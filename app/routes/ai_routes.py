"""
AI模型API路由
"""
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.logger import get_logger
from app.ai_models import (
    model_manager,
    ModelProvider,
    ModelConfig,
    ChatMessage,
    ChatResponse,
)

logger = get_logger("ai_routes")


router = APIRouter(prefix="/api/ai", tags=["AI模型"])


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    model_id: Optional[str] = None
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    stream: bool = False


class RegisterModelRequest(BaseModel):
    provider: str
    model_name: str
    api_key: str
    base_url: Optional[str] = None
    secret_key: Optional[str] = None
    endpoint_id: Optional[str] = None
    is_default: bool = False


class SetDefaultModelRequest(BaseModel):
    model_id: str


class ModelInfo(BaseModel):
    id: str
    provider: str
    model_name: str
    is_default: bool
    enabled: bool


class ModelListResponse(BaseModel):
    models: List[ModelInfo]
    default_model: Optional[str]


class ChatResponseModel(BaseModel):
    content: str
    model: str
    provider: str
    usage: Optional[dict] = None
    finish_reason: Optional[str] = None


@router.get("/models", response_model=ModelListResponse)
async def list_models():
    """获取所有已注册的AI模型列表"""
    models = model_manager.list_models()
    logger.info("获取模型列表: %d个模型", len(models))
    return ModelListResponse(
        models=[ModelInfo(**m) for m in models],
        default_model=model_manager.get_default_model_id(),
    )


@router.post("/models/register")
async def register_model(request: RegisterModelRequest):
    """注册新的AI模型"""
    try:
        provider = ModelProvider(request.provider)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的模型提供商: {request.provider}。支持的提供商: {[p.value for p in ModelProvider]}"
        )

    config = ModelConfig(
        provider=provider,
        model_name=request.model_name,
        api_key=request.api_key,
        base_url=request.base_url,
        secret_key=request.secret_key,
        endpoint_id=request.endpoint_id,
        is_default=request.is_default,
    )

    try:
        model_id = model_manager.register_model(config)
        logger.info("注册模型: %s (provider=%s)", request.model_name, request.provider)
        return {
            "success": True,
            "model_id": model_id,
            "message": f"模型 {model_id} 注册成功"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/models/{model_id}")
async def unregister_model(model_id: str):
    """注销AI模型"""
    if model_manager.unregister_model(model_id):
        return {"success": True, "message": f"模型 {model_id} 已注销"}
    raise HTTPException(status_code=404, detail=f"模型不存在: {model_id}")


@router.put("/models/default")
async def set_default_model(request: SetDefaultModelRequest):
    """设置默认AI模型"""
    if model_manager.set_default_model(request.model_id):
        logger.info("切换默认模型: %s", request.model_id)
        return {
            "success": True,
            "message": f"默认模型已设置为: {request.model_id}"
        }
    raise HTTPException(status_code=404, detail=f"模型不存在: {request.model_id}")


@router.get("/models/{model_id}/validate")
async def validate_model(model_id: str):
    """验证模型配置是否有效"""
    if model_manager.validate_model(model_id):
        return {"valid": True, "model_id": model_id}
    raise HTTPException(status_code=400, detail=f"模型配置无效: {model_id}")


@router.post("/chat", response_model=ChatResponseModel)
async def chat(request: ChatRequest):
    """发送聊天请求"""
    try:
        model = model_manager.get_model(request.model_id)
        response = await model.chat(
            messages=request.messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            stream=False,
        )
        return ChatResponseModel(
            content=response.content,
            model=response.model,
            provider=response.provider,
            usage=response.usage,
            finish_reason=response.finish_reason,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI模型调用失败: {str(e)}")


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """流式聊天请求"""

    async def generate():
        try:
            model = model_manager.get_model(request.model_id)
            async for chunk in model.chat_stream(
                messages=request.messages,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
            ):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except ValueError as e:
            yield f"data: [ERROR] {str(e)}\n\n"
        except Exception as e:
            yield f"data: [ERROR] AI模型调用失败: {str(e)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.get("/providers")
async def list_providers():
    """获取支持的AI模型提供商列表"""
    return {
        "providers": [
            {
                "id": ModelProvider.OPENAI.value,
                "name": "OpenAI",
                "description": "OpenAI GPT系列模型",
                "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
                "required_config": ["api_key", "model_name"],
                "optional_config": ["base_url"],
            },
            {
                "id": ModelProvider.BAIDU.value,
                "name": "百度文心一言",
                "description": "百度文心大模型",
                "models": ["ernie-4.0-8k", "ernie-3.5-8k", "ernie-speed-8k", "ernie-lite-8k"],
                "required_config": ["api_key", "secret_key", "model_name"],
                "optional_config": [],
            },
            {
                "id": ModelProvider.BYTEPLUS.value,
                "name": "字节豆包",
                "description": "字节跳动火山引擎Ark API",
                "models": ["doubao-pro-32k", "doubao-lite-32k", "doubao-pro-128k"],
                "required_config": ["api_key", "model_name"],
                "optional_config": ["endpoint_id", "base_url"],
            },
        ]
    }
