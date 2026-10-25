//! Experimental candidate router (phase 2), by phase: configuration, transport, selection and policy
//! on walkable units, the historical adapter on the units it decides (public fixture of measured
//! decoders), v1 parity on really signed bundles, laziness, the adapter contract and byte ownership.
//! Candidate verification is phase 3: corpus expectations accept_v2 and COMMITMENT_MISMATCH are checked
//! only as `Candidate`. The grammar walker is checked in the module's unit test.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use dcp_ai::v2::experimental_candidate_ingress::{experimental_candidate_ingress, CandidateIngressOutcome};
use dcp_ai::v2::experimental_candidate_router::{
    extract_unit, CandidateExtraction, CandidateRoute, CandidateRouteError, CandidateRouter, CandidateRouterConfig,
    CandidateWarning, HistoricalAdapter, HistoricalDecode,
};
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::verify_signed_bundle_v2_at;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn repo(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{}/../../{}", env!("CARGO_MANIFEST_DIR"), path)).unwrap()).unwrap()
}

fn input_of(case: &Value) -> Vec<u8> {
    let bytes = match case.get("input_hex") {
        Some(h) => hex::decode(h.as_str().unwrap()).unwrap(),
        None => case["input_json"].as_str().unwrap().as_bytes().to_vec(),
    };
    assert_eq!(hex::encode(Sha256::digest(&bytes)), case["input_sha256"], "{}", case["id"]);
    bytes
}

fn counting(inner: HistoricalAdapter) -> (HistoricalAdapter, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let name = inner.name().to_string();
    let adapter = HistoricalAdapter::custom(name, move |unit| {
        seen.fetch_add(1, Ordering::SeqCst);
        inner.decode(unit)
    });
    (adapter, calls)
}

fn router(transport: &str, policy: Value, adapter: HistoricalAdapter) -> CandidateRouter {
    CandidateRouter::new(CandidateRouterConfig { transport: transport.into(), accepted_profiles: policy, historical: Some(adapter) }).unwrap()
}

fn unit_with(profile: &str, extra: &str) -> Vec<u8> {
    format!("{{\"bundle\":{{\"manifest\":{{\"canonicalization_profile\":{}}}}},\"signature\":{{}}{}}}", profile, extra).into_bytes()
}

fn warnings_json(w: &[CandidateWarning]) -> Value {
    Value::Array(w.iter().map(|w| json!({"class": w.class, "offset": w.offset})).collect())
}

fn obsolete(case: &Value) -> bool {
    case["options"]["depth_scope"] == "transport"
}

#[test]
fn configuration_before_any_input() {
    let design = repo("docs/proposals/canonicalization-candidate/corpus.json");
    let cases = design["cases"].as_array().unwrap();
    let configuration: Vec<&Value> = cases.iter().filter(|c| c["group"] == "configuration").collect();
    assert_eq!(configuration.len(), 9);
    for c in configuration {
        let err = CandidateRouter::new(CandidateRouterConfig {
            transport: "bare".into(),
            accepted_profiles: c.get("policy").cloned().unwrap_or(Value::Null),
            historical: Some(HistoricalAdapter::serde_json_from_slice()),
        })
        .err()
        .unwrap_or_else(|| panic!("{} was accepted", c["id"]));
        assert_eq!((json!(err.code), json!(err.detail)), (c["expected"]["class"].clone(), c["expected"]["detail"].clone()), "{}", c["id"]);
    }
    let detail = |config: CandidateRouterConfig| CandidateRouter::new(config).err().map(|e| e.detail);
    let adapter = Some(HistoricalAdapter::serde_json_from_slice());
    assert_eq!(detail(CandidateRouterConfig { transport: "header".into(), accepted_profiles: json!(["dcp-jcs-v1"]), historical: adapter.clone() }).as_deref(), Some("TRANSPORT"));
    assert_eq!(detail(CandidateRouterConfig { transport: "bare".into(), accepted_profiles: json!(["dcp-jcs-v1"]), historical: None }).as_deref(), Some("HISTORICAL_ADAPTER"));
    let unnamed = HistoricalAdapter::custom("", |_| Ok(Value::Null));
    assert_eq!(detail(CandidateRouterConfig { transport: "bare".into(), accepted_profiles: json!(["dcp-jcs-v1"]), historical: Some(unnamed) }).as_deref(), Some("HISTORICAL_ADAPTER"));

    // A private snapshot: the configuration value is moved in and the router keeps its own copy.
    let mut config = CandidateRouterConfig { transport: "bare".into(), accepted_profiles: json!(["dcp-jcs-v1"]), historical: adapter };
    let r = CandidateRouter::new(config.clone()).unwrap();
    config.accepted_profiles = json!(["dcp-jcs-v1", "dcp-jcs-v2"]);
    config.transport = "envelope".into();
    config.historical = Some(HistoricalAdapter::custom("replaced", |_| Err(HistoricalDecode::Adapter("replaced".into()))));
    let (_, mut profiles, _) = r.configuration();
    profiles.push("dcp-jcs-v2".into());
    assert!(matches!(r.route(&unit_with("\"dcp-jcs-v2\"", "")).unwrap(), CandidateRoute::Reject { ref class, .. } if class == "PROFILE_NOT_ACCEPTED"));
    assert!(matches!(r.route(&unit_with("\"dcp-jcs-v1\"", "")).unwrap(), CandidateRoute::V1Path { ref historical, .. } if historical.adapter == "serde_json_from_slice"));
    assert_eq!(r.configuration(), ("bare".to_string(), vec!["dcp-jcs-v1".to_string()], "serde_json_from_slice".to_string()));
}

