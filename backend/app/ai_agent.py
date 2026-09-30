"""AI 自然语言布置。

优先：若配置了 LLM（环境变量 LLM_API_KEY），调用大模型让其返回结构化放置指令。
兜底：内置启发式解析，识别"家具类型 + 房间名"，放置在房间中心。
始终返回 (scene_or_None, message)。
"""
import time
from . import rooms as rooms_mod
from .catalog import FURNITURE_DEFAULTS, get_furniture_defaults
from .config import LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
from .scene import _uid  # noqa: F401  (保留导出方便测试)

FURNITURE_KEYWORDS = {
    "沙发": "sofa", "床": "bed", "桌子": "table", "餐桌": "table", "书桌": "table",
    "椅子": "chair", "凳子": "chair", "冰箱": "fridge", "柜": "cabinet",
    "衣柜": "cabinet", "书柜": "bookshelf", "书架": "bookshelf", "电视": "tv",
    "绿植": "plant", "植物": "plant", "马桶": "toilet", "厕所": "toilet",
}

ROOM_HINTS = {
    "客厅": ["客厅", "起居", "沙龙"], "卧室": ["卧室", "主卧", "次卧", "睡房"],
    "厨房": ["厨房"], "卫生间": ["卫生间", "厕所", "浴室", "洗手间"],
    "餐厅": ["餐厅", "饭厅"], "书房": ["书房", "办公"], "阳台": ["阳台"],
}


def _detect_furniture(msg):
    for kw, t in FURNITURE_KEYWORDS.items():
        if kw in msg:
            return t
    return None


def _detect_room(scene, msg):
    # 1) 消息里直接出现房间名关键词
    for room in scene.get("rooms", []):
        rn = room.get("name", "")
        for rk, hints in ROOM_HINTS.items():
            if rk in msg or any(h in msg for h in hints):
                return room
        if rn and rn in msg:
            return room
    return None


def _place(scene, ftype, room):
    defs = get_furniture_defaults()
    spec = defs.get(ftype, defs["image"])
    if room and room.get("points"):
        cx, cy = rooms_mod.room_centroid(room["points"])
        # 稍微随机偏移，避免叠放
        import random
        cx += random.uniform(-300, 300)
        cy += random.uniform(-300, 300)
    else:
        cx, cy = 2000, 2000
    item = {
        "id": f"f{int(time.time() * 1000)}",
        "type": ftype,
        "x": round(cx, 1),
        "y": round(cy, 1),
        "width": spec["width"],
        "depth": spec["depth"],
        "rotation": 0,
        "color": spec["color"],
        "label": spec["label"],
    }
    scene.setdefault("furniture", []).append(item)
    return item


def _heuristic(scene, msg):
    ftype = _detect_furniture(msg)
    if not ftype:
        return None, ("未识别到家具类型，请尝试包含：沙发、床、桌子、椅子、冰箱、柜子、书架、电视、绿植、马桶等关键词。")
    room = _detect_room(scene, msg)
    item = _place(scene, ftype, room)
    where = room["name"] if room else "场景中心"
    return scene, f"已在「{where}」放置一个{spec_label(ftype)}。"


def spec_label(ftype):
    defs = get_furniture_defaults()
    return defs.get(ftype, defs["image"])["label"]


def _llm_arrange(scene, msg):
    """调用大模型，要求返回 JSON 放置列表。失败抛出异常由调用方兜底。"""
    system = (
        "你是一个室内布置助手。用户用中文描述想在某个房间放什么家具。"
        "请结合当前场景（房间列表、已有家具），输出要新增的家具放置指令，"
        "仅返回 JSON，格式：{\"adds\":[{\"type\":\"sofa|bed|table|chair|fridge|cabinet|bookshelf|tv|plant|toilet\","
        "\"room\":\"房间名（尽量匹配已有房间）\"}]}，不要任何解释文字。"
    )
    rooms_desc = [r.get("name", "") for r in scene.get("rooms", [])]
    user = f"当前房间：{rooms_desc}\n用户需求：{msg}"
    import httpx  # 仅在使用 LLM 时才需要
    resp = httpx.post(
        f"{LLM_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
        json={"model": LLM_MODEL, "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ], "temperature": 0.2},
        timeout=30,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    import json
    data = json.loads(_extract_json(content))
    added = []
    for a in data.get("adds", []):
        ftype = a.get("type")
        if ftype not in get_furniture_defaults():
            continue
        room = next((r for r in scene.get("rooms", []) if r.get("name") == a.get("room")), None)
        item = _place(scene, ftype, room)
        added.append(item["label"])
    return scene, f"已根据 AI 建议放置：{('、'.join(added) if added else '无')}。"


def _extract_json(text):
    s = text.find("{")
    e = text.rfind("}")
    if s >= 0 and e >= 0:
        return text[s:e + 1]
    return text


def arrange_from_message(scene, msg):
    if LLM_API_KEY:
        try:
            return _llm_arrange(scene, msg)
        except Exception:
            pass
    return _heuristic(scene, msg)
