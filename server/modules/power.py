"""POWER module — battery, load, radio, storage telemetry.

Sprint 3 (canary) ships a clean ``Source`` interface with a synthetic
backend wired in. Real hardware (Jackery USB-C protocol decode, INA226
shunt, psutil battery) plugs in behind the same interface.

Sprint 22 adds INA226 and shunt-ADC adapters and switches the selector
from the local ``OVERSEER_POWER_SOURCE`` flag to the unified
``hw.power_backend()`` (env: ``OVERSEER_POWER`` = ``ina226`` | ``shunt`` |
``synthetic``). Real adapters lazy-import ``smbus2``: if the import
fails or the bus open raises, they log once and fall back to synthetic
so the server still boots on a dev machine.

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
# Real-hardware sources — Sprint 22.
#
# Both INA226 and Shunt sources monitor a single DC rail (battery output
# into the OPi5). They produce a Sample by combining the rail measurement
# with psutil-derived CPU/RAM/thermal numbers. If psutil is unavailable
# the CPU/RAM/thermal fields fall back to the synthetic generator so the
# wire shape stays identical.
#
# Lazy import contract: smbus2 / psutil are imported inside __post_init__.
# On ImportError or open-bus failure the source records the reason in
# .last_error and read_sample() falls back to its embedded synthetic
# generator. This means a dev box without I2C still boots and tests run
# without the wheels installed.
# --------------------------------------------------------------------- #

# INA226 (Texas Instruments) register map.
_INA226_REG_CONFIG        = 0x00
_INA226_REG_SHUNT_V       = 0x01  # signed, 2.5 µV / LSB
_INA226_REG_BUS_V         = 0x02  # 1.25 mV / LSB
_INA226_REG_POWER         = 0x03  # 25 × current LSB W / LSB
_INA226_REG_CURRENT       = 0x04  # signed, current_lsb A / LSB
_INA226_REG_CALIBRATION   = 0x05
_INA226_DEFAULT_ADDR      = 0x40
_INA226_DEFAULT_BUS       = 1


@dataclass
class _RailMeasurement:
    """Single DC-rail snapshot returned by hardware sources."""
    bus_v: float        # Volts, post-shunt
    current_a: float    # Amps; positive = discharging the battery
    timestamp: float


@dataclass
class Ina226Source:
    """Texas Instruments INA226 high-side current/voltage monitor.

    Reads one rail per call. The companion config is written once at
    init: 1.024 ms conversion time, average=16, continuous shunt+bus.

    Parameters
    ----------
    bus_id, addr : I2C bus number + 7-bit device address.
    shunt_ohms   : Shunt resistor value (Ω). 0.01 Ω is the dev-board
                   default; the Jackery harness ships 0.005 Ω.
    max_current_a : Used to compute current_lsb = max_current / 32768.
    capacity_wh   : Battery nominal capacity, drives runtime-estimate.
    """

    bus_id: int = _INA226_DEFAULT_BUS
    addr: int = _INA226_DEFAULT_ADDR
    shunt_ohms: float = 0.01
    max_current_a: float = 20.0
    capacity_wh: float = 2000.0

    _bus: object | None = field(default=None, init=False, repr=False)
    _current_lsb: float = field(default=0.0, init=False, repr=False)
    _synth_fallback: SyntheticSource | None = field(default=None, init=False, repr=False)
    _batt_pct: float = field(default=85.0, init=False, repr=False)
    _draw_peak: float = field(default=0.0, init=False, repr=False)
    last_error: str | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        self._current_lsb = self.max_current_a / 32768.0
        try:
            import smbus2  # type: ignore
        except ImportError as exc:
            self._fallback(f"smbus2 unavailable: {exc}")
            return
        try:
            self._bus = smbus2.SMBus(self.bus_id)
            # Config: avg=16, vbus_ct=1.1 ms, vsh_ct=1.1 ms, mode=continuous shunt+bus.
            self._write_u16(_INA226_REG_CONFIG, 0x4527)
            cal = int(round(0.00512 / (self._current_lsb * self.shunt_ohms)))
            self._write_u16(_INA226_REG_CALIBRATION, cal & 0xFFFF)
        except Exception as exc:  # noqa: BLE001 — any I2C-stack failure
            self._fallback(f"INA226 init failed: {exc}")

    def _fallback(self, reason: str) -> None:
        self.last_error = reason
        import warnings
        warnings.warn(f"OVERSEER POWER: {reason}; using synthetic fallback", stacklevel=2)
        self._synth_fallback = SyntheticSource()

    def _read_rail(self) -> _RailMeasurement:
        bus_raw = self._read_u16(_INA226_REG_BUS_V)
        cur_raw = self._read_i16(_INA226_REG_CURRENT)
        return _RailMeasurement(
            bus_v=bus_raw * 0.00125,                    # 1.25 mV/LSB
            current_a=cur_raw * self._current_lsb,
            timestamp=time.time(),
        )

    def _write_u16(self, reg: int, value: int) -> None:
        # INA226 is big-endian on the wire; SMBus block writes little-endian,
        # so swap bytes for word-data writes.
        swapped = ((value & 0xFF) << 8) | ((value >> 8) & 0xFF)
        self._bus.write_word_data(self.addr, reg, swapped)  # type: ignore[union-attr]

    def _read_u16(self, reg: int) -> int:
        raw = self._bus.read_word_data(self.addr, reg)  # type: ignore[union-attr]
        return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)

    def _read_i16(self, reg: int) -> int:
        u = self._read_u16(reg)
        return u - 0x10000 if u & 0x8000 else u

    def read_sample(self, *, now: float | None = None) -> Sample:
        if self._synth_fallback is not None:
            return self._synth_fallback.read_sample(now=now)
        try:
            rail = self._read_rail()
        except Exception as exc:  # noqa: BLE001
            self._fallback(f"INA226 read failed: {exc}")
            return self._synth_fallback.read_sample(now=now)  # type: ignore[union-attr]
        return _rail_to_sample(
            rail, batt_pct=self._batt_pct, capacity_wh=self.capacity_wh,
            update_peak=self._update_peak,
        )

    def _update_peak(self, draw_w: float) -> float:
        self._draw_peak = max(self._draw_peak * 0.999, draw_w)
        return self._draw_peak


@dataclass
class ShuntSource:
    """Generic shunt + ADC source.

    Reads two ADC channels (bus voltage post-divider, shunt voltage)
    over I2C. Designed against ADS1115 by default; any 16-bit I2C ADC
    with the same address scheme works by overriding ``read_raw``.

    The math is identical to INA226 once converted to volts/amps.
    """

    bus_id: int = 1
    adc_addr: int = 0x48
    shunt_ohms: float = 0.01
    bus_divider: float = 11.0           # Top/bottom resistor divider ratio
    bus_v_full_scale: float = 6.144     # ADS1115 ±6.144 V range
    shunt_v_full_scale: float = 0.256   # ±0.256 V range
    bus_channel: int = 0
    shunt_channel: int = 1
    capacity_wh: float = 2000.0

    _bus: object | None = field(default=None, init=False, repr=False)
    _synth_fallback: SyntheticSource | None = field(default=None, init=False, repr=False)
    _batt_pct: float = field(default=85.0, init=False, repr=False)
    _draw_peak: float = field(default=0.0, init=False, repr=False)
    last_error: str | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        try:
            import smbus2  # type: ignore
        except ImportError as exc:
            self._fallback(f"smbus2 unavailable: {exc}")
            return
        try:
            self._bus = smbus2.SMBus(self.bus_id)
        except Exception as exc:  # noqa: BLE001
            self._fallback(f"ADC bus open failed: {exc}")

    def _fallback(self, reason: str) -> None:
        self.last_error = reason
        import warnings
        warnings.warn(f"OVERSEER POWER: {reason}; using synthetic fallback", stacklevel=2)
        self._synth_fallback = SyntheticSource()

    def read_raw(self, channel: int) -> int:
        """Override-point: returns signed 16-bit ADC reading for channel."""
        # ADS1115: config register write to start single-shot, then read register 0.
        # Minimal placeholder — real hardware deployments will subclass.
        if self._bus is None:
            raise RuntimeError("ADC bus not open")
        # MUX = AINp single-ended to GND; PGA = ±6.144 V; mode = single; rate = 128 SPS.
        config_high = 0x80 | ((4 + channel) << 4) | (0 << 1)  # MUX + PGA
        config_low  = 0x83                                    # rate=128 SPS, comparator off
        self._bus.write_i2c_block_data(self.adc_addr, 0x01, [config_high, config_low])  # type: ignore[union-attr]
        time.sleep(0.009)  # 128 SPS → 7.8 ms
        raw = self._bus.read_word_data(self.adc_addr, 0x00)  # type: ignore[union-attr]
        # ADS1115 is big-endian on the wire.
        raw = ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)
        return raw - 0x10000 if raw & 0x8000 else raw

    def read_sample(self, *, now: float | None = None) -> Sample:
        if self._synth_fallback is not None:
            return self._synth_fallback.read_sample(now=now)
        try:
            bus_raw = self.read_raw(self.bus_channel)
            shunt_raw = self.read_raw(self.shunt_channel)
        except Exception as exc:  # noqa: BLE001
            self._fallback(f"ADC read failed: {exc}")
            return self._synth_fallback.read_sample(now=now)  # type: ignore[union-attr]
        bus_v   = (bus_raw   / 32767.0) * self.bus_v_full_scale * self.bus_divider
        shunt_v = (shunt_raw / 32767.0) * self.shunt_v_full_scale
        rail = _RailMeasurement(
            bus_v=bus_v,
            current_a=shunt_v / self.shunt_ohms,
            timestamp=time.time(),
        )
        return _rail_to_sample(
            rail, batt_pct=self._batt_pct, capacity_wh=self.capacity_wh,
            update_peak=self._update_peak,
        )

    def _update_peak(self, draw_w: float) -> float:
        self._draw_peak = max(self._draw_peak * 0.999, draw_w)
        return self._draw_peak


def _rail_to_sample(rail: _RailMeasurement, *, batt_pct: float,
                    capacity_wh: float, update_peak) -> Sample:
    """Combine a hardware rail measurement with psutil host metrics."""
    draw_w = max(0.0, rail.bus_v * rail.current_a)
    cpu, ram, ram_used_gb, ram_total_gb, swap, temp_c, fan = _host_metrics()
    runtime_s = (
        int(batt_pct / 100.0 * capacity_wh / max(0.1, draw_w) * 3600)
        if draw_w > 0.1 else int(1e9)
    )
    return Sample(
        at=rail.timestamp,
        batt_pct=batt_pct,
        draw_w=draw_w,
        input_w=0.0,                    # bidirectional shunt not modelled yet
        runtime_est_s=runtime_s,
        cpu=cpu, ram=ram, ram_used_gb=ram_used_gb,
        ram_total_gb=ram_total_gb,
        swap=swap,
        temp_c=temp_c,
        fan=fan,
        draw_w_peak=update_peak(draw_w),
    )


def _host_metrics() -> tuple[float, float, float, float, float, float, int]:
    """psutil-backed host metrics; returns plausible defaults if absent."""
    try:
        import psutil  # type: ignore
    except ImportError:
        return 7.0, 61.0, 9.8, 16.0, 2.0, 22.0, 1500
    cpu = psutil.cpu_percent(interval=None) or 7.0
    vm = psutil.virtual_memory()
    ram = vm.percent
    ram_total_gb = vm.total / (1024 ** 3)
    ram_used_gb  = vm.used  / (1024 ** 3)
    sw = psutil.swap_memory()
    swap = sw.percent
    temp_c, fan = 22.0, 1500
    try:
        temps = psutil.sensors_temperatures()  # type: ignore[attr-defined]
        if temps:
            first = next(iter(temps.values()))
            if first:
                temp_c = float(first[0].current)
    except (AttributeError, OSError):
        pass
    try:
        fans = psutil.sensors_fans()  # type: ignore[attr-defined]
        if fans:
            first = next(iter(fans.values()))
            if first:
                fan = int(first[0].current)
    except (AttributeError, OSError):
        pass
    return cpu, ram, ram_used_gb, ram_total_gb, swap, temp_c, fan


# --------------------------------------------------------------------- #
# Module-level state: source + history buffer
# --------------------------------------------------------------------- #

def _select_source() -> Source:
    """Pick a power Source based on hw.power_backend().

    Real adapters absorb their own bring-up errors and fall back to a
    synthetic source internally, so this function does not catch.
    """
    from server import hw
    backend = hw.power_backend()
    if backend == "synthetic":
        return SyntheticSource()
    if backend == "ina226":
        return Ina226Source()
    if backend == "shunt":
        return ShuntSource()
    # hw.power_backend() validates against _POWER_BACKENDS, so any other
    # value means hw.py was edited without updating this dispatch.
    raise ValueError(f"unhandled power backend {backend!r}; update _select_source()")


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


# --------------------------------------------------------------------- #
# WS push producer — lazy daemon thread.
# --------------------------------------------------------------------- #
import threading  # noqa: E402  (intentional late import — keeps module-load cost low)

POWER_TOPIC = "power.now"

_producer_thread: threading.Thread | None = None
_producer_stop: threading.Event | None = None


def _producer_loop():
    """Take a sample every POWER_POLL_S seconds and publish on POWER_TOPIC.

    Sprint 4 cadence is the same 30 s the polling path used in Sprint 3
    (ADR-0008 HOT class). The loop checks the stop event on every wait
    so unsubscribing kills the thread within at most one cadence.
    """
    from server import ws as _ws   # local import — avoids module-load cycle
    while _producer_stop is not None and not _producer_stop.wait(POWER_POLL_S):
        try:
            sample = read_sample()
            _ws.publish(POWER_TOPIC, sample.to_wire())
        except Exception:  # noqa: BLE001 -- swallow; loop continues
            pass


def start_producer() -> None:
    """Lazy-start the producer thread. Idempotent.

    Called by the WS hub when ``power.now`` gets its first subscriber.
    Per Ted's Sprint-4 directive: starts on first subscribe, not at app
    boot, so tests don't accumulate background threads. If a third
    module repeats this pattern, refactor to a generic scheduler.
    """
    global _producer_thread, _producer_stop
    if _producer_thread is not None and _producer_thread.is_alive():
        return
    _producer_stop = threading.Event()
    _producer_thread = threading.Thread(
        target=_producer_loop, daemon=True, name="power-producer",
    )
    _producer_thread.start()


def stop_producer() -> None:
    """Stop the producer thread (called when last subscriber disconnects)."""
    global _producer_thread, _producer_stop
    if _producer_stop is not None:
        _producer_stop.set()
    _producer_thread = None
    _producer_stop = None


def producer_is_running() -> bool:
    return _producer_thread is not None and _producer_thread.is_alive()


# Auto-register with the WS hub on module load. Hub starts the thread
# only when a client actually subscribes.
def _bind_to_ws_hub():
    try:
        from server import ws as _ws
        _ws.register_producer(POWER_TOPIC, start=start_producer, stop=stop_producer)
    except Exception:
        pass


_bind_to_ws_hub()
