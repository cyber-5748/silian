"""
对话上下文管理API路由
"""
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.context import (
    context_manager,
    ContextConfig,
    ContextMessage,
    ContextBuildResult,
    CompressionStrategy,
)
from app.storage import get_session, get_node_path


router = APIRouter(prefix="/api/context", tags=["上下文管理"])


class BuildContextRequest(BaseModel):
    session_id: str
    node_id: str
    include_current: bool = True
    max_tokens: Optional[int] = None
    recent_messages_count: Optional[int] = None
    compression_strategy: Optional[CompressionStrategy] = None
    preserve_first_message: Optional[bool] = None


class BuildMultiBranchRequest(BaseModel):
    session_id: str
    node_ids: List[str]
    max_tokens: Optional[int] = None
    recent_messages_count: Optional[int] = None
    compression_strategy: Optional[CompressionStrategy] = None


class ContextMessageResponse(BaseModel):
    role: str
    content: str
    timestamp: Optional[str] = None
    node_id: Optional[str] = None
    token_count: int


class ContextBuildResponse(BaseModel):
    messages: List[ContextMessageResponse]
    total_tokens: int
    original_tokens: int
    compressed: bool
    compression_ratio: Optional[float] = None
    strategy_used: Optional[str] = None
    message_count: int


class ContextStatsResponse(BaseModel):
    message_count: int
    total_tokens: int
    user_messages: int
    assistant_messages: int
    system_messages: int
    avg_tokens_per_message: int


class CostEstimateResponse(BaseModel):
    input_tokens: int
    estimated_input_cost: float
    input_cost_per_1k: float
    output_cost_per_1k: float


class NodePathResponse(BaseModel):
    session_id: str
    node_id: str
    path: List[dict]
    path_length: int


class ConfigUpdateRequest(BaseModel):
    max_tokens: Optional[int] = None
    recent_messages_count: Optional[int] = None
    compression_strategy: Optional[CompressionStrategy] = None
    summary_max_tokens: Optional[int] = None
    preserve_first_message: Optional[bool] = None


class ConfigResponse(BaseModel):
    max_tokens: int
    recent_messages_count: int
    compression_strategy: str
    summary_max_tokens: int
    preserve_first_message: bool


