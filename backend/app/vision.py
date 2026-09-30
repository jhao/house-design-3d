"""多模态大模型图纸识别。

把 JPG/PNG/PDF/DWG(需外部转换) 的房型图交给视觉大模型，
按提示词要求返回结构化 JSON，再转换成平台内部的 scene 数据。

接口协议：OpenAI 兼容的 /chat/completions（messages 里带 image_url）。
因此 OpenAI、通义千问 VL、智谱 GLM-4V、豆包、Ollama(LLaVA) 等均可直接填写使用。
"""
import base64
import json
import math
import os
import re
import shutil
import subprocess
import tempfile

import httpx

from .catalog import WALL_KIND_THICKNESS
from .scene import empty_scene, normalize_scene, _uid
from .settings import get_llm_config, active_recognition_prompt, log_llm_call

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff")
MIME_MAP = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif",
    ".tif": "image/tiff", ".tiff": "image/tiff",
}

# DWG 版本标识（文件头前 6 字节）
DWG_MAGICS = ("AC1015", "AC1018", "AC1021", "AC1024", "AC1027", "AC1032")



# ---------------- 文件 → 图片 ----------------

def _ext_of(filename):
    return os.path.splitext((filename or "").lower())[1]


def _sniff(data):
    """按魔术字节判断真实类型，返回扩展名（含点）。"""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:2] == b"BM":
        return ".bmp"
    if data[:4] == b"%PDF":
        return ".pdf"
    if data[:6] in (m.encode() for m in DWG_MAGICS):
        return ".dwg"
    if data[:4] == b"GIF8":
        return ".gif"
    return ""


def _pdf_to_png(data):
    """PDF 首页转 PNG。优先 PyMuPDF，失败则提示。"""
    try:
        import fitz  # PyMuPDF
    except Exception:
        raise RuntimeError(
            "PDF 需要转换为图片后才能识别。请直接上传 JPG/PNG，"
            "或在系统设置里安装 PyMuPDF（pip install pymupdf）后重试。"
        )
    doc = fitz.open(stream=data, filetype="pdf")
    page = doc.load_page(0)
    pix = page.get_pixmap(dpi=200)
    out = pix.tobytes("png")
    doc.close()
    return out


def _dwg_to_png(data, filename):
    """DWG 转图片：需要用户在系统设置里配置转换命令模板（含 {in} 与 {out}）。
    例如：
      dwg2dxf 后自行转图：  dwg2dxf {in} {out}.dxf
      LibreCAD 无头导出：    librecad-cli {in} --outfile {out}
    """
    cfg = get_llm_config()
    tpl = (cfg.get("dwg_converter") or "").strip()
    if not tpl:
        raise RuntimeError(
            "DWG 是二进制专有格式，无法直接送给大模型识别。\n"
            "请选择其中一种方式：\n"
            "1) 用 AutoCAD / 浩辰 CAD / 在线转换工具把 DWG 另存为 JPG 或 PNG 后再上传；\n"
            "2) 在【系统设置 → 多模态大模型】里填写「DWG 转换命令」，"
            "例如 dwg2dxf {in} {out}.dxf（命令需能输出图片）。"
        )
    tmpdir = tempfile.mkdtemp(prefix="dwg_")
    try:
        src = os.path.join(tmpdir, "in" + (_ext_of(filename) or ".dwg"))
        with open(src, "wb") as f:
            f.write(data)
        dst = os.path.join(tmpdir, "out.png")
        cmd = tpl.replace("{in}", f'"{src}"').replace("{out}", f'"{dst}"')
        proc = subprocess.run(cmd, shell=True, capture_output=True, timeout=180)
        if proc.returncode != 0:
            raise RuntimeError(
                "DWG 转换命令执行失败（退出码 %s）：%s"
                % (proc.returncode, (proc.stderr or proc.stdout or b"").decode("utf-8", "ignore")[:300])
            )
        # 找产物：优先 out.png，其次任意图片
        cands = [dst] + [os.path.join(tmpdir, n) for n in sorted(os.listdir(tmpdir))]
        for c in cands:
            if not os.path.isfile(c):
                continue
            with open(c, "rb") as f:
                blob = f.read()
            ext = _sniff(blob) or _ext_of(c)
            if ext in IMAGE_EXTS:
                return blob, MIME_MAP.get(ext, "image/png")
        raise RuntimeError("DWG 转换命令未产出可识别的图片，请检查命令配置。")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def prepare_image(data: bytes, filename: str = ""):
    """把上传内容统一成 (图片字节, mime)。"""
    ext = _ext_of(filename)
    if not ext or ext not in IMAGE_EXTS + (".pdf", ".dwg", ".dxf"):
        ext = _sniff(data) or ext
    if ext in IMAGE_EXTS:
        return data, MIME_MAP.get(ext, "image/png")
    if ext == ".pdf":
        return _pdf_to_png(data), "image/png"
    if ext == ".dwg":
        return _dwg_to_png(data, filename)
    if ext == ".dxf":
        raise RuntimeError(
            "DXF 是文本格式，已按 CAD 线框直接解析（不经过大模型）。"
            "若想用大模型识别，请先导出为 JPG/PNG 上传。"
        )
    # 兜底：看起来像图片就按图片处理
    sniffed = _sniff(data)
    if sniffed in IMAGE_EXTS:
        return data, MIME_MAP.get(sniffed, "image/png")
    raise RuntimeError(f"无法识别的文件类型：{filename or '未知'}，请上传 JPG / PNG / PDF / DWG。")


