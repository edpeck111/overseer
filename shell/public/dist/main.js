(() => {
  // src/state/store.js
  function createStore(initial) {
    let state = freeze({ ...initial });
    const globalSubs = /* @__PURE__ */ new Set();
    const topicSubs = /* @__PURE__ */ new Map();
    function get(key) {
      return key === void 0 ? state : state[key];
    }
    function set(patch) {
      const changed = [];
      const next = { ...state };
      for (const k of Object.keys(patch)) {
        if (!shallowEqual(state[k], patch[k])) {
          next[k] = patch[k];
          changed.push(k);
        }
      }
      if (changed.length === 0) return;
      state = freeze(next);
      for (const fn of globalSubs) safe(() => fn(state, changed));
      for (const k of changed) {
        const subs = topicSubs.get(k);
        if (subs) for (const fn of subs) safe(() => fn(state[k], k));
      }
    }
    function subscribe(a, b) {
      if (typeof a === "function") {
        globalSubs.add(a);
        return () => globalSubs.delete(a);
      }
      let subs = topicSubs.get(a);
      if (!subs) topicSubs.set(a, subs = /* @__PURE__ */ new Set());
      subs.add(b);
      return () => subs.delete(b);
    }
    function dispatch2(action, net) {
      if (action.optimistic) set(action.optimistic);
      if (!net) return Promise.resolve();
      return net.then(
        (result) => {
          if (action.reconcile) set(action.reconcile(result));
        },
        (err) => {
          if (action.rollback) set(action.rollback);
          throw err;
        }
      );
    }
    return { get, set, subscribe, dispatch: dispatch2 };
  }
  function freeze(o) {
    return Object.freeze(o);
  }
  function shallowEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (a[k] !== b[k]) return false;
    return true;
  }
  function safe(fn) {
    try {
      fn();
    } catch (e) {
      if (typeof console !== "undefined") console.error("[store] subscriber threw", e);
    }
  }

  // src/state/initial.js
  function initialState() {
    return {
      version: "3.0.1",
      operator: "ALPHA-1",
      system: "OK",
      ai: "QWEN-7B",
      kb: { mounted: 12, total: 12 },
      power: { pct: 82, runtime: "14d 02h" },
      mesh: { reachable: 2, known: 3 },
      clock: { day: 417, hhmm: "23:47" },
      unread: 3,
      alerts: 2,
      crumbs: ["HOME"],
      pill: "3 UNREAD \xB7 2 ALERTS",
      module: "HOME",
      hotkeys: defaultHotkeyBar()
    };
  }
  function defaultHotkeyBar() {
    return [
      { k: "K", l: "knowledge" },
      { k: "C", l: "comms" },
      { k: "M", l: "medical" },
      { k: "N", l: "nav" },
      { k: "P", l: "power" },
      { k: "L", l: "log" },
      { k: ":", l: "palette", variant: "special" },
      { k: "/", l: "search", variant: "special" },
      { k: "?", l: "help" },
      { k: "Q", l: "back", variant: "danger" }
    ];
  }

  // src/chrome/_dom.js
  function el(tag, cls, ...kids) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const k of kids) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    return n;
  }
  function txt(s) {
    return document.createTextNode(String(s ?? ""));
  }

  // src/chrome/statusbar.js
  function mountStatusBar(root, store2) {
    const render = () => {
      const s = store2.get();
      root.replaceChildren(
        seg("brand", ["v", `OVERSEER`, "k", `v${s.version}`]),
        seg("", ["k", "OP", "v", s.operator]),
        seg("hide-sm" + sysCls(s.system), ["k", "SYS", "v", s.system]),
        seg("hide-sm", ["k", "AI", "v", s.ai]),
        seg("hide-sm", ["k", "KB", "v", `${s.kb.mounted}/${s.kb.total}`]),
        seg("hide-sm", ["k", "MESH", "v", meshDots(s.mesh)]),
        seg(pwrCls(s.power.pct), ["k", "PWR", "v", `${s.power.pct}%`]),
        seg("flex", ["clock", `D+${s.clock.day} \xB7 ${s.clock.hhmm}`])
      );
    };
    for (const k of ["version", "operator", "system", "ai", "kb", "power", "mesh", "clock"]) {
      store2.subscribe(k, render);
    }
    render();
  }
  function seg(cls, parts) {
    const node = el("div", `seg ${cls}`);
    for (let i = 0; i < parts.length; i += 2) {
      node.appendChild(el("span", parts[i], txt(parts[i + 1])));
    }
    return node;
  }
  function pwrCls(pct) {
    return pct < 15 ? "alert" : pct < 30 ? "warn" : "";
  }
  function sysCls(sys) {
    return sys === "FAULT" ? " alert" : sys === "DEGRADED" ? " warn" : "";
  }
  function meshDots(m) {
    const filled = "\u25CF".repeat(Math.max(0, m.reachable));
    const hollow = "\u25CB".repeat(Math.max(0, m.known - m.reachable));
    return filled + hollow || "\u2014";
  }

  // src/chrome/breadcrumb.js
  function mountBreadcrumb(root, store2) {
    const render = () => {
      const crumbs = store2.get("crumbs") || ["HOME"];
      const pill = store2.get("pill");
      const parts = [];
      crumbs.forEach((label, i) => {
        if (i > 0) parts.push(el("span", "arrow", txt("\u203A")));
        parts.push(el("span", "crumb" + (i === crumbs.length - 1 ? " active" : ""), txt(label)));
      });
      if (pill) parts.push(el("span", "pill", txt(pill)));
      root.replaceChildren(...parts);
    };
    store2.subscribe("crumbs", render);
    store2.subscribe("pill", render);
    render();
  }

  // src/chrome/hotkey_bar.js
  function mountHotkeyBar(root, store2) {
    const render = () => {
      const items = store2.get("hotkeys") || [];
      root.replaceChildren(...items.map(({ k, l, variant }) => {
        const wrap = el("span", "key" + (variant ? " " + variant : ""));
        wrap.appendChild(el("span", "k", txt(k)));
        wrap.appendChild(el("span", "l", txt(l)));
        return wrap;
      }));
    };
    store2.subscribe("hotkeys", render);
    render();
  }

  // src/chrome/mode.js
  var PHONE = 720;
  var TABLET = 1100;
  function observeMode(term) {
    const apply = () => {
      const w = term.getBoundingClientRect().width || window.innerWidth;
      const mode = w < PHONE ? "phone" : w < TABLET ? "tablet" : "desktop";
      if (term.getAttribute("data-mode") !== mode) {
        term.setAttribute("data-mode", mode);
      }
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(apply);
      ro.observe(term);
    } else {
      window.addEventListener("resize", apply, { passive: true });
    }
    apply();
  }

  // src/palette/registry.js
  var registry = [];
  function register(cmd) {
    const existing = registry.findIndex((c) => c.id === cmd.id);
    if (existing >= 0) registry[existing] = cmd;
    else registry.push(cmd);
  }
  function getCommands() {
    return registry.slice();
  }
  function registerDefaults() {
    if (registry.length > 0) return;
    const modules = [
      ["home", "go to HOME"],
      ["knowledge", "K \xB7 chat \xB7 library"],
      ["comms", "C \xB7 mail \xB7 boards \xB7 mesh"],
      ["medical", "M \xB7 triage \xB7 ref \xB7 dose"],
      ["navigation", "N \xB7 map \xB7 waypoints \xB7 route"],
      ["power", "P \xB7 battery \xB7 load \xB7 radio"],
      ["log", "L \xB7 daily journal"],
      ["inventory", "I \xB7 kit \xB7 food \xB7 ammo \xB7 meds"],
      ["recreation", "R \xB7 games \xB7 books \xB7 fortune"],
      ["signal", "S \xB7 sdr \xB7 weather \xB7 scan"],
      ["timeline", "T \xB7 unified events"],
      ["system", "X \xB7 admin \xB7 users \xB7 settings"],
      ["help", "? \xB7 topics \xB7 plugins \xB7 lore"]
    ];
    for (const [id, label] of modules) {
      register({
        id: `goto.${id}`,
        label,
        run: ({ store: store2 }) => store2.set({ module: id.toUpperCase(), crumbs: [id.toUpperCase()] })
      });
    }
    register({
      id: "crt.toggle",
      label: "toggle CRT scanlines / vignette",
      run: () => {
        const root = document.documentElement;
        root.dataset.crt = root.dataset.crt === "off" ? "on" : "off";
      }
    });
  }

  // src/palette/palette.js
  function mountPalette(root, store2) {
    registerDefaults();
    let open = false;
    let query = "";
    let selected = 0;
    let results = [];
    const wrap = el("div", "palette");
    const head = el("div", "palette-input");
    const sigil = el("span", "sigil", txt(":"));
    const field = el("span", "field");
    const queryNode = txt("");
    field.appendChild(queryNode);
    field.appendChild(el("span", "cursor"));
    const hint = el("span", "palette-hint", txt("[ESC to close \xB7 \u2191\u2193 to nav \xB7 \u21B5 run]"));
    head.append(sigil, field, hint);
    const list = el("div", "palette-list");
    wrap.append(head, list);
    root.appendChild(wrap);
    root.addEventListener("click", (e) => {
      if (e.target === root) close();
    });
    wrap.addEventListener("click", (e) => e.stopPropagation());
    function render() {
      queryNode.nodeValue = query;
      list.replaceChildren(...results.map((cmd, i) => {
        const row = el("div", "palette-row" + (i === selected ? " sel" : ""));
        row.append(
          el("span", "name", highlight(cmd.id, query)),
          el("span", "hint", txt(cmd.label || ""))
        );
        row.addEventListener("click", () => run(cmd));
        return row;
      }));
    }
    function recompute() {
      results = filter(getCommands(), query);
      selected = Math.min(selected, Math.max(0, results.length - 1));
      render();
    }
    function show() {
      if (open) return;
      open = true;
      query = "";
      selected = 0;
      recompute();
      root.classList.add("show");
    }
    function close() {
      if (!open) return;
      open = false;
      root.classList.remove("show");
    }
    function run(cmd) {
      close();
      try {
        cmd.run({ store: store2 });
      } catch (e) {
        console.error("[palette] command threw", e);
      }
    }
    document.addEventListener("keydown", (e) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selected = Math.min(selected + 1, results.length - 1);
        render();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selected = Math.max(selected - 1, 0);
        render();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (results[selected]) run(results[selected]);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        query = query.slice(0, -1);
        recompute();
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        query += e.key.toLowerCase();
        recompute();
      }
    }, { capture: true });
    return { show, close, isOpen: () => open };
  }
  function filter(commands, q) {
    if (!q) return commands.slice(0, 50);
    const ql = q.toLowerCase();
    const scored = [];
    for (const c of commands) {
      const id = c.id.toLowerCase();
      let score = scoreOrdered(id, ql);
      if (score >= 0) scored.push([score, id.length, c]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    return scored.map((row) => row[2]).slice(0, 50);
  }
  function scoreOrdered(haystack, needle) {
    let i = 0, score = 0, contig = 0;
    for (let j = 0; j < haystack.length && i < needle.length; j++) {
      if (haystack[j] === needle[i]) {
        score += 1;
        if (j === 0) score += 5;
        contig += 1;
        score += contig;
        i++;
      } else {
        contig = 0;
      }
    }
    return i === needle.length ? score : -1;
  }
  function highlight(id, q) {
    if (!q) return txt(id);
    const node = el("span");
    const ql = q.toLowerCase();
    let i = 0;
    for (const ch of id) {
      if (i < ql.length && ch.toLowerCase() === ql[i]) {
        node.appendChild(el("b", null, txt(ch)));
        i++;
      } else {
        node.appendChild(txt(ch));
      }
    }
    return node;
  }

  // src/modules/_registry.js
  var MODULES = [
    { hotkey: "K", id: "knowledge", name: "KNOWLEDGE", desc: "chat \xB7 library \xB7 12 vols", category: "primary", sprint: 5, pip: "\u25CF" },
    { hotkey: "C", id: "comms", name: "COMMS", desc: "mail \xB7 boards \xB7 mesh", category: "primary", sprint: 6, pip: "3 NEW", pipClass: "alert" },
    { hotkey: "M", id: "medical", name: "MEDICAL", desc: "triage \xB7 ref \xB7 dose", category: "primary", sprint: 7, pip: "\u25CF" },
    { hotkey: "N", id: "navigation", name: "NAVIGATION", desc: "map \xB7 waypoints \xB7 route", category: "primary", sprint: 8, pip: "GPS", pipClass: "cool" },
    { hotkey: "P", id: "power", name: "POWER", desc: "battery \xB7 load \xB7 radio", category: "primary", sprint: 3, pip: "82%" },
    { hotkey: "L", id: "log", name: "LOG", desc: "daily journal \xB7 timeline", category: "primary", sprint: 9, pip: "\u25CF" },
    { hotkey: "I", id: "inventory", name: "INVENTORY", desc: "kit \xB7 food \xB7 ammo \xB7 meds", category: "secondary", sprint: 10, pip: "2 EXP", pipClass: "alert" },
    { hotkey: "R", id: "recreation", name: "RECREATION", desc: "games \xB7 books \xB7 fortune", category: "secondary", sprint: 13, pip: "\u25CF" },
    { hotkey: "S", id: "signal", name: "SIGNAL", desc: "sdr \xB7 weather \xB7 scan", category: "secondary", sprint: 12, pip: "RX", pipClass: "cool" },
    { hotkey: "T", id: "timeline", name: "TIMELINE", desc: "unified events \xB7 query", category: "secondary", sprint: 11, pip: "\u25CF" },
    { hotkey: "U", id: "auspice", name: "AUSPICE", desc: "sky \xB7 tarot \xB7 oracle \xB7 journal", category: "secondary", sprint: 13, pip: "\u2726", pipClass: "cool" },
    { hotkey: "X", id: "system", name: "SYSTEM", desc: "admin \xB7 users \xB7 settings", category: "secondary", sprint: 15, pip: "\u25CF" },
    { hotkey: "?", id: "help", name: "HELP & XTRAS", desc: "topics \xB7 plugins \xB7 lore", category: "secondary", sprint: 15, pip: "\u25CF" }
  ];
  function moduleByHotkey(k) {
    const u = k.toUpperCase();
    return MODULES.find((m) => m.hotkey === u);
  }
  function moduleById(id) {
    return MODULES.find((m) => m.id === id);
  }

  // src/router.js
  function mountRouter(store2, { palette: palette2 }) {
    document.addEventListener("keydown", (e) => {
      if (palette2.isOpen()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ":") {
        e.preventDefault();
        palette2.show();
        return;
      }
      if (e.key === "Q" || e.key === "q") {
        const crumbs = store2.get("crumbs") || ["HOME"];
        if (crumbs.length > 1) {
          store2.set({ crumbs: crumbs.slice(0, -1), module: crumbs[crumbs.length - 2] });
        }
        e.preventDefault();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        return;
      }
      if (e.key === "?") {
        const help = moduleByHotkey("?");
        if (help) selectModule(store2, help);
        e.preventDefault();
        return;
      }
      if (e.key.length === 1) {
        const m = moduleByHotkey(e.key);
        if (m) {
          selectModule(store2, m);
          e.preventDefault();
        }
      }
    });
  }
  function selectModule(store2, m) {
    store2.set({
      module: m.name,
      crumbs: m.id === "home" ? ["HOME"] : ["HOME", m.name],
      pill: m.pip
    });
  }

  // src/transport/cache_classes.js
  var CACHE_CLASS = Object.freeze({
    STATIC: Object.freeze({ ttl: Infinity, ttlMesh: Infinity, poll: 0, pollMesh: 0 }),
    STABLE: Object.freeze({ ttl: 6e4, ttlMesh: 36e5, poll: 0, pollMesh: 0 }),
    WARM: Object.freeze({ ttl: 3e4, ttlMesh: 3e5, poll: 6e4, pollMesh: 6e5 }),
    HOT: Object.freeze({ ttl: 0, ttlMesh: 3e4, poll: 0, pollMesh: 3e4 }),
    EXPENSIVE: Object.freeze({ ttl: 0, ttlMesh: 0, poll: 0, pollMesh: 0 })
  });
  function ttlFor(cls, transportKind) {
    const c = CACHE_CLASS[cls] || CACHE_CLASS.WARM;
    return transportKind === "mesh" ? c.ttlMesh : c.ttl;
  }
  function pollFor(cls, transportKind) {
    const c = CACHE_CLASS[cls] || CACHE_CLASS.WARM;
    return transportKind === "mesh" ? c.pollMesh : c.poll;
  }

  // src/transport/http.js
  var KIND = "wifi";
  var HttpTransport = class {
    constructor({ store: store2, baseUrl = "" } = {}) {
      this.store = store2;
      this.baseUrl = baseUrl;
      this.cache = /* @__PURE__ */ new Map();
      this.healthState = "wifi";
      this.ws = null;
      this.subs = /* @__PURE__ */ new Map();
      this._wsBuffer = [];
      this._healthRecoveredCbs = [];
      this._connectWs();
    }
    kind() {
      return KIND;
    }
    health() {
      return this.healthState;
    }
    /** Register a fn called when health flips from "offline" to up. */
    onHealthRecovered(fn) {
      this._healthRecoveredCbs.push(fn);
      return () => {
        const i = this._healthRecoveredCbs.indexOf(fn);
        if (i >= 0) this._healthRecoveredCbs.splice(i, 1);
      };
    }
    /** request(method, path, body?, { cacheClass = "WARM", signal? }) */
    async request(method, path, body, opts = {}) {
      const cls = opts.cacheClass || "WARM";
      const ttl = ttlFor(cls, KIND);
      const cacheable = method === "GET" && ttl > 0;
      if (cacheable) {
        const hit = this.cache.get(path);
        if (hit) {
          const age = Date.now() - hit.at;
          if (age < ttl) return { ...hit.value, _cache: { age, fresh: true } };
          this._refetch(method, path, body, cls).catch(() => {
          });
          return { ...hit.value, _cache: { age, fresh: false } };
        }
      }
      const value = await this._fetch(method, path, body, opts);
      if (cacheable) this.cache.set(path, { value, at: Date.now() });
      return value;
    }
    /** subscribe(channel, onMessage) → unsubscribe fn */
    subscribe(channel, onMessage) {
      let subs = this.subs.get(channel);
      if (!subs) {
        this.subs.set(channel, subs = /* @__PURE__ */ new Set());
        this._send({ op: "subscribe", topics: [channel] });
      }
      subs.add(onMessage);
      return () => {
        subs.delete(onMessage);
        if (subs.size === 0) {
          this.subs.delete(channel);
          this._send({ op: "unsubscribe", topics: [channel] });
        }
      };
    }
    // ---- internals --------------------------------------------------
    async _fetch(method, path, body, opts) {
      const init = { method, headers: { "Accept": "application/json" }, signal: opts.signal };
      if (body !== void 0 && method !== "GET") {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      const url = this.baseUrl + path;
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
      return res.json();
    }
    async _refetch(method, path, body, cls) {
      const value = await this._fetch(method, path, body, {});
      this.cache.set(path, { value, at: Date.now() });
      for (const fn of this.subs.get("cache:" + path) || []) fn(value);
    }
    _connectWs() {
      if (typeof WebSocket === "undefined") return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${location.host}/ws`;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        this._setHealth("offline");
        return;
      }
      this.ws = ws;
      ws.addEventListener("open", () => {
        this._setHealth("wifi");
        for (const m of this._wsBuffer.splice(0)) ws.send(JSON.stringify(m));
        const topics = [...this.subs.keys()];
        if (topics.length) ws.send(JSON.stringify({ op: "subscribe", topics }));
      });
      ws.addEventListener("close", () => {
        this._setHealth("offline");
        setTimeout(() => this._connectWs(), 2e3);
      });
      ws.addEventListener("error", () => {
        this._setHealth("degraded");
      });
      ws.addEventListener("message", (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.op === "push") {
            for (const fn of this.subs.get(msg.topic) || []) fn(msg.data);
          }
        } catch (err) {
        }
      });
    }
    _send(payload) {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify(payload));
      } else {
        this._wsBuffer.push(payload);
      }
    }
    _setHealth(s) {
      const prev = this.healthState;
      if (prev === s) return;
      this.healthState = s;
      if (this.store) {
        const isUp = s === "wifi";
        this.store.set({ mesh: {
          reachable: isUp ? this.store.get("mesh")?.known ?? 1 : 0,
          known: this.store.get("mesh")?.known ?? 1
        } });
      }
      if (prev === "offline" && (s === "wifi" || s === "mesh")) {
        for (const fn of this._healthRecoveredCbs) {
          try {
            fn();
          } catch {
          }
        }
      }
    }
  };

  // node_modules/msgpackr/unpack.js
  var decoder;
  try {
    decoder = new TextDecoder();
  } catch (error) {
  }
  var src;
  var srcEnd;
  var position = 0;
  var EMPTY_ARRAY = [];
  var strings = EMPTY_ARRAY;
  var stringPosition = 0;
  var currentUnpackr = {};
  var currentStructures;
  var srcString;
  var srcStringStart = 0;
  var srcStringEnd = 0;
  var bundledStrings;
  var referenceMap;
  var currentExtensions = [];
  var dataView;
  var defaultOptions = {
    useRecords: false,
    mapsAsObjects: true
  };
  var C1Type = class {
  };
  var C1 = new C1Type();
  C1.name = "MessagePack 0xC1";
  var sequentialMode = false;
  var inlineObjectReadThreshold = 2;
  var readStruct;
  var onLoadedStructures;
  var onSaveState;
  var Unpackr = class _Unpackr {
    constructor(options) {
      if (options) {
        if (options.useRecords === false && options.mapsAsObjects === void 0)
          options.mapsAsObjects = true;
        if (options.sequential && options.trusted !== false) {
          options.trusted = true;
          if (!options.structures && options.useRecords != false) {
            options.structures = [];
            if (!options.maxSharedStructures)
              options.maxSharedStructures = 0;
          }
        }
        if (options.structures)
          options.structures.sharedLength = options.structures.length;
        else if (options.getStructures) {
          (options.structures = []).uninitialized = true;
          options.structures.sharedLength = 0;
        }
        if (options.int64AsNumber) {
          options.int64AsType = "number";
        }
      }
      Object.assign(this, options);
    }
    unpack(source, options) {
      if (src) {
        return saveState(() => {
          clearSource();
          return this ? this.unpack(source, options) : _Unpackr.prototype.unpack.call(defaultOptions, source, options);
        });
      }
      if (!source.buffer && source.constructor === ArrayBuffer)
        source = typeof Buffer !== "undefined" ? Buffer.from(source) : new Uint8Array(source);
      if (typeof options === "object") {
        srcEnd = options.end || source.length;
        position = options.start || 0;
      } else {
        position = 0;
        srcEnd = options > -1 ? options : source.length;
      }
      stringPosition = 0;
      srcStringEnd = 0;
      srcString = null;
      strings = EMPTY_ARRAY;
      bundledStrings = null;
      src = source;
      try {
        dataView = source.dataView || (source.dataView = new DataView(source.buffer, source.byteOffset, source.byteLength));
      } catch (error) {
        src = null;
        if (source instanceof Uint8Array)
          throw error;
        throw new Error("Source must be a Uint8Array or Buffer but was a " + (source && typeof source == "object" ? source.constructor.name : typeof source));
      }
      if (this instanceof _Unpackr) {
        currentUnpackr = this;
        if (this.structures) {
          currentStructures = this.structures;
          return checkedRead(options);
        } else if (!currentStructures || currentStructures.length > 0) {
          currentStructures = [];
        }
      } else {
        currentUnpackr = defaultOptions;
        if (!currentStructures || currentStructures.length > 0)
          currentStructures = [];
      }
      return checkedRead(options);
    }
    unpackMultiple(source, forEach) {
      let values, lastPosition = 0;
      try {
        sequentialMode = true;
        let size = source.length;
        let value = this ? this.unpack(source, size) : defaultUnpackr.unpack(source, size);
        if (forEach) {
          if (forEach(value, lastPosition, position) === false) return;
          while (position < size) {
            lastPosition = position;
            if (forEach(checkedRead(), lastPosition, position) === false) {
              return;
            }
          }
        } else {
          values = [value];
          while (position < size) {
            lastPosition = position;
            values.push(checkedRead());
          }
          return values;
        }
      } catch (error) {
        error.lastPosition = lastPosition;
        error.values = values;
        throw error;
      } finally {
        sequentialMode = false;
        clearSource();
      }
    }
    _mergeStructures(loadedStructures, existingStructures) {
      if (onLoadedStructures)
        loadedStructures = onLoadedStructures.call(this, loadedStructures);
      loadedStructures = loadedStructures || [];
      if (Object.isFrozen(loadedStructures))
        loadedStructures = loadedStructures.map((structure) => structure.slice(0));
      for (let i = 0, l = loadedStructures.length; i < l; i++) {
        let structure = loadedStructures[i];
        if (structure) {
          structure.isShared = true;
          if (i >= 32)
            structure.highByte = i - 32 >> 5;
        }
      }
      loadedStructures.sharedLength = loadedStructures.length;
      for (let id in existingStructures || []) {
        if (id >= 0) {
          let structure = loadedStructures[id];
          let existing = existingStructures[id];
          if (existing) {
            if (structure)
              (loadedStructures.restoreStructures || (loadedStructures.restoreStructures = []))[id] = structure;
            loadedStructures[id] = existing;
          }
        }
      }
      return this.structures = loadedStructures;
    }
    decode(source, options) {
      return this.unpack(source, options);
    }
  };
  function checkedRead(options) {
    try {
      if (!currentUnpackr.trusted && !sequentialMode) {
        let sharedLength = currentStructures.sharedLength || 0;
        if (sharedLength < currentStructures.length)
          currentStructures.length = sharedLength;
      }
      let result;
      if (currentUnpackr.randomAccessStructure && src[position] < 64 && src[position] >= 32 && readStruct) {
        result = readStruct(src, position, srcEnd, currentUnpackr);
        src = null;
        if (!(options && options.lazy) && result)
          result = result.toJSON();
        position = srcEnd;
      } else
        result = read();
      if (bundledStrings) {
        position = bundledStrings.postBundlePosition;
        bundledStrings = null;
      }
      if (sequentialMode)
        currentStructures.restoreStructures = null;
      if (position == srcEnd) {
        if (currentStructures && currentStructures.restoreStructures)
          restoreStructures();
        currentStructures = null;
        src = null;
        if (referenceMap)
          referenceMap = null;
      } else if (position > srcEnd) {
        throw new Error("Unexpected end of MessagePack data");
      } else if (!sequentialMode) {
        let jsonView;
        try {
          jsonView = JSON.stringify(result, (_, value) => typeof value === "bigint" ? `${value}n` : value).slice(0, 100);
        } catch (error) {
          jsonView = "(JSON view not available " + error + ")";
        }
        throw new Error("Data read, but end of buffer not reached " + jsonView);
      }
      return result;
    } catch (error) {
      if (currentStructures && currentStructures.restoreStructures)
        restoreStructures();
      clearSource();
      if (error instanceof RangeError || error.message.startsWith("Unexpected end of buffer") || position > srcEnd) {
        error.incomplete = true;
      }
      throw error;
    }
  }
  function restoreStructures() {
    for (let id in currentStructures.restoreStructures) {
      currentStructures[id] = currentStructures.restoreStructures[id];
    }
    currentStructures.restoreStructures = null;
  }
  function read() {
    let token = src[position++];
    if (token < 160) {
      if (token < 128) {
        if (token < 64)
          return token;
        else {
          let structure = currentStructures[token & 63] || currentUnpackr.getStructures && loadStructures()[token & 63];
          if (structure) {
            if (!structure.read) {
              structure.read = createStructureReader(structure, token & 63);
            }
            return structure.read();
          } else
            return token;
        }
      } else if (token < 144) {
        token -= 128;
        if (currentUnpackr.mapsAsObjects) {
          let object = {};
          for (let i = 0; i < token; i++) {
            let key = readKey();
            if (key === "__proto__")
              key = "__proto_";
            object[key] = read();
          }
          return object;
        } else {
          let map = /* @__PURE__ */ new Map();
          for (let i = 0; i < token; i++) {
            map.set(read(), read());
          }
          return map;
        }
      } else {
        token -= 144;
        let array = new Array(token);
        for (let i = 0; i < token; i++) {
          array[i] = read();
        }
        if (currentUnpackr.freezeData)
          return Object.freeze(array);
        return array;
      }
    } else if (token < 192) {
      let length = token - 160;
      if (srcStringEnd >= position) {
        return srcString.slice(position - srcStringStart, (position += length) - srcStringStart);
      }
      if (srcStringEnd == 0 && srcEnd < 140) {
        let string = length < 16 ? shortStringInJS(length) : longStringInJS(length);
        if (string != null)
          return string;
      }
      return readFixedString(length);
    } else {
      let value;
      switch (token) {
        case 192:
          return null;
        case 193:
          if (bundledStrings) {
            value = read();
            if (value > 0)
              return bundledStrings[1].slice(bundledStrings.position1, bundledStrings.position1 += value);
            else
              return bundledStrings[0].slice(bundledStrings.position0, bundledStrings.position0 -= value);
          }
          return C1;
        // "never-used", return special object to denote that
        case 194:
          return false;
        case 195:
          return true;
        case 196:
          value = src[position++];
          if (value === void 0)
            throw new Error("Unexpected end of buffer");
          return readBin(value);
        case 197:
          value = dataView.getUint16(position);
          position += 2;
          return readBin(value);
        case 198:
          value = dataView.getUint32(position);
          position += 4;
          return readBin(value);
        case 199:
          return readExt(src[position++]);
        case 200:
          value = dataView.getUint16(position);
          position += 2;
          return readExt(value);
        case 201:
          value = dataView.getUint32(position);
          position += 4;
          return readExt(value);
        case 202:
          value = dataView.getFloat32(position);
          if (currentUnpackr.useFloat32 > 2) {
            let multiplier = mult10[(src[position] & 127) << 1 | src[position + 1] >> 7];
            position += 4;
            return (multiplier * value + (value > 0 ? 0.5 : -0.5) >> 0) / multiplier;
          }
          position += 4;
          return value;
        case 203:
          value = dataView.getFloat64(position);
          position += 8;
          return value;
        // uint handlers
        case 204:
          return src[position++];
        case 205:
          value = dataView.getUint16(position);
          position += 2;
          return value;
        case 206:
          value = dataView.getUint32(position);
          position += 4;
          return value;
        case 207:
          if (currentUnpackr.int64AsType === "number") {
            value = dataView.getUint32(position) * 4294967296;
            value += dataView.getUint32(position + 4);
          } else if (currentUnpackr.int64AsType === "string") {
            value = dataView.getBigUint64(position).toString();
          } else if (currentUnpackr.int64AsType === "auto") {
            value = dataView.getBigUint64(position);
            if (value <= BigInt(2) << BigInt(52)) value = Number(value);
          } else
            value = dataView.getBigUint64(position);
          position += 8;
          return value;
        // int handlers
        case 208:
          return dataView.getInt8(position++);
        case 209:
          value = dataView.getInt16(position);
          position += 2;
          return value;
        case 210:
          value = dataView.getInt32(position);
          position += 4;
          return value;
        case 211:
          if (currentUnpackr.int64AsType === "number") {
            value = dataView.getInt32(position) * 4294967296;
            value += dataView.getUint32(position + 4);
          } else if (currentUnpackr.int64AsType === "string") {
            value = dataView.getBigInt64(position).toString();
          } else if (currentUnpackr.int64AsType === "auto") {
            value = dataView.getBigInt64(position);
            if (value >= BigInt(-2) << BigInt(52) && value <= BigInt(2) << BigInt(52)) value = Number(value);
          } else
            value = dataView.getBigInt64(position);
          position += 8;
          return value;
        case 212:
          value = src[position++];
          if (value == 114) {
            return recordDefinition(src[position++] & 63);
          } else {
            let extension = currentExtensions[value];
            if (extension) {
              if (extension.read) {
                position++;
                return extension.read(read());
              } else if (extension.noBuffer) {
                position++;
                return extension();
              } else
                return extension(src.subarray(position, ++position));
            } else
              throw new Error("Unknown extension " + value);
          }
        case 213:
          value = src[position];
          if (value == 114) {
            position++;
            return recordDefinition(src[position++] & 63, src[position++]);
          } else
            return readExt(2);
        case 214:
          return readExt(4);
        case 215:
          return readExt(8);
        case 216:
          return readExt(16);
        case 217:
          value = src[position++];
          if (srcStringEnd >= position) {
            return srcString.slice(position - srcStringStart, (position += value) - srcStringStart);
          }
          return readString8(value);
        case 218:
          value = dataView.getUint16(position);
          position += 2;
          if (srcStringEnd >= position) {
            return srcString.slice(position - srcStringStart, (position += value) - srcStringStart);
          }
          return readString16(value);
        case 219:
          value = dataView.getUint32(position);
          position += 4;
          if (srcStringEnd >= position) {
            return srcString.slice(position - srcStringStart, (position += value) - srcStringStart);
          }
          return readString32(value);
        case 220:
          value = dataView.getUint16(position);
          position += 2;
          return readArray(value);
        case 221:
          value = dataView.getUint32(position);
          position += 4;
          return readArray(value);
        case 222:
          value = dataView.getUint16(position);
          position += 2;
          return readMap(value);
        case 223:
          value = dataView.getUint32(position);
          position += 4;
          return readMap(value);
        default:
          if (token >= 224)
            return token - 256;
          if (token === void 0) {
            let error = new Error("Unexpected end of MessagePack data");
            error.incomplete = true;
            throw error;
          }
          throw new Error("Unknown MessagePack token " + token);
      }
    }
  }
  var validName = /^[a-zA-Z_$][a-zA-Z\d_$]*$/;
  function createStructureReader(structure, firstId) {
    function readObject() {
      if (readObject.count++ > inlineObjectReadThreshold) {
        let optimizedReadObject;
        try {
          optimizedReadObject = structure.read = new Function("r", "return function(){return " + (currentUnpackr.freezeData ? "Object.freeze" : "") + "({" + structure.map((key) => key === "__proto__" ? "__proto_:r()" : validName.test(key) ? key + ":r()" : "[" + JSON.stringify(key) + "]:r()").join(",") + "})}")(read);
        } catch (error) {
          inlineObjectReadThreshold = Infinity;
          return readObject();
        }
        if (structure.highByte === 0)
          structure.read = createSecondByteReader(firstId, structure.read);
        return optimizedReadObject();
      }
      let object = {};
      for (let i = 0, l = structure.length; i < l; i++) {
        let key = structure[i];
        if (key === "__proto__")
          key = "__proto_";
        object[key] = read();
      }
      if (currentUnpackr.freezeData)
        return Object.freeze(object);
      return object;
    }
    readObject.count = 0;
    if (structure.highByte === 0) {
      return createSecondByteReader(firstId, readObject);
    }
    return readObject;
  }
  var createSecondByteReader = (firstId, read0) => {
    return function() {
      let highByte = src[position++];
      if (highByte === 0)
        return read0();
      let id = firstId < 32 ? -(firstId + (highByte << 5)) : firstId + (highByte << 5);
      let structure = currentStructures[id] || loadStructures()[id];
      if (!structure) {
        throw new Error("Record id is not defined for " + id);
      }
      if (!structure.read)
        structure.read = createStructureReader(structure, firstId);
      return structure.read();
    };
  };
  function loadStructures() {
    let loadedStructures = saveState(() => {
      src = null;
      return currentUnpackr.getStructures();
    });
    return currentStructures = currentUnpackr._mergeStructures(loadedStructures, currentStructures);
  }
  var readFixedString = readStringJS;
  var readString8 = readStringJS;
  var readString16 = readStringJS;
  var readString32 = readStringJS;
  function readStringJS(length) {
    let result;
    if (length < 16) {
      if (result = shortStringInJS(length))
        return result;
    }
    if (length > 64 && decoder)
      return decoder.decode(src.subarray(position, position += length));
    const end = position + length;
    const units = [];
    result = "";
    while (position < end) {
      const byte1 = src[position++];
      if ((byte1 & 128) === 0) {
        units.push(byte1);
      } else if ((byte1 & 224) === 192) {
        const byte2 = src[position++] & 63;
        const codePoint = (byte1 & 31) << 6 | byte2;
        if (codePoint < 128) {
          units.push(65533);
        } else {
          units.push(codePoint);
        }
      } else if ((byte1 & 240) === 224) {
        const byte2 = src[position++] & 63;
        const byte3 = src[position++] & 63;
        const codePoint = (byte1 & 31) << 12 | byte2 << 6 | byte3;
        if (codePoint < 2048 || codePoint >= 55296 && codePoint <= 57343) {
          units.push(65533);
        } else {
          units.push(codePoint);
        }
      } else if ((byte1 & 248) === 240) {
        const byte2 = src[position++] & 63;
        const byte3 = src[position++] & 63;
        const byte4 = src[position++] & 63;
        let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
        if (unit < 65536 || unit > 1114111) {
          units.push(65533);
        } else if (unit > 65535) {
          unit -= 65536;
          units.push(unit >>> 10 & 1023 | 55296);
          unit = 56320 | unit & 1023;
          units.push(unit);
        } else {
          units.push(unit);
        }
      } else {
        units.push(65533);
      }
      if (units.length >= 4096) {
        result += fromCharCode.apply(String, units);
        units.length = 0;
      }
    }
    if (units.length > 0) {
      result += fromCharCode.apply(String, units);
    }
    return result;
  }
  function readArray(length) {
    let array = new Array(length);
    for (let i = 0; i < length; i++) {
      array[i] = read();
    }
    if (currentUnpackr.freezeData)
      return Object.freeze(array);
    return array;
  }
  function readMap(length) {
    if (currentUnpackr.mapsAsObjects) {
      let object = {};
      for (let i = 0; i < length; i++) {
        let key = readKey();
        if (key === "__proto__")
          key = "__proto_";
        object[key] = read();
      }
      return object;
    } else {
      let map = /* @__PURE__ */ new Map();
      for (let i = 0; i < length; i++) {
        map.set(read(), read());
      }
      return map;
    }
  }
  var fromCharCode = String.fromCharCode;
  function longStringInJS(length) {
    let start = position;
    let bytes = new Array(length);
    for (let i = 0; i < length; i++) {
      const byte = src[position++];
      if ((byte & 128) > 0) {
        position = start;
        return;
      }
      bytes[i] = byte;
    }
    return fromCharCode.apply(String, bytes);
  }
  function shortStringInJS(length) {
    if (length < 4) {
      if (length < 2) {
        if (length === 0)
          return "";
        else {
          let a = src[position++];
          if ((a & 128) > 1) {
            position -= 1;
            return;
          }
          return fromCharCode(a);
        }
      } else {
        let a = src[position++];
        let b = src[position++];
        if ((a & 128) > 0 || (b & 128) > 0) {
          position -= 2;
          return;
        }
        if (length < 3)
          return fromCharCode(a, b);
        let c = src[position++];
        if ((c & 128) > 0) {
          position -= 3;
          return;
        }
        return fromCharCode(a, b, c);
      }
    } else {
      let a = src[position++];
      let b = src[position++];
      let c = src[position++];
      let d = src[position++];
      if ((a & 128) > 0 || (b & 128) > 0 || (c & 128) > 0 || (d & 128) > 0) {
        position -= 4;
        return;
      }
      if (length < 6) {
        if (length === 4)
          return fromCharCode(a, b, c, d);
        else {
          let e = src[position++];
          if ((e & 128) > 0) {
            position -= 5;
            return;
          }
          return fromCharCode(a, b, c, d, e);
        }
      } else if (length < 8) {
        let e = src[position++];
        let f = src[position++];
        if ((e & 128) > 0 || (f & 128) > 0) {
          position -= 6;
          return;
        }
        if (length < 7)
          return fromCharCode(a, b, c, d, e, f);
        let g = src[position++];
        if ((g & 128) > 0) {
          position -= 7;
          return;
        }
        return fromCharCode(a, b, c, d, e, f, g);
      } else {
        let e = src[position++];
        let f = src[position++];
        let g = src[position++];
        let h = src[position++];
        if ((e & 128) > 0 || (f & 128) > 0 || (g & 128) > 0 || (h & 128) > 0) {
          position -= 8;
          return;
        }
        if (length < 10) {
          if (length === 8)
            return fromCharCode(a, b, c, d, e, f, g, h);
          else {
            let i = src[position++];
            if ((i & 128) > 0) {
              position -= 9;
              return;
            }
            return fromCharCode(a, b, c, d, e, f, g, h, i);
          }
        } else if (length < 12) {
          let i = src[position++];
          let j = src[position++];
          if ((i & 128) > 0 || (j & 128) > 0) {
            position -= 10;
            return;
          }
          if (length < 11)
            return fromCharCode(a, b, c, d, e, f, g, h, i, j);
          let k = src[position++];
          if ((k & 128) > 0) {
            position -= 11;
            return;
          }
          return fromCharCode(a, b, c, d, e, f, g, h, i, j, k);
        } else {
          let i = src[position++];
          let j = src[position++];
          let k = src[position++];
          let l = src[position++];
          if ((i & 128) > 0 || (j & 128) > 0 || (k & 128) > 0 || (l & 128) > 0) {
            position -= 12;
            return;
          }
          if (length < 14) {
            if (length === 12)
              return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l);
            else {
              let m = src[position++];
              if ((m & 128) > 0) {
                position -= 13;
                return;
              }
              return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m);
            }
          } else {
            let m = src[position++];
            let n = src[position++];
            if ((m & 128) > 0 || (n & 128) > 0) {
              position -= 14;
              return;
            }
            if (length < 15)
              return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m, n);
            let o = src[position++];
            if ((o & 128) > 0) {
              position -= 15;
              return;
            }
            return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o);
          }
        }
      }
    }
  }
  function readOnlyJSString() {
    let token = src[position++];
    let length;
    if (token < 192) {
      length = token - 160;
    } else {
      switch (token) {
        case 217:
          length = src[position++];
          break;
        case 218:
          length = dataView.getUint16(position);
          position += 2;
          break;
        case 219:
          length = dataView.getUint32(position);
          position += 4;
          break;
        default:
          throw new Error("Expected string");
      }
    }
    return readStringJS(length);
  }
  function readBin(length) {
    return currentUnpackr.copyBuffers ? (
      // specifically use the copying slice (not the node one)
      Uint8Array.prototype.slice.call(src, position, position += length)
    ) : src.subarray(position, position += length);
  }
  function readExt(length) {
    let type = src[position++];
    if (currentExtensions[type]) {
      let end;
      return currentExtensions[type](src.subarray(position, end = position += length), (readPosition) => {
        position = readPosition;
        try {
          return read();
        } finally {
          position = end;
        }
      });
    } else
      throw new Error("Unknown extension type " + type);
  }
  var keyCache = new Array(4096);
  function readKey() {
    let length = src[position++];
    if (length >= 160 && length < 192) {
      length = length - 160;
      if (srcStringEnd >= position)
        return srcString.slice(position - srcStringStart, (position += length) - srcStringStart);
      else if (!(srcStringEnd == 0 && srcEnd < 180))
        return readFixedString(length);
    } else {
      position--;
      return asSafeString(read());
    }
    let key = (length << 5 ^ (length > 1 ? dataView.getUint16(position) : length > 0 ? src[position] : 0)) & 4095;
    let entry = keyCache[key];
    let checkPosition = position;
    let end = position + length - 3;
    let chunk;
    let i = 0;
    if (entry && entry.bytes == length) {
      while (checkPosition < end) {
        chunk = dataView.getUint32(checkPosition);
        if (chunk != entry[i++]) {
          checkPosition = 1879048192;
          break;
        }
        checkPosition += 4;
      }
      end += 3;
      while (checkPosition < end) {
        chunk = src[checkPosition++];
        if (chunk != entry[i++]) {
          checkPosition = 1879048192;
          break;
        }
      }
      if (checkPosition === end) {
        position = checkPosition;
        return entry.string;
      }
      end -= 3;
      checkPosition = position;
    }
    entry = [];
    keyCache[key] = entry;
    entry.bytes = length;
    while (checkPosition < end) {
      chunk = dataView.getUint32(checkPosition);
      entry.push(chunk);
      checkPosition += 4;
    }
    end += 3;
    while (checkPosition < end) {
      chunk = src[checkPosition++];
      entry.push(chunk);
    }
    let string = length < 16 ? shortStringInJS(length) : longStringInJS(length);
    if (string != null)
      return entry.string = string;
    return entry.string = readFixedString(length);
  }
  function asSafeString(property) {
    if (typeof property === "string") return property;
    if (typeof property === "number" || typeof property === "boolean" || typeof property === "bigint") return property.toString();
    if (property == null) return property + "";
    if (currentUnpackr.allowArraysInMapKeys && Array.isArray(property) && property.flat().every((item) => ["string", "number", "boolean", "bigint"].includes(typeof item))) {
      return property.flat().toString();
    }
    throw new Error(`Invalid property type for record: ${typeof property}`);
  }
  var recordDefinition = (id, highByte) => {
    let structure = read().map(asSafeString);
    let firstByte = id;
    if (highByte !== void 0) {
      id = id < 32 ? -((highByte << 5) + id) : (highByte << 5) + id;
      structure.highByte = highByte;
    }
    let existingStructure = currentStructures[id];
    if (existingStructure && (existingStructure.isShared || sequentialMode)) {
      (currentStructures.restoreStructures || (currentStructures.restoreStructures = []))[id] = existingStructure;
    }
    currentStructures[id] = structure;
    structure.read = createStructureReader(structure, firstByte);
    return structure.read();
  };
  currentExtensions[0] = () => {
  };
  currentExtensions[0].noBuffer = true;
  currentExtensions[66] = (data) => {
    let headLength = data.byteLength % 8 || 8;
    let head = BigInt(data[0] & 128 ? data[0] - 256 : data[0]);
    for (let i = 1; i < headLength; i++) {
      head <<= BigInt(8);
      head += BigInt(data[i]);
    }
    if (data.byteLength !== headLength) {
      let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let decode3 = (start, end) => {
        let length = end - start;
        if (length <= 40) {
          let out = view.getBigUint64(start);
          for (let i = start + 8; i < end; i += 8) {
            out <<= BigInt(64n);
            out |= view.getBigUint64(i);
          }
          return out;
        }
        let middle = start + (length >> 4 << 3);
        let left = decode3(start, middle);
        let right = decode3(middle, end);
        return left << BigInt((end - middle) * 8) | right;
      };
      head = head << BigInt((view.byteLength - headLength) * 8) | decode3(headLength, view.byteLength);
    }
    return head;
  };
  var errors = {
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,
    AggregateError: typeof AggregateError === "function" ? AggregateError : null
  };
  currentExtensions[101] = () => {
    let data = read();
    if (!errors[data[0]]) {
      let error = Error(data[1], { cause: data[2] });
      error.name = data[0];
      return error;
    }
    return errors[data[0]](data[1], { cause: data[2] });
  };
  currentExtensions[105] = (data) => {
    if (currentUnpackr.structuredClone === false) throw new Error("Structured clone extension is disabled");
    let id = dataView.getUint32(position - 4);
    if (!referenceMap)
      referenceMap = /* @__PURE__ */ new Map();
    let token = src[position];
    let target2;
    if (token >= 144 && token < 160 || token == 220 || token == 221)
      target2 = [];
    else if (token >= 128 && token < 144 || token == 222 || token == 223)
      target2 = /* @__PURE__ */ new Map();
    else if ((token >= 199 && token <= 201 || token >= 212 && token <= 216) && src[position + 1] === 115)
      target2 = /* @__PURE__ */ new Set();
    else
      target2 = {};
    let refEntry = { target: target2 };
    referenceMap.set(id, refEntry);
    let targetProperties = read();
    if (!refEntry.used) {
      return refEntry.target = targetProperties;
    } else {
      Object.assign(target2, targetProperties);
    }
    if (target2 instanceof Map)
      for (let [k, v] of targetProperties.entries()) target2.set(k, v);
    if (target2 instanceof Set)
      for (let i of Array.from(targetProperties)) target2.add(i);
    return target2;
  };
  currentExtensions[112] = (data) => {
    if (currentUnpackr.structuredClone === false) throw new Error("Structured clone extension is disabled");
    let id = dataView.getUint32(position - 4);
    let refEntry = referenceMap.get(id);
    refEntry.used = true;
    return refEntry.target;
  };
  currentExtensions[115] = () => new Set(read());
  var typedArrays = ["Int8", "Uint8", "Uint8Clamped", "Int16", "Uint16", "Int32", "Uint32", "Float32", "Float64", "BigInt64", "BigUint64"].map((type) => type + "Array");
  var glbl = typeof globalThis === "object" ? globalThis : window;
  currentExtensions[116] = (data) => {
    let typeCode = data[0];
    let buffer = Uint8Array.prototype.slice.call(data, 1).buffer;
    let typedArrayName = typedArrays[typeCode];
    if (!typedArrayName) {
      if (typeCode === 16) return buffer;
      if (typeCode === 17) return new DataView(buffer);
      throw new Error("Could not find typed array for code " + typeCode);
    }
    return new glbl[typedArrayName](buffer);
  };
  currentExtensions[120] = () => {
    let data = read();
    return new RegExp(data[0], data[1]);
  };
  var TEMP_BUNDLE = [];
  currentExtensions[98] = (data) => {
    let dataSize = (data[0] << 24) + (data[1] << 16) + (data[2] << 8) + data[3];
    let dataPosition = position;
    position += dataSize - data.length;
    bundledStrings = TEMP_BUNDLE;
    bundledStrings = [readOnlyJSString(), readOnlyJSString()];
    bundledStrings.position0 = 0;
    bundledStrings.position1 = 0;
    bundledStrings.postBundlePosition = position;
    position = dataPosition;
    return read();
  };
  currentExtensions[255] = (data) => {
    if (data.length == 4)
      return new Date((data[0] * 16777216 + (data[1] << 16) + (data[2] << 8) + data[3]) * 1e3);
    else if (data.length == 8)
      return new Date(
        ((data[0] << 22) + (data[1] << 14) + (data[2] << 6) + (data[3] >> 2)) / 1e6 + ((data[3] & 3) * 4294967296 + data[4] * 16777216 + (data[5] << 16) + (data[6] << 8) + data[7]) * 1e3
      );
    else if (data.length == 12)
      return new Date(
        ((data[0] << 24) + (data[1] << 16) + (data[2] << 8) + data[3]) / 1e6 + ((data[4] & 128 ? -281474976710656 : 0) + data[6] * 1099511627776 + data[7] * 4294967296 + data[8] * 16777216 + (data[9] << 16) + (data[10] << 8) + data[11]) * 1e3
      );
    else
      return /* @__PURE__ */ new Date("invalid");
  };
  function saveState(callback) {
    if (onSaveState)
      onSaveState();
    let savedSrcEnd = srcEnd;
    let savedPosition = position;
    let savedStringPosition = stringPosition;
    let savedSrcStringStart = srcStringStart;
    let savedSrcStringEnd = srcStringEnd;
    let savedSrcString = srcString;
    let savedStrings = strings;
    let savedReferenceMap = referenceMap;
    let savedBundledStrings = bundledStrings;
    let savedSrc = new Uint8Array(src.slice(0, srcEnd));
    let savedStructures = currentStructures;
    let savedStructuresContents = currentStructures.slice(0, currentStructures.length);
    let savedPackr = currentUnpackr;
    let savedSequentialMode = sequentialMode;
    let value = callback();
    srcEnd = savedSrcEnd;
    position = savedPosition;
    stringPosition = savedStringPosition;
    srcStringStart = savedSrcStringStart;
    srcStringEnd = savedSrcStringEnd;
    srcString = savedSrcString;
    strings = savedStrings;
    referenceMap = savedReferenceMap;
    bundledStrings = savedBundledStrings;
    src = savedSrc;
    sequentialMode = savedSequentialMode;
    currentStructures = savedStructures;
    currentStructures.splice(0, currentStructures.length, ...savedStructuresContents);
    currentUnpackr = savedPackr;
    dataView = new DataView(src.buffer, src.byteOffset, src.byteLength);
    return value;
  }
  function clearSource() {
    src = null;
    referenceMap = null;
    currentStructures = null;
  }
  var mult10 = new Array(147);
  for (let i = 0; i < 256; i++) {
    mult10[i] = +("1e" + Math.floor(45.15 - i * 0.30103));
  }
  var defaultUnpackr = new Unpackr({ useRecords: false });
  var unpack = defaultUnpackr.unpack;
  var unpackMultiple = defaultUnpackr.unpackMultiple;
  var decode = defaultUnpackr.unpack;
  var FLOAT32_OPTIONS = {
    NEVER: 0,
    ALWAYS: 1,
    DECIMAL_ROUND: 3,
    DECIMAL_FIT: 4
  };
  var f32Array = new Float32Array(1);
  var u8Array = new Uint8Array(f32Array.buffer, 0, 4);

  // node_modules/msgpackr/pack.js
  var textEncoder;
  try {
    textEncoder = new TextEncoder();
  } catch (error) {
  }
  var extensions;
  var extensionClasses;
  var hasNodeBuffer = typeof Buffer !== "undefined";
  var ByteArrayAllocate = hasNodeBuffer ? function(length) {
    return Buffer.allocUnsafeSlow(length);
  } : Uint8Array;
  var ByteArray = hasNodeBuffer ? Buffer : Uint8Array;
  var MAX_BUFFER_SIZE = hasNodeBuffer ? 4294967296 : 2144337920;
  var target;
  var keysTarget;
  var targetView;
  var position2 = 0;
  var safeEnd;
  var bundledStrings2 = null;
  var writeStructSlots;
  var MAX_BUNDLE_SIZE = 21760;
  var hasNonLatin = /[\u0080-\uFFFF]/;
  var RECORD_SYMBOL = /* @__PURE__ */ Symbol("record-id");
  var Packr = class extends Unpackr {
    constructor(options) {
      super(options);
      this.offset = 0;
      let typeBuffer;
      let start;
      let hasSharedUpdate;
      let structures;
      let referenceMap2;
      let encodeUtf8 = ByteArray.prototype.utf8Write ? function(string, position3) {
        return target.utf8Write(string, position3, target.byteLength - position3);
      } : textEncoder && textEncoder.encodeInto ? function(string, position3) {
        return textEncoder.encodeInto(string, target.subarray(position3)).written;
      } : false;
      let packr = this;
      if (!options)
        options = {};
      let isSequential = options && options.sequential;
      let hasSharedStructures = options.structures || options.saveStructures;
      let maxSharedStructures = options.maxSharedStructures;
      if (maxSharedStructures == null)
        maxSharedStructures = hasSharedStructures ? 32 : 0;
      if (maxSharedStructures > 8160)
        throw new Error("Maximum maxSharedStructure is 8160");
      if (options.structuredClone && options.moreTypes == void 0) {
        this.moreTypes = true;
      }
      let maxOwnStructures = options.maxOwnStructures;
      if (maxOwnStructures == null)
        maxOwnStructures = hasSharedStructures ? 32 : 64;
      if (!this.structures && options.useRecords != false)
        this.structures = [];
      let useTwoByteRecords = maxSharedStructures > 32 || maxOwnStructures + maxSharedStructures > 64;
      let sharedLimitId = maxSharedStructures + 64;
      let maxStructureId = maxSharedStructures + maxOwnStructures + 64;
      if (maxStructureId > 8256) {
        throw new Error("Maximum maxSharedStructure + maxOwnStructure is 8192");
      }
      let recordIdsToRemove = [];
      let transitionsCount = 0;
      let serializationsSinceTransitionRebuild = 0;
      this.pack = this.encode = function(value, encodeOptions) {
        if (!target) {
          target = new ByteArrayAllocate(8192);
          targetView = target.dataView || (target.dataView = new DataView(target.buffer, 0, 8192));
          position2 = 0;
        }
        safeEnd = target.length - 10;
        if (safeEnd - position2 < 2048) {
          target = new ByteArrayAllocate(target.length);
          targetView = target.dataView || (target.dataView = new DataView(target.buffer, 0, target.length));
          safeEnd = target.length - 10;
          position2 = 0;
        } else
          position2 = position2 + 7 & 2147483640;
        start = position2;
        if (encodeOptions & RESERVE_START_SPACE) position2 += encodeOptions & 255;
        referenceMap2 = packr.structuredClone ? /* @__PURE__ */ new Map() : null;
        if (packr.bundleStrings && typeof value !== "string") {
          bundledStrings2 = [];
          bundledStrings2.size = Infinity;
        } else
          bundledStrings2 = null;
        structures = packr.structures;
        if (structures) {
          if (structures.uninitialized)
            structures = packr._mergeStructures(packr.getStructures());
          let sharedLength = structures.sharedLength || 0;
          if (sharedLength > maxSharedStructures) {
            throw new Error("Shared structures is larger than maximum shared structures, try increasing maxSharedStructures to " + structures.sharedLength);
          }
          if (!structures.transitions) {
            structures.transitions = /* @__PURE__ */ Object.create(null);
            for (let i = 0; i < sharedLength; i++) {
              let keys = structures[i];
              if (!keys)
                continue;
              let nextTransition, transition = structures.transitions;
              for (let j = 0, l = keys.length; j < l; j++) {
                let key = keys[j];
                nextTransition = transition[key];
                if (!nextTransition) {
                  nextTransition = transition[key] = /* @__PURE__ */ Object.create(null);
                }
                transition = nextTransition;
              }
              transition[RECORD_SYMBOL] = i + 64;
            }
            this.lastNamedStructuresLength = sharedLength;
          }
          if (!isSequential) {
            structures.nextId = sharedLength + 64;
          }
        }
        if (hasSharedUpdate)
          hasSharedUpdate = false;
        let encodingError;
        try {
          if (packr.randomAccessStructure && value && typeof value === "object") {
            if (value.constructor === Object) writeStruct(value);
            else if (value.constructor !== Map && !Array.isArray(value) && !extensionClasses.some((extClass) => value instanceof extClass)) {
              writeStruct(value.toJSON ? value.toJSON() : value);
            } else pack2(value);
          } else
            pack2(value);
          let lastBundle = bundledStrings2;
          if (bundledStrings2)
            writeBundles(start, pack2, 0);
          if (referenceMap2 && referenceMap2.idsToInsert) {
            let idsToInsert = referenceMap2.idsToInsert.sort((a, b) => a.offset > b.offset ? 1 : -1);
            let i = idsToInsert.length;
            let incrementPosition = -1;
            while (lastBundle && i > 0) {
              let insertionPoint = idsToInsert[--i].offset + start;
              if (insertionPoint < lastBundle.stringsPosition + start && incrementPosition === -1)
                incrementPosition = 0;
              if (insertionPoint > lastBundle.position + start) {
                if (incrementPosition >= 0)
                  incrementPosition += 6;
              } else {
                if (incrementPosition >= 0) {
                  targetView.setUint32(
                    lastBundle.position + start,
                    targetView.getUint32(lastBundle.position + start) + incrementPosition
                  );
                  incrementPosition = -1;
                }
                lastBundle = lastBundle.previous;
                i++;
              }
            }
            if (incrementPosition >= 0 && lastBundle) {
              targetView.setUint32(
                lastBundle.position + start,
                targetView.getUint32(lastBundle.position + start) + incrementPosition
              );
            }
            position2 += idsToInsert.length * 6;
            if (position2 > safeEnd)
              makeRoom(position2);
            packr.offset = position2;
            let serialized = insertIds(target.subarray(start, position2), idsToInsert);
            referenceMap2 = null;
            return serialized;
          }
          packr.offset = position2;
          if (encodeOptions & REUSE_BUFFER_MODE) {
            target.start = start;
            target.end = position2;
            return target;
          }
          return target.subarray(start, position2);
        } catch (error) {
          encodingError = error;
          throw error;
        } finally {
          if (structures) {
            resetStructures();
            if (hasSharedUpdate && packr.saveStructures) {
              let sharedLength = structures.sharedLength || 0;
              let returnBuffer = target.subarray(start, position2);
              let newSharedData = prepareStructures(structures, packr);
              if (!encodingError) {
                if (packr.saveStructures(newSharedData, newSharedData.isCompatible) === false) {
                  return packr.pack(value, encodeOptions);
                }
                packr.lastNamedStructuresLength = sharedLength;
                if (target.length > 1073741824) target = null;
                return returnBuffer;
              }
            }
          }
          if (target.length > 1073741824) target = null;
          if (encodeOptions & RESET_BUFFER_MODE)
            position2 = start;
        }
      };
      const resetStructures = () => {
        if (serializationsSinceTransitionRebuild < 10)
          serializationsSinceTransitionRebuild++;
        let sharedLength = structures.sharedLength || 0;
        if (structures.length > sharedLength && !isSequential)
          structures.length = sharedLength;
        if (transitionsCount > 1e4) {
          structures.transitions = null;
          serializationsSinceTransitionRebuild = 0;
          transitionsCount = 0;
          if (recordIdsToRemove.length > 0)
            recordIdsToRemove = [];
        } else if (recordIdsToRemove.length > 0 && !isSequential) {
          for (let i = 0, l = recordIdsToRemove.length; i < l; i++) {
            recordIdsToRemove[i][RECORD_SYMBOL] = 0;
          }
          recordIdsToRemove = [];
        }
      };
      const packArray = (value) => {
        var length = value.length;
        if (length < 16) {
          target[position2++] = 144 | length;
        } else if (length < 65536) {
          target[position2++] = 220;
          target[position2++] = length >> 8;
          target[position2++] = length & 255;
        } else {
          target[position2++] = 221;
          targetView.setUint32(position2, length);
          position2 += 4;
        }
        for (let i = 0; i < length; i++) {
          pack2(value[i]);
        }
      };
      const pack2 = (value) => {
        if (position2 > safeEnd)
          target = makeRoom(position2);
        var type = typeof value;
        var length;
        if (type === "string") {
          let strLength = value.length;
          if (bundledStrings2 && strLength >= 4 && strLength < 4096) {
            if ((bundledStrings2.size += strLength) > MAX_BUNDLE_SIZE) {
              let extStart;
              let maxBytes2 = (bundledStrings2[0] ? bundledStrings2[0].length * 3 + bundledStrings2[1].length : 0) + 10;
              if (position2 + maxBytes2 > safeEnd)
                target = makeRoom(position2 + maxBytes2);
              let lastBundle;
              if (bundledStrings2.position) {
                lastBundle = bundledStrings2;
                target[position2] = 200;
                position2 += 3;
                target[position2++] = 98;
                extStart = position2 - start;
                position2 += 4;
                writeBundles(start, pack2, 0);
                targetView.setUint16(extStart + start - 3, position2 - start - extStart);
              } else {
                target[position2++] = 214;
                target[position2++] = 98;
                extStart = position2 - start;
                position2 += 4;
              }
              bundledStrings2 = ["", ""];
              bundledStrings2.previous = lastBundle;
              bundledStrings2.size = 0;
              bundledStrings2.position = extStart;
            }
            let twoByte = hasNonLatin.test(value);
            bundledStrings2[twoByte ? 0 : 1] += value;
            target[position2++] = 193;
            pack2(twoByte ? -strLength : strLength);
            return;
          }
          let headerSize;
          if (strLength < 32) {
            headerSize = 1;
          } else if (strLength < 256) {
            headerSize = 2;
          } else if (strLength < 65536) {
            headerSize = 3;
          } else {
            headerSize = 5;
          }
          let maxBytes = strLength * 3;
          if (position2 + maxBytes > safeEnd)
            target = makeRoom(position2 + maxBytes);
          if (strLength < 64 || !encodeUtf8) {
            let i, c1, c2, strPosition = position2 + headerSize;
            for (i = 0; i < strLength; i++) {
              c1 = value.charCodeAt(i);
              if (c1 < 128) {
                target[strPosition++] = c1;
              } else if (c1 < 2048) {
                target[strPosition++] = c1 >> 6 | 192;
                target[strPosition++] = c1 & 63 | 128;
              } else if ((c1 & 64512) === 55296 && ((c2 = value.charCodeAt(i + 1)) & 64512) === 56320) {
                c1 = 65536 + ((c1 & 1023) << 10) + (c2 & 1023);
                i++;
                target[strPosition++] = c1 >> 18 | 240;
                target[strPosition++] = c1 >> 12 & 63 | 128;
                target[strPosition++] = c1 >> 6 & 63 | 128;
                target[strPosition++] = c1 & 63 | 128;
              } else {
                target[strPosition++] = c1 >> 12 | 224;
                target[strPosition++] = c1 >> 6 & 63 | 128;
                target[strPosition++] = c1 & 63 | 128;
              }
            }
            length = strPosition - position2 - headerSize;
          } else {
            length = encodeUtf8(value, position2 + headerSize);
          }
          if (length < 32) {
            target[position2++] = 160 | length;
          } else if (length < 256) {
            if (headerSize < 2) {
              target.copyWithin(position2 + 2, position2 + 1, position2 + 1 + length);
            }
            target[position2++] = 217;
            target[position2++] = length;
          } else if (length < 65536) {
            if (headerSize < 3) {
              target.copyWithin(position2 + 3, position2 + 2, position2 + 2 + length);
            }
            target[position2++] = 218;
            target[position2++] = length >> 8;
            target[position2++] = length & 255;
          } else {
            if (headerSize < 5) {
              target.copyWithin(position2 + 5, position2 + 3, position2 + 3 + length);
            }
            target[position2++] = 219;
            targetView.setUint32(position2, length);
            position2 += 4;
          }
          position2 += length;
        } else if (type === "number") {
          if (value >>> 0 === value) {
            if (value < 32 || value < 128 && this.useRecords === false || value < 64 && !this.randomAccessStructure) {
              target[position2++] = value;
            } else if (value < 256) {
              target[position2++] = 204;
              target[position2++] = value;
            } else if (value < 65536) {
              target[position2++] = 205;
              target[position2++] = value >> 8;
              target[position2++] = value & 255;
            } else {
              target[position2++] = 206;
              targetView.setUint32(position2, value);
              position2 += 4;
            }
          } else if (value >> 0 === value) {
            if (value >= -32) {
              target[position2++] = 256 + value;
            } else if (value >= -128) {
              target[position2++] = 208;
              target[position2++] = value + 256;
            } else if (value >= -32768) {
              target[position2++] = 209;
              targetView.setInt16(position2, value);
              position2 += 2;
            } else {
              target[position2++] = 210;
              targetView.setInt32(position2, value);
              position2 += 4;
            }
          } else {
            let useFloat32;
            if ((useFloat32 = this.useFloat32) > 0 && value < 4294967296 && value >= -2147483648) {
              target[position2++] = 202;
              targetView.setFloat32(position2, value);
              let xShifted;
              if (useFloat32 < 4 || // this checks for rounding of numbers that were encoded in 32-bit float to nearest significant decimal digit that could be preserved
              (xShifted = value * mult10[(target[position2] & 127) << 1 | target[position2 + 1] >> 7]) >> 0 === xShifted) {
                position2 += 4;
                return;
              } else
                position2--;
            }
            target[position2++] = 203;
            targetView.setFloat64(position2, value);
            position2 += 8;
          }
        } else if (type === "object" || type === "function") {
          if (!value)
            target[position2++] = 192;
          else {
            if (referenceMap2) {
              let referee = referenceMap2.get(value);
              if (referee) {
                if (!referee.id) {
                  let idsToInsert = referenceMap2.idsToInsert || (referenceMap2.idsToInsert = []);
                  referee.id = idsToInsert.push(referee);
                }
                target[position2++] = 214;
                target[position2++] = 112;
                targetView.setUint32(position2, referee.id);
                position2 += 4;
                return;
              } else
                referenceMap2.set(value, { offset: position2 - start });
            }
            let constructor = value.constructor;
            if (constructor === Object) {
              writeObject(value);
            } else if (constructor === Array) {
              packArray(value);
            } else if (constructor === Map) {
              if (this.mapAsEmptyObject) target[position2++] = 128;
              else {
                length = value.size;
                if (length < 16) {
                  target[position2++] = 128 | length;
                } else if (length < 65536) {
                  target[position2++] = 222;
                  target[position2++] = length >> 8;
                  target[position2++] = length & 255;
                } else {
                  target[position2++] = 223;
                  targetView.setUint32(position2, length);
                  position2 += 4;
                }
                for (let [key, entryValue] of value) {
                  pack2(key);
                  pack2(entryValue);
                }
              }
            } else {
              for (let i = 0, l = extensions.length; i < l; i++) {
                let extensionClass = extensionClasses[i];
                if (value instanceof extensionClass) {
                  let extension = extensions[i];
                  if (extension.write) {
                    if (extension.type) {
                      target[position2++] = 212;
                      target[position2++] = extension.type;
                      target[position2++] = 0;
                    }
                    let writeResult = extension.write.call(this, value);
                    if (writeResult === value) {
                      if (Array.isArray(value)) {
                        packArray(value);
                      } else {
                        writeObject(value);
                      }
                    } else {
                      pack2(writeResult);
                    }
                    return;
                  }
                  let currentTarget = target;
                  let currentTargetView = targetView;
                  let currentPosition = position2;
                  target = null;
                  let result;
                  try {
                    result = extension.pack.call(this, value, (size) => {
                      target = currentTarget;
                      currentTarget = null;
                      position2 += size;
                      if (position2 > safeEnd)
                        makeRoom(position2);
                      return {
                        target,
                        targetView,
                        position: position2 - size
                      };
                    }, pack2);
                  } finally {
                    if (currentTarget) {
                      target = currentTarget;
                      targetView = currentTargetView;
                      position2 = currentPosition;
                      safeEnd = target.length - 10;
                    }
                  }
                  if (result) {
                    if (result.length + position2 > safeEnd)
                      makeRoom(result.length + position2);
                    position2 = writeExtensionData(result, target, position2, extension.type);
                  }
                  return;
                }
              }
              if (Array.isArray(value)) {
                packArray(value);
              } else {
                if (value.toJSON) {
                  const json = value.toJSON();
                  if (json !== value)
                    return pack2(json);
                }
                if (type === "function")
                  return pack2(this.writeFunction && this.writeFunction(value));
                writeObject(value);
              }
            }
          }
        } else if (type === "boolean") {
          target[position2++] = value ? 195 : 194;
        } else if (type === "bigint") {
          if (value < 9223372036854776e3 && value >= -9223372036854776e3) {
            target[position2++] = 211;
            targetView.setBigInt64(position2, value);
          } else if (value < 18446744073709552e3 && value > 0) {
            target[position2++] = 207;
            targetView.setBigUint64(position2, value);
          } else {
            if (this.largeBigIntToFloat) {
              target[position2++] = 203;
              targetView.setFloat64(position2, Number(value));
            } else if (this.largeBigIntToString) {
              return pack2(value.toString());
            } else if (this.useBigIntExtension || this.moreTypes) {
              let empty = value < 0 ? BigInt(-1) : BigInt(0);
              let array;
              if (value >> BigInt(65536) === empty) {
                let mask = BigInt(18446744073709552e3) - BigInt(1);
                let chunks = [];
                while (true) {
                  chunks.push(value & mask);
                  if (value >> BigInt(63) === empty) break;
                  value >>= BigInt(64);
                }
                array = new Uint8Array(new BigUint64Array(chunks).buffer);
                array.reverse();
              } else {
                let invert = value < 0;
                let string = (invert ? ~value : value).toString(16);
                if (string.length % 2) {
                  string = "0" + string;
                } else if (parseInt(string.charAt(0), 16) >= 8) {
                  string = "00" + string;
                }
                if (hasNodeBuffer) {
                  array = Buffer.from(string, "hex");
                } else {
                  array = new Uint8Array(string.length / 2);
                  for (let i = 0; i < array.length; i++) {
                    array[i] = parseInt(string.slice(i * 2, i * 2 + 2), 16);
                  }
                }
                if (invert) {
                  for (let i = 0; i < array.length; i++) array[i] = ~array[i];
                }
              }
              if (array.length + position2 > safeEnd)
                makeRoom(array.length + position2);
              position2 = writeExtensionData(array, target, position2, 66);
              return;
            } else {
              throw new RangeError(value + " was too large to fit in MessagePack 64-bit integer format, use useBigIntExtension, or set largeBigIntToFloat to convert to float-64, or set largeBigIntToString to convert to string");
            }
          }
          position2 += 8;
        } else if (type === "undefined") {
          if (this.encodeUndefinedAsNil)
            target[position2++] = 192;
          else {
            target[position2++] = 212;
            target[position2++] = 0;
            target[position2++] = 0;
          }
        } else {
          throw new Error("Unknown type: " + type);
        }
      };
      const writePlainObject = this.variableMapSize || this.coercibleKeyAsNumber || this.skipValues ? (object) => {
        let keys;
        if (this.skipValues) {
          keys = [];
          for (let key2 in object) {
            if ((typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key2)) && !this.skipValues.includes(object[key2]))
              keys.push(key2);
          }
        } else {
          keys = Object.keys(object);
        }
        let length = keys.length;
        if (length < 16) {
          target[position2++] = 128 | length;
        } else if (length < 65536) {
          target[position2++] = 222;
          target[position2++] = length >> 8;
          target[position2++] = length & 255;
        } else {
          target[position2++] = 223;
          targetView.setUint32(position2, length);
          position2 += 4;
        }
        let key;
        if (this.coercibleKeyAsNumber) {
          for (let i = 0; i < length; i++) {
            key = keys[i];
            let num = Number(key);
            pack2(isNaN(num) ? key : num);
            pack2(object[key]);
          }
        } else {
          for (let i = 0; i < length; i++) {
            pack2(key = keys[i]);
            pack2(object[key]);
          }
        }
      } : (object) => {
        target[position2++] = 222;
        let objectOffset = position2 - start;
        position2 += 2;
        let size = 0;
        for (let key in object) {
          if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
            pack2(key);
            pack2(object[key]);
            size++;
          }
        }
        if (size > 65535) {
          throw new Error('Object is too large to serialize with fast 16-bit map size, use the "variableMapSize" option to serialize this object');
        }
        target[objectOffset++ + start] = size >> 8;
        target[objectOffset + start] = size & 255;
      };
      const writeRecord = this.useRecords === false ? writePlainObject : options.progressiveRecords && !useTwoByteRecords ? (
        // this is about 2% faster for highly stable structures, since it only requires one for-in loop (but much more expensive when new structure needs to be written)
        (object) => {
          let nextTransition, transition = structures.transitions || (structures.transitions = /* @__PURE__ */ Object.create(null));
          let objectOffset = position2++ - start;
          let wroteKeys;
          for (let key in object) {
            if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
              nextTransition = transition[key];
              if (nextTransition)
                transition = nextTransition;
              else {
                let keys = Object.keys(object);
                let lastTransition = transition;
                transition = structures.transitions;
                let newTransitions = 0;
                for (let i = 0, l = keys.length; i < l; i++) {
                  let key2 = keys[i];
                  nextTransition = transition[key2];
                  if (!nextTransition) {
                    nextTransition = transition[key2] = /* @__PURE__ */ Object.create(null);
                    newTransitions++;
                  }
                  transition = nextTransition;
                }
                if (objectOffset + start + 1 == position2) {
                  position2--;
                  newRecord(transition, keys, newTransitions);
                } else
                  insertNewRecord(transition, keys, objectOffset, newTransitions);
                wroteKeys = true;
                transition = lastTransition[key];
              }
              pack2(object[key]);
            }
          }
          if (!wroteKeys) {
            let recordId = transition[RECORD_SYMBOL];
            if (recordId)
              target[objectOffset + start] = recordId;
            else
              insertNewRecord(transition, Object.keys(object), objectOffset, 0);
          }
        }
      ) : (object) => {
        let nextTransition, transition = structures.transitions || (structures.transitions = /* @__PURE__ */ Object.create(null));
        let newTransitions = 0;
        for (let key in object) if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
          nextTransition = transition[key];
          if (!nextTransition) {
            nextTransition = transition[key] = /* @__PURE__ */ Object.create(null);
            newTransitions++;
          }
          transition = nextTransition;
        }
        let recordId = transition[RECORD_SYMBOL];
        if (recordId) {
          if (recordId >= 96 && useTwoByteRecords) {
            target[position2++] = ((recordId -= 96) & 31) + 96;
            target[position2++] = recordId >> 5;
          } else
            target[position2++] = recordId;
        } else {
          newRecord(transition, transition.__keys__ || Object.keys(object), newTransitions);
        }
        for (let key in object)
          if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
            pack2(object[key]);
          }
      };
      const checkUseRecords = typeof this.useRecords == "function" && this.useRecords;
      const writeObject = checkUseRecords ? (object) => {
        checkUseRecords(object) ? writeRecord(object) : writePlainObject(object);
      } : writeRecord;
      const makeRoom = (end) => {
        let newSize;
        if (end > 16777216) {
          if (end - start > MAX_BUFFER_SIZE)
            throw new Error("Packed buffer would be larger than maximum buffer size");
          newSize = Math.min(
            MAX_BUFFER_SIZE,
            Math.round(Math.max((end - start) * (end > 67108864 ? 1.25 : 2), 4194304) / 4096) * 4096
          );
        } else
          newSize = (Math.max(end - start << 2, target.length - 1) >> 12) + 1 << 12;
        let newBuffer = new ByteArrayAllocate(newSize);
        targetView = newBuffer.dataView || (newBuffer.dataView = new DataView(newBuffer.buffer, 0, newSize));
        end = Math.min(end, target.length);
        if (target.copy)
          target.copy(newBuffer, 0, start, end);
        else
          newBuffer.set(target.slice(start, end));
        position2 -= start;
        start = 0;
        safeEnd = newBuffer.length - 10;
        return target = newBuffer;
      };
      const newRecord = (transition, keys, newTransitions) => {
        let recordId = structures.nextId;
        if (!recordId)
          recordId = 64;
        if (recordId < sharedLimitId && this.shouldShareStructure && !this.shouldShareStructure(keys)) {
          recordId = structures.nextOwnId;
          if (!(recordId < maxStructureId))
            recordId = sharedLimitId;
          structures.nextOwnId = recordId + 1;
        } else {
          if (recordId >= maxStructureId)
            recordId = sharedLimitId;
          structures.nextId = recordId + 1;
        }
        let highByte = keys.highByte = recordId >= 96 && useTwoByteRecords ? recordId - 96 >> 5 : -1;
        transition[RECORD_SYMBOL] = recordId;
        transition.__keys__ = keys;
        structures[recordId - 64] = keys;
        if (recordId < sharedLimitId) {
          keys.isShared = true;
          structures.sharedLength = recordId - 63;
          hasSharedUpdate = true;
          if (highByte >= 0) {
            target[position2++] = (recordId & 31) + 96;
            target[position2++] = highByte;
          } else {
            target[position2++] = recordId;
          }
        } else {
          if (highByte >= 0) {
            target[position2++] = 213;
            target[position2++] = 114;
            target[position2++] = (recordId & 31) + 96;
            target[position2++] = highByte;
          } else {
            target[position2++] = 212;
            target[position2++] = 114;
            target[position2++] = recordId;
          }
          if (newTransitions)
            transitionsCount += serializationsSinceTransitionRebuild * newTransitions;
          if (recordIdsToRemove.length >= maxOwnStructures)
            recordIdsToRemove.shift()[RECORD_SYMBOL] = 0;
          recordIdsToRemove.push(transition);
          pack2(keys);
        }
      };
      const insertNewRecord = (transition, keys, insertionOffset, newTransitions) => {
        let mainTarget = target;
        let mainPosition = position2;
        let mainSafeEnd = safeEnd;
        let mainStart = start;
        target = keysTarget;
        position2 = 0;
        start = 0;
        if (!target)
          keysTarget = target = new ByteArrayAllocate(8192);
        safeEnd = target.length - 10;
        newRecord(transition, keys, newTransitions);
        keysTarget = target;
        let keysPosition = position2;
        target = mainTarget;
        position2 = mainPosition;
        safeEnd = mainSafeEnd;
        start = mainStart;
        if (keysPosition > 1) {
          let newEnd = position2 + keysPosition - 1;
          if (newEnd > safeEnd)
            makeRoom(newEnd);
          let insertionPosition = insertionOffset + start;
          target.copyWithin(insertionPosition + keysPosition, insertionPosition + 1, position2);
          target.set(keysTarget.slice(0, keysPosition), insertionPosition);
          position2 = newEnd;
        } else {
          target[insertionOffset + start] = keysTarget[0];
        }
      };
      const writeStruct = (object) => {
        let newPosition = writeStructSlots(object, target, start, position2, structures, makeRoom, (value, newPosition2, notifySharedUpdate) => {
          if (notifySharedUpdate)
            return hasSharedUpdate = true;
          position2 = newPosition2;
          let startTarget = target;
          pack2(value);
          resetStructures();
          if (startTarget !== target) {
            return { position: position2, targetView, target };
          }
          return position2;
        }, this);
        if (newPosition === 0)
          return writeObject(object);
        position2 = newPosition;
      };
    }
    useBuffer(buffer) {
      target = buffer;
      target.dataView || (target.dataView = new DataView(target.buffer, target.byteOffset, target.byteLength));
      targetView = target.dataView;
      position2 = 0;
    }
    set position(value) {
      position2 = value;
    }
    get position() {
      return position2;
    }
    clearSharedData() {
      if (this.structures)
        this.structures = [];
      if (this.typedStructs)
        this.typedStructs = [];
    }
  };
  extensionClasses = [Date, Set, Error, RegExp, ArrayBuffer, Object.getPrototypeOf(Uint8Array.prototype).constructor, DataView, C1Type];
  extensions = [{
    pack(date, allocateForWrite, pack2) {
      let seconds = date.getTime() / 1e3;
      if ((this.useTimestamp32 || date.getMilliseconds() === 0) && seconds >= 0 && seconds < 4294967296) {
        let { target: target2, targetView: targetView2, position: position3 } = allocateForWrite(6);
        target2[position3++] = 214;
        target2[position3++] = 255;
        targetView2.setUint32(position3, seconds);
      } else if (seconds > 0 && seconds < 4294967296) {
        let { target: target2, targetView: targetView2, position: position3 } = allocateForWrite(10);
        target2[position3++] = 215;
        target2[position3++] = 255;
        targetView2.setUint32(position3, date.getMilliseconds() * 4e6 + (seconds / 1e3 / 4294967296 >> 0));
        targetView2.setUint32(position3 + 4, seconds);
      } else if (isNaN(seconds)) {
        if (this.onInvalidDate) {
          allocateForWrite(0);
          return pack2(this.onInvalidDate());
        }
        let { target: target2, targetView: targetView2, position: position3 } = allocateForWrite(3);
        target2[position3++] = 212;
        target2[position3++] = 255;
        target2[position3++] = 255;
      } else {
        let { target: target2, targetView: targetView2, position: position3 } = allocateForWrite(15);
        target2[position3++] = 199;
        target2[position3++] = 12;
        target2[position3++] = 255;
        targetView2.setUint32(position3, date.getMilliseconds() * 1e6);
        targetView2.setBigInt64(position3 + 4, BigInt(Math.floor(seconds)));
      }
    }
  }, {
    pack(set, allocateForWrite, pack2) {
      if (this.setAsEmptyObject) {
        allocateForWrite(0);
        return pack2({});
      }
      let array = Array.from(set);
      let { target: target2, position: position3 } = allocateForWrite(this.moreTypes ? 3 : 0);
      if (this.moreTypes) {
        target2[position3++] = 212;
        target2[position3++] = 115;
        target2[position3++] = 0;
      }
      pack2(array);
    }
  }, {
    pack(error, allocateForWrite, pack2) {
      let { target: target2, position: position3 } = allocateForWrite(this.moreTypes ? 3 : 0);
      if (this.moreTypes) {
        target2[position3++] = 212;
        target2[position3++] = 101;
        target2[position3++] = 0;
      }
      pack2([error.name, error.message, error.cause]);
    }
  }, {
    pack(regex, allocateForWrite, pack2) {
      let { target: target2, position: position3 } = allocateForWrite(this.moreTypes ? 3 : 0);
      if (this.moreTypes) {
        target2[position3++] = 212;
        target2[position3++] = 120;
        target2[position3++] = 0;
      }
      pack2([regex.source, regex.flags]);
    }
  }, {
    pack(arrayBuffer, allocateForWrite) {
      if (this.moreTypes)
        writeExtBuffer(arrayBuffer, 16, allocateForWrite);
      else
        writeBuffer(hasNodeBuffer ? Buffer.from(arrayBuffer) : new Uint8Array(arrayBuffer), allocateForWrite);
    }
  }, {
    pack(typedArray, allocateForWrite) {
      let constructor = typedArray.constructor;
      if (constructor !== ByteArray && this.moreTypes)
        writeExtBuffer(typedArray, typedArrays.indexOf(constructor.name), allocateForWrite);
      else
        writeBuffer(typedArray, allocateForWrite);
    }
  }, {
    pack(arrayBuffer, allocateForWrite) {
      if (this.moreTypes)
        writeExtBuffer(arrayBuffer, 17, allocateForWrite);
      else
        writeBuffer(hasNodeBuffer ? Buffer.from(arrayBuffer) : new Uint8Array(arrayBuffer), allocateForWrite);
    }
  }, {
    pack(c1, allocateForWrite) {
      let { target: target2, position: position3 } = allocateForWrite(1);
      target2[position3] = 193;
    }
  }];
  function writeExtBuffer(typedArray, type, allocateForWrite, encode3) {
    let length = typedArray.byteLength;
    if (length + 1 < 256) {
      var { target: target2, position: position3 } = allocateForWrite(4 + length);
      target2[position3++] = 199;
      target2[position3++] = length + 1;
    } else if (length + 1 < 65536) {
      var { target: target2, position: position3 } = allocateForWrite(5 + length);
      target2[position3++] = 200;
      target2[position3++] = length + 1 >> 8;
      target2[position3++] = length + 1 & 255;
    } else {
      var { target: target2, position: position3, targetView: targetView2 } = allocateForWrite(7 + length);
      target2[position3++] = 201;
      targetView2.setUint32(position3, length + 1);
      position3 += 4;
    }
    target2[position3++] = 116;
    target2[position3++] = type;
    if (!typedArray.buffer) typedArray = new Uint8Array(typedArray);
    target2.set(new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength), position3);
  }
  function writeBuffer(buffer, allocateForWrite) {
    let length = buffer.byteLength;
    var target2, position3;
    if (length < 256) {
      var { target: target2, position: position3 } = allocateForWrite(length + 2);
      target2[position3++] = 196;
      target2[position3++] = length;
    } else if (length < 65536) {
      var { target: target2, position: position3 } = allocateForWrite(length + 3);
      target2[position3++] = 197;
      target2[position3++] = length >> 8;
      target2[position3++] = length & 255;
    } else {
      var { target: target2, position: position3, targetView: targetView2 } = allocateForWrite(length + 5);
      target2[position3++] = 198;
      targetView2.setUint32(position3, length);
      position3 += 4;
    }
    target2.set(buffer, position3);
  }
  function writeExtensionData(result, target2, position3, type) {
    let length = result.length;
    switch (length) {
      case 1:
        target2[position3++] = 212;
        break;
      case 2:
        target2[position3++] = 213;
        break;
      case 4:
        target2[position3++] = 214;
        break;
      case 8:
        target2[position3++] = 215;
        break;
      case 16:
        target2[position3++] = 216;
        break;
      default:
        if (length < 256) {
          target2[position3++] = 199;
          target2[position3++] = length;
        } else if (length < 65536) {
          target2[position3++] = 200;
          target2[position3++] = length >> 8;
          target2[position3++] = length & 255;
        } else {
          target2[position3++] = 201;
          target2[position3++] = length >> 24;
          target2[position3++] = length >> 16 & 255;
          target2[position3++] = length >> 8 & 255;
          target2[position3++] = length & 255;
        }
    }
    target2[position3++] = type;
    target2.set(result, position3);
    position3 += length;
    return position3;
  }
  function insertIds(serialized, idsToInsert) {
    let nextId;
    let distanceToMove = idsToInsert.length * 6;
    let lastEnd = serialized.length - distanceToMove;
    while (nextId = idsToInsert.pop()) {
      let offset = nextId.offset;
      let id = nextId.id;
      serialized.copyWithin(offset + distanceToMove, offset, lastEnd);
      distanceToMove -= 6;
      let position3 = offset + distanceToMove;
      serialized[position3++] = 214;
      serialized[position3++] = 105;
      serialized[position3++] = id >> 24;
      serialized[position3++] = id >> 16 & 255;
      serialized[position3++] = id >> 8 & 255;
      serialized[position3++] = id & 255;
      lastEnd = offset;
    }
    return serialized;
  }
  function writeBundles(start, pack2, incrementPosition) {
    if (bundledStrings2.length > 0) {
      targetView.setUint32(bundledStrings2.position + start, position2 + incrementPosition - bundledStrings2.position - start);
      bundledStrings2.stringsPosition = position2 - start;
      let writeStrings = bundledStrings2;
      bundledStrings2 = null;
      pack2(writeStrings[0]);
      pack2(writeStrings[1]);
    }
  }
  function prepareStructures(structures, packr) {
    structures.isCompatible = (existingStructures) => {
      let compatible = !existingStructures || (packr.lastNamedStructuresLength || 0) === existingStructures.length;
      if (!compatible)
        packr._mergeStructures(existingStructures);
      return compatible;
    };
    return structures;
  }
  var defaultPackr = new Packr({ useRecords: false });
  var pack = defaultPackr.pack;
  var encode = defaultPackr.pack;
  var { NEVER, ALWAYS, DECIMAL_ROUND, DECIMAL_FIT } = FLOAT32_OPTIONS;
  var REUSE_BUFFER_MODE = 512;
  var RESET_BUFFER_MODE = 1024;
  var RESERVE_START_SPACE = 2048;

  // src/transport/omp_opcodes.js
  var Op = Object.freeze({
    // Protocol control
    HELLO: 0,
    HELLO_ACK: 1,
    ACK: 2,
    NACK: 3,
    PING: 4,
    PONG: 5,
    ERROR: 6,
    FRAG_REQ: 7,
    DICT_HASH: 8,
    DICT_FETCH: 9,
    SYNC_HELLO: 10,
    TIME_SYNC: 11,
    TIME_SYNC_RESP: 12,
    SUBSCRIBE: 13,
    UNSUBSCRIBE: 14,
    PUSH: 15,
    // Comms (subset)
    INBOX_HEADERS: 16,
    MESSAGE_FETCH: 17,
    MESSAGE_SEND: 18,
    MESSAGE_MARK_READ: 19,
    BOARD_LIST: 25,
    NET_NODES: 32,
    // Knowledge
    LLM_QUERY: 48,
    LLM_TOKEN: 49,
    // Power & System
    POWER_NOW: 144,
    POWER_HISTORY: 145,
    SYS_STATUS: 160,
    SYS_PIN_VERIFY: 164
  });

  // src/transport/omp_codec.js
  var VERSION = 1;
  var SERVER_VERSION = 2;
  var HEADER_LEN = 4;
  async function encode2(op, msgId, payload, { version = VERSION, dictionary } = {}) {
    if (!(op >= 0 && op < 256)) throw new Error(`op out of range: ${op}`);
    if (!(msgId >= 0 && msgId < 65536)) throw new Error(`msg_id out of range: ${msgId}`);
    if (version !== VERSION) {
      throw new Error(
        `JS encode at v0x${version.toString(16)} not supported in Sprint 4 \u2014 see ADR-0010`
      );
    }
    if (dictionary) throw new Error("v0x01 does not support dictionaries");
    const body = pack(payload);
    const out = new Uint8Array(HEADER_LEN + body.byteLength);
    const view = new DataView(out.buffer);
    view.setUint8(0, version);
    view.setUint8(1, op);
    view.setUint16(2, msgId, false);
    out.set(body, HEADER_LEN);
    return out;
  }
  async function decode2(packet) {
    if (packet.byteLength < HEADER_LEN) throw new Error("packet too short");
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const ver = view.getUint8(0);
    if (ver === SERVER_VERSION) {
      throw new Error(
        "JS decoder received Brotli (v0x02) packet \u2014 Sprint 4 ships v0x01 only in the WiFi-served bundle. The Cardputer-served bundle will add v0x02 when the Cardputer firmware lands (~Sprint 11). See ADR-0010."
      );
    }
    if (ver !== VERSION) throw new Error(`unsupported OMP version 0x${ver.toString(16)}`);
    const op = view.getUint8(1);
    const msgId = view.getUint16(2, false);
    const body = new Uint8Array(packet.buffer, packet.byteOffset + HEADER_LEN, packet.byteLength - HEADER_LEN);
    const payload = unpack(body);
    return { op, msgId, payload };
  }

  // src/transport/omp.js
  var KIND2 = "mesh";
  var ROUTE_TO_OP = {
    "GET /api/c/inbox": Op.INBOX_HEADERS,
    "GET /api/c/net": Op.NET_NODES,
    "GET /api/p/now": Op.POWER_NOW,
    "GET /api/x/status": Op.SYS_STATUS,
    "POST /api/ping": Op.PING
  };
  var OmpTransport = class {
    constructor({ store: store2, bridgeUrl = "/omp", heartbeatMs = 5e3 } = {}) {
      this.store = store2;
      this.bridgeUrl = bridgeUrl;
      this.healthState = "offline";
      this.msgIdSeq = 1;
      this.cache = /* @__PURE__ */ new Map();
      this.subs = /* @__PURE__ */ new Map();
      this._healthRecoveredCbs = [];
      this._heartbeat(heartbeatMs);
    }
    kind() {
      return KIND2;
    }
    health() {
      return this.healthState;
    }
    onHealthRecovered(fn) {
      this._healthRecoveredCbs.push(fn);
      return () => {
        const i = this._healthRecoveredCbs.indexOf(fn);
        if (i >= 0) this._healthRecoveredCbs.splice(i, 1);
      };
    }
    /** request(method, path, body?, { cacheClass = "WARM" }) */
    async request(method, path, body, opts = {}) {
      const cls = opts.cacheClass || "WARM";
      const ttl = ttlFor(cls, KIND2);
      const cacheable = method === "GET" && ttl > 0 && ttl !== Infinity;
      if (cacheable) {
        const hit = this.cache.get(path);
        if (hit && Date.now() - hit.at < ttl) {
          return { ...hit.value, _cache: { age: Date.now() - hit.at, fresh: true } };
        }
      }
      const op = ROUTE_TO_OP[`${method} ${path}`];
      if (op === void 0) {
        throw new Error(`OmpTransport: no opcode mapping for ${method} ${path}`);
      }
      const value = await this._roundtrip(op, body || {});
      if (cacheable) this.cache.set(path, { value, at: Date.now() });
      return value;
    }
    /** subscribe(channel, onMessage) — poll-based for Sprint 2. */
    subscribe(channel, onMessage) {
      const cls = channelToCacheClass(channel);
      const interval = pollFor(cls, KIND2) || 3e4;
      const fetcher = channelToRefetch(channel);
      if (!fetcher) return () => {
      };
      const tick = async () => {
        try {
          const value = await this._roundtrip(fetcher.op, {});
          onMessage(value);
        } catch {
        }
      };
      const timer = setInterval(tick, interval);
      tick();
      this.subs.set(channel, { fn: onMessage, timer });
      return () => {
        clearInterval(timer);
        this.subs.delete(channel);
      };
    }
    // ---- internals --------------------------------------------------
    async _roundtrip(op, payload) {
      const msgId = this._nextMsgId();
      const pkt = await encode2(op, msgId, payload);
      let res;
      try {
        res = await fetch(this.bridgeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: pkt
        });
      } catch (e) {
        this._setHealth("offline");
        throw e;
      }
      if (!res.ok) {
        this._setHealth("degraded");
        throw new Error(`OMP bridge ${this.bridgeUrl} -> ${res.status}`);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const { op: respOp, msgId: respId, payload: respPayload } = await decode2(buf);
      if (respId !== msgId) {
        throw new Error(`OMP msg_id mismatch: req=${msgId} resp=${respId}`);
      }
      if (respOp === Op.ERROR) {
        this._setHealth("degraded");
        throw new Error(`OMP server error: ${respPayload.code} ${respPayload.msg}`);
      }
      this._setHealth("mesh");
      return respPayload;
    }
    _heartbeat(ms) {
      const tick = async () => {
        try {
          await this._roundtrip(Op.PING, {});
        } catch {
        }
      };
      if (typeof setInterval !== "undefined") setInterval(tick, ms);
      tick();
    }
    _setHealth(s) {
      const prev = this.healthState;
      if (prev === s) return;
      this.healthState = s;
      if (this.store) {
        const known = this.store.get("mesh")?.known ?? 1;
        const reachable = s === "mesh" ? known : 0;
        this.store.set({ mesh: { reachable, known } });
      }
      if (prev === "offline" && (s === "mesh" || s === "wifi")) {
        for (const fn of this._healthRecoveredCbs) {
          try {
            fn();
          } catch {
          }
        }
      }
    }
    _nextMsgId() {
      const id = this.msgIdSeq;
      this.msgIdSeq = this.msgIdSeq + 1 & 65535;
      if (this.msgIdSeq === 0) this.msgIdSeq = 1;
      return id;
    }
  };
  function channelToCacheClass(channel) {
    if (channel === "comms.inbox" || channel === "comms.delivery") return "WARM";
    if (channel === "power.now") return "HOT";
    return "WARM";
  }
  function channelToRefetch(channel) {
    if (channel === "comms.inbox") return { op: Op.INBOX_HEADERS };
    if (channel === "comms.net") return { op: Op.NET_NODES };
    if (channel === "power.now") return { op: Op.POWER_NOW };
    return null;
  }

  // src/transport/transport.js
  function detectTransport() {
    if (typeof window === "undefined") return "wifi";
    const url = new URL(window.location.href);
    const forced = url.searchParams.get("transport");
    if (forced === "mesh" || forced === "wifi") return forced;
    return "wifi";
  }
  function makeTransport({ store: store2, kind = detectTransport() } = {}) {
    return kind === "mesh" ? new OmpTransport({ store: store2 }) : new HttpTransport({ store: store2 });
  }

  // src/transport/idb_outbox.js
  var DB_NAME = "overseer";
  var STORE_NAME = "outbox";
  var VERSION2 = 1;
  var _dbPromise = null;
  function _hasIDB() {
    return typeof indexedDB !== "undefined";
  }
  function _openDB() {
    if (_dbPromise) return _dbPromise;
    if (!_hasIDB()) return null;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store2 = db.createObjectStore(STORE_NAME, { keyPath: "key", autoIncrement: true });
          store2.createIndex("queuedAt", "queuedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }
  var _mem = /* @__PURE__ */ new Map();
  var _memSeq = 0;
  async function _txn(mode) {
    const db = await _openDB();
    if (!db) return null;
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }
  async function append(entry) {
    const store2 = await _txn("readwrite");
    if (!store2) {
      const key = ++_memSeq;
      _mem.set(key, { ...entry, key });
      return key;
    }
    return new Promise((resolve, reject) => {
      const req = store2.add(entry);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function readAll() {
    const store2 = await _txn("readonly");
    if (!store2) return [..._mem.values()].sort((a, b) => a.key - b.key);
    return new Promise((resolve, reject) => {
      const req = store2.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function remove(key) {
    const store2 = await _txn("readwrite");
    if (!store2) {
      _mem.delete(key);
      return;
    }
    return new Promise((resolve, reject) => {
      const req = store2.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  async function count() {
    const store2 = await _txn("readonly");
    if (!store2) return _mem.size;
    return new Promise((resolve, reject) => {
      const req = store2.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function pruneOlderThan(cutoffMs) {
    const store2 = await _txn("readwrite");
    if (!store2) {
      let n = 0;
      for (const [k, v] of _mem) if (v.queuedAt < cutoffMs) {
        _mem.delete(k);
        n++;
      }
      return n;
    }
    return new Promise((resolve, reject) => {
      let n = 0;
      const idx = store2.index("queuedAt");
      const range = IDBKeyRange.upperBound(cutoffMs, true);
      const req = idx.openCursor(range);
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          cur.delete();
          n++;
          cur.continue();
        } else {
          resolve(n);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }
  async function clearForTests() {
    const store2 = await _txn("readwrite");
    if (!store2) {
      _mem.clear();
      _memSeq = 0;
      return;
    }
    return new Promise((resolve, reject) => {
      const req = store2.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // src/transport/queue.js
  var DEFAULT_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
  var ActionQueue = class {
    constructor({ store: store2, pruneAgeMs = DEFAULT_PRUNE_AGE_MS } = {}) {
      this.store = store2;
      this.pruneAgeMs = pruneAgeMs;
      this._publishCount();
      this.prune().catch(() => {
      });
    }
    async enqueue({ optimistic, request }) {
      if (!request || !request.method || !request.path) {
        throw new Error("ActionQueue.enqueue: action.request {method, path} required");
      }
      const queuedAt = Date.now();
      await append({ optimistic: optimistic || null, request, queuedAt });
      await this._publishCount();
    }
    /** Replay queued requests via the transport, FIFO. Stops on first
     *  failure leaving the head intact for the next drain attempt. */
    async drain(transport2) {
      const all = await readAll();
      for (const entry of all) {
        try {
          await transport2.request(
            entry.request.method,
            entry.request.path,
            entry.request.body,
            entry.request.options
          );
          await remove(entry.key);
        } catch {
          await this._publishCount();
          return false;
        }
      }
      await this._publishCount();
      return true;
    }
    async size() {
      return count();
    }
    async clear() {
      await clearForTests();
      await this._publishCount();
    }
    /** Prune entries older than pruneAgeMs (default 7 d). */
    async prune() {
      const cutoff = Date.now() - this.pruneAgeMs;
      const n = await pruneOlderThan(cutoff);
      await this._publishCount();
      return n;
    }
    async _publishCount() {
      if (this.store) {
        const n = await count();
        this.store.set({ outboxCount: n });
      }
    }
  };

  // src/transport/dispatcher.js
  function makeDispatcher({ store: store2, transport: transport2, queue: queue2 }) {
    transport2.onHealthRecovered?.(async () => {
      try {
        await queue2.drain(transport2);
      } catch (e) {
        console.warn("[dispatch] drain failed:", e);
      }
    });
    return async function dispatch2(action) {
      if (action.optimistic) store2.set(action.optimistic);
      if (transport2.health() === "offline") {
        await queue2.enqueue({
          optimistic: action.optimistic,
          request: action.request
        });
        return;
      }
      try {
        const result = await transport2.request(
          action.request.method,
          action.request.path,
          action.request.body,
          action.request.options
        );
        if (action.reconcile) store2.set(action.reconcile(result));
        return result;
      } catch (err) {
        if (action.rollback) store2.set(action.rollback);
        throw err;
      }
    };
  }

  // src/modules/home.js
  function mountHome(root, store2) {
    const screen = el("div", "screen-home home");
    const top = el("div", "home-top");
    const titleCol = el("div");
    const logo = el("div", "logo");
    logo.innerHTML = `<span class="accent">\u2554\u2550\u2557 \u2566  \u2566 \u2554\u2550\u2557 \u2566\u2550\u2557 \u2554\u2550\u2557 \u2554\u2550\u2557 \u2554\u2550\u2557 \u2554\u2550\u2557</span>
<span class="accent">\u2551 \u2551 \u255A\u2557\u2554\u255D \u2551\u2563  \u2560\u2566\u255D \u255A\u2550\u2557 \u2551\u2563  \u2551\u2563  \u2560\u2566\u255D</span>
<span class="accent">\u255A\u2550\u255D  \u255A\u255D  \u255A\u2550\u255D \u2569\u255A\u2550 \u255A\u2550\u255D \u255A\u2550\u255D \u255A\u2550\u255D \u2569\u255A\u2550</span>`;
    const tagline = el(
      "div",
      "tagline",
      txt("offline vault \xB7 essential records \xB7 survival, emergency & endurance response")
    );
    const flavor = el("div", "flavor");
    const flavorRows = [
      ["UPTIME", "17d 04h 22m"],
      ["BATTERY", "82% \xB7 14d 02h", "warn"],
      ["ARCHIVE", "READY \xB7 12 vols"],
      ["MESH", "3 nodes seen", "cool"],
      ["LAST QUERY", "02:14 ago"],
      ["WEATHER", "overcast \xB7 11\xB0C"]
    ];
    for (const [k, v, cls] of flavorRows) {
      const row = el("div", "row");
      row.append(el("span", "k", txt(k)), el("span", "v" + (cls ? " " + cls : ""), txt(v)));
      flavor.appendChild(row);
    }
    titleCol.append(logo, tagline, flavor);
    top.appendChild(titleCol);
    const side = el("div", "side-stack hide-on-phone");
    side.append(
      panel("UNREAD MAIL", "3", unreadList()),
      panel("ONE-LINER OF THE DAY", null, oneliner()),
      panel("POWER \xB7 24H", null, sparklineRow())
    );
    top.appendChild(side);
    screen.appendChild(top);
    const menuWrap = el("div");
    menuWrap.append(menuSection("PRIMARY MODULES", MODULES.filter((m) => m.category === "primary")));
    menuWrap.append(menuSection("SECONDARY MODULES", MODULES.filter((m) => m.category === "secondary")));
    screen.appendChild(menuWrap);
    const prompt = el("div", "prompt");
    const sigil = el("span", "sigil", txt(">_"));
    const input = el("span", "input", txt("_"));
    input.appendChild(el("span", "cursor"));
    const promptHint = el(
      "span",
      "prompt-hint",
      txt("[ press a letter, or ")
    );
    promptHint.appendChild(el("span", "prompt-amber", txt(":")));
    promptHint.appendChild(txt(" for palette ]"));
    prompt.append(sigil, input, promptHint);
    screen.appendChild(prompt);
    const active = (store2.get("module") || "HOME").toUpperCase();
    for (const item of screen.querySelectorAll(".menu-item")) {
      item.classList.toggle("active", item.dataset.name === active);
    }
    root.replaceChildren(screen);
    return void 0;
  }
  function menuSection(title, mods) {
    const wrap = el("div");
    wrap.appendChild(el("div", "menu-section-title", txt(title)));
    const grid = el("div", "menu");
    for (const m of mods) grid.appendChild(menuItem(m));
    wrap.appendChild(grid);
    return wrap;
  }
  function menuItem(m) {
    const wrap = el("div", "menu-item");
    wrap.dataset.hotkey = m.hotkey;
    wrap.dataset.name = m.name;
    wrap.dataset.id = m.id;
    wrap.append(
      el("span", "key", txt(m.hotkey)),
      el("span", "label", txt(m.name)),
      el("span", "desc", txt(m.desc)),
      el("span", "pip" + (m.pipClass ? " " + m.pipClass : ""), txt(m.pip))
    );
    return wrap;
  }
  function panel(title, badge, body) {
    const p = el("div", "panel");
    const t = el("div", "panel-title", txt(title));
    if (badge) t.appendChild(el("span", "badge", txt(badge)));
    p.append(t, body);
    return p;
  }
  function unreadList() {
    const list = el("div", "unread-list");
    const seed = [
      ["BRAVO-2", "Re: rendezvous shift \u2014 copy that", "14m"],
      ["CHARLIE-7", "Cache-7 inventory update", "02h"],
      ["ECHO-3", "[BOARD/INTEL] vehicle traffic NW", "06h"]
    ];
    for (const [from, subj, when] of seed) {
      const row = el("div", "msg");
      row.append(
        el("span", "from", txt(from)),
        el("span", "subj", txt(subj)),
        el("span", "when", txt(when))
      );
      list.appendChild(row);
    }
    return list;
  }
  function oneliner() {
    const o = el("div", "oneliner");
    o.appendChild(txt("\u201CIf you do not change direction, you may end up where you are heading.\u201D"));
    o.appendChild(el("span", "who", txt("\u2014 LAO TZU \xB7 posted by DELTA-4")));
    return o;
  }
  function sparklineRow() {
    const row = el("div", "tiny-spark");
    row.innerHTML = `<span class="lo">\u2581\u2581\u2582\u2582\u2582\u2583\u2583</span><span>\u2584\u2584\u2585\u2585\u2585\u2585\u2586</span><span class="hi">\u2586\u2587\u2588\u2587\u2586\u2585\u2584</span><span>\u2584\u2583\u2583\u2583\u2582\u2582\u2582</span>`;
    const sub = el("div", "spark-sub", txt("avg 4.2W \xB7 peak 11.6W \xB7 trough 2.1W"));
    const wrap = el("div");
    wrap.append(row, sub);
    return wrap;
  }

  // src/components/dom.js
  function el2(tag, cls, ...kids) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const k of kids) {
      if (k == null) continue;
      n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    }
    return n;
  }

  // src/components/tile.js
  function tileEl(title, { meta } = {}) {
    const wrap = el2("div", "tile");
    const head = el2("div", "tile-title", title);
    if (meta) head.appendChild(el2("span", "meta", meta));
    wrap.appendChild(head);
    return wrap;
  }
  function bignumEl(value, unit, { variant = "" } = {}) {
    const wrap = el2("div", "bignum" + (variant ? " " + variant : ""), String(value));
    if (unit) wrap.appendChild(el2("span", "unit", unit));
    return wrap;
  }
  function kvGridEl(rows) {
    const grid = el2("div", "kv-grid");
    for (const [k, v] of rows) {
      grid.appendChild(el2("span", "k", k));
      grid.appendChild(el2("span", "v", v));
    }
    return grid;
  }

  // src/components/bar.js
  function barEl(label, pct, { variant = "" } = {}) {
    const clamped = Math.max(0, Math.min(100, pct));
    const bar = el2("div", "bar" + (variant ? " " + variant : ""));
    bar.appendChild(el2("span", "lab", label));
    const track = el2("div", "track");
    const fill = el2("div", "fill");
    fill.style.width = clamped + "%";
    track.appendChild(fill);
    bar.appendChild(track);
    bar.appendChild(el2("span", "pct", Math.round(clamped) + "%"));
    return bar;
  }

  // src/components/sparkline.js
  var BLOCKS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
  function sparklineEl(values, opts = {}) {
    const wrap = el2("div", "spark");
    if (!values || values.length === 0) return wrap;
    const lo = opts.min !== void 0 ? opts.min : Math.min(...values);
    const hi = opts.max !== void 0 ? opts.max : Math.max(...values);
    const span = Math.max(1e-9, hi - lo);
    const QUARTILES = ["a", "b", "c", "d"];
    let group = "", glyphs = "";
    for (const v of values) {
      const norm = (v - lo) / span;
      const q = QUARTILES[Math.min(3, Math.floor(norm * 4))];
      const idx = Math.max(0, Math.min(
        BLOCKS.length - 1,
        Math.round(norm * (BLOCKS.length - 1))
      ));
      const ch = BLOCKS[idx];
      if (q === group) {
        glyphs += ch;
      } else {
        if (group) wrap.appendChild(el2("span", group, glyphs));
        group = q;
        glyphs = ch;
      }
    }
    if (glyphs) wrap.appendChild(el2("span", group, glyphs));
    return wrap;
  }

  // src/modules/power.js
  var POLL_MS = 3e4;
  var LIVE_CHANNEL = "power.now";
  var HISTORY_LEN = 32;
  function mountPower(root, store2, ctx2) {
    const screen = el("div", "screen-power power");
    const tiles = {
      battery: tileEl("BATTERY", { meta: "jackery 2000Wh" }),
      load: tileEl("LOAD", { meta: "RK3588 \xB7 8 cores" }),
      radio: tileEl("RADIO", { meta: "3 transports" }),
      storage: tileEl("STORAGE", { meta: "1 TB nvme" })
    };
    Object.values(tiles).forEach((t) => screen.appendChild(t));
    root.replaceChildren(screen);
    const ring = [];
    function repaintBattery(s) {
      const body = el("div", "tile-body");
      const row = el("div", "row-flex");
      row.appendChild(bignumEl(Math.round(s.batt_pct), "%", { variant: powerVariant(s.batt_pct) }));
      const right = el("div", "right");
      right.appendChild(el("div", "k-tiny", txt("EST RUNTIME")));
      right.appendChild(el("div", "v-big", txt(formatRuntime(s.runtime_est_s))));
      row.appendChild(right);
      body.appendChild(row);
      body.appendChild(barEl("CHG", s.batt_pct, { variant: powerVariant(s.batt_pct) }));
      body.appendChild(kvGridEl([
        ["DRAW", `${s.draw_w} W avg \xB7 ${s.draw_w_peak} W peak`],
        ["INPUT", s.input_w > 0 ? `${s.input_w} W \u2014 solar` : "0 W \u2014 solar disconnected"],
        ["CYCLES", `${s.cycles} \xB7 health ${s.health_pct}%`],
        ["TEMP", `${s.temp_c} \xB0C`]
      ]));
      if (ring.length > 1) {
        body.appendChild(sparklineEl(ring.map((x) => x.draw_w)));
        body.appendChild(el("div", "spark-sub", txt(`draw \xB7 last ${ring.length} samples \xB7 ${POLL_MS / 1e3}s buckets`)));
      }
      swapBody(tiles.battery, body);
    }
    function repaintLoad(s) {
      const body = el("div", "tile-body");
      const row = el("div", "row-flex");
      row.appendChild(bignumEl(Math.round(s.cpu), "% CPU"));
      const right = el("div", "right");
      right.appendChild(el("div", "k-tiny", txt("RAM USED")));
      right.appendChild(el("div", "v-big", txt(`${s.ram_used_gb} / ${s.ram_total_gb} GB`)));
      row.appendChild(right);
      body.appendChild(row);
      body.appendChild(barEl("CPU", s.cpu));
      body.appendChild(barEl("RAM", s.ram));
      body.appendChild(barEl("SWAP", s.swap));
      body.appendChild(kvGridEl([
        ["CORES", "4\xD7A76 + 4\xD7A55"],
        ["TEMP", `${s.temp_c}\xB0C \xB7 fan ${s.fan} rpm`],
        ["FREQ", "408 MHz idle \xB7 2.4 GHz turbo"]
      ]));
      swapBody(tiles.load, body);
    }
    function repaintRadio(radio) {
      const body = el("div", "tile-body");
      body.appendChild(kvGridEl([
        ["WiFi", `${radio.wifi.ssid} \xB7 ${radio.wifi.rssi_db}dB \xB7 ${radio.wifi.clients} clients`],
        ["LoRa", `${radio.lora.freq_mhz} MHz \xB7 ${radio.lora.state} \xB7 ${radio.lora.pkts_per_h} pkts/h`],
        ["SDR", `${radio.sdr.kind} \xB7 ${radio.sdr.state} \xB7 ${radio.sdr.jobs} jobs queued`],
        ["BT", radio.bt.state === "disabled" ? `disabled (${radio.bt.reason})` : `${radio.bt.state}`]
      ]));
      swapBody(tiles.radio, body);
    }
    function repaintStorage(storage) {
      const body = el("div", "tile-body");
      const pct = Math.round(storage.used_gb / storage.total_gb * 100);
      const row = el("div", "row-flex");
      row.appendChild(bignumEl(pct, "% used"));
      const right = el("div", "right");
      right.appendChild(el("div", "k-tiny", txt("USED / TOTAL")));
      right.appendChild(el("div", "v-big", txt(`${storage.used_gb} / ${storage.total_gb} GB`)));
      row.appendChild(right);
      body.appendChild(row);
      body.appendChild(barEl("DISK", pct));
      body.appendChild(kvGridEl([
        ["ARCHIVES", `${storage.breakdown.archives_gb} GB`],
        ["MODELS", `${storage.breakdown.models_gb} GB`],
        ["SYSTEM", `${storage.breakdown.system_gb} GB`],
        ["SMART", storage.smart_status]
      ]));
      swapBody(tiles.storage, body);
    }
    let timer = null;
    let active = true;
    async function pull() {
      if (!active) return;
      try {
        const sample = await ctx2.transport.request("GET", "/api/p/now", void 0, { cacheClass: "HOT" });
        ring.push(sample);
        if (ring.length > HISTORY_LEN) ring.shift();
        repaintBattery(sample);
        repaintLoad(sample);
      } catch (e) {
        console.warn("[power] /api/p/now failed:", e.message);
      }
    }
    async function pullStatic() {
      try {
        const [radio, storage] = await Promise.all([
          ctx2.transport.request("GET", "/api/p/radio", void 0, { cacheClass: "STABLE" }),
          ctx2.transport.request("GET", "/api/p/storage", void 0, { cacheClass: "STABLE" })
        ]);
        repaintRadio(radio);
        repaintStorage(storage);
      } catch (e) {
        console.warn("[power] static fetch failed:", e.message);
      }
    }
    pull();
    pullStatic();
    let unsubscribeLive = () => {
    };
    try {
      unsubscribeLive = ctx2.transport.subscribe(LIVE_CHANNEL, (sample) => {
        ring.push(sample);
        if (ring.length > HISTORY_LEN) ring.shift();
        repaintBattery(sample);
        repaintLoad(sample);
      });
    } catch (e) {
      timer = setInterval(pull, POLL_MS);
    }
    return function unmount() {
      active = false;
      try {
        unsubscribeLive();
      } catch {
      }
      if (timer) clearInterval(timer);
    };
  }
  function powerVariant(pct) {
    return pct < 15 ? "alert" : pct < 30 ? "warn" : "";
  }
  function formatRuntime(s) {
    if (!isFinite(s) || s > 60 * 86400) return "indefinite (charging)";
    const d = Math.floor(s / 86400);
    const h = Math.floor(s % 86400 / 3600);
    const m = Math.floor(s % 3600 / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
  }
  function swapBody(tile, body) {
    const head = tile.firstChild;
    tile.replaceChildren(head, body);
  }

  // src/modules/knowledge.js
  var SUB_HOTKEYS = { C: "chat", L: "library", B: "branches" };
  var local = {
    sessionId: null,
    sub: "chat",
    history: [],
    // [{role, content, citations?}, ...]
    archives: null,
    articles: {},
    // archive -> [{id,title}]
    selected: { archive: null, article: null, preview: null },
    branches: null
  };
  function mountKnowledge(root, store2, ctx2) {
    const screen = el("div", "screen-knowledge knowledge");
    root.replaceChildren(screen);
    const tabbar = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabbar, body);
    function paint() {
      tabbar.replaceChildren(...["chat", "library", "branches"].map((s) => {
        const tab = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
        tab.append(el("span", "k", s[0].toUpperCase()), el("span", "l", s));
        tab.addEventListener("click", () => {
          local.sub = s;
          paint();
        });
        return tab;
      }));
      if (local.sub === "chat") paintChat(body, ctx2);
      if (local.sub === "library") paintLibrary(body, ctx2);
      if (local.sub === "branches") paintBranches(body, ctx2);
    }
    function onKey(e) {
      if (e.target && e.target.tagName === "INPUT" && document.activeElement === e.target) return;
      if (!SUB_HOTKEYS[e.key]) return;
      local.sub = SUB_HOTKEYS[e.key];
      e.preventDefault();
      paint();
    }
    document.addEventListener("keydown", onKey, true);
    paint();
    return function unmount() {
      document.removeEventListener("keydown", onKey, true);
    };
  }
  async function paintChat(body, ctx2) {
    body.replaceChildren();
    const log = el("div", "kb-log");
    body.appendChild(log);
    for (const t of local.history) renderTurn(log, t, ctx2);
    log.scrollTop = log.scrollHeight;
    const inputRow = el("div", "kb-input");
    const sigil = el("span", "sigil", txt(">"));
    const field = el("input", "field");
    field.type = "text";
    field.placeholder = "ask \xB7 or /branch /cite N /save name";
    field.autofocus = true;
    field.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const q = field.value.trim();
      if (!q) return;
      field.value = "";
      await handleInput(q, log, ctx2);
    });
    inputRow.append(sigil, field);
    body.appendChild(inputRow);
    setTimeout(() => field.focus(), 0);
  }
  async function handleInput(text, log, ctx2) {
    if (text.startsWith("/")) {
      const [cmd, ...rest] = text.slice(1).split(" ");
      if (cmd === "branch") {
        await branchCurrent(log, ctx2);
        return;
      }
      if (cmd === "cite") {
        const idx = parseInt(rest[0] || "1", 10) - 1;
        const lastCited = [...local.history].reverse().find((t) => t.citations && t.citations.length);
        if (lastCited && lastCited.citations[idx]) {
          openCitation(lastCited.citations[idx]);
        }
        return;
      }
      if (cmd === "forget") {
        local.history = [];
        local.sessionId = null;
        return paintChat(document.querySelector(".kb-body"), ctx2);
      }
      appendTurn(log, "system", `[unknown command: /${cmd}]`);
      return;
    }
    const userTurn = { role: "user", content: text };
    local.history.push(userTurn);
    renderTurn(log, userTurn, ctx2);
    const overseer = { role: "overseer", content: "", citations: [] };
    local.history.push(overseer);
    const turnEl = renderTurn(log, overseer, ctx2);
    log.scrollTop = log.scrollHeight;
    try {
      const res = await fetch("/api/k/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, session_id: local.sessionId })
      });
      if (!res.ok) throw new Error(`/api/k/query \u2192 ${res.status}`);
      const all = await res.text();
      for (const line of all.split("\n")) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.session_id) local.sessionId = chunk.session_id;
        if (chunk.tokens) overseer.content += chunk.tokens;
        if (chunk.citations) overseer.citations = chunk.citations;
        turnEl.replaceWith(renderTurn(null, overseer, ctx2, turnEl));
        log.scrollTop = log.scrollHeight;
      }
    } catch (e) {
      overseer.content += `
[error: ${e.message}]`;
      turnEl.replaceWith(renderTurn(null, overseer, ctx2));
    }
  }
  function renderTurn(log, turn, ctx2, replaceTarget) {
    const wrap = el("div", "kb-turn kb-turn-" + turn.role);
    const sigil = turn.role === "user" ? "> " : turn.role === "overseer" ? "[OVERSEER] " : "[!] ";
    wrap.appendChild(el("span", "kb-sigil", txt(sigil)));
    const body = el("span", "kb-body-text");
    const citations = turn.citations || [];
    const re = /\[(\d+)\]/g;
    let last = 0, m;
    const text = turn.content;
    while (m = re.exec(text)) {
      if (m.index > last) body.appendChild(txt(text.slice(last, m.index)));
      const idx = parseInt(m[1], 10) - 1;
      const link = el("span", "kb-cite", txt(`[${m[1]}]`));
      if (citations[idx]) {
        link.addEventListener("click", () => openCitation(citations[idx]));
        link.title = `${citations[idx].archive} \xB7 ${citations[idx].article} \xB7 \xB6${citations[idx].paragraph}`;
      }
      body.appendChild(link);
      last = m.index + m[0].length;
    }
    if (last < text.length) body.appendChild(txt(text.slice(last)));
    wrap.appendChild(body);
    if (log) log.appendChild(wrap);
    return wrap;
  }
  function appendTurn(log, role, content2) {
    local.history.push({ role, content: content2 });
    renderTurn(log, { role, content: content2 }, null);
    log.scrollTop = log.scrollHeight;
  }
  async function branchCurrent(log, ctx2) {
    if (!local.sessionId) {
      appendTurn(log, "system", "[no active session to branch from \u2014 ask a question first]");
      return;
    }
    try {
      const r = await fetch(`/api/k/session/${local.sessionId}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const j = await r.json();
      appendTurn(log, "system", `[branched session ${local.sessionId} \u2192 ${j.id}]`);
      local.sessionId = j.id;
    } catch (e) {
      appendTurn(log, "system", `[branch failed: ${e.message}]`);
    }
  }
  function openCitation(c) {
    local.sub = "library";
    local.selected.archive = c.archive;
    local.selected.article = c.article;
    local.selected.previewParagraph = c.paragraph;
    const lib = document.querySelector(".kb-tab.l, .kb-tab:nth-child(2)");
    if (lib) lib.click();
    else {
      const allTabs = document.querySelectorAll(".kb-tab");
      if (allTabs[1]) allTabs[1].click();
    }
  }
  async function paintLibrary(body, ctx2) {
    body.replaceChildren();
    const cols = el("div", "kb-miller");
    const archCol = el("div", "kb-col");
    const artCol = el("div", "kb-col");
    const prevCol = el("div", "kb-col kb-preview");
    cols.append(archCol, artCol, prevCol);
    body.appendChild(cols);
    archCol.appendChild(el("div", "kb-col-title", txt("ARCHIVES")));
    artCol.appendChild(el("div", "kb-col-title", txt("ARTICLES")));
    prevCol.appendChild(el("div", "kb-col-title", txt("PREVIEW")));
    if (!local.archives) {
      try {
        const r = await fetch("/api/k/library/archives");
        local.archives = await r.json();
      } catch {
        local.archives = [];
      }
    }
    for (const a of local.archives) {
      const row = el("div", "kb-item" + (local.selected.archive === a.key ? " active" : ""));
      row.append(
        el("span", "kb-name", txt(a.label)),
        el("span", "kb-meta", txt(`${a.articles} \xB7 ${a.size_gb}GB`))
      );
      row.addEventListener("click", async () => {
        local.selected.archive = a.key;
        local.selected.article = null;
        local.selected.preview = null;
        try {
          const r = await fetch(`/api/k/library/articles?archive=${encodeURIComponent(a.key)}`);
          local.articles[a.key] = await r.json();
        } catch {
          local.articles[a.key] = [];
        }
        paintLibrary(body, ctx2);
      });
      archCol.appendChild(row);
    }
    if (local.selected.archive) {
      const arts = local.articles[local.selected.archive] || [];
      for (const art of arts) {
        const row = el("div", "kb-item" + (local.selected.article === art.id ? " active" : ""));
        row.append(el("span", "kb-name", txt(art.title)));
        row.addEventListener("click", async () => {
          local.selected.article = art.id;
          try {
            const r = await fetch(`/api/k/library/article?archive=${encodeURIComponent(local.selected.archive)}&id=${encodeURIComponent(art.id)}`);
            local.selected.preview = await r.json();
          } catch {
            local.selected.preview = { error: "fetch failed" };
          }
          paintLibrary(body, ctx2);
        });
        artCol.appendChild(row);
      }
    }
    if (local.selected.preview) {
      const p = local.selected.preview;
      if (p.error) {
        prevCol.appendChild(el("div", "kb-error", txt(p.error)));
      } else {
        prevCol.appendChild(el("h3", "kb-preview-title", txt(p.title)));
        const focused = local.selected.previewParagraph;
        (p.paragraphs || []).forEach((para, i) => {
          const cls = "kb-para" + (focused === i ? " focused" : "");
          prevCol.appendChild(el("p", cls, txt(`\xB6${i + 1}  ${para}`)));
        });
        if (focused !== void 0 && focused !== null) {
          setTimeout(() => {
            const focusedEl = prevCol.querySelector(".kb-para.focused");
            if (focusedEl) focusedEl.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 0);
        }
      }
    } else if (local.selected.archive) {
      prevCol.appendChild(el("div", "kb-empty", txt("select an article \u2192")));
    } else {
      prevCol.appendChild(el("div", "kb-empty", txt("\u2190 select an archive")));
    }
  }
  async function paintBranches(body, ctx2) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("CONVERSATION TREE")));
    const tree = el("pre", "kb-tree");
    body.appendChild(tree);
    try {
      let walk = function(node, depth) {
        const pad = "  ".repeat(depth);
        const star = node.pinned ? "\u2605 " : "  ";
        const active = local.sessionId === node.id ? "\u25CF " : "  ";
        lines.push(`${pad}${active}${star}#${node.id}  ${node.name}  (${node.turns_count} turns)`);
        for (const c of node.children) walk(c, depth + 1);
      };
      const r = await fetch("/api/k/branches");
      const data = await r.json();
      if (!data.roots || data.roots.length === 0) {
        tree.textContent = "(no sessions yet \u2014 start a chat in the C tab)";
        return;
      }
      let lines = [];
      for (const r2 of data.roots) walk(r2, 0);
      tree.textContent = lines.join("\n");
    } catch (e) {
      tree.textContent = `[error: ${e.message}]`;
    }
  }

  // src/modules/comms.js
  var ME = "ALPHA-1";
  var PEER = "BRAVO-2";
  var SUBS = { M: "mail", B: "boards", N: "net" };
  var FOLDERS = ["INBOX", "SENT", "DRAFTS", "ARCHIVE", "OUTBOX"];
  var local2 = {
    sub: "mail",
    registered: false,
    folder: "INBOX",
    selected: null,
    inbox: [],
    sent: [],
    composing: false,
    draft: { to: PEER, subj: "", body: "" },
    boards: [],
    boardPosts: {},
    selectedBoard: null,
    net: []
  };
  function mountComms(root, store2, ctx2) {
    const screen = el("div", "screen-comms comms");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      tabs.replaceChildren(...["mail", "boards", "net"].map((s, i) => {
        const t = el("span", "kb-tab" + (local2.sub === s ? " active" : ""));
        t.append(el("span", "k", "MBN"[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local2.sub = s;
          paint();
        });
        return t;
      }));
      if (local2.sub === "mail") paintMail(body);
      if (local2.sub === "boards") paintBoards(body);
      if (local2.sub === "net") paintNet(body);
    }
    function onKey(e) {
      if (e.target && e.target.tagName === "INPUT") return;
      if (e.target && e.target.tagName === "TEXTAREA") return;
      if (!SUBS[e.key]) return;
      local2.sub = SUBS[e.key];
      e.preventDefault();
      paint();
    }
    document.addEventListener("keydown", onKey, true);
    bootstrap().then(paint);
    return function unmount() {
      document.removeEventListener("keydown", onKey, true);
    };
  }
  async function bootstrap() {
    if (local2.registered) return;
    try {
      await fetch("/api/c/contacts/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callsign: ME })
      });
      await fetch("/api/c/contacts/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callsign: PEER })
      });
      local2.registered = true;
    } catch (e) {
      console.warn("[comms] register failed:", e.message);
    }
    await refresh();
  }
  async function refresh() {
    try {
      const inbox = await (await fetch(`/api/c/inbox/${ME}`)).json();
      local2.inbox = inbox || [];
    } catch {
      local2.inbox = [];
    }
    try {
      const sent = await (await fetch(`/api/c/sent/${ME}`)).json();
      local2.sent = sent || [];
    } catch {
      local2.sent = [];
    }
  }
  function paintMail(body) {
    body.replaceChildren();
    const grid = el("div", "comms-grid");
    body.appendChild(grid);
    const fpane = el("div", "kb-col comms-folders");
    fpane.appendChild(el("div", "kb-col-title", txt("FOLDERS")));
    for (const f of FOLDERS) {
      const counts = f === "INBOX" ? local2.inbox.length : f === "SENT" ? local2.sent.length : 0;
      const row = el("div", "comms-folder" + (local2.folder === f ? " sel" : ""));
      row.append(
        el("span", "fname", txt(f)),
        el("span", "fct", txt(String(counts)))
      );
      row.addEventListener("click", () => {
        local2.folder = f;
        local2.selected = null;
        paintMail(body);
      });
      fpane.appendChild(row);
    }
    grid.appendChild(fpane);
    const mpane = el("div", "kb-col comms-msglist");
    const messages = local2.folder === "INBOX" ? local2.inbox : local2.folder === "SENT" ? local2.sent : [];
    mpane.appendChild(el("div", "kb-col-title", txt(local2.folder + ` \xB7 ${messages.length}`)));
    if (local2.folder === "INBOX" || local2.folder === "SENT") {
      const composeBtn = el("button", "comms-compose-btn", txt("[N]ew"));
      composeBtn.addEventListener("click", () => {
        local2.composing = true;
        paintMail(body);
      });
      mpane.appendChild(composeBtn);
    }
    for (const m of messages) {
      const row = el("div", "comms-row" + (local2.selected === m.id ? " sel" : ""));
      const who = local2.folder === "INBOX" ? m.from : m.to;
      const verified = m.verified === true ? "\u26BF " : m.verified === false ? "\u2717 " : "";
      row.append(
        el("span", "from", txt(verified + who)),
        el("span", "subj", txt(m.subj)),
        el("span", "when", txt(formatWhen(m.when)))
      );
      row.addEventListener("click", () => {
        local2.selected = m.id;
        local2.composing = false;
        paintMail(body);
        if (local2.folder === "INBOX" && m.state !== "read") {
          fetch("/api/c/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callsign: ME, ids: [m.id] })
          }).then(refresh);
        }
      });
      mpane.appendChild(row);
    }
    grid.appendChild(mpane);
    const dpane = el("div", "kb-col comms-detail");
    if (local2.composing) paintCompose(dpane, body);
    else if (local2.selected !== null) paintDetail(dpane, messages.find((x) => x.id === local2.selected));
    else dpane.appendChild(el("div", "kb-empty", txt("\u2190 select a message \xB7 or [N]ew")));
    grid.appendChild(dpane);
  }
  function paintDetail(pane, msg) {
    if (!msg) {
      pane.appendChild(el("div", "kb-error", txt("message gone")));
      return;
    }
    pane.appendChild(el("div", "msg-h-row", el("span", "k", txt("FROM")), el("span", "v", txt(msg.from || ""))));
    if (msg.to) pane.appendChild(el("div", "msg-h-row", el("span", "k", txt("TO")), el("span", "v", txt(msg.to))));
    pane.appendChild(el("div", "msg-h-row", el("span", "k", txt("SUBJ")), el("span", "v", txt(msg.subj || ""))));
    pane.appendChild(el(
      "div",
      "msg-h-row",
      el("span", "k", txt("WHEN")),
      el("span", "v", txt(formatWhen(msg.when, true)))
    ));
    if (msg.hops !== void 0) pane.appendChild(el(
      "div",
      "msg-h-row",
      el("span", "k", txt("HOPS")),
      el("span", "v", txt(`${msg.hops} hop${msg.hops === 1 ? "" : "s"}`))
    ));
    if (msg.verified !== void 0) pane.appendChild(el(
      "div",
      "msg-h-row",
      el("span", "k", txt("VERIFY")),
      el("span", "v" + (msg.verified ? " ok" : " bad"), txt(msg.verified ? "\u26BF verified" : "\u2717 FAILED"))
    ));
    pane.appendChild(el("hr"));
    const body = el("div", "msg-body");
    for (const line of (msg.body || "").split("\n")) {
      body.appendChild(el("div", "", txt(line || "\xA0")));
    }
    pane.appendChild(body);
  }
  function paintCompose(pane, root) {
    pane.appendChild(el("div", "kb-col-title", txt("COMPOSE")));
    const toRow = el("div", "compose-row");
    toRow.append(el("span", "k", txt("TO")));
    const toI = el("input", "field");
    toI.value = local2.draft.to;
    toI.addEventListener("input", (e) => {
      local2.draft.to = e.target.value;
    });
    toRow.appendChild(toI);
    pane.appendChild(toRow);
    const subjRow = el("div", "compose-row");
    subjRow.append(el("span", "k", txt("SUBJ")));
    const sI = el("input", "field");
    sI.value = local2.draft.subj;
    sI.addEventListener("input", (e) => {
      local2.draft.subj = e.target.value;
    });
    subjRow.appendChild(sI);
    pane.appendChild(subjRow);
    const bI = el("textarea", "field compose-body");
    bI.value = local2.draft.body;
    bI.placeholder = "message body \u2014 markdown rendering arrives in Sprint 6.5";
    bI.addEventListener("input", (e) => {
      local2.draft.body = e.target.value;
    });
    pane.appendChild(bI);
    const sendBtn = el("button", "comms-send-btn", txt("[S]end"));
    sendBtn.addEventListener("click", async () => {
      const d = local2.draft;
      if (!d.to || !d.subj) return;
      sendBtn.textContent = "sending\u2026";
      try {
        const r = await fetch("/api/c/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: ME, to: d.to, subj: d.subj, body: d.body, hops: 1 })
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        local2.draft = { to: PEER, subj: "", body: "" };
        local2.composing = false;
        local2.folder = "SENT";
        await refresh();
        paintMail(root);
      } catch (e) {
        sendBtn.textContent = "[S]end (failed: " + e.message + ")";
      }
    });
    pane.appendChild(sendBtn);
    const cancelBtn = el("button", "comms-cancel-btn", txt("Cancel"));
    cancelBtn.addEventListener("click", () => {
      local2.composing = false;
      paintMail(root);
    });
    pane.appendChild(cancelBtn);
  }
  async function paintBoards(body) {
    body.replaceChildren();
    if (!local2.boards.length) {
      try {
        local2.boards = await (await fetch("/api/c/boards")).json();
      } catch {
        local2.boards = [];
      }
    }
    const grid = el("div", "comms-grid comms-boards-grid");
    body.appendChild(grid);
    const list = el("div", "kb-col");
    list.appendChild(el("div", "kb-col-title", txt("BOARDS")));
    for (const b of local2.boards) {
      const slug = b.name.replace(/^\//, "");
      const row = el("div", "comms-folder" + (local2.selectedBoard === slug ? " sel" : ""));
      row.append(el("span", "fname", txt(b.name)), el("span", "fct", txt(String(b.post_count))));
      row.addEventListener("click", async () => {
        local2.selectedBoard = slug;
        try {
          local2.boardPosts[slug] = await (await fetch(`/api/c/boards/${slug}`)).json();
        } catch {
          local2.boardPosts[slug] = [];
        }
        paintBoards(body);
      });
      list.appendChild(row);
    }
    grid.appendChild(list);
    const posts = el("div", "kb-col comms-board-posts");
    if (local2.selectedBoard) {
      posts.appendChild(el("div", "kb-col-title", txt("/" + local2.selectedBoard + " \xB7 posts")));
      const pp = local2.boardPosts[local2.selectedBoard] || [];
      if (!pp.length) posts.appendChild(el("div", "kb-empty", txt("no posts yet")));
      for (const p of pp) {
        const row = el("div", "board-post");
        row.append(
          el("div", "h", el("span", "from", txt(p.from)), el("span", "when", txt(formatWhen(p.when, true)))),
          el("div", "subj", txt(p.subj)),
          el("div", "body", txt(p.body))
        );
        posts.appendChild(row);
      }
    } else {
      posts.appendChild(el("div", "kb-empty", txt("\u2190 select a board")));
    }
    grid.appendChild(posts);
  }
  async function paintNet(body) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("MESH NODES")));
    if (!local2.net.length) {
      try {
        local2.net = await (await fetch("/api/c/net")).json();
      } catch {
        local2.net = [];
      }
    }
    const list = el("div", "comms-net-list");
    for (const n of local2.net) {
      const row = el("div", "net-row");
      const transportColor = n.transport === "wifi" ? "cool" : "amber";
      row.append(
        el("span", "dot " + transportColor, txt(n.transport === "wifi" ? "\u25CF" : "\u25D0")),
        el("span", "callsign", txt(n.callsign)),
        el("span", "transport", txt(n.transport.toUpperCase())),
        el("span", "rssi", txt(`${n.rssi}dB`)),
        el("span", "dist", txt(n.dist_m ? `${(n.dist_m / 1e3).toFixed(1)}km` : "WiFi"))
      );
      list.appendChild(row);
    }
    body.appendChild(list);
  }
  function formatWhen(t, full = false) {
    if (!t) return "";
    const sec = typeof t === "number" ? t : t / 1e3;
    const ago = Date.now() / 1e3 - sec;
    if (full) return new Date(sec * 1e3).toLocaleString();
    if (ago < 60) return Math.floor(ago) + "s";
    if (ago < 3600) return Math.floor(ago / 60) + "m";
    if (ago < 86400) return Math.floor(ago / 3600) + "h";
    return Math.floor(ago / 86400) + "d";
  }

  // src/modules/medical.js
  var SUBS2 = { T: "triage", H: "history", D: "dose", R: "drugs", P: "photo" };
  var local3 = {
    sub: "triage",
    // triage state
    cats: null,
    category: null,
    runId: null,
    treeNodes: null,
    // {nodeId: {q, opts} | {action}}
    currentNode: null,
    history: [],
    // [{node_id, q, ans, branch}]
    outcome: null,
    // history sub-screen
    runs: null,
    selectedRun: null,
    selectedRunDetail: null,
    // dose sub-screen
    doseForm: { drug: "paracetamol", weight: 70, age: null },
    doseResult: null,
    // drugs sub-screen
    drugQuery: "",
    drugResults: [],
    drugDetail: null,
    // photo
    photoResult: null
  };
  function mountMedical(root, store2, ctx2) {
    const screen = el("div", "screen-medical medical");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      tabs.replaceChildren(...["triage", "history", "dose", "drugs", "photo"].map((s, i) => {
        const t = el("span", "kb-tab" + (local3.sub === s ? " active" : ""));
        t.append(el("span", "k", "THDRP"[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local3.sub = s;
          paint();
        });
        return t;
      }));
      if (local3.sub === "triage") paintTriage(body);
      if (local3.sub === "history") paintHistory(body);
      if (local3.sub === "dose") paintDose(body);
      if (local3.sub === "drugs") paintDrugs(body);
      if (local3.sub === "photo") paintPhoto(body);
    }
    function onKey(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (!SUBS2[e.key]) return;
      local3.sub = SUBS2[e.key];
      e.preventDefault();
      paint();
    }
    document.addEventListener("keydown", onKey, true);
    paint();
    return function unmount() {
      document.removeEventListener("keydown", onKey, true);
    };
  }
  async function paintTriage(body) {
    body.replaceChildren();
    if (!local3.cats) {
      try {
        local3.cats = await (await fetch("/api/m/categories")).json();
      } catch {
        local3.cats = [];
      }
    }
    if (!local3.category) {
      body.appendChild(el("div", "kb-col-title", txt("TRIAGE \u2014 PICK A CATEGORY")));
      const grid = el("div", "med-cat-grid");
      for (const c of local3.cats) {
        const card = el("div", "med-cat-card");
        card.append(
          el("div", "med-cat-icon", txt(c.icon || "+")),
          el("div", "med-cat-name", txt(c.name))
        );
        card.addEventListener("click", () => startTriage(c.id, body));
        grid.appendChild(card);
      }
      body.appendChild(grid);
      return;
    }
    if (local3.outcome) {
      paintOutcome(body);
      return;
    }
    const node = local3.currentNode;
    if (!node) {
      body.appendChild(el("div", "kb-empty", txt("loading\u2026")));
      return;
    }
    body.appendChild(el("div", "kb-col-title", txt(`TRIAGE \u203A ${local3.category.toUpperCase()}`)));
    if (node.q) {
      body.appendChild(el("div", "med-q", txt(node.q)));
      const opts = el("div", "med-opts");
      (node.opts || []).forEach((o, i) => {
        const row = el("div", "med-opt");
        row.append(
          el("span", "med-opt-key", txt("(" + String.fromCharCode(65 + i) + ")")),
          el("span", "med-opt-label", txt(o.label))
        );
        row.addEventListener("click", () => answer(node, o, body));
        opts.appendChild(row);
      });
      body.appendChild(opts);
      body.appendChild(el("div", "med-controls", txt("[b] back \xB7 [q] abort")));
    } else if (node.action) {
      paintActionNode(body, node);
    }
  }
  async function startTriage(category, body) {
    local3.category = category;
    local3.history = [];
    local3.outcome = null;
    try {
      const t = await (await fetch(`/api/m/tree/${category}`)).json();
      local3.treeNodes = t.nodes || {};
      local3.currentNode = local3.treeNodes[t.start];
      local3.currentNode._id = t.start;
      const r = await (await fetch("/api/m/run/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category })
      })).json();
      local3.runId = r.run_id;
    } catch (e) {
      console.warn("[medical] startTriage failed:", e.message);
    }
    paintTriage(body);
  }
  async function answer(node, opt, body) {
    if (local3.runId) {
      fetch(`/api/m/run/${local3.runId}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: node._id, q: node.q, ans: opt.label, branch: opt.next })
      }).catch(() => {
      });
    }
    local3.history.push({ node_id: node._id, q: node.q, ans: opt.label, branch: opt.next });
    const next = local3.treeNodes[opt.next];
    if (!next) {
      local3.outcome = { title: "Path ended", steps: ["[no next node \u2014 tree data issue]"] };
    } else {
      next._id = opt.next;
      local3.currentNode = next;
      if (next.action) {
        local3.outcome = next.action;
        if (local3.runId) {
          fetch(`/api/m/run/${local3.runId}/end`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outcome: next.action.title || "(no title)" })
          }).catch(() => {
          });
        }
      }
    }
    paintTriage(body);
  }
  function paintActionNode(body, node) {
    paintOutcome(body, node.action);
  }
  function paintOutcome(body, action = null) {
    const a = action || local3.outcome;
    body.appendChild(el("div", "kb-col-title", txt(`OUTCOME \u2014 ${local3.category.toUpperCase()}`)));
    const card = el("div", "med-action-card" + (a.cls === "danger" ? " danger" : ""));
    card.appendChild(el("div", "med-action-title", txt(a.title || "")));
    if (a.steps?.length) {
      card.appendChild(el("div", "med-action-h", txt("STEPS")));
      const ol = el("ol", "med-steps");
      for (const s of a.steps) ol.appendChild(el("li", "", txt(s)));
      card.appendChild(ol);
    }
    if (a.doList?.length) {
      card.appendChild(el("div", "med-action-h ok", txt("DO")));
      const ul = el("ul", "med-list");
      for (const s of a.doList) ul.appendChild(el("li", "", txt(s)));
      card.appendChild(ul);
    }
    if (a.dontList?.length) {
      card.appendChild(el("div", "med-action-h bad", txt("DON'T")));
      const ul = el("ul", "med-list");
      for (const s of a.dontList) ul.appendChild(el("li", "", txt(s)));
      card.appendChild(ul);
    }
    body.appendChild(card);
    const reset = el("button", "med-btn", txt("[N]ew triage"));
    reset.addEventListener("click", () => {
      local3.category = null;
      local3.runId = null;
      local3.outcome = null;
      local3.currentNode = null;
      local3.history = [];
      paintTriage(body);
    });
    body.appendChild(reset);
  }
  async function paintHistory(body) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("TRIAGE HISTORY")));
    try {
      local3.runs = await (await fetch("/api/m/runs")).json();
    } catch {
      local3.runs = [];
    }
    if (!local3.runs.length) {
      body.appendChild(el("div", "kb-empty", txt("no runs yet \u2014 switch to T to start one")));
      return;
    }
    const list = el("div", "med-runs-list");
    for (const r of local3.runs) {
      const row = el("div", "med-run-row" + (local3.selectedRun === r.id ? " sel" : ""));
      row.append(
        el("span", "id", txt("#" + r.id)),
        el("span", "cat", txt(r.category.toUpperCase())),
        el("span", "out", txt(r.outcome || "(in progress)")),
        el("span", "n", txt(`${r.step_count} steps`))
      );
      row.addEventListener("click", async () => {
        local3.selectedRun = r.id;
        try {
          local3.selectedRunDetail = await (await fetch(`/api/m/run/${r.id}`)).json();
        } catch {
          local3.selectedRunDetail = null;
        }
        paintHistory(body);
      });
      list.appendChild(row);
    }
    body.appendChild(list);
    if (local3.selectedRunDetail) {
      const d = local3.selectedRunDetail;
      const detail = el("div", "med-run-detail");
      detail.appendChild(el("div", "med-action-h", txt(`Run #${d.id} \xB7 ${d.category}`)));
      for (const s of d.steps || []) {
        detail.appendChild(el(
          "div",
          "med-step",
          el("span", "q", txt(s.q || s.node_id)),
          el("span", "ans", txt("\u2192 " + (s.ans || "")))
        ));
      }
      if (d.outcome) detail.appendChild(el("div", "med-outcome", txt("OUTCOME: " + d.outcome)));
      body.appendChild(detail);
    }
  }
  function paintDose(body) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("DOSE CALCULATOR")));
    const form = el("div", "med-form");
    const drugRow = el("div", "med-form-row");
    drugRow.append(el("span", "k", txt("DRUG")));
    const drugI = el("input", "field");
    drugI.value = local3.doseForm.drug;
    drugI.addEventListener("input", (e) => {
      local3.doseForm.drug = e.target.value;
    });
    drugRow.appendChild(drugI);
    form.appendChild(drugRow);
    const wRow = el("div", "med-form-row");
    wRow.append(el("span", "k", txt("WEIGHT KG")));
    const wI = el("input", "field");
    wI.type = "number";
    wI.value = local3.doseForm.weight;
    wI.addEventListener("input", (e) => {
      local3.doseForm.weight = parseFloat(e.target.value) || 0;
    });
    wRow.appendChild(wI);
    form.appendChild(wRow);
    const aRow = el("div", "med-form-row");
    aRow.append(el("span", "k", txt("AGE Y (opt)")));
    const aI = el("input", "field");
    aI.type = "number";
    aI.placeholder = "leave blank for adult";
    if (local3.doseForm.age != null) aI.value = String(local3.doseForm.age);
    aI.addEventListener("input", (e) => {
      const v = e.target.value.trim();
      local3.doseForm.age = v === "" ? null : parseInt(v, 10);
    });
    aRow.appendChild(aI);
    form.appendChild(aRow);
    const calcBtn = el("button", "med-btn", txt("Calculate"));
    calcBtn.addEventListener("click", async () => {
      try {
        const r = await fetch("/api/m/dose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(local3.doseForm)
        });
        local3.doseResult = await r.json();
      } catch {
        local3.doseResult = { error: "fetch failed" };
      }
      paintDose(body);
    });
    form.appendChild(calcBtn);
    body.appendChild(form);
    if (local3.doseResult) {
      const r = local3.doseResult;
      const card = el("div", "med-action-card");
      if (r.error) {
        card.appendChild(el("div", "med-action-title bad", txt(r.error)));
      } else {
        card.appendChild(el("div", "med-action-title", txt(`${r.drug} (${r.generic}) \xB7 ${r["class"]}`)));
        card.appendChild(el("div", "med-form-row", el("span", "k", txt("BAND")), el("span", "v", txt(r.band))));
        card.appendChild(el("div", "med-form-row", el("span", "k", txt("DOSE")), el("span", "v", txt(r.result_text))));
        if (r.per_dose_mg_low !== null) {
          card.appendChild(el(
            "div",
            "med-form-row",
            el("span", "k", txt("PER DOSE")),
            el("span", "v", txt(`${r.per_dose_mg_low}\u2013${r.per_dose_mg_high} mg`))
          ));
        }
        if (r.warnings?.length) {
          card.appendChild(el("div", "med-action-h bad", txt("WARNINGS")));
          const ul = el("ul", "med-list");
          for (const w of r.warnings) ul.appendChild(el("li", "", txt(w)));
          card.appendChild(ul);
        }
      }
      body.appendChild(card);
    }
  }
  function paintDrugs(body) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("DRUG SEARCH")));
    const search = el("div", "med-form-row");
    search.append(el("span", "k", txt("Q")));
    const qI = el("input", "field");
    qI.placeholder = "drug name / class";
    qI.value = local3.drugQuery;
    qI.addEventListener("input", async (e) => {
      local3.drugQuery = e.target.value;
      try {
        local3.drugResults = await (await fetch(`/api/m/drug/search?q=${encodeURIComponent(local3.drugQuery)}`)).json();
      } catch {
        local3.drugResults = [];
      }
      renderDrugList();
    });
    search.appendChild(qI);
    body.appendChild(search);
    const list = el("div", "med-drug-list");
    body.appendChild(list);
    const detailWrap = el("div", "med-drug-detail");
    body.appendChild(detailWrap);
    function renderDrugList() {
      list.replaceChildren();
      for (const d of local3.drugResults) {
        const row = el("div", "med-drug-row" + (local3.drugDetail?.name === d.name ? " sel" : ""));
        row.append(
          el("span", "name", txt(d.name)),
          el("span", "class", txt(d["class"]))
        );
        row.addEventListener("click", async () => {
          try {
            local3.drugDetail = await (await fetch(`/api/m/drug/${encodeURIComponent(d.name)}`)).json();
          } catch {
            local3.drugDetail = null;
          }
          renderDrugList();
          renderDrugDetail();
        });
        list.appendChild(row);
      }
    }
    function renderDrugDetail() {
      detailWrap.replaceChildren();
      if (!local3.drugDetail) return;
      const d = local3.drugDetail;
      const card = el("div", "med-action-card");
      card.appendChild(el("div", "med-action-title", txt(`${d.name} \xB7 ${d["class"]}`)));
      if (d.doses) {
        for (const [b, t] of Object.entries(d.doses)) {
          card.appendChild(el("div", "med-form-row", el("span", "k", txt(b.toUpperCase())), el("span", "v", txt(t))));
        }
      }
      if (d.warnings?.length) {
        card.appendChild(el("div", "med-action-h bad", txt("WARNINGS")));
        const ul = el("ul", "med-list");
        for (const w of d.warnings) ul.appendChild(el("li", "", txt(w)));
        card.appendChild(ul);
      }
      if (d.interactions?.length) {
        card.appendChild(el("div", "med-action-h", txt("INTERACTIONS")));
        const ul = el("ul", "med-list");
        for (const w of d.interactions) ul.appendChild(el("li", "", txt(w)));
        card.appendChild(ul);
      }
      detailWrap.appendChild(card);
    }
    if (!local3.drugResults.length) {
      fetch("/api/m/drug/search?q=").then((r) => r.json()).then((j) => {
        local3.drugResults = j;
        renderDrugList();
      }).catch(() => {
      });
    } else {
      renderDrugList();
      renderDrugDetail();
    }
  }
  function paintPhoto(body) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("PHOTO TRIAGE")));
    body.appendChild(el("div", "kb-empty", txt(
      "Sprint 7 ships plumbing only \u2014 synthetic VLM placeholder. Real Qwen2-VL on RK3588 NPU lands when OVERSEER_VLM=qwen2vl is wired (ADR-pattern same as KNOWLEDGE / POWER / COMMS)."
    )));
    const btn = el("button", "med-btn", txt("Run synthetic analysis"));
    btn.addEventListener("click", async () => {
      try {
        const r = await fetch("/api/m/photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "wound", image_b64: btoa("placeholder image bytes") })
        });
        local3.photoResult = await r.json();
      } catch {
        local3.photoResult = { error: "fetch failed" };
      }
      paintPhoto(body);
    });
    body.appendChild(btn);
    if (local3.photoResult) {
      const r = local3.photoResult;
      const card = el("div", "med-action-card");
      if (r.error) card.appendChild(el("div", "med-action-title bad", txt(r.error)));
      else {
        card.appendChild(el("div", "med-action-title", txt(`Findings \xB7 synthetic=${r.synthetic}`)));
        card.appendChild(el(
          "div",
          "med-form-row",
          el("span", "k", txt("BYTES")),
          el("span", "v", txt(String(r.image_bytes)))
        ));
        const ul = el("ul", "med-list");
        for (const f of r.findings || []) {
          ul.appendChild(el("li", "", txt(`${f.label} (${(f.confidence * 100).toFixed(0)}%)`)));
        }
        card.appendChild(ul);
      }
      body.appendChild(card);
    }
  }

  // src/sextant/rasterizer.js
  function sextantChar(pattern) {
    if (pattern === 0) return " ";
    if (pattern === 63) return "\u2588";
    if (pattern === 21) return "\u258C";
    if (pattern === 42) return "\u2590";
    let offset = pattern - 1;
    if (pattern > 21) offset -= 1;
    if (pattern > 42) offset -= 1;
    return String.fromCodePoint(129792 + offset);
  }
  function rasterize(bitmap) {
    if (!bitmap || bitmap.length === 0) return "";
    const h = bitmap.length;
    let w = 0;
    for (const row of bitmap) if (row.length > w) w = row.length;
    const padded = bitmap.map((row) => {
      const r = row.slice();
      while (r.length < w) r.push(0);
      return r;
    });
    while (padded.length % 3 !== 0) padded.push(new Array(w).fill(0));
    if (w % 2 !== 0) {
      for (const row of padded) row.push(0);
      w += 1;
    }
    const cellRows = padded.length / 3;
    const cellCols = w / 2;
    const lines = [];
    for (let cy = 0; cy < cellRows; cy++) {
      let line = "";
      for (let cx = 0; cx < cellCols; cx++) {
        const tl = padded[cy * 3 + 0][cx * 2 + 0] ? 1 : 0;
        const tr = padded[cy * 3 + 0][cx * 2 + 1] ? 1 : 0;
        const ml = padded[cy * 3 + 1][cx * 2 + 0] ? 1 : 0;
        const mr = padded[cy * 3 + 1][cx * 2 + 1] ? 1 : 0;
        const bl = padded[cy * 3 + 2][cx * 2 + 0] ? 1 : 0;
        const br = padded[cy * 3 + 2][cx * 2 + 1] ? 1 : 0;
        const pattern = tl << 0 | tr << 1 | ml << 2 | mr << 3 | bl << 4 | br << 5;
        line += sextantChar(pattern);
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  // src/modules/navigation.js
  var SUBS3 = { W: "waypoints", C: "compass", M: "map", O: "overlays" };
  var ME_LL = { lat: 53.38, lon: -1.47 };
  var local4 = {
    sub: "waypoints",
    waypoints: null,
    selectedCat: null,
    selectedWp: null,
    compass: null,
    mapBitmap: null,
    mapText: null,
    overlays: null
  };
  function mountNavigation(root, store2, ctx2) {
    const screen = el("div", "screen-nav nav");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      tabs.replaceChildren(...["waypoints", "compass", "map", "overlays"].map((s, i) => {
        const t = el("span", "kb-tab" + (local4.sub === s ? " active" : ""));
        t.append(el("span", "k", "WCMO"[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local4.sub = s;
          paint();
        });
        return t;
      }));
      if (local4.sub === "waypoints") paintWaypoints(body);
      if (local4.sub === "compass") paintCompass(body);
      if (local4.sub === "map") paintMap(body);
      if (local4.sub === "overlays") paintOverlays(body);
    }
    function onKey(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (!SUBS3[e.key]) return;
      local4.sub = SUBS3[e.key];
      e.preventDefault();
      paint();
    }
    document.addEventListener("keydown", onKey, true);
    bootstrap2().then(paint);
    return function unmount() {
      document.removeEventListener("keydown", onKey, true);
    };
  }
  async function bootstrap2() {
    try {
      const wps = await (await fetch("/api/n/waypoints")).json();
      if (!wps || wps.length === 0) {
        const demo = [
          { name: "Cache-7", cat: "cache", lat: 53.39, lon: -1.46, notes: "under the cairn" },
          { name: "RV-North", cat: "rdv", lat: 53.42, lon: -1.45 },
          { name: "Spring", cat: "water", lat: 53.36, lon: -1.49 },
          { name: "Old-mill", cat: "shelter", lat: 53.38, lon: -1.51 }
        ];
        for (const w of demo) {
          await fetch("/api/n/waypoint", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(w)
          }).catch(() => {
          });
        }
      }
    } catch {
    }
    await refresh2();
  }
  async function refresh2() {
    try {
      local4.waypoints = await (await fetch("/api/n/waypoints")).json();
    } catch {
      local4.waypoints = [];
    }
  }
  function paintWaypoints(body) {
    body.replaceChildren();
    const grid = el("div", "nav-grid");
    body.appendChild(grid);
    const cats = el("div", "kb-col");
    cats.appendChild(el("div", "kb-col-title", txt("CATEGORIES")));
    const wps = local4.waypoints || [];
    const byCat = {};
    for (const w2 of wps) byCat[w2.cat] = (byCat[w2.cat] || 0) + 1;
    byCat["all"] = wps.length;
    for (const [c, n] of Object.entries(byCat)) {
      const row = el("div", "comms-folder" + ((local4.selectedCat || "all") === c ? " sel" : ""));
      row.append(el("span", "fname", txt(c.toUpperCase())), el("span", "fct", txt(String(n))));
      row.addEventListener("click", () => {
        local4.selectedCat = c === "all" ? null : c;
        local4.selectedWp = null;
        paintWaypoints(body);
      });
      cats.appendChild(row);
    }
    grid.appendChild(cats);
    const items = el("div", "kb-col");
    items.appendChild(el("div", "kb-col-title", txt("WAYPOINTS")));
    const filtered = local4.selectedCat ? wps.filter((w2) => w2.cat === local4.selectedCat) : wps;
    for (const w2 of filtered) {
      const row = el("div", "nav-wp-row" + (local4.selectedWp === w2.id ? " sel" : ""));
      row.append(
        el("span", "name", txt(w2.name)),
        el("span", "cat", txt(w2.cat)),
        el("span", "ll", txt(`${w2.lat.toFixed(3)}, ${w2.lon.toFixed(3)}`))
      );
      row.addEventListener("click", () => {
        local4.selectedWp = w2.id;
        paintWaypoints(body);
      });
      items.appendChild(row);
    }
    if (filtered.length === 0) items.appendChild(el("div", "kb-empty", txt("(no waypoints in category)")));
    grid.appendChild(items);
    const detail = el("div", "kb-col");
    detail.appendChild(el("div", "kb-col-title", txt("DETAIL")));
    const w = wps.find((x) => x.id === local4.selectedWp);
    if (w) {
      const distKm = haversineKm(ME_LL.lat, ME_LL.lon, w.lat, w.lon);
      const bearing = bearingDeg(ME_LL.lat, ME_LL.lon, w.lat, w.lon);
      detail.append(
        _kv("NAME", w.name),
        _kv("CAT", w.cat),
        _kv("LAT", w.lat.toFixed(5)),
        _kv("LON", w.lon.toFixed(5)),
        _kv("ELEV", w.elev != null ? `${Math.round(w.elev)} m` : "\u2014"),
        _kv("BEARING", `${bearing.toFixed(1)}\xB0 ${cardinal(bearing)}`),
        _kv("DIST", distKm < 1 ? `${Math.round(distKm * 1e3)} m` : `${distKm.toFixed(2)} km`),
        _kv("VERIFY", w.verified ? "\u2713" : "\u2014")
      );
      if (w.notes) detail.appendChild(el("div", "nav-notes", txt(w.notes)));
    } else detail.appendChild(el("div", "kb-empty", txt("\u2190 select a waypoint")));
    grid.appendChild(detail);
  }
  function _kv(k, v) {
    const row = el("div", "med-form-row");
    row.append(el("span", "k", txt(k)), el("span", "v", txt(String(v))));
    return row;
  }
  async function paintCompass(body) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("COMPASS \u2014 NEAREST WAYPOINTS")));
    body.appendChild(el(
      "div",
      "med-form-row",
      el("span", "k", txt("FROM")),
      el("span", "v", txt(`${ME_LL.lat.toFixed(4)}, ${ME_LL.lon.toFixed(4)} (default)`))
    ));
    if (!local4.compass) {
      try {
        local4.compass = await (await fetch(`/api/n/nearest?lat=${ME_LL.lat}&lon=${ME_LL.lon}&max=10`)).json();
      } catch {
        local4.compass = [];
      }
    }
    if (!local4.compass.length) {
      body.appendChild(el("div", "kb-empty", txt("(no waypoints to point at)")));
      return;
    }
    const list = el("div", "nav-compass-list");
    for (const c of local4.compass) {
      const row = el("div", "nav-compass-row");
      row.append(
        el("span", "bearing", txt(`${String(Math.round(c.bearing_deg)).padStart(3, "0")}\xB0`)),
        el("span", "card", txt(cardinal(c.bearing_deg))),
        el("span", "name", txt(c.name)),
        el("span", "cat", txt(c.cat)),
        el("span", "dist", txt(c.dist_m < 1e3 ? `${c.dist_m} m` : `${(c.dist_m / 1e3).toFixed(2)} km`))
      );
      list.appendChild(row);
    }
    body.appendChild(list);
  }
  async function paintMap(body) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("TEXT MAP \xB7 sextant rasterizer (ADR-0009)")));
    if (!local4.mapBitmap) {
      try {
        const j = await (await fetch("/api/n/terrain?w=64&h=48&threshold_m=600")).json();
        local4.mapBitmap = j.bitmap;
        local4.mapText = rasterize(local4.mapBitmap);
      } catch (e) {
        local4.mapText = `[fetch failed: ${e.message}]`;
      }
    }
    const meta = el("div", "nav-map-meta", txt(
      `bitmap ${local4.mapBitmap ? local4.mapBitmap[0].length : 0}\xD7${local4.mapBitmap ? local4.mapBitmap.length : 0}  \xB7  rendered ${local4.mapText ? local4.mapText.split("\n").length : 0} sextant rows`
    ));
    body.appendChild(meta);
    const pre = el("pre", "nav-map");
    pre.textContent = local4.mapText || "(loading\u2026)";
    body.appendChild(pre);
  }
  async function paintOverlays(body) {
    body.replaceChildren();
    body.appendChild(el("div", "kb-col-title", txt("OVERLAYS")));
    if (!local4.overlays) {
      try {
        local4.overlays = await (await fetch("/api/n/overlays")).json();
      } catch {
        local4.overlays = [];
      }
    }
    if (!local4.overlays.length) {
      body.appendChild(el("div", "kb-empty", txt(
        "no overlays \u2014 drawing UI lands in Sprint 8.5 (the polygon picker, hex search, route trace)"
      )));
      return;
    }
    const list = el("div", "nav-ovs");
    for (const o of local4.overlays) {
      const row = el("div", "nav-ov-row");
      row.append(
        el("span", "name", txt(o.name)),
        el("span", "kind", txt(o.kind))
      );
      list.appendChild(row);
    }
    body.appendChild(list);
  }
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const dp = p2 - p1;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function cardinal(deg) {
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  // src/modules/log.js
  var SUBS4 = { T: "today", E: "entries", S: "summary", X: "export" };
  var KINDS = ["observation", "decision", "patrol", "ration", "incident", "triage", "comms", "system", "note"];
  var local5 = {
    sub: "today",
    // today
    todayData: null,
    // entries
    entryList: null,
    filterKind: "",
    filterQ: "",
    // summary
    summaryData: null,
    // export
    exportFrom: "",
    exportTo: "",
    exportResult: null
  };
  function mountLog(root, store2, ctx2) {
    const screen = el("div", "screen-log log");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      tabs.replaceChildren(...["today", "entries", "summary", "export"].map((s, i) => {
        const t = el("span", "kb-tab" + (local5.sub === s ? " active" : ""));
        t.append(el("span", "k", "TESX"[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local5.sub = s;
          paint();
        });
        return t;
      }));
      if (local5.sub === "today") paintToday(body);
      if (local5.sub === "entries") paintEntries(body);
      if (local5.sub === "summary") paintSummary(body);
      if (local5.sub === "export") paintExport(body);
    }
    function onKey(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (!SUBS4[e.key]) return;
      local5.sub = SUBS4[e.key];
      e.preventDefault();
      paint();
    }
    document.addEventListener("keydown", onKey, true);
    loadToday().then(paint);
    return function unmount() {
      document.removeEventListener("keydown", onKey, true);
    };
  }
  async function loadToday() {
    try {
      local5.todayData = await (await fetch("/api/l/today")).json();
    } catch (_) {
      local5.todayData = { date: today(), day_number: 0, entries: [] };
    }
  }
  function paintToday(body) {
    body.replaceChildren();
    const header = el("div", "log-day-header");
    const d = local5.todayData;
    const dayNum = d ? `D+${d.day_number}` : "D+?";
    const dateStr = d ? d.date : today();
    header.append(
      el("span", "log-day-num", dayNum),
      el("span", "log-day-sep", " \xB7 "),
      el("span", "log-day-date", dateStr),
      el(
        "span",
        "log-entry-count",
        ` \xB7 ${d ? d.entries.length : 0} entr${d && d.entries.length === 1 ? "y" : "ies"}`
      )
    );
    body.append(header);
    const list = el("div", "log-entry-list");
    if (d && d.entries.length) {
      for (const e of d.entries) {
        list.append(buildEntryRow(e));
      }
    } else {
      list.append(el("div", "kb-empty", "No entries today. Start writing below."));
    }
    body.append(list);
    body.append(buildQuickEntry(async (kind, text) => {
      if (!text.trim()) return;
      await fetch("/api/l/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, body: text })
      }).catch(() => {
      });
      await loadToday();
      paintToday(body);
    }));
  }
  function buildEntryRow(e) {
    const row = el("div", "log-entry-row");
    row.append(
      el("span", "log-entry-time", e.time || "??:??"),
      el("span", "log-entry-kind log-kind-" + e.kind, e.kind),
      el("span", "log-entry-body", e.body)
    );
    if (e.source === "auto") row.classList.add("log-auto");
    return row;
  }
  function buildQuickEntry(onSubmit) {
    const wrap = el("div", "log-quick");
    const kindSel = el("select", "log-kind-sel");
    for (const k of KINDS) {
      const opt = el("option", "", k);
      opt.value = k;
      if (k === "observation") opt.selected = true;
      kindSel.append(opt);
    }
    const input = el("input", "log-input");
    input.type = "text";
    input.placeholder = "> new entry\u2026";
    input.setAttribute("autocomplete", "off");
    const btn = el("button", "log-submit-btn", "ADD");
    async function submit() {
      await onSubmit(kindSel.value, input.value);
      input.value = "";
      input.focus();
    }
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    wrap.append(kindSel, input, btn);
    return wrap;
  }
  async function loadEntries() {
    const params = new URLSearchParams();
    if (local5.filterKind) params.set("kind", local5.filterKind);
    if (local5.filterQ) params.set("q", local5.filterQ);
    try {
      local5.entryList = await (await fetch("/api/l/entries?" + params)).json();
    } catch (_) {
      local5.entryList = [];
    }
  }
  function paintEntries(body) {
    body.replaceChildren();
    const filters = el("div", "log-filters");
    const kindSel = el("select", "log-filter-kind");
    const allOpt = el("option", "", "all kinds");
    allOpt.value = "";
    kindSel.append(allOpt);
    for (const k of KINDS) {
      const opt = el("option", "", k);
      opt.value = k;
      if (k === local5.filterKind) opt.selected = true;
      kindSel.append(opt);
    }
    kindSel.addEventListener("change", () => {
      local5.filterKind = kindSel.value;
      loadEntries().then(() => paintEntries(body));
    });
    const search = el("input", "log-search");
    search.type = "text";
    search.placeholder = "search\u2026";
    search.value = local5.filterQ;
    search.setAttribute("autocomplete", "off");
    search.addEventListener("input", () => {
      local5.filterQ = search.value;
      loadEntries().then(() => paintEntries(body));
    });
    filters.append(kindSel, search);
    body.append(filters);
    const list = el("div", "log-entry-list");
    if (!local5.entryList) {
      loadEntries().then(() => paintEntries(body));
      list.append(el("div", "kb-empty", "Loading\u2026"));
    } else if (!local5.entryList.length) {
      list.append(el("div", "kb-empty", "No matching entries."));
    } else {
      let curDate = null;
      for (const e of local5.entryList) {
        if (e.date !== curDate) {
          curDate = e.date;
          list.append(el("div", "log-date-divider", e.date));
        }
        list.append(buildEntryRow(e));
      }
    }
    body.append(list);
  }
  async function loadSummary() {
    const d = today();
    try {
      local5.summaryData = await (await fetch(`/api/l/summary/${d}`)).json();
    } catch (_) {
      local5.summaryData = null;
    }
  }
  function paintSummary(body) {
    body.replaceChildren();
    const hdr = el("div", "log-section-header", "DAILY DEBRIEF");
    body.append(hdr);
    if (!local5.summaryData) {
      loadSummary().then(() => paintSummary(body));
      body.append(el("div", "kb-empty", "Generating summary\u2026"));
      return;
    }
    const s = local5.summaryData;
    const card = el("div", "log-summary-card");
    const dateSpan = el("span", "log-summary-date", s.date || today());
    card.append(dateSpan);
    const textBox = el("pre", "log-summary-text", s.text);
    card.append(textBox);
    if (s.approved_at) {
      const ts = new Date(s.approved_at * 1e3).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      card.append(el("div", "log-summary-approved", `\u2713 approved ${ts}`));
    } else {
      const btn = el("button", "log-approve-btn", "APPROVE");
      btn.addEventListener("click", async () => {
        await fetch(`/api/l/summary/${s.date}/approve`, { method: "POST" }).catch(() => {
        });
        await loadSummary();
        paintSummary(body);
      });
      card.append(btn);
    }
    body.append(card);
  }
  function paintExport(body) {
    body.replaceChildren();
    const hdr = el("div", "log-section-header", "EXPORT LOG");
    body.append(hdr);
    const form = el("div", "log-export-form");
    const fromLabel = el("label", "log-export-label", "FROM ");
    const fromInput = el("input", "log-export-date");
    fromInput.type = "date";
    fromInput.value = local5.exportFrom || today();
    const toLabel = el("label", "log-export-label", "TO ");
    const toInput = el("input", "log-export-date");
    toInput.type = "date";
    toInput.value = local5.exportTo || today();
    const btn = el("button", "log-export-btn", "EXPORT MD");
    btn.addEventListener("click", async () => {
      local5.exportFrom = fromInput.value;
      local5.exportTo = toInput.value;
      try {
        const r = await fetch(`/api/l/export?from=${local5.exportFrom}&to=${local5.exportTo}&fmt=json`);
        const j = await r.json();
        local5.exportResult = j.text;
      } catch (_) {
        local5.exportResult = "Export failed.";
      }
      paintExport(body);
    });
    form.append(fromLabel, fromInput, toLabel, toInput, btn);
    body.append(form);
    if (local5.exportResult) {
      const pre = el("pre", "log-export-preview", local5.exportResult);
      body.append(pre);
    }
  }
  function today() {
    const d = /* @__PURE__ */ new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // src/modules/inventory.js
  var SUBS5 = { B: "browse", E: "expiring", L: "low", P: "pack" };
  var local6 = {
    sub: "browse",
    cats: null,
    selectedCat: null,
    items: null,
    selectedItem: null,
    expiring: null,
    low: null,
    pack: null,
    packMission: "48h patrol"
  };
  var MISSIONS = ["48h patrol", "14d bug-out", "winter overnight"];
  function mountInventory(root, store2, ctx2) {
    const screen = el("div", "screen-inv inv");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      tabs.replaceChildren(...["browse", "expiring", "low", "pack"].map((s, i) => {
        const t = el("span", "kb-tab" + (local6.sub === s ? " active" : ""));
        t.append(el("span", "k", "BELP"[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local6.sub = s;
          paint();
        });
        return t;
      }));
      if (local6.sub === "browse") paintBrowse(body);
      if (local6.sub === "expiring") paintExpiring(body);
      if (local6.sub === "low") paintLow(body);
      if (local6.sub === "pack") paintPack(body);
    }
    function onKey(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
      if (!SUBS5[e.key]) return;
      local6.sub = SUBS5[e.key];
      e.preventDefault();
      paint();
    }
    document.addEventListener("keydown", onKey, true);
    loadCats().then(paint);
    return function unmount() {
      document.removeEventListener("keydown", onKey, true);
    };
  }
  async function loadCats() {
    try {
      local6.cats = await (await fetch("/api/i/categories")).json();
    } catch (_) {
      local6.cats = [];
    }
  }
  async function loadItems(catId) {
    try {
      const url = catId != null ? `/api/i/items?category=${catId}` : "/api/i/items";
      local6.items = await (await fetch(url)).json();
    } catch (_) {
      local6.items = [];
    }
  }
  function paintBrowse(body) {
    body.replaceChildren();
    const grid = el("div", "inv-miller");
    const col1 = el("div", "inv-col inv-col-cats");
    col1.append(el("div", "inv-col-hdr", "CATEGORIES"));
    const catList = el("div", "inv-col-body");
    (local6.cats || []).forEach((c) => {
      const row = el("div", "inv-cat-row" + (local6.selectedCat?.id === c.id ? " active" : ""), c.name);
      row.addEventListener("click", () => {
        local6.selectedCat = c;
        local6.selectedItem = null;
        local6.items = null;
        loadItems(c.id).then(() => paintBrowse(body));
      });
      catList.append(row);
    });
    col1.append(catList);
    const col2 = el("div", "inv-col inv-col-items");
    col2.append(el("div", "inv-col-hdr", local6.selectedCat ? local6.selectedCat.name.toUpperCase() : "ALL ITEMS"));
    const itemList = el("div", "inv-col-body");
    if (!local6.items && local6.selectedCat) {
      itemList.append(el("div", "kb-empty", "Loading\u2026"));
    } else {
      (local6.items || []).forEach((it) => {
        const row = el("div", "inv-item-row" + (local6.selectedItem?.id === it.id ? " active" : ""));
        const nameSpan = el("span", "inv-item-name", it.name);
        const qtySpan = el("span", "inv-item-qty" + (it.low ? " low" : ""), `\xD7${it.qty}`);
        row.append(nameSpan, qtySpan);
        if (it.exp_days != null && it.exp_days < 60) row.classList.add("expiring-soon");
        row.addEventListener("click", () => {
          local6.selectedItem = it;
          paintBrowse(body);
        });
        itemList.append(row);
      });
      if (!(local6.items || []).length) {
        itemList.append(el("div", "kb-empty", local6.selectedCat ? "No items in this category." : "Select a category."));
      }
    }
    col2.append(itemList);
    const col3 = el("div", "inv-col inv-col-detail");
    col3.append(el("div", "inv-col-hdr", "DETAIL"));
    if (local6.selectedItem) {
      col3.append(buildDetail(local6.selectedItem));
    } else {
      col3.append(el("div", "kb-empty", "Select an item."));
    }
    grid.append(col1, col2, col3);
    body.append(grid);
  }
  function buildDetail(it) {
    const d = el("div", "inv-detail");
    const name = el("div", "inv-detail-name", it.name);
    d.append(name);
    const rows = [
      ["Qty", `${it.qty} ${it.unit}`],
      ["Location", it.location || "\u2014"],
      ["Weight", it.weight_g ? `${it.weight_g}g` : "\u2014"],
      ["Calories", it.kcal ? `${it.kcal} kcal` : "\u2014"],
      it.exp_days != null ? ["Expires", `${it.exp_days >= 0 ? `in ${it.exp_days}d` : "EXPIRED"}${it.exp_days < 60 ? " \u26A0" : ""}`] : ["Expires", "\u2014"],
      ["Notes", it.notes || "\u2014"]
    ];
    const tbl = el("div", "inv-detail-tbl");
    for (const [k, v] of rows) {
      const row = el("div", "inv-detail-row");
      row.append(el("span", "inv-detail-k", k), el("span", "inv-detail-v", v));
      tbl.append(row);
    }
    d.append(tbl);
    const btn = el("button", "inv-consume-btn", "USE 1");
    btn.addEventListener("click", async () => {
      await fetch("/api/i/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: it.id, delta: -1, reason: "manual" })
      }).catch(() => {
      });
      await loadItems(local6.selectedCat?.id ?? null);
      local6.selectedItem = local6.items?.find((x) => x.id === it.id) ?? null;
      paintBrowse(document.querySelector(".inv .kb-body"));
    });
    d.append(btn);
    return d;
  }
  async function loadExpiring() {
    try {
      local6.expiring = await (await fetch("/api/i/expiring?within=90")).json();
    } catch (_) {
      local6.expiring = [];
    }
  }
  function paintExpiring(body) {
    body.replaceChildren();
    body.append(el("div", "inv-section-hdr", "EXPIRING WITHIN 90 DAYS"));
    if (!local6.expiring) {
      loadExpiring().then(() => paintExpiring(body));
      body.append(el("div", "kb-empty", "Loading\u2026"));
      return;
    }
    if (!local6.expiring.length) {
      body.append(el("div", "kb-empty", "Nothing expiring soon. \u2713"));
      return;
    }
    const list = el("div", "inv-exp-list");
    for (const it of local6.expiring) {
      const row = el("div", "inv-exp-row");
      const urgency = it.exp_days < 14 ? " urgent" : it.exp_days < 30 ? " warn" : "";
      row.append(
        el("span", "inv-exp-name", it.name),
        el("span", "inv-exp-days" + urgency, `${it.exp_days}d`),
        el("span", "inv-exp-qty", `\xD7${it.qty} ${it.unit}`)
      );
      list.append(row);
    }
    body.append(list);
  }
  async function loadLow() {
    try {
      local6.low = await (await fetch("/api/i/low")).json();
    } catch (_) {
      local6.low = [];
    }
  }
  function paintLow(body) {
    body.replaceChildren();
    body.append(el("div", "inv-section-hdr", "BELOW THRESHOLD"));
    if (!local6.low) {
      loadLow().then(() => paintLow(body));
      body.append(el("div", "kb-empty", "Loading\u2026"));
      return;
    }
    if (!local6.low.length) {
      body.append(el("div", "kb-empty", "All items above threshold. \u2713"));
      return;
    }
    const list = el("div", "inv-low-list");
    for (const it of local6.low) {
      const row = el("div", "inv-low-row");
      row.append(
        el("span", "inv-low-name", it.name),
        el("span", "inv-low-qty", `${it.qty} / ${it.threshold_qty} ${it.unit}`)
      );
      list.append(row);
    }
    body.append(list);
  }
  function paintPack(body) {
    body.replaceChildren();
    body.append(el("div", "inv-section-hdr", "PACK OPTIMIZER"));
    const form = el("div", "inv-pack-form");
    const sel = el("select", "inv-pack-mission-sel");
    for (const m of MISSIONS) {
      const opt = el("option", "", m);
      opt.value = m;
      if (m === local6.packMission) opt.selected = true;
      sel.append(opt);
    }
    const btn = el("button", "inv-pack-btn", "OPTIMIZE");
    btn.addEventListener("click", async () => {
      local6.packMission = sel.value;
      try {
        local6.pack = await (await fetch("/api/i/pack/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mission: local6.packMission })
        })).json();
      } catch (_) {
        local6.pack = null;
      }
      paintPack(body);
    });
    form.append(sel, btn);
    body.append(form);
    if (!local6.pack) return;
    const p = local6.pack;
    const stats = el("div", "inv-pack-stats");
    stats.append(
      el("span", "inv-pack-stat", `${(p.total_weight_g / 1e3).toFixed(1)}kg`),
      el("span", "inv-pack-stat-label", " weight \xB7 "),
      el("span", "inv-pack-stat", `${p.total_kcal}kcal`),
      el("span", "inv-pack-stat-label", " \xB7 med: "),
      el("span", "inv-pack-stat" + (p.medical_coverage === "OK" ? " ok" : " warn"), p.medical_coverage)
    );
    body.append(stats);
    const list = el("div", "inv-pack-list");
    for (const it of p.items) {
      const row = el("div", "inv-pack-row");
      row.append(
        el("span", "inv-pack-label inv-pack-label-" + it.label, it.label.slice(0, 1).toUpperCase()),
        el("span", "inv-pack-name", it.name),
        el("span", "inv-pack-wt", `${it.weight_g}g`)
      );
      list.append(row);
    }
    body.append(list);
  }

  // src/modules/timeline.js
  var SUBS6 = { F: "feed", S: "search", X: "export" };
  var RANGES = [
    { key: "1", label: "24h", hours: 24 },
    { key: "3", label: "72h", hours: 72 },
    { key: "7", label: "7d", hours: 168 },
    { key: "M", label: "30d", hours: 720 },
    { key: "A", label: "all", hours: null }
  ];
  var MOD_CLASS = {
    log: "tl-mod-log",
    comms: "tl-mod-comms",
    medical: "tl-mod-med",
    triage: "tl-mod-med",
    navigation: "tl-mod-nav",
    inventory: "tl-mod-inv",
    system: "tl-mod-sys"
  };
  var local7 = {
    sub: "feed",
    range: RANGES[1],
    // default 72h
    events: null,
    searchQ: "",
    searchKind: "",
    searchWho: "",
    exportFrom: "",
    exportTo: "",
    exportResult: null
  };
  function mountTimeline(root, store2, ctx2) {
    const screen = el("div", "screen-tl tl");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      tabs.replaceChildren(...["feed", "search", "export"].map((s, i) => {
        const t = el("span", "kb-tab" + (local7.sub === s ? " active" : ""));
        t.append(el("span", "k", "FSX"[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local7.sub = s;
          paint();
        });
        return t;
      }));
      if (local7.sub === "feed") paintFeed(body);
      if (local7.sub === "search") paintSearch(body);
      if (local7.sub === "export") paintExport2(body);
    }
    function onKey(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
      if (SUBS6[e.key]) {
        local7.sub = SUBS6[e.key];
        e.preventDefault();
        paint();
        return;
      }
      if (local7.sub === "feed") {
        const r = RANGES.find((x) => x.key === e.key.toUpperCase());
        if (r) {
          local7.range = r;
          local7.events = null;
          e.preventDefault();
          loadFeed().then(() => paintFeed(body));
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    loadFeed().then(paint);
    return function unmount() {
      document.removeEventListener("keydown", onKey, true);
    };
  }
  async function loadFeed(opts = {}) {
    const params = new URLSearchParams();
    if (local7.range.hours) params.set("range", local7.range.hours + "h");
    if (opts.kind) params.set("kind", opts.kind);
    if (opts.q) params.set("q", opts.q);
    if (opts.who) params.set("who", opts.who);
    try {
      local7.events = await (await fetch("/api/t/events?" + params)).json();
    } catch (_) {
      local7.events = [];
    }
  }
  function paintFeed(body) {
    body.replaceChildren();
    const rangeBar = el("div", "tl-range-bar");
    for (const r of RANGES) {
      const btn = el("span", "tl-range-btn" + (local7.range.key === r.key ? " active" : ""), r.label);
      btn.addEventListener("click", () => {
        local7.range = r;
        local7.events = null;
        loadFeed().then(() => paintFeed(body));
      });
      rangeBar.append(btn);
    }
    body.append(rangeBar);
    if (!local7.events) {
      body.append(el("div", "kb-empty", "Loading\u2026"));
      return;
    }
    if (!local7.events.length) {
      body.append(el("div", "kb-empty", "No events in this range."));
      return;
    }
    const stream = el("div", "tl-stream");
    let curDate = null;
    for (const e of local7.events) {
      if (e.date !== curDate) {
        curDate = e.date;
        stream.append(el("div", "tl-date-divider", `D+${e.day_number} \xB7 ${e.date}`));
      }
      stream.append(buildEventRow(e));
    }
    body.append(stream);
  }
  function buildEventRow(e) {
    const row = el("div", "tl-event-row");
    const modKey = e.kind.split(".")[0];
    const modCls = MOD_CLASS[modKey] || "tl-mod-sys";
    row.append(
      el("span", "tl-ev-time", e.time),
      el("span", "tl-ev-kind " + modCls, e.kind),
      el("span", "tl-ev-body", e.body)
    );
    return row;
  }
  function paintSearch(body) {
    body.replaceChildren();
    const filters = el("div", "tl-search-filters");
    const qInput = el("input", "tl-search-q");
    qInput.type = "text";
    qInput.placeholder = "search events\u2026";
    qInput.value = local7.searchQ;
    qInput.setAttribute("autocomplete", "off");
    const kindInput = el("input", "tl-search-kind");
    kindInput.type = "text";
    kindInput.placeholder = "kind prefix (e.g. log)";
    kindInput.value = local7.searchKind;
    kindInput.setAttribute("autocomplete", "off");
    const whoInput = el("input", "tl-search-who");
    whoInput.type = "text";
    whoInput.placeholder = "who (callsign)";
    whoInput.value = local7.searchWho;
    whoInput.setAttribute("autocomplete", "off");
    const btn = el("button", "tl-search-btn", "SEARCH");
    async function doSearch() {
      local7.searchQ = qInput.value;
      local7.searchKind = kindInput.value;
      local7.searchWho = whoInput.value;
      await loadFeed({ q: local7.searchQ, kind: local7.searchKind, who: local7.searchWho });
      paintSearchResults(body, resultsDiv);
    }
    btn.addEventListener("click", doSearch);
    [qInput, kindInput, whoInput].forEach(
      (inp) => inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doSearch();
        }
      })
    );
    filters.append(qInput, kindInput, whoInput, btn);
    body.append(filters);
    const resultsDiv = el("div", "tl-search-results");
    body.append(resultsDiv);
  }
  function paintSearchResults(body, resultsDiv) {
    resultsDiv.replaceChildren();
    if (!local7.events) {
      resultsDiv.append(el("div", "kb-empty", "Loading\u2026"));
      return;
    }
    if (!local7.events.length) {
      resultsDiv.append(el("div", "kb-empty", "No matches."));
      return;
    }
    const stream = el("div", "tl-stream");
    for (const e of local7.events) stream.append(buildEventRow(e));
    resultsDiv.append(stream);
  }
  function todayStr() {
    const d = /* @__PURE__ */ new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function paintExport2(body) {
    body.replaceChildren();
    body.append(el("div", "tl-section-hdr", "EXPORT TIMELINE"));
    const form = el("div", "tl-export-form");
    const fromLabel = el("label", "tl-export-label", "FROM ");
    const fromInput = el("input", "tl-export-date");
    fromInput.type = "date";
    fromInput.value = local7.exportFrom || todayStr();
    const toLabel = el("label", "tl-export-label", "TO ");
    const toInput = el("input", "tl-export-date");
    toInput.type = "date";
    toInput.value = local7.exportTo || todayStr();
    const btn = el("button", "tl-export-btn", "EXPORT MD");
    btn.addEventListener("click", async () => {
      local7.exportFrom = fromInput.value;
      local7.exportTo = toInput.value;
      try {
        const r = await fetch(`/api/t/export?from=${local7.exportFrom}&to=${local7.exportTo}&fmt=json`);
        local7.exportResult = (await r.json()).text;
      } catch (_) {
        local7.exportResult = "Export failed.";
      }
      paintExport2(body);
    });
    form.append(fromLabel, fromInput, toLabel, toInput, btn);
    body.append(form);
    if (local7.exportResult) {
      body.append(el("pre", "tl-export-preview", local7.exportResult));
    }
  }

  // src/modules/auspice.js
  var SUBS7 = { S: "sky", C: "chart", T: "tarot", O: "oracle", D: "daily", J: "journal", A: "almanac" };
  var local8 = {
    sub: "sky",
    // sky
    sky: null,
    upcoming: null,
    // chart
    chartLat: "",
    chartLon: "",
    chartDt: "",
    chartResult: null,
    // tarot
    spreads: null,
    decks: null,
    tarotSpread: null,
    tarotQuery: "",
    tarotResult: null,
    // oracle
    oracleSub: "iching",
    // iching | runes | traditions
    ichingQ: "",
    ichingResult: null,
    runeCount: 3,
    runeResult: null,
    traditions: null,
    // daily
    daily: null,
    // journal
    journalUnlocked: false,
    journalPin: "",
    journalPinError: "",
    journalEntries: null,
    journalBody: "",
    journalMood: "",
    journalDetail: null,
    // almanac
    almanacYear: (/* @__PURE__ */ new Date()).getFullYear(),
    almanac: null
  };
  function mountAuspice(root, store2, ctx2) {
    const screen = el("div", "screen-auspice auspice");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      const labels = ["sky", "chart", "tarot", "oracle", "daily", "journal", "almanac"];
      const keys = "SCTODJA";
      tabs.replaceChildren(...labels.map((s, i) => {
        const t = el("span", "kb-tab" + (local8.sub === s ? " active" : ""));
        t.append(el("span", "k", keys[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local8.sub = s;
          paint();
        });
        return t;
      }));
      if (local8.sub === "sky") paintSky(body);
      if (local8.sub === "chart") paintChart(body);
      if (local8.sub === "tarot") paintTarot(body);
      if (local8.sub === "oracle") paintOracle(body);
      if (local8.sub === "daily") paintDaily(body);
      if (local8.sub === "journal") paintJournal(body);
      if (local8.sub === "almanac") paintAlmanac(body);
    }
    function onKey(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
      if (SUBS7[e.key]) {
        local8.sub = SUBS7[e.key];
        e.preventDefault();
        paint();
      }
    }
    document.addEventListener("keydown", onKey, true);
    loadSky().then(paint);
    return function unmount() {
      document.removeEventListener("keydown", onKey, true);
    };
    async function loadSky() {
      const [a, b] = await Promise.all([
        fetch("/api/u/sky").then((r) => r.json()),
        fetch("/api/u/sky/upcoming?days=30").then((r) => r.json())
      ]);
      local8.sky = a;
      local8.upcoming = b;
    }
    function paintSky(c) {
      c.replaceChildren();
      if (!local8.sky) {
        c.append(el("div", "au-loading", "loading sky\u2026"));
        return;
      }
      const d = local8.sky;
      const hdr = el("div", "au-sky-hdr");
      const ph = el("div", "au-moon-phase");
      ph.append(
        el("span", "au-moon-glyph", d.moon?.glyph || "\u{1F311}"),
        el("span", "au-moon-name", d.moon?.phase_name || "\u2014"),
        el("span", "au-moon-illum", d.moon?.illumination != null ? Math.round(d.moon.illumination * 100) + "%" : "")
      );
      const sr = el("div", "au-sun-times");
      if (d.sun) {
        sr.append(
          el("span", "au-st-label", "rise "),
          el("span", "au-st-val", d.sun.rise || "\u2014"),
          el("span", "au-st-label", " transit "),
          el("span", "au-st-val", d.sun.transit || "\u2014"),
          el("span", "au-st-label", " set "),
          el("span", "au-st-val", d.sun.set || "\u2014")
        );
      }
      hdr.append(ph, sr);
      c.append(hdr);
      const grid = el("div", "au-sky-grid");
      const planets = d.planets || [];
      planets.forEach((p) => {
        const row = el("div", "au-sky-row");
        row.append(
          el("span", "au-sky-body", p.name),
          el("span", "au-sky-lon", p.lon != null ? p.lon.toFixed(1) + "\xB0" : "\u2014"),
          el("span", "au-sky-sign", p.zodiac || "\u2014"),
          el("span", "au-sky-sym", p.zodiac_sym || "")
        );
        grid.append(row);
      });
      c.append(grid);
      if (local8.upcoming?.events?.length) {
        c.append(el("div", "au-section-hdr", "upcoming"));
        const ul = el("div", "au-upcoming-list");
        local8.upcoming.events.slice(0, 8).forEach((ev) => {
          const row = el("div", "au-upcoming-row");
          row.append(
            el("span", "au-up-date", ev.date),
            el("span", "au-up-label", ev.label),
            el("span", "au-up-sign", ev.zodiac || "")
          );
          ul.append(row);
        });
        c.append(ul);
      }
    }
    function paintChart(c) {
      c.replaceChildren();
      c.append(el("div", "au-section-hdr", "natal chart"));
      const form = el("div", "au-chart-form");
      const latIn = el("input");
      latIn.className = "au-chart-lat";
      latIn.placeholder = "lat (e.g. 51.5)";
      latIn.value = local8.chartLat;
      const lonIn = el("input");
      lonIn.className = "au-chart-lon";
      lonIn.placeholder = "lon (e.g. -0.1)";
      lonIn.value = local8.chartLon;
      const dtIn = el("input");
      dtIn.className = "au-chart-dt";
      dtIn.placeholder = "birth UTC (YYYY-MM-DDTHH:MM)";
      dtIn.value = local8.chartDt;
      const btn = el("button", "au-chart-btn", "CAST");
      btn.addEventListener("click", async () => {
        local8.chartLat = latIn.value;
        local8.chartLon = lonIn.value;
        local8.chartDt = dtIn.value;
        const url = `/api/u/chart?lat=${encodeURIComponent(local8.chartLat)}&lon=${encodeURIComponent(local8.chartLon)}&dt_birth=${encodeURIComponent(local8.chartDt)}`;
        local8.chartResult = await fetch(url).then((r) => r.json());
        paintChart(c);
      });
      form.append(latIn, lonIn, dtIn, btn);
      c.append(form);
      if (local8.chartResult) {
        const res = local8.chartResult;
        const grid = el("div", "au-sky-grid");
        (res.planets || []).forEach((p) => {
          const row = el("div", "au-sky-row");
          row.append(
            el("span", "au-sky-body", p.name),
            el("span", "au-sky-lon", p.lon != null ? p.lon.toFixed(1) + "\xB0" : "\u2014"),
            el("span", "au-sky-sign", p.zodiac || "\u2014")
          );
          grid.append(row);
        });
        if (res.asc) {
          const a = el("div", "au-chart-asc");
          a.append(el("span", "au-st-label", "ASC "), el("span", "au-sky-sign", res.asc));
          c.append(a);
        }
        c.append(grid);
      }
    }
    async function loadTarot() {
      if (!local8.spreads) local8.spreads = await fetch("/api/u/spreads").then((r) => r.json());
      if (!local8.decks) local8.decks = await fetch("/api/u/decks").then((r) => r.json());
      if (!local8.tarotSpread && local8.spreads?.spreads?.length) local8.tarotSpread = local8.spreads.spreads[0].id;
    }
    function paintTarot(c) {
      c.replaceChildren();
      c.append(el("div", "au-section-hdr", "tarot reading"));
      if (!local8.spreads) {
        loadTarot().then(() => paintTarot(c));
        c.append(el("div", "au-loading", "loading\u2026"));
        return;
      }
      const form = el("div", "au-tarot-form");
      const sel = el("select");
      sel.className = "au-tarot-spread";
      (local8.spreads?.spreads || []).forEach((s) => {
        const o = el("option");
        o.value = s.id;
        o.textContent = s.name;
        if (s.id === local8.tarotSpread) o.selected = true;
        sel.append(o);
      });
      sel.addEventListener("change", () => {
        local8.tarotSpread = sel.value;
      });
      const qIn = el("input");
      qIn.className = "au-tarot-query";
      qIn.placeholder = "question (optional)";
      qIn.value = local8.tarotQuery;
      const btn = el("button", "au-tarot-btn", "DRAW");
      btn.addEventListener("click", async () => {
        local8.tarotQuery = qIn.value;
        local8.tarotResult = await fetch("/api/u/readings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deck: "rws", spread: local8.tarotSpread, query: local8.tarotQuery })
        }).then((r) => r.json());
        paintTarot(c);
      });
      form.append(sel, qIn, btn);
      c.append(form);
      if (local8.tarotResult) {
        const res = local8.tarotResult;
        if (res.query) c.append(el("div", "au-tarot-question", "\u2726 " + res.query));
        const cards = el("div", "au-tarot-cards");
        (res.cards || []).forEach((card) => {
          const row = el("div", "au-tarot-card");
          const rev = card.reversed ? " (rev)" : "";
          row.append(
            el("span", "au-card-pos", card.position || ""),
            el("span", "au-card-name", card.name + rev),
            el("span", "au-card-kw", (card.keywords || []).slice(0, 3).join(" \xB7 "))
          );
          cards.append(row);
        });
        c.append(cards);
      }
    }
    const ORACLE_SUBS = { I: "iching", R: "runes", T: "traditions" };
    function paintOracle(c) {
      c.replaceChildren();
      const subTabs = el("div", "au-oracle-tabs");
      [["I", "iching"], ["R", "runes"], ["T", "traditions"]].forEach(([k, s]) => {
        const t = el("span", "au-oracle-tab" + (local8.oracleSub === s ? " active" : ""));
        t.append(el("span", "k", k), el("span", "l", " " + s));
        t.addEventListener("click", () => {
          local8.oracleSub = s;
          paintOracle(c);
        });
        subTabs.append(t);
      });
      c.append(subTabs);
      if (local8.oracleSub === "iching") paintIching(c);
      if (local8.oracleSub === "runes") paintRunes(c);
      if (local8.oracleSub === "traditions") paintTraditions(c);
    }
    function paintIching(c) {
      const form = el("div", "au-oracle-form");
      const qIn = el("input");
      qIn.className = "au-iching-q";
      qIn.placeholder = "question";
      qIn.value = local8.ichingQ;
      const btn = el("button", "au-oracle-btn", "CAST");
      btn.addEventListener("click", async () => {
        local8.ichingQ = qIn.value;
        local8.ichingResult = await fetch(`/api/u/oracle/iching?q=${encodeURIComponent(local8.ichingQ)}`).then((r) => r.json());
        paint();
      });
      form.append(qIn, btn);
      c.append(form);
      if (local8.ichingResult) {
        const res = local8.ichingResult;
        const card = el("div", "au-iching-card");
        card.append(
          el("div", "au-iching-hex", res.hexagram?.symbol || ""),
          el("div", "au-iching-num", "Hexagram " + (res.hexagram?.number || "")),
          el("div", "au-iching-name", res.hexagram?.name || ""),
          el("div", "au-iching-judge", res.hexagram?.judgment || "")
        );
        if (res.changing_lines?.length) {
          card.append(el("div", "au-iching-changing", "Changing lines: " + res.changing_lines.join(", ")));
        }
        c.append(card);
      }
    }
    function paintRunes(c) {
      const form = el("div", "au-oracle-form");
      const countSel = el("select");
      countSel.className = "au-rune-count";
      [1, 3, 9].forEach((n) => {
        const o = el("option");
        o.value = n;
        o.textContent = n + " rune" + (n > 1 ? "s" : "");
        if (n === local8.runeCount) o.selected = true;
        countSel.append(o);
      });
      countSel.addEventListener("change", () => {
        local8.runeCount = +countSel.value;
      });
      const btn = el("button", "au-oracle-btn", "DRAW");
      btn.addEventListener("click", async () => {
        local8.runeResult = await fetch(`/api/u/oracle/runes?count=${local8.runeCount}`).then((r) => r.json());
        paint();
      });
      form.append(countSel, btn);
      c.append(form);
      if (local8.runeResult) {
        const runes = el("div", "au-rune-row");
        (local8.runeResult.runes || []).forEach((r) => {
          const rw = el("div", "au-rune-card");
          rw.append(
            el("div", "au-rune-glyph", r.glyph || ""),
            el("div", "au-rune-name", r.name),
            el("div", "au-rune-kw", (r.keywords || []).slice(0, 2).join(" \xB7 "))
          );
          runes.append(rw);
        });
        c.append(runes);
      }
    }
    function paintTraditions(c) {
      if (!local8.traditions) {
        fetch("/api/u/oracle/traditions").then((r) => r.json()).then((d) => {
          local8.traditions = d;
          paint();
        });
        c.append(el("div", "au-loading", "loading\u2026"));
        return;
      }
      const list = el("div", "au-trad-list");
      (local8.traditions.traditions || []).forEach((t) => {
        const row = el("div", "au-trad-row");
        row.append(el("span", "au-trad-name", t.name), el("span", "au-trad-count", t.card_count + " cards"));
        list.append(row);
      });
      c.append(list);
    }
    function paintDaily(c) {
      c.replaceChildren();
      c.append(el("div", "au-section-hdr", "daily reading"));
      if (!local8.daily) {
        fetch("/api/u/daily").then((r) => r.json()).then((d2) => {
          local8.daily = d2;
          paintDaily(c);
        });
        c.append(el("div", "au-loading", "loading\u2026"));
        return;
      }
      const d = local8.daily;
      const card = el("div", "au-daily-card");
      card.append(el("div", "au-daily-date", d.date || ""));
      if (d.moon) {
        const m = el("div", "au-daily-moon");
        m.append(el("span", "au-moon-glyph", d.moon.glyph || ""), el("span", "", " " + d.moon.phase_name));
        card.append(m);
      }
      if (d.tarot) {
        const t = el("div", "au-daily-tarot");
        t.append(el("span", "au-card-name", d.tarot.name), el("span", "au-card-kw", (d.tarot.keywords || []).slice(0, 3).join(" \xB7 ")));
        card.append(el("div", "au-daily-lbl", "card of the day"), t);
      }
      if (d.rune) {
        const r = el("div", "au-daily-rune");
        r.append(el("span", "au-rune-glyph", d.rune.glyph || ""), el("span", "", " " + d.rune.name));
        card.append(el("div", "au-daily-lbl", "rune of the day"), r);
      }
      if (d.planet_in_sign) card.append(el("div", "au-daily-planet", d.planet_in_sign));
      c.append(card);
    }
    function paintJournal(c) {
      c.replaceChildren();
      c.append(el("div", "au-section-hdr", "encrypted journal"));
      if (!local8.journalUnlocked) {
        const pinForm = el("div", "au-pin-form");
        const pinIn = el("input");
        pinIn.className = "au-pin-input";
        pinIn.type = "password";
        pinIn.placeholder = "PIN";
        const unlockBtn = el("button", "au-pin-btn", "UNLOCK");
        unlockBtn.addEventListener("click", async () => {
          const res = await fetch("/api/u/journal/unlock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: pinIn.value })
          }).then((r) => r.json());
          if (res.ok) {
            local8.journalUnlocked = true;
            local8.journalPinError = "";
            local8.journalEntries = null;
            paintJournal(c);
          } else {
            local8.journalPinError = res.error || "wrong PIN";
            paintJournal(c);
          }
        });
        pinForm.append(pinIn, unlockBtn);
        if (local8.journalPinError) pinForm.append(el("div", "au-pin-error", local8.journalPinError));
        c.append(pinForm);
        return;
      }
      const compose = el("div", "au-journal-compose");
      const bodyIn = el("textarea");
      bodyIn.className = "au-journal-body";
      bodyIn.placeholder = "entry\u2026";
      bodyIn.value = local8.journalBody;
      bodyIn.addEventListener("input", () => {
        local8.journalBody = bodyIn.value;
      });
      const moodIn = el("input");
      moodIn.className = "au-journal-mood";
      moodIn.placeholder = "mood 1\u20135";
      moodIn.value = local8.journalMood;
      const saveBtn = el("button", "au-journal-save", "SAVE");
      saveBtn.addEventListener("click", async () => {
        local8.journalMood = moodIn.value;
        await fetch("/api/u/journal/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: local8.journalBody, mood: local8.journalMood ? +local8.journalMood : null })
        });
        local8.journalBody = "";
        local8.journalMood = "";
        local8.journalEntries = null;
        paintJournal(c);
      });
      compose.append(bodyIn, moodIn, saveBtn);
      c.append(compose);
      if (!local8.journalEntries) {
        fetch("/api/u/journal/entries").then((r) => r.json()).then((d) => {
          local8.journalEntries = d.entries || [];
          paintJournal(c);
        });
        return;
      }
      const entries = el("div", "au-journal-entries");
      local8.journalEntries.slice(0, 20).forEach((e) => {
        const row = el("div", "au-journal-row");
        row.append(
          el("span", "au-journal-date", e.date || ""),
          el("span", "au-journal-preview", (e.preview || "").substring(0, 60))
        );
        if (e.mood) row.append(el("span", "au-journal-mood-badge", "\u2665".repeat(e.mood)));
        row.addEventListener("click", async () => {
          local8.journalDetail = await fetch(`/api/u/journal/entries/${e.id}`).then((r) => r.json());
          paintJournalDetail(c, local8.journalDetail);
        });
        entries.append(row);
      });
      c.append(entries);
    }
    function paintJournalDetail(c, entry) {
      c.replaceChildren();
      const back = el("button", "au-back-btn", "\u2190 back");
      back.addEventListener("click", () => paintJournal(c));
      c.append(back);
      const card = el("div", "au-journal-detail");
      card.append(
        el("div", "au-journal-date", entry.date || ""),
        el("div", "au-journal-full", entry.body || "")
      );
      if (entry.mood) card.append(el("div", "au-journal-mood-badge", "mood: " + entry.mood));
      c.append(card);
    }
    function paintAlmanac(c) {
      c.replaceChildren();
      const controls = el("div", "au-almanac-controls");
      const prevBtn = el("button", "au-almanac-nav", "\u25C0");
      const nextBtn = el("button", "au-almanac-nav", "\u25B6");
      const yearLbl = el("span", "au-almanac-year", String(local8.almanacYear));
      prevBtn.addEventListener("click", () => {
        local8.almanacYear--;
        local8.almanac = null;
        paintAlmanac(c);
        loadAlmanac().then(() => paintAlmanac(c));
      });
      nextBtn.addEventListener("click", () => {
        local8.almanacYear++;
        local8.almanac = null;
        paintAlmanac(c);
        loadAlmanac().then(() => paintAlmanac(c));
      });
      controls.append(prevBtn, yearLbl, nextBtn);
      c.append(controls);
      if (!local8.almanac) {
        loadAlmanac().then(() => paintAlmanac(c));
        c.append(el("div", "au-loading", "loading almanac\u2026"));
        return;
      }
      c.append(el("div", "au-section-hdr", "wheel of the year \u2014 sabbats"));
      const sabbats = el("div", "au-sabbat-list");
      (local8.almanac.sabbats || []).forEach((s) => {
        const row = el("div", "au-sabbat-row");
        row.append(
          el("span", "au-sabbat-date", s.date),
          el("span", "au-sabbat-name", s.name),
          el("span", "au-sabbat-lon", s.solar_lon != null ? s.solar_lon + "\xB0" : "")
        );
        sabbats.append(row);
      });
      c.append(sabbats);
      c.append(el("div", "au-section-hdr", "lunar calendar"));
      const lunar = el("div", "au-lunar-grid");
      (local8.almanac.lunar_calendar || []).slice(0, 4).forEach((mo) => {
        const col = el("div", "au-lunar-month");
        col.append(el("div", "au-lunar-month-name", mo.month_name));
        (mo.phases || []).forEach((ph) => {
          const row = el("div", "au-lunar-phase-row");
          row.append(
            el("span", "au-moon-glyph", ph.glyph || ""),
            el("span", "au-lunar-phase", ph.phase),
            el("span", "au-lunar-date", ph.date)
          );
          col.append(row);
        });
        lunar.append(col);
      });
      c.append(lunar);
    }
    async function loadAlmanac() {
      local8.almanac = await fetch(`/api/u/almanac?year=${local8.almanacYear}`).then((r) => r.json());
    }
  }

  // src/modules/signal.js
  var SUBS8 = { W: "weather", A: "air", P: "aprs", M: "mesh", S: "scan", B: "bands" };
  var local9 = {
    sub: "weather",
    passes: null,
    aircraft: null,
    aprs: null,
    mesh: null,
    scanBand: "2m",
    scan: null,
    bands: null,
    decoding: false
  };
  function mountSignal(root, store2, ctx2) {
    const screen = el("div", "screen-signal signal");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      const labels = ["weather", "air", "aprs", "mesh", "scan", "bands"];
      const keys = "WAPMSB";
      tabs.replaceChildren(...labels.map((s, i) => {
        const t = el("span", "kb-tab" + (local9.sub === s ? " active" : ""));
        t.append(el("span", "k", keys[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local9.sub = s;
          paint();
        });
        return t;
      }));
      body.replaceChildren();
      switch (local9.sub) {
        case "weather":
          paintWeather(body);
          break;
        case "air":
          paintAir(body);
          break;
        case "aprs":
          paintAprs(body);
          break;
        case "mesh":
          paintMesh(body);
          break;
        case "scan":
          paintScan(body);
          break;
        case "bands":
          paintBands(body);
          break;
      }
    }
    function paintWeather(c) {
      const hdr = el("div", "sig-hdr");
      const title = el("div", "sig-title", "SATELLITE WEATHER");
      const refresh3 = el("button", "kb-btn", "R REFRESH");
      const decode3 = el("button", "kb-btn sig-decode-btn", "D DECODE NEXT");
      hdr.append(title, refresh3, decode3);
      c.append(hdr);
      if (!local9.passes) {
        const loading = el("div", "sig-empty", "Loading passes...");
        c.append(loading);
        fetch("/api/s/weather/passes?hours=24").then((r) => r.json()).then((d) => {
          local9.passes = d.passes;
          paint();
        });
        return;
      }
      if (local9.passes.length === 0) {
        c.append(el("div", "sig-empty", "No passes in next 24 hours."));
      } else {
        const grid = el("div", "sig-pass-grid");
        const hdrRow = el("div", "sig-pass-row sig-pass-hdr");
        hdrRow.append(
          el("span", "sig-col-sat", "SAT"),
          el("span", "sig-col-freq", "FREQ MHz"),
          el("span", "sig-col-aos", "AOS UTC"),
          el("span", "sig-col-los", "LOS UTC"),
          el("span", "sig-col-el", "EL"),
          el("span", "sig-col-dir", "DIR")
        );
        grid.append(hdrRow);
        for (const p of local9.passes) {
          const row = el("div", "sig-pass-row");
          row.append(
            el("span", "sig-col-sat", p.sat),
            el("span", "sig-col-freq sig-accent", p.freq_mhz.toFixed(3)),
            el("span", "sig-col-aos", p.aos.slice(11, 16)),
            el("span", "sig-col-los", p.los.slice(11, 16)),
            el("span", "sig-col-el", p.max_el + "\xB0"),
            el("span", "sig-col-dir", p.direction)
          );
          grid.append(row);
        }
        c.append(grid);
      }
      const note = el(
        "div",
        "sig-note",
        "Real passes: set OVERSEER_SIGNAL_SDR=rtlsdr"
      );
      c.append(note);
      refresh3.addEventListener("click", () => {
        local9.passes = null;
        paint();
      });
      decode3.addEventListener("click", () => {
        if (local9.decoding) return;
        local9.decoding = true;
        const next = local9.passes && local9.passes[0];
        const sat = next ? next.sat : "NOAA-19";
        fetch("/api/s/weather/decode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sat })
        }).then((r) => r.json()).then((d) => {
          local9.decoding = false;
          paint();
        }).catch(() => {
          local9.decoding = false;
        });
      });
    }
    function paintAir(c) {
      const hdr = el("div", "sig-hdr");
      hdr.append(el("div", "sig-title", "ADS-B TRACKS"));
      const refresh3 = el("button", "kb-btn", "R REFRESH");
      hdr.append(refresh3);
      c.append(hdr);
      if (!local9.aircraft) {
        c.append(el("div", "sig-empty", "Loading..."));
        fetch("/api/s/air").then((r) => r.json()).then((d) => {
          local9.aircraft = d.aircraft;
          paint();
        });
        return;
      }
      if (local9.aircraft.length === 0) {
        c.append(el("div", "sig-empty", "No aircraft in range."));
      } else {
        const grid = el("div", "sig-air-grid");
        const hdrRow = el("div", "sig-air-row sig-air-hdr");
        hdrRow.append(
          el("span", "sig-ac-icao", "ICAO"),
          el("span", "sig-ac-call", "CALLSIGN"),
          el("span", "sig-ac-alt", "ALT ft"),
          el("span", "sig-ac-spd", "SPD kt"),
          el("span", "sig-ac-hdg", "HDG"),
          el("span", "sig-ac-sq", "SQ")
        );
        grid.append(hdrRow);
        for (const a of local9.aircraft) {
          const row = el("div", "sig-air-row" + (a.squawk === "7700" ? " sig-emerg" : ""));
          row.append(
            el("span", "sig-ac-icao sig-mono", a.icao),
            el("span", "sig-ac-call sig-accent", a.callsign),
            el("span", "sig-ac-alt  sig-mono", a.alt_ft.toLocaleString()),
            el("span", "sig-ac-spd  sig-mono", String(a.speed_kt)),
            el("span", "sig-ac-hdg  sig-mono", String(a.heading).padStart(3, "0")),
            el("span", "sig-ac-sq   sig-mono", a.squawk)
          );
          grid.append(row);
        }
        c.append(grid);
      }
      refresh3.addEventListener("click", () => {
        local9.aircraft = null;
        paint();
      });
    }
    function paintAprs(c) {
      const hdr = el("div", "sig-hdr");
      hdr.append(el("div", "sig-title", "APRS FEED"));
      const refresh3 = el("button", "kb-btn", "R REFRESH");
      hdr.append(refresh3);
      c.append(hdr);
      if (!local9.aprs) {
        c.append(el("div", "sig-empty", "Loading..."));
        fetch("/api/s/aprs").then((r) => r.json()).then((d) => {
          local9.aprs = d.packets;
          paint();
        });
        return;
      }
      if (local9.aprs.length === 0) {
        c.append(el("div", "sig-empty", "No APRS packets."));
      } else {
        for (const p of local9.aprs) {
          const row = el("div", "sig-aprs-row");
          const age = Math.round(Date.now() / 1e3 - p.at);
          row.append(
            el("span", "sig-aprs-call sig-accent", p.callsign),
            el("span", "sig-aprs-sym sig-mono", "[" + p.symbol + "]"),
            el("span", "sig-aprs-comment sig-dim", p.comment),
            el("span", "sig-aprs-age sig-dim", age + "s ago")
          );
          c.append(row);
        }
      }
      const note = el("div", "sig-note", "Real packets: OVERSEER_SIGNAL_APRS=direwolf");
      c.append(note);
      refresh3.addEventListener("click", () => {
        local9.aprs = null;
        paint();
      });
    }
    function paintMesh(c) {
      const hdr = el("div", "sig-hdr");
      hdr.append(el("div", "sig-title", "MESH NODES"));
      const refresh3 = el("button", "kb-btn", "R REFRESH");
      hdr.append(refresh3);
      c.append(hdr);
      if (!local9.mesh) {
        c.append(el("div", "sig-empty", "Loading..."));
        fetch("/api/s/mesh").then((r) => r.json()).then((d) => {
          local9.mesh = d.nodes;
          paint();
        });
        return;
      }
      if (local9.mesh.length === 0) {
        c.append(el("div", "sig-empty", "No mesh nodes seen. Check LoRa hardware."));
      } else {
        for (const n of local9.mesh) {
          const row = el("div", "sig-mesh-row");
          row.append(
            el("span", "sig-mesh-id sig-accent sig-mono", n.id || n.node_id || "?"),
            el("span", "sig-mesh-name", n.short_name || n.name || ""),
            el("span", "sig-mesh-snr sig-dim", n.snr != null ? "SNR " + n.snr + " dB" : "")
          );
          c.append(row);
        }
      }
      refresh3.addEventListener("click", () => {
        local9.mesh = null;
        paint();
      });
    }
    function paintScan(c) {
      const hdr = el("div", "sig-hdr");
      hdr.append(el("div", "sig-title", "SPECTRUM SCAN"));
      const bands = ["2m", "70cm", "HF", "VHF", "UHF"];
      const sel = el("select", "sig-band-sel");
      for (const b of bands) {
        const opt = el("option", "", b);
        opt.value = b;
        if (b === local9.scanBand) opt.selected = true;
        sel.append(opt);
      }
      const go = el("button", "kb-btn", "S SCAN");
      hdr.append(sel, go);
      c.append(hdr);
      if (!local9.scan) {
        c.append(el("div", "sig-empty", "Press S to scan."));
      } else {
        const s = local9.scan;
        const info = el("div", "sig-scan-info");
        info.append(
          el("span", "sig-scan-band sig-accent", s.band),
          el("span", "sig-dim", " " + s.freq_lo + "\u2013" + s.freq_hi + " " + s.unit)
        );
        c.append(info);
        const chart = el("pre", "sig-scan-chart");
        const min_dbm = -120, max_dbm = -50;
        const width = 48;
        let lines = "";
        for (let i = 0; i < s.buckets.length; i += 4) {
          const avg = (s.buckets[i] + (s.buckets[i + 1] || s.buckets[i]) + (s.buckets[i + 2] || s.buckets[i]) + (s.buckets[i + 3] || s.buckets[i])) / 4;
          const pct = Math.max(0, Math.min(1, (avg - min_dbm) / (max_dbm - min_dbm)));
          const filled = Math.round(pct * width);
          const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
          const freq = (s.freq_lo + i / s.buckets.length * (s.freq_hi - s.freq_lo)).toFixed(2);
          lines += freq.padStart(7) + " |" + bar + "| " + avg.toFixed(0) + " dBm\n";
        }
        chart.textContent = lines;
        c.append(chart);
      }
      go.addEventListener("click", () => {
        local9.scanBand = sel.value;
        local9.scan = null;
        c.append(el("div", "sig-empty", "Scanning..."));
        fetch("/api/s/scan?band=" + encodeURIComponent(local9.scanBand)).then((r) => r.json()).then((d) => {
          local9.scan = d;
          paint();
        });
      });
    }
    function paintBands(c) {
      c.append(el("div", "sig-title", "BAND REFERENCE"));
      if (!local9.bands) {
        fetch("/api/s/bands").then((r) => r.json()).then((d) => {
          local9.bands = d.bands;
          paint();
        });
        return;
      }
      const grid = el("div", "sig-band-grid");
      const hdrRow = el("div", "sig-band-row sig-band-hdr");
      hdrRow.append(
        el("span", "sig-b-name", "BAND"),
        el("span", "sig-b-lo", "LOW MHz"),
        el("span", "sig-b-hi", "HIGH MHz")
      );
      grid.append(hdrRow);
      for (const b of local9.bands) {
        const row = el("div", "sig-band-row");
        row.append(
          el("span", "sig-b-name sig-accent", b.band),
          el("span", "sig-b-lo  sig-mono", b.freq_lo.toFixed(1)),
          el("span", "sig-b-hi  sig-mono", b.freq_hi.toFixed(1))
        );
        grid.append(row);
      }
      c.append(grid);
    }
    function onKey(e) {
      const k = e.key.toUpperCase();
      if (SUBS8[k]) {
        local9.sub = SUBS8[k];
        paint();
        return;
      }
    }
    screen.setAttribute("tabindex", "0");
    screen.addEventListener("keydown", onKey);
    screen.focus();
    paint();
    return () => screen.removeEventListener("keydown", onKey);
  }

  // src/modules/recreation.js
  var SUBS9 = { F: "fortune", W: "wiki", G: "games", C: "chess", Z: "zork", R: "reader" };
  var local10 = {
    sub: "fortune",
    fortune: null,
    wiki: null,
    games: null,
    // chess
    chessGame: null,
    chessMoveInput: "",
    // zork
    zorkSession: null,
    zorkHistory: [],
    zorkInput: "",
    zorkDone: false,
    // reader
    reading: null
  };
  function mountRecreation(root, store2, ctx2) {
    const screen = el("div", "screen-recreation recreation");
    root.replaceChildren(screen);
    const tabs = el("div", "kb-tabs");
    const body = el("div", "kb-body");
    screen.append(tabs, body);
    function paint() {
      const labels = ["fortune", "wiki", "games", "chess", "zork", "reader"];
      const keys = "FWGCZR";
      tabs.replaceChildren(...labels.map((s, i) => {
        const t = el("span", "kb-tab" + (local10.sub === s ? " active" : ""));
        t.append(el("span", "k", keys[i]), el("span", "l", s));
        t.addEventListener("click", () => {
          local10.sub = s;
          paint();
        });
        return t;
      }));
      body.replaceChildren();
      switch (local10.sub) {
        case "fortune":
          paintFortune(body);
          break;
        case "wiki":
          paintWiki(body);
          break;
        case "games":
          paintGames(body);
          break;
        case "chess":
          paintChess(body);
          break;
        case "zork":
          paintZork(body);
          break;
        case "reader":
          paintReader(body);
          break;
      }
    }
    function paintFortune(c) {
      const hdr = el("div", "rec-hdr");
      hdr.append(el("div", "rec-title", "FORTUNE"));
      const draw = el("button", "kb-btn", "D DRAW");
      hdr.append(draw);
      c.append(hdr);
      if (local10.fortune) {
        const box = el("div", "rec-fortune-box");
        const q = el("blockquote", "rec-fortune-quote", local10.fortune.quote);
        box.append(q);
        c.append(box);
      } else {
        c.append(el("div", "rec-empty", "Press D to draw a fortune."));
      }
      draw.addEventListener("click", () => {
        fetch("/api/r/fortune").then((r) => r.json()).then((d) => {
          local10.fortune = d;
          paint();
        });
      });
    }
    function paintWiki(c) {
      const hdr = el("div", "rec-hdr");
      hdr.append(el("div", "rec-title", "WIKI ROULETTE"));
      const spin = el("button", "kb-btn", "S SPIN");
      hdr.append(spin);
      c.append(hdr);
      if (local10.wiki) {
        const art = el("div", "rec-article");
        art.append(
          el("div", "rec-article-title", local10.wiki.title),
          el("div", "rec-article-body", local10.wiki.summary),
          el("div", "rec-article-src rec-dim", "Source: " + local10.wiki.zim)
        );
        c.append(art);
      } else {
        c.append(el("div", "rec-empty", "Press S to spin the wiki wheel."));
      }
      spin.addEventListener("click", () => {
        fetch("/api/r/wiki/random").then((r) => r.json()).then((d) => {
          local10.wiki = d;
          paint();
        });
      });
    }
    function paintGames(c) {
      c.append(el("div", "rec-title", "GAME REGISTRY"));
      if (!local10.games) {
        fetch("/api/r/games").then((r) => r.json()).then((d) => {
          local10.games = d.games;
          paint();
        });
        return;
      }
      const grid = el("div", "rec-games-grid");
      for (const g of local10.games) {
        const row = el("div", "rec-game-row" + (g.status === "available" ? " rec-avail" : " rec-coming"));
        const key = el("span", "k rec-game-key", g.hotkey);
        const name = el("span", "rec-game-name" + (g.status === "available" ? " rec-accent" : " rec-dim"), g.name);
        const stat = el("span", "rec-game-stat rec-dim", g.status);
        row.append(key, name, stat);
        row.addEventListener("click", () => {
          if (g.status !== "available") return;
          const sub = { chess: "chess", zork: "zork", wiki: "wiki", fortune: "fortune", reader: "reader" }[g.id];
          if (sub) {
            local10.sub = sub;
            paint();
          }
        });
        grid.append(row);
      }
      c.append(grid);
    }
    function paintChess(c) {
      const hdr = el("div", "rec-hdr");
      hdr.append(el("div", "rec-title", "CHESS"));
      const newGame = el("button", "kb-btn", "N NEW GAME");
      hdr.append(newGame);
      c.append(hdr);
      if (!local10.chessGame) {
        c.append(el("div", "rec-empty", "Press N to start a game."));
      } else {
        const g = local10.chessGame;
        const info = el("div", "rec-chess-info");
        info.append(
          el(
            "span",
            "rec-chess-turn rec-accent",
            "To move: " + g.to_move.toUpperCase()
          ),
          el("span", "rec-dim", " | Moves: " + g.pgn.length)
        );
        c.append(info);
        const board = el("pre", "rec-chess-board", g.board);
        c.append(board);
        const pgn = el(
          "div",
          "rec-pgn rec-dim rec-mono",
          g.pgn.length ? g.pgn.join(" ") : "(no moves yet)"
        );
        c.append(pgn);
        const moveRow = el("div", "rec-move-row");
        const inp = el("input", "rec-move-inp");
        inp.placeholder = "e4, Nf3, O-O ...";
        inp.value = local10.chessMoveInput;
        const submit = el("button", "kb-btn", "ENTER");
        moveRow.append(inp, submit);
        c.append(moveRow);
        const doMove = () => {
          const mv = inp.value.trim();
          if (!mv) return;
          fetch("/api/r/chess/" + g.id + "/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ move: mv })
          }).then((r) => r.json()).then((d) => {
            local10.chessGame = d;
            local10.chessMoveInput = "";
            paint();
          });
        };
        submit.addEventListener("click", doMove);
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") doMove();
        });
        inp.focus();
      }
      newGame.addEventListener("click", () => {
        fetch("/api/r/chess/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json()).then((d) => {
          local10.chessGame = d;
          paint();
        });
      });
    }
    function paintZork(c) {
      const hdr = el("div", "rec-hdr");
      hdr.append(el("div", "rec-title", "BUNKER ADVENTURE"));
      const startBtn = el("button", "kb-btn", "N NEW GAME");
      hdr.append(startBtn);
      c.append(hdr);
      if (!local10.zorkSession) {
        c.append(el("div", "rec-empty", "Press N to enter the bunker."));
      } else {
        const hist = el("div", "rec-zork-hist");
        for (const [cmd, resp] of local10.zorkHistory) {
          if (cmd) {
            const cmdEl = el("div", "rec-zork-cmd");
            cmdEl.append(el("span", "rec-accent", "> "), el("span", "", cmd));
            hist.append(cmdEl);
          }
          hist.append(el("div", "rec-zork-resp", resp));
        }
        c.append(hist);
        if (!local10.zorkDone) {
          const inputRow = el("div", "rec-zork-input-row");
          const prompt = el("span", "rec-accent", "> ");
          const inp = el("input", "rec-zork-inp");
          inp.placeholder = "look, go north, take torch...";
          inputRow.append(prompt, inp);
          c.append(inputRow);
          inp.focus();
          inp.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            const cmd = inp.value.trim();
            if (!cmd) return;
            fetch("/api/r/zork/" + local10.zorkSession + "/cmd", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cmd })
            }).then((r) => r.json()).then((d) => {
              local10.zorkHistory.push([cmd, d.response]);
              local10.zorkDone = d.done;
              paint();
              setTimeout(() => {
                const h = body.querySelector(".rec-zork-hist");
                if (h) h.scrollTop = h.scrollHeight;
              }, 10);
            });
          });
        } else {
          c.append(el("div", "rec-dim", "-- GAME OVER -- Press N to play again."));
        }
      }
      startBtn.addEventListener("click", () => {
        const sid = "z" + Date.now();
        fetch("/api/r/zork/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: sid })
        }).then((r) => r.json()).then((d) => {
          local10.zorkSession = d.session;
          local10.zorkHistory = [["", d.response]];
          local10.zorkDone = false;
          paint();
        });
      });
    }
    function paintReader(c) {
      const hdr = el("div", "rec-hdr");
      hdr.append(el("div", "rec-title", "READING PROGRESS"));
      const refresh3 = el("button", "kb-btn", "R REFRESH");
      hdr.append(refresh3);
      c.append(hdr);
      if (!local10.reading) {
        fetch("/api/r/reader/progress").then((r) => r.json()).then((d) => {
          local10.reading = d.progress;
          paint();
        });
        return;
      }
      if (local10.reading.length === 0) {
        c.append(el("div", "rec-empty", "No reading progress stored yet."));
      } else {
        for (const rp of local10.reading) {
          const row = el("div", "rec-reader-row");
          const pct = Math.round(rp.position * 100);
          const bar = el("div", "rec-reader-bar");
          const fill = el("div", "rec-reader-fill");
          fill.style.width = pct + "%";
          bar.append(fill);
          row.append(
            el("div", "rec-reader-title rec-accent", rp.article),
            el("div", "rec-reader-src rec-dim", rp.archive),
            bar,
            el("div", "rec-reader-pct rec-mono", pct + "%")
          );
          if (rp.bookmark) {
            row.append(el("div", "rec-reader-bk rec-dim", "Bookmark: " + rp.bookmark));
          }
          c.append(row);
        }
      }
      refresh3.addEventListener("click", () => {
        local10.reading = null;
        paint();
      });
    }
    function onKey(e) {
      const k = e.key.toUpperCase();
      if (SUBS9[k]) {
        local10.sub = SUBS9[k];
        paint();
        return;
      }
    }
    screen.setAttribute("tabindex", "0");
    screen.addEventListener("keydown", onKey);
    screen.focus();
    paint();
    return () => screen.removeEventListener("keydown", onKey);
  }

  // src/modules/_screens.js
  var SCREENS = {
    HOME: mountHome,
    POWER: mountPower,
    KNOWLEDGE: mountKnowledge,
    COMMS: mountComms,
    MEDICAL: mountMedical,
    NAVIGATION: mountNavigation,
    LOG: mountLog,
    INVENTORY: mountInventory,
    TIMELINE: mountTimeline,
    AUSPICE: mountAuspice,
    SIGNAL: mountSignal,
    RECREATION: mountRecreation
  };

  // src/modules/_placeholder.js
  function mountPlaceholder(root, store2) {
    const id = (store2.get("module") || "HOME").toLowerCase();
    const m = moduleById(id) || moduleById("home") || {
      name: id.toUpperCase(),
      desc: "\u2014",
      sprint: "?"
    };
    const wrap = el("div", "module-placeholder");
    wrap.append(
      el("div", "ph-name", txt(m.name)),
      el("div", "ph-desc", txt(m.desc)),
      el("div", "ph-line", txt(`scheduled for Sprint ${m.sprint}`)),
      el("div", "ph-back", txt("press Q or H to return HOME \xB7 : for palette"))
    );
    root.replaceChildren(wrap);
    return void 0;
  }

  // src/main.js
  var store = createStore(initialState());
  mountStatusBar(document.getElementById("statusbar"), store);
  mountBreadcrumb(document.getElementById("breadcrumb"), store);
  mountHotkeyBar(document.getElementById("hotkeybar"), store);
  var palette = mountPalette(document.getElementById("palette"), store);
  var transport = makeTransport({ store });
  var queue = new ActionQueue({ store });
  var dispatch = makeDispatcher({ store, transport, queue });
  var ctx = { transport, queue, dispatch, store };
  var content = document.getElementById("content");
  var currentUnmount = null;
  function dispatchScreen(name) {
    if (typeof currentUnmount === "function") {
      try {
        currentUnmount();
      } catch (e) {
        console.error("[shell] cleanup threw", e);
      }
    }
    const key = String(name || "HOME").toUpperCase();
    const mounter = SCREENS[key] || mountPlaceholder;
    currentUnmount = mounter(content, store, ctx) || null;
  }
  store.subscribe("module", dispatchScreen);
  dispatchScreen(store.get("module"));
  mountRouter(store, { palette });
  observeMode(document.getElementById("term"));
  window.__overseer = ctx;
})();
