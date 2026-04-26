"""POWER module — battery, load, radio, storage telemetry.

Sprint 3 (canary) ships a clean ``Source`` interface with a synthetic
backend wired in. Real hardware (Jackery USB-C protocol decode, INA219
shunt, psutil battery) plugs in behind the same interface in a later
sprint by setting OVERSEER_POWER_SOURCE in the environment — swapping
in real hardware is a one-file change at module load time.

Per Ted's Sprint-3 directive:
  - synthetic data only, plausible noise + slow drift + occasional
    AC-on / load-spike events
  - no background sampler thread (Sprint 4 lands the WS push producer)
  - the read_sample() interface is the contract — it stays the same
    when the hardware path replaces the synthetic one

Sprint 3 is read-only canary. The HTTP module uses ``read_sample()``
on demand at POWER_POLL_S (30 s) cadence; the in-memory history
buffer keeps the latest range of samples for the sparklines.

Spec: docs/02-MODULE-CATALOG.md → (P) POWER. Schema: docs/02-MODULE-
CATALOG.md → power_sample (mirror lives in server/db.py).
"""

from __future__ import annotations

import math
import os
import random
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Iterable, Protocol

# Polling cadence on WiFi for HOT class (ADR-0008). The shell polls
# /api/p/now at this rate; the history buffer downsamples to it.
POWER_POLL_S: int = 30

# How many samples to keep in the in-memory history (30 d × 86400 s /
# 30 s = 86_400; a deque is fine — RAM cost ≤ ~10 MB at 100 B/sample).
# For Sprint 3 we cap at 24 h × 120 = 2880 samples.
_HISTORY_CAP: int = (24 * 60 * 60) // POWER_POLL_S


# --------------------------------------------------------------------- #
# The canonical sample shape (kept as a dict on the wire to match the
# fixture in server/omp/fixtures/power_now.json).
# --------------------------------------------------------------------- #

@dataclass
class Sample:
    at: float                # Unix seconds (float for sub-second precision in tests)
    batt_pct: float
    draw_w: float
    input_w: float           # 0 when on battery; > 0 when AC connected / charging
    runtime_est_s: int
    cpu: float               # 0..100
    ram: float               # 0..100
    ram_used_gb: float
    ram_total_gb: float
    swap: float
    temp_c: float
    fan: int
    cycles: int = 238
    health_pct: float = 96.0
    draw_w_peak: float = 0.0  # rolling 24 h peak (set by aggregator)

    def to_wire(self) -> dict:
        d = {k: v for k, v in self.__dict__.items()}
        # Nudge ints where the design spec uses them (RAM%, CPU% rounded
        # to ints when displayed; we keep one decimal in storage).
        d["batt_pct"] = round(self.batt_pct, 1)
        d["draw_w"] = round(self.draw_w, 2)
        d["input_w"] = round(self.input_w, 2)
        d["cpu"] = round(self.cpu)
        d["ram"] = round(self.ram)
        d["ram_used_gb"] = round(self.ram_used_gb, 1)
        d["temp_c"] = round(self.temp_c)
        d["fan"] = int(self.fan)
        d["swap"] = round(self.swap, 1)
        d["runtime_est_s"] = int(self.runtime_est_s)
        d["draw_w_peak"] = round(self.draw_w_peak, 1)
        return d


# --------------------------------------------------------------------- #
# Source protocol — implementations swap freely at boot.
# --------------------------------------------------------------------- #

class Source(Protocol):
    """Anything the POWER module reads from."""
    def read_sample(self) -> Sample:
        ...


# --------------------------------------------------------------------- #
# Synthetic source — Sprint 3 default.
# --------------------------------------------------------------------- #

