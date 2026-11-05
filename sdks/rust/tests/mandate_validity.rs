//! The mandate validity helper (DCP-09 §3.5.2 rule 4, §3.6), Rust SDK: the
//! shared vectors every SDK must agree on
//! (tests/interop/v2/mandate_validity_vectors.json), the injected and default
//! clocks, and JSON values that must give a result, never a panic.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

use dcp_ai::v2::delegation::{verify_mandate_validity, verify_mandate_validity_at};
use dcp_ai::v2::session_nonce::{generate_session_expiry, parse_rfc3339_millis};

const ID: &str = "mandate-validity-0001";

fn load_vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/interop/v2/mandate_validity_vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read mandate validity vectors"))
        .expect("parse mandate validity vectors")
}

fn ids(list: &Value) -> HashSet<String> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

fn outcome(m: &Value, revoked: &HashSet<String>, now: i64) -> Value {
    let r = verify_mandate_validity_at(m, revoked, now);
    match r.reason {
        Some(reason) => json!({ "valid": r.valid, "reason": reason }),
        None => json!({ "valid": r.valid }),
    }
}

fn mandate(from: &str, until: &str) -> Value {
    json!({ "mandate_id": ID, "valid_from": from, "valid_until": until })
}

#[test]
fn mandate_validity_vectors() {
    let v = load_vectors();
    let cases = v["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 94);
    let default_now = v["verification_time"].as_str().expect("verification_time");
    let mut wrong = Vec::new();
    for c in cases {
        let now = parse_rfc3339_millis(c["now"].as_str().unwrap_or(default_now))
            .expect("now is an instant");
        let got = outcome(&c["mandate"], &ids(&c["revoked_mandate_ids"]), now);
        if got != c["expect"] {
            wrong.push(format!("{}: got {}, want {}", c["name"], got, c["expect"]));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}

#[test]
fn without_a_time_it_uses_the_current_time() {
    // generate_session_expiry gives the RFC 3339 instant of now plus that many seconds.
    let at = |seconds: i64| generate_session_expiry(Some(seconds), None);
    let none = HashSet::new();
    assert!(verify_mandate_validity(&mandate(&at(-3600), &at(3600)), &none).valid);
    let expired = verify_mandate_validity(&mandate(&at(-7200), &at(-3600)), &none);
    assert_eq!(expired.reason.as_deref(), Some("Mandate has expired"));
    let future = verify_mandate_validity(&mandate(&at(3600), &at(7200)), &none);
    assert_eq!(future.reason.as_deref(), Some("Mandate is not yet valid"));
}

#[test]
fn every_instant_is_a_verification_time() {
    let window = mandate("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z");
    let none = HashSet::new();
    for now in [i64::MIN, -62_167_219_200_000, 0, i64::MAX] {
        let r = verify_mandate_validity_at(&window, &none, now);
        assert!(!r.valid && r.reason.is_some(), "{now}: {r:?}");
    }
    assert!(
        verify_mandate_validity_at(
            &mandate("0000-01-01T00:00:00Z", "0000-01-01T00:00:00Z"),
            &none,
            -62_167_219_200_000
        )
        .valid
    );
}

#[test]
fn json_values_give_a_result_never_a_panic() {
    let values = [
        Value::Null,
        json!(0),
        json!(-1),
        json!(1.5),
        json!(""),
        json!(true),
        json!([]),
        json!({}),
        json!([ID]),
        json!(1e300),
    ];
    for v in &values {
        for m in [
            v.clone(),
            json!({ "mandate_id": v, "valid_from": "2026-06-01T00:00:00Z", "valid_until": "2026-07-01T00:00:00Z" }),
            json!({ "mandate_id": ID, "valid_from": v, "valid_until": "2026-07-01T00:00:00Z" }),
            json!({ "mandate_id": ID, "valid_from": "2026-06-01T00:00:00Z", "valid_until": v }),
        ] {
            let r = verify_mandate_validity_at(&m, &HashSet::new(), 0);
            assert!(!r.valid && r.reason.is_some(), "{m}: {r:?}");
        }
    }
}
