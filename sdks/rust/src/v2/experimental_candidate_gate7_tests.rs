//! Gate 7, dcp-jcs-v1 side (docs/proposals/canonicalization-candidate/README.md §9): a defect of each unit
//! class, injected at byte level into a dcp-jcs-v1 bundle, keeps today's verdict. The public fixture
//! tests/interop/candidate/gate7-v1-negatives.json has 38 cases over the frozen phase 3 bases with a reasoned
//! expectation for each of 10 configurations; this module runs the Rust one (38 checks) and, apart, the 3
//! envelope boundary cases (no equivalence claimed). It is registered from experimental_candidate_verify.rs only
//! under #[cfg(test)], so it can use the crate's verify_routed probe; it exposes nothing.
//!
//! For each case the experimental route (the router, then verify_routed with a probe that records each verifier
//! entered) and today's route of this SDK (serde_json::from_slice, then verify_signed_bundle_v2_at) get the same
//! bytes, clock and policy. Their results must be equal on every declared field and both must match the
//! expectation; the public CandidateVerifier::verify_at must give the instrumented route's result. A panic or an
//! error of either side is never parity and never a rejection.

use super::*;
use crate::v2::experimental_candidate_router::HistoricalAdapter;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const CFG: &str = "rust.serde_json_from_slice";
/// The fields of V2VerificationDetails as serialized: equality between the routes covers exactly these.
const DECLARED: [&str; 11] = [
    "verified", "dcp_version", "errors", "warnings", "classical_valid", "pq_valid", "session_binding_valid",
    "manifest_valid", "verification_mode", "resolved_tier", "signer_keys",
];

