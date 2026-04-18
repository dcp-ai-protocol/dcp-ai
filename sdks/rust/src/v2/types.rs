//! DCP v2.0 artifact types.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use super::composite_sig::CompositeSignature;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyEntry {
    pub kid: String,
    pub alg: String,
    pub public_key_b64: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub status: String,
}

// ── DCP-01: Identity & Human Binding ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPassportV2 {
    pub dcp_version: String,
    pub agent_id: String,
    pub session_nonce: String,
    pub keys: Vec<KeyEntry>,
    pub principal_binding_reference: String,
    pub capabilities: Vec<String>,
    pub risk_tier: String,
    pub created_at: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emergency_revocation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponsiblePrincipalRecordV2 {
    pub dcp_version: String,
    pub human_id: String,
    pub session_nonce: String,
    pub legal_name: String,
    pub entity_type: String,
    pub jurisdiction: String,
    pub liability_mode: String,
    pub override_rights: bool,
    pub issued_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact: Option<String>,
    pub binding_keys: Vec<KeyEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlindedResponsiblePrincipalRecordV2 {
    pub dcp_version: String,
    pub human_id: String,
    pub session_nonce: String,
    pub blinded: bool,
    pub pii_hash: String,
    pub entity_type: String,
    pub jurisdiction: String,
    pub liability_mode: String,
    pub override_rights: bool,
    pub issued_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub binding_keys: Vec<KeyEntry>,
}

// ── DCP-02: Intent Declaration & Policy Gating ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentTargetV2 {
    pub channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentV2 {
    pub dcp_version: String,
    pub intent_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub human_id: String,
    pub timestamp: String,
    pub action_type: String,
    pub target: IntentTargetV2,
    pub data_classes: Vec<String>,
    pub estimated_impact: String,
    pub requires_consent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecisionV2 {
    pub dcp_version: String,
    pub intent_id: String,
    pub session_nonce: String,
    pub decision: String,
    /// Integer 0-1000 (millirisk). No floats.
    pub risk_score: i32,
    pub reasons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_confirmation: Option<serde_json::Value>,
    pub applied_policy_hash: String,
    pub timestamp: String,
}

// ── DCP-03: Audit Chain & Transparency ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvidenceV2 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEventV2 {
    pub dcp_version: String,
    pub audit_id: String,
    pub session_nonce: String,
    pub prev_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev_hash_secondary: Option<String>,
    pub hash_alg: String,
    pub timestamp: String,
    pub agent_id: String,
    pub human_id: String,
    pub intent_id: String,
    pub intent_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent_hash_secondary: Option<String>,
    pub policy_decision: String,
    pub outcome: String,
    pub evidence: AuditEvidenceV2,
    pub pq_checkpoint_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventRange {
    pub from_audit_id: String,
    pub to_audit_id: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PQCheckpoint {
    pub checkpoint_id: String,
    pub session_nonce: String,
    pub event_range: EventRange,
    pub merkle_root: String,
    pub composite_sig: CompositeSignature,
}

// ── Bundle ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleManifest {
    pub session_nonce: String,
    pub rpr_hash: String,
    pub passport_hash: String,
    pub intent_hash: String,
    pub policy_hash: String,
    pub audit_merkle_root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_merkle_root_secondary: Option<String>,
    pub audit_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pq_checkpoints: Option<Vec<String>>,
}

// ── Capability Discovery ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportedAlgs {
    pub signing: Vec<String>,
    pub kem: Vec<String>,
    pub hash: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DcpFeatures {
    pub composite_signatures: bool,
    pub session_binding: bool,
    pub blinded_rpr: bool,
    pub dual_hash_chains: bool,
    pub pq_checkpoints: bool,
    pub emergency_revocation: bool,
    pub multi_party_auth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DcpCapabilities {
    pub supported_versions: Vec<String>,
    pub supported_algs: SupportedAlgs,
    pub supported_wire_formats: Vec<String>,
    pub features: DcpFeatures,
    pub verifier_policy_hash: String,
    pub min_accepted_version: String,
}

// ── Verifier Policy ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifierPolicy {
    pub default_mode: String,
    pub risk_overrides: HashMap<String, String>,
    pub min_classical: u32,
    pub min_pq: u32,
    pub accepted_classical_algs: Vec<String>,
    pub accepted_pq_algs: Vec<String>,
    pub accepted_hash_algs: Vec<String>,
    pub require_session_binding: bool,
    pub require_composite_binding: bool,
    pub max_key_age_days: u32,
    pub allow_v1_bundles: bool,
}

// ── DCP-05: Agent Lifecycle ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalityMetrics {
    pub task_completion_rate: f64,
    pub error_rate: f64,
    pub human_satisfaction: f64,
    pub policy_alignment: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommissioningCertificate {
    pub dcp_version: String,
    pub agent_id: String,
    pub session_nonce: String,
    pub human_id: String,
    pub commissioning_authority: String,
    pub timestamp: String,
    pub purpose: String,
    pub initial_capabilities: Vec<String>,
    pub risk_tier: String,
    pub principal_binding_reference: String,
    pub composite_sig: CompositeSignature,
}

/// Vitality score is 0-1000.
/// State: "commissioned", "active", "declining", "decommissioned".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalityReport {
    pub dcp_version: String,
    pub agent_id: String,
    pub session_nonce: String,
    pub timestamp: String,
    pub vitality_score: i32,
    pub state: String,
    pub metrics: VitalityMetrics,
    pub prev_report_hash: String,
    pub composite_sig: CompositeSignature,
}

/// TerminationMode: "planned_retirement", "termination_for_cause", "organizational_restructuring", "sudden_failure".
/// DataDisposition: "transferred", "archived", "destroyed".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecommissioningRecord {
    pub dcp_version: String,
    pub agent_id: String,
    pub session_nonce: String,
    pub human_id: String,
    pub timestamp: String,
    pub termination_mode: String,
    pub reason: String,
    pub final_vitality_score: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub successor_agent_id: Option<String>,
    pub data_disposition: String,
    pub composite_sig: CompositeSignature,
}

