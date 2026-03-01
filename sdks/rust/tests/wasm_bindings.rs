#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;
use dcp_ai::wasm::*;

wasm_bindgen_test_configure!(run_in_browser);

// ── Keypair Generation ──────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_ed25519_keygen() {
    let result = wasm_generate_keypair();
    let kp: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(kp["alg"], "ed25519");
    assert!(!kp["public_key_b64"].as_str().unwrap().is_empty());
    assert!(!kp["secret_key_b64"].as_str().unwrap().is_empty());
}

#[wasm_bindgen_test]
fn test_ml_dsa_65_keygen() {
    let result = wasm_generate_ml_dsa_65_keypair();
    let kp: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(kp["alg"], "ml-dsa-65");
    assert!(!kp["kid"].as_str().unwrap().is_empty());
}

#[wasm_bindgen_test]
fn test_slh_dsa_192f_keygen() {
    let result = wasm_generate_slh_dsa_192f_keypair();
    let kp: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(kp["alg"], "slh-dsa-192f");
    assert!(!kp["kid"].as_str().unwrap().is_empty());
}

#[wasm_bindgen_test]
fn test_hybrid_keygen() {
    let result = wasm_generate_hybrid_keypair();
    let kp: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(kp["classical"]["alg"], "ed25519");
    assert_eq!(kp["pq"]["alg"], "ml-dsa-65");
    assert!(!kp["classical"]["public_key_b64"].as_str().unwrap().is_empty());
    assert!(!kp["pq"]["public_key_b64"].as_str().unwrap().is_empty());
}

// ── Composite Sign/Verify Round Trip ─────────────────────────────────────

#[wasm_bindgen_test]
fn test_composite_sign_verify() {
    let hybrid = wasm_generate_hybrid_keypair();
    let kp: serde_json::Value = serde_json::from_str(&hybrid).unwrap();

    let classical_sk = kp["classical"]["secret_key_b64"].as_str().unwrap();
    let classical_kid = kp["classical"]["kid"].as_str().unwrap();
    let classical_pk = kp["classical"]["public_key_b64"].as_str().unwrap();
    let pq_sk = kp["pq"]["secret_key_b64"].as_str().unwrap();
    let pq_kid = kp["pq"]["kid"].as_str().unwrap();
    let pq_pk = kp["pq"]["public_key_b64"].as_str().unwrap();

    let payload = r#"{"action":"test","value":42}"#;
    let sig_json = wasm_composite_sign(
        "DCP-AI.v2.Intent", payload,
        classical_sk, classical_kid, pq_sk, pq_kid,
    );
    let sig: serde_json::Value = serde_json::from_str(&sig_json).unwrap();
    assert_eq!(sig["binding"], "pq_over_classical");

    let verify_result = wasm_composite_verify(
        "DCP-AI.v2.Intent", payload, &sig_json,
        classical_pk, Some(pq_pk.to_string()),
    );
    let vr: serde_json::Value = serde_json::from_str(&verify_result).unwrap();
    assert!(vr["valid"].as_bool().unwrap());
    assert!(vr["classical_valid"].as_bool().unwrap());
    assert!(vr["pq_valid"].as_bool().unwrap());
}

#[wasm_bindgen_test]
fn test_classical_only_sign_verify() {
    let kp_json = wasm_generate_keypair();
    let kp: serde_json::Value = serde_json::from_str(&kp_json).unwrap();
    let sk = kp["secret_key_b64"].as_str().unwrap();
    let pk = kp["public_key_b64"].as_str().unwrap();
    let kid = wasm_derive_kid("ed25519", pk);

    let payload = r#"{"action":"read"}"#;
    let sig_json = wasm_classical_only_sign("DCP-AI.v2.Intent", payload, sk, &kid);
    let sig: serde_json::Value = serde_json::from_str(&sig_json).unwrap();
    assert_eq!(sig["binding"], "classical_only");

    let verify_result = wasm_composite_verify(
        "DCP-AI.v2.Intent", payload, &sig_json, pk, None,
    );
    let vr: serde_json::Value = serde_json::from_str(&verify_result).unwrap();
    assert!(vr["valid"].as_bool().unwrap());
}

// ── Dual Hash ────────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_dual_hash() {
    let result = wasm_dual_hash("hello");
    let dh: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(dh["sha256"].as_str().unwrap().len(), 64);
    assert_eq!(dh["sha3_256"].as_str().unwrap().len(), 64);
    assert_ne!(dh["sha256"], dh["sha3_256"]);
}

