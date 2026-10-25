//! Admission (spec/profiles/admission): the shared vectors in
//! tests/interop/v2/admission_vectors.json, through the public API, and what
//! the vectors cannot express.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::{
    admit_signed_bundle_v2, evaluate_admission_v2, resolve_strict_v1_profile, revocation_subjects,
    verify_signed_bundle_v2, verify_signed_bundle_v2_at, verify_signed_bundle_v2_with_policy, AdmissionConfigError,
    AdmissionOptions, AdmissionResult, AdmitOptions, PrincipalTrust, PrincipalTrustStore, ProfileCompliance,
    StrictV1Profile,
};
use serde_json::{json, Value};

fn vectors() -> &'static Value {
    static VECTORS: OnceLock<Value> = OnceLock::new();
    VECTORS.get_or_init(|| {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/admission_vectors.json");
        serde_json::from_str(&std::fs::read_to_string(path).expect("read admission vectors")).expect("parse")
    })
}

fn bundle(name: &str) -> Value {
    vectors()["signed_bundles"][name].clone()
}

fn strict() -> StrictV1Profile {
    resolve_strict_v1_profile(&vectors()["profiles"]["strict"]).expect("strict profile")
}

fn principal() -> PrincipalTrustStore {
    PrincipalTrustStore::from_json(&vectors()["trust_sets"]["principal"]).expect("principal trust set")
}

fn case(name: &str) -> &'static Value {
    vectors()["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).expect(name)
}

fn millis(rfc3339: &Value) -> i64 {
    parse_rfc3339_millis(rfc3339.as_str().expect("RFC 3339 string")).expect("RFC 3339")
}

/// The clock of case A, inside the base bundle's session.
fn now() -> i64 {
    millis(&case("A_known_principal_strict")["now"])
}

fn codes(result: &AdmissionResult) -> Vec<&'static str> {
    result.errors.iter().map(|e| e.code).collect()
}

#[test]
fn admission_vectors() {
    let v = vectors();
    let cases = v["cases"].as_array().expect("cases");
    assert!(cases.len() >= 65, "the vectors lost cases: {}", cases.len());
    let mut failures = Vec::new();
    for c in cases {
        let profile = c["profile"].as_str().map(|id| resolve_strict_v1_profile(&v["profiles"][id]).expect(id));
        let trust = c["trust"].as_str().map(|id| PrincipalTrustStore::from_json(&v["trust_sets"][id]).expect(id));
        let options = AdmitOptions {
            profile: profile.as_ref(),
            trust: trust.as_ref(),
            // Absent and null both mean the source could not answer.
            revocation: c.get("revocation"),
            now_ms: Some(millis(&c["now"])),
            ..Default::default()
        };
        let result = admit_signed_bundle_v2(&v["signed_bundles"][c["bundle"].as_str().unwrap()], &options)
            .unwrap_or_else(|e| panic!("{}: {e}", c["name"]));
        let codes: BTreeSet<&str> = result.errors.iter().map(|e| e.code).collect();
        let got = json!({
            "verified": result.verified,
            "principal_trust": result.principal_trust,
            "profile_compliance": result.profile_compliance,
            "admitted": result.admitted,
            "recorded_decision": result.recorded_decision,
            "action_authorized": result.action_authorized,
            "codes": codes,
        });
        if got != c["expected"] {
            failures.push(format!(
                "{} ({}): got {got}, expected {}: {:?}",
                c["name"], c["rule"], c["expected"], result.errors
            ));
        }
        let profile_id = c["profile"].as_str().map(|_| "strict-v1");
        let version = c["trust"].as_str().map(|id| v["trust_sets"][id]["trust_set_version"].as_str().unwrap());
        if result.profile != profile_id || result.trust_set_version.as_deref() != version {
            failures.push(format!(
                "{}: profile {:?}, trust_set_version {:?}",
                c["name"], result.profile, result.trust_set_version
            ));
        }
    }
    assert!(failures.is_empty(), "{} of {} cases differ:\n{}", failures.len(), cases.len(), failures.join("\n"));
}

