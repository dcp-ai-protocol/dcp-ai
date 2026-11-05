//! DCP-09 §3.5.2 rule 5, a domain that appears twice in one mandate (Rust SDK):
//! the shared signed vectors every SDK must agree on
//! (tests/interop/v2/mandate_domain_vectors.json), at every depth, the root
//! included, with domains compared as exact strings. The verdicts are the
//! protocol's; the exact error lists are this SDK's diagnostics, checked as a
//! regression.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use dcp_ai::v2::delegation::{verify_mandate_chain, MandateChainKeys};
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;

fn revoked(case: &Value) -> HashSet<String> {
    case["revoked_mandate_ids"]
        .as_array()
        .expect("revoked_mandate_ids")
        .iter()
        .map(|id| id.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn mandate_domain_vectors() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/interop/v2/mandate_domain_vectors.json");
    let v: Value =
        serde_json::from_str(&fs::read_to_string(path).expect("read mandate domain vectors"))
            .expect("parse mandate domain vectors");
    let accept = v["must_accept"].as_array().expect("must_accept");
    let reject = v["must_reject"].as_array().expect("must_reject");
    assert_eq!((accept.len(), reject.len()), (8, 15));
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
    let keys: MandateChainKeys = serde_json::from_value(v["keys"].clone()).expect("keys");
    let now =
        parse_rfc3339_millis(v["verification_time"].as_str().unwrap()).expect("verification_time");
    for case in accept {
        let chain = case["chain"].as_array().expect("chain").clone();
        let r = verify_mandate_chain(&chain, &revoked(case), &keys, Some(now));
        assert!(r.errors.is_empty(), "{}: {:?}", case["name"], r.errors);
        assert!(r.valid, "{}", case["name"]);
        assert_eq!(
            r.depth as u64,
            case["expected"]["depth"].as_u64().unwrap(),
            "{}",
            case["name"]
        );
        assert_eq!(
            r.effective_tier.is_none(),
            case["expected"]["effective_tier"].is_null(),
            "{}",
            case["name"]
        );
    }
    let mut mismatches = Vec::new();
    for case in reject {
        let chain = case["chain"].as_array().expect("chain").clone();
        let r = verify_mandate_chain(&chain, &revoked(case), &keys, Some(now));
        let want: Vec<String> = serde_json::from_value(case["errors"].clone()).expect("errors");
        if r.valid || r.errors != want || r.depth != 0 || r.effective_tier.is_some() {
            mismatches.push((case["name"].clone(), r.valid, r.errors));
        }
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}
