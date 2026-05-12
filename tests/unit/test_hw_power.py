"""Tests for the Sprint 22 POWER hardware adapters.

The real adapters lazy-import smbus2; CI doesn't have it installed, so
construction normally takes the fallback path. These tests inject a
fake bus when we need to exercise the register-read math.
"""
from __future__ import annotations

import pytest

from server.modules import power as P


# --------------------------------------------------------------------- #
# Fakes
# --------------------------------------------------------------------- #

class _FakeBus:
    """Records writes; returns canned values for reads."""

    def __init__(self, *, bus_v_raw=0x2EE0, current_raw=0x0100):
        self._bus_v_raw = bus_v_raw      # INA226 BUS_V register value
        self._current_raw = current_raw  # INA226 CURRENT register value
        self.writes: list[tuple[int, int, int]] = []

    @staticmethod
    def _swap_be(word: int) -> int:
        return ((word & 0xFF) << 8) | ((word >> 8) & 0xFF)

    def read_word_data(self, addr: int, reg: int) -> int:
        # Adapter swaps bytes before reading; return values pre-swapped so
        # the post-swap value equals our canned raw.
        if reg == 0x02:                 # BUS_V
            return self._swap_be(self._bus_v_raw)
        if reg == 0x04:                 # CURRENT
            return self._swap_be(self._current_raw & 0xFFFF)
        return 0

    def write_word_data(self, addr: int, reg: int, value: int) -> None:
        self.writes.append((addr, reg, value))


class _FakeADC:
    """Stand-in for an ADS1115; returns canned per-channel values."""

    def __init__(self, *, bus_raw=10000, shunt_raw=500):
        self.bus_raw = bus_raw
        self.shunt_raw = shunt_raw
        self.writes: list[tuple[int, int, list[int]]] = []

    def write_i2c_block_data(self, addr: int, reg: int, data: list[int]) -> None:
        self.writes.append((addr, reg, data))

    def read_word_data(self, addr: int, reg: int) -> int:
        # Caller alternates bus then shunt; we cheat with a length counter.
        # Reading the BE-swapped raw + bit 16 sign convention used by the
        # adapter: we provide pre-swapped values.
        if len(self.writes) % 2 == 1:           # latest write was bus_channel
            val = self.bus_raw
        else:
            val = self.shunt_raw
        return ((val & 0xFF) << 8) | ((val >> 8) & 0xFF)


# --------------------------------------------------------------------- #
# INA226 source
# --------------------------------------------------------------------- #

def test_ina226_constructs_with_fallback_when_smbus2_missing():
    """smbus2 is not in the test deps; source must fall back gracefully."""
    src = P.Ina226Source()
    assert src._synth_fallback is not None
    assert "smbus2" in (src.last_error or "")
    # read_sample still returns a valid Sample shape via the fallback.
    s = src.read_sample(now=1_700_000_000).to_wire()
    assert {"batt_pct", "draw_w", "cpu", "temp_c"} <= set(s.keys())


def test_ina226_register_math_with_fake_bus():
    """With a fake I2C bus injected, the math should match the data-sheet
    conversions: bus_v = raw × 1.25 mV; current = raw × current_lsb."""
    src = P.Ina226Source(shunt_ohms=0.01, max_current_a=20.0)
    src._synth_fallback = None              # disable the fallback we got at init
    fake = _FakeBus(bus_v_raw=0x2EE0, current_raw=0x0100)
    src._bus = fake
    rail = src._read_rail()
    # 0x2EE0 = 12000 → 12000 × 0.00125 V = 15.0 V
    assert rail.bus_v == pytest.approx(15.0, abs=1e-6)
    # 0x0100 = 256 → 256 × (20/32768) = 0.15625 A
    expected_current = 256 * (20.0 / 32768.0)
    assert rail.current_a == pytest.approx(expected_current, abs=1e-6)


def test_ina226_negative_current_is_signed():
    """Current register is signed 16-bit. A two's-complement value > 0x8000
    must come back negative (charging, by adapter convention)."""
    src = P.Ina226Source(shunt_ohms=0.01, max_current_a=20.0)
    src._synth_fallback = None
    fake = _FakeBus(bus_v_raw=0x2EE0, current_raw=0xFF00)
    src._bus = fake
    rail = src._read_rail()
    assert rail.current_a < 0


def test_ina226_read_failure_attaches_fallback():
    """If read_word_data raises, the adapter switches to synthetic in place."""
    src = P.Ina226Source()
    src._synth_fallback = None
    class _Boom:
        def read_word_data(self, *a, **kw): raise OSError("I2C bus error")
        def write_word_data(self, *a, **kw): pass
    src._bus = _Boom()
    s = src.read_sample(now=1_700_000_000).to_wire()
    # We still got a valid sample (via newly-attached fallback).
    assert "batt_pct" in s
    assert src._synth_fallback is not None
    assert "read failed" in (src.last_error or "")


# --------------------------------------------------------------------- #
# Shunt source
# --------------------------------------------------------------------- #

def test_shunt_falls_back_when_smbus2_missing():
    src = P.ShuntSource()
    assert src._synth_fallback is not None


def test_shunt_math_with_overridden_read_raw():
    """Override read_raw to return canned ADC counts; verify V/A math."""
    src = P.ShuntSource(
        shunt_ohms=0.01, bus_divider=11.0,
        bus_v_full_scale=6.144, shunt_v_full_scale=0.256,
    )
    src._synth_fallback = None

    # 50% of full scale on both channels → bus = 0.5 × 6.144 × 11 = 33.792 V,
    # shunt = 0.5 × 0.256 V → current = 0.128 / 0.01 = 12.8 A
    half = 32767 // 2
    src.read_raw = lambda ch: half  # type: ignore[method-assign]

    sample = src.read_sample(now=1_700_000_000)
    expected_v = 0.5 * 6.144 * 11.0
    expected_a = (0.5 * 0.256) / 0.01
    expected_w = expected_v * expected_a
    # draw_w is the rail product; allow a generous tolerance for rounding.
    assert sample.draw_w == pytest.approx(expected_w, rel=0.01)


def test_shunt_read_failure_falls_back():
    src = P.ShuntSource()
    src._synth_fallback = None
    def _boom(_ch): raise OSError("ADC offline")
    src.read_raw = _boom  # type: ignore[method-assign]
    s = src.read_sample(now=1_700_000_000).to_wire()
    assert "batt_pct" in s
    assert src._synth_fallback is not None


# --------------------------------------------------------------------- #
# Selector wiring
# --------------------------------------------------------------------- #

def test_select_source_routes_ina226(monkeypatch):
    monkeypatch.setenv("OVERSEER_POWER", "ina226")
    assert isinstance(P._select_source(), P.Ina226Source)


def test_select_source_routes_shunt(monkeypatch):
    monkeypatch.setenv("OVERSEER_POWER", "shunt")
    assert isinstance(P._select_source(), P.ShuntSource)


def test_select_source_default_synthetic(monkeypatch):
    monkeypatch.delenv("OVERSEER_POWER", raising=False)
    assert isinstance(P._select_source(), P.SyntheticSource)
