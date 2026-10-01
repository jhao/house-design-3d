"""AI 自然语言布置助手。

核心思路：把「用户的一句话需求」翻译成一组标准画布动作（actions），
再交给 backend.app.actions.apply_actions 执行。这样无论是 LLM 还是内置启发式，
走的都是同一套语义接口，行为一致、可审计、可被 MCP 复用。

- 配置了 LLM（环境变量 LLM_API_KEY）：调用大模型，要求其返回 JSON 动作数组。
- 未配置 / LLM 失败：回落到内置启发式（识别「家具类型 + 房间名」→ 在房间中心放置）。
始终返回 (scene, message)。
"""
import json
from . import rooms as rooms_mod
from .catalog import get_furniture_defaults, FURNITURE_DEFAULTS
from .config import LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
from . import actions as actions_mod

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
    for room in scene.get("rooms", []):
        rn = room.get("name", "")
        for rk, hints in ROOM_HINTS.items():
            if rk in msg or any(h in msg for h in hints):
                return room
        if rn and rn in msg:
            return room
    return None


def spec_label(ftype):
    return get_furniture_defaults().get(ftype, get_furniture_defaults()["image"])["label"]


def _scene_summary(scene):
    """给 LLM 的精简场景摘要（避免塞入完整坐标）。"""
    rooms = [r.get("name", "") for r in scene.get("rooms", [])]
    walls = [{"id": w.get("id"), "len": round(((w["x2"] - w["x1"]) ** 2 + (w["y2"] - w["y1"]) ** 2) ** 0.5)}
             for w in scene.get("walls", [])]
    openings = [{"id": o.get("id"), "type": o.get("type"), "wall_id": o.get("wall_id"), "offset": o.get("offset")}
                for o in scene.get("openings", [])]
    furn = [{"id": f.get("id"), "type": f.get("type"), "label": f.get("label"), "x": f.get("x"), "y": f.get("y")}
            for f in scene.get("furniture", [])]
    chars = [{"id": c.get("id"), "x": c.get("x"), "y": c.get("y"), "state": c.get("state")}
             for c in scene.get("characters", [])]
    return {
        "rooms": rooms,
        "walls": walls,
        "openings": openings,
        "furniture": furn,
        "characters": chars,
        "ceiling_height": scene.get("ceiling_height", 2900),
    }


def _heuristic_actions(scene, msg):
    """内置启发式：识别家具类型 + 房间，生成 add_furniture 动作。"""
    ftype = _detect_furniture(msg)
    if not ftype:
        return None
    room = _detect_room(scene, msg)
    if room and room.get("points"):
        import random
        cx, cy = rooms_mod.room_centroid(room["points"])
        cx += random.uniform(-300, 300); cy += random.uniform(-300, 300)
    else:
        cx, cy = 2000, 2000
    return [{
        "op": "add_furniture",
        "type": ftype,
        "x": round(cx),
        "y": round(cy),
    }]


def _llm_actions(scene, msg):
    """调用大模型，要求返回 JSON 动作数组。失败抛异常由调用方兜底。"""
    summary = _scene_summary(scene)
    system = (
        "你是室内户型图编辑助手。用户用中文描述想对户型图做的修改，"
        "你需要把修改翻译为一组『标准画布动作』（JSON 数组）。每个动作形如："
        '{"op":"<动作名>", ...参数}。\n'
        "可用动作：add_furniture(新增家具,type,x,y,可选width/depth/rotation/color/label)、"
        "update_furniture(修改家具属性,id,x?,y?,width?,depth?,rotation?,color?,label?)、"
        "add_character(新增人物,x,y,可选height/rotation/state)、"
        "update_character(修改人物,id,...)、"
        "move_element(平移元素,type,x?,y?,dx?,dy?；type∈furniture|character|wall|room|opening)、"
        "add_wall(新增墙,x1,y1,x2,y2,可选kind/thickness/height)、"
        "update_wall(修改墙,id,x1?,y1?,x2?,y2?,kind?,thickness?,height?)、"
        "add_opening(新增门窗,wall_id,opening_type,可选offset/width/height/dir)、"
        "update_opening(修改门窗,id,offset?,width?,height?,dir?,wall_id?)、"
        "delete_element(删除元素,type,id)。\n"
        "坐标单位 mm。家具 type 仅限：bed/sofa/table/chair/fridge/cabinet/bookshelf/tv/plant/toilet/stove/sink/image。"
        "门 dir 仅限：left_in/left_out/right_in/right_out/double_in/double_out。"
        "只能引用场景里已存在的 id。只返回 JSON 数组，不要任何解释文字。"
    )
    user = "当前场景摘要：" + json.dumps(summary, ensure_ascii=False) + "\n用户需求：" + msg
    import httpx
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
    data = json.loads(_extract_json_array(content))
    acts = []
    for a in data:
        na = actions_mod.normalize_action(a)
        if na:
            acts.append(na)
    return acts


def _extract_json_array(text):
    s = text.find("[")
    e = text.rfind("]")
    if s >= 0 and e >= 0:
        return text[s:e + 1]
    # 也兼容 {"actions":[...]}
    s = text.find("{"); e = text.rfind("}")
    if s >= 0 and e >= 0:
        try:
            obj = json.loads(text[s:e + 1])
            if isinstance(obj.get("actions"), list):
                return json.dumps(obj["actions"], ensure_ascii=False)
        except Exception:
            pass
    return text


def arrange_from_message(scene, msg):
    """返回 (scene_or_None, message)。"""
    # 1) 优先尝试 LLM → 动作数组
    if LLM_API_KEY:
        try:
            acts = _llm_actions(scene, msg)
            if acts:
                new_scene, reports = actions_mod.apply_actions(scene, acts)
                applied = [r for r in reports if not r.startswith("⚠️")]
                msg_out = "已执行 " + str(len(applied)) + " 项操作：" + "；".join(applied[:6])
                if len(applied) > 6:
                    msg_out += " …"
                return new_scene, msg_out
        except Exception as e:
            # LLM 失败，回落启发式
            print("LLM 布置失败，回落启发式：", e)

    # 2) 启发式兜底
    acts = _heuristic_actions(scene, msg)
    if not acts:
        return None, ("未识别到可执行的家具类型，请尝试包含：沙发、床、桌子、椅子、冰箱、柜子、书架、电视、绿植、马桶等关键词。"
                      "（配置大模型后还可调整墙/门窗/人物等）")
    new_scene, reports = actions_mod.apply_actions(scene, acts)
    where = _detect_room(scene, msg)
    return new_scene, f"已在「{where['name'] if where else '场景中心'}」放置一个{spec_label(acts[0]['type'])}。"
