"""
OVERSEER LoRa Dictionary Trainer — builds a zstd compression dictionary from ZIM content.

Fetches sample articles from kiwix-serve, extracts plain text, and trains
a zstd compression dictionary optimised for the content the LoRa relay will
actually be transmitting.

Usage:
    py train_dictionary.py [--kiwix-url http://localhost:8080] [--samples 1000] [--output lora_dict.zstd]

The dictionary should be trained once during setup and deployed to both the
OPi 5 Max and each Pi Zero relay.
"""

import argparse
import re
import sys
import random
import requests
import zstandard as zstd
from html.parser import HTMLParser
from pathlib import Path


# ── HTML text extraction (standalone, no Flask dependency) ────────────────

class TextExtractor(HTMLParser):
    """Strip HTML to plain text, matching the LoRa relay's content pipeline."""

    def __init__(self):
        super().__init__()
        self.parts = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav", "footer"):
            self._skip = True
        if tag == "br":
            self.parts.append("\n")
        if tag == "p":
            self.parts.append("\n\n")
        if tag in ("h1", "h2", "h3", "h4"):
            self.parts.append("\n\n")
        if tag == "li":
            self.parts.append("\n  - ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "footer"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)

    def get_text(self) -> str:
        text = "".join(self.parts).strip()
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"  +", " ", text)
        return text


def html_to_text(html: str) -> str:
    """Convert HTML to plain text."""
    extractor = TextExtractor()
    extractor.feed(html)
    return extractor.get_text()


# ── Sample fetching ───────────────────────────────────────────────────────

def get_books(kiwix_url: str) -> list[dict]:
    """Get list of available ZIM books from kiwix-serve OPDS catalog."""
    try:
        resp = requests.get(f"{kiwix_url}/catalog/search?count=100", timeout=10)
        if resp.status_code != 200:
            return []
        # Parse OPDS entries for book names
        books = re.findall(r'<name>([^<]+)</name>', resp.text)
        if not books:
            # Fallback: try the simpler endpoint
            books = re.findall(r'"name"\s*:\s*"([^"]+)"', resp.text)
        return [{"name": b} for b in books]
    except requests.ConnectionError:
        return []


def search_articles(kiwix_url: str, query: str, book: str = "", limit: int = 30) -> list[str]:
    """Search kiwix-serve and return article paths."""
    params = {"pattern": query, "pageLength": limit}
    if book:
        params["books.name"] = book

    try:
        resp = requests.get(f"{kiwix_url}/search", params=params, timeout=10)
        if resp.status_code != 200:
            return []
        paths = re.findall(r'href="(/content/[^"]*)"', resp.text)
        return list(dict.fromkeys(paths))  # deduplicate preserving order
    except requests.ConnectionError:
        return []


def fetch_article_text(kiwix_url: str, path: str) -> str:
    """Fetch an article and return stripped plain text."""
    try:
        resp = requests.get(f"{kiwix_url}{path}", timeout=15, allow_redirects=True)
        resp.encoding = "utf-8"
        if resp.status_code != 200:
            return ""
        return html_to_text(resp.text)
    except (requests.ConnectionError, requests.Timeout):
        return ""


# ── Dictionary training ──────────────────────────────────────────────────

# Search terms covering survival-relevant topics across ZIM archives
TRAINING_QUERIES = [
    # Medical
    "first aid", "wound care", "fracture treatment", "infection", "dehydration",
    "snake bite", "burns", "hypothermia", "CPR", "antibiotics", "suturing",
    "blood pressure", "fever", "diarrhea", "pain management",
    # Survival
    "water purification", "fire starting", "shelter", "food preservation",
    "navigation", "compass", "solar", "battery", "generator",
    "radio", "antenna", "frequency", "morse code",
    # Repair/Engineering
    "engine repair", "welding", "electrical wiring", "plumbing",
    "circuit board", "soldering", "voltage", "resistance",
    "pump", "filter", "valve", "bearing",
    # Agriculture
    "crop rotation", "composting", "seed saving", "irrigation",
    "chicken", "goat", "soil", "fertilizer", "harvest",
    # General knowledge
    "history", "geography", "chemistry", "physics", "biology",
    "cooking", "bread", "fermentation", "smoking meat", "canning",
    # Common words (to train on general vocabulary)
    "the", "important", "treatment", "system", "method",
]


