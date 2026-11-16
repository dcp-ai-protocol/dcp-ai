//! V2-2 in front of the public Rust verifiers: verify_signed_bundle_v2, verify_signed_bundle_v2_with_policy,
//! verify_signed_bundle_v2_at, admit_signed_bundle_v2, the experimental candidate verifier and (feature wasm) the
//! wasm_verify_signed_bundle_v2 binding, over the signed cases of tests/interop/v2/schema_validation/, with the deeper
//! checks the historical rows used to reach kept covered (regression_map.json, deep_negatives.json). The native APIs
//! take no provider registry: a rejection before any signature shows as no signer key observed.

use dcp_ai::v2::experimental_candidate_router::{CandidateRoute, CandidateRouterConfig, HistoricalAdapter};
use dcp_ai::v2::experimental_candidate_verify::CandidateVerifier;
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::{
    admit_signed_bundle_v2, resolve_strict_v1_profile, verify_signed_bundle_v2, verify_signed_bundle_v2_at,
    verify_signed_bundle_v2_with_policy, AdmitOptions, PrincipalTrust, PrincipalTrustStore, V2VerificationDetails,
};
use serde_json::{json, Value};

mod schema_regression_map;
use schema_regression_map::{expected_diagnostics, regression_map, shared};

fn read(rel: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(shared(rel)).unwrap()).unwrap()
}

fn wiring() -> (Value, VerifierPolicy, i64) {
    let w = read("schema_validation/wiring_cases.json");
    let policy: VerifierPolicy = serde_json::from_value(w["verifier_policy"].clone()).unwrap();
    let now = parse_rfc3339_millis(w["verification_time"].as_str().unwrap()).unwrap();
    (w, policy, now)
}

/// The case's value: its text when it has one (parsed as every caller of the native API parses), else its JSON.
fn doc(c: &Value) -> Value {
    match c.get("signed_bundle_text") {
        Some(t) => serde_json::from_str(t.as_str().unwrap()).unwrap(),
        None => c["signed_bundle"].clone(),
    }
}

fn target(c: &Value) -> String {
    let instance = match c["target"]["instance"].as_str().unwrap() {
        "" => "/",
        i => i,
    };
    format!("schema: {} {}", instance, c["target"]["keyword"].as_str().unwrap())
}

/// Rejected by V2-2 alone, `target` among the errors, the established result shape and no signer key observed.
fn assert_v22_only(label: &str, d: &V2VerificationDetails, target: &str) {
    let r = &d.result;
    assert!(r.errors.iter().all(|e| e.starts_with("schema: ")), "{label}: {:?}", r.errors);
    assert!(r.errors.iter().any(|e| e == target || e.starts_with(&format!("{target} "))), "{label}: {target} in {:?}", r.errors);
    assert!(
        !r.verified && r.dcp_version == "2.0" && r.warnings.is_empty() && !r.classical_valid && !r.pq_valid
            && !r.session_binding_valid && !r.manifest_valid && r.verification_mode.is_empty() && r.resolved_tier.is_empty(),
        "{label}: {r:?}"
    );
    assert!(d.signer_keys.is_empty(), "{label}: signer keys before any signature");
}

fn candidate(profiles: Value) -> CandidateVerifier {
    CandidateVerifier::new(CandidateRouterConfig {
        transport: "bare".into(),
        accepted_profiles: profiles,
        historical: Some(HistoricalAdapter::serde_json_from_slice()),
    })
    .unwrap()
}

