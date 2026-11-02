//! The historical rejects that V2-2 now decides first (tests/interop/v2/schema_validation/regression_map.json): for
//! these rows a test asserts the exact schema diagnostics both oracles report, instead of the historical
//! error_contains, which belonged to a deeper check the row no longer reaches. Where that check stays reachable, the
//! map names its coverage (schema-valid rows, deep_negatives.json or a helper's direct test; see tests/schema_v2.rs).
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::OnceLock;

use serde_json::Value;

pub fn shared(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/interop/v2").join(rel)
}

pub fn regression_map() -> &'static Value {
    static MAP: OnceLock<Value> = OnceLock::new();
    MAP.get_or_init(|| {
        serde_json::from_str(&std::fs::read_to_string(shared("schema_validation/regression_map.json")).unwrap()).unwrap()
    })
}

/// The row of `fixture` (a file under tests/interop/v2/) named `name`, when V2-2 now decides it.
pub fn schema_first_row(fixture: &str, name: &str) -> Option<&'static Value> {
    let fixture = format!("tests/interop/v2/{fixture}");
    regression_map()["rows"].as_array().unwrap().iter().find(|r| r["fixture"] == fixture.as_str() && r["name"] == name)
}

/// The verifier's wording of a member name: RFC 6901 escaped, then cut to 64 code points.
pub fn bounded_token(s: &str) -> String {
    let t = s.replace('~', "~0").replace('/', "~1");
    match t.char_indices().nth(64) {
        Some((at, _)) => format!("{}…[cut]", &t[..at]),
        None => t,
    }
}

pub fn expected_diagnostics(row: &Value) -> Vec<String> {
    let mut want: Vec<String> = row["schema_errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let instance = match e["instance"].as_str().unwrap() {
                "" => "/",
                i => i,
            };
            match e.get("member").and_then(Value::as_str) {
                Some(m) => format!("schema: {} {} {}", instance, e["keyword"].as_str().unwrap(), bounded_token(m)),
                None => format!("schema: {} {}", instance, e["keyword"].as_str().unwrap()),
            }
        })
        .collect();
    want.sort();
    want
}

/// A rejection by V2-2 alone with exactly `want` (sorted), or its first 16 and the truncation marker.
pub fn assert_schema_diagnostics(label: &str, verified: bool, errors: &[String], want: &[String]) {
    assert!(!verified, "{label}: must be rejected");
    if want.len() <= 16 {
        let mut got = errors.to_vec();
        got.sort();
        assert_eq!(got, want, "{label}");
    } else {
        assert_eq!(errors.len(), 17, "{label}: {errors:?}");
        assert_eq!(errors[16], "schema: further errors not listed", "{label}");
        assert!(errors[..16].iter().all(|e| want.contains(e)), "{label}: {errors:?}");
    }
}

/// A rejection by V2-2 with exactly the oracles' schema errors of `row`.
pub fn assert_schema_rejection(verified: bool, errors: &[String], row: &Value) {
    assert_schema_diagnostics(row["name"].as_str().unwrap(), verified, errors, &expected_diagnostics(row));
}