#[test]
fn transport_and_selection() {
    let design = repo("docs/proposals/canonicalization-candidate/corpus.json");
    let (mut envelopes, mut routed) = (0, 0);
    for c in design["cases"].as_array().unwrap() {
        if obsolete(c) || c["group"] == "configuration" || c.get("historical").is_some() {
            continue;
        }
        let input = input_of(c);
        let e = &c["expected"];
        if c["mode"] == "document" {
            if c["transport"] != "envelope" {
                continue;
            }
            envelopes += 1;
            match extract_unit(&input, "envelope").unwrap() {
                CandidateExtraction::Reject { class, detail, transport_offset } => {
                    assert_eq!((json!(class), json!(detail), json!(transport_offset)), (e["class"].clone(), e["detail"].clone(), e.get("transport_offset").cloned().unwrap_or(Value::Null)), "{}", c["id"]);
                }
                CandidateExtraction::Unit { start, end } => {
                    assert!(e["class"] != "TRANSPORT_INVALID" && e["class"] != "TRANSPORT_AMBIGUOUS", "{}", c["id"]);
                    if let Some(u) = e.get("unit") {
                        assert_eq!(json!([start, end]), *u, "{}", c["id"]);
                    }
                    match experimental_candidate_ingress(&input[start..end]).unwrap() {
                        CandidateIngressOutcome::Accept { canonical_sha256, .. } => assert_eq!(json!(canonical_sha256), e["canonical_sha256"], "{}", c["id"]),
                        CandidateIngressOutcome::Reject { class, offset } => assert_eq!((json!(class.as_str()), json!(offset)), (e["class"].clone(), e["offset"].clone()), "{}", c["id"]),
                    }
                }
            }
            continue;
        }
        routed += 1;
        let (adapter, calls) = counting(HistoricalAdapter::serde_json_from_slice());
        let r = router(c["transport"].as_str().unwrap(), c["policy"].clone(), adapter).route(&input).unwrap();
        let calls = calls.load(Ordering::SeqCst);
        if e["result"] == "accept_v2" || e["class"] == "COMMITMENT_MISMATCH" {
            assert!(matches!(&r, CandidateRoute::Candidate { .. }) && r.attempts() == vec!["dcp-jcs-v2"] && calls == 0, "{}: {:?}", c["id"], r);
            if let (CandidateRoute::Candidate { unit, .. }, Some(u)) = (&r, e.get("unit")) {
                assert_eq!(json!([unit.start, unit.end]), *u);
            }
        } else if e["result"] == "v1_path" {
            match &r {
                CandidateRoute::V1Path { warnings, .. } => assert_eq!((warnings_json(warnings), calls), (e["warnings"].clone(), 1), "{}", c["id"]),
                other => panic!("{}: {:?}", c["id"], other),
            }
            assert_eq!(json!(r.attempts()), e["attempts"]);
        } else {
            match &r {
                CandidateRoute::Reject { class, offset, profile, .. } => assert_eq!(
                    (json!(class), json!(offset), json!(profile), calls),
                    (e["class"].clone(), e.get("offset").cloned().unwrap_or(Value::Null), e.get("profile").cloned().unwrap_or(Value::Null), 0),
                    "{}",
                    c["id"]
                ),
                other => panic!("{}: {:?}", c["id"], other),
            }
        }
    }
    assert_eq!((envelopes, routed), (28, 58));
}

