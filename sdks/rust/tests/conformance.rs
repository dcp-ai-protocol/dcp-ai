//! DCP-AI v2.0 Conformance Tests (Rust)
//!
//! 1. V1 bundles verify through the V2-era verifier
//! 2. Golden canonical vectors match across all SDKs
//! 3. Dual-hash chain (SHA-256 + SHA3-256) produces expected results

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use sha2::{Digest as Sha2Digest, Sha256};
use sha3::{Digest as Sha3Digest, Sha3_256};

use dcp_ai::crypto::{canonicalize, hash_object, merkle_root_from_hex_leaves, verify_object};
use dcp_ai::v2::canonicalize::{assert_no_floats, canonicalize_v2};
use dcp_ai::v2::dual_hash::{dual_hash, dual_hash_canonical, sha256_hex, sha3_256_hex};
use dcp_ai::verify::verify_signed_bundle;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("conformance")
}

fn load_golden_vectors() -> Value {
    let path = fixtures_dir().join("v2").join("golden_vectors.json");
    let data = fs::read_to_string(&path).expect("golden_vectors.json not found");
    serde_json::from_str(&data).expect("invalid JSON in golden_vectors.json")
}

fn load_signed_bundle() -> Value {
    let path = fixtures_dir()
        .join("examples")
        .join("citizenship_bundle.signed.json");
    let data = fs::read_to_string(&path).expect("signed bundle not found");
    serde_json::from_str(&data).expect("invalid JSON in signed bundle")
}

// ---------------------------------------------------------------------------
// 1. V1 Bundle Verification (backward compatibility)
// ---------------------------------------------------------------------------

#[test]
fn v1_bundle_verifies_with_embedded_key() {
    let sb = load_signed_bundle();
    let result = verify_signed_bundle(&sb, None);
    assert!(result.verified, "V1 bundle should verify: {:?}", result.errors);
}

#[test]
fn v1_bundle_verifies_with_explicit_key() {
    let sb = load_signed_bundle();
    let vectors = load_golden_vectors();
    let pk = vectors["v1_bundle_verification"]["public_key_b64"]
        .as_str()
        .unwrap();
    let result = verify_signed_bundle(&sb, Some(pk));
    assert!(result.verified, "V1 bundle should verify: {:?}", result.errors);
}

