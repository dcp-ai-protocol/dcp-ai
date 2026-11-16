//! Exact dual Merkle roots (spec/VERIFICATION.md V2-11 and its erratum) through the shared vectors
//! tests/conformance/v2/merkle_vectors.json: the core v2::dual_hash::dual_merkle_root and, with the `wasm`
//! feature, the wasm_dual_merkle_root export, which must give the same roots and keep its errors.

use std::fs;
use std::path::PathBuf;

use dcp_ai::v2::dual_hash::{dual_merkle_root, DualHash};
use serde_json::Value;

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/conformance/v2/merkle_vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read merkle vectors")).expect("parse merkle vectors")
}

fn leaves(c: &Value) -> Vec<DualHash> {
    serde_json::from_value(c["leaves"].clone()).expect("leaves")
}

#[test]
fn core_dual_merkle_root_matches_the_vectors() {
    let v = vectors();
    let cases = v["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 6);
    for c in cases {
        let root = dual_merkle_root(&leaves(c)).expect("a root");
        assert_eq!(root.sha256, c["expected"]["sha256"].as_str().unwrap(), "{}", c["name"]);
        assert_eq!(root.sha3_256, c["expected"]["sha3_256"].as_str().unwrap(), "{}", c["name"]);
    }
}

#[cfg(feature = "wasm")]
#[test]
fn wasm_export_matches_the_vectors_and_keeps_its_errors() {
    use dcp_ai::wasm::wasm_dual_merkle_root;
    let v = vectors();
    for c in v["cases"].as_array().unwrap() {
        let out: Value = serde_json::from_str(&wasm_dual_merkle_root(&c["leaves"].to_string())).unwrap();
        assert_eq!(out, c["expected"], "{}", c["name"]);
    }
    assert_eq!(wasm_dual_merkle_root("[]"), r#"{"error":"Empty leaves array"}"#);
    let parse: Value = serde_json::from_str(&wasm_dual_merkle_root("[")).unwrap();
    assert!(parse["error"].as_str().unwrap().starts_with("JSON parse: "));
    for c in [&v["cases"][0], &v["cases"][1]] {
        let upper: Vec<Value> = c["leaves"].as_array().unwrap().iter()
            .map(|l| serde_json::json!({"sha256": l["sha256"].as_str().unwrap().to_uppercase(), "sha3_256": l["sha3_256"].as_str().unwrap().to_uppercase()}))
            .collect();
        let out: Value = serde_json::from_str(&wasm_dual_merkle_root(&Value::Array(upper).to_string())).unwrap();
        assert_eq!(out, c["expected"], "{} in uppercase", c["name"]);
    }
    let leaf = &v["cases"][1]["leaves"][0];
    for bad in [
        serde_json::json!([{"sha256": "zz".repeat(32), "sha3_256": leaf["sha3_256"]}, leaf]),
        serde_json::json!([{"sha256": leaf["sha256"], "sha3_256": &leaf["sha3_256"].as_str().unwrap()[2..]}, leaf]),
        serde_json::json!([{"sha256": "hello", "sha3_256": "world"}]),
    ] {
        let out: Value = serde_json::from_str(&wasm_dual_merkle_root(&bad.to_string())).unwrap();
        assert!(out["error"].is_string() && out.get("sha256").is_none(), "{bad}: {out}");
    }
}
