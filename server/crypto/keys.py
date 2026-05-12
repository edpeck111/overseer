"""Operator identity keys + ephemeral DH keypairs.

Real ed25519 (signing) + x25519 (key exchange) via pyca/cryptography.
Sprint 6 lands the cryptographic primitives behind a clean Keystore
API; storage at-rest is a Sprint 17 SYSTEM concern (PIN-derived
encryption — same pattern as the AUSPICE journal keystore).
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, x25519
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


@dataclass(frozen=True)
class Identity:
    """A persistent operator identity. The signing key proves who you
    are; the dh_pub is the long-lived component of the key exchange."""
    callsign: str
    sign_priv: ed25519.Ed25519PrivateKey
    dh_priv:   x25519.X25519PrivateKey

    @property
    def sign_pub(self) -> ed25519.Ed25519PublicKey:
        return self.sign_priv.public_key()

    @property
    def dh_pub(self) -> x25519.X25519PublicKey:
        return self.dh_priv.public_key()

    @property
    def fingerprint(self) -> str:
        """Hex-encoded SHA-256 of the signing public key — short ID."""
        digest = hashes.Hash(hashes.SHA256())
        digest.update(self.sign_pub.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        ))
        return digest.finalize().hex()[:16]

    def serialize_pub(self) -> dict:
        """Public bundle to share with other operators (over CONTACTS)."""
        return {
            "callsign": self.callsign,
            "sign_pub": self.sign_pub.public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw,
            ),
            "dh_pub": self.dh_pub.public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw,
            ),
            "fp": self.fingerprint,
        }


def generate(callsign: str) -> Identity:
    """Generate a fresh Identity with new ed25519 + x25519 keypairs."""
    return Identity(
        callsign=callsign,
        sign_priv=ed25519.Ed25519PrivateKey.generate(),
        dh_priv=x25519.X25519PrivateKey.generate(),
    )


def derive_shared(my_dh_priv: x25519.X25519PrivateKey,
                   peer_dh_pub: x25519.X25519PublicKey,
                   *, info: bytes = b"OVERSEER-COMMS-v1") -> bytes:
    """X25519 → HKDF-SHA256 → 32-byte symmetric key."""
    dh = my_dh_priv.exchange(peer_dh_pub)
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=info,
    ).derive(dh)
