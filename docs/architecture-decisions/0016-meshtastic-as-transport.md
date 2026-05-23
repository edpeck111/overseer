# ADR-0016: OMP rides Meshtastic as transport — we do not run our own mesh layer

**Status:** Accepted (Sprint 23a)
**Deciders:** Ted; recorded by Sprint 23a author

## Context

Sprint 23a (LoRa MVP on OPi5) needed a decision before any code went
in: should OVERSEER's mesh transport be a custom LoRa stack we write,
or should OMP packets ride inside an existing mesh protocol?

The architectural backdrop:

  - `docs/03-MESH-ARCHITECTURE.md` puts the LoRa link at the centre of
    the field topology: phone → Cardputer (SoftAP + LoRa) → mesh →
    OPi5 Prime. Up to 200 miles end-to-end *if* the mesh has hops to
    relay through.
  - `server/hw.py` declared the `OVERSEER_LORA` env-var contract
    (sx1262 / sx1278 / rylr998) at Sprint 20 but no driver had been
    written for v3.
  - Legacy v1 code at the repo root (`lora_bridge.py`, 447 lines) was
    already doing **exactly the kind of Meshtastic-Python plumbing**
    we'd need — using `meshtastic.serial_interface.SerialInterface` to
    a Heltec V3, subscribing to pubsub events, sending text payloads.
    It works. It just wasn't wired to anything in v3.
  - The Cardputer firmware was (and still is) unbuilt. The whole
    field-relay story depends on a microcontroller writing comparable
    radio code — but the ESP32-S3 doesn't run Python; it'd need to be
    re-implemented in C / ESP-IDF.

Three real options.

### Option A — Custom LoRa stack

Write our own framing, our own forward-error-correction, our own mesh
routing protocol, our own duty-cycle accounting, our own channel
encryption.

Pros: total control of the wire format, no third-party protocol
constraints.

Cons:
  - Months of work re-inventing what already exists.
  - Every Cardputer / OPi5 / relay node has to run our firmware. No
    interop with the broader LoRa community.
  - We become responsible for compliance with EU 1% duty-cycle on
    868 MHz and FCC 30 dBm caps on 915 MHz — easy to get wrong, no
    second pair of eyes.
  - The 200-mile / multi-hop story doesn't work until we've shipped
    routing — i.e. it's gated on us building a thing that hundreds of
    person-years of OSS already exist for.

### Option B — Meshtastic as transport (chosen)

Use the [Meshtastic](https://meshtastic.org) protocol as the link
layer. OMP packets ride inside Meshtastic data packets as
`PRIVATE_APP` payloads (`portnums_pb2.PortNum.PRIVATE_APP = 258`).
Meshtastic handles:

  - Mesh routing (up to 7 hops by default)
  - AES-256 channel encryption
  - Duty-cycle compliance per region preset (EU / US / etc.)
  - Neighbour discovery and link-quality (RSSI / SNR per packet)
  - Store-and-forward of undelivered messages
  - LoRa region / frequency / SF presets matching the regulatory
    framework of wherever the device is

Pros:
  - Battle-tested. Tens of thousands of users daily. The bugs we'd
    otherwise hit have already been found and fixed.
  - Hardware indifference: the `meshtastic` Python library talks to
    any Meshtastic-compatible device (Heltec V3, T-Beam, RAK4631,
    Cardputer-Adv, …) identically. We swap radios without code change.
  - **Free multi-hop.** Other people's Meshtastic nodes can relay our
    packets without running our firmware. The 200-mile vision comes
    from the broader community plus any relay nodes we deploy
    ourselves.
  - Compliance handled at the firmware level. Not our concern.
  - The proof point was already in-repo: legacy `lora_bridge.py` uses
    this exact pattern today. Sprint 23a lifts the working code, not
    a research project.

Cons:
  - Per-packet payload cap ~200 bytes after Meshtastic framing. Fits
    one Brotli'd OMP packet (~178 bytes typical, confirmed against
    real fixture data) but writes larger than that need OMP-level
    fragmentation (deferred — Sprint 12 placeholder in
    `server/omp/codec.py` lifts when needed).
  - We live within Meshtastic's protocol-version churn. Mitigated by
    pinning a known-good version of the `meshtastic` library in
    `requirements.txt` when the dependency is added (Sprint 23a notes
    the optional install, doesn't pin yet because the dep is
    lazy-imported and not in CI).
  - Less control over channel discipline; if we want to talk *only*
    to our own nodes, we use a private channel with a non-default PSK.

