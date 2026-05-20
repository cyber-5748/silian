import io
import json
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.logger import get_logger
from app.storage import (
    get_session,
    get_session_list,
    create_session as storage_create_session,
    update_session as storage_update_session,
    delete_session as storage_delete_session,
    delete_node as storage_delete_node,
    save_session as storage_save_session,
    read_sessions,
    write_sessions,
    backup_sessions,
    get_session_tree as storage_get_session_tree,
    get_node_context_path as storage_get_node_context_path,
)
from app.context import context_manager

logger = get_logger("session")


router = APIRouter(prefix="/api/sessions", tags=["会话管理"])


class CreateSessionRequest(BaseModel):
    title: str = "新会话"


class UpdateSessionRequest(BaseModel):
    title: Optional[str] = None
    messages: Optional[list] = None
    mindmap: Optional[dict] = None
    nodes: Optional[list] = None
    conversation_tree: Optional[dict] = None


class AutosaveRequest(BaseModel):
    messages: Optional[list] = None
    mindmap: Optional[dict] = None
    nodes: Optional[list] = None
    conversation_tree: Optional[dict] = None
    title: Optional[str] = None


class ImportSessionsRequest(BaseModel):
    sessions: list
    merge: bool = True


class SessionResponse(BaseModel):
    id: str
    title: Optional[str] = None
    name: Optional[str] = None
    created_at: str
    updated_at: str
    node_count: int
    messages: Optional[list] = None
    mindmap: Optional[dict] = None
    nodes: Optional[list] = None
    conversation_tree: Optional[dict] = None


@router.get("")
async def list_sessions():
    sessions = get_session_list()
    return {"sessions": sessions}


@router.post("")
async def create_session_api(request: CreateSessionRequest = None):
    if request is None:
        request = CreateSessionRequest()
    session = storage_create_session(name=request.title)
    logger.info("创建会话: id=%s, title=%s", session["id"], request.title)
    return session


@router.post("/import")
async def import_sessions(request: ImportSessionsRequest):
    if not request.sessions:
        raise HTTPException(status_code=400, detail="导入数据不能为空")

    data = read_sessions()
    existing_ids = {s["id"] for s in data.get("sessions", [])}

    if request.merge:
        imported_count = 0
        skipped_count = 0
        for session_data in request.sessions:
            if not isinstance(session_data, dict) or "id" not in session_data:
                continue
            if session_data["id"] in existing_ids:
                skipped_count += 1
            else:
                now = datetime.now().isoformat()
                if "created_at" not in session_data:
                    session_data["created_at"] = now
                if "updated_at" not in session_data:
                    session_data["updated_at"] = now
                data["sessions"].append(session_data)
                imported_count += 1
        write_sessions(data)
        return {
            "success": True,
            "message": f"导入完成: 新增 {imported_count} 个, 跳过 {skipped_count} 个(已存在)",
            "imported": imported_count,
            "skipped": skipped_count,
        }
    else:
        now = datetime.now().isoformat()
        for session_data in request.sessions:
            if not isinstance(session_data, dict):
                continue
            if "created_at" not in session_data:
                session_data["created_at"] = now
            if "updated_at" not in session_data:
                session_data["updated_at"] = now
        data["sessions"] = request.sessions
        write_sessions(data)
        return {
            "success": True,
            "message": f"导入完成: 替换为 {len(request.sessions)} 个会话",
            "imported": len(request.sessions),
        }


