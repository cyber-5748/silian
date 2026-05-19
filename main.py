"""
思维导图式AI聊天应用 - FastAPI入口
"""
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv

from app.logger import setup_logging, get_logger
from app.ai_models import model_manager, ModelProvider, ModelConfig
from app.routes import ai_router, context_router, branch_router, chat_router, session_router

load_dotenv()

setup_logging(os.getenv("LOG_LEVEL", "INFO"))
logger = get_logger("main")

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="思维导图AI聊天应用",
    description="基于思维导图的AI聊天应用后端服务",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = BASE_DIR / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

templates_dir = BASE_DIR / "templates"
templates_dir.mkdir(exist_ok=True)
templates = Jinja2Templates(directory=str(templates_dir))

data_dir = BASE_DIR / "data"
data_dir.mkdir(exist_ok=True)

app.include_router(ai_router)
app.include_router(context_router)
app.include_router(branch_router)
app.include_router(chat_router)
app.include_router(session_router)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info("请求: %s %s", request.method, request.url.path)
    response = await call_next(request)
    logger.info("响应: %s %s -> %d", request.method, request.url.path, response.status_code)
    return response


def init_ai_models():
    """初始化AI模型配置"""
    llm_api_key = os.getenv("LLM_API_KEY", "")
    llm_base_url = os.getenv("LLM_BASE_URL", "")
    llm_model = os.getenv("LLM_MODEL", "")

    if llm_api_key:
        config = ModelConfig(
            provider=ModelProvider.OPENAI,
            model_name=llm_model or "gpt-4o-mini",
            api_key=llm_api_key,
            base_url=llm_base_url if llm_base_url else None,
            is_default=True,
        )
        model_manager.register_model(config)
        logger.info("注册AI模型: %s (provider=%s)", config.model_name, config.provider.value)

    openai_api_key = os.getenv("OPENAI_API_KEY", "")
    openai_base_url = os.getenv("OPENAI_BASE_URL", "")
    openai_model_name = os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini")

    if openai_api_key:
        config = ModelConfig(
            provider=ModelProvider.OPENAI,
            model_name=openai_model_name,
            api_key=openai_api_key,
            base_url=openai_base_url if openai_base_url else None,
            is_default=not bool(llm_api_key),
        )
        model_manager.register_model(config)
        logger.info("注册AI模型: %s (provider=%s)", config.model_name, config.provider.value)

    baidu_api_key = os.getenv("BAIDU_API_KEY", "")
    baidu_secret_key = os.getenv("BAIDU_SECRET_KEY", "")
    baidu_model_name = os.getenv("BAIDU_MODEL_NAME", "ernie-3.5-8k")

    if baidu_api_key and baidu_secret_key:
        config = ModelConfig(
            provider=ModelProvider.BAIDU,
            model_name=baidu_model_name,
            api_key=baidu_api_key,
            secret_key=baidu_secret_key,
            is_default=not bool(llm_api_key or openai_api_key),
        )
        model_manager.register_model(config)
        logger.info("注册AI模型: %s (provider=%s)", config.model_name, config.provider.value)

    byteplus_api_key = os.getenv("BYTEPLUS_API_KEY", "")
    byteplus_model_name = os.getenv("BYTEPLUS_MODEL_NAME", "doubao-pro-32k")
    byteplus_endpoint_id = os.getenv("BYTEPLUS_ENDPOINT_ID", "")
    byteplus_base_url = os.getenv("BYTEPLUS_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

    if byteplus_api_key:
        config = ModelConfig(
            provider=ModelProvider.BYTEPLUS,
            model_name=byteplus_model_name,
            api_key=byteplus_api_key,
            endpoint_id=byteplus_endpoint_id if byteplus_endpoint_id else None,
            base_url=byteplus_base_url,
            is_default=not bool(llm_api_key or openai_api_key or baidu_api_key),
        )
        model_manager.register_model(config)
        logger.info("注册AI模型: %s (provider=%s)", config.model_name, config.provider.value)


@app.on_event("startup")
async def startup_event():
    """应用启动时初始化"""
    init_ai_models()
    port = os.getenv("PORT", 8000)
    logger.info("应用启动,端口=%s", port)


@app.get("/")
async def root():
    return {"message": "思维导图AI聊天应用后端服务运行中", "version": "1.0.0"}


@app.get("/app", response_class=HTMLResponse)
async def get_app(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 8000)),
        reload=os.getenv("DEBUG", "false").lower() == "true",
    )
