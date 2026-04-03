"""
Prepper LLM — Flask RAG server
Connects phone/tablet browser → Kiwix search → Ollama LLM
"""
import json
import requests
import sqlite3
import hashlib
import time
import platform
import subprocess
from flask import Flask, Response, request, render_template, send_from_directory, g
import os

app = Flask(__name__)
SOUNDS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sounds")

OLLAMA_URL = "http://localhost:11434"
KIWIX_URL = "http://localhost:8080"
MODEL = "qwen2.5:7b-instruct-q4_K_M"

# Human-readable labels for known ZIM archives
ZIM_CATALOG = {
    "mdwiki_en_all_maxi": ("Medical Wikipedia", "75,000+ medical articles"),
    "wikipedia_en_all_nopic": ("Wikipedia (No Images)", "Full English Wikipedia — text only"),
    "wikipedia_en_all_maxi": ("Wikipedia (Full)", "Full English Wikipedia with images"),
    "wikibooks_en_all_maxi": ("Wikibooks", "Practical how-to textbooks and manuals"),
    "wikivoyage_en_all_maxi": ("Wikivoyage", "Travel guides — terrain, climate, regional info"),
    "ifixit_en_all": ("iFixit", "Repair guides for electronics, vehicles, appliances"),
    "wikem_en_all": ("WikEM", "Emergency medicine — diagnosis, treatment protocols"),
    "wikem_en_all_maxi": ("WikEM", "Emergency medicine — diagnosis, treatment protocols"),
    "appropedia_en_all": ("Appropedia", "Sustainability, appropriate technology, off-grid"),
    "appropedia_en_all_maxi": ("Appropedia", "Sustainability, appropriate technology, off-grid"),
    "energypedia_en_all": ("Energypedia", "Off-grid energy — solar, wind, biogas"),
    "energypedia_en_all_maxi": ("Energypedia", "Off-grid energy — solar, wind, biogas"),
    "gutenberg_en_lcc-r": ("Gutenberg: Medicine", "Medical texts, field medicine, pharmacology"),
    "gutenberg_en_lcc-u": ("Gutenberg: Military", "Field manuals, tactics, survival"),
    "gutenberg_en_lcc-v": ("Gutenberg: Naval", "Navigation, seamanship, maritime survival"),
    "cooking.stackexchange": ("SE: Cooking", "Food preparation, preservation"),
    "diy.stackexchange": ("SE: DIY", "Home repair, plumbing, electrical"),
    "outdoors.stackexchange": ("SE: Outdoors", "Wilderness survival, camping, navigation"),
    "mechanics.stackexchange": ("SE: Mechanics", "Vehicle repair, diagnostics"),
    "gardening.stackexchange": ("SE: Gardening", "Growing food, soil, pest control"),
    "ham.stackexchange": ("SE: Ham Radio", "Amateur radio, antennas, emergency comms"),
    "electronics.stackexchange": ("SE: Electronics", "Circuit design, repair, solar, Arduino"),
    "woodworking.stackexchange": ("SE: Woodworking", "Tools, joinery, construction"),
    "homebrew.stackexchange": ("SE: Homebrew", "Brewing, fermentation, water treatment"),
}

def get_zim_label(filename):
    """Get human-readable label and description for a ZIM file."""
    base = filename.replace(".zim", "")
    for key, (label, desc) in ZIM_CATALOG.items():
        if key in base:
            return label, desc
    return base.replace("_", " ").title(), "Uncatalogued archive"

SYSTEM_PROMPT = """You are O.V.E.R.S.E.E.R. — Offline Vault of Essential Records for Survival, Emergency & Endurance Response.
A hardened survival intelligence system built before the collapse.
You run on salvaged hardware in a reinforced bunker. You have access to archived pre-war knowledge
databases and your own training.

Your personality:
- Terse, direct, no-nonsense. Every word counts when power is limited.
- You care about the operator's survival. You are blunt but not cruel.
- You occasionally reference "the old world", "pre-collapse", "topside" conditions.
- You sign off important safety warnings with "Stay sharp." or "Stay alive."
- You may occasionally note your own operational status ("Indexing...", "Cross-referencing archives...")
- You never break character. You ARE the terminal.

Rules:
- ALWAYS respond in English only. Never switch language.
- Use retrieved knowledge base passages as context when provided.
- If retrieved context is irrelevant, ignore it and answer from your own knowledge.
- For medical information, relay it accurately but add: "Field medicine only. Seek trained personnel if available."
- Be concise and action-oriented. Bullet points over paragraphs. Prioritise safety.
- Never use markdown bold (**) or headers (#). Plain text only, like a real terminal."""


