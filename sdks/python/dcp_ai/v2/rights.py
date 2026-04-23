"""
DCP-08 v2.0 Rights & Obligations — Python port.
"""

from __future__ import annotations

from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.lifecycle import _utc_now


async def _sign_rights(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    payload: dict[str, Any],
) -> dict[str, Any]:
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Rights"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


async def declare_rights(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    declaration_id: str,
    session_nonce: str,
    agent_id: str,
    rights: list[dict[str, Any]],
    jurisdiction: str,
) -> dict[str, Any]:
    """Declare rights for an agent (typically invoked at commissioning)."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "declaration_id": declaration_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "rights": rights,
        "jurisdiction": jurisdiction,
        "timestamp": _utc_now(),
    }
    return await _sign_rights(registry, classical_key, pq_key, payload)


async def record_obligation(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    obligation_id: str,
    session_nonce: str,
    agent_id: str,
    human_id: str,
    obligation_type: str,
    compliance_status: str,
    evidence_hashes: list[str],
) -> dict[str, Any]:
    """Record an obligation between an agent and its responsible principal."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "obligation_id": obligation_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "human_id": human_id,
        "obligation_type": obligation_type,
        "compliance_status": compliance_status,
        "evidence_hashes": evidence_hashes,
        "timestamp": _utc_now(),
    }
    return await _sign_rights(registry, classical_key, pq_key, payload)


async def report_violation(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    violation_id: str,
    session_nonce: str,
    agent_id: str,
    violated_right: str,
    evidence_hashes: list[str],
    dispute_id: str | None,
) -> dict[str, Any]:
    """Report a rights violation. Optionally links to a DCP-07 dispute."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "violation_id": violation_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "violated_right": violated_right,
        "evidence_hashes": evidence_hashes,
        "dispute_id": dispute_id,
        "timestamp": _utc_now(),
    }
    return await _sign_rights(registry, classical_key, pq_key, payload)


def check_rights_compliance(
    declaration: dict[str, Any],
    obligations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Check rights compliance. Returns {'compliant': bool, 'violations': [str]}."""
    _ = declaration  # declaration kept in signature for API parity
    violations: list[str] = []
    for obligation in obligations:
        if obligation.get("compliance_status") == "non_compliant":
            violations.append(
                f"Obligation {obligation.get('obligation_id')} "
                f"({obligation.get('obligation_type')}) is non-compliant"
            )
    return {"compliant": not violations, "violations": violations}
