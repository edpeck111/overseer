// AUSPICE module — astronomy, divination, encrypted journal.
//
// Sprint 12+13. Hotkey U from HOME. Sub-screens:
//   S — SKY       current sky positions + moon phase
//   C — CHART     natal chart builder
//   T — TAROT     card readings (RWS deck)
//   O — ORACLE    I Ching / runes / traditions
//   D — DAILY     daily divination snapshot
//   J — JOURNAL   AES-256-GCM encrypted personal journal
//   A — ALMANAC   year wheel — sabbats + lunar calendar
//
// Purple sub-theme (.screen-auspice): --accent #b88cff

import { el } from "../chrome/_dom.js";

const SUBS = { S:"sky", C:"chart", T:"tarot", O:"oracle", D:"daily", J:"journal", A:"almanac" };

const local = {
  sub: "sky",
  // sky
  sky: null,
  upcoming: null,
  // chart
  chartLat: "", chartLon: "", chartDt: "",
  chartResult: null,
  // tarot
  spreads: null, decks: null,
  tarotSpread: null, tarotQuery: "",
  tarotResult: null,
  // oracle
  oracleSub: "iching",   // iching | runes | traditions
  ichingQ: "", ichingResult: null,
  runeCount: 3, runeResult: null,
  traditions: null,
  // daily
  daily: null,
  // journal
  journalUnlocked: false,
  journalPin: "", journalPinError: "",
  journalEntries: null,
  journalBody: "", journalMood: "",
  journalDetail: null,
  // almanac
  almanacYear: new Date().getFullYear(),
  almanac: null,
};

