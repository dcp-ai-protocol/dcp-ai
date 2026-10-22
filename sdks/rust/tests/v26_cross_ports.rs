//! v2.6 cross-ports: advisory + blinded RPR + multi-party auth (Rust).

use serde_json::json;

use dcp_ai::v2::advisory::{
    apply_advisories_to_policy, build_algorithm_advisory, check_advisory, evaluate_advisories,
};
use dcp_ai::v2::blinded_rpr::{
    blind_rpr, compute_pii_hash, generate_pii_salt, is_blinded_rpr, verify_blinded_rpr,
};
use dcp_ai::v2::multi_party_auth::{
    verify_multi_party_authorization, MultiPartyPolicy,
};

#[test]
fn advisory_grace_expired_flags() {
    let adv = build_algorithm_advisory(
        "adv_001",
        "medium",
        vec!["ed25519".into()],
        "deprecate",
        "2020-01-01T00:00:00Z", // long in the past
        "test advisory",
        "issuer_X",
    );
    let result = check_advisory(&adv, None);
    assert!(result.grace_period_expired);
    assert_eq!(result.affected_algorithms, vec!["ed25519"]);
}

#[test]
fn advisory_evaluation_routes() {
    let adv_deprecate = build_algorithm_advisory(
        "adv_001",
        "medium",
        vec!["ed25519".into()],
        "deprecate",
        "2020-01-01T00:00:00Z",
        "",
        "i",
    );
    let adv_warn = build_algorithm_advisory(
        "adv_002",
        "low",
        vec!["ml-dsa-65".into()],
        "warn",
        "2020-01-01T00:00:00Z",
        "",
        "i",
    );
    let adv_revoke = build_algorithm_advisory(
        "adv_003",
        "critical",
        vec!["md5".into()],
        "revoke",
        "2020-01-01T00:00:00Z",
        "",
        "i",
    );
    let eval = evaluate_advisories(&[adv_deprecate, adv_warn, adv_revoke], None);
    assert!(eval.deprecated.contains("ed25519"));
    assert!(eval.warned.contains("ml-dsa-65"));
    assert!(eval.revoked.contains("md5"));
    assert_eq!(eval.active_advisories.len(), 3);
}

#[test]
fn advisory_evaluation_skips_future() {
    let adv = build_algorithm_advisory(
        "adv_fut",
        "medium",
        vec!["X".into()],
        "deprecate",
        "2099-01-01T00:00:00Z",
        "",
        "i",
    );
    let eval = evaluate_advisories(&[adv], None);
    assert!(eval.deprecated.is_empty());
    assert!(eval.active_advisories.is_empty());
}

#[test]
fn apply_advisories_filters_and_warns() {
    let adv_deprecate = build_algorithm_advisory(
        "adv_001",
        "medium",
        vec!["ed25519".into()],
        "deprecate",
        "2020-01-01T00:00:00Z",
        "",
        "i",
    );
    let adv_warn = build_algorithm_advisory(
        "adv_002",
        "low",
        vec!["ml-dsa-65".into()],
        "warn",
        "2020-01-01T00:00:00Z",
        "",
        "i",
    );
    let eval = evaluate_advisories(&[adv_deprecate, adv_warn], None);
    let result = apply_advisories_to_policy(
        &vec!["ed25519".into(), "ml-dsa-65".into(), "slh-dsa-192f".into()],
        &eval,
    );
    assert_eq!(result.removed_algs, vec!["ed25519"]);
    assert_eq!(
        result.filtered_algs,
        vec!["ml-dsa-65".to_string(), "slh-dsa-192f".to_string()]
    );
    assert!(result.warnings.iter().any(|w| w.contains("ml-dsa-65")));
}

// ── Blinded RPR ──

fn sample_rpr() -> serde_json::Value {
    json!({
        "dcp_version": "2.0",
        "human_id": "human_1",
        "session_nonce": "a".repeat(64),
        "contact": "dan@example.com",
        "legal_name": "Dan Example",
        "entity_type": "individual",
        "jurisdiction": "US-CA",
        "liability_mode": "direct",
        "override_rights": ["revoke"],
        "issued_at": "2026-04-01T00:00:00Z",
        "expires_at": "2027-04-01T00:00:00Z",
        "binding_keys": [],
        "pii_salt": "c".repeat(64),
    })
}

