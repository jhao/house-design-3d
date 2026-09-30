"""CAD/线框导入、一键缩放、房间识别、图片上传。"""
import os
import time
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from .. import db
from ..cad_parser import import_bytes_to_scene, import_to_scene
from ..scene import normalize_scene, scale_scene, compute_areas
from .. import rooms as rooms_mod
from ..config import UPLOAD_DIR
from ..schemas import ScaleRequest

router = APIRouter(prefix="/api", tags=["floorplan"])


@router.post("/import")
async def import_new_project(
    name: str = Form("导入的房型"),
    file: UploadFile = File(None),
    json_body: str = Form(None),
    hint: str = Form(""),
):
    """新建项目：支持 DXF / JSON 线框，以及 JPG/PNG/PDF/DWG（走多模态大模型识别）。"""
    if file is not None:
        raw = await file.read()
        fname = file.filename or ""
        try:
            scene = import_bytes_to_scene(raw, fname, hint or "")
        except RuntimeError as e:
            raise HTTPException(400, str(e))
    elif json_body:
        scene = import_to_scene(json_body, "wireframe.json")
    else:
        raise HTTPException(400, "请上传文件或提供 json_body")
    return db.create_project(name, scene)


@router.post("/projects/{pid}/import")
async def import_into_project(pid: int, file: UploadFile = File(...), hint: str = Form("")):
    """把图纸导入到已有项目（覆盖场景）。"""
    if not db.get_project(pid):
        raise HTTPException(404, "项目不存在")
    raw = await file.read()
    try:
        scene = import_bytes_to_scene(raw, file.filename or "", hint or "")
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return db.update_project(pid, scene)


@router.post("/projects/{pid}/scale")
def scale(pid: int, body: ScaleRequest):
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    scene = scale_scene(p["scene"], body.ratio)
    return db.update_project(pid, scene)


@router.post("/projects/{pid}/detect_rooms")
def detect_rooms(pid: int):
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    scene = p["scene"]
    scene["rooms"] = rooms_mod.detect_rooms(scene.get("walls", []))
    scene = normalize_scene(scene)
    return db.update_project(pid, scene)


@router.post("/projects/{pid}/areas")
def areas(pid: int):
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    return compute_areas(p["scene"])


@router.post("/upload_image")
async def upload_image(file: UploadFile = File(...)):
    """上传现实场地图片，返回可放入场景的 URL（家具 type=image）。"""
    ext = os.path.splitext(file.filename or "img.png")[1] or ".png"
    fname = f"img{int(time.time() * 1000)}{ext}"
    path = os.path.join(UPLOAD_DIR, fname)
    with open(path, "wb") as f:
        f.write(await file.read())
    return {"url": f"/uploads/{fname}"}
