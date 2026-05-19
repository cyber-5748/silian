"""
对话上下文管理模块
实现思维导图式对话的上下文构建和压缩功能
"""
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum
from pydantic import BaseModel, Field
import tiktoken

from app.logger import get_logger
from app.storage import get_session, get_node_path
from app.ai_models import ChatMessage

logger = get_logger("context")


class CompressionStrategy(str, Enum):
    RECENT_N = "recent_n"
    SUMMARY = "summary"
    HYBRID = "hybrid"


class ContextMessage(BaseModel):
    role: str
    content: str
    timestamp: Optional[str] = None
    node_id: Optional[str] = None
    token_count: int = 0


class ContextConfig(BaseModel):
    max_tokens: int = Field(default=4096, description="上下文最大token数")
    recent_messages_count: int = Field(default=6, description="保留最近N条消息")
    compression_strategy: CompressionStrategy = Field(
        default=CompressionStrategy.HYBRID, 
        description="压缩策略"
    )
    summary_max_tokens: int = Field(default=500, description="摘要最大token数")
    preserve_first_message: bool = Field(default=True, description="是否保留第一条消息")


class ContextBuildResult(BaseModel):
    messages: List[ContextMessage]
    total_tokens: int
    original_tokens: int
    compressed: bool
    compression_ratio: Optional[float] = None
    strategy_used: Optional[CompressionStrategy] = None


class ContextSummary(BaseModel):
    node_id: str
    summary: str
    message_count: int
    token_count: int
    created_at: str


