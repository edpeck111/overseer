"""
OVERSEER LoRa Bridge — Server-side daemon connecting Meshtastic to OVERSEER.

Uses the meshtastic Python library over USB serial to a Heltec V3 (or similar).
Listens for text messages, parses command prefixes, routes to Ollama/Kiwix,
and sends responses back over the mesh.

Message format (text-based, rides on Meshtastic's own protocol):
  Chat:     [CALLSIGN] message text
  LLM:      [CALLSIGN] /ask question text
  KB search:[CALLSIGN] /search query
  KB fetch: [CALLSIGN] /read /content/wikimed/Article_Name

Responses:
  Chat:     [OVERSEER] response text
  LLM:      [LLM:RESP] full response (short)
            [LLM:PART:1/5] chunk... (long, multi-message)
  KB:       [KB:RESULTS] JSON array of {title, link, source}
            [KB:ARTICLE] full text (short)
            [KB:PART:1/10] chunk... (long, multi-message)

Runs as a background thread within the Flask server.
"""

import sqlite3
import time
import json
import uuid
import threading
import logging
import re
import requests
from html.parser import HTMLParser

log = logging.getLogger("lora_bridge")

# ── Configuration ─────────────────────────────────────────────────────────

KIWIX_URL = "http://localhost:8080"
OLLAMA_URL = "http://localhost:11434"
MODEL = "qwen2.5:7b-instruct-q4_K_M"
MAX_MSG_LEN = 220  # Meshtastic max text message ~228 bytes, leave room for headers
MAX_RESPONSE_PARTS = 20  # Max chunks for a long response


# ── HTML text stripper ────────────────────────────────────────────────────

class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav", "footer"):
            self._skip = True
        if tag == "br": self.parts.append("\n")
        if tag == "p": self.parts.append("\n\n")
        if tag in ("h1", "h2", "h3", "h4"): self.parts.append("\n\n")
        if tag == "li": self.parts.append("\n  - ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "footer"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)

    def get_text(self):
        text = "".join(self.parts).strip()
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"  +", " ", text)
        return text


def html_to_text(html):
    ext = _TextExtractor()
    ext.feed(html)
    return ext.get_text()


# ── Message Chunking ──────────────────────────────────────────────────────

