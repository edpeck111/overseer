"""RECREATION module — games registry, fortune, wiki roulette, reader, chess, zork-lite.

Sprint 15. Dragon's Tale (Sprint 16) is a placeholder here.

Sub-screens: F(fortune) W(wiki) R(reader) C(chess) Z(zork) D(dragon-placeholder)
API prefix: /api/r/
"""
from __future__ import annotations
import os, time, random, json, textwrap
from dataclasses import dataclass, field, asdict
from typing import Optional

# ── in-memory stores ───────────────────────────────────────────────────────
@dataclass
class ReadingProgress:
    archive:  str
    article:  str
    position: float   # 0.0–1.0
    bookmark: Optional[str]
    updated:  float

@dataclass
class ChessGame:
    id:       int
    fen:      str     # FEN string of current position
    pgn:      list    # list of SAN move strings
    to_move:  str     # "white" | "black"
    result:   Optional[str]  # None | "1-0" | "0-1" | "1/2-1/2"
    started:  float

@dataclass
class ZorkState:
    room:    str
    inv:     list
    history: list     # list of (cmd, response) pairs
    done:    bool

_reading:   dict[str, ReadingProgress] = {}   # key: f"{archive}:{article}"
_chess:     dict[int, ChessGame]       = {}
_zork:      dict[str, ZorkState]       = {}   # key: session_id
_seq = 0

# ── fortune quotes ─────────────────────────────────────────────────────────
_FORTUNES = [
    "The map is not the territory.",
    "Two is one, one is none.",
    "Slow is smooth, smooth is fast.",
    "Prior planning prevents poor performance.",
    "Adapt what is useful, reject what is useless, add what is specifically your own.",
    "Amateurs think about tactics; professionals think about logistics.",
    "In the middle of difficulty lies opportunity. — Einstein",
    "Prepare for the worst, hope for the best, and accept what comes.",
    "A human being should be able to change a diaper, plan an invasion, butcher a hog, "
    "conn a ship, design a building, write a sonnet, balance accounts, build a wall, "
    "set a bone, comfort the dying, take orders, give orders, cooperate, act alone. "
    "Specialisation is for insects. — Heinlein",
    "It's not the daily increase but daily decrease. Hack away the unessential. — Bruce Lee",
    "The more you sweat in training, the less you bleed in battle.",
    "Better to have and not need than to need and not have.",
    "When in doubt, don't.",
    "He who fails to plan is planning to fail.",
    "Beware of endeavours that require new clothes.",
    "An armed society is a polite society.",
    "Sleep is a weapon.",
    "Noise proves nothing. Often a hen who has merely laid an egg cackles as if she had "
    "laid an asteroid. — Mark Twain",
    "It is not the mountain we conquer but ourselves. — Hillary",
    "Fortune favours the prepared mind.",
    "He that fights and runs away may live to fight another day.",
    "The first rule of any technology used in a business is that automation applied to "
    "an efficient operation will magnify the efficiency.",
    "Give me six hours to chop down a tree and I will spend the first four sharpening "
    "the axe. — Lincoln",
    "Do or do not, there is no try.",
    "The obstacle is the way.",
    "Memento mori. Amor fati.",
    "Per aspera ad astra.",
    "Aut viam inveniam aut faciam. (I shall find a way or make one.)",
    "Festina lente. (Make haste slowly.)",
]

# ── tiny zork-like adventure ───────────────────────────────────────────────
_ROOMS = {
    "bunker_entrance": {
        "desc": "You stand at the reinforced entrance to the bunker. A heavy steel door "
                "leads NORTH. Scratched into the concrete: 'OVERSEER v3 EXPERIMENTAL'. "
                "A rusted ladder descends to the EAST.",
        "exits": {"north": "command_room", "east": "supply_shaft"},
        "items": ["torch"],
    },
    "command_room": {
        "desc": "The command room hums with the sound of cooling fans. Racks of radio "
                "equipment line the WEST wall. A terminal glows in the corner. Exits: "
                "SOUTH (entrance), EAST (dormitory).",
        "exits": {"south": "bunker_entrance", "east": "dormitory"},
        "items": ["radio_manual"],
    },
    "dormitory": {
        "desc": "Six bunks, half made. A faint smell of instant coffee. Footlockers "
                "under each bunk. Exits: WEST (command room), NORTH (store room).",
        "exits": {"west": "command_room", "north": "store_room"},
        "items": ["coffee_tin"],
    },
    "store_room": {
        "desc": "Shelves floor-to-ceiling. Canned goods, water barrels, medical kits. "
                "A faded inventory sheet on the door. Exits: SOUTH (dormitory). "
                "You notice a HATCH in the floor.",
        "exits": {"south": "dormitory", "down": "comms_hub"},
        "items": ["med_kit", "ration_pack"],
    },
    "supply_shaft": {
        "desc": "The shaft is dark. Your torch (if you have one) reveals damp walls and "
                "a faint dripping. A passage leads WEST back to the entrance. "
                "Deeper down: darkness.",
        "exits": {"west": "bunker_entrance"},
        "items": ["old_map"],
    },
    "comms_hub": {
        "desc": "You've found it — the comms hub. Mesh antennas, LoRa gear, a "
                "hand-crank generator. A note reads: 'Frequency: 433.175 MHz'. "
                "Exits: UP (store room).",
        "exits": {"up": "store_room"},
        "items": ["frequency_note"],
    },
}

