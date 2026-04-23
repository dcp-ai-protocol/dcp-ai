//! DCP-09 v2.0 Delegation & Representation — Rust port.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_DELEGATION;
use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

pub struct DelegationMandateParams<'a> {
    pub mandate_id: &'a str,
    pub session_nonce: &'a str,
    pub human_id: &'a str,
    pub agent_id: &'a str,
    pub authority_scope: Vec<Value>,
    pub valid_from: &'a str,
    pub valid_until: &'a str,
    pub revocable: bool,
}

/// Create a delegation mandate signed by the human principal.
/// The output carries the signature in the `human_composite_sig` field, not
/// `composite_sig`, to distinguish the human-principal witness on the mandate.
pub fn create_delegation_mandate(
    human_classical_provider: &dyn CryptoProvider,
    human_pq_provider: &dyn CryptoProvider,
    human_classical_key: &CompositeKeyInfo,
    human_pq_key: &CompositeKeyInfo,
    params: DelegationMandateParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "mandate_id": params.mandate_id,
        "session_nonce": params.session_nonce,
        "human_id": params.human_id,
        "agent_id": params.agent_id,
        "authority_scope": params.authority_scope,
        "valid_from": params.valid_from,
        "valid_until": params.valid_until,
        "revocable": params.revocable,
        "timestamp": utc_now_iso(),
    });
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        human_classical_provider,
        human_pq_provider,
        CTX_DELEGATION,
        canonical.as_bytes(),
        human_classical_key,
        human_pq_key,
    )?;
    let mut out = payload;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "human_composite_sig".into(),
            serde_json::to_value(&composite).map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

#[derive(Debug, Clone)]
pub struct MandateValidity {
    pub valid: bool,
    pub reason: Option<String>,
}

/// Check whether a mandate is currently valid (not expired, not revoked).
pub fn verify_mandate_validity(mandate: &Value, revoked_mandate_ids: &HashSet<String>) -> MandateValidity {
    let mandate_id = mandate
        .get("mandate_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !mandate_id.is_empty() && revoked_mandate_ids.contains(mandate_id) {
        return MandateValidity {
            valid: false,
            reason: Some("Mandate has been revoked".into()),
        };
    }
    let valid_from = mandate.get("valid_from").and_then(Value::as_str).unwrap_or("");
    let valid_until = mandate.get("valid_until").and_then(Value::as_str).unwrap_or("");
    let now = utc_now_iso();
    // Lexicographic comparison works for ISO-8601 UTC strings.
    if valid_from > now.as_str() {
        return MandateValidity {
            valid: false,
            reason: Some("Mandate is not yet valid".into()),
        };
    }
    if valid_until < now.as_str() {
        return MandateValidity {
            valid: false,
            reason: Some("Mandate has expired".into()),
        };
    }
    MandateValidity {
        valid: true,
        reason: None,
    }
}

#[derive(Debug, Clone)]
pub struct RevocationOutcome {
    pub revoked: bool,
    pub reason: Option<String>,
}

/// Mark a mandate as revoked. Mutates `revoked_mandate_ids`. Non-revocable
/// mandates are returned as `revoked: false` with a reason string.
pub fn revoke_delegation(mandate: &Value, revoked_mandate_ids: &mut HashSet<String>) -> RevocationOutcome {
    if !mandate.get("revocable").and_then(Value::as_bool).unwrap_or(false) {
        return RevocationOutcome {
            revoked: false,
            reason: Some("Mandate is not revocable".into()),
        };
    }
    if let Some(id) = mandate.get("mandate_id").and_then(Value::as_str) {
        revoked_mandate_ids.insert(id.to_string());
    }
    RevocationOutcome {
        revoked: true,
        reason: None,
    }
}

pub struct InteractionParams<'a> {
    pub interaction_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub counterparty_agent_id: &'a str,
    pub public_layer: Value,
    pub private_layer_hash: &'a str,
    pub mandate_id: &'a str,
}

pub fn generate_interaction_record(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: InteractionParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "interaction_id": params.interaction_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "counterparty_agent_id": params.counterparty_agent_id,
        "public_layer": params.public_layer,
        "private_layer_hash": params.private_layer_hash,
        "mandate_id": params.mandate_id,
        "timestamp": utc_now_iso(),
    });
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        CTX_DELEGATION,
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
