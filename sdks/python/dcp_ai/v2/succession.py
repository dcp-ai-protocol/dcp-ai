"""
DCP-06 v2.0 Digital Succession — Python port.

Implements digital testaments, succession ceremonies, and memory transfer
manifests. Mirrors sdks/typescript/src/core/succession.ts semantics.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    )


async def create_digital_testament(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    agent_id: str,
    session_nonce: str,
    successor_preferences: list[dict[str, Any]],
    memory_classification: dict[str, str],
    human_consent_required: bool,
) -> dict[str, Any]:
    """Create a first-version digital testament (prev_testament_hash = 'GENESIS')."""
    now = _utc_now()
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "agent_id": agent_id,
        "session_nonce": session_nonce,
        "created_at": now,
        "last_updated": now,
        "successor_preferences": successor_preferences,
        "memory_classification": memory_classification,
        "human_consent_required": human_consent_required,
        "testament_version": 1,
        "prev_testament_hash": "GENESIS",
    }

    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Succession"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


async def update_digital_testament(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    previous_testament: dict[str, Any],
    *,
    session_nonce: str,
    successor_preferences: list[dict[str, Any]] | None = None,
    memory_classification: dict[str, str] | None = None,
    human_consent_required: bool | None = None,
) -> dict[str, Any]:
    """Update an existing testament. Increments version and chains the hash."""
    prev_payload = {k: v for k, v in previous_testament.items() if k != "composite_sig"}
    prev_hash = "sha256:" + hashlib.sha256(
        canonicalize_v2(prev_payload).encode("utf-8")
    ).hexdigest()

    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "agent_id": previous_testament["agent_id"],
        "session_nonce": session_nonce,
        "created_at": previous_testament["created_at"],
        "last_updated": _utc_now(),
        "successor_preferences": (
            successor_preferences
            if successor_preferences is not None
            else previous_testament["successor_preferences"]
        ),
        "memory_classification": (
            memory_classification
            if memory_classification is not None
            else previous_testament["memory_classification"]
        ),
        "human_consent_required": (
            human_consent_required
            if human_consent_required is not None
            else previous_testament["human_consent_required"]
        ),
        "testament_version": int(previous_testament["testament_version"]) + 1,
        "prev_testament_hash": prev_hash,
    }

    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Succession"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


def classify_memory(
    entries: list[dict[str, Any]],
    classification: dict[str, str],
) -> dict[str, Any]:
    """Partition memory entries into operational (transferable) and relational (to destroy).

    Each entry must have {"hash": str, "category": str, "size": int}.
    Default disposition for unknown categories is "destroy".

    Returns {"operational": [...], "relational_destroyed": [hash, ...]}.
    """
    operational: list[dict[str, Any]] = []
    relational_destroyed: list[str] = []

    for entry in entries:
        disposition = classification.get(entry["category"], "destroy")
        if disposition == "transfer":
            operational.append(entry)
        elif disposition == "destroy":
            relational_destroyed.append(entry["hash"])

    return {"operational": operational, "relational_destroyed": relational_destroyed}


async def create_memory_transfer_manifest(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    session_nonce: str,
    predecessor_agent_id: str,
    successor_agent_id: str,
    operational_memory: list[dict[str, Any]],
    relational_memory_destroyed: list[str],
    transfer_hash: dict[str, str],
) -> dict[str, Any]:
    """Produce a memory transfer manifest with a dual-hash root."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "session_nonce": session_nonce,
        "predecessor_agent_id": predecessor_agent_id,
        "successor_agent_id": successor_agent_id,
        "timestamp": _utc_now(),
        "operational_memory": operational_memory,
        "relational_memory_destroyed": relational_memory_destroyed,
        "transfer_hash": transfer_hash,
    }

    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Succession"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


async def execute_succession(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    predecessor_agent_id: str,
    successor_agent_id: str,
    session_nonce: str,
    transition_type: str,
    human_consent: dict[str, Any] | None,
    ceremony_participants: list[str],
    memory_transfer_manifest_hash: str,
) -> dict[str, Any]:
    """Execute a succession ceremony. Requires at least one participant."""
    if not ceremony_participants:
        raise ValueError("Succession ceremony requires at least one participant")

    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "predecessor_agent_id": predecessor_agent_id,
        "successor_agent_id": successor_agent_id,
        "session_nonce": session_nonce,
        "timestamp": _utc_now(),
        "transition_type": transition_type,
        "human_consent": human_consent,
        "ceremony_participants": ceremony_participants,
        "memory_transfer_manifest_hash": memory_transfer_manifest_hash,
    }

    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Succession"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}
