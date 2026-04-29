"""SYSTEM module — admin, sysinfo, settings, users, backup status.

Sprint 18: persisted to SQLite (tables: users, settings, backup_job).
Sub-screens: I(info) U(users) S(settings) B(backup)
API prefix: /api/x/
"""
from __future__ import annotations
import os, time, platform
from server.db import get_db, reset_tables

# ── sysinfo ────────────────────────────────────────────────────────────────
def sysinfo() -> dict:
    import sys
    uname = platform.uname()
    try:
        uptime_s = int(float(open("/proc/uptime").read().split()[0]))
    except Exception:
        uptime_s = None
    try:
        load = list(os.getloadavg())
    except AttributeError:
        load = [0.0, 0.0, 0.0]
    try:
        st = os.statvfs("/")
        disk = {"total_gb": round(st.f_blocks * st.f_frsize / 1e9, 1),
                "free_gb":  round(st.f_bfree  * st.f_frsize / 1e9, 1)}
    except Exception:
        disk = {"total_gb": 0.0, "free_gb": 0.0}
    return {
        "node":      uname.node or "overseer",
        "os":        f"{uname.system} {uname.release}",
        "arch":      uname.machine,
        "python":    sys.version.split()[0],
        "cpu_cores": os.cpu_count() or 1,
        "load_1m":   round(load[0], 2),
        "uptime_s":  uptime_s,
        "disk":      disk,
        "at":        time.time(),
    }

# ── users ──────────────────────────────────────────────────────────────────
def _row_to_user(row) -> dict:
    return {"uid": row["callsign"], "callsign": row["callsign"],
            "role": row["role"], "active": bool(row["active"]),
            "last_seen": row["last_seen"]}

def users_list() -> list[dict]:
    db = get_db()
    _ensure_seed_users(db)
    return [_row_to_user(r) for r in db.execute(
        "SELECT callsign, role, active, last_seen FROM users ORDER BY callsign")]

def user_add(uid: str, callsign: str, role: str = "observer") -> dict:
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO users(callsign, role, active) VALUES (?,?,1)",
        (callsign, role))
    db.commit()
    row = db.execute("SELECT callsign,role,active,last_seen FROM users WHERE callsign=?",
                     (callsign,)).fetchone()
    return _row_to_user(row)

def user_remove(uid: str) -> dict:
    db = get_db()
    cur = db.execute("DELETE FROM users WHERE callsign=?", (uid,))
    db.commit()
    return {"ok": cur.rowcount > 0, "uid": uid}

def _ensure_seed_users(db) -> None:
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        now = time.time()
        db.executemany(
            "INSERT OR IGNORE INTO users(callsign,role,last_seen,active) VALUES(?,?,?,?)",
            [("ALPHA-1",   "admin",    now - 120,  1),
             ("BRAVO-2",   "operator", now - 3600, 1),
             ("CHARLIE-7", "observer", None,        0)])
        db.commit()

# ── settings ───────────────────────────────────────────────────────────────
def settings_get_all() -> dict:
    db = get_db()
    return {r["key"]: r["value"] for r in db.execute("SELECT key,value FROM settings")}

def settings_set(key: str, value: str) -> dict:
    db = get_db()
    db.execute("INSERT OR REPLACE INTO settings(key,value,updated_at) "
               "VALUES(?,?,strftime('%s','now'))", (key, str(value)))
    db.commit()
    return {"key": key, "value": str(value)}

# ── backup ─────────────────────────────────────────────────────────────────
def _row_to_backup(row) -> dict:
    return {"id": row["id"], "target": row["name"], "path": row["dest"],
            "status": row["status"], "size_mb": row["size_mb"],
            "at": row["last_run"]}

def backup_status() -> list[dict]:
    db = get_db()
    _ensure_seed_backups(db)
    return [_row_to_backup(r) for r in db.execute(
        "SELECT id,name,dest,status,size_mb,last_run FROM backup_job ORDER BY id")]

