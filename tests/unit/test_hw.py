"""Tests for server/hw.py — hardware backend detection. Sprint 20."""
import os
import warnings
import pytest


@pytest.fixture(autouse=True)
def _clean_env():
    """Remove all OVERSEER_* env vars before each test."""
    keys = [k for k in os.environ if k.startswith("OVERSEER_")]
    saved = {k: os.environ.pop(k) for k in keys}
    yield
    os.environ.update(saved)


class TestDefaults:
    def test_sdr_default_synthetic(self):
        from server.hw import sdr_backend
        assert sdr_backend() == "synthetic"

    def test_lora_default_synthetic(self):
        from server.hw import lora_backend
        assert lora_backend() == "synthetic"

    def test_mesh_default_synthetic(self):
        from server.hw import mesh_backend
        assert mesh_backend() == "synthetic"

    def test_gps_default_synthetic(self):
        from server.hw import gps_backend
        assert gps_backend() == "synthetic"

    def test_power_default_synthetic(self):
        from server.hw import power_backend
        assert power_backend() == "synthetic"

    def test_display_default_headless(self):
        from server.hw import display_backend
        assert display_backend() == "headless"


class TestEnvOverrides:
    def test_sdr_rtlsdr(self):
        from server.hw import sdr_backend
        os.environ["OVERSEER_SDR"] = "rtlsdr"
        assert sdr_backend() == "rtlsdr"

    def test_lora_sx1262(self):
        from server.hw import lora_backend
        os.environ["OVERSEER_LORA"] = "sx1262"
        assert lora_backend() == "sx1262"

    def test_mesh_meshtastic(self):
        from server.hw import mesh_backend
        os.environ["OVERSEER_MESH"] = "meshtastic"
        assert mesh_backend() == "meshtastic"

    def test_gps_gpsd(self):
        from server.hw import gps_backend
        os.environ["OVERSEER_GPS"] = "gpsd"
        assert gps_backend() == "gpsd"

    def test_power_ina226(self):
        from server.hw import power_backend
        os.environ["OVERSEER_POWER"] = "ina226"
        assert power_backend() == "ina226"

    def test_display_epaper(self):
        from server.hw import display_backend
        os.environ["OVERSEER_DISPLAY"] = "epaper"
        assert display_backend() == "epaper"

    def test_unknown_value_falls_back_to_default(self):
        from server.hw import sdr_backend
        os.environ["OVERSEER_SDR"] = "unknown_radio"
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = sdr_backend()
        assert result == "synthetic"
        assert len(w) == 1
        assert "unknown_radio" in str(w[0].message)

    def test_case_insensitive(self):
        from server.hw import sdr_backend
        os.environ["OVERSEER_SDR"] = "RTLSDR"
        assert sdr_backend() == "rtlsdr"


class TestHwInfo:
    def test_hw_info_returns_all_keys(self):
        from server.hw import hw_info
        info = hw_info()
        assert set(info.keys()) == {"sdr", "lora", "mesh", "gps", "power", "display"}

    def test_hw_info_all_synthetic_by_default(self):
        from server.hw import hw_info
        info = hw_info()
        assert info["sdr"] == "synthetic"
        assert info["lora"] == "synthetic"
        assert info["display"] == "headless"

    def test_any_real_hardware_false_by_default(self):
        from server.hw import any_real_hardware
        assert any_real_hardware() is False

    def test_any_real_hardware_true_when_sdr_set(self):
        from server.hw import any_real_hardware
        os.environ["OVERSEER_SDR"] = "rtlsdr"
        assert any_real_hardware() is True


# -- end of test --
