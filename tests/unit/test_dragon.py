"""Tests for Dragon's Tale engine -- Sprint 16."""
import pytest

@pytest.fixture(autouse=True)
def _reset():
    from server.modules import recreation
    recreation.reset_for_tests()
    yield
    recreation.reset_for_tests()

@pytest.fixture
def client():
    from server.app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c

class TestDragonEngine:
    def test_start_returns_session(self):
        from server.modules.recreation import dragon_start
        d = dragon_start("s1")
        assert d["session"] == "s1"
        assert "response" in d
        assert d["hp"] == 20

    def test_start_in_village(self):
        from server.modules.recreation import dragon_start
        d = dragon_start("s1")
        assert "village" in d["response"].lower() or "kingdom" in d["response"].lower()

    def test_look_command(self):
        from server.modules.recreation import dragon_start, dragon_cmd
        dragon_start("s1")
        r = dragon_cmd("s1", "look")
        assert "response" in r
        assert len(r["response"]) > 10

    def test_go_north_to_forge(self):
        from server.modules.recreation import dragon_start, dragon_cmd
        dragon_start("s1")
        r = dragon_cmd("s1", "go north")
        assert r["room"] == "blacksmith_forge"

    def test_take_sword_in_forge(self):
        from server.modules.recreation import dragon_start, dragon_cmd
        dragon_start("s1")
        dragon_cmd("s1", "go north")
        r = dragon_cmd("s1", "take sword")
        assert "sword" in r["response"].lower()
        assert "sword" in r["inv"]

    def test_sword_increases_atk(self):
        from server.modules.recreation import dragon_start, dragon_cmd, _dragon, _dr_atk
        dragon_start("s1")
        state = _dragon["s1"]
        base_atk = _dr_atk(state.inv)
        dragon_cmd("s1", "go north")
        dragon_cmd("s1", "take sword")
        assert _dr_atk(state.inv) == base_atk + 3

    def test_inventory_shows_items(self):
        from server.modules.recreation import dragon_start, dragon_cmd
        dragon_start("s1")
        dragon_cmd("s1", "go north")
        dragon_cmd("s1", "take sword")
        r = dragon_cmd("s1", "inventory")
        assert "sword" in r["response"].lower()

    def test_examine_item(self):
        from server.modules.recreation import dragon_start, dragon_cmd
        dragon_start("s1")
        dragon_cmd("s1", "go north")
        dragon_cmd("s1", "take sword")
        r = dragon_cmd("s1", "examine sword")
        assert "sharp" in r["response"].lower() or "sword" in r["response"].lower()

    def test_heal_potion(self):
        from server.modules.recreation import dragon_start, dragon_cmd, _dragon
        dragon_start("s1")
        state = _dragon["s1"]
        state.hp = 10
        # go to cave depths (need to clear goblin first — force it)
        state.enemies["cave_entrance"] = {"hp": 0}
        dragon_cmd("s1", "go east")   # to market
        # go via forest
        state.room = "cave_depths"
        r = dragon_cmd("s1", "take healing_potion")
        assert "healing_potion" in r["inv"] or "healing potion" in r["response"].lower()

    def test_attack_goblin(self):
        from server.modules.recreation import dragon_start, dragon_cmd, _dragon
        dragon_start("s1")
        dragon_cmd("s1", "go north")   # forge
        dragon_cmd("s1", "take sword")
        dragon_cmd("s1", "go east")    # forest
        dragon_cmd("s1", "go east")    # cave entrance (goblin)
        state = _dragon["s1"]
        assert state.room == "cave_entrance"
        r = dragon_cmd("s1", "attack")
        assert "goblin" in r["response"].lower() or "damage" in r["response"].lower()

    def test_enemy_blocks_guarded_exit(self):
        from server.modules.recreation import dragon_start, dragon_cmd, _dragon
        dragon_start("s1")
        dragon_cmd("s1", "go north")
        dragon_cmd("s1", "go east")   # forest
        dragon_cmd("s1", "go north")  # bridge (troll)
        r = dragon_cmd("s1", "go north")  # troll blocks north
        assert "block" in r["response"].lower() or "deal with" in r["response"].lower()

    def test_flee(self):
        from server.modules.recreation import dragon_start, dragon_cmd, _dragon
        dragon_start("s1")
        dragon_cmd("s1", "go north")
        dragon_cmd("s1", "go east")
        dragon_cmd("s1", "go north")  # bridge with troll
        r = dragon_cmd("s1", "flee")
        assert r["room"] != "old_bridge" or "flee" in r["response"].lower()

    def test_help_command(self):
        from server.modules.recreation import dragon_start, dragon_cmd
        dragon_start("s1")
        r = dragon_cmd("s1", "help")
        assert "look" in r["response"].lower()
        assert "attack" in r["response"].lower()

    def test_status_command(self):
        from server.modules.recreation import dragon_start, dragon_cmd
        dragon_start("s1")
        r = dragon_cmd("s1", "status")
        assert "hp" in r["response"].lower()
        assert "atk" in r["response"].lower()

    def test_unknown_session(self):
        from server.modules.recreation import dragon_cmd
        r = dragon_cmd("ghost", "look")
        assert "error" in r

    def test_game_registry_dragon_available(self):
        from server.modules.recreation import games_list
        dragon = next(g for g in games_list() if g["id"] == "dragon")
        assert dragon["status"] == "available"

class TestDragonRoutes:
    def test_start_route(self, client):
        r = client.post("/api/r/dragon/start",
                        json={"session": "test-dr"},
                        content_type="application/json")
        assert r.status_code == 200
        d = r.get_json()
        assert d["session"] == "test-dr"
        assert "response" in d
        assert d["hp"] == 20

    def test_cmd_route(self, client):
        client.post("/api/r/dragon/start", json={"session": "dr1"},
                    content_type="application/json")
        r = client.post("/api/r/dragon/dr1/cmd", json={"cmd": "look"},
                        content_type="application/json")
        assert r.status_code == 200
        assert "response" in r.get_json()

    def test_cmd_missing_session(self, client):
        r = client.post("/api/r/dragon/ghost/cmd", json={"cmd": "look"},
                        content_type="application/json")
        assert r.status_code == 404

    def test_go_north_via_route(self, client):
        client.post("/api/r/dragon/start", json={"session": "dr2"},
                    content_type="application/json")
        r = client.post("/api/r/dragon/dr2/cmd", json={"cmd": "go north"},
                        content_type="application/json")
        assert r.get_json()["room"] == "blacksmith_forge"
