"""Runtime configuration. Paths, ports, knobs."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]   # v3/app/
DATA_DIR = REPO_ROOT / "data"
SHELL_DIST = REPO_ROOT / "shell" / "dist"


@dataclass(frozen=True)
class Config:
    debug: bool = True
    host: str = "127.0.0.1"
    port: int = 5000

    db_path: Path = DATA_DIR / "overseer.sqlite"
    shell_dist: Path = SHELL_DIST

    # Where archives (ZIM files etc) are mounted. v2 used ./zim ; v3 follows.
    archives_dir: Path = DATA_DIR / "archives"

    # Day counter epoch — D+0 is when the system was first commissioned.
    # Persisted in the DB once initialized; this is the dev fallback.
    day_zero_iso: str = "2025-03-05"

    # Operator label shown in the status strip when no operator is logged in.
    default_operator: str = "ALPHA-1"

    # Status strip display knobs.
    brand: str = "OVERSEER"
    version: str = "v3.0.0-dev"


def from_env() -> Config:
    """Build a Config, allowing env-var overrides for ops use."""
    return Config(
        debug=os.environ.get("OVERSEER_DEBUG", "1") == "1",
        host=os.environ.get("OVERSEER_HOST", "127.0.0.1"),
        port=int(os.environ.get("OVERSEER_PORT", "5000")),
    )
