use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::canonicalize::canonicalize_v2;
use super::composite_sig::CompositeSignature;
use super::dual_hash::dual_hash_canonical;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedPayload {
    pub payload: Value,
    pub payload_hash: String,
    pub composite_sig: CompositeSignature,
}

/// Canonicalize a serializable payload and compute its SHA-256 hash.
/// Returns (canonical_bytes, "sha256:<hex>").
pub fn prepare_payload<T: Serialize>(payload: &T) -> Result<(Vec<u8>, String), String> {
    let value = serde_json::to_value(payload).map_err(|e| format!("Serialization error: {}", e))?;
    let canonical = canonicalize_v2(&value)?;
    let dh = dual_hash_canonical(&canonical);
    let canonical_bytes = canonical.into_bytes();
    Ok((canonical_bytes, format!("sha256:{}", dh.sha256)))
}

/// Verify that the payload_hash in a SignedPayload matches a fresh hash of the payload.
pub fn verify_payload_hash(signed: &SignedPayload) -> Result<bool, String> {
    let canonical = canonicalize_v2(&signed.payload)?;
    let dh = dual_hash_canonical(&canonical);
    let expected = format!("sha256:{}", dh.sha256);
    Ok(signed.payload_hash == expected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use crate::v2::composite_sig::{SignatureEntry, CompositeSignature};

    #[test]
    fn test_prepare_payload() {
        let payload = json!({"action": "test", "value": 42});
        let (bytes, hash) = prepare_payload(&payload).unwrap();
        assert!(!bytes.is_empty());
        assert!(hash.starts_with("sha256:"));
    }

    #[test]
    fn test_verify_payload_hash_valid() {
        let payload = json!({"action": "test", "value": 42});
        let (_, hash) = prepare_payload(&payload).unwrap();
        let signed = SignedPayload {
            payload: payload,
            payload_hash: hash,
            composite_sig: CompositeSignature::classical_only(SignatureEntry {
                alg: "ed25519".into(),
                kid: "test".into(),
                sig_b64: "fake".into(),
            }),
        };
        assert!(verify_payload_hash(&signed).unwrap());
    }
}