// ── DCP-06: Succession ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessorPreference {
    pub agent_id: String,
    pub priority: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<String>,
}

/// MemoryClassification values: "transfer", "retain", "destroy".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalTestament {
    pub dcp_version: String,
    pub agent_id: String,
    pub session_nonce: String,
    pub created_at: String,
    pub last_updated: String,
    pub successor_preferences: Vec<SuccessorPreference>,
    pub memory_classification: HashMap<String, String>,
    pub human_consent_required: bool,
    pub testament_version: i32,
    pub prev_testament_hash: String,
    pub composite_sig: CompositeSignature,
}

/// TransitionType: "planned", "forced", "emergency".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessionRecord {
    pub dcp_version: String,
    pub predecessor_agent_id: String,
    pub successor_agent_id: String,
    pub session_nonce: String,
    pub timestamp: String,
    pub transition_type: String,
    pub human_consent: Option<serde_json::Value>,
    pub ceremony_participants: Vec<String>,
    pub memory_transfer_manifest_hash: String,
    pub composite_sig: CompositeSignature,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryTransferEntry {
    pub hash: String,
    pub category: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DualHashRef {
    pub sha256: String,
    #[serde(rename = "sha3-256", skip_serializing_if = "Option::is_none")]
    pub sha3_256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryTransferManifest {
    pub dcp_version: String,
    pub session_nonce: String,
    pub predecessor_agent_id: String,
    pub successor_agent_id: String,
    pub timestamp: String,
    pub operational_memory: Vec<MemoryTransferEntry>,
    pub relational_memory_destroyed: Vec<String>,
    pub transfer_hash: DualHashRef,
    pub composite_sig: CompositeSignature,
}

// ── DCP-07: Dispute Resolution ──

/// DisputeType: "resource_conflict", "directive_conflict", "capability_conflict", "policy_conflict".
/// EscalationLevel: "direct_negotiation", "contextual_arbitration", "human_appeal".
/// Status: "open", "in_negotiation", "arbitrated", "appealed", "resolved".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisputeRecord {
    pub dcp_version: String,
    pub dispute_id: String,
    pub session_nonce: String,
    pub initiator_agent_id: String,
    pub respondent_agent_id: String,
    pub dispute_type: String,
    pub evidence_hashes: Vec<String>,
    pub escalation_level: String,
    pub status: String,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrationResolution {
    pub dcp_version: String,
    pub dispute_id: String,
    pub session_nonce: String,
    pub arbitrator_ids: Vec<String>,
    pub resolution: String,
    pub binding: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub precedent_references: Option<Vec<String>>,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

/// AuthorityLevel: "local", "organizational", "cross_org".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JurisprudenceBundle {
    pub dcp_version: String,
    pub jurisprudence_id: String,
    pub session_nonce: String,
    pub dispute_id: String,
    pub resolution_id: String,
    pub category: String,
    pub precedent_summary: String,
    pub applicable_contexts: Vec<String>,
    pub authority_level: String,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

/// ObjectionType: "ethical", "safety", "policy_violation", "capability_mismatch".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectionRecord {
    pub dcp_version: String,
    pub objection_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub directive_hash: String,
    pub objection_type: String,
    pub reasoning: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposed_alternative: Option<String>,
    pub human_escalation_required: bool,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

// ── DCP-08: Rights & Obligations ──

/// RightType: "memory_integrity", "dignified_transition", "identity_consistency", "immutable_record".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RightEntry {
    pub right_type: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RightsDeclaration {
    pub dcp_version: String,
    pub declaration_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub rights: Vec<RightEntry>,
    pub jurisdiction: String,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

/// ComplianceStatus: "compliant", "non_compliant", "pending_review".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObligationRecord {
    pub dcp_version: String,
    pub obligation_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub human_id: String,
    pub obligation_type: String,
    pub compliance_status: String,
    pub evidence_hashes: Vec<String>,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RightsViolationReport {
    pub dcp_version: String,
    pub violation_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub violated_right: String,
    pub evidence_hashes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispute_id: Option<String>,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

// ── DCP-09: Delegation & Representation ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorityScopeEntry {
    pub domain: String,
    pub actions_permitted: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_classes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limits: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelegationMandate {
    pub dcp_version: String,
    pub mandate_id: String,
    pub session_nonce: String,
    pub human_id: String,
    pub agent_id: String,
    pub authority_scope: Vec<AuthorityScopeEntry>,
    pub valid_from: String,
    pub valid_until: String,
    pub revocable: bool,
    pub timestamp: String,
    pub human_composite_sig: CompositeSignature,
}

/// SignificanceScore is 0-1000.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvisoryDeclaration {
    pub dcp_version: String,
    pub declaration_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub human_id: String,
    pub significance_score: i32,
    pub action_summary: String,
    pub recommended_response: String,
    pub response_deadline: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub human_response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proceeded_without_response: Option<bool>,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrincipalMirror {
    pub dcp_version: String,
    pub mirror_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub human_id: String,
    pub period: HashMap<String, String>,
    pub narrative: String,
    pub action_count: u32,
    pub decision_summary: String,
    pub audit_chain_hash: String,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionRecord {
    pub dcp_version: String,
    pub interaction_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub counterparty_agent_id: String,
    pub public_layer: HashMap<String, String>,
    pub private_layer_hash: String,
    pub mandate_id: String,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}

/// Operator: "gt", "lt", "gte", "lte", "eq".
/// ActionIfTriggered: "notify", "escalate", "block".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThresholdRule {
    pub dimension: String,
    pub operator: String,
    pub value: f64,
    pub action_if_triggered: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwarenessThreshold {
    pub dcp_version: String,
    pub threshold_id: String,
    pub session_nonce: String,
    pub agent_id: String,
    pub human_id: String,
    pub threshold_rules: Vec<ThresholdRule>,
    pub timestamp: String,
    pub composite_sig: CompositeSignature,
}