def collect_samples(kiwix_url: str, target_count: int) -> list[bytes]:
    """Collect text samples from kiwix-serve for dictionary training."""
    samples = []
    article_paths = set()

    print(f"Collecting ~{target_count} text samples from {kiwix_url}...")

    # Gather article paths from search queries
    for query in TRAINING_QUERIES:
        paths = search_articles(kiwix_url, query, limit=20)
        article_paths.update(paths)
        sys.stdout.write(f"\r  Discovered {len(article_paths)} articles...")
        sys.stdout.flush()
        if len(article_paths) >= target_count * 2:
            break

    print(f"\n  Found {len(article_paths)} unique articles")

    if not article_paths:
        print("  WARNING: No articles found. Is kiwix-serve running?")
        return []

    # Shuffle and fetch articles
    paths_list = list(article_paths)
    random.shuffle(paths_list)

    for i, path in enumerate(paths_list[:target_count]):
        text = fetch_article_text(kiwix_url, path)
        if len(text) > 100:  # skip very short articles
            # Split long articles into ~500-byte chunks (simulating LoRa payload sizes)
            text_bytes = text.encode("utf-8")
            for offset in range(0, len(text_bytes), 500):
                chunk = text_bytes[offset : offset + 500]
                if len(chunk) > 50:
                    samples.append(chunk)

        if (i + 1) % 10 == 0:
            sys.stdout.write(f"\r  Fetched {i+1}/{min(len(paths_list), target_count)} articles, {len(samples)} samples...")
            sys.stdout.flush()

    print(f"\n  Collected {len(samples)} text samples ({sum(len(s) for s in samples) / 1024:.0f} KB)")
    return samples


def train_dict(samples: list[bytes], dict_size: int = 32768) -> bytes:
    """Train a zstd dictionary from text samples."""
    if not samples:
        raise ValueError("No samples to train from")

    print(f"Training zstd dictionary ({dict_size // 1024}KB target) from {len(samples)} samples...")
    dict_data = zstd.train_dictionary(dict_size, samples)
    print(f"  Dictionary trained: {len(dict_data.as_bytes())} bytes")
    return dict_data.as_bytes()


def test_dictionary(dict_bytes: bytes, samples: list[bytes]) -> None:
    """Test dictionary compression performance on sample data."""
    dict_data = zstd.ZstdCompressionDict(dict_bytes)
    compressor_dict = zstd.ZstdCompressor(level=19, dict_data=dict_data)
    compressor_plain = zstd.ZstdCompressor(level=19)

    # Test on a subset of samples
    test_samples = random.sample(samples, min(200, len(samples)))

    total_original = 0
    total_dict = 0
    total_plain = 0

    for sample in test_samples:
        total_original += len(sample)
        total_dict += len(compressor_dict.compress(sample))
        total_plain += len(compressor_plain.compress(sample))

    ratio_dict = total_dict / total_original * 100
    ratio_plain = total_plain / total_original * 100

    print(f"\nCompression test on {len(test_samples)} samples:")
    print(f"  Original:        {total_original:>8,} bytes")
    print(f"  zstd (no dict):  {total_plain:>8,} bytes ({ratio_plain:.1f}%)")
    print(f"  zstd (with dict): {total_dict:>8,} bytes ({ratio_dict:.1f}%)")
    print(f"  Dictionary gain:  {ratio_plain - ratio_dict:.1f} percentage points better")


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train zstd compression dictionary from ZIM content")
    parser.add_argument("--kiwix-url", default="http://localhost:8080", help="kiwix-serve URL")
    parser.add_argument("--samples", type=int, default=500, help="Number of articles to fetch")
    parser.add_argument("--dict-size", type=int, default=32768, help="Dictionary size in bytes")
    parser.add_argument("--output", default="lora_dict.zstd", help="Output dictionary file")
    args = parser.parse_args()

    # Collect samples
    samples = collect_samples(args.kiwix_url, args.samples)
    if not samples:
        print("ERROR: No samples collected. Ensure kiwix-serve is running.")
        sys.exit(1)

    # Train dictionary
    dict_bytes = train_dict(samples, args.dict_size)

    # Test performance
    test_dictionary(dict_bytes, samples)

    # Save
    output_path = Path(args.output)
    output_path.write_bytes(dict_bytes)
    print(f"\nDictionary saved to {output_path} ({len(dict_bytes):,} bytes)")
    print("Deploy this file to both OPi 5 Max and all Pi Zero relays.")


if __name__ == "__main__":
    main()
