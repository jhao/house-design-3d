"""场景（scene）工具：归一化、一键缩放、面积统计。"""
import itertools
import time
from . import rooms as rooms_mod
from .catalog import FURNITURE_DEFAULTS, ROOM_PALETTE, WALL_KIND_THICKNESS, get_furniture_defaults


def empty_scene():
    return {
        "scale": 1.0,            # 用户施加的整体缩放比例（实际尺寸倍数）
        "display_ratio": 200,    # 1:200 展示
        "units": "mm",
        "ceiling_height": 2900,  # 房高（mm），项目基础配置，默认 2.9m
        "walls": [],
        "openings": [],
        "rooms": [],
        "furniture": [],
        "characters": [],
    }


# 自增序号：保证同一毫秒内批量创建 id 也不会重复（否则门窗会全部挂到同一面墙）
_uid_seq = itertools.count(1)


def _uid(prefix):
    return f"{prefix}{int(time.time() * 1000) % 1000000}_{next(_uid_seq)}"


def normalize_scene(scene):
    """补全字段、生成缺省 id，保证前端可安全读取。"""
    base = empty_scene()
    base.update(scene or {})
    s = base
    for w in s["walls"]:
        w.setdefault("id", _uid("w"))
        kind = w.get("kind", "normal")
        w.setdefault("kind", "normal")
        if "thickness" not in w:
            w["thickness"] = WALL_KIND_THICKNESS.get(kind, 150)
        if "height" not in w:
            w["height"] = s.get("ceiling_height", 2900)
    for o in s["openings"]:
        o.setdefault("id", _uid("o"))
        o.setdefault("width", 900)
        o.setdefault("height", 2100)
        if o.get("type") == "door" and "dir" not in o:
            o["dir"] = "left_in"
    for r in s["rooms"]:
        r.setdefault("id", _uid("r"))
        r.setdefault("color", ROOM_PALETTE[len(s["rooms"]) % len(ROOM_PALETTE)])
        if "area" not in r and r.get("points"):
            r["area"] = rooms_mod.polygon_area(r["points"])
    fdefs = get_furniture_defaults()
    fallback = fdefs.get("image", {"width": 800, "depth": 800, "color": "#90A4AE", "label": "自定义"})
    for f in s["furniture"]:
        f.setdefault("id", _uid("f"))
        spec = fdefs.get(f.get("type"), fallback)
        f.setdefault("width", spec["width"])
        f.setdefault("depth", spec["depth"])
        f.setdefault("height", spec.get("height"))
        f.setdefault("color", spec["color"])
        f.setdefault("label", spec["label"])
        f.setdefault("rotation", 0)
    for c in s.get("characters", []):
        c.setdefault("id", _uid("c"))
        c.setdefault("x", 2000)
        c.setdefault("y", 2000)
        c.setdefault("height", 1700)      # 身高 mm，默认 1.7m，最高 2500
        c.setdefault("state", "stand")    # stand/raise/squat/sit/lie
        c.setdefault("rotation", 0)
        c.setdefault("color", "#3a7bd5")
        c.setdefault("label", "人")
    return s


def scale_scene(scene, ratio):
    """一键缩放：所有实际尺寸（位置与大小）按 ratio 等比例缩放。"""
    if not ratio or ratio <= 0:
        return scene
    s = dict(scene)
    s["scale"] = round(scene.get("scale", 1.0) * ratio, 4)
    s["walls"] = [
        {**w, "x1": w["x1"] * ratio, "y1": w["y1"] * ratio,
         "x2": w["x2"] * ratio, "y2": w["y2"] * ratio,
         "thickness": w.get("thickness", 200) * ratio,
         "height": w.get("height", 2800) * ratio}
        for w in scene.get("walls", [])
    ]
    s["openings"] = [
        {**o, "offset": o.get("offset", 0) * ratio,
         "width": o.get("width", 900) * ratio,
         "height": o.get("height", 2100) * ratio}
        for o in scene.get("openings", [])
    ]
    s["rooms"] = [
        {**r, "points": [[p[0] * ratio, p[1] * ratio] for p in r.get("points", [])],
         "area": r.get("area", 0) * ratio * ratio}
        for r in scene.get("rooms", [])
    ]
    s["furniture"] = [
        {**f, "x": f.get("x", 0) * ratio, "y": f.get("y", 0) * ratio,
         "width": f.get("width", 800) * ratio, "depth": f.get("depth", 800) * ratio}
        for f in scene.get("furniture", [])
    ]
    s["characters"] = [
        {**c, "x": c.get("x", 0) * ratio, "y": c.get("y", 0) * ratio}
        for c in scene.get("characters", [])
    ]
    return s


def compute_areas(scene):
    """返回 {rooms:[{name,area}], total}。优先使用已识别房间面积（网格法，天然不重复）。"""
    rooms_list = []
    total = 0.0
    for r in scene.get("rooms", []):
        area = r.get("area")
        if area is None and r.get("points"):
            area = rooms_mod.polygon_area(r["points"])
        area = area or 0.0
        rooms_list.append({"name": r.get("name", "房间"), "area": round(area / 1e6, 2)})
        total += area
    return {"rooms": rooms_list, "total": round(total / 1e6, 2)}  # 转 m^2
