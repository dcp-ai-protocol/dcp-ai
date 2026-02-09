//! Ed25519 signing, verification, and SHA-256 hashing for DCP.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey, Signature};
use sha2::{Sha256, Digest};
use serde_json::Value;

/// Canonical JSON serialization (sorted keys, compact).
pub fn canonicalize(obj: &Value) -> String {
    match obj {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let pairs: Vec<String> = keys
                .iter()
                .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), canonicalize(&map[*k])))
                .collect();
            format!("{{{}}}", pairs.join(","))
        }
        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(canonicalize).collect();
            format!("[{}]", items.join(","))
        }
        _ => serde_json::to_string(obj).unwrap(),
    }
}

/// Compute SHA-256 hash of canonical JSON. Returns hex string.
pub fn hash_object(obj: &Value) -> String {
    let canon = canonicalize(obj);
    let mut hasher = Sha256::new();
    hasher.update(canon.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a new Ed25519 keypair. Returns (public_key_b64, secret_key_b64).
pub fn generate_keypair() -> (String, String) {
    let mut rng = rand::thread_rng();
    let signing_key = SigningKey::generate(&mut rng);
    let verifying_key = signing_key.verifying_key();
    let secret_b64 = BASE64.encode(signing_key.to_keypair_bytes());
    let public_b64 = BASE64.encode(verifying_key.to_bytes());
    (public_b64, secret_b64)
}

/// Sign a JSON value with Ed25519 (detached). Returns base64 signature.
pub fn sign_object(obj: &Value, secret_key_b64: &str) -> Result<String, String> {
    let canon = canonicalize(obj);
    let sk_bytes = BASE64.decode(secret_key_b64).map_err(|e| e.to_string())?;
    let key_bytes: [u8; 32] = sk_bytes[..32].try_into().map_err(|_| "invalid key length")?;
    let signing_key = SigningKey::from_bytes(&key_bytes);
    let sig = signing_key.sign(canon.as_bytes());
    Ok(BASE64.encode(sig.to_bytes()))
}

/// Verify an Ed25519 detached signature on a JSON value.
pub fn verify_object(obj: &Value, signature_b64: &str, public_key_b64: &str) -> Result<bool, String> {
    let canon = canonicalize(obj);
    let sig_bytes = BASE64.decode(signature_b64).map_err(|e| e.to_string())?;
    let pk_bytes = BASE64.decode(public_key_b64).map_err(|e| e.to_string())?;

    let pk_array: [u8; 32] = pk_bytes.try_into().map_err(|_| "invalid public key length")?;
    let sig_array: [u8; 64] = sig_bytes.try_into().map_err(|_| "invalid signature length")?;

    let verifying_key = VerifyingKey::from_bytes(&pk_array).map_err(|e| e.to_string())?;
    let signature = Signature::from_bytes(&sig_array);

    Ok(verifying_key.verify(canon.as_bytes(), &signature).is_ok())
}

/// Compute Merkle root from hex leaf hashes.
pub fn merkle_root_from_hex_leaves(leaves: &[String]) -> Option<String> {
    if leaves.is_empty() {
        return None;
    }
    let mut layer: Vec<String> = leaves.to_vec();
    while layer.len() > 1 {
        if layer.len() % 2 == 1 {
            let last = layer.last().unwrap().clone();
            layer.push(last);
        }
        let mut next = Vec::new();
        for i in (0..layer.len()).step_by(2) {
            let left = hex::decode(&layer[i]).unwrap();
            let right = hex::decode(&layer[i + 1]).unwrap();
            let mut combined = left;
            combined.extend_from_slice(&right);
            let mut hasher = Sha256::new();
            hasher.update(&combined);
            next.push(hex::encode(hasher.finalize()));
        }
        layer = next;
    }
    Some(layer[0].clone())
}
