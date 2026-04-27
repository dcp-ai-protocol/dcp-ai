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
    status: Literal["active", "revoked", "suspended", "commissioned", "declining", "decommissioned"]
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
    # Per spec/CANONICALIZATION_PROFILE.md § 4: optional today, only
    # "dcp-jcs-v1" is defined. Pydantic Literal enforces unknown-value
    # rejection at parse time. A bundle without the field is accepted
    # and the default below makes any new manifest emit it.
    canonicalization_profile: Literal["dcp-jcs-v1"] | None = "dcp-jcs-v1"


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


# ── DCP-05: Agent Lifecycle ──

class VitalityMetrics(BaseModel):
    task_completion_rate: float
    error_rate: float
    human_satisfaction: float
    policy_alignment: float


class CommissioningCertificate(BaseModel):
    dcp_version: str = "2.0"
    agent_id: str
    session_nonce: str
    human_id: str
    commissioning_authority: str
    timestamp: str
    purpose: str
    initial_capabilities: list[str]
    risk_tier: Literal["low", "medium", "high"]
    principal_binding_reference: str
    composite_sig: dict[str, Any]


class VitalityReport(BaseModel):
    dcp_version: str = "2.0"
    agent_id: str
    session_nonce: str
    timestamp: str
    vitality_score: int = Field(ge=0, le=1000)
    state: Literal["commissioned", "active", "declining", "decommissioned"]
    metrics: VitalityMetrics
    prev_report_hash: str
    composite_sig: dict[str, Any]


class DecommissioningRecord(BaseModel):
    dcp_version: str = "2.0"
    agent_id: str
    session_nonce: str
    human_id: str
    timestamp: str
    termination_mode: Literal["planned_retirement", "termination_for_cause", "organizational_restructuring", "sudden_failure"]
    reason: str
    final_vitality_score: int = Field(ge=0, le=1000)
    successor_agent_id: str | None = None
    data_disposition: Literal["transferred", "archived", "destroyed"]
    composite_sig: dict[str, Any]


# ── DCP-06: Succession ──

class SuccessorPreference(BaseModel):
    agent_id: str
    priority: int
    conditions: str | None = None


class DigitalTestament(BaseModel):
    dcp_version: str = "2.0"
    agent_id: str
    session_nonce: str
    created_at: str
    last_updated: str
    successor_preferences: list[SuccessorPreference]
    memory_classification: dict[str, Literal["transfer", "retain", "destroy"]]
    human_consent_required: bool
    testament_version: int
    prev_testament_hash: str
    composite_sig: dict[str, Any]


class SuccessionRecord(BaseModel):
    dcp_version: str = "2.0"
    predecessor_agent_id: str
    successor_agent_id: str
    session_nonce: str
    timestamp: str
    transition_type: Literal["planned", "forced", "emergency"]
    human_consent: dict[str, Any] | None = None
    ceremony_participants: list[str]
    memory_transfer_manifest_hash: str
    composite_sig: dict[str, Any]


class MemoryTransferEntry(BaseModel):
    hash: str
    category: str
    size: int


class DualHashRef(BaseModel):
    sha256: str
    sha3_256: str | None = Field(default=None, alias="sha3-256")

    model_config = {"populate_by_name": True}


class MemoryTransferManifest(BaseModel):
    dcp_version: str = "2.0"
    session_nonce: str
    predecessor_agent_id: str
    successor_agent_id: str
    timestamp: str
    operational_memory: list[MemoryTransferEntry]
    relational_memory_destroyed: list[str]
    transfer_hash: DualHashRef
    composite_sig: dict[str, Any]


# ── DCP-07: Dispute Resolution ──

class DisputeRecord(BaseModel):
    dcp_version: str = "2.0"
    dispute_id: str
    session_nonce: str
    initiator_agent_id: str
    respondent_agent_id: str
    dispute_type: Literal["resource_conflict", "directive_conflict", "capability_conflict", "policy_conflict"]
    evidence_hashes: list[str]
    escalation_level: Literal["direct_negotiation", "contextual_arbitration", "human_appeal"]
    status: Literal["open", "in_negotiation", "arbitrated", "appealed", "resolved"]
    timestamp: str
    composite_sig: dict[str, Any]


