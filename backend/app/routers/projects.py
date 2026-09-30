"""项目 CRUD + 复制。"""
from fastapi import APIRouter, HTTPException
from .. import db
from ..scene import normalize_scene, empty_scene
from ..schemas import ProjectCreate, ProjectUpdate, ProjectRename

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
def list_projects():
    return db.list_projects()


@router.post("")
def create_project(body: ProjectCreate):
    scene = normalize_scene(body.scene or empty_scene())
    return db.create_project(body.name, scene)


@router.get("/{pid}")
def get_project(pid: int):
    p = db.get_project(pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


@router.put("/{pid}")
def update_project(pid: int, body: ProjectUpdate):
    if not db.get_project(pid):
        raise HTTPException(404, "项目不存在")
    return db.update_project(pid, body.scene)


@router.patch("/{pid}/rename")
def rename(pid: int, body: ProjectRename):
    if not db.get_project(pid):
        raise HTTPException(404, "项目不存在")
    return db.rename_project(pid, body.name)


@router.delete("/{pid}")
def delete(pid: int):
    db.delete_project(pid)
    return {"ok": True}


@router.post("/{pid}/copy")
def copy_project(pid: int):
    src = db.get_project(pid)
    if not src:
        raise HTTPException(404, "源项目不存在")
    return db.create_project(f"{src['name']} 副本", src["scene"])
