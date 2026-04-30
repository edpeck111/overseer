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
    {"id": "dragon",  "name": "Dragon's Tale",  "status": "available",        "hotkey": "D"},
    {"id": "trader",  "name": "Trader",          "status": "available",        "hotkey": "T"},
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
    global _reading, _chess, _zork, _dragon, _seq
    _reading = {}; _chess = {}; _zork = {}; _dragon = {}; _trader = {}; _seq = 0

# ── Dragon's Tale text adventure ──────────────────────────────────────────────
# Fantasy text adventure as recreational escapism. 10 rooms, combat,
# inventory, quest completion (slay the Ashen Dragon or find the secret ending).

from dataclasses import dataclass, field as dc_field
from typing import Optional

@dataclass
class DragonState:
    room:    str
    inv:     list
    history: list      # (cmd, response) pairs
    hp:      int
    max_hp:  int
    done:    bool
    won:     bool
    enemies: dict      # room -> {hp: int} for tracked enemies
    flags:   set       # progression flags (using list for JSON compat)

_dragon: dict = {}   # session -> DragonState
_trader: dict = {}   # session -> TraderState

_DR_ROOMS = {
    "village_square": {
        "desc": "Crumbling cobblestones, a dry fountain. Ravens watch from charred eaves. "
                "A FORGE smokes faintly to the NORTH. Market ruins lie to the EAST. "
                "A CELLAR DOOR is half-buried in the rubble at your feet.",
        "exits": {"north": "blacksmith_forge", "east": "market_ruins",
                  "down": "hidden_cellar"},
        "items": [],
        "hidden_exit": "down",
    },
    "blacksmith_forge": {
        "desc": "The forge still holds heat — someone was here recently. Tongs, hammers, "
                "and a SWORD hang on the wall. Ash coats everything. "
                "Exits: SOUTH (village square), EAST (forest path).",
        "exits": {"south": "village_square", "east": "forest_path"},
        "items": ["sword"],
    },
    "market_ruins": {
        "desc": "Collapsed stalls, scattered coins, overturned carts. A cracked SHIELD "
                "leans against a pillar. Crows pick at something unseen. "
                "Exits: WEST (village square), NORTH (forest path).",
        "exits": {"west": "village_square", "north": "forest_path"},
        "items": ["shield", "torch"],
    },
    "forest_path": {
        "desc": "Ancient oaks close overhead, filtering grey light. Mud tracks lead "
                "NORTH to an old bridge, WEST to the forge, SOUTH back to the market, "
                "and EAST to a cave entrance.",
        "exits": {"north": "old_bridge", "west": "blacksmith_forge",
                  "south": "market_ruins", "east": "cave_entrance"},
        "items": [],
    },
    "old_bridge": {
        "desc": "A stone bridge over a black river. Halfway across, a STONE TROLL "
                "blocks the path. It eyes your pack hungrily. "
                "Exits: SOUTH (forest), NORTH (dark tower — if troll is gone).",
        "exits": {"south": "forest_path"},
        "items": [],
        "enemy": {"name": "Stone Troll", "max_hp": 12, "atk": 3, "drop": "troll_tooth",
                  "guard_exit": "north", "guard_dest": "dark_tower"},
    },
    "cave_entrance": {
        "desc": "The cave mouth breathes cold air. A GOBLIN SCOUT crouches behind a "
                "rock, clutching a rusty knife. Dripping water echoes from DEEPER IN. "
                "Exits: WEST (forest), DEEPER (east — into cave depths).",
        "exits": {"west": "forest_path"},
        "items": [],
        "enemy": {"name": "Goblin Scout", "max_hp": 6, "atk": 2, "drop": "goblin_key",
                  "guard_exit": "east", "guard_dest": "cave_depths"},
    },
    "cave_depths": {
        "desc": "Crystals catch your torchlight (if you have one). A brass CHEST sits "
                "open — someone beat you here. But a HEALING POTION remains, spilled "
                "but salvageable. Graffiti on the wall: 'The tower. The scale. The way out.' "
                "Exits: WEST (cave entrance).",
        "exits": {"west": "cave_entrance"},
        "items": ["healing_potion"],
    },
    "dark_tower": {
        "desc": "The tower door is iron-banded oak. A FALLEN KNIGHT in black armour "
                "slumps against the wall — dead, but unnaturally animate. It stirs as "
                "you approach. Stairs spiral UP to the battlements. "
                "Exits: SOUTH (bridge), UP (battlements).",
        "exits": {"south": "old_bridge"},
        "items": [],
        "enemy": {"name": "Fallen Knight", "max_hp": 18, "atk": 5, "drop": "knight_helm",
                  "guard_exit": "up", "guard_dest": "tower_battlements"},
    },
    "tower_battlements": {
        "desc": "Wind screams across the parapet. The ASHEN DRAGON coils around the "
                "highest merlon, scales the colour of dead embers. Its eyes open — "
                "two coals, slow and certain. It knows you came for it. "
                "Exits: DOWN (tower).",
        "exits": {"down": "dark_tower"},
        "items": [],
        "enemy": {"name": "Ashen Dragon", "max_hp": 30, "atk": 8, "drop": "dragon_scale",
                  "is_final": True},
    },
    "hidden_cellar": {
        "desc": "A dusty cellar. Racks of old wine, most broken. A LEATHER JOURNAL "
                "lies open on a table: 'The dragon brought the collapse. Its scale is "
                "the cure. Take it to the well.' A HEALING POTION sits beside it. "
                "Exits: UP (village square).",
        "exits": {"up": "village_square"},
        "items": ["cellar_potion", "journal"],
    },
}

