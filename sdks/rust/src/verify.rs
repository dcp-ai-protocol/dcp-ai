//! Full DCP signed bundle verification.

use serde_json::Value;
use crate::crypto::{canonicalize, hash_object, verify_object, merkle_root_from_hex_leaves};
use crate::types::VerificationResult;

/// Verify a signed bundle from its JSON Value representation.
/// Checks signature, bundle_hash, merkle_root, intent_hash chain, and prev_hash chain.
pub fn verify_signed_bundle(signed_bundle: &Value, public_key_b64: Option<&str>) -> VerificationResult {
    let bundle = match signed_bundle.get("bundle") {
        Some(b) => b,
        None => return VerificationResult::fail(vec!["Missing bundle".into()]),
    };

    let signature = match signed_bundle.get("signature") {
        Some(s) => s,
        None => return VerificationResult::fail(vec!["Missing signature".into()]),
    };

    let sig_b64 = match signature.get("sig_b64").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return VerificationResult::fail(vec!["Missing sig_b64".into()]),
    };

    let pub_key = public_key_b64
        .or_else(|| {
            signature.get("signer")
                .and_then(|s| s.get("public_key_b64"))
                .and_then(|v| v.as_str())
        });

    let pub_key = match pub_key {
        Some(k) => k,
        None => return VerificationResult::fail(vec!["Missing public key".into()]),
    };

    // 1) Signature verification
    match verify_object(bundle, sig_b64, pub_key) {
        Ok(true) => {}
        _ => return VerificationResult::fail(vec!["SIGNATURE INVALID".into()]),
    }

    // 2) bundle_hash
    if let Some(bh) = signature.get("bundle_hash").and_then(|v| v.as_str()) {
        if bh.starts_with("sha256:") {
            let expected = {
                let canon = canonicalize(bundle);
                use sha2::{Sha256, Digest};
                let mut hasher = Sha256::new();
                hasher.update(canon.as_bytes());
                hex::encode(hasher.finalize())
            };
            let got = &bh["sha256:".len()..];
            if got != expected {
                return VerificationResult::fail(vec!["BUNDLE HASH MISMATCH".into()]);
            }
        }
    }

    // 3) merkle_root
    if let Some(mr) = signature.get("merkle_root").and_then(|v| v.as_str()) {
        if mr.starts_with("sha256:") {
            if let Some(entries) = bundle.get("audit_entries").and_then(|v| v.as_array()) {
                let leaves: Vec<String> = entries.iter().map(|e| hash_object(e)).collect();
                if let Some(expected) = merkle_root_from_hex_leaves(&leaves) {
                    let got = &mr["sha256:".len()..];
                    if got != expected {
                        return VerificationResult::fail(vec!["MERKLE ROOT MISMATCH".into()]);
                    }
                }
            }
        }
    }

    // 4) intent_hash and prev_hash chain
    if let Some(intent) = bundle.get("intent") {
        let expected_intent_hash = hash_object(intent);

        if let Some(entries) = bundle.get("audit_entries").and_then(|v| v.as_array()) {
            let mut prev_expected = "GENESIS".to_string();
            for (i, entry) in entries.iter().enumerate() {
                if let Some(ih) = entry.get("intent_hash").and_then(|v| v.as_str()) {
                    if ih != expected_intent_hash {
                        return VerificationResult::fail(vec![
                            format!("intent_hash (entry {}): expected {}, got {}", i, expected_intent_hash, ih),
                        ]);
                    }
                }
                if let Some(ph) = entry.get("prev_hash").and_then(|v| v.as_str()) {
                    if ph != prev_expected {
                        return VerificationResult::fail(vec![
                            format!("prev_hash chain (entry {}): expected {}, got {}", i, prev_expected, ph),
                        ]);
                    }
                }
                prev_expected = hash_object(entry);
            }
        }
    }

    VerificationResult::ok()
}
