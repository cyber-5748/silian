"""
对话分支管理API路由
"""
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.logger import get_logger
from app.storage import (
    get_session,
    create_branch as storage_create_branch,
    delete_branch as storage_delete_branch,
    get_branches,
    update_branch as storage_update_branch,
    get_branch_tree,
    get_available_branch_colors,
)

logger = get_logger("branch")


router = APIRouter(prefix="/api/branches", tags=["分支管理"])


class CreateBranchRequest(BaseModel):
    session_id: str
    parent_node_id: str
    branch_name: Optional[str] = None


class BranchNodeResponse(BaseModel):
    id: str
    parent_id: Optional[str] = None
    branch_color: str
    branch_name: str
    is_branch: bool
    timestamp: str
    user_message: Optional[str] = None
    ai_reply: Optional[str] = None


class DeleteBranchRequest(BaseModel):
    session_id: str
    branch_node_id: str
    delete_children: bool = True


class UpdateBranchRequest(BaseModel):
    session_id: str
    branch_node_id: str
    branch_name: Optional[str] = None
    branch_color: Optional[str] = None


class BranchTreeResponse(BaseModel):
    id: str
    parent_id: Optional[str] = None
    branch_color: str
    branch_name: str
    is_branch: bool
    timestamp: str
    children: List[dict] = []


class BranchColorsResponse(BaseModel):
    colors: List[str]


@router.post("/create", response_model=BranchNodeResponse)
async def create_branch(request: CreateBranchRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {request.session_id}")
    
    branch = storage_create_branch(
        session_id=request.session_id,
        parent_node_id=request.parent_node_id,
        branch_name=request.branch_name
    )
    
    if not branch:
        raise HTTPException(status_code=400, detail="创建分支失败，父节点不存在")
    
    logger.info("创建分支: session_id=%s, branch_id=%s", request.session_id, branch["id"])
    return BranchNodeResponse(
        id=branch["id"],
        parent_id=branch.get("parent_id"),
        branch_color=branch["branch_color"],
        branch_name=branch["branch_name"],
        is_branch=branch["is_branch"],
        timestamp=branch["timestamp"],
        user_message=branch.get("user_message"),
        ai_reply=branch.get("ai_reply")
    )


@router.delete("/delete")
async def delete_branch(request: DeleteBranchRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {request.session_id}")
    
    success = storage_delete_branch(
        session_id=request.session_id,
        branch_node_id=request.branch_node_id,
        delete_children=request.delete_children
    )
    
    if not success:
        raise HTTPException(status_code=404, detail="分支不存在或删除失败")
    
    logger.info("删除分支: session_id=%s, branch_id=%s", request.session_id, request.branch_node_id)
    return {"success": True, "message": "分支已删除"}


@router.get("/list/{session_id}", response_model=List[BranchNodeResponse])
async def list_branches(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")
    
    branches = get_branches(session_id)
    
    return [
        BranchNodeResponse(
            id=branch["id"],
            parent_id=branch.get("parent_id"),
            branch_color=branch["branch_color"],
            branch_name=branch["branch_name"],
            is_branch=branch["is_branch"],
            timestamp=branch["timestamp"],
            user_message=branch.get("user_message"),
            ai_reply=branch.get("ai_reply")
        )
        for branch in branches
    ]


@router.put("/update", response_model=BranchNodeResponse)
async def update_branch(request: UpdateBranchRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {request.session_id}")
    
    updates = {}
    if request.branch_name is not None:
        updates["branch_name"] = request.branch_name
    if request.branch_color is not None:
        updates["branch_color"] = request.branch_color
    
    if not updates:
        raise HTTPException(status_code=400, detail="没有提供更新内容")
    
    branch = storage_update_branch(
        session_id=request.session_id,
        branch_node_id=request.branch_node_id,
        updates=updates
    )
    
    if not branch:
        raise HTTPException(status_code=404, detail="分支不存在")
    
    return BranchNodeResponse(
        id=branch["id"],
        parent_id=branch.get("parent_id"),
        branch_color=branch["branch_color"],
        branch_name=branch["branch_name"],
        is_branch=branch["is_branch"],
        timestamp=branch["timestamp"],
        user_message=branch.get("user_message"),
        ai_reply=branch.get("ai_reply")
    )


@router.get("/tree/{session_id}/{branch_node_id}", response_model=BranchTreeResponse)
async def get_branch_tree_api(session_id: str, branch_node_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")
    
    tree = get_branch_tree(session_id, branch_node_id)
    
    if not tree:
        raise HTTPException(status_code=404, detail="分支不存在")
    
    return BranchTreeResponse(
        id=tree["id"],
        parent_id=tree.get("parent_id"),
        branch_color=tree["branch_color"],
        branch_name=tree["branch_name"],
        is_branch=tree["is_branch"],
        timestamp=tree["timestamp"],
        children=tree.get("children", [])
    )


@router.get("/colors", response_model=BranchColorsResponse)
async def list_branch_colors():
    colors = get_available_branch_colors()
    return BranchColorsResponse(colors=colors)