fn read(name: &str) -> Value {
    let path = format!("{}/../../tests/interop/candidate/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

struct Fixture {
    f: Value,
    p3: Value,
}

impl Fixture {
    fn load() -> Self {
        let (f, p3) = (read("gate7-v1-negatives.json"), read("phase3-signed-vectors.json"));
        assert_eq!(f["now_ms"], p3["now_ms"], "now_ms is the phase 3 instant");
        Self { f, p3 }
    }
    fn now(&self) -> i64 {
        self.f["now_ms"].as_i64().unwrap()
    }
    fn base(&self, name: &str) -> Vec<u8> {
        self.p3["bases"][name]["input_json"].as_str().unwrap().as_bytes().to_vec()
    }
    fn input(&self, c: &Value) -> Vec<u8> {
        let edits = match c.get("edits") {
            Some(e) => e,
            None if c["mutation"].is_null() => return self.base(c["base"].as_str().unwrap()),
            None => &self.f["mutations"][c["mutation"].as_str().unwrap()]["edits"],
        };
        apply(self.base(c["base"].as_str().unwrap()), edits)
    }
    fn case(&self, id: &str) -> &Value {
        self.f["cases"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap()
    }
    fn shape(&self, name: &str) -> &Value {
        &self.f["verification_shapes"][name]
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

/// The fixture's edit grammar, written here independently of the Python checker.
fn apply(mut out: Vec<u8>, edits: &Value) -> Vec<u8> {
    for e in edits.as_array().unwrap() {
        if let Some(p) = e.get("prefix") {
            out = [p.as_str().unwrap().as_bytes(), &out].concat();
        } else if let Some(p) = e.get("prefix_hex") {
            out = [unhex(p.as_str().unwrap()), out].concat();
        } else if let Some(a) = e.get("append") {
            out.extend_from_slice(a.as_str().unwrap().as_bytes());
        } else if let Some(a) = e.get("append_hex") {
            out.extend(unhex(a.as_str().unwrap()));
        } else if let Some(n) = e.get("drop_last") {
            out.truncate(out.len() - n.as_u64().unwrap() as usize);
        } else if let Some(f) = e.get("replace_once") {
            let find = f.as_str().unwrap().as_bytes();
            let at: Vec<usize> = out.windows(find.len()).enumerate().filter(|(_, w)| *w == find).map(|(i, _)| i).collect();
            assert_eq!(at.len(), 1, "anchor not unique: {f}");
            let with = match e.get("with_hex") {
                Some(h) => unhex(h.as_str().unwrap()),
                None => e["with"].as_str().unwrap().as_bytes().to_vec(),
            };
            out = [&out[..at[0]], &with[..], &out[at[0] + find.len()..]].concat();
        } else {
            panic!("unknown edit {e}");
        }
    }
    out
}

// ── The two routes, each classified into exactly one outcome ──

#[derive(Clone, Debug)]
enum Today {
    Verified(Value),
    HostDecode(String),
    VerifierError(String),
}

#[derive(Clone, Debug)]
enum Exp {
    Returned { route: CandidateRoute, entered: &'static str, verification: Option<Value>, calls: usize, entries: Vec<&'static str> },
    VerifierError(String),
}

fn today(data: &[u8], now: i64) -> Today {
    let value = match serde_json::from_slice::<Value>(data) {
        Ok(v) => v,
        Err(e) => return Today::HostDecode(format!("{:?}", e.classify())),
    };
    match catch_unwind(AssertUnwindSafe(|| verify_signed_bundle_v2_at(&value, &VerifierPolicy::default(), now))) {
        Ok(d) => Today::Verified(serde_json::to_value(d).unwrap()),
        Err(_) => Today::VerifierError("verify_signed_bundle_v2_at panicked".into()),
    }
}

fn config(transport: &str, historical: HistoricalAdapter) -> CandidateRouterConfig {
    CandidateRouterConfig { transport: transport.into(), accepted_profiles: json!(["dcp-jcs-v1"]), historical: Some(historical) }
}

fn experimental(data: &[u8], transport: &str, now: i64) -> Exp {
    let calls = Arc::new(AtomicUsize::new(0));
    let c = calls.clone();
    let real = HistoricalAdapter::serde_json_from_slice();
    let counted = HistoricalAdapter::custom("serde_json_from_slice", move |u| {
        c.fetch_add(1, Ordering::SeqCst);
        real.decode(u)
    });
    let policy = VerifierPolicy::default();
    let run = catch_unwind(AssertUnwindSafe(|| {
        let mut entries = Vec::new();
        let route = CandidateRouter::new(config(transport, counted)).map_err(|e| e.to_string())?.route(data).map_err(|e| e.to_string())?;
        let r = verify_routed(route, &policy, now, &mut |e| entries.push(e)).map_err(|e| e.to_string())?;
        // The public verifier gives the instrumented route's result.
        let public = CandidateVerifier::new(config(transport, HistoricalAdapter::serde_json_from_slice()))
            .map_err(|e| e.to_string())?
            .verify_at(data, &policy, now)
            .map_err(|e| e.to_string())?;
        let as_value = |v: &Option<V2VerificationDetails>| v.as_ref().map(|d| serde_json::to_value(d).unwrap());
        if public.route != r.route || public.entered != r.entered || as_value(&public.verification) != as_value(&r.verification) {
            return Err("the public verifier differs from the instrumented route".to_string());
        }
        Ok::<_, String>((r.route, r.entered, as_value(&r.verification), entries))
    }));
    match run {
        Ok(Ok((route, entered, verification, entries))) => {
            Exp::Returned { route, entered, verification, calls: calls.load(Ordering::SeqCst), entries }
        }
        Ok(Err(e)) => Exp::VerifierError(e),
        Err(_) => Exp::VerifierError("the experimental route panicked".into()),
    }
}

// ── The judgement: pure, so the self-tests can feed it fakes ──

fn route_shape(route: &CandidateRoute, transport: bool) -> Value {
    match route {
        CandidateRoute::V1Path { profile_source, warnings, historical, .. } => json!({
            "outcome": "v1_path",
            "profile_source": profile_source,
            "warning_classes": warnings.iter().map(|w| w.class.clone()).collect::<Vec<_>>(),
            "historical": if historical.decoded.is_some() { "decoded" } else { "failed" },
        }),
        CandidateRoute::Reject { class, detail, offset, .. } if transport => json!({"outcome": "reject", "class": class, "detail": detail}),
        CandidateRoute::Reject { class, offset, .. } => json!({"outcome": "reject", "class": class, "offset": offset}),
        CandidateRoute::Candidate { .. } => json!({"outcome": "candidate"}),
    }
}

fn undeclared(r: &Value) -> Vec<String> {
    r.as_object().unwrap().keys().filter(|k| !DECLARED.contains(&k.as_str())).cloned().collect()
}

fn shape_problems(r: &Value, s: &Value) -> Vec<String> {
    let mut p = Vec::new();
    if r["verified"] != s["verified"] {
        p.push(format!("verified {}, expected {}", r["verified"], s["verified"]));
    }
    let errors: Vec<&str> = r["errors"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    if errors.len() as u64 != s["error_count"].as_u64().unwrap() {
        p.push(format!("{} errors, expected {}: {errors:?}", errors.len(), s["error_count"]));
    }
    for sub in s["errors_contain"].as_array().unwrap() {
        let sub = sub.as_str().unwrap();
        if !errors.iter().any(|e| e.contains(sub)) {
            p.push(format!("no error contains {sub:?}: {errors:?}"));
        }
    }
    if r.get("warnings").unwrap_or(&Value::Null) != &s["warnings"] {
        p.push(format!("warnings {:?}, expected {}", r.get("warnings"), s["warnings"]));
    }
    for (k, v) in s["fields"].as_object().unwrap() {
        if r.get(k).unwrap_or(&Value::Null) != v {
            p.push(format!("{k} {:?}, expected {v}", r.get(k)));
        }
    }
    p
}

fn judge(fx: &Fixture, e: &Value, t: Option<&Today>, x: &Exp, transport: bool) -> Vec<String> {
    let (route, entered, verification, calls, entries) = match x {
        Exp::VerifierError(m) => return vec![format!("experimental verifier_error: {m}")],
        Exp::Returned { route, entered, verification, calls, entries } => (route, *entered, verification, *calls, entries),
    };
    if let Some(Today::VerifierError(m)) = t {
        return vec![format!("today verifier_error: {m}")];
    }
    let mut p = Vec::new();
    let got = route_shape(route, transport);
    if got != e["route"] {
        p.push(format!("route {got}, expected {}", e["route"]));
    }
    if calls as u64 != e["adapter_calls"].as_u64().unwrap() {
        p.push(format!("adapter calls {calls}, expected {}", e["adapter_calls"]));
    }
    if entered != e["entered"] {
        p.push(format!("entered {entered}, expected {}", e["entered"]));
    }
    let wanted: Vec<&str> = if e["entered"] == "none" { vec![] } else { vec!["dcp-jcs-v1"] };
    if *entries != wanted {
        p.push(format!("verifier entries {entries:?}, expected {wanted:?}"));
    }
    let implied: Vec<&str> = if entered == "none" { vec![] } else { vec![entered] };
    if *entries != implied {
        p.push(format!("verifier entries {entries:?} contradict entered {entered}"));
    }
    match (e["verification"].as_str(), verification) {
        (None, Some(_)) => p.push("a verification where none was expected".into()),
        (Some(name), None) => p.push(format!("no verification, expected {name}")),
        (Some(name), Some(v)) => {
            p.extend(undeclared(v).into_iter().map(|k| format!("experimental result has undeclared field {k}")));
            p.extend(shape_problems(v, fx.shape(name)).into_iter().map(|m| format!("experimental: {m}")));
        }
        (None, None) => {}
    }
    let Some(t) = t else { return p };
    let expected_today = e["today"]["outcome"].as_str().unwrap();
    match t {
        Today::HostDecode(kind) => {
            if expected_today != "host_decode_error" {
                p.push(format!("today host_decode_error, expected {expected_today}"));
            } else if e["today"]["kind"] != kind.as_str() {
                p.push(format!("today decoder error {kind}, expected {}", e["today"]["kind"]));
            }
            if entered != "none" {
                p.push("today refused the bytes but the experimental route entered a verifier".into());
            }
        }
        Today::Verified(r) => {
            if expected_today != "verified_result" {
                p.push(format!("today verified_result, expected {expected_today}"));
            }
            p.extend(undeclared(r).into_iter().map(|k| format!("today result has undeclared field {k}")));
            if let Some(name) = e["verification"].as_str() {
                p.extend(shape_problems(r, fx.shape(name)).into_iter().map(|m| format!("today: {m}")));
            }
            match verification {
                None => p.push("today verified a result but the experimental route entered no verifier".into()),
                Some(v) if v != r => p.push(format!("the routes differ: today {r} / experimental {v}")),
                Some(_) => {}
            }
        }
        Today::VerifierError(_) => unreachable!(),
    }
    p
}

fn run_case(fx: &Fixture, c: &Value) -> (Vec<String>, Today, Exp) {
    let data = fx.input(c);
    let frozen = data.clone();
    let t = today(&data, fx.now());
    let x = experimental(&data, "bare", fx.now());
    let mut p = judge(fx, &c["expected"][CFG], Some(&t), &x, false);
    if data != frozen {
        p.push("the input buffer was changed".into());
    }
    (p, t, x)
}

/// A failed or missing control invalidates every case of its base.
fn gate(results: &[(String, Vec<String>)]) -> Vec<(String, Vec<String>)> {
    results
        .iter()
        .map(|(id, p)| {
            if id.ends_with("C00") {
                return (id.clone(), p.clone());
            }
            let control_id = format!("{}C00", &id[..6]);
            let mut p = p.clone();
            match results.iter().find(|(i, _)| *i == control_id) {
                None => p.insert(0, format!("control_missing: {control_id}")),
                Some((_, cp)) if !cp.is_empty() => p.insert(0, format!("control_failed: {control_id}")),
                Some(_) => {}
            }
            (id.clone(), p)
        })
        .collect()
}

#[test]
fn gate7_fixture() {
    let fx = Fixture::load();
    let ids: Vec<&str> = fx.f["cases"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();
    let want: Vec<String> = ["V1", "AB"]
        .iter()
        .flat_map(|t| (0..=18).map(move |i| if i == 0 { format!("G7-{t}-C00") } else { format!("G7-{t}-M{i:02}") }))
        .collect();
    assert_eq!(ids, want);
    assert_eq!(fx.f["configurations"].as_array().unwrap().len(), 10);
    assert!(fx.f["configurations"].as_array().unwrap().contains(&json!(CFG)));
    for b in ["B-v1", "B-absent"] {
        assert_eq!(hex(&Sha256::digest(fx.base(b))), fx.f["bases"][b]["input_sha256"], "{b}");
    }
    for c in fx.f["cases"].as_array().unwrap().iter().chain(fx.f["boundary"]["cases"].as_array().unwrap()) {
        assert_eq!(c["expected"].as_object().unwrap().len(), 10, "{}", c["id"]);
        assert_eq!(hex(&Sha256::digest(fx.input(c))), c["input_sha256"], "{}", c["id"]);
    }
    // The declared fields are every serialized field of a full result: a new field forces a decision here.
    let full = serde_json::to_value(verify_signed_bundle_v2_at(&serde_json::from_slice(&fx.base("B-v1")).unwrap(), &VerifierPolicy::default(), fx.now())).unwrap();
    let mut keys: Vec<&str> = full.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut declared = DECLARED.to_vec();
    declared.sort_unstable();
    assert_eq!(keys, declared);
}

#[test]
fn gate7_cases() {
    let fx = Fixture::load();
    let results: Vec<(String, Vec<String>)> =
        fx.f["cases"].as_array().unwrap().iter().map(|c| (c["id"].as_str().unwrap().to_string(), run_case(&fx, c).0)).collect();
    assert_eq!(results.len(), 38, "completeness: zero executed checks can never pass");
    let failures: Vec<String> = gate(&results).into_iter().filter(|(_, p)| !p.is_empty()).map(|(id, p)| format!("{CFG} {id}: {}", p.join(" | "))).collect();
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn gate7_envelope_boundary() {
    let fx = Fixture::load();
    let bare = experimental(&fx.input(fx.case("G7-V1-C00")), "bare", fx.now());
    let mut checks = 0;
    for c in fx.f["boundary"]["cases"].as_array().unwrap() {
        let x = experimental(&fx.input(c), "envelope", fx.now());
        let p = judge(&fx, &c["expected"][CFG], None, &x, true);
        assert!(p.is_empty(), "{}: {p:?}", c["id"]);
        if c["id"] == "G7E-1" {
            let (Exp::Returned { verification: a, .. }, Exp::Returned { verification: b, .. }) = (&x, &bare) else { panic!() };
            assert_eq!(a, b, "G7E-1 differs from the bare control");
        }
        checks += 1;
    }
    assert_eq!(checks, 3);
}

#[test]
fn gate7_judgement_can_fail() {
    let fx = Fixture::load();
    let control = fx.case("G7-V1-C00");
    let exp = &control["expected"][CFG];
    let has = |p: &[String], prefix: &str| p.iter().any(|m| m.starts_with(prefix));

    // The experimental route outside the bundle window.
    let data = fx.input(control);
    let t = today(&data, fx.now());
    let late = experimental(&data, "bare", 4_102_531_200_000); // 2100-01-02T00:00:00Z
    assert!(has(&judge(&fx, exp, Some(&t), &late, false), "the routes differ"));

    // One changed error entry.
    let m10 = fx.case("G7-V1-M10");
    let (p, t10, x10) = run_case(&fx, m10);
    assert!(p.is_empty(), "{p:?}");
    let Exp::Returned { route, entered, verification: Some(mut v), calls, entries } = x10.clone() else { panic!() };
    v["errors"][0] = json!("intent: payload_hash mismatch (altered)");
    let altered = Exp::Returned { route, entered, verification: Some(v), calls, entries };
    assert!(has(&judge(&fx, &m10["expected"][CFG], Some(&t10), &altered, false), "the routes differ"));

    // A verifier error, even on both sides.
    let boom = Today::VerifierError("provider exploded".into());
    assert_eq!(judge(&fx, exp, Some(&boom), &Exp::VerifierError("provider exploded".into()), false), vec!["experimental verifier_error: provider exploded"]);

    // A second, a candidate or a missing entry; an entry under G7E-2.
    let (_, tc, xc) = run_case(&fx, control);
    let Exp::Returned { route, entered, verification, calls, entries } = xc else { panic!() };
    assert_eq!(entries, vec!["dcp-jcs-v1"]);
    for bad in [vec!["dcp-jcs-v1", "dcp-jcs-v1"], vec!["dcp-jcs-v2"], vec![]] {
        let y = Exp::Returned { route: route.clone(), entered, verification: verification.clone(), calls, entries: bad.clone() };
        assert!(has(&judge(&fx, exp, Some(&tc), &y, false), "verifier entries"), "{bad:?}");
    }
    let g7e2 = &fx.f["boundary"]["cases"][1];
    let Exp::Returned { route, entered, verification, calls, entries } = experimental(&fx.input(g7e2), "envelope", fx.now()) else { panic!() };
    assert!(entries.is_empty());
    let y = Exp::Returned { route, entered, verification, calls, entries: vec!["dcp-jcs-v1"] };
    assert!(has(&judge(&fx, &g7e2["expected"][CFG], None, &y, true), "verifier entries"));

    // A missing control.
    assert_eq!(gate(&[("G7-V1-M01".to_string(), vec![])])[0].1, vec!["control_missing: G7-V1-C00".to_string()]);

    // Fakes that reject or accept everything.
    let reject = Exp::Returned {
        route: CandidateRoute::Reject { class: "SYNTAX".into(), detail: None, offset: Some(0), transport_offset: Some(0), unit: None, profile: None },
        entered: "none",
        verification: None,
        calls: 1,
        entries: vec![],
    };
    let refused = Today::HostDecode("Syntax".into());
    let out: Vec<(String, Vec<String>)> = fx.f["cases"].as_array().unwrap().iter().map(|c| (c["id"].as_str().unwrap().to_string(), judge(&fx, &c["expected"][CFG], Some(&refused), &reject, false))).collect();
    let gated = gate(&out);
    assert!(gated.iter().all(|(_, p)| !p.is_empty()), "a reject-everything fake passed a case");
    assert_eq!(gated.iter().filter(|(_, p)| p[0].starts_with("control_failed")).count(), 36);
    let (_, t_ok, x_ok) = run_case(&fx, control);
    let negatives: Vec<&Value> = fx.f["cases"].as_array().unwrap().iter().filter(|c| c["expected"][CFG]["verification"] != "rust.ok").collect();
    assert!(negatives.len() > 10);
    for c in negatives {
        assert!(!judge(&fx, &c["expected"][CFG], Some(&t_ok), &x_ok, false).is_empty(), "{} passed an accept-everything fake", c["id"]);
    }
}
