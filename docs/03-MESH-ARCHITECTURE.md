# 03 — MESH ARCHITECTURE

> The single most consequential architectural decision in v3 is the **static shell + thin API split**. It governs how the UI is bundled, how the API is shaped, how the Cardputer connects to the OPi5, and how the system degrades gracefully under bandwidth pressure. Read this carefully before writing API code.

---

## 1. The bandwidth reality

LoRa via Meshtastic is brutal. Real numbers:

| Setting | Theoretical | Realistic | Use case |
|---|---|---|---|
| **SF7 / 250kHz** | ~5.5 kbps | ~1-2 kbps | short range, fastest |
| **SF9 / 125kHz** | ~1.7 kbps | ~600 bps | medium range, default |
| **SF12 / 125kHz** | ~290 bps | ~100-200 bps | maximum range |

Meshtastic per-packet payload max: ~237 bytes after framing/encryption. Often less.

**Implication:** the Overseer HTML preview is ~35KB. At SF12 that's ~19 minutes to transmit. At SF7 it's ~30 seconds.

**Conclusion:** the UI cannot cross the wire. The UI must be **preloaded and resident** on the client device. Only state deltas traverse the network.

---

## 2. Hardware topology

```
                    ┌─────────────────────────────────┐
                    │      ORANGE PI 5 MAX (16GB)     │
                    │      "OVERSEER PRIME"           │
                    │                                 │
                    │  · Flask backend                │
                    │  · SQLite + FTS5 + sqlite-vss   │
                    │  · Ollama (Qwen 7B/14B)         │
                    │  · kiwix-serve (12 ZIMs)        │
                    │  · whisper.cpp / piper          │
                    │  · meshtasticd (LoRa daemon)    │
                    │  · OMP server                   │
                    │  · Static shell hosted          │
                    └────────┬───────────┬────────────┘
                             │           │
                       WiFi  │           │  USB-LoRa or
                  (LAN/AP)   │           │  Cap LoRa-1262
                             │           │
                ┌────────────┴───┐   ┌───┴───────────┐
                │                │   │               │
       ┌────────▼────────┐  ┌────▼───▼────────┐  ┌──▼──────────┐
       │  PHONE/TABLET   │  │  CARDPUTER-ADV  │  │  M5STICKC   │
       │  browser        │  │  (relay/term)   │  │  (status)   │
       │                 │  │                 │  │             │
       │  · Static shell │  │  · Local web    │  │  · /status  │
       │    served from  │  │    server       │  │    polling  │
       │    OPi5 once    │  │  · Static shell │  │             │
       │  · WS to OPi5   │  │    on flash     │  │             │
       │                 │  │  · OMP→LoRa     │  │             │
       │                 │  │    bridge       │  │             │
       └─────────────────┘  └─────────────────┘  └─────────────┘
                                     │
                                LoRa │ 868 MHz
                                     │
                          ┌──────────┴──────────┐
                          │  REMOTE OPERATOR    │
                          │  (Cardputer)        │
                          │                     │
                          │  Same shell, same   │
                          │  UI, low-bandwidth  │
                          │  state-only sync    │
                          └─────────────────────┘
```

### Roles

**OPi5 "Overseer Prime":** the canonical state. Authoritative source of truth for everything. Heavy lifting (LLM, ZIM search, embeddings). Hosts the static shell as static files served at `/`.

**Phone/tablet on local WiFi:** loads the static shell once from OPi5, then talks to it via REST + WebSocket. Full-bandwidth, full feature set. The "home" experience.

**Cardputer-Adv:** dual role.
- *Personal terminal:* its own screen + keyboard + battery, runs the same UI rendered by an embedded webview or native renderer, talks to OPi5 over WiFi or LoRa.
- *Mesh relay:* serves the static shell from its own flash to a connected phone over its SoftAP, bridges API requests to OMP packets over LoRa.

**M5StickC PLUS2:** ambient status display. Polls `/api/x/status` periodically. Doesn't run the full UI — just shows model, RAM, battery, unread count.

**Remote operators:** same Cardputer firmware. Their static shell is identical. Their reality is just slower (LoRa) and more cached.

---

## 3. The static shell

### Definition

The shell is **everything that doesn't depend on user data**:

- HTML structure
- CSS (design tokens, layouts, animations)
- JavaScript state machine + module logic
- Fonts (subsets, woff2)
- Sound effects (8 key WAVs + chime + alerts)
- Static assets (icons, ANSI art, splash banners)
- Static help text, lore, fortune database
- The medical triage decision trees themselves (data, not output)
- Drug interaction database (read-only)
- UPC database (read-only)
- The complete command registry