def is_vision_candidate(filename: str) -> bool:
    """是否应交给大模型识别（图片类）。"""
    return _ext_of(filename) in IMAGE_EXTS + (".pdf", ".dwg")


# ---------------- 图片归一化（关键：避免 400 与空返回） ----------------

# 部分视觉大模型只接受 png / jpeg / webp / gif；
# 我们还会把超大图缩放，避免接口静默返回空内容。
# 注意：deepseek-flash 等模型对「图片 token + 提示词 token」总量较敏感，
# 图片过大或提示词过长都可能静默返回空 content，故尺寸控制在 1280 且提示词从简。
_MAX_SIDE = 1280


def _normalize_image_for_vision(data: bytes, mime: str, filename: str = ""):
    """把任意图片统一成 API 支持的格式（png / jpeg）并限制最长边，
    从源头消除两类问题：
      ① 上传 bmp / tiff / 异常 webp 等 → 接口报 "unsupported image" 400；
      ② 图片过大 → 接口可能静默返回空 content。
    无 Pillow 或解码失败时，退化为原样发送（让上层报更清晰错误）。
    """
    try:
        from PIL import Image, ImageOps
        import io
    except Exception:
        return data, mime

    cfg = get_llm_config()
    model = cfg.get("vision_model") or cfg.get("model") or ""

    try:
        im = Image.open(io.BytesIO(data))
        im.load()  # 触发完整解码，尽早暴露损坏/不支持的文件
    except Exception as e:
        log_llm_call("图纸识别", model, filename, "error", 0, 0,
                     f"图片解码失败（可能损坏或格式不支持）：{e}", 0, "")
        # 解码失败时不强制改写，仍按原 mime 发送，交由接口给明确错误
        return data, mime

    # 按 EXIF 方向摆正（手机拍照图常见）
    try:
        im = ImageOps.exif_transpose(im)
    except Exception:
        pass

    # 超尺寸则等比缩放，最长边不超过 _MAX_SIDE
    w, h = im.size
    if max(w, h) > _MAX_SIDE:
        scale = _MAX_SIDE / float(max(w, h))
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    out = io.BytesIO()
    if has_alpha:
        im = im.convert("RGBA")
        im.save(out, format="PNG")
        return out.getvalue(), "image/png"
    im = im.convert("RGB")
    im.save(out, format="JPEG", quality=90)
    return out.getvalue(), "image/jpeg"


