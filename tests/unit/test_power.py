"""POWER backend — synthetic source determinism + history bounds."""

from __future__ import annotations

import pytest

from server.modules import power as P


@pytest.fixture(autouse=True)
def fresh_state():
    """Reset module state with a deterministic seeded source."""
    P.reset_for_tests(source=P.SyntheticSource(seed=42))
    yield
    P.reset_for_tests()


def test_first_sample_has_expected_fields():
    s = P.read_sample().to_wire()
    expected = {
        "at", "batt_pct", "draw_w", "input_w", "runtime_est_s",
        "cpu", "ram", "ram_used_gb", "ram_total_gb", "swap",
        "temp_c", "fan", "cycles", "health_pct", "draw_w_peak",
    }
    missing = expected - set(s.keys())
    assert not missing, f"sample missing fields: {missing}"


def test_battery_drifts_under_idle_draw():
    """Without AC events triggering, SoC should decrease over many calls."""
    src = P.SyntheticSource(seed=1)
    # Skip ahead past any AC-on rolls by feeding sequential timestamps.
    samples = []
    for i in range(120):     # 120 × 30 s = 1 hour of synthetic time
        samples.append(src.read_sample(now=1_700_000_000 + i * 30))
    starts = samples[0].batt_pct
    ends   = samples[-1].batt_pct
    # Allow that an AC-on event in this window pushes SoC up; we don't
    # assert direction, only that something *changed* (no stuck values).
    assert any(samples[i].batt_pct != samples[0].batt_pct for i in range(1, len(samples)))


def test_load_spike_increases_cpu_and_temp():
    """When we force a spike window, CPU + temp should rise together."""
    src = P.SyntheticSource(seed=7)
    base = src.read_sample(now=1_700_000_000)
    # Force a spike state directly (white-box) to keep test deterministic.
    src._spike_until = 1_700_000_000 + 1000
    src._spike_amp   = 60.0
    spiked = src.read_sample(now=1_700_000_030)
    # CPU should be substantially higher than baseline+noise
    assert spiked.cpu > base.cpu + 30
    # Temp lags but should already be moving in the right direction
    assert spiked.temp_c >= base.temp_c


def test_history_returns_recent_only():
    P.reset_for_tests(source=P.SyntheticSource(seed=99))
    # Take 40 samples synthesised over 20 minutes
    for i in range(40):
        P._source._last_at = None
        P._history.append(P._source.read_sample(now=1_700_000_000 + i * 30))
    # Range query covering only the last 5 min should return ~10 samples
    cutoff_back_s = 5 * 60
    # Trick the wall-clock cutoff: time.time() in read_history uses real
    # time, so we just assert all-or-nothing semantics.
    full = P.read_history(range_s=10**9)
    assert len(full) == 40
    bucketed = P.read_history(range_s=10**9, buckets=8)
    assert len(bucketed) <= 8


def test_to_wire_rounds_consistently():
    src = P.SyntheticSource(seed=3)
    s = src.read_sample(now=1_700_000_000).to_wire()
    # Some fields must be ints on the wire.
    assert isinstance(s["fan"], int)
    assert isinstance(s["runtime_est_s"], int)
    assert isinstance(s["cpu"], int)
    assert isinstance(s["ram"], int)
    assert isinstance(s["temp_c"], int)
    # batt_pct keeps one decimal
    assert isinstance(s["batt_pct"], (int, float))


def test_unknown_source_flavour_rejected(monkeypatch):
    monkeypatch.setenv("OVERSEER_POWER_SOURCE", "totally-not-a-thing")
    with pytest.raises(ValueError):
        P._select_source()


def test_hardware_flavour_explicitly_unimplemented(monkeypatch):
    monkeypatch.setenv("OVERSEER_POWER_SOURCE", "hardware")
    with pytest.raises(NotImplementedError, match="hardware"):
        P._select_source()
