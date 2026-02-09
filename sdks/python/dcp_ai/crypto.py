"""
Ed25519 signing and verification for DCP bundles.
Uses PyNaCl for cryptographic operations.
"""

from __future__ import annotations

import json
from typing import Any

import nacl.signing
import nacl.encoding


def canonicalize(obj: Any) -> str:
    """Canonical JSON serialization (deterministic key ordering, no whitespace)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def generate_keypair() -> dict[str, str]:
    """Generate a new Ed25519 keypair. Returns dict with public_key_b64 and secret_key_b64."""
    signing_key = nacl.signing.SigningKey.generate()
    verify_key = signing_key.verify_key
    return {
        "public_key_b64": verify_key.encode(encoder=nacl.encoding.Base64Encoder).decode("ascii"),
        "secret_key_b64": (signing_key.encode() + verify_key.encode()),
    }


def _to_b64(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode("ascii")


def _from_b64(s: str) -> bytes:
    import base64
    return base64.b64decode(s)


def sign_object(obj: Any, secret_key_b64: str) -> str:
    """Sign a JSON object with Ed25519 (detached). Returns base64 signature."""
    msg = canonicalize(obj).encode("utf-8")
    sk_bytes = _from_b64(secret_key_b64)
    signing_key = nacl.signing.SigningKey(sk_bytes[:32])
    signed = signing_key.sign(msg)
    # Detached signature is the first 64 bytes
    return _to_b64(signed.signature)


def verify_object(obj: Any, signature_b64: str, public_key_b64: str) -> bool:
    """Verify an Ed25519 detached signature on a JSON object."""
    msg = canonicalize(obj).encode("utf-8")
    sig = _from_b64(signature_b64)
    pk_bytes = _from_b64(public_key_b64)
    verify_key = nacl.signing.VerifyKey(pk_bytes)
    try:
        verify_key.verify(msg, sig)
        return True
    except nacl.exceptions.BadSignatureError:
        return False


def public_key_from_secret(secret_key_b64: str) -> str:
    """Derive the public key from a secret key (base64)."""
    sk_bytes = _from_b64(secret_key_b64)
    signing_key = nacl.signing.SigningKey(sk_bytes[:32])
    return _to_b64(signing_key.verify_key.encode())