#[test]
fn generate_pii_salt_is_32_random_bytes_as_hex() {
    let salt = generate_pii_salt();
    assert_eq!(salt.len(), 64);
    assert!(
        salt.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
        "{salt}"
    );
    assert_ne!(generate_pii_salt(), salt);
}

#[test]
fn blind_rpr_requires_pii_salt() {
    for salt in [
        json!(null),
        json!(""),
        json!("ab"),
        json!("A".repeat(64)),
        json!("g".repeat(64)),
        json!("a".repeat(66)),
        json!(format!("{}\n", "a".repeat(64))),
        json!(42),
    ] {
        let mut full = sample_rpr();
        full["pii_salt"] = salt.clone();
        let err = blind_rpr(&full).unwrap_err();
        assert!(err.contains("generate_pii_salt()"), "{salt}: {err}");
    }
    let mut full = sample_rpr();
    full.as_object_mut().unwrap().remove("pii_salt");
    assert!(blind_rpr(&full).is_err());
}

#[test]
fn verify_blinded_rpr_wrong_salt() {
    let mut full = sample_rpr();
    let blinded = blind_rpr(&full).unwrap();
    full["pii_salt"] = json!("d".repeat(64));
    let result = verify_blinded_rpr(&full, &blinded);
    assert!(!result.valid);
    assert!(
        result.errors[0].starts_with("pii_hash mismatch"),
        "{:?}",
        result.errors
    );
}

#[test]
fn verify_blinded_rpr_rejects_malformed_salt() {
    for salt in [json!(""), json!("ab"), json!("A".repeat(64)), json!(42)] {
        let mut full = sample_rpr();
        full["pii_salt"] = salt.clone();
        let mut blinded = blind_rpr(&sample_rpr()).unwrap();
        blinded["pii_hash"] = json!(compute_pii_hash(&full).unwrap());
        let result = verify_blinded_rpr(&full, &blinded);
        assert!(!result.valid, "{salt}");
        assert!(
            result
                .errors
                .contains(&"pii_salt is not 32 random bytes as 64 lowercase hex".to_string()),
            "{salt}: {:?}",
            result.errors
        );
    }
}

#[test]
fn verify_blinded_rpr_accepts_legacy_unsalted_record() {
    let mut legacy = sample_rpr();
    legacy.as_object_mut().unwrap().remove("pii_salt");
    let mut blinded = blind_rpr(&sample_rpr()).unwrap();
    blinded["pii_hash"] = json!(compute_pii_hash(&legacy).unwrap());
    let result = verify_blinded_rpr(&legacy, &blinded);
    assert!(result.valid, "errors: {:?}", result.errors);
}

#[test]
fn pii_hash_is_deterministic_and_prefixed() {
    let h1 = compute_pii_hash(&sample_rpr()).unwrap();
    let h2 = compute_pii_hash(&sample_rpr()).unwrap();
    assert_eq!(h1, h2);
    assert!(h1.starts_with("sha256:"));
    assert_eq!(h1.len(), "sha256:".len() + 64);
}

#[test]
fn blind_rpr_strips_pii() {
    let full = sample_rpr();
    let blinded = blind_rpr(&full).unwrap();
    assert_eq!(blinded["blinded"], true);
    assert!(blinded.get("contact").is_none() || blinded["contact"].is_null());
    assert!(blinded.get("legal_name").is_none() || blinded["legal_name"].is_null());
    assert!(blinded.get("pii_salt").is_none());
    assert!(is_blinded_rpr(&blinded));
}

#[test]
fn verify_blinded_rpr_happy_path() {
    let full = sample_rpr();
    let blinded = blind_rpr(&full).unwrap();
    let result = verify_blinded_rpr(&full, &blinded);
    assert!(result.valid, "errors: {:?}", result.errors);
}