### Bundle structure (target)

```
shell/
├── index.html                  Single entry point, all chrome
├── overseer.js                 Bundled state machine + modules
├── overseer.css                Bundled design tokens + module styles
├── fonts/
│   ├── jetbrains-mono.woff2    Body font (subset)
│   ├── vt323.woff2             Display font
│   └── ...
├── assets/
│   ├── ansi/                   Pre-rendered ANSI art
│   ├── icons/
│   └── sounds/
├── data/
│   ├── triage.json             Medical decision trees (compiled)
│   ├── drugs.sqlite            Drug + interaction DB
│   ├── upc.sqlite              UPC lookup
│   ├── fortune.txt             Quotes
│   ├── help.json               Help articles
│   └── lore.json               In-character backstory
└── manifest.json               PWA manifest
```

**Target size: ≤ 2MB total, gzipped.** That's fast to load over WiFi, fits in Cardputer flash with room to spare, and lets the whole shell ship in a single signed payload.

### How it loads

**Direct WiFi (phone → OPi5):**
1. Phone hits `http://overseer.local/` once
2. OPi5 serves static shell with aggressive caching (`Cache-Control: max-age=86400, immutable` on hashed assets)
3. Service Worker takes over for subsequent loads — fully offline-capable
4. JS connects WebSocket to `/ws` for live updates

**Cardputer (LoRa-only operator):**
1. Cardputer powers on, ESP32 boots, mounts flash filesystem with shell
2. Cardputer's local web server serves shell at `http://192.168.4.1/` from flash
3. Phone connects to Cardputer's SoftAP (or Cardputer's own screen renders directly)
4. JS detects `transport=mesh` and routes API calls through the OMP bridge
5. OMP bridge encodes requests as binary LoRa packets, awaits responses, returns JSON

**Critically:** the JS code path for "make an API call" is identical in both cases. The shell doesn't know whether it's talking to OPi5 directly or via mesh. A transport adapter handles routing.

---

## 4. The transport adapter

```js
// shell/src/transport.js — sketch

class Transport {
  async request(method, path, body) {
    throw new Error('subclass me');
  }
  subscribe(channel, onMessage) {
    throw new Error('subclass me');
  }
}

class HttpTransport extends Transport {
  async request(method, path, body) {
    const res = await fetch(path, { method, body: JSON.stringify(body), ... });
    return res.json();
  }
  subscribe(channel, onMessage) {
    this.ws ??= new WebSocket(`ws://${location.host}/ws`);
    // subscribe via WS
  }
}

class OmpTransport extends Transport {
  // Talks to local Cardputer/relay's OMP bridge endpoint
  async request(method, path, body) {
    const opcode = lookupOpcode(method, path);
    const payload = encodePayload(body);
    return await this.bridge.send(opcode, payload);  // returns parsed JSON
  }
  subscribe(channel, onMessage) {
    // OMP server-push events
    this.bridge.on(channelOpcode(channel), onMessage);
  }
}

