"""
Pydantic v2 models for all DCP v1 artifacts.
Generated from the DCP JSON Schemas.
"""

from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ── DCP-01: Identity & Human Binding ──

class HumanBindingRecord(BaseModel):
    dcp_version: str = "1.0"
    human_id: str
    legal_name: str
    entity_type: Literal["natural_person", "organization"]
    jurisdiction: str
    liability_mode: Literal["owner_responsible"]
    override_rights: bool
    issued_at: str
    expires_at: Optional[str] = None
    contact: Optional[str] = None
    signature: str


class AgentPassport(BaseModel):
    dcp_version: str = "1.0"
    agent_id: str
    public_key: str
    human_binding_reference: str
    capabilities: Optional[list[str]] = None
    risk_tier: Optional[Literal["low", "medium", "high"]] = None
    created_at: str
    status: Literal["active", "revoked", "suspended"]
    signature: str


# ── DCP-02: Intent Declaration & Policy Gating ──

class IntentTarget(BaseModel):
    channel: Literal["web", "api", "email", "calendar", "payments", "crm", "filesystem", "runtime"]
    to: Optional[str] = None
    domain: Optional[str] = None
    url: Optional[str] = None

    model_config = {"extra": "allow"}


class Intent(BaseModel):
    dcp_version: str = "1.0"
    intent_id: str
    agent_id: str
    human_id: str
    timestamp: str
    action_type: Literal[
        "browse", "api_call", "send_email", "create_calendar_event",
        "initiate_payment", "update_crm", "write_file", "execute_code"
    ]
    target: IntentTarget
    data_classes: list[str]
    estimated_impact: Literal["low", "medium", "high"]
    requires_consent: Optional[bool] = None


class RequiredConfirmation(BaseModel):
    type: Literal["human_approve"]
    fields: Optional[list[str]] = None


class PolicyDecision(BaseModel):
    dcp_version: str = "1.0"
    intent_id: str
    decision: Literal["approve", "escalate", "block"]
    risk_score: float = Field(ge=0, le=1)
    reasons: list[str]
    required_confirmation: Optional[RequiredConfirmation] = None


# ── DCP-03: Audit Chain & Transparency ──

class AuditEvidence(BaseModel):
    tool: Optional[str] = None
    result_ref: Optional[str] = None

    model_config = {"extra": "allow"}


class AuditEntry(BaseModel):
    dcp_version: str = "1.0"
    audit_id: str
    prev_hash: str
    timestamp: str
    agent_id: str
    human_id: str
    intent_id: str
    intent_hash: str
    policy_decision: Literal["approved", "escalated", "blocked"]
    outcome: str
    evidence: AuditEvidence


# ── Bundle Types ──

class CitizenshipBundle(BaseModel):
    human_binding_record: HumanBindingRecord
    agent_passport: AgentPassport
    intent: Intent
    policy_decision: PolicyDecision
    audit_entries: list[AuditEntry]


class SignerInfo(BaseModel):
    type: Literal["human", "organization"]
    id: str
    public_key_b64: str


class BundleSignature(BaseModel):
    alg: Literal["ed25519"] = "ed25519"
    created_at: str
    signer: SignerInfo
    bundle_hash: str
    merkle_root: Optional[str] = None
    sig_b64: str


class SignedBundle(BaseModel):
    bundle: CitizenshipBundle
    signature: BundleSignature


# ── Revocation ──

class RevocationRecord(BaseModel):
    dcp_version: str = "1.0"
    agent_id: str
    human_id: str
    timestamp: str
    reason: str
    signature: str


# ── Human Confirmation ──

class HumanConfirmation(BaseModel):
    dcp_version: str = "1.0"
    intent_id: str
    human_id: str
    timestamp: str
    decision: Literal["approve", "deny"]
    signature: str
