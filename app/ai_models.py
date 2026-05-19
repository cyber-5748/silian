"""
AI模型封装模块
支持OpenAI、百度文心一言、字节豆包等AI模型
"""
import json
import time
import hashlib
import hmac
import base64
import urllib.parse
from abc import ABC, abstractmethod
from typing import Optional, AsyncGenerator, Dict, Any, List
from enum import Enum
import httpx
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.logger import get_logger
logger = get_logger("ai_models")


class ModelProvider(str, Enum):
    OPENAI = "openai"
    BAIDU = "baidu"
    BYTEPLUS = "byteplus"


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatResponse(BaseModel):
    content: str
    model: str
    provider: str
    usage: Optional[Dict[str, int]] = None
    finish_reason: Optional[str] = None


class AIModelBase(ABC):
    """AI模型基类"""

    def __init__(
        self,
        api_key: str,
        model_name: str,
        base_url: Optional[str] = None,
        **kwargs
    ):
        self.api_key = api_key
        self.model_name = model_name
        self.base_url = base_url
        self.extra_params = kwargs

    @abstractmethod
    async def chat(
        self,
        messages: List[ChatMessage],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        **kwargs
    ) -> ChatResponse:
        """发送聊天请求"""
        pass

    @abstractmethod
    async def chat_stream(
        self,
        messages: List[ChatMessage],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """流式聊天"""
        pass

    def validate_config(self) -> bool:
        """验证配置是否有效"""
        return bool(self.api_key)


class OpenAIModel(AIModelBase):
    """OpenAI模型封装"""

    def __init__(
        self,
        api_key: str,
        model_name: str = "gpt-4o-mini",
        base_url: Optional[str] = None,
        **kwargs
    ):
        super().__init__(api_key, model_name, base_url, **kwargs)
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        self.client = AsyncOpenAI(**client_kwargs)

    async def chat(
        self,
        messages: List[ChatMessage],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        **kwargs
    ) -> ChatResponse:
        message_dicts = [{"role": m.role, "content": m.content} for m in messages]

        completion_params = {
            "model": self.model_name,
            "messages": message_dicts,
            "temperature": temperature,
        }
        if max_tokens:
            completion_params["max_tokens"] = max_tokens
        completion_params.update(kwargs)

        response = await self.client.chat.completions.create(**completion_params)

        return ChatResponse(
            content=response.choices[0].message.content or "",
            model=response.model,
            provider=ModelProvider.OPENAI.value,
            usage={
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                "total_tokens": response.usage.total_tokens if response.usage else 0,
            } if response.usage else None,
            finish_reason=response.choices[0].finish_reason,
        )

    async def chat_stream(
        self,
        messages: List[ChatMessage],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        message_dicts = [{"role": m.role, "content": m.content} for m in messages]

        completion_params = {
            "model": self.model_name,
            "messages": message_dicts,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens:
            completion_params["max_tokens"] = max_tokens
        completion_params.update(kwargs)

        stream = await self.client.chat.completions.create(**completion_params)

        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


class BaiduWenxinModel(AIModelBase):
    """百度文心一言模型封装"""

    MODEL_ENDPOINTS = {
        "ernie-4.0-8k": "completions_pro",
        "ernie-3.5-8k": "completions",
        "ernie-3.5-8k-0205": "completions",
        "ernie-speed-8k": "ernie_speed",
        "ernie-speed-128k": "ernie-speed-128k",
        "ernie-lite-8k": "eb-instant",
        "ernie-tiny-8k": "ernie-tiny-8k",
    }

    def __init__(
        self,
        api_key: str,
        secret_key: str,
        model_name: str = "ernie-3.5-8k",
        **kwargs
    ):
        super().__init__(api_key, model_name, **kwargs)
        self.secret_key = secret_key
        self._access_token: Optional[str] = None
        self._token_expire_time: float = 0

    def validate_config(self) -> bool:
        return bool(self.api_key and self.secret_key)

    async def _get_access_token(self) -> str:
        if self._access_token and time.time() < self._token_expire_time:
            return self._access_token

        url = f"https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id={self.api_key}&client_secret={self.secret_key}"

        async with httpx.AsyncClient() as client:
            response = await client.post(url)
            result = response.json()

        if "access_token" not in result:
            raise ValueError(f"获取百度access_token失败: {result}")

        self._access_token = result["access_token"]
        self._token_expire_time = time.time() + result.get("expires_in", 86400) - 300

        return self._access_token

    def _get_endpoint(self) -> str:
        return self.MODEL_ENDPOINTS.get(self.model_name, "completions")

    async def chat(
        self,
        messages: List[ChatMessage],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        **kwargs
    ) -> ChatResponse:
        access_token = await self._get_access_token()
        endpoint = self._get_endpoint()
        url = f"https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{endpoint}?access_token={access_token}"

        message_dicts = [{"role": m.role, "content": m.content} for m in messages]

        payload = {
            "messages": message_dicts,
            "temperature": temperature,
        }
        if max_tokens:
            payload["max_output_tokens"] = max_tokens
        payload.update(kwargs)

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, json=payload)
            result = response.json()

        if "error_code" in result:
            raise ValueError(f"百度文心API错误: {result.get('error_msg', result)}")

        return ChatResponse(
            content=result.get("result", ""),
            model=self.model_name,
            provider=ModelProvider.BAIDU.value,
            usage={
                "prompt_tokens": result.get("usage", {}).get("prompt_tokens", 0),
                "completion_tokens": result.get("usage", {}).get("completion_tokens", 0),
                "total_tokens": result.get("usage", {}).get("total_tokens", 0),
            } if result.get("usage") else None,
            finish_reason=result.get("finish_reason"),
        )

    async def chat_stream(
        self,
        messages: List[ChatMessage],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        access_token = await self._get_access_token()
        endpoint = self._get_endpoint()
        url = f"https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{endpoint}?access_token={access_token}&stream=true"

        message_dicts = [{"role": m.role, "content": m.content} for m in messages]

        payload = {
            "messages": message_dicts,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens:
            payload["max_output_tokens"] = max_tokens
        payload.update(kwargs)

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if data_str.strip():
                            try:
                                data = json.loads(data_str)
                                if "result" in data:
                                    yield data["result"]
                            except json.JSONDecodeError:
                                continue


class BytePlusModel(AIModelBase):
    """字节豆包模型封装 (火山引擎Ark API)"""

    def __init__(
        self,
        api_key: str,
        model_name: str = "doubao-pro-32k",
        endpoint_id: Optional[str] = None,
        base_url: str = "https://ark.cn-beijing.volces.com/api/v3",
        **kwargs
    ):
        super().__init__(api_key, model_name, base_url, **kwargs)
        self.endpoint_id = endpoint_id
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
        )

    async def chat(
        self,
        messages: List[ChatMessage],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        **kwargs
    ) -> ChatResponse:
        message_dicts = [{"role": m.role, "content": m.content} for m in messages]

        model_to_use = self.endpoint_id if self.endpoint_id else self.model_name

        completion_params = {
            "model": model_to_use,
            "messages": message_dicts,
            "temperature": temperature,
        }
        if max_tokens:
            completion_params["max_tokens"] = max_tokens
        completion_params.update(kwargs)

        response = await self.client.chat.completions.create(**completion_params)

        return ChatResponse(
            content=response.choices[0].message.content or "",
            model=self.model_name,
            provider=ModelProvider.BYTEPLUS.value,
            usage={
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                "total_tokens": response.usage.total_tokens if response.usage else 0,
            } if response.usage else None,
            finish_reason=response.choices[0].finish_reason,
        )

    async def chat_stream(
        self,
        messages: List[ChatMessage],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        message_dicts = [{"role": m.role, "content": m.content} for m in messages]

        model_to_use = self.endpoint_id if self.endpoint_id else self.model_name

        completion_params = {
            "model": model_to_use,
            "messages": message_dicts,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens:
            completion_params["max_tokens"] = max_tokens
        completion_params.update(kwargs)

        stream = await self.client.chat.completions.create(**completion_params)

        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


class ModelConfig(BaseModel):
    """模型配置"""
    provider: ModelProvider
    model_name: str
    api_key: str
    base_url: Optional[str] = None
    secret_key: Optional[str] = None
    endpoint_id: Optional[str] = None
    is_default: bool = False
    enabled: bool = True


class AIModelManager:
    """AI模型管理器"""

    def __init__(self):
        self._models: Dict[str, AIModelBase] = {}
        self._configs: Dict[str, ModelConfig] = {}
        self._default_model: Optional[str] = None

    def register_model(self, config: ModelConfig) -> str:
        """注册模型"""
        model_id = f"{config.provider.value}:{config.model_name}"

        model: AIModelBase
        if config.provider == ModelProvider.OPENAI:
            model = OpenAIModel(
                api_key=config.api_key,
                model_name=config.model_name,
                base_url=config.base_url,
            )
        elif config.provider == ModelProvider.BAIDU:
            if not config.secret_key:
                raise ValueError("百度文心模型需要提供secret_key")
            model = BaiduWenxinModel(
                api_key=config.api_key,
                secret_key=config.secret_key,
                model_name=config.model_name,
            )
        elif config.provider == ModelProvider.BYTEPLUS:
            model = BytePlusModel(
                api_key=config.api_key,
                model_name=config.model_name,
                endpoint_id=config.endpoint_id,
                base_url=config.base_url or "https://ark.cn-beijing.volces.com/api/v3",
            )
        else:
            raise ValueError(f"不支持的模型提供商: {config.provider}")

        self._models[model_id] = model
        self._configs[model_id] = config

        if config.is_default or self._default_model is None:
            self._default_model = model_id

        logger.info("注册AI模型: %s (provider=%s)", config.model_name, config.provider.value)
        return model_id

    def unregister_model(self, model_id: str) -> bool:
        """注销模型"""
        if model_id in self._models:
            del self._models[model_id]
            del self._configs[model_id]
            if self._default_model == model_id:
                self._default_model = next(iter(self._models.keys()), None)
            return True
        return False

    def get_model(self, model_id: Optional[str] = None) -> AIModelBase:
        """获取模型实例"""
        target_id = model_id or self._default_model
        if not target_id:
            raise ValueError("没有可用的AI模型")
        if target_id not in self._models:
            raise ValueError(f"模型不存在: {target_id}")
        return self._models[target_id]

    def get_config(self, model_id: Optional[str] = None) -> ModelConfig:
        """获取模型配置"""
        target_id = model_id or self._default_model
        if not target_id:
            raise ValueError("没有可用的AI模型配置")
        if target_id not in self._configs:
            raise ValueError(f"模型配置不存在: {target_id}")
        return self._configs[target_id]

    def set_default_model(self, model_id: str) -> bool:
        """设置默认模型"""
        if model_id in self._models:
            self._default_model = model_id
            logger.info("切换默认模型: %s", model_id)
            return True
        return False

    def get_default_model_id(self) -> Optional[str]:
        """获取默认模型ID"""
        return self._default_model

    def list_models(self) -> List[Dict[str, Any]]:
        """列出所有模型"""
        result = []
        for model_id, config in self._configs.items():
            result.append({
                "id": model_id,
                "provider": config.provider.value,
                "model_name": config.model_name,
                "is_default": model_id == self._default_model,
                "enabled": config.enabled,
            })
        return result

    def validate_model(self, model_id: str) -> bool:
        """验证模型配置是否有效"""
        if model_id not in self._models:
            return False
        return self._models[model_id].validate_config()


model_manager = AIModelManager()
