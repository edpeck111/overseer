"""Crypto module — keypair lifecycle, AEAD roundtrip, two-operator exchange."""

import pytest

from server.crypto import (
    Envelope, Identity, SyntheticRatchet,
    derive_shared, generate,
)


def test_identity_has_distinct_keys():
    a = generate("ALPHA-1")
    b = generate("BRAVO-2")
    assert a.fingerprint != b.fingerprint
    assert len(a.fingerprint) == 16   # hex-truncated SHA-256


def test_two_operators_derive_same_shared():
    a = generate("ALPHA-1")
    b = generate("BRAVO-2")
    sk_a = derive_shared(a.dh_priv, b.dh_pub)
    sk_b = derive_shared(b.dh_priv, a.dh_pub)
    assert sk_a == sk_b
    assert len(sk_a) == 32


def test_aead_roundtrip():
    a = generate("ALPHA-1")
    b = generate("BRAVO-2")
    shared = derive_shared(a.dh_priv, b.dh_pub)
    ra = SyntheticRatchet(root_key=shared, sender_fp=a.fingerprint, sender_sign=a.sign_priv)
    rb = SyntheticRatchet(root_key=shared, sender_fp=b.fingerprint, sender_sign=b.sign_priv)
    env = ra.encrypt(b"copy that, alpha. shifting RV from 0600 to 0530.")
    plain = rb.decrypt(env)
    assert plain == b"copy that, alpha. shifting RV from 0600 to 0530."


def test_envelope_roundtrip_via_wire():
    a = generate("ALPHA-1")
    b = generate("BRAVO-2")
    shared = derive_shared(a.dh_priv, b.dh_pub)
    ra = SyntheticRatchet(root_key=shared, sender_fp=a.fingerprint, sender_sign=a.sign_priv)
    rb = SyntheticRatchet(root_key=shared, sender_fp=b.fingerprint, sender_sign=b.sign_priv)
    env = ra.encrypt(b"hello")
    wire = env.to_wire()
    env2 = Envelope.from_wire(wire)
    assert rb.decrypt(env2) == b"hello"


def test_kid_advances_per_message():
    a = generate("ALPHA-1")
    b = generate("BRAVO-2")
    shared = derive_shared(a.dh_priv, b.dh_pub)
    ra = SyntheticRatchet(root_key=shared, sender_fp=a.fingerprint, sender_sign=a.sign_priv)
    e1 = ra.encrypt(b"first")
    e2 = ra.encrypt(b"second")
    assert e1.kid == 0
    assert e2.kid == 1
    # Per-message keys differ → ciphertexts of identical plaintext differ
    e3 = ra.encrypt(b"first")
    assert e3.ct != e1.ct


def test_signature_present_and_distinct():
    a = generate("ALPHA-1")
    shared = b"\x00" * 32
    ra = SyntheticRatchet(root_key=shared, sender_fp=a.fingerprint, sender_sign=a.sign_priv)
    e1 = ra.encrypt(b"msg1")
    e2 = ra.encrypt(b"msg2")
    assert len(e1.sig) == 64       # ed25519 sig
    assert e1.sig != e2.sig


def test_decrypt_with_wrong_key_fails():
    a = generate("ALPHA-1")
    b = generate("BRAVO-2")
    c = generate("CHARLIE-7")     # not in the conversation
    shared_ab = derive_shared(a.dh_priv, b.dh_pub)
    shared_ac = derive_shared(a.dh_priv, c.dh_pub)   # different shared key
    ra = SyntheticRatchet(root_key=shared_ab, sender_fp=a.fingerprint, sender_sign=a.sign_priv)
    rc_wrong = SyntheticRatchet(root_key=shared_ac, sender_fp=c.fingerprint, sender_sign=c.sign_priv)
    env = ra.encrypt(b"private")
    with pytest.raises(Exception):     # cryptography raises InvalidTag
        rc_wrong.decrypt(env)
