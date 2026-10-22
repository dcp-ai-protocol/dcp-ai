//! DCP v2.0 Blinded RPR — Rust port.
//!
//! Strips PII from a ResponsiblePrincipalRecord and replaces it with a
//! salted SHA-256 commitment (sha256:<hex>) so the artefact can be published
//! to transparency logs without leaking personal data. The salt (`pii_salt`)
//! stays in the full RPR.

use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::v2::canonicalize::canonicalize_v2;

/// Generate a `pii_salt`: 32 random bytes as 64 lowercase hex chars. Set it on
/// the full RPR before signing it, and never publish it.
pub fn generate_pii_salt() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Compute the sha256 commitment over the PII fields (`contact`, `legal_name`)
/// and `pii_salt`. Without `pii_salt` this is the legacy unsalted commitment
/// (deprecated), kept so existing records can still be opened.
pub fn compute_pii_hash(rpr: &Value) -> Result<String, String> {
    let mut pii = json!({
        "contact": rpr.get("contact").cloned().unwrap_or(Value::Null),
        "legal_name": rpr.get("legal_name").cloned().unwrap_or(Value::Null),
    });
    if let Some(salt) = rpr.get("pii_salt").filter(|s| !s.is_null()) {
        pii["pii_salt"] = salt.clone();
    }
    let canonical = canonicalize_v2(&pii)?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

/// Build a blinded RPR from a full RPR, replacing PII and `pii_salt` with a
/// hash commitment. Fails when `pii_salt` is missing or malformed: an
/// unsalted commitment can be confirmed by guessing the PII.
pub fn blind_rpr(rpr: &Value) -> Result<Value, String> {
    let salt = rpr.get("pii_salt").and_then(Value::as_str).unwrap_or("");
    if salt.len() != 64 || !salt.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err("blind_rpr requires pii_salt (32 random bytes as 64 lowercase hex): set it with generate_pii_salt() before signing the RPR".into());
    }
    let pii_hash = compute_pii_hash(rpr)?;
    Ok(json!({
        "dcp_version": "2.0",
        "human_id": rpr.get("human_id"),
        "session_nonce": rpr.get("session_nonce"),
        "blinded": true,
        "pii_hash": pii_hash,
        "entity_type": rpr.get("entity_type"),
        "jurisdiction": rpr.get("jurisdiction"),
        "liability_mode": rpr.get("liability_mode"),
        "override_rights": rpr.get("override_rights"),
        "issued_at": rpr.get("issued_at"),
        "expires_at": rpr.get("expires_at"),
        "binding_keys": rpr.get("binding_keys"),
    }))
}

#[derive(Debug, Clone, Default)]
pub struct BlindedRprCheck {
    pub valid: bool,
    pub errors: Vec<String>,
}

/// Verify that a full RPR discloses the expected blinded commitment.
///
/// A full RPR without `pii_salt` still verifies against the legacy unsalted
/// commitment, which is deprecated (spec §12.1): check
/// `full_rpr.get("pii_salt")` to flag such records.
pub fn verify_blinded_rpr(full_rpr: &Value, blinded_rpr: &Value) -> BlindedRprCheck {
    let mut errors = Vec::new();
    match compute_pii_hash(full_rpr) {
        Ok(expected) => {
            let got = blinded_rpr.get("pii_hash").and_then(Value::as_str).unwrap_or("");
            if got != expected {
                errors.push(format!("pii_hash mismatch: expected {expected}, got {got}"));
            }
        }
        Err(e) => errors.push(format!("compute pii_hash: {e}")),
    }
    let keys = [
        "human_id",
        "session_nonce",
        "entity_type",
        "jurisdiction",
        "liability_mode",
        "override_rights",
        "issued_at",
        "expires_at",
        "binding_keys",
    ];
    for k in keys {
        if full_rpr.get(k) != blinded_rpr.get(k) {
            errors.push(format!("{k} mismatch"));
        }
    }
    BlindedRprCheck {
        valid: errors.is_empty(),
        errors,
    }
}

/// Check whether an RPR payload is already blinded.
pub fn is_blinded_rpr(rpr: &Value) -> bool {
    rpr.get("blinded").and_then(Value::as_bool).unwrap_or(false)
}
