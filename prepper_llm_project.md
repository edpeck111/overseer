# Prepper Offline LLM + Knowledge Base — Project Summary
## For continuation in Claude Code
### Last updated: 2026-03-30

---

## WHO YOU'RE TALKING TO

Ted — UK-based developer and commodities trader.
- Strong embedded background: bare-metal C for STM32, ESP32/Arduino via PlatformIO on VS Code
- Owns M5StickC PLUS2 and has Cardputer-Adv on order
- Business entity (UK) — purchases equipment for VAT reclamation
- Prepper/survivalist hardware interest
- Pi Hut preferred UK supplier for M5Stack items

---

## THE PROJECT IN ONE SENTENCE

Build a fully offline, battery-powered prepper knowledge base + LLM chat system deployable from a Jackery 2000Wh battery, accessible via phone/tablet browser on a local WiFi network, with no internet dependency whatsoever.

---

## FINAL HARDWARE DECISIONS

### Main compute device — DECIDED, NOT YET PURCHASED
**Orange Pi 5 Max 16GB LPDDR5** — ~£265 on Amazon UK
- ASIN: B0D9Y1NTM5
- Chip: Rockchip RK3588 (full, not S)
- RAM: 16GB LPDDR5 quad-channel
- M.2: PCIe 3.0 ×4 (full bandwidth, no kernel pinning issue unlike Pro)
- WiFi: 6E built-in
- Ethernet: 2.5GbE
- Power: USB-C PD 5V 4A (check if bundled PSU variant available)
- Power draw: ~2W idle, ~8-12W during LLM inference
- Jackery 2000Wh runtime: ~12-17 days (query/wait pattern)

### Case — DECIDED, NOT YET PURCHASED
**eleUniverse / Geekworm N515 metal case** — ~£13-16 on Amazon UK
- Explicitly compatible with OPi 5 Pro/Max/Ultra
- Includes 3010 5V fan + heatsinks
- GPIO cable hole and antenna holes included
- Note: power button recessed, needs pencil to press
- Search: "eleUniverse N515 Orange Pi 5 Max" on Amazon.co.uk

### Storage — PURCHASED
**Fanxiang S500 Pro 512GB NVMe M.2 2280 PCIe Gen3 x4**
- TLC NAND (confirmed, not QLC — S501Q is QLC, S500 Pro is TLC)
- Uses YMTC NAND
- ~160GB of content planned, ~350GB headroom
- Confirmed fits in N515 case (verified from Geekworm installation video)

### PSU — CHECK IF BUNDLED WITH BOARD
- OPi 5 Max uses USB-C PD input
- Need 5V 4A minimum (5V 5A recommended with NVMe + USB peripherals)
- May be included with "+TC Supply" board variant — check listing

### Kiwix server device — DECISION PENDING
Originally planned as separate Pi Zero 2W (~£15) but OPi 5 Max has enough RAM
to run kiwix-serve directly — simplifies the build. Pi Zero 2W now optional.

### Already purchased / in hand
- M5StickC PLUS2 (received)
- Cardputer-Adv (ordered, en route)
- Fanxiang S500 Pro 512GB NVMe (purchased, this session)

---

## COMPLETE SHOPPING LIST (remaining items)

| Item | Est. price | Status |
|------|-----------|--------|
| OPi 5 Max 16GB | ~£265 | Not yet purchased |
| Geekworm N515 case + fan | ~£13-16 | Not yet purchased |
| PSU USB-C 5V 4A (if not bundled) | ~£8-12 | Check board listing |
| Pi Zero 2W (optional, for kiwix) | ~£15 | Optional |
| 512GB Samsung PRO Endurance microSD | ~£50 | Optional (if using Pi Zero) |
| Cap LoRa-1262 for Cardputer (Pi Hut) | ~£25 | Future |
| RTL-SDR USB dongle | ~£20 | Future |
| M5StickC PLUS2 ENV III HAT | ~£10 | Future |
| M5StickC PLUS2 NCIR HAT | ~£13 | Future |

