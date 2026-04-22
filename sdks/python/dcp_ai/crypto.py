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
    import base64
    sk_bytes = signing_key.encode() + verify_key.encode()
    return {
        "public_key_b64": verify_key.encode(encoder=nacl.encoding.Base64Encoder).decode("ascii"),
        "secret_key_b64": base64.b64encode(sk_bytes).decode("ascii"),
    }


def _to_b64(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode("ascii")


def _from_b64(s: str) -> bytes:
    import base64
    return base64.b64decode(s)


def sign_object(obj: Any, secret_key_b64: str) -> str:
    """Sign a JSON object with Ed25519 (detached). Returns base64 signature."""
    from dcp_ai.observability.telemetry import dcp_telemetry
    import time as _time

    span_id = dcp_telemetry.start_span("dcp.sign", {"algorithm": "ed25519"})
    t0 = _time.perf_counter()
    try:
        msg = canonicalize(obj).encode("utf-8")
        sk_bytes = _from_b64(secret_key_b64)
        signing_key = nacl.signing.SigningKey(sk_bytes[:32])
        signed = signing_key.sign(msg)
        # Detached signature is the first 64 bytes
        result = _to_b64(signed.signature)
    except Exception as exc:
        dcp_telemetry.end_span(span_id, status="error", error=str(exc))
        dcp_telemetry.record_error("sign", str(exc))
        raise
    dcp_telemetry.record_sign_latency((_time.perf_counter() - t0) * 1000.0, "ed25519")
    dcp_telemetry.end_span(span_id)
    return result


def verify_object(obj: Any, signature_b64: str, public_key_b64: str) -> bool:
    """Verify an Ed25519 detached signature on a JSON object."""
    from dcp_ai.observability.telemetry import dcp_telemetry
    import time as _time

    span_id = dcp_telemetry.start_span("dcp.verify", {"algorithm": "ed25519"})
    t0 = _time.perf_counter()
    try:
        msg = canonicalize(obj).encode("utf-8")
        sig = _from_b64(signature_b64)
        pk_bytes = _from_b64(public_key_b64)
        verify_key = nacl.signing.VerifyKey(pk_bytes)
        try:
            verify_key.verify(msg, sig)
            ok = True
        except nacl.exceptions.BadSignatureError:
            ok = False
    except Exception as exc:
        dcp_telemetry.end_span(span_id, status="error", error=str(exc))
        dcp_telemetry.record_error("verify", str(exc))
        raise
    dcp_telemetry.record_verify_latency((_time.perf_counter() - t0) * 1000.0, "ed25519")
    dcp_telemetry.end_span(span_id)
    return ok


def public_key_from_secret(secret_key_b64: str) -> str:
    """Derive the public key from a secret key (base64)."""
    sk_bytes = _from_b64(secret_key_b64)
    signing_key = nacl.signing.SigningKey(sk_bytes[:32])
    return _to_b64(signing_key.verify_key.encode())