// Selected once at boot based on transport detection:
const transport = detectTransport();  // 'wifi' | 'mesh' | 'tui'
const api = transport === 'mesh' ? new OmpTransport() : new HttpTransport();
```

The status strip's `MESH:●●○` pip is bound to `transport.healthState`.

---

## 5. Caching strategy (mesh-aware)

Every API endpoint is tagged with a cache policy:

| Cache class | TTL on phone WiFi | TTL on mesh | Notes |
|---|---|---|---|
| **STATIC** (drugs, fortune) | forever | forever | Ships in shell; never refetched |
| **STABLE** (waypoints, contacts) | 60s | 1h | Refetch on focus or explicit refresh |
| **WARM** (inbox headers, log entries) | 30s | 5min | Polled on focus; pushed on change |
| **HOT** (current chat, power) | live (WS) | 30s | Real-time on WiFi, polled on mesh |
| **EXPENSIVE** (LLM, library article) | per-query | per-query | Always fetched on demand |

**Stale-while-revalidate everywhere.** The UI shows cached data instantly with a dim `as-of 14m ago` badge, fires off a fresh fetch in the background, swaps in new data when it arrives.

**Mesh-specific:** when `transport === 'mesh'`, all polling intervals multiply by 10×, and every cache TTL multiplies by 5×. The user sees more `as-of` stamps but bandwidth is preserved.

---

## 6. Optimistic UI

Every user action that hits the network:

1. **Updates UI immediately** with `⟳ pending` flag
2. **Fires the API call** in the background
3. **Queues the action** if offline (writes to IndexedDB)
4. **Reconciles** when response arrives:
   - Success: flag flips to `✓ delivered`
   - Failure: flag flips to `✗ retry`, action remains in queue
5. **Drains queue** automatically when transport returns

Examples:

| Action | Optimistic effect |
|---|---|
| Send message | Appears in SENT instantly with pending flag |
| Add waypoint | Pin shows on map, dim, until synced |
| Mark message read | Flag clears immediately, reconciles later |
| Triage step commit | Wizard advances, server commit happens async |
| Log entry | Appears in today's log instantly |
| Inventory change | Quantity updates, syncs in background |

This is what makes mesh use *bearable*. The user never feels the latency on common actions.

---

## 7. LLM streaming over mesh

LLM responses are special — they're large (200-2000 chars), interactive (user wants to see them flowing), and frequently the bottleneck.

**On WiFi:** standard SSE, token-by-token, no compression needed.

**On mesh:**

1. Client sends compressed query (~50-100 bytes after Brotli) as one OMP packet
2. OPi5 returns immediately with `stream_id` (4 bytes)
3. OPi5 starts inference, streams tokens as they generate
4. Each batch of ~5-10 tokens compressed against the **Overseer-vocab dictionary** (see §9), framed in OMP, transmitted
5. Client decompresses and renders incrementally — first words visible within ~1 second of query

Fallback: if mesh drops mid-stream, the partial response stays on screen with a `… [stream interrupted, X% received]` indicator. User can `r` to retry the missing portion.

---

## 8. The OMP protocol (summary)

Full spec in `05-OMP-PROTOCOL.md`. Quick overview:

```
+--------+--------+--------+--------+----------------+
| ver(1) | op(1)  |  msgid(2)       | brotli(N)      |
+--------+--------+--------+--------+----------------+
```

- 4-byte fixed header
- Variable-length Brotli-compressed payload
- MessagePack inside the Brotli envelope for structure
- Fragmentation header prepended for multi-packet payloads (3 bytes)
- All payloads use the Overseer shared dictionary

Opcode space:

| Range | Use |
|---|---|
| 0x00-0x0F | Protocol control (handshake, ping, fragment ack) |
| 0x10-0x2F | Comms (mail, boards, mesh) |
| 0x30-0x4F | Knowledge (LLM, library) |
| 0x50-0x6F | Medical |
| 0x70-0x8F | Navigation |
| 0x90-0xAF | Power, System |
| 0xB0-0xCF | Log, Inventory, Timeline |
| 0xD0-0xEF | Recreation, Signal |
| 0xF0-0xFF | Reserved + plugin opcodes |

---

## 9. Compression strategy

**Three layers:**

### Layer 1: Wire format

MessagePack instead of JSON. Typed binary serialization. Roughly 30-50% smaller than JSON before any compression.

### Layer 2: Brotli with shared dictionary

A pre-computed Overseer-vocabulary Brotli dictionary ships in the shell. Built from:

- Common JSON keys (`from`, `to`, `subject`, `body`, `at`, `kind`, `lat`, `lon`, ...)
- Common values (`OVERSEER`, `ALPHA-1`, callsigns, board names, `cache`, `water`, ...)
- Common phrases the LLM produces (`stay sharp`, `field medicine only`, ...)
- Common command names
- ANSI escape sequences

Dictionary is generated once from sample traffic, signed, distributed with the shell.

Typical compression ratios on small payloads:

| Payload type | Raw | After MsgPack | After Brotli+dict |
|---|---|---|---|
| Status ping | ~120 bytes JSON | ~60 bytes | ~16 bytes |
| Inbox 10 headers | ~600 bytes | ~340 bytes | ~95 bytes |
| Single message body 200 chars | ~280 bytes | ~250 bytes | ~70 bytes |
| LLM 500-char response | ~520 bytes | ~510 bytes | ~140 bytes |
| Library article 3KB | ~3000 bytes | ~2900 bytes | ~700 bytes |

### Layer 3: Reference-based

Whenever the same data has been transmitted before, transmit a **content hash reference**, not the data:

```
Client requests INBOX:
  → Sends list of message IDs it has cached
  ← Server responds with [new messages] + "you-already-have" list

Client requests waypoint:
  → Includes waypoint last-modified timestamp
  ← Server responds 304-equivalent if unchanged
