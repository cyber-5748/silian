import json
import os
import shutil
from datetime import datetime
from typing import Optional
from uuid import uuid4

from app.logger import get_logger
logger = get_logger("storage")


DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")


def _ensure_data_dir():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
    if not os.path.exists(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)


def _init_sessions_file():
    _ensure_data_dir()
    if not os.path.exists(SESSIONS_FILE):
        with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump({"sessions": []}, f, ensure_ascii=False, indent=2)


def read_sessions() -> dict:
    _init_sessions_file()
    try:
        with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.error("读取会话文件失败: %s", e)
        return {"sessions": []}


def write_sessions(data: dict) -> None:
    _ensure_data_dir()
    try:
        with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except OSError as e:
        logger.error("写入会话文件失败: %s", e)


def backup_sessions(backup_name: Optional[str] = None) -> str:
    _ensure_data_dir()
    if not os.path.exists(SESSIONS_FILE):
        raise FileNotFoundError("会话数据文件不存在")
    
    if backup_name is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"sessions_backup_{timestamp}.json"
    
    backup_path = os.path.join(BACKUP_DIR, backup_name)
    shutil.copy2(SESSIONS_FILE, backup_path)
    return backup_path


def get_session_list() -> list:
    data = read_sessions()
    sessions = data.get("sessions", [])
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "created_at": s["created_at"],
            "updated_at": s["updated_at"],
            "node_count": len(s.get("nodes", []))
        }
        for s in sessions
    ]


def get_session(session_id: str) -> Optional[dict]:
    data = read_sessions()
    sessions = data.get("sessions", [])
    for session in sessions:
        if session["id"] == session_id:
            return session
    return None


def create_session(name: str = "新会话") -> dict:
    data = read_sessions()
    now = datetime.now().isoformat()
    new_session = {
        "id": str(uuid4()),
        "name": name,
        "created_at": now,
        "updated_at": now,
        "nodes": []
    }
    data["sessions"].append(new_session)
    write_sessions(data)
    logger.info("创建会话: id=%s, name=%s", new_session["id"], name)
    return new_session


def update_session(session_id: str, updates: dict) -> Optional[dict]:
    data = read_sessions()
    sessions = data.get("sessions", [])
    for i, session in enumerate(sessions):
        if session["id"] == session_id:
            session["updated_at"] = datetime.now().isoformat()
            for key, value in updates.items():
                if key not in ["id", "created_at"]:
                    session[key] = value
            data["sessions"][i] = session
            write_sessions(data)
            return session
    return None


def save_session(session_id: str, session_data: dict) -> Optional[dict]:
    data = read_sessions()
    sessions = data.get("sessions", [])
    for i, session in enumerate(sessions):
        if session["id"] == session_id:
            session_data["updated_at"] = datetime.now().isoformat()
            if "id" not in session_data:
                session_data["id"] = session_id
            if "created_at" not in session_data:
                session_data["created_at"] = session.get("created_at", datetime.now().isoformat())
            data["sessions"][i] = session_data
            write_sessions(data)
            return session_data
    return None


def delete_session(session_id: str) -> bool:
    data = read_sessions()
    sessions = data.get("sessions", [])
    original_count = len(sessions)
    data["sessions"] = [s for s in sessions if s["id"] != session_id]
    if len(data["sessions"]) < original_count:
        write_sessions(data)
        logger.info("删除会话: id=%s", session_id)
        return True
    return False


def add_node(session_id: str, node_data: dict) -> Optional[dict]:
    session = get_session(session_id)
    if session is None:
        return None
    
    now = datetime.now().isoformat()
    new_node = {
        "id": node_data.get("id", str(uuid4())),
        "parent_id": node_data.get("parent_id"),
        "user_message": node_data.get("user_message", ""),
        "ai_reply": node_data.get("ai_reply", ""),
        "timestamp": node_data.get("timestamp", now),
        "branch_color": node_data.get("branch_color", "#3498db")
    }
    
    session["nodes"].append(new_node)
    session["updated_at"] = now
    
    data = read_sessions()
    for i, s in enumerate(data["sessions"]):
        if s["id"] == session_id:
            data["sessions"][i] = session
            break
    
    write_sessions(data)
    return new_node


def update_node(session_id: str, node_id: str, updates: dict) -> Optional[dict]:
    session = get_session(session_id)
    if session is None:
        return None
    
    for i, node in enumerate(session["nodes"]):
        if node["id"] == node_id:
            for key, value in updates.items():
                if key not in ["id"]:
                    node[key] = value
            session["nodes"][i] = node
            session["updated_at"] = datetime.now().isoformat()
            
            data = read_sessions()
            for j, s in enumerate(data["sessions"]):
                if s["id"] == session_id:
                    data["sessions"][j] = session
                    break
            
            write_sessions(data)
            return node
    return None


def delete_node(session_id: str, node_id: str) -> bool:
    session = get_session(session_id)
    if session is None:
        return False
    
    original_count = len(session["nodes"])
    session["nodes"] = [n for n in session["nodes"] if n["id"] != node_id]
    
    if len(session["nodes"]) < original_count:
        session["updated_at"] = datetime.now().isoformat()
        
        data = read_sessions()
        for i, s in enumerate(data["sessions"]):
            if s["id"] == session_id:
                data["sessions"][i] = session
                break
        
        write_sessions(data)
        return True
    return False


