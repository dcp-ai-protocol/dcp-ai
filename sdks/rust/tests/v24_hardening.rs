//! v2.4 production hardening tests — Rust.

use serde_json::json;

use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::composite_ops::CompositeKeyInfo;
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::emergency_revocation::{
    build_emergency_revocation, generate_emergency_revocation_token,
    verify_emergency_revocation_secret,
};
use dcp_ai::v2::pq_checkpoint::{
    audit_events_merkle_root, create_pq_checkpoint, PQCheckpointManager,
};
use dcp_ai::v2::security_tier::{
    compute_security_tier, max_tier, tier_to_checkpoint_interval, tier_to_verification_mode,
    SecurityTier,
};
use dcp_ai::v2::session_nonce::{
    generate_session_expiry, generate_session_nonce, is_session_expired, is_valid_session_nonce,
    verify_session_binding,
};

fn make_keys() -> (Ed25519Provider, MlDsa65Provider, CompositeKeyInfo, CompositeKeyInfo) {
    let ed = Ed25519Provider;
    let pq = MlDsa65Provider;
    let ed_kp = ed.generate_keypair().unwrap();
    let pq_kp = pq.generate_keypair().unwrap();
    (
        ed,
        pq,
        CompositeKeyInfo {
            kid: ed_kp.kid,
            alg: "ed25519".into(),
            secret_key_b64: ed_kp.secret_key_b64,
            public_key_b64: ed_kp.public_key_b64,
        },
        CompositeKeyInfo {
            kid: pq_kp.kid,
            alg: "ml-dsa-65".into(),
            secret_key_b64: pq_kp.secret_key_b64,
            public_key_b64: pq_kp.public_key_b64,
        },
    )
}