def backup_trigger(target_id: int) -> dict:
    db = get_db()
    _ensure_seed_backups(db)
    now = int(time.time())
    cur = db.execute(
        "UPDATE backup_job SET status='pending', last_run=? WHERE id=?",
        (now, target_id))
    db.commit()
    if cur.rowcount == 0:
        return {"ok": False, "error": "job not found"}
    row = db.execute("SELECT id,name,dest,status,size_mb,last_run FROM backup_job WHERE id=?",
                     (target_id,)).fetchone()
    return {"ok": True, "job": _row_to_backup(row)}

def _ensure_seed_backups(db) -> None:
    if db.execute("SELECT COUNT(*) FROM backup_job").fetchone()[0] == 0:
        now = int(time.time())
        db.executemany(
            "INSERT OR IGNORE INTO backup_job(id,name,dest,status,size_mb,last_run) "
            "VALUES(?,?,?,?,?,?)",
            [(1, "Full DB",   "/mnt/usb0/overseer/db.tar.gz",     "ok",      82.4, now-7200),
             (2, "Config",    "/mnt/usb0/overseer/config.tar.gz", "ok",       1.2, now-7200),
             (3, "Knowledge", "/mnt/usb0/overseer/know.tar.gz",   "pending",  0.0, now-60)])
        db.commit()

# ── test reset ─────────────────────────────────────────────────────────────
def reset_for_tests() -> None:
    reset_tables("users", "backup_job")
    db = get_db()
    # Re-seed users with stable entries
    now = time.time()
    db.executemany(
        "INSERT OR IGNORE INTO users(callsign,role,last_seen,active) VALUES(?,?,?,?)",
        [("ALPHA-1",   "admin",    now - 120,  1),
         ("BRAVO-2",   "operator", now - 3600, 1),
         ("CHARLIE-7", "observer", None,        0)])
    # Re-seed backup jobs with explicit IDs
    now_i = int(now)
    db.executemany(
        "INSERT OR IGNORE INTO backup_job(id,name,dest,status,size_mb,last_run) VALUES(?,?,?,?,?,?)",
        [(1, "Full DB",   "/mnt/usb0/overseer/db.tar.gz",     "ok",      82.4, now_i-7200),
         (2, "Config",    "/mnt/usb0/overseer/config.tar.gz", "ok",       1.2, now_i-7200),
         (3, "Knowledge", "/mnt/usb0/overseer/know.tar.gz",   "pending",  0.0, now_i-60)])
    # Re-insert default settings
    db.execute("DELETE FROM settings")
    db.executemany("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", [
        ("callsign","ALPHA-1"),("grid_ref","IO91wm"),("tz","UTC"),
        ("mesh_freq","433.175"),("day_zero","2024-01-05"),
        ("log_level","info"),("backup_path","/mnt/usb0/overseer"),("theme","dark")])
    db.commit()

# ── Flask routes ───────────────────────────────────────────────────────────
def register(app):
    from flask import jsonify, request

    @app.route("/api/x/info")
    def _info():
        return jsonify(sysinfo())

    @app.route("/api/x/users", methods=["GET"])
    def _users_list():
        return jsonify({"users": users_list()})

    @app.route("/api/x/users", methods=["POST"])
    def _user_add():
        d = request.json or {}
        return jsonify(user_add(d.get("uid",""), d.get("callsign",""), d.get("role","observer")))

    @app.route("/api/x/users/<uid>", methods=["DELETE"])
    def _user_remove(uid):
        return jsonify(user_remove(uid))

    @app.route("/api/x/settings", methods=["GET"])
    def _settings_all():
        return jsonify({"settings": settings_get_all()})

    @app.route("/api/x/settings", methods=["POST"])
    def _settings_set():
        d = request.json or {}
        return jsonify(settings_set(d.get("key",""), str(d.get("value",""))))

    @app.route("/api/x/backup", methods=["GET"])
    def _backup_status():
        return jsonify({"jobs": backup_status()})

    @app.route("/api/x/backup/trigger", methods=["POST"])
    def _backup_trigger():
        jid = int((request.json or {}).get("id", 0))
        return jsonify(backup_trigger(jid))

# -- end of module - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

