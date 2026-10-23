"""
DCP v2.0 Bundle Builder and Signer — Python port of the TypeScript SDK's
bundle/builder-v2.ts and bundle/signer-v2.ts.

The manifest cryptographically binds all artifact hashes. The bundle-level
composite signature covers canonical(manifest) only, under the
"DCP-AI.v2.Bundle" context, not the entire bundle.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, classical_only_sign, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.dual_hash import dual_hash_canonical, dual_merkle_root
from dcp_ai.v2.pq_checkpoint import audit_events_merkle_root
from dcp_ai.v2.session_nonce import verify_session_binding
from dcp_ai.v2.signed_payload import prepare_payload


class BundleBuilderV2:
    """Fluent builder for V2 Citizenship Bundles.

    Takes SignedPayload dicts ({payload, payload_hash, composite_sig}) and audit
    event dicts; build() returns the bundle dict with its computed manifest.
    """

    def __init__(self, session_nonce: str) -> None:
        self._session_nonce = session_nonce
        self._rpr: dict[str, Any] | None = None
        self._passport: dict[str, Any] | None = None
        self._intent: dict[str, Any] | None = None
        self._policy: dict[str, Any] | None = None
        self._audit_entries: list[dict[str, Any]] = []
        self._pq_checkpoints: list[dict[str, Any]] = []
        self._dual_hash = False

    def responsible_principal_record(self, rpr: dict[str, Any]) -> BundleBuilderV2:
        self._rpr = rpr
        return self

    def agent_passport(self, passport: dict[str, Any]) -> BundleBuilderV2:
        self._passport = passport
        return self

    def intent(self, intent: dict[str, Any]) -> BundleBuilderV2:
        self._intent = intent
        return self

    def policy_decision(self, policy: dict[str, Any]) -> BundleBuilderV2:
        self._policy = policy
        return self

    def add_audit_entry(self, entry: dict[str, Any]) -> BundleBuilderV2:
        self._audit_entries.append(entry)
        return self

    def add_audit_entries(self, entries: list[dict[str, Any]]) -> BundleBuilderV2:
        self._audit_entries.extend(entries)
        return self

    def add_pq_checkpoint(self, checkpoint: dict[str, Any]) -> BundleBuilderV2:
        self._pq_checkpoints.append(checkpoint)
        return self

    def add_pq_checkpoints(self, checkpoints: list[dict[str, Any]]) -> BundleBuilderV2:
        self._pq_checkpoints.extend(checkpoints)
        return self

    def enable_dual_hash(self) -> BundleBuilderV2:
        self._dual_hash = True
        return self

    def build(self) -> dict[str, Any]:
        """Build the bundle with its manifest.

        Raises ValueError if an artifact is missing or the session nonces disagree.
        """
        if self._rpr is None:
            raise ValueError("Missing responsible_principal_record")
        if self._passport is None:
            raise ValueError("Missing agent_passport")
        if self._intent is None:
            raise ValueError("Missing intent")
        if self._policy is None:
            raise ValueError("Missing policy_decision")
        if not self._audit_entries:
            raise ValueError("At least one audit entry is required")

        artifacts = [
            self._rpr["payload"],
            self._passport["payload"],
            self._intent["payload"],
            self._policy["payload"],
            *self._audit_entries,
            *self._pq_checkpoints,
        ]
        binding = verify_session_binding(artifacts)
        if not binding["valid"]:
            raise ValueError(f"Session nonce validation failed: {binding['error']}")
        if binding["nonce"] != self._session_nonce:
            raise ValueError(
                f"Session nonce mismatch: builder={self._session_nonce}, artifacts={binding['nonce']}"
            )

        manifest: dict[str, Any] = {
            "session_nonce": self._session_nonce,
            "rpr_hash": prepare_payload(self._rpr["payload"])[1],
            "passport_hash": prepare_payload(self._passport["payload"])[1],
            "intent_hash": prepare_payload(self._intent["payload"])[1],
            "policy_hash": prepare_payload(self._policy["payload"])[1],
            "audit_merkle_root": f"sha256:{audit_events_merkle_root(self._audit_entries)}",
            "audit_count": len(self._audit_entries),
            "canonicalization_profile": "dcp-jcs-v1",
        }
        if self._dual_hash:
            leaves = [dual_hash_canonical(canonicalize_v2(e)) for e in self._audit_entries]
            manifest["audit_merkle_root_secondary"] = f"sha3-256:{dual_merkle_root(leaves)['sha3_256']}"
        if self._pq_checkpoints:
            manifest["pq_checkpoints"] = [c["checkpoint_id"] for c in self._pq_checkpoints]

        bundle: dict[str, Any] = {
            "dcp_bundle_version": "2.0",
            "manifest": manifest,
            "responsible_principal_record": self._rpr,
            "agent_passport": self._passport,
            "intent": self._intent,
            "policy_decision": self._policy,
            "audit_entries": list(self._audit_entries),
        }
        if self._pq_checkpoints:
            bundle["pq_checkpoints"] = list(self._pq_checkpoints)
        return bundle


def _now_iso() -> str:
    """UTC timestamp shaped like JavaScript's Date.toISOString()."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def sign_bundle_v2(
    bundle: dict[str, Any],
    registry: AlgorithmRegistry,
    signer_type: str,
    signer_id: str,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    dual_hash: bool = False,
    session_expires_at: str | None = None,
    intended_verifier: str | None = None,
) -> dict[str, Any]:
    """Composite-sign the manifest of a V2 bundle. Returns {"bundle", "signature"}.

    session_expires_at and intended_verifier are written into the manifest
    before signing, as in the TypeScript signBundleV2. With session_expires_at,
    the manifest also gets session_issued_at (now) unless it already has one.
    """
    if session_expires_at:
        bundle["manifest"]["session_expires_at"] = session_expires_at
        # The session start a verifier's maximum session duration is measured from.
        if bundle["manifest"].get("session_issued_at") is None:
            bundle["manifest"]["session_issued_at"] = _now_iso()
    if intended_verifier:
        bundle["manifest"]["intended_verifier"] = intended_verifier

    manifest_bytes, manifest_hash = prepare_payload(bundle["manifest"])
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Bundle"], manifest_bytes, classical_key, pq_key
    )
    return {
        "bundle": bundle,
        "signature": {
            "hash_alg": "sha256+sha3-256" if dual_hash else "sha256",
            "created_at": _now_iso(),
            "signer": {"type": signer_type, "id": signer_id, "kids": [classical_key.kid, pq_key.kid]},
            "manifest_hash": manifest_hash,
            "composite_sig": composite,
        },
    }


async def sign_bundle_v2_classical_only(
    bundle: dict[str, Any],
    registry: AlgorithmRegistry,
    signer_type: str,
    signer_id: str,
    key: CompositeKeyInfo,
) -> dict[str, Any]:
    """Sign a V2 bundle with a classical-only composite signature (transition mode)."""
    manifest_bytes, manifest_hash = prepare_payload(bundle["manifest"])
    composite = await classical_only_sign(registry, DCP_CONTEXTS["Bundle"], manifest_bytes, key)
    return {
        "bundle": bundle,
        "signature": {
            "hash_alg": "sha256",
            "created_at": _now_iso(),
            "signer": {"type": signer_type, "id": signer_id, "kids": [key.kid]},
            "manifest_hash": manifest_hash,
            "composite_sig": composite,
        },
    }
