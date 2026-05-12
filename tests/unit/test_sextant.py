"""Parity test: tests/fixtures/sextant_fixtures.py renders are stable
across runs (regression guard). The JS port test (smoke harness or
node-side) re-runs the same fixtures via shell/src/sextant/."""

from __future__ import annotations

import json
from pathlib import Path

FIX = Path(__file__).resolve().parents[1] / "fixtures"


def test_fixture_file_exists():
    assert (FIX / "sextant_fixtures.json").exists(), "Run python tests/fixtures/sextant_fixtures.py"
    assert (FIX / "sextant_input_bitmaps.json").exists()


def test_python_renders_are_stable():
    """Re-render and compare against the on-disk fixtures."""
    import sys
    sys.path.insert(0, str(FIX))
    import sextant_fixtures as sf

    expected = json.loads((FIX / "sextant_fixtures.json").read_text(encoding="utf-8"))
    for name, bm in sf.FIXTURES.items():
        got = sf.rasterize(bm)
        assert got == expected[name], f"fixture {name} drifted"
