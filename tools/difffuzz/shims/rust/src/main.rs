//! Rust SDK shim for the differential fuzzer.
//!
//! Usage: difffuzz-rust-shim [mode] [--loop]
//!   stdin: one signed bundle (JSON document); with --loop, one compact JSON
//!          document per line.
//!   stdout: one line per document: {"valid": bool, "errors": [string]}
//!   mode: empty for VerifierPolicy::default(), or a verification mode applied
//!         to default_mode and to every risk tier (as the interop tests do).
//! Exit code 0 for a verdict; anything else (a panic) is a crash of the verifier.
//!
//! Usage: difffuzz-rust-shim --batch   (the driver's protocol, dcp-difffuzz/2; see README.md)
//!   stdin: one request {protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}; stdout: one response
//!   with exactly one result per case: verdict {verified, errors}, parse_rejected {message}, error {message} (the SDK
//!   panicked) or unsupported. Each case is verified under its own explicit policy with verify_signed_bundle_v2_at at
//!   now_ms. A malformed request exits 2. Base64 is decoded here with std only, so the manifest gains no dependency.
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::{verify_signed_bundle_v2_at, verify_signed_bundle_v2_with_policy};
use serde_json::{json, Map, Value};
use std::io::{self, BufRead, Read, Write};

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(data: &[u8]) -> String {
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            s.push(if k <= c.len() { B64[(n >> (18 - 6 * k) & 63) as usize] as char } else { '=' });
        }
    }
    s
}

/// Canonical RFC 4648 base64 with padding only: decoded, then the same string after re-encoding.
fn b64_decode_strict(s: &str) -> Option<Vec<u8>> {
    let b = s.as_bytes();
    if b.len() % 4 != 0 {
        return None;
    }
    let pad = b.iter().rev().take_while(|&&c| c == b'=').count();
    if pad > 2 {
        return None;
    }
    let mut out = Vec::with_capacity(b.len() / 4 * 3);
    let mut acc = 0u32;
    for (i, &c) in b[..b.len() - pad].iter().enumerate() {
        let v = B64.iter().position(|&x| x == c)? as u32;
        acc = acc << 6 | v;
        if i % 4 == 3 {
            out.extend_from_slice(&[(acc >> 16) as u8, (acc >> 8) as u8, acc as u8]);
            acc = 0;
        }
    }
    match pad {
        1 => out.extend_from_slice(&[(acc >> 10) as u8, (acc >> 2) as u8]),
        2 => out.push((acc >> 4) as u8),
        _ => {}
    }
    (b64_encode(&out) == s).then_some(out)
}

fn bad_request(why: &str) -> ! {
    eprintln!("invalid request: {why}");
    std::process::exit(2)
}

fn exact_keys(o: &Map<String, Value>, keys: &[&str]) -> bool {
    o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k))
}

fn batch() {
    let mut text = String::new();
    if io::stdin().read_to_string(&mut text).is_err() {
        bad_request("stdin is not UTF-8");
    }
    let req: Value = serde_json::from_str(&text).unwrap_or_else(|e| bad_request(&format!("not JSON: {e}")));
    let Some(o) = req.as_object().filter(|o| exact_keys(o, &["protocol", "run_id", "nonce", "now_ms", "cases"])) else { bad_request("envelope") };
    let (Some("dcp-difffuzz/2"), Some(now_ms), Some(cases)) = (o["protocol"].as_str(), o["now_ms"].as_i64(), o["cases"].as_array()) else { bad_request("envelope") };
    let mut results = Vec::with_capacity(cases.len());
    for c in cases {
        let Some(c) = c.as_object().filter(|c| exact_keys(c, &["id", "policy", "bundle_b64"]) && c["policy"].is_object()) else { bad_request("case fields") };
        let (Some(id), Some(b64)) = (c["id"].as_str(), c["bundle_b64"].as_str()) else { bad_request("case fields") };
        let policy: VerifierPolicy = serde_json::from_value(c["policy"].clone()).unwrap_or_else(|e| bad_request(&format!("case {id}: policy: {e}")));
        let bytes = b64_decode_strict(b64).unwrap_or_else(|| bad_request(&format!("case {id}: bundle_b64 is not canonical base64")));
        let doc = match std::str::from_utf8(&bytes).map_err(|e| e.to_string()).and_then(|t| serde_json::from_str::<Value>(t).map_err(|e| e.to_string())) {
            Ok(doc) => doc,
            Err(e) => {
                results.push(json!({"id": id, "status": "parse_rejected", "message": e.chars().take(500).collect::<String>()}));
                continue;
            }
        };
        // A panic of the SDK is an error result, never a verdict.
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| verify_signed_bundle_v2_at(&doc, &policy, now_ms).result));
        results.push(match r {
            Ok(r) => json!({"id": id, "status": "verdict", "verified": r.verified, "errors": r.errors}),
            Err(p) => {
                let msg = p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                json!({"id": id, "status": "error", "message": format!("panic: {}", msg.chars().take(480).collect::<String>())})
            }
        });
    }
    println!("{}", json!({"protocol": "dcp-difffuzz/2", "run_id": o["run_id"], "nonce": o["nonce"], "results": results}));
}

fn verdict(text: &str, policy: &VerifierPolicy) -> String {
    let (valid, errors) = match serde_json::from_str::<serde_json::Value>(text) {
        Ok(doc) => {
            let r = verify_signed_bundle_v2_with_policy(&doc, policy);
            (r.verified, r.errors)
        }
        Err(e) => (false, vec![format!("JSON parse error: {e}")]),
    };
    serde_json::json!({ "valid": valid, "errors": errors }).to_string()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--batch") {
        return batch();
    }
    let is_loop = args.iter().any(|a| a == "--loop");
    let mode = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .cloned()
        .unwrap_or_default();
    let mut policy = VerifierPolicy::default();
    if !mode.is_empty() {
        policy.default_mode = mode.clone();
        policy.risk_overrides = ["low", "medium", "high"]
            .iter()
            .map(|t| (t.to_string(), mode.clone()))
            .collect();
    }

    let stdout = io::stdout();
    let mut out = stdout.lock();
    if is_loop {
        for line in io::stdin().lock().lines() {
            let line = line.expect("read stdin");
            if line.trim().is_empty() {
                continue;
            }
            writeln!(out, "{}", verdict(&line, &policy)).expect("write stdout");
            out.flush().expect("flush stdout");
        }
    } else {
        let mut text = String::new();
        io::stdin().read_to_string(&mut text).expect("read stdin");
        writeln!(out, "{}", verdict(&text, &policy)).expect("write stdout");
    }
}
