"""
Builder pattern for constructing and signing DCP Citizenship Bundles.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from dcp_ai.crypto import canonicalize, sign_object, public_key_from_secret
from dcp_ai.merkle import hash_object, intent_hash, merkle_root_for_audit_entries
from dcp_ai.models import (
    CitizenshipBundle,
    HumanBindingRecord,
    AgentPassport,
    Intent,
    PolicyDecision,
    AuditEntry,
    AuditEvidence,
)


class BundleBuilder:
    """Fluent builder for DCP Citizenship Bundles."""

    def __init__(self) -> None:
        self._hbr: HumanBindingRecord | None = None
        self._passport: AgentPassport | None = None
        self._intent: Intent | None = None
        self._policy: PolicyDecision | None = None
        self._audit_entries: list[AuditEntry] = []

    def human_binding_record(self, hbr: HumanBindingRecord) -> BundleBuilder:
        self._hbr = hbr
        return self

    def agent_passport(self, passport: AgentPassport) -> BundleBuilder:
        self._passport = passport
        return self

    def intent(self, intent: Intent) -> BundleBuilder:
        self._intent = intent
        return self

    def policy_decision(self, policy: PolicyDecision) -> BundleBuilder:
        self._policy = policy
        return self

    def add_audit_entry(self, entry: AuditEntry) -> BundleBuilder:
        self._audit_entries.append(entry)
        return self

    def create_audit_entry(
        self,
        *,
        audit_id: str,
        timestamp: str,
        agent_id: str,
        human_id: str,
        intent_id: str,
        policy_decision: str,
        outcome: str,
        evidence: AuditEvidence | None = None,
    ) -> BundleBuilder:
        """Create a new audit entry with correct intent_hash and prev_hash chaining."""
        if not self._intent:
            raise ValueError("Intent must be set before creating audit entries")

        i_hash = intent_hash(self._intent.model_dump())
        prev_hash = (
            "GENESIS"
            if not self._audit_entries
            else hash_object(self._audit_entries[-1].model_dump())
        )

        entry = AuditEntry(
            audit_id=audit_id,
            prev_hash=prev_hash,
            timestamp=timestamp,
            agent_id=agent_id,
            human_id=human_id,
            intent_id=intent_id,
            intent_hash=i_hash,
            policy_decision=policy_decision,  # type: ignore
            outcome=outcome,
            evidence=evidence or AuditEvidence(),
        )
        self._audit_entries.append(entry)
        return self

    def build(self) -> CitizenshipBundle:
        """Build the Citizenship Bundle. Raises ValueError if any required artifact is missing."""
        if not self._hbr:
            raise ValueError("Missing human_binding_record")
        if not self._passport:
            raise ValueError("Missing agent_passport")
        if not self._intent:
            raise ValueError("Missing intent")
        if not self._policy:
            raise ValueError("Missing policy_decision")
        if not self._audit_entries:
            raise ValueError("At least one audit entry is required")

        return CitizenshipBundle(
            human_binding_record=self._hbr,
            agent_passport=self._passport,
            intent=self._intent,
            policy_decision=self._policy,
            audit_entries=self._audit_entries,
        )


def sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]:
    """Sign a Citizenship Bundle and produce a Signed Bundle dict."""
    bundle_dict = bundle.model_dump()
    public_key_b64 = public_key_from_secret(secret_key_b64)

    bundle_hash_hex = hashlib.sha256(
        canonicalize(bundle_dict).encode("utf-8")
    ).hexdigest()

    merkle_hex = merkle_root_for_audit_entries(bundle_dict.get("audit_entries", []))

    sig_b64 = sign_object(bundle_dict, secret_key_b64)

    return {
        "bundle": bundle_dict,
        "signature": {
            "alg": "ed25519",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "signer": {
                "type": signer_type,
                "id": signer_id or bundle.human_binding_record.human_id,
                "public_key_b64": public_key_b64,
            },
            "bundle_hash": f"sha256:{bundle_hash_hex}",
            "merkle_root": f"sha256:{merkle_hex}" if merkle_hex else None,
            "sig_b64": sig_b64,
        },
    }
