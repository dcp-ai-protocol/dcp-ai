//! DCP-AI v2.0 Composite Signature Tests (Rust)
//!
//! Tests composite-bound hybrid signatures, proof-of-possession,
//! and key rotation using Ed25519 provider.

use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::v2::composite_ops::{
    classical_only_sign, composite_verify, CompositeKeyInfo,
};
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::domain_separation::{CTX_AGENT_PASSPORT, CTX_AUDIT_EVENT, CTX_INTENT};
use dcp_ai::v2::proof_of_possession::{
    create_key_rotation, generate_registration_pop, verify_key_rotation,
    verify_registration_pop, PopChallenge,
};

// ---------------------------------------------------------------------------
// Classical-Only Composite Signature
// ---------------------------------------------------------------------------

#[test]
fn classical_only_sign_verify_round_trip() {
    let ed = Ed25519Provider;
    let kp = ed.generate_keypair().unwrap();
    let key = CompositeKeyInfo {
        kid: kp.kid.clone(),
        alg: "ed25519".into(),
        secret_key_b64: kp.secret_key_b64.clone(),
        public_key_b64: kp.public_key_b64.clone(),
    };
    let payload = b"test classical-only payload";

    let sig = classical_only_sign(&ed, CTX_AGENT_PASSPORT, payload, &key).unwrap();
    assert_eq!(sig.binding, "classical_only");
    assert!(sig.pq.is_none());

    let result = composite_verify(
        &ed,
        None,
        CTX_AGENT_PASSPORT,
        payload,
        &sig,
        &kp.public_key_b64,
        None,
    )
    .unwrap();

    assert!(result.valid);
    assert!(result.classical_valid);
    assert!(!result.pq_valid);
}

#[test]
fn classical_only_wrong_key_fails() {
    let ed = Ed25519Provider;
    let kp1 = ed.generate_keypair().unwrap();
    let kp2 = ed.generate_keypair().unwrap();
    let key = CompositeKeyInfo {
        kid: kp1.kid.clone(),
        alg: "ed25519".into(),
        secret_key_b64: kp1.secret_key_b64.clone(),
        public_key_b64: kp1.public_key_b64.clone(),
    };
    let payload = b"test wrong key";

    let sig = classical_only_sign(&ed, CTX_INTENT, payload, &key).unwrap();

    let result = composite_verify(
        &ed,
        None,
        CTX_INTENT,
        payload,
        &sig,
        &kp2.public_key_b64,
        None,
    )
    .unwrap();

    assert!(!result.valid);
}

// ---------------------------------------------------------------------------
// Domain Separation
// ---------------------------------------------------------------------------

#[test]
fn domain_separation_prevents_replay() {
    let ed = Ed25519Provider;
    let kp = ed.generate_keypair().unwrap();
    let key = CompositeKeyInfo {
        kid: kp.kid.clone(),
        alg: "ed25519".into(),
        secret_key_b64: kp.secret_key_b64.clone(),
        public_key_b64: kp.public_key_b64.clone(),
    };
    let payload = b"shared payload";

    let sig = classical_only_sign(&ed, CTX_INTENT, payload, &key).unwrap();

    let result = composite_verify(
        &ed,
        None,
        CTX_AUDIT_EVENT,
        payload,
        &sig,
        &kp.public_key_b64,
        None,
    )
    .unwrap();

    assert!(!result.valid, "cross-context replay should fail");
}

// ---------------------------------------------------------------------------
// Proof of Possession
// ---------------------------------------------------------------------------

#[test]
fn registration_pop_round_trip() {
    let ed = Ed25519Provider;
    let kp = ed.generate_keypair().unwrap();
    let challenge = PopChallenge {
        kid: kp.kid.clone(),
        agent_id: "agent-test".into(),
        timestamp: "2026-02-25T00:00:00Z".into(),
        nonce: "deadbeef".into(),
    };

    let pop = generate_registration_pop(&ed, &challenge, &kp.secret_key_b64).unwrap();
    assert_eq!(pop.alg, "ed25519");
    assert_eq!(pop.kid, kp.kid);

    let valid = verify_registration_pop(&ed, &challenge, &pop, &kp.public_key_b64).unwrap();
    assert!(valid);
}

#[test]
fn registration_pop_wrong_key_fails() {
    let ed = Ed25519Provider;
    let kp1 = ed.generate_keypair().unwrap();
    let kp2 = ed.generate_keypair().unwrap();
    let challenge = PopChallenge {
        kid: kp1.kid.clone(),
        agent_id: "agent-test".into(),
        timestamp: "2026-02-25T00:00:00Z".into(),
        nonce: "abc123".into(),
    };

    let pop = generate_registration_pop(&ed, &challenge, &kp1.secret_key_b64).unwrap();
    let valid = verify_registration_pop(&ed, &challenge, &pop, &kp2.public_key_b64).unwrap();
    assert!(!valid);
}

// ---------------------------------------------------------------------------
// Key Rotation
// ---------------------------------------------------------------------------

#[test]
fn key_rotation_round_trip() {
    let ed = Ed25519Provider;
    let old_kp = ed.generate_keypair().unwrap();
    let new_kp = ed.generate_keypair().unwrap();

    let record = create_key_rotation(
        &ed,
        &ed,
        &old_kp.kid,
        &old_kp.secret_key_b64,
        &new_kp.kid,
        &new_kp.secret_key_b64,
        &new_kp.public_key_b64,
        "ed25519",
        "2026-06-01T00:00:00Z",
        None,
    )
    .unwrap();

    assert_eq!(record.record_type, "key_rotation");
    assert_eq!(record.old_kid, old_kp.kid);
    assert_eq!(record.new_kid, new_kp.kid);

    let (valid, pop_valid, auth_valid) = verify_key_rotation(
        &ed,
        &ed,
        &record,
        &old_kp.public_key_b64,
        &new_kp.public_key_b64,
    )
    .unwrap();

    assert!(valid);
    assert!(pop_valid);
    assert!(auth_valid);
}

#[test]
fn key_rotation_wrong_old_key_fails() {
    let ed = Ed25519Provider;
    let old_kp = ed.generate_keypair().unwrap();
    let new_kp = ed.generate_keypair().unwrap();
    let wrong_kp = ed.generate_keypair().unwrap();

    let record = create_key_rotation(
        &ed,
        &ed,
        &old_kp.kid,
        &old_kp.secret_key_b64,
        &new_kp.kid,
        &new_kp.secret_key_b64,
        &new_kp.public_key_b64,
        "ed25519",
        "2026-06-01T00:00:00Z",
        None,
    )
    .unwrap();

    let (valid, _, auth_valid) = verify_key_rotation(
        &ed,
        &ed,
        &record,
        &wrong_kp.public_key_b64,
        &new_kp.public_key_b64,
    )
    .unwrap();

    assert!(!valid);
    assert!(!auth_valid);
}
