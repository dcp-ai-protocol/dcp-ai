//! The verification API as it was before admission, used as an external crate
//! would: `V2VerificationResult` with its ten public fields (built in full and
//! destructured without `..`), the two verify functions with their types, and
//! a JSON without `signer_keys`. The signer keys are only in
//! `V2VerificationDetails`, from the same verification.

use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::{
    verify_signed_bundle_v2, verify_signed_bundle_v2_at, verify_signed_bundle_v2_with_policy, V2VerificationResult,
};
use serde_json::Value;

/// tests/interop/v2/bundle_vectors.json: its signed bundle verifies (its session
/// runs to 2099, so the system clock is no edge), and its first must_reject
/// case, applied to it, does not.
fn bundles() -> (Value, Value) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/bundle_vectors.json");
    let vectors: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("read bundle vectors")).unwrap();
    let valid = vectors["signed_bundle"].clone();
    let mut rejected = valid.clone();
    for mutation in vectors["must_reject"][0]["mutations"].as_array().expect("mutations") {
        let mut node = &mut rejected;
        for key in mutation["path"].as_array().expect("path") {
            node = &mut node[key.as_str().expect("path key")];
        }
        *node = mutation["value"].clone();
    }
    (valid, rejected)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

#[test]
fn the_result_is_built_and_destructured_with_its_ten_fields() {
    let built = V2VerificationResult {
        verified: false,
        dcp_version: "2.0".into(),
        errors: vec!["e".into()],
        warnings: vec![],
        classical_valid: false,
        pq_valid: false,
        session_binding_valid: false,
        manifest_valid: false,
        verification_mode: String::new(),
        resolved_tier: String::new(),
    };
    let V2VerificationResult {
        verified,
        dcp_version,
        errors,
        warnings,
        classical_valid,
        pq_valid,
        session_binding_valid,
        manifest_valid,
        verification_mode,
        resolved_tier,
    } = built;
    assert!(!verified && !classical_valid && !pq_valid && !session_binding_valid && !manifest_valid);
    assert_eq!((dcp_version.as_str(), errors.len(), warnings.len()), ("2.0", 1, 0));
    assert!(verification_mode.is_empty() && resolved_tier.is_empty());
}

#[test]
fn the_verify_functions_keep_their_types() {
    let _: fn(&Value) -> V2VerificationResult = verify_signed_bundle_v2;
    let _: fn(&Value, &VerifierPolicy) -> V2VerificationResult = verify_signed_bundle_v2_with_policy;
}

#[test]
fn the_result_serializes_without_signer_keys() {
    let (valid, _) = bundles();
    let json = serde_json::to_string(&verify_signed_bundle_v2(&valid)).unwrap();
    assert!(json.starts_with("{\"verified\":true,") && !json.contains("signer_keys"), "{json}");
}

/// One verification, verified and rejected: the two functions give the
/// details' result, and the details serialize as those bytes followed by
/// `signer_keys`.
#[test]
fn the_details_are_the_same_verification_with_its_signer_keys() {
    let (valid, rejected) = bundles();
    let policy = VerifierPolicy::default();
    for (bundle, verified) in [(&valid, true), (&rejected, false)] {
        let details = verify_signed_bundle_v2_at(bundle, &policy, now_ms());
        assert_eq!(details.result.verified, verified, "{:?}", details.result.errors);
        let result = serde_json::to_string(&details.result).unwrap();
        assert_eq!(serde_json::to_string(&verify_signed_bundle_v2_with_policy(bundle, &policy)).unwrap(), result);
        assert_eq!(serde_json::to_string(&verify_signed_bundle_v2(bundle)).unwrap(), result);
        let keys = serde_json::to_string(&details.signer_keys).unwrap();
        let expected = format!("{},\"signer_keys\":{}}}", &result[..result.len() - 1], keys);
        assert_eq!(serde_json::to_string(&details).unwrap(), expected);
        if verified {
            assert!(details.signer_keys.iter().any(|k| k.signature == "bundle" && k.verified), "{:?}", details.signer_keys);
        }
    }
}
