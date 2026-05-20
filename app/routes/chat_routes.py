"""
对话消息处理API路由
实现流式响应和对话上下文管理
"""
import json
from typing import Optional, List, AsyncGenerator
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.logger import get_logger
from app.ai_models import model_manager, ChatMessage
from app.context import context_manager, ContextConfig, CompressionStrategy
from app.storage import get_session, add_node, update_node, get_node_path

logger = get_logger("chat")


router = APIRouter(prefix="/api/chat", tags=["对话消息"])


class SendMessageRequest(BaseModel):
    content: str
    session_id: str
    parent_node_id: str = "root"
    model_id: Optional[str] = None
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    stream: bool = True


class MessageResponse(BaseModel):
    role: str
    content: str
    node_id: Optional[str] = None


class ChatHistoryResponse(BaseModel):
    session_id: str
    messages: List[MessageResponse]
    total_messages: int


class StreamChunk(BaseModel):
    type: str
    content: str
    node_id: Optional[str] = None
    done: bool = False


async def generate_stream_response(
    messages: List[ChatMessage],
    model_id: Optional[str],
    temperature: float,
    max_tokens: Optional[int],
    session_id: str,
    user_content: str,
    parent_node_id: str,
) -> AsyncGenerator[str, None]:
    full_content = ""
    node_id = None

    try:
        model = model_manager.get_model(model_id)

        yield f"data: {json.dumps({'type': 'start', 'content': ''}, ensure_ascii=False)}\n\n"

        async for chunk in model.chat_stream(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            full_content += chunk
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk}, ensure_ascii=False)}\n\n"

        # AI回复完成后，使用 add_node 创建新节点
        new_node = add_node(
            session_id=session_id,
            node_data={
                "parent_id": parent_node_id,
                "user_message": user_content,
                "ai_reply": full_content,
            },
        )
        node_id = new_node["id"] if new_node else None

        yield f"data: {json.dumps({'type': 'done', 'content': full_content, 'node_id': node_id, 'parent_id': parent_node_id}, ensure_ascii=False)}\n\n"

    except ValueError as e:
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': f'AI模型调用失败: {str(e)}'}, ensure_ascii=False)}\n\n"


def save_ai_response_to_session(
    session_id: str,
    user_content: str,
    ai_content: str,
    parent_node_id: str = "root",
) -> Optional[str]:
    """使用 add_node 创建节点，替代直接操作 session["messages"]。"""
    new_node = add_node(
        session_id=session_id,
        node_data={
            "parent_id": parent_node_id,
            "user_message": user_content,
            "ai_reply": ai_content,
        },
    )
    if new_node:
        return new_node["id"]
    return None


def build_context_for_chat(
    session_id: str,
    current_message: str,
    parent_node_id: str = "root",
) -> List[ChatMessage]:
    """使用 context_manager.build_context_from_node 沿 parent 链回溯构建上下文。"""
    # 构建上下文：从根到 parent_node_id 的路径
    context_messages = context_manager.build_context_from_node(
        session_id=session_id,
        node_id=parent_node_id,
        include_current=True,
    )

    # 转换为 ChatMessage 列表
    messages = context_manager.to_chat_messages(context_messages)

    # 添加当前用户消息
    messages.append(ChatMessage(role="user", content=current_message))

    return messages


