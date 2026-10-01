"""标准画布动作 API（Standard Canvas Actions）。

把「对画布的一切修改」收敛为一组结构化「动作」（action），由 apply_actions 统一执行。
这样前端交互、AI 助手、以及未来的 MCP 工具都走同一套语义接口，保证行为一致、
可审计、可重放。每个动作都是一个 dict：

    {"op": "<动作名>", ...参数 }

支持的动作（op）：
  add_furniture     新增家具      {type, x, y, width?, depth?, rotation?, color?, label?}
  update_furniture  修改家具属性  {id, x?, y?, width?, depth?, rotation?, color?, label?, type?}
  add_character     新增人物      {x, y, height?, rotation?, color?, state?, label?}
  update_character  修改人物属性  {id, x?, y?, height?, rotation?, color?, state?, label?}
  move_element      平移元素      {type, id, dx?, dy?, x?, y?}
                                     type ∈ furniture|character|wall|room|opening
  add_wall          新增墙体      {x1, y1, x2, y2, kind?, thickness?, height?}
  update_wall       修改墙体      {id, x1?, y1?, x2?, y2?, kind?, thickness?, height?}
  add_opening       新增门窗      {wall_id, opening_type, offset?, width?, height?, dir?}
  update_opening    修改门窗      {id, wall_id?, offset?, width?, height?, dir?, opening_type?}
  delete_element    删除元素      {type, id}   type ∈ wall|opening|furniture|character|room

坐标单位：mm（世界坐标）。门窗 offset 为沿所属墙起点起算的弧长，自动夹紧在墙段内。
"""


def _uid(prefix):
    from .scene import _uid as _u
    return _u(prefix)


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _find_list(scene, etype):
    key = {"furniture": "furniture", "character": "characters", "wall": "walls",
           "opening": "openings", "room": "rooms"}.get(etype)
    return scene.get(key) if key else None


def _find(scene, etype, eid):
    lst = _find_list(scene, etype)
    if not lst:
        return None
    return next((x for x in lst if x.get("id") == eid), None)


def _wall_len(w):
    return float(math_hypot(w["x2"] - w["x1"], w["y2"] - w["y1"]) or 1)


def math_hypot(a, b):
    return (a * a + b * b) ** 0.5


def _clamp_opening_offset(o, wall):
    if not wall:
        return o
    L = _wall_len(wall)
    half = (o.get("width") or 900) / 2
    o["offset"] = round(_clamp(o.get("offset", L / 2), half, max(half, L - half)))
    return o


