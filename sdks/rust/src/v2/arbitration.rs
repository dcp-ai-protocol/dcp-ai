//! DCP-07 v2.0 Arbitration & Jurisprudence — Rust port.

use serde_json::{json, Value};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_DISPUTE;
use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

#[derive(Debug, Clone)]
pub struct ArbitrationPanel {
    pub arbitrator_ids: Vec<String>,
    pub threshold: u32,
    pub created_at: String,
}

pub fn create_arbitration_panel(
    arbitrator_ids: Vec<String>,
    threshold: u32,
) -> Result<ArbitrationPanel, String> {
    if threshold < 1 {
        return Err("Arbitration panel: threshold must be >= 1".into());
    }
    if (arbitrator_ids.len() as u32) < threshold {
        return Err(format!(
            "Arbitration panel: need at least {} arbitrators, got {}",
            threshold,
            arbitrator_ids.len()
        ));
    }
    Ok(ArbitrationPanel {
        arbitrator_ids,
        threshold,
        created_at: utc_now_iso(),
    })
}

pub struct SubmitResolutionParams<'a> {
    pub dispute_id: &'a str,
    pub session_nonce: &'a str,
    pub arbitrator_ids: Vec<String>,
    pub resolution: &'a str,
    pub binding: bool,
    pub precedent_references: Option<Vec<String>>,
}

pub fn submit_resolution(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: SubmitResolutionParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "dispute_id": params.dispute_id,
        "session_nonce": params.session_nonce,
        "arbitrator_ids": params.arbitrator_ids,
        "resolution": params.resolution,
        "binding": params.binding,
        "precedent_references": params.precedent_references,
        "timestamp": utc_now_iso(),
    });
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
            serde_json::to_value(&composite).map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

pub struct JurisprudenceParams<'a> {
    pub jurisprudence_id: &'a str,
    pub session_nonce: &'a str,
    pub dispute_id: &'a str,
    pub resolution_id: &'a str,
    pub category: &'a str,
    pub precedent_summary: &'a str,
    pub applicable_contexts: Vec<String>,
    pub authority_level: &'a str,
}

pub fn build_jurisprudence_bundle(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: JurisprudenceParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "jurisprudence_id": params.jurisprudence_id,
        "session_nonce": params.session_nonce,
        "dispute_id": params.dispute_id,
        "resolution_id": params.resolution_id,
        "category": params.category,
        "precedent_summary": params.precedent_summary,
        "applicable_contexts": params.applicable_contexts,
        "authority_level": params.authority_level,
        "timestamp": utc_now_iso(),
    });
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
            serde_json::to_value(&composite).map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

/// Filter a jurisprudence collection by category, optionally restricting to
/// entries whose `applicable_contexts` include the given context.
pub fn lookup_precedent(
    jurisprudence: &[Value],
    category: &str,
    context: Option<&str>,
) -> Vec<Value> {
    let mut out = Vec::new();
    for entry in jurisprudence {
        if entry.get("category").and_then(Value::as_str) != Some(category) {
            continue;
        }
        if let Some(ctx) = context {
            let contexts = entry
                .get("applicable_contexts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let matches = contexts.iter().any(|v| v.as_str() == Some(ctx));
            if !matches {
                continue;
            }
        }
        out.push(entry.clone());
    }
    out
}