@router.post("/send")
async def send_message(request: SendMessageRequest):
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="消息内容不能为空")

    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {request.session_id}")

    # 验证 parent_node_id 对应的节点存在
    nodes = session.get("nodes", [])
    if request.parent_node_id != "root":
        node_exists = any(n["id"] == request.parent_node_id for n in nodes)
        if not node_exists:
            raise HTTPException(status_code=400, detail=f"父节点不存在: {request.parent_node_id}")

    logger.info("发送消息: session_id=%s, parent_node_id=%s", request.session_id, request.parent_node_id)

    messages = build_context_for_chat(
        session_id=request.session_id,
        current_message=request.content,
        parent_node_id=request.parent_node_id,
    )

    if request.stream:
        return StreamingResponse(
            generate_stream_response(
                messages=messages,
                model_id=request.model_id,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                session_id=request.session_id,
                user_content=request.content,
                parent_node_id=request.parent_node_id,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    else:
        try:
            model = model_manager.get_model(request.model_id)
            response = await model.chat(
                messages=messages,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                stream=False,
            )

            node_id = save_ai_response_to_session(
                session_id=request.session_id,
                user_content=request.content,
                ai_content=response.content,
                parent_node_id=request.parent_node_id,
            )

            return {
                "role": "assistant",
                "content": response.content,
                "node_id": node_id,
                "parent_id": request.parent_node_id,
                "model": response.model,
                "provider": response.provider,
            }

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error("AI模型调用失败: session_id=%s, error=%s", request.session_id, str(e))
            raise HTTPException(status_code=500, detail=f"AI模型调用失败: {str(e)}")

@router.post("/send/stream")
async def send_message_stream(request: SendMessageRequest):
    request.stream = True
    return await send_message(request)


@router.get("/history/{session_id}", response_model=ChatHistoryResponse)
async def get_chat_history(session_id: str, limit: int = 50, offset: int = 0):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    messages = session.get("messages", [])
    total = len(messages)

    paginated_messages = messages[offset:offset + limit]

    return ChatHistoryResponse(
        session_id=session_id,
        messages=[
            MessageResponse(
                role=msg["role"],
                content=msg["content"],
                node_id=msg.get("node_id"),
            )
            for msg in paginated_messages
        ],
        total_messages=total,
    )


@router.post("/context/build")
async def build_context(
    session_id: str,
    node_id: Optional[str] = None,
    max_tokens: int = 4096,
    compression_strategy: str = "hybrid",
):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    try:
        strategy = CompressionStrategy(compression_strategy)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的压缩策略: {compression_strategy}"
        )

    config = ContextConfig(
        max_tokens=max_tokens,
        compression_strategy=strategy,
    )

    if node_id:
        result = context_manager.build_and_compress_context(
            session_id=session_id,
            node_id=node_id,
            config=config,
        )
    else:
        messages = []
        for msg in session.get("messages", []):
            from app.context import ContextMessage
            messages.append(ContextMessage(
                role=msg["role"],
                content=msg["content"],
                timestamp=msg.get("timestamp"),
                node_id=msg.get("node_id"),
            ))

        compressed_messages, was_compressed, used_strategy = context_manager.compress_context(
            messages, strategy
        )

        from app.context import ContextBuildResult
        result = ContextBuildResult(
            messages=compressed_messages,
            total_tokens=context_manager.count_messages_tokens(compressed_messages),
            original_tokens=context_manager.count_messages_tokens(messages),
            compressed=was_compressed,
            compression_ratio=context_manager.count_messages_tokens(compressed_messages) / context_manager.count_messages_tokens(messages) if was_compressed and messages else None,
            strategy_used=used_strategy if was_compressed else None,
        )

    return {
        "messages": [
            {
                "role": msg.role,
                "content": msg.content,
                "token_count": msg.token_count,
            }
            for msg in result.messages
        ],
        "total_tokens": result.total_tokens,
        "original_tokens": result.original_tokens,
        "compressed": result.compressed,
        "compression_ratio": result.compression_ratio,
        "strategy_used": result.strategy_used.value if result.strategy_used else None,
    }


@router.get("/context/stats/{session_id}")
async def get_context_stats(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    from app.context import ContextMessage

    messages = []
    for msg in session.get("messages", []):
        messages.append(ContextMessage(
            role=msg["role"],
            content=msg["content"],
            timestamp=msg.get("timestamp"),
            node_id=msg.get("node_id"),
        ))

    stats = context_manager.get_context_stats(messages)

    return stats


@router.post("/regenerate/{session_id}/{node_id}")
async def regenerate_response(
    session_id: str,
    node_id: str,
    model_id: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
    stream: bool = True,
):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    # 在 nodes 列表中查找节点
    nodes = session.get("nodes", [])
    target_node = None
    for n in nodes:
        if n["id"] == node_id:
            target_node = n
            break

    if not target_node:
        raise HTTPException(status_code=404, detail=f"节点不存在: {node_id}")

    user_content = target_node.get("user_message")
    if not user_content:
        raise HTTPException(status_code=400, detail="该节点没有用户消息")

    parent_id = target_node.get("parent_id", "root")

    messages = build_context_for_chat(
        session_id=session_id,
        current_message=user_content,
        parent_node_id=parent_id,
    )

    if stream:
        return StreamingResponse(
            generate_stream_response(
                messages=messages,
                model_id=model_id,
                temperature=temperature,
                max_tokens=max_tokens,
                session_id=session_id,
                user_content=user_content,
                parent_node_id=parent_id,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    else:
        try:
            model = model_manager.get_model(model_id)
            response = await model.chat(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
            )

            # 更新现有节点的 ai_reply
            update_node(
                session_id=session_id,
                node_id=node_id,
                updates={"ai_reply": response.content},
            )

            return {
                "role": "assistant",
                "content": response.content,
                "node_id": node_id,
                "parent_id": parent_id,
                "model": response.model,
                "provider": response.provider,
            }

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error("重新生成失败: session_id=%s, node_id=%s, error=%s", session_id, node_id, str(e))
            raise HTTPException(status_code=500, detail=f"AI模型调用失败: {str(e)}")