# ---------------- 调用视觉大模型 ----------------

def _data_url(data: bytes, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def _repair_json(s: str) -> str:
    """尽力补全被截断的 JSON（补上未闭合的 {} / []，砍掉残缺的尾部字段）。

    推理型模型输出超预算时，JSON 常被中途截断；补全后往往仍可用。
    """
    stack, in_str, esc = [], False, False
    for ch in s:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]" and stack:
            stack.pop()
    if not stack and not in_str:
        return s
    out = s
    if in_str:                      # 截断在字符串中间 → 砍掉最后一段残缺内容
        k = max(out.rfind(","), out.rfind("{"), out.rfind("["))
        if k > 0:
            out = out[:k]
            # 重算未闭合栈
            stack, in_str, esc = [], False, False
            for ch in out:
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                    continue
                if ch == '"':
                    in_str = True
                elif ch in "{[":
                    stack.append(ch)
                elif ch in "}]" and stack:
                    stack.pop()
    out = out.rstrip().rstrip(",")
    for ch in reversed(stack):
        out += "}" if ch == "{" else "]"
    return out


def _extract_json(text):
    if not text:
        raise RuntimeError("大模型返回内容为空")
    s = text.strip()
    # 去掉 ```json ... ``` 代码围栏
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)

    candidates = [s]
    i, j = s.find("{"), s.rfind("}")
    if i >= 0 and j > i:
        candidates.append(s[i:j + 1])
    for base in list(candidates):        # 被截断的 JSON：补全括号后再试
        rep = _repair_json(base)
        if rep and rep not in candidates:
            candidates.append(rep)

    last_err = None
    for c in candidates:
        try:
            return json.loads(c)
        except Exception as e:
            last_err = e
    raise RuntimeError(f"大模型返回的不是合法 JSON（{last_err}）：\n{s[:300]}")


