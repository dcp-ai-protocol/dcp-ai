//! Experimental candidate dcp-jcs-v2, phase 4: the Rust adapter of the producer x consumer matrix
//! (tests/interop/candidate/phase4/run.mjs) and the gate 2 cells of Rust. The adapter runs only when the
//! runner sets DCP_PHASE4_RUN; modes produce, ring, verify and cost read and write the run directory in the
//! format of the other adapters. Value inputs are read with serde_json; Ed25519 keys reach the producer as
//! the 32-byte seed; the decoder calls are counted by a custom adapter around serde_json::from_slice.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use dcp_ai::providers::{ed25519::Ed25519Provider, ml_dsa_65::MlDsa65Provider};
use dcp_ai::v2::bundle::{build_bundle_v2, sign_bundle_v2};
use dcp_ai::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use dcp_ai::v2::crypto_provider::derive_kid;
use dcp_ai::v2::experimental_candidate_produce::{sign_bundle, sign_payload, BundleOptions, BundleParts, BundleSigner, CandidateInput, CandidateKeys};
use dcp_ai::v2::experimental_candidate_router::{CandidateRoute, CandidateRouterConfig, HistoricalAdapter, HistoricalDecode};
use dcp_ai::v2::experimental_candidate_verify::CandidateVerifier;
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::signed_payload::{prepare_payload, SignedPayload};
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::verify_signed_bundle_v2_at;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const SDKS: [&str; 5] = ["ts", "py", "go", "rust", "wasm"];
const PARTS: [(&str, &str, &str); 4] = [
    ("rpr", "DCP-AI.v2.ResponsiblePrincipal", "principal"),
    ("passport", "DCP-AI.v2.AgentPassport", "agent"),
    ("intent", "DCP-AI.v2.Intent", "agent"),
    ("policy", "DCP-AI.v2.PolicyDecision", "agent"),
];

fn keys_of(all: &Value, who: &str, classical_only: bool) -> CandidateKeys {
    let s = |v: &Value| v.as_str().unwrap().to_string();
    let (c, p) = (&all[who]["classical"], &all[who]["pq"]);
    CandidateKeys {
        classical: CompositeKeyInfo { kid: s(&c["kid"]), alg: "ed25519".into(), secret_key_b64: s(&c["seed32"]), public_key_b64: s(&c["pk"]) },
        pq: (!classical_only).then(|| CompositeKeyInfo { kid: s(&p["kid"]), alg: "ml-dsa-65".into(), secret_key_b64: s(&p["sk"]), public_key_b64: s(&p["pk"]) }),
    }
}

struct Run {
    dir: PathBuf,
    id: String,
    specs: Value,
}

/// The current time as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
fn stamp() -> String {
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Civil date from days since the epoch (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000)
}

impl Run {
    fn path(&self, parts: &[&str]) -> PathBuf {
        parts.iter().fold(self.dir.clone(), |p, x| p.join(x))
    }

    fn read(&self, parts: &[&str]) -> Vec<u8> {
        fs::read(self.path(parts)).unwrap_or_else(|e| panic!("{}: {e}", self.path(parts).display()))
    }

    fn json(&self, parts: &[&str]) -> Value {
        serde_json::from_slice(&self.read(parts)).unwrap()
    }

