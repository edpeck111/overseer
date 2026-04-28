"""Tests for RECREATION module — Sprint 15.

Gate: fortune, wiki roulette, reader progress CRUD, chess new/state/move,
      zork-lite adventure, game registry, Flask routes.
"""
import pytest, time


# ─── Setup ────────────────────────────────────────────────────────────────

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


# ─── Fortune ──────────────────────────────────────────────────────────────

class TestFortune:
    def test_returns_quote_key(self):
        from server.modules.recreation import fortune_get
        f = fortune_get()
        assert "quote" in f
        assert isinstance(f["quote"], str)
        assert len(f["quote"]) > 5

    def test_draws_from_pool(self):
        from server.modules.recreation import fortune_get, _FORTUNES
        quotes = {fortune_get()["quote"] for _ in range(50)}
        # After 50 draws we should get at least 2 distinct fortunes
        assert len(quotes) >= 2

    def test_all_fortunes_are_strings(self):
        from server.modules.recreation import _FORTUNES
        for q in _FORTUNES:
            assert isinstance(q, str) and len(q) > 0


# ─── Wiki roulette ────────────────────────────────────────────────────────

class TestWikiRoulette:
    def test_returns_article_fields(self):
        from server.modules.recreation import wiki_random
        a = wiki_random()
        for key in ("title", "summary", "zim"):
            assert key in a

    def test_summary_is_nonempty(self):
        from server.modules.recreation import wiki_random
        assert len(wiki_random()["summary"]) > 20

    def test_zim_field_is_wikipedia(self):
        from server.modules.recreation import wiki_random
        assert wiki_random()["zim"] == "wikipedia"

    def test_variety(self):
        from server.modules.recreation import wiki_random
        titles = {wiki_random()["title"] for _ in range(30)}
        assert len(titles) >= 2


# ─── Reader progress ──────────────────────────────────────────────────────

class TestReaderProgress:
    def test_get_unknown_returns_none(self):
        from server.modules.recreation import reader_get_progress
        assert reader_get_progress("wikipedia", "Bowline") is None

    def test_set_and_get_roundtrip(self):
        from server.modules.recreation import reader_set_progress, reader_get_progress
        reader_set_progress("wikipedia", "Bowline", 0.42)
        rp = reader_get_progress("wikipedia", "Bowline")
        assert rp is not None
        assert abs(rp["position"] - 0.42) < 0.001

    def test_position_clamped_to_one(self):
        from server.modules.recreation import reader_set_progress, reader_get_progress
        reader_set_progress("wikipedia", "Bowline", 5.0)
        assert reader_get_progress("wikipedia", "Bowline")["position"] == 1.0

    def test_position_clamped_to_zero(self):
        from server.modules.recreation import reader_set_progress, reader_get_progress
        reader_set_progress("wikipedia", "Bowline", -1.0)
        assert reader_get_progress("wikipedia", "Bowline")["position"] == 0.0

    def test_bookmark_stored(self):
        from server.modules.recreation import reader_set_progress, reader_get_progress
        reader_set_progress("wikipedia", "Morse", 0.1, bookmark="para:3")
        assert reader_get_progress("wikipedia", "Morse")["bookmark"] == "para:3"

    def test_list_returns_all(self):
        from server.modules.recreation import reader_set_progress, reader_list_progress
        reader_set_progress("wikipedia", "Bowline", 0.1)
        reader_set_progress("wikipedia", "Morse", 0.9)
        lst = reader_list_progress()
        assert len(lst) == 2

    def test_list_sorted_newest_first(self):
        from server.modules.recreation import reader_set_progress, reader_list_progress
        reader_set_progress("wikipedia", "Bowline", 0.1)
        time.sleep(0.01)
        reader_set_progress("wikipedia", "Morse", 0.9)
        lst = reader_list_progress()
        assert lst[0]["article"] == "Morse"


# ─── Chess ────────────────────────────────────────────────────────────────

class TestChess:
    def test_new_game_returns_id(self):
        from server.modules.recreation import chess_new
        g = chess_new()
        assert g["id"] == 1
        assert g["to_move"] == "white"
        assert g["result"] is None

    def test_board_rendered(self):
        from server.modules.recreation import chess_new
        g = chess_new()
        assert "board" in g
        assert "a b c d e f g h" in g["board"]

    def test_sequential_ids(self):
        from server.modules.recreation import chess_new
        ids = [chess_new()["id"] for _ in range(3)]
        assert ids == [1, 2, 3]

    def test_state_returns_game(self):
        from server.modules.recreation import chess_new, chess_state
        g = chess_new()
        s = chess_state(g["id"])
        assert s is not None
        assert s["id"] == g["id"]

    def test_state_missing_game(self):
        from server.modules.recreation import chess_state
        assert chess_state(999) is None

    def test_move_recorded(self):
        from server.modules.recreation import chess_new, chess_move
        g = chess_new()
        r = chess_move(g["id"], "e4")
        assert r["move_recorded"] == "e4"
        assert r["to_move"] == "black"
        assert "e4" in r["pgn"]

    def test_move_alternates_side(self):
        from server.modules.recreation import chess_new, chess_move
        g = chess_new()
        chess_move(g["id"], "e4")
        r = chess_move(g["id"], "e5")
        assert r["to_move"] == "white"

    def test_move_nonexistent_game(self):
        from server.modules.recreation import chess_move
        r = chess_move(999, "e4")
        assert "error" in r


