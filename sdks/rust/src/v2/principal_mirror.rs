//! DCP-09 v2.0 Principal Mirror — Rust port.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_DELEGATION;
use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

fn compute_audit_chain_hash(entries: &[Value]) -> Result<String, String> {
    let mut h = Sha256::new();
    for entry in entries {
        let canonical = canonicalize_v2(entry)?;
        h.update(canonical.as_bytes());
    }
    Ok(format!("sha256:{}", hex::encode(h.finalize())))
}

pub struct MirrorParams<'a> {
    pub mirror_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub human_id: &'a str,
    pub period: Value, // {"from": "...", "to": "..."}
    pub audit_entries: Vec<Value>,
    pub narrative: &'a str,
    pub decision_summary: &'a str,
}

pub fn generate_mirror(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: MirrorParams<'_>,
) -> Result<Value, CryptoError> {
    let audit_hash =
        compute_audit_chain_hash(&params.audit_entries).map_err(CryptoError::SignatureError)?;
    let action_count = params.audit_entries.len();

    let payload = json!({
        "dcp_version": "2.0",
        "mirror_id": params.mirror_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "human_id": params.human_id,
        "period": params.period,
        "narrative": params.narrative,
        "action_count": action_count,
        "decision_summary": params.decision_summary,
        "audit_chain_hash": audit_hash,
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
