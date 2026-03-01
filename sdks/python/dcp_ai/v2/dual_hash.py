"""
Dual-hash (SHA-256 + SHA3-256) utilities for DCP v2 post-quantum readiness.
"""

from __future__ import annotations

import hashlib


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha3_256_hex(data: bytes) -> str:
    return hashlib.sha3_256(data).hexdigest()


def dual_hash(data: bytes) -> dict[str, str]:
    return {
        "sha256": sha256_hex(data),
        "sha3_256": sha3_256_hex(data),
    }


def dual_hash_canonical(canonical_json: str) -> dict[str, str]:
    return dual_hash(canonical_json.encode("utf-8"))


def _merkle_root_hex(leaves: list[str], hash_fn: type[object] | None = None) -> str | None:
    """Compute a Merkle root from hex-encoded leaf hashes using the given hashlib constructor."""
    if not leaves:
        return None
    layer = list(leaves)
    while len(layer) > 1:
        if len(layer) % 2 == 1:
            layer.append(layer[-1])
        next_layer: list[str] = []
        for i in range(0, len(layer), 2):
            combined = bytes.fromhex(layer[i]) + bytes.fromhex(layer[i + 1])
            if hash_fn is not None:
                next_layer.append(hash_fn(combined).hexdigest())  # type: ignore[operator]
            else:
                next_layer.append(hashlib.sha256(combined).hexdigest())
        layer = next_layer
    return layer[0]


def dual_merkle_root(leaves: list[dict[str, str]]) -> dict[str, str] | None:
    """Compute dual Merkle roots from a list of dual-hash dicts.

    Each leaf dict must have 'sha256' and 'sha3_256' keys.
    Returns dict with sha256 and sha3_256 Merkle roots, or None if empty.
    """
    if not leaves:
        return None
    sha256_leaves = [leaf["sha256"] for leaf in leaves]
    sha3_leaves = [leaf["sha3_256"] for leaf in leaves]
    return {
        "sha256": _merkle_root_hex(sha256_leaves, hashlib.sha256) or "",
        "sha3_256": _merkle_root_hex(sha3_leaves, hashlib.sha3_256) or "",
    }
