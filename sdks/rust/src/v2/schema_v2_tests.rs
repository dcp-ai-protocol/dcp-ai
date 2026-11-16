//! V2-2 in the Rust SDK, the internal interpreter (schema_v2.rs) over the shared corpus of
//! tests/interop/v2/schema_validation/: its value domain (serde_json::Value), the programs, the date-time boundary,
//! the error budget and the one-time initialization. tests/schema_v2.rs runs the gate through the public APIs.

use super::*;
use crate::v2::security_tier::compute_security_tier;
use crate::v2::session_nonce::parse_rfc3339_millis;
use crate::v2::types::VerifierPolicy;
use crate::v2::verify_bundle::verify_signed_bundle_v2_at;
use serde_json::json;

fn repo(rel: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(rel)
}

fn shared(name: &str) -> Value {
    let path = repo("tests/interop/v2/schema_validation").join(name);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn v1(doc: &Value) -> SchemaResult {
    validate_signed_bundle_v2_schema(doc, "dcp-jcs-v1").unwrap()
}

fn pairs(r: &SchemaResult) -> Vec<(String, &'static str)> {
    r.errors.iter().map(|e| (e.instance.clone(), e.keyword)).collect()
}

fn instance() -> Value {
    shared("schema_cases.json")["instance"].clone()
}

fn at(f: impl FnOnce(&mut Value)) -> SchemaResult {
    let mut d = instance();
    f(&mut d);
    v1(&d)
}

#[test]
fn the_ir_is_the_staged_ir_with_its_sha256_and_the_ported_notice_is_kept() {
    let staged = std::fs::read_to_string(repo("tools/schema-ir/staging/ir.json")).unwrap();
    assert_eq!(staged.trim_end_matches('\n'), SCHEMA_V2_IR);
    assert_eq!(hex::encode(Sha256::digest(SCHEMA_V2_IR.as_bytes())), SCHEMA_V2_IR_SHA256);
    let ir: Value = serde_json::from_str(SCHEMA_V2_IR).unwrap();
    assert_eq!(ir["format"], "dcp-ai.v2-schema-ir/1");
    let sources = ir["sources"].as_array().unwrap();
    assert_eq!(sources.len(), 11);
    for s in sources {
        let bytes = std::fs::read(repo(s["file"].as_str().unwrap())).unwrap();
        assert_eq!(hex::encode(Sha256::digest(&bytes)), s["sha256"], "{}", s["file"]);
    }
    let source = include_str!("schema_v2.rs");
    assert!(source.contains("Copyright (c) 2020 Evgeny Poberezkin") && source.contains("MIT License"));
}

/// Every one of the 468 cases: the representable ones through the interpreter (verdict, attribution, nothing
/// written) and the verifier (V2-2 alone on a negative, no schema error on a positive); the three serde_json cannot
/// represent are its parse errors, recorded apart and never counted as schema evaluations.
#[test]
fn the_468_schema_cases_get_their_verdict_and_attribution_and_nothing_is_written() {
    let corpus = shared("schema_cases.json");
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 468);
    let base = corpus["instance"].clone();
    assert!(v1(&base).valid);
    let text = serde_json::to_string(&base).unwrap();
    let now = parse_rfc3339_millis("2026-10-22T00:00:00Z").unwrap();
    let (mut parse_errors, mut valid, mut invalid) = (Vec::new(), 0, 0);
    for c in cases {
        let id = c["id"].as_str().unwrap();
        let expect = &c["expect"]["schema"];
        let doc: Value = if let Some(r) = c.get("raw_replace") {
            let (from, to) = (r[0].as_str().unwrap(), r[1].as_str().unwrap());
            assert_eq!(text.matches(from).count(), 1, "{id}: raw_replace target");
            match serde_json::from_str(&text.replacen(from, to, 1)) {
                Ok(d) => d,
                Err(_) => {
                    // A lone surrogate escape or 1e400: serde_json refuses the text before any schema check, whatever
                    // the schema would say (legal_name's lone surrogate is schema-valid for the other SDKs).
                    parse_errors.push((id.to_string(), expect["valid"].as_bool().unwrap()));
                    continue;
                }
            }
        } else {
            let mut d = base.clone();
            if let Some(m) = c.get("mutation") {
                let path: Vec<&Value> = m["path"].as_array().unwrap().iter().collect();
                match m["op"].as_str().unwrap() {
                    "set" if path.is_empty() => d = m["value"].clone(),
                    "set" | "delete" => {
                        let mut node = &mut d;
                        for k in &path[..path.len() - 1] {
                            node = match k {
                                Value::String(s) => &mut node[s.as_str()],
                                n => &mut node[n.as_u64().unwrap() as usize],
                            };
                        }
                        let last = path[path.len() - 1];
                        match (m["op"].as_str().unwrap(), last) {
                            ("set", Value::String(s)) => node[s.as_str()] = m["value"].clone(),
                            ("set", n) => node[n.as_u64().unwrap() as usize] = m["value"].clone(),
                            (_, Value::String(s)) => {
                                node.as_object_mut().unwrap().remove(s.as_str());
                            }
                            (_, n) => panic!("{id}: delete at {n}"),
                        }
                    }
                    "many" => {
                        for i in 0..m["count"].as_u64().unwrap() {
                            d[format!("x_unknown_{i:02}")] = json!(i);
                        }
                    }
                    op => panic!("{id}: op {op}"),
                }
            }
            d
        };
        let before = serde_json::to_string(&doc).unwrap();
        let r = v1(&doc);
        assert_eq!(serde_json::to_string(&doc).unwrap(), before, "{id}: the value was written");
        assert_eq!(r.valid, expect["valid"].as_bool().unwrap(), "{id}: {:?}", r.errors);
        let attribution = expect.get("attribution");
        if let Some(a) = attribution {
            let want = (a["instance"].as_str().unwrap().to_string(), a["keyword"].as_str().unwrap());
            assert!(pairs(&r).iter().any(|p| p.0 == want.0 && p.1 == want.1), "{id}: {:?}", r.errors);
        }
        if r.valid { valid += 1 } else { invalid += 1 }

        // The verifier on the value: V2-2 alone on a negative, never on a positive.
        let d = verify_signed_bundle_v2_at(&doc, &VerifierPolicy::default(), now);
        let schema = d.result.errors.iter().filter(|e| e.starts_with("schema: ")).count();
        if r.valid {
            assert_eq!(schema, 0, "{id}: {:?}", d.result.errors);
        } else {
            assert!(!d.result.verified && schema == d.result.errors.len() && d.signer_keys.is_empty(), "{id}: {:?}", d.result.errors);
            if let Some(a) = attribution {
                let instance = match a["instance"].as_str().unwrap() {
                    "" => "/",
                    i => i,
                };
                let target = format!("schema: {} {}", instance, a["keyword"].as_str().unwrap());
                assert!(d.result.errors.iter().any(|e| *e == target || e.starts_with(&format!("{target} "))), "{id}: {:?}", d.result.errors);
            }
        }
    }
    parse_errors.sort();
    let refused = [
        ("raw:audit_count 1e400 (non-finite after parsing)", false),
        ("raw:jurisdiction lone surrogate", false),
        ("raw:legal_name lone surrogate", true),
    ];
    assert_eq!(parse_errors, refused.map(|(id, v)| (id.to_string(), v)), "the serde_json parse errors, by the corpus's schema verdict");
    assert_eq!((valid, invalid), (60, 405), "the 465 representable cases");
}