#[wasm_bindgen_test]
fn test_sha3_256() {
    let hash = wasm_sha3_256("hello");
    assert_eq!(hash.len(), 64);
}

// ── Session Nonce ────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_session_nonce() {
    let nonce1 = wasm_generate_session_nonce();
    let nonce2 = wasm_generate_session_nonce();
    assert_eq!(nonce1.len(), 64);
    assert_ne!(nonce1, nonce2);
}

#[wasm_bindgen_test]
fn test_session_binding_valid() {
    let artifacts = r#"[{"session_nonce":"abc"},{"session_nonce":"abc"}]"#;
    let result = wasm_verify_session_binding(artifacts);
    let r: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(r["valid"].as_bool().unwrap());
}

#[wasm_bindgen_test]
fn test_session_binding_invalid() {
    let artifacts = r#"[{"session_nonce":"abc"},{"session_nonce":"xyz"}]"#;
    let result = wasm_verify_session_binding(artifacts);
    let r: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(!r["valid"].as_bool().unwrap());
}

// ── Security Tier ────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_security_tier_routine() {
    let intent = r#"{"risk_score":50,"data_classes":[],"action_type":"read"}"#;
    let result = wasm_compute_security_tier(intent);
    let r: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(r["tier"], "routine");
}

#[wasm_bindgen_test]
fn test_security_tier_maximum() {
    let intent = r#"{"risk_score":900,"data_classes":["credentials"],"action_type":"admin"}"#;
    let result = wasm_compute_security_tier(intent);
    let r: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(r["tier"], "maximum");
}

// ── Prepare Payload ──────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_prepare_payload() {
    let payload = r#"{"action":"test","value":42}"#;
    let result = wasm_prepare_payload(payload);
    let r: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(r["payload_hash"].as_str().unwrap().starts_with("sha256:"));
    assert!(!r["canonical"].as_str().unwrap().is_empty());
}

// ── Canonicalization ─────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_canonicalize_deterministic() {
    let a = wasm_canonicalize_v2(r#"{"b":2,"a":1}"#);
    let b = wasm_canonicalize_v2(r#"{"a":1,"b":2}"#);
    assert_eq!(a, b);
}

// ── ML-KEM-768 ───────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_ml_kem_768_round_trip() {
    let kp_json = wasm_ml_kem_768_keygen();
    let kp: serde_json::Value = serde_json::from_str(&kp_json).unwrap();
    assert_eq!(kp["alg"], "ml-kem-768");

    let pk = kp["public_key_b64"].as_str().unwrap();
    let sk = kp["secret_key_b64"].as_str().unwrap();

    let encaps_json = wasm_ml_kem_768_encapsulate(pk);
    let enc: serde_json::Value = serde_json::from_str(&encaps_json).unwrap();
    let ct = enc["ciphertext_b64"].as_str().unwrap();
    let ss_enc = enc["shared_secret_hex"].as_str().unwrap();

    let ss_dec = wasm_ml_kem_768_decapsulate(ct, sk);
    assert_eq!(ss_enc, ss_dec);
    assert_eq!(ss_dec.len(), 64);
}

// ── Proof of Possession ──────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_pop_ed25519_round_trip() {
    let kp_json = wasm_generate_keypair();
    let kp: serde_json::Value = serde_json::from_str(&kp_json).unwrap();
    let pk = kp["public_key_b64"].as_str().unwrap();
    let sk = kp["secret_key_b64"].as_str().unwrap();
    let kid = wasm_derive_kid("ed25519", pk);

    let challenge = format!(
        r#"{{"kid":"{}","agent_id":"agent-test","timestamp":"2026-02-28T00:00:00Z","nonce":"deadbeef"}}"#,
        kid
    );

    let pop_json = wasm_generate_registration_pop(&challenge, sk, "ed25519");
    let pop: serde_json::Value = serde_json::from_str(&pop_json).unwrap();
    assert_eq!(pop["alg"], "ed25519");

    let verify_json = wasm_verify_registration_pop(&challenge, &pop_json, pk, "ed25519");
    let vr: serde_json::Value = serde_json::from_str(&verify_json).unwrap();
    assert!(vr["valid"].as_bool().unwrap());
}

// ── Version Detection ────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn test_detect_version_v2() {
    let result = wasm_detect_version(r#"{"dcp_version":"2.0"}"#);
    assert_eq!(result, "\"2.0\"");
}

#[wasm_bindgen_test]
fn test_detect_version_unknown() {
    let result = wasm_detect_version(r#"{"foo":"bar"}"#);
    assert_eq!(result, "null");
}
