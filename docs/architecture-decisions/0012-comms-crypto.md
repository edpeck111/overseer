# ADR-0012: COMMS crypto — pyca/cryptography primitives + synthetic-ratchet

**Status:** Accepted (Sprint 6)
**Deciders:** Ted (delegated; standing autonomous mandate); recorded by Sprint 6 author

## Context

Sprint 6 (COMMS) needs encrypted messaging between operators. The
design spec calls for Signal-style double-ratchet over ed25519/x25519
identity + AES-256-GCM symmetric. Per Ted's Sprint-6 directive, do not
roll our own crypto — pick a well-audited library, document the
choice, ship synthetic test vectors if real keys aren't needed for the
gate.

## Decision

**Three layers, each independently swappable.**

### 1. Identity + key exchange — `pyca/cryptography` (real)

ed25519 for long-term identity signing; x25519 for ephemeral DH. The
`cryptography` package is the canonical Python crypto library, FIPS-
auditable, used by `requests`, `urllib3`, and most of the Python
ecosystem. Already in `requirements.txt`. No new dependency.

```python
from cryptography.hazmat.primitives.asymmetric import x25519, ed25519
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
```

We generate per-operator identity keypairs at first launch, stored
under operator-PIN-derived encryption (the same keystore pattern
AUSPICE uses for journal encryption). Ephemeral x25519 keypairs roll
per-message.

### 2. Symmetric encryption — `pyca/cryptography` AES-256-GCM (real)

`AESGCM(key)` from `cryptography.hazmat.primitives.ciphers.aead`.
Standard AEAD — confidentiality + integrity + AAD support. 96-bit
nonce per message. The shared key is derived fresh per-message via
HKDF(shared_secret || message_index), so even though we don't have
true forward secrecy from a full ratchet (see §3), each message has
its own AEAD key.

### 3. Forward secrecy / ratchet — synthetic for Sprint 6

A real Signal double-ratchet has two parts: the symmetric chain
(forward secrecy within a session) and the DH ratchet (forward
secrecy across sessions). `python-doubleratchet` (PyPI: `DoubleRatchet
1.3.0`, by syndace) is the only well-audited Python implementation —
correct choice for production. **It is NOT installed in Sprint 6**
because:

  - The JS-side counterpart (`@privacyresearch/libsignal-protocol-typescript`
    or `@signalapp/libsignal-client`) needs to land at the same time
    or the wire formats diverge.
  - Sprint 6's gate is "two simulated operators exchange encrypted
    messages over the mesh simulator with multi-hop routing; ratchet
    state survives across reconnects; board posts visible to all."
    The "encrypted" half is met by AEAD with HKDF-derived per-message
    keys; the "ratchet state survives reconnects" half is met by a
    deterministic message counter that both sides advance on each
    delivery. No forward secrecy, but the wire format is real.
  - Per the standing autonomous mandate (synthetic over real hardware,
    conservative scope), ship a clean `Ratchet` protocol with a
    synthetic implementation; flip `OVERSEER_COMMS_RATCHET=signal` to
    swap in `python-doubleratchet` once both sides have it.

```python
class Ratchet(Protocol):
    def encrypt(self, plaintext: bytes, *, aad: bytes = b"") -> Envelope: ...
    def decrypt(self, env: Envelope) -> bytes: ...
```

Synthetic implementation: `SyntheticRatchet`. Real implementation
(future): `SignalRatchet` wraps `DoubleRatchet`. Same Envelope shape,
same call sites unchanged.

### 4. Wire envelope (real)

```
{
  "ct":     <bytes>,    # AES-256-GCM ciphertext
  "nonce":  <bytes>,    # 12 bytes
  "tag":    <bytes>,    # 16 bytes (GCM auth tag)
  "kid":    <int>,      # message index — Sprint 6's "ratchet step"
  "sig":    <bytes>,    # ed25519 over (sender_id || msg_id || ct)
}
```

This shape is what the real ratchet emits too. Sprint 6's
`SyntheticRatchet` populates all five; Sprint 6.5+ `SignalRatchet`
fills `kid` from real ratchet state.

## Why not roll our own ratchet

Per Ted's directive. Even setting that aside: implementing a Signal
double-ratchet from scratch is a known footgun (Heartbleed-class bug
surface). `python-doubleratchet` exists, is maintained, and is used in
production by OMEMO. We swap it in cleanly when the JS counterpart
is in.

## Consequences

  - **Real keys, real AEAD, real signatures from Sprint 6 onwards.**
    No fake crypto; just the missing forward-secrecy layer.
  - **Wire format is final.** Switching to the real ratchet doesn't
    change the envelope shape — `kid` semantics tighten (today's
    monotonic counter becomes the real chain step) but field names +
    sizes stay.
  - **Two-operator gate test uses two real keypairs, real AEAD.** The
    only synthetic part is that compromising the message key today
    decrypts past + future messages from that pair, which a real
    ratchet would prevent.
  - **Migration to `signal-protocol`** (the Rust bindings via maturin)
    is a Sprint-7+ option if `python-doubleratchet`'s pure-Python perf
    becomes a bottleneck. The Rust binding has tighter security
    boundaries but installation involves a wheel + maturin build that
    might not land cleanly on every dev box.

## Revisit triggers

  - JS-side ratchet library lands → flip `OVERSEER_COMMS_RATCHET=signal`
    on Python side, same flag on JS side, gate exercises full forward
    secrecy.
  - PyPI `DoubleRatchet` security advisory → re-evaluate, pin to a
    safe version or vendor a frozen copy.
  - OPi5 Ollama load competing with Python ratchet CPU → consider
    moving to `signal-protocol` Rust binding.