@dataclass
class SyntheticSource:
    """Plausible synthetic telemetry.

    Maintains a small state machine and advances it on each call to
    read_sample(). Time advances in steps of POWER_POLL_S; we use a
    monotonic clock so jitter in the caller doesn't perturb the model.

    Events:
      AC_ON        battery starts charging (input_w > 0); drains stop
      LOAD_SPIKE   CPU jumps high for a short window
      THERMAL_LAG  temp follows CPU with first-order lag

    Determinism: a seeded RNG. Use ``SyntheticSource(seed=...)`` in tests.
    """

    seed: int | None = None

    # Battery state
    batt_pct: float    = 82.0    # initial charge
    capacity_wh: float = 2000.0  # Jackery 2000Wh nominal
    base_draw_w: float = 4.2     # idle draw on the OPi5
    cycles: int        = 238
    health_pct: float  = 96.0

    # CPU/RAM baselines
    cpu_baseline: float = 7.0
    ram_baseline: float = 61.0
    ram_total_gb: float = 16.0
    swap_baseline: float = 2.0

    # Thermal
    temp_baseline: float = 22.0
    cpu_to_temp_gain: float = 0.4   # °C per CPU%
    fan_curve_floor: int = 1500
    fan_curve_per_temp: float = 75   # rpm per °C above baseline

    # Event timing (seconds between events; randomised around these)
    ac_on_period_s: int = 30 * 60     # ~30 min
    load_spike_period_s: int = 8 * 60 # ~8 min

    # Internal state
    _rng: random.Random = field(init=False)
    _last_at: float | None = field(default=None, init=False)
    _next_ac_event: float = field(default=0.0, init=False)
    _ac_until: float = field(default=0.0, init=False)
    _next_spike: float = field(default=0.0, init=False)
    _spike_until: float = field(default=0.0, init=False)
    _spike_amp: float = field(default=0.0, init=False)
    _temp: float = field(init=False)
    _draw_peak: float = field(default=0.0, init=False)

    def __post_init__(self):
        self._rng = random.Random(self.seed if self.seed is not None else time.time_ns())
        self._temp = self.temp_baseline
        self._next_ac_event = -1.0
        self._next_spike = -1.0

    # ----------------------------------------------------------------- #

    def read_sample(self, *, now: float | None = None) -> Sample:
        now = now if now is not None else time.time()
        dt = (now - self._last_at) if self._last_at is not None else POWER_POLL_S
        if dt < 0:
            dt = POWER_POLL_S  # clock went backwards; skip update
        self._last_at = now

        # Roll for AC-on event
        if self._next_ac_event < 0:
            self._next_ac_event = now + self._rng.uniform(0.5, 1.5) * self.ac_on_period_s
        if now >= self._next_ac_event and now >= self._ac_until:
            duration = self._rng.uniform(8 * 60, 15 * 60)
            self._ac_until = now + duration
            self._next_ac_event = now + self._rng.uniform(0.6, 1.6) * self.ac_on_period_s
        ac_on = now < self._ac_until

        # Roll for load spike
        if self._next_spike < 0:
            self._next_spike = now + self._rng.uniform(0.5, 1.5) * self.load_spike_period_s
        if now >= self._next_spike and now >= self._spike_until:
            duration = self._rng.uniform(20.0, 90.0)
            self._spike_until = now + duration
            self._spike_amp = self._rng.uniform(40.0, 75.0)   # extra CPU%
            self._next_spike = now + self._rng.uniform(0.6, 1.4) * self.load_spike_period_s

        spike_active = now < self._spike_until
        cpu = self._clip(
            self.cpu_baseline + self._rng.gauss(0, 1.5)
            + (self._spike_amp if spike_active else 0.0),
            0.0, 100.0,
        )
        ram = self._clip(
            self.ram_baseline + self._rng.gauss(0, 0.6)
            + (4.0 if spike_active else 0.0),
            5.0, 99.0,
        )
        ram_used_gb = round(self.ram_total_gb * ram / 100.0, 2)
        swap = self._clip(self.swap_baseline + self._rng.gauss(0, 0.3), 0.0, 100.0)

        # Thermal: first-order lag toward (baseline + cpu*gain)
        target_temp = self.temp_baseline + cpu * self.cpu_to_temp_gain
        alpha = 1.0 - math.exp(-dt / 30.0)         # ~30 s thermal time constant
        self._temp = self._temp + alpha * (target_temp - self._temp)
        fan = int(self.fan_curve_floor +
                  max(0.0, self._temp - self.temp_baseline) * self.fan_curve_per_temp)

        # Draw correlates with CPU (rough TDP curve) + a bit of noise
        draw_w = self.base_draw_w + (cpu / 100.0) * 7.0 + self._rng.gauss(0, 0.15)
        draw_w = max(0.5, draw_w)
        input_w = self._rng.uniform(45, 55) if ac_on else 0.0
        # Battery drift: net rate (W) → capacity_wh → %/sec
        net_w = (input_w if ac_on else 0.0) - draw_w
        net_pct_per_s = net_w / self.capacity_wh / 36.0      # 1 % = capacity_wh × 36 (3600s/100%)
        self.batt_pct = self._clip(self.batt_pct + net_pct_per_s * dt, 0.0, 100.0)

        runtime_est_s = (
            int(self.batt_pct / 100.0 * self.capacity_wh / max(0.1, draw_w) * 3600)
            if not ac_on else int(1e9)
        )
        self._draw_peak = max(self._draw_peak * 0.999, draw_w)  # slow decay so peak isn't sticky

        return Sample(
            at=now,
            batt_pct=self.batt_pct,
            draw_w=draw_w,
            input_w=input_w,
            runtime_est_s=runtime_est_s,
            cpu=cpu, ram=ram, ram_used_gb=ram_used_gb,
            ram_total_gb=self.ram_total_gb,
            swap=swap,
            temp_c=self._temp,
            fan=fan,
            cycles=self.cycles,
            health_pct=self.health_pct,
            draw_w_peak=self._draw_peak,
        )

    @staticmethod
    def _clip(x: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, x))