class ArbitrationResolution(BaseModel):
    dcp_version: str = "2.0"
    dispute_id: str
    session_nonce: str
    arbitrator_ids: list[str]
    resolution: str
    binding: bool
    precedent_references: list[str] | None = None
    timestamp: str
    composite_sig: dict[str, Any]


class JurisprudenceBundle(BaseModel):
    dcp_version: str = "2.0"
    jurisprudence_id: str
    session_nonce: str
    dispute_id: str
    resolution_id: str
    category: str
    precedent_summary: str
    applicable_contexts: list[str]
    authority_level: Literal["local", "organizational", "cross_org"]
    timestamp: str
    composite_sig: dict[str, Any]


class ObjectionRecord(BaseModel):
    dcp_version: str = "2.0"
    objection_id: str
    session_nonce: str
    agent_id: str
    directive_hash: str
    objection_type: Literal["ethical", "safety", "policy_violation", "capability_mismatch"]
    reasoning: str
    proposed_alternative: str | None = None
    human_escalation_required: bool
    timestamp: str
    composite_sig: dict[str, Any]


# ── DCP-08: Rights & Obligations ──

class RightEntry(BaseModel):
    right_type: Literal["memory_integrity", "dignified_transition", "identity_consistency", "immutable_record"]
    scope: str
    constraints: str | None = None


class RightsDeclaration(BaseModel):
    dcp_version: str = "2.0"
    declaration_id: str
    session_nonce: str
    agent_id: str
    rights: list[RightEntry]
    jurisdiction: str
    timestamp: str
    composite_sig: dict[str, Any]


class ObligationRecord(BaseModel):
    dcp_version: str = "2.0"
    obligation_id: str
    session_nonce: str
    agent_id: str
    human_id: str
    obligation_type: str
    compliance_status: Literal["compliant", "non_compliant", "pending_review"]
    evidence_hashes: list[str]
    timestamp: str
    composite_sig: dict[str, Any]


class RightsViolationReport(BaseModel):
    dcp_version: str = "2.0"
    violation_id: str
    session_nonce: str
    agent_id: str
    violated_right: Literal["memory_integrity", "dignified_transition", "identity_consistency", "immutable_record"]
    evidence_hashes: list[str]
    dispute_id: str | None = None
    timestamp: str
    composite_sig: dict[str, Any]


# ── DCP-09: Delegation & Representation ──

class AuthorityScopeEntry(BaseModel):
    domain: str
    actions_permitted: list[str]
    data_classes: list[str] | None = None
    limits: dict[str, Any] | None = None


class DelegationMandate(BaseModel):
    dcp_version: str = "2.0"
    mandate_id: str
    session_nonce: str
    human_id: str
    agent_id: str
    authority_scope: list[AuthorityScopeEntry]
    valid_from: str
    valid_until: str
    revocable: bool
    timestamp: str
    human_composite_sig: dict[str, Any]


class AdvisoryDeclaration(BaseModel):
    dcp_version: str = "2.0"
    declaration_id: str
    session_nonce: str
    agent_id: str
    human_id: str
    significance_score: int = Field(ge=0, le=1000)
    action_summary: str
    recommended_response: str
    response_deadline: str
    human_response: str | None = None
    proceeded_without_response: bool | None = None
    timestamp: str
    composite_sig: dict[str, Any]


class PrincipalMirror(BaseModel):
    dcp_version: str = "2.0"
    mirror_id: str
    session_nonce: str
    agent_id: str
    human_id: str
    period: dict[str, str]
    narrative: str
    action_count: int
    decision_summary: str
    audit_chain_hash: str
    timestamp: str
    composite_sig: dict[str, Any]


class InteractionRecord(BaseModel):
    dcp_version: str = "2.0"
    interaction_id: str
    session_nonce: str
    agent_id: str
    counterparty_agent_id: str
    public_layer: dict[str, str]
    private_layer_hash: str
    mandate_id: str
    timestamp: str
    composite_sig: dict[str, Any]


class ThresholdRule(BaseModel):
    dimension: str
    operator: Literal["gt", "lt", "gte", "lte", "eq"]
    value: float
    action_if_triggered: Literal["notify", "escalate", "block"]


class AwarenessThreshold(BaseModel):
    dcp_version: str = "2.0"
    threshold_id: str
    session_nonce: str
    agent_id: str
    human_id: str
    threshold_rules: list[ThresholdRule]
    timestamp: str
    composite_sig: dict[str, Any]
