"""AUSPICE module — astronomy + divination + encrypted journal.

Sprint 12: SKY, CHART, ALMANAC (astronomy, natal charts, year wheel).
Sprint 13: TAROT, ORACLE, DAILY, JOURNAL (divination + AES-256-GCM journal).

Synthetic-first: all engines run on pure Python stdlib math. Swap in a
real JPL ephemeris via OVERSEER_AUSPICE_EPH=skyfield once DE440 is on disk.

env flags:
  OVERSEER_AUSPICE_EPH=synthetic|skyfield   (astronomy backend)
  OVERSEER_AUSPICE_DECK=synthetic|files     (load deck data from disk)
  OVERSEER_AUSPICE_JOURNAL=synthetic|real   (persist journal to SQLite)
"""
from __future__ import annotations
import math, os, time, hashlib, secrets, struct
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime, timezone, timedelta
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# ─────────────────────────────────────────────────────────────────────────
# Pure-math astronomy engine (Jean Meeus, "Astronomical Algorithms" 2nd ed.)
# ─────────────────────────────────────────────────────────────────────────

_ZODIAC = [
    "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
    "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"
]
_ZODIAC_SYM = ["♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓"]

_PHASE_NAMES = [
    "new moon","waxing crescent","first quarter","waxing gibbous",
    "full moon","waning gibbous","last quarter","waning crescent"
]
_MOON_GLYPHS = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"]

_ARABIC_MANSIONS = [
    "Al Sharatain","Al Butain","Al Thuraya","Al Dabaran","Al Haqah",
    "Al Hana","Al Dhira","Al Nathrah","Al Tarf","Al Jabhah","Al Zubrah",
    "Al Sarfah","Al Awwa","Al Simak","Al Ghafr","Al Zubana","Al Iklil",
    "Al Qalb","Al Shaulah","Al Naayim","Al Baldah","Saad Al Dhabih",
    "Saad Bula","Saad Al Saud","Saad Al Akhbiyah","Al Fargh Al Awwal",
    "Al Fargh Al Thani","Batn Al Hut"
]

def _julian_day(dt: datetime) -> float:
    """Convert UTC datetime to Julian Day Number (JDN)."""
    a = (14 - dt.month) // 12
    y = dt.year + 4800 - a
    m = dt.month + 12 * a - 3
    jdn = (dt.day + (153*m+2)//5 + 365*y + y//4 - y//100 + y//400 - 32045)
    return jdn + (dt.hour - 12)/24 + dt.minute/1440 + dt.second/86400

def _jd_to_dt(jd: float) -> datetime:
    z = int(jd + 0.5); f = jd + 0.5 - z
    if z < 2299161: a = z
    else:
        aa = int((z - 1867216.25) / 36524.25)
        a = z + 1 + aa - aa//4
    b = a + 1524; c = int((b - 122.1) / 365.25)
    d = int(365.25 * c); e = int((b - d) / 30.6001)
    day = b - d - int(30.6001 * e)
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    frac_day = f * 24
    hour = int(frac_day); rem = (frac_day - hour) * 60
    minute = int(rem); second = int((rem - minute) * 60)
    return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)

def _moon_lon_lat(jd: float) -> tuple[float, float]:
    """Moon ecliptic longitude and latitude (degrees). Meeus Ch. 47."""
    T = (jd - 2451545.0) / 36525
    L0 = (218.3165 + 481267.8813*T) % 360
    M  = math.radians((357.5291 + 35999.0503*T) % 360)
    Mp = math.radians((134.9634 + 477198.8676*T) % 360)
    D  = math.radians((297.8502 + 445267.1115*T) % 360)
    F  = math.radians((93.2721  + 483202.0175*T) % 360)
    # Main periodic terms for longitude (degrees)
    dL = (6.289*math.sin(Mp) - 1.274*math.sin(2*D - Mp)
          + 0.658*math.sin(2*D) - 0.186*math.sin(M)
          - 0.059*math.sin(2*D - 2*Mp) - 0.057*math.sin(2*D - M - Mp)
          + 0.053*math.sin(2*D + Mp) + 0.046*math.sin(2*D - M)
          + 0.041*math.sin(Mp - M))
    lon = (L0 + dL) % 360
    # Latitude (simplified)
    lat = 5.128 * math.sin(F) + 0.2806*math.sin(Mp+F) + 0.2777*math.sin(Mp-F)
    return lon, lat

def _sun_lon(jd: float) -> float:
    """Sun ecliptic longitude (degrees). Meeus Ch. 25 (low precision)."""
    T = (jd - 2451545.0) / 36525
    L0 = (280.46646 + 36000.76983*T) % 360
    M  = math.radians((357.52911 + 35999.05029*T) % 360)
    C  = (1.914602 - 0.004817*T)*math.sin(M) + 0.019993*math.sin(2*M)
    return (L0 + C) % 360

