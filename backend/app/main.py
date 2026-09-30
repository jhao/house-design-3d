"""FastAPI 应用入口：单进程同时提供 API 与前端静态资源。"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from .config import FRONTEND_DIR, UPLOAD_DIR, HOST, PORT, ensure_dirs
from .db import init_db
from .routers import projects, floorplan, ai, settings

ensure_dirs()
init_db()

app = FastAPI(title="房型设计平台", version="0.1.0")

# 自用小工具，允许本地跨域（仅本机访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(floorplan.router)
app.include_router(ai.router)
app.include_router(settings.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    return {"status": "ready"}


# 用户上传的图片
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# 前端静态资源 + 首页（html=True 使 "/" 返回 index.html）
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.app.main:app", host=HOST, port=PORT, reload=False)
