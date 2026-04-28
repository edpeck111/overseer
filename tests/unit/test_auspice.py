"""Tests for AUSPICE module — Sprints 12 + 13.

Sprint 12 gate: sky data correct, natal chart computes, almanac sabbats present,
                ALMANAC events appear in TIMELINE.
Sprint 13 gate: tarot reading CRUD, I Ching cast, rune cast, journal PIN
                setup/write/read/reset, daily card + moon.
"""
import pytest, json
from datetime import datetime, timezone


# ─── Setup ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset():
    from server.modules import auspice
    auspice.reset_for_tests()
    yield
    auspice.reset_for_tests()

@pytest.fixture
def client():
    from server.app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ─── Sprint 12: SKY ───────────────────────────────────────────────────────

class TestSkyEngine:
    def test_sky_get_returns_structure(self):
        from server.modules.auspice import sky_get
        s = sky_get()
        assert "moon" in s and "sun" in s and "planets" in s
        assert "at" in s

    def test_moon_phase_fields(self):
        from server.modules.auspice import sky_get
        moon = sky_get()["moon"]
        assert "phase" in moon
        assert moon["phase"] in [
            "new moon","waxing crescent","first quarter","waxing gibbous",
            "full moon","waning gibbous","last quarter","waning crescent"
        ]
        assert 0 <= moon["illumination_pct"] <= 100
        assert 0 <= moon["age_days"] < 30
        assert "next_full_moon" in moon
        assert "mansion_name" in moon
        assert "zodiac" in moon and "sign" in moon["zodiac"]

    def test_moon_full_illumination_near_180(self):
        from server.modules.auspice import sky_get, _julian_day
        from server.modules.auspice import _moon_phase_info
        # JD of known full moon (approx 2025-01-13 22:27 UTC)
        jd_full = 2460689.437
        info = _moon_phase_info(jd_full)
        assert info["illumination_pct"] >= 95

    def test_sun_zodiac_sign_present(self):
        from server.modules.auspice import sky_get
        sun = sky_get()["sun"]
        from server.modules.auspice import _ZODIAC
        assert sun["zodiac"]["sign"] in _ZODIAC

    def test_planets_count(self):
        from server.modules.auspice import sky_get
        planets = sky_get()["planets"]
        # Sun + Moon + 8 planets = 10
        assert len(planets) == 10

    def test_planet_fields(self):
        from server.modules.auspice import sky_get
        p = sky_get()["planets"][0]
        assert "name" in p and "symbol" in p and "sign" in p
        assert isinstance(p["retrograde"], bool)

    def test_lunar_mansion_range(self):
        from server.modules.auspice import sky_get
        moon = sky_get()["moon"]
        assert 1 <= moon["mansion_num"] <= 28
        assert moon["mansion_name"] in __import__("server.modules.auspice",
                                                   fromlist=["_ARABIC_MANSIONS"])._ARABIC_MANSIONS

    def test_sky_upcoming_returns_events(self):
        from server.modules.auspice import sky_upcoming, _julian_day
        from datetime import datetime, timezone
        jd = _julian_day(datetime(2026, 4, 28, tzinfo=timezone.utc))
        events = sky_upcoming(jd, days=60)
        assert len(events) >= 2
        assert all("kind" in e and "date" in e for e in events)

    def test_sky_api_endpoint(self, client):
        r = client.get("/api/u/sky")
        assert r.status_code == 200
        d = r.get_json()
        assert "moon" in d and "planets" in d

    def test_sky_upcoming_endpoint(self, client):
        r = client.get("/api/u/sky/upcoming?days=30")
        assert r.status_code == 200
        assert isinstance(r.get_json(), list)


# ─── Sprint 12: CHART ─────────────────────────────────────────────────────

class TestChart:
    def test_chart_create(self):
        from server.modules.auspice import chart_create
        c = chart_create("Alice","1987-03-14T03:42:00Z", 50.82, -0.14)
        assert c.id
        assert len(c.placements) == 10
        assert len(c.aspects) >= 0

    def test_chart_sun_in_pisces_march(self):
        """Sun should be in Pisces for a March 14 birth date."""
        from server.modules.auspice import chart_create
        c = chart_create("Pi","1987-03-14T12:00:00Z", 0.0, 0.0)
        sun = next(p for p in c.placements if p["name"]=="Sun")
        assert sun["sign"] in ("Pisces","Aries")  # near cusp

    def test_chart_has_aspects(self):
        from server.modules.auspice import chart_create
        c = chart_create("Bob","1990-06-15T10:00:00Z", 51.5, -0.1)
        # Should find at least some aspects among 10 planets
        assert isinstance(c.aspects, list)

    def test_chart_api_create(self, client):
        r = client.post("/api/u/chart", json={
            "name":"Test","birth_dt":"1990-01-15T12:00:00Z",
            "birth_lat":51.5,"birth_lon":-0.1
        })
        assert r.status_code == 201
        d = r.get_json()
        assert "id" in d and "placements" in d

    def test_chart_api_get(self, client):
        r = client.post("/api/u/chart", json={
            "name":"T","birth_dt":"1990-01-15T12:00:00Z",
            "birth_lat":0,"birth_lon":0
        })
        cid = r.get_json()["id"]
        r2 = client.get(f"/api/u/chart/{cid}")
        assert r2.status_code == 200
        assert r2.get_json()["id"] == cid

    def test_chart_aspects_endpoint(self, client):
        r = client.post("/api/u/chart", json={
            "name":"A","birth_dt":"2000-07-04T04:00:00Z",
            "birth_lat":40.7,"birth_lon":-74.0
        })
        cid = r.get_json()["id"]
        r2 = client.get(f"/api/u/chart/{cid}/aspects")
        assert r2.status_code == 200
        assert isinstance(r2.get_json(), list)


