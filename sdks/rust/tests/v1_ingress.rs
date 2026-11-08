//! Admission from bytes (MP-02 F3): tests/interop/v2/v1_ingress_vectors.json with the two candidate corpora it
//! pins, the signed bundles of delegated_admission_vectors.json, and a subslice of a larger buffer. The input
//! is a shared borrow, so no test of a copy is needed; the parser fault is tested inside the module
//! (src/v2/v1_ingress.rs), where the private route is. Mirrors sdks/typescript/src/__tests__/v1-ingress.test.ts.

use dcp_ai::v2::experimental_candidate_ingress::{experimental_candidate_ingress, CandidateIngressOutcome};
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::{
    admit_signed_bundle_v2, admit_signed_bundle_v2_from_bytes, resolve_strict_v1_profile, AdmitOptions,
    IngressOutcome, PrincipalTrustStore,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

fn read(path: &str) -> Vec<u8> {
    std::fs::read(format!("{ROOT}/{path}")).expect(path)
}

fn sha(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

fn ingress_vectors() -> Value {
    serde_json::from_slice(&read("tests/interop/v2/v1_ingress_vectors.json")).unwrap()
}

fn delegated_vectors() -> Value {
    serde_json::from_slice(&read("tests/interop/v2/delegated_admission_vectors.json")).unwrap()
}

fn accepted(unit_sha256: &str, canonical_sha256: &str) -> IngressOutcome {
    IngressOutcome {
        accepted: true,
        layer: None,
        class: None,
        offset: None,
        unit_sha256: unit_sha256.into(),
        canonical_sha256: Some(canonical_sha256.into()),
    }
}

fn rejected(layer: &str, class: &str, offset: Option<usize>, unit_sha256: &str) -> IngressOutcome {
    IngressOutcome {
        accepted: false,
        layer: Some(layer.into()),
        class: Some(class.into()),
        offset,
        unit_sha256: unit_sha256.into(),
        canonical_sha256: None,
    }
}

/// The strict-v1 configuration the signed bundles are admitted under.
struct Strict {
    profile: dcp_ai::v2::StrictV1Profile,
    store: PrincipalTrustStore,
    revocation: Value,
    now: i64,
}

impl Strict {
    fn new(v: &Value) -> Self {
        Strict {
            profile: resolve_strict_v1_profile(&v["profiles"]["strict"]).unwrap(),
            store: PrincipalTrustStore::from_json(&v["trust_sets"]["base"]).unwrap(),
            revocation: v["revocations"]["all_not_revoked"].clone(),
            now: parse_rfc3339_millis(v["now"].as_str().unwrap()).unwrap(),
        }
    }

    fn options(&self) -> AdmitOptions<'_> {
        AdmitOptions {
            profile: Some(&self.profile),
            trust: Some(&self.store),
            revocation: Some(&self.revocation),
            now_ms: Some(self.now),
            ..Default::default()
        }
    }
}

#[test]
fn the_168_unit_cases_of_the_candidate_corpora() {
    let iv = ingress_vectors();
    let differences: std::collections::BTreeMap<&str, &Value> =
        iv["domain_differences"].as_array().unwrap().iter().map(|d| (d["id"].as_str().unwrap(), d)).collect();
    assert_eq!(differences.len(), 30);
    let mut failures = Vec::new();
    let mut counts = Vec::new();
    let mut ids = std::collections::BTreeSet::new();
    for s in iv["sources"].as_array().unwrap() {
        let path = s["path"].as_str().unwrap();
        let raw = read(path);
        assert_eq!(sha(&raw), s["sha256"].as_str().unwrap(), "{path}");
        let file: Value = serde_json::from_slice(&raw).unwrap();
        let cases: Vec<&Value> = file["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| path.ends_with("baseline-corpus.json") || (c["mode"] == "document" && c["transport"] == "bare"))
            .collect();
        assert_eq!(cases.len() as u64, s["count"].as_u64().unwrap(), "{path}");
        counts.push(cases.len());
        for c in cases {
            let id = c["id"].as_str().unwrap();
            ids.insert(id.to_string());
            let unit = match c.get("input_hex") {
                Some(h) => hex::decode(h.as_str().unwrap()).unwrap(),
                None => c["input_json"].as_str().unwrap().as_bytes().to_vec(),
            };
            let unit_sha = c["input_sha256"].as_str().unwrap();
            assert_eq!(sha(&unit), unit_sha, "{id}");
            let r = admit_signed_bundle_v2_from_bytes(&unit, &AdmitOptions::default()).unwrap();
            let e = &c["expected"];
            let is_accepted = if e.is_string() { e == "accept" } else { e["result"] == "accept" };
            let want = if let Some(d) = differences.get(id) {
                assert!(is_accepted && d["input_sha256"] == c["input_sha256"], "{id}: the scanner accepts it; only the domain rejects");
                let x = &d["expected"];
                rejected(x["layer"].as_str().unwrap(), x["class"].as_str().unwrap(), x["offset"].as_u64().map(|o| o as usize), unit_sha)
            } else if !is_accepted {
                let CandidateIngressOutcome::Reject { class, offset } = experimental_candidate_ingress(&unit).unwrap() else {
                    panic!("{id}: the scanner accepts a case its corpus rejects");
                };
                let cls = if e.is_string() { c["reject_class"].as_str().unwrap() } else { e["class"].as_str().unwrap() };
                assert_eq!(class.as_str(), cls, "{id}");
                if !e.is_string() {
                    assert_eq!(Some(offset as u64), e["offset"].as_u64(), "{id}");
                }
                rejected("scanner", cls, Some(offset), unit_sha)
            } else {
                let canonical = if e.is_string() { &c["canonical_sha256"] } else { &e["canonical_sha256"] };
                accepted(unit_sha, canonical.as_str().unwrap())
            };
            let admission_ok = match (&r.admission, want.accepted) {
                (Some(a), true) => !a.verified && !a.admitted,
                (None, false) => r.value.is_null(),
                _ => false,
            };
            if r.ingress != want || !admission_ok {
                failures.push(format!("{id}: ingress {:?} want {:?}", r.ingress, want));
            }
        }
    }
    assert_eq!(counts, vec![87, 81]);
    for id in differences.keys() {
        assert!(ids.contains(*id), "domain difference {id} is not a corpus case");
    }
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn new_cases() {
    let iv = ingress_vectors();
    let cases = iv["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 26);
    let mut failures = Vec::new();
    for c in cases {
        let id = c["id"].as_str().unwrap();
        let text = c["input_json"].as_str().unwrap();
        let unit_sha = c["input_sha256"].as_str().unwrap();
        assert_eq!(sha(text.as_bytes()), unit_sha, "{id}");
        let r = admit_signed_bundle_v2_from_bytes(text.as_bytes(), &AdmitOptions::default()).unwrap();
        let e = &c["expected"];
        let ok = if e["ingress"] == "accept" {
            assert_eq!(sha(e["canonical"].as_str().unwrap().as_bytes()), e["canonical_sha256"].as_str().unwrap(), "{id}");
            let parsed: Value = serde_json::from_str(text).unwrap();
            // not a signed bundle: admission runs over the value and rejects it, with no parser fault
            r.ingress == accepted(unit_sha, e["canonical_sha256"].as_str().unwrap())
                && r.value == parsed
                && r.admission.as_ref().is_some_and(|a| !a.verified && !a.admitted)
        } else {
            let want = rejected(
                e["layer"].as_str().unwrap(),
                e["class"].as_str().unwrap(),
                e["offset"].as_u64().map(|o| o as usize),
                unit_sha,
            );
            r.ingress == want && r.admission.is_none() && r.value.is_null()
        };
        if !ok {
            failures.push(format!("{} {id}: ingress {:?}", c["group"], r.ingress));
        }
    }
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn signed_bundles_have_the_same_admission_as_the_value_api() {
    let v = delegated_vectors();
    let strict = Strict::new(&v);
    let bundles = v["signed_bundles"].as_object().unwrap();
    assert_eq!(bundles.len(), 16);
    let mut failures = Vec::new();
    for (name, bundle) in bundles {
        let expected = serde_json::to_value(admit_signed_bundle_v2(bundle, &strict.options()).unwrap()).unwrap();
        if name == "orch" {
            assert_eq!(expected["admitted"], true, "orch is admitted");
        }
        let mut canonicals = Vec::new();
        for unit in [serde_json::to_vec(bundle).unwrap(), serde_json::to_vec_pretty(bundle).unwrap()] {
            let r = admit_signed_bundle_v2_from_bytes(&unit, &strict.options()).unwrap();
            let admission = serde_json::to_value(&r.admission).unwrap();
            if !r.ingress.accepted || admission != expected || r.value != *bundle {
                failures.push(format!("{name}: ingress {:?}", r.ingress));
            }
            canonicals.push(r.ingress.canonical_sha256);
        }
        if canonicals[0] != canonicals[1] {
            failures.push(format!("{name}: compact and indented canonical differ"));
        }
    }
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn rejects_a_transport_that_rewrites_100_as_100_0_which_the_value_api_admits() {
    let v = delegated_vectors();
    let strict = Strict::new(&v);
    let text = serde_json::to_string(&v["signed_bundles"]["orch"]).unwrap();
    assert_eq!(text.matches(r#""risk_score":100,"#).count(), 1);
    let rewritten = text.replace(r#""risk_score":100,"#, r#""risk_score":100.0,"#);
    let parsed: Value = serde_json::from_str(&rewritten).unwrap();
    assert!(admit_signed_bundle_v2(&parsed, &strict.options()).unwrap().admitted, "the value API admits the rewritten text");
    let r = admit_signed_bundle_v2_from_bytes(rewritten.as_bytes(), &strict.options()).unwrap();
    let want = rejected("domain", "NUMBER_NOT_PORTABLE", rewritten.find("100.0"), &sha(rewritten.as_bytes()));
    assert_eq!(r.ingress, want);
    assert!(r.admission.is_none());
}

#[test]
fn hashes_a_subslice_only() {
    let v = delegated_vectors();
    let strict = Strict::new(&v);
    let original = serde_json::to_vec(&v["signed_bundles"]["orch"]).unwrap();
    let mut backing = vec![b'X'; original.len() + 16];
    backing[8..8 + original.len()].copy_from_slice(&original);
    let r = admit_signed_bundle_v2_from_bytes(&backing[8..8 + original.len()], &strict.options()).unwrap();
    assert_eq!(r.ingress.unit_sha256, sha(&original));
    assert!(r.admission.unwrap().admitted);
}
