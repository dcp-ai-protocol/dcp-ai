"""
DCP-05 v2.0 Agent Lifecycle Management — Python port.

State machine: commissioned -> active -> declining -> decommissioned.

Mirrors sdks/typescript/src/core/lifecycle.ts semantics exactly — every
artifact produced here is byte-identical to the TS output under the same
input (canonicalisation + composite sign over context "DCP-AI.v2.Lifecycle").
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS

# ── Lifecycle state machine ──

_LifecycleState = str  # "commissioned" | "active" | "declining" | "decommissioned"

_VALID_TRANSITIONS: dict[_LifecycleState, list[_LifecycleState]] = {
    "commissioned": ["active", "decommissioned"],
    "active": ["declining", "decommissioned"],
    "declining": ["decommissioned", "active"],
    "decommissioned": [],
}


def validate_state_transition(from_state: _LifecycleState, to_state: _LifecycleState) -> bool:
    """Return True iff the lifecycle transition from->to is allowed."""
    return to_state in _VALID_TRANSITIONS.get(from_state, [])


# ── Vitality scoring ──

_METRIC_WEIGHTS = {
    "task_completion_rate": 0.3,
    "error_rate": 0.25,
    "human_satisfaction": 0.25,
    "policy_alignment": 0.2,
}


def compute_vitality_score(metrics: dict[str, float]) -> int:
    """Compute a vitality score in 0..1000 from per-metric floats in 0..1.

    error_rate is inverted (lower error = higher score).
    """
    raw = (
        metrics["task_completion_rate"] * _METRIC_WEIGHTS["task_completion_rate"]
        + (1.0 - metrics["error_rate"]) * _METRIC_WEIGHTS["error_rate"]
        + metrics["human_satisfaction"] * _METRIC_WEIGHTS["human_satisfaction"]
        + metrics["policy_alignment"] * _METRIC_WEIGHTS["policy_alignment"]
    )
    clamped = max(0.0, min(1.0, raw))
    return round(clamped * 1000)


# ── Artifact creation ──


def _utc_now() -> str:
    # ISO-8601 UTC with Z suffix, matching the TS `new Date().toISOString()`.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    )


async def create_commissioning_certificate(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    agent_id: str,
    session_nonce: str,
    human_id: str,
    commissioning_authority: str,
    purpose: str,
    initial_capabilities: list[str],
    risk_tier: str,
    principal_binding_reference: str,
) -> dict[str, Any]:
    """Create a commissioning certificate for a new agent."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "agent_id": agent_id,
        "session_nonce": session_nonce,
        "human_id": human_id,
        "commissioning_authority": commissioning_authority,
        "timestamp": _utc_now(),
        "purpose": purpose,
        "initial_capabilities": initial_capabilities,
        "risk_tier": risk_tier,
        "principal_binding_reference": principal_binding_reference,
    }

    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Lifecycle"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


async def create_vitality_report(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    agent_id: str,
    session_nonce: str,
    state: _LifecycleState,
    metrics: dict[str, float],
    prev_report_hash: str,
) -> dict[str, Any]:
    """Create a vitality report hash-chained to the previous report."""
    vitality_score = compute_vitality_score(metrics)
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "agent_id": agent_id,
        "session_nonce": session_nonce,
        "timestamp": _utc_now(),
        "vitality_score": vitality_score,
        "state": state,
        "metrics": metrics,
        "prev_report_hash": prev_report_hash,
    }

    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Lifecycle"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


def hash_vitality_report(report: dict[str, Any]) -> str:
    """Compute sha256 hash of a vitality report (composite_sig excluded) for chaining."""
    payload = {k: v for k, v in report.items() if k != "composite_sig"}
    canonical = canonicalize_v2(payload)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def create_decommissioning_record(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    agent_id: str,
    session_nonce: str,
    human_id: str,
    termination_mode: str,
    reason: str,
    final_vitality_score: int,
    successor_agent_id: str | None,
    data_disposition: str,
) -> dict[str, Any]:
    """Create a decommissioning record."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "agent_id": agent_id,
        "session_nonce": session_nonce,
        "human_id": human_id,
        "timestamp": _utc_now(),
        "termination_mode": termination_mode,
        "reason": reason,
        "final_vitality_score": final_vitality_score,
        "successor_agent_id": successor_agent_id,
        "data_disposition": data_disposition,
    }

    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Lifecycle"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}
