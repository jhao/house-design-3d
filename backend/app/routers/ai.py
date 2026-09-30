"""AI 自然语言布置。"""
from fastapi import APIRouter, HTTPException
from .. import db
from ..ai_agent import arrange_from_message
from ..schemas import AiArrangeRequest

router = APIRouter(prefix="/api/projects", tags=["ai"])


@router.post("/{pid}/ai_arrange")
def ai_arrange(pid: int, body: AiArrangeRequest):
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    scene = dict(p["scene"])
    scene, message = arrange_from_message(scene, body.message)
    if scene is None:
        return {"ok": False, "message": message, "scene": p["scene"]}
    updated = db.update_project(pid, scene)
    return {"ok": True, "message": message, "scene": updated["scene"]}
