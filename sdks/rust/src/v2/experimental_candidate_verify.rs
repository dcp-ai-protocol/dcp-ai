//! EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 3): verification of the original bytes of a
//! signed bundle. The bytes are routed once by the phase 2 router, and then at most one verifier runs:
//!
//! - `reject`: none.
//! - `v1_path`: today's `verify_signed_bundle_v2_at`, on the value the historical adapter decoded,
//!   which is what a current caller would hand it. When the adapter refused the data there is no such
//!   value, and nothing runs.
//! - `candidate`: today's verifier, accepting exactly `dcp-jcs-v2`, on the exact value of the bytes.
//!
//! There is no second attempt under another profile. `verified` means the signatures and commitments
//! verified; it grants no trust or admission and authorizes nothing.

use serde_json::Value;

use crate::v2::experimental_candidate_ingress::CandidateIngressInternalError;
use crate::v2::experimental_candidate_router::{
    CandidateConfigError, CandidateRoute, CandidateRouteError, CandidateRouter, CandidateRouterConfig,
};
use crate::v2::types::VerifierPolicy;
use crate::v2::verify_bundle::{verify_signed_bundle_v2_at, verify_signed_bundle_v2_at_profile, V2VerificationDetails};

/// The route, the verifier it entered (`none`, `dcp-jcs-v1` or `dcp-jcs-v2`, at most one) and that
/// verifier's result as is (`None` when none ran).
#[derive(Debug, Clone)]
pub struct CandidateVerification {
    pub route: CandidateRoute,
    pub entered: &'static str,
    pub verification: Option<V2VerificationDetails>,
}

/// A verifier of original bytes over a router (`CandidateVerifier::new`).
pub struct CandidateVerifier {
    router: CandidateRouter,
}

impl CandidateVerifier {
    /// EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 3): a verifier over a router created from
    /// `config` (`CandidateRouter::new`: validated before any input, no default profile).
    pub fn new(config: CandidateRouterConfig) -> Result<Self, CandidateConfigError> {
        Ok(Self { router: CandidateRouter::new(config)? })
    }

    /// The effective configuration: the transport, the accepted profiles and the adapter's name.
    pub fn configuration(&self) -> (String, Vec<String>, String) {
        self.router.configuration()
    }

    /// Routes `input` and runs at most one verifier, with the parameters of
    /// `verify_signed_bundle_v2_at`. The error is an adapter or internal error, never a rejection.
    pub fn verify_at(&self, input: &[u8], policy: &VerifierPolicy, now_ms: i64) -> Result<CandidateVerification, CandidateRouteError> {
        verify_routed(self.router.route(input)?, policy, now_ms, &mut |_| {})
    }
}

