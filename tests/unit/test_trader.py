"""Tests for TRADER engine -- Sprint 19."""
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


# ─── Engine ───────────────────────────────────────────────────────────────

class TestTraderEngine:
    def test_new_returns_session(self):
        from server.modules.recreation import trader_new
        d = trader_new("s1")
        assert d["session"] == "s1"
        assert "response" in d
        assert d["synthetic"] is True

    def test_new_starts_at_homestead(self):
        from server.modules.recreation import trader_new
        d = trader_new("s1")
        assert d["sector"] == "homestead"

    def test_new_has_starting_credits(self):
        from server.modules.recreation import trader_new, _TR_CREDITS_START
        d = trader_new("s1")
        assert d["credits"] == _TR_CREDITS_START

    def test_new_has_starting_turns(self):
        from server.modules.recreation import trader_new, _TR_TURNS_START
        d = trader_new("s1")
        assert d["turns"] == _TR_TURNS_START

    def test_new_cargo_empty(self):
        from server.modules.recreation import trader_new
        d = trader_new("s1")
        assert all(v == 0 for v in d["cargo"].values())

    def test_go_adjacent_sector(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        r = trader_cmd("s1", "go farmstead")
        assert r["sector"] == "farmstead"

    def test_go_costs_one_turn(self):
        from server.modules.recreation import trader_new, trader_cmd, _TR_TURNS_START
        trader_new("s1")
        r = trader_cmd("s1", "go farmstead")
        assert r["turns"] == _TR_TURNS_START - 1

    def test_go_non_adjacent_rejected(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        r = trader_cmd("s1", "go bunker")   # bunker not adjacent to homestead
        assert "can't reach" in r["response"].lower() or "exits" in r["response"].lower()
        assert r["sector"] == "homestead"

    def test_buy_increases_cargo(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        r = trader_cmd("s1", "buy food 3")
        assert r["cargo"]["food"] == 3

    def test_buy_deducts_credits(self):
        from server.modules.recreation import trader_new, trader_cmd, _TR_CREDITS_START
        trader_new("s1")
        r = trader_cmd("s1", "buy food 3")
        assert r["credits"] < _TR_CREDITS_START

    def test_sell_reduces_cargo(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        trader_cmd("s1", "buy food 5")
        r = trader_cmd("s1", "sell food 3")
        assert r["cargo"]["food"] == 2

    def test_sell_increases_credits(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        trader_cmd("s1", "buy food 5")
        credits_after_buy = trader_cmd("s1", "status")["credits"]
        r = trader_cmd("s1", "sell food 5")
        assert r["credits"] > credits_after_buy

    def test_cross_sector_trade_profitable(self):
        """Buy cheap at farmstead, sell higher at bunker."""
        from server.modules.recreation import trader_new, trader_cmd, _TR_CREDITS_START
        trader_new("s1")
        trader_cmd("s1", "go farmstead")       # farmstead: food cheap
        trader_cmd("s1", "buy food 10")
        trader_cmd("s1", "go homestead")
        trader_cmd("s1", "go market_town")
        trader_cmd("s1", "go fuel_depot")
        trader_cmd("s1", "go bunker")          # bunker: food expensive
        r = trader_cmd("s1", "sell food 10")
        assert r["credits"] > _TR_CREDITS_START

    def test_buy_unknown_commodity(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        r = trader_cmd("s1", "buy gold 1")
        assert "unknown" in r["response"].lower()

    def test_buy_insufficient_credits(self):
        from server.modules.recreation import trader_new, trader_cmd, _TR_CREDITS_START
        trader_new("s1")
        # Try to buy more than we can afford
        r = trader_cmd("s1", "buy medicine 100")
        assert "credits" in r["response"].lower() or "enough" in r["response"].lower()

    def test_cargo_limit_enforced(self):
        from server.modules.recreation import trader_new, trader_cmd, _TR_CARGO_MAX
        trader_new("s1")
        trader_cmd("s1", "buy food 10")
        trader_cmd("s1", "buy water 10")   # now at max (20)
        r = trader_cmd("s1", "buy tools 1")
        assert "cargo" in r["response"].lower() or "space" in r["response"].lower()

    def test_sell_more_than_held(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        trader_cmd("s1", "buy food 2")
        r = trader_cmd("s1", "sell food 10")
        assert "only" in r["response"].lower() or "have" in r["response"].lower()

    def test_help_command(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        r = trader_cmd("s1", "help")
        assert "go" in r["response"].lower()
        assert "buy" in r["response"].lower()
        assert "sell" in r["response"].lower()

    def test_status_command(self):
        from server.modules.recreation import trader_new, trader_cmd
        trader_new("s1")
        r = trader_cmd("s1", "status")
        assert "credits" in r["response"].lower()
        assert "sector" in r["response"].lower() or "homestead" in r["response"].lower()

    def test_unknown_session_returns_error(self):
        from server.modules.recreation import trader_cmd
        r = trader_cmd("nosession", "status")
        assert "error" in r

    def test_game_registry_available(self):
        from server.modules.recreation import games_list
        games = games_list()
        trader = next(g for g in games if g["id"] == "trader")
        assert trader["status"] == "available"


# ─── Routes ───────────────────────────────────────────────────────────────

class TestTraderRoutes:
    def test_start_route(self, client):
        r = client.post("/api/r/trader/start", json={"session": "r1"})
        assert r.status_code == 200
        j = r.get_json()
        assert j["session"] == "r1"
        assert j["sector"] == "homestead"

    def test_cmd_route_go(self, client):
        client.post("/api/r/trader/start", json={"session": "r2"})
        r = client.post("/api/r/trader/r2/cmd", json={"cmd": "go farmstead"})
        assert r.status_code == 200
        assert r.get_json()["sector"] == "farmstead"

    def test_cmd_route_buy(self, client):
        client.post("/api/r/trader/start", json={"session": "r3"})
        r = client.post("/api/r/trader/r3/cmd", json={"cmd": "buy food 4"})
        assert r.status_code == 200
        assert r.get_json()["cargo"]["food"] == 4

    def test_cmd_route_missing_session(self, client):
        r = client.post("/api/r/trader/nosession/cmd", json={"cmd": "status"})
        assert r.status_code == 404

# -- end of test --
