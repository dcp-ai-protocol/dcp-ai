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
use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::composite_ops::composite_verify;
use dcp_ai::v2::composite_sig::CompositeSignature;
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::dual_hash::{dual_merkle_root, sha256_hex, sha3_256_hex, DualHash};
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::verify_signed_bundle_v2_at;
use serde_json::{json, Map, Value};

const CONTRACT: &str = "dcp-ai-conformance-external/1";
const CONTRACT_V2: &str = "dcp-ai-conformance-external/2";

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

/// A message longer than this many UTF-8 bytes (1 MiB, the same measure as the WASM wrapper) is never
/// classified as a profile rejection: it is reported as an error. The limit applies to this classifier only.
const MAX_REJECTION_MESSAGE: usize = 1 << 20;
const REJECTION_TEXTS: [&[u8]; 2] = [b"Non-integer number in V2 canonical form: ", b"Non-finite number in V2 canonical form: "];

/// The documented rejection text of canonicalize_v2, behind any number of `key "<k>": ` prefixes (<k> may
/// itself contain `": `) and `array[<digits>]: ` prefixes. Trying every possible end of a key backtracks
/// exponentially, so a small automaton runs over the bytes instead: one pass, a constant number of states
/// per byte. States, as bits: B at a prefix boundary; K1..K4 inside `key "`; KB inside the key; E1/E2 after
/// `"` and `":`; A1..A5 inside `array[`; D0 before the first digit; D in the digits; F1/F2 after `]` and `]:`.
fn is_documented_rejection(msg: &str) -> bool {
    const KEY_OPEN: &[u8] = b"key \"";
    const ARRAY_OPEN: &[u8] = b"array[";
    const B: u32 = 1;
    const KB: u32 = 1 << 5;
    const E1: u32 = 1 << 6;
    const E2: u32 = 1 << 7;
    const D0: u32 = 1 << 13;
    const D: u32 = 1 << 14;
    const F1: u32 = 1 << 15;
    const F2: u32 = 1 << 16;
    let k = |i: usize| 1u32 << i; // K1..K4: bits 1..4
    let a = |i: usize| 1u32 << (7 + i); // A1..A5: bits 8..12
    let bytes = msg.as_bytes();
    if bytes.len() > MAX_REJECTION_MESSAGE {
        return false;
    }
    let mut set = B;
    let mut i = 0;
    while set != 0 {
        if set & B != 0 && REJECTION_TEXTS.iter().any(|t| bytes[i..].starts_with(t)) {
            return true;
        }
        let Some(&c) = bytes.get(i) else { return false };
        let mut next = 0;
        if set & B != 0 {
            if c == KEY_OPEN[0] { next |= k(1); }
            if c == ARRAY_OPEN[0] { next |= a(1); }
        }
        for j in 1..=4 {
            if set & k(j) != 0 && c == KEY_OPEN[j] { next |= if j < 4 { k(j + 1) } else { KB }; }
        }
        if set & KB != 0 { next |= if c == b'"' { KB | E1 } else { KB }; }
        if set & E1 != 0 && c == b':' { next |= E2; }
        if set & E2 != 0 && c == b' ' { next |= B; }
        for j in 1..=5 {
            if set & a(j) != 0 && c == ARRAY_OPEN[j] { next |= if j < 5 { a(j + 1) } else { D0 }; }
        }
        if set & (D0 | D) != 0 && c.is_ascii_digit() { next |= D; }
        if set & D != 0 && c == b']' { next |= F1; }
        if set & F1 != 0 && c == b':' { next |= F2; }
        if set & F2 != 0 && c == b' ' { next |= B; }
        set = next;
        i += 1;
    }
    false
}