---

## SYSTEM ARCHITECTURE

```
Phone/tablet
    │ WiFi
    ▼
OPi 5 Max (headless, Armbian minimal)
    ├── Ollama/Llamafile + Qwen2.5 7B Q4_K_M (primary)
    │   └── upgrade path: 14B Q4_K_M (fits in 16GB with headroom)
    ├── kiwix-serve :8080 (Wikipedia, WikiMed, etc.)
    ├── Flask web server + RAG pipeline
    ├── meshtasticd + USB LoRa module (future)
    └── rtl_tcp + RTL-SDR dongle (future)
        │ NVMe (Fanxiang S500 Pro 512GB)
        └── ZIM files + models + OS

M5StickC PLUS2 → status display (polls /status endpoint)
Cardputer-Adv → preset query buttons + keyboard UI
Pi Zero 2W (optional) → dedicated kiwix-serve if needed
```

### RAM budget (all services running simultaneously)
```
Armbian minimal:     ~300MB
kiwix-serve:         ~200MB
Ollama 7B loaded:    ~5.5GB
meshtasticd:         ~50MB
rtl_tcp:             ~100MB
Flask/RAG:           ~100MB
─────────────────────────────
Total used:          ~6.5GB
Free:                ~9.5GB  ← comfortable headroom
```

### Max model size that fits
- 7B Q4_K_M: ~5GB — fits easily, primary target
- 14B Q4_K_M: ~9GB — fits with headroom, better quality
- 14B Q8: ~15GB — very tight, squeezes other services
- 32B Q4_K_M: ~20GB — does NOT fit

---

## SOFTWARE STACK