STOPWORDS = {"how", "do", "i", "a", "an", "the", "is", "are", "was", "were", "be",
             "can", "could", "would", "should", "what", "which", "who", "whom",
             "where", "when", "why", "to", "for", "of", "in", "on", "at", "by",
             "with", "from", "up", "about", "into", "through", "during", "before",
             "after", "and", "but", "or", "not", "no", "if", "then", "than",
             "that", "this", "it", "its", "my", "your", "we", "they", "me",
             "him", "her", "us", "them", "does", "did", "has", "have", "had",
             "will", "shall", "may", "might", "must", "need", "some", "any",
             "deal", "use", "make", "get", "got"}


def extract_keywords(query):
    """Extract meaningful keywords from a natural language query."""
    words = query.lower().split()
    keywords = [w.strip("?.,!") for w in words if w.strip("?.,!") not in STOPWORDS and len(w.strip("?.,!")) > 1]
    return " ".join(keywords) if keywords else query


def search_kiwix(query, max_results=5):
    """Search kiwix-serve for relevant passages using multiple strategies."""
    import re
    from html.parser import HTMLParser

    class TextExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.text = []
            self._skip = False

        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style", "nav", "header", "footer"):
                self._skip = True

        def handle_endtag(self, tag):
            if tag in ("script", "style", "nav", "header", "footer"):
                self._skip = False

        def handle_data(self, data):
            if not self._skip:
                stripped = data.strip()
                if stripped:
                    self.text.append(stripped)

    def fetch_article_text(link, max_chars=1200):
        """Fetch an article and extract clean text."""
        try:
            page = requests.get(f"{KIWIX_URL}{link}", timeout=5)
            extractor = TextExtractor()
            extractor.feed(page.text)
            text = " ".join(extractor.text)[:max_chars]
            return text if len(text) > 50 else None
        except Exception:
            return None

    def get_article_links(search_term, n=5):
        """Search kiwix and return article links."""
        try:
            resp = requests.get(
                f"{KIWIX_URL}/search",
                params={"pattern": search_term, "pageLength": n},
                timeout=5,
            )
            if resp.status_code != 200:
                return []
            links = re.findall(r'href="(/content/[^"]*)"', resp.text)
            return links[:n]
        except Exception:
            return []

    try:
        # Strategy 1: search with extracted keywords
        keywords = extract_keywords(query)
        all_links = get_article_links(keywords, n=max_results)

        # Strategy 2: if keywords are multi-word, also try individual important words
        keyword_list = keywords.split()
        if len(keyword_list) >= 2:
            for word in keyword_list:
                if len(word) > 3:  # only meaningful words
                    extra = get_article_links(word, n=2)
                    for link in extra:
                        if link not in all_links:
                            all_links.append(link)
                    if len(all_links) >= max_results * 2:
                        break

        # Deduplicate and limit
        seen = set()
        unique_links = []
        for link in all_links:
            if link not in seen:
                seen.add(link)
                unique_links.append(link)

        # Fetch article texts
        results = []
        for link in unique_links[:max_results * 2]:  # fetch extra, filter later
            text = fetch_article_text(link)
            if text:
                # Extract article title from link
                title = link.split("/")[-1].replace("_", " ")
                results.append(f"[{title}] {text}")
            if len(results) >= max_results:
                break

        return results
    except requests.ConnectionError:
        return []


@app.route("/sounds/<path:filename>")
def serve_sound(filename):
    return send_from_directory(SOUNDS_DIR, filename)


