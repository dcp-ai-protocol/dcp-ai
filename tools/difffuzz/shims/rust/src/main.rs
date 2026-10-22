//! Rust SDK shim for the differential fuzzer.
//!
//! Usage: difffuzz-rust-shim [mode] [--loop]
//!   stdin: one signed bundle (JSON document); with --loop, one compact JSON
//!          document per line.
//!   stdout: one line per document: {"valid": bool, "errors": [string]}
//!   mode: empty for VerifierPolicy::default(), or a verification mode applied
//!         to default_mode and to every risk tier (as the interop tests do).
//! Exit code 0 for a verdict; anything else (a panic) is a crash of the verifier.
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::verify_signed_bundle_v2_with_policy;
use std::io::{self, BufRead, Read, Write};

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