#[test]
fn configuration_vectors_are_refused_with_their_code() {
    let cases = vectors()["config_cases"].as_array().expect("config_cases");
    assert!(cases.len() >= 49, "the vectors lost configuration cases: {}", cases.len());
    let mut failures = Vec::new();
    for c in cases {
        let refused = match c["kind"].as_str() {
            Some("trust_set") => PrincipalTrustStore::from_json(&c["config"]).err(),
            Some("profile") => resolve_strict_v1_profile(&c["config"]).err(),
            kind => panic!("{}: unknown kind {kind:?}", c["name"]),
        };
        match refused {
            Some(e) if e.code == c["expected_code"] => {}
            other => {
                failures.push(format!("{} {}: {:?}, expected {}", c["kind"], c["name"], other, c["expected_code"]))
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn accepted_profiles_load_with_their_limits() {
    let cases = vectors()["accepted_profiles"].as_array().expect("accepted_profiles");
    assert!(cases.len() >= 2, "the vectors lost accepted profiles: {}", cases.len());
    for c in cases {
        let profile = resolve_strict_v1_profile(&c["config"]).unwrap_or_else(|e| panic!("{}: {e}", c["name"]));
        let session = c["expected_max_session_duration_seconds"].as_u64();
        assert_eq!(Some(profile.max_session_duration_seconds()), session, "{}", c["name"]);
        assert_eq!(Some(profile.max_revocation_age_seconds()), c["expected_max_revocation_age_seconds"].as_u64());
        assert_eq!(profile.policy().max_session_duration_seconds, session, "{}", c["name"]);
    }
}

/// "Integer" is a JSON number with an integer value, whatever its spelling.
#[test]
fn profile_limits_are_integers_in_any_spelling() {
    for (text, want) in [("1e2", 100), ("300.0", 300), ("120", 120)] {
        let config: Value = serde_json::from_str(&format!(
            r#"{{"profile":"strict-v1","verifier_id":"v","max_session_duration_seconds":{text},"max_revocation_age_seconds":{text}}}"#
        ))
        .unwrap();
        let profile = resolve_strict_v1_profile(&config).unwrap_or_else(|e| panic!("{text}: {e}"));
        assert_eq!((profile.max_session_duration_seconds(), profile.max_revocation_age_seconds()), (want, want));
    }
    for (value, code) in [
        (json!(120.5), "CONFIG_INVALID_VALUE"),
        (json!("300"), "CONFIG_INVALID_VALUE"),
        (json!(3e2 + 1.0), "CONFIG_PROFILE_CONTRADICTION"),
    ] {
        let config = json!({ "profile": "strict-v1", "verifier_id": "v", "max_revocation_age_seconds": value });
        assert_eq!(resolve_strict_v1_profile(&config).unwrap_err().code, code, "{value}");
    }
}

#[test]
fn the_verifier_reports_the_key_of_each_signature_component_it_verified() {
    let base = bundle("base");
    let result = verify_signed_bundle_v2_at(&base, &VerifierPolicy::default(), now());
    assert!(result.result.verified, "{:?}", result.result.errors);
    let rpr_keys = &base["bundle"]["responsible_principal_record"]["payload"]["binding_keys"];
    for signature in ["bundle", "responsible_principal_record"] {
        let reported: Vec<(&str, &str, bool)> = result
            .signer_keys
            .iter()
            .filter(|k| k.signature == signature)
            .map(|k| (k.component.as_str(), k.kid.as_str(), k.verified))
            .collect();
        let want = vec![
            ("classical", rpr_keys[0]["kid"].as_str().unwrap(), true),
            ("pq", rpr_keys[1]["kid"].as_str().unwrap(), true),
        ];
        assert_eq!(reported, want, "{signature}");
        for (key, entry) in
            result.signer_keys.iter().filter(|k| k.signature == signature).zip(rpr_keys.as_array().unwrap())
        {
            assert_eq!(
                (key.alg.as_str(), key.public_key_b64.as_str()),
                (entry["alg"].as_str().unwrap(), entry["public_key_b64"].as_str().unwrap())
            );
        }
    }
    // In the order the verifier checks them, each with both components.
    let order: Vec<&str> = result.signer_keys.iter().map(|k| k.signature.as_str()).collect();
    let mut want = Vec::new();
    for signature in ["bundle", "responsible_principal_record", "agent_passport", "intent", "policy_decision"] {
        want.extend([signature, signature]);
    }
    assert_eq!(order, want);

    // Serialized as signer_keys with the field names of § 2.3.
    let json = serde_json::to_value(&result).unwrap();
    let first = json["signer_keys"][0].as_object().unwrap();
    let fields: BTreeSet<&str> = first.keys().map(String::as_str).collect();
    assert_eq!(fields, BTreeSet::from(["signature", "component", "kid", "alg", "public_key_b64", "verified"]));
}

#[test]
fn a_component_that_fails_verification_is_reported_as_not_verified() {
    let result = verify_signed_bundle_v2_at(&bundle("pq_signature_invalid"), &VerifierPolicy::default(), now());
    assert!(!result.result.verified);
    assert!(result.signer_keys.iter().any(|k| k.component == "pq" && !k.verified), "{:?}", result.signer_keys);
    // A signature that never reaches the cryptographic check reports no key.
    let mut no_key = bundle("base");
    no_key["signature"]["composite_sig"]["classical"]["kid"] = json!("0".repeat(32));
    let result = verify_signed_bundle_v2_at(&no_key, &VerifierPolicy::default(), now());
    assert!(!result.signer_keys.iter().any(|k| k.signature == "bundle"), "{:?}", result.signer_keys);
}

#[test]
fn without_now_verification_and_admission_use_the_system_clock() {
    // The base bundle's session runs from 10:00 to 10:05 on 2 November 2026:
    // outside it, on the system clock, it does not verify; at the vector's now it does.
    let base = bundle("base");
    assert!(verify_signed_bundle_v2_at(&base, &VerifierPolicy::default(), now()).result.verified);
    let in_window = |t: i64| t >= millis(&json!("2026-11-02T09:59:30Z")) && t <= millis(&json!("2026-11-02T10:05:00Z"));
    let clock = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    let before = clock();
    let results = [
        verify_signed_bundle_v2(&base).verified,
        verify_signed_bundle_v2_with_policy(&base, &VerifierPolicy::default()).verified,
        admit_signed_bundle_v2(&base, &AdmitOptions::default()).unwrap().verified,
    ];
    let after = clock();
    if in_window(before) == in_window(after) {
        assert_eq!(results, [in_window(after); 3]);
    }
}

#[test]
fn revocation_subjects_are_the_agent_and_every_verified_signer_kid_sorted() {
    let base = bundle("base");
    let verification = verify_signed_bundle_v2_at(&base, &VerifierPolicy::default(), now());
    let subjects = revocation_subjects(&base, &verification);
    assert_eq!(subjects.agent_ids, ["agent:acme-bot"]);
    let kids: BTreeSet<&str> = verification.signer_keys.iter().map(|k| k.kid.as_str()).collect();
    assert_eq!(subjects.kids, kids.into_iter().collect::<Vec<_>>());
    assert_eq!(subjects.kids.len(), 4);
    // Unverified components are not subjects; neither is a non-string agent_id.
    let mut odd = base.clone();
    odd["bundle"]["agent_passport"]["payload"]["agent_id"] = json!(7);
    let mut unverified = verification.clone();
    unverified.signer_keys.iter_mut().for_each(|k| k.verified = false);
    let subjects = revocation_subjects(&odd, &unverified);
    assert!(subjects.agent_ids.is_empty() && subjects.kids.is_empty(), "{subjects:?}");
}

#[test]
fn a_loaded_profile_cannot_be_weakened() {
    let profile = strict();
    let policy = profile.policy();
    let tiers = ["low", "medium", "high"].map(|t| policy.risk_overrides.get(t).map(String::as_str));
    assert_eq!(policy.default_mode, "hybrid_required");
    assert_eq!(tiers, [Some("hybrid_required"); 3]);
    assert!(!policy.allow_v1_bundles && !policy.allow_classical_fallback_disable);
    assert!(policy.require_session_binding && policy.require_composite_binding);
    assert!(policy.require_session_expiry && policy.require_audience_binding);
    assert_eq!(policy.verifier_id.as_deref(), vectors()["verifier_id"].as_str());
    assert_eq!(policy.max_session_duration_seconds, Some(300));
    assert_eq!(profile.verifier_id(), "verifier:acme-api");
    assert_eq!(profile.profile(), "strict-v1");
    // The policy is read-only: a copy can change, the profile's cannot.
    let mut copy = profile.policy().clone();
    copy.allow_v1_bundles = true;
    copy.default_mode = "classical_only".into();
    assert!(!profile.policy().allow_v1_bundles);
    assert_eq!(profile.policy().default_mode, "hybrid_required");
}

#[test]
fn a_profile_without_a_trust_set_or_with_a_caller_policy_is_a_configuration_error() {
    let base = bundle("base");
    let profile = strict();
    let trust = principal();
    let verification = verify_signed_bundle_v2_at(&base, profile.policy(), now());
    let options = AdmissionOptions { profile: Some(&profile), trust: None, revocation: None, now_ms: now() };
    let error = evaluate_admission_v2(&base, &verification, &options).unwrap_err();
    assert_eq!(error.code, "CONFIG_PROFILE_CONTRADICTION");

    let with_policy = AdmitOptions {
        profile: Some(&profile),
        trust: Some(&trust),
        policy: Some(VerifierPolicy::default()),
        now_ms: Some(now()),
        ..Default::default()
    };
    assert_eq!(admit_signed_bundle_v2(&base, &with_policy).unwrap_err().code, "CONFIG_PROFILE_CONTRADICTION");
    let without_trust = AdmitOptions { profile: Some(&profile), now_ms: Some(now()), ..Default::default() };
    assert_eq!(admit_signed_bundle_v2(&base, &without_trust).unwrap_err().code, "CONFIG_PROFILE_CONTRADICTION");
}

#[test]
fn a_verification_under_a_permissive_policy_is_not_compliant_with_the_profile() {
    // The caller passed the result of a classical_only verification: the profile notices.
    let base = bundle("base");
    let permissive = VerifierPolicy {
        default_mode: "classical_only".into(),
        risk_overrides: ["low", "medium", "high"]
            .iter()
            .map(|t| (t.to_string(), "classical_only".to_string()))
            .collect(),
        ..VerifierPolicy::default()
    };
    let verification = verify_signed_bundle_v2_at(&base, &permissive, now());
    assert!(verification.result.verified, "{:?}", verification.result.errors);
    let (profile, trust) = (strict(), principal());
    let options = AdmissionOptions {
        profile: Some(&profile),
        trust: Some(&trust),
        revocation: case("A_known_principal_strict").get("revocation"),
        now_ms: now(),
    };
    let result = evaluate_admission_v2(&base, &verification, &options).unwrap();
    assert!(!result.admitted);
    assert_eq!(result.profile_compliance, ProfileCompliance::NonCompliant);
    assert!(codes(&result).contains(&"PROFILE_HYBRID_REQUIRED"), "{:?}", result.errors);
}

#[test]
fn action_authorized_is_false_even_for_an_admitted_approve_decision() {
    let (profile, trust) = (strict(), principal());
    let options = AdmitOptions {
        profile: Some(&profile),
        trust: Some(&trust),
        revocation: case("A_known_principal_strict").get("revocation"),
        now_ms: Some(now()),
        ..Default::default()
    };
    let result = admit_signed_bundle_v2(&bundle("base"), &options).unwrap();
    assert!(result.admitted);
    assert_eq!(result.principal_trust, PrincipalTrust::Trusted);
    assert_eq!(result.recorded_decision.as_deref(), Some("approve"));
    assert!(!result.action_authorized);
}

#[test]
fn the_result_serializes_with_the_field_names_of_the_spec() {
    let result =
        admit_signed_bundle_v2(&bundle("v1_bundle"), &AdmitOptions { now_ms: Some(now()), ..Default::default() })
            .unwrap();
    let json = serde_json::to_value(&result).unwrap();
    let fields: BTreeSet<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
    let want = [
        "verified",
        "verification",
        "principal_trust",
        "profile",
        "profile_compliance",
        "admitted",
        "action_authorized",
        "recorded_decision",
        "trust_set_version",
        "errors",
    ];
    assert_eq!(fields, BTreeSet::from(want));
    assert_eq!(json["profile"], Value::Null);
    assert_eq!(json["recorded_decision"], Value::Null);
    assert_eq!(json["trust_set_version"], Value::Null);
    assert_eq!(json["principal_trust"], "not_evaluated");
    assert_eq!(json["profile_compliance"], "not_evaluated");
    assert_eq!(json["errors"][0]["code"], "VERIFICATION_FAILED");
    assert!(json["errors"][0]["message"].is_string());
    assert!(json["verification"]["signer_keys"].is_array());
}

#[test]
fn error_messages_are_bounded_and_carry_no_key_material() {
    let trust = principal();
    let set = &vectors()["trust_sets"]["principal"];
    let public_keys: Vec<&str> = set["principals"][0]["keys"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k["public_key_b64"].as_str().unwrap())
        .collect();
    let check = |result: &AdmissionResult| {
        for e in &result.errors {
            assert!(e.message.chars().count() <= 500, "{}: {} characters", e.code, e.message.chars().count());
        }
        let text = serde_json::to_string(&result.errors).unwrap();
        for key in &public_keys {
            assert!(!text.contains(key), "an error message carries a public key");
        }
    };

    let mut huge = bundle("base");
    huge["bundle"]["responsible_principal_record"]["payload"]["human_id"] = json!("x".repeat(100_000));
    let options = AdmitOptions { trust: Some(&trust), now_ms: Some(now()), ..Default::default() };
    check(&admit_signed_bundle_v2(&huge, &options).unwrap());

    // A verifier error that repeats a long value is cut.
    let mut long = bundle("base");
    long["bundle"]["manifest"]["canonicalization_profile"] = json!("y".repeat(100_000));
    let result = admit_signed_bundle_v2(&long, &options).unwrap();
    let first = &result.errors[0];
    assert_eq!(first.code, "VERIFICATION_FAILED");
    assert!(first.message.ends_with('…'), "{}", first.message.chars().take(120).collect::<String>());
    check(&result);

    // Trust codes name keys by kid only, never by their bytes.
    let (profile, stranger) =
        (strict(), PrincipalTrustStore::from_json(&vectors()["trust_sets"]["classical_only_trusted"]).unwrap());
    let options = AdmitOptions {
        profile: Some(&profile),
        trust: Some(&stranger),
        revocation: case("A_known_principal_strict").get("revocation"),
        now_ms: Some(now()),
        ..Default::default()
    };
    let result = admit_signed_bundle_v2(&bundle("attacker_claims_known_human_id"), &options).unwrap();
    assert!(codes(&result).contains(&"TRUST_KEY_NOT_ANCHORED"), "{:?}", result.errors);
    check(&result);
}

#[test]
fn configuration_errors_display_their_code() {
    let error = resolve_strict_v1_profile(&json!({ "profile": "strict-v1" })).unwrap_err();
    assert_eq!(error.to_string(), format!("CONFIG_PROFILE_CONTRADICTION: {}", error.message));
    let boxed: Box<dyn std::error::Error> = Box::new(error.clone());
    assert_eq!(boxed.to_string(), error.to_string());
    let _: &AdmissionConfigError = &error;
    // A long unknown field name is cut in the message.
    let mut config = json!({ "profile": "strict-v1", "verifier_id": "v" });
    config["z".repeat(10_000)] = json!(true);
    let error = resolve_strict_v1_profile(&config).unwrap_err();
    assert_eq!(error.code, "CONFIG_UNKNOWN_FIELD");
    assert!(error.message.chars().count() < 120, "{}", error.message);
}

/// A profile may narrow the accepted classical and PQ algorithms, which the
/// verifier enforces: the base bundle's ML-DSA-65 signatures are admitted
/// under `["ml-dsa-65"]` and fail verification under `["slh-dsa-192f"]`.
#[test]
fn a_profile_narrowing_the_accepted_algorithms_is_enforced() {
    let trust = principal();
    let admit = |pq_algs: Value| {
        let config = json!({
            "profile": "strict-v1", "verifier_id": "verifier:acme-api",
            "verifier_policy": { "accepted_classical_algs": ["ed25519"], "accepted_pq_algs": pq_algs },
        });
        let profile = resolve_strict_v1_profile(&config).unwrap();
        let options = AdmitOptions {
            profile: Some(&profile),
            trust: Some(&trust),
            revocation: case("A_known_principal_strict").get("revocation"),
            now_ms: Some(now()),
            ..Default::default()
        };
        admit_signed_bundle_v2(&bundle("base"), &options).unwrap()
    };
    let result = admit(json!(["ml-dsa-65"]));
    assert!(result.admitted, "{:?}", result.errors);
    let result = admit(json!(["slh-dsa-192f"]));
    assert!(!result.admitted);
    assert_eq!(codes(&result), ["VERIFICATION_FAILED"]);
    assert!(
        result.verification.result.errors.iter().any(|e| e.contains("PQ algorithm ml-dsa-65 not accepted by verifier policy")),
        "{:?}",
        result.verification.result.errors
    );
}

/// min_classical, min_pq, max_key_age_days and accepted_hash_algs are fixed:
/// restating them loads, any other value is a contradiction.
#[test]
fn a_profile_fixes_the_fields_verifiers_do_not_enforce_alike() {
    let load = |field: &str, value: Value| {
        let config = json!({ "profile": "strict-v1", "verifier_id": "v", "verifier_policy": { field: value } });
        resolve_strict_v1_profile(&config).map(|_| ()).map_err(|e| e.code)
    };
    for (field, value) in [
        ("min_classical", json!(1)),
        ("min_pq", json!(1.0)),
        ("max_key_age_days", json!(365)),
        ("accepted_hash_algs", json!(["sha384", "sha256"])),
    ] {
        assert_eq!(load(field, value.clone()), Ok(()), "{field}: {value}");
    }
    for (field, value, code) in [
        ("min_classical", json!(2), "CONFIG_PROFILE_CONTRADICTION"),
        ("min_pq", json!(0), "CONFIG_PROFILE_CONTRADICTION"),
        ("min_pq", json!("1"), "CONFIG_INVALID_VALUE"),
        ("max_key_age_days", json!(30), "CONFIG_PROFILE_CONTRADICTION"),
        ("max_key_age_days", json!(365.5), "CONFIG_INVALID_VALUE"),
        ("accepted_hash_algs", json!(["sha256"]), "CONFIG_PROFILE_CONTRADICTION"),
        ("accepted_hash_algs", json!(["sha256", "sha256"]), "CONFIG_PROFILE_CONTRADICTION"),
        ("accepted_hash_algs", json!(["sha256", "sha384", "sha384"]), "CONFIG_PROFILE_CONTRADICTION"),
        ("accepted_hash_algs", json!("sha256"), "CONFIG_INVALID_VALUE"),
    ] {
        assert_eq!(load(field, value.clone()), Err(code), "{field}: {value}");
    }
}

/// A field outside the schema is reported before any value of
/// verifier_policy, whatever the order of its keys.
#[test]
fn unknown_policy_fields_are_reported_first() {
    let config = json!({
        "profile": "strict-v1", "verifier_id": "v",
        "verifier_policy": { "aaa": true, "default_mode": "pq_only", "zzz": 1 },
    });
    assert_eq!(resolve_strict_v1_profile(&config).unwrap_err().code, "CONFIG_UNKNOWN_FIELD");
}
