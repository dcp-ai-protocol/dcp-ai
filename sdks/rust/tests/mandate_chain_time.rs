//! DCP-09 §3.5.2 chain time rules (Rust SDK): the shared signed vectors every
//! SDK must agree on (tests/interop/v2/mandate_chain_time_vectors.json) and the
//! verification time as this SDK takes it, in whole milliseconds: before the
//! Unix epoch, at the ends of i64, and the current time when none is given.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::composite_ops::CompositeKeyInfo;
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::delegation::{
    create_delegation_mandate, verify_mandate_chain, DelegationMandateParams, MandateChainKeys,
};
use dcp_ai::v2::session_nonce::{generate_session_nonce, parse_rfc3339_millis};

fn load_vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/interop/v2/mandate_chain_time_vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read mandate chain time vectors"))
        .expect("parse mandate chain time vectors")
}

fn keys_of(v: &Value, case: &Value) -> MandateChainKeys {
    let keys = if case.get("keys").is_some() {
        &case["keys"]
    } else {
        &v["keys"]
    };
    serde_json::from_value(keys.clone()).expect("keys")
}

fn time_of(v: &Value, case: &Value) -> i64 {
    let s = case["verification_time"]
        .as_str()
        .unwrap_or_else(|| v["verification_time"].as_str().expect("verification_time"));
    parse_rfc3339_millis(s).unwrap_or_else(|| {
        panic!(
            "{}: the verification time {s} is not an instant",
            case["name"]
        )
    })
}

fn chain_of(case: &Value) -> Vec<Value> {
    case["chain"].as_array().expect("chain").clone()
}

fn named<'a>(v: &'a Value, name: &str) -> &'a Value {
    v["must_accept"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("no case {name}"))
}

#[test]
fn mandate_chain_time_vectors() {
    let v = load_vectors();
    let accept = v["must_accept"].as_array().expect("must_accept");
    let reject = v["must_reject"].as_array().expect("must_reject");
    assert_eq!((accept.len(), reject.len()), (9, 13));
    let names: HashSet<&str> = accept
        .iter()
        .chain(reject)
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names.len(),
        accept.len() + reject.len(),
        "case names are unique"
    );
    let none = HashSet::new();
    for case in accept {
        let r = verify_mandate_chain(
            &chain_of(case),
            &none,
            &keys_of(&v, case),
            Some(time_of(&v, case)),
        );
        assert!(r.errors.is_empty(), "{}: {:?}", case["name"], r.errors);
        assert!(r.valid, "{}", case["name"]);
        assert_eq!(
            r.depth as u64,
            case["expected"]["depth"].as_u64().unwrap(),
            "{}",
            case["name"]
        );
        assert!(
            r.effective_tier.is_none() && case["expected"]["effective_tier"].is_null(),
            "{}",
            case["name"]
        );
    }
    for case in reject {
        let r = verify_mandate_chain(
            &chain_of(case),
            &none,
            &keys_of(&v, case),
            Some(time_of(&v, case)),
        );
        let errors = r.errors.join("\n").to_lowercase();
        let want = case["error_contains"].as_str().unwrap();
        assert!(
            !r.valid && errors.contains(want),
            "{}: want {want:?}, got {:?}",
            case["name"],
            r.errors
        );
    }
}

#[test]
fn every_i64_is_a_verification_time() {
    let v = load_vectors();
    let extreme = named(
        &v,
        "windows_from_year_0000_to_year_9999_offsets_crossing_both",
    );
    let keys = keys_of(&v, extreme);
    let none = HashSet::new();
    let low = verify_mandate_chain(&chain_of(extreme), &none, &keys, Some(i64::MIN));
    assert!(
        !low.valid
            && low
                .errors
                .join("\n")
                .contains("not yet valid at the verification time"),
        "{low:?}"
    );
    let high = verify_mandate_chain(&chain_of(extreme), &none, &keys, Some(i64::MAX));
    assert!(
        !high.valid
            && high
                .errors
                .join("\n")
                .contains("expired at the verification time"),
        "{high:?}"
    );
}

#[test]
fn without_a_time_it_uses_the_current_time() {
    let v = load_vectors();
    let none = HashSet::new();
    let current = &v["must_accept"][0];
    assert!(verify_mandate_chain(&chain_of(current), &none, &keys_of(&v, current), None).valid);
    // These keys expire at 2026-10-22T12:00:00Z, before the current time.
    let expiring = named(&v, "every_signer_key_expires_at_the_verification_time");
    assert!(!verify_mandate_chain(&chain_of(expiring), &none, &keys_of(&v, expiring), None).valid);
}

#[test]
fn before_the_unix_epoch() {
    let ed_kp = Ed25519Provider.generate_keypair().unwrap();
    let pq_kp = MlDsa65Provider.generate_keypair().unwrap();
    let human = (
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
    );
    let nonce = generate_session_nonce();
    let root = create_delegation_mandate(
        &Ed25519Provider,
        &MlDsa65Provider,
        &human.0,
        &human.1,
        DelegationMandateParams {
            mandate_id: "mandate:before-epoch",
            session_nonce: &nonce,
            human_id: "human:alice",
            agent_id: "agent:a",
            authority_scope: vec![json!({"domain": "email", "actions_permitted": ["read"]})],
            valid_from: "1969-01-01T00:00:00Z",
            valid_until: "1970-12-31T00:00:00Z",
            revocable: true,
        },
    )
    .unwrap();
    let entries = [&human.0, &human.1]
        .iter()
        .map(|k| json!({"kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64, "created_at": "1969-01-01T00:00:00Z", "expires_at": "1969-12-31T23:59:59.999Z", "status": "active"}))
        .collect();
    let keys = MandateChainKeys {
        human_keys: entries,
        agent_keys: HashMap::new(),
    };
    let none = HashSet::new();
    let at_expiry = verify_mandate_chain(std::slice::from_ref(&root), &none, &keys, Some(-1));
    assert!(at_expiry.valid, "{:?}", at_expiry.errors);
    let at_epoch = verify_mandate_chain(std::slice::from_ref(&root), &none, &keys, Some(0));
    assert!(
        !at_epoch.valid
            && at_epoch
                .errors
                .join("\n")
                .contains("has expired or has an invalid expires_at"),
        "{at_epoch:?}"
    );
}