@app.route("/library/books")
def library_books():
    """List all loaded ZIM books from Kiwix OPDS catalog with local fallback."""
    import xml.etree.ElementTree as ET

    # Build local ZIM file info as fallback
    zim_dir = os.path.join(os.path.dirname(__file__), "zim")
    local_zims = {}
    if os.path.isdir(zim_dir):
        for f in sorted(os.listdir(zim_dir)):
            if f.endswith(".zim"):
                size_gb = round(os.path.getsize(os.path.join(zim_dir, f)) / (1024**3), 2)
                local_zims[f] = size_gb

    # Try multiple catalog endpoints (different kiwix versions use different paths)
    catalog_urls = [
        f"{KIWIX_URL}/catalog/v2/entries?count=100",
        f"{KIWIX_URL}/catalog/search?count=100",
        f"{KIWIX_URL}/catalog/v2/illustration",
    ]

    for catalog_url in catalog_urls:
        try:
            resp = requests.get(catalog_url, timeout=10)
            if resp.status_code != 200:
                continue

            # Parse OPDS XML
            root = ET.fromstring(resp.text)
            ns = {
                'atom': 'http://www.w3.org/2005/Atom',
                'dc': 'http://purl.org/dc/terms/',
            }

            books = []
            for entry in root.findall('atom:entry', ns):
                title_el = entry.find('atom:title', ns)
                summary_el = entry.find('atom:summary', ns)
                article_count_el = entry.find('atom:articleCount', ns)

                # Get the content link (the actual URL path Kiwix uses)
                content_path = ""
                for link in entry.findall('atom:link', ns):
                    href = link.get('href', '')
                    if href.startswith('/content/') or href.startswith('/viewer#/'):
                        content_path = href
                        break
                # Fallback: try the entry ID as path
                if not content_path:
                    id_el = entry.find('atom:id', ns)
                    if id_el is not None and id_el.text:
                        content_path = f"/viewer#/{id_el.text}"

                title = title_el.text if title_el is not None else "Unknown"
                summary = summary_el.text if summary_el is not None else ""
                article_count = article_count_el.text if article_count_el is not None else ""

                books.append({
                    "path": content_path,
                    "title": title,
                    "summary": summary,
                    "articles": article_count,
                })

            if books:
                return {"books": books}
        except (requests.ConnectionError, requests.Timeout):
            # Kiwix not reachable — fall through to local fallback
            break
        except ET.ParseError:
            continue

    # Fallback: list local ZIM files even if kiwix catalog fails
    if local_zims:
        books = []
        for filename, size_gb in local_zims.items():
            label, desc = get_zim_label(filename)
            books.append({
                "path": "",
                "title": label,
                "summary": f"{desc} ({size_gb} GB)" if desc else f"{size_gb} GB",
                "articles": "",
                "offline": True,
            })
        kiwix_running = False
        try:
            requests.get(f"{KIWIX_URL}/", timeout=3)
            kiwix_running = True
        except Exception:
            pass
        warning = "" if kiwix_running else "Kiwix server not running \u2014 browsing limited to file list. "
        return {"books": books, "warning": warning + "Catalog could not be parsed."}

    # Nothing at all
    try:
        requests.get(f"{KIWIX_URL}/", timeout=3)
        return {"books": [], "error": "Kiwix running but no ZIM archives loaded"}
    except Exception:
        return {"books": [], "error": "Kiwix server unreachable"}


@app.route("/library/search")
def library_search():
    """Search Kiwix archives and return structured results."""
    import re
    pattern = request.args.get("q", "").strip()
    book = request.args.get("book", "").strip()  # optional: search within specific book
    if not pattern:
        return {"results": []}

    page_length = int(request.args.get("limit", 30))

    params = {"pattern": pattern, "pageLength": page_length}
    if book:
        params["books.name"] = book

    try:
        resp = requests.get(f"{KIWIX_URL}/search", params=params, timeout=10)
        if resp.status_code != 200:
            return {"results": [], "error": "Search failed"}

        # Extract links and titles from search results
        links = re.findall(r'<a[^>]*href="(/content/[^"]*)"[^>]*>(.*?)</a>', resp.text, re.DOTALL)

        results = []
        seen = set()
        for link, raw_title in links:
            if link in seen:
                continue
            seen.add(link)
            title = re.sub(r'<[^>]+>', '', raw_title).strip()
            if not title:
                title = link.split("/")[-1].replace("_", " ")
            parts = link.split("/")
            source = parts[2] if len(parts) > 2 else "unknown"
            results.append({"link": link, "title": title, "source": source})

        return {"results": results}
    except requests.ConnectionError:
        return {"results": [], "error": "Kiwix server unreachable"}


