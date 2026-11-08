//! Delegated admission (MP-02 F2): the shared vectors of tests/interop/v2/delegated_admission_vectors.json
//! through the public API, the policy contract (R4), the mandate preflight and loaded and raw configuration.
//! The floor step, the contract-checked gate and the schema tables are tested inside the crate
//! (src/v2/delegated_admission.rs). The evidence and configuration are taken by shared reference, so there is
//! no snapshot to test: they cannot change during the call. Mirrors
//! sdks/typescript/src/__tests__/delegated-admission.test.ts.

use std::collections::BTreeSet;

use dcp_ai::v2::{
    admit_delegated_bundle_v2, admit_signed_bundle_v2, resolve_strict_v1_profile, AdmitOptions, DelegatedAdmissionResult,
    DelegatedEvidence, DelegatedOperator, PrincipalTrustStore,
};
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::types::VerifierPolicy;
use serde_json::{json, Value};

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/delegated_admission_vectors.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("vectors")).expect("json")
}

fn named<'a>(v: &'a Value, field: &str, name: Option<&str>) -> Option<&'a Value> {
    name.map(|n| &v[field][n])
}

struct Inputs {
    chain: Vec<Value>,
    delegators: Vec<Value>,
}

fn inputs(v: &Value, c: &Value) -> Inputs {
    let list = |field: &str, from: &str| -> Vec<Value> {
        c[field].as_array().unwrap().iter().map(|n| v[from][n.as_str().unwrap()].clone()).collect()
    };
    Inputs { chain: list("chain", "mandates"), delegators: list("delegators", "signed_bundles") }
}

fn now(v: &Value) -> i64 {
    parse_rfc3339_millis(v["now"].as_str().unwrap()).unwrap()
}

fn operator<'a>(v: &'a Value, c: &'a Value) -> DelegatedOperator<'a> {
    DelegatedOperator {
        trust_set: Some(&v["trust_sets"][c["trust"].as_str().unwrap()]),
        profile_config: named(v, "profiles", c["profile"].as_str()),
        policy: named(v, "policies", c["policy"].as_str()),
        revocation: named(v, "revocations", c["revocation"].as_str()),
        mandate_revocation: named(v, "mandate_revocations", c["mandate_revocation"].as_str()),
        max_revocation_age_seconds: c["max_revocation_age_seconds"].as_u64(),
        now_ms: Some(now(v)),
        ..Default::default()
    }
}

fn run(v: &Value, c: &Value, op: &DelegatedOperator<'_>) -> DelegatedAdmissionResult {
    let i = inputs(v, c);
    let evidence = DelegatedEvidence {
        signed_bundle: &v["signed_bundles"][c["leaf"].as_str().unwrap()],
        mandate_chain: &i.chain,
        delegator_bundles: &i.delegators,
    };
    admit_delegated_bundle_v2(&evidence, op).expect("configuration")
}

fn codes(r: &DelegatedAdmissionResult) -> Vec<String> {
    r.errors.iter().map(|e| e.code.to_string()).collect::<BTreeSet<_>>().into_iter().collect()
}

fn case<'a>(v: &'a Value, name: &str) -> &'a Value {
    v["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).expect(name)
}

