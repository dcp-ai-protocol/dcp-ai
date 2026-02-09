//! DCP v1 type definitions.

use serde::{Deserialize, Serialize};

/// DCP-01: Human Binding Record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HumanBindingRecord {
    pub dcp_version: String,
    pub human_id: String,
    pub legal_name: String,
    pub entity_type: String,
    pub jurisdiction: String,
    pub liability_mode: String,
    pub override_rights: bool,
    pub issued_at: String,
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact: Option<String>,
    pub signature: String,
}

/// DCP-01: Agent Passport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPassport {
    pub dcp_version: String,
    pub agent_id: String,
    pub public_key: String,
    pub human_binding_reference: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk_tier: Option<String>,
    pub created_at: String,
    pub status: String,
    pub signature: String,
}

/// Intent target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentTarget {
    pub channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// DCP-02: Intent Declaration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Intent {
    pub dcp_version: String,
    pub intent_id: String,
    pub agent_id: String,
    pub human_id: String,
    pub timestamp: String,
    pub action_type: String,
    pub target: IntentTarget,
    pub data_classes: Vec<String>,
    pub estimated_impact: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires_consent: Option<bool>,
}

/// DCP-02: Policy Decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub dcp_version: String,
    pub intent_id: String,
    pub decision: String,
    pub risk_score: f64,
    pub reasons: Vec<String>,
}

/// Evidence attached to an audit entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvidence {
    pub tool: Option<String>,
    pub result_ref: Option<String>,
}

/// DCP-03: Audit Entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub dcp_version: String,
    pub audit_id: String,
    pub prev_hash: String,
    pub timestamp: String,
    pub agent_id: String,
    pub human_id: String,
    pub intent_id: String,
    pub intent_hash: String,
    pub policy_decision: String,
    pub outcome: String,
    pub evidence: AuditEvidence,
}

/// Citizenship Bundle — contains all DCP artifacts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CitizenshipBundle {
    pub human_binding_record: HumanBindingRecord,
    pub agent_passport: AgentPassport,
    pub intent: Intent,
    pub policy_decision: PolicyDecision,
    pub audit_entries: Vec<AuditEntry>,
}

/// Signer information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signer {
    #[serde(rename = "type")]
    pub signer_type: String,
    pub id: String,
    pub public_key_b64: String,
}

/// Bundle signature block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleSignature {
    pub alg: String,
    pub created_at: String,
    pub signer: Signer,
    pub bundle_hash: String,
    pub merkle_root: Option<String>,
    pub sig_b64: String,
}

/// Signed Bundle — bundle + cryptographic signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedBundle {
    pub bundle: CitizenshipBundle,
    pub signature: BundleSignature,
}

/// Verification result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<String>>,
}

impl VerificationResult {
    pub fn ok() -> Self {
        Self { verified: true, errors: None }
    }

    pub fn fail(errors: Vec<String>) -> Self {
        Self { verified: false, errors: Some(errors) }
    }
}