def call_vision(data_url: str, hint: str = "", filename: str = "", kind: str = "图纸识别"):
    """调用视觉大模型，返回 (解析后的 dict, 原始文本)。每次调用都会写日志。"""
    import time as _time

    cfg = get_llm_config()
    if not cfg.get("enabled", True):
        log_llm_call(kind, cfg.get("model", ""), filename, "error", 0, 0,
                     "未启用大模型识别（系统设置中已关闭）", 0, "")
        raise RuntimeError("系统设置中未启用大模型识别，请先在【系统设置】开启。")
    base = (cfg.get("base_url") or "").strip().rstrip("/")
    key = (cfg.get("api_key") or "").strip()
    model = (cfg.get("vision_model") or cfg.get("model") or "").strip()
    if not base:
        log_llm_call(kind, model, filename, "error", 0, 0, "未配置接口地址 Base URL", 0, "")
        raise RuntimeError("未配置大模型接口地址（Base URL），请到【系统设置】填写。")
    if not key:
        log_llm_call(kind, model, filename, "error", 0, 0, "未配置 API Key", 0, "")
        raise RuntimeError("未配置大模型 API Key，请到【系统设置】填写。")
    if not model:
        log_llm_call(kind, model, filename, "error", 0, 0, "未配置模型名称", 0, "")
        raise RuntimeError("未配置大模型名称，请到【系统设置】填写。")

    prompt = active_recognition_prompt() + (f"\n\n【用户对本次识别的补充要求】\n{hint}" if hint else "")
    payload = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }],
        "temperature": 0.1,
    }

    # ── 输出预算 ──────────────────────────────────────────────────────────
    # 关键：deepseek-flash / deepseek-reasoner 等**推理型**模型会先输出一大段
    # reasoning_content（思维链），思考结束后才在 content 里给出正式答案。
    # 若 max_tokens 太小，预算会被思考过程耗尽 → finish_reason="length" 且
    # content 为空（HTTP 仍为 200）。因此这里：① 默认给足预算；
    # ② 被截断时自动加码重试；③ 服务商拒绝该预算时自动降级。
    try:
        _base_max = int(cfg.get("max_tokens") or 0)
    except (TypeError, ValueError):
        _base_max = 0
    if _base_max < 2048:
        _base_max = 16000
    budgets, _seen = [], set()
    for _b in (_base_max, _base_max * 2, 8000, 4096):
        _b = int(_b)
        if _b >= 1024 and _b not in _seen and len(budgets) < 3:
            _seen.add(_b)
            budgets.append(_b)

    content = None
    reasoning = None
    finish_reason = None
    raw = ""
    ms = 0
    http = 200
    last_diag = ""
    used_budget = budgets[0]
    budget_cap = None          # 服务商拒绝某预算时记录上限，不再尝试更大的预算

    for mt in budgets:
        if budget_cap is not None and mt > budget_cap:
            continue
        used_budget = mt
        payload["max_tokens"] = mt
        t0 = _time.time()
        try:
            resp = httpx.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
                timeout=float(cfg.get("timeout") or 300),
            )
        except Exception as e:
            ems = int((_time.time() - t0) * 1000)
            log_llm_call(kind, model, filename, "error", 0, ems, f"无法连接大模型接口（{base}）：{e}",
                         len(prompt), "")
            raise RuntimeError(f"无法连接大模型接口（{base}）：{e}")

        ms = int((_time.time() - t0) * 1000)
        http = resp.status_code
        if http == 401:
            log_llm_call(kind, model, filename, "error", http, ms, "大模型返回 401：API Key 无效或已过期",
                         len(prompt), "")
            raise RuntimeError("大模型返回 401：API Key 无效或已过期。")
        if http == 404:
            log_llm_call(kind, model, filename, "error", http, ms, "大模型返回 404：接口地址或模型名不正确",
                         len(prompt), "")
            raise RuntimeError("大模型返回 404：接口地址或模型名不正确。")
        if http >= 400:
            body = (resp.text or "")[:300]
            low = body.lower()
            # 服务商不支持这么大的 max_tokens（上限更低）→ 降级重试，而不是直接失败
            if ("max_tokens" in low or "maximum" in low or "too large" in low) and mt > 4096:
                budget_cap = mt - 1
                log_llm_call(kind, model, filename, "error", http, ms,
                             f"接口不接受 max_tokens={mt}，将降级重试：{body[:160]}", len(prompt), "")
                continue
            log_llm_call(kind, model, filename, "error", http, ms, f"大模型返回 {http}：{body[:200]}",
                         len(prompt), "")
            raise RuntimeError(f"大模型返回 {http}：{body[:300]}")

        raw = resp.text
        try:
            _j = resp.json()
            _ch = (_j.get("choices") or [{}])[0] or {}
            _msg = _ch.get("message", {}) or {}
            content = _msg.get("content")
            reasoning = _msg.get("reasoning_content")
            finish_reason = _ch.get("finish_reason")
        except Exception:
            log_llm_call(kind, model, filename, "error", http, ms, f"大模型返回结构异常：{raw[:200]}",
                         len(prompt), raw[:400])
            raise RuntimeError(f"大模型返回结构异常：{raw[:300]}")

        c = (content or "").strip()
        if c:
            try:
                parsed = _extract_json(c)
            except RuntimeError as e:
                if finish_reason == "length":
                    # JSON 被截断（推理/输出超预算）→ 加码预算重试
                    last_diag = f"返回 JSON 被截断：{e}"
                    continue
                log_llm_call(kind, model, filename, "error", http, ms, str(e), len(prompt), c[:400])
                raise
            log_llm_call(kind, model, filename, "ok", http, ms, "", len(prompt),
                         c.replace("\n", " ")[:400])
            return parsed, c

        # content 为空：记录诊断
        rc = (reasoning or "").strip()
        last_diag = rc[:400] or raw[:400]
        if finish_reason == "length":
            # 推理预算被耗尽 → 直接尝试更大的预算
            continue
        # 其它空返回（瞬时过载/限流）→ 短暂退避后重试
        if mt != budgets[-1]:
            _time.sleep(2)

    # 所有预算都失败
    extra = ""
    if finish_reason == "length":
        extra = ("该模型是推理型（会先输出思考过程），本次思考耗尽了全部输出预算仍未给出正式答案。"
                 f"已尝试预算 max_tokens={budgets}。")
    log_llm_call(
        kind, model, filename, "error", http, ms,
        "大模型多次返回内容为空。" + extra +
        f"（最后 max_tokens={used_budget}，finish_reason={finish_reason}）原始返回：" + last_diag,
        len(prompt), last_diag,
    )
    raise RuntimeError(
        "大模型没有返回可用内容。\n"
        "排查建议：\n"
        "1) 若模型是推理型（如 deepseek-flash / deepseek-reasoner），它会先输出思考过程，"
        "输出预算不足时会「只思考、不回答」→ 请到【系统设置】把「最大输出 tokens」调大"
        f"（当前 {used_budget}，建议 16000 以上）；\n"
        "2) 图纸过于复杂/模糊时，可先裁剪出单个区域再识别；\n"
        "3) 确认【系统设置】里填的是支持图片的模型；\n"
        "4) 详见【系统设置 → 大模型调用日志】中的原始返回。"
    )


