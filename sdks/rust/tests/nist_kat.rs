//! NIST KAT (Known Answer Test) Compliance Tests (Rust SDK)
//!
//! Ed25519: RFC 8032 deterministic test vectors.
//! ML-DSA-65: FIPS 204 property-based compliance.
//!
//! Phase 1 gate: no SDK ships V2 without passing all KAT tests.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey, Signature};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::crypto_provider::{derive_kid, CryptoProvider};
use dcp_ai::v2::domain_separation::domain_separated_message;

fn kat_path(algo: &str) -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent().unwrap()
        .parent().unwrap()
        .join("tests")
        .join("nist-kat")
        .join(algo)
        .join("vectors.json")
}

fn interop_path() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent().unwrap()
        .parent().unwrap()
        .join("tests")
        .join("interop")
        .join("v2")
        .join("interop_vectors.json")
}

fn hex_to_bytes(hex: &str) -> Vec<u8> {
    hex::decode(hex).expect("valid hex")
}

// ---------------------------------------------------------------------------
// Ed25519 RFC 8032 KAT
// ---------------------------------------------------------------------------

#[test]
fn ed25519_rfc8032_sign_and_verify() {
    let data = fs::read_to_string(kat_path("ed25519")).expect("read KAT");
    let kat: Value = serde_json::from_str(&data).expect("parse KAT");

    for vec in kat["test_vectors"].as_array().unwrap() {
        let name = vec["name"].as_str().unwrap();
        let sk_bytes = hex_to_bytes(vec["secret_key_hex"].as_str().unwrap());
        let pk_bytes = hex_to_bytes(vec["public_key_hex"].as_str().unwrap());
        let msg = hex_to_bytes(vec["message_hex"].as_str().unwrap());
        let expected_sig = hex_to_bytes(vec["signature_hex"].as_str().unwrap());

        let sk_array: [u8; 32] = sk_bytes[..32].try_into().unwrap();
        let signing_key = SigningKey::from_bytes(&sk_array);

        // Verify public key derivation
        let derived_pk = signing_key.verifying_key();
        assert_eq!(derived_pk.to_bytes().as_slice(), &pk_bytes, "{}: pk mismatch", name);

        // Sign and compare
        let sig = signing_key.sign(&msg);
        assert_eq!(sig.to_bytes().as_slice(), &expected_sig, "{}: sig mismatch", name);

        // Verify
        let pk_array: [u8; 32] = pk_bytes[..32].try_into().unwrap();
        let verifying_key = VerifyingKey::from_bytes(&pk_array).unwrap();
        let sig_obj = Signature::from_bytes(&expected_sig[..64].try_into().unwrap());
        assert!(verifying_key.verify(&msg, &sig_obj).is_ok(), "{}: verify failed", name);
    }
}

#[test]
fn ed25519_rfc8032_tampered_fails() {
    let data = fs::read_to_string(kat_path("ed25519")).expect("read KAT");
    let kat: Value = serde_json::from_str(&data).expect("parse KAT");

    for vec in kat["test_vectors"].as_array().unwrap() {
        let pk_bytes = hex_to_bytes(vec["public_key_hex"].as_str().unwrap());
        let msg = hex_to_bytes(vec["message_hex"].as_str().unwrap());
        let mut sig_bytes = hex_to_bytes(vec["signature_hex"].as_str().unwrap());
        sig_bytes[0] ^= 0xFF;

        let pk_array: [u8; 32] = pk_bytes[..32].try_into().unwrap();
        let verifying_key = VerifyingKey::from_bytes(&pk_array).unwrap();
        let sig = Signature::from_bytes(&sig_bytes[..64].try_into().unwrap());
        assert!(verifying_key.verify(&msg, &sig).is_err(), "tampered sig should fail");
    }
}

// ---------------------------------------------------------------------------
// Ed25519 Provider KAT
// ---------------------------------------------------------------------------

#[test]
fn ed25519_provider_sizes() {
    let p = Ed25519Provider;
    assert_eq!(p.key_size(), 32);
    assert_eq!(p.sig_size(), 64);
}

#[test]
fn ed25519_provider_kid_deterministic() {
    let p = Ed25519Provider;
    let kp = p.generate_keypair().unwrap();
    let pk_bytes = BASE64.decode(&kp.public_key_b64).unwrap();
    assert_eq!(derive_kid("ed25519", &pk_bytes), kp.kid);
    assert_eq!(kp.kid.len(), 32);
}

