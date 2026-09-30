"""集中配置：全部来自环境变量，启动时校验，密钥不进代码库。"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # 项目根（运行时由文件位置自动推导，不依赖绝对路径）

# 实际场景与网页展示的等比例缩小倍数（1:200），用于节省图形渲染计算
DISPLAY_RATIO = int(os.getenv("DISPLAY_RATIO", "200"))

DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
FRONTEND_DIR = BASE_DIR / "frontend"
DB_PATH = DATA_DIR / "house_design.db"

# 可选 LLM（用于 AI 自然语言布置）。不配置则使用内置启发式解析。
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-chat")

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))


def ensure_dirs():
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