    fn write(&self, data: &[u8], parts: &[&str]) {
        let p = self.path(parts);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, data).unwrap();
    }

    fn piece(&self, case: &str, mode: &str, name: &str) -> CandidateInput {
        let b = self.read(&["inputs", case, &format!("{name}.json")]);
        if mode == "bytes" {
            CandidateInput::Bytes(b)
        } else {
            CandidateInput::Value(serde_json::from_slice(&b).unwrap())
        }
    }

    fn keys(&self, who: &str, classical_only: bool) -> CandidateKeys {
        keys_of(&self.json(&["inputs", "keys.json"]), who, classical_only)
    }

    /// S09: members an artifact and its composite_sig do not sign, added to the intent artifact.
    fn with_extensions(&self, part: &CandidateInput) -> CandidateInput {
        match part {
            CandidateInput::Value(v) => {
                let mut a = v.clone();
                a["x_artifact_ext"] = json!("unsigned");
                a["composite_sig"]["x_sig_ext"] = json!("unsigned");
                CandidateInput::Value(a)
            }
            CandidateInput::Bytes(b) => {
                let head = br#"{"composite_sig":{"#;
                assert!(b.starts_with(head), "an artifact that is not canonical");
                let mut out = br#"{"x_artifact_ext":"unsigned","composite_sig":{"x_sig_ext":"unsigned","#.to_vec();
                out.extend_from_slice(&b[head.len()..]);
                CandidateInput::Bytes(out)
            }
        }
    }

    fn assemble(&self, case: &str, mode: &str, artifacts: &[CandidateInput; 4]) -> Vec<u8> {
        let md = self.json(&["inputs", case, "meta.json"]);
        let flag = |k: &str| md[k].as_bool().unwrap();
        let text = |k: &str| Some(md[k].as_str().unwrap().to_string());
        let parts = BundleParts {
            rpr: artifacts[0].clone(),
            passport: artifacts[1].clone(),
            intent: if flag("extensions") { self.with_extensions(&artifacts[2]) } else { artifacts[2].clone() },
            policy_decision: artifacts[3].clone(),
            audit_entries: md["entries"].as_array().unwrap().iter().map(|e| self.piece(case, mode, e.as_str().unwrap())).collect(),
            pq_checkpoints: if flag("checkpoint") { vec![self.piece(case, mode, "checkpoint-0")] } else { vec![] },
        };
        let signer = BundleSigner { signer_type: "human".into(), signer_id: "human:candidate-principal".into(), keys: self.keys("principal", flag("classical")) };
        let options = BundleOptions {
            session_nonce: md["session_nonce"].as_str().unwrap().into(),
            session_issued_at: text("session_issued_at"),
            session_expires_at: text("session_expires_at"),
            intended_verifier: None,
            created_at: text("created_at"),
            dual_hash: flag("dual_hash"),
        };
        sign_bundle(&parts, &signer, &options).unwrap_or_else(|e| panic!("{case}-{mode}: {e}")).bytes
    }

    fn produced(&self, name: &str, data: &[u8], index: &mut Vec<Value>) {
        self.write(data, &["produced", "rust", &format!("{name}.bin")]);
        index.push(json!({ "case": name, "sha256": hex::encode(Sha256::digest(data)), "run_id": self.id, "created_at": stamp() }));
    }

    fn produce(&self) {
        let keys = self.json(&["inputs", "keys.json"]);
        let mut kids = String::new();
        for who in ["principal", "agent"] {
            for c in ["classical", "pq"] {
                let k = &keys[who][c];
                let pk = base64::engine::general_purpose::STANDARD.decode(k["pk"].as_str().unwrap()).unwrap();
                kids.push_str(&format!("{who}.{c} {}\n", derive_kid(k["alg"].as_str().unwrap(), &pk)));
            }
        }
        self.write(kids.as_bytes(), &["kids", "rust.json"]);
        let mut index = vec![];
        for c in self.specs["cases"].as_array().unwrap() {
            let id = c["id"].as_str().unwrap();
            let classical = self.json(&["inputs", id, "meta.json"])["classical"].as_bool().unwrap();
            for m in c["modes"].as_array().unwrap().iter().map(|m| m.as_str().unwrap()) {
                let artifacts = PARTS.map(|(name, context, who)| {
                    let out = sign_payload(context, &self.piece(id, m, name), &self.keys(who, classical)).unwrap_or_else(|e| panic!("{id}-{m} {name}: {e}"));
                    if id == "S01" && m == "bytes" {
                        self.write(&out.bytes, &["produced", "rust", "artifacts", &format!("{name}.bin")]);
                    }
                    if m == "bytes" { CandidateInput::Bytes(out.bytes) } else { CandidateInput::Value(out.signed_payload) }
                });
                self.produced(&format!("{id}-{m}"), &self.assemble(id, m, &artifacts), &mut index);
            }
        }
        self.write(serde_json::to_string_pretty(&index).unwrap().as_bytes(), &["produced", "rust", "index.json"]);
    }

    fn ring(&self) {
        let next = SDKS[(SDKS.iter().position(|s| *s == "rust").unwrap() + 1) % SDKS.len()];
        let artifacts = PARTS.map(|(name, _, _)| CandidateInput::Bytes(self.read(&["produced", next, "artifacts", &format!("{name}.bin")])));
        let mut index = vec![];
        self.produced("R", &self.assemble("S01", "bytes", &artifacts), &mut index);
        self.write(serde_json::to_string_pretty(&index).unwrap().as_bytes(), &["produced", "rust", "ring.json"]);
    }

    fn items(&self) -> Vec<(String, String, Vec<u8>, Value)> {
        let mut out = vec![];
        for producer in SDKS {
            for file in ["index.json", "ring.json"] {
                if !self.path(&["produced", producer, file]).exists() {
                    continue;
                }
                for e in self.json(&["produced", producer, file]).as_array().unwrap() {
                    let case = e["case"].as_str().unwrap();
                    out.push((producer.into(), case.into(), self.read(&["produced", producer, &format!("{case}.bin")]), json!({ "transport": "bare", "accepted": ["dcp-jcs-v2"] })));
                }
            }
            if !self.path(&["negatives", producer, "index.json"]).exists() {
                continue;
            }
            for e in self.json(&["negatives", producer, "index.json"]).as_array().unwrap() {
                let case = e["case"].as_str().unwrap();
                out.push((producer.into(), case.into(), self.read(&["negatives", producer, &format!("{case}.bin")]), e["config"].clone()));
            }
        }
        out
    }

    fn verify(&self) {
        let now = parse_rfc3339_millis(self.specs["session"]["now"].as_str().unwrap()).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = {
            let calls = calls.clone();
            let base = HistoricalAdapter::serde_json_from_slice();
            HistoricalAdapter::custom(base.name().to_string(), move |unit: &[u8]| -> Result<Value, HistoricalDecode> {
                calls.fetch_add(1, Ordering::SeqCst);
                base.decode(unit)
            })
        };
        let policy = VerifierPolicy::default();
        let mut verifiers: Vec<(Value, CandidateVerifier)> = vec![];
        let mut lines = String::new();
        for (producer, case, data, config) in self.items() {
            let i = match verifiers.iter().position(|(c, _)| *c == config) {
                Some(i) => i,
                None => {
                    let v = CandidateVerifier::new(CandidateRouterConfig {
                        transport: config["transport"].as_str().unwrap().into(),
                        accepted_profiles: config["accepted"].clone(),
                        historical: Some(counted.clone()),
                    })
                    .unwrap();
                    verifiers.push((config.clone(), v));
                    verifiers.len() - 1
                }
            };
            calls.store(0, Ordering::SeqCst);
            let r = verifiers[i].1.verify_at(&data, &policy, now).unwrap_or_else(|e| panic!("{producer} {case}: {e:?}"));
            let (outcome, class) = match &r.route {
                CandidateRoute::Reject { class, .. } => ("reject", Some(class.clone())),
                CandidateRoute::V1Path { .. } => ("v1_path", None),
                CandidateRoute::Candidate { .. } => ("candidate", None),
            };
            let v = r.verification.as_ref().map(|d| &d.result);
            let line = json!({
                "run_id": self.id, "consumer": "rust", "producer": producer, "case": case, "created_at": stamp(),
                "outcome": outcome, "class": class, "entered": r.entered, "verified": v.map(|v| v.verified),
                "decoder_calls": calls.load(Ordering::SeqCst), "errors": v.map(|v| v.errors.iter().take(3).cloned().collect::<Vec<_>>()).unwrap_or_default(),
            });
            lines.push_str(&format!("{line}\n"));
        }
        let p = self.path(&["results", "rust.jsonl"]);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let mut existing = fs::read_to_string(&p).unwrap_or_default();
        existing.push_str(&lines);
        fs::write(p, existing).unwrap();
    }
}