# ─── Zork-lite ────────────────────────────────────────────────────────────

class TestZork:
    def _start(self):
        from server.modules.recreation import ZorkState, _zork, _zork_cmd
        from server.modules import recreation as rec
        state = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        return state

    def test_look_describes_room(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        resp = _zork_cmd(s, "look")
        assert "bunker" in resp.lower() or "entrance" in resp.lower()

    def test_go_north(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        _zork_cmd(s, "go north")
        assert s.room == "command_room"

    def test_go_invalid_direction(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        resp = _zork_cmd(s, "go south")
        assert "can't" in resp.lower()

    def test_take_item(self):
        from server.modules.recreation import _zork_cmd, ZorkState, _ROOMS
        # Reset room items
        _ROOMS["bunker_entrance"]["items"] = ["torch"]
        s = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        resp = _zork_cmd(s, "take torch")
        assert "torch" in resp.lower()
        assert "torch" in s.inv

    def test_inventory_empty(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        resp = _zork_cmd(s, "inventory")
        assert "nothing" in resp.lower() or "not carrying" in resp.lower()

    def test_inventory_with_item(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=["torch"], history=[], done=False)
        resp = _zork_cmd(s, "i")
        assert "torch" in resp.lower()

    def test_examine_item(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=["torch"], history=[], done=False)
        resp = _zork_cmd(s, "examine torch")
        assert len(resp) > 5

    def test_quit_sets_done(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        _zork_cmd(s, "quit")
        assert s.done is True

    def test_help_lists_commands(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        resp = _zork_cmd(s, "help")
        assert "look" in resp.lower() and "go" in resp.lower()

    def test_unknown_command(self):
        from server.modules.recreation import _zork_cmd, ZorkState
        s = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        resp = _zork_cmd(s, "xyzzy")
        assert "don't understand" in resp.lower() or "i don't" in resp.lower()


# ─── Game registry ────────────────────────────────────────────────────────

class TestGamesRegistry:
    def test_returns_list(self):
        from server.modules.recreation import games_list
        assert isinstance(games_list(), list)

    def test_has_chess_and_zork(self):
        from server.modules.recreation import games_list
        ids = {g["id"] for g in games_list()}
        assert "chess" in ids and "zork" in ids

    def test_dragon_is_placeholder(self):
        from server.modules.recreation import games_list
        dragon = next(g for g in games_list() if g["id"] == "dragon")
        assert "sprint 16" in dragon["status"].lower()

    def test_all_have_hotkey(self):
        from server.modules.recreation import games_list
        for g in games_list():
            assert "hotkey" in g and len(g["hotkey"]) == 1


# ─── Flask routes ─────────────────────────────────────────────────────────

class TestRecreationRoutes:
    def test_games_route(self, client):
        r = client.get("/api/r/games")
        assert r.status_code == 200
        d = r.get_json()
        assert "games" in d
        assert len(d["games"]) > 0

    def test_fortune_route(self, client):
        r = client.get("/api/r/fortune")
        assert r.status_code == 200
        assert "quote" in r.get_json()

    def test_wiki_random_route(self, client):
        r = client.get("/api/r/wiki/random")
        assert r.status_code == 200
        assert "title" in r.get_json()

    def test_reader_get_empty(self, client):
        r = client.get("/api/r/reader/progress")
        assert r.status_code == 200
        assert r.get_json()["progress"] == []

    def test_reader_post_and_get(self, client):
        client.post("/api/r/reader/progress",
                    json={"archive": "wikipedia", "article": "Bowline", "position": 0.5},
                    content_type="application/json")
        r = client.get("/api/r/reader/progress")
        assert len(r.get_json()["progress"]) == 1

    def test_chess_new_route(self, client):
        r = client.post("/api/r/chess/new", content_type="application/json", json={})
        assert r.status_code == 200
        assert "id" in r.get_json()

    def test_chess_state_route(self, client):
        new_r = client.post("/api/r/chess/new", content_type="application/json", json={})
        gid = new_r.get_json()["id"]
        r = client.get(f"/api/r/chess/{gid}")
        assert r.status_code == 200
        assert r.get_json()["id"] == gid

    def test_chess_state_404(self, client):
        r = client.get("/api/r/chess/9999")
        assert r.status_code == 404

    def test_chess_move_route(self, client):
        new_r = client.post("/api/r/chess/new", content_type="application/json", json={})
        gid = new_r.get_json()["id"]
        r = client.post(f"/api/r/chess/{gid}/move",
                        json={"move": "e4"}, content_type="application/json")
        assert r.status_code == 200
        assert r.get_json()["move_recorded"] == "e4"

    def test_zork_start_route(self, client):
        r = client.post("/api/r/zork/start",
                        json={"session": "test-sess"}, content_type="application/json")
        assert r.status_code == 200
        d = r.get_json()
        assert d["session"] == "test-sess"
        assert "response" in d

    def test_zork_cmd_route(self, client):
        client.post("/api/r/zork/start",
                    json={"session": "sess1"}, content_type="application/json")
        r = client.post("/api/r/zork/sess1/cmd",
                        json={"cmd": "go north"}, content_type="application/json")
        assert r.status_code == 200
        d = r.get_json()
        assert "response" in d
        assert d["room"] == "command_room"

    def test_zork_cmd_missing_session(self, client):
        r = client.post("/api/r/zork/ghost/cmd",
                        json={"cmd": "look"}, content_type="application/json")
        assert r.status_code == 404
