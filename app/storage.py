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
    root_node = {
        "id": "root",
        "parent_id": None,
        "user_message": "",
        "ai_reply": "",
        "timestamp": now,
        "branch_color": "",
    }
    new_session = {
        "id": str(uuid4()),
        "name": name,
        "created_at": now,
        "updated_at": now,
        "nodes": [root_node]
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


def _assign_branch_color(session: dict, parent_id: Optional[str]) -> str:
    """为新节点分配分支颜色。
    如果是父节点的第一个子节点，使用默认色；
    如果是后续子节点（分叉），从 BRANCH_COLORS 中取下一个颜色。
    """
    nodes = session.get("nodes", [])
    siblings = [n for n in nodes if n.get("parent_id") == parent_id]
    if len(siblings) == 0:
        # 第一个子节点，使用默认色
        return BRANCH_COLORS[0]
    else:
        # 后续子节点（分叉），取下一个颜色
        used_colors = {n.get("branch_color") for n in siblings if n.get("branch_color")}
        for color in BRANCH_COLORS:
            if color not in used_colors:
                return color
        # 所有颜色都用过了，循环取
        return BRANCH_COLORS[len(siblings) % len(BRANCH_COLORS)]


def add_node(session_id: str, node_data: dict) -> Optional[dict]:
    session = get_session(session_id)
    if session is None:
        return None

    now = datetime.now().isoformat()
    parent_id = node_data.get("parent_id")

    # 分配分支颜色：如果调用方已指定则使用，否则自动分配
    if "branch_color" in node_data and node_data["branch_color"]:
        branch_color = node_data["branch_color"]
    else:
        branch_color = _assign_branch_color(session, parent_id)

    new_node = {
        "id": node_data.get("id", str(uuid4())),
        "parent_id": parent_id,
        "user_message": node_data.get("user_message", ""),
        "ai_reply": node_data.get("ai_reply", ""),
        "timestamp": node_data.get("timestamp", now),
        "branch_color": branch_color,
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


def delete_node(session_id: str, node_id: str, cascade: bool = True) -> bool:
    session = get_session(session_id)
    if session is None:
        return False

    nodes = session.get("nodes", [])

    if cascade:
        # 级联删除:收集该节点及所有子孙节点
        ids_to_delete = set()
        def collect_descendants(nid):
            ids_to_delete.add(nid)
            for n in nodes:
                if n.get("parent_id") == nid:
                    collect_descendants(n["id"])
        collect_descendants(node_id)
        session["nodes"] = [n for n in nodes if n["id"] not in ids_to_delete]
    else:
        session["nodes"] = [n for n in nodes if n["id"] != node_id]

    if len(session["nodes"]) < len(nodes):
        session["updated_at"] = datetime.now().isoformat()

        data = read_sessions()
        for i, s in enumerate(data["sessions"]):
            if s["id"] == session_id:
                data["sessions"][i] = session
                break

        write_sessions(data)
        logger.info("删除节点: session_id=%s, node_id=%s, cascade=%s", session_id, node_id, cascade)
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


def get_session_tree(session_id: str) -> Optional[dict]:
    """返回完整对话树结构，从根节点开始递归构建。"""
    session = get_session(session_id)
    if session is None:
        return None

    nodes = session.get("nodes", [])

    # 找到根节点
    root_node = None
    for n in nodes:
        if n["id"] == "root":
            root_node = n
            break

    if root_node is None:
        # 兼容旧数据：如果没有 root 节点，找 parent_id 为 None 的节点
        for n in nodes:
            if n.get("parent_id") is None:
                root_node = n
                break

    if root_node is None:
        return None

    # 构建子节点映射
    children_map = {}
    for n in nodes:
        pid = n.get("parent_id")
        if pid:
            if pid not in children_map:
                children_map[pid] = []
            children_map[pid].append(n)

    def build_tree(node: dict) -> dict:
        node_id = node["id"]
        children = children_map.get(node_id, [])
        return {
            "id": node_id,
            "parent_id": node.get("parent_id"),
            "user_message": node.get("user_message", ""),
            "ai_reply": node.get("ai_reply", ""),
            "branch_color": node.get("branch_color", ""),
            "timestamp": node.get("timestamp", ""),
            "children": [build_tree(child) for child in children],
        }

    return build_tree(root_node)


def get_node_context_path(session_id: str, node_id: str) -> list:
    """返回从根节点到指定节点的路径上所有节点（用于上下文构建）。
    与 get_node_path 类似，但排除根节点（root）本身。
    """
    path = get_node_path(session_id, node_id)
    # 排除根节点（id="root"），因为根节点没有实际对话内容
    return [n for n in path if n.get("id") != "root"]


BRANCH_COLORS = [
    "#6366f1", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"
]


def get_available_branch_colors() -> list:
    return BRANCH_COLORS
