"""Build the OMP shared Brotli dictionary from sample server responses.

Output: ``server/omp/dictionary.bin`` (≤ 32 KB)

Per Ted's Sprint-2 decision (and 05-OMP-PROTOCOL.md §2.2): the dict is
built fresh from server responses, NOT seeded from the v2
``train_dictionary.py``. The corpus lives at
``server/omp/fixtures/`` as JSON files representing typical server
outputs. Each fixture is loaded, MessagePack-encoded (so the dict
matches the wire format of the bodies it will be used against), and
concatenated. A small hand-curated vocab section is prepended so
high-value keys and phrases get strong matches even if a particular
fixture happens not to use them.

Brotli "shared dictionary" semantics: not a trained model. It is a
plain bytes blob. The encoder uses it as a static back-reference
window — substrings present in the dictionary compress for free.
Bigger dictionary → more potential matches → more RAM on the encoder
side. The 32 KB cap is a Brotli-level upper bound (older versions
allow up to 24 KB; newer ones allow more — we stay conservative for
embedded targets).

Usage:

    python tools/build-dictionary.py              # writes dictionary.bin
    python tools/build-dictionary.py --check-only # exit non-zero if regen needed
    python tools/build-dictionary.py --print-stats

Sprint 4 turns Brotli on by default (codec.compress=True). Until
then this artifact is built but unused on the wire.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import msgpack

# Resolve paths relative to this script so it runs from any cwd.
_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT  = _SCRIPT_DIR.parent
FIXTURES    = _REPO_ROOT / "server" / "omp" / "fixtures"
OUTPUT      = _REPO_ROOT / "server" / "omp" / "dictionary.bin"
HASH_OUTPUT = _REPO_ROOT / "server" / "omp" / "dictionary.sha256"

DICT_MAX_BYTES = 16_384  # 16 KB cap — fits easily in Cardputer flash too

# Hand-curated vocab section — gets prepended so it survives even if
# fixtures change. Each entry is a typical Overseer wire string.
VOCAB = [
    # Common JSON / MsgPack keys
    "from", "to", "subj", "body", "when", "id", "kind", "at",
    "lat", "lon", "alt", "state", "op", "who", "callsign",
    "user_id", "transport", "rssi", "dist_m", "last_seen",
    "batt_pct", "draw_w", "runtime_est_s", "cpu", "ram", "temp_c", "fan",
    "stream_id", "tokens", "citations", "archive", "article", "paragraph",
    "score", "done", "uptime_s", "model", "archives", "size_gb", "articles",
    # Common values
    "OVERSEER", "ALPHA-1", "BRAVO-2", "CHARLIE-7", "DELTA-4", "ECHO-3",
    "wifi", "lora", "sdr", "wifi-direct", "verified", "pending", "delivered",
    # Boards
    "/general", "/intel", "/trade", "/swap", "/sos",
    # LLM idioms (frequent in responses)
    "Stay sharp.", "Field medicine only.", "Cross-referencing archives...",
    "Seek trained personnel if available.", "Avoid first-flush runoff.",
    # Status strip strings
    "SYS:OK", "SYS:DEGRADED", "SYS:FAULT", "MESH", "PWR", "AI", "KB",
    # ANSI escape sequences
    "\x1b[0m", "\x1b[1m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[36m",
]


def build_corpus() -> bytes:
    """Concatenate vocab + fixture msgpack bodies into a corpus blob."""
    parts: list[bytes] = []
    # Vocab as a packed list of strings — preserves key shapes useful
    # for both JSON-style and MsgPack-style payloads.
    parts.append(msgpack.packb(VOCAB, use_bin_type=True))

    if not FIXTURES.exists():
        raise FileNotFoundError(f"fixtures dir not found: {FIXTURES}")
    for fp in sorted(FIXTURES.glob("*.json")):
        with fp.open("r", encoding="utf-8") as f:
            obj = json.load(f)
        parts.append(msgpack.packb(obj, use_bin_type=True))
        # Append again as a JSON snapshot too — doubles the chance of
        # matches against either wire format. The dict gets de-duped
        # implicitly by Brotli's match algorithm.
        parts.append(fp.read_bytes())

    blob = b"".join(parts)
    if len(blob) > DICT_MAX_BYTES:
        # Truncate from the LSB end (later fixtures get clipped first)
        blob = blob[:DICT_MAX_BYTES]
    return blob


def write_dictionary(blob: bytes) -> tuple[Path, str]:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(blob)
    sha = hashlib.sha256(blob).hexdigest()
    HASH_OUTPUT.write_text(sha + "\n")
    return OUTPUT, sha


def print_stats(blob: bytes) -> None:
    """Print dictionary size + a Brotli no-dict baseline for a sample.

    The Python ``brotli`` library does not currently expose
    BrotliEncoderSetCustomDictionary. Sprint 4 picks an alternative
    backend (likely ``brotlicffi``) and adds dict-compressed timing
    here. Today this just prints the no-dict baseline so we have a
    yardstick to revisit once dict support lands.
    """
    import brotli
    sample = json.dumps({
        "id": 1, "from": "BRAVO-2",
        "subj": "Re: rendezvous shift — copy that",
        "body": "Stay sharp. Field medicine only.",
    }).encode()
    raw = brotli.compress(sample, quality=6)
    print(f"dictionary size: {len(blob):,} bytes (cap {DICT_MAX_BYTES:,})")
    print(f"sample message:  {len(sample):,} bytes raw")
    print(f"  brotli no dict:    {len(raw):,} bytes ({len(raw)/len(sample)*100:.1f}%)")
    print(f"  brotli with dict:  Sprint 4 — needs a backend with shared-dict support")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-only", action="store_true",
                    help="Build, compare against on-disk dict; exit 1 if different.")
    ap.add_argument("--print-stats", action="store_true",
                    help="Print compression-ratio comparison after build.")
    args = ap.parse_args(argv)

    blob = build_corpus()

    if args.check_only:
        if not OUTPUT.exists():
            print(f"missing {OUTPUT}", file=sys.stderr)
            return 1
        if OUTPUT.read_bytes() != blob:
            print(f"on-disk dict differs from rebuild. Rerun without --check-only.", file=sys.stderr)
            return 1
        print("dictionary up to date")
        return 0

    path, sha = write_dictionary(blob)
    print(f"wrote {path} ({len(blob):,} bytes, sha256={sha[:16]}...)")
    if args.print_stats:
        print_stats(blob)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