_DR_ITEMS = {
    "sword":         {"desc": "A balanced short sword. Still sharp.", "atk_bonus": 3},
    "shield":        {"desc": "A cracked iron shield, still serviceable.", "def_bonus": 2},
    "torch":         {"desc": "A pitch-black torch. Unlit but useful.", "light": True},
    "healing_potion":{"desc": "A vial of cloudy liquid. Restores 10 HP.", "heal": 10},
    "cellar_potion": {"desc": "An older potion, dusty but intact. Restores 8 HP.", "heal": 8},
    "goblin_key":    {"desc": "A crude iron key. Opens something small."},
    "troll_tooth":   {"desc": "A massive yellow tooth. Souvenir."},
    "knight_helm":   {"desc": "A visored helm of black iron. Heavy."},
    "dragon_scale":  {"desc": "An ember-grey scale, warm to the touch. The quest object.",
                      "quest": True},
    "journal":       {"desc": "A leather journal. 'The dragon brought the collapse. "
                               "Its scale is the cure. Take it to the well.'"},
}

_DR_PLAYER_ATK  = 4   # base attack
_DR_PLAYER_DEF  = 0   # base defence

def _dr_atk(inv: list) -> int:
    bonus = sum(_DR_ITEMS.get(i, {}).get("atk_bonus", 0) for i in inv)
    return _DR_PLAYER_ATK + bonus

def _dr_def(inv: list) -> int:
    bonus = sum(_DR_ITEMS.get(i, {}).get("def_bonus", 0) for i in inv)
    return _DR_PLAYER_DEF + bonus

def _dr_room(state: DragonState):
    return _DR_ROOMS.get(state.room, _DR_ROOMS["village_square"])

def _dr_enemy_hp(state: DragonState) -> int:
    return state.enemies.get(state.room, {}).get("hp", 0)

def _dr_init_enemies() -> dict:
    """Build initial enemy HP map from room definitions."""
    result = {}
    for rk, rv in _DR_ROOMS.items():
        if "enemy" in rv:
            result[rk] = {"hp": rv["enemy"]["max_hp"]}
    return result

