"""Tests for SYSTEM module — Sprint 17.

Gate: sysinfo, users CRUD, settings CRUD, backup list + trigger, Flask routes.
"""
import pytest


# ─── Setup ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset():
    from server.modules import system_
    system_.reset_for_tests()
    yield
    system_.reset_for_tests()


@pytest.fixture
def client():
    from server.app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ─── Sysinfo ──────────────────────────────────────────────────────────────

class TestSysinfo:
    def test_returns_dict(self):
        from server.modules.system_ import sysinfo
        s = sysinfo()
        assert isinstance(s, dict)

    def test_has_required_keys(self):
        from server.modules.system_ import sysinfo
        s = sysinfo()
        for key in ("node", "os", "arch", "python", "cpu_cores", "load_1m", "disk", "at"):
            assert key in s, f"missing key: {key}"

    def test_uptime_s_present(self):
        from server.modules.system_ import sysinfo
        s = sysinfo()
        assert "uptime_s" in s

    def test_disk_has_total_and_free(self):
        from server.modules.system_ import sysinfo
        d = sysinfo()["disk"]
        assert "total_gb" in d and "free_gb" in d

    def test_node_is_string(self):
        from server.modules.system_ import sysinfo
        assert isinstance(sysinfo()["node"], str)
        assert len(sysinfo()["node"]) > 0


# ─── Users ────────────────────────────────────────────────────────────────

class TestUsers:
    def test_list_returns_seeded_users(self):
        from server.modules.system_ import users_list
        ul = users_list()
        assert len(ul) >= 1

    def test_user_has_required_fields(self):
        from server.modules.system_ import users_list
        u = users_list()[0]
        for f in ("uid", "callsign", "role", "active"):
            assert f in u

    def test_seeded_has_admin(self):
        from server.modules.system_ import users_list
        roles = {u["role"] for u in users_list()}
        assert "admin" in roles

    def test_add_user(self):
        from server.modules.system_ import users_list, user_add
        before = len(users_list())
        user_add("TEST-9", "TEST-9", "observer")
        assert len(users_list()) == before + 1

    def test_add_user_returns_entry(self):
        from server.modules.system_ import user_add
        u = user_add("DELTA-4", "DELTA-4", "operator")
        assert u["uid"] == "DELTA-4"
        assert u["role"] == "operator"

    def test_remove_user(self):
        from server.modules.system_ import users_list, user_add, user_remove
        user_add("TEMP-1", "TEMP-1", "observer")
        before = len(users_list())
        result = user_remove("TEMP-1")
        assert result["ok"] is True
        assert len(users_list()) == before - 1

    def test_remove_nonexistent_returns_ok_false(self):
        from server.modules.system_ import user_remove
        result = user_remove("NOBODY-99")
        assert result["ok"] is False


# ─── Settings ─────────────────────────────────────────────────────────────

class TestSettings:
    def test_returns_dict(self):
        from server.modules.system_ import settings_get_all
        s = settings_get_all()
        assert isinstance(s, dict)

    def test_has_seeded_keys(self):
        from server.modules.system_ import settings_get_all
        s = settings_get_all()
        assert "callsign" in s and "tz" in s

    def test_set_new_key(self):
        from server.modules.system_ import settings_set, settings_get_all
        settings_set("new_key", "new_val")
        assert settings_get_all()["new_key"] == "new_val"

    def test_overwrite_existing(self):
        from server.modules.system_ import settings_set, settings_get_all
        settings_set("tz", "Europe/London")
        assert settings_get_all()["tz"] == "Europe/London"

    def test_set_returns_kv(self):
        from server.modules.system_ import settings_set
        r = settings_set("foo", "bar")
        assert r["key"] == "foo" and r["value"] == "bar"


# ─── Backup ───────────────────────────────────────────────────────────────

class TestBackup:
    def test_list_returns_jobs(self):
        from server.modules.system_ import backup_status
        bl = backup_status()
        assert isinstance(bl, list)
        assert len(bl) >= 1

    def test_job_has_fields(self):
        from server.modules.system_ import backup_status
        j = backup_status()[0]
        for f in ("id", "target", "path", "status", "size_mb", "at"):
            assert f in j

    def test_trigger_returns_ok(self):
        from server.modules.system_ import backup_trigger
        result = backup_trigger(1)
        assert result["ok"] is True
        assert "job" in result

    def test_trigger_sets_pending(self):
        from server.modules.system_ import backup_trigger, backup_status
        backup_trigger(1)
        jobs = {j["id"]: j for j in backup_status()}
        assert jobs[1]["status"] == "pending"

    def test_trigger_nonexistent_returns_error(self):
        from server.modules.system_ import backup_trigger
        result = backup_trigger(9999)
        assert result["ok"] is False
        assert "error" in result


# ─── Flask routes ─────────────────────────────────────────────────────────

class TestSystemRoutes:
    def test_info_route(self, client):
        r = client.get("/api/x/info")
        assert r.status_code == 200
        d = r.get_json()
        assert "node" in d

    def test_users_get(self, client):
        r = client.get("/api/x/users")
        assert r.status_code == 200
        assert "users" in r.get_json()

    def test_users_post(self, client):
        r = client.post("/api/x/users",
                        json={"uid": "ECHO-5", "callsign": "ECHO-5", "role": "observer"},
                        content_type="application/json")
        assert r.status_code == 200
        assert r.get_json()["uid"] == "ECHO-5"

    def test_users_delete(self, client):
        # add then delete
        client.post("/api/x/users",
                    json={"uid": "FOXTROT-6", "callsign": "FOXTROT-6", "role": "observer"},
                    content_type="application/json")
        r = client.delete("/api/x/users/FOXTROT-6")
        assert r.status_code == 200
        assert r.get_json()["ok"] is True

    def test_settings_get(self, client):
        r = client.get("/api/x/settings")
        assert r.status_code == 200
        assert "settings" in r.get_json()
        assert isinstance(r.get_json()["settings"], dict)

    def test_settings_post(self, client):
        r = client.post("/api/x/settings",
                        json={"key": "theme", "value": "green"},
                        content_type="application/json")
        assert r.status_code == 200
        assert r.get_json()["key"] == "theme"

    def test_backup_list_route(self, client):
        r = client.get("/api/x/backup")
        assert r.status_code == 200
        assert "jobs" in r.get_json()

    def test_backup_trigger_route(self, client):
        jid = client.get("/api/x/backup").get_json()["jobs"][0]["id"]
        r = client.post("/api/x/backup/trigger",
                        json={"id": jid},
                        content_type="application/json")
        assert r.status_code == 200
        assert r.get_json()["ok"] is True