def get_child_nodes(session_id: str, parent_id: Optional[str] = None) -> list:
    session = get_session(session_id)
    if session is None:
        return []
    
    return [
        node for node in session.get("nodes", [])
        if node.get("parent_id") == parent_id
    ]


def get_node_path(session_id: str, node_id: str) -> list:
    session = get_session(session_id)
    if session is None:
        return []
    
    nodes_dict = {n["id"]: n for n in session.get("nodes", [])}
    path = []
    current_id = node_id
    
    while current_id and current_id in nodes_dict:
        node = nodes_dict[current_id]
        path.insert(0, node)
        current_id = node.get("parent_id")
    
    return path


BRANCH_COLORS = [
    "#6366f1", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"
]


def create_branch(session_id: str, parent_node_id: str, branch_name: str = None) -> Optional[dict]:
    session = get_session(session_id)
    if session is None:
        return None

    nodes = session.get("nodes", [])
    parent_exists = any(n["id"] == parent_node_id for n in nodes)
    if not parent_exists and parent_node_id != "root":
        return None

    existing_branches = [n.get("branch_color") for n in nodes if n.get("branch_color")]
    color_index = len(set(existing_branches)) % len(BRANCH_COLORS)
    branch_color = BRANCH_COLORS[color_index]

    now = datetime.now().isoformat()
    branch_node = {
        "id": str(uuid4()),
        "parent_id": parent_node_id if parent_node_id != "root" else None,
        "user_message": "",
        "ai_reply": "",
        "timestamp": now,
        "branch_color": branch_color,
        "branch_name": branch_name or f"分支 {len([n for n in nodes if n.get('is_branch')]) + 1}",
        "is_branch": True,
        "children": []
    }

    session["nodes"].append(branch_node)
    session["updated_at"] = now

    data = read_sessions()
    for i, s in enumerate(data["sessions"]):
        if s["id"] == session_id:
            data["sessions"][i] = session
            break

    write_sessions(data)
    logger.info("创建分支: session_id=%s, branch_id=%s", session_id, branch_node["id"])
    return branch_node


def delete_branch(session_id: str, branch_node_id: str, delete_children: bool = True) -> bool:
    session = get_session(session_id)
    if session is None:
        return False
    
    nodes = session.get("nodes", [])
    branch_node = next((n for n in nodes if n["id"] == branch_node_id and n.get("is_branch")), None)
    
    if not branch_node:
        return False
    
    nodes_to_delete = [branch_node_id]
    
    if delete_children:
        def collect_children(parent_id):
            children = [n["id"] for n in nodes if n.get("parent_id") == parent_id]
            for child_id in children:
                nodes_to_delete.append(child_id)
                collect_children(child_id)
        
        collect_children(branch_node_id)
    
    original_count = len(session["nodes"])
    session["nodes"] = [n for n in nodes if n["id"] not in nodes_to_delete]
    
    if len(session["nodes"]) < original_count:
        session["updated_at"] = datetime.now().isoformat()
        
        data = read_sessions()
        for i, s in enumerate(data["sessions"]):
            if s["id"] == session_id:
                data["sessions"][i] = session
                break
        
        write_sessions(data)
        logger.info("删除分支: session_id=%s, branch_id=%s", session_id, branch_node_id)
        return True

    return False


def get_branches(session_id: str) -> list:
    session = get_session(session_id)
    if session is None:
        return []
    
    nodes = session.get("nodes", [])
    branches = [n for n in nodes if n.get("is_branch")]
    return branches


def update_branch(session_id: str, branch_node_id: str, updates: dict) -> Optional[dict]:
    session = get_session(session_id)
    if session is None:
        return None
    
    for i, node in enumerate(session["nodes"]):
        if node["id"] == branch_node_id and node.get("is_branch"):
            if "branch_name" in updates:
                node["branch_name"] = updates["branch_name"]
            if "branch_color" in updates:
                node["branch_color"] = updates["branch_color"]
            
            session["nodes"][i] = node
            session["updated_at"] = datetime.now().isoformat()
            
            data = read_sessions()
            for j, s in enumerate(data["sessions"]):
                if s["id"] == session_id:
                    data["sessions"][j] = session
                    break
            
            write_sessions(data)
            return node
    
    return None


def get_branch_tree(session_id: str, branch_node_id: str) -> Optional[dict]:
    session = get_session(session_id)
    if session is None:
        return None
    
    nodes = session.get("nodes", [])
    branch_node = next((n for n in nodes if n["id"] == branch_node_id and n.get("is_branch")), None)
    
    if not branch_node:
        return None
    
    def build_tree(node):
        children = [n for n in nodes if n.get("parent_id") == node["id"]]
        return {
            **node,
            "children": [build_tree(child) for child in children]
        }
    
    return build_tree(branch_node)


def get_available_branch_colors() -> list:
    return BRANCH_COLORS