#[test]
fn historical_adapter_fixture() {
    let fixture = repo("tests/interop/candidate/phase2-adapter-expectations.json");
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 16);
    for c in cases {
        let input = hex::decode(c["input_hex"].as_str().unwrap()).unwrap();
        assert_eq!(json!(hex::encode(Sha256::digest(&input))), c["input_sha256"]);
        let row = &c["adapters"]["rs.serde_json_from_slice"];
        // The fixture reading is the decoder's own, re-measured here.
        let reading = match serde_json::from_slice::<Value>(&input) {
            Err(_) => "fails".to_string(),
            Ok(v) => match v.get("bundle").filter(|b| b.is_object()).and_then(|b| b.get("manifest")).filter(|m| m.is_object()).and_then(|m| m.get("canonicalization_profile")) {
                None => "absent".into(),
                Some(Value::String(s)) if s == "dcp-jcs-v1" || s == "dcp-jcs-v2" => s.clone(),
                Some(_) => "other".into(),
            },
        };
        assert_eq!(json!(reading), row["decoder_reading"], "{}", c["id"]);
        let (adapter, calls) = counting(HistoricalAdapter::serde_json_from_slice());
        let r = router("bare", c["policy"].clone(), adapter).route(&input).unwrap();
        let e = &row["expected"];
        assert_eq!(json!(calls.load(Ordering::SeqCst)), e["adapter_calls"], "{}", c["id"]);
        match r {
            CandidateRoute::Reject { class, offset, profile, .. } => {
                assert_eq!(e["outcome"], "reject", "{}", c["id"]);
                assert_eq!((json!(class), json!(offset), json!(profile)), (e["class"].clone(), e["offset"].clone(), e.get("profile").cloned().unwrap_or(Value::Null)), "{}", c["id"]);
            }
            CandidateRoute::V1Path { profile_source, warnings, historical, .. } => {
                assert_eq!(e["outcome"], "v1_path", "{}", c["id"]);
                let h = if historical.decoded.is_some() { "decoded" } else { "failed" };
                assert_eq!((json!(profile_source), warnings_json(&warnings), json!(h)), (e["profile_source"].clone(), e["warnings"].clone(), e["historical"].clone()), "{}", c["id"]);
            }
            other => panic!("{}: {:?}", c["id"], other),
        }
    }
}