class ConversationContext:
    """对话上下文管理器"""

    def __init__(self, config: Optional[ContextConfig] = None):
        self.config = config or ContextConfig()
        self._encoding: Optional[Any] = None
        self._summaries_cache: Dict[str, ContextSummary] = {}

    def _get_encoding(self):
        if self._encoding is None:
            try:
                self._encoding = tiktoken.get_encoding("cl100k_base")
            except Exception:
                self._encoding = None
        return self._encoding

    def count_tokens(self, text: str) -> int:
        if not text:
            return 0
        encoding = self._get_encoding()
        if encoding:
            try:
                return len(encoding.encode(text))
            except Exception:
                pass
        return len(text) // 4

    def count_messages_tokens(self, messages: List[ContextMessage]) -> int:
        total = 0
        for msg in messages:
            total += self.count_tokens(msg.content)
            total += 4
        return total

    def build_context_from_node(
        self, 
        session_id: str, 
        node_id: str,
        include_current: bool = True
    ) -> List[ContextMessage]:
        session = get_session(session_id)
        if session is None:
            return []
        
        path = get_node_path(session_id, node_id)
        if not path:
            return []
        
        logger.debug("构建上下文: session_id=%s, node_id=%s, path_len=%d", session_id, node_id, len(path))
        
        messages: List[ContextMessage] = []
        
        for node in path:
            if not include_current and node["id"] == node_id:
                continue
            
            if node.get("user_message"):
                messages.append(ContextMessage(
                    role="user",
                    content=node["user_message"],
                    timestamp=node.get("timestamp"),
                    node_id=node["id"],
                    token_count=self.count_tokens(node["user_message"])
                ))
            
            if node.get("ai_reply"):
                messages.append(ContextMessage(
                    role="assistant",
                    content=node["ai_reply"],
                    timestamp=node.get("timestamp"),
                    node_id=node["id"],
                    token_count=self.count_tokens(node["ai_reply"])
                ))
        
        return messages

    def build_context_from_multiple_branches(
        self,
        session_id: str,
        node_ids: List[str]
    ) -> List[ContextMessage]:
        if not node_ids:
            return []
        
        all_messages: List[ContextMessage] = []
        seen_node_ids: set = set()
        
        for node_id in node_ids:
            messages = self.build_context_from_node(session_id, node_id)
            for msg in messages:
                if msg.node_id and msg.node_id not in seen_node_ids:
                    all_messages.append(msg)
                    seen_node_ids.add(msg.node_id)
        
        all_messages.sort(key=lambda m: m.timestamp or "")
        
        return all_messages

    def compress_context(
        self,
        messages: List[ContextMessage],
        strategy: Optional[CompressionStrategy] = None
    ) -> Tuple[List[ContextMessage], bool, CompressionStrategy]:
        if not messages:
            return messages, False, CompressionStrategy.RECENT_N
        
        strategy = strategy or self.config.compression_strategy
        original_tokens = self.count_messages_tokens(messages)
        
        if original_tokens <= self.config.max_tokens:
            return messages, False, strategy
        
        compressed_messages: List[ContextMessage] = []
        
        if strategy == CompressionStrategy.RECENT_N:
            compressed_messages = self._compress_recent_n(messages)
        elif strategy == CompressionStrategy.SUMMARY:
            compressed_messages = self._compress_summary(messages)
        else:
            compressed_messages = self._compress_hybrid(messages)
        
        return compressed_messages, True, strategy

    def _compress_recent_n(self, messages: List[ContextMessage]) -> List[ContextMessage]:
        result: List[ContextMessage] = []
        
        if self.config.preserve_first_message and messages:
            first_user_msg = None
            for msg in messages:
                if msg.role == "user":
                    first_user_msg = msg
                    break
            
            if first_user_msg:
                result.append(first_user_msg)
        
        recent_count = self.config.recent_messages_count
        if self.config.preserve_first_message and result:
            recent_count += 2
        
        recent_messages = messages[-recent_count:] if len(messages) > recent_count else messages
        
        for msg in recent_messages:
            if msg not in result:
                result.append(msg)
        
        seen = set()
        unique_result = []
        for msg in result:
            key = (msg.role, msg.content[:50] if msg.content else "")
            if key not in seen:
                seen.add(key)
                unique_result.append(msg)
        
        return unique_result

    def _compress_summary(self, messages: List[ContextMessage]) -> List[ContextMessage]:
        if len(messages) <= 2:
            return messages
        
        summary_content = self._generate_summary(messages[:-2])
        
        summary_msg = ContextMessage(
            role="system",
            content=f"[历史对话摘要]\n{summary_content}",
            token_count=self.count_tokens(summary_content)
        )
        
        result = [summary_msg] + messages[-2:]
        return result

    def _compress_hybrid(self, messages: List[ContextMessage]) -> List[ContextMessage]:
        result: List[ContextMessage] = []
        
        if self.config.preserve_first_message and messages:
            first_user_msg = None
            for msg in messages:
                if msg.role == "user":
                    first_user_msg = msg
                    break
            
            if first_user_msg:
                result.append(first_user_msg)
        
        recent_messages_count = self.config.recent_messages_count
        recent_messages = messages[-recent_messages_count:] if len(messages) > recent_messages_count else messages
        
        older_messages = messages[:-recent_messages_count] if len(messages) > recent_messages_count else []
        
        if older_messages:
            older_to_summarize = [m for m in older_messages if m not in result]
            if older_to_summarize:
                summary_content = self._generate_summary(older_to_summarize)
                summary_msg = ContextMessage(
                    role="system",
                    content=f"[历史对话摘要]\n{summary_content}",
                    token_count=self.count_tokens(summary_content)
                )
                result.append(summary_msg)
        
        for msg in recent_messages:
            if msg not in result:
                result.append(msg)
        
        return result

    def _generate_summary(self, messages: List[ContextMessage]) -> str:
        if not messages:
            return ""
        
        topics: List[str] = []
        current_topic: List[str] = []
        
        for msg in messages:
            content = msg.content[:200] if msg.content else ""
            if msg.role == "user":
                if current_topic:
                    topics.append(" ".join(current_topic))
                    current_topic = []
                current_topic.append(f"用户问:{content[:100]}")
            else:
                current_topic.append(f"AI答:{content[:100]}")
        
        if current_topic:
            topics.append(" ".join(current_topic))
        
        summary = " | ".join(topics[:5])
        
        if len(summary) > self.config.summary_max_tokens * 4:
            summary = summary[:self.config.summary_max_tokens * 4] + "..."
        
        return summary

    def build_and_compress_context(
        self,
        session_id: str,
        node_id: str,
        config: Optional[ContextConfig] = None
    ) -> ContextBuildResult:
        if config:
            original_config = self.config
            self.config = config
        
        messages = self.build_context_from_node(session_id, node_id)
        original_tokens = self.count_messages_tokens(messages)
        
        compressed_messages, was_compressed, strategy = self.compress_context(messages)
        final_tokens = self.count_messages_tokens(compressed_messages)
        
        if was_compressed:
            logger.debug("上下文压缩: session_id=%s, %d->%d tokens, strategy=%s", 
                        session_id, original_tokens, final_tokens, strategy.value)
        
        if config:
            self.config = original_config
        
        compression_ratio = None
        if was_compressed and original_tokens > 0:
            compression_ratio = final_tokens / original_tokens
        
        return ContextBuildResult(
            messages=compressed_messages,
            total_tokens=final_tokens,
            original_tokens=original_tokens,
            compressed=was_compressed,
            compression_ratio=compression_ratio,
            strategy_used=strategy if was_compressed else None
        )

    def to_chat_messages(self, context_messages: List[ContextMessage]) -> List[ChatMessage]:
        return [
            ChatMessage(role=msg.role, content=msg.content)
            for msg in context_messages
        ]

    def get_context_stats(self, messages: List[ContextMessage]) -> Dict[str, Any]:
        if not messages:
            return {
                "message_count": 0,
                "total_tokens": 0,
                "user_messages": 0,
                "assistant_messages": 0,
                "system_messages": 0,
                "avg_tokens_per_message": 0,
            }
        
        total_tokens = self.count_messages_tokens(messages)
        user_count = sum(1 for m in messages if m.role == "user")
        assistant_count = sum(1 for m in messages if m.role == "assistant")
        system_count = sum(1 for m in messages if m.role == "system")
        
        return {
            "message_count": len(messages),
            "total_tokens": total_tokens,
            "user_messages": user_count,
            "assistant_messages": assistant_count,
            "system_messages": system_count,
            "avg_tokens_per_message": total_tokens // len(messages) if messages else 0,
        }

    def estimate_cost(
        self,
        messages: List[ContextMessage],
        input_cost_per_1k: float = 0.0005,
        output_cost_per_1k: float = 0.0015
    ) -> Dict[str, float]:
        total_tokens = self.count_messages_tokens(messages)
        input_cost = (total_tokens / 1000) * input_cost_per_1k
        
        return {
            "input_tokens": total_tokens,
            "estimated_input_cost": input_cost,
            "input_cost_per_1k": input_cost_per_1k,
            "output_cost_per_1k": output_cost_per_1k,
        }


context_manager = ConversationContext()