/// The verifiers after a route; `probe` observes which one is about to run and cannot replace it.
pub(crate) fn verify_routed(
    route: CandidateRoute,
    policy: &VerifierPolicy,
    now_ms: i64,
    probe: &mut dyn FnMut(&'static str),
) -> Result<CandidateVerification, CandidateRouteError> {
    let (entered, verification) = match &route {
        CandidateRoute::Reject { .. } => ("none", None),
        // The discriminant is the member, never the value: a decoded null is data and is delegated.
        CandidateRoute::V1Path { historical, .. } => match &historical.decoded {
            None => ("none", None),
            Some(decoded) => {
                probe("dcp-jcs-v1");
                ("dcp-jcs-v1", Some(verify_signed_bundle_v2_at(decoded, policy, now_ms)))
            }
        },
        CandidateRoute::Candidate { value, .. } => {
            let details = verify_candidate(value, policy, now_ms, probe).map_err(CandidateRouteError::Internal)?;
            ("dcp-jcs-v2", Some(details))
        }
    };
    Ok(CandidateVerification { route, entered, verification })
}

/// Today's verifier, accepting exactly `dcp-jcs-v2`, on the exact value of a candidate route (also the
/// candidate step of the wasm binding).
pub(crate) fn verify_candidate(
    value: &Value,
    policy: &VerifierPolicy,
    now_ms: i64,
    probe: &mut dyn FnMut(&'static str),
) -> Result<V2VerificationDetails, CandidateIngressInternalError> {
    if value.pointer("/bundle/manifest/canonicalization_profile").and_then(Value::as_str) != Some("dcp-jcs-v2") {
        return Err(CandidateIngressInternalError("a candidate route whose value does not name dcp-jcs-v2".into()));
    }
    probe("dcp-jcs-v2");
    Ok(verify_signed_bundle_v2_at_profile(value, policy, now_ms, "dcp-jcs-v2"))
}

#[cfg(test)]
mod tests {
    //! The public signed vectors (tests/interop/candidate/phase3-signed-vectors.json) and the controls
    //! of the contract, with the probe: one verifier at most, parity of the delegation, the canonical
    //! bytes of every committed value, the profile policy, a decoder refusal versus a decoded null,
    //! buffers the caller mutates, and today's API still refusing dcp-jcs-v2.
    use super::*;
    use crate::v2::canonicalize::canonicalize_v2;
    use crate::v2::experimental_candidate_ingress::{experimental_candidate_ingress, CandidateIngressOutcome};
    use crate::v2::experimental_candidate_router::{HistoricalAdapter, HistoricalDecode};
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// The 57 case IDs approved for phase 3, written here: the vectors must carry exactly these, each once.
    const APPROVED_IDS: [&str; 57] = [
        "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08",
        "P09", "P10", "P11", "P12", "P13-800", "P13-801", "P13-5000", "P14",
        "R01", "R02", "R03", "R04", "R05a", "R05b-v2", "R06", "R07",
        "R08", "R09", "R10", "R11", "R12", "R13", "R14", "R15",
        "R16", "F01", "F02", "F03", "F04", "F05", "F06", "F07",
        "F08", "F09", "F10", "F11", "F12", "F13", "F14", "D01",
        "D02", "D03", "D04", "R05b-both", "D05", "D06", "D07", "D08",
        "D09",
    ];

    /// Why `ids` is not exactly the approved set, each once (repeated, missing, unknown), or `None`.
    fn id_problem(ids: &[&str]) -> Option<String> {
        let mut seen: Vec<&str> = Vec::new();
        let (mut repeated, mut unknown) = (Vec::new(), Vec::new());
        for id in ids {
            if seen.contains(id) {
                repeated.push(*id);
            } else {
                seen.push(id);
            }
            if !APPROVED_IDS.contains(id) && !unknown.contains(id) {
                unknown.push(*id);
            }
        }
        let missing: Vec<&str> = APPROVED_IDS.iter().copied().filter(|id| !seen.contains(id)).collect();
        (!(repeated.is_empty() && missing.is_empty() && unknown.is_empty()))
            .then(|| format!("repeated {repeated:?}, missing {missing:?}, unknown {unknown:?}"))
    }

    /// The vectors, with exactly the approved case IDs, checked before any case runs.
    fn vectors() -> Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/candidate/phase3-signed-vectors.json");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let ids: Vec<&str> = v["cases"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();
        if let Some(problem) = id_problem(&ids) {
            panic!("phase 3 vectors: not the approved case IDs: {problem}");
        }
        v
    }

    #[test]
    fn exactly_the_approved_ids_and_a_missing_repeated_or_unknown_one_is_refused() {
        let v = vectors();
        let ids: Vec<&str> = v["cases"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();
        assert_eq!(id_problem(&ids), None);
        assert_eq!(id_problem(&APPROVED_IDS), None);
        let without: Vec<&str> = ids.iter().copied().filter(|id| *id != "F07").collect();
        assert_eq!(id_problem(&without).as_deref(), Some(r#"repeated [], missing ["F07"], unknown []"#));
        let repeated: Vec<&str> = ids.iter().copied().chain(["D03"]).collect();
        assert_eq!(id_problem(&repeated).as_deref(), Some(r#"repeated ["D03"], missing [], unknown []"#));
        let renamed: Vec<&str> = ids.iter().map(|id| if *id == "P05" { "P99" } else { *id }).collect();
        assert_eq!(id_problem(&renamed).as_deref(), Some(r#"repeated [], missing ["P05"], unknown ["P99"]"#));
    }

    fn case<'a>(v: &'a Value, id: &str) -> &'a Value {
        v["cases"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap()
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{:02x}", x)).collect()
    }

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    fn latin1(s: &str) -> Vec<u8> {
        s.chars().map(|c| c as u32 as u8).collect()
    }

    /// The input of a case: its base, then each edit in order on the bytes.
    fn input(v: &Value, c: &Value) -> Vec<u8> {
        let mut buf = latin1(v["bases"][c["input"]["base"].as_str().unwrap()]["input_json"].as_str().unwrap());
        for e in c["input"]["edits"].as_array().unwrap() {
            if let Some(find) = e["find"].as_str() {
                let find = latin1(find);
                let at: Vec<usize> = buf.windows(find.len()).enumerate().filter(|(_, w)| *w == find.as_slice()).map(|(i, _)| i).collect();
                assert_eq!(at.len(), 1, "{}: find must occur exactly once", c["id"]);
                let by = match e["replace"].as_str() {
                    Some(r) => latin1(r),
                    None => unhex(e["replace_hex"].as_str().unwrap()),
                };
                buf.splice(at[0]..at[0] + find.len(), by);
            } else if let Some(prefix) = e["prefix"].as_str() {
                buf = [latin1(prefix), buf, latin1(e["suffix"].as_str().unwrap())].concat();
            } else if let Some(prefix) = e["prefix_hex"].as_str() {
                buf = [unhex(prefix), buf].concat();
            } else if let Some(n) = e["drop_last"].as_u64() {
                buf.truncate(buf.len() - n as usize);
            } else {
                panic!("{}: unknown edit {e}", c["id"]);
            }
        }
        buf
    }

    /// The default by omission for "default"; otherwise the policy as written in the file.
    fn policy(v: &Value, c: &Value) -> VerifierPolicy {
        match c["verifier_policy"].as_str().unwrap() {
            "default" => VerifierPolicy::default(),
            name => serde_json::from_value(v["verifier_policies"][name].clone()).unwrap(),
        }
    }

    /// A serde_json_from_slice adapter that counts its calls.
    fn counting() -> (HistoricalAdapter, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let real = HistoricalAdapter::serde_json_from_slice();
        (HistoricalAdapter::custom("serde_json_from_slice", move |u| {
            c.fetch_add(1, Ordering::SeqCst);
            real.decode(u)
        }), calls)
    }

    fn router(c: &Value, historical: HistoricalAdapter) -> CandidateRouter {
        CandidateRouter::new(CandidateRouterConfig {
            transport: c["transport"].as_str().unwrap().into(),
            accepted_profiles: c["accepted_profiles"].clone(),
            historical: Some(historical),
        })
        .unwrap()
    }

    fn check(id: &str, r: &CandidateVerification, exp: &Value) {
        let er = &exp["route"];
        let (outcome, class, detail, offset, profile) = match &r.route {
            CandidateRoute::Reject { class, detail, offset, profile, .. } => ("reject", Some(class.clone()), detail.clone(), *offset, profile.clone()),
            CandidateRoute::V1Path { .. } => ("v1_path", None, None, None, Some("dcp-jcs-v1".to_string())),
            CandidateRoute::Candidate { .. } => ("candidate", None, None, None, Some("dcp-jcs-v2".to_string())),
        };
        assert_eq!(outcome, er["outcome"], "{id}: {:?}", r.route);
        if let Some(c) = er.get("class") {
            assert_eq!(class.as_deref(), c.as_str(), "{id}: class");
        }
        if let Some(d) = er.get("detail") {
            assert_eq!(detail.as_deref(), d.as_str(), "{id}: detail");
        }
        if let Some(o) = er.get("offset") {
            assert_eq!(offset.map(|o| o as u64), o.as_u64(), "{id}: offset");
        }
        if let Some(p) = er.get("profile") {
            assert_eq!(profile.as_deref(), p.as_str(), "{id}: profile");
        }
        if let CandidateRoute::V1Path { profile_source, warnings, historical, .. } = &r.route {
            if let Some(s) = er.get("profile_source") {
                assert_eq!(profile_source, s.as_str().unwrap(), "{id}: profile source");
            }
            if let Some(w) = er.get("warning_classes") {
                let got: Vec<&str> = warnings.iter().map(|w| w.class.as_str()).collect();
                let want: Vec<&str> = w.as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
                assert_eq!(got, want, "{id}: warnings");
            }
            if let Some(h) = er.get("historical") {
                assert_eq!(if historical.decoded.is_some() { "decoded" } else { "failed" }, h, "{id}: historical");
            }
        }
        assert_eq!(r.entered, exp["entered"], "{id}: entered");
        let ev = &exp["verification"];
        match (&r.verification, ev.is_null()) {
            (None, true) => {}
            (Some(v), false) => {
                assert_eq!(v.result.verified, ev["verified"], "{id}: {:?}", v.result.errors);
                if v.result.verified {
                    assert!(v.result.errors.is_empty(), "{id}: {:?}", v.result.errors);
                }
                for s in ev["errors_contain"]["rust"].as_array().unwrap() {
                    let s = s.as_str().unwrap();
                    assert!(v.result.errors.iter().any(|e| e.contains(s)), "{id}: {s} in {:?}", v.result.errors);
                }
            }
            (got, _) => panic!("{id}: verification {got:?}, expected {ev}"),
        }
    }

    #[test]
    fn signed_vectors() {
        let v = vectors();
        let cases = v["cases"].as_array().unwrap();
        let now = v["now_ms"].as_i64().unwrap();
        for c in cases {
            let id = c["id"].as_str().unwrap();
            let exp = c.get("by_adapter").and_then(|b| b.get("rust:serde_json_from_slice")).unwrap_or(&c["expected"]);
            let data = input(&v, c);
            assert_eq!(hex(&Sha256::digest(&data)), c["input_sha256"], "{id}: input hash");
            let (adapter, calls) = counting();
            let mut entries = Vec::new();
            let pol = policy(&v, c);
            let r = verify_routed(router(c, adapter).route(&data).unwrap(), &pol, now, &mut |e| entries.push(e)).unwrap();
            check(id, &r, exp);
            assert_eq!(calls.load(Ordering::SeqCst) as u64, exp["adapter_calls"].as_u64().unwrap(), "{id}: adapter calls");
            let want: Vec<&str> = if exp["entered"] == "none" { vec![] } else { vec![exp["entered"].as_str().unwrap()] };
            assert_eq!(entries, want, "{id}: verifiers entered");

            if let (CandidateRoute::Candidate { value, canonical_sha256, .. }, Some(m)) = (&r.route, exp["manifest_sha256"].as_str()) {
                assert_eq!(canonical_sha256, exp["canonical_sha256"].as_str().unwrap(), "{id}");
                let manifest = canonicalize_v2(&value["bundle"]["manifest"]).unwrap();
                assert_eq!(format!("sha256:{}", hex(&Sha256::digest(manifest.as_bytes()))), m, "{id}: manifest hash");
                assert_eq!(value["signature"]["manifest_hash"], m, "{id}");
            }
            // Delegation: exactly what a current caller gets by decoding the unit with the same decoder.
            if let (CandidateRoute::V1Path { unit, .. }, Some(got)) = (&r.route, &r.verification) {
                let decoded = HistoricalAdapter::serde_json_from_slice().decode(&unit.bytes).unwrap();
                let direct = verify_signed_bundle_v2_at(&decoded, &pol, now);
                assert_eq!(serde_json::to_value(got).unwrap(), serde_json::to_value(direct).unwrap(), "{id}: delegation");
            }
            // The public verifier gives the same result.
            let plain = CandidateVerifier::new(CandidateRouterConfig {
                transport: c["transport"].as_str().unwrap().into(),
                accepted_profiles: c["accepted_profiles"].clone(),
                historical: Some(HistoricalAdapter::serde_json_from_slice()),
            })
            .unwrap()
            .verify_at(&data, &pol, now)
            .unwrap();
            assert_eq!(plain.route, r.route, "{id}");
            assert_eq!(plain.entered, r.entered, "{id}");
            assert_eq!(serde_json::to_value(&plain.verification).unwrap(), serde_json::to_value(&r.verification).unwrap(), "{id}");
        }
    }

    /// The same exact value: integers by numeric value.
    fn same_exact(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => x.as_i64().is_some() && x.as_i64() == y.as_i64(),
            (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, xv)| y.get(k).is_some_and(|yv| same_exact(xv, yv))),
            (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_exact(p, q)),
            _ => a == b,
        }
    }

    /// Every committed value (the unit, the manifest, the four payloads, the audit entries and the
    /// checkpoints without their signature) and every object or array inside them.
    fn committed(unit: &Value) -> Vec<Value> {
        let b = &unit["bundle"];
        let mut roots = vec![unit.clone(), b["manifest"].clone()];
        for n in ["responsible_principal_record", "agent_passport", "intent", "policy_decision"] {
            roots.push(b[n]["payload"].clone());
        }
        roots.extend(b["audit_entries"].as_array().unwrap().iter().cloned());
        for cp in b["pq_checkpoints"].as_array().into_iter().flatten() {
            let mut payload = cp.clone();
            payload.as_object_mut().unwrap().remove("composite_sig");
            roots.push(payload);
        }
        fn walk(v: &Value, out: &mut Vec<Value>) {
            match v {
                Value::Object(m) => {
                    out.push(v.clone());
                    m.values().for_each(|x| walk(x, out));
                }
                Value::Array(a) => {
                    out.push(v.clone());
                    a.iter().for_each(|x| walk(x, out));
                }
                _ => {}
            }
        }
        let mut out = Vec::new();
        roots.iter().for_each(|r| walk(r, &mut out));
        out
    }

    #[test]
    fn canonical_bytes_of_every_committed_value() {
        let v = vectors();
        let mut positives = Vec::new();
        for c in v["cases"].as_array().unwrap().iter().filter(|c| c["expected"].get("manifest_sha256").is_some()) {
            let id = c["id"].as_str().unwrap();
            positives.push(id);
            let route = router(c, HistoricalAdapter::serde_json_from_slice()).route(&input(&v, c)).unwrap();
            let CandidateRoute::Candidate { value, .. } = route else { panic!("{id}: {route:?}") };
            let values = committed(&value);
            if id == "P10" {
                assert!(values.iter().any(|x| x.get("checkpoint_id").is_some()), "P10: the checkpoint");
            }
            for node in &values {
                let canonical = canonicalize_v2(node).unwrap();
                match experimental_candidate_ingress(canonical.as_bytes()).unwrap() {
                    CandidateIngressOutcome::Accept { value: again, canonical: bytes, .. } => {
                        assert!(same_exact(&again, node), "{id}: {:.80}", canonical);
                        assert_eq!(bytes, canonical.as_bytes(), "{id}");
                    }
                    other => panic!("{id}: {other:?}"),
                }
            }
        }
        assert_eq!(positives.len(), 16);
    }

    #[test]
    fn exact_integers_whatever_their_form() {
        let v = vectors();
        let limits = serde_json::json!({"exact_one": 1, "ten": 10, "hundred": 100, "zero": 0, "max_safe": 9007199254740991i64, "min_safe": -9007199254740991i64});
        for id in ["P04", "P13-800", "P13-801", "P13-5000", "P14"] {
            let c = case(&v, id);
            let route = router(c, HistoricalAdapter::serde_json_from_slice()).route(&input(&v, c)).unwrap();
            let CandidateRoute::Candidate { value, .. } = route else { panic!("{id}") };
            assert!(same_exact(&value["bundle"]["intent"]["payload"]["target"]["limits"], &limits), "{id}");
        }
    }

    #[test]
    fn the_profile_policy_is_required_with_no_default() {
        for accepted in [Value::Null, serde_json::json!([]), serde_json::json!(["dcp-jcs-v3"]), serde_json::json!(["dcp-jcs-v2", "dcp-jcs-v2"]), serde_json::json!("dcp-jcs-v2")] {
            let e = CandidateVerifier::new(CandidateRouterConfig {
                transport: "bare".into(),
                accepted_profiles: accepted.clone(),
                historical: Some(HistoricalAdapter::serde_json_from_slice()),
            })
            .err()
            .unwrap_or_else(|| panic!("{accepted}: accepted"));
            assert_eq!(e.code, "POLICY_INVALID", "{accepted}");
        }
        let missing = CandidateVerifier::new(CandidateRouterConfig { transport: "bare".into(), accepted_profiles: serde_json::json!(["dcp-jcs-v2"]), historical: None });
        assert!(missing.is_err());
    }

    #[test]
    fn a_decoder_refusal_is_not_delegated_and_a_decoded_null_is() {
        let v = vectors();
        let d01 = case(&v, "D01");
        let now = v["now_ms"].as_i64().unwrap();
        let refuses = HistoricalAdapter::custom("refuses", |_| Err(HistoricalDecode::Failed("refused by the test".into())));
        let mut entries = Vec::new();
        let r = verify_routed(router(d01, refuses).route(&input(&v, d01)).unwrap(), &VerifierPolicy::default(), now, &mut |e| entries.push(e)).unwrap();
        let CandidateRoute::V1Path { historical, .. } = &r.route else { panic!("{:?}", r.route) };
        assert_eq!((historical.decoded.is_none(), historical.failed.as_deref()), (true, Some("refused by the test")));
        assert_eq!((r.entered, r.verification.is_none(), entries.len()), ("none", true, 0));

        let decodes_null = HistoricalAdapter::custom("decodes-null", |_| Ok(Value::Null));
        let mut entries = Vec::new();
        let r = verify_routed(router(d01, decodes_null).route(&input(&v, d01)).unwrap(), &VerifierPolicy::default(), now, &mut |e| entries.push(e)).unwrap();
        assert_eq!((r.entered, entries), ("dcp-jcs-v1", vec!["dcp-jcs-v1"]));
        let got = r.verification.unwrap();
        assert!(!got.result.verified);
        let direct = verify_signed_bundle_v2_at(&Value::Null, &VerifierPolicy::default(), now);
        assert_eq!(serde_json::to_value(got).unwrap(), serde_json::to_value(direct).unwrap());
    }

    #[test]
    fn an_adapter_failure_is_an_error_and_no_verifier_runs() {
        let v = vectors();
        let d01 = case(&v, "D01");
        let fails = HistoricalAdapter::custom("fails", |_| Err(HistoricalDecode::Adapter("boom".into())));
        assert!(matches!(router(d01, fails).route(&input(&v, d01)), Err(CandidateRouteError::Adapter(_))));
    }

    #[test]
    fn the_caller_mutating_its_buffer_after_the_call_changes_nothing() {
        let v = vectors();
        let p01 = case(&v, "P01");
        let verifier = CandidateVerifier::new(CandidateRouterConfig {
            transport: "bare".into(),
            accepted_profiles: serde_json::json!(["dcp-jcs-v2"]),
            historical: Some(HistoricalAdapter::serde_json_from_slice()),
        })
        .unwrap();
        let mut data = input(&v, p01);
        let r = verifier.verify_at(&data, &VerifierPolicy::default(), v["now_ms"].as_i64().unwrap()).unwrap();
        data.iter_mut().for_each(|b| *b = b' ');
        let CandidateRoute::Candidate { unit, .. } = &r.route else { panic!() };
        assert_eq!(hex(&Sha256::digest(&unit.bytes)), p01["input_sha256"]);
        assert!(r.verification.unwrap().result.verified);
    }

    #[test]
    fn todays_api_still_refuses_dcp_jcs_v2_also_given_the_exact_value() {
        let v = vectors();
        let p01 = case(&v, "P01");
        let now = v["now_ms"].as_i64().unwrap();
        let parsed: Value = serde_json::from_slice(&input(&v, p01)).unwrap();
        let r = verify_signed_bundle_v2_at(&parsed, &VerifierPolicy::default(), now);
        assert!(!r.result.verified && r.result.errors.iter().any(|e| e == "Unknown canonicalization_profile: dcp-jcs-v2"));
        let CandidateRoute::Candidate { value, .. } = router(p01, HistoricalAdapter::serde_json_from_slice()).route(&input(&v, p01)).unwrap() else { panic!() };
        let exact = verify_signed_bundle_v2_at(&value, &VerifierPolicy::default(), now);
        assert!(!exact.result.verified && exact.result.errors.iter().any(|e| e == "Unknown canonicalization_profile: dcp-jcs-v2"));
    }
}
