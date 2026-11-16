//! Mandate acknowledgment (MP-02 F4): the frozen vectors of tests/interop/v2/mandate_acknowledgment_vectors.json
//! through the public API, the composition against admit_delegated_bundle_v2, the six altered-PQ controls, the
//! new context and the creator. Mirrors sdks/typescript/src/__tests__/mandate-acknowledgment.test.ts.
//!
//! Not applicable to Rust, and why:
//! - the 4 PREC cases whose containers are not arrays: `&[Value]` cannot express them;
//! - the 3 text cases: a lone surrogate is rejected when the text is parsed, outside this API, so they are checked
//!   only as external parsing, never as an activation test;
//! - the Go bytes case: it is about Go's raw parse; Rust's host value 1 is the corpus case value_one;
//! - a snapshot or copy test: the inputs are shared borrows and cannot change during the call;
//! - the creator's raw-chain and lone-surrogate rejections: a `&str` and a `Value` hold only Unicode scalar values.

use std::sync::atomic::{AtomicUsize, Ordering};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use dcp_ai::providers::ed25519::Ed25519Provider;
use dcp_ai::providers::ml_dsa_65::MlDsa65Provider;
use dcp_ai::v2::canonicalize::canonicalize_v2;
use dcp_ai::v2::composite_ops::{composite_sign, composite_verify, CompositeKeyInfo};
use dcp_ai::v2::composite_sig::CompositeSignature;
use dcp_ai::v2::crypto_provider::{CryptoError, CryptoProvider, GeneratedKeypair};
use dcp_ai::v2::domain_separation::{domain_separated_message, is_valid_context, CTX_AWARENESS};
use dcp_ai::v2::dual_hash::sha256_hex;
use dcp_ai::v2::experimental_candidate_produce::{sign_payload, CandidateInput, CandidateKeys, ProduceError};
use dcp_ai::v2::session_nonce::parse_rfc3339_millis;
use dcp_ai::v2::{
    admit_delegated_bundle_v2, create_mandate_acknowledgment, evaluate_delegation_activation_v2, ActivationEvidence,
    DelegatedEvidence, DelegatedOperator, DelegationActivationResult, MandateAcknowledgmentParams,
    CTX_MANDATE_ACKNOWLEDGMENT, MANDATE_ACKNOWLEDGMENT_FORMAT,
};
use serde_json::{json, Value};

const FROZEN_CORPUS: &str = "e98a14a0ef8ecaff7a08bf394b7555f0d0ae69c29aac1b6b1ec75527f9503f8b";

fn corpus() -> (Value, Vec<u8>) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/mandate_acknowledgment_vectors.json");
    let data = std::fs::read(path).expect("vectors");
    (serde_json::from_slice(&data).expect("json"), data)
}

fn now(v: &Value) -> i64 {
    parse_rfc3339_millis(v["now"].as_str().unwrap()).unwrap()
}

fn named<'a>(v: &'a Value, field: &str, name: &Value) -> Option<&'a Value> {
    name.as_str().map(|n| &v[field][n])
}

/// The case's operator; `policy` replaces the profile with a policy and a revocation age of 300 s.
fn operator<'a>(v: &'a Value, c: &'a Value, policy: Option<&str>) -> DelegatedOperator<'a> {
    let (profile, policy, max_age) = match policy {
        Some(p) => (None, Some(&v["policies"][p]), Some(300)),
        None => (named(v, "profiles", &c["profile"]), named(v, "policies", &c["policy"]), c["max_revocation_age_seconds"].as_u64()),
    };
    DelegatedOperator {
        trust_set: Some(&v["trust_sets"][c["trust"].as_str().unwrap()]),
        profile_config: profile,
        policy,
        revocation: named(v, "revocations", &c["revocation"]),
        mandate_revocation: named(v, "mandate_revocations", &c["mandate_revocation"]),
        max_revocation_age_seconds: max_age,
        now_ms: Some(now(v)),
        ..Default::default()
    }
}

struct Inputs {
    chain: Vec<Value>,
    delegators: Vec<Value>,
    acknowledgments: Vec<Value>,
    thresholds: Vec<Value>,
}

