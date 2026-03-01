"""
Pydantic v2 models for all DCP v2 artifacts.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Key & Crypto ──

class KeyEntryV2(BaseModel):
    kid: str
    alg: str
    public_key_b64: str
    created_at: str
    expires_at: str | None = None
    status: Literal["active", "revoked", "expired"] = "active"


# ── DCP-01: Identity & Human Binding ──

class AgentPassportV2(BaseModel):
    dcp_version: str = "2.0"
    agent_id: str
    session_nonce: str
    keys: list[KeyEntryV2]
    principal_binding_reference: str
    capabilities: list[str] | None = None
    risk_tier: Literal["low", "medium", "high"] | None = None
    created_at: str
    status: Literal["active", "revoked", "suspended"]
    emergency_revocation_token: str | None = None


class ResponsiblePrincipalRecordV2(BaseModel):
    dcp_version: str = "2.0"
    human_id: str
    session_nonce: str
    legal_name: str
    entity_type: Literal["natural_person", "organization"]
    jurisdiction: str
    liability_mode: Literal["owner_responsible"]
    override_rights: bool
    issued_at: str
    expires_at: str | None = None
    contact: str | None = None
    binding_keys: list[KeyEntryV2]


class BlindedResponsiblePrincipalRecordV2(BaseModel):
    dcp_version: str = "2.0"
    human_id: str
    session_nonce: str
    blinded: Literal[True] = True
    pii_hash: str
    entity_type: Literal["natural_person", "organization"]
    jurisdiction: str
    liability_mode: Literal["owner_responsible"]
    override_rights: bool
    issued_at: str
    expires_at: str | None = None
    binding_keys: list[KeyEntryV2]


# ── DCP-02: Intent Declaration & Policy Gating ──

class IntentV2(BaseModel):
    dcp_version: str = "2.0"
    intent_id: str
    session_nonce: str
    agent_id: str
    human_id: str
    timestamp: str
    action_type: str
    target: dict[str, Any]
    data_classes: list[str]
    estimated_impact: Literal["low", "medium", "high"]
    requires_consent: bool | None = None


class PolicyDecisionV2(BaseModel):
    dcp_version: str = "2.0"
    intent_id: str
    session_nonce: str
    decision: Literal["approve", "escalate", "block"]
    risk_score: int = Field(ge=0, le=1000)
    reasons: list[str]
    required_confirmation: dict[str, Any] | None = None
    applied_policy_hash: str | None = None
    timestamp: str


# ── DCP-03: Audit Chain & Transparency ──

class AuditEventV2(BaseModel):
    dcp_version: str = "2.0"
    audit_id: str
    session_nonce: str
    prev_hash: str
    prev_hash_secondary: str | None = None
    hash_alg: str = "sha256"
    timestamp: str
    agent_id: str
    human_id: str
    intent_id: str
    intent_hash: str
    intent_hash_secondary: str | None = None
    policy_decision: Literal["approved", "escalated", "blocked"]
    outcome: str
    evidence: dict[str, Any]
    pq_checkpoint_ref: str | None = None


class PQCheckpoint(BaseModel):
    checkpoint_id: str
    session_nonce: str
    event_range: dict[str, Any]
    merkle_root: str
    composite_sig: dict[str, Any]


# ── Bundle ──

class BundleManifest(BaseModel):
    session_nonce: str
    rpr_hash: str
    passport_hash: str
    intent_hash: str
    policy_hash: str
    audit_merkle_root: str
    audit_merkle_root_secondary: str | None = None
    audit_count: int
    pq_checkpoints: list[PQCheckpoint] | None = None


# ── Capabilities & Verifier Policy ──

class DcpCapabilities(BaseModel):
    supported_versions: list[str]
    supported_algs: dict[str, list[str]]
    supported_wire_formats: list[str]
    features: dict[str, bool]
    verifier_policy_hash: str
    min_accepted_version: str


class VerifierPolicy(BaseModel):
    default_mode: str = "hybrid_required"
    risk_overrides: dict[str, Any] | None = Field(
        default_factory=lambda: {"low": "hybrid_required", "medium": "hybrid_required", "high": "hybrid_required"}
    )
    min_classical: int = 1
    min_pq: int = 1
    accepted_classical_algs: list[str] = Field(default_factory=lambda: ["ed25519"])
    accepted_pq_algs: list[str] = Field(default_factory=lambda: ["ml-dsa-65", "slh-dsa-192f"])
    accepted_hash_algs: list[str] = Field(default_factory=lambda: ["sha256", "sha384"])
    require_session_binding: bool = True
    require_composite_binding: bool = True
    max_key_age_days: int = 365
    allow_v1_bundles: bool = True