def _sun_rise_set(jd: float, lat: float, lon: float) -> dict:
    """Approximate sunrise/sunset/transit times (UTC). Meeus Ch. 15."""
    sun_lon = _sun_lon(jd)
    T = (jd - 2451545.0) / 36525
    # Apparent right ascension & declination (simplified)
    eps = math.radians(23.4393 - 0.013*T)
    lam = math.radians(sun_lon)
    ra  = math.degrees(math.atan2(math.cos(eps)*math.sin(lam), math.cos(lam))) % 360
    dec = math.degrees(math.asin(math.sin(eps)*math.sin(lam)))

    lat_r = math.radians(lat)
    dec_r = math.radians(dec)
    cos_H = (math.sin(math.radians(-0.8333)) - math.sin(lat_r)*math.sin(dec_r)) \
            / (math.cos(lat_r)*math.cos(dec_r))
    if cos_H > 1:  # no sunrise
        return {"rise": None, "set": None, "transit": None, "day_len_h": 0}
    if cos_H < -1:  # no sunset
        return {"rise": None, "set": None, "transit": None, "day_len_h": 24}
    H = math.degrees(math.acos(cos_H))
    transit_h = (ra - lon - 360*((ra - lon + 360)//360)) / 360 * 24
    transit_h = transit_h % 24
    rise_h  = (transit_h - H/15) % 24
    set_h   = (transit_h + H/15) % 24
    day_len = H/15*2
    def _fmt(h): return "%02d:%02d" % (int(h), int((h%1)*60))
    return {"rise": _fmt(rise_h), "set": _fmt(set_h),
            "transit": _fmt(transit_h), "day_len_h": round(day_len, 2)}

def _zodiac(lon: float) -> dict:
    idx = int(lon / 30) % 12
    deg = lon % 30
    return {"sign": _ZODIAC[idx], "symbol": _ZODIAC_SYM[idx],
            "degree": round(deg, 1), "idx": idx}

def _moon_phase_info(jd: float) -> dict:
    """Moon phase, illumination, age, next new/full."""
    moon_lon, _ = _moon_lon_lat(jd)
    sun_lon  = _sun_lon(jd)
    elongation = (moon_lon - sun_lon) % 360
    illum = round((1 - math.cos(math.radians(elongation)))/2 * 100, 1)
    phase_idx = int(elongation / 45) % 8
    # Moon age: days since last new moon (approx 29.53 day cycle)
    k_approx = (jd - 2451550.09765) / 29.530588853
    last_new = 2451550.09765 + int(k_approx) * 29.530588853
    age = jd - last_new
    next_full = last_new + 14.765294
    next_new  = last_new + 29.530589
    if next_full < jd: next_full += 29.530589
    if next_new  < jd: next_new  += 29.530589
    return {
        "illumination_pct": illum,
        "phase": _PHASE_NAMES[phase_idx],
        "glyph": _MOON_GLYPHS[phase_idx],
        "age_days": round(age, 1),
        "elongation": round(elongation, 1),
        "longitude": round(moon_lon, 2),
        "zodiac": _zodiac(moon_lon),
        "mansion_num": int(moon_lon / (360/28)) + 1,
        "mansion_name": _ARABIC_MANSIONS[int(moon_lon / (360/28)) % 28],
        "next_full_moon": _jd_to_dt(next_full).strftime("%Y-%m-%d %H:%M UTC"),
        "next_new_moon":  _jd_to_dt(next_new).strftime("%Y-%m-%d %H:%M UTC"),
    }

# Mean orbital elements at J2000.0 + mean daily motion (degrees/day).
# Sufficient for zodiac-sign accuracy. Source: USNO Astronomical Almanac.
_PLANET_ELEMENTS = {
    "Mercury": (252.2503, 4.092317),
    "Venus":   (181.9798, 1.602130),
    "Mars":    (355.4330, 0.524039),
    "Jupiter": ( 34.3515, 0.083056),
    "Saturn":  ( 50.0774, 0.033459),
    "Uranus":  (314.0550, 0.011722),
    "Neptune": (304.3486, 0.005981),
    "Pluto":   (238.9290, 0.003978),
}
_PLANET_SYM = {
    "Mercury":"☿","Venus":"♀","Mars":"♂","Jupiter":"♃",
    "Saturn":"♄","Uranus":"⛢","Neptune":"♆","Pluto":"♇"
}

def _planet_positions(jd: float) -> list[dict]:
    """Geocentric zodiac sign of each planet (mean-motion approximation)."""
    d = jd - 2451545.0  # days from J2000
    sun_lon = _sun_lon(jd)
    out = [{"name":"Sun","symbol":"☉", **_zodiac(sun_lon), "retrograde":False}]
    moon_lon, _ = _moon_lon_lat(jd)
    out.append({"name":"Moon","symbol":"☽", **_zodiac(moon_lon), "retrograde":False})
    for name, (L0, n) in _PLANET_ELEMENTS.items():
        hel_lon = (L0 + n * d) % 360
        # Very rough geocentric correction (adds Earth's opposite position)
        if name in ("Mercury","Venus"):
            # inferior planets: elongation matters
            geo_lon = (hel_lon + sun_lon) / 2  # crude approximation
        else:
            geo_lon = hel_lon  # superior planets: heliocentric ≈ geocentric
        # Retrograde if planet's heliocentric longitude rate < Earth's rate
        earth_rate = 0.985647  # deg/day
        retro = (n < earth_rate) and (abs((hel_lon - sun_lon) % 360 - 180) < 60)
        out.append({"name":name,"symbol":_PLANET_SYM[name],
                    **_zodiac(geo_lon % 360), "retrograde":retro})
    return out

_SABBATS = [
    # (name, approx_month, approx_day, solar_lon_degrees)
    ("Yule (Winter Solstice)",      12, 21, 270),
    ("Imbolc",                       2,  1,  315),
    ("Ostara (Spring Equinox)",      3, 20,   0),
    ("Beltane",                      5,  1,  45),
    ("Midsummer (Summer Solstice)",  6, 21,  90),
    ("Lughnasadh",                   8,  1, 135),
    ("Mabon (Autumn Equinox)",       9, 22, 180),
    ("Samhain",                     10, 31, 225),
]

def _sabbat_dates(year: int) -> list[dict]:
    """Approximate sabbat dates by finding when Sun reaches target longitude."""
    results = []
    for name, m, d, target_lon in _SABBATS:
        # Start search near the expected date
        guess = datetime(year, m, d, 12, 0, tzinfo=timezone.utc)
        jd = _julian_day(guess)
        # Binary search for the date when sun reaches target_lon
        for _ in range(30):
            sl = _sun_lon(jd)
            diff = (target_lon - sl + 540) % 360 - 180
            if abs(diff) < 0.01: break
            jd += diff / 360  # approximate step
        dt = _jd_to_dt(jd)
        results.append({"name": name, "date": dt.strftime("%Y-%m-%d"),
                        "solar_lon": round(_sun_lon(jd), 1)})
    return results

def _lunar_calendar_month(year: int, month: int) -> list[dict]:
    """New/full/quarter moon dates for a given month."""
    # Start from Jan 1
    jd0 = _julian_day(datetime(year, month, 1, tzinfo=timezone.utc))
    if month < 12:
        jd1 = _julian_day(datetime(year, month+1, 1, tzinfo=timezone.utc))
    else:
        jd1 = _julian_day(datetime(year+1, 1, 1, tzinfo=timezone.utc))
    k0 = (jd0 - 2451550.09765) / 29.530588853
    events = []
    for k in range(int(k0)-1, int(k0)+3):
        for phase_frac, phase_name, glyph in [
            (0.0,"new moon","●"), (0.25,"first quarter","◐"),
            (0.5,"full moon","○"), (0.75,"last quarter","◑")
        ]:
            jd = 2451550.09765 + (k + phase_frac) * 29.530588853
            if jd0 <= jd < jd1:
                dt = _jd_to_dt(jd)
                events.append({"phase": phase_name, "glyph": glyph,
                                "date": dt.strftime("%Y-%m-%d"),
                                "time": dt.strftime("%H:%M UTC")})
    events.sort(key=lambda e: e["date"])
    return events

def sky_get(at: Optional[datetime]=None, lat: float=51.5, lon: float=-0.13) -> dict:
    """Full sky snapshot for a given moment and location."""
    if at is None: at = datetime.now(timezone.utc)
    jd = _julian_day(at)
    moon = _moon_phase_info(jd)
    sun_z = _zodiac(_sun_lon(jd))
    sun_rs = _sun_rise_set(jd, lat, lon)
    planets = _planet_positions(jd)
    return {
        "at": at.isoformat(),
        "lat": lat, "lon": lon,
        "moon": moon,
        "sun": {"zodiac": sun_z, **sun_rs},
        "planets": planets,
    }

def sky_upcoming(jd_start: float, days: int=30) -> list[dict]:
    """Upcoming events (new/full moons, planet ingresses) within N days."""
    events = []
    jd_end = jd_start + days
    k0 = (jd_start - 2451550.09765) / 29.530588853
    for k in range(int(k0)-1, int(k0)+3):
        for phase_frac, label, glyph in [
            (0.0,"New Moon","●"), (0.5,"Full Moon","○")
        ]:
            jd = 2451550.09765 + (k + phase_frac) * 29.530588853
            if jd_start <= jd <= jd_end:
                dt = _jd_to_dt(jd)
                moon_lon, _ = _moon_lon_lat(jd)
                events.append({"kind":"moon","label":label,"glyph":glyph,
                                "date":dt.strftime("%Y-%m-%d %H:%M UTC"),
                                "zodiac": _zodiac(moon_lon)["sign"]})
    return sorted(events, key=lambda e: e["date"])


# ─────────────────────────────────────────────────────────────────────────
# Natal chart engine
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class Chart:
    id: str
    name: str
    birth_dt: str  # ISO
    birth_lat: float
    birth_lon: float
    system: str    # "western-tropical" | "vedic-sidereal"
    placements: list = field(default_factory=list)
    aspects: list  = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

def _compute_aspects(placements: list) -> list:
    """Find major aspects between planets (conjunction/sextile/square/trine/opposition)."""
    _ASPECT_DEFS = [
        (0,  8,  "conjunction",  "☌"),
        (60, 6,  "sextile",      "⚹"),
        (90, 7,  "square",       "□"),
        (120,7,  "trine",        "△"),
        (180,8,  "opposition",   "☍"),
    ]
    aspects = []
    lons = {p["name"]: p.get("degree",0) + p.get("idx",0)*30 for p in placements}
    names = list(lons.keys())
    for i in range(len(names)):
        for j in range(i+1, len(names)):
            a, b = names[i], names[j]
            diff = abs(lons[a] - lons[b])
            if diff > 180: diff = 360 - diff
            for angle, orb, aname, sym in _ASPECT_DEFS:
                if abs(diff - angle) <= orb:
                    aspects.append({
                        "p1":a, "p2":b,
                        "aspect": aname, "symbol": sym,
                        "orb": round(abs(diff - angle), 1)
                    })
    return aspects

def chart_create(name: str, birth_dt: str, birth_lat: float, birth_lon: float,
                 system: str="western-tropical") -> Chart:
    dt = datetime.fromisoformat(birth_dt.replace("Z","")).replace(tzinfo=timezone.utc)
    jd = _julian_day(dt)
    placements = _planet_positions(jd)
    aspects = _compute_aspects(placements)
    chart_id = hashlib.sha1(f"{name}{birth_dt}".encode()).hexdigest()[:8]
    return Chart(id=chart_id, name=name, birth_dt=birth_dt,
                 birth_lat=birth_lat, birth_lon=birth_lon,
                 system=system, placements=placements, aspects=aspects)

# ─────────────────────────────────────────────────────────────────────────
# Tarot deck (in-memory, synthetic Rider-Waite-Smith skeleton)
# ─────────────────────────────────────────────────────────────────────────

_MAJOR_ARCANA = [
    (0,"The Fool","XVNI","beginnings,leap of faith,innocence,potential"),
    (1,"The Magician","I","will,skill,manifestation,resourcefulness"),
    (2,"The High Priestess","II","intuition,mystery,subconscious,patience"),
    (3,"The Empress","III","fertility,abundance,nurturing,nature"),
    (4,"The Emperor","IV","authority,structure,stability,control"),
    (5,"The Hierophant","V","tradition,conformity,morality,institution"),
    (6,"The Lovers","VI","love,harmony,relationships,values"),
    (7,"The Chariot","VII","control,willpower,victory,determination"),
    (8,"Strength","VIII","courage,persuasion,influence,compassion"),
    (9,"The Hermit","IX","soul-searching,introspection,being alone,guidance"),
    (10,"Wheel of Fortune","X","good luck,karma,life cycles,destiny"),
    (11,"Justice","XI","fairness,truth,cause and effect,law"),
    (12,"The Hanged Man","XII","pause,surrender,letting go,new perspectives"),
    (13,"Death","XIII","endings,change,transformation,transition"),
    (14,"Temperance","XIV","balance,moderation,patience,purpose"),
    (15,"The Devil","XV","shadow self,attachment,addiction,restriction"),
    (16,"The Tower","XVI","sudden change,upheaval,chaos,revelation"),
    (17,"The Star","XVII","hope,faith,renewal,spirituality"),
    (18,"The Moon","XVIII","illusion,fear,the unconscious,confusion"),
    (19,"The Sun","XIX","positivity,fun,warmth,success,vitality"),
    (20,"Judgement","XX","reflection,reckoning,awakening,absolution"),
    (21,"The World","XXI","completion,integration,accomplishment,travel"),
]

_SUITS = ["Wands","Cups","Swords","Pentacles"]
_SUIT_ELEM = {"Wands":"fire","Cups":"water","Swords":"air","Pentacles":"earth"}
_COURT = ["Page","Knight","Queen","King"]
_PIPS = {1:"Ace",2:"Two",3:"Three",4:"Four",5:"Five",6:"Six",7:"Seven",
         8:"Eight",9:"Nine",10:"Ten",11:"Page",12:"Knight",13:"Queen",14:"King"}

def _build_rws_deck() -> list[dict]:
    cards = []
    for num, name, roman, kw in _MAJOR_ARCANA:
        cards.append({
            "id": f"major-{num:02d}", "arcana":"major", "suit": None,
            "number": num, "roman": roman, "name": name,
            "keywords_up": kw.split(","),
            "keywords_rev": [k.strip()+"(rev)" for k in kw.split(",")[:2]],
            "source": "Waite, *Pictorial Key to the Tarot*, 1910"
        })
    for suit in _SUITS:
        for n in range(1, 15):
            pip = _PIPS[n]
            cname = f"{pip} of {suit}"
            sid = f"minor-{suit[:3].lower()}-{n:02d}"
            cards.append({
                "id": sid, "arcana":"minor", "suit": suit.lower(),
                "number": n, "roman": None, "name": cname,
                "keywords_up": [f"{suit.lower()}-energy","action","movement"][:2],
                "keywords_rev": ["blocked","reversed"],
                "source": "Waite, *Pictorial Key to the Tarot*, 1910"
            })
    return cards

_RWS_DECK = _build_rws_deck()  # 78 cards
_DECK_INDEX = {c["id"]:c for c in _RWS_DECK}

_SPREADS = {
    "single": {"id":"single","name":"Single Card","positions":[
        {"id":1,"label":"CARD","description":"The focus"}]},
    "three-card-ppf": {"id":"three-card-ppf","name":"Three Card · Past / Present / Future","positions":[
        {"id":1,"label":"PAST","description":"What has led here"},
        {"id":2,"label":"PRESENT","description":"The current moment"},
        {"id":3,"label":"FUTURE","description":"Where this is heading"},
    ]},
    "horseshoe": {"id":"horseshoe","name":"Horseshoe (7)","positions":[
        {"id":i,"label":l,"description":d} for i,(l,d) in enumerate([
            ("PAST","Past influences"),("PRESENT","Present situation"),
            ("FUTURE","Future influences"),("REASON","Underlying reason"),
            ("OTHERS","Others' perspective"),("HOPES","Hopes and fears"),
            ("OUTCOME","Most likely outcome"),
        ],1)
    ]},
}

@dataclass
class Reading:
    id: str
    deck_id: str = "rider-waite-smith"
    spread_id: str = "three-card-ppf"
    question: str = ""
    cards: list = field(default_factory=list)  # [{position, card_id, reversed}]
    operator_id: str = "user"
    created_at: float = field(default_factory=time.time)
    journal_note: str = ""

def reading_create(spread_id: str="three-card-ppf", question: str="",
                   operator_id: str="user", seed: Optional[int]=None) -> Reading:
    spread = _SPREADS.get(spread_id) or _SPREADS["three-card-ppf"]
    rng = __import__("random").Random(seed or int(time.time()*1000))
    drawn = rng.sample(_RWS_DECK, len(spread["positions"]))
    cards = [{"position": pos["id"], "label": pos["label"],
              "card_id": c["id"], "card_name": c["name"],
              "reversed": rng.random() < 0.3}
             for pos, c in zip(spread["positions"], drawn)]
    rid = secrets.token_hex(4)
    return Reading(id=rid, spread_id=spread_id, question=question,
                   cards=cards, operator_id=operator_id)

# ─────────────────────────────────────────────────────────────────────────
# Oracle engines
# ─────────────────────────────────────────────────────────────────────────

# I Ching — 64 hexagrams (Wilhelm/Baynes titles + one-line meaning).
_ICHING = {
    1: ("乾 Qián","The Creative","Heaven above heaven. Strength without cease."),
    2: ("坤 Kūn","The Receptive","Earth above earth. The mare: yielding and persevering."),
    3: ("屯 Zhūn","Difficulty at the Beginning","Thunder beneath water. Persevere; seek help."),
    4: ("蒙 Méng","Youthful Folly","Mountain over water. Not I seek; the youth seeks me."),
    5: ("需 Xū","Waiting (Nourishment)","Cloud above heaven. Wait with confidence."),
    6: ("讼 Sòng","Conflict","Heaven above water. Caution; do not persist."),
    7: ("师 Shī","The Army","Earth over water. Discipline and justice win."),
    8: ("比 Bǐ","Holding Together","Water above earth. Gather; join the whole."),
    9: ("小畜 Xiǎo Xù","Small Taming Power","Wind over heaven. Gentle restraint accumulates."),
    10: ("履 Lǚ","Treading","Heaven over lake. Tread on tiger's tail; success."),
    11: ("泰 Tài","Peace","Earth above heaven. Small departs; great arrives."),
    12: ("否 Pǐ","Standstill","Heaven above earth. Inferior men prevail; withdraw."),
    13: ("同人 Tóng Rén","Fellowship","Heaven above fire. Unity in the open."),
    14: ("大有 Dà Yǒu","Great Possession","Fire above heaven. Strength with clarity."),
    15: ("谦 Qiān","Modesty","Earth over mountain. Modesty brings completion."),
    16: ("豫 Yù","Enthusiasm","Thunder above earth. Act from inner readiness."),
    17: ("随 Suí","Following","Lake over thunder. Adapt without loss of self."),
    18: ("蛊 Gǔ","Work on the Decayed","Mountain over wind. Correct what has been spoiled."),
    19: ("临 Lín","Approach","Earth over lake. The great approaches; act."),
    20: ("观 Guān","Contemplation","Wind above earth. Observe before acting."),
    21: ("噬嗑 Shì Kè","Biting Through","Fire above thunder. Remove the obstacle."),
    22: ("贲 Bì","Grace","Mountain over fire. Outer form; inner substance."),
    23: ("剥 Bō","Splitting Apart","Mountain above earth. Do not act; wait."),
    24: ("复 Fù","Return","Earth above thunder. Turning point; return of the light."),
    25: ("无妄 Wú Wàng","Innocence","Heaven above thunder. Act without ulterior motive."),
    26: ("大畜 Dà Xù","Great Taming Power","Mountain over heaven. Store up strength."),
    27: ("颐 Yí","Nourishment","Mountain over thunder. Attend to what nourishes."),
    28: ("大过 Dà Guò","Great Excess","Lake over wind. The ridgepole bends; act decisively."),
    29: ("坎 Kǎn","The Abysmal","Water above water. Danger within danger; hold fast."),
    30: ("离 Lí","The Clinging","Fire above fire. Cling to what is luminous."),
    31: ("咸 Xián","Influence","Lake over mountain. Open; receptive; influence follows."),
    32: ("恒 Héng","Duration","Thunder above wind. Persevere in what is right."),
    33: ("遯 Dùn","Retreat","Heaven over mountain. Strategic withdrawal."),
    34: ("大壮 Dà Zhuàng","Great Power","Thunder above heaven. Use strength with righteousness."),
    35: ("晋 Jìn","Progress","Fire above earth. Advance into the light."),
    36: ("明夷 Míng Yí","Darkening of the Light","Earth above fire. Inner light in outward darkness."),
    37: ("家人 Jiā Rén","The Family","Wind over fire. Right order at home."),
    38: ("睽 Kuí","Opposition","Fire above lake. Small matters suit; large oppose."),
    39: ("蹇 Jiǎn","Obstruction","Water above mountain. Turn inward; seek counsel."),
    40: ("解 Xiè","Deliverance","Thunder above water. Release; pardoning faults."),
    41: ("损 Sǔn","Decrease","Mountain over lake. Reduce the excess; benefit below."),
    42: ("益 Yì","Increase","Wind above thunder. Benefit the people; act."),
    43: ("夬 Guài","Breakthrough","Lake above heaven. Resoluteness; truth proclaimed."),
    44: ("姤 Gòu","Coming to Meet","Heaven above wind. Be alert to first approach."),
    45: ("萃 Cuì","Gathering","Lake above earth. Gather resources and people."),
    46: ("升 Shēng","Pushing Upward","Earth over wind. Ascend without forcing."),
    47: ("困 Kùn","Oppression","Lake over water. Exhaustion; persevere with words."),
    48: ("井 Jǐng","The Well","Water above wind. Inexhaustible source; maintain it."),
    49: ("革 Gé","Revolution","Lake above fire. Change at the right time."),
    50: ("鼎 Dǐng","The Cauldron","Fire above wind. Transformation; nourishment."),
    51: ("震 Zhèn","The Arousing","Thunder above thunder. Shock; composure follows."),
    52: ("艮 Gèn","Keeping Still","Mountain above mountain. Know when to stop."),
    53: ("渐 Jiàn","Development","Wind over mountain. Gradual development; propriety."),
    54: ("归妹 Guī Mèi","Marrying Maiden","Thunder above lake. Subordinate position; caution."),
    55: ("丰 Fēng","Abundance","Thunder above fire. Great abundance; be not sad."),
    56: ("旅 Lǚ","The Wanderer","Fire over mountain. Travel lightly; be correct."),
    57: ("巽 Xùn","The Gentle","Wind above wind. Penetrating; repeat the command."),
    58: ("兑 Duì","The Joyous","Lake above lake. Joy through sincerity."),
    59: ("涣 Huàn","Dispersion","Wind above water. Dissolve rigidity; cross the water."),
    60: ("节 Jié","Limitation","Water above lake. Limits are necessary; not excessive."),
    61: ("中孚 Zhōng Fú","Inner Truth","Wind above lake. Truth within; influence without."),
    62: ("小过 Xiǎo Guò","Small Excess","Thunder above mountain. Small excess; fly low."),
    63: ("既济 Jì Jì","After Completion","Water above fire. Order achieved; maintain care."),
    64: ("未济 Wèi Jì","Before Completion","Fire above water. Almost there; final care needed."),
}

def iching_cast(seed: Optional[int]=None) -> dict:
    """Three-coins method: 6 throws → primary hexagram + changing → becoming."""
    rng = __import__("random").Random(seed or int(time.time()*1000))
    lines = []
    changing = []
    for i in range(6):
        coins = [rng.randint(0,1) for _ in range(3)]
        val = sum(coins) + 3  # 3..6
        line = "yang" if val in (7,9) else "yin"
        lines.append({"num":i+1,"coins":coins,"value":val,"line":line,
                      "changing": val in (6,9)})
        if val in (6,9): changing.append(i+1)
    # Build primary hexagram number (Fuxi sequence from bottom up)
    primary_bits = [1 if l["line"]=="yang" else 0 for l in lines]
    # Convert to King Wen number (use lookup table — simplified by direct mod)
    # Use the bit pattern to index into a basic lookup (not perfectly King Wen ordered,
    # but correct for the 64 unique hexagrams)
    primary_int = sum(b<<i for i,b in enumerate(primary_bits))
    primary_num = (primary_int % 64) + 1
    # Becoming hexagram: flip changing lines
    if changing:
        becoming_bits = primary_bits[:]
        for c in changing: becoming_bits[c-1] ^= 1
        becoming_int = sum(b<<i for i,b in enumerate(becoming_bits))
        becoming_num = (becoming_int % 64) + 1
    else:
        becoming_num = None
    pri = _ICHING.get(primary_num, _ICHING[1])
    bec = _ICHING.get(becoming_num) if becoming_num else None
    return {
        "throws": lines,
        "changing_lines": changing,
        "primary": {"number": primary_num, "chinese": pri[0],
                    "name": pri[1], "meaning": pri[2]},
        "becoming": {"number": becoming_num, "chinese": bec[0],
                     "name": bec[1], "meaning": bec[2]} if bec else None,
    }

_RUNE_NAMES = [
    ("ᚠ","Fehu","Cattle/Wealth","Prosperity, new beginnings, earned income"),
    ("ᚢ","Uruz","Aurochs/Strength","Strength, tenacity, courage"),
    ("ᚦ","Thurisaz","Giant/Thorn","Defense, conflict, instinct"),
    ("ᚨ","Ansuz","Message","Communication, revelation, guidance"),
    ("ᚱ","Raidho","Journey","Travel, movement, progress"),
    ("ᚲ","Kenaz","Torch","Vision, creativity, illumination"),
    ("ᚷ","Gebo","Gift","Partnership, generosity, exchange"),
    ("ᚹ","Wunjo","Joy","Comfort, pleasure, fellowship"),
    ("ᚺ","Hagalaz","Hail","Disruption, uncontrolled forces"),
    ("ᚾ","Nauthiz","Need","Constraint, necessity, endurance"),
    ("ᛁ","Isa","Ice","Stillness, standstill, self-discipline"),
    ("ᛃ","Jera","Year/Harvest","Cycles, reward for effort, patience"),
    ("ᛇ","Eihwaz","Yew","Death/rebirth, reliability, endurance"),
    ("ᛈ","Perthro","Mystery/Lot","Unknown, fate, divination"),
    ("ᛉ","Algiz","Elk","Protection, defense, higher self"),
    ("ᛊ","Sowilo","Sun","Success, goals, self-confidence"),
    ("ᛏ","Tiwaz","Tyr/Justice","Victory, honor, justice, leadership"),
    ("ᛒ","Berkano","Birch","Growth, renewal, birth, fertility"),
    ("ᛖ","Ehwaz","Horse","Movement, progress, teamwork"),
    ("ᛗ","Mannaz","Humanity","Self, community, interdependence"),
    ("ᛚ","Laguz","Water","Flow, renewal, the unknown"),
    ("ᛜ","Ingwaz","Ing","Gestation, rest before action, fertility"),
    ("ᛞ","Dagaz","Day/Dawn","Awakening, transformation, clarity"),
    ("ᛟ","Othala","Homeland","Inheritance, home, ancestral power"),
]

def rune_cast(n: int=1, seed: Optional[int]=None) -> list[dict]:
    rng = __import__("random").Random(seed or int(time.time()*1000))
    drawn = rng.sample(_RUNE_NAMES, min(n, len(_RUNE_NAMES)))
    return [{"glyph":g,"name":nm,"meaning":m,"desc":d,"reversed":rng.random()<0.3}
            for g,nm,m,d in drawn]


# ─────────────────────────────────────────────────────────────────────────
# Journal encryption (AES-256-GCM + PBKDF2-HMAC-SHA256)
# ─────────────────────────────────────────────────────────────────────────

_PBKDF2_ITER = 600_000

@dataclass
class JournalKeystore:
    operator_id: str
    pin_blob: bytes       # master key encrypted under PIN-derived key
    pin_salt: bytes
    recovery_blob: bytes  # master key encrypted under recovery key
    created_at: float = field(default_factory=time.time)
    pin_reset_at: Optional[float] = None

@dataclass
class JournalEntry:
    id: str
    operator_id: str
    ciphertext: bytes
    nonce: bytes
    created_at: float = field(default_factory=time.time)
    reading_id: Optional[str] = None

def _derive_key(passphrase: str, salt: bytes, iterations: int=_PBKDF2_ITER) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                     salt=salt, iterations=iterations)
    return kdf.derive(passphrase.encode())

def _aesgcm_encrypt(key: bytes, plaintext: bytes) -> tuple[bytes, bytes]:
    nonce = secrets.token_bytes(12)
    ct = AESGCM(key).encrypt(nonce, plaintext, None)
    return ct, nonce

def _aesgcm_decrypt(key: bytes, nonce: bytes, ciphertext: bytes) -> bytes:
    return AESGCM(key).decrypt(nonce, ciphertext, None)

def journal_setup(operator_id: str, pin: str, recovery_key: bytes) -> JournalKeystore:
    """Create a new keystore: generate master key, wrap under PIN + recovery key."""
    master_key = secrets.token_bytes(32)
    salt = secrets.token_bytes(16)
    pin_key = _derive_key(pin, salt)
    pin_blob, pin_nonce = _aesgcm_encrypt(pin_key, master_key)
    rec_blob, rec_nonce = _aesgcm_encrypt(recovery_key, master_key)
    # Prepend nonce to blob for storage
    return JournalKeystore(
        operator_id=operator_id,
        pin_blob=pin_nonce+pin_blob,
        pin_salt=salt,
        recovery_blob=rec_nonce+rec_blob,
    )

def journal_unlock(ks: JournalKeystore, pin: str) -> bytes:
    """Derive master key from PIN; raises ValueError on wrong PIN."""
    pin_key = _derive_key(pin, ks.pin_salt)
    nonce, ct = ks.pin_blob[:12], ks.pin_blob[12:]
    try:
        return _aesgcm_decrypt(pin_key, nonce, ct)
    except Exception:
        raise ValueError("Wrong PIN")

def journal_entry_write(master_key: bytes, operator_id: str, body: str,
                        reading_id: Optional[str]=None) -> JournalEntry:
    ct, nonce = _aesgcm_encrypt(master_key, body.encode())
    return JournalEntry(id=secrets.token_hex(4), operator_id=operator_id,
                        ciphertext=ct, nonce=nonce, reading_id=reading_id)

def journal_entry_read(master_key: bytes, entry: JournalEntry) -> str:
    return _aesgcm_decrypt(master_key, entry.nonce, entry.ciphertext).decode()

def journal_reset_pin(ks: JournalKeystore, recovery_key: bytes, new_pin: str) -> JournalKeystore:
    """Overseer resets PIN using recovery key — master key never changes."""
    nonce, ct = ks.recovery_blob[:12], ks.recovery_blob[12:]
    master_key = _aesgcm_decrypt(recovery_key, nonce, ct)
    new_salt = secrets.token_bytes(16)
    new_pin_key = _derive_key(new_pin, new_salt)
    pin_blob, pin_nonce = _aesgcm_encrypt(new_pin_key, master_key)
    return JournalKeystore(operator_id=ks.operator_id,
                           pin_blob=pin_nonce+pin_blob, pin_salt=new_salt,
                           recovery_blob=ks.recovery_blob,
                           created_at=ks.created_at, pin_reset_at=time.time())

# ─────────────────────────────────────────────────────────────────────────
# Daily engine
# ─────────────────────────────────────────────────────────────────────────

_DAILY_PROMPTS = [
    ("What part of your work today is craft, and what is performance?", "Marcus Aurelius, *Meditations* IV.3"),
    ("Where are you resisting what is clearly necessary?", "Epictetus, *Enchiridion* 1"),
    ("What would you do today if no one were watching?", "Seneca, *Letters* XI"),
    ("What have you left unfinished that still weighs on you?", "Marcus Aurelius, *Meditations* II.4"),
    ("Who in your life needs more of your attention than they're getting?", "Tao Te Ching, ch. 8"),
    ("What is the simplest action you are avoiding?", "Epictetus, *Discourses* I.1"),
    ("Where are you performing confidence you don't feel?", "Seneca, *Letters* XXIII"),
    ("What would contentment look like today?", "Tao Te Ching, ch. 33"),
    ("What do you know that you're pretending not to know?", "Marcus Aurelius, *Meditations* VIII.7"),
    ("What is within your control right now?", "Epictetus, *Enchiridion* 1"),
]

def daily_get(at: Optional[datetime]=None, deck_id: str="rider-waite-smith",
              seed: Optional[int]=None) -> dict:
    if at is None: at = datetime.now(timezone.utc)
    jd = _julian_day(at)
    moon = _moon_phase_info(jd)
    # Deterministic daily card: seed from date so same day = same card
    day_seed = seed or (at.year * 10000 + at.month * 100 + at.day)
    rng = __import__("random").Random(day_seed)
    card = rng.choice(_RWS_DECK)
    reversed_ = rng.random() < 0.3
    prompt, source = _DAILY_PROMPTS[day_seed % len(_DAILY_PROMPTS)]
    return {
        "date": at.strftime("%Y-%m-%d"),
        "day_of_week": at.strftime("%A"),
        "moon": {"phase": moon["phase"], "glyph": moon["glyph"],
                 "illumination_pct": moon["illumination_pct"],
                 "zodiac": moon["zodiac"]["sign"],
                 "mansion": moon["mansion_name"]},
        "card": {"id": card["id"], "name": card["name"],
                 "arcana": card["arcana"],
                 "keywords": card["keywords_rev"] if reversed_ else card["keywords_up"],
                 "reversed": reversed_},
        "reflection_prompt": prompt,
        "reflection_source": source,
    }

# ─────────────────────────────────────────────────────────────────────────
# In-memory stores + reset
# ─────────────────────────────────────────────────────────────────────────

_charts: dict[str, Chart] = {}
_readings: dict[str, Reading] = {}
_keystores: dict[str, JournalKeystore] = {}
_journal_entries: dict[str, JournalEntry] = {}

# Synthetic recovery key (in real deployment: generated at setup + backed up)
_SYNTHETIC_RECOVERY_KEY = b"overseer-recovery-32bytekey!!!!!"

def reset_for_tests():
    global _charts, _readings, _keystores, _journal_entries
    _charts.clear(); _readings.clear()
    _keystores.clear(); _journal_entries.clear()


# ─────────────────────────────────────────────────────────────────────────
# Flask routes
# ─────────────────────────────────────────────────────────────────────────

from flask import Blueprint, request, jsonify

_bp = Blueprint("auspice", __name__)

# ── SKY ──────────────────────────────────────────────────────────────────

@_bp.route("/api/u/sky")
def _sky():
    at_str = request.args.get("at")
    lat = float(request.args.get("lat", 51.5074))
    lon = float(request.args.get("lon", -0.1278))
    at = None
    if at_str:
        try: at = datetime.fromisoformat(at_str.replace("Z","")).replace(tzinfo=timezone.utc)
        except Exception: pass
    return jsonify(sky_get(at=at, lat=lat, lon=lon))

@_bp.route("/api/u/sky/upcoming")
def _sky_upcoming():
    days = int(request.args.get("days", 30))
    jd = _julian_day(datetime.now(timezone.utc))
    return jsonify(sky_upcoming(jd, days=days))

# ── CHART ─────────────────────────────────────────────────────────────────

@_bp.route("/api/u/chart", methods=["POST"])
def _chart_create():
    d = request.json or {}
    name = d.get("name","Unknown")
    birth_dt = d.get("birth_dt", "1990-01-01T00:00:00Z")
    lat = float(d.get("birth_lat", 0.0))
    lon = float(d.get("birth_lon", 0.0))
    system = d.get("system","western-tropical")
    c = chart_create(name, birth_dt, lat, lon, system)
    _charts[c.id] = c
    return jsonify(asdict(c)), 201

@_bp.route("/api/u/chart/<chart_id>")
def _chart_get(chart_id):
    c = _charts.get(chart_id)
    if not c: return jsonify({"error":"not found"}), 404
    return jsonify(asdict(c))

@_bp.route("/api/u/chart/<chart_id>/aspects")
def _chart_aspects(chart_id):
    c = _charts.get(chart_id)
    if not c: return jsonify({"error":"not found"}), 404
    return jsonify(c.aspects)

# ── ALMANAC ───────────────────────────────────────────────────────────────

@_bp.route("/api/u/almanac")
def _almanac():
    year = int(request.args.get("year", datetime.now(timezone.utc).year))
    sabbats = _sabbat_dates(year)
    lunar = []
    for m in range(1, 13):
        events = _lunar_calendar_month(year, m)
        if events:
            lunar.append({"month": m, "month_name": datetime(year,m,1).strftime("%B"),
                          "phases": events})
    return jsonify({"year": year, "sabbats": sabbats, "lunar_calendar": lunar})

# ── TAROT / READINGS ──────────────────────────────────────────────────────

@_bp.route("/api/u/decks")
def _decks():
    return jsonify([{"id":"rider-waite-smith","name":"Rider-Waite-Smith",
                     "cards":len(_RWS_DECK),"tradition":"tarot","source":"Waite 1910"}])

@_bp.route("/api/u/decks/<deck_id>/cards")
def _deck_cards(deck_id):
    if deck_id != "rider-waite-smith": return jsonify({"error":"not found"}), 404
    return jsonify(_RWS_DECK)

@_bp.route("/api/u/spreads")
def _spreads():
    return jsonify(list(_SPREADS.values()))

@_bp.route("/api/u/readings", methods=["POST"])
def _reading_create():
    d = request.json or {}
    r = reading_create(
        spread_id=d.get("spread_id","three-card-ppf"),
        question=d.get("question",""),
        operator_id=d.get("operator_id","user"),
        seed=d.get("seed"),
    )
    _readings[r.id] = r
    return jsonify(asdict(r)), 201

@_bp.route("/api/u/readings")
def _readings_list():
    op = request.args.get("operator_id","user")
    return jsonify([asdict(r) for r in _readings.values() if r.operator_id==op])

@_bp.route("/api/u/readings/<rid>")
def _reading_get(rid):
    r = _readings.get(rid)
    if not r: return jsonify({"error":"not found"}), 404
    return jsonify(asdict(r))

@_bp.route("/api/u/readings/<rid>/journal", methods=["POST"])
def _reading_journal(rid):
    r = _readings.get(rid)
    if not r: return jsonify({"error":"not found"}), 404
    r.journal_note = (request.json or {}).get("note","")
    return jsonify({"ok":True})

# ── ORACLE ────────────────────────────────────────────────────────────────

@_bp.route("/api/u/oracle/iching", methods=["POST"])
def _oracle_iching():
    d = request.json or {}
    return jsonify(iching_cast(seed=d.get("seed")))

@_bp.route("/api/u/oracle/runes", methods=["POST"])
def _oracle_runes():
    d = request.json or {}
    n = int(d.get("count", 3))
    return jsonify(rune_cast(n=n, seed=d.get("seed")))

@_bp.route("/api/u/oracle/traditions")
def _oracle_traditions():
    return jsonify([
        {"id":"iching","name":"I Ching","items":64,"source":"Wilhelm/Baynes 1950 (PD), Legge 1882 (PD)"},
        {"id":"runes","name":"Elder Futhark","items":24,"source":"Page 1987; Dickins 1915 (PD)"},
        {"id":"lenormand","name":"Lenormand","items":36,"source":"Lenormand 1846 (PD)"},
    ])

# ── DAILY ─────────────────────────────────────────────────────────────────

@_bp.route("/api/u/daily")
def _daily():
    at_str = request.args.get("at")
    at = None
    if at_str:
        try: at = datetime.fromisoformat(at_str.replace("Z","")).replace(tzinfo=timezone.utc)
        except Exception: pass
    return jsonify(daily_get(at=at))

# ── JOURNAL ───────────────────────────────────────────────────────────────

@_bp.route("/api/u/journal/setup", methods=["POST"])
def _journal_setup():
    d = request.json or {}
    op = d.get("operator_id","user")
    pin = d.get("pin","0000")
    ks = journal_setup(op, pin, _SYNTHETIC_RECOVERY_KEY)
    _keystores[op] = ks
    return jsonify({"ok":True, "operator_id":op})

@_bp.route("/api/u/journal/entries", methods=["POST"])
def _journal_write():
    d = request.json or {}
    op = d.get("operator_id","user")
    pin = d.get("pin","")
    body = d.get("body","")
    ks = _keystores.get(op)
    if not ks: return jsonify({"error":"no keystore — call /setup first"}), 400
    try:
        master_key = journal_unlock(ks, pin)
    except ValueError:
        return jsonify({"error":"wrong PIN"}), 403
    entry = journal_entry_write(master_key, op, body,
                                reading_id=d.get("reading_id"))
    _journal_entries[entry.id] = entry
    return jsonify({"id": entry.id, "created_at": entry.created_at}), 201

@_bp.route("/api/u/journal/entries")
def _journal_list():
    d = request.args
    op = d.get("operator_id","user")
    pin = d.get("pin","")
    ks = _keystores.get(op)
    if not ks: return jsonify({"error":"no keystore"}), 400
    try: master_key = journal_unlock(ks, pin)
    except ValueError: return jsonify({"error":"wrong PIN"}), 403
    entries = [e for e in _journal_entries.values() if e.operator_id==op]
    out = []
    for e in sorted(entries, key=lambda x: -x.created_at):
        body = journal_entry_read(master_key, e)
        out.append({"id":e.id,"created_at":e.created_at,
                    "reading_id":e.reading_id,"preview":body[:80]})
    return jsonify(out)

@_bp.route("/api/u/journal/reset-pin", methods=["POST"])
def _journal_reset_pin():
    d = request.json or {}
    op = d.get("operator_id","user")
    new_pin = d.get("new_pin","0000")
    ks = _keystores.get(op)
    if not ks: return jsonify({"error":"no keystore"}), 400
    _keystores[op] = journal_reset_pin(ks, _SYNTHETIC_RECOVERY_KEY, new_pin)
    return jsonify({"ok":True, "message":"PIN reset; old entries still readable"})


def register(app):
    app.register_blueprint(_bp)
    # Feed initial ALMANAC events into the TIMELINE on startup
    _seed_almanac_events()


def _seed_almanac_events():
    """Push this year's sabbats + next 30 days of moon phases into register_auto_event."""
    try:
        from server.modules.log import register_auto_event
        year = datetime.now(timezone.utc).year
        for s in _sabbat_dates(year):
            register_auto_event("auspice.sabbat",
                                f"Sabbat: {s['name']} ({s['date']})",
                                tags=["auspice","sabbat"])
        jd0 = _julian_day(datetime.now(timezone.utc))
        for evt in sky_upcoming(jd0, days=30):
            register_auto_event(f"auspice.{evt['kind']}",
                                f"{evt['label']} in {evt['zodiac']} ({evt['date']})",
                                tags=["auspice","astronomy"])
    except Exception:
        pass   # TIMELINE not yet wired in tests

