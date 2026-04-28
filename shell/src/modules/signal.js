// SIGNAL module -- RTL-SDR, ADS-B, APRS, spectrum scanner.
//
// Sprint 14. Hotkey S from HOME. Sub-screens:
//   W -- WEATHER  sat passes + APT decode
//   A -- AIR      ADS-B track table
//   P -- APRS     packet feed
//   M -- MESH     LoRa mesh node list (delegates to comms store)
//   S -- SCAN     spectrum waterfall
//   B -- BANDS    band reference
//
// Amber sub-theme (.screen-signal): --accent #ffb347

import { el } from "../chrome/_dom.js";

const SUBS = { W:"weather", A:"air", P:"aprs", M:"mesh", S:"scan", B:"bands" };

const local = {
  sub: "weather",
  passes: null,
  aircraft: null,
  aprs: null,
  mesh: null,
  scanBand: "2m",
  scan: null,
  bands: null,
  decoding: false,
};

export function mountSignal(root, store, ctx) {
  const screen = el("div", "screen-signal signal");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    const labels = ["weather","air","aprs","mesh","scan","bands"];
    const keys   = "WAPMSB";
    tabs.replaceChildren(...labels.map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", keys[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    body.replaceChildren();
    switch (local.sub) {
      case "weather": paintWeather(body); break;
      case "air":     paintAir(body);     break;
      case "aprs":    paintAprs(body);    break;
      case "mesh":    paintMesh(body);    break;
      case "scan":    paintScan(body);    break;
      case "bands":   paintBands(body);   break;
    }
  }

  // ── WEATHER ──────────────────────────────────────────────────────────────
  function paintWeather(c) {
    const hdr = el("div", "sig-hdr");
    const title = el("div", "sig-title", "SATELLITE WEATHER");
    const refresh = el("button", "kb-btn", "R REFRESH");
    const decode  = el("button", "kb-btn sig-decode-btn", "D DECODE NEXT");
    hdr.append(title, refresh, decode);
    c.append(hdr);

    if (!local.passes) {
      const loading = el("div", "sig-empty", "Loading passes...");
      c.append(loading);
      fetch("/api/s/weather/passes?hours=24")
        .then(r => r.json())
        .then(d => { local.passes = d.passes; paint(); });
      return;
    }

    if (local.passes.length === 0) {
      c.append(el("div", "sig-empty", "No passes in next 24 hours."));
    } else {
      const grid = el("div", "sig-pass-grid");
      const hdrRow = el("div", "sig-pass-row sig-pass-hdr");
      hdrRow.append(
        el("span", "sig-col-sat",  "SAT"),
        el("span", "sig-col-freq", "FREQ MHz"),
        el("span", "sig-col-aos",  "AOS UTC"),
        el("span", "sig-col-los",  "LOS UTC"),
        el("span", "sig-col-el",   "EL"),
        el("span", "sig-col-dir",  "DIR"),
      );
      grid.append(hdrRow);
      for (const p of local.passes) {
        const row = el("div", "sig-pass-row");
        row.append(
          el("span", "sig-col-sat",  p.sat),
          el("span", "sig-col-freq sig-accent", p.freq_mhz.toFixed(3)),
          el("span", "sig-col-aos",  p.aos.slice(11,16)),
          el("span", "sig-col-los",  p.los.slice(11,16)),
          el("span", "sig-col-el",   p.max_el + "°"),
          el("span", "sig-col-dir",  p.direction),
        );
        grid.append(row);
      }
      c.append(grid);
    }

    const note = el("div", "sig-note",
      "Real passes: set OVERSEER_SIGNAL_SDR=rtlsdr");
    c.append(note);

    refresh.addEventListener("click", () => {
      local.passes = null; paint();
    });
    decode.addEventListener("click", () => {
      if (local.decoding) return;
      local.decoding = true;
      const next = local.passes && local.passes[0];
      const sat = next ? next.sat : "NOAA-19";
      fetch("/api/s/weather/decode", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({sat}),
      }).then(r => r.json()).then(d => {
        local.decoding = false;
        paint();
      }).catch(() => { local.decoding = false; });
    });
  }

  // ── AIR ──────────────────────────────────────────────────────────────────
  function paintAir(c) {
    const hdr = el("div", "sig-hdr");
    hdr.append(el("div", "sig-title", "ADS-B TRACKS"));
    const refresh = el("button", "kb-btn", "R REFRESH");
    hdr.append(refresh);
    c.append(hdr);

    if (!local.aircraft) {
      c.append(el("div", "sig-empty", "Loading..."));
      fetch("/api/s/air").then(r => r.json()).then(d => {
        local.aircraft = d.aircraft; paint();
      });
      return;
    }

    if (local.aircraft.length === 0) {
      c.append(el("div", "sig-empty", "No aircraft in range."));
    } else {
      const grid = el("div", "sig-air-grid");
      const hdrRow = el("div", "sig-air-row sig-air-hdr");
      hdrRow.append(
        el("span", "sig-ac-icao",    "ICAO"),
        el("span", "sig-ac-call",    "CALLSIGN"),
        el("span", "sig-ac-alt",     "ALT ft"),
        el("span", "sig-ac-spd",     "SPD kt"),
        el("span", "sig-ac-hdg",     "HDG"),
        el("span", "sig-ac-sq",      "SQ"),
      );
      grid.append(hdrRow);
      for (const a of local.aircraft) {
        const row = el("div", "sig-air-row" + (a.squawk === "7700" ? " sig-emerg" : ""));
        row.append(
          el("span", "sig-ac-icao sig-mono", a.icao),
          el("span", "sig-ac-call sig-accent", a.callsign),
          el("span", "sig-ac-alt  sig-mono", a.alt_ft.toLocaleString()),
          el("span", "sig-ac-spd  sig-mono", String(a.speed_kt)),
          el("span", "sig-ac-hdg  sig-mono", String(a.heading).padStart(3,"0")),
          el("span", "sig-ac-sq   sig-mono", a.squawk),
        );
        grid.append(row);
      }
      c.append(grid);
    }

    refresh.addEventListener("click", () => { local.aircraft = null; paint(); });
  }

  // ── APRS ─────────────────────────────────────────────────────────────────
  function paintAprs(c) {
    const hdr = el("div", "sig-hdr");
    hdr.append(el("div", "sig-title", "APRS FEED"));
    const refresh = el("button", "kb-btn", "R REFRESH");
    hdr.append(refresh);
    c.append(hdr);

    if (!local.aprs) {
      c.append(el("div", "sig-empty", "Loading..."));
      fetch("/api/s/aprs").then(r => r.json()).then(d => {
        local.aprs = d.packets; paint();
      });
      return;
    }

    if (local.aprs.length === 0) {
      c.append(el("div", "sig-empty", "No APRS packets."));
    } else {
      for (const p of local.aprs) {
        const row = el("div", "sig-aprs-row");
        const age = Math.round((Date.now()/1000 - p.at));
        row.append(
          el("span", "sig-aprs-call sig-accent", p.callsign),
          el("span", "sig-aprs-sym sig-mono", "[" + p.symbol + "]"),
          el("span", "sig-aprs-comment sig-dim", p.comment),
          el("span", "sig-aprs-age sig-dim", age + "s ago"),
        );
        c.append(row);
      }
    }

    const note = el("div", "sig-note", "Real packets: OVERSEER_SIGNAL_APRS=direwolf");
    c.append(note);
    refresh.addEventListener("click", () => { local.aprs = null; paint(); });
  }

  // ── MESH ─────────────────────────────────────────────────────────────────
  function paintMesh(c) {
    const hdr = el("div", "sig-hdr");
    hdr.append(el("div", "sig-title", "MESH NODES"));
    const refresh = el("button", "kb-btn", "R REFRESH");
    hdr.append(refresh);
    c.append(hdr);

    if (!local.mesh) {
      c.append(el("div", "sig-empty", "Loading..."));
      fetch("/api/s/mesh").then(r => r.json()).then(d => {
        local.mesh = d.nodes; paint();
      });
      return;
    }

    if (local.mesh.length === 0) {
      c.append(el("div", "sig-empty", "No mesh nodes seen. Check LoRa hardware."));
    } else {
      for (const n of local.mesh) {
        const row = el("div", "sig-mesh-row");
        row.append(
          el("span", "sig-mesh-id sig-accent sig-mono", n.id || n.node_id || "?"),
          el("span", "sig-mesh-name", n.short_name || n.name || ""),
          el("span", "sig-mesh-snr sig-dim", n.snr != null ? "SNR " + n.snr + " dB" : ""),
        );
        c.append(row);
      }
    }

    refresh.addEventListener("click", () => { local.mesh = null; paint(); });
  }

  // ── SCAN ─────────────────────────────────────────────────────────────────
  function paintScan(c) {
    const hdr = el("div", "sig-hdr");
    hdr.append(el("div", "sig-title", "SPECTRUM SCAN"));

    const bands = ["2m","70cm","HF","VHF","UHF"];
    const sel = el("select", "sig-band-sel");
    for (const b of bands) {
      const opt = el("option", "", b);
      opt.value = b;
      if (b === local.scanBand) opt.selected = true;
      sel.append(opt);
    }
    const go = el("button", "kb-btn", "S SCAN");
    hdr.append(sel, go);
    c.append(hdr);

    if (!local.scan) {
      c.append(el("div", "sig-empty", "Press S to scan."));
    } else {
      const s = local.scan;
      const info = el("div", "sig-scan-info");
      info.append(
        el("span", "sig-scan-band sig-accent", s.band),
        el("span", "sig-dim", " " + s.freq_lo + "–" + s.freq_hi + " " + s.unit),
      );
      c.append(info);

      // ASCII waterfall bar chart
      const chart = el("pre", "sig-scan-chart");
      const min_dbm = -120, max_dbm = -50;
      const width = 48;
      let lines = "";
      for (let i = 0; i < s.buckets.length; i += 4) {
        const avg = (s.buckets[i] + (s.buckets[i+1]||s.buckets[i]) +
                     (s.buckets[i+2]||s.buckets[i]) + (s.buckets[i+3]||s.buckets[i])) / 4;
        const pct = Math.max(0, Math.min(1, (avg - min_dbm) / (max_dbm - min_dbm)));
        const filled = Math.round(pct * width);
        const bar = "█".repeat(filled) + "░".repeat(width - filled);
        const freq = (s.freq_lo + (i / s.buckets.length) * (s.freq_hi - s.freq_lo)).toFixed(2);
        lines += freq.padStart(7) + " |" + bar + "| " + avg.toFixed(0) + " dBm\n";
      }
      chart.textContent = lines;
      c.append(chart);
    }

    go.addEventListener("click", () => {
      local.scanBand = sel.value;
      local.scan = null;
      c.append(el("div", "sig-empty", "Scanning..."));
      fetch("/api/s/scan?band=" + encodeURIComponent(local.scanBand))
        .then(r => r.json())
        .then(d => { local.scan = d; paint(); });
    });
  }

  // ── BANDS ─────────────────────────────────────────────────────────────────
  function paintBands(c) {
    c.append(el("div", "sig-title", "BAND REFERENCE"));

    if (!local.bands) {
      fetch("/api/s/bands").then(r => r.json()).then(d => {
        local.bands = d.bands; paint();
      });
      return;
    }

    const grid = el("div", "sig-band-grid");
    const hdrRow = el("div", "sig-band-row sig-band-hdr");
    hdrRow.append(
      el("span", "sig-b-name", "BAND"),
      el("span", "sig-b-lo",   "LOW MHz"),
      el("span", "sig-b-hi",   "HIGH MHz"),
    );
    grid.append(hdrRow);
    for (const b of local.bands) {
      const row = el("div", "sig-band-row");
      row.append(
        el("span", "sig-b-name sig-accent", b.band),
        el("span", "sig-b-lo  sig-mono", b.freq_lo.toFixed(1)),
        el("span", "sig-b-hi  sig-mono", b.freq_hi.toFixed(1)),
      );
      grid.append(row);
    }
    c.append(grid);
  }

  // ── keyboard ──────────────────────────────────────────────────────────────
  function onKey(e) {
    const k = e.key.toUpperCase();
    if (SUBS[k]) { local.sub = SUBS[k]; paint(); return; }
  }

  screen.setAttribute("tabindex", "0");
  screen.addEventListener("keydown", onKey);
  screen.focus();
  paint();

  return () => screen.removeEventListener("keydown", onKey);
}
