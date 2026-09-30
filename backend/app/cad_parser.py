"""CAD / 线框解析。

支持：
1. DXF（文本）：LINE / LWPOLYLINE / POLYLINE → 墙体线段
2. 自有 JSON 线框格式（含 walls/rooms/openings/furniture）

导入后做"美化"：补全缺省厚度/高度、生成墙体 id、对纯墙体图纸自动识别房间。
"""
import json
from . import rooms as rooms_mod
from .catalog import ROOM_PALETTE
from .scene import empty_scene, normalize_scene


def _make_wall(x1, y1, x2, y2, thickness=200, height=2800):
    return {"x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "thickness": thickness, "height": height}


def parse_dxf(text):
    """极简 DXF 解析，返回 {walls:[...]}。"""
    lines = text.splitlines()
    tokens = []
    it = iter(lines)
    try:
        while True:
            code = next(it).strip()
            val = next(it).strip()
            tokens.append((code, val))
    except StopIteration:
        pass

    walls = []
    current = None

    def finalize_line(c):
        if c and "x1" in c and "x2" in c:
            walls.append(_make_wall(c["x1"], c["y1"], c["x2"], c["y2"]))

    def finalize_poly(c):
        pts = c.get("points", [])
        pts = [p for p in pts if p[0] is not None and p[1] is not None]
        for i in range(len(pts) - 1):
            x1, y1 = pts[i]
            x2, y2 = pts[i + 1]
            walls.append(_make_wall(x1, y1, x2, y2))

    i = 0
    while i < len(tokens):
        code, val = tokens[i]
        if code == "0":
            t = val.upper()
            if current and current.get("type") == "LINE":
                finalize_line(current)
                current = None
            if t == "LINE":
                current = {"type": "LINE"}
            elif t in ("LWPOLYLINE", "POLYLINE"):
                current = {"type": "POLYLINE", "points": []}
            elif t == "SEQEND":
                if current and current.get("type") == "POLYLINE":
                    finalize_poly(current)
                current = None
            else:
                current = None
        elif current is not None:
            if current["type"] == "LINE":
                if code == "10":
                    current["x1"] = float(val)
                elif code == "20":
                    current["y1"] = float(val)
                elif code == "11":
                    current["x2"] = float(val)
                elif code == "21":
                    current["y2"] = float(val)
            else:  # POLYLINE / LWPOLYLINE
                if code == "10":
                    current["points"].append([float(val), None])
                elif code == "20" and current["points"]:
                    current["points"][-1][1] = float(val)
        i += 1
    # 收尾（文件末尾的 LINE）
    if current and current.get("type") == "LINE":
        finalize_line(current)
    return {"walls": walls}


def parse_json_wireframe(obj):
    """解析自有 JSON 线框格式。"""
    s = empty_scene()
    s["walls"] = obj.get("walls", [])
    s["openings"] = obj.get("openings", [])
    s["rooms"] = obj.get("rooms", [])
    s["furniture"] = obj.get("furniture", [])
    if obj.get("scale") is not None:
        s["scale"] = obj["scale"]
    return s


def import_bytes_to_scene(data: bytes, filename: str = "", hint: str = ""):
    """统一入口（字节版）：
    - 图片 / PDF / DWG → 交给多模态大模型识别（vision.recognize_floorplan）
    - DXF / JSON     → 原有线框解析
    """
    from .vision import is_vision_candidate, recognize_floorplan

    if is_vision_candidate(filename):
        scene, _parsed = recognize_floorplan(data, filename, hint or "")
        return scene

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        # 二进制但扩展名未知：按图片交给大模型
        scene, _parsed = recognize_floorplan(data, filename, hint or "")
        return scene

    return import_to_scene(text, filename)


def import_to_scene(raw_text, filename=""):
    """统一入口：根据文件类型解析并美化，返回规范化后的 scene。"""
    name = (filename or "").lower()
    if name.endswith(".dxf"):
        parsed = parse_dxf(raw_text)
    elif name.endswith(".json"):
        parsed = parse_json_wireframe(json.loads(raw_text))
    else:
        # 尝试当作 JSON，失败再当 DXF
        try:
            parsed = parse_json_wireframe(json.loads(raw_text))
        except Exception:
            parsed = parse_dxf(raw_text)

    scene = empty_scene()
    scene["walls"] = parsed.get("walls", [])
    scene["openings"] = parsed.get("openings", [])
    scene["furniture"] = parsed.get("furniture", [])
    # 若未提供房间，则从墙体自动识别
    if parsed.get("rooms"):
        scene["rooms"] = parsed["rooms"]
    else:
        scene["rooms"] = rooms_mod.detect_rooms(scene["walls"])

    return normalize_scene(scene)
