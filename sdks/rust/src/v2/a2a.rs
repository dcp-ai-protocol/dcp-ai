//! DCP-04 v2.0 A2A — Rust port (discovery + handshake scaffolding).
//!
//! The full A2A session layer (AES-256-GCM encryption, resume, rekey) is
//! delegated to follow-up minor releases for Rust; the Python and TypeScript
//! SDKs carry the complete implementation today. This module ports the parts
//! that are non-cryptographic protocol scaffolding so Rust users can build
//! agent directories, HELLO/WELCOME messages, and derive session IDs from a
//! shared key they obtain out-of-band (e.g. via ML-KEM-768 on the TS or Python
//! side).

use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

// ── Discovery ──

pub fn create_agent_directory(organization: &str, agents: Vec<Value>) -> Value {
    json!({
        "dcp_version": "2.0",
        "organization": organization,
        "agents": agents,
    })
}

/// Return the first active agent whose capabilities cover `required`.
pub fn find_agent_by_capability<'a>(directory: &'a Value, required: &[&str]) -> Option<&'a Value> {
    let agents = directory.get("agents")?.as_array()?;
    agents.iter().find(|agent| {
        if agent.get("status").and_then(Value::as_str) != Some("active") {
            return false;
        }
        let caps: Vec<&str> = agent
            .get("capabilities")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        required.iter().all(|r| caps.contains(r))
    })
}

/// Return the first active agent whose `agent_id` matches.
pub fn find_agent_by_id<'a>(directory: &'a Value, agent_id: &str) -> Option<&'a Value> {
    let agents = directory.get("agents")?.as_array()?;
    agents.iter().find(|a| {
        a.get("agent_id").and_then(Value::as_str) == Some(agent_id)
            && a.get("status").and_then(Value::as_str) == Some("active")
    })
}

/// Validate a directory entry; return the list of schema errors (empty on success).
pub fn validate_directory_entry(entry: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if entry.get("agent_id").and_then(Value::as_str).unwrap_or("").is_empty() {
        errors.push("Missing agent_id".into());
    }
    if entry.get("agent_name").and_then(Value::as_str).unwrap_or("").is_empty() {
        errors.push("Missing agent_name".into());
    }
    let caps_ok = entry
        .get("capabilities")
        .and_then(Value::as_array)
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    if !caps_ok {
        errors.push("capabilities must be non-empty array".into());
    }
    if entry.get("bundle_endpoint").and_then(Value::as_str).unwrap_or("").is_empty() {
        errors.push("Missing bundle_endpoint".into());
    }
    if entry.get("a2a_endpoint").and_then(Value::as_str).unwrap_or("").is_empty() {
        errors.push("Missing a2a_endpoint".into());
    }
    let status = entry.get("status").and_then(Value::as_str).unwrap_or("");
    if !matches!(status, "active" | "suspended" | "revoked") {
        errors.push("Invalid status".into());
    }
    errors
}

// ── Handshake ──

/// Generate a 256-bit handshake nonce (64 lowercase hex chars).
pub fn generate_nonce() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn create_hello(
    initiator_bundle: Value,
    kem_public_key_b64: &str,
    requested_capabilities: Vec<String>,
    security_tier: &str,
) -> Value {
    json!({
        "type": "A2A_HELLO",
        "protocol_version": "2.0",
        "initiator_bundle": initiator_bundle,
        "ephemeral_kem_public_key": {
            "alg": "x25519-ml-kem-768",
            "public_key_b64": kem_public_key_b64,
        },
        "nonce": generate_nonce(),
        "supported_algorithms": {
            "signing": ["ed25519", "ml-dsa-65"],
            "kem": ["x25519-ml-kem-768"],
            "cipher": ["aes-256-gcm"],
        },
        "requested_capabilities": requested_capabilities,
        "security_tier": security_tier,
        "timestamp": utc_now_iso(),
    })
}

pub fn create_welcome(
    responder_bundle: Value,
    kem_public_key_b64: &str,
    kem_ciphertext_b64: &str,
    resolved_tier: &str,
) -> Value {
    json!({
        "type": "A2A_WELCOME",
        "protocol_version": "2.0",
        "responder_bundle": responder_bundle,
        "ephemeral_kem_public_key": {
            "alg": "x25519-ml-kem-768",
            "public_key_b64": kem_public_key_b64,
        },
        "nonce": generate_nonce(),
        "kem_ciphertext": {
            "alg": "x25519-ml-kem-768",
            "ciphertext_b64": kem_ciphertext_b64,
        },
        "selected_algorithms": {
            "signing": "ed25519",
            "kem": "x25519-ml-kem-768",
            "cipher": "aes-256-gcm",
        },
        "resolved_security_tier": resolved_tier,
        "timestamp": utc_now_iso(),
    })
}

/// Derive a stable session identifier from the two nonces + session key.
pub fn derive_session_id(
    agent_id_a: &str,
    agent_id_b: &str,
    nonce_a_hex: &str,
    nonce_b_hex: &str,
    session_key: &[u8],
) -> Result<String, String> {
    let nonce_a = hex::decode(nonce_a_hex).map_err(|e| e.to_string())?;
    let nonce_b = hex::decode(nonce_b_hex).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(b"DCP-AI.v2.A2A.Session");
    hasher.update([0u8]);
    hasher.update(agent_id_a.as_bytes());
    hasher.update([0u8]);
    hasher.update(agent_id_b.as_bytes());
    hasher.update([0u8]);
    hasher.update(&nonce_a);
    hasher.update(&nonce_b);
    hasher.update(session_key);
    Ok(hex::encode(hasher.finalize()))
}

pub fn create_close_message(
    session_id: &str,
    reason: &str,
    final_sequence: u64,
    audit_summary_hash: &str,
) -> Value {
    json!({
        "type": "A2A_CLOSE",
        "session_id": session_id,
        "reason": reason,
        "final_sequence": final_sequence,
        "audit_summary_hash": audit_summary_hash,
        "timestamp": utc_now_iso(),
    })
}
