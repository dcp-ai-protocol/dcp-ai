//! DCP-08 v2.0 Rights & Obligations — Rust port.

use serde_json::{json, Value};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_RIGHTS;
use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

fn finalize_rights(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    payload: Value,
) -> Result<Value, CryptoError> {
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        CTX_RIGHTS,
        canonical.as_bytes(),
        classical_key,
        pq_key,
    )?;
    let mut out = payload;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "composite_sig".into(),
            serde_json::to_value(&composite).map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

pub struct DeclareRightsParams<'a> {
    pub declaration_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub rights: Vec<Value>,
    pub jurisdiction: &'a str,
}

pub fn declare_rights(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: DeclareRightsParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "declaration_id": params.declaration_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "rights": params.rights,
        "jurisdiction": params.jurisdiction,
        "timestamp": utc_now_iso(),
    });
    finalize_rights(classical_provider, pq_provider, classical_key, pq_key, payload)
}

pub struct ObligationParams<'a> {
    pub obligation_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub human_id: &'a str,
    pub obligation_type: &'a str,
    pub compliance_status: &'a str,
    pub evidence_hashes: Vec<String>,
}

pub fn record_obligation(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: ObligationParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "obligation_id": params.obligation_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "human_id": params.human_id,
        "obligation_type": params.obligation_type,
        "compliance_status": params.compliance_status,
        "evidence_hashes": params.evidence_hashes,
        "timestamp": utc_now_iso(),
    });
    finalize_rights(classical_provider, pq_provider, classical_key, pq_key, payload)
}

pub struct ViolationParams<'a> {
    pub violation_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub violated_right: &'a str,
    pub evidence_hashes: Vec<String>,
    pub dispute_id: Option<&'a str>,
}

pub fn report_violation(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: ViolationParams<'_>,
) -> Result<Value, CryptoError> {
    let dispute: Value = match params.dispute_id {
        Some(s) => Value::String(s.to_string()),
        None => Value::Null,
    };
    let payload = json!({
        "dcp_version": "2.0",
        "violation_id": params.violation_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "violated_right": params.violated_right,
        "evidence_hashes": params.evidence_hashes,
        "dispute_id": dispute,
        "timestamp": utc_now_iso(),
    });
    finalize_rights(classical_provider, pq_provider, classical_key, pq_key, payload)
}

#[derive(Debug, Clone)]
pub struct ComplianceReport {
    pub compliant: bool,
    pub violations: Vec<String>,
}

/// Check an agent's rights compliance against declared obligations.
pub fn check_rights_compliance(_declaration: &Value, obligations: &[Value]) -> ComplianceReport {
    let mut violations = Vec::new();
    for obligation in obligations {
        if obligation.get("compliance_status").and_then(Value::as_str) == Some("non_compliant") {
            let id = obligation
                .get("obligation_id")
                .and_then(Value::as_str)
                .unwrap_or("?");
            let otype = obligation
                .get("obligation_type")
                .and_then(Value::as_str)
                .unwrap_or("?");
            violations.push(format!("Obligation {id} ({otype}) is non-compliant"));
        }
    }
    ComplianceReport {
        compliant: violations.is_empty(),
        violations,
    }
}
