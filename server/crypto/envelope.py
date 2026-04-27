"""Encrypted message envelope.

The wire shape stays the same when Sprint 6.5+ swaps in
python-doubleratchet — only the kid semantics tighten (counter
becomes a real chain step). See ADR-0012.

Envelope shape:
    {
      "ct":     <bytes>,   AES-256-GCM ciphertext
      "nonce":  <bytes>,   12 bytes
      "tag":    <bytes>,   16 bytes (GCM auth tag)
      "kid":    <int>,     message index / chain step
      "sig":    <bytes>,   ed25519 over (sender_fp || kid || ct)
      "from":   <str>,     sender callsign
    }
"""

from __future__ import annotations

import os
from dataclasses import dataclass, asdict
from typing import Any, Protocol

from cryptography.hazmat.primitives import hashes, hmac
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


@dataclass
class Envelope:
    ct: bytes
    nonce: bytes
    tag: bytes
    kid: int
    sig: bytes
    sender_fp: str

    def to_wire(self) -> dict:
        # bytes → base64-ascii so the wire is JSON/MsgPack friendly
        import base64
        b64 = lambda b: base64.b64encode(b).decode("ascii")
        return {
            "ct":   b64(self.ct),
            "nonce": b64(self.nonce),
            "tag":  b64(self.tag),
            "kid":  self.kid,
            "sig":  b64(self.sig),
            "from": self.sender_fp,
        }

    @staticmethod
    def from_wire(d: dict) -> "Envelope":
        import base64
        b = lambda s: base64.b64decode(s)
        return Envelope(
            ct=b(d["ct"]), nonce=b(d["nonce"]), tag=b(d["tag"]),
            kid=d["kid"], sig=b(d["sig"]), sender_fp=d["from"],
        )


class Ratchet(Protocol):
    """The minimum API both SyntheticRatchet and (future) SignalRatchet
    expose. Call sites stay unchanged across the swap."""

    def encrypt(self, plaintext: bytes, *, aad: bytes = b"") -> Envelope: ...
    def decrypt(self, env: Envelope) -> bytes: ...


@dataclass
class SyntheticRatchet:
    """Sprint-6 synthetic ratchet — real AEAD, fake forward secrecy.

    Both sides share a 32-byte root key (derived via X25519 + HKDF on
    initial handshake — see crypto.keys.derive_shared). Each message
    derives its own AEAD key via HKDF(root || counter), so message-
    level confidentiality is real. What's missing: ratchet renewal —
    if the root key leaks, every past + future message decrypts. The
    real ratchet (ADR-0012) plugs in here without changing the wire.
    """

    root_key: bytes
    sender_fp: str
    sender_sign: ed25519.Ed25519PrivateKey
    counter: int = 0

    def encrypt(self, plaintext: bytes, *, aad: bytes = b"") -> Envelope:
        kid = self.counter
        self.counter += 1
        per_msg_key = self._derive(kid)
        nonce = os.urandom(12)
        aead = AESGCM(per_msg_key)
        ct_with_tag = aead.encrypt(nonce, plaintext, aad)
        # AESGCM.encrypt returns ciphertext||tag; split off the 16-byte tag.
        ct, tag = ct_with_tag[:-16], ct_with_tag[-16:]
        sig = self.sender_sign.sign(self.sender_fp.encode() + kid.to_bytes(4, "big") + ct)
        return Envelope(ct=ct, nonce=nonce, tag=tag, kid=kid, sig=sig, sender_fp=self.sender_fp)

    def decrypt(self, env: Envelope) -> bytes:
        per_msg_key = self._derive(env.kid)
        aead = AESGCM(per_msg_key)
        return aead.decrypt(env.nonce, env.ct + env.tag, b"")

    def _derive(self, counter: int) -> bytes:
        return HKDF(
            algorithm=hashes.SHA256(), length=32, salt=None,
            info=b"OVERSEER-COMMS-v1-msg-" + counter.to_bytes(4, "big"),
        ).derive(self.root_key)