_ITEM_DESC = {
    "torch":          "A heavy LED torch, fully charged.",
    "radio_manual":   "A dog-eared copy of 'ARRL Radio Handbook 2019'.",
    "coffee_tin":     "A tin of instant coffee, half full. Smells incredible.",
    "med_kit":        "A compact IFAK. Tourniquet, QuikClot, chest seal.",
    "ration_pack":    "MRE: Beef Stew. 1200 kcal. Exp 2029.",
    "old_map":        "A hand-drawn map of the surrounding area. Grid references marked.",
    "frequency_note": "A scrap of paper: '433.175 MHz - primary mesh freq'.",
}

def _zork_cmd(state: ZorkState, cmd: str) -> str:
    cmd = cmd.strip().lower()
    room = _ROOMS.get(state.room, _ROOMS["bunker_entrance"])

    if cmd in ("look", "l", ""):
        return room["desc"] + (f"\nItems here: {', '.join(room['items'])}" if room["items"] else "")

    if cmd.startswith("go ") or cmd in room["exits"]:
        direction = cmd.replace("go ", "").strip() if cmd.startswith("go ") else cmd
        dest = room["exits"].get(direction)
        if dest:
            state.room = dest
            new_room = _ROOMS[dest]
            return new_room["desc"]
        return f"You can't go {direction} from here."

    if cmd.startswith("take ") or cmd.startswith("get "):
        item = cmd.split(None, 1)[1].replace(" ", "_")
        if item in room["items"]:
            room["items"].remove(item)
            state.inv.append(item)
            return f"You take the {item.replace('_',' ')}."
        return f"There's no {item.replace('_',' ')} here."

    if cmd in ("inventory", "i", "inv"):
        if not state.inv:
            return "You're not carrying anything."
        return "Carrying: " + ", ".join(i.replace("_"," ") for i in state.inv)

    if cmd.startswith("examine ") or cmd.startswith("x "):
        item = cmd.split(None, 1)[1].replace(" ", "_")
        desc = _ITEM_DESC.get(item)
        if desc:
            return desc
        if item in state.inv or item in room["items"]:
            return f"It's a {item.replace('_',' ')}. Nothing special."
        return f"You don't see that here."

    if cmd in ("quit", "q", "exit"):
        state.done = True
        return "You surface from the adventure. The bunker fades."

    if cmd in ("help", "?"):
        return ("Commands: look (l), go <dir>, take/get <item>, examine/x <item>, "
                "inventory (i), quit (q). Directions: north/south/east/west/up/down.")

    return f"I don't understand '{cmd}'."

# ── chess (algebraic text board, no engine) ────────────────────────────────
_INIT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

def _fen_to_board(fen: str) -> str:
    """Render a FEN position as an ASCII board."""
    ranks = fen.split()[0].split("/")
    lines = ["  a b c d e f g h"]
    for ri, rank in enumerate(ranks):
        row = []
        for ch in rank:
            if ch.isdigit():
                row.extend(["."] * int(ch))
            else:
                row.append(ch)
        lines.append(f"{8-ri} {' '.join(row)} {8-ri}")
    lines.append("  a b c d e f g h")
    return "\n".join(lines)

def chess_new() -> dict:
    global _seq
    _seq += 1
    g = ChessGame(id=_seq, fen=_INIT_FEN, pgn=[], to_move="white", result=None, started=time.time())
    _chess[_seq] = g
    return {**asdict(g), "board": _fen_to_board(g.fen)}

def chess_state(game_id: int) -> Optional[dict]:
    g = _chess.get(game_id)
    return {**asdict(g), "board": _fen_to_board(g.fen)} if g else None

def chess_move(game_id: int, move: str) -> dict:
    """Accept a move in algebraic notation (synthetic: just record it, no legality check)."""
    g = _chess.get(game_id)
    if not g:
        return {"error": "game not found"}
    if g.result:
        return {"error": "game is over"}
    g.pgn.append(move)
    g.to_move = "black" if g.to_move == "white" else "white"
    # Synthetic: accept any move, no FEN update (would need a real engine)
    return {**asdict(g), "board": _fen_to_board(g.fen), "move_recorded": move}