/// Timings of `f` in ms: 3 warm-ups discarded, then 20 samples; median and p90.
fn measure(mut f: impl FnMut()) -> Value {
    for _ in 0..3 {
        f();
    }
    let samples: Vec<f64> = (0..20)
        .map(|_| {
            let t0 = Instant::now();
            f();
            t0.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    let mut s = samples.clone();
    s.sort_by(f64::total_cmp);
    json!({ "median_ms": (s[9] + s[10]) / 2.0, "p90_ms": s[17], "samples_ms": samples })
}

fn rustc() -> String {
    std::process::Command::new("rustc").arg("--version").output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}

fn cpu() -> String {
    let sysctl = std::process::Command::new("sysctl").args(["-n", "machdep.cpu.brand_string"]).output();
    if let Some(out) = sysctl.ok().filter(|o| o.status.success()) {
        return String::from_utf8_lossy(&out.stdout).trim().to_string();
    }
    fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|c| c.lines().find(|l| l.starts_with("model name")).map(|l| l.split_once(':').unwrap().1.trim().to_string()))
        .unwrap_or_else(|| std::env::consts::ARCH.to_string())
}

impl Run {
    /// Gate 10: today's builder and signer against the candidate producer, and the three verifications.
    fn cost(&self) {
        let md = self.json(&["inputs", "S01", "meta.json"]);
        let text = |k: &str| md[k].as_str().unwrap().to_string();
        let payloads = PARTS.map(|(name, _, _)| self.json(&["inputs", "S01", &format!("{name}.json")]));
        let entries: Vec<Value> = md["entries"].as_array().unwrap().iter().map(|e| self.json(&["inputs", "S01", &format!("{}.json", e.as_str().unwrap())])).collect();
        let all = self.json(&["inputs", "keys.json"]);
        let produce_v1 = || -> Vec<u8> {
            let a: Vec<SignedPayload> = PARTS
                .iter()
                .zip(&payloads)
                .map(|((_, context, who), payload)| {
                    let k = keys_of(&all, who, false);
                    let (bytes, payload_hash) = prepare_payload(payload).unwrap();
                    let composite_sig = composite_sign(&Ed25519Provider, &MlDsa65Provider, context, &bytes, &k.classical, k.pq.as_ref().unwrap()).unwrap();
                    SignedPayload { payload: payload.clone(), payload_hash, composite_sig }
                })
                .collect();
            let mut bundle = build_bundle_v2(&a[0], &a[1], &a[2], &a[3], &entries, &text("session_nonce")).unwrap();
            bundle["manifest"]["session_issued_at"] = json!(text("session_issued_at"));
            bundle["manifest"]["session_expires_at"] = json!(text("session_expires_at"));
            let k = keys_of(&all, "principal", false);
            serde_json::to_vec(&sign_bundle_v2(bundle, &k.classical, k.pq.as_ref().unwrap()).unwrap()).unwrap()
        };
        let produce_candidate = || -> Vec<u8> {
            let mut a = PARTS.iter().zip(&payloads).map(|((_, context, who), payload)| {
                CandidateInput::Value(sign_payload(context, &CandidateInput::Value(payload.clone()), &keys_of(&all, who, false)).unwrap().signed_payload)
            });
            let mut next = || a.next().unwrap();
            let parts = BundleParts {
                rpr: next(),
                passport: next(),
                intent: next(),
                policy_decision: next(),
                audit_entries: entries.iter().cloned().map(CandidateInput::Value).collect(),
                pq_checkpoints: vec![],
            };
            let signer = BundleSigner { signer_type: "human".into(), signer_id: "human:candidate-principal".into(), keys: keys_of(&all, "principal", false) };
            let options = BundleOptions {
                session_nonce: text("session_nonce"),
                session_issued_at: Some(text("session_issued_at")),
                session_expires_at: Some(text("session_expires_at")),
                intended_verifier: None,
                created_at: Some(text("created_at")),
                dual_hash: false,
            };
            sign_bundle(&parts, &signer, &options).unwrap().bytes
        };
        let (v1, candidate) = (produce_v1(), produce_candidate());
        self.write(&v1, &["cost", "rust-v1.bin"]);
        self.write(&candidate, &["cost", "rust-candidate.bin"]);
        let now = parse_rfc3339_millis(self.specs["session"]["now"].as_str().unwrap()).unwrap();
        let policy = VerifierPolicy::default();
        let verifier = CandidateVerifier::new(CandidateRouterConfig {
            transport: "bare".into(),
            accepted_profiles: json!(["dcp-jcs-v1", "dcp-jcs-v2"]),
            historical: Some(HistoricalAdapter::serde_json_from_slice()),
        })
        .unwrap();
        let today = || verify_signed_bundle_v2_at(&serde_json::from_slice(&v1).unwrap(), &policy, now);
        let via = |bytes: &[u8]| verifier.verify_at(bytes, &policy, now).unwrap();
        let (a, b, c) = (today(), via(&v1), via(&candidate));
        let (u1, u2): (Value, Value) = (serde_json::from_slice(&v1).unwrap(), serde_json::from_slice(&candidate).unwrap());
        let same = |ptr: &str| u1.pointer(ptr).is_some_and(Value::is_string) && u1.pointer(ptr) == u2.pointer(ptr);
        let verified = |r: &dcp_ai::v2::experimental_candidate_verify::CandidateVerification, profile: &str| r.entered == profile && r.verification.as_ref().is_some_and(|d| d.result.verified);
        let same_payload_hashes = ["responsible_principal_record", "agent_passport", "intent", "policy_decision"].iter().all(|n| same(&format!("/bundle/{n}/payload_hash")));
        let same_session = ["session_nonce", "session_issued_at", "session_expires_at"].iter().all(|n| same(&format!("/bundle/manifest/{n}")));
        let checks = json!({
            "same_payload_hashes": same_payload_hashes,
            "same_session": same_session,
            "same_entries": u1.pointer("/bundle/audit_entries") == u2.pointer("/bundle/audit_entries"),
            "today_verified": a.result.verified,
            "v1_path": verified(&b, "dcp-jcs-v1"),
            "candidate": verified(&c, "dcp-jcs-v2"),
        });
        assert!(checks.as_object().unwrap().values().all(|v| *v == json!(true)), "the pair is not equivalent: {checks}");
        let secondary = |u: &Value| u.pointer("/bundle/manifest/audit_merkle_root_secondary").is_some_and(Value::is_string);
        let t0 = Instant::now();
        let ops = json!({
            "produce_v1": measure(|| { produce_v1(); }),
            "produce_candidate": measure(|| { produce_candidate(); }),
            "verify_today": measure(|| { today(); }),
            "verify_v1_path": measure(|| { via(&v1); }),
            "verify_candidate": measure(|| { via(&candidate); }),
        });
        let report = json!({
            "sdk": "rust", "run_id": self.id, "created_at": stamp(), "n": 20, "warmup": 3,
            "platform": format!("Rust (cargo test, {} profile)", if cfg!(debug_assertions) { "debug" } else { "release" }),
            "versions": { "rustc": rustc() }, "cpu": cpu(),
            "bytes": { "v1": v1.len(), "candidate": candidate.len() },
            "differences": {
                "secondary_root": { "v1": secondary(&u1), "candidate": secondary(&u2) },
                "profile": { "v1": u1.pointer("/bundle/manifest/canonicalization_profile"), "candidate": u2.pointer("/bundle/manifest/canonicalization_profile") },
                "serialization": { "v1": "serde_json::to_vec of the signed Value (compact, sorted keys: no preserve_order)", "candidate": "canonical bytes (dcp-jcs, from the producer)" },
            },
            "boundaries": {
                "produce_v1": "the four artifacts signed with prepare_payload and composite_sign, build_bundle_v2, sign_bundle_v2, serde_json::to_vec",
                "produce_candidate": "the four artifacts signed by the candidate producer (value inputs), the bundle assembled and signed, canonical bytes",
                "verify_today": "serde_json::from_slice of the bytes, then verify_signed_bundle_v2_at(&Value): the value API, with the decode a caller of bytes needs",
                "verify_v1_path": "the bytes into the phase 3 verifier (accepting dcp-jcs-v1 and dcp-jcs-v2): ingress, route, the historical decoder, today's verifier",
                "verify_candidate": "the bytes into the same verifier: ingress, route, the candidate verifier",
            },
            "checks": checks, "ops": ops, "measured_ms": t0.elapsed().as_secs_f64() * 1000.0,
        });
        self.write(serde_json::to_string_pretty(&report).unwrap().as_bytes(), &["cost", "rust.json"]);
    }
}

#[test]
fn experimental_candidate_phase4_matrix() {
    let Ok(dir) = std::env::var("DCP_PHASE4_RUN") else {
        eprintln!("run by tests/interop/candidate/phase4/run.mjs");
        return;
    };
    let id = std::env::var("DCP_PHASE4_RUN_ID").expect("DCP_PHASE4_RUN_ID is required");
    let specs = serde_json::from_slice(&fs::read(std::env::var("DCP_PHASE4_SPECS").unwrap()).unwrap()).unwrap();
    let run = Run { dir: dir.into(), id, specs };
    match std::env::var("DCP_PHASE4_MODE").as_deref() {
        Ok("produce") => run.produce(),
        Ok("ring") => run.ring(),
        Ok("verify") => run.verify(),
        Ok("cost") => run.cost(),
        other => panic!("unknown mode {other:?}"),
    }
}

/// Gate 2 (§4.1 of the phase 4 contract): each R cell of Rust, by corpus ID, as the value of the corpus
/// document (`serde_json::Value`: i64, or an f64 that holds it; depths built directly, past serde's limit of
/// 128). The N cells (n-overflow, n-huge-exponent, n-nan, n-negative-infinity: `Value` has neither
/// infinities, NaN nor big integers) and the 9 parser IDs (P) are documented, not tested.
#[test]
fn gate2_host_value_cells() {
    use dcp_ai::v2::crypto_provider::CryptoProvider;
    use dcp_ai::v2::experimental_candidate_produce::ProduceError;
    // Keys that cannot sign: a signer call would be a provider error, so a rejection shows that none ran.
    let key = |p: &dyn CryptoProvider| {
        let k = p.generate_keypair().unwrap();
        CompositeKeyInfo { kid: k.kid, alg: p.alg().to_string(), secret_key_b64: "AA==".into(), public_key_b64: k.public_key_b64 }
    };
    let keys = CandidateKeys { classical: key(&Ed25519Provider), pq: Some(key(&MlDsa65Provider)) };
    let class_of = |v: Value| match sign_payload("DCP-AI.v2.Intent", &CandidateInput::Value(v), &keys) {
        Err(ProduceError::Reject(r)) => (r.class, r.part, r.path),
        other => panic!("not a rejection: {:?}", other.map(|p| p.bytes.len())),
    };
    let cells: [(&str, Value, &str); 8] = [
        ("n-two53", json!(1_i64 << 53), "NUMBER_OUT_OF_RANGE"),
        ("n-1e20", json!(1e20), "NUMBER_OUT_OF_RANGE"),
        ("n-1e21", json!(1e21), "NUMBER_OUT_OF_RANGE"),
        ("n-fraction", json!(0.5), "NUMBER_NOT_INTEGER"),
        ("n-two53-plus-one", json!((1_i64 << 53) + 1), "NUMBER_OUT_OF_RANGE"),
        ("n-neg-two53-plus-one", json!(-((1_i64 << 53) + 1)), "NUMBER_OUT_OF_RANGE"),
        ("n-int64-max", json!(i64::MAX), "NUMBER_OUT_OF_RANGE"),
        ("n-sci-over", json!(9_007_199_254_740_993_i64), "NUMBER_OUT_OF_RANGE"),
    ];
    for (id, v, class) in cells {
        assert_eq!(class_of(json!({ "n": v })), (class.to_string(), "payload".to_string(), Some("/n".to_string())), "{id}");
    }
    for levels in [65, 129] {
        let deep = (0..levels).fold(json!(1), |inner, _| json!([inner]));
        let (class, part, _) = class_of(deep);
        assert_eq!((class.as_str(), part.as_str()), ("DEPTH_EXCEEDED", "payload"), "s-depth-{levels}");
    }
    // The control: with a value in the domain, these keys reach a signer and fail there.
    assert!(matches!(sign_payload("DCP-AI.v2.Intent", &CandidateInput::Value(json!({ "n": 1 })), &keys), Err(ProduceError::Provider(_))));
}
