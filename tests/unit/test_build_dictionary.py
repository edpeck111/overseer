"""Build-dictionary tool: corpus assembled correctly, capped, hashable.

We don't run the script as a subprocess (PYTHONPATH gymnastics on the
hostile-fs dev box); we import the module via importlib and call
``build_corpus()`` directly. The script's __main__ section is exercised
in CI separately.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "build-dictionary.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("_bd", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def test_corpus_is_within_cap():
    bd = _load_module()
    blob = bd.build_corpus()
    assert len(blob) <= bd.DICT_MAX_BYTES


def test_corpus_is_deterministic():
    bd = _load_module()
    a = bd.build_corpus()
    b = bd.build_corpus()
    assert a == b


def test_corpus_contains_vocab_strings():
    bd = _load_module()
    blob = bd.build_corpus()
    for needle in (b"OVERSEER", b"Stay sharp", b"BRAVO-2", b"callsign"):
        assert needle in blob, f"vocab string not in corpus: {needle!r}"


def test_corpus_contains_fixture_payload_bytes():
    bd = _load_module()
    blob = bd.build_corpus()
    # 'inbox_headers.json' has unique strings:
    assert b"rendezvous shift" in blob
    assert b"Cache-7 inventory" in blob