# ---------------- AI 结果 → scene ----------------

def _num(v, default=0.0):
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _wall_len(w):
    return math.hypot(w["x2"] - w["x1"], w["y2"] - w["y1"])


def _project(w, x, y):
    """把点投影到墙上，返回距起点的距离（沿墙方向，已 clamp）。"""
    dx, dy = w["x2"] - w["x1"], w["y2"] - w["y1"]
    L2 = dx * dx + dy * dy
    if L2 <= 0:
        return 0.0
    t = ((x - w["x1"]) * dx + (y - w["y1"]) * dy) / L2
    return max(0.0, min(1.0, t)) * math.sqrt(L2)


def _nearest_wall(walls, x, y):
    best, best_d = None, None
    for w in walls:
        d = abs(_project(w, x, y))
        mx = (w["x1"] + w["x2"]) / 2
        my = (w["y1"] + w["y2"]) / 2
        dist = math.hypot(x - mx, y - my)
        if best_d is None or dist < best_d:
            best, best_d = w, dist
    return best


def _walls_from_rooms(rooms):
    """兜底：只有房间多边形时，用房间边生成墙体（去重）。"""
    walls, seen = [], set()
    for r in rooms:
        pts = r.get("points") or []
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            if len(a) < 2 or len(b) < 2:
                continue
            x1, y1, x2, y2 = _num(a[0]), _num(a[1]), _num(b[0]), _num(b[1])
            if abs(x1 - x2) < 1 and abs(y1 - y2) < 1:
                continue
            key = tuple(sorted([(round(x1), round(y1)), (round(x2), round(y2))]))
            if key in seen:
                continue
            seen.add(key)
            walls.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2, "kind": "normal"})
    return walls