def chunk_response(text, prefix, max_len=MAX_MSG_LEN, max_parts=MAX_RESPONSE_PARTS):
    """Split a long response into numbered parts.

    Short responses (fit in one message): returns ["{prefix} text"]
    Long responses: returns ["[PREFIX:PART:1/N] chunk", "[PREFIX:PART:2/N] chunk", ...]
    """
    # Try single message first
    single = f"{prefix} {text}"
    if len(single.encode("utf-8")) <= max_len:
        return [single]

    # Need to chunk — calculate overhead per part
    # Format: [PREFIX:PART:XX/YY] (max ~20 bytes overhead)
    parts = []
    remaining = text
    # First pass: estimate how many parts
    usable = max_len - 25  # room for part header
    estimated_parts = min((len(remaining.encode("utf-8")) // usable) + 1, max_parts)

    part_num = 0
    while remaining and part_num < max_parts:
        part_num += 1
        # Binary-safe chunking: encode, slice bytes, find safe UTF-8 boundary
        remaining_bytes = remaining.encode("utf-8")
        if len(remaining_bytes) <= usable:
            chunk = remaining
            remaining = ""
        else:
            # Find a good split point (don't split mid-character)
            split_at = usable
            while split_at > 0 and (remaining_bytes[split_at] & 0xC0) == 0x80:
                split_at -= 1
            chunk = remaining_bytes[:split_at].decode("utf-8", errors="ignore")
            remaining = remaining_bytes[split_at:].decode("utf-8", errors="ignore")
        parts.append(chunk)

    # Format with part numbers (now we know the real total)
    total = len(parts)
    tag = prefix.strip("[]")
    return [f"[{tag}:PART:{i+1}/{total}] {p}" for i, p in enumerate(parts)]


# ── Bridge Core ──────────────────────────────────────────────────────────

class LoraBridge:
    """Connects Meshtastic to OVERSEER — handles chat, LLM, and Knowledge relay."""

    def __init__(self, db_path, kiwix_url=KIWIX_URL, ollama_url=OLLAMA_URL, serial_port=None):
        self.db_path = db_path
        self.kiwix_url = kiwix_url
        self.ollama_url = ollama_url
        self.model = MODEL
        self.serial_port = serial_port
        self._interface = None
        self._running = False
        self._lock = threading.Lock()

    def _get_db(self):
        db = sqlite3.connect(self.db_path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        return db

    # ── Startup ───────────────────────────────────────────────────────

    def start(self):
        """Start the bridge. Connects to Meshtastic radio via USB serial."""
        self._running = True

        try:
            import meshtastic.serial_interface
            if self.serial_port:
                self._interface = meshtastic.serial_interface.SerialInterface(self.serial_port)
            else:
                self._interface = meshtastic.serial_interface.SerialInterface()

            # Register message handler
            from pubsub import pub
            pub.subscribe(self._on_receive, "meshtastic.receive.text")

            log.info(f"LoRa bridge started — connected to Meshtastic radio")
            my_info = self._interface.getMyNodeInfo()
            if my_info:
                log.info(f"  Node: {my_info.get('user', {}).get('longName', 'unknown')}")
                log.info(f"  ID: {my_info.get('num', 'unknown')}")

        except ImportError:
            log.warning("meshtastic library not installed — bridge running in offline mode")
            log.warning("Install with: pip install meshtastic")
        except Exception as e:
            log.warning(f"Could not connect to Meshtastic radio: {e}")
            log.warning("Bridge running in offline mode — will process commands from DB only")

    def stop(self):
        self._running = False
        if self._interface:
            try:
                self._interface.close()
            except Exception:
                pass

    # ── Incoming Message Handler ──────────────────────────────────────

    def _on_receive(self, packet, interface):
        """Called by meshtastic library when a text message arrives."""
        try:
            text = packet.get("decoded", {}).get("text", "")
            from_node = packet.get("fromId", "")
            from_num = packet.get("from", 0)

            if not text:
                return

            log.info(f"LoRa RX from {from_node}: {text[:80]}...")

            # Parse callsign prefix: [CALLSIGN] message
            callsign = "UNKNOWN"
            body = text
            m = re.match(r'^\[([^\]]+)\]\s*([\s\S]*)', text)
            if m:
                callsign = m.group(1)
                body = m.group(2)

            # Route commands
            if body.startswith("/ask "):
                query = body[5:].strip()
                if query:
                    threading.Thread(
                        target=self._handle_ask, args=(query, callsign, from_num),
                        daemon=True
                    ).start()
            elif body.startswith("/search "):
                query = body[8:].strip()
                if query:
                    threading.Thread(
                        target=self._handle_search, args=(query, callsign, from_num),
                        daemon=True
                    ).start()
            elif body.startswith("/read "):
                path = body[6:].strip()
                if path:
                    threading.Thread(
                        target=self._handle_read, args=(path, callsign, from_num),
                        daemon=True
                    ).start()
            else:
                # Regular chat message — store in DB
                self._store_message(callsign, body, from_num)

        except Exception as e:
            log.error(f"Error handling incoming message: {e}")

    # ── Send Response ─────────────────────────────────────────────────

    def _send(self, text, to_node=None):
        """Send a text message over Meshtastic."""
        if not self._interface:
            log.warning(f"No radio — would send: {text[:80]}...")
            return

        with self._lock:
            try:
                if to_node:
                    self._interface.sendText(text, destinationId=to_node)
                else:
                    self._interface.sendText(text)
                # Small delay between messages to avoid flooding the radio
                time.sleep(1.5)
            except Exception as e:
                log.error(f"Send failed: {e}")

    def _send_chunked(self, text, prefix, to_node=None):
        """Send a potentially long response, chunked if needed."""
        parts = chunk_response(text, prefix)
        for part in parts:
            self._send(part, to_node)

    # ── Command Handlers ──────────────────────────────────────────────

    def _handle_ask(self, query, callsign, from_num):
        """Handle /ask — run RAG pipeline, send response."""
        log.info(f"LLM query from {callsign}: {query[:60]}...")
        try:
            # Search Kiwix for context
            context = self._search_kiwix_context(query)

            # Build prompt
            prompt = query
            if context:
                prompt = (
                    f"Retrieved knowledge base passages:\n\n{context}\n\n---\n\n"
                    f"User question: {query}\n\n"
                    f"Answer concisely and practically using the above context where relevant. "
                    f"Keep under 500 words."
                )

            # Query Ollama (non-streaming)
            resp = requests.post(
                f"{self.ollama_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": "You are OVERSEER, an offline survival knowledge assistant. Answer concisely and practically."},
                        {"role": "user", "content": prompt},
                    ],
                    "stream": False,
                },
                timeout=120,
            )

            if resp.status_code != 200:
                self._send("[LLM:RESP] Query failed — server error.", from_num)
                return

            data = resp.json()
            answer = data.get("message", {}).get("content", "No response generated.")

            # Truncate very long answers
            if len(answer) > 4000:
                answer = answer[:4000] + "\n\n[Truncated]"

            self._send_chunked(answer, "[LLM:RESP]", from_num)
            log.info(f"LLM response sent to {callsign}: {len(answer)} chars")

        except Exception as e:
            log.error(f"LLM query failed: {e}")
            self._send(f"[LLM:RESP] Query failed: {str(e)[:100]}", from_num)

    def _handle_search(self, query, callsign, from_num):
        """Handle /search — search Kiwix, send results."""
        log.info(f"KB search from {callsign}: {query}")
        try:
            params = {"pattern": query, "pageLength": 10}
            resp = requests.get(f"{self.kiwix_url}/search", params=params, timeout=10)

            results = []
            if resp.status_code == 200:
                links = re.findall(r'href="(/content/[^"]*)"[^>]*>([^<]*)', resp.text)
                seen = set()
                for link, title in links:
                    title = title.strip()
                    if link not in seen and title:
                        seen.add(link)
                        source = link.split("/")[2] if len(link.split("/")) > 2 else ""
                        results.append({"title": title, "link": link, "source": source})
                        if len(results) >= 8:
                            break

            results_json = json.dumps(results)
            self._send_chunked(results_json, "[KB:RESULTS]", from_num)
            log.info(f"KB search results: {len(results)} hits")

        except Exception as e:
            log.error(f"KB search failed: {e}")
            self._send("[KB:RESULTS] []", from_num)

    def _handle_read(self, path, callsign, from_num):
        """Handle /read — fetch article, strip HTML, send text."""
        log.info(f"KB fetch from {callsign}: {path}")
        try:
            resp = requests.get(f"{self.kiwix_url}{path}", timeout=15, allow_redirects=True)
            resp.encoding = "utf-8"

            if resp.status_code != 200:
                self._send(f"[KB:ARTICLE] Article not found (HTTP {resp.status_code})", from_num)
                return

            text = html_to_text(resp.text)

            # Truncate very long articles
            if len(text) > 4000:
                text = text[:4000] + "\n\n[Article truncated for LoRa transmission]"

            self._send_chunked(text, "[KB:ARTICLE]", from_num)
            log.info(f"KB article sent: {len(text)} chars")

        except Exception as e:
            log.error(f"KB fetch failed: {e}")
            self._send(f"[KB:ARTICLE] Fetch failed: {str(e)[:100]}", from_num)

    # ── Kiwix Context Search (for RAG) ────────────────────────────────

    def _search_kiwix_context(self, query, max_results=3):
        """Search Kiwix for RAG context."""
        try:
            stopwords = {"how", "do", "i", "a", "an", "the", "is", "it", "to", "in", "of", "for",
                         "and", "or", "what", "where", "when", "why", "can", "you", "me", "my"}
            keywords = [w for w in query.lower().split() if w not in stopwords and len(w) > 1]
            search_query = " ".join(keywords) if keywords else query

            params = {"pattern": search_query, "pageLength": max_results}
            resp = requests.get(f"{self.kiwix_url}/search", params=params, timeout=10)
            if resp.status_code != 200:
                return ""

            links = re.findall(r'href="(/content/[^"]*)"', resp.text)
            context_parts = []
            for link in links[:max_results]:
                try:
                    art = requests.get(f"{self.kiwix_url}{link}", timeout=10, allow_redirects=True)
                    art.encoding = "utf-8"
                    if art.status_code == 200:
                        text = html_to_text(art.text)[:1200]
                        if text:
                            context_parts.append(text)
                except Exception:
                    continue

            return "\n\n---\n\n".join(context_parts)
        except Exception:
            return ""

    # ── Message Storage ───────────────────────────────────────────────

    def _store_message(self, callsign, body, from_node):
        """Store a chat message in the OVERSEER database."""
        db = self._get_db()
        try:
            # Find or note the user
            user = db.execute("SELECT id FROM users WHERE callsign = ?", (callsign,)).fetchone()
            if not user:
                log.info(f"Unknown callsign '{callsign}' from node {from_node} — message stored but user not registered")
                return

            # Store as message to OVERSEER (admin user, id=1 typically)
            overseer = db.execute("SELECT id FROM users WHERE callsign = 'OVERSEER'").fetchone()
            if not overseer:
                return

            msg_uuid = str(uuid.uuid4())[:8]
            db.execute(
                "INSERT INTO messages (from_user, to_user, body, sent_at, delivery_status, source, msg_uuid) "
                "VALUES (?, ?, ?, ?, 'delivered', 'lora', ?)",
                (user["id"], overseer["id"], body, time.time(), msg_uuid),
            )
            db.commit()
            log.info(f"Stored LoRa chat from {callsign}: {body[:50]}...")
        finally:
            db.close()

    # ── Send chat from web UI over LoRa ───────────────────────────────

    def send_chat(self, from_callsign, body, to_node=None):
        """Send a chat message from the OVERSEER web UI out over LoRa."""
        wire_text = f"[{from_callsign}] {body}"
        self._send(wire_text, to_node)


# ── Module-level bridge instance ─────────────────────────────────────────

_bridge = None


def init(db_path, serial_port=None, **kwargs):
    """Initialize and start the LoRa bridge."""
    global _bridge
    _bridge = LoraBridge(db_path, serial_port=serial_port, **kwargs)
    _bridge.start()
    return _bridge


def get_bridge():
    return _bridge
