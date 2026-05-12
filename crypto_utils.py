"""
OVERSEER LoRa Encryption — Ed25519/X25519 ECDH + AES-256-GCM.

Key flow:
  1. Each user has an Ed25519 keypair (identity, already in OVERSEER)
  2. Ed25519 keys are converted to X25519 (Curve25519) for ECDH
  3. ECDH key agreement derives a shared secret per sender-recipient pair
  4. HKDF-SHA256 stretches the shared secret into an AES-256-GCM key
  5. Each chunk is encrypted with AES-256-GCM (12-byte nonce + 16-byte tag)
  6. Overhead: 28 bytes per chunk → 190 bytes usable payload (of 218 max)

Nonce strategy: 12 bytes = 4 bytes msg_id + 1 byte chunk_index + 7 bytes random.
This prevents nonce reuse across messages and chunks while keeping randomness
as a safety margin.
"""

import os
import struct
import hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Ed25519 curve prime
_ED25519_P = 2**255 - 19


# ── Key Conversion ────────────────────────────────────────────────────────

def ed25519_private_to_x25519(ed_private: Ed25519PrivateKey) -> X25519PrivateKey:
    """Convert an Ed25519 private key to X25519 for ECDH key agreement.

    Follows the same derivation as libsodium's crypto_sign_ed25519_sk_to_curve25519:
    hash the 32-byte seed with SHA-512, take the first 32 bytes, and clamp per RFC 7748.
    """
    seed = ed_private.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    h = bytearray(hashlib.sha512(seed).digest()[:32])
    # Clamp per RFC 7748
    h[0] &= 248
    h[31] &= 127
    h[31] |= 64
    return X25519PrivateKey.from_private_bytes(bytes(h))


def ed25519_public_to_x25519(ed_public: Ed25519PublicKey) -> X25519PublicKey:
    """Convert an Ed25519 public key to X25519 for ECDH key agreement.

    Uses the birational Edwards-to-Montgomery map: u = (1 + y) / (1 - y) mod p,
    matching libsodium's crypto_sign_ed25519_pk_to_curve25519.
    """
    raw = ed_public.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    # Ed25519 public key is a compressed Edwards point encoding the y-coordinate
    # (little-endian) with the sign bit of x in the top bit of the last byte.
    y_bytes = bytearray(raw)
    y_bytes[31] &= 0x7F  # clear sign bit
    y = int.from_bytes(y_bytes, "little")

    # Montgomery u-coordinate: u = (1 + y) * (1 - y)^(-1) mod p
    p = _ED25519_P
    u = ((1 + y) * pow(1 - y, p - 2, p)) % p
    u_bytes = u.to_bytes(32, "little")

    return X25519PublicKey.from_public_bytes(u_bytes)


# ── Key Loading ───────────────────────────────────────────────────────────

