"""系统设置：大模型（多模态）配置、数据库存储概况、家具默认值。

GET  /api/settings                 一次性返回全部设置与统计
PUT  /api/settings/llm             保存大模型配置
POST /api/settings/test_llm        测试大模型连通性（文本 + 视觉可选）
PUT  /api/settings/furniture       保存家具默认值覆盖
POST /api/settings/furniture/reset 恢复出厂默认值
"""
import time

import httpx
from fastapi import APIRouter, HTTPException

from .. import db
from ..catalog import (
    FURNITURE_DEFAULTS,
    FURNITURE_HEIGHTS,
    WALL_KIND_LABELS,
    WALL_KIND_THICKNESS,
    get_furniture_defaults,
)
from ..schemas import FurnitureDefaultsPayload, LlmSettings
from ..settings import (
    BUILTIN_RECOGNIZE_PROMPT,
    clear_furniture_overrides,
    get_llm_config,
    log_llm_call,
    save_furniture_overrides,
    save_llm_config,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def read_settings():
    cfg = get_llm_config()
    return {
        "llm": cfg,
        "llm_base": {
            "base_url": cfg.get("base_url", ""),
            "model": cfg.get("model", ""),
            "has_key": bool(cfg.get("api_key")),
            "vision_model": cfg.get("vision_model", ""),
            "enabled": bool(cfg.get("enabled")),
        },
        "recognition_prompt": cfg.get("recognition_prompt", ""),
        "recognition_prompt_builtin": BUILTIN_RECOGNIZE_PROMPT,
        "db": db.db_stats(),
        "furniture_defaults": get_furniture_defaults(),
        "furniture_builtin": {
            k: {**v, "height": FURNITURE_HEIGHTS.get(k, 800)}
            for k, v in FURNITURE_DEFAULTS.items()
        },
        "wall_kinds": [
            {"kind": k, "label": WALL_KIND_LABELS.get(k, k), "thickness": t}
            for k, t in WALL_KIND_THICKNESS.items()
        ],
    }


@router.put("/llm")
def write_llm(body: LlmSettings):
    payload = {k: v for k, v in body.dict().items() if v is not None}
    cfg = save_llm_config(payload)
    return {"ok": True, "llm": {**cfg, "api_key": ("***" if cfg.get("api_key") else "")}}


@router.post("/test_llm")
def test_llm(body: LlmSettings = None):
    """用一条极短的文本请求验证连通性；body 可临时覆盖配置（未保存）。"""
    cfg = get_llm_config()
    if body is not None:
        cfg.update({k: v for k, v in body.dict().items() if v is not None})

    base = (cfg.get("base_url") or "").strip().rstrip("/")
    key = (cfg.get("api_key") or "").strip()
    model = (cfg.get("model") or "").strip()
    if not base:
        raise HTTPException(400, "请填写接口地址（Base URL）")
    if not key:
        raise HTTPException(400, "请填写 API Key")
    if not model:
        raise HTTPException(400, "请填写模型名称")

    t0 = time.time()
    try:
        resp = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": model,
                  "messages": [{"role": "user", "content": "只回复两个字：正常"}],
                  "max_tokens": 16, "temperature": 0},
            timeout=30,
        )
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        log_llm_call("测试连接", model, "", "error", 0, ms, f"连接失败：{e}", 0, "")
        raise HTTPException(400, f"连接失败：{e}")
    ms = int((time.time() - t0) * 1000)
    if resp.status_code == 401:
        log_llm_call("测试连接", model, "", "error", 401, ms, "401：API Key 无效或已过期", 0, "")
        raise HTTPException(400, "401：API Key 无效或已过期")
    if resp.status_code == 404:
        log_llm_call("测试连接", model, "", "error", 404, ms, "404：接口地址或模型名不正确", 0, "")
        raise HTTPException(400, "404：接口地址或模型名不正确")
    if resp.status_code >= 400:
        log_llm_call("测试连接", model, "", "error", resp.status_code, ms, resp.text[:200], 0, "")
        raise HTTPException(400, f"{resp.status_code}：{resp.text[:200]}")
    try:
        reply = resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        reply = "(无内容)"
    log_llm_call("测试连接", model, "", "ok", resp.status_code, ms, "", 0, reply[:400])
    return {
        "ok": True,
        "message": f"连接成功（{ms}ms）",
        "model": model,
        "reply": reply[:80],
        "vision_model": (cfg.get("vision_model") or model),
    }


@router.put("/furniture")
def write_furniture(body: FurnitureDefaultsPayload):
    ov = save_furniture_overrides(body.defaults or {})
    return {"ok": True, "overrides": ov, "furniture_defaults": get_furniture_defaults()}


@router.post("/furniture/reset")
def reset_furniture():
    clear_furniture_overrides()
    return {"ok": True, "furniture_defaults": get_furniture_defaults()}


@router.get("/llm_logs")
def read_llm_logs(limit: int = 100):
    """查看大模型调用日志（最近 N 条，倒序）。"""
    return {"logs": db.list_llm_logs(limit)}


@router.delete("/llm_logs")
def delete_llm_logs():
    """清空大模型调用日志。"""
    db.clear_llm_logs()
    return {"ok": True}