def _dr_cmd(state: DragonState, cmd: str) -> str:
    import random as _r
    cmd = cmd.strip().lower()
    room = _dr_room(state)

    # ── LOOK ──────────────────────────────────────────────────────────────
    if cmd in ("look", "l", ""):
        out = room["desc"]
        items = [i for i in room.get("items", []) if i not in state.flags]
        if items:
            out += f"\nItems: {', '.join(i.replace('_',' ') for i in items)}"
        enemy_def = room.get("enemy")
        ehp = _dr_enemy_hp(state)
        if enemy_def and ehp > 0:
            out += f"\nEnemy: {enemy_def['name']} (HP {ehp}/{enemy_def['max_hp']})"
        out += f"\nHP: {state.hp}/{state.max_hp}   ATK: {_dr_atk(state.inv)}   DEF: {_dr_def(state.inv)}"
        if state.inv:
            out += f"\nCarrying: {', '.join(i.replace('_',' ') for i in state.inv)}"
        return out

    # ── STATUS ─────────────────────────────────────────────────────────────
    if cmd in ("status", "stat", "stats"):
        return (f"HP: {state.hp}/{state.max_hp}  ATK: {_dr_atk(state.inv)}  "
                f"DEF: {_dr_def(state.inv)}\n"
                f"Inventory: {', '.join(i.replace('_',' ') for i in state.inv) or 'nothing'}")

    # ── GO ─────────────────────────────────────────────────────────────────
    if cmd.startswith("go ") or cmd in room["exits"]:
        direction = cmd.replace("go ", "").strip() if cmd.startswith("go ") else cmd
        enemy_def = room.get("enemy")
        ehp = _dr_enemy_hp(state)
        # Blocked by living enemy?
        if enemy_def and ehp > 0 and direction == enemy_def.get("guard_exit"):
            return f"The {enemy_def['name']} blocks your path. Deal with it first."
        # Normal exit
        dest = room["exits"].get(direction)
        if not dest and enemy_def and ehp <= 0:
            dest = enemy_def.get("guard_dest") if direction == enemy_def.get("guard_exit") else None
        if not dest:
            # Check if enemy was cleared for guard_dest
            if enemy_def and direction == enemy_def.get("guard_exit"):
                dest = enemy_def.get("guard_dest")
        if dest:
            state.room = dest
            new_room = _DR_ROOMS.get(dest, {})
            out = new_room.get("desc", "You move to a new area.")
            new_enemy = new_room.get("enemy")
            new_ehp = _dr_enemy_hp(state)
            if new_enemy and new_ehp > 0:
                out += f"\n\n{new_enemy['name']} is here! (HP {new_ehp})"
            return out
        return f"You can't go {direction} from here."

    # ── TAKE / GET ─────────────────────────────────────────────────────────
    if cmd.startswith(("take ", "get ", "pick up ")):
        item = cmd.split(None, 2)[-1].strip().replace(" ", "_")
        room_items = room.get("items", [])
        picked_items = [i for i in room_items if i not in state.flags]
        if item in picked_items:
            state.flags.add(f"taken_{item}")
            room_items.remove(item)
            state.inv.append(item)
            desc = _DR_ITEMS.get(item, {}).get("desc", "")
            return f"You take the {item.replace('_',' ')}. {desc}"
        return f"There's no {item.replace('_',' ')} here."

    # ── USE ────────────────────────────────────────────────────────────────
    if cmd.startswith("use "):
        item = cmd[4:].strip().replace(" ", "_")
        if item not in state.inv:
            return f"You don't have a {item.replace('_',' ')}."
        item_def = _DR_ITEMS.get(item, {})
        if "heal" in item_def:
            healed = min(item_def["heal"], state.max_hp - state.hp)
            state.hp = min(state.max_hp, state.hp + item_def["heal"])
            state.inv.remove(item)
            return f"You drink the {item.replace('_',' ')}. +{healed} HP. HP: {state.hp}/{state.max_hp}"
        if item_def.get("quest"):
            return ("The dragon scale pulses warmly. You need to take it to the well.")
        if item_def.get("light"):
            return "You hold the torch aloft, casting amber light."
        return f"You turn the {item.replace('_',' ')} over in your hands. Nothing happens."

    # ── EXAMINE ────────────────────────────────────────────────────────────
    if cmd.startswith(("examine ", "x ", "inspect ")):
        item = cmd.split(None, 1)[1].strip().replace(" ", "_")
        idef = _DR_ITEMS.get(item)
        if idef:
            return idef["desc"]
        return f"You see nothing special about the {item.replace('_',' ')}."

    # ── INVENTORY ──────────────────────────────────────────────────────────
    if cmd in ("inventory", "i", "inv"):
        if not state.inv:
            return "You carry nothing."
        lines = []
        for item in state.inv:
            idef = _DR_ITEMS.get(item, {})
            bonus = []
            if "atk_bonus" in idef: bonus.append(f"+{idef['atk_bonus']} ATK")
            if "def_bonus" in idef: bonus.append(f"+{idef['def_bonus']} DEF")
            if "heal" in idef:      bonus.append(f"+{idef['heal']} HP when used")
            b = f" ({', '.join(bonus)})" if bonus else ""
            lines.append(f"  {item.replace('_',' ')}{b}")
        return "Carrying:\n" + "\n".join(lines)

    # ── ATTACK ─────────────────────────────────────────────────────────────
    if cmd in ("attack", "fight", "a", "atk") or cmd.startswith("attack "):
        import random as _r
        enemy_def = room.get("enemy")
        ehp = _dr_enemy_hp(state)
        if not enemy_def or ehp <= 0:
            return "There's nothing to fight here."
        # Player attacks
        p_dmg = max(1, _r.randint(1, _dr_atk(state.inv)) - _r.randint(0, 1))
        new_ehp = max(0, ehp - p_dmg)
        state.enemies[state.room]["hp"] = new_ehp
        lines = [f"You strike the {enemy_def['name']} for {p_dmg} damage. "
                 f"({enemy_def['name']} HP: {new_ehp}/{enemy_def['max_hp']})"]
        # Enemy dead?
        if new_ehp <= 0:
            drop = enemy_def.get("drop")
            if drop:
                room.setdefault("items", []).append(drop)
                lines.append(f"The {enemy_def['name']} falls! It drops a {drop.replace('_',' ')}.")
            else:
                lines.append(f"The {enemy_def['name']} crumbles and falls!")
            if enemy_def.get("is_final"):
                state.done = True
                state.won  = True
                lines.append("\nThe Ashen Dragon shudders and collapses. The ember-light "
                             "fades from its eyes. A DRAGON SCALE lies at your feet.\n"
                             "You have completed Dragon's Tale. The kingdom can breathe again.")
            return "\n".join(lines)
        # Enemy counter-attacks
        e_dmg = max(0, _r.randint(1, enemy_def["atk"]) - _dr_def(state.inv))
        state.hp -= e_dmg
        lines.append(f"The {enemy_def['name']} retaliates for {e_dmg} damage. "
                     f"(Your HP: {state.hp}/{state.max_hp})")
        if state.hp <= 0:
            state.done = True
            state.won  = False
            lines.append(f"\nThe {enemy_def['name']} delivers the killing blow. "
                         "The world fades to black.\n-- GAME OVER -- (type 'restart' to play again)")
        return "\n".join(lines)

    # ── FLEE ───────────────────────────────────────────────────────────────
    if cmd in ("flee", "run", "escape"):
        enemy_def = room.get("enemy")
        ehp = _dr_enemy_hp(state)
        if not enemy_def or ehp <= 0:
            return "Nothing to flee from."
        exits = [d for d in room["exits"] if d != enemy_def.get("guard_exit", "")]
        if not exits:
            return "No way to retreat!"
        import random as _r
        direction = _r.choice(exits)
        dest = room["exits"][direction]
        state.room = dest
        e_dmg = max(0, enemy_def["atk"] // 2 - _dr_def(state.inv))
        state.hp -= e_dmg
        out = f"You flee {direction}! The {enemy_def['name']} clips you as you run ({e_dmg} dmg)."
        out += f"\nHP: {state.hp}/{state.max_hp}"
        if state.hp <= 0:
            state.done = True; state.won = False
            out += "\nYou collapse from your wounds.\n-- GAME OVER --"
        return out

    # ── RESTART ────────────────────────────────────────────────────────────
    if cmd in ("restart", "new", "reset"):
        state.room = "village_square"
        state.inv  = []
        state.hp   = state.max_hp
        state.done = False
        state.won  = False
        state.enemies = _dr_init_enemies()
        state.flags   = set()
        # Reset room items
        for rk, rv in _DR_ROOMS.items():
            if rk in _DR_ITEMS:
                pass  # items are stored in room dict directly
        return "You begin again.\n\n" + _DR_ROOMS["village_square"]["desc"]

    # ── QUIT ───────────────────────────────────────────────────────────────
    if cmd in ("quit", "q", "exit"):
        state.done = True; state.won = False
        return "You set down your sword. The adventure pauses."

    # ── HELP ───────────────────────────────────────────────────────────────
    if cmd in ("help", "?", "h"):
        return ("Commands: look (l), go <dir>, take/get <item>, examine/x <item>, "
                "inventory (i), use <item>, attack (a), flee, status, restart, quit.\n"
                "Directions: north/south/east/west/up/down.")

    return f"I don't understand '{cmd}'."


def dragon_start(session: str) -> dict:
    # Reset room items to originals each new game
    import copy
    for rk, rv in _DR_ROOMS.items():
        rv["items"] = list(_DR_ROOMS_ORIG.get(rk, {}).get("items", []))
    state = DragonState(
        room="village_square", inv=[], history=[], hp=20, max_hp=20,
        done=False, won=False, enemies=_dr_init_enemies(), flags=set(),
    )
    _dragon[session] = state
    intro = ("Dragon's Tale\n"
             "A kingdom in ash. One creature responsible.\n\n")
    intro += _dr_cmd(state, "look")
    state.history.append(("", intro))
    return {"session": session, "response": intro, "hp": state.hp,
            "max_hp": state.max_hp, "done": False, "won": False}


def dragon_cmd(session: str, cmd: str) -> dict:
    state = _dragon.get(session)
    if not state:
        return {"error": "session not found"}
    resp = _dr_cmd(state, cmd)
    state.history.append((cmd, resp))
    return {"response": resp, "room": state.room, "inv": state.inv,
            "hp": state.hp, "max_hp": state.max_hp,
            "done": state.done, "won": state.won}


# Preserve original room items for restart
_DR_ROOMS_ORIG = {rk: {"items": list(rv.get("items", []))}
                  for rk, rv in _DR_ROOMS.items()}


# ── Flask routes ───────────────────────────────────────────────────────────

# TRADER engine block — appended to recreation.py

# ═══════════════════════════════════════════════════════════════════════════
# TRADER  —  TradeWars-lite barter economy (Sprint 19)
# ═══════════════════════════════════════════════════════════════════════════

# Sectors and their base prices (synthetic post-collapse economy).
# Each sector has comparative advantage so cross-trading is always profitable.
_TR_SECTORS = {
    "homestead": {
        "desc": "Your fortified homestead. Safe harbour, poor selection.",
        "prices": {"food":  8, "water":  5, "fuel": 18, "medicine": 25, "ammo": 20, "tools": 15},
        "exits": ["market_town", "farmstead"],
    },
    "market_town": {
        "desc": "A busy trading post. Wide selection, average prices.",
        "prices": {"food": 10, "water":  7, "fuel": 15, "medicine": 22, "ammo": 18, "tools": 12},
        "exits": ["homestead", "fuel_depot", "medical_station"],
    },
    "farmstead": {
        "desc": "Farming collective. Cheap food and water, little else.",
        "prices": {"food":  4, "water":  3, "fuel": 20, "medicine": 30, "ammo": 25, "tools": 18},
        "exits": ["homestead", "bunker"],
    },
    "fuel_depot": {
        "desc": "Salvage operation. Fuel is cheapest here.",
        "prices": {"food": 14, "water": 10, "fuel":  8, "medicine": 28, "ammo": 22, "tools": 14},
        "exits": ["market_town", "bunker"],
    },
    "medical_station": {
        "desc": "Field hospital. Medicine at cost; everything else scarce.",
        "prices": {"food": 16, "water":  8, "fuel": 22, "medicine": 12, "ammo": 30, "tools": 20},
        "exits": ["market_town", "bunker"],
    },
    "bunker": {
        "desc": "Fortified bunker community. Ammo and tools cheap; food costly.",
        "prices": {"food": 20, "water": 12, "fuel": 16, "medicine": 24, "ammo":  9, "tools":  8},
        "exits": ["farmstead", "fuel_depot", "medical_station"],
    },
}

_TR_COMMODITIES = ["food", "water", "fuel", "medicine", "ammo", "tools"]
_TR_CARGO_MAX   = 20   # total units across all commodities
_TR_TURNS_START = 30
_TR_CREDITS_START = 200
_TR_PRICE_VARIANCE = 0.25   # ±25% per-session random variation

@dataclass
class TraderState:
    sector:  str
    credits: int
    cargo:   dict        # commodity -> qty
    turns:   int
    history: list
    prices:  dict        # sector -> commodity -> price (randomised at game start)
    done:    bool = False
    won:     bool = False

_trader: dict = {}   # session -> TraderState


def _tr_randomise_prices(rng) -> dict:
    """Build per-session price table with ±25% variance from base."""
    out = {}
    for sec, data in _TR_SECTORS.items():
        out[sec] = {}
        for com, base in data["prices"].items():
            lo = max(1, int(base * (1 - _TR_PRICE_VARIANCE)))
            hi = max(lo + 1, int(base * (1 + _TR_PRICE_VARIANCE)) + 1)
            out[sec][com] = rng.randint(lo, hi)
    return out


def _tr_cargo_total(state: TraderState) -> int:
    return sum(state.cargo.values())


def _tr_net_worth(state: TraderState) -> int:
    """Credits + cargo valued at current-sector prices."""
    sec_prices = state.prices[state.sector]
    return state.credits + sum(
        qty * sec_prices.get(com, 0) for com, qty in state.cargo.items()
    )


def _tr_price_table(state: TraderState) -> str:
    """ASCII price table for current sector."""
    rows = [f"  {'COMMODITY':<12} {'BUY':>5} {'SELL':>5}",
            "  " + "-" * 26]
    p = state.prices[state.sector]
    for com in _TR_COMMODITIES:
        price = p[com]
        sell  = max(1, price - 1)   # sell slightly below buy
        rows.append(f"  {com:<12} {price:>5} {sell:>5}")
    return "\n".join(rows)


def _tr_status(state: TraderState) -> str:
    sec  = _TR_SECTORS[state.sector]
    cargo_str = ", ".join(f"{q}x{c}" for c, q in state.cargo.items() if q > 0) or "empty"
    exits = ", ".join(sec["exits"])
    return (
        f"SECTOR: {state.sector.replace('_',' ').upper()}\n"
        f"{sec['desc']}\n\n"
        f"Credits: {state.credits}  |  Cargo: {_tr_cargo_total(state)}/{_TR_CARGO_MAX}"
        f"  |  Turns: {state.turns}\n"
        f"Cargo hold: {cargo_str}\n"
        f"Exits: {exits}\n\n"
        f"PRICES (buy / sell):\n{_tr_price_table(state)}"
    )


def _tr_cmd(state: TraderState, raw: str) -> str:
    if state.done:
        return "Game over. Start a new session to trade again."

    parts = raw.strip().lower().split()
    if not parts:
        return "Commands: go <sector>, buy <item> <qty>, sell <item> <qty>, status, prices, help"

    cmd = parts[0]

    # ── status / look ────────────────────────────────────────────────
    if cmd in ("status", "look", "l"):
        return _tr_status(state)

    # ── prices ───────────────────────────────────────────────────────
    if cmd in ("prices", "p"):
        return _tr_price_table(state)

    # ── help ─────────────────────────────────────────────────────────
    if cmd == "help":
        return (
            "TRADER — post-collapse barter sim\n\n"
            "  go <sector>       Travel to adjacent sector (costs 1 turn)\n"
            "  buy <item> <qty>  Buy commodities at current sector price\n"
            "  sell <item> <qty> Sell commodities (receive sell price)\n"
            "  status            Show current position and prices\n"
            "  prices            Show price table for this sector\n"
            "  help              This message\n\n"
            f"Sectors: {', '.join(_TR_SECTORS.keys())}\n"
            f"Commodities: {', '.join(_TR_COMMODITIES)}"
        )

    # ── go ───────────────────────────────────────────────────────────
    if cmd == "go":
        if len(parts) < 2:
            return "Go where? Specify a sector name."
        dest = "_".join(parts[1:])
        exits = _TR_SECTORS[state.sector]["exits"]
        if dest not in exits:
            return f"Can't reach {dest} from here. Exits: {', '.join(exits)}"
        state.sector = dest
        state.turns -= 1
        if state.turns <= 0:
            state.done = True
            nw = _tr_net_worth(state)
            state.won = nw > _TR_CREDITS_START
            return (
                f"You arrive at {dest.replace('_',' ').upper()}.\n"
                f"[GAME OVER — out of turns]\n"
                f"Final net worth: {nw} credits "
                f"({'profit!' if state.won else 'loss'} vs {_TR_CREDITS_START} start)"
            )
        return f"You travel to {dest.replace('_',' ').upper()}. Turns left: {state.turns}\n\n" + _tr_status(state)

    # ── buy ──────────────────────────────────────────────────────────
    if cmd == "buy":
        if len(parts) < 3:
            return "Usage: buy <item> <qty>"
        com = parts[1]
        if com not in _TR_COMMODITIES:
            return f"Unknown commodity: {com}. Options: {', '.join(_TR_COMMODITIES)}"
        try:
            qty = int(parts[2])
        except ValueError:
            return "Quantity must be a number."
        if qty <= 0:
            return "Quantity must be positive."
        free = _TR_CARGO_MAX - _tr_cargo_total(state)
        if qty > free:
            return f"Not enough cargo space. Free: {free} units."
        price = state.prices[state.sector][com]
        cost  = price * qty
        if cost > state.credits:
            return f"Not enough credits. Need {cost}, have {state.credits}."
        state.credits -= cost
        state.cargo[com] = state.cargo.get(com, 0) + qty
        return f"Bought {qty}x {com} @ {price} each. Cost: {cost}. Credits: {state.credits}."

    # ── sell ─────────────────────────────────────────────────────────
    if cmd == "sell":
        if len(parts) < 3:
            return "Usage: sell <item> <qty>"
        com = parts[1]
        if com not in _TR_COMMODITIES:
            return f"Unknown commodity: {com}. Options: {', '.join(_TR_COMMODITIES)}"
        try:
            qty = int(parts[2])
        except ValueError:
            return "Quantity must be a number."
        if qty <= 0:
            return "Quantity must be positive."
        have = state.cargo.get(com, 0)
        if qty > have:
            return f"You only have {have}x {com}."
        sell_price = max(1, state.prices[state.sector][com] - 1)
        earned = sell_price * qty
        state.cargo[com] -= qty
        state.credits += earned
        return f"Sold {qty}x {com} @ {sell_price} each. Earned: {earned}. Credits: {state.credits}."

    return f"Unknown command: {cmd}. Type 'help' for commands."


def trader_new(session: str) -> dict:
    import random as _r
    rng = _r.Random(session)   # deterministic per session-id
    prices = _tr_randomise_prices(rng)
    state  = TraderState(
        sector  = "homestead",
        credits = _TR_CREDITS_START,
        cargo   = {c: 0 for c in _TR_COMMODITIES},
        turns   = _TR_TURNS_START,
        history = [],
        prices  = prices,
    )
    _trader[session] = state
    intro = (
        "Welcome to TRADER — post-collapse barter economy.\n\n"
        + _tr_status(state)
        + "\n\nType 'help' for commands."
    )
    state.history.append(("start", intro))
    return {
        "session": session,
        "response": intro,
        "sector":  state.sector,
        "credits": state.credits,
        "cargo":   dict(state.cargo),
        "turns":   state.turns,
        "done":    state.done,
        "synthetic": True,
    }


def trader_cmd(session: str, cmd: str) -> dict:
    state = _trader.get(session)
    if state is None:
        return {"error": "session not found"}
    resp = _tr_cmd(state, cmd)
    state.history.append((cmd, resp))
    return {
        "session": session,
        "response": resp,
        "sector":  state.sector,
        "credits": state.credits,
        "cargo":   dict(state.cargo),
        "turns":   state.turns,
        "done":    state.done,
    }

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


    @app.route("/api/r/dragon/start", methods=["POST"])
    def _dragon_start():
        sid = (request.json or {}).get("session", f"d{int(time.time())}")
        return jsonify(dragon_start(sid))

    @app.route("/api/r/dragon/<session>/cmd", methods=["POST"])
    def _dragon_cmd_route(session):
        cmd = (request.json or {}).get("cmd", "")
        r = dragon_cmd(session, cmd)
        return (jsonify(r), 404) if "error" in r else jsonify(r)

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

    @app.route("/api/r/trader/start", methods=["POST"])
    def _trader_start():
        sid = (request.json or {}).get("session", f"t{int(time.time())}")
        return jsonify(trader_new(sid))

    @app.route("/api/r/trader/<session>/cmd", methods=["POST"])
    def _trader_cmd_route(session):
        cmd = (request.json or {}).get("cmd", "")
        r = trader_cmd(session, cmd)
        return (jsonify(r), 404) if "error" in r else jsonify(r)

# -- end of module - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

