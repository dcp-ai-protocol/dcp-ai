//! DCP v2.0 Emergency Revocation — Rust port.

use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

#[derive(Debug, Clone)]
pub struct EmergencyRevocationTokenPair {
    pub revocation_secret: String,          // 64 hex chars
    pub emergency_revocation_token: String, // "sha256:<hex>"
}

/// Generate a (secret, commitment) pair. The secret MUST be stored offline.
pub fn generate_emergency_revocation_token() -> EmergencyRevocationTokenPair {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    EmergencyRevocationTokenPair {
        revocation_secret: hex::encode(bytes),
        emergency_revocation_token: format!("sha256:{}", hex::encode(digest)),
    }
}

/// Constant-time verification that `sha256(secret) == commitment`.
pub fn verify_emergency_revocation_secret(revocation_secret: &str, commitment_token: &str) -> bool {
    let Some(expected_hex) = commitment_token.strip_prefix("sha256:") else {
        return false;
    };
    let Ok(secret_bytes) = hex::decode(revocation_secret) else {
        return false;
    };
    if secret_bytes.len() != 32 {
        return false;
    }
    let mut hasher = Sha256::new();
    hasher.update(&secret_bytes);
    let actual = hex::encode(hasher.finalize());
    // Byte-wise comparison in constant time over fixed-length hex digests.
    ct_eq_str(&actual, expected_hex)
}

fn ct_eq_str(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Build an emergency-revocation request payload (unsigned; gateway validates the secret).
pub fn build_emergency_revocation(agent_id: &str, human_id: &str, revocation_secret: &str) -> Value {
    json!({
        "type": "emergency_revocation",
        "agent_id": agent_id,
        "human_id": human_id,
        "revocation_secret": revocation_secret,
        "timestamp": utc_now_iso(),
        "reason": "key_compromise_emergency",
    })
}
