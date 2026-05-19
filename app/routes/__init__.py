"""
路由模块
"""
from app.routes.ai_routes import router as ai_router
from app.routes.context_routes import router as context_router
from app.routes.chat_routes import router as chat_router
from app.routes.branch_routes import router as branch_router
from app.routes.session_routes import router as session_router

__all__ = ["ai_router", "context_router", "chat_router", "branch_router", "session_router"]
