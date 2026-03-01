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