### OS
**Armbian minimal CLI** — headless, SSH only, no desktop
- No kernel pinning needed on OPi 5 Max (Max doesn't have the PCIe bug that affects Pro)
- Flash to NVMe via microSD bootstrap

### LLM inference
**Llamafile** preferred over Ollama for RK3588
- Confirmed 3-4× faster than Ollama on RK3588 sub-7B models
- Standalone binary, no daemon management
- Model: Qwen2.5 7B instruct Q4_K_M (primary)
- Model: Qwen2.5 14B instruct Q4_K_M (upgrade, test after 7B validated)

**Ollama** as alternative — easier model management (ollama pull/rm/list)
- Model switching: single command, can have multiple installed, one loads at a time
- Test both, keep what works best

### Knowledge base
**kiwix-serve** — serves ZIM files over HTTP
- Download ZIM files via torrent from library.kiwix.org

### Web interface
**Flask** (Python) — simple RAG pipeline
1. Receive query from phone browser
2. Search kiwix index for relevant passages
3. Build prompt: system + retrieved context + query
4. Stream response from Ollama/Llamafile
5. Return to browser

---

## PLANNED ZIM FILE CONTENT (~136GB total)

| Content | Size | Priority |
|---------|------|----------|
| Wikipedia (no pictures) | ~100GB | Essential |
| WikiMed (medical) | ~4GB | Essential |
| Wikibooks | ~5GB | High |
| iFixit (repair guides) | ~3GB | High |
| Wikivoyage | ~1GB | Medium |
| Project Gutenberg | ~3GB | Medium (old practical manuals) |
| Stack Exchange (Cooking, DIY, Outdoors, Mechanics, Ham Radio, Gardening) | ~15GB | Medium |
| Prepper PDFs (custom) | ~5GB | High |

**Note:** LLM is text-only (Qwen2.5). No vision capability. Images in Wikipedia are stripped
before reaching the LLM — text descriptions only. For VLM capability, Qwen2-VL exists
but is significantly heavier and not planned for v1.

---

## KEY TECHNICAL DECISIONS & RATIONALE

### Why OPi 5 Max over OPi 5 Pro (£7 more)
- Full RK3588 vs RK3588S → PCIe 3.0 ×4 M.2 (vs ×1 on Pro)
- WiFi 6E vs WiFi 5
- 2.5GbE vs Gigabit
- No kernel pinning required (Pro has PCIe bug requiring Armbian 24.8.1 freeze)
- Same 16GB LPDDR5, same LLM inference speed

### Why not DDR4/LPDDR4X SBCs
- LPDDR4X bandwidth ~25-34 GB/s → 3-5 tok/s on 7B (unusably slow, 40-70s responses)
- LPDDR5 bandwidth ~51 GB/s → 8-15 tok/s (acceptable, 15-25s responses)
- The constraint is bandwidth not capacity

### Why not a corporate mini PC (Dell OptiPlex etc.)
- 25-30W draw → only ~2.5 days on Jackery vs 12-17 days for OPi 5 Max
- OPi 5 Max idles at 2W with aggressive clock scaling (408MHz at idle)
- Battery runtime is the decisive factor

### Why not Raspberry Pi 5 16GB
- LPDDR4X (not LPDDR5) → slower bandwidth
- 4-6 tok/s on 7B vs 8-15 tok/s for OPi 5 Max
- Pi 5 costs £196 for worse LLM performance

### Why not eGPU
- PSU draw 150-350W → Jackery gone in hours
- Incompatible with battery-backed prepper use case

### Suspend/wake status
- RK3588 suspend/wake broken in Armbian (known issue, ongoing)
- Decision: leave running at ~2-3W idle — 27 days continuous on Jackery
- GPIO power button pulse from Cardputer is future option if needed

---

## IMMEDIATE NEXT ACTIONS (in order)

### STEP 1 — Validate concept on Windows desktop FIRST (before buying OPi)
```
1. Install Ollama from ollama.com
2. ollama pull qwen2.5:7b-instruct-q4_K_M
3. Test quality on survival/medical queries
4. Test with pasted Wikipedia passages as context (simulates RAG)
5. Download Kiwix Windows app + WikiMed ZIM (~4GB)
6. Verify content quality for medical queries
```
This validates the entire concept before committing to SBC hardware.

### STEP 2 — Buy hardware (after concept validated)
1. OPi 5 Max 16GB — Amazon UK, ASIN B0D9Y1NTM5
2. Geekworm N515 case — Amazon UK, "eleUniverse N515 Orange Pi 5 Max"
3. PSU if not bundled with board

### STEP 3 — Initial setup when hardware arrives
```bash
# Flash Armbian minimal to microSD
# Boot OPi 5 Max from microSD
# Install to NVMe:
sudo armbian-install  # follow prompts, select NVMe target

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull model
ollama pull qwen2.5:7b-instruct-q4_K_M

# Install kiwix-serve
sudo apt install kiwix-tools

# Download ZIM files (start with WikiMed, smallest/most critical)
# from library.kiwix.org via torrent

# Test LLM
ollama run qwen2.5:7b-instruct-q4_K_M
```

### STEP 4 — Flask RAG server
Build Flask web server that:
- Serves chat UI on port 80
- Accepts POST /query with question text
- Searches kiwix index via kiwix-serve API
- Injects retrieved passages into prompt
- Streams Ollama response back to browser

### STEP 5 — Cardputer firmware
- Preset query buttons (first aid, water, fire, shelter)
- Keyboard for free-text queries
- Hits same Flask API endpoint as phone

### STEP 6 — M5StickC PLUS2 status display
- Polls /status endpoint every 30s
- Shows: model loaded, RAM free, uptime, last query time

---

## FUTURE EXPANSION (not v1)

- **Meshtastic**: Cap LoRa-1262 on Cardputer + meshtasticd on OPi 5 Max
  → Remote family members with T-Beam nodes can query LLM via LoRa mesh
- **SDR**: RTL-SDR USB dongle on OPi 5 Max
  → NOAA weather satellites, APRS, ADS-B via rtl_tcp + SDR++
- **Sensor nodes**: ENV III HAT (temp/humidity), NCIR HAT (IR thermometer)
- **GPIO wake**: Cardputer pulses OPi 5 Max power button via transistor circuit
- **14B upgrade**: Swap 7B for 14B Q4_K_M once 7B validated (~9GB, fits fine)

---

## POWER SYSTEM

**Jackery Explorer 2000Wh** (already owned)

| Scenario | Draw | Runtime |
|----------|------|---------|
| Idle only | ~3W | ~27 days |
| Light use (occasional queries) | ~4-5W | ~16-17 days |
| Heavy use (frequent queries) | ~6-7W | ~12 days |
| Stress (continuous inference) | ~10-12W | ~7-8 days |

OPi 5 Max idles at 408MHz, drawing ~2W — aggressive clock scaling makes
a significant difference vs Pi 5 which idles at 1500MHz.

---

## NOTES ON NAND/STORAGE

### Why Fanxiang S500 Pro over S501Q
- S501Q = QLC NAND (Q suffix = QLC)
- S500 Pro = TLC NAND (explicitly stated in product listing)
- Both use YMTC NAND (legitimate Chinese fab, not B-grade)
- For read-heavy workload both would work but TLC preferred for reliability

### Trusted NVMe brands (reference)
**Tier 1 (own fabs):** Samsung, SK Hynix, Micron/Crucial, Kioxia, WD
**Tier 2 (buy certified NAND):** Kingston, Seagate, ADATA, Teamgroup, Corsair
**Asian value (legitimate YMTC NAND):** Fanxiang S500 Pro, ZHITAI SC001, Hikvision NVMe
**Avoid:** No-brand unverifiable drives (fake capacity risk, no warranty)

### Capacity planning
```
OS + software:        ~7GB
Models (7B + 14B):    ~14GB
ZIM files:            ~136GB
─────────────────────────
Total:                ~157GB
512GB drive headroom: ~355GB  ← comfortable
```

---

## CONVERSATION HISTORY LOCATION

Previous session transcripts (for deeper context):
- /mnt/transcripts/2026-03-29-14-12-19-cardputer-prepper-system.txt
- /mnt/transcripts/2026-03-29-15-22-01-cardputer-prepper-llm-hardware.txt
- /mnt/transcripts/2026-03-29-16-38-13-prepper-llm-hardware-research.txt
- /mnt/transcripts/2026-03-30-03-06-21-prepper-llm-hardware-research.txt

Today's session (this file summarises) covers:
- GPU/eGPU discussion (not suitable — power draw)
- DDR5 pricing crisis workarounds
- Raspberry Pi Compute Module / AI HAT+ 2 (not suitable)
- DDR4 SBC options (LPDDR4X bandwidth too slow for 7B)
- OPi 5 Max vs Pro final comparison at near-identical prices
- Power consumption verification (2W idle confirmed)
- Sleep/wake feasibility (suspend broken, leave running)
- Case + fan requirements (N515 confirmed compatible)
- NVMe form factor confirmation (2280 fits in N515)
- Multi-service simultaneous operation confirmed (RAM headroom fine)
- ZIM file content planning (Wikipedia, WikiMed, Gutenberg, Stack Exchange)
- LLM max model size (14B Q4_K_M practical maximum)
- Model swapping (trivial with Ollama — single command)
- NAND quality deep dive → Fanxiang S500 Pro purchased
- Final shopping list consolidated

---

## SUGGESTED CLAUDE CODE PROMPT TO CONTINUE

Paste this at the start of your Claude Code session:

```
I'm building an offline prepper LLM + knowledge base system.
The project summary is in prepper_llm_project.md — please read it first.

I'm at [STEP X from the IMMEDIATE NEXT ACTIONS section].

[Then describe what you want to work on next]
```