@router.post("/backup")
async def create_backup():
    try:
        backup_path = backup_sessions()
        return {
            "success": True,
            "message": "备份创建成功",
            "backup_path": backup_path,
            "timestamp": datetime.now().isoformat(),
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{session_id}/tree")
async def get_session_tree_api(session_id: str):
    """返回完整对话树结构"""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    tree = storage_get_session_tree(session_id)
    if tree is None:
        raise HTTPException(status_code=404, detail="对话树为空")

    return tree


@router.get("/{session_id}/nodes/{node_id}/context")
async def get_node_context_api(session_id: str, node_id: str):
    """返回从根节点到指定节点的上下文路径"""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    context_path = storage_get_node_context_path(session_id, node_id)
    if not context_path:
        raise HTTPException(status_code=404, detail=f"节点不存在: {node_id}")

    # 同时使用 context_manager 构建完整的上下文消息
    context_messages = context_manager.build_context_from_node(
        session_id=session_id,
        node_id=node_id,
        include_current=True,
    )

    return {
        "node_id": node_id,
        "path": [
            {
                "id": n.get("id"),
                "parent_id": n.get("parent_id"),
                "user_message": n.get("user_message", ""),
                "ai_reply": n.get("ai_reply", ""),
                "branch_color": n.get("branch_color", ""),
                "timestamp": n.get("timestamp", ""),
            }
            for n in context_path
        ],
        "context_messages": [
            {
                "role": msg.role,
                "content": msg.content,
                "node_id": msg.node_id,
            }
            for msg in context_messages
        ],
    }


@router.delete("/{session_id}/nodes/{node_id}")
async def delete_node_api(session_id: str, node_id: str, cascade: bool = True):
    """删除节点及其子节点"""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    if node_id == "root":
        raise HTTPException(status_code=400, detail="不能删除根节点")

    success = storage_delete_node(session_id, node_id, cascade=cascade)
    if not success:
        raise HTTPException(status_code=404, detail=f"节点不存在: {node_id}")

    logger.info("删除节点: session_id=%s, node_id=%s", session_id, node_id)
    return {"success": True, "message": "节点已删除"}


@router.get("/{session_id}")
async def get_session_api(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")
    return session


@router.put("/{session_id}")
async def update_session_api(session_id: str, request: UpdateSessionRequest):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    updates = {}
    if request.title is not None:
        updates["name"] = request.title
    if request.messages is not None:
        updates["messages"] = request.messages
    if request.mindmap is not None:
        updates["mindmap"] = request.mindmap
    if request.nodes is not None:
        updates["nodes"] = request.nodes
    if request.conversation_tree is not None:
        updates["conversation_tree"] = request.conversation_tree

    if not updates:
        return session

    result = storage_update_session(session_id, updates)
    if not result:
        raise HTTPException(status_code=500, detail="更新会话失败")
    return result


@router.delete("/{session_id}")
async def delete_session_api(session_id: str):
    success = storage_delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")
    logger.info("删除会话: id=%s", session_id)
    return {"success": True, "message": "会话已删除"}


@router.post("/{session_id}/autosave")
async def autosave_session(session_id: str, request: AutosaveRequest):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    updates = {}
    if request.title is not None:
        updates["name"] = request.title
    if request.messages is not None:
        updates["messages"] = request.messages
    if request.mindmap is not None:
        updates["mindmap"] = request.mindmap
    if request.nodes is not None:
        updates["nodes"] = request.nodes
    if request.conversation_tree is not None:
        updates["conversation_tree"] = request.conversation_tree

    if updates:
        result = storage_update_session(session_id, updates)
        if not result:
            raise HTTPException(status_code=500, detail="自动保存失败")
        return {"success": True, "message": "自动保存成功", "updated_at": result.get("updated_at")}

    return {"success": True, "message": "无变更需要保存"}


@router.get("/{session_id}/export/pdf")
async def export_pdf(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.lib.colors import HexColor
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="PDF导出需要安装reportlab库，请运行: pip install reportlab",
        )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CustomTitle",
        parent=styles["Title"],
        fontSize=18,
        spaceAfter=12,
        textColor=HexColor("#1a1a2e"),
    )
    heading_style = ParagraphStyle(
        "CustomHeading",
        parent=styles["Heading2"],
        fontSize=13,
        spaceAfter=6,
        textColor=HexColor("#6366f1"),
    )
    user_msg_style = ParagraphStyle(
        "UserMsg",
        parent=styles["Normal"],
        fontSize=10,
        spaceAfter=4,
        leftIndent=10,
        textColor=HexColor("#1e40af"),
        backColor=HexColor("#eff6ff"),
        borderPadding=6,
    )
    ai_msg_style = ParagraphStyle(
        "AIMsg",
        parent=styles["Normal"],
        fontSize=10,
        spaceAfter=8,
        leftIndent=10,
        textColor=HexColor("#065f46"),
        backColor=HexColor("#ecfdf5"),
        borderPadding=6,
    )
    node_style = ParagraphStyle(
        "NodeStyle",
        parent=styles["Normal"],
        fontSize=10,
        spaceAfter=4,
    )

    story = []

    session_name = session.get("name", session.get("title", "未命名会话"))
    story.append(Paragraph(session_name, title_style))
    story.append(Spacer(1, 6))

    created = session.get("created_at", "")
    updated = session.get("updated_at", "")
    meta_text = f"创建时间: {created}  |  更新时间: {updated}"
    story.append(Paragraph(meta_text, styles["Normal"]))
    story.append(Spacer(1, 12))

    messages = session.get("messages", [])
    if messages:
        story.append(Paragraph("对话记录", heading_style))
        story.append(Spacer(1, 6))
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            escaped = content.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
            if role == "user":
                story.append(Paragraph(f"<b>用户:</b> {escaped}", user_msg_style))
            elif role == "assistant":
                story.append(Paragraph(f"<b>AI:</b> {escaped}", ai_msg_style))
            else:
                story.append(Paragraph(f"<b>{role}:</b> {escaped}", node_style))
            story.append(Spacer(1, 4))

    nodes = session.get("nodes", [])
    if nodes:
        story.append(Spacer(1, 8))
        story.append(Paragraph("思维导图节点", heading_style))
        story.append(Spacer(1, 6))

        def build_tree_nodes(parent_id=None, depth=0):
            children = [n for n in nodes if n.get("parent_id") == parent_id]
            result = []
            for node in children:
                indent = "&nbsp;&nbsp;&nbsp;&nbsp;" * depth
                user_msg = node.get("user_message", "")
                ai_reply = node.get("ai_reply", "")
                branch_name = node.get("branch_name", "")
                label = branch_name if branch_name else (user_msg[:30] if user_msg else "节点")
                escaped_label = label.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                result.append(Paragraph(f"{indent}<b>&#8226;</b> {escaped_label}", node_style))
                if user_msg:
                    escaped = user_msg.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
                    result.append(Paragraph(f"{indent}&nbsp;&nbsp;Q: {escaped}", node_style))
                if ai_reply:
                    escaped = ai_reply[:100].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
                    result.append(Paragraph(f"{indent}&nbsp;&nbsp;A: {escaped}...", node_style))
                result.extend(build_tree_nodes(node["id"], depth + 1))
            return result

        root_nodes = [n for n in nodes if n.get("parent_id") is None]
        if root_nodes:
            story.extend(build_tree_nodes(None))
        else:
            for node in nodes[:10]:
                user_msg = node.get("user_message", "")
                ai_reply = node.get("ai_reply", "")
                if user_msg:
                    escaped = user_msg.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
                    story.append(Paragraph(f"<b>&#8226;</b> {escaped}", node_style))
                if ai_reply:
                    escaped = ai_reply[:100].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
                    story.append(Paragraph(f"&nbsp;&nbsp;{escaped}...", node_style))

    if not messages and not nodes:
        story.append(Paragraph("此会话暂无内容", styles["Normal"]))

    doc.build(story)
    buffer.seek(0)

    filename = f"{session_name}.pdf"
    from urllib.parse import quote
    encoded_filename = quote(filename)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )


