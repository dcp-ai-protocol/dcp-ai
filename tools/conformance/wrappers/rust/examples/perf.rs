//! Performance child for the Rust SDK (dcp-ai-perf/1, tools/conformance/perf.js), an example of the wrapper crate so
//! that the wrapper's default build is unchanged. Build: cargo build --example perf --release --locked (the driver
//! does it). Timed per call: serde_json::from_slice of the input bytes, then verify_signed_bundle_v2_at(&bundle,
//! &policy, now_ms). The policy is set up once. A malformed request exits 2.

use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Write};
use std::time::Instant;

use base64::Engine as _;
use dcp_ai::v2::dual_hash::sha256_hex;
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::verify_signed_bundle_v2_at;
use serde_json::{json, Value};

const CONTRACT: &str = "dcp-ai-perf/1";

fn refuse(message: &str) -> ! {
    eprintln!("perf child: {message}");
    std::process::exit(2);
}

struct Workload {
    id: String,
    bytes: Vec<u8>,
    expect: bool,
}

fn keys_are(v: &Value, keys: &[&str]) -> bool {
    v.as_object().is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}

fn count(v: &Value) -> usize {
    match v.as_u64() {
        Some(n) if n >= 1 => n as usize,
        _ => refuse("warmup and samples must be integers of at least 1"),
    }
}

fn problem(expect: bool, verified: bool, errors: &[String]) -> Option<&'static str> {
    if verified != expect {
        Some("verdict")
    } else if verified && !errors.is_empty() {
        Some("contradiction")
    } else if !verified && errors.is_empty() {
        Some("no_errors")
    } else {
        None
    }
}

fn main() {
    let mut raw = Vec::new();
    if std::io::stdin().read_to_end(&mut raw).is_err() {
        refuse("cannot read stdin");
    }
    let req: Value = serde_json::from_slice(&raw).unwrap_or_else(|_| refuse("the request is not JSON"));
    let fields = ["contract", "run_id", "nonce", "verification_time", "policy", "warmup", "samples", "workloads"];
    if !keys_are(&req, &fields) || req["contract"] != CONTRACT || !req["run_id"].is_string() || !req["nonce"].is_string() {
        refuse("the request must be exactly a dcp-ai-perf/1 request");
    }
    let now_ms = req["verification_time"].as_str().and_then(parse_rfc3339_millis).unwrap_or_else(|| refuse("verification_time is not an RFC 3339 instant"));
    if !req["policy"].is_object() {
        refuse("policy must be an object");
    }
    let policy: VerifierPolicy = serde_json::from_value(req["policy"].clone()).unwrap_or_else(|_| refuse("policy is not a verifier policy"));
    let (warmup, samples) = (count(&req["warmup"]), count(&req["samples"]));
    let mut seen = HashSet::new();
    let workloads: Vec<Workload> = req["workloads"].as_array().filter(|a| !a.is_empty()).unwrap_or_else(|| refuse("workloads must be a non-empty array"))
        .iter()
        .map(|w| {
            if !keys_are(w, &["id", "input_b64", "input_sha256", "expect"]) || !keys_are(&w["expect"], &["verified"]) {
                refuse("a workload has the wrong shape");
            }
            let id = w["id"].as_str().unwrap_or_else(|| refuse("a workload id must be a string")).to_string();
            let expect = w["expect"]["verified"].as_bool().unwrap_or_else(|| refuse("expect.verified must be a boolean"));
            if !seen.insert(id.clone()) {
                refuse("duplicate workload id");
            }
            let b64 = w["input_b64"].as_str().unwrap_or_else(|| refuse("input_b64 must be a string"));
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap_or_else(|_| refuse("input_b64 is not base64"));
            if base64::engine::general_purpose::STANDARD.encode(&bytes) != b64 || w["input_sha256"].as_str() != Some(sha256_hex(&bytes).as_str()) {
                refuse("input_b64 does not match input_sha256");
            }
            Workload { id, bytes, expect }
        })
        .collect();

    let mut first: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut timings: BTreeMap<String, Vec<u64>> = workloads.iter().map(|w| (w.id.clone(), Vec::new())).collect();
    let mut failure = None;
    'measure: for (phase, rounds) in [("warmup", warmup), ("sample", samples)] {
        for index in 0..rounds {
            for w in &workloads {
                let t0 = Instant::now();
                let parsed: Result<Value, _> = serde_json::from_slice(&w.bytes);
                let details = parsed.as_ref().ok().map(|bundle| verify_signed_bundle_v2_at(bundle, &policy, now_ms));
                let elapsed = t0.elapsed();
                let (verified, errors) = match &details {
                    Some(d) => (d.result.verified, d.result.errors.clone()),
                    None => (false, Vec::new()),
                };
                let why = if details.is_none() { Some("malformed_result") } else { problem(w.expect, verified, &errors) };
                if let Some(reason) = why {
                    failure = Some(json!({ "id": w.id, "phase": phase, "index": index, "verified": verified, "errors": errors, "reason": reason }));
                    break 'measure;
                }
                first.entry(w.id.clone()).or_insert(errors);
                if phase == "sample" {
                    timings.get_mut(&w.id).unwrap().push(elapsed.as_nanos() as u64);
                }
            }
        }
    }

    let implementation = json!({
        "sdk": "rust", "entrypoint": "verify_signed_bundle_v2_at", "source": "checkout", "clock": "std::time::Instant", "unit": "ns",
        "runtime": { "profile": if cfg!(debug_assertions) { "debug" } else { "release" }, "os": std::env::consts::OS, "arch": std::env::consts::ARCH },
        "loaded": { "crates": "tools/conformance/wrappers/rust/Cargo.lock (see the build record)" },
    });
    let mut out = json!({ "contract": CONTRACT, "run_id": req["run_id"], "nonce": req["nonce"], "implementation": implementation });
    match failure {
        Some(f) => {
            out["status"] = json!("check_failed");
            out["failure"] = f;
        }
        None => {
            out["status"] = json!("ok");
            out["results"] = Value::Array(workloads.iter().map(|w| json!({
                "id": w.id, "verified": w.expect, "errors_first": first[&w.id], "warmup_checked": warmup, "checked": samples,
                "samples_ns": timings[&w.id],
            })).collect());
        }
    }
    let mut stdout = std::io::stdout();
    if stdout.write_all(out.to_string().as_bytes()).is_err() {
        std::process::exit(1);
    }
}
