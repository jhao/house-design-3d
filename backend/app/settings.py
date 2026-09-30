"""系统设置：大模型（含多模态）配置、家具默认值覆盖。

配置持久化在 SQLite 的 settings 表；未配置时回落到环境变量（config.py）。
"""
import time

from . import db
from .config import LLM_BASE_URL, LLM_API_KEY, LLM_MODEL

# 家具默认值里允许用户覆盖的字段
FURNITURE_FIELDS = ("label", "width", "depth", "height", "color")


# ============ 内置的「图纸识别提示词」 ============
# 用户可在系统设置里覆盖（recognition_prompt 字段）；留空即使用此内置提示词。
BUILTIN_RECOGNIZE_PROMPT = """你是户型图识别引擎。只输出严格合法 JSON，不要任何解释或代码块。
坐标系：单位 mm、原点在图纸左下角、X 轴向右、Y 轴向上。
字段：ceiling_height(层高mm)；walls[{x1,y1,x2,y2,kind}]，kind∈normal/bearing/glass；
rooms[{name,points:[[x,y]...]}]（闭合多边形，至少 3 点）；
openings[{type:door|window,wall_index,offset,width,height,dir|sill}]，dir∈left_in/left_out/right_in/right_out/double_in/double_out；
furniture[{type,x,y,rotation}]，type∈bed/sofa/table/chair/fridge/cabinet/bookshelf/tv/plant/toilet/stove/sink。
优先依据图上尺寸标注；无标注按中国住宅常见尺度估算（墙厚150/承重300、门900×2100、窗1500×1500+窗台900、层高2900）。只输出 JSON 本身。"""


def default_llm_config():
    return {
        "base_url": LLM_BASE_URL or "https://api.deepseek.com/v1",
        "api_key": LLM_API_KEY or "",
        "model": LLM_MODEL or "deepseek-chat",
        "vision_model": "",          # 留空表示与 model 相同
        "enabled": bool(LLM_API_KEY),
        "dwg_converter": "",         # 可选：DWG→图片 的外部命令模板，含 {in} {out}
        "timeout": 300,              # 推理型视觉模型耗时较长，默认放宽到 300s
        # 输出预算（含推理型模型的思考 token）。deepseek-flash 等推理模型在识别
        # 复杂图纸时会先产出上万 token 的 reasoning_content，预算不足会导致
        # content 为空（finish_reason=length）。默认给足，并在截断时自动加码重试。
        "max_tokens": 16000,
        "recognition_prompt": "",    # 留空表示使用内置提示词
    }


def get_llm_config():
    cfg = default_llm_config()
    saved = db.get_setting("llm", {}) or {}
    if isinstance(saved, dict):
        for k, v in saved.items():
            if v is not None:
                cfg[k] = v
    return cfg


def save_llm_config(cfg: dict):
    cur = get_llm_config()
    cur.update({k: v for k, v in (cfg or {}).items() if v is not None})
    db.set_setting("llm", cur)
    return cur


def get_vision_model():
    cfg = get_llm_config()
    return (cfg.get("vision_model") or cfg.get("model") or "").strip()


def active_recognition_prompt():
    """当前生效的图纸识别提示词：用户覆盖优先，否则内置。"""
    return (get_llm_config().get("recognition_prompt") or "").strip() or BUILTIN_RECOGNIZE_PROMPT


# ---------------- 大模型调用日志 ----------------

def log_llm_call(kind, model, filename, status, http=0, duration_ms=0,
                 error="", prompt_len=0, reply_preview=""):
    """记录一次大模型调用。status: ok / error。"""
    try:
        db.add_llm_log(
            kind=kind, model=model or "", filename=filename or "",
            status=status, http=int(http or 0), duration_ms=int(duration_ms or 0),
            error=(error or "")[:1000], prompt_len=int(prompt_len or 0),
            reply_preview=(reply_preview or "")[:800],
        )
    except Exception:
        pass


def get_llm_logs(limit=100):
    return db.list_llm_logs(limit)


def clear_llm_logs():
    db.clear_llm_logs()


def get_furniture_overrides():
    return db.get_setting("furniture_defaults", {}) or {}


def save_furniture_overrides(payload: dict):
    """payload: {type: {label,width,depth,height,color}}，只保留已知字段与数值合法性。"""
    ov = get_furniture_overrides()
    for ftype, spec in (payload or {}).items():
        if not isinstance(spec, dict):
            continue
        clean = {}
        for f in FURNITURE_FIELDS:
            if f not in spec:
                continue
            v = spec[f]
            if f in ("width", "depth", "height"):
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    continue
                if v <= 0:
                    continue
                v = int(round(v))
            elif f == "color":
                v = str(v).strip()
                if not v.startswith("#"):
                    continue
            else:
                v = str(v).strip()
            clean[f] = v
        if clean:
            ov[str(ftype)] = clean
    db.set_setting("furniture_defaults", ov)
    return ov


def clear_furniture_overrides():
    db.delete_setting("furniture_defaults")
    return {}