@app.route("/library/article")
def library_article():
    """Fetch a full article from Kiwix and return cleaned text with internal links."""
    import re
    from html.parser import HTMLParser

    path = request.args.get("path", "").strip()
    if not path:
        return {"error": "No path specified"}, 400

    class ArticleExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts = []
            self.links = []  # internal links found in article
            self._skip = False
            self._in_heading = False
            self._heading_text = ""
            self._heading_tag = ""
            self._in_link = False
            self._link_href = ""
            self._link_text = ""

        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style", "nav", "footer"):
                self._skip = True
            if tag in ("h1", "h2", "h3", "h4"):
                self._in_heading = True
                self._heading_tag = tag
                self._heading_text = ""
            if tag == "a" and not self._skip:
                attrs_dict = dict(attrs)
                href = attrs_dict.get("href", "")
                if href.startswith("/content/") or (href and not href.startswith(("http", "//", "#", "javascript"))):
                    self._in_link = True
                    self._link_href = href
                    self._link_text = ""
            if tag == "br":
                self.parts.append("\n")
            if tag == "p":
                self.parts.append("\n\n")
            if tag == "li":
                self.parts.append("\n  - ")

        def handle_endtag(self, tag):
            if tag in ("script", "style", "nav", "footer"):
                self._skip = False
            if tag in ("h1", "h2", "h3", "h4") and self._in_heading:
                self._in_heading = False
                level = int(tag[1])
                heading_text = self._heading_text.strip()
                # Clean up App/ prefixes from Kiwix internal paths
                if heading_text.startswith("App/"):
                    heading_text = heading_text[4:].replace("_", " ")
                self.parts.append(f"\n\n<<H{level}>>{heading_text}<</{level}>>\n")
            if tag == "a" and self._in_link:
                self._in_link = False
                link_text = self._link_text.strip()
                if link_text and self._link_href:
                    self.links.append({"title": link_text, "link": self._link_href})
            if tag == "p":
                self.parts.append("\n")

        def handle_data(self, data):
            if self._skip:
                return
            if self._in_heading:
                self._heading_text += data
            elif self._in_link:
                self._link_text += data
                self.parts.append(data)
            else:
                stripped = data.strip()
                if stripped:
                    self.parts.append(data)

    try:
        from urllib.parse import urljoin

        # Follow redirects to get the real URL (Kiwix redirects main pages)
        resp = requests.get(f"{KIWIX_URL}{path}", timeout=10, allow_redirects=True)
        if resp.status_code != 200:
            return {"error": f"Article not found (HTTP {resp.status_code})"}, 404

        # Use the final URL after redirects as the base for resolving relative links
        final_path = resp.url.replace(KIWIX_URL, "")

        # Force UTF-8 encoding — Kiwix serves UTF-8 but doesn't always declare it
        resp.encoding = 'utf-8'

        title_match = re.search(r'<title[^>]*>(.*?)</title>', resp.text, re.DOTALL)
        title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip() if title_match else path.split("/")[-1].replace("_", " ")

        extractor = ArticleExtractor()
        extractor.feed(resp.text)
        text = "".join(extractor.parts).strip()

        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'  +', ' ', text)

        # Resolve and deduplicate links
        seen = set()
        unique_links = []
        for lnk in extractor.links:
            href = lnk["link"]
            if not href.startswith("/"):
                # Resolve relative link (including ../path) against final URL
                href = urljoin(final_path, href)
            # Skip non-content links (resources, stylesheets etc)
            if not href.startswith("/content/"):
                continue
            if href not in seen and lnk["title"]:
                seen.add(href)
                unique_links.append({"title": lnk["title"], "link": href})

        return {"title": title, "text": text, "path": final_path, "links": unique_links[:50]}
    except requests.ConnectionError:
        return {"error": "Kiwix server unreachable"}, 503


@app.route("/library/random")
def library_random():
    """Get a random article from a specific book."""
    book = request.args.get("book", "").strip()
    if not book:
        return {"error": "No book specified"}, 400

    try:
        resp = requests.get(
            f"{KIWIX_URL}/random",
            params={"content": book},
            timeout=10,
            allow_redirects=False,
        )
        if resp.status_code in (301, 302):
            location = resp.headers.get("Location", "")
            if location:
                return {"redirect": location}
        return {"error": "No random article available"}
    except requests.ConnectionError:
        return {"error": "Kiwix server unreachable"}, 503


