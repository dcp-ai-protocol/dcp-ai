"""
Signed payload preparation and verification for DCP v2.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_sig import CompositeSignature
from dcp_ai.v2.dual_hash import sha256_hex


@dataclass
class SignedPayloadData:
    payload: Any
    payload_hash: str
    composite_sig: CompositeSignature


def prepare_payload(payload: Any) -> tuple[bytes, str]:
    """Canonicalize a payload and compute its prefixed hash.

    Returns (canonical_bytes, payload_hash) where payload_hash is "sha256:<hex>".
    """
    canonical = canonicalize_v2(payload)
    canonical_bytes = canonical.encode("utf-8")
    hex_digest = sha256_hex(canonical_bytes)
    return canonical_bytes, f"sha256:{hex_digest}"


def verify_payload_hash(signed: dict[str, Any]) -> bool:
    """Re-canonicalize signed["payload"] and check it matches signed["payload_hash"]."""
    _, expected_hash = prepare_payload(signed["payload"])
    return signed.get("payload_hash") == expected_hash