/// None when a container is not an array (the PREC cases Rust cannot express).
fn inputs(v: &Value, c: &Value) -> Option<Inputs> {
    let list = |field: &str, from: &str| -> Option<Vec<Value>> {
        Some(c[field].as_array()?.iter().map(|n| v[from][n.as_str().unwrap()].clone()).collect())
    };
    Some(Inputs {
        chain: list("chain", "mandates")?,
        delegators: list("delegators", "signed_bundles")?,
        acknowledgments: list("acknowledgments", "acknowledgments")?,
        thresholds: list("awareness_thresholds", "awareness_thresholds")?,
    })
}

fn evidence<'a>(v: &'a Value, c: &Value, i: &'a Inputs) -> ActivationEvidence<'a> {
    ActivationEvidence {
        evidence: DelegatedEvidence {
            signed_bundle: &v["signed_bundles"][c["leaf"].as_str().unwrap()],
            mandate_chain: &i.chain,
            delegator_bundles: &i.delegators,
        },
        acknowledgments: &i.acknowledgments,
        awareness_thresholds: &i.thresholds,
    }
}

fn outcome(r: &DelegationActivationResult) -> Value {
    json!({
        "composition_admitted": r.composition.admitted,
        "activation": r.activation,
        "delegation_active": r.delegation_active,
        "codes": r.errors.iter().map(|e| e.code).collect::<Vec<_>>(),
        "verified": r.acknowledgments.iter().map(|a| a.verified).collect::<Vec<_>>(),
    })
}

fn case<'a>(v: &'a Value, name: &str) -> &'a Value {
    v["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).expect(name)
}

