"""Tests for SIGNAL module — Sprint 14.

Gate: satellite passes, ADS-B tracks, APRS feed, spectrum scan,
      captures, bands list, mesh delegation, all Flask routes.
"""
import pytest, time
from datetime import datetime, timezone


# ─── Setup ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset():
    from server.modules import signal_
    signal_.reset_for_tests()
    yield
    signal_.reset_for_tests()


@pytest.fixture
def client():
    from server.app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ─── SatPass / weather_passes ─────────────────────────────────────────────

class TestWeatherPasses:
    def test_returns_list(self):
        from server.modules.signal_ import weather_passes
        passes = weather_passes()
        assert isinstance(passes, list)

    def test_seeded_with_four_sats(self):
        from server.modules.signal_ import weather_passes
        passes = weather_passes(hours_ahead=24)
        assert len(passes) == 4

    def test_pass_fields_present(self):
        from server.modules.signal_ import weather_passes
        p = weather_passes(hours_ahead=24)[0]
        for key in ("sat", "freq_mhz", "aos", "los", "max_el", "direction"):
            assert key in p, f"Missing field: {key}"

    def test_pass_freq_is_float(self):
        from server.modules.signal_ import weather_passes
        p = weather_passes(hours_ahead=24)[0]
        assert isinstance(p["freq_mhz"], float)
        assert 130.0 < p["freq_mhz"] < 150.0

    def test_noaa_sats_present(self):
        from server.modules.signal_ import weather_passes
        names = {p["sat"] for p in weather_passes(hours_ahead=24)}
        assert "NOAA-15" in names
        assert "NOAA-19" in names

    def test_hours_filter(self):
        from server.modules.signal_ import weather_passes, _seed
        _seed()
        # 0-hour window should exclude all passes (they start ≥40 min ahead)
        near = weather_passes(hours_ahead=0)
        assert len(near) == 0

    def test_weather_decode_creates_capture(self):
        from server.modules.signal_ import weather_decode, captures_list
        r = weather_decode("NOAA-19")
        assert r["ok"] is True
        assert "capture" in r
        caps = captures_list()
        assert len(caps) == 1
        assert caps[0]["kind"] == "apt"


# ─── ADS-B tracks ─────────────────────────────────────────────────────────

class TestAirTracks:
    def test_returns_three_synthetic_tracks(self):
        from server.modules.signal_ import air_tracks
        tracks = air_tracks()
        assert len(tracks) == 3

    def test_track_fields(self):
        from server.modules.signal_ import air_tracks
        t = air_tracks()[0]
        for key in ("icao", "callsign", "lat", "lon", "alt_ft", "speed_kt", "heading", "squawk"):
            assert key in t

    def test_squawk_7700_present(self):
        from server.modules.signal_ import air_tracks
        squawks = {t["squawk"] for t in air_tracks()}
        assert "7700" in squawks


# ─── APRS feed ────────────────────────────────────────────────────────────

class TestAprsFeed:
    def test_returns_three_packets(self):
        from server.modules.signal_ import aprs_feed
        pkts = aprs_feed()
        assert len(pkts) == 3

    def test_packet_fields(self):
        from server.modules.signal_ import aprs_feed
        p = aprs_feed()[0]
        for key in ("callsign", "symbol", "lat", "lon", "comment", "at"):
            assert key in p

    def test_sorted_newest_first(self):
        from server.modules.signal_ import aprs_feed
        pkts = aprs_feed()
        ats = [p["at"] for p in pkts]
        assert ats == sorted(ats, reverse=True)

    def test_limit_param(self):
        from server.modules.signal_ import aprs_feed
        assert len(aprs_feed(limit=1)) == 1


# ─── Spectrum scan ────────────────────────────────────────────────────────

class TestSpectrumScan:
    def test_returns_spectrum_slice(self):
        from server.modules.signal_ import spectrum_scan
        s = spectrum_scan("2m")
        for key in ("band", "freq_lo", "freq_hi", "unit", "buckets"):
            assert key in s

    def test_bucket_count(self):
        from server.modules.signal_ import spectrum_scan
        s = spectrum_scan("2m")
        assert len(s["buckets"]) == 64

    def test_buckets_are_floats(self):
        from server.modules.signal_ import spectrum_scan
        for b in spectrum_scan("70cm")["buckets"]:
            assert isinstance(b, float)

    def test_all_bands_scannable(self):
        from server.modules.signal_ import spectrum_scan, _BANDS
        for band in (b["band"] for b in _BANDS):
            s = spectrum_scan(band)
            assert s["band"] == band


# ─── Bands list ───────────────────────────────────────────────────────────

class TestBandsList:
    def test_returns_five_bands(self):
        from server.modules.signal_ import bands_list
        bands = bands_list()
        assert len(bands) == 5

    def test_band_names(self):
        from server.modules.signal_ import bands_list
        names = {b["band"] for b in bands_list()}
        assert {"2m", "70cm", "HF", "VHF", "UHF"} == names


# ─── Captures ─────────────────────────────────────────────────────────────

class TestCaptures:
    def test_empty_initially(self):
        from server.modules.signal_ import captures_list
        assert captures_list() == []

    def test_decode_appends_capture(self):
        from server.modules.signal_ import weather_decode, captures_list
        weather_decode("NOAA-15")
        weather_decode("NOAA-18")
        caps = captures_list()
        assert len(caps) == 2

    def test_captures_newest_first(self):
        from server.modules.signal_ import weather_decode, captures_list
        weather_decode("NOAA-15")
        time.sleep(0.01)
        weather_decode("NOAA-18")
        caps = captures_list()
        assert caps[0]["sat"] == "NOAA-18"


# ─── Flask routes ─────────────────────────────────────────────────────────

class TestSignalRoutes:
    def test_weather_passes_route(self, client):
        r = client.get("/api/s/weather/passes")
        assert r.status_code == 200
        d = r.get_json()
        assert "passes" in d
        assert isinstance(d["passes"], list)

    def test_weather_decode_route(self, client):
        r = client.post("/api/s/weather/decode",
                        json={"sat": "NOAA-19"},
                        content_type="application/json")
        assert r.status_code == 200
        assert r.get_json()["ok"] is True

    def test_air_route(self, client):
        r = client.get("/api/s/air")
        assert r.status_code == 200
        assert "aircraft" in r.get_json()

    def test_aprs_route(self, client):
        r = client.get("/api/s/aprs")
        assert r.status_code == 200
        assert "packets" in r.get_json()

    def test_scan_route_default_band(self, client):
        r = client.get("/api/s/scan")
        assert r.status_code == 200
        d = r.get_json()
        assert d["band"] == "2m"

    def test_scan_route_named_band(self, client):
        r = client.get("/api/s/scan?band=HF")
        assert r.status_code == 200
        assert r.get_json()["band"] == "HF"

    def test_bands_route(self, client):
        r = client.get("/api/s/bands")
        assert r.status_code == 200
        assert len(r.get_json()["bands"]) == 5

    def test_captures_route(self, client):
        r = client.get("/api/s/captures")
        assert r.status_code == 200
        assert "captures" in r.get_json()

    def test_mesh_route(self, client):
        r = client.get("/api/s/mesh")
        assert r.status_code == 200
        assert "nodes" in r.get_json()