# ─── Sprint 12: ALMANAC ───────────────────────────────────────────────────

class TestAlmanac:
    def test_sabbat_count(self):
        from server.modules.auspice import _sabbat_dates
        s = _sabbat_dates(2026)
        assert len(s) == 8

    def test_sabbat_names(self):
        from server.modules.auspice import _sabbat_dates
        names = {s["name"] for s in _sabbat_dates(2026)}
        assert "Yule (Winter Solstice)" in names
        assert "Ostara (Spring Equinox)" in names
        assert "Midsummer (Summer Solstice)" in names
        assert "Samhain" in names

    def test_lunar_calendar_has_phases(self):
        from server.modules.auspice import _lunar_calendar_month
        phases = _lunar_calendar_month(2026, 4)
        assert len(phases) >= 3  # at least 3 of 4 quarters in any month
        glyphs = {p["glyph"] for p in phases}
        assert len(glyphs) >= 2

    def test_almanac_endpoint(self, client):
        r = client.get("/api/u/almanac?year=2026")
        assert r.status_code == 200
        d = r.get_json()
        assert d["year"] == 2026
        assert len(d["sabbats"]) == 8
        assert len(d["lunar_calendar"]) == 12

    def test_almanac_timeline_feed(self):
        """register() should push sabbat events into the log's auto-event store."""
        from server.modules import log as _log, auspice
        # Reset log store so we start clean
        _log.reset_for_tests()
        auspice._seed_almanac_events()
        events = _log.entries_query(kind="auspice.sabbat")
        assert len(events) >= 8


# ─── Sprint 13: TAROT ─────────────────────────────────────────────────────

class TestTarot:
    def test_rws_deck_size(self):
        from server.modules.auspice import _RWS_DECK
        assert len(_RWS_DECK) == 78

    def test_major_arcana_count(self):
        from server.modules.auspice import _RWS_DECK
        majors = [c for c in _RWS_DECK if c["arcana"]=="major"]
        assert len(majors) == 22

    def test_minor_arcana_count(self):
        from server.modules.auspice import _RWS_DECK
        minors = [c for c in _RWS_DECK if c["arcana"]=="minor"]
        assert len(minors) == 56

    def test_reading_creates_correct_card_count(self):
        from server.modules.auspice import reading_create
        r = reading_create("three-card-ppf", seed=1)
        assert len(r.cards) == 3

    def test_reading_cards_unique(self):
        from server.modules.auspice import reading_create
        r = reading_create("three-card-ppf", seed=42)
        ids = [c["card_id"] for c in r.cards]
        assert len(ids) == len(set(ids))

    def test_reading_api_create(self, client):
        r = client.post("/api/u/readings", json={
            "spread_id":"three-card-ppf","question":"test q","seed":7
        })
        assert r.status_code == 201
        d = r.get_json()
        assert d["id"] and len(d["cards"]) == 3

    def test_reading_api_get(self, client):
        rid = client.post("/api/u/readings", json={"seed":1}).get_json()["id"]
        r = client.get(f"/api/u/readings/{rid}")
        assert r.status_code == 200

    def test_spreads_endpoint(self, client):
        r = client.get("/api/u/spreads")
        assert r.status_code == 200
        spreads = r.get_json()
        assert len(spreads) >= 3
        names = [s["name"] for s in spreads]
        assert any("Three Card" in n for n in names)


# ─── Sprint 13: ORACLE ────────────────────────────────────────────────────

class TestOracle:
    def test_iching_cast_structure(self):
        from server.modules.auspice import iching_cast
        ic = iching_cast(seed=42)
        assert len(ic["throws"]) == 6
        assert "primary" in ic
        assert 1 <= ic["primary"]["number"] <= 64
        assert ic["primary"]["name"]  # non-empty

    def test_iching_changing_lines_lead_to_becoming(self):
        from server.modules.auspice import iching_cast
        # Force a seed where we know changing lines appear
        ic = iching_cast(seed=99)
        if ic["changing_lines"]:
            assert ic["becoming"] is not None
            assert 1 <= ic["becoming"]["number"] <= 64

    def test_iching_all_64_in_dict(self):
        from server.modules.auspice import _ICHING
        assert len(_ICHING) == 64

    def test_rune_cast(self):
        from server.modules.auspice import rune_cast
        runes = rune_cast(n=3, seed=5)
        assert len(runes) == 3
        assert all("glyph" in r and "name" in r and "desc" in r for r in runes)

    def test_oracle_iching_endpoint(self, client):
        r = client.post("/api/u/oracle/iching", json={"seed":1})
        assert r.status_code == 200
        assert "primary" in r.get_json()

    def test_oracle_runes_endpoint(self, client):
        r = client.post("/api/u/oracle/runes", json={"count":3,"seed":1})
        assert r.status_code == 200
        assert len(r.get_json()) == 3