### Option C — Meshtastic firmware + our app as side-by-side processes

Investigated and rejected. ESP32-S3 doesn't multitask the way a Linux
host does; running stock Meshtastic firmware *and* an OVERSEER app
beside it would require either a dual-firmware partition scheme or
heavy IPC. Simpler: on microcontroller targets we re-implement the
Meshtastic protocol layer (using their published protobuf .proto
files) inside our own ESP-IDF firmware. Sprint 23c onward.

## Decision

**OVERSEER uses Meshtastic as its LoRa transport layer at every tier.**

On the OPi5 (Sprint 23a, just landed): the `meshtastic` Python library
talks to a USB-attached Meshtastic device. OMP packets are sent and
received as `PRIVATE_APP` payloads. Implementation: `server/omp/lora_transport.py`,
follows the ADR-0014 adapter pattern (lazy import, synthetic fallback
on bring-up failure, never crashes server boot).

On the Cardputer (Sprint 23c+): our ESP-IDF firmware will use the
Meshtastic protobuf library to drive the on-board SX1262 radio
directly — no stock-Meshtastic-firmware-running-beside-us.

On other operator devices (phones, future hardware): if and when those
gain LoRa, they use whatever Meshtastic client library exists on that
platform. The wire-format constraint stays the same.

## What this is not

  - **Not "we use Meshtastic for chat".** OVERSEER doesn't send text
    messages on the default Meshtastic channels. We use `PRIVATE_APP`
    payloads on a private channel; the bytes inside are OMP packets
    (Brotli + msgpack), not human-readable text.
  - **Not a commitment to Meshtastic's UI.** The Meshtastic phone app
    is irrelevant to us; operators use the OVERSEER shell.
  - **Not amateur radio.** ISM-band (868 MHz EU / 915 MHz US) at
    LoRa power levels. License-free, encryption permitted on ISM.

## Consequences

  - `server/omp/lora_transport.py` is the load-bearing v3 transport for
    the mesh side. The HTTP `/omp` route in `server/omp/server.py`
    delegates its dispatch core to `dispatch_packet` in this module so
    both transports share one source of truth for "given an OMP packet,
    what's the response?".
  - `meshtastic` becomes an optional runtime dependency. Lazy-imported
    inside `MeshtasticLora.__post_init__`; absent on dev machines and
    on the OPi5 unless `pip install meshtastic` is run. The
    synthetic-fallback path (ADR-0014) keeps the server bootable
    everywhere.
  - The v1 `lora_bridge.py` at the repo root becomes redundant for the
    OPi5 mesh-server role. Keep it around for now as a known-good
    reference for Meshtastic-Python plumbing; remove in a later sprint
    once Sprint 23d/e have replicated its chat/LLM/KB features through
    v3-native OMP opcodes.
  - Cardputer firmware (Sprint 23c+) is *our* ESP-IDF code that
    implements the Meshtastic protocol subset we need, not a binary
    we flash from upstream. That's a meaningful body of work but a
    bounded one — the protobuf .proto files are public, the radio
    drivers are well-trodden territory.
  - Operators can join the broader Meshtastic community if they want
    — our private channel is one of many they can run alongside
    public channels. Their device, their choice.

## Revisit triggers

  - **Per-packet payload cap becomes load-bearing.** If a real use case
    pushes through fragmentation often (e.g. KNOWLEDGE article delta
    sync over LoRa) and Meshtastic's protocol layer slows the radio
    enough to matter, we measure and decide whether OMP-level
    fragmentation handles it or whether the transport needs to change.
  - **Duty cycle on busy channels.** If aggressive v3 shell use (lots
    of polls, lots of writes) saturates the EU 1% limit, we either
    tighten caching (ADR-0008 TTLs) and adopt delta-sync everywhere
    (ADR-0007 pattern), or revisit transport.
  - **Meshtastic upstream changes the protocol incompatibly.** Pin the
    Python lib version, monitor releases, revisit only if breakage is
    unfixable in our wrapper.
  - **Regulatory change.** If the relevant regulator alters ISM-band
    rules in a way that matters, all of this gets revisited regardless
    of transport choice.

## Reference

  - Meshtastic protocol: https://meshtastic.org/docs/overview/
  - `server/omp/lora_transport.py` — the implementation
  - `tests/unit/test_lora_transport.py` — synthetic-fallback contract,
    dispatch round-trip, HTTP regression
  - `docs/03-MESH-ARCHITECTURE.md` §2 — topology this transport sits
    inside
  - `docs/STATUS.md` Sprint 23 scope — the milestones this ADR enables
