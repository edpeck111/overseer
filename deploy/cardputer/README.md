# Cardputer flash image — staging

The Cardputer-Adv runs a stripped-down OVERSEER environment that:

1. Serves the static shell from its own flash on a SoftAP
2. Forwards `/api/*` requests to OMP packets over LoRa (or WiFi when
   in range of Overseer Prime)

Sprint 4 ships **scaffolding only**. Ted writes the actual ESP-IDF
firmware (his domain per the project memory). This directory holds:

- `flash-layout.md` — the partition layout the firmware should match
- `bridge-config.example.json` — the schema for the OMP bridge config
  read at firmware boot
- `seed-shell/` — the shell bundle copied verbatim from
  `shell/public/dist/` into the flash image at build time

## Flash layout (target)

```
LittleFS partition (~6 MB usable on Cardputer-Adv):
  /etc/overseer/operator.json   callsign + identity keypair
  /etc/overseer/bridge.json     OMP bridge config (this dir's example)
  /shell/                       static bundle (index.html + dist/* + manifest)
  /var/cache/                   sync daemon's local SQLite (inbox cache, etc.)
```

## Building the flash image (future)

When Ted's firmware is ready, the build pipeline will:

1. Run `cd shell && npm run build` (already automated in CI).
2. Copy `shell/public/dist/main.{js,css}` and `shell/public/index.html`
   into the firmware project's `data/shell/` directory.
3. Run `idf.py littlefs-image` to produce the flash artefact.
4. `esptool.py write_flash` flashes it to the device.

Sprint 4 does step 2's "copy" target as a Make-style rule below; steps
1, 3, 4 wait for hardware in Ted's hands.

```sh
# From repo root, materialise a synthetic flash root
mkdir -p deploy/cardputer/seed-shell
cp -r shell/public/* deploy/cardputer/seed-shell/
cp deploy/cardputer/bridge-config.example.json \
   deploy/cardputer/seed-shell/bridge.json
```

## OMP bridge config schema

See `bridge-config.example.json`. Fields:

- `bridge_url`        — where the firmware HTTP server forwards OMP
                       packets received via WiFi. Default `http://overseer.local:6100/omp`.
- `lora_mode`         — `"sf7"` | `"sf9"` | `"sf12"` (matches Meshtastic preset names).
- `prefer_transport`  — `"wifi"` | `"lora"`. Auto-detect: try WiFi first,
                       fall back to LoRa.
- `heartbeat_ms`      — how often to PING the bridge. Default 5000 on
                       WiFi, 60000 on LoRa.
- `dict_version`      — OMP shared-dictionary version expected (HELLO
                       check). Today: `0` (Sprint 4 ships v0x02 raw,
                       no dict; ADR-0010 explains).

Sprint 11+ work materialises this into real firmware.
