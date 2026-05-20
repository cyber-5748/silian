"""
对话分支管理API路由
"""
from typing import List
from fastapi import APIRouter
from pydantic import BaseModel

from app.logger import get_logger
from app.storage import get_available_branch_colors

logger = get_logger("branch")


router = APIRouter(prefix="/api/branches", tags=["分支管理"])


class BranchColorsResponse(BaseModel):
    colors: List[str]


@router.get("/colors", response_model=BranchColorsResponse)
async def list_branch_colors():
    colors = get_available_branch_colors()
    return BranchColorsResponse(colors=colors)
