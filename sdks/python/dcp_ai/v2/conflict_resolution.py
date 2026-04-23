"""
DCP-07 v2.0 Conflict Resolution — Python port.

Disputes follow a three-level escalation model:
    direct_negotiation -> contextual_arbitration -> human_appeal
"""

from __future__ import annotations

from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.lifecycle import _utc_now  # reuse the shared ISO-8601 helper

_ESCALATION_ORDER = [
    "direct_negotiation",
    "contextual_arbitration",
    "human_appeal",
]


async def _sign_dispute(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    payload: dict[str, Any],
) -> dict[str, Any]:
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Dispute"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


async def create_dispute(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    dispute_id: str,
    session_nonce: str,
    initiator_agent_id: str,
    respondent_agent_id: str,
    dispute_type: str,
    evidence_hashes: list[str],
) -> dict[str, Any]:
    """Create a new dispute record at the direct_negotiation level."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "dispute_id": dispute_id,
        "session_nonce": session_nonce,
        "initiator_agent_id": initiator_agent_id,
        "respondent_agent_id": respondent_agent_id,
        "dispute_type": dispute_type,
        "evidence_hashes": evidence_hashes,
        "escalation_level": "direct_negotiation",
        "status": "open",
        "timestamp": _utc_now(),
    }
    return await _sign_dispute(registry, classical_key, pq_key, payload)


async def escalate_dispute(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    dispute: dict[str, Any],
    session_nonce: str,
) -> dict[str, Any]:
    """Escalate a dispute to the next level; raises ValueError at the ceiling."""
    current = dispute["escalation_level"]
    try:
        idx = _ESCALATION_ORDER.index(current)
    except ValueError as exc:
        raise ValueError(f"Unknown escalation_level: {current!r}") from exc
    if idx >= len(_ESCALATION_ORDER) - 1:
        raise ValueError("Dispute is already at maximum escalation level (human_appeal)")
    next_level = _ESCALATION_ORDER[idx + 1]

    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "dispute_id": dispute["dispute_id"],
        "session_nonce": session_nonce,
        "initiator_agent_id": dispute["initiator_agent_id"],
        "respondent_agent_id": dispute["respondent_agent_id"],
        "dispute_type": dispute["dispute_type"],
        "evidence_hashes": dispute["evidence_hashes"],
        "escalation_level": next_level,
        "status": "in_negotiation",
        "timestamp": _utc_now(),
    }
    return await _sign_dispute(registry, classical_key, pq_key, payload)


async def resolve_dispute(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    dispute: dict[str, Any],
    session_nonce: str,
) -> dict[str, Any]:
    """Mark a dispute as resolved, preserving its current escalation level."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "dispute_id": dispute["dispute_id"],
        "session_nonce": session_nonce,
        "initiator_agent_id": dispute["initiator_agent_id"],
        "respondent_agent_id": dispute["respondent_agent_id"],
        "dispute_type": dispute["dispute_type"],
        "evidence_hashes": dispute["evidence_hashes"],
        "escalation_level": dispute["escalation_level"],
        "status": "resolved",
        "timestamp": _utc_now(),
    }
    return await _sign_dispute(registry, classical_key, pq_key, payload)


async def create_objection(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    objection_id: str,
    session_nonce: str,
    agent_id: str,
    directive_hash: str,
    objection_type: str,
    reasoning: str,
    proposed_alternative: str | None,
    human_escalation_required: bool,
) -> dict[str, Any]:
    """Create a formal objection to a directive."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "objection_id": objection_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "directive_hash": directive_hash,
        "objection_type": objection_type,
        "reasoning": reasoning,
        "proposed_alternative": proposed_alternative,
        "human_escalation_required": human_escalation_required,
        "timestamp": _utc_now(),
    }
    return await _sign_dispute(registry, classical_key, pq_key, payload)