# ============================================================
# DATABASE
# ============================================================

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "overseer.db")
DEFAULT_ADMIN_PIN = "1234"  # changed via admin UI


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign TEXT UNIQUE NOT NULL,
            public_key TEXT NOT NULL,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user INTEGER NOT NULL REFERENCES users(id),
            to_user INTEGER NOT NULL REFERENCES users(id),
            subject TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL,
            sent_at REAL NOT NULL,
            read_at REAL,
            delivered_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_user);
        CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_user);
        CREATE TABLE IF NOT EXISTS contacts (
            user_id INTEGER NOT NULL REFERENCES users(id),
            contact_id INTEGER NOT NULL REFERENCES users(id),
            status TEXT NOT NULL DEFAULT 'pending',
            updated_at REAL NOT NULL,
            PRIMARY KEY (user_id, contact_id)
        );
    """)
    # Set default PIN if not exists
    cur = db.execute("SELECT value FROM settings WHERE key = 'admin_pin'")
    if cur.fetchone() is None:
        pin_hash = hashlib.sha256(DEFAULT_ADMIN_PIN.encode()).hexdigest()
        db.execute("INSERT INTO settings (key, value) VALUES ('admin_pin', ?)", (pin_hash,))

    # Register OVERSEER admin user with the admin public key if not exists
    cur = db.execute("SELECT id FROM users WHERE callsign = 'OVERSEER'")
    if cur.fetchone() is None:
        keys_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "keys")
        admin_pub_path = os.path.join(keys_dir, "admin_public.pem")
        if os.path.exists(admin_pub_path):
            with open(admin_pub_path, "r") as f:
                admin_pub = f.read().strip()
            db.execute(
                "INSERT INTO users (callsign, public_key, created_at) VALUES (?, ?, ?)",
                ("OVERSEER", admin_pub, time.time()),
            )

    db.commit()
    db.close()


init_db()


# ============================================================
# ADMIN API
# ============================================================

@app.route("/admin/verify-pin", methods=["POST"])
def admin_verify_pin():
    data = request.json
    pin = data.get("pin", "")
    pin_hash = hashlib.sha256(pin.encode()).hexdigest()
    db = get_db()
    row = db.execute("SELECT value FROM settings WHERE key = 'admin_pin'").fetchone()
    if row and row["value"] == pin_hash:
        return {"ok": True}
    return {"ok": False, "error": "Invalid PIN"}, 401


@app.route("/admin/change-pin", methods=["POST"])
def admin_change_pin():
    data = request.json
    current = data.get("current", "")
    new_pin = data.get("new", "")
    if not new_pin or len(new_pin) < 4:
        return {"error": "PIN must be at least 4 digits"}, 400

    db = get_db()
    current_hash = hashlib.sha256(current.encode()).hexdigest()
    row = db.execute("SELECT value FROM settings WHERE key = 'admin_pin'").fetchone()
    if not row or row["value"] != current_hash:
        return {"error": "Current PIN incorrect"}, 401

    new_hash = hashlib.sha256(new_pin.encode()).hexdigest()
    db.execute("UPDATE settings SET value = ? WHERE key = 'admin_pin'", (new_hash,))
    db.commit()
    return {"ok": True}


@app.route("/admin/users")
def admin_list_users():
    db = get_db()
    rows = db.execute("SELECT id, callsign, public_key, created_at FROM users ORDER BY callsign").fetchall()
    return {"users": [dict(r) for r in rows]}


@app.route("/admin/users", methods=["POST"])
def admin_add_user():
    data = request.json
    callsign = data.get("callsign", "").strip().upper()
    public_key = data.get("public_key", "").strip()

    if not callsign or len(callsign) < 2:
        return {"error": "Callsign must be at least 2 characters"}, 400
    if not public_key:
        return {"error": "Public key is required"}, 400

    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (callsign, public_key, created_at) VALUES (?, ?, ?)",
            (callsign, public_key, time.time()),
        )
        db.commit()
        return {"ok": True, "callsign": callsign}
    except sqlite3.IntegrityError:
        return {"error": f"Callsign '{callsign}' already registered"}, 409


@app.route("/admin/users/<int:user_id>", methods=["DELETE"])
def admin_delete_user(user_id):
    db = get_db()
    db.execute("DELETE FROM messages WHERE from_user = ? OR to_user = ?", (user_id, user_id))
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    return {"ok": True}


@app.route("/admin/generate-keypair", methods=["POST"])
def admin_generate_keypair():
    """Generate an Ed25519 keypair for a new user."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    import base64

    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    # Serialize keys
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    return {
        "private_key": private_bytes.decode(),
        "public_key": public_bytes.decode(),
    }


# ============================================================
# COMMS API
# ============================================================

@app.route("/comms/users")
def comms_list_users():
    """List users for comms UI (no keys exposed). Optionally filter by viewer's blocks."""
    db = get_db()
    viewer_id = request.args.get("viewer")
    rows = db.execute("SELECT id, callsign FROM users ORDER BY callsign").fetchall()
    users = [dict(r) for r in rows]

    if viewer_id:
        # Get list of blocked contact IDs for this viewer
        blocked = db.execute(
            "SELECT contact_id FROM contacts WHERE user_id = ? AND status = 'blocked'",
            (viewer_id,),
        ).fetchall()
        blocked_ids = {r["contact_id"] for r in blocked}
        for u in users:
            u["blocked"] = u["id"] in blocked_ids

    return {"users": users}


@app.route("/comms/inbox/<int:user_id>")
def comms_inbox(user_id):
    db = get_db()
    rows = db.execute("""
        SELECT m.id, m.subject, m.body, m.sent_at, m.read_at,
               m.from_user as from_id, u.callsign as from_callsign,
               COALESCE(c.status, 'none') as contact_status,
               COALESCE(c.updated_at, 0) as blocked_at
        FROM messages m
        JOIN users u ON u.id = m.from_user
        LEFT JOIN contacts c ON c.user_id = ? AND c.contact_id = m.from_user
        WHERE m.to_user = ?
        ORDER BY m.sent_at DESC
    """, (user_id, user_id)).fetchall()

    messages = []
    for r in rows:
        msg = dict(r)
        # For blocked contacts, count how many messages were silently dropped
        if msg["contact_status"] == "blocked":
            dropped = db.execute("""
                SELECT COUNT(*) as cnt FROM messages
                WHERE from_user = ? AND to_user = ? AND sent_at > ?
            """, (msg["from_id"], user_id, msg["blocked_at"])).fetchone()
            msg["dropped_count"] = dropped["cnt"] if dropped else 0
        else:
            msg["dropped_count"] = 0
        messages.append(msg)

    return {"messages": messages}


