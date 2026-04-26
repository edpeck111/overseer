# OVERSEER Custom Meshtastic Firmware — Build Guide

Build a custom Meshtastic firmware for the M5Stack Cardputer ADV that serves
the OVERSEER web interface instead of the default Meshtastic web UI.

## What this does

- Flashes Meshtastic firmware with full mesh networking capability
- Replaces the default web UI with the OVERSEER interface
- When a phone connects to the Cardputer's WiFi, the OVERSEER page loads automatically (captive portal)
- The Cardputer's screen still shows Meshtastic node info, signal, etc.

## Prerequisites

- Python 3.9+
- Git
- PlatformIO (VS Code extension or CLI)
- USB-C cable

### Install PlatformIO CLI

```bash
pip install platformio
```

Or install the PlatformIO extension in VS Code.

## Step 1: Clone Meshtastic firmware

```bash
git clone https://github.com/meshtastic/firmware.git
cd firmware
git submodule update --init --recursive
```

## Step 2: Replace the web UI

The Meshtastic web UI files live in `data/static/`. We replace them with our OVERSEER page.

```bash
# Clear existing web UI
rm -rf data/static/*

# Copy OVERSEER page
cp /path/to/overseer.html data/static/index.html

# Also create the captive portal detection files
# (phones check these URLs to detect captive portals)
cp data/static/index.html data/static/hotspot-detect.html
cp data/static/index.html data/static/generate_204
cp data/static/index.html data/static/connecttest.txt
```

The captive portal files ensure that when a phone connects to the Cardputer's
WiFi, the OS automatically opens the OVERSEER page regardless of phone brand:
- Apple: checks `/hotspot-detect.html`
- Android: checks `/generate_204`
- Windows: checks `/connecttest.txt`

## Step 3: Build for Cardputer

```bash
# For M5Stack Cardputer (original)
pio run -e m5stack-cardputer

# For M5Stack Cardputer ADV (if separate target exists)
# Check available targets:
pio run --list-targets | grep cardputer
```

The compiled firmware will be in `.pio/build/m5stack-cardputer/`

## Step 4: Flash the Cardputer

### Option A: PlatformIO (easiest if already set up)

```bash
pio run -e m5stack-cardputer --target upload
```

### Option B: esptool (manual)

```bash
pip install esptool

# Put Cardputer in download mode:
#   1. Power off
#   2. Hold G0 button
#   3. Power on
#   4. Release G0

# Flash
esptool.py --chip esp32s3 --port COM3 write_flash \
    0x0      .pio/build/m5stack-cardputer/bootloader.bin \
    0x8000   .pio/build/m5stack-cardputer/partitions.bin \
    0xe000   ~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin \
    0x10000  .pio/build/m5stack-cardputer/firmware.bin \
    0x310000 .pio/build/m5stack-cardputer/littlefs.bin
```

Replace `COM3` with your actual serial port.

### Option C: Web Flasher

If the standard Meshtastic web flasher at https://flasher.meshtastic.org
supports custom firmware files, you can upload the built `.bin` files there.

## Step 5: Configure the radio

After flashing, connect via USB and configure:

```bash
pip install meshtastic

# Set region (required — radio won't transmit without this)
meshtastic --set lora.region EU_868

# Set modem preset
meshtastic --set lora.modem_preset LONG_FAST

# Create OVERSEER private channel
meshtastic --ch-index 1 --ch-set name OVERSEER
meshtastic --ch-index 1 --ch-set psk random
meshtastic --ch-index 1 --ch-enable

# Read back the PSK (copy this to all other nodes)
meshtastic --ch-index 1 --ch-get psk

# Set the WiFi AP name
meshtastic --set network.wifi_ssid OVERSEER
meshtastic --set network.wifi_enabled true
```

## Step 6: Test

1. Power on the Cardputer
2. On your phone, connect to WiFi network `OVERSEER`
3. The OVERSEER page should pop up automatically
4. If not, open browser and go to any URL — it will redirect
5. Enter a callsign and start chatting

## Restoring stock firmware

### Restore Meshtastic (default web UI)

Go to https://flasher.meshtastic.org, select Cardputer, flash. Done.

### Restore M5Stack factory firmware

1. Download and install M5Burner from M5Stack
2. Put Cardputer in download mode (power off → hold G0 → power on → release)
3. In M5Burner, search for "Cardputer User Demo"
4. Select your serial port and click flash

### Full erase (nuclear option)

```bash
esptool.py --chip esp32s3 erase_flash
```

Then flash whatever firmware you want from scratch.

## Backup before flashing

Save the entire flash contents before modifying:

```bash
esptool.py --chip esp32s3 read_flash 0 0x1000000 cardputer_backup.bin
```

Restore later with:

```bash
esptool.py --chip esp32s3 write_flash 0 cardputer_backup.bin
```

## Files

```
meshtastic/
├── overseer.html    — OVERSEER relay page (goes in data/static/index.html)
└── BUILD.md         — This file
```

## OPi 5 Max side

The OPi 5 Max needs a Heltec V3 running **stock Meshtastic firmware** (no custom build).
Flash it via the web flasher, then configure:

```bash
meshtastic --set lora.region EU_868
meshtastic --set lora.modem_preset LONG_FAST
meshtastic --ch-index 1 --ch-set name OVERSEER
meshtastic --ch-index 1 --ch-set psk base64:PASTE_THE_PSK_HERE
meshtastic --ch-index 1 --ch-enable
```

The OVERSEER server's `lora_bridge.py` connects to the Heltec V3 via USB serial
using the `meshtastic` Python library.
