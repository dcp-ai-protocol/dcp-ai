//! Secondary SHA3-256 fields (spec/VERIFICATION.md V2-11 and its erratum of
//! 27/10/2026), through the shared vectors
//! tests/interop/v2/secondary_sha3_vectors.json: the verifier, admission and the
//! experimental candidate verifier (v1 route).

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use dcp_ai::v2::admission::{admit_signed_bundle_v2, AdmitOptions, PrincipalTrustStore};
use dcp_ai::v2::experimental_candidate_router::{CandidateRouterConfig, HistoricalAdapter};
use dcp_ai::v2::experimental_candidate_verify::CandidateVerifier;
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::verify_signed_bundle_v2_at;
use serde_json::{json, Value};

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/interop/v2/secondary_sha3_vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read secondary vectors")).expect("parse secondary vectors")
}

fn assemble(v: &Value, part: &Value) -> Value {
    let mut bundle = v["base"]["artifacts"].clone();
    let b = bundle.as_object_mut().unwrap();
    b.insert("dcp_bundle_version".into(), json!("2.0"));
    b.insert("manifest".into(), part["manifest"].clone());
    b.insert("audit_entries".into(), part["audit_entries"].clone());
    json!({ "bundle": bundle, "signature": part["signature"] })
}

#[test]
fn secondary_sha3_vectors() {
    let v = vectors();
    let cases = v["cases"].as_array().unwrap();
    let names: BTreeSet<&str> = cases.iter().map(|c| c["name"].as_str().unwrap()).collect();
    let accept = cases.iter().filter(|c| c["expect"] == "accept").count();
    let reject = cases.iter().filter(|c| c["expect"] == "reject").count();
    assert_eq!((cases.len(), names.len(), accept, reject), (51, 51, 22, 29));
    for g in ["root", "chain", "intent", "mixed"] {
        assert!(cases.iter().any(|c| c["group"] == g), "no {g} case");
    }

    let now = parse_rfc3339_millis(v["verification_time"].as_str().unwrap()).unwrap();
    let policy = VerifierPolicy::default();
    let keys: Vec<Value> = v["base"]["principal_keys"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| json!({ "kid": k["kid"], "alg": k["alg"], "public_key_b64": k["public_key_b64"], "status": "active" }))
        .collect();
    let trust = PrincipalTrustStore::from_json(&json!({
        "trust_set_version": "2026-10-27.secondary",
        "principals": [{ "human_id": v["base"]["artifacts"]["responsible_principal_record"]["payload"]["human_id"], "keys": keys }],
    }))
    .expect("trust store");
    // The vectors name dcp-jcs-v1 in the manifest, so the router must accept it to take the v1 route.
    let candidate = CandidateVerifier::new(CandidateRouterConfig {
        transport: "bare".into(),
        accepted_profiles: json!(["dcp-jcs-v1", "dcp-jcs-v2"]),
        historical: Some(HistoricalAdapter::serde_json_from_slice()),
    })
    .expect("candidate verifier");

    for c in cases {
        let name = c["name"].as_str().unwrap();
        let ok = c["expect"] == "accept";
        let signed = assemble(&v, c);
        let r = verify_signed_bundle_v2_at(&signed, &policy, now).result;
        if ok {
            assert!(r.verified && r.errors.is_empty(), "{name}: {:?}", r.errors);
        } else {
            let token = c["error_contains"].as_str().unwrap();
            assert!(!r.verified, "{name}: accepted");
            assert!(r.errors.iter().any(|e| e.contains(token)), "{name}: {:?}", r.errors);
            assert!(r.errors.iter().all(|e| e.contains("secondary")), "{name}: {:?}", r.errors);
            let ctl = verify_signed_bundle_v2_at(&assemble(&v, &c["control"]), &policy, now).result;
            assert!(ctl.verified && ctl.errors.is_empty(), "{name} control: {:?}", ctl.errors);
        }

        let adm = admit_signed_bundle_v2(&signed, &AdmitOptions { trust: Some(&trust), now_ms: Some(now), ..Default::default() })
            .expect("admission");
        assert_eq!((adm.verified, adm.admitted, adm.action_authorized), (ok, ok, false), "{name}: admission");

        let routed = candidate.verify_at(&serde_json::to_vec(&signed).unwrap(), &policy, now).expect("candidate");
        assert_eq!(routed.entered, "dcp-jcs-v1", "{name}: candidate route");
        assert_eq!(routed.verification.map(|d| d.result.verified), Some(ok), "{name}: candidate verdict");
    }
}