#[test]
fn payloads_are_closed_by_their_artifact_schema_and_open_objects_stay_open() {
    let r = at(|d| d["bundle"]["intent"]["payload"]["x_unknown"] = json!(1));
    assert_eq!(pairs(&r), [("/bundle/intent/payload".to_string(), "additionalProperties")]);
    let r = at(|d| {
        d["bundle"]["x"] = json!({"deep": [1, [2, {"three": null}]]});
        d["bundle"]["intent"]["payload"]["target"]["x"] = json!("open");
        d["bundle"]["policy_decision"]["payload"]["required_confirmation"] = json!({"type": "human_approve", "x": "open"});
        d["bundle"]["audit_entries"][0]["evidence"]["x"] = json!("open");
    });
    assert!(r.valid, "{:?}", r.errors);
}

/// The value domain is serde_json::Value: an i64, a u64 or a finite f64 for a number. An integer is any of them with
/// no fraction; a bound compares an integer exactly.
#[test]
fn the_native_boundary_of_numbers_strings_lists_and_keys() {
    let count = |v: Value| at(|d| d["bundle"]["manifest"]["audit_count"] = v);
    for good in [json!(3), json!(3.0), json!(u64::MAX), json!(i64::MAX), json!(1e300), json!(-0.0), json!(0)] {
        // integers at or above minimum 0, with no maximum
        let r = count(good.clone());
        assert!(r.valid, "{good}: {:?}", r.errors);
    }
    assert_eq!(pairs(&count(json!(-1))), [("/bundle/manifest/audit_count".to_string(), "minimum")]);
    for bad in [json!(3.5), json!(true), json!(false), json!("3"), Value::Null, json!([3]), json!({"n": 3})] {
        assert!(!count(bad.clone()).valid, "{bad}");
    }
    // risk_score: integer, 0..=1000 inclusive, compared exactly
    let risk = |v: Value| pairs(&at(|d| d["bundle"]["policy_decision"]["payload"]["risk_score"] = v));
    let at_risk = "/bundle/policy_decision/payload/risk_score".to_string();
    for ok in [json!(0), json!(1000), json!(1000.0), json!(0.0), json!(-0.0)] {
        assert_eq!(risk(ok.clone()), [], "{ok}");
    }
    assert_eq!(risk(json!(1001)), [(at_risk.clone(), "maximum")]);
    assert_eq!(risk(json!(-1)), [(at_risk.clone(), "minimum")]);
    assert_eq!(risk(json!(u64::MAX)), [(at_risk.clone(), "maximum")]);
    assert_eq!(risk(json!(i64::MIN)), [(at_risk.clone(), "minimum")]);
    assert_eq!(risk(json!(1000.5)), [(at_risk.clone(), "type"), (at_risk.clone(), "maximum")]);
    assert_eq!(risk(json!(1e300)), [(at_risk.clone(), "maximum")]);
    assert_eq!(cmp_number(&Number::from(9_007_199_254_740_993u64), &Number::from_f64(9_007_199_254_740_992.0).unwrap()), Ordering::Greater);
    assert_eq!(cmp_number(&Number::from(-1i64), &Number::from_f64(-0.5).unwrap()), Ordering::Less);
    assert_eq!(cmp_number(&Number::from(0u64), &Number::from_f64(-0.5).unwrap()), Ordering::Greater);
    // absent and null differ
    assert!(at(|d| d["bundle"]["responsible_principal_record"]["payload"]["expires_at"] = Value::Null).valid);
    let r = at(|d| {
        d["bundle"]["responsible_principal_record"]["payload"].as_object_mut().unwrap().remove("expires_at");
    });
    assert_eq!(r.errors.iter().map(|e| (e.keyword, e.member.clone())).collect::<Vec<_>>(), [("required", Some("expires_at".to_string()))]);
    // code points: an astral character counts one; a lone surrogate never reaches a Rust string
    let jur = |s: &str| at(|d| d["bundle"]["responsible_principal_record"]["payload"]["jurisdiction"] = json!(s)).valid;
    assert!(jur("\u{1F600}\u{1F600}") && !jur("\u{1F600}") && jur("\u{FFFD}\u{FFFD}") && !jur("\u{FFFD}"));
    assert!(serde_json::from_str::<Value>(r#""\ud800""#).is_err());
}

#[test]
fn one_of_is_one_branch_reported_once() {
    let base = instance();
    let pq = |v: Value| at(|d| d["signature"]["composite_sig"]["pq"] = v);
    assert!(pq(Value::Null).valid && pq(base["signature"]["composite_sig"]["pq"].clone()).valid);
    let mut extra = base["signature"]["composite_sig"]["pq"].clone();
    extra["x"] = json!(1);
    for v in [json!({}), json!(false), json!("x"), extra] {
        assert_eq!(pairs(&pq(v.clone())), [("/signature/composite_sig/pq".to_string(), "oneOf")], "{v}");
    }
}

/// Each program against samples whose answer follows from its anchored ASCII source by hand (the crate has no
/// regex engine to compare with; TypeScript, Python and Go compare these same IR programs with their own engines).
#[test]
fn each_pattern_program_answers_as_its_anchored_source() {
    let h = |n: usize, c: &str| c.repeat(n);
    let samples: [(&str, Vec<(String, bool)>); 7] = [
        ("^[0-9a-f]{32}$", vec![(h(32, "a"), true), (h(31, "a"), false), (h(33, "a"), false), (h(32, "A"), false), (format!("{}\n", h(32, "a")), false), (format!("{}\u{0661}", h(31, "0")), false), (String::new(), false)]),
        ("^[A-Za-z0-9+/]+={0,2}$", vec![("AAAA".into(), true), ("AAAA==".into(), true), ("AAAA===".into(), false), ("=".into(), false), (String::new(), false), ("AA AA".into(), false), ("AAAA\n".into(), false), ("-_".into(), false)]),
        ("^sha256:[0-9a-f]{64}$", vec![(format!("sha256:{}", h(64, "a")), true), (format!("sha256:{}", h(63, "a")), false), (format!("SHA256:{}", h(64, "a")), false), (format!("sha256:{}\n", h(64, "a")), false)]),
        ("^sha3-256:[0-9a-f]{64}$", vec![(format!("sha3-256:{}", h(64, "0")), true), (format!("sha3-256:{}", h(65, "0")), false), (format!("sha256:{}", h(64, "0")), false)]),
        ("^(sha256:[0-9a-f]{64}|GENESIS)$", vec![("GENESIS".into(), true), ("GENESIS\n".into(), false), ("genesis".into(), false), (format!("sha256:{}", h(64, "f")), true), (format!("sha256:{}GENESIS", h(64, "f")), false)]),
        ("^(sha3-256:[0-9a-f]{64}|GENESIS)$", vec![("GENESIS".into(), true), (format!("sha3-256:{}", h(64, "9")), true), (format!("sha256:{}", h(64, "9")), false)]),
        ("^[0-9a-f]{64}$", vec![(h(64, "f"), true), (h(64, "g"), false), (h(63, "f"), false), (format!("{}\u{1F600}", h(63, "f")), false)]),
    ];
    let programs = patterns();
    assert_eq!(programs.len(), samples.len());
    for (p, (source, cases)) in programs.iter().zip(&samples) {
        assert_eq!(p.source, *source);
        for (s, want) in cases {
            assert_eq!(match_program(p, s), *want, "{source} on {s:?}");
        }
    }
}

#[test]
fn date_time_is_the_ajv_formats_boundary_on_the_shared_cases_and_every_bmp_separator() {
    let d = shared("date_time_cases.json");
    let cases = d["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let v = c["value"].as_str().unwrap();
        assert_eq!(is_schema_date_time(v), c["accepted"].as_bool().unwrap(), "{v:?}");
    }
    let accepted: Vec<String> = (0u32..0x10000)
        .filter_map(char::from_u32)
        .filter(|c| is_schema_date_time(&format!("2000-01-01{c}00:00:00Z")))
        .map(|c| format!("U+{:04X}", c as u32))
        .collect();
    assert_eq!(serde_json::to_value(&accepted).unwrap(), d["separator_scalars"]);
    assert_eq!(accepted.len(), 27);
}

#[test]
fn the_error_budget_and_bounded_escaped_diagnostics() {
    let many = |n: usize| {
        at(|d| {
            for i in 0..n {
                d[format!("x_{i}")] = json!(i);
            }
        })
    };
    let (r16, r17) = (many(16), many(17));
    assert_eq!((r16.errors.len(), r16.truncated, r16.valid), (16, false, false));
    assert_eq!((r17.errors.len(), r17.truncated, r17.valid), (SCHEMA_ERRORS_CAP, true, false));
    assert_eq!(schema_diagnostics(&r17).last().unwrap(), "schema: further errors not listed");
    let lines = schema_diagnostics(&at(|d| {
        d["x".repeat(1 << 20)] = json!("v".repeat(1 << 20));
        d["~/".repeat(100)] = json!(1);
        d["bundle"]["manifest"]["intended_verifier"] = json!("w".repeat(5000));
    }));
    let all = lines.join("\n");
    assert!(!all.contains("vvvv") && !all.contains("wwww"), "a value is echoed");
    assert!(lines.iter().all(|l| l.chars().count() < 200), "{lines:?}");
    assert!(lines.iter().any(|l| l.starts_with("schema: / additionalProperties ~0~1") && l.ends_with("…[cut]")), "{lines:?}");
}

#[test]
fn the_overlay_changes_one_const_in_both_directions() {
    let errors = |p: Option<&str>, profile: &str| {
        let mut d = instance();
        let m = d["bundle"]["manifest"].as_object_mut().unwrap();
        match p {
            Some(p) => m.insert("canonicalization_profile".into(), json!(p)),
            None => m.remove("canonicalization_profile"),
        };
        pairs(&validate_signed_bundle_v2_schema(&d, profile).unwrap())
    };
    let constant = [("/bundle/manifest/canonicalization_profile".to_string(), "const")];
    assert_eq!(errors(Some("dcp-jcs-v1"), "dcp-jcs-v1"), []);
    assert_eq!(errors(Some("dcp-jcs-v2"), "dcp-jcs-v2"), []);
    assert_eq!(errors(Some("dcp-jcs-v2"), "dcp-jcs-v1"), constant);
    assert_eq!(errors(Some("dcp-jcs-v1"), "dcp-jcs-v2"), constant);
    assert_eq!(errors(None, "dcp-jcs-v2"), []);
    assert!(validate_signed_bundle_v2_schema(&json!({}), "dcp-jcs-v3").is_err());
}

/// The IR is built once and read-only afterwards: 32 threads race to initialize a fresh cell, and 32 threads use the
/// shared one at the same time.
#[test]
fn concurrent_initialization_and_use() {
    fresh_load().unwrap();
    let base = instance();
    std::thread::scope(|s| {
        let handles: Vec<_> = (0..32)
            .map(|i| {
                let mut d = base.clone();
                s.spawn(move || {
                    if i % 2 == 1 {
                        d["bundle"]["intent"]["payload"]["x"] = json!(1);
                    }
                    v1(&d).valid == (i % 2 == 0)
                })
            })
            .collect();
        assert!(handles.into_iter().all(|h| h.join().unwrap()));
    });
}

/// The historical V2-9 rows used names like constructor; V2-2 now refuses them, so the tier lookup is tested directly.
/// The policy's mode lookup is an inline HashMap get in verify_bundle.rs, with no helper to call and no prototype.
#[test]
fn the_tier_lookup_keeps_its_guard_for_names_outside_the_enums() {
    let intent = instance()["bundle"]["intent"]["payload"].clone();
    let with = |field: &str, name: &str| {
        let mut i = intent.clone();
        i[field] = json!(name);
        i
    };
    let policy = json!({"risk_score": 0});
    let unknown = compute_security_tier(&with("action_type", "zz-unknown"), Some(&policy));
    for name in ["constructor", "__proto__", "toString", "hasOwnProperty", "__class__", "__dict__"] {
        for field in ["action_type", "estimated_impact", "security_tier"] {
            let tier = compute_security_tier(&with(field, name), Some(&policy));
            if field != "security_tier" {
                assert_eq!(tier, unknown, "{field}={name}");
            }
        }
    }
}
