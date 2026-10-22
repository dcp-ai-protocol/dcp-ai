//! DCP-AI Rust SDK — Digital Citizenship Protocol for AI Agents.
//!
//! Provides types, Ed25519 cryptography, SHA-256 hashing, Merkle trees,
//! and full signed bundle verification. V2 adds composite hybrid signatures,
//! domain separation, and post-quantum algorithm support.

pub mod types;
pub mod crypto;
pub mod verify;
pub mod v2;
pub mod providers;
pub mod observability;

pub use types::*;
pub use crypto::{
    canonicalize, hash_object, generate_keypair, sign_object, verify_object,
    merkle_root_from_hex_leaves,
};
pub use verify::verify_signed_bundle;

/// Detect the DCP protocol version from a JSON value.
pub fn detect_dcp_version(value: &serde_json::Value) -> Option<&str> {
    if let Some(v) = value.get("dcp_version").and_then(|v| v.as_str()) {
        match v {
            "1.0" | "2.0" => return Some(v),
            _ => {}
        }
    }
    if let Some(v) = value.get("dcp_bundle_version").and_then(|v| v.as_str()) {
        if v == "2.0" {
            return Some("2.0");
        }
    }
    if let Some(bundle) = value.get("bundle") {
        if let Some(v) = bundle.get("dcp_bundle_version").and_then(|v| v.as_str()) {
            if v == "2.0" {
                return Some("2.0");
            }
        }
        if let Some(rpr) = bundle.get("responsible_principal_record") {
            if rpr.get("dcp_version").and_then(|v| v.as_str()) == Some("1.0") {
                return Some("1.0");
            }
        }
    }
    None
}

// ── WASM bindings ──

#[cfg(feature = "wasm")]
pub mod wasm {
    use wasm_bindgen::prelude::*;
    use serde_json::{json, Value};
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;

    use crate::crypto;
    use crate::verify;
    use crate::providers::ed25519::Ed25519Provider;
    use crate::providers::ml_dsa_65::MlDsa65Provider;
    use crate::providers::slh_dsa_192f::SlhDsa192fProvider;
    use crate::v2::crypto_provider::CryptoProvider;
    use crate::v2::composite_ops::{
        CompositeKeyInfo, composite_sign, classical_only_sign, composite_verify,
    };
    use crate::v2::composite_sig::{CompositeSignature, SignatureEntry};
    use crate::v2::dual_hash;
    use crate::v2::canonicalize::canonicalize_v2;
    use crate::v2::signed_payload;
    use crate::v2::verify_bundle::provider_for_alg;
    use crate::v2::proof_of_possession::{
        PopChallenge, generate_registration_pop, verify_registration_pop,
    };

    fn json_err(msg: &str) -> String {
        format!("{{\"error\":\"{}\"}}", msg.replace('"', "'"))
    }

    // ── V1 Compatibility ──────────────────────────────────────────────────

    #[wasm_bindgen]
    pub fn wasm_verify_signed_bundle(signed_bundle_json: &str, public_key_b64: Option<String>) -> String {
        let sb: Value = match serde_json::from_str(signed_bundle_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse error: {}", e)),
        };
        let result = verify::verify_signed_bundle(&sb, public_key_b64.as_deref());
        serde_json::to_string(&result).unwrap_or_else(|_| "{\"verified\":false}".to_string())
    }

    #[wasm_bindgen]
    pub fn wasm_hash_object(json_str: &str) -> String {
        let obj: Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        crypto::hash_object(&obj)
    }

