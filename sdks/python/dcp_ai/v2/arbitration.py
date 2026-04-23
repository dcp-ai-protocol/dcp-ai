"""
DCP-07 v2.0 Arbitration & Jurisprudence — Python port.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.lifecycle import _utc_now


@dataclass
class ArbitrationPanel:
    arbitrator_ids: list[str]
    threshold: int
    created_at: str


def create_arbitration_panel(arbitrator_ids: list[str], threshold: int) -> ArbitrationPanel:
    """Create an arbitration panel (M-of-N ceremony pattern)."""
    if threshold < 1:
        raise ValueError("Arbitration panel: threshold must be >= 1")
    if len(arbitrator_ids) < threshold:
        raise ValueError(
            f"Arbitration panel: need at least {threshold} arbitrators, "
            f"got {len(arbitrator_ids)}"
        )
    return ArbitrationPanel(
        arbitrator_ids=arbitrator_ids,
        threshold=threshold,
        created_at=_utc_now(),
    )


async def submit_resolution(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    dispute_id: str,
    session_nonce: str,
    arbitrator_ids: list[str],
    resolution: str,
    binding: bool,
    precedent_references: list[str] | None = None,
) -> dict[str, Any]:
    """Submit a resolution for a dispute."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "dispute_id": dispute_id,
        "session_nonce": session_nonce,
        "arbitrator_ids": arbitrator_ids,
        "resolution": resolution,
        "binding": binding,
        "precedent_references": precedent_references,
        "timestamp": _utc_now(),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Dispute"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


async def build_jurisprudence_bundle(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    jurisprudence_id: str,
    session_nonce: str,
    dispute_id: str,
    resolution_id: str,
    category: str,
    precedent_summary: str,
    applicable_contexts: list[str],
    authority_level: str,
) -> dict[str, Any]:
    """Build a jurisprudence bundle from a resolved dispute."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "jurisprudence_id": jurisprudence_id,
        "session_nonce": session_nonce,
        "dispute_id": dispute_id,
        "resolution_id": resolution_id,
        "category": category,
        "precedent_summary": precedent_summary,
        "applicable_contexts": applicable_contexts,
        "authority_level": authority_level,
        "timestamp": _utc_now(),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Dispute"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


def lookup_precedent(
    jurisprudence: list[dict[str, Any]],
    category: str,
    context: str | None = None,
) -> list[dict[str, Any]]:
    """Filter a jurisprudence collection by category (and optional context)."""
    out: list[dict[str, Any]] = []
    for entry in jurisprudence:
        if entry.get("category") != category:
            continue
        if context is not None and context not in entry.get("applicable_contexts", []):
            continue
        out.append(entry)
    return out