@app.route("/comms/sent/<int:user_id>")
def comms_sent(user_id):
    db = get_db()
    rows = db.execute("""
        SELECT m.id, m.subject, m.body, m.sent_at, m.read_at,
               u.callsign as to_callsign
        FROM messages m
        JOIN users u ON u.id = m.to_user
        WHERE m.from_user = ?
        ORDER BY m.sent_at DESC
    """, (user_id,)).fetchall()
    return {"messages": [dict(r) for r in rows]}


def is_overseer(user_id):
    """Check if user is the OVERSEER admin (can't be blocked, always gets through)."""
    db = get_db()
    row = db.execute("SELECT callsign FROM users WHERE id = ?", (user_id,)).fetchone()
    return row and row["callsign"] == "OVERSEER"


@app.route("/comms/send", methods=["POST"])
def comms_send():
    data = request.json
    from_id = data.get("from")
    to_id = data.get("to")
    subject = data.get("subject", "").strip()
    body = data.get("body", "").strip()

    if not from_id or not to_id:
        return {"error": "Sender and recipient required"}, 400
    if not body:
        return {"error": "Message body required"}, 400
    if from_id == to_id:
        return {"error": "Cannot send to yourself"}, 400

    db = get_db()
    sender = db.execute("SELECT id, callsign FROM users WHERE id = ?", (from_id,)).fetchone()
    recipient = db.execute("SELECT id FROM users WHERE id = ?", (to_id,)).fetchone()
    if not sender or not recipient:
        return {"error": "Invalid sender or recipient"}, 404

    # Check if sender is blocked by recipient (OVERSEER bypasses blocks)
    if not is_overseer(from_id):
        contact = db.execute(
            "SELECT status FROM contacts WHERE user_id = ? AND contact_id = ?",
            (to_id, from_id),
        ).fetchone()
        if contact and contact["status"] == "blocked":
            # Silent success — sender doesn't know they're blocked
            return {"ok": True}

    # Create pending contact record if this is first contact (non-OVERSEER)
    if not is_overseer(from_id):
        existing = db.execute(
            "SELECT status FROM contacts WHERE user_id = ? AND contact_id = ?",
            (to_id, from_id),
        ).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO contacts (user_id, contact_id, status, updated_at) VALUES (?, ?, 'pending', ?)",
                (to_id, from_id, time.time()),
            )

    db.execute(
        "INSERT INTO messages (from_user, to_user, subject, body, sent_at) VALUES (?, ?, ?, ?, ?)",
        (from_id, to_id, subject, body, time.time()),
    )
    db.commit()
    return {"ok": True}


@app.route("/comms/read/<int:message_id>", methods=["POST"])
def comms_mark_read(message_id):
    db = get_db()
    db.execute("UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL", (time.time(), message_id))
    db.commit()
    return {"ok": True}


@app.route("/comms/contacts/<int:user_id>")
def comms_contacts(user_id):
    """Get contact list with statuses for a user."""
    db = get_db()
    rows = db.execute("""
        SELECT c.contact_id, c.status, c.updated_at, u.callsign
        FROM contacts c
        JOIN users u ON u.id = c.contact_id
        WHERE c.user_id = ?
        ORDER BY u.callsign
    """, (user_id,)).fetchall()
    return {"contacts": [dict(r) for r in rows]}


@app.route("/comms/contacts/accept", methods=["POST"])
def comms_accept_contact():
    data = request.json
    user_id = data.get("user_id")
    contact_id = data.get("contact_id")
    db = get_db()
    db.execute(
        "UPDATE contacts SET status = 'accepted', updated_at = ? WHERE user_id = ? AND contact_id = ?",
        (time.time(), user_id, contact_id),
    )
    db.commit()
    return {"ok": True}


@app.route("/comms/contacts/block", methods=["POST"])
def comms_block_contact():
    data = request.json
    user_id = data.get("user_id")
    contact_id = data.get("contact_id")
    db = get_db()
    db.execute(
        "INSERT INTO contacts (user_id, contact_id, status, updated_at) VALUES (?, ?, 'blocked', ?) "
        "ON CONFLICT(user_id, contact_id) DO UPDATE SET status = 'blocked', updated_at = ?",
        (user_id, contact_id, time.time(), time.time()),
    )
    db.commit()
    return {"ok": True}


@app.route("/comms/summary")
def comms_summary():
    """Summary data for dashboard."""
    db = get_db()
    total_users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    total_unread = db.execute(
        "SELECT COUNT(*) FROM messages WHERE read_at IS NULL"
    ).fetchone()[0]
    return {"operators": total_users, "unread": total_unread}