#[test]
fn v1_bundle_rejects_wrong_key() {
    let sb = load_signed_bundle();
    let result = verify_signed_bundle(&sb, Some("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
    assert!(!result.verified);
}

#[test]
fn v1_bundle_rejects_tampered_audit() {
    let sb = load_signed_bundle();
    let mut tampered = sb.clone();
    tampered["bundle"]["audit_entries"][0]["outcome"] = json!("tampered");
    let result = verify_signed_bundle(&tampered, None);
    assert!(!result.verified);
}

#[test]
fn v1_bundle_rejects_tampered_intent() {
    let sb = load_signed_bundle();
    let mut tampered = sb.clone();
    tampered["bundle"]["intent"]["action_type"] = json!("execute_code");
    let result = verify_signed_bundle(&tampered, None);
    assert!(!result.verified);
}

#[test]
fn v1_bundle_hash_matches_golden_vector() {
    let sb = load_signed_bundle();
    let vectors = load_golden_vectors();
    let expected = vectors["v1_bundle_verification"]["expected_bundle_hash"]
        .as_str()
        .unwrap();
    let canon = canonicalize(&sb["bundle"]);
    let mut hasher = Sha256::new();
    hasher.update(canon.as_bytes());
    let computed = format!("sha256:{}", hex::encode(hasher.finalize()));
    assert_eq!(computed, expected);
}

#[test]
fn v1_merkle_root_matches_golden_vector() {
    let sb = load_signed_bundle();
    let vectors = load_golden_vectors();
    let expected = vectors["v1_bundle_verification"]["expected_merkle_root"]
        .as_str()
        .unwrap();
    let entries = sb["bundle"]["audit_entries"].as_array().unwrap();
    let leaves: Vec<String> = entries.iter().map(|e| hash_object(e)).collect();
    let root = merkle_root_from_hex_leaves(&leaves).unwrap();
    assert_eq!(format!("sha256:{}", root), expected);
}

#[test]
fn v1_intent_hash_matches_golden_vector() {
    let sb = load_signed_bundle();
    let vectors = load_golden_vectors();
    let expected = vectors["v1_bundle_verification"]["intent_hash"]
        .as_str()
        .unwrap();
    let computed = hash_object(&sb["bundle"]["intent"]);
    assert_eq!(computed, expected);
}

#[test]
fn v1_prev_hash_chain_matches_golden_vector() {
    let sb = load_signed_bundle();
    let vectors = load_golden_vectors();
    let expected_chain = vectors["v1_bundle_verification"]["prev_hash_chain"]
        .as_array()
        .unwrap();
    let entries = sb["bundle"]["audit_entries"].as_array().unwrap();

    let mut prev_hash = "GENESIS".to_string();
    assert_eq!(prev_hash, expected_chain[0].as_str().unwrap());

    for (i, entry) in entries.iter().enumerate() {
        let entry_prev = entry["prev_hash"].as_str().unwrap();
        assert_eq!(entry_prev, prev_hash, "prev_hash mismatch at entry {}", i);
        prev_hash = hash_object(entry);
        assert_eq!(
            prev_hash,
            expected_chain[i + 1].as_str().unwrap(),
            "computed hash mismatch at entry {}",
            i
        );
    }
}

// ---------------------------------------------------------------------------
// 2. Golden Canonical Vectors
// ---------------------------------------------------------------------------

#[test]
fn canonical_simple_sorted_keys() {
    let vectors = load_golden_vectors();
    let input = &vectors["canonicalization"]["simple_sorted_keys"]["input"];
    let expected = vectors["canonicalization"]["simple_sorted_keys"]["expected_canonical"]
        .as_str()
        .unwrap();
    assert_eq!(canonicalize(input), expected);
}

#[test]
fn canonical_nested_objects() {
    let vectors = load_golden_vectors();
    let input = &vectors["canonicalization"]["nested_objects"]["input"];
    let expected = vectors["canonicalization"]["nested_objects"]["expected_canonical"]
        .as_str()
        .unwrap();
    assert_eq!(canonicalize(input), expected);
}

#[test]
fn canonical_mixed_types() {
    let vectors = load_golden_vectors();
    let input = &vectors["canonicalization"]["mixed_types"]["input"];
    let expected = vectors["canonicalization"]["mixed_types"]["expected_canonical"]
        .as_str()
        .unwrap();
    assert_eq!(canonicalize(input), expected);
}

#[test]
fn canonical_with_null() {
    let vectors = load_golden_vectors();
    let input = &vectors["canonicalization"]["with_null"]["input"];
    let expected = vectors["canonicalization"]["with_null"]["expected_canonical"]
        .as_str()
        .unwrap();
    assert_eq!(canonicalize(input), expected);
}

#[test]
fn canonical_unicode() {
    let vectors = load_golden_vectors();
    let input = &vectors["canonicalization"]["unicode"]["input"];
    let expected = vectors["canonicalization"]["unicode"]["expected_canonical"]
        .as_str()
        .unwrap();
    assert_eq!(canonicalize(input), expected);
}

#[test]
fn v2_canonical_integer_only() {
    let vectors = load_golden_vectors();
    let input = &vectors["v2_canonicalization"]["integer_only"]["input"];
    let expected = vectors["v2_canonicalization"]["integer_only"]["expected_canonical"]
        .as_str()
        .unwrap();
    assert_eq!(canonicalize_v2(input).unwrap(), expected);
}

#[test]
fn v2_canonical_rejects_floats() {
    let val = json!({"score": 0.5});
    assert!(canonicalize_v2(&val).is_err());
}

#[test]
fn v2_canonical_rejects_nested_floats() {
    let val = json!({"outer": {"inner": 3.14}});
    assert!(canonicalize_v2(&val).is_err());
}

#[test]
fn v2_assert_no_floats_passes_integers() {
    let val = json!({"a": 1, "b": [2, 3]});
    assert!(assert_no_floats(&val).is_ok());
}

#[test]
fn v2_assert_no_floats_rejects() {
    let val = json!({"a": 1.5});
    assert!(assert_no_floats(&val).is_err());
}

#[test]
fn sha256_hello_matches() {
    let vectors = load_golden_vectors();
    let expected = vectors["hash_vectors"]["sha256_hello"]["expected_hex"]
        .as_str()
        .unwrap();
    assert_eq!(sha256_hex(b"hello"), expected);
}

#[test]
fn sha256_empty_matches() {
    let vectors = load_golden_vectors();
    let expected = vectors["hash_vectors"]["sha256_empty"]["expected_hex"]
        .as_str()
        .unwrap();
    assert_eq!(sha256_hex(b""), expected);
}

#[test]
fn sha3_256_hello_matches() {
    let vectors = load_golden_vectors();
    let expected = vectors["hash_vectors"]["sha3_256_hello"]["expected_hex"]
        .as_str()
        .unwrap();
    assert_eq!(sha3_256_hex(b"hello"), expected);
}

#[test]
fn sha3_256_empty_matches() {
    let vectors = load_golden_vectors();
    let expected = vectors["hash_vectors"]["sha3_256_empty"]["expected_hex"]
        .as_str()
        .unwrap();
    assert_eq!(sha3_256_hex(b""), expected);
}

#[test]
fn audit_entry_hashes_match_golden() {
    let sb = load_signed_bundle();
    let vectors = load_golden_vectors();
    let expected = vectors["v1_bundle_verification"]["audit_entry_hashes"]
        .as_array()
        .unwrap();
    let entries = sb["bundle"]["audit_entries"].as_array().unwrap();

    for (i, entry) in entries.iter().enumerate() {
        assert_eq!(
            hash_object(entry),
            expected[i].as_str().unwrap(),
            "audit entry hash mismatch at index {}",
            i
        );
    }
}

// ---------------------------------------------------------------------------
// 3. Dual-Hash Chain Tests
// ---------------------------------------------------------------------------

#[test]
fn dual_hash_raw_matches_golden() {
    let vectors = load_golden_vectors();
    let dv = &vectors["dual_hash_vectors"]["raw_dual_hash"];
    let input = dv["input_utf8"].as_str().unwrap();
    let result = dual_hash(input.as_bytes());
    assert_eq!(result.sha256, dv["sha256"].as_str().unwrap());
    assert_eq!(result.sha3_256, dv["sha3_256"].as_str().unwrap());
}

#[test]
fn dual_hash_sha256_sha3_always_differ() {
    let result = dual_hash(b"test data");
    assert_ne!(result.sha256, result.sha3_256);
}

#[test]
fn dual_hash_canonical_intent_matches() {
    let vectors = load_golden_vectors();
    let dv = &vectors["dual_hash_vectors"]["intent_canonical"];
    let canon = dv["canonical_json"].as_str().unwrap();
    let result = dual_hash_canonical(canon);
    assert_eq!(result.sha256, dv["sha256"].as_str().unwrap());
    assert_eq!(result.sha3_256, dv["sha3_256"].as_str().unwrap());
}

#[test]
fn dual_hash_audit_entries_match_golden() {
    let sb = load_signed_bundle();
    let vectors = load_golden_vectors();
    let expected_dual = vectors["dual_hash_vectors"]["audit_entry_dual_hashes"]
        .as_array()
        .unwrap();
    let entries = sb["bundle"]["audit_entries"].as_array().unwrap();

    for (i, entry) in entries.iter().enumerate() {
        let canon = canonicalize(entry);
        let result = dual_hash_canonical(&canon);
        assert_eq!(
            result.sha256,
            expected_dual[i]["sha256"].as_str().unwrap(),
            "SHA-256 mismatch at entry {}",
            i
        );
        assert_eq!(
            result.sha3_256,
            expected_dual[i]["sha3_256"].as_str().unwrap(),
            "SHA3-256 mismatch at entry {}",
            i
        );
    }
}

#[test]
fn dual_merkle_roots_match_golden() {
    let vectors = load_golden_vectors();
    let dv = &vectors["dual_hash_vectors"];
    let expected_sha256 = dv["dual_merkle_roots"]["sha256"].as_str().unwrap();
    let expected_sha3 = dv["dual_merkle_roots"]["sha3_256"].as_str().unwrap();

    let dual_leaves = dv["audit_entry_dual_hashes"].as_array().unwrap();
    let sha256_leaves: Vec<String> = dual_leaves
        .iter()
        .map(|l| l["sha256"].as_str().unwrap().to_string())
        .collect();
    let sha3_leaves: Vec<String> = dual_leaves
        .iter()
        .map(|l| l["sha3_256"].as_str().unwrap().to_string())
        .collect();

    let sha256_root = merkle_root_from_hex_leaves(&sha256_leaves).unwrap();
    assert_eq!(sha256_root, expected_sha256);

    let sha3_root = merkle_root_sha3(&sha3_leaves).unwrap();
    assert_eq!(sha3_root, expected_sha3);
}

#[test]
fn dual_merkle_sha256_matches_v1_merkle_root() {
    let vectors = load_golden_vectors();
    let dv = &vectors["dual_hash_vectors"];
    let v1_root = vectors["v1_bundle_verification"]["expected_merkle_root"]
        .as_str()
        .unwrap()
        .strip_prefix("sha256:")
        .unwrap();
    let sha256_root = dv["dual_merkle_roots"]["sha256"].as_str().unwrap();
    assert_eq!(sha256_root, v1_root);
}

#[test]
fn dual_hash_chain_integrity() {
    let sb = load_signed_bundle();
    let vectors = load_golden_vectors();
    let expected_chain = vectors["v1_bundle_verification"]["prev_hash_chain"]
        .as_array()
        .unwrap();
    let dual_hashes = vectors["dual_hash_vectors"]["audit_entry_dual_hashes"]
        .as_array()
        .unwrap();
    let entries = sb["bundle"]["audit_entries"].as_array().unwrap();

    let mut prev_sha256 = "GENESIS".to_string();
    let mut prev_sha3 = "GENESIS".to_string();

    for (i, entry) in entries.iter().enumerate() {
        assert_eq!(entry["prev_hash"].as_str().unwrap(), prev_sha256);
        let canon = canonicalize(entry);
        let dh = dual_hash_canonical(&canon);
        prev_sha256 = dh.sha256;
        prev_sha3 = dh.sha3_256;
        assert_eq!(prev_sha256, expected_chain[i + 1].as_str().unwrap());
        assert_eq!(prev_sha3, dual_hashes[i]["sha3_256"].as_str().unwrap());
    }
}

/// SHA3-256 Merkle root helper (mirrors SHA-256 merkle_root_from_hex_leaves).
fn merkle_root_sha3(leaves: &[String]) -> Option<String> {
    if leaves.is_empty() {
        return None;
    }
    let mut layer: Vec<String> = leaves.to_vec();
    while layer.len() > 1 {
        if layer.len() % 2 == 1 {
            let last = layer.last().unwrap().clone();
            layer.push(last);
        }
        let mut next = Vec::new();
        for i in (0..layer.len()).step_by(2) {
            let left = hex::decode(&layer[i]).unwrap();
            let right = hex::decode(&layer[i + 1]).unwrap();
            let mut combined = left;
            combined.extend_from_slice(&right);
            let mut hasher = Sha3_256::new();
            hasher.update(&combined);
            next.push(hex::encode(hasher.finalize()));
        }
        layer = next;
    }
    Some(layer[0].clone())
}
