# ADR-0014: Hardware-adapter pattern — synthetic-fallback on bring-up failure, lazy optional imports

**Status:** Accepted (Sprint 22)
**Deciders:** Ted (delegated; standing autonomous mandate); recorded by Sprint 22 author

## Context

Sprint 20 added `server/hw.py` as a thin env-var selector that maps
`OVERSEER_{SDR,LORA,MESH,GPS,POWER,DISPLAY}` to backend-name strings
(e.g. `gpsd`, `rtlsdr`, `ina226`, `synthetic`, …). Sprint 21 added the
DISABLED-banner system in the shell, fed by `/api/hw`.

Sprint 22 is the first sprint that lands *actual* real-hardware
adapters — INA226 / shunt-ADC for POWER, gpsd / serial-NMEA for GPS.
With four more backend categories still to fill (SDR, LoRa, mesh,
display), it's worth pinning down the adapter shape before the second
example diverges from the first.

Three forces in tension:

1. **The server must boot on a dev box.** Most Overseer development
   happens on a Windows or generic-Linux box that has none of the I2C
   buses, GPS receivers, SDRs, or LoRa radios that the real hardware
   on the OPi5 has. A backend that crashes on import or raises during
   bring-up makes the whole module unusable for everyone else.

2. **Optional dependencies should not be in `requirements.txt`.** Each
   real backend pulls in a domain-specific Python wheel: `smbus2` for
   I2C, `pyserial` for UART, `pyrtlsdr` for SDR, etc. Bundling all of
   them inflates the install surface (especially on Windows where some
   wheels don't exist) and the dev-box footprint, when only the OPi5
   ever uses any of them.

3. **The wire shape must not change between synthetic and real.** The
   shell can't branch on backend type. `/api/p/now` always returns a
   `Sample`; `/api/n/gps/fix` always returns a `Fix` (or 204). The
   shell only knows it's running on synthetic via `/api/hw`'s
   `_synthetic` flags (which drive DISABLED banners per Sprint 21).

## Decisions

### 1. Adapter classes live next to the module that consumes them

Not under a `server/hw/` sub-package. `server/hw.py` stays a flat
env-var selector. The actual adapter implementations sit in the
module file that owns the protocol — `server/modules/power.py` for
INA226 and shunt; `server/modules/navigation.py` for gpsd and NMEA;
later `server/modules/signal_.py` for RTL-SDR and HackRF, and so on.

Rationale: the existing `SyntheticSource` already lives in
`power.py`. Splitting real vs synthetic into different files would
encourage drift between their `read_sample()` signatures. Keeping
them colocated also keeps the diff legible — a new backend is *one
file* changed.

### 2. Lazy import of the optional dependency

Every real adapter imports its I/O library inside `__post_init__`,
not at module-import time:

```python
def __post_init__(self) -> None:
    try:
        import smbus2  # type: ignore
    except ImportError as exc:
        self._fallback(f"smbus2 unavailable: {exc}")
        return
    try:
        self._bus = smbus2.SMBus(self.bus_id)
        ...
    except Exception as exc:  # noqa: BLE001
        self._fallback(f"INA226 init failed: {exc}")
```

Importing the module file (and running tests against it) never
requires `smbus2`, `pyserial`, `pyrtlsdr`, etc. CI stays slim.

### 3. Synthetic-fallback on any bring-up or read failure

If the optional dep is missing, or the device file is absent, or the
first read raises, the adapter attaches an internal synthetic source
and routes subsequent calls to it. The user-visible effect is a
single `UserWarning` at startup and then identical behaviour to
synthetic mode:

```python
def _fallback(self, reason: str) -> None:
    self.last_error = reason
    import warnings
    warnings.warn(f"OVERSEER POWER: {reason}; using synthetic fallback",
                  stacklevel=2)
    self._synth_fallback = SyntheticSource()
```

The server NEVER crashes because of missing hardware. Three reasons:

  - **Headless dev.** A laptop running the server can drive the shell
    locally without any radio plugged in.
  - **Field degraded mode.** If the GPS dongle is unplugged mid-run,
    we'd rather keep serving the rest of the system than 502 on
    `/api/n/gps/fix`.
  - **Tests.** Test code can construct a real adapter and assert it
    fell back — that's the entire CI guarantee for the bring-up
    paths, since we can't simulate hardware presence on the runner.

The trade-off: the operator can't tell *from the wire alone* that
their GPS is dead — they'll see the synthetic walk and assume it's
real. This is mitigated by:

  - `/api/hw` exposes `_synthetic` per category. The shell renders an
    amber DISABLED banner whenever a category falls back (Sprint 21).
  - Each adapter retains `last_error: str | None`, which a future
    `/api/hw/details` endpoint can surface for diagnostics.

### 4. Unknown env values fall back to default, with a warning

This was already the behaviour of `hw.py`. Sprint 22 preserves it
when the module routes to its adapter classes: an unknown
`OVERSEER_POWER` value is normalised to `synthetic` by `hw.py`'s
`_read()`, and `power._select_source()` returns a `SyntheticSource`
without raising. The old `OVERSEER_POWER_SOURCE` behaviour (raise
`ValueError` on unknown, raise `NotImplementedError` on `hardware`)
is gone.

### 5. Module owns its own selector function

Modules call `hw.power_backend()` (or `hw.gps_backend()`, etc.) and
dispatch with an if-ladder. They DO NOT read `os.environ` directly.
`hw.py` is the single point that validates env values; everything
downstream sees only the validated string.

If `hw.py` gains a new valid value (e.g. `OVERSEER_POWER=fuel_cell`)
that the module's selector doesn't know about, the module raises
`ValueError(f"unhandled power backend {backend!r}; update
_select_source()")`. This catches the case where someone adds a
backend name in one place and forgets the other.

### 6. Real adapters carry their own optional sub-config via env

Per-adapter knobs that don't belong in `hw.py`'s selector enum go
through their own env vars, also read at the module:

  - `MBTILES_PATH` (Sprint 21)
  - `OVERSEER_GPS_DEVICE`, `OVERSEER_GPS_BAUD` (Sprint 22)
  - `OVERSEER_MBTILES_MIN_ZOOM`, `_MAX_ZOOM` (Sprint 21)

These are read at adapter construction, never re-read on every
call. They don't go through `hw.py`'s validator because they're
free-form (paths, device strings, integers).

## Consequences

- New real backend = one file diff in `server/modules/<thing>.py`
  plus the env-var validator entry in `server/hw.py` plus tests.
  Estimated 200–400 LOC per backend based on Sprint 22's POWER and
  GPS work.

- We don't need `server/hw/` as a sub-package. If a backend grows
  beyond ~300 LOC it can move to its own file (e.g.
  `server/modules/power_ina226.py`) but the module that *uses* it
  still owns the selector. We'll re-evaluate at Sprint 24/25 once
  SDR and LoRa exist.

- The `last_error` attribute on each adapter is currently
  undocumented in the public API. A follow-up sprint will expose it
  via `/api/hw/details` and a tooltip on the DISABLED banner so an
  operator can see *why* the backend fell back ("smbus2 unavailable",
  "ADC bus open failed", "gpsd connection refused", …).

- Tests must construct each real adapter twice: once with the
  fallback in place (to confirm graceful degradation), and once with
  a fake I/O object injected (to exercise the real code path's math
  and parsing).

## Alternatives considered

- **Hard fail when a real backend is requested but unavailable.**
  Rejected: incompatible with the headless-dev workflow and with
  field-degradation tolerance.
- **A central `hw.adapters` registry that owns instantiation.**
  Rejected as premature; we only have two real backends so far, and
  the if-ladder is six lines per module.
- **Bundle all optional deps in `requirements.txt`.** Rejected:
  `pyrtlsdr` and friends are not wheels-everywhere, and dev install
  shouldn't depend on the SDR toolchain.