#[test]
fn ed25519_provider_roundtrip() {
    let p = Ed25519Provider;
    let kp = p.generate_keypair().unwrap();
    let msg = b"KAT round-trip";
    let sig = p.sign(msg, &kp.secret_key_b64).unwrap();
    assert_eq!(sig.len(), 64);
    assert!(p.verify(msg, &sig, &kp.public_key_b64).unwrap());
}

#[test]
fn ed25519_provider_wrong_key() {
    let p = Ed25519Provider;
    let kp1 = p.generate_keypair().unwrap();
    let kp2 = p.generate_keypair().unwrap();
    let sig = p.sign(b"test", &kp1.secret_key_b64).unwrap();
    assert!(!p.verify(b"test", &sig, &kp2.public_key_b64).unwrap());
}

// ---------------------------------------------------------------------------
// ML-DSA-65 FIPS 204 Property-Based KAT
// ---------------------------------------------------------------------------

#[test]
fn ml_dsa_65_sizes() {
    let p = MlDsa65Provider;
    assert_eq!(p.alg(), "ml-dsa-65");
    assert_eq!(p.key_size(), 1952);
    assert_eq!(p.sig_size(), 3309);
}

#[test]
fn ml_dsa_65_generated_pk_size() {
    let p = MlDsa65Provider;
    let kp = p.generate_keypair().unwrap();
    let pk_bytes = BASE64.decode(&kp.public_key_b64).unwrap();
    assert_eq!(pk_bytes.len(), 1952);
}

#[test]
fn ml_dsa_65_kid_deterministic() {
    let p = MlDsa65Provider;
    let kp = p.generate_keypair().unwrap();
    let pk_bytes = BASE64.decode(&kp.public_key_b64).unwrap();
    assert_eq!(derive_kid("ml-dsa-65", &pk_bytes), kp.kid);
    assert_eq!(kp.kid.len(), 32);
}

#[test]
fn ml_dsa_65_roundtrip() {
    let p = MlDsa65Provider;
    let kp = p.generate_keypair().unwrap();
    let msg = b"ML-DSA-65 KAT round-trip";
    let sig = p.sign(msg, &kp.secret_key_b64).unwrap();
    assert!(sig.len() > 0);
    assert!(p.verify(msg, &sig, &kp.public_key_b64).unwrap());
}

#[test]
fn ml_dsa_65_wrong_key() {
    let p = MlDsa65Provider;
    let kp1 = p.generate_keypair().unwrap();
    let kp2 = p.generate_keypair().unwrap();
    let sig = p.sign(b"test", &kp1.secret_key_b64).unwrap();
    assert!(!p.verify(b"test", &sig, &kp2.public_key_b64).unwrap());
}

#[test]
fn ml_dsa_65_wrong_message() {
    let p = MlDsa65Provider;
    let kp = p.generate_keypair().unwrap();
    let sig = p.sign(b"A", &kp.secret_key_b64).unwrap();
    assert!(!p.verify(b"B", &sig, &kp.public_key_b64).unwrap());
}

#[test]
fn ml_dsa_65_cross_sdk_verify() {
    let data = fs::read_to_string(interop_path()).expect("read interop vectors");
    let v: Value = serde_json::from_str(&data).expect("parse interop");
    let entry = &v["composite_signatures"]["passport_composite"];
    let context = entry["context"].as_str().unwrap();
    let payload_key = entry["payload_key"].as_str().unwrap();
    let canonical = v["canonicalization"][payload_key]["expected_canonical"]
        .as_str()
        .unwrap();

    let dsm = domain_separated_message(context, canonical.as_bytes()).unwrap();
    let classical_sig = BASE64
        .decode(entry["composite_sig"]["classical"]["sig_b64"].as_str().unwrap())
        .unwrap();
    let mut composite_msg = Vec::with_capacity(dsm.len() + classical_sig.len());
    composite_msg.extend_from_slice(&dsm);
    composite_msg.extend_from_slice(&classical_sig);

    let pq_sig = BASE64
        .decode(entry["composite_sig"]["pq"]["sig_b64"].as_str().unwrap())
        .unwrap();
    let pq_pk = v["test_keys"]["ml_dsa_65"]["public_key_b64"].as_str().unwrap();

    let ml = MlDsa65Provider;
    let valid = ml.verify(&composite_msg, &pq_sig, pq_pk).unwrap();
    assert!(valid, "Cross-SDK ML-DSA-65 verification failed");
}