@router.get("/{session_id}/export/mm")
async def export_freemind(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"会话不存在: {session_id}")

    session_name = session.get("name", session.get("title", "未命名会话"))

    root_el = ET.Element("map", version="0.9.0")
    root_node = ET.SubElement(root_el, "node", TEXT=session_name)

    nodes = session.get("nodes", [])

    def add_child_nodes(parent_el, parent_id):
        children = [n for n in nodes if n.get("parent_id") == parent_id]
        for child in children:
            text = child.get("branch_name", "") or child.get("user_message", "") or "节点"
            color = child.get("branch_color", "")
            attrs = {"TEXT": text}
            if color:
                attrs["COLOR"] = color
            child_el = ET.SubElement(parent_el, "node", **attrs)

            ai_reply = child.get("ai_reply", "")
            if ai_reply:
                richcontent = ET.SubElement(child_el, "richcontent", TYPE="NOTE")
                html_el = ET.SubElement(richcontent, "html")
                body_el = ET.SubElement(html_el, "body")
                p_el = ET.SubElement(body_el, "p")
                p_el.text = ai_reply

            add_child_nodes(child_el, child["id"])

    add_child_nodes(root_node, None)

    if not nodes:
        messages = session.get("messages", [])
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user":
                node_el = ET.SubElement(root_node, "node", TEXT=content[:50], COLOR="#1e40af")
            elif role == "assistant":
                node_el = ET.SubElement(root_node, "node", TEXT=content[:50], COLOR="#065f46")
                richcontent = ET.SubElement(node_el, "richcontent", TYPE="NOTE")
                html_el = ET.SubElement(richcontent, "html")
                body_el = ET.SubElement(html_el, "body")
                p_el = ET.SubElement(body_el, "p")
                p_el.text = content

    tree = ET.ElementTree(root_el)
    ET.indent(tree, space="  ")

    buffer = io.BytesIO()
    tree.write(buffer, encoding="unicode", xml_declaration=True)
    buffer.seek(0)

    filename = f"{session_name}.mm"
    from urllib.parse import quote
    encoded_filename = quote(filename)

    return StreamingResponse(
        buffer,
        media_type="application/xml",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )
