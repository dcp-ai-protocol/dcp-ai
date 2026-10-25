//! Experimental candidate ingress (phase 1): the public corpus cases that test one unit from its
//! bytes, and focused examples. Bundle cases (selection, policy, configuration, migration, historical
//! parsers) and transport envelopes, the obsolete depth rule among them, belong to later phases: they
//! are counted here, not run.

use dcp_ai::v2::canonicalize::canonicalize_v2;
use dcp_ai::v2::experimental_candidate_ingress::{
    experimental_candidate_ingress, CandidateIngressOutcome, CandidateRejectClass,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn corpus(name: &str) -> Vec<Value> {
    let path = format!("{}/../../docs/proposals/canonicalization-candidate/{}", env!("CARGO_MANIFEST_DIR"), name);
    let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    file["cases"].as_array().unwrap().clone()
}

fn input_of(case: &Value) -> Vec<u8> {
    let bytes = match case.get("input_hex") {
        Some(h) => hex::decode(h.as_str().unwrap()).unwrap(),
        None => case["input_json"].as_str().unwrap().as_bytes().to_vec(),
    };
    assert_eq!(hex::encode(Sha256::digest(&bytes)), case["input_sha256"], "{}", case["id"]);
    bytes
}

fn ingest(input: &[u8]) -> CandidateIngressOutcome {
    experimental_candidate_ingress(input).expect("no internal error")
}

fn rejected(input: &[u8]) -> (&'static str, usize) {
    match ingest(input) {
        CandidateIngressOutcome::Reject { class, offset } => (class.as_str(), offset),
        other => panic!("{:?} was accepted: {:?}", String::from_utf8_lossy(input), other),
    }
}

fn canonical(input: &[u8]) -> String {
    match ingest(input) {
        CandidateIngressOutcome::Accept { value, canonical, .. } => {
            let text = String::from_utf8(canonical).unwrap();
            assert_eq!(canonicalize_v2(&value).unwrap(), text, "dcp-jcs-v1 output over the materialized value");
            text
        }
        other => panic!("{:?} was rejected: {:?}", String::from_utf8_lossy(input), other),
    }
}

#[test]
fn corpus_unit_cases_and_exclusions() {
    let baseline = corpus("baseline-corpus.json");
    let design = corpus("corpus.json");
    let document: Vec<&Value> = design
        .iter()
        .filter(|c| c["mode"] == "document" && c["transport"] == "bare" && c.get("options").is_none())
        .collect();
    let bundles = design.iter().filter(|c| c["mode"] == "bundle").count();
    let envelopes = design.iter().filter(|c| c["mode"] == "document" && c["transport"] == "envelope").count();
    assert_eq!((baseline.len(), document.len(), bundles, envelopes, design.len()), (87, 81, 77, 29, 187));

    for case in &baseline {
        let input = input_of(case);
        if case["expected"] == "accept" {
            assert_eq!(canonical(&input), case["canonical"].as_str().unwrap(), "{}", case["id"]);
            match ingest(&input) {
                CandidateIngressOutcome::Accept { canonical_sha256, .. } => assert_eq!(canonical_sha256, case["canonical_sha256"]),
                _ => unreachable!(),
            }
        } else {
            assert_eq!(rejected(&input).0, case["reject_class"], "{}", case["id"]);
        }
    }
    for case in document {
        let input = input_of(case);
        let expected = &case["expected"];
        if expected["result"] == "accept" {
            let text = canonical(&input);
            assert_eq!(hex::encode(Sha256::digest(text.as_bytes())), expected["canonical_sha256"], "{}", case["id"]);
        } else {
            let (class, offset) = rejected(&input);
            assert_eq!((json!(class), json!(offset)), (expected["class"].clone(), expected["offset"].clone()), "{}", case["id"]);
        }
    }
}

#[test]
fn ill_formed_utf8_and_bom() {
    for bad in [&b"\xc0\x80"[..], b"\xe0\x80\x80", b"\xed\xa0\x80", b"\xf4\x90\x80\x80", b"\xf5", b"\x80", b"\xe2\x82"] {
        let input = [&b"{\"s\":\""[..], bad, b"\"}"].concat();
        assert_eq!(rejected(&input), ("UTF8_INVALID", 6), "{:?}", bad);
    }
    assert_eq!(rejected(b"[,\"\xff\"]"), ("UTF8_INVALID", 3)); // the encoding layer wins over grammar
    assert_eq!(rejected(b"\xef\xbb\xbf{\"a\":1}"), ("BOM", 0));
    assert_eq!(rejected(b"\xef\xbb\xbf[\"\xff\"]"), ("BOM", 0));
    assert_eq!(canonical(b"[\"\xef\xbb\xbfx\"]").as_bytes(), b"[\"\xef\xbb\xbfx\"]");
}

#[test]
fn keys_after_unescaping_and_proto() {
    assert_eq!(rejected(b"{\"a\":1,\"\\u0061\":2}"), ("DUPLICATE_KEY", 7));
    assert_eq!(rejected("{\"\\u00e9\":1,\"\u{e9}\":2}".as_bytes()), ("DUPLICATE_KEY", 12));
    assert_eq!(rejected("{\"\\ud83d\\ude00\":1,\"\u{1f600}\":2}".as_bytes()), ("DUPLICATE_KEY", 18));
    assert_eq!(canonical("{\"\u{e9}\":1,\"e\\u0301\":2}".as_bytes()), "{\"e\u{301}\":2,\"\u{e9}\":1}");
    assert_eq!(rejected(b"{\"\\ud800\":1,\"\\ud800\":2}"), ("SURROGATE_UNPAIRED", 2));
    match ingest(b"{\"__proto__\":{\"x\":1},\"y\":[]}") {
        CandidateIngressOutcome::Accept { value, canonical, .. } => {
            assert_eq!(value, json!({"__proto__": {"x": 1}, "y": []}));
            assert_eq!(canonical, b"{\"__proto__\":{\"x\":1},\"y\":[]}");
        }
        other => panic!("{:?}", other),
    }
    assert_eq!(rejected(b"{\"__proto__\":1,\"__proto__\":2}"), ("DUPLICATE_KEY", 15));
}

#[test]
fn numbers_on_the_exact_literal_with_saturated_exponents() {
    assert_eq!(
        canonical(b"[9007199254740991,-9007199254740991,-0,-0.0e-0,0e99999999999999999999999]"),
        "[9007199254740991,-9007199254740991,0,0,0]"
    );
    assert_eq!(canonical(b"[100000000000000000000e-5,1.5e1,100e-2,1E+2]"), "[1000000000000000,15,1,100]");
    assert_eq!(canonical(format!("[1{}e-100000]", "0".repeat(100000)).as_bytes()), "[1]");
    assert_eq!(canonical(format!("[0.{}1e50001]", "0".repeat(50000)).as_bytes()), "[1]");
    for (text, class) in [
        ("[9007199254740992]", "NUMBER_OUT_OF_RANGE"),
        ("[1e21]", "NUMBER_OUT_OF_RANGE"),
        ("[1e99999999999999999999999]", "NUMBER_OUT_OF_RANGE"),
        ("[1e-99999999999999999999999]", "NUMBER_NOT_INTEGER"),
        ("[1.0000000000000001]", "NUMBER_NOT_INTEGER"),
        ("[4503599627370497.5e40]", "NUMBER_OUT_OF_RANGE"),
        ("[0.5e-400000000000]", "NUMBER_NOT_INTEGER"),
    ] {
        assert_eq!(rejected(text.as_bytes()), (class, 1), "{}", text);
    }
}

#[test]
fn surrogate_pairs_and_output_escapes() {
    assert_eq!(canonical(b"[\"\\ud83d\\ude00\"]"), "[\"\u{1f600}\"]");
    for text in ["[\"\\ud83d\"]", "[\"\\ude00\"]", "[\"\\ud83d\\u0041\"]", "[\"\\ud83d\\ud83d\\ude00\"]", "[\"\\ud83dx\"]"] {
        assert_eq!(rejected(text.as_bytes()), ("SURROGATE_UNPAIRED", 2), "{}", text);
    }
    assert_eq!(rejected(b"[\"\\ud83d\\uZZZZ\"]"), ("SYNTAX", 10));
    assert_eq!(
        canonical(b"[\"\\u0000\\u001f\\b\\t\\n\\f\\r\\\"\\\\\\/\\u007f\\u2028\"]"),
        "[\"\\u0000\\u001f\\b\\t\\n\\f\\r\\\"\\\\/\u{7f}\u{2028}\"]"
    );
}

#[test]
fn depth_from_the_unit_root_and_grammar_past_level_64() {
    let nest = |open: usize, close: usize, tail: &str| format!("{}{}{}", "[".repeat(open), "]".repeat(close), tail);
    assert_eq!(canonical(nest(64, 64, "").as_bytes()), nest(64, 64, ""));
    assert_eq!(rejected(nest(65, 65, "").as_bytes()), ("DEPTH_EXCEEDED", 64));
    assert_eq!(rejected(format!("{}1.5{}", "[".repeat(65), "]".repeat(65)).as_bytes()), ("DEPTH_EXCEEDED", 64));
    assert_eq!(rejected(nest(20000, 20000, "").as_bytes()), ("DEPTH_EXCEEDED", 64));
    assert_eq!(rejected(nest(20000, 19999, "").as_bytes()), ("SYNTAX", 39999));
    assert_eq!(rejected(nest(20000, 19999, "}").as_bytes()), ("SYNTAX", 39999));
    assert_eq!(rejected(b"{\"a\":1,\"a\":2,}"), ("SYNTAX", 13)); // grammar wins over a value-level defect
    assert_eq!(CandidateRejectClass::DepthExceeded.as_str(), "DEPTH_EXCEEDED");
}