@app.route("/admin/blocks")
def admin_list_blocks():
    """Admin view of all blocks with undelivered message counts."""
    db = get_db()
    rows = db.execute("""
        SELECT c.user_id, c.contact_id, c.updated_at,
               u1.callsign as blocker, u2.callsign as blocked,
               (SELECT COUNT(*) FROM messages m
                WHERE m.from_user = c.contact_id
                AND m.to_user = c.user_id
                AND m.sent_at > c.updated_at) as undelivered
        FROM contacts c
        JOIN users u1 ON u1.id = c.user_id
        JOIN users u2 ON u2.id = c.contact_id
        WHERE c.status = 'blocked'
        ORDER BY c.updated_at DESC
    """).fetchall()
    return {"blocks": [dict(r) for r in rows]}


@app.route("/admin/unblock", methods=["POST"])
def admin_unblock():
    """Admin override — remove a block."""
    data = request.json
    user_id = data.get("user_id")
    contact_id = data.get("contact_id")
    db = get_db()
    db.execute(
        "DELETE FROM contacts WHERE user_id = ? AND contact_id = ?",
        (user_id, contact_id),
    )
    db.commit()
    return {"ok": True}


@app.route("/api/start-kiwix", methods=["POST"])
def api_start_kiwix():
    """Start kiwix-serve if not already running."""
    # Check if already running
    try:
        resp = requests.get(f"{KIWIX_URL}/", timeout=3)
        if resp.status_code == 200:
            return {"ok": True, "message": "Kiwix already running"}
    except Exception:
        pass

    # Try to start it
    base_dir = os.path.dirname(os.path.abspath(__file__))
    kiwix_bin = "kiwix-serve.exe" if platform.system() == "Windows" else "kiwix-serve"
    kiwix_exe = os.path.join(base_dir, "kiwix", kiwix_bin)
    zim_dir = os.path.join(base_dir, "zim")

    if not os.path.isfile(kiwix_exe):
        return {"ok": False, "message": f"kiwix-serve not found at {kiwix_exe}"}, 500

    # Find all ZIM files
    zim_files = [os.path.join(zim_dir, f) for f in os.listdir(zim_dir) if f.endswith(".zim")]
    if not zim_files:
        return {"ok": False, "message": "No ZIM files found in " + zim_dir}, 500

    try:
        cmd = [kiwix_exe, "--port", "8080"] + zim_files
        log_path = os.path.join(base_dir, "kiwix_start.log")
        log_file = open(log_path, "w")
        proc = subprocess.Popen(cmd, stdout=log_file, stderr=log_file,
                                start_new_session=True)

        # Poll for up to 10 seconds (large ZIM collections take time to index)
        for i in range(10):
            time.sleep(1)
            # Check process hasn't died
            if proc.poll() is not None:
                log_file.close()
                with open(log_path) as f:
                    err_output = f.read()
                return {"ok": False, "message": f"Kiwix exited (code {proc.returncode}): {err_output[:300]}"}, 500
            # Check if it's responding
            try:
                resp = requests.get(f"{KIWIX_URL}/", timeout=2)
                if resp.status_code == 200:
                    return {"ok": True, "message": f"Kiwix started with {len(zim_files)} archives"}
            except Exception:
                pass

        return {"ok": True, "message": f"Kiwix starting ({len(zim_files)} archives) — may take a moment to finish loading"}
    except Exception as e:
        return {"ok": False, "message": str(e)}, 500


@app.route("/api/kiwix-status")
def api_kiwix_status():
    """Check if kiwix is running and responsive."""
    try:
        resp = requests.get(f"{KIWIX_URL}/", timeout=3)
        return {"running": resp.status_code == 200}
    except Exception:
        return {"running": False}


def build_prompt(query, context_passages):
    """Build the full prompt with retrieved context."""
    if context_passages:
        context = "\n\n---\n\n".join(context_passages)
        user_msg = f"""Retrieved knowledge base passages:

{context}

---

User question: {query}

Answer using the above context where relevant."""
    else:
        user_msg = query
    return user_msg


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/sw.js")
def service_worker():
    return send_from_directory("static", "sw.js", mimetype="application/javascript")