#[test]
fn delegated_admission_vectors() {
    let v = vectors();
    let cases = v["cases"].as_array().unwrap();
    assert_eq!((cases.len(), v["config_cases"].as_array().unwrap().len()), (71, 6));
    let mut failures = Vec::new();
    for c in cases {
        let r = run(&v, c, &operator(&v, c));
        let e = &c["expected"];
        let mut want: Vec<String> = e["codes"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        want.sort();
        let mut ok = r.admitted == e["admitted"] && r.delegation_verified == e["delegation_verified"] && codes(&r) == want;
        ok &= r.activation == "not_evaluated" && !r.delegation_active && !r.action_authorized;
        let text = |o: &Option<String>| o.clone().map(Value::from).unwrap_or(Value::Null);
        if let Some(t) = e.get("security_tier") {
            ok &= text(&r.security_tier) == *t;
        }
        if let Some(m) = e.get("verification_mode") {
            ok &= text(&r.verification_mode) == *m;
        }
        if let Some(f) = e.get("effective_floor") {
            ok &= r.chain.as_ref().map(|ch| text(&ch.effective_floor)).unwrap_or(Value::Null) == *f;
        }
        if let Some(expected) = c.get("control_public_admitted") {
            let policy: VerifierPolicy = serde_json::from_value(v["policies"][c["policy"].as_str().unwrap()].clone()).unwrap();
            let store = PrincipalTrustStore::from_json(&v["trust_sets"][c["trust"].as_str().unwrap()]).unwrap();
            let public = admit_signed_bundle_v2(
                &v["signed_bundles"][c["leaf"].as_str().unwrap()],
                &AdmitOptions { policy: Some(policy), trust: Some(&store), now_ms: Some(now(&v)), ..Default::default() },
            )
            .unwrap();
            ok &= Value::Bool(public.admitted) == *expected;
        }
        if !ok {
            let messages: Vec<&str> = r.errors.iter().map(|e| e.message.as_str()).collect();
            failures.push(format!("{}: admitted={} delegation_verified={} codes={:?} want {} {:?}\n  {}", c["name"], r.admitted, r.delegation_verified, codes(&r), e, want, messages.join("\n  ")));
        }
    }
    for c in v["config_cases"].as_array().unwrap() {
        let o = &c["operator"];
        let op = DelegatedOperator {
            trust_set: named(&v, "trust_sets", o["trust"].as_str()),
            profile_config: named(&v, "profiles", o["profile"].as_str()),
            policy: named(&v, "policies", o["policy"].as_str()),
            revocation: Some(&v["revocations"]["all_not_revoked"]),
            mandate_revocation: Some(&v["mandate_revocations"]["all_not_revoked"]),
            max_revocation_age_seconds: o["max_revocation_age_seconds"].as_u64(),
            now_ms: Some(now(&v)),
            ..Default::default()
        };
        let chain = vec![v["mandates"]["root"].clone()];
        let evidence = DelegatedEvidence { signed_bundle: &v["signed_bundles"]["orch"], mandate_chain: &chain, delegator_bundles: &[] };
        match admit_delegated_bundle_v2(&evidence, &op) {
            Err(e) if e.code == c["expected_code"] => {}
            other => failures.push(format!("config {}: {:?}", c["name"], other.map(|r| r.admitted))),
        }
    }
    assert!(failures.is_empty(), "{} failure(s):\n{}", failures.len(), failures.join("\n"));
}

fn policy_with(base: &Value, change: Value) -> Value {
    let mut p = base.clone();
    for (k, x) in change.as_object().unwrap() {
        if x.is_null() {
            p.as_object_mut().unwrap().remove(k);
        } else {
            p[k] = x.clone();
        }
    }
    p
}

#[test]
fn policy_contract() {
    let v = vectors();
    let weak_case = case(&v, "no_floor_weak_policy");
    let pq_case = case(&v, "pq_only_stays_with_routine_floor");
    let weak = &v["policies"]["weak_classical"];
    let default = serde_json::to_value(VerifierPolicy::default()).unwrap();
    let with = |c: &Value, policy: &Value| {
        let i = inputs(&v, c);
        let evidence = DelegatedEvidence { signed_bundle: &v["signed_bundles"][c["leaf"].as_str().unwrap()], mandate_chain: &i.chain, delegator_bundles: &i.delegators };
        admit_delegated_bundle_v2(&evidence, &DelegatedOperator { policy: Some(policy), ..operator(&v, c) })
    };
    let reversed = json!({"accepted_hash_algs": ["sha384", "sha256"]});
    for (name, c, policy) in [
        ("weak_classical with reversed hashes", weak_case, policy_with(weak, reversed.clone())),
        ("DEFAULT with reversed hashes", weak_case, policy_with(&default, reversed.clone())),
        ("the PQ_ONLY preset with reversed hashes", pq_case, policy_with(&v["policies"]["pq_only"], reversed.clone())),
        ("integral floats", weak_case, policy_with(weak, json!({"min_pq": 1.0, "min_classical": 1.0, "max_key_age_days": 365.0}))),
        ("max_session_duration_seconds 0", weak_case, policy_with(weak, json!({"max_session_duration_seconds": 0}))),
        ("max_session_duration_seconds 2147483647", weak_case, policy_with(weak, json!({"max_session_duration_seconds": 2147483647u64}))),
        ("max_session_duration_seconds 300.0", weak_case, policy_with(weak, json!({"max_session_duration_seconds": 300.0}))),
    ] {
        let r = with(c, &policy).unwrap_or_else(|e| panic!("{}: {}", name, e));
        assert!(r.admitted, "{}: {:?}", name, r.errors);
    }
    for (name, change, code) in [
        ("min_pq 2 (R4)", json!({"min_pq": 2}), "CONFIG_INVALID_VALUE"),
        ("min_classical 2 (R4)", json!({"min_classical": 2}), "CONFIG_INVALID_VALUE"),
        ("accepted_hash_algs sha384 (R4)", json!({"accepted_hash_algs": ["sha384"]}), "CONFIG_INVALID_VALUE"),
        ("max_key_age_days 1 (R4)", json!({"max_key_age_days": 1}), "CONFIG_INVALID_VALUE"),
        ("max_key_age_days 364", json!({"max_key_age_days": 364}), "CONFIG_INVALID_VALUE"),
        ("min_pq 0", json!({"min_pq": 0}), "CONFIG_INVALID_VALUE"),
        ("min_classical 0 outside pq_only", json!({"min_classical": 0}), "CONFIG_INVALID_VALUE"),
        ("require_composite_binding false outside pq_only", json!({"require_composite_binding": false}), "CONFIG_INVALID_VALUE"),
        ("require_session_binding false", json!({"require_session_binding": false}), "CONFIG_INVALID_VALUE"),
        ("accepted_hash_algs sha256 twice", json!({"accepted_hash_algs": ["sha256", "sha256"]}), "CONFIG_INVALID_VALUE"),
        ("accepted_hash_algs with a third", json!({"accepted_hash_algs": ["sha256", "sha384", "sha512"]}), "CONFIG_INVALID_VALUE"),
        ("max_session_duration_seconds 2147483648", json!({"max_session_duration_seconds": 2147483648u64}), "CONFIG_INVALID_VALUE"),
        ("max_session_duration_seconds 2147483648.0", json!({"max_session_duration_seconds": 2147483648.0}), "CONFIG_INVALID_VALUE"),
        ("max_session_duration_seconds -1", json!({"max_session_duration_seconds": -1}), "CONFIG_INVALID_VALUE"),
        ("max_session_duration_seconds true", json!({"max_session_duration_seconds": true}), "CONFIG_INVALID_VALUE"),
        ("max_session_duration_seconds 1.5", json!({"max_session_duration_seconds": 1.5}), "CONFIG_INVALID_VALUE"),
        ("require_session_binding 0 (R2)", json!({"require_session_binding": 0}), "CONFIG_INVALID_VALUE"),
        ("unknown member (R2)", json!({"unknown_setting": true}), "CONFIG_UNKNOWN_FIELD"),
        ("max_key_age_days \"365\" (R2)", json!({"max_key_age_days": "365"}), "CONFIG_INVALID_VALUE"),
        ("max_key_age_days true", json!({"max_key_age_days": true}), "CONFIG_INVALID_VALUE"),
        ("unknown mode", json!({"default_mode": "hybrid"}), "CONFIG_INVALID_VALUE"),
        ("risk tier missing", json!({"risk_overrides": {"low": "classical_only", "medium": "classical_only"}}), "CONFIG_INVALID_VALUE"),
        ("unknown risk tier", json!({"risk_overrides": {"low": "classical_only", "medium": "classical_only", "high": "classical_only", "extreme": "pq_only"}}), "CONFIG_UNKNOWN_FIELD"),
        ("empty classical list", json!({"accepted_classical_algs": []}), "CONFIG_INVALID_VALUE"),
        ("required member missing", json!({"allow_v1_bundles": null}), "CONFIG_INVALID_VALUE"),
    ] {
        match with(weak_case, &policy_with(weak, change)) {
            Err(e) if e.code == code => {}
            other => panic!("{}: {:?}", name, other.map(|r| r.admitted)),
        }
    }
    let mixed = policy_with(&v["policies"]["pq_only"], json!({"risk_overrides": {"low": "pq_only", "medium": "pq_only", "high": "hybrid_required"}}));
    assert!(matches!(with(pq_case, &mixed), Err(e) if e.code == "CONFIG_INVALID_VALUE"));
}

#[test]
fn preflight_rejects() {
    let v = vectors();
    let c = case(&v, "principal_orchestrator_subagent");
    let base = inputs(&v, c);
    let check = |name: &str, edit: &dyn Fn(&mut Vec<Value>), message: Option<&str>| {
        let mut chain = base.chain.clone();
        edit(&mut chain);
        let evidence = DelegatedEvidence { signed_bundle: &v["signed_bundles"]["sub"], mandate_chain: &chain, delegator_bundles: &base.delegators };
        let r = admit_delegated_bundle_v2(&evidence, &operator(&v, c)).unwrap();
        match message {
            Some(m) => assert!(codes(&r) == ["DELEGATION_CHAIN_INVALID"] && r.errors.iter().any(|e| e.message.contains(m)), "{}: {:?}", name, r.errors),
            None => assert!(r.admitted, "{}: {:?}", name, r.errors),
        }
    };
    check("root with parent_mandate_id", &|c| c[0]["parent_mandate_id"] = json!("mandate:parent"), Some("a root mandate has no parent_mandate_id"));
    check("root with delegation_depth 1", &|c| c[0]["delegation_depth"] = json!(1), Some("a root mandate has delegation_depth 0"));
    check("sub-mandate without delegation_depth", &|c| { c[1].as_object_mut().unwrap().remove("delegation_depth"); }, Some("missing delegation_depth"));
    check("sub-mandate without parent_mandate_id", &|c| { c[1].as_object_mut().unwrap().remove("parent_mandate_id"); }, Some("missing parent_mandate_id"));
    check("scope entry without actions_permitted", &|c| { c[1]["authority_scope"][0].as_object_mut().unwrap().remove("actions_permitted"); }, Some("is missing actions_permitted"));
    check("limits that is not an object", &|c| c[1]["authority_scope"][0]["limits"] = json!([]), Some("limits must be an object"));
    check("unknown tier", &|c| c[0]["minimum_security_tier"] = json!("critical"), Some("minimum_security_tier is not"));
    check("delegation_depth true", &|c| c[1]["delegation_depth"] = json!(true), Some("delegation_depth must be an integer"));
    // An integral float depth is an integer, and canonicalizes as 1: the signature still verifies.
    check("delegation_depth 1.0", &|c| c[1]["delegation_depth"] = json!(1.0), None);
}

#[test]
fn loaded_and_raw_configuration() {
    let v = vectors();
    let c = case(&v, "principal_orchestrator_subagent");
    let store = PrincipalTrustStore::from_json(&v["trust_sets"][c["trust"].as_str().unwrap()]).unwrap();
    let profile = resolve_strict_v1_profile(&v["profiles"][c["profile"].as_str().unwrap()]).unwrap();
    let loaded = DelegatedOperator { trust: Some(&store), trust_set: None, profile: Some(&profile), profile_config: None, ..operator(&v, c) };
    let r = run(&v, c, &loaded);
    assert!(r.admitted && codes(&r) == codes(&run(&v, c, &operator(&v, c))), "{:?}", r.errors);
    let i = inputs(&v, c);
    let evidence = DelegatedEvidence { signed_bundle: &v["signed_bundles"]["sub"], mandate_chain: &i.chain, delegator_bundles: &i.delegators };
    let both = DelegatedOperator { trust: Some(&store), ..operator(&v, c) };
    assert!(matches!(admit_delegated_bundle_v2(&evidence, &both), Err(e) if e.code == "CONFIG_INVALID_VALUE"));
}