# ============ 单个动作执行 ============
def _exec_action(scene, a):
    op = (a.get("op") or "").strip()
    if not op:
        return None
    etype = a.get("type")
    eid = a.get("id")

    # ---- 新增家具 ----
    if op == "add_furniture":
        from .catalog import get_furniture_defaults
        defs = get_furniture_defaults()
        ftype = a.get("type")
        if ftype not in defs:
            return f"⚠️ 未知家具类型：{ftype}"
        spec = defs[ftype]
        item = {
            "id": _uid("f"),
            "type": ftype,
            "x": round(float(a.get("x", 2000))),
            "y": round(float(a.get("y", 2000))),
            "width": int(a.get("width", spec["width"])),
            "depth": int(a.get("depth", spec["depth"])),
            "rotation": int(a.get("rotation", 0)),
            "color": a.get("color", spec["color"]),
            "label": a.get("label", spec["label"]),
        }
        scene.setdefault("furniture", []).append(item)
        return f"➕ 已在 ({item['x']},{item['y']}) 放置{spec['label']}"

    # ---- 修改家具 ----
    if op == "update_furniture":
        el = _find(scene, "furniture", eid)
        if not el:
            return f"⚠️ 找不到家具 {eid}"
        for k in ("x", "y", "width", "depth", "rotation"):
            if k in a and a[k] is not None:
                el[k] = round(float(a[k])) if k != "rotation" else int(a[k])
        for k in ("color", "label", "type"):
            if k in a and a[k] is not None:
                el[k] = a[k]
        return f"✏️ 已更新家具 {el.get('label', eid)}"

    # ---- 新增人物 ----
    if op == "add_character":
        item = {
            "id": _uid("c"),
            "x": round(float(a.get("x", 2000))),
            "y": round(float(a.get("y", 2000))),
            "height": int(a.get("height", 1700)),
            "rotation": int(a.get("rotation", 0)),
            "color": a.get("color", "#3a7bd5"),
            "state": a.get("state", "stand"),
            "label": a.get("label", "人"),
        }
        scene.setdefault("characters", []).append(item)
        return f"➕ 已添加人物（{item['state']}）"

    # ---- 修改人物 ----
    if op == "update_character":
        el = _find(scene, "character", eid)
        if not el:
            return f"⚠️ 找不到人物 {eid}"
        for k in ("x", "y", "height", "rotation"):
            if k in a and a[k] is not None:
                el[k] = round(float(a[k])) if k != "rotation" else int(a[k])
        for k in ("color", "state", "label"):
            if k in a and a[k] is not None:
                el[k] = a[k]
        return f"✏️ 已更新人物（{el.get('state', '')}）"

    # ---- 平移元素（家具/人物/墙/房间/门窗）----
    if op == "move_element":
        if etype == "furniture":
            el = _find(scene, "furniture", eid)
            if not el:
                return f"⚠️ 找不到家具 {eid}"
            if "x" in a and a["x"] is not None:
                el["x"], el["y"] = round(float(a["x"])), round(float(a.get("y", el["y"])))
            else:
                el["x"] = round(el["x"] + float(a.get("dx", 0)))
                el["y"] = round(el["y"] + float(a.get("dy", 0)))
            return f"↔️ 已移动家具 {el.get('label', eid)}"
        if etype == "character":
            el = _find(scene, "character", eid)
            if not el:
                return f"⚠️ 找不到人物 {eid}"
            if "x" in a and a["x"] is not None:
                el["x"], el["y"] = round(float(a["x"])), round(float(a.get("y", el["y"])))
            else:
                el["x"] = round(el["x"] + float(a.get("dx", 0)))
                el["y"] = round(el["y"] + float(a.get("dy", 0)))
            return f"↔️ 已移动人物 {eid}"
        if etype == "wall":
            el = _find(scene, "wall", eid)
            if not el:
                return f"⚠️ 找不到墙 {eid}"
            dx = float(a.get("dx", 0)) if "x" not in a else float(a.get("x", el["x1"])) - el["x1"]
            dy = float(a.get("dy", 0)) if "y" not in a else float(a.get("y", el["y1"])) - el["y1"]
            if "x" in a or "y" in a:
                # 以 (x,y) 作为墙起点，整体平移
                ddx = float(a.get("x", el["x1"])) - el["x1"]
                ddy = float(a.get("y", el["y1"])) - el["y1"]
            else:
                ddx, ddy = dx, dy
            el["x1"] = round(el["x1"] + ddx); el["y1"] = round(el["y1"] + ddy)
            el["x2"] = round(el["x2"] + ddx); el["y2"] = round(el["y2"] + ddy)
            return f"↔️ 已移动墙 {eid}"
        if etype == "room":
            el = _find(scene, "room", eid)
            if not el:
                return f"⚠️ 找不到房间 {eid}"
            pts = el.get("points") or []
            if "x" in a and a["x"] is not None:
                ddx = float(a["x"]) - (pts[0][0] if pts else 0)
                ddy = float(a.get("y", 0)) - (pts[0][1] if pts else 0)
            else:
                ddx, ddy = float(a.get("dx", 0)), float(a.get("dy", 0))
            el["points"] = [[round(p[0] + ddx), round(p[1] + ddy)] for p in pts]
            return f"↔️ 已移动房间 {el.get('name', eid)}"
        if etype == "opening":
            el = _find(scene, "opening", eid)
            if not el:
                return f"⚠️ 找不到门窗 {eid}"
            wall = _find(scene, "wall", el.get("wall_id"))
            if "x" in a and a["x"] is not None and wall:
                wdx = (wall["x2"] - wall["x1"]); wdy = (wall["y2"] - wall["y1"])
                L = _wall_len(wall) or 1
                ux, uy = wdx / L, wdy / L
                el["offset"] = round((float(a["x"]) - wall["x1"]) * ux + (float(a.get("y", 0)) - wall["y1"]) * uy)
            else:
                el["offset"] = round(el.get("offset", 0) + float(a.get("dx", 0)))
            _clamp_opening_offset(el, wall)
            return f"↔️ 已移动门窗 {eid}"
        return f"⚠️ move_element 不支持 type={etype}"

    # ---- 新增墙 ----
    if op == "add_wall":
        from .catalog import WALL_KIND_THICKNESS
        kind = a.get("kind", "normal")
        w = {
            "id": _uid("w"),
            "x1": round(float(a["x1"])), "y1": round(float(a["y1"])),
            "x2": round(float(a["x2"])), "y2": round(float(a["y2"])),
            "kind": kind,
            "thickness": int(a.get("thickness", WALL_KIND_THICKNESS.get(kind, 150))),
            "height": int(a.get("height", scene.get("ceiling_height", 2900))),
        }
        scene.setdefault("walls", []).append(w)
        return f"➕ 已新增墙（{kind}）长 {round(_wall_len(w))}mm"

    # ---- 修改墙 ----
    if op == "update_wall":
        el = _find(scene, "wall", eid)
        if not el:
            return f"⚠️ 找不到墙 {eid}"
        for k in ("x1", "y1", "x2", "y2", "thickness", "height"):
            if k in a and a[k] is not None:
                el[k] = round(float(a[k]))
        if "kind" in a and a["kind"] is not None:
            el["kind"] = a["kind"]
            if "thickness" not in a:
                from .catalog import WALL_KIND_THICKNESS
                el["thickness"] = WALL_KIND_THICKNESS.get(a["kind"], 150)
        return f"✏️ 已更新墙 {eid}"

    # ---- 新增门窗 ----
    if op == "add_opening":
        wall = _find(scene, "wall", a.get("wall_id"))
        if not wall:
            return f"⚠️ 找不到所属墙 {a.get('wall_id')}"
        otype = a.get("opening_type", "door")
        o = {
            "id": _uid("o"),
            "wall_id": wall["id"],
            "type": otype,
            "offset": int(a.get("offset", round(_wall_len(wall) / 2))),
            "width": int(a.get("width", 900 if otype == "door" else 1500)),
            "height": int(a.get("height", (scene.get("ceiling_height", 2900) - 80) if otype == "door" else 1500)),
        }
        if otype == "door":
            o["dir"] = a.get("dir", "left_in")
        _clamp_opening_offset(o, wall)
        scene.setdefault("openings", []).append(o)
        return f"➕ 已在墙 {wall['id']} 上添加{'门' if otype=='door' else '窗'}"

    # ---- 修改门窗 ----
    if op == "update_opening":
        el = _find(scene, "opening", eid)
        if not el:
            return f"⚠️ 找不到门窗 {eid}"
        if "wall_id" in a and a["wall_id"] is not None:
            el["wall_id"] = a["wall_id"]
        if "opening_type" in a and a["opening_type"] is not None:
            el["type"] = a["opening_type"]
        for k in ("offset", "width", "height"):
            if k in a and a[k] is not None:
                el[k] = round(float(a[k]))
        if "dir" in a and a["dir"] is not None:
            el["dir"] = a["dir"]
        wall = _find(scene, "wall", el.get("wall_id"))
        _clamp_opening_offset(el, wall)
        return f"✏️ 已更新门窗 {eid}"

    # ---- 删除元素 ----
    if op == "delete_element":
        lst = _find_list(scene, etype)
        if not lst:
            return f"⚠️ 未知元素类型 {etype}"
        before = len(lst)
        scene[_key_for(etype)] = [x for x in lst if x.get("id") != eid]
        # 删除墙时连带删除其门窗
        if etype == "wall":
            scene["openings"] = [o for o in scene.get("openings", []) if o.get("wall_id") != eid]
        return f"🗑️ 已删除 {etype} {eid}" if len(lst) != before else f"⚠️ 找不到 {etype} {eid}"

    return f"⚠️ 未知动作 op={op}"