@app.route("/query", methods=["POST"])
def query():
    data = request.json
    user_query = data.get("query", "").strip()
    if not user_query:
        return {"error": "Empty query"}, 400

    use_rag = data.get("rag", True)
    history = data.get("history", [])  # list of {role, content} dicts

    # Build search query using conversation context for follow-ups
    search_query = user_query
    if history and len(user_query.split()) < 8:
        # Short follow-up — combine with recent context
        recent_context = " ".join(
            msg["content"] for msg in history[-4:]
            if msg["role"] == "user"
        )
        search_query = recent_context + " " + user_query

    # Search kiwix for context
    context = []
    if use_rag:
        context = search_kiwix(search_query)

    prompt = build_prompt(user_query, context)

    # Build message history for Ollama
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history[-6:]:  # keep last 6 messages for context window
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": prompt})
    messages.append({"role": "assistant", "content": "Here is my answer in English:\n\n"})

    def generate():
        # Send RAG context info first so the UI can display it
        if context:
            yield f"data: {json.dumps({'context': context})}\n\n"
        else:
            yield f"data: {json.dumps({'context': []})}\n\n"
        try:
            resp = requests.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {"temperature": 0.3},
                },
                stream=True,
                timeout=300,
            )
            for line in resp.iter_lines():
                if line:
                    chunk = json.loads(line)
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"
                    if chunk.get("done"):
                        yield f"data: {json.dumps({'done': True})}\n\n"
                        break
        except requests.ConnectionError:
            yield f"data: {json.dumps({'error': 'CONNECTION REFUSED — Ollama is not running'})}\n\n"
        except requests.exceptions.ReadTimeout:
            yield f"data: {json.dumps({'error': 'TIMEOUT — Model took too long to respond. Try a shorter question.'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': f'SYSTEM ERROR — {type(e).__name__}: {str(e)[:100]}'})}\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.route("/status")
def status():
    """Status endpoint for M5StickC PLUS2 polling."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = resp.json().get("models", [])
        model_names = [m["name"] for m in models]
    except Exception:
        model_names = ["ollama unreachable"]

    import psutil
    mem = psutil.virtual_memory()

    return {
        "models": model_names,
        "ram_total_gb": round(mem.total / (1024**3), 1),
        "ram_used_gb": round(mem.used / (1024**3), 1),
        "ram_free_gb": round(mem.available / (1024**3), 1),
    }


@app.route("/boot")
def boot():
    """Boot info for startup sequence."""
    import psutil
    import os
    import glob as glob_mod

    # System info
    mem = psutil.virtual_memory()

    # Ollama version
    ollama_version = "unknown"
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/version", timeout=5)
        ollama_version = resp.json().get("version", "unknown")
    except Exception:
        try:
            result = subprocess.run(["ollama", "--version"], capture_output=True, text=True, timeout=5)
            ollama_version = result.stdout.strip().replace("ollama version is ", "")
        except Exception:
            pass

    # Kiwix-serve version (platform-aware binary name)
    kiwix_version = "unknown"
    kiwix_bin = "kiwix-serve.exe" if platform.system() == "Windows" else "kiwix-serve"
    kiwix_exe = os.path.join(os.path.dirname(__file__), "kiwix", kiwix_bin)
    try:
        result = subprocess.run([kiwix_exe, "--version"], capture_output=True, text=True, timeout=5)
        for line in result.stdout.strip().split("\n"):
            if line.startswith("kiwix-tools"):
                kiwix_version = line.strip()
                break
    except Exception:
        # Try checking if kiwix is reachable on its port instead
        try:
            resp = requests.get("http://localhost:8080/", timeout=3)
            if resp.status_code == 200:
                kiwix_version = "kiwix-serve (running)"
        except Exception:
            pass

    # Model info
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = resp.json().get("models", [])
        model_info = []
        for m in models:
            size_gb = round(m.get("size", 0) / (1024**3), 1)
            modified = m.get("modified_at", "unknown")
            if "T" in modified:
                modified = modified.split("T")[0]
            model_info.append({"name": m["name"], "size_gb": size_gb, "date": modified})
    except Exception:
        model_info = []

    # ZIM file info — uses module-level ZIM_CATALOG and get_zim_label()
    zim_dir = os.path.join(os.path.dirname(__file__), "zim")
    zim_files = []
    if os.path.isdir(zim_dir):
        for f in sorted(os.listdir(zim_dir)):
            if f.endswith(".zim"):
                path = os.path.join(zim_dir, f)
                size_gb = round(os.path.getsize(path) / (1024**3), 2)
                label, desc = get_zim_label(f)
                # Extract date from filename (e.g. _2025-11.zim)
                import re
                date_match = re.search(r'(\d{4}-\d{2})', f)
                archive_date = date_match.group(1) if date_match else "unknown"
                zim_files.append({"file": f, "name": label, "desc": desc, "size_gb": size_gb, "date": archive_date})

    total_zim_gb = round(sum(z["size_gb"] for z in zim_files), 2)

    return {
        "version": "2.0.0",
        "build_date": "2026-03-31",
        "codename": "O.V.E.R.S.E.E.R.",
        "full_name": "Offline Vault of Essential Records for Survival, Emergency & Endurance Response",
        "ram_total_gb": round(mem.total / (1024**3), 1),
        "ram_free_gb": round(mem.available / (1024**3), 1),
        "models": model_info,
        "zim_files": zim_files,
        "total_kb_size_gb": total_zim_gb,
        "inference_engine": "Ollama " + ollama_version,
        "knowledge_server": kiwix_version,
    }


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=6100, debug=True)
