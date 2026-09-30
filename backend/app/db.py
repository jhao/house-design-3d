"""SQLite 数据访问层（自用小工具，原生 sqlite3，场景整体存为 JSON）。"""
import json
import os
import sqlite3
import time
from pathlib import Path
from .config import DB_PATH, UPLOAD_DIR


def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            scene TEXT NOT NULL
        )
        """
    )
    # 系统设置（key -> JSON 文本）
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    # 大模型调用日志
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS llm_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL NOT NULL,
            kind TEXT,
            model TEXT,
            filename TEXT,
            status TEXT,
            http INTEGER,
            duration_ms INTEGER,
            error TEXT,
            prompt_len INTEGER,
            reply_preview TEXT
        )
        """
    )
    conn.commit()
    conn.close()


def now():
    return time.time()


def create_project(name: str, scene: dict) -> dict:
    import json

    t = now()
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO projects (name, created_at, updated_at, scene) VALUES (?,?,?,?)",
        (name, t, t, json.dumps(scene, ensure_ascii=False)),
    )
    pid = cur.lastrowid
    conn.commit()
    conn.close()
    return get_project(pid)


def get_project(pid: int) -> dict:
    import json

    conn = get_conn()
    row = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        return None
    return _row_to_dict(row)


def list_projects() -> list:
    import json

    conn = get_conn()
    rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def update_project(pid: int, scene: dict) -> dict:
    import json

    conn = get_conn()
    conn.execute(
        "UPDATE projects SET scene=?, updated_at=? WHERE id=?",
        (json.dumps(scene, ensure_ascii=False), now(), pid),
    )
    conn.commit()
    conn.close()
    return get_project(pid)


def rename_project(pid: int, name: str) -> dict:
    conn = get_conn()
    conn.execute("UPDATE projects SET name=?, updated_at=? WHERE id=?", (name, now(), pid))
    conn.commit()
    conn.close()
    return get_project(pid)


def delete_project(pid: int):
    conn = get_conn()
    conn.execute("DELETE FROM projects WHERE id=?", (pid,))
    conn.commit()
    conn.close()


def _row_to_dict(row):
    import json

    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "scene": json.loads(row["scene"]),
    }


# ---------------- 系统设置（key -> JSON） ----------------

def get_setting(key, default=None):
    conn = get_conn()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except Exception:
        return default


def set_setting(key, value):
    conn = get_conn()
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        (key, json.dumps(value, ensure_ascii=False), now()),
    )
    conn.commit()
    conn.close()


def delete_setting(key):
    conn = get_conn()
    conn.execute("DELETE FROM settings WHERE key=?", (key,))
    conn.commit()
    conn.close()


def all_settings():
    conn = get_conn()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    out = {}
    for r in rows:
        try:
            out[r["key"]] = json.loads(r["value"])
        except Exception:
            pass
    return out


# ---------------- 大模型调用日志 ----------------

def add_llm_log(kind, model, filename, status, http=0, duration_ms=0, error="",
                prompt_len=0, reply_preview=""):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO llm_logs (ts, kind, model, filename, status, http, duration_ms, error, prompt_len, reply_preview) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (now(), kind, model or "", filename or "", status, int(http or 0),
         int(duration_ms or 0), error or "", int(prompt_len or 0), reply_preview or ""),
    )
    # 只保留最近 500 条，避免无限增长
    try:
        max_id = conn.execute("SELECT MAX(id) FROM llm_logs").fetchone()[0] or 0
        if max_id > 500:
            conn.execute("DELETE FROM llm_logs WHERE id <= ?", (max_id - 500,))
    except Exception:
        pass
    conn.commit()
    conn.close()


def list_llm_logs(limit=100):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM llm_logs ORDER BY id DESC LIMIT ?", (int(limit or 100),)
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"], "ts": r["ts"], "kind": r["kind"], "model": r["model"],
            "filename": r["filename"], "status": r["status"], "http": r["http"],
            "duration_ms": r["duration_ms"], "error": r["error"],
            "prompt_len": r["prompt_len"], "reply_preview": r["reply_preview"],
        }
        for r in rows
    ]


def clear_llm_logs():
    conn = get_conn()
    conn.execute("DELETE FROM llm_logs")
    conn.commit()
    conn.close()


# ---------------- 数据库存储统计 ----------------

def _human_size(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024


def _dir_size(path):
    total = 0
    count = 0
    p = Path(path)
    if not p.exists():
        return 0, 0
    for f in p.rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
                count += 1
            except OSError:
                pass
    return total, count


def db_stats():
    """数据库与上传目录的存储概况（供系统设置页展示）。"""
    db_size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    up_size, up_count = _dir_size(UPLOAD_DIR)

    conn = get_conn()
    tables = []
    try:
        names = [r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
        for name in names:
            rows = conn.execute(f'SELECT COUNT(*) AS c FROM "{name}"').fetchone()["c"]
            tables.append({"name": name, "rows": rows})
    except Exception:
        pass

    projects = []
    total_scene_bytes = 0
    try:
        rows = conn.execute(
            "SELECT id, name, created_at, updated_at, LENGTH(scene) AS scene_bytes "
            "FROM projects ORDER BY updated_at DESC LIMIT 20"
        ).fetchall()
        for r in rows:
            b = r["scene_bytes"] or 0
            total_scene_bytes += b
            projects.append({
                "id": r["id"], "name": r["name"],
                "created_at": r["created_at"], "updated_at": r["updated_at"],
                "scene_bytes": b, "scene_size": _human_size(b),
            })
    except Exception:
        pass
    conn.close()

    return {
        "db_path": str(DB_PATH),
        "db_size": db_size,
        "db_size_human": _human_size(db_size),
        "tables": tables,
        "projects_count": len(projects),
        "scene_bytes_total": total_scene_bytes,
        "scene_size_total": _human_size(total_scene_bytes),
        "projects": projects,
        "upload_dir": str(UPLOAD_DIR),
        "upload_count": up_count,
        "upload_size": up_size,
        "upload_size_human": _human_size(up_size),
        "disk_free": _human_size(_shutil_disk_free()),
    }


def _shutil_disk_free():
    try:
        import shutil
        return shutil.disk_usage(str(DB_PATH.parent)).free
    except Exception:
        return 0
