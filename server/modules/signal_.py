"""SIGNAL module — RTL-SDR + LoRa + ADS-B + APRS + spectrum scanner.

Sprint 14. Synthetic-first; real hardware via env flags:
  OVERSEER_SIGNAL_SDR=synthetic|rtlsdr
  OVERSEER_SIGNAL_LORA=synthetic|meshtastic
  OVERSEER_SIGNAL_ADSB=synthetic|dump1090
  OVERSEER_SIGNAL_APRS=synthetic|direwolf

Sub-screens: W(weather) A(air) P(aprs) M(mesh) S(scan) T(transmit)
API prefix: /api/s/
"""
from __future__ import annotations
import math, os, time, random, json
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime, timezone, timedelta

# ── env flags ──────────────────────────────────────────────────────────────
_SDR_BACKEND   = os.getenv("OVERSEER_SIGNAL_SDR",  "synthetic")
_LORA_BACKEND  = os.getenv("OVERSEER_SIGNAL_LORA", "synthetic")
_ADSB_BACKEND  = os.getenv("OVERSEER_SIGNAL_ADSB", "synthetic")
_APRS_BACKEND  = os.getenv("OVERSEER_SIGNAL_APRS", "synthetic")

# ── in-memory stores ───────────────────────────────────────────────────────
@dataclass
class SatPass:
    sat:       str
    freq_mhz:  float
    aos:       str   # acquisition-of-signal UTC ISO
    los:       str   # loss-of-signal UTC ISO
    max_el:    float # degrees
    direction: str   # N/S pass direction

@dataclass
class AircraftTrack:
    icao:     str
    callsign: str
    lat:      float
    lon:      float
    alt_ft:   int
    speed_kt: int
    heading:  int
    squawk:   str
    seen:     float  # unix ts

@dataclass
class AprsPacket:
    callsign: str
    symbol:   str
    lat:      float
    lon:      float
    comment:  str
    at:       float

@dataclass
class SpectrumSlice:
    band:     str
    freq_lo:  float
    freq_hi:  float
    unit:     str      # MHz
    buckets:  list     # list of dBm floats

@dataclass
class Capture:
    id:       int
    kind:     str      # apt | spectrum
    sat:      Optional[str]
    band:     Optional[str]
    path:     str      # relative path
    at:       float

_passes:   list[SatPass]       = []
_aircraft: list[AircraftTrack] = []
_aprs:     list[AprsPacket]    = []
_captures: list[Capture]       = []
_scan_cache: dict[str, SpectrumSlice] = {}
_seeded = False

# ── synthetic seed data ────────────────────────────────────────────────────
_NOAA_SATS = [
    {"sat": "NOAA-15", "freq_mhz": 137.620},
    {"sat": "NOAA-18", "freq_mhz": 137.912},
    {"sat": "NOAA-19", "freq_mhz": 137.100},
    {"sat": "ISS",     "freq_mhz": 145.800},
]

_BANDS = [
    {"band": "2m",  "freq_lo": 144.0, "freq_hi": 146.0, "unit": "MHz"},
    {"band": "70cm","freq_lo": 430.0, "freq_hi": 440.0, "unit": "MHz"},
    {"band": "HF",  "freq_lo": 14.0,  "freq_hi": 14.35, "unit": "MHz"},
    {"band": "VHF", "freq_lo": 108.0, "freq_hi": 136.0, "unit": "MHz"},
    {"band": "UHF", "freq_lo": 400.0, "freq_hi": 512.0, "unit": "MHz"},
]

_FORTUNE_QUOTES = [
    "The map is not the territory.",
    "Two is one, one is none.",
    "Slow is smooth, smooth is fast.",
    "Prior planning prevents poor performance.",
    "Adapt what is useful, discard what is not.",
    "Amateurs think about tactics; professionals think about logistics.",
    "In the middle of difficulty lies opportunity.",
    "Prepare for the worst; hope for the best.",
    "A human being should be able to change a diaper, plan an invasion, butcher a hog, "
    "conn a ship, design a building, write a sonnet, balance accounts, build a wall, "
    "set a bone, comfort the dying, take orders, give orders, cooperate, act alone, "
    "solve equations, analyse a new problem, pitch manure, program a computer, cook a "
    "tasty meal, fight efficiently, die gallantly. Specialization is for insects.",
    "Survival is not about the fittest — it is about the most adaptable.",
    "It's not the daily increase but daily decrease. Hack away the unessential.",
    "The more you sweat in training, the less you bleed in battle.",
    "When in doubt, don't.",
    "He who is prudent and lies in wait for an enemy who is not, will be victorious.",
    "Better to have it and not need it than need it and not have it.",
]