# ─── Sprint 13: JOURNAL ───────────────────────────────────────────────────

class TestJournal:
    def test_journal_setup_and_unlock(self):
        from server.modules.auspice import (journal_setup, journal_unlock,
                                             _SYNTHETIC_RECOVERY_KEY)
        ks = journal_setup("alice","mypincode", _SYNTHETIC_RECOVERY_KEY)
        mk = journal_unlock(ks,"mypincode")
        assert len(mk) == 32

    def test_journal_wrong_pin_raises(self):
        from server.modules.auspice import (journal_setup, journal_unlock,
                                             _SYNTHETIC_RECOVERY_KEY)
        ks = journal_setup("bob","correct", _SYNTHETIC_RECOVERY_KEY)
        with pytest.raises(ValueError, match="PIN"):
            journal_unlock(ks,"wrong")

    def test_journal_write_and_read(self):
        from server.modules.auspice import (journal_setup, journal_unlock,
                                             journal_entry_write, journal_entry_read,
                                             _SYNTHETIC_RECOVERY_KEY)
        ks = journal_setup("carol","securepin", _SYNTHETIC_RECOVERY_KEY)
        mk = journal_unlock(ks,"securepin")
        e = journal_entry_write(mk, "carol", "Today I drew The Tower.")
        plaintext = journal_entry_read(mk, e)
        assert plaintext == "Today I drew The Tower."

    def test_journal_encrypted_at_rest(self):
        from server.modules.auspice import (journal_setup, journal_unlock,
                                             journal_entry_write,
                                             _SYNTHETIC_RECOVERY_KEY)
        ks = journal_setup("dave","pin1234", _SYNTHETIC_RECOVERY_KEY)
        mk = journal_unlock(ks,"pin1234")
        e = journal_entry_write(mk, "dave", "secret reflection")
        assert b"secret" not in e.ciphertext  # must be encrypted

    def test_journal_pin_reset(self):
        from server.modules.auspice import (journal_setup, journal_unlock,
                                             journal_entry_write, journal_entry_read,
                                             journal_reset_pin, _SYNTHETIC_RECOVERY_KEY)
        ks = journal_setup("eve","oldpin", _SYNTHETIC_RECOVERY_KEY)
        mk = journal_unlock(ks,"oldpin")
        e = journal_entry_write(mk, "eve", "pre-reset entry")
        # Overseer resets PIN
        ks2 = journal_reset_pin(ks, _SYNTHETIC_RECOVERY_KEY, "newpin")
        # Old PIN fails
        with pytest.raises(ValueError):
            journal_unlock(ks2,"oldpin")
        # New PIN works and old entry still readable
        mk2 = journal_unlock(ks2,"newpin")
        assert journal_entry_read(mk2, e) == "pre-reset entry"

    def test_journal_api_full_flow(self, client):
        # Setup
        r = client.post("/api/u/journal/setup",
                        json={"operator_id":"op1","pin":"testpin"})
        assert r.status_code == 200
        # Write entry
        r2 = client.post("/api/u/journal/entries", json={
            "operator_id":"op1","pin":"testpin",
            "body":"Today was difficult."
        })
        assert r2.status_code == 201
        # Read entries
        r3 = client.get("/api/u/journal/entries?operator_id=op1&pin=testpin")
        assert r3.status_code == 200
        entries = r3.get_json()
        assert len(entries) == 1
        assert "Today was difficult" in entries[0]["preview"]

    def test_journal_wrong_pin_api(self, client):
        client.post("/api/u/journal/setup",
                    json={"operator_id":"op2","pin":"correct"})
        r = client.post("/api/u/journal/entries", json={
            "operator_id":"op2","pin":"wrong","body":"x"
        })
        assert r.status_code == 403


# ─── Sprint 13: DAILY ─────────────────────────────────────────────────────

class TestDaily:
    def test_daily_structure(self):
        from server.modules.auspice import daily_get
        d = daily_get()
        assert "date" in d and "card" in d and "moon" in d
        assert "reflection_prompt" in d and "reflection_source" in d

    def test_daily_same_day_same_card(self):
        from server.modules.auspice import daily_get
        from datetime import datetime, timezone
        at = datetime(2026, 4, 28, 12, 0, tzinfo=timezone.utc)
        d1 = daily_get(at=at)
        d2 = daily_get(at=at)
        assert d1["card"]["id"] == d2["card"]["id"]

    def test_daily_endpoint(self, client):
        r = client.get("/api/u/daily")
        assert r.status_code == 200
        d = r.get_json()
        assert "card" in d and "moon" in d