fn is_hex64(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// YYYY-MM-DDTHH:MM:SS[.fraction] followed by Z or ±HH:MM (the kit's contract; no local or implicit zone).
fn is_rfc3339_with_zone(t: &str) -> bool {
    let b = t.as_bytes();
    let digits = |r: std::ops::Range<usize>| r.clone().all(|i| b.get(i).is_some_and(u8::is_ascii_digit));
    if b.len() < 20 || !digits(0..4) || b[4] != b'-' || !digits(5..7) || b[7] != b'-' || !digits(8..10) || b[10] != b'T'
        || !digits(11..13) || b[13] != b':' || !digits(14..16) || b[16] != b':' || !digits(17..19) {
        return false;
    }
    let mut i = 19;
    if b[i] == b'.' { i += 1; let s = i; while i < b.len() && b[i].is_ascii_digit() { i += 1; } if i == s { return false; } }
    &t[i..] == "Z" || (b.len() == i + 6 && (b[i] == b'+' || b[i] == b'-') && digits(i + 1..i + 3) && b[i + 3] == b':' && digits(i + 4..i + 6))
}

/// Contract /2 (opt-in evidence): one call per case to dual_merkle_root, composite_verify (Ed25519 and
/// ML-DSA-65 providers, as the SDK's interop tests pass them) or verify_signed_bundle_v2_at.
fn run_evidence_case(id: &str, op: &str, o: &Map<String, Value>) -> Value {
    let need_str = |k: &str| -> &str { o.get(k).and_then(Value::as_str).unwrap_or_else(|| fail(&format!("case {id}: {k} must be a string"))) };
    match op {
        "dual_merkle_root" => {
            if !exact_keys(o, &["id", "op", "leaves"]) { fail(&format!("case {id}: fields do not match op {op}")); }
            let leaves: Vec<DualHash> = match o["leaves"].as_array() {
                Some(a) if !a.is_empty() && a.iter().all(|l| l.as_object().is_some_and(|m| exact_keys(m, &["sha256", "sha3_256"]) && m.values().all(is_hex64))) =>
                    serde_json::from_value(o["leaves"].clone()).unwrap_or_else(|e| fail(&format!("case {id}: leaves: {e}"))),
                _ => fail(&format!("case {id}: leaves must be {{sha256, sha3_256}} strings")),
            };
            match dual_merkle_root(&leaves) {
                Some(r) => json!({"id": id, "status": "ok", "sha256": r.sha256, "sha3_256": r.sha3_256}),
                None => json!({"id": id, "status": "error", "message": "dual_merkle_root returned no root"}),
            }
        }
        "composite_verify" => {
            if !exact_keys(o, &["id", "op", "context", "payload_b64", "composite_sig", "classical_public_key_b64", "pq_public_key_b64"]) || !o["composite_sig"].is_object() {
                fail(&format!("case {id}: fields do not match op {op}"));
            }
            let payload = decode_base64_strict(need_str("payload_b64")).unwrap_or_else(|| fail(&format!("case {id}: payload_b64 is not canonical base64")));
            let pq = match &o["pq_public_key_b64"] { Value::Null => None, Value::String(s) => Some(s.as_str()), _ => fail(&format!("case {id}: pq_public_key_b64 must be a string or null")) };
            let sig: CompositeSignature = serde_json::from_value(o["composite_sig"].clone()).unwrap_or_else(|e| fail(&format!("case {id}: composite_sig: {e}")));
            let ml = MlDsa65Provider;
            match composite_verify(&Ed25519Provider, Some(&ml as &dyn CryptoProvider), need_str("context"), &payload, &sig, need_str("classical_public_key_b64"), pq) {
                Ok(r) => json!({"id": id, "status": "ok", "valid": r.valid, "classical_valid": r.classical_valid, "pq_valid": r.pq_valid}),
                // The SDK reports an absent PQ signature under a pq_over_classical binding as an Err (its interop test
                // accepts that as the rejection). Only that exact error, for that exact input, is
                // rejected(missing_pq_signature); any other Err is an error.
                Err(e) if format!("{e:?}") == r#"SignatureError("pq_over_classical binding requires PQ signature")"#
                    && o["composite_sig"]["binding"] == "pq_over_classical" && o["composite_sig"]["pq"].is_null() =>
                    json!({"id": id, "status": "rejected", "code": "missing_pq_signature"}),
                Err(e) => json!({"id": id, "status": "error", "message": format!("{e:?}").chars().take(500).collect::<String>()}),
            }
        }
        _ => {
            if !exact_keys(o, &["id", "op", "bundle_b64", "policy", "verification_time"]) || !o["policy"].is_object() {
                fail(&format!("case {id}: fields do not match op {op}"));
            }
            let bytes = decode_base64_strict(need_str("bundle_b64")).unwrap_or_else(|| fail(&format!("case {id}: bundle_b64 is not canonical base64")));
            let t = need_str("verification_time");
            let now = if is_rfc3339_with_zone(t) { parse_rfc3339_millis(t) } else { None }
                .unwrap_or_else(|| fail(&format!("case {id}: verification_time is not RFC 3339 with an explicit zone")));
            let policy: VerifierPolicy = serde_json::from_value(o["policy"].clone()).unwrap_or_else(|e| fail(&format!("case {id}: policy: {e}")));
            let Some(signed) = std::str::from_utf8(&bytes).ok().and_then(|t| serde_json::from_str::<Value>(t).ok()) else {
                return json!({"id": id, "status": "rejected", "code": "parse"});
            };
            let r = verify_signed_bundle_v2_at(&signed, &policy, now).result;
            json!({"id": id, "status": "ok", "verified": r.verified, "errors": r.errors})
        }
    }
}

fn run_case(c: &Value, v2: bool) -> Value {
    let o = c.as_object().unwrap_or_else(|| fail("a case must be an object"));
    let id = o.get("id").and_then(Value::as_str).unwrap_or_else(|| fail("a case needs a string id")).to_string();
    // A missing or non-string op, alg or profile is an invalid request (exit 2), never "unsupported".
    let need_str = |k: &str| -> &str { o.get(k).and_then(Value::as_str).unwrap_or_else(|| fail(&format!("case {id}: {k} must be a string"))) };
    let op = need_str("op");
    if v2 && matches!(op, "dual_merkle_root" | "composite_verify" | "verify_signed_bundle_v2") {
        return run_evidence_case(&id, op, o);
    }
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
    let contract = r.get("contract").and_then(Value::as_str).unwrap_or("");
    if !exact_keys(r, &["contract", "run_id", "nonce", "cases"]) || (contract != CONTRACT && contract != CONTRACT_V2) {
        fail("the request needs exactly contract dcp-ai-conformance-external/1 or /2, run_id, nonce and cases");
    }
    let v2 = contract == CONTRACT_V2;
    let (Some(run_id), Some(nonce), Some(cases)) = (r["run_id"].as_str(), r["nonce"].as_str(), r["cases"].as_array()) else {
        fail("run_id and nonce must be strings and cases an array");
    };
    let results: Vec<Value> = cases.iter().map(|c| run_case(c, v2)).collect();
    let resp = json!({
        "contract": contract,
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