#[test]
fn v1_parity_on_really_signed_bundles() {
    let vectors = repo("tests/interop/v2/bundle_vectors.json");
    let admission = repo("tests/interop/v2/admission_vectors.json");
    let text = serde_json::to_vec(&vectors["signed_bundle"]).unwrap();
    let s = String::from_utf8(text.clone()).unwrap();
    let profile = "\"canonicalization_profile\":\"dcp-jcs-v1\"";
    assert_eq!(s.matches(profile).count(), 1);
    let action = s.find("\"action_type\":\"").unwrap() + "\"action_type\":\"".len();
    let repl = |old: &str, new: &str| s.replacen(old, new, 1).into_bytes();
    let tail = |extra: &str| format!("{}{}", &s[..s.len() - 1], extra).into_bytes();
    let splice = |with: &[u8]| [&text[..action], with, &text[action + 1..]].concat();
    let variants: Vec<(&str, Vec<u8>)> = vec![
        ("bom", [&[0xEF, 0xBB, 0xBF][..], &text].concat()),
        ("dup-profile-unknown-then-v1", repl(profile, &format!("\"canonicalization_profile\":\"dcp-jcs-v9\",{}", profile))),
        ("dup-profile-v2-then-v1", repl(profile, &format!("\"canonicalization_profile\":\"dcp-jcs-v2\",{}", profile))),
        ("dup-profile-v1-then-unknown", repl(profile, &format!("{},\"canonicalization_profile\":\"dcp-jcs-v9\"", profile))),
        ("dup-manifest-empty-then-real", repl("\"manifest\":{", "\"manifest\":{},\"manifest\":{")),
        ("dup-bundle-empty-then-real", repl("{\"bundle\":{", "{\"bundle\":{},\"bundle\":{")),
        ("utf8-ff-in-intent", splice(&[0xFF])),
        ("ufffd-literal-in-intent", splice(&[0xEF, 0xBF, 0xBD])),
        ("trailing-comma", tail(",}")),
        ("inf-unsigned", tail(",\"x\":1e999}")),
        ("nan-unsigned", tail(",\"x\":NaN}")),
        ("lone-surrogate-unsigned", tail(",\"x\":\"\\ud800\"}")),
        ("inf-profile", repl(profile, "\"canonicalization_profile\":1e999")),
        ("nan-before-v1", repl(profile, &format!("\"canonicalization_profile\":NaN,{}", profile))),
        ("inf-before-v1", repl(profile, &format!("\"canonicalization_profile\":1e999,{}", profile))),
    ];
    let now_vectors = 1793491200000i64;
    let now_admission = 1793613660000i64; // 2026-11-02T10:01:00.000Z, A_known_principal_strict
    assert!(admission["cases"].as_array().unwrap().iter().any(|c| c["name"] == "A_known_principal_strict" && c["now"] == "2026-11-02T10:01:00.000Z"));
    let mut inputs: Vec<(String, Vec<u8>, i64)> = vec![
        ("signed_bundle".into(), text.clone(), now_vectors),
        ("classical_only".into(), serde_json::to_vec(&vectors["classical_only_routine_bundle"]["signed_bundle"]).unwrap(), now_vectors),
    ];
    for key in ["must_accept_bundles", "must_reject_bundles"] {
        for c in vectors[key].as_array().unwrap() {
            inputs.push((format!("{} {}", key, c["name"]), serde_json::to_vec(&c["signed_bundle"]).unwrap(), now_vectors));
        }
    }
    for (k, v) in admission["signed_bundles"].as_object().unwrap() {
        inputs.push((format!("admission {}", k), serde_json::to_vec(v).unwrap(), now_admission));
    }
    for (k, v) in variants {
        inputs.push((format!("variant {}", k), v, now_vectors));
    }
    assert_eq!(inputs.len(), 2 + vectors["must_accept_bundles"].as_array().unwrap().len() + vectors["must_reject_bundles"].as_array().unwrap().len() + 20 + 15);
    let r = router("bare", json!(["dcp-jcs-v1"]), HistoricalAdapter::serde_json_from_slice());
    let verdict = |v: &Value, now: i64| verify_signed_bundle_v2_at(v, &VerifierPolicy::default(), now).result.verified;
    let (mut differences, mut accepted) = (Vec::new(), 0);
    for (label, data, now) in &inputs {
        let today = serde_json::from_slice::<Value>(data).ok();
        let today_verdict = today.as_ref().map_or(false, |v| verdict(v, *now));
        let routed = match r.route(data).unwrap() {
            CandidateRoute::Candidate { .. } => panic!("{}: candidate under a v1-only policy", label),
            CandidateRoute::Reject { .. } => false,
            CandidateRoute::V1Path { historical, .. } => match &historical.decoded {
                Some(v) => {
                    assert_eq!(Some(v), today.as_ref(), "{}", label);
                    verdict(v, *now)
                }
                None => false,
            },
        };
        if routed != today_verdict {
            differences.push(format!("{}: today {}, routed {}", label, today_verdict, routed));
        }
        accepted += usize::from(today_verdict);
    }
    assert!(differences.is_empty(), "{:?}", differences);
    assert!(accepted > 10, "{} accepted", accepted);
}

#[test]
fn laziness_and_adapter_contract() {
    let both = json!(["dcp-jcs-v1", "dcp-jcs-v2"]);
    let bom_v1 = [&[0xEF, 0xBB, 0xBF][..], &unit_with("\"dcp-jcs-v1\"", "")].concat();
    let claims_v2 = HistoricalAdapter::custom("claims-v2", |_| Ok(json!({"bundle": {"manifest": {"canonicalization_profile": "dcp-jcs-v2"}}})));
    let bom_v2 = [&[0xEF, 0xBB, 0xBF][..], &unit_with("\"dcp-jcs-v2\"", "")].concat();
    assert!(matches!(router("bare", both.clone(), claims_v2).route(&bom_v2).unwrap(), CandidateRoute::Reject { ref class, .. } if class == "BOM"));

    let (adapter, calls) = counting(HistoricalAdapter::serde_json_from_slice());
    let r = router("bare", both.clone(), adapter);
    for unit in [unit_with("\"dcp-jcs-v2\"", ""), unit_with("\"DCP-JCS-V2\"", ""), unit_with("\"dcp-jcs-v2\"", ",\"x\":1.5")] {
        r.route(&unit).unwrap();
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    r.route(&unit_with("\"dcp-jcs-v1\"", "")).unwrap();
    r.route(&[&unit_with("\"dcp-jcs-v1\"", "")[..], b" "].concat()).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);

    let adapter_error = |a: HistoricalAdapter| matches!(router("bare", both.clone(), a).route(&bom_v1), Err(CandidateRouteError::Adapter(_)));
    assert!(adapter_error(HistoricalAdapter::custom("errs", |_| Err(HistoricalDecode::Adapter("synthetic".into())))));
    assert!(adapter_error(HistoricalAdapter::custom("panics", |_| panic!("synthetic"))));
    let refuses = HistoricalAdapter::custom("refuses", |_| Err(HistoricalDecode::Failed("no".into())));
    assert!(matches!(router("bare", both.clone(), refuses).route(&bom_v1).unwrap(), CandidateRoute::Reject { ref class, .. } if class == "BOM"));
}

