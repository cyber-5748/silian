import logging
import os
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from datetime import datetime, timedelta


def setup_logging(log_level="INFO"):
    """初始化日志系统"""
    log_dir = Path(__file__).resolve().parent.parent / "logs"
    log_dir.mkdir(exist_ok=True)

    # 清理7天前的日志
    cleanup_old_logs(log_dir, days=7)

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    # 避免重复添加handler
    if root_logger.handlers:
        return

    formatter = logging.Formatter(
        '[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # 控制台handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # 文件handler - 按日期
    log_file = log_dir / f"app_{datetime.now().strftime('%Y-%m-%d')}.log"
    file_handler = logging.FileHandler(str(log_file), encoding='utf-8')
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)


def cleanup_old_logs(log_dir: Path, days: int = 7):
    """清理旧日志文件"""
    cutoff = datetime.now() - timedelta(days=days)
    for log_file in log_dir.glob("app_*.log"):
        try:
            date_str = log_file.stem.replace("app_", "")
            file_date = datetime.strptime(date_str, "%Y-%m-%d")
            if file_date < cutoff:
                log_file.unlink()
        except (ValueError, OSError):
            pass


def get_logger(name: str) -> logging.Logger:
    """获取命名logger"""
    return logging.getLogger(name)