#[test]
fn session_nonce_generator_is_lowercase_hex() {
    let n = generate_session_nonce();
    assert_eq!(n.len(), 64);
    assert!(n.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
}

#[test]
fn session_nonce_validator() {
    assert!(is_valid_session_nonce(&"a".repeat(64)));
    assert!(!is_valid_session_nonce(&"A".repeat(64)));
    assert!(!is_valid_session_nonce(&"a".repeat(63)));
}

#[test]
fn session_binding_matches_when_equal_mismatches_otherwise() {
    let ok = verify_session_binding(&[
        json!({"session_nonce": "a".repeat(64)}),
        json!({"session_nonce": "a".repeat(64)}),
    ]);
    assert!(ok.valid);
    let bad = verify_session_binding(&[
        json!({"session_nonce": "a".repeat(64)}),
        json!({"session_nonce": "b".repeat(64)}),
    ]);
    assert!(!bad.valid);
    let empty = verify_session_binding(&[]);
    assert!(!empty.valid);
}

#[test]
fn session_expiry_past_is_expired() {
    let past = generate_session_expiry(Some(-1), None);
    assert!(is_session_expired(&past));
}

#[test]
fn tier_routing_thresholds() {
    assert_eq!(compute_security_tier(&json!({})), SecurityTier::Routine);
    assert_eq!(
        compute_security_tier(&json!({"risk_score": 200})),
        SecurityTier::Standard
    );
    assert_eq!(
        compute_security_tier(&json!({"data_classes": ["pii"]})),
        SecurityTier::Elevated
    );
    assert_eq!(
        compute_security_tier(&json!({"action_type": "initiate_payment"})),
        SecurityTier::Elevated
    );
    assert_eq!(
        compute_security_tier(&json!({"data_classes": ["credentials"]})),
        SecurityTier::Maximum
    );
    assert_eq!(
        compute_security_tier(&json!({"risk_score": 800})),
        SecurityTier::Maximum
    );
}

#[test]
fn tier_helpers() {
    assert_eq!(max_tier(SecurityTier::Routine, SecurityTier::Maximum), SecurityTier::Maximum);
    assert_eq!(max_tier(SecurityTier::Elevated, SecurityTier::Standard), SecurityTier::Elevated);
    assert_eq!(tier_to_verification_mode(SecurityTier::Maximum), "hybrid_required");
    assert_eq!(tier_to_verification_mode(SecurityTier::Routine), "classical_only");
    assert_eq!(tier_to_checkpoint_interval(SecurityTier::Routine), 50);
    assert_eq!(tier_to_checkpoint_interval(SecurityTier::Maximum), 1);
}

#[test]
fn emergency_revocation_round_trip() {
    let pair = generate_emergency_revocation_token();
    assert!(pair.emergency_revocation_token.starts_with("sha256:"));
    assert_eq!(pair.revocation_secret.len(), 64);
    assert!(verify_emergency_revocation_secret(
        &pair.revocation_secret,
        &pair.emergency_revocation_token
    ));
    assert!(!verify_emergency_revocation_secret(
        &"f".repeat(64),
        &pair.emergency_revocation_token
    ));
    assert!(!verify_emergency_revocation_secret(&pair.revocation_secret, "md5:0"));
    assert!(!verify_emergency_revocation_secret("ab", &pair.emergency_revocation_token));

    let req = build_emergency_revocation("agent_X", "human_1", &pair.revocation_secret);
    assert_eq!(req["type"], "emergency_revocation");
    assert_eq!(req["reason"], "key_compromise_emergency");
}

#[test]
fn pq_checkpoint_merkle_and_create() {
    let events: Vec<_> = (1..=5)
        .map(|i| json!({"audit_id": format!("evt_{:03}", i), "session_nonce": "a".repeat(64), "seq": i}))
        .collect();
    let root1 = audit_events_merkle_root(&events).unwrap();
    let root2 = audit_events_merkle_root(&events).unwrap();
    assert_eq!(root1, root2);
    assert_eq!(root1.len(), 64);

    let (ed, pq, ck, pqk) = make_keys();
    let ckpt = create_pq_checkpoint(&ed, &pq, &ck, &pqk, &events, &"a".repeat(64)).unwrap();
    assert_eq!(ckpt["event_range"]["count"], 5);
    let mr = ckpt["merkle_root"].as_str().unwrap();
    assert!(mr.starts_with("sha256:"));
    assert_eq!(ckpt["composite_sig"]["binding"], "pq_over_classical");
}

#[test]
fn pq_checkpoint_manager_interval_flush() {
    let (ed, pq, ck, pqk) = make_keys();
    let mut mgr = PQCheckpointManager::new(3, "a".repeat(64)).unwrap();
    assert_eq!(mgr.interval(), 3);
    for i in 1..=2 {
        let got = mgr
            .record_event(&ed, &pq, &ck, &pqk, json!({"audit_id": format!("evt_{:03}", i)}))
            .unwrap();
        assert!(got.is_none());
    }
    let got = mgr
        .record_event(&ed, &pq, &ck, &pqk, json!({"audit_id": "evt_003"}))
        .unwrap();
    assert!(got.is_some());
    assert_eq!(got.unwrap()["event_range"]["count"], 3);
    assert_eq!(mgr.pending_count(), 0);
    // second manual batch
    for i in 4..=5 {
        let _ = mgr
            .record_event(&ed, &pq, &ck, &pqk, json!({"audit_id": format!("evt_{:03}", i)}))
            .unwrap();
    }
    let got = mgr.flush(&ed, &pq, &ck, &pqk).unwrap();
    assert!(got.is_some());
    assert_eq!(got.unwrap()["event_range"]["count"], 2);
    assert_eq!(mgr.checkpoints().len(), 2);
}

#[test]
fn pq_checkpoint_manager_tier_derives_interval() {
    let mut mgr = PQCheckpointManager::with_tier(SecurityTier::Routine, "a".repeat(64));
    assert_eq!(mgr.interval(), 50);
    mgr.set_tier(SecurityTier::Maximum);
    assert_eq!(mgr.interval(), 1);
}