#[test]
fn ownership_and_boundaries() {
    let both = json!(["dcp-jcs-v1", "dcp-jcs-v2"]);
    // Not walkable (invalid UTF-8): a custom adapter decides; the router borrows the input immutably
    // and returns owned copies.
    let original = [&unit_with("\"dcp-jcs-v1\"", ",\"x\":\"")[..unit_with("\"dcp-jcs-v1\"", ",\"x\":\"").len() - 1], b"\xff\"}"].concat();
    let mutating = HistoricalAdapter::custom("mutating", |unit| {
        let mut own = unit.to_vec();
        own.iter_mut().for_each(|b| *b = 0);
        Ok(json!({"bundle": {"manifest": {"canonicalization_profile": "dcp-jcs-v1"}}}))
    });
    let r = router("bare", both.clone(), mutating);
    let mut first = match r.route(&original).unwrap() {
        CandidateRoute::V1Path { unit, .. } => unit,
        other => panic!("{:?}", other),
    };
    assert_eq!(first.bytes, original);
    first.bytes.iter_mut().for_each(|b| *b = 1); // the returned copy is mutable; nothing else changes
    assert!(matches!(r.route(&original).unwrap(), CandidateRoute::V1Path { ref unit, .. } if unit.bytes == original));

    assert!(extract_unit(b"{}", "header").is_err());
    let env = router("envelope", both, HistoricalAdapter::serde_json_from_slice());
    // serde_json refuses the invalid byte: the class of the diagnosis rejects it, with both offsets.
    match env.route(b"{\"signed_bundle\":{\"x\":\"\xff\"}}").unwrap() {
        CandidateRoute::Reject { class, offset, transport_offset, unit, .. } => assert_eq!((class.as_str(), offset, transport_offset, unit), ("UTF8_INVALID", Some(6), Some(23), Some((17, 26)))),
        other => panic!("{:?}", other),
    }
    match env.route(b"{\"a\":1,\"signed_bundle\":{\"bundle\":{\"manifest\":{\"canonicalization_profile\":\"x\"}}}}").unwrap() {
        CandidateRoute::Reject { class, offset, transport_offset, unit, .. } => assert_eq!((class.as_str(), offset, transport_offset, unit), ("PROFILE_UNKNOWN", Some(50), Some(73), Some((23, 79)))),
        other => panic!("{:?}", other),
    }
    match env.route(b"{\"signed_bundle\":1,\"signed_bundle\":2}").unwrap() {
        CandidateRoute::Reject { class, offset, transport_offset, unit, .. } => assert_eq!((class.as_str(), offset, transport_offset, unit), ("TRANSPORT_AMBIGUOUS", None, Some(19), None)),
        other => panic!("{:?}", other),
    }
    let deep = format!("{{\"signed_bundle\":{}{}}}", "[".repeat(20000), "]".repeat(20000)).into_bytes();
    assert_eq!(extract_unit(&deep, "envelope").unwrap(), CandidateExtraction::Unit { start: 17, end: 40017 });
    match env.route(&deep).unwrap() {
        CandidateRoute::V1Path { profile_source, warnings, historical, .. } => {
            assert_eq!(profile_source, "absent");
            assert_eq!(warnings, vec![CandidateWarning { class: "DEPTH_EXCEEDED".into(), offset: 64, transport_offset: 81 }]);
            assert!(historical.decoded.is_none()); // serde_json's recursion limit: the real decoder refuses
        }
        other => panic!("{:?}", other),
    }
}