# ── wiki roulette (ZIM stub) ───────────────────────────────────────────────
_STUB_ARTICLES = [
    {"title": "Knot — Bowline",    "summary": "The bowline is one of the most useful knots. It forms a fixed loop at the end of a rope and is easy to untie after loading.", "zim": "wikipedia"},
    {"title": "Fire — Methods",    "summary": "Friction fire methods include the bow drill and hand drill. A consistent stroke rhythm is more important than speed.", "zim": "wikipedia"},
    {"title": "Morse Code",        "summary": "Morse code encodes text as dots and dashes. SOS is ···–––···. A radio operator should aim for 20 WPM minimum.", "zim": "wikipedia"},
    {"title": "Water Purification","summary": "Boiling for one minute (3 at altitude) kills pathogens. Chemical treatment with iodine or chlorine is a backup.", "zim": "wikipedia"},
    {"title": "Navigation — Stars","summary": "Polaris sits within 1° of true north. The Southern Cross points toward the south celestial pole.", "zim": "wikipedia"},
    {"title": "Edible Plants — UK","summary": "Common edibles: dandelion (leaves/root), nettle (young shoots, cook first), hawthorn berries, rosehips.", "zim": "wikipedia"},
    {"title": "Ham Radio — Bands", "summary": "2m (144–146 MHz) and 70cm (430–440 MHz) are primary local comms bands. HF (3–30 MHz) for long-range.", "zim": "wikipedia"},
    {"title": "Fermentation",      "summary": "Lacto-fermentation preserves vegetables without refrigeration. Salt at 2% by weight inhibits harmful bacteria.", "zim": "wikipedia"},
]

def wiki_random() -> dict:
    return random.choice(_STUB_ARTICLES)

# ── reader progress ────────────────────────────────────────────────────────
def reader_get_progress(archive: str, article: str) -> Optional[dict]:
    rp = _reading.get(f"{archive}:{article}")
    return asdict(rp) if rp else None

def reader_set_progress(archive: str, article: str, position: float,
                        bookmark: Optional[str] = None) -> dict:
    key = f"{archive}:{article}"
    rp = ReadingProgress(archive=archive, article=article,
                         position=min(1.0, max(0.0, position)),
                         bookmark=bookmark, updated=time.time())
    _reading[key] = rp
    return asdict(rp)

def reader_list_progress() -> list[dict]:
    return [asdict(v) for v in sorted(_reading.values(), key=lambda x: -x.updated)]

# ── game registry ──────────────────────────────────────────────────────────
_GAMES = [
    {"id": "dragon",  "name": "Dragon's Tale",  "status": "coming Sprint 16", "hotkey": "D"},
    {"id": "trader",  "name": "Trader",          "status": "coming Sprint 16", "hotkey": "T"},
    {"id": "chess",   "name": "Chess",           "status": "available",        "hotkey": "C"},
    {"id": "zork",    "name": "Bunker Adventure","status": "available",        "hotkey": "Z"},
    {"id": "wiki",    "name": "Wiki Roulette",   "status": "available",        "hotkey": "W"},
    {"id": "fortune", "name": "Fortune",         "status": "available",        "hotkey": "F"},
    {"id": "reader",  "name": "Reader",          "status": "available",        "hotkey": "R"},
]

def games_list() -> list[dict]:
    return _GAMES

def fortune_get() -> dict:
    return {"quote": random.choice(_FORTUNES)}

def reset_for_tests():
    global _reading, _chess, _zork, _seq
    _reading = {}; _chess = {}; _zork = {}; _seq = 0

# ── Flask routes ───────────────────────────────────────────────────────────
def register(app):
    from flask import jsonify, request, session

    @app.route("/api/r/games")
    def _games():
        return jsonify({"games": games_list()})

    @app.route("/api/r/fortune")
    def _fortune():
        return jsonify(fortune_get())

    @app.route("/api/r/wiki/random")
    def _wiki_random():
        return jsonify(wiki_random())

    @app.route("/api/r/reader/progress", methods=["GET"])
    def _reader_list():
        return jsonify({"progress": reader_list_progress()})

    @app.route("/api/r/reader/progress", methods=["POST"])
    def _reader_set():
        d = request.json or {}
        rp = reader_set_progress(
            d.get("archive", ""), d.get("article", ""),
            float(d.get("position", 0.0)), d.get("bookmark")
        )
        return jsonify(rp)

    @app.route("/api/r/chess/new", methods=["POST"])
    def _chess_new():
        return jsonify(chess_new())

    @app.route("/api/r/chess/<int:game_id>")
    def _chess_state(game_id):
        g = chess_state(game_id)
        return jsonify(g) if g else (jsonify({"error": "not found"}), 404)

    @app.route("/api/r/chess/<int:game_id>/move", methods=["POST"])
    def _chess_move(game_id):
        move = (request.json or {}).get("move", "")
        return jsonify(chess_move(game_id, move))

    @app.route("/api/r/zork/start", methods=["POST"])
    def _zork_start():
        sid = (request.json or {}).get("session", f"s{int(time.time())}")
        state = ZorkState(room="bunker_entrance", inv=[], history=[], done=False)
        _zork[sid] = state
        intro = _zork_cmd(state, "look")
        state.history.append(("look", intro))
        return jsonify({"session": sid, "response": intro, "done": False})

    @app.route("/api/r/zork/<session>/cmd", methods=["POST"])
    def _zork_cmd_route(session):
        state = _zork.get(session)
        if not state:
            return jsonify({"error": "session not found"}), 404
        cmd = (request.json or {}).get("cmd", "")
        resp = _zork_cmd(state, cmd)
        state.history.append((cmd, resp))
        return jsonify({"response": resp, "room": state.room,
                        "inv": state.inv, "done": state.done})