# --------------------------------------------------------------------- #
# Module-level state: source + history buffer
# --------------------------------------------------------------------- #

def _select_source() -> Source:
    flavour = os.environ.get("OVERSEER_POWER_SOURCE", "synthetic").lower()
    if flavour == "synthetic":
        return SyntheticSource()
    if flavour == "hardware":
        # Real telemetry plug-in — Sprint 4+ work.
        raise NotImplementedError(
            "OVERSEER_POWER_SOURCE=hardware: implement HardwareSource and "
            "swap it in here. Sprint 3 is synthetic only."
        )
    raise ValueError(f"unknown OVERSEER_POWER_SOURCE={flavour!r}")


_source: Source = _select_source()
_history: deque[Sample] = deque(maxlen=_HISTORY_CAP)


def read_sample() -> Sample:
    """Take one sample and append it to the in-memory history.

    The history holds at most _HISTORY_CAP samples (24 h at 30 s).
    """
    s = _source.read_sample()
    _history.append(s)
    return s


def read_history(range_s: int = 24 * 3600, buckets: int | None = None) -> list[Sample]:
    """Return samples within the last ``range_s`` seconds.

    If ``buckets`` is given, downsample to that many buckets — used by
    the sparkline component which renders fixed-width bars.
    """
    if not _history:
        return []
    cutoff = time.time() - range_s
    in_range = [s for s in _history if s.at >= cutoff]
    if buckets is None or buckets <= 0 or buckets >= len(in_range):
        return in_range
    # Bucket by index (cheap; the sampling cadence is uniform).
    step = max(1, len(in_range) // buckets)
    return in_range[::step][:buckets]


def reset_for_tests(*, source: Source | None = None) -> None:
    """Reset module state for deterministic tests."""
    global _source
    _source = source if source is not None else _select_source()
    _history.clear()


def radio_status() -> dict:
    """Static synthetic radio block. Sprint 14 SIGNAL replaces with real."""
    return {
        "wifi": {"ssid": "overseer-net", "rssi_db": -42, "clients": 6},
        "lora": {"freq_mhz": 868, "state": "listening", "pkts_per_h": 14},
        "sdr":  {"kind": "RTL.SDR", "state": "idle", "jobs": 0},
        "bt":   {"state": "disabled", "reason": "power_save"},
    }


def storage_summary() -> dict:
    """Static synthetic storage block. Sprint 17 SYSTEM may refine."""
    return {
        "used_gb": 412,
        "total_gb": 512,
        "breakdown": {"archives_gb": 142, "models_gb": 14, "system_gb": 6, "other_gb": 250},
        "smart_status": "healthy",
    }


# --------------------------------------------------------------------- #
# REST blueprint — Sprint 3 read-only canary endpoints.
# --------------------------------------------------------------------- #

from flask import Blueprint, jsonify, request  # noqa: E402

power_bp = Blueprint("power", __name__, url_prefix="/api/p")


@power_bp.route("/now", methods=["GET"])
def _now():
    """One snapshot, taken on demand. HOT cache class — no caching at
    the transport layer; the shell polls every POWER_POLL_S seconds."""
    return jsonify(read_sample().to_wire())


@power_bp.route("/history", methods=["GET"])
def _history_endpoint():
    """Return a window of recent samples. Query params:
        range:   seconds back (default 86400 = 24 h)
        buckets: optional cap on samples returned (sparkline width)
    """
    rng = int(request.args.get("range", 24 * 3600))
    buckets_arg = request.args.get("buckets")
    buckets = int(buckets_arg) if buckets_arg else None
    samples = read_history(range_s=rng, buckets=buckets)
    return jsonify([s.to_wire() for s in samples])


@power_bp.route("/radio", methods=["GET"])
def _radio():
    return jsonify(radio_status())


@power_bp.route("/storage", methods=["GET"])
def _storage():
    return jsonify(storage_summary())


def register(app) -> None:
    """Register POWER's REST routes onto a Flask app. Idempotent."""
    if "power" in app.blueprints:
        return
    app.register_blueprint(power_bp)