#[test]
fn verify_blinded_rpr_tampered() {
    let full = sample_rpr();
    let mut blinded = blind_rpr(&full).unwrap();
    if let Some(obj) = blinded.as_object_mut() {
        obj.insert("jurisdiction".into(), json!("TAMPERED"));
    }
    let result = verify_blinded_rpr(&full, &blinded);
    assert!(!result.valid);
}

#[test]
fn verify_blinded_rpr_compares_keys_and_nonce() {
    for (field, value) in [
        (
            "binding_keys",
            json!([{ "kid": "attacker", "alg": "ed25519" }]),
        ),
        ("session_nonce", json!("b".repeat(64))),
    ] {
        let full = sample_rpr();
        let mut blinded = blind_rpr(&full).unwrap();
        blinded[field] = value;
        let result = verify_blinded_rpr(&full, &blinded);
        assert!(!result.valid, "{field}");
        assert!(
            result.errors.contains(&format!("{field} mismatch")),
            "{field}: {:?}",
            result.errors
        );
    }
}

// ── Multi-party auth ──

fn mpa(operation: &str, auths: Vec<serde_json::Value>) -> serde_json::Value {
    json!({
        "type": "multi_party_authorization",
        "operation": operation,
        "operation_payload": {},
        "required_parties": 2,
        "authorizations": auths,
    })
}

fn auth(party: &str, role: &str, has_sig: bool) -> serde_json::Value {
    let sig: serde_json::Value = if has_sig {
        json!({
            "classical": {"alg": "ed25519", "kid": party, "sig_b64": "AAAA"},
            "pq": null,
            "binding": "classical_only",
        })
    } else {
        serde_json::Value::Null
    };
    json!({
        "party_id": party,
        "role": role,
        "composite_sig": sig,
    })
}

#[test]
fn mpa_valid_with_owner_and_admin() {
    let m = mpa(
        "revoke_agent",
        vec![auth("p1", "owner", true), auth("p2", "org_admin", true)],
    );
    let r = verify_multi_party_authorization(&m, None);
    assert!(r.valid, "errors: {:?}", r.errors);
}

#[test]
fn mpa_rejects_insufficient() {
    let m = mpa("revoke_agent", vec![auth("p1", "owner", true)]);
    let r = verify_multi_party_authorization(&m, None);
    assert!(!r.valid);
    assert!(r.errors.iter().any(|e| e.contains("Insufficient")));
}

#[test]
fn mpa_requires_owner_when_policy_says_so() {
    let m = mpa(
        "revoke_agent",
        vec![
            auth("p1", "org_admin", true),
            auth("p2", "recovery_contact", true),
        ],
    );
    let r = verify_multi_party_authorization(&m, None);
    assert!(!r.valid);
    assert!(r.errors.iter().any(|e| e.contains("Owner")));
}

#[test]
fn mpa_rejects_unknown_operation_without_policy() {
    let m = mpa("unknown_op", vec![auth("p1", "owner", true)]);
    let r = verify_multi_party_authorization(&m, None);
    assert!(!r.valid);
    assert!(r.errors.iter().any(|e| e.contains("No policy defined")));
}

#[test]
fn mpa_rejects_missing_sig() {
    let m = mpa(
        "revoke_agent",
        vec![auth("p1", "owner", true), auth("p2", "org_admin", false)],
    );
    let r = verify_multi_party_authorization(&m, None);
    assert!(!r.valid);
    assert!(r.errors.iter().any(|e| e.contains("composite_sig")));
}

#[test]
fn mpa_custom_policy() {
    let policy = MultiPartyPolicy {
        required_parties: 3,
        allowed_roles: vec!["owner".into(), "recovery_contact".into()],
        require_owner: true,
    };
    let m = mpa(
        "revoke_agent",
        vec![
            auth("p1", "owner", true),
            auth("p2", "recovery_contact", true),
            auth("p3", "recovery_contact", true),
        ],
    );
    let r = verify_multi_party_authorization(&m, Some(&policy));
    assert!(r.valid, "errors: {:?}", r.errors);
}
