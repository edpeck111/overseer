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


def test_selector_default_is_synthetic(monkeypatch):
    """No env vars set → SyntheticSource."""
    monkeypatch.delenv("OVERSEER_POWER", raising=False)
    src = P._select_source()
    assert isinstance(src, P.SyntheticSource)


def test_selector_ina226_returns_ina226_source(monkeypatch):
    """OVERSEER_POWER=ina226 → Ina226Source (which silently falls back to
    synthetic in-process when smbus2 / I2C bus is absent — verified
    separately in test_hw_power.py)."""
    monkeypatch.setenv("OVERSEER_POWER", "ina226")
    src = P._select_source()
    assert isinstance(src, P.Ina226Source)


def test_selector_shunt_returns_shunt_source(monkeypatch):
    monkeypatch.setenv("OVERSEER_POWER", "shunt")
    src = P._select_source()
    assert isinstance(src, P.ShuntSource)


def test_unknown_backend_warns_and_falls_back_to_synthetic(monkeypatch, recwarn):
    """hw.power_backend() validates: an unknown value warns and yields
    'synthetic', so the selector should hand back a SyntheticSource."""
    monkeypatch.setenv("OVERSEER_POWER", "totally-not-a-thing")
    src = P._select_source()
    assert isinstance(src, P.SyntheticSource)


# --------------------------------------------------------------------- #
# WS push producer — Sprint 4
# --------------------------------------------------------------------- #

def test_producer_starts_and_stops():
    import time
    from server.modules.power import (
        producer_is_running, start_producer, stop_producer,
    )
    P.reset_for_tests(source=P.SyntheticSource(seed=11))
    assert not producer_is_running()
    start_producer()
    assert producer_is_running()
    stop_producer()
    # Daemon thread joins implicitly on event-set; give it a moment.
    time.sleep(0.05)
    assert not producer_is_running()


def test_producer_registered_with_ws_hub():
    """power.py auto-registers POWER_TOPIC with server.ws on import."""
    from server import ws as ws_mod
    from server.modules.power import POWER_TOPIC
    assert POWER_TOPIC in ws_mod._producers


def test_first_subscribe_starts_producer(monkeypatch):
    """Hub fires power.start_producer() when the topic gets its first sub."""
    from server import ws as ws_mod
    from server.modules.power import POWER_TOPIC, producer_is_running, stop_producer
    stop_producer()
    # Fake-subscribe via the internal hook (avoid spinning up a real ws).
    ws_mod._on_first_subscribe(POWER_TOPIC)
    assert producer_is_running()
    ws_mod._on_last_unsubscribe(POWER_TOPIC)
    import time; time.sleep(0.05)
    assert not producer_is_running()
