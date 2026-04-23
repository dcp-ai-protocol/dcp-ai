"""
DCP v2.0 Lazy PQ Checkpoint — Python port.

Each audit event is signed classically (Ed25519). Every N events a PQ
checkpoint is produced: a composite signature over the Merkle root of
the batch. Gives real-time classical security with periodic PQ assurance.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.security_tier import tier_to_checkpoint_interval


def audit_events_merkle_root(events: list[dict[str, Any]]) -> str:
    """Compute a SHA-256 Merkle root over canonicalised event payloads.

    Returns a 64-char hex string (no "sha256:" prefix).
    """
    if not events:
        raise ValueError("Cannot compute Merkle root of empty event list")

    leaves = [
        hashlib.sha256(canonicalize_v2(e).encode("utf-8")).hexdigest() for e in events
    ]
    while len(leaves) > 1:
        if len(leaves) % 2 == 1:
            leaves.append(leaves[-1])
        next_leaves: list[str] = []
        for i in range(0, len(leaves), 2):
            combined = bytes.fromhex(leaves[i]) + bytes.fromhex(leaves[i + 1])
            next_leaves.append(hashlib.sha256(combined).hexdigest())
        leaves = next_leaves
    return leaves[0]


async def create_pq_checkpoint(
    registry: AlgorithmRegistry,
    events: list[dict[str, Any]],
    session_nonce: str,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
) -> dict[str, Any]:
    """Create a PQ checkpoint over a batch of audit events."""
    if not events:
        raise ValueError("Cannot create checkpoint for empty event list")

    merkle = audit_events_merkle_root(events)
    checkpoint_id = f"ckpt-{uuid.uuid4()}"

    payload: dict[str, Any] = {
        "checkpoint_id": checkpoint_id,
        "session_nonce": session_nonce,
        "event_range": {
            "from_audit_id": events[0]["audit_id"],
            "to_audit_id": events[-1]["audit_id"],
            "count": len(events),
        },
        "merkle_root": f"sha256:{merkle}",
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["AuditEvent"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


class PQCheckpointManager:
    """Collect audit events and produce PQ checkpoints at a configurable interval."""

    def __init__(
        self,
        interval: int,
        registry: AlgorithmRegistry,
        session_nonce: str,
        classical_key: CompositeKeyInfo,
        pq_key: CompositeKeyInfo,
        tier: str | None = None,
    ) -> None:
        if tier is not None:
            self._tier = tier
            self._interval = tier_to_checkpoint_interval(tier)
        else:
            self._tier = None
            self._interval = interval
        if self._interval < 1:
            raise ValueError("Checkpoint interval must be >= 1")
        self._registry = registry
        self._session_nonce = session_nonce
        self._classical_key = classical_key
        self._pq_key = pq_key
        self._pending: list[dict[str, Any]] = []
        self._checkpoints: list[dict[str, Any]] = []

    @property
    def interval(self) -> int:
        return self._interval

    @property
    def tier(self) -> str | None:
        return self._tier

    def set_tier(self, tier: str) -> None:
        """Update the tier at runtime; does not flush pending events."""
        self._tier = tier
        self._interval = tier_to_checkpoint_interval(tier)

    async def record_event(self, event: dict[str, Any]) -> dict[str, Any] | None:
        """Record an event; when pending reaches interval, emit a checkpoint."""
        self._pending.append(event)
        if len(self._pending) >= self._interval:
            return await self.flush()
        return None

    async def flush(self) -> dict[str, Any] | None:
        """Force a checkpoint over all pending events (e.g. at session end)."""
        if not self._pending:
            return None
        checkpoint = await create_pq_checkpoint(
            self._registry,
            self._pending,
            self._session_nonce,
            self._classical_key,
            self._pq_key,
        )
        self._checkpoints.append(checkpoint)
        self._pending = []
        return checkpoint

    def get_checkpoints(self) -> list[dict[str, Any]]:
        return list(self._checkpoints)

    def get_pending_count(self) -> int:
        return len(self._pending)