def scene_from_ai(data: dict):
    """把大模型返回的 JSON 转成平台 scene（未 normalize）。"""
    data = data if isinstance(data, dict) else {}
    scene = empty_scene()

    try:
        ch = _num(data.get("ceiling_height"), 0)
        if 1500 <= ch <= 6000:
            scene["ceiling_height"] = int(round(ch))
    except Exception:
        pass

    # 墙体
    walls = []
    for w in data.get("walls") or []:
        if not isinstance(w, dict):
            continue
        x1, y1 = _num(w.get("x1")), _num(w.get("y1"))
        x2, y2 = _num(w.get("x2")), _num(w.get("y2"))
        if abs(x1 - x2) < 1 and abs(y1 - y2) < 1:
            continue
        kind = str(w.get("kind") or "normal").lower()
        if kind not in WALL_KIND_THICKNESS:
            kind = "normal"
        wall = {
            "id": _uid("w"),
            "x1": round(x1, 1), "y1": round(y1, 1),
            "x2": round(x2, 1), "y2": round(y2, 1),
            "kind": kind,
        }
        walls.append(wall)

    # 房间（多边形）
    rooms = []
    for r in data.get("rooms") or []:
        if not isinstance(r, dict):
            continue
        pts = []
        for p in r.get("points") or []:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                pts.append([round(_num(p[0]), 1), round(_num(p[1]), 1)])
        if len(pts) >= 3:
            rooms.append({"id": _uid("r"), "name": str(r.get("name") or "房间"), "points": pts})
    scene["rooms"] = rooms

    # 墙体兜底：模型只给了房间
    if not walls and rooms:
        walls = _walls_from_rooms(rooms)
    scene["walls"] = walls

    # 门窗
    openings = []
    valid_dirs = {"left_in", "left_out", "right_in", "right_out", "double_in", "double_out"}
    for o in data.get("openings") or []:
        if not isinstance(o, dict):
            continue
        otype = "window" if str(o.get("type") or "").lower().startswith("win") else "door"
        wall = None
        idx = o.get("wall_index")
        try:
            idx = int(idx)
        except (TypeError, ValueError):
            idx = None
        if idx is not None and 0 <= idx < len(walls):
            wall = walls[idx]
        elif o.get("x") is not None and walls:
            wall = _nearest_wall(walls, _num(o.get("x")), _num(o.get("y")))
        if wall is None:
            continue

        width = _num(o.get("width"), 900 if otype == "door" else 1500)
        width = max(300, min(int(width), int(max(300, _wall_len(wall)))))
        height = _num(o.get("height"), 2100 if otype == "door" else 1500)
        height = max(400, min(int(height), int(scene["ceiling_height"])))
        offset = _num(o.get("offset"), None)
        if offset is None:
            offset = _project(wall, _num(o.get("x")), _num(o.get("y")))
        offset = max(0.0, min(float(offset), float(_wall_len(wall))))

        op = {
            "id": _uid("o"),
            "type": otype,
            "wall_id": wall["id"],
            "offset": round(offset, 1),
            "width": int(width),
            "height": int(height),
        }
        if otype == "window":
            sill = _num(o.get("sill"), 900)
            op["sill"] = int(max(0, min(sill, height - 100)))
        else:
            d = str(o.get("dir") or "left_in").lower()
            op["dir"] = d if d in valid_dirs else "left_in"
        openings.append(op)
    scene["openings"] = openings

    # 家具（可选）
    furn = []
    for f in data.get("furniture") or []:
        if not isinstance(f, dict):
            continue
        ftype = str(f.get("type") or "").strip()
        if not ftype:
            continue
        rot = _num(f.get("rotation"), 0)
        furn.append({
            "id": _uid("f"),
            "type": ftype,
            "x": round(_num(f.get("x")), 1),
            "y": round(_num(f.get("y")), 1),
            "rotation": int(round(rot / 90.0)) * 90 % 360,
        })
    scene["furniture"] = furn

    return scene


def recognize_floorplan(data: bytes, filename: str = "", hint: str = ""):
    """入口：图片 → 大模型 → 规范化 scene。"""
    img, mime = prepare_image(data, filename)
    # 关键：统一成接口支持的 png/jpeg 并限制尺寸，避免 400 / 空返回
    img, mime = _normalize_image_for_vision(img, mime, filename)
    parsed, _raw = call_vision(_data_url(img, mime), hint, filename, "图纸识别")
    scene = scene_from_ai(parsed)
    return normalize_scene(scene), parsed