#[test]
fn the_57_signed_cases_through_the_public_apis_negatives_before_any_signature() {
    let (w, policy, now) = wiring();
    let cases = w["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 57);
    let v1_route = candidate(json!(["dcp-jcs-v1"]));
    let (mut positives, mut negatives) = (0, 0);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let value = doc(c);
        let frozen = value.clone();
        let d = verify_signed_bundle_v2_at(&value, &policy, now);
        if c["expect"]["verified"] == true {
            positives += 1;
            assert!(d.result.verified && d.result.errors.is_empty() && !d.signer_keys.is_empty(), "{name}: {:?}", d.result.errors);
        } else {
            negatives += 1;
            let t = target(c);
            assert_v22_only(&format!("{name} at"), &d, &t);
            // The other entry points give the same rejection.
            let with_policy = verify_signed_bundle_v2_with_policy(&value, &policy);
            assert_eq!(with_policy.errors, d.result.errors, "{name} with_policy");
            assert_eq!(verify_signed_bundle_v2(&value).errors, d.result.errors, "{name} default");
            let adm = admit_signed_bundle_v2(&value, &AdmitOptions { now_ms: Some(now), ..Default::default() }).unwrap();
            assert!(!adm.verified && !adm.admitted && !adm.action_authorized && adm.principal_trust == PrincipalTrust::NotEvaluated, "{name} admission");
            assert_v22_only(&format!("{name} admission"), &adm.verification, &t);
            let routed = v1_route.verify_at(&serde_json::to_vec(&value).unwrap(), &policy, now).unwrap();
            assert_eq!(routed.entered, "dcp-jcs-v1", "{name} candidate route");
            assert_v22_only(&format!("{name} candidate"), routed.verification.as_ref().unwrap(), &t);
        }
        assert_eq!(value, frozen, "{name}: the input was written");
    }
    assert_eq!((positives, negatives), (13, 44));
}