export function mountAuspice(root, store, ctx) {
  const screen = el("div", "screen-auspice auspice");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    const labels = ["sky","chart","tarot","oracle","daily","journal","almanac"];
    const keys   = "SCTODJA";
    tabs.replaceChildren(...labels.map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", keys[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    if (local.sub === "sky")     paintSky(body);
    if (local.sub === "chart")   paintChart(body);
    if (local.sub === "tarot")   paintTarot(body);
    if (local.sub === "oracle")  paintOracle(body);
    if (local.sub === "daily")   paintDaily(body);
    if (local.sub === "journal") paintJournal(body);
    if (local.sub === "almanac") paintAlmanac(body);
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
    if (SUBS[e.key]) { local.sub = SUBS[e.key]; e.preventDefault(); paint(); }
  }
  document.addEventListener("keydown", onKey, true);

  loadSky().then(paint);

  return function unmount() {
    document.removeEventListener("keydown", onKey, true);
  };

  // ── SKY ────────────────────────────────────────────────────────────
  async function loadSky() {
    const [a, b] = await Promise.all([
      fetch("/api/u/sky").then(r => r.json()),
      fetch("/api/u/sky/upcoming?days=30").then(r => r.json()),
    ]);
    local.sky = a; local.upcoming = b;
  }

  function paintSky(c) {
    c.replaceChildren();
    if (!local.sky) { c.append(el("div","au-loading","loading sky…")); return; }
    const d = local.sky;

    // Moon phase header
    const hdr = el("div","au-sky-hdr");
    const ph  = el("div","au-moon-phase");
    ph.append(el("span","au-moon-glyph", d.moon?.glyph || "🌑"),
              el("span","au-moon-name",  d.moon?.phase_name || "—"),
              el("span","au-moon-illum", d.moon?.illumination != null
                ? Math.round(d.moon.illumination*100)+"%"
                : ""));
    const sr = el("div","au-sun-times");
    if (d.sun) {
      sr.append(
        el("span","au-st-label","rise "),
        el("span","au-st-val", d.sun.rise || "—"),
        el("span","au-st-label"," transit "),
        el("span","au-st-val", d.sun.transit || "—"),
        el("span","au-st-label"," set "),
        el("span","au-st-val", d.sun.set || "—"),
      );
    }
    hdr.append(ph, sr);
    c.append(hdr);

    // Planet grid
    const grid = el("div","au-sky-grid");
    const planets = d.planets || [];
    planets.forEach(p => {
      const row = el("div","au-sky-row");
      row.append(
        el("span","au-sky-body", p.name),
        el("span","au-sky-lon",  p.lon != null ? p.lon.toFixed(1)+"°" : "—"),
        el("span","au-sky-sign", p.zodiac || "—"),
        el("span","au-sky-sym",  p.zodiac_sym || ""),
      );
      grid.append(row);
    });
    c.append(grid);

    // Upcoming events
    if (local.upcoming?.events?.length) {
      c.append(el("div","au-section-hdr","upcoming"));
      const ul = el("div","au-upcoming-list");
      local.upcoming.events.slice(0,8).forEach(ev => {
        const row = el("div","au-upcoming-row");
        row.append(
          el("span","au-up-date", ev.date),
          el("span","au-up-label", ev.label),
          el("span","au-up-sign",  ev.zodiac || ""),
        );
        ul.append(row);
      });
      c.append(ul);
    }
  }

  // ── CHART ──────────────────────────────────────────────────────────
  function paintChart(c) {
    c.replaceChildren();
    c.append(el("div","au-section-hdr","natal chart"));

    const form = el("div","au-chart-form");
    const latIn = el("input"); latIn.className = "au-chart-lat"; latIn.placeholder = "lat (e.g. 51.5)"; latIn.value = local.chartLat;
    const lonIn = el("input"); lonIn.className = "au-chart-lon"; lonIn.placeholder = "lon (e.g. -0.1)"; lonIn.value = local.chartLon;
    const dtIn  = el("input"); dtIn.className  = "au-chart-dt";  dtIn.placeholder  = "birth UTC (YYYY-MM-DDTHH:MM)"; dtIn.value = local.chartDt;
    const btn   = el("button","au-chart-btn","CAST");
    btn.addEventListener("click", async () => {
      local.chartLat = latIn.value; local.chartLon = lonIn.value; local.chartDt = dtIn.value;
      const url = `/api/u/chart?lat=${encodeURIComponent(local.chartLat)}&lon=${encodeURIComponent(local.chartLon)}&dt_birth=${encodeURIComponent(local.chartDt)}`;
      local.chartResult = await fetch(url).then(r => r.json());
      paintChart(c);
    });
    form.append(latIn, lonIn, dtIn, btn);
    c.append(form);

    if (local.chartResult) {
      const res = local.chartResult;
      const grid = el("div","au-sky-grid");
      (res.planets || []).forEach(p => {
        const row = el("div","au-sky-row");
        row.append(
          el("span","au-sky-body", p.name),
          el("span","au-sky-lon",  p.lon != null ? p.lon.toFixed(1)+"°" : "—"),
          el("span","au-sky-sign", p.zodiac || "—"),
        );
        grid.append(row);
      });
      if (res.asc) {
        const a = el("div","au-chart-asc");
        a.append(el("span","au-st-label","ASC "), el("span","au-sky-sign", res.asc));
        c.append(a);
      }
      c.append(grid);
    }
  }

  // ── TAROT ──────────────────────────────────────────────────────────
  async function loadTarot() {
    if (!local.spreads) local.spreads = await fetch("/api/u/spreads").then(r => r.json());
    if (!local.decks)   local.decks   = await fetch("/api/u/decks").then(r => r.json());
    if (!local.tarotSpread && local.spreads?.spreads?.length) local.tarotSpread = local.spreads.spreads[0].id;
  }

  function paintTarot(c) {
    c.replaceChildren();
    c.append(el("div","au-section-hdr","tarot reading"));

    if (!local.spreads) { loadTarot().then(() => paintTarot(c)); c.append(el("div","au-loading","loading…")); return; }

    const form = el("div","au-tarot-form");
    const sel  = el("select"); sel.className = "au-tarot-spread";
    (local.spreads?.spreads || []).forEach(s => {
      const o = el("option"); o.value = s.id; o.textContent = s.name;
      if (s.id === local.tarotSpread) o.selected = true;
      sel.append(o);
    });
    sel.addEventListener("change", () => { local.tarotSpread = sel.value; });

    const qIn = el("input"); qIn.className = "au-tarot-query"; qIn.placeholder = "question (optional)"; qIn.value = local.tarotQuery;
    const btn = el("button","au-tarot-btn","DRAW");
    btn.addEventListener("click", async () => {
      local.tarotQuery = qIn.value;
      local.tarotResult = await fetch("/api/u/readings", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ deck: "rws", spread: local.tarotSpread, query: local.tarotQuery }),
      }).then(r => r.json());
      paintTarot(c);
    });
    form.append(sel, qIn, btn);
    c.append(form);

    if (local.tarotResult) {
      const res = local.tarotResult;
      if (res.query) c.append(el("div","au-tarot-question", "✦ " + res.query));
      const cards = el("div","au-tarot-cards");
      (res.cards || []).forEach(card => {
        const row = el("div","au-tarot-card");
        const rev = card.reversed ? " (rev)" : "";
        row.append(
          el("span","au-card-pos",  card.position || ""),
          el("span","au-card-name", card.name + rev),
          el("span","au-card-kw",   (card.keywords || []).slice(0,3).join(" · ")),
        );
        cards.append(row);
      });
      c.append(cards);
    }
  }

  // ── ORACLE ─────────────────────────────────────────────────────────
  const ORACLE_SUBS = { I:"iching", R:"runes", T:"traditions" };

  function paintOracle(c) {
    c.replaceChildren();
    const subTabs = el("div","au-oracle-tabs");
    [["I","iching"],["R","runes"],["T","traditions"]].forEach(([k,s]) => {
      const t = el("span","au-oracle-tab" + (local.oracleSub === s ? " active" : ""));
      t.append(el("span","k",k), el("span","l"," "+s));
      t.addEventListener("click", () => { local.oracleSub = s; paintOracle(c); });
      subTabs.append(t);
    });
    c.append(subTabs);

    if (local.oracleSub === "iching")  paintIching(c);
    if (local.oracleSub === "runes")   paintRunes(c);
    if (local.oracleSub === "traditions") paintTraditions(c);
  }

  function paintIching(c) {
    const form = el("div","au-oracle-form");
    const qIn  = el("input"); qIn.className = "au-iching-q"; qIn.placeholder = "question"; qIn.value = local.ichingQ;
    const btn  = el("button","au-oracle-btn","CAST");
    btn.addEventListener("click", async () => {
      local.ichingQ = qIn.value;
      local.ichingResult = await fetch(`/api/u/oracle/iching?q=${encodeURIComponent(local.ichingQ)}`).then(r => r.json());
      paint();
    });
    form.append(qIn, btn); c.append(form);

    if (local.ichingResult) {
      const res = local.ichingResult;
      const card = el("div","au-iching-card");
      card.append(
        el("div","au-iching-hex",   res.hexagram?.symbol || ""),
        el("div","au-iching-num",   "Hexagram " + (res.hexagram?.number || "")),
        el("div","au-iching-name",  res.hexagram?.name || ""),
        el("div","au-iching-judge", res.hexagram?.judgment || ""),
      );
      if (res.changing_lines?.length) {
        card.append(el("div","au-iching-changing", "Changing lines: " + res.changing_lines.join(", ")));
      }
      c.append(card);
    }
  }

  function paintRunes(c) {
    const form = el("div","au-oracle-form");
    const countSel = el("select"); countSel.className = "au-rune-count";
    [1,3,9].forEach(n => {
      const o = el("option"); o.value = n; o.textContent = n + " rune" + (n>1?"s":"");
      if (n === local.runeCount) o.selected = true;
      countSel.append(o);
    });
    countSel.addEventListener("change", () => { local.runeCount = +countSel.value; });
    const btn = el("button","au-oracle-btn","DRAW");
    btn.addEventListener("click", async () => {
      local.runeResult = await fetch(`/api/u/oracle/runes?count=${local.runeCount}`).then(r => r.json());
      paint();
    });
    form.append(countSel, btn); c.append(form);

    if (local.runeResult) {
      const runes = el("div","au-rune-row");
      (local.runeResult.runes || []).forEach(r => {
        const rw = el("div","au-rune-card");
        rw.append(
          el("div","au-rune-glyph", r.glyph || ""),
          el("div","au-rune-name",  r.name),
          el("div","au-rune-kw",    (r.keywords||[]).slice(0,2).join(" · ")),
        );
        runes.append(rw);
      });
      c.append(runes);
    }
  }

  function paintTraditions(c) {
    if (!local.traditions) {
      fetch("/api/u/oracle/traditions").then(r => r.json()).then(d => {
        local.traditions = d;
        paint();
      });
      c.append(el("div","au-loading","loading…")); return;
    }
    const list = el("div","au-trad-list");
    (local.traditions.traditions || []).forEach(t => {
      const row = el("div","au-trad-row");
      row.append(el("span","au-trad-name", t.name), el("span","au-trad-count", t.card_count+" cards"));
      list.append(row);
    });
    c.append(list);
  }

  // ── DAILY ──────────────────────────────────────────────────────────
  function paintDaily(c) {
    c.replaceChildren();
    c.append(el("div","au-section-hdr","daily reading"));
    if (!local.daily) {
      fetch("/api/u/daily").then(r => r.json()).then(d => { local.daily = d; paintDaily(c); });
      c.append(el("div","au-loading","loading…")); return;
    }
    const d = local.daily;
    const card = el("div","au-daily-card");
    card.append(el("div","au-daily-date", d.date || ""));
    if (d.moon) {
      const m = el("div","au-daily-moon");
      m.append(el("span","au-moon-glyph", d.moon.glyph || ""), el("span","", " "+d.moon.phase_name));
      card.append(m);
    }
    if (d.tarot) {
      const t = el("div","au-daily-tarot");
      t.append(el("span","au-card-name", d.tarot.name), el("span","au-card-kw", (d.tarot.keywords||[]).slice(0,3).join(" · ")));
      card.append(el("div","au-daily-lbl","card of the day"), t);
    }
    if (d.rune) {
      const r = el("div","au-daily-rune");
      r.append(el("span","au-rune-glyph", d.rune.glyph||""), el("span","", " "+d.rune.name));
      card.append(el("div","au-daily-lbl","rune of the day"), r);
    }
    if (d.planet_in_sign) card.append(el("div","au-daily-planet", d.planet_in_sign));
    c.append(card);
  }

  // ── JOURNAL ────────────────────────────────────────────────────────
  function paintJournal(c) {
    c.replaceChildren();
    c.append(el("div","au-section-hdr","encrypted journal"));

    if (!local.journalUnlocked) {
      const pinForm = el("div","au-pin-form");
      const pinIn   = el("input"); pinIn.className = "au-pin-input"; pinIn.type = "password"; pinIn.placeholder = "PIN";
      const unlockBtn = el("button","au-pin-btn","UNLOCK");
      unlockBtn.addEventListener("click", async () => {
        const res = await fetch("/api/u/journal/unlock", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ pin: pinIn.value }),
        }).then(r => r.json());
        if (res.ok) {
          local.journalUnlocked = true; local.journalPinError = "";
          local.journalEntries = null; paintJournal(c);
        } else {
          local.journalPinError = res.error || "wrong PIN";
          paintJournal(c);
        }
      });
      pinForm.append(pinIn, unlockBtn);
      if (local.journalPinError) pinForm.append(el("div","au-pin-error", local.journalPinError));
      c.append(pinForm);
      return;
    }

    // Compose form
    const compose = el("div","au-journal-compose");
    const bodyIn  = el("textarea"); bodyIn.className = "au-journal-body"; bodyIn.placeholder = "entry…"; bodyIn.value = local.journalBody;
    bodyIn.addEventListener("input", () => { local.journalBody = bodyIn.value; });
    const moodIn  = el("input"); moodIn.className = "au-journal-mood"; moodIn.placeholder = "mood 1–5"; moodIn.value = local.journalMood;
    const saveBtn = el("button","au-journal-save","SAVE");
    saveBtn.addEventListener("click", async () => {
      local.journalMood = moodIn.value;
      await fetch("/api/u/journal/entries", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ body: local.journalBody, mood: local.journalMood ? +local.journalMood : null }),
      });
      local.journalBody = ""; local.journalMood = ""; local.journalEntries = null;
      paintJournal(c);
    });
    compose.append(bodyIn, moodIn, saveBtn);
    c.append(compose);

    // Entry list
    if (!local.journalEntries) {
      fetch("/api/u/journal/entries").then(r => r.json()).then(d => {
        local.journalEntries = d.entries || [];
        paintJournal(c);
      });
      return;
    }
    const entries = el("div","au-journal-entries");
    local.journalEntries.slice(0,20).forEach(e => {
      const row = el("div","au-journal-row");
      row.append(
        el("span","au-journal-date", e.date || ""),
        el("span","au-journal-preview", (e.preview || "").substring(0,60)),
      );
      if (e.mood) row.append(el("span","au-journal-mood-badge","♥".repeat(e.mood)));
      row.addEventListener("click", async () => {
        local.journalDetail = await fetch(`/api/u/journal/entries/${e.id}`).then(r => r.json());
        paintJournalDetail(c, local.journalDetail);
      });
      entries.append(row);
    });
    c.append(entries);
  }

  function paintJournalDetail(c, entry) {
    c.replaceChildren();
    const back = el("button","au-back-btn","← back");
    back.addEventListener("click", () => paintJournal(c));
    c.append(back);
    const card = el("div","au-journal-detail");
    card.append(
      el("div","au-journal-date", entry.date || ""),
      el("div","au-journal-full", entry.body || ""),
    );
    if (entry.mood) card.append(el("div","au-journal-mood-badge", "mood: " + entry.mood));
    c.append(card);
  }

  // ── ALMANAC ────────────────────────────────────────────────────────
  function paintAlmanac(c) {
    c.replaceChildren();

    const controls = el("div","au-almanac-controls");
    const prevBtn = el("button","au-almanac-nav","◀");
    const nextBtn = el("button","au-almanac-nav","▶");
    const yearLbl = el("span","au-almanac-year", String(local.almanacYear));
    prevBtn.addEventListener("click", () => { local.almanacYear--; local.almanac = null; paintAlmanac(c); loadAlmanac().then(() => paintAlmanac(c)); });
    nextBtn.addEventListener("click", () => { local.almanacYear++; local.almanac = null; paintAlmanac(c); loadAlmanac().then(() => paintAlmanac(c)); });
    controls.append(prevBtn, yearLbl, nextBtn);
    c.append(controls);

    if (!local.almanac) {
      loadAlmanac().then(() => paintAlmanac(c));
      c.append(el("div","au-loading","loading almanac…")); return;
    }

    // Sabbats
    c.append(el("div","au-section-hdr","wheel of the year — sabbats"));
    const sabbats = el("div","au-sabbat-list");
    (local.almanac.sabbats || []).forEach(s => {
      const row = el("div","au-sabbat-row");
      row.append(
        el("span","au-sabbat-date", s.date),
        el("span","au-sabbat-name", s.name),
        el("span","au-sabbat-lon",  s.solar_lon != null ? s.solar_lon+"°" : ""),
      );
      sabbats.append(row);
    });
    c.append(sabbats);

    // Lunar calendar
    c.append(el("div","au-section-hdr","lunar calendar"));
    const lunar = el("div","au-lunar-grid");
    (local.almanac.lunar_calendar || []).slice(0,4).forEach(mo => {
      const col = el("div","au-lunar-month");
      col.append(el("div","au-lunar-month-name", mo.month_name));
      (mo.phases || []).forEach(ph => {
        const row = el("div","au-lunar-phase-row");
        row.append(
          el("span","au-moon-glyph",  ph.glyph || ""),
          el("span","au-lunar-phase", ph.phase),
          el("span","au-lunar-date",  ph.date),
        );
        col.append(row);
      });
      lunar.append(col);
    });
    c.append(lunar);
  }

  async function loadAlmanac() {
    local.almanac = await fetch(`/api/u/almanac?year=${local.almanacYear}`).then(r => r.json());
  }
}
