"""
SHA-256 hashing and Merkle tree operations for DCP.
"""

from __future__ import annotations

import hashlib
from typing import Any

from dcp_ai.crypto import canonicalize


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_object(obj: Any) -> str:
    """Compute the SHA-256 hash of a canonicalized JSON object."""
    canon = canonicalize(obj)
    return _sha256_hex(canon.encode("utf-8"))


def merkle_root_from_hex_leaves(leaves: list[str]) -> str | None:
    """Compute Merkle root from an array of hex leaf hashes."""
    if not leaves:
        return None
    layer = list(leaves)
    while len(layer) > 1:
        if len(layer) % 2 == 1:
            layer.append(layer[-1])
        next_layer: list[str] = []
        for i in range(0, len(layer), 2):
            left = bytes.fromhex(layer[i])
            right = bytes.fromhex(layer[i + 1])
            next_layer.append(_sha256_hex(left + right))
        layer = next_layer
    return layer[0]


def merkle_root_for_audit_entries(audit_entries: list[Any]) -> str | None:
    """Compute Merkle root for an array of audit entries."""
    leaves = [hash_object(entry) for entry in audit_entries]
    return merkle_root_from_hex_leaves(leaves)


def intent_hash(intent: Any) -> str:
    """Compute intent_hash for an Intent object (DCP-02)."""
    return hash_object(intent)


def prev_hash_for_entry(prev_entry: Any) -> str:
    """Compute prev_hash for audit entry chaining (DCP-03)."""
    return hash_object(prev_entry)