#[test]
fn c4_null_session_times_fail_the_schema() {
    let (w, policy, now) = wiring();
    for name in ["c4_session_expires_at_null", "c4_session_issued_at_null"] {
        let c = w["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap();
        let errors = verify_signed_bundle_v2_at(&doc(c), &policy, now).result.errors;
        assert_eq!(errors, [format!("schema: {} type", c["target"]["instance"].as_str().unwrap())], "{name}");
    }
}

/// The policy contract comes before V2-2, as it did; the native API takes a parsed value, so the parser contract is
/// the caller's serde_json (a lone surrogate escape or 1e400 never reaches the verifier).
#[test]
fn the_policy_contract_is_kept_before_v2_2() {
    let unenforced = VerifierPolicy { min_classical: 5, ..VerifierPolicy::default() };
    let r = verify_signed_bundle_v2_with_policy(&json!({}), &unenforced);
    assert!(r.errors.len() == 1 && r.errors[0].contains("does not enforce"), "{:?}", r.errors);
    assert_eq!(verify_signed_bundle_v2(&Value::Null).errors, ["schema: / type"]);
    assert_eq!(verify_signed_bundle_v2(&json!({})).errors, ["schema: / required bundle", "schema: / required signature"]);
    for text in [r#"{"x":"\ud800"}"#, r#"{"x":1e400}"#] {
        assert!(serde_json::from_str::<Value>(text).is_err(), "{text}");
    }
}

/// Over 16 errors the list is cut with a marker, and the rejection stands whatever the cut.
#[test]
fn the_error_budget_keeps_the_rejection() {
    let (w, policy, now) = wiring();
    let mut many = w["cases"][0]["signed_bundle"].clone();
    for i in 0..40 {
        many[format!("x_{i:02}")] = json!(i);
    }
    let r = verify_signed_bundle_v2_at(&many, &policy, now);
    assert!(!r.result.verified && r.signer_keys.is_empty());
    assert_eq!(r.result.errors.len(), 17);
    assert_eq!(r.result.errors[16], "schema: further errors not listed");
    assert!(r.result.errors[..16].iter().all(|e| e.starts_with("schema: / additionalProperties x_")), "{:?}", r.result.errors);
}

#[test]
fn combined_admission_positive_schema_negative_and_trust() {
    let a = read("admission_vectors.json");
    let c = a["cases"].as_array().unwrap().iter().find(|c| c["name"] == "A_known_principal_strict").unwrap();
    let now = parse_rfc3339_millis(c["now"].as_str().unwrap()).unwrap();
    let profile = resolve_strict_v1_profile(&a["profiles"]["strict"]).unwrap();
    let trust = PrincipalTrustStore::from_json(&a["trust_sets"]["principal"]).unwrap();
    let empty = PrincipalTrustStore::from_json(&json!({"trust_set_version": "v", "principals": []})).unwrap();
    let base = a["signed_bundles"]["base"].clone();
    let strict = AdmitOptions { profile: Some(&profile), trust: Some(&trust), revocation: c.get("revocation"), now_ms: Some(now), ..Default::default() };
    let ok = admit_signed_bundle_v2(&base, &strict).unwrap();
    assert!(ok.verified && ok.admitted && ok.principal_trust == PrincipalTrust::Trusted && !ok.action_authorized, "{:?}", ok.errors);
    let mut bad = base.clone();
    bad["x_ext"] = json!(1);
    for (label, options) in [
        ("strict", strict),
        ("empty trust", AdmitOptions { trust: Some(&empty), now_ms: Some(now), ..Default::default() }),
        ("no trust", AdmitOptions { now_ms: Some(now), ..Default::default() }),
    ] {
        let r = admit_signed_bundle_v2(&bad, &options).unwrap();
        assert!(!r.verified && !r.admitted && r.principal_trust == PrincipalTrust::NotEvaluated && r.recorded_decision.is_none(), "{label}");
        assert_eq!(r.verification.result.errors, ["schema: / additionalProperties x_ext"], "{label}");
        assert!(r.verification.signer_keys.is_empty(), "{label}");
    }
    // An explicit empty trust set trusts nobody; without one, trust is not evaluated and the verified bundle is
    // admitted (both as before V2-2).
    let r = admit_signed_bundle_v2(&base, &AdmitOptions { trust: Some(&empty), now_ms: Some(now), ..Default::default() }).unwrap();
    assert!(r.verified && !r.admitted && r.principal_trust == PrincipalTrust::Untrusted, "{:?}", r.errors);
    let r = admit_signed_bundle_v2(&base, &AdmitOptions { now_ms: Some(now), ..Default::default() }).unwrap();
    assert!(r.verified && r.admitted && r.principal_trust == PrincipalTrust::NotEvaluated, "{:?}", r.errors);
}

#[test]
fn candidate_positive_schema_negative_no_opt_in_and_default_separation() {
    let p3: Value = serde_json::from_str(
        &std::fs::read_to_string(shared("../candidate/phase3-signed-vectors.json")).unwrap(),
    )
    .unwrap();
    let now = p3["now_ms"].as_i64().unwrap();
    let policy = VerifierPolicy::default();
    let text = p3["bases"]["B-v2"]["input_json"].as_str().unwrap();
    let opt_in = candidate(json!(["dcp-jcs-v2"]));
    let ok = opt_in.verify_at(text.as_bytes(), &policy, now).unwrap();
    assert_eq!((ok.entered, ok.verification.as_ref().map(|d| d.result.verified)), ("dcp-jcs-v2", Some(true)));
    let bad_text = format!("{{\"x_ext\":1,{}", &text.trim_start()[1..]);
    let bad = opt_in.verify_at(bad_text.as_bytes(), &policy, now).unwrap();
    assert_eq!(bad.entered, "dcp-jcs-v2");
    assert_v22_only("candidate negative", bad.verification.as_ref().unwrap(), "schema: / additionalProperties x_ext");
    // No opt-in: the public verifier refuses the candidate identifier by V2-2 (const dcp-jcs-v1).
    let parsed: Value = serde_json::from_str(text).unwrap();
    assert_eq!(verify_signed_bundle_v2_at(&parsed, &policy, now).result.errors, ["schema: /bundle/manifest/canonicalization_profile const"]);
    // Default separation: a v1-only verifier does not take the candidate, and a candidate-only one not dcp-jcs-v1.
    let v1_only = candidate(json!(["dcp-jcs-v1"]));
    let r = v1_only.verify_at(text.as_bytes(), &policy, now).unwrap();
    assert!(r.entered == "none" && r.verification.is_none() && matches!(r.route, CandidateRoute::Reject { .. }));
    let (w, wpolicy, wnow) = wiring();
    let base = serde_json::to_vec(&w["cases"][0]["signed_bundle"]).unwrap();
    let r = opt_in.verify_at(&base, &wpolicy, wnow).unwrap();
    assert!(matches!(&r.route, CandidateRoute::Reject { class, .. } if class == "PROFILE_NOT_ACCEPTED") && r.entered == "none");
    let r = v1_only.verify_at(&base, &wpolicy, wnow).unwrap();
    assert_eq!((r.entered, r.verification.map(|d| d.result.verified)), ("dcp-jcs-v1", Some(true)));
}

/// The historical rows: each document fails V2-2 alone, with the oracles' errors, and the rows that keep its deeper
/// check covered pass it (tests/interop.rs and tests/secondary_sha3.rs assert them per mode).
#[test]
fn the_56_regression_rows_and_their_coverage() {
    let b = read("bundle_vectors.json");
    let s = read("secondary_sha3_vectors.json");
    let historical = |fixture: &str, name: &str| -> Value {
        if fixture.ends_with("secondary_sha3_vectors.json") {
            let c = s["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap();
            let mut bundle = s["base"]["artifacts"].clone();
            bundle["dcp_bundle_version"] = json!("2.0");
            bundle["manifest"] = c["manifest"].clone();
            bundle["audit_entries"] = c["audit_entries"].clone();
            return json!({"bundle": bundle, "signature": c["signature"]});
        }
        for group in ["must_reject_bundles", "must_accept_bundles"] {
            if let Some(x) = b[group].as_array().unwrap().iter().find(|x| x["name"] == name) {
                return x["signed_bundle"].clone();
            }
        }
        let m = b["must_reject"].as_array().unwrap().iter().find(|x| x["name"] == name).unwrap();
        let mut d = b["signed_bundle"].clone();
        for mutation in m["mutations"].as_array().unwrap() {
            let mut node = &mut d;
            for k in mutation["path"].as_array().unwrap() {
                node = &mut node[k.as_str().unwrap()];
            }
            *node = mutation["value"].clone();
        }
        d
    };
    let deep = read("schema_validation/deep_negatives.json");
    let policy = VerifierPolicy::default();
    let rows = regression_map()["rows"].as_array().unwrap();
    let count = |f: &str| rows.iter().filter(|r| r["fixture"].as_str().unwrap().ends_with(f)).count();
    assert_eq!((count("bundle_vectors.json"), count("secondary_sha3_vectors.json")), (43, 13));
    for r in rows {
        let (fixture, name) = (r["fixture"].as_str().unwrap(), r["name"].as_str().unwrap());
        let mut errors = verify_signed_bundle_v2_at(&historical(fixture, name), &policy, 0).result.errors;
        errors.sort();
        assert_eq!(errors.len().min(17), errors.len());
        if errors.len() <= 16 {
            assert_eq!(errors, expected_diagnostics(r), "{name}");
        } else {
            assert!(errors.iter().all(|e| e.starts_with("schema: ")), "{name}: {errors:?}");
        }
        let cov = &r["deep_coverage"];
        for c in [Some(cov), cov.get("also")].into_iter().flatten().filter(|c| c["kind"] == "schema_valid_rows") {
            for n in c["rows"].as_array().unwrap() {
                let e = verify_signed_bundle_v2_at(&historical(c["fixture"].as_str().unwrap(), n.as_str().unwrap()), &policy, 0).result.errors;
                assert!(!e.iter().any(|e| e.starts_with("schema: ")), "{name}: coverage row {n} is not schema-valid: {e:?}");
            }
        }
        match cov["kind"].as_str().unwrap() {
            "schema_valid_rows" | "helper" | "structural" => {}
            "deep_negatives" => {
                for n in cov["cases"].as_array().unwrap() {
                    assert!(deep["cases"].as_array().unwrap().iter().any(|d| d["name"] == *n), "{name}: no deep negative {n}");
                }
            }
            k => panic!("{name}: coverage {k}"),
        }
    }
}

/// Schema-valid signed negatives that reach the checks the historical rows reached with schema-invalid input: the
/// temporal parsers of V2-4, V2-13 and V2-14 and the canonicalization of a fraction in an open, committed member.
#[test]
fn the_deep_negatives_reach_the_temporal_parsers_and_the_canonicalizer_past_v2_2() {
    let d = read("schema_validation/deep_negatives.json");
    let policy: VerifierPolicy = serde_json::from_value(d["verifier_policy"].clone()).unwrap();
    let now = parse_rfc3339_millis(d["verification_time"].as_str().unwrap()).unwrap();
    let cases = d["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 7);
    // Their positive control: the wiring base they are built from (deep_negatives.json has none of its own), verified
    // at their instant under their policy, so a failure shared by all of them cannot pass for each one's check.
    let (w, _, _) = wiring();
    let control = verify_signed_bundle_v2_at(&w["cases"][0]["signed_bundle"], &policy, now).result;
    assert_eq!(w["cases"][0]["name"], "base");
    assert!(control.verified && control.errors.is_empty(), "control: {:?}", control.errors);
    let mut missing = Vec::new();
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let r = verify_signed_bundle_v2_at(&c["signed_bundle"], &policy, now).result;
        let Some(want) = c["error_contains_by_sdk"]["rust"].as_str() else {
            missing.push(format!("{name}: {:?}", r.errors));
            continue;
        };
        let text = r.errors.join("\n");
        assert!(!r.verified && !text.contains("schema: ") && text.to_lowercase().contains(&want.to_lowercase()), "{name}: {:?}", r.errors);
    }
    assert!(missing.is_empty(), "no rust wording:\n{}", missing.join("\n"));
}

/// The wasm binding, natively (feature wasm): its version dispatch and JSON parse stay before the V2 verifier, which
/// now runs V2-2 first. A case without a V2 marker is "Unknown DCP version" there, before any schema check.
#[cfg(feature = "wasm")]
#[test]
fn the_57_signed_cases_through_the_wasm_binding() {
    let (w, _, _) = wiring();
    let (mut verified, mut v22, mut dispatch) = (0, 0, 0);
    for c in w["cases"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let text = match c.get("signed_bundle_text") {
            Some(t) => t.as_str().unwrap().to_string(),
            None => c["signed_bundle"].to_string(),
        };
        let r: Value = serde_json::from_str(&dcp_ai::wasm::wasm_verify_signed_bundle_v2(&text, None)).unwrap();
        let errors: Vec<&str> = r["errors"].as_array().unwrap().iter().map(|e| e.as_str().unwrap()).collect();
        if c["expect"]["verified"] == true {
            assert_eq!((r["verified"].as_bool(), errors.len()), (Some(true), 0), "{name}: {errors:?}");
            verified += 1;
        } else if errors == ["Unknown DCP version"] {
            assert_eq!(r["verified"], false, "{name}");
            assert!(dcp_ai::detect_dcp_version(&doc(c)).is_none(), "{name}");
            dispatch += 1;
        } else {
            assert_eq!(r["verified"], false, "{name}");
            let t = target(c);
            assert!(errors.iter().all(|e| e.starts_with("schema: ")) && errors.iter().any(|e| *e == t || e.starts_with(&format!("{t} "))), "{name}: {errors:?}");
            assert_eq!(r["signer_keys"], json!([]), "{name}");
            v22 += 1;
        }
    }
    assert_eq!(verified, 13);
    assert_eq!(v22 + dispatch, 44);
    eprintln!("wasm binding: 13 verified, {v22} V2-2, {dispatch} version dispatch");
}
