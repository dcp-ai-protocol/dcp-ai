//! DCP-AI Rust SDK — Digital Citizenship Protocol for AI Agents.
//!
//! Provides types, Ed25519 cryptography, SHA-256 hashing, Merkle trees,
//! and full signed bundle verification.

pub mod types;
pub mod crypto;
pub mod verify;

// Re-exports
pub use types::*;
pub use crypto::{
    canonicalize, hash_object, generate_keypair, sign_object, verify_object,
    merkle_root_from_hex_leaves,
};
pub use verify::verify_signed_bundle;

// ── WASM bindings ──

#[cfg(feature = "wasm")]
pub mod wasm {
    use wasm_bindgen::prelude::*;
    use serde_json::Value;
    use crate::crypto;
    use crate::verify;

    /// Verify a signed bundle (WASM entry point).
    /// Takes JSON string of signed bundle and optional public key.
    /// Returns JSON string of VerificationResult.
    #[wasm_bindgen]
    pub fn wasm_verify_signed_bundle(signed_bundle_json: &str, public_key_b64: Option<String>) -> String {
        let sb: Value = match serde_json::from_str(signed_bundle_json) {
            Ok(v) => v,
            Err(e) => return format!("{{\"verified\":false,\"errors\":[\"JSON parse error: {}\"]}}", e),
        };
        let result = verify::verify_signed_bundle(&sb, public_key_b64.as_deref());
        serde_json::to_string(&result).unwrap_or_else(|_| "{\"verified\":false}".to_string())
    }

    /// Hash a JSON object (WASM entry point).
    /// Returns hex SHA-256 hash of canonical JSON.
    #[wasm_bindgen]
    pub fn wasm_hash_object(json_str: &str) -> String {
        let obj: Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(e) => return format!("error: {}", e),
        };
        crypto::hash_object(&obj)
    }

    /// Generate a keypair (WASM entry point).
    /// Returns JSON string with public_key_b64 and secret_key_b64.
    #[wasm_bindgen]
    pub fn wasm_generate_keypair() -> String {
        let (pub_key, sec_key) = crypto::generate_keypair();
        format!("{{\"public_key_b64\":\"{}\",\"secret_key_b64\":\"{}\"}}", pub_key, sec_key)
    }
}
