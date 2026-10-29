//! External conformance wrapper for the Rust SDK (contract dcp-ai-conformance-external/1,
//! tools/conformance/README.md). Reads one request on stdin and writes one response on stdout.
//!
//! canonicalize: fatal UTF-8 decoding and serde_json::from_str (a failure is rejected/parse), then ONE
//! call to dcp_ai::v2::canonicalize::canonicalize_v2. Only its documented rejection ("Non-integer number
//! in V2 canonical form:" / "Non-finite number in V2 canonical form:", possibly behind `key "…": ` and
//! `array[i]: ` path prefixes; an Err(String) with no stable code) is rejected/profile; any other Err is
//! an error. digest: dcp_ai::v2::dual_hash::sha256_hex / sha3_256_hex of the decoded bytes.

use std::io::{Read, Write};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use dcp_ai::v2::canonicalize::canonicalize_v2;
use dcp_ai::v2::dual_hash::{sha256_hex, sha3_256_hex};
use serde_json::{json, Map, Value};

const CONTRACT: &str = "dcp-ai-conformance-external/1";

fn fail(msg: &str) -> ! {
    eprintln!("rust wrapper: {msg}");
    std::process::exit(2);
}

fn exact_keys(o: &Map<String, Value>, want: &[&str]) -> bool {
    o.len() == want.len() && want.iter().all(|k| o.contains_key(*k))
}

/// Canonical RFC 4648 base64 with padding only: the same string after re-encoding.
fn decode_base64_strict(s: &str) -> Option<Vec<u8>> {
    let b = STANDARD.decode(s).ok()?;
    (STANDARD.encode(&b) == s).then_some(b)
}

/// The documented rejection text of canonicalize_v2, behind any number of path prefixes. A key may
/// itself contain `": `, so every possible end of a `key "…": ` prefix is tried.
fn is_documented_rejection(msg: &str) -> bool {
    if msg.starts_with("Non-integer number in V2 canonical form: ") || msg.starts_with("Non-finite number in V2 canonical form: ") {
        return true;
    }
    if let Some(after) = msg.strip_prefix("array[") {
        return match after.find("]: ") {
            Some(i) if i > 0 && after[..i].bytes().all(|b| b.is_ascii_digit()) => is_documented_rejection(&after[i + 3..]),
            _ => false,
        };
    }
    if let Some(after) = msg.strip_prefix("key \"") {
        return after.match_indices("\": ").any(|(i, _)| is_documented_rejection(&after[i + 3..]));
    }
    false
}

fn run_case(c: &Value) -> Value {
    let o = c.as_object().unwrap_or_else(|| fail("a case must be an object"));
    let id = o.get("id").and_then(Value::as_str).unwrap_or_else(|| fail("a case needs a string id")).to_string();
    // A missing or non-string op, alg or profile is an invalid request (exit 2), never "unsupported".
    let need_str = |k: &str| -> &str { o.get(k).and_then(Value::as_str).unwrap_or_else(|| fail(&format!("case {id}: {k} must be a string"))) };
    let op = need_str("op");
    let fields: &[&str] = match op {
        "canonicalize" => &["id", "op", "profile", "input_b64"],
        "digest" => &["id", "op", "alg", "input_b64"],
        _ => return json!({"id": id, "status": "unsupported"}),
    };
    if !exact_keys(o, fields) {
        fail(&format!("case fields do not match op {op}"));
    }
    let b64 = need_str("input_b64");
    let input = decode_base64_strict(b64).unwrap_or_else(|| fail(&format!("case {id}: input_b64 is not canonical base64")));
    if op == "digest" {
        return match need_str("alg") {
            "sha256" => json!({"id": id, "status": "ok", "hex": sha256_hex(&input)}),
            "sha3-256" => json!({"id": id, "status": "ok", "hex": sha3_256_hex(&input)}),
            _ => json!({"id": id, "status": "unsupported"}),
        };
    }
    if need_str("profile") != "dcp-jcs-v1" {
        return json!({"id": id, "status": "unsupported"});
    }
    let text = match std::str::from_utf8(&input) {
        Ok(t) => t,
        Err(_) => return json!({"id": id, "status": "rejected", "code": "parse"}),
    };
    let value: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return json!({"id": id, "status": "rejected", "code": "parse"}),
    };
    match canonicalize_v2(&value) {
        Ok(out) => json!({"id": id, "status": "ok", "output_b64": STANDARD.encode(out.as_bytes())}),
        Err(e) if is_documented_rejection(&e) => json!({"id": id, "status": "rejected", "code": "profile"}),
        Err(e) => json!({"id": id, "status": "error", "message": e.chars().take(500).collect::<String>()}),
    }
}

fn main() {
    let mut data = Vec::new();
    if std::io::stdin().read_to_end(&mut data).is_err() {
        fail("cannot read stdin");
    }
    let text = std::str::from_utf8(&data).unwrap_or_else(|_| fail("the request is not UTF-8"));
    let req: Value = serde_json::from_str(text).unwrap_or_else(|e| fail(&format!("the request is not JSON: {e}")));
    let r = req.as_object().unwrap_or_else(|| fail("the request must be an object"));
    if !exact_keys(r, &["contract", "run_id", "nonce", "cases"]) || r.get("contract").and_then(Value::as_str) != Some(CONTRACT) {
        fail("the request needs exactly contract dcp-ai-conformance-external/1, run_id, nonce and cases");
    }
    let (Some(run_id), Some(nonce), Some(cases)) = (r["run_id"].as_str(), r["nonce"].as_str(), r["cases"].as_array()) else {
        fail("run_id and nonce must be strings and cases an array");
    };
    let results: Vec<Value> = cases.iter().map(run_case).collect();
    let resp = json!({
        "contract": CONTRACT,
        "run_id": run_id,
        "nonce": nonce,
        "implementation": {
            "name": "dcp-ai Rust SDK via tools/conformance/wrappers/rust",
            "version": dcp_ai::observability::DCP_SDK_VERSION,
            "resolved_from": "path dependency ../../../../sdks/rust",
            "runtime": format!("native {}-{}", std::env::consts::ARCH, std::env::consts::OS),
        },
        "results": results,
    });
    let mut out = std::io::stdout().lock();
    if writeln!(out, "{resp}").is_err() {
        std::process::exit(3);
    }
}
