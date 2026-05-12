"""Runtime configuration — paths, URLs, model names, feature flags.

All values can be overridden by environment variables. Modules import
constants from here rather than hard-coding them.
"""
from __future__ import annotations
import os
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────
_ROOT = Path(__file__).resolve().parents[1]          # repo root

DATA_DIR  = _ROOT / "data"
DB_PATH   = str(DATA_DIR / "overseer.sqlite")

ZIM_DIR   = _ROOT / "zim"
KIWIX_DIR = _ROOT / "kiwix"

# ── Service URLs ───────────────────────────────────────────────────────────
KIWIX_URL  = os.getenv("OVERSEER_KIWIX_URL",  "http://localhost:8080")
OLLAMA_URL = os.getenv("OVERSEER_OLLAMA_URL", "http://localhost:11434")

# ── LLM ────────────────────────────────────────────────────────────────────
OLLAMA_MODEL     = os.getenv("OVERSEER_OLLAMA_MODEL", "qwen2.5:7b-instruct-q4_K_M")
OLLAMA_TEMP      = float(os.getenv("OVERSEER_OLLAMA_TEMP", "0.3"))
OLLAMA_CTX_TURNS = int(os.getenv("OVERSEER_OLLAMA_CTX", "6"))

# ── Feature flags ──────────────────────────────────────────────────────────
SIGNAL_SDR   = os.getenv("OVERSEER_SIGNAL_SDR",   "synthetic")   # synthetic | rtlsdr
SIGNAL_LORA  = os.getenv("OVERSEER_SIGNAL_LORA",  "synthetic")   # synthetic | meshtastic
SIGNAL_ADSB  = os.getenv("OVERSEER_SIGNAL_ADSB",  "synthetic")   # synthetic | dump1090
SIGNAL_APRS  = os.getenv("OVERSEER_SIGNAL_APRS",  "synthetic")   # synthetic | direwolf

LOG_LLM      = os.getenv("OVERSEER_LOG_LLM",      "synthetic")   # synthetic | ollama
LOG_OCR      = os.getenv("OVERSEER_LOG_OCR",       "synthetic")   # synthetic | tesseract
INV_UPC      = os.getenv("OVERSEER_INV_UPC",       "synthetic")   # synthetic | local
INV_PACK     = os.getenv("OVERSEER_INV_PACK",       "synthetic")  # synthetic | real
