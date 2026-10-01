"""AI 自然语言布置 + 标准动作 API。"""
from fastapi import APIRouter, HTTPException
from .. import db
from ..ai_agent import arrange_from_message
from ..actions import apply_actions
from ..schemas import AiArrangeRequest, ApplyActionsRequest

router = APIRouter(prefix="/api/projects", tags=["ai"])


@router.post("/{pid}/ai_arrange")
def ai_arrange(pid: int, body: AiArrangeRequest):
    """自然语言布置：LLM（或启发式）把一句话翻译成动作并应用到场景。"""
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    scene = dict(p["scene"])
    scene, message = arrange_from_message(scene, body.message)
    if scene is None:
        return {"ok": False, "message": message, "scene": p["scene"]}
    updated = db.update_project(pid, scene)
    return {"ok": True, "message": message, "scene": updated["scene"]}


@router.post("/{pid}/apply_actions")
def apply_actions_endpoint(pid: int, body: ApplyActionsRequest):
    """标准动作 API：直接执行一组画布动作（供 AI / MCP / 自动化调用，无需自然语言）。

    body: { "actions": [ {"op":"...", ...}, ... ], "message": "可选备注" }
    返回应用后的完整场景与逐项执行报告。
    """
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    scene = dict(p["scene"])
    new_scene, reports = apply_actions(scene, body.actions)
    updated = db.update_project(pid, new_scene)
    ok_count = sum(1 for r in reports if not r.startswith("⚠️"))
    msg = body.message or f"已应用 {ok_count}/{len(body.actions or [])} 个动作"
    return {"ok": True, "message": msg, "reports": reports, "scene": updated["scene"]}
