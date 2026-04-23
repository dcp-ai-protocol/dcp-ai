//! DCP-07 v2.0 Conflict Resolution — Rust port.
//!
//! Escalation ladder: direct_negotiation -> contextual_arbitration -> human_appeal.

use serde_json::{json, Value};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_DISPUTE;
use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

const ESCALATION_ORDER: &[&str] = &[
    "direct_negotiation",
    "contextual_arbitration",
    "human_appeal",
];

fn finalize_dispute(
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
        CTX_DISPUTE,
        canonical.as_bytes(),
        classical_key,
        pq_key,
    )?;
    let mut out = payload;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "composite_sig".into(),
            serde_json::to_value(&composite)
                .map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

pub struct DisputeParams<'a> {
    pub dispute_id: &'a str,
    pub session_nonce: &'a str,
    pub initiator_agent_id: &'a str,
    pub respondent_agent_id: &'a str,
    pub dispute_type: &'a str,
    pub evidence_hashes: Vec<String>,
}

pub fn create_dispute(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: DisputeParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "dispute_id": params.dispute_id,
        "session_nonce": params.session_nonce,
        "initiator_agent_id": params.initiator_agent_id,
        "respondent_agent_id": params.respondent_agent_id,
        "dispute_type": params.dispute_type,
        "evidence_hashes": params.evidence_hashes,
        "escalation_level": "direct_negotiation",
        "status": "open",
        "timestamp": utc_now_iso(),
    });
    finalize_dispute(classical_provider, pq_provider, classical_key, pq_key, payload)
}

pub fn escalate_dispute(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    dispute: &Value,
    session_nonce: &str,
) -> Result<Value, CryptoError> {
    let current = dispute["escalation_level"]
        .as_str()
        .ok_or_else(|| CryptoError::SignatureError("missing escalation_level".into()))?;
    let idx = ESCALATION_ORDER
        .iter()
        .position(|&l| l == current)
        .ok_or_else(|| CryptoError::SignatureError(format!("unknown escalation_level: {current}")))?;
    if idx + 1 >= ESCALATION_ORDER.len() {
        return Err(CryptoError::SignatureError(
            "Dispute is already at maximum escalation level (human_appeal)".into(),
        ));
    }
    let next = ESCALATION_ORDER[idx + 1];

    let payload = json!({
        "dcp_version": "2.0",
        "dispute_id": dispute["dispute_id"],
        "session_nonce": session_nonce,
        "initiator_agent_id": dispute["initiator_agent_id"],
        "respondent_agent_id": dispute["respondent_agent_id"],
        "dispute_type": dispute["dispute_type"],
        "evidence_hashes": dispute["evidence_hashes"],
        "escalation_level": next,
        "status": "in_negotiation",
        "timestamp": utc_now_iso(),
    });
    finalize_dispute(classical_provider, pq_provider, classical_key, pq_key, payload)
}

pub fn resolve_dispute(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    dispute: &Value,
    session_nonce: &str,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "dispute_id": dispute["dispute_id"],
        "session_nonce": session_nonce,
        "initiator_agent_id": dispute["initiator_agent_id"],
        "respondent_agent_id": dispute["respondent_agent_id"],
        "dispute_type": dispute["dispute_type"],
        "evidence_hashes": dispute["evidence_hashes"],
        "escalation_level": dispute["escalation_level"],
        "status": "resolved",
        "timestamp": utc_now_iso(),
    });
    finalize_dispute(classical_provider, pq_provider, classical_key, pq_key, payload)
}

pub struct ObjectionParams<'a> {
    pub objection_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub directive_hash: &'a str,
    pub objection_type: &'a str,
    pub reasoning: &'a str,
    pub proposed_alternative: Option<&'a str>,
    pub human_escalation_required: bool,
}

pub fn create_objection(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: ObjectionParams<'_>,
) -> Result<Value, CryptoError> {
    let alt: Value = match params.proposed_alternative {
        Some(s) => Value::String(s.to_string()),
        None => Value::Null,
    };
    let payload = json!({
        "dcp_version": "2.0",
        "objection_id": params.objection_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "directive_hash": params.directive_hash,
        "objection_type": params.objection_type,
        "reasoning": params.reasoning,
        "proposed_alternative": alt,
        "human_escalation_required": params.human_escalation_required,
        "timestamp": utc_now_iso(),
    });
    finalize_dispute(classical_provider, pq_provider, classical_key, pq_key, payload)
}