def _seed():
    global _seeded
    if _seeded:
        return
    _seeded = True
    now = datetime.now(timezone.utc)
    # Satellite passes — synthetic schedule for next 12 hours
    for i, sat in enumerate(_NOAA_SATS):
        aos_dt = now + timedelta(minutes=40 + i * 90)
        los_dt = aos_dt + timedelta(minutes=10 + random.randint(0, 4))
        _passes.append(SatPass(
            sat=sat["sat"], freq_mhz=sat["freq_mhz"],
            aos=aos_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            los=los_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            max_el=round(20 + random.uniform(0, 55), 1),
            direction="N" if i % 2 == 0 else "S",
        ))
    # ADS-B tracks
    _aircraft.extend([
        AircraftTrack("4CA123","EI-ABC",51.52,-0.10,35000,450,270,"7700",time.time()-30),
        AircraftTrack("400F2C","G-XYZQ",51.45,-0.25,12000,220, 95,"1200",time.time()-15),
        AircraftTrack("3C4B11","DLH42A",51.60, 0.05,22000,380,180,"2000",time.time()-60),
    ])
    # APRS packets
    _aprs.extend([
        AprsPacket("M0XYZ-9","[",51.503,-0.128,"Mobile: speed 0 alt 10m",time.time()-120),
        AprsPacket("GB3OX","#",  51.501,-0.125,"Repeater 145.775MHz -600 CTCSS 82.5",time.time()-300),
        AprsPacket("EW4567","_", 51.510,-0.100,"WX: T=12.3 Dew=8.1 Hum=74% Wind=240/8kt",time.time()-60),
    ])
    # Spectrum cache
    for b in _BANDS:
        _generate_spectrum(b["band"])

def _generate_spectrum(band: str) -> SpectrumSlice:
    """Generate synthetic noise floor + occasional signal spikes."""
    b = next((x for x in _BANDS if x["band"] == band), _BANDS[0])
    buckets = []
    n = 64
    for i in range(n):
        noise = -105 + random.gauss(0, 3)
        # occasional signal blip
        if random.random() < 0.05:
            noise += random.uniform(20, 50)
        buckets.append(round(noise, 1))
    sl = SpectrumSlice(band=b["band"], freq_lo=b["freq_lo"], freq_hi=b["freq_hi"],
                       unit=b["unit"], buckets=buckets)
    _scan_cache[band] = sl
    return sl

def reset_for_tests():
    global _passes, _aircraft, _aprs, _captures, _scan_cache, _seeded
    _passes = []; _aircraft = []; _aprs = []
    _captures = []; _scan_cache = {}; _seeded = False

# ── public API functions ───────────────────────────────────────────────────

def weather_passes(hours_ahead: int = 12) -> list[dict]:
    _seed()
    if _SDR_BACKEND != "synthetic":
        pass  # TODO: real TLE prediction via ephem/skyfield
    cutoff = (datetime.now(timezone.utc) + timedelta(hours=hours_ahead)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return [asdict(p) for p in _passes if p.aos < cutoff]

def weather_decode(sat: str) -> dict:
    """Trigger APT decode of next pass (synthetic: return stub image info)."""
    _seed()
    cap = Capture(
        id=len(_captures)+1, kind="apt", sat=sat,
        band=None, path=f"data/captures/apt_{sat.replace('-','').lower()}_{int(time.time())}.png",
        at=time.time()
    )
    _captures.append(cap)
    return {"ok": True, "capture": asdict(cap), "note": "Synthetic APT decode — real image on OVERSEER_SIGNAL_SDR=rtlsdr"}

def air_tracks() -> list[dict]:
    _seed()
    if _ADSB_BACKEND != "synthetic":
        pass  # TODO: query dump1090 http://localhost:8080/data/aircraft.json
    now = time.time()
    # Age out stale tracks (>120s in synthetic)
    return [asdict(a) for a in _aircraft if now - a.seen < 300]

def aprs_feed(limit: int = 50) -> list[dict]:
    _seed()
    if _APRS_BACKEND != "synthetic":
        pass  # TODO: query direwolf KISS/AGWPE port
    return sorted([asdict(p) for p in _aprs], key=lambda x: -x["at"])[:limit]

def spectrum_scan(band: str = "2m") -> dict:
    _seed()
    if _SDR_BACKEND != "synthetic":
        pass  # TODO: rtl_power subprocess + parse CSV
    sl = _generate_spectrum(band) if band not in _scan_cache else _scan_cache[band]
    return asdict(sl)

def captures_list() -> list[dict]:
    _seed()
    return [asdict(c) for c in reversed(_captures)]

def bands_list() -> list[dict]:
    return _BANDS

def mesh_nodes() -> list[dict]:
    """Pull mesh node list from comms module (shared store)."""
    try:
        from server.modules.comms import nodes_list
        return nodes_list()
    except Exception:
        return []

# ── Flask routes ───────────────────────────────────────────────────────────
def register(app):
    from flask import jsonify, request
    _seed()

    @app.route("/api/s/weather/passes")
    def _weather_passes():
        hours = int(request.args.get("hours", 12))
        return jsonify({"passes": weather_passes(hours)})

    @app.route("/api/s/weather/decode", methods=["POST"])
    def _weather_decode():
        sat = (request.json or {}).get("sat", "NOAA-19")
        return jsonify(weather_decode(sat))

    @app.route("/api/s/air")
    def _air():
        return jsonify({"aircraft": air_tracks()})

    @app.route("/api/s/aprs")
    def _aprs_route():
        limit = int(request.args.get("limit", 50))
        return jsonify({"packets": aprs_feed(limit)})

    @app.route("/api/s/scan")
    def _scan():
        band = request.args.get("band", "2m")
        return jsonify(spectrum_scan(band))

    @app.route("/api/s/bands")
    def _bands():
        return jsonify({"bands": bands_list()})

    @app.route("/api/s/captures")
    def _captures():
        return jsonify({"captures": captures_list()})

    @app.route("/api/s/mesh")
    def _mesh():
        return jsonify({"nodes": mesh_nodes()})