@router.post("/build", response_model=ContextBuildResponse)
async def build_context(request: BuildContextRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {request.session_id}")
    
    path = get_node_path(request.session_id, request.node_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"节点不存在: {request.node_id}")
    
    config = None
    if any([
        request.max_tokens is not None,
        request.recent_messages_count is not None,
        request.compression_strategy is not None,
        request.preserve_first_message is not None,
    ]):
        config = ContextConfig(
            max_tokens=request.max_tokens or context_manager.config.max_tokens,
            recent_messages_count=request.recent_messages_count or context_manager.config.recent_messages_count,
            compression_strategy=request.compression_strategy or context_manager.config.compression_strategy,
            preserve_first_message=request.preserve_first_message if request.preserve_first_message is not None else context_manager.config.preserve_first_message,
        )
    
    result = context_manager.build_and_compress_context(
        session_id=request.session_id,
        node_id=request.node_id,
        config=config,
    )
    
    return ContextBuildResponse(
        messages=[
            ContextMessageResponse(
                role=msg.role,
                content=msg.content,
                timestamp=msg.timestamp,
                node_id=msg.node_id,
                token_count=msg.token_count,
            )
            for msg in result.messages
        ],
        total_tokens=result.total_tokens,
        original_tokens=result.original_tokens,
        compressed=result.compressed,
        compression_ratio=result.compression_ratio,
        strategy_used=result.strategy_used.value if result.strategy_used else None,
        message_count=len(result.messages),
    )


@router.post("/build-raw", response_model=ContextBuildResponse)
async def build_raw_context(request: BuildContextRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {request.session_id}")
    
    messages = context_manager.build_context_from_node(
        session_id=request.session_id,
        node_id=request.node_id,
        include_current=request.include_current,
    )
    
    total_tokens = context_manager.count_messages_tokens(messages)
    
    return ContextBuildResponse(
        messages=[
            ContextMessageResponse(
                role=msg.role,
                content=msg.content,
                timestamp=msg.timestamp,
                node_id=msg.node_id,
                token_count=msg.token_count,
            )
            for msg in messages
        ],
        total_tokens=total_tokens,
        original_tokens=total_tokens,
        compressed=False,
        compression_ratio=None,
        strategy_used=None,
        message_count=len(messages),
    )


@router.post("/build-multi-branch", response_model=ContextBuildResponse)
async def build_multi_branch_context(request: BuildMultiBranchRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {request.session_id}")
    
    messages = context_manager.build_context_from_multiple_branches(
        session_id=request.session_id,
        node_ids=request.node_ids,
    )
    
    original_tokens = context_manager.count_messages_tokens(messages)
    
    config = None
    if request.max_tokens or request.recent_messages_count or request.compression_strategy:
        config = ContextConfig(
            max_tokens=request.max_tokens or context_manager.config.max_tokens,
            recent_messages_count=request.recent_messages_count or context_manager.config.recent_messages_count,
            compression_strategy=request.compression_strategy or context_manager.config.compression_strategy,
        )
    
    compressed_messages, was_compressed, strategy = context_manager.compress_context(
        messages=messages,
        strategy=request.compression_strategy,
    )
    
    final_tokens = context_manager.count_messages_tokens(compressed_messages)
    
    compression_ratio = None
    if was_compressed and original_tokens > 0:
        compression_ratio = final_tokens / original_tokens
    
    return ContextBuildResponse(
        messages=[
            ContextMessageResponse(
                role=msg.role,
                content=msg.content,
                timestamp=msg.timestamp,
                node_id=msg.node_id,
                token_count=msg.token_count,
            )
            for msg in compressed_messages
        ],
        total_tokens=final_tokens,
        original_tokens=original_tokens,
        compressed=was_compressed,
        compression_ratio=compression_ratio,
        strategy_used=strategy.value if was_compressed else None,
        message_count=len(compressed_messages),
    )


@router.post("/compress", response_model=ContextBuildResponse)
async def compress_context(
    messages: List[ContextMessage],
    strategy: Optional[CompressionStrategy] = None,
    max_tokens: Optional[int] = None,
):
    if not messages:
        raise HTTPException(status_code=400, detail="消息列表不能为空")
    
    original_tokens = context_manager.count_messages_tokens(messages)
    
    config = None
    if max_tokens:
        config = ContextConfig(max_tokens=max_tokens)
        original_config = context_manager.config
        context_manager.config = config
    
    compressed_messages, was_compressed, used_strategy = context_manager.compress_context(
        messages=messages,
        strategy=strategy,
    )
    
    if max_tokens:
        context_manager.config = original_config
    
    final_tokens = context_manager.count_messages_tokens(compressed_messages)
    
    compression_ratio = None
    if was_compressed and original_tokens > 0:
        compression_ratio = final_tokens / original_tokens
    
    return ContextBuildResponse(
        messages=[
            ContextMessageResponse(
                role=msg.role,
                content=msg.content,
                timestamp=msg.timestamp,
                node_id=msg.node_id,
                token_count=msg.token_count,
            )
            for msg in compressed_messages
        ],
        total_tokens=final_tokens,
        original_tokens=original_tokens,
        compressed=was_compressed,
        compression_ratio=compression_ratio,
        strategy_used=used_strategy.value if was_compressed else None,
        message_count=len(compressed_messages),
    )


@router.get("/node-path/{session_id}/{node_id}", response_model=NodePathResponse)
async def get_node_path_api(session_id: str, node_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")
    
    path = get_node_path(session_id, node_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"节点不存在: {node_id}")
    
    return NodePathResponse(
        session_id=session_id,
        node_id=node_id,
        path=path,
        path_length=len(path),
    )


@router.post("/stats", response_model=ContextStatsResponse)
async def get_context_stats(messages: List[ContextMessage]):
    stats = context_manager.get_context_stats(messages)
    return ContextStatsResponse(**stats)


@router.post("/estimate-cost", response_model=CostEstimateResponse)
async def estimate_cost(
    messages: List[ContextMessage],
    input_cost_per_1k: float = 0.0005,
    output_cost_per_1k: float = 0.0015,
):
    estimate = context_manager.estimate_cost(
        messages=messages,
        input_cost_per_1k=input_cost_per_1k,
        output_cost_per_1k=output_cost_per_1k,
    )
    return CostEstimateResponse(**estimate)


@router.get("/config", response_model=ConfigResponse)
async def get_config():
    config = context_manager.config
    return ConfigResponse(
        max_tokens=config.max_tokens,
        recent_messages_count=config.recent_messages_count,
        compression_strategy=config.compression_strategy.value,
        summary_max_tokens=config.summary_max_tokens,
        preserve_first_message=config.preserve_first_message,
    )


@router.put("/config", response_model=ConfigResponse)
async def update_config(request: ConfigUpdateRequest):
    if request.max_tokens is not None:
        context_manager.config.max_tokens = request.max_tokens
    if request.recent_messages_count is not None:
        context_manager.config.recent_messages_count = request.recent_messages_count
    if request.compression_strategy is not None:
        context_manager.config.compression_strategy = request.compression_strategy
    if request.summary_max_tokens is not None:
        context_manager.config.summary_max_tokens = request.summary_max_tokens
    if request.preserve_first_message is not None:
        context_manager.config.preserve_first_message = request.preserve_first_message
    
    config = context_manager.config
    return ConfigResponse(
        max_tokens=config.max_tokens,
        recent_messages_count=config.recent_messages_count,
        compression_strategy=config.compression_strategy.value,
        summary_max_tokens=config.summary_max_tokens,
        preserve_first_message=config.preserve_first_message,
    )


@router.post("/count-tokens")
async def count_tokens(text: str):
    token_count = context_manager.count_tokens(text)
    return {
        "text_length": len(text),
        "token_count": token_count,
    }


@router.get("/strategies")
async def list_compression_strategies():
    return {
        "strategies": [
            {
                "id": CompressionStrategy.RECENT_N.value,
                "name": "保留最近N条",
                "description": "保留最近的N条消息，可选择保留第一条消息",
            },
            {
                "id": CompressionStrategy.SUMMARY.value,
                "name": "摘要压缩",
                "description": "将历史消息压缩为摘要，保留最近几条消息",
            },
            {
                "id": CompressionStrategy.HYBRID.value,
                "name": "混合策略",
                "description": "结合保留第一条消息、摘要压缩和保留最近消息的策略",
            },
        ]
    }