def load_private_key(pem_path: str) -> Ed25519PrivateKey:
    """Load an Ed25519 private key from PEM file."""
    with open(pem_path, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def load_public_key(pem_path: str) -> Ed25519PublicKey:
    """Load an Ed25519 public key from PEM file."""
    with open(pem_path, "rb") as f:
        return serialization.load_pem_public_key(f.read())


# ── ECDH Key Agreement ───────────────────────────────────────────────────

HKDF_INFO = b"OVERSEER-LoRa-v1"
AES_KEY_SIZE = 32  # AES-256


def derive_shared_key(
    my_private: Ed25519PrivateKey,
    their_public: Ed25519PublicKey,
) -> bytes:
    """Derive a shared AES-256 key from Ed25519 keypair via X25519 ECDH + HKDF.

    The same key is derived regardless of who is sender vs recipient,
    because ECDH is commutative: A_priv * B_pub == B_priv * A_pub.
    """
    x_private = ed25519_private_to_x25519(my_private)
    x_public = ed25519_public_to_x25519(their_public)

    shared_secret = x_private.exchange(x_public)

    # Stretch through HKDF for key separation
    aes_key = HKDF(
        algorithm=hashes.SHA256(),
        length=AES_KEY_SIZE,
        salt=None,  # no salt — deterministic derivation from shared secret
        info=HKDF_INFO,
    ).derive(shared_secret)

    return aes_key


# ── AES-256-GCM Encryption ───────────────────────────────────────────────

NONCE_SIZE = 12  # GCM standard
TAG_SIZE = 16    # GCM tag (appended by AESGCM)
ENCRYPTION_OVERHEAD = NONCE_SIZE + TAG_SIZE  # 28 bytes


def build_nonce(msg_id: int, chunk_index: int) -> bytes:
    """Build a 12-byte nonce from message context + randomness.
    Format: [msg_id: 4 bytes][chunk_index: 1 byte][random: 7 bytes]
    """
    return struct.pack(">IB", msg_id & 0xFFFFFFFF, chunk_index & 0xFF) + os.urandom(7)


def encrypt(plaintext: bytes, aes_key: bytes, msg_id: int, chunk_index: int) -> bytes:
    """Encrypt with AES-256-GCM. Returns nonce + ciphertext + tag."""
    nonce = build_nonce(msg_id, chunk_index)
    aesgcm = AESGCM(aes_key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)  # no associated data
    return nonce + ciphertext  # ciphertext includes the 16-byte GCM tag


def decrypt(data: bytes, aes_key: bytes) -> bytes:
    """Decrypt AES-256-GCM. Input is nonce + ciphertext + tag."""
    if len(data) < NONCE_SIZE + TAG_SIZE:
        raise ValueError(f"Encrypted data too short: {len(data)} bytes")
    nonce = data[:NONCE_SIZE]
    ciphertext = data[NONCE_SIZE:]
    aesgcm = AESGCM(aes_key)
    return aesgcm.decrypt(nonce, ciphertext, None)


# ── Session Key Cache ─────────────────────────────────────────────────────

class KeyStore:
    """Caches derived AES keys for known peers.

    Usage:
        store = KeyStore(my_private_key)
        store.add_peer(peer_id, peer_public_key)
        encrypted = store.encrypt_for(peer_id, plaintext, msg_id, chunk_index)
        decrypted = store.decrypt_from(peer_id, ciphertext_with_nonce)
    """

    def __init__(self, my_private: Ed25519PrivateKey):
        self._my_private = my_private
        self._peer_keys: dict[int, bytes] = {}  # peer_id -> AES-256 key

    def add_peer(self, peer_id: int, peer_public: Ed25519PublicKey) -> None:
        """Register a peer's public key and derive the shared AES key."""
        self._peer_keys[peer_id] = derive_shared_key(self._my_private, peer_public)

    def has_peer(self, peer_id: int) -> bool:
        return peer_id in self._peer_keys

    def encrypt_for(self, peer_id: int, plaintext: bytes, msg_id: int, chunk_index: int) -> bytes:
        """Encrypt data for a specific peer."""
        if peer_id not in self._peer_keys:
            raise KeyError(f"No key for peer {peer_id}")
        return encrypt(plaintext, self._peer_keys[peer_id], msg_id, chunk_index)

    def decrypt_from(self, peer_id: int, data: bytes) -> bytes:
        """Decrypt data from a specific peer."""
        if peer_id not in self._peer_keys:
            raise KeyError(f"No key for peer {peer_id}")
        return decrypt(data, self._peer_keys[peer_id])

    def make_encrypt_fn(self, peer_id: int, msg_id: int):
        """Return a closure suitable for chunk_payload(encrypt_fn=...).

        The closure tracks chunk_index internally so each chunk gets a unique nonce.
        """
        aes_key = self._peer_keys.get(peer_id)
        if aes_key is None:
            raise KeyError(f"No key for peer {peer_id}")
        state = {"chunk_idx": 0}

        def _encrypt(plaintext: bytes) -> bytes:
            result = encrypt(plaintext, aes_key, msg_id, state["chunk_idx"])
            state["chunk_idx"] += 1
            return result

        return _encrypt

    def make_decrypt_fn(self, peer_id: int):
        """Return a closure suitable for ReassemblyBuffer(decrypt_fn=...)."""
        aes_key = self._peer_keys.get(peer_id)
        if aes_key is None:
            raise KeyError(f"No key for peer {peer_id}")

        def _decrypt(data: bytes) -> bytes:
            return decrypt(data, aes_key)

        return _decrypt