    #[wasm_bindgen]
    pub fn wasm_detect_version(json_str: &str) -> String {
        let val: Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(_) => return "null".to_string(),
        };
        match crate::detect_dcp_version(&val) {
            Some(v) => format!("\"{}\"", v),
            None => "null".to_string(),
        }
    }

    // ── Keypair Generation ────────────────────────────────────────────────

    #[wasm_bindgen]
    pub fn wasm_generate_keypair() -> String {
        let (pub_key, sec_key) = crypto::generate_keypair();
        serde_json::to_string(&json!({
            "alg": "ed25519",
            "public_key_b64": pub_key,
            "secret_key_b64": sec_key
        })).unwrap()
    }

    #[wasm_bindgen]
    pub fn wasm_generate_ml_dsa_65_keypair() -> String {
        let provider = MlDsa65Provider;
        match provider.generate_keypair() {
            Ok(kp) => serde_json::to_string(&json!({
                "alg": "ml-dsa-65",
                "kid": kp.kid,
                "public_key_b64": kp.public_key_b64,
                "secret_key_b64": kp.secret_key_b64
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    #[wasm_bindgen]
    pub fn wasm_generate_slh_dsa_192f_keypair() -> String {
        let provider = SlhDsa192fProvider;
        match provider.generate_keypair() {
            Ok(kp) => serde_json::to_string(&json!({
                "alg": "slh-dsa-192f",
                "kid": kp.kid,
                "public_key_b64": kp.public_key_b64,
                "secret_key_b64": kp.secret_key_b64
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Generate an Ed25519 + ML-DSA-65 hybrid keypair in a single call.
    #[wasm_bindgen]
    pub fn wasm_generate_hybrid_keypair() -> String {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let ed_kp = match ed.generate_keypair() {
            Ok(kp) => kp,
            Err(e) => return json_err(&e.to_string()),
        };
        let pq_kp = match pq.generate_keypair() {
            Ok(kp) => kp,
            Err(e) => return json_err(&e.to_string()),
        };
        serde_json::to_string(&json!({
            "classical": {
                "alg": "ed25519",
                "kid": ed_kp.kid,
                "public_key_b64": ed_kp.public_key_b64,
                "secret_key_b64": ed_kp.secret_key_b64
            },
            "pq": {
                "alg": "ml-dsa-65",
                "kid": pq_kp.kid,
                "public_key_b64": pq_kp.public_key_b64,
                "secret_key_b64": pq_kp.secret_key_b64
            }
        })).unwrap()
    }

    // ── Composite Signing ─────────────────────────────────────────────────

    /// Composite sign: Ed25519 + ML-DSA-65 with pq_over_classical binding.
    #[wasm_bindgen]
    pub fn wasm_composite_sign(
        context: &str,
        payload_json: &str,
        classical_sk_b64: &str,
        classical_kid: &str,
        pq_sk_b64: &str,
        pq_kid: &str,
    ) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let canonical = match canonicalize_v2(&val) {
            Ok(c) => c,
            Err(e) => return json_err(&e),
        };

        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let classical_key = CompositeKeyInfo {
            kid: classical_kid.to_string(),
            alg: "ed25519".to_string(),
            secret_key_b64: classical_sk_b64.to_string(),
            public_key_b64: String::new(),
        };
        let pq_key = CompositeKeyInfo {
            kid: pq_kid.to_string(),
            alg: "ml-dsa-65".to_string(),
            secret_key_b64: pq_sk_b64.to_string(),
            public_key_b64: String::new(),
        };

        match composite_sign(&ed, &pq, context, canonical.as_bytes(), &classical_key, &pq_key) {
            Ok(sig) => serde_json::to_string(&sig).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Classical-only signing (Ed25519 transition mode).
    #[wasm_bindgen]
    pub fn wasm_classical_only_sign(
        context: &str,
        payload_json: &str,
        sk_b64: &str,
        kid: &str,
    ) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let canonical = match canonicalize_v2(&val) {
            Ok(c) => c,
            Err(e) => return json_err(&e),
        };

        let ed = Ed25519Provider;
        let key = CompositeKeyInfo {
            kid: kid.to_string(),
            alg: "ed25519".to_string(),
            secret_key_b64: sk_b64.to_string(),
            public_key_b64: String::new(),
        };

        match classical_only_sign(&ed, context, canonical.as_bytes(), &key) {
            Ok(sig) => serde_json::to_string(&sig).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Sign a payload and return a SignedPayload envelope (payload + hash + composite_sig).
    #[wasm_bindgen]
    pub fn wasm_sign_payload(
        context: &str,
        payload_json: &str,
        classical_sk_b64: &str,
        classical_kid: &str,
        pq_sk_b64: &str,
        pq_kid: &str,
    ) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let (canonical_bytes, payload_hash) = match signed_payload::prepare_payload(&val) {
            Ok(r) => r,
            Err(e) => return json_err(&e),
        };

        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let classical_key = CompositeKeyInfo {
            kid: classical_kid.to_string(),
            alg: "ed25519".to_string(),
            secret_key_b64: classical_sk_b64.to_string(),
            public_key_b64: String::new(),
        };
        let pq_key = CompositeKeyInfo {
            kid: pq_kid.to_string(),
            alg: "ml-dsa-65".to_string(),
            secret_key_b64: pq_sk_b64.to_string(),
            public_key_b64: String::new(),
        };

        match composite_sign(&ed, &pq, context, &canonical_bytes, &classical_key, &pq_key) {
            Ok(sig) => serde_json::to_string(&json!({
                "payload": val,
                "payload_hash": payload_hash,
                "composite_sig": sig
            })).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e.to_string()),
        }
    }

    // ── Composite Verification ────────────────────────────────────────────

    /// Verify a composite signature cryptographically.
    #[wasm_bindgen]
    pub fn wasm_composite_verify(
        context: &str,
        payload_json: &str,
        composite_sig_json: &str,
        classical_pk_b64: &str,
        pq_pk_b64: Option<String>,
    ) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let sig: CompositeSignature = match serde_json::from_str(composite_sig_json) {
            Ok(s) => s,
            Err(e) => return json_err(&format!("Signature parse: {}", e)),
        };
        let canonical = match canonicalize_v2(&val) {
            Ok(c) => c,
            Err(e) => return json_err(&e),
        };

        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let pq_ref: Option<&dyn CryptoProvider> = if pq_pk_b64.is_some() { Some(&pq) } else { None };

        match composite_verify(
            &ed, pq_ref, context, canonical.as_bytes(),
            &sig, classical_pk_b64, pq_pk_b64.as_deref(),
        ) {
            Ok(result) => serde_json::to_string(&json!({
                "valid": result.valid,
                "classical_valid": result.classical_valid,
                "pq_valid": result.pq_valid
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Full V2 bundle verification with cryptographic signature checks.
    ///
    /// `policy_json` is a full `VerifierPolicy` for V2 bundles; without it the
    /// default policy applies. The mode is the stricter of the policy mode and
    /// the security tier's mode (spec §14.3). The V1 verifier cannot apply a
    /// policy, so with one a V1 bundle is rejected.
    #[wasm_bindgen]
    pub fn wasm_verify_signed_bundle_v2(signed_bundle_json: &str, policy_json: Option<String>) -> String {
        let policy: crate::v2::types::VerifierPolicy = match policy_json.as_deref().map(serde_json::from_str) {
            None => Default::default(),
            Some(Ok(p)) => p,
            Some(Err(e)) => return serde_json::to_string(&json!({
                "verified": false, "errors": [format!("Policy parse error: {}", e)]
            })).unwrap(),
        };
        let val: Value = match serde_json::from_str(signed_bundle_json) {
            Ok(v) => v,
            Err(e) => return serde_json::to_string(&json!({
                "verified": false, "errors": [format!("JSON parse error: {}", e)]
            })).unwrap(),
        };

        match crate::detect_dcp_version(&val) {
            Some("1.0") if policy_json.is_some() => serde_json::to_string(&json!({
                "verified": false, "errors": ["V1 bundles cannot be verified under a verifier policy"]
            })).unwrap(),
            Some("1.0") => {
                let result = verify::verify_signed_bundle(&val, None);
                serde_json::to_string(&result).unwrap_or_else(|_| "{\"verified\":false}".to_string())
            },
            Some("2.0") => {
                let result = crate::v2::verify_bundle::verify_signed_bundle_v2_with_policy(&val, &policy);
                serde_json::to_string(&result).unwrap_or_else(|_| "{\"verified\":false}".to_string())
            },
            _ => serde_json::to_string(&json!({
                "verified": false, "errors": ["Unknown DCP version"]
            })).unwrap(),
        }
    }

    // ── Canonicalization & Domain Separation ───────────────────────────────

    #[wasm_bindgen]
    pub fn wasm_derive_kid(alg: &str, public_key_b64: &str) -> String {
        let pk_bytes = match BASE64.decode(public_key_b64) {
            Ok(b) => b,
            Err(e) => return json_err(&format!("base64 decode: {}", e)),
        };
        crate::v2::crypto_provider::derive_kid(alg, &pk_bytes)
    }

    #[wasm_bindgen]
    pub fn wasm_canonicalize_v2(json_str: &str) -> String {
        let val: Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        match canonicalize_v2(&val) {
            Ok(s) => s,
            Err(e) => json_err(&e),
        }
    }

    #[wasm_bindgen]
    pub fn wasm_domain_separated_message(context: &str, payload_hex: &str) -> String {
        let payload = match hex::decode(payload_hex) {
            Ok(b) => b,
            Err(e) => return json_err(&format!("hex decode: {}", e)),
        };
        match crate::v2::domain_separation::domain_separated_message(context, &payload) {
            Ok(dsm) => hex::encode(dsm),
            Err(e) => json_err(&e),
        }
    }

    // ── Dual Hash ─────────────────────────────────────────────────────────

    /// Compute SHA-256 + SHA3-256 dual hash of a string.
    #[wasm_bindgen]
    pub fn wasm_dual_hash(data: &str) -> String {
        let dh = dual_hash::dual_hash(data.as_bytes());
        serde_json::to_string(&dh).unwrap()
    }

    /// Compute SHA3-256 hash of a string (hex-encoded).
    #[wasm_bindgen]
    pub fn wasm_sha3_256(data: &str) -> String {
        dual_hash::sha3_256_hex(data.as_bytes())
    }

    /// Compute dual Merkle root from an array of dual-hash leaves.
    /// Input: JSON array of {"sha256":"...","sha3_256":"..."} objects.
    #[wasm_bindgen]
    pub fn wasm_dual_merkle_root(leaves_json: &str) -> String {
        let leaves: Vec<dual_hash::DualHash> = match serde_json::from_str(leaves_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        if leaves.is_empty() {
            return json_err("Empty leaves array");
        }

        fn merkle_reduce(hashes: Vec<String>, use_sha3: bool) -> String {
            if hashes.len() == 1 {
                return hashes[0].clone();
            }
            let mut next = Vec::new();
            let mut i = 0;
            while i < hashes.len() {
                if i + 1 < hashes.len() {
                    let combined = format!("{}{}", hashes[i], hashes[i + 1]);
                    if use_sha3 {
                        next.push(dual_hash::sha3_256_hex(combined.as_bytes()));
                    } else {
                        next.push(dual_hash::sha256_hex(combined.as_bytes()));
                    }
                    i += 2;
                } else {
                    next.push(hashes[i].clone());
                    i += 1;
                }
            }
            merkle_reduce(next, use_sha3)
        }

        let sha256_leaves: Vec<String> = leaves.iter().map(|l| l.sha256.clone()).collect();
        let sha3_leaves: Vec<String> = leaves.iter().map(|l| l.sha3_256.clone()).collect();

        let sha256_root = merkle_reduce(sha256_leaves, false);
        let sha3_root = merkle_reduce(sha3_leaves, true);

        serde_json::to_string(&json!({
            "sha256": sha256_root,
            "sha3_256": sha3_root
        })).unwrap()
    }

    // ── Session Nonce ─────────────────────────────────────────────────────

    /// Generate a 256-bit random session nonce (64 hex chars).
    #[wasm_bindgen]
    pub fn wasm_generate_session_nonce() -> String {
        use rand::RngCore;
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        hex::encode(bytes)
    }

    /// Verify session nonce consistency across artifacts.
    /// Input: JSON array of objects, each optionally containing "session_nonce".
    #[wasm_bindgen]
    pub fn wasm_verify_session_binding(artifacts_json: &str) -> String {
        let artifacts: Vec<Value> = match serde_json::from_str(artifacts_json) {
            Ok(v) => v,
            Err(e) => return serde_json::to_string(&json!({
                "valid": false, "error": format!("JSON parse: {}", e)
            })).unwrap(),
        };

        let mut found_nonce: Option<String> = None;
        for art in &artifacts {
            if let Some(nonce) = art.get("session_nonce").and_then(|n| n.as_str()) {
                match &found_nonce {
                    None => found_nonce = Some(nonce.to_string()),
                    Some(expected) => {
                        if nonce != expected {
                            return serde_json::to_string(&json!({
                                "valid": false,
                                "error": "Session nonce mismatch",
                                "expected": expected,
                                "got": nonce
                            })).unwrap();
                        }
                    }
                }
            }
        }

        serde_json::to_string(&json!({
            "valid": true,
            "nonce": found_nonce
        })).unwrap()
    }

    // ── Security Tier ─────────────────────────────────────────────────────

    /// Compute the adaptive security tier (spec §14.2) from an intent and,
    /// optionally, the bundle's policy decision, whose risk_score it reads.
    #[wasm_bindgen]
    pub fn wasm_compute_security_tier(intent_json: &str, policy_decision_json: Option<String>) -> String {
        let intent: Value = match serde_json::from_str(intent_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let policy_decision: Option<Value> = match policy_decision_json.as_deref().map(serde_json::from_str) {
            None => None,
            Some(Ok(v)) => Some(v),
            Some(Err(e)) => return json_err(&format!("JSON parse: {}", e)),
        };

        let tier = crate::v2::security_tier::compute_security_tier(&intent, policy_decision.as_ref());
        serde_json::to_string(&json!({
            "tier": tier.as_str(),
            "verification_mode": crate::v2::security_tier::tier_to_verification_mode(tier),
            "checkpoint_interval": crate::v2::security_tier::tier_to_checkpoint_interval(tier)
        })).unwrap()
    }

    // ── Payload Preparation ───────────────────────────────────────────────

    /// Canonicalize a payload and compute its hash.
    /// Returns { canonical: "...", payload_hash: "sha256:..." }.
    #[wasm_bindgen]
    pub fn wasm_prepare_payload(payload_json: &str) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        match signed_payload::prepare_payload(&val) {
            Ok((canonical_bytes, hash)) => {
                let canonical_str = String::from_utf8_lossy(&canonical_bytes);
                serde_json::to_string(&json!({
                    "canonical": canonical_str,
                    "payload_hash": hash
                })).unwrap()
            },
            Err(e) => json_err(&e),
        }
    }

    // ── Bundle Building & Signing ─────────────────────────────────────────

    /// Build a V2 CitizenshipBundle with manifest from signed artifacts: each
    /// artifact is a SignedPayload from `wasm_sign_payload`.
    #[wasm_bindgen]
    pub fn wasm_build_bundle(
        rpr_json: &str,
        passport_json: &str,
        intent_json: &str,
        policy_json: &str,
        audit_entries_json: &str,
        session_nonce: &str,
    ) -> String {
        let mut signed = Vec::with_capacity(4);
        for (name, artifact_json) in [
            ("RPR", rpr_json), ("Passport", passport_json), ("Intent", intent_json), ("Policy", policy_json),
        ] {
            let sp: Value = match serde_json::from_str(artifact_json) {
                Ok(v) => v, Err(e) => return json_err(&format!("{} parse: {}", name, e)),
            };
            let (Some(payload), Some(sig)) = (sp.get("payload"), sp.get("composite_sig")) else {
                return json_err(&format!("{} must be a SignedPayload from wasm_sign_payload", name));
            };
            let canonical = match canonicalize_v2(payload) {
                Ok(c) => c, Err(e) => return json_err(&format!("{}: {}", name, e)),
            };
            let hash = format!("sha256:{}", dual_hash::dual_hash_canonical(&canonical).sha256);
            signed.push(json!({ "payload": payload, "payload_hash": hash, "composite_sig": sig }));
        }
        let audit_entries: Vec<Value> = match serde_json::from_str(audit_entries_json) {
            Ok(v) => v, Err(e) => return json_err(&format!("Audit entries parse: {}", e)),
        };

        // Compute dual Merkle root over audit entries
        let audit_hashes: Vec<dual_hash::DualHash> = audit_entries.iter()
            .filter_map(|e| canonicalize_v2(e).ok())
            .map(|c| dual_hash::dual_hash_canonical(&c))
            .collect();

        let (audit_merkle_sha256, audit_merkle_sha3) = if audit_hashes.is_empty() {
            ("sha256:".to_string() + &"0".repeat(64), "sha3-256:".to_string() + &"0".repeat(64))
        } else {
            let sha256_leaves: Vec<String> = audit_hashes.iter().map(|h| h.sha256.clone()).collect();
            let sha3_leaves: Vec<String> = audit_hashes.iter().map(|h| h.sha3_256.clone()).collect();
            (
                format!("sha256:{}", crypto::merkle_root_from_hex_leaves(&sha256_leaves).unwrap_or_default()),
                format!("sha3-256:{}", crypto::merkle_root_from_hex_leaves(&sha3_leaves).unwrap_or_default()),
            )
        };

        let manifest = json!({
            "session_nonce": session_nonce,
            "rpr_hash": signed[0]["payload_hash"],
            "passport_hash": signed[1]["payload_hash"],
            "intent_hash": signed[2]["payload_hash"],
            "policy_hash": signed[3]["payload_hash"],
            "audit_merkle_root": audit_merkle_sha256,
            "audit_merkle_root_secondary": audit_merkle_sha3,
            "audit_count": audit_entries.len(),
            "canonicalization_profile": "dcp-jcs-v1"
        });

        let bundle = json!({
            "dcp_bundle_version": "2.0",
            "manifest": manifest,
            "responsible_principal_record": signed[0],
            "agent_passport": signed[1],
            "intent": signed[2],
            "policy_decision": signed[3],
            "audit_entries": audit_entries
        });

        serde_json::to_string(&bundle).unwrap_or_else(|_| json_err("serialize failed"))
    }

    /// Sign a V2 bundle with composite signature (Ed25519 + ML-DSA-65).
    #[wasm_bindgen]
    pub fn wasm_sign_bundle(
        bundle_json: &str,
        classical_sk_b64: &str,
        classical_kid: &str,
        pq_sk_b64: &str,
        pq_kid: &str,
    ) -> String {
        let bundle: Value = match serde_json::from_str(bundle_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("Bundle parse: {}", e)),
        };

        let manifest = match bundle.get("manifest") {
            Some(m) => m,
            None => return json_err("Missing manifest in bundle"),
        };

        let canonical = match canonicalize_v2(manifest) {
            Ok(c) => c,
            Err(e) => return json_err(&e),
        };

        let manifest_hash = {
            let dh = dual_hash::dual_hash_canonical(&canonical);
            format!("sha256:{}", dh.sha256)
        };

        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let classical_key = CompositeKeyInfo {
            kid: classical_kid.to_string(),
            alg: "ed25519".to_string(),
            secret_key_b64: classical_sk_b64.to_string(),
            public_key_b64: String::new(),
        };
        let pq_key = CompositeKeyInfo {
            kid: pq_kid.to_string(),
            alg: "ml-dsa-65".to_string(),
            secret_key_b64: pq_sk_b64.to_string(),
            public_key_b64: String::new(),
        };

        let sig = match composite_sign(
            &ed, &pq,
            crate::v2::domain_separation::CTX_BUNDLE,
            canonical.as_bytes(), &classical_key, &pq_key,
        ) {
            Ok(s) => s,
            Err(e) => return json_err(&e.to_string()),
        };

        let signed_bundle = json!({
            "bundle": bundle,
            "signature": {
                "hash_alg": "sha256",
                "created_at": "",
                "signer": {
                    "type": "human",
                    "kids": [classical_kid, pq_kid]
                },
                "manifest_hash": manifest_hash,
                "composite_sig": sig
            }
        });

        serde_json::to_string(&signed_bundle).unwrap_or_else(|_| json_err("serialize failed"))
    }

    // ── Proof of Possession ───────────────────────────────────────────────

    /// Generate a proof-of-possession for key registration.
    #[wasm_bindgen]
    pub fn wasm_generate_registration_pop(
        challenge_json: &str,
        sk_b64: &str,
        alg: &str,
    ) -> String {
        let challenge: PopChallenge = match serde_json::from_str(challenge_json) {
            Ok(c) => c,
            Err(e) => return json_err(&format!("Challenge parse: {}", e)),
        };
        let provider = match provider_for_alg(alg) {
            Ok(p) => p,
            Err(e) => return json_err(&e),
        };

        match generate_registration_pop(provider.as_ref(), &challenge, sk_b64) {
            Ok(entry) => serde_json::to_string(&entry).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e.to_string()),
        }
    }

    // ── ML-KEM-768 Key Encapsulation ─────────────────────────────────────

    /// Generate an ML-KEM-768 keypair (encapsulation key + decapsulation key).
    #[wasm_bindgen]
    pub fn wasm_ml_kem_768_keygen() -> String {
        use crate::providers::ml_kem_768::MlKem768Provider;
        use crate::v2::crypto_provider::KemProvider;
        let provider = MlKem768Provider;
        match provider.generate_keypair() {
            Ok(kp) => serde_json::to_string(&json!({
                "alg": "ml-kem-768",
                "kid": kp.kid,
                "public_key_b64": kp.public_key_b64,
                "secret_key_b64": kp.secret_key_b64
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Encapsulate a shared secret using an ML-KEM-768 public key.
    /// Returns { shared_secret_hex, ciphertext_b64 }.
    #[wasm_bindgen]
    pub fn wasm_ml_kem_768_encapsulate(public_key_b64: &str) -> String {
        use crate::providers::ml_kem_768::MlKem768Provider;
        use crate::v2::crypto_provider::KemProvider;
        let provider = MlKem768Provider;
        match provider.encapsulate(public_key_b64) {
            Ok((ss, ct)) => serde_json::to_string(&json!({
                "shared_secret_hex": hex::encode(&ss),
                "ciphertext_b64": BASE64.encode(&ct)
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Decapsulate a shared secret from ciphertext using an ML-KEM-768 secret key.
    /// Returns the shared secret as hex.
    #[wasm_bindgen]
    pub fn wasm_ml_kem_768_decapsulate(ciphertext_b64: &str, secret_key_b64: &str) -> String {
        use crate::providers::ml_kem_768::MlKem768Provider;
        use crate::v2::crypto_provider::KemProvider;
        let provider = MlKem768Provider;
        let ct = match BASE64.decode(ciphertext_b64) {
            Ok(b) => b,
            Err(e) => return json_err(&format!("base64 decode: {}", e)),
        };
        match provider.decapsulate(&ct, secret_key_b64) {
            Ok(ss) => hex::encode(ss),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Verify a proof-of-possession for key registration.
    #[wasm_bindgen]
    pub fn wasm_verify_registration_pop(
        challenge_json: &str,
        pop_json: &str,
        pk_b64: &str,
        alg: &str,
    ) -> String {
        let challenge: PopChallenge = match serde_json::from_str(challenge_json) {
            Ok(c) => c,
            Err(e) => return json_err(&format!("Challenge parse: {}", e)),
        };
        let pop: SignatureEntry = match serde_json::from_str(pop_json) {
            Ok(p) => p,
            Err(e) => return json_err(&format!("PoP parse: {}", e)),
        };
        let provider = match provider_for_alg(alg) {
            Ok(p) => p,
            Err(e) => return json_err(&e),
        };

        match verify_registration_pop(provider.as_ref(), &challenge, &pop, pk_b64) {
            Ok(valid) => serde_json::to_string(&json!({ "valid": valid })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }
}