```

This is essentially HTTP conditional requests adapted for OMP.

---

## 10. Sync model

The OPi5 is canonical. Cardputers sync to it.

**On reconnect** (mesh dropped and returned):

1. Cardputer sends `SYNC_HELLO` with last-known sequence number per data type
2. OPi5 responds with delta since that sequence
3. Cardputer applies deltas, drains its outbound action queue (optimistic-pending operations)
4. OPi5 acknowledges drained actions
5. State is consistent

**Conflict resolution:**

- Most operations are commutative (logs append, messages send) — last-write-wins on rare conflicts
- Multi-operator games (Dragon's Tale) use simple CRDTs
- Inventory changes: deltas not absolutes. `qty -= 1` not `qty = 14`. Composes naturally.

---

## 11. Cardputer firmware spec

Ted writes this himself, but here's the spec the OPi5 backend should support:

### Bootstrap

1. Cardputer boots, mounts flash partition with shell + seed config
2. Reads `/etc/overseer/operator.json` for callsign + keypair
3. Tries WiFi first (configured SSIDs), falls back to LoRa-only
4. If LoRa: starts listening for OPi5 broadcasts on configured channel

### Local web server

ESP-IDF `esp_http_server` on port 80. Routes:

```
GET  /                        → flash:/shell/index.html
GET  /static/*                → flash:/shell/static/*
GET  /api/*                   → OMP bridge (over WiFi or LoRa)
WS   /ws                      → local WebSocket; bridges to OMP push events
```

### OMP bridge

- Accepts HTTP requests
- Translates path+method+body to opcode+payload
- Encodes via MessagePack + Brotli (with shared dictionary)
- Submits to LoRa transmit queue (or WiFi forward)
- Awaits response (timeout configurable per opcode)
- Decodes and returns as HTTP response

### Sync daemon

Background task that:

- Pings OPi5 every N minutes (or on user activity burst)
- Pulls deltas for STABLE/WARM-classed endpoints
- Keeps inbox, waypoints, log, inventory cached locally in SQLite (LittleFS)
- Drains outbound action queue on reconnect

### Direct screen mode (optional)

If user prefers Cardputer's own screen over phone:

- Run a stripped-down renderer (probably LVGL with monospace font)
- Render the same module set but at 320×240 res, ~40×16 chars
- Reuse the shell's state machine via WebView or port to C

---

## 12. Security

E2E encryption between operators uses Signal-style double ratchet over the existing keypair infrastructure:

- Long-term identity key: ed25519 (already in v2)
- Per-session ratchet: x25519
- Symmetric: AES-256-GCM
- Sealed sender variant for mesh privacy (intermediate hops can't read recipient)

Mesh transport encryption is *additional*, not replacing — Meshtastic's own AES is fine but not auditable for us. Application-layer crypto is mandatory for direct mail.

Public boards (`/general /intel ...`) are signed but not encrypted — they're meant to be readable across the mesh.

Admin operations (PIN-gated) require not just PIN but a signed challenge from the operator's identity key — protects against MITM on the local network.

---

## 13. Bandwidth budgets — concrete

To validate the design, here's what realistic operator activity costs:

| Activity | Frequency | Bytes per (mesh) |
|---|---|---|
| Status ping | every 60s | ~24 |
| Inbox poll (no new) | every 5min | ~30 (just timestamp check) |
| Inbox poll (1 new) | event | ~95 (header) + ~70 (body if read) |
| Send 200-char message | event | ~120 + ack (12) |
| LLM query (50-char Q, 500-char A) | event | ~50 + ~140 (streamed) |
| Library article search + read 3KB | event | ~50 + ~700 (chunked) |
| Add waypoint | event | ~80 + ack |
| Daily activity total (active operator) | per day | ~25-50 KB |

A *daily* operator session at SF7 LoRa is workable — minutes of cumulative airtime. At SF12 it's practical only for messaging and status.

---

## 14. Service worker / PWA

The shell ships as a PWA. Service worker:

- Pre-caches shell on install
- Strategy `cacheFirst` for `/static/*`
- Strategy `staleWhileRevalidate` for `/api/*` STABLE/WARM endpoints
- Strategy `networkOnly` for HOT and EXPENSIVE
- Installable on phone home screen
- Works fully offline (with cached data) when OPi5 unreachable

Manifest declares it as a `standalone` display, with theme color matching `--bg-deep`.

---

## 15. Testing the architecture

Two simulators worth building early:

**Mesh simulator:** an `OmpTransport` mock that injects configurable latency/loss/bandwidth, lets you test the UI under realistic LoRa conditions without hardware.

**Multi-operator simulator:** spin up 3-5 fake operators against the same OPi5, generate realistic message traffic, verify mesh routing, sync, and conflict resolution behave correctly.

Both should ship as `tools/sim-mesh.py` and `tools/sim-operators.py`.

---

End of mesh architecture. Continue to `04-IMPLEMENTATION-PLAN.md` and `05-OMP-PROTOCOL.md`.
