"""HARDWARE backends — env-flag abstraction layer.

Maps environment variables to named backend strings so all modules
share one place to check hardware availability.  Modules import
hw.sdr_backend() etc. instead of reading os.environ directly.

Backend strings are deliberately lowercase identifiers so callers
can do:  if hw.sdr_backend() == "rtlsdr": ...

Sprint 20.  All real hardware is opt-in via env vars; default is
always "synthetic" so the server runs without any attached hardware.

Environment variables
---------------------
OVERSEER_SDR        rtlsdr | hackrf | airspy    (default: synthetic)
OVERSEER_LORA       sx1262 | sx1278 | rylr998   (default: synthetic)
OVERSEER_MESH       meshtastic | hamlib          (default: synthetic)
OVERSEER_GPS        gpsd | serial               (default: synthetic)
OVERSEER_POWER      ina226 | shunt              (default: synthetic)
OVERSEER_DISPLAY    epaper | hdmi               (default: headless)
"""

from __future__ import annotations
import os

# ── Valid backend names per category ─────────────────────────────────────

_SDR_BACKENDS   = {"rtlsdr", "hackrf", "airspy", "synthetic"}
_LORA_BACKENDS  = {"sx1262", "sx1278", "rylr998", "synthetic"}
_MESH_BACKENDS  = {"meshtastic", "hamlib", "synthetic"}
_GPS_BACKENDS   = {"gpsd", "serial", "synthetic"}
_POWER_BACKENDS = {"ina226", "shunt", "synthetic"}
_DISPLAY_BACKENDS = {"epaper", "hdmi", "headless"}


def _read(env_key: str, valid: set, default: str) -> str:
    """Read an env var, validate against known values, fall back to default."""
    raw = os.environ.get(env_key, "").strip().lower()
    if raw in valid:
        return raw
    if raw:  # set but unknown — log and fall back
        import warnings
        warnings.warn(
            f"OVERSEER: unknown value {env_key}={raw!r}; "
            f"valid: {sorted(valid)}; using '{default}'",
            stacklevel=3,
        )
    return default


# ── Public API ────────────────────────────────────────────────────────────

def sdr_backend() -> str:
    """SDR receiver backend.  'synthetic' unless OVERSEER_SDR is set."""
    return _read("OVERSEER_SDR", _SDR_BACKENDS, "synthetic")


def lora_backend() -> str:
    """LoRa radio backend.  'synthetic' unless OVERSEER_LORA is set."""
    return _read("OVERSEER_LORA", _LORA_BACKENDS, "synthetic")


def mesh_backend() -> str:
    """Mesh transport backend.  'synthetic' unless OVERSEER_MESH is set."""
    return _read("OVERSEER_MESH", _MESH_BACKENDS, "synthetic")


def gps_backend() -> str:
    """GPS source backend.  'synthetic' unless OVERSEER_GPS is set."""
    return _read("OVERSEER_GPS", _GPS_BACKENDS, "synthetic")


def power_backend() -> str:
    """Power monitor backend.  'synthetic' unless OVERSEER_POWER is set."""
    return _read("OVERSEER_POWER", _POWER_BACKENDS, "synthetic")


def display_backend() -> str:
    """Display backend.  'headless' unless OVERSEER_DISPLAY is set."""
    return _read("OVERSEER_DISPLAY", _DISPLAY_BACKENDS, "headless")


def hw_info() -> dict:
    """Return a snapshot of all backend selections."""
    return {
        "sdr":     sdr_backend(),
        "lora":    lora_backend(),
        "mesh":    mesh_backend(),
        "gps":     gps_backend(),
        "power":   power_backend(),
        "display": display_backend(),
    }


def any_real_hardware() -> bool:
    """True if at least one non-synthetic / non-headless backend is active."""
    info = hw_info()
    return any(v not in ("synthetic", "headless") for v in info.values())


# -- end of module ------------------------------------------------------------
