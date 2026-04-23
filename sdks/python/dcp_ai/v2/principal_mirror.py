"""
DCP-09 v2.0 Principal Mirror — Python port.

Generates human-readable narrative summaries of agent actions synthesised
from audit chains. The narrative itself is produced by the caller; this
module signs it and binds it to an audit-chain integrity hash.
"""

from __future__ import annotations

import hashlib
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.lifecycle import _utc_now


def _compute_audit_chain_hash(entries: list[dict[str, Any]]) -> str:
    """Hash the audit entries in order for integrity binding."""
    h = hashlib.sha256()
    for entry in entries:
        h.update(canonicalize_v2(entry).encode("utf-8"))
    return "sha256:" + h.hexdigest()


async def generate_mirror(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    mirror_id: str,
    session_nonce: str,
    agent_id: str,
    human_id: str,
    period: dict[str, str],
    audit_entries: list[dict[str, Any]],
    narrative: str,
    decision_summary: str,
) -> dict[str, Any]:
    """Produce a signed principal-mirror artifact over a narrative + audit trail."""
    audit_chain_hash = _compute_audit_chain_hash(audit_entries)

    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "mirror_id": mirror_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "human_id": human_id,
        "period": period,
        "narrative": narrative,
        "action_count": len(audit_entries),
        "decision_summary": decision_summary,
        "audit_chain_hash": audit_chain_hash,
        "timestamp": _utc_now(),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Delegation"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}
