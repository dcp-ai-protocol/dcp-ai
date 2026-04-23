"""
DCP-09 v2.0 Delegation & Representation — Python port.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.lifecycle import _utc_now


async def create_delegation_mandate(
    registry: AlgorithmRegistry,
    human_classical_key: CompositeKeyInfo,
    human_pq_key: CompositeKeyInfo,
    *,
    mandate_id: str,
    session_nonce: str,
    human_id: str,
    agent_id: str,
    authority_scope: list[dict[str, Any]],
    valid_from: str,
    valid_until: str,
    revocable: bool,
) -> dict[str, Any]:
    """Create a delegation mandate signed by the human principal."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "mandate_id": mandate_id,
        "session_nonce": session_nonce,
        "human_id": human_id,
        "agent_id": agent_id,
        "authority_scope": authority_scope,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "revocable": revocable,
        "timestamp": _utc_now(),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry,
        DCP_CONTEXTS["Delegation"],
        canonical.encode("utf-8"),
        human_classical_key,
        human_pq_key,
    )
    # TS uses `human_composite_sig` (not `composite_sig`) to distinguish the
    # human-principal signature on the mandate artifact.
    return {**payload, "human_composite_sig": composite}


def verify_mandate_validity(
    mandate: dict[str, Any],
    revoked_mandate_ids: set[str],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Verify a delegation mandate is still valid (not expired, not revoked)."""
    if mandate["mandate_id"] in revoked_mandate_ids:
        return {"valid": False, "reason": "Mandate has been revoked"}

    current = now or datetime.now(timezone.utc)
    valid_from = datetime.fromisoformat(mandate["valid_from"].replace("Z", "+00:00"))
    valid_until = datetime.fromisoformat(mandate["valid_until"].replace("Z", "+00:00"))

    if valid_from > current:
        return {"valid": False, "reason": "Mandate is not yet valid"}
    if valid_until < current:
        return {"valid": False, "reason": "Mandate has expired"}
    return {"valid": True}


def revoke_delegation(
    mandate: dict[str, Any],
    revoked_mandate_ids: set[str],
) -> dict[str, Any]:
    """Revoke a delegation mandate; mutates `revoked_mandate_ids` in place."""
    if not mandate.get("revocable", False):
        return {"revoked": False, "reason": "Mandate is not revocable"}
    revoked_mandate_ids.add(mandate["mandate_id"])
    return {"revoked": True}


async def generate_interaction_record(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    interaction_id: str,
    session_nonce: str,
    agent_id: str,
    counterparty_agent_id: str,
    public_layer: dict[str, str],
    private_layer_hash: str,
    mandate_id: str,
) -> dict[str, Any]:
    """Create a dual-layer interaction record between agents acting under delegation."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "interaction_id": interaction_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "counterparty_agent_id": counterparty_agent_id,
        "public_layer": public_layer,
        "private_layer_hash": private_layer_hash,
        "mandate_id": mandate_id,
        "timestamp": _utc_now(),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry,
        DCP_CONTEXTS["Delegation"],
        canonical.encode("utf-8"),
        classical_key,
        pq_key,
    )
    return {**payload, "composite_sig": composite}
