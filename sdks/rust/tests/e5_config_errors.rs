//! E5 gaps found in MP-03 P4: an operator configuration error is a typed error, never a result, through two public
//! functions whose own tests did not reach it. Mirrors sdks/typescript/src/__tests__/e5-config-errors.test.ts.
//!
//! - `admit_signed_bundle_v2_from_bytes`: on bytes its ingress accepts, `IngressError::Config` with the code
//!   `admit_signed_bundle_v2` gives for the same options. On bytes the ingress rejects, the ingress decides first
//!   (scanner, domain, parser, then admission, where the configuration is read): `Ok` with the rejection, no admission.
//! - `evaluate_delegation_activation_v2`: the 6 config_cases of delegated_admission_vectors.json give the
//!   `AdmissionConfigError` and code `admit_delegated_bundle_v2` gives (tests/delegated_admission.rs), before any
//!   evidence is read.

use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::{
    admit_signed_bundle_v2, admit_signed_bundle_v2_from_bytes, evaluate_delegation_activation_v2, resolve_strict_v1_profile,
    ActivationEvidence, AdmitOptions, DelegatedEvidence, DelegatedOperator, IngressError, PrincipalTrustStore,
};
use serde_json::Value;

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/delegated_admission_vectors.json");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

#[test]
fn from_bytes_config_errors() {
    let v = vectors();
    let now = parse_rfc3339_millis(v["now"].as_str().unwrap()).unwrap();
    let bundle = &v["signed_bundles"]["orch"];
    let bytes = serde_json::to_vec(bundle).unwrap();
    let profile = resolve_strict_v1_profile(&v["profiles"]["strict"]).unwrap();
    let store = PrincipalTrustStore::from_json(&v["trust_sets"]["base"]).unwrap();
    let revocation = &v["revocations"]["all_not_revoked"];
    let policy: VerifierPolicy = serde_json::from_value(v["policies"]["weak_classical"].clone()).unwrap();
    let strict = || AdmitOptions { profile: Some(&profile), trust: Some(&store), revocation: Some(revocation), now_ms: Some(now), ..Default::default() };

    let control = admit_signed_bundle_v2_from_bytes(&bytes, &strict()).unwrap();
    assert!(control.ingress.accepted && control.admission.as_ref().is_some_and(|a| a.admitted), "control");

    let bad: Vec<(&str, AdmitOptions)> = vec![
        ("a profile with a verifier policy", AdmitOptions { policy: Some(policy.clone()), ..strict() }),
        ("a profile without a trust set", AdmitOptions { trust: None, ..strict() }),
    ];
    for (name, options) in &bad {
        let object = admit_signed_bundle_v2(bundle, options).expect_err(name);
        assert_eq!(object.code, "CONFIG_PROFILE_CONTRADICTION", "{name}");
        match admit_signed_bundle_v2_from_bytes(&bytes, options) {
            Err(IngressError::Config(e)) => assert_eq!(e.code, object.code, "{name}"),
            other => panic!("{name}: {:?}", other.map(|r| r.ingress)),
        }
        let rejected = admit_signed_bundle_v2_from_bytes(b"{", options).expect(name);
        assert!(!rejected.ingress.accepted && rejected.ingress.layer.as_deref() == Some("scanner"), "{name}");
        assert!(rejected.admission.is_none(), "{name}");
    }
}

#[test]
fn activation_config_errors() {
    let v = vectors();
    let now = parse_rfc3339_millis(v["now"].as_str().unwrap()).unwrap();
    let configs = v["config_cases"].as_array().unwrap();
    assert_eq!(configs.len(), 6);
    let named = |field: &str, name: Option<&str>| name.map(|n| &v[field][n]);
    let chain = vec![v["mandates"]["root"].clone()];
    for c in configs {
        let o = &c["operator"];
        let op = DelegatedOperator {
            trust_set: named("trust_sets", o["trust"].as_str()),
            profile_config: named("profiles", o["profile"].as_str()),
            policy: named("policies", o["policy"].as_str()),
            revocation: Some(&v["revocations"]["all_not_revoked"]),
            mandate_revocation: Some(&v["mandate_revocations"]["all_not_revoked"]),
            max_revocation_age_seconds: o["max_revocation_age_seconds"].as_u64(),
            now_ms: Some(now),
            ..Default::default()
        };
        let evidence = ActivationEvidence {
            evidence: DelegatedEvidence { signed_bundle: &v["signed_bundles"]["orch"], mandate_chain: &chain, delegator_bundles: &[] },
            acknowledgments: &[],
            awareness_thresholds: &[],
        };
        match evaluate_delegation_activation_v2(&evidence, &op) {
            Err(e) => assert_eq!(e.code, c["expected_code"], "{}", c["name"]),
            Ok(r) => panic!("{}: a result, admitted {}", c["name"], r.composition.admitted),
        }
    }
}