#[test]
fn the_frozen_vectors() {
    let (v, data) = corpus();
    assert_eq!(sha256_hex(&data), FROZEN_CORPUS, "the corpus is not the frozen one");
    let cases = v["cases"].as_array().unwrap();
    assert_eq!((cases.len(), v["text_cases"].as_array().unwrap().len(), v["go_bytes_cases"].as_array().unwrap().len()), (93, 3, 1));
    let mut failures = Vec::new();
    let mut excluded = Vec::new();
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let Some(i) = inputs(&v, c) else {
            excluded.push(name);
            continue;
        };
        let op = operator(&v, c, None);
        let e = evidence(&v, c, &i);
        let r = evaluate_delegation_activation_v2(&e, &op).expect("configuration");
        if outcome(&r) != c["expected"] {
            failures.push(format!("{} {name}: got {}, want {}; {:?}", c["group"], outcome(&r), c["expected"], r.errors));
        }
        if r.action_authorized || r.composition.action_authorized || r.composition.activation != "not_evaluated" {
            failures.push(format!("{name}: activation or authorization"));
        }
        let f2 = admit_delegated_bundle_v2(&e.evidence, &op).expect("configuration");
        if serde_json::to_value(&r.composition).unwrap() != serde_json::to_value(&f2).unwrap() {
            failures.push(format!("{name}: the composition differs from admit_delegated_bundle_v2"));
        }
        if (r.inputs.now, r.inputs.acknowledgments, r.inputs.awareness_thresholds) != (now(&v), i.acknowledgments.len(), i.thresholds.len()) {
            failures.push(format!("{name}: inputs {:?}", r.inputs));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    excluded.sort();
    assert_eq!(
        (cases.len() - excluded.len(), excluded),
        (89, vec!["acknowledgments_not_an_array", "both_containers_invalid", "rejected_composition_invalid_container", "thresholds_not_an_array"]),
    );
}

#[test]
fn configuration_errors_are_the_composition_s() {
    let (v, _) = corpus();
    let c = case(&v, "root_only");
    let i = inputs(&v, c).unwrap();
    let e = evidence(&v, c, &i);
    for op in [
        DelegatedOperator { trust_set: None, ..operator(&v, c, None) },
        DelegatedOperator { max_revocation_age_seconds: Some(300), ..operator(&v, c, None) },
        DelegatedOperator { max_revocation_age_seconds: Some(301), ..operator(&v, c, Some("weak_classical")) },
    ] {
        let got = evaluate_delegation_activation_v2(&e, &op).expect_err("a configuration error");
        let f2 = admit_delegated_bundle_v2(&e.evidence, &op).expect_err("a configuration error");
        assert_eq!((got.code, got.message), (f2.code, f2.message));
    }
}

#[test]
fn text_cases_are_rejected_by_the_external_parser_only() {
    // External parsing, not an activation test: serde_json refuses a lone surrogate escape, so no such Value
    // reaches the API.
    let (v, _) = corpus();
    for tc in v["text_cases"].as_array().unwrap() {
        let text = tc["text"].as_str().unwrap();
        assert!(text.contains("\\ud8") || text.contains("\\udc"), "{}", tc["name"]);
        assert!(serde_json::from_str::<Value>(text).is_err(), "{} parsed", tc["name"]);
    }
}

fn flip_pq(record: &mut Value) {
    let pq = &mut record["composite_sig"]["pq"]["sig_b64"];
    let mut sig = STANDARD.decode(pq.as_str().unwrap()).unwrap();
    sig[200] ^= 1;
    *pq = Value::from(STANDARD.encode(sig));
}

#[test]
fn an_altered_pq_component_with_a_valid_classical_one_is_rejected() {
    let (v, _) = corpus();
    let c = case(&v, "root_only");
    for policy in [None, Some("pq_only"), Some("weak_classical")] {
        for (target, code) in [("awareness_thresholds", "ACK_THRESHOLD_SIGNATURE_INVALID"), ("acknowledgments", "ACK_SIGNATURE_INVALID")] {
            let mut i = inputs(&v, c).unwrap();
            flip_pq(if target == "acknowledgments" { &mut i.acknowledgments[0] } else { &mut i.thresholds[0] });
            let r = evaluate_delegation_activation_v2(&evidence(&v, c, &i), &operator(&v, c, policy)).expect("configuration");
            let codes: Vec<&str> = r.errors.iter().map(|e| e.code).collect();
            assert!(r.composition.admitted && !r.delegation_active && codes == [code], "{target} under {policy:?}: {}", outcome(&r));
        }
    }
}

#[test]
fn the_new_context() {
    let (v, _) = corpus();
    let d = &v["domain_separation"];
    assert_eq!(d["context"], CTX_MANDATE_ACKNOWLEDGMENT);
    let dsm = domain_separated_message(CTX_MANDATE_ACKNOWLEDGMENT, d["payload_canonical"].as_str().unwrap().as_bytes()).unwrap();
    assert_eq!(hex::encode(dsm), d["dsm_hex"].as_str().unwrap());
    assert!(is_valid_context(CTX_MANDATE_ACKNOWLEDGMENT));
    // Kept out of the experimental producer's contexts; Awareness, in them, passes the context check.
    let empty = CompositeKeyInfo { kid: String::new(), alg: String::new(), secret_key_b64: String::new(), public_key_b64: String::new() };
    let keys = CandidateKeys { classical: empty, pq: None };
    let input = CandidateInput::Value(json!({}));
    let usage = |ctx: &str| match sign_payload(ctx, &input, &keys) {
        Err(ProduceError::Usage(m)) => m,
        other => panic!("{ctx}: {:?}", other.map(|_| ())),
    };
    assert_eq!(usage(CTX_MANDATE_ACKNOWLEDGMENT), "context must be one of the DCP contexts");
    assert_ne!(usage(CTX_AWARENESS), "context must be one of the DCP contexts");
}

// ── Creation (design § 3.2) ──

/// A provider that counts its signatures.
struct Counting<P> {
    inner: P,
    signs: AtomicUsize,
}

impl<P: CryptoProvider> CryptoProvider for Counting<P> {
    fn alg(&self) -> &str {
        self.inner.alg()
    }
    fn key_size(&self) -> usize {
        self.inner.key_size()
    }
    fn sig_size(&self) -> usize {
        self.inner.sig_size()
    }
    fn is_constant_time(&self) -> bool {
        self.inner.is_constant_time()
    }
    fn generate_keypair(&self) -> Result<GeneratedKeypair, CryptoError> {
        self.inner.generate_keypair()
    }
    fn sign(&self, message: &[u8], secret_key_b64: &str) -> Result<Vec<u8>, CryptoError> {
        self.signs.fetch_add(1, Ordering::SeqCst);
        self.inner.sign(message, secret_key_b64)
    }
    fn verify(&self, message: &[u8], signature: &[u8], public_key_b64: &str) -> Result<bool, CryptoError> {
        self.inner.verify(message, signature, public_key_b64)
    }
}

fn counting<P>(inner: P) -> Counting<P> {
    Counting { inner, signs: AtomicUsize::new(0) }
}

fn fresh_keys() -> (CompositeKeyInfo, CompositeKeyInfo) {
    let info = |k: GeneratedKeypair, alg: &str| CompositeKeyInfo { kid: k.kid, alg: alg.into(), secret_key_b64: k.secret_key_b64, public_key_b64: k.public_key_b64 };
    (info(Ed25519Provider.generate_keypair().unwrap(), "ed25519"), info(MlDsa65Provider.generate_keypair().unwrap(), "ml-dsa-65"))
}

/// A threshold of the sub-mandate's agent, signed with `keys`, with `over` replacing members before signing.
fn threshold(v: &Value, (classical, pq): &(CompositeKeyInfo, CompositeKeyInfo), over: Value) -> Value {
    let sub = &v["mandates"]["sub"];
    let mut payload = json!({
        "dcp_version": "2.0", "threshold_id": "threshold:creation", "session_nonce": sub["session_nonce"], "agent_id": sub["agent_id"],
        "human_id": sub["human_id"], "threshold_rules": [{"dimension": "spend", "operator": "gt", "value": 100, "action_if_triggered": "notify"}],
        "timestamp": "2026-11-02T01:00:00.000Z",
    });
    for (k, x) in over.as_object().unwrap() {
        payload[k] = x.clone();
    }
    let canonical = canonicalize_v2(&payload).unwrap();
    let sig = composite_sign(&Ed25519Provider, &MlDsa65Provider, CTX_AWARENESS, canonical.as_bytes(), classical, pq).unwrap();
    payload["composite_sig"] = serde_json::to_value(sig).unwrap();
    payload
}

fn digest(v: &Value) -> String {
    format!("sha256:{}", sha256_hex(canonicalize_v2(v).unwrap().as_bytes()))
}

fn without(v: &Value, fields: &[&str]) -> Value {
    let mut m = v.as_object().unwrap().clone();
    for f in fields {
        m.remove(*f);
    }
    Value::Object(m)
}

#[test]
fn creates_a_verifiable_acknowledgment_from_its_inputs() {
    let (v, _) = corpus();
    let keys = fresh_keys();
    let chain = [v["mandates"]["root"].clone(), v["mandates"]["sub"].clone()];
    let u = threshold(&v, &keys, json!({}));
    let params = MandateAcknowledgmentParams { mandate_chain: &chain, awareness_threshold: &u, acknowledgment_id: "ack:creation", acknowledged_at: Some("2026-11-02T02:00:00Z") };
    let a = create_mandate_acknowledgment(&Ed25519Provider, &MlDsa65Provider, &keys.0, &keys.1, params).unwrap();
    // The hashes, computed here independently of the module.
    let sigs = ["human_composite_sig", "delegator_composite_sig"];
    let (root_hash, sub_hash) = (digest(&without(&chain[0], &sigs)), digest(&without(&chain[1], &sigs)));
    let sub = &chain[1];
    let unsigned = without(&a, &["composite_sig"]);
    assert_eq!(
        unsigned,
        json!({
            "dcp_version": "2.0", "acknowledgment_format": MANDATE_ACKNOWLEDGMENT_FORMAT, "acknowledgment_id": "ack:creation",
            "mandate_id": sub["mandate_id"], "mandate_hash": sub_hash, "chain_hash": digest(&json!([root_hash, sub_hash])),
            "session_nonce": sub["session_nonce"], "human_id": sub["human_id"], "agent_id": sub["agent_id"],
            "awareness_threshold_id": "threshold:creation", "awareness_threshold_hash": digest(&without(&u, &["composite_sig"])),
            "acknowledged_at": "2026-11-02T02:00:00Z",
        }),
    );
    let cs: CompositeSignature = serde_json::from_value(a["composite_sig"].clone()).unwrap();
    let canonical = canonicalize_v2(&unsigned).unwrap();
    let r = composite_verify(&Ed25519Provider, Some(&MlDsa65Provider), CTX_MANDATE_ACKNOWLEDGMENT, canonical.as_bytes(), &cs, &keys.0.public_key_b64, Some(&keys.1.public_key_b64)).unwrap();
    assert!(r.valid && r.classical_valid && r.pq_valid);
}

#[test]
fn rejects_without_signing() {
    let (v, _) = corpus();
    let keys = fresh_keys();
    let root = &v["mandates"]["root"];
    let chain = [root.clone(), v["mandates"]["sub"].clone()];
    let not_linked = [v["mandates"]["root_future"].clone(), v["mandates"]["sub"].clone()];
    let u = threshold(&v, &keys, json!({}));
    let mut big_value = threshold(&v, &keys, json!({}));
    big_value["threshold_rules"][0]["value"] = json!(9_007_199_254_740_992_u64);
    let other_agent = threshold(&v, &keys, json!({"agent_id": root["agent_id"]}));
    let other_session = threshold(&v, &keys, json!({"session_nonce": root["session_nonce"]}));
    let early = threshold(&v, &keys, json!({"timestamp": "2026-11-01T00:00:00Z"}));
    let with_kid = |k: &CompositeKeyInfo, kid: &str| CompositeKeyInfo { kid: kid.into(), alg: k.alg.clone(), secret_key_b64: k.secret_key_b64.clone(), public_key_b64: k.public_key_b64.clone() };
    let (bad_pq, bad_classical) = (with_kid(&keys.1, "x"), with_kid(&keys.0, &keys.1.kid));
    let base = MandateAcknowledgmentParams { mandate_chain: &chain, awareness_threshold: &u, acknowledgment_id: "ack:creation", acknowledged_at: Some("2026-11-02T02:00:00Z") };
    let cases: Vec<(&str, &str, &CompositeKeyInfo, &CompositeKeyInfo, MandateAcknowledgmentParams)> = vec![
        ("a pq kid that is not the derived kid", "pq key: kid x is not derived from its key", &keys.0, &bad_pq, base),
        ("a classical kid of another key", "classical key: kid ", &bad_classical, &keys.1, base),
        ("a threshold of another agent", "the threshold's agent_id is not the mandate's", &keys.0, &keys.1, MandateAcknowledgmentParams { awareness_threshold: &other_agent, ..base }),
        ("a threshold of another session", "the threshold's session_nonce is not the mandate's", &keys.0, &keys.1, MandateAcknowledgmentParams { awareness_threshold: &other_session, ..base }),
        ("an instant before the mandate", "acknowledged_at is before the mandate timestamp", &keys.0, &keys.1, MandateAcknowledgmentParams { awareness_threshold: &early, acknowledged_at: Some("2026-11-01T23:59:59.999Z"), ..base }),
        ("an instant before the threshold", "acknowledged_at is before the threshold timestamp", &keys.0, &keys.1, MandateAcknowledgmentParams { acknowledged_at: Some("2026-11-02T00:30:00Z"), ..base }),
        ("an instant after valid_until", "acknowledged_at is after the mandate valid_until", &keys.0, &keys.1, MandateAcknowledgmentParams { acknowledged_at: Some("2027-11-01T00:00:00.001Z"), ..base }),
        ("a threshold value outside ±(2^53 − 1)", "threshold_rules[0].value is not an integer", &keys.0, &keys.1, MandateAcknowledgmentParams { awareness_threshold: &big_value, ..base }),
        ("an identifier of five astral code points", "at least 6 Unicode scalar values", &keys.0, &keys.1, MandateAcknowledgmentParams { acknowledgment_id: "😀😀😀😀😀", ..base }),
        ("a chain whose sub-mandate does not name its parent", "mandate[1] does not name mandate[0] as its parent", &keys.0, &keys.1, MandateAcknowledgmentParams { mandate_chain: &not_linked, ..base }),
        ("an empty chain", "the mandate chain must be a non-empty array", &keys.0, &keys.1, MandateAcknowledgmentParams { mandate_chain: &[], ..base }),
    ];
    // Each rejection names its own reason, not an earlier check.
    for (name, reason, classical, pq, params) in cases {
        let (ed, ml) = (counting(Ed25519Provider), counting(MlDsa65Provider));
        let err = create_mandate_acknowledgment(&ed, &ml, classical, pq, params).expect_err(name).to_string();
        assert!(err.starts_with("create mandate acknowledgment: ") && err.contains(reason), "{name}: {err}");
        assert_eq!((ed.signs.load(Ordering::SeqCst), ml.signs.load(Ordering::SeqCst)), (0, 0), "{name}: signed before rejecting");
        assert!(!err.contains(&keys.0.secret_key_b64) && !err.contains(&keys.1.secret_key_b64), "{name}: the error names a secret");
    }
    // The valid control through the same counting providers signs once with each.
    let (ed, ml) = (counting(Ed25519Provider), counting(MlDsa65Provider));
    create_mandate_acknowledgment(&ed, &ml, &keys.0, &keys.1, base).unwrap();
    assert_eq!((ed.signs.load(Ordering::SeqCst), ml.signs.load(Ordering::SeqCst)), (1, 1));
}