def _key_for(etype):
    return {"furniture": "furniture", "character": "characters", "wall": "walls",
            "opening": "openings", "room": "rooms"}.get(etype)


def apply_actions(scene, actions):
    """执行一组标准动作，返回 (新场景, 报告文本列表)。

    场景会被深拷贝，不会污染调用方传入的对象。
    """
    import copy
    s = copy.deepcopy(scene) if scene is not None else {}
    s.setdefault("walls", []); s.setdefault("openings", [])
    s.setdefault("rooms", []); s.setdefault("furniture", []); s.setdefault("characters", [])
    reports = []
    for a in (actions or []):
        try:
            r = _exec_action(s, a)
            if r:
                reports.append(r)
        except Exception as e:  # 单个动作失败不阻断其余动作
            reports.append(f"⚠️ 动作执行失败：{e}")
    return s, reports


def normalize_action(a):
    """轻量校验：返回规范化后的动作或 None（非法）。供 LLM/MCP 入口预处理。"""
    op = (a.get("op") or "").strip()
    valid = {"add_furniture", "update_furniture", "add_character", "update_character",
             "move_element", "add_wall", "update_wall", "add_opening", "update_opening",
             "delete_element"}
    if op not in valid:
        return None
    if op in ("update_furniture", "update_character", "update_wall", "update_opening",
              "move_element", "delete_element"):
        if not a.get("id"):
            return None
    if op in ("add_furniture", "update_furniture") and a.get("type") == "furniture":
        pass
    return a
