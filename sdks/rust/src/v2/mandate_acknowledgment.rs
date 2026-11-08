//! Mandate acknowledgment (opt-in, MP-02 F4): DCP-09 § 3.3 steps 4–6. The delegate agent signs a separate,
//! versioned record (format dcp09-mandate-ack-v1, context DCP-AI.v2.MandateAcknowledgment) that binds one mandate
//! of a chain, the chain up to it and the agent's awareness threshold. Rust port of the TypeScript SDK's
//! core/mandate-acknowledgment.ts; design: docs/reviews/mp02-acknowledgment-design.md v0.2.
//!
//! [`evaluate_delegation_activation_v2`] runs the delegated admission (F2) at one instant and evaluates the
//! acknowledgments only when that composition is admitted, with the agents, keys, policy, mode and revocation
//! snapshot the composition verified. Nothing is taken from the caller as a result, key or digest. An active
//! delegation authorizes no action: `action_authorized` is always false, and neither `authority_scope` nor
//! `threshold_rules` is evaluated.
//!
//! The inputs are host values (`serde_json::Value`) taken by shared reference: they cannot change during the
//! call, so no copy is needed. A `Value` holds only Unicode scalar values (a lone surrogate or invalid UTF-8 is
//! rejected when the text is parsed, outside this API), so the Unicode rule of design § 2.1 holds by
//! construction. A container that is not an array cannot be expressed by `&[Value]`.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::v2::admission::{bounded, printable, printable_str, AdmissionConfigError, AdmissionError};
use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, composite_verify, CompositeKeyInfo};
use crate::v2::composite_sig::{CompositeSignature, SignatureEntry};
use crate::v2::crypto_provider::CryptoProvider;
use crate::v2::delegated_admission::{
    compose_delegated, find_key, mandate_preflight, min_length, signature_slot_error, sorted_keys,
    take_delegated_snapshot, used_key_error, DelegatedAdmissionResult, DelegatedEvidence, DelegatedOperator,
    DelegatedVerified,
};
use crate::v2::delegation::signer_key;
use crate::v2::domain_separation::{CTX_AWARENESS, CTX_MANDATE_ACKNOWLEDGMENT};
use crate::v2::lifecycle::utc_now_iso_pub;
use crate::v2::schema_v2::is_schema_date_time;
use crate::v2::session_nonce::parse_rfc3339_millis;
use crate::v2::verify_bundle::{provider_for_alg, SESSION_CLOCK_SKEW_MS};

/// The version of the acknowledgment record.
pub const MANDATE_ACKNOWLEDGMENT_FORMAT: &str = "dcp09-mandate-ack-v1";

/// The evidence of [`crate::v2::admit_delegated_bundle_v2`] plus the acknowledgments and the thresholds they name.
#[derive(Debug, Clone, Copy)]
pub struct ActivationEvidence<'a> {
    pub evidence: DelegatedEvidence<'a>,
    pub acknowledgments: &'a [Value],
    pub awareness_thresholds: &'a [Value],
}

/// The acknowledgment of one mandate of the chain.
#[derive(Debug, Clone, Serialize)]
pub struct AcknowledgmentEntry {
    pub mandate_id: String,
    pub acknowledgment_id: Option<String>,
    pub awareness_threshold_id: Option<String>,
    pub verified: bool,
}

/// The instant and the number of elements evaluated.
#[derive(Debug, Clone, Serialize)]
pub struct ActivationInputs {
    pub now: i64,
    pub acknowledgments: usize,
    pub awareness_thresholds: usize,
}

/// The outcome of [`evaluate_delegation_activation_v2`]. Serializes with the field names of the design.
#[derive(Debug, Clone, Serialize)]
pub struct DelegationActivationResult {
    /// Exactly `admit_delegated_bundle_v2`'s result over the same inputs and instant.
    pub composition: DelegatedAdmissionResult,
    /// "evaluated" if and only if the composition is admitted, else "not_evaluated".
    pub activation: &'static str,
    /// Activation evaluated and no acknowledgment error.
    pub delegation_active: bool,
    /// Always false: activation authorizes no action.
    pub action_authorized: bool,
    /// One entry per mandate, chain order; empty when not evaluated.
    pub acknowledgments: Vec<AcknowledgmentEntry>,
    pub inputs: ActivationInputs,
    /// In the normative order of design § 7.2.
    pub errors: Vec<AdmissionError>,
}

/// The inputs of [`create_mandate_acknowledgment`].
#[derive(Debug, Clone, Copy)]
pub struct MandateAcknowledgmentParams<'a> {
    /// Root first, ending with the acknowledged mandate.
    pub mandate_chain: &'a [Value],
    /// The signed awareness threshold of the same agent.
    pub awareness_threshold: &'a Value,
    pub acknowledgment_id: &'a str,
    /// RFC 3339; None: the system clock, UTC, milliseconds.
    pub acknowledged_at: Option<&'a str>,
}

/// An acknowledgment that cannot be created: an argument that could never give a verifiable acknowledgment, or a
/// signing failure. Messages name kids, never a secret.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("create mandate acknowledgment: {0}")]
pub struct MandateAcknowledgmentError(pub String);

// ── Form (design § 2 and § 2.1) ──

/// The members of schemas/v2/mandate_acknowledgment.schema.json and of awareness_threshold.schema.json, all
/// required; checked by the parity test.
pub(crate) const ACK_FIELDS: [&str; 13] = [
    "dcp_version", "acknowledgment_format", "acknowledgment_id", "mandate_id", "mandate_hash", "chain_hash",
    "session_nonce", "human_id", "agent_id", "awareness_threshold_id", "awareness_threshold_hash", "acknowledged_at",
    "composite_sig",
];
pub(crate) const THRESHOLD_FIELDS: [&str; 8] =
    ["dcp_version", "threshold_id", "session_nonce", "agent_id", "human_id", "threshold_rules", "timestamp", "composite_sig"];
pub(crate) const RULE_FIELDS: [&str; 4] = ["dimension", "operator", "value", "action_if_triggered"];
pub(crate) const RULE_OPERATORS: [&str; 5] = ["gt", "lt", "gte", "lte", "eq"];
pub(crate) const RULE_ACTIONS: [&str; 3] = ["notify", "escalate", "block"];
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn is_hex(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_digest(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).and_then(|s| s.strip_prefix("sha256:")).is_some_and(|h| is_hex(h, 64))
}

fn is_nonce(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| is_hex(s, 64))
}

fn is_instant(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| is_schema_date_time(s) && parse_rfc3339_millis(s).is_some())
}

/// Design § 2.1: an integer value of ±(2^53 − 1); an integral float is admitted; a bool is not a number.
pub(crate) fn is_safe_integer_value(v: &Value) -> bool {
    match v {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.unsigned_abs() <= MAX_SAFE_INTEGER
            } else if let Some(u) = n.as_u64() {
                u <= MAX_SAFE_INTEGER
            } else {
                n.as_f64().is_some_and(|f| f.fract() == 0.0 && f.abs() <= MAX_SAFE_INTEGER as f64)
            }
        }
        _ => false,
    }
}

fn members_error(m: &Map<String, Value>, fields: &[&str]) -> Option<String> {
    for k in sorted_keys(m) {
        if !fields.contains(&k.as_str()) {
            return Some(format!("unknown member {}", printable_str(k)));
        }
    }
    fields.iter().find(|f| !m.contains_key(**f)).map(|f| format!("missing {f}"))
}

fn acknowledgment_fields_error(a: &Map<String, Value>, fields: &[&str]) -> Option<String> {
    if let Some(e) = members_error(a, fields) {
        return Some(e);
    }
    if a.get("dcp_version").and_then(Value::as_str) != Some("2.0") {
        return Some("dcp_version must be \"2.0\"".into());
    }
    if a.get("acknowledgment_format").and_then(Value::as_str) != Some(MANDATE_ACKNOWLEDGMENT_FORMAT) {
        return Some(format!("acknowledgment_format must be \"{MANDATE_ACKNOWLEDGMENT_FORMAT}\""));
    }
    for f in ["acknowledgment_id", "mandate_id", "human_id", "agent_id", "awareness_threshold_id"] {
        if !min_length(a.get(f), 6) {
            return Some(format!("{f} must be a string of at least 6 code points"));
        }
    }
    for f in ["mandate_hash", "chain_hash", "awareness_threshold_hash"] {
        if !is_digest(a.get(f)) {
            return Some(format!("{f} is not sha256: and 64 lowercase hex digits"));
        }
    }
    if !is_nonce(a.get("session_nonce")) {
        return Some("session_nonce is not 64 lowercase hex digits".into());
    }
    if !is_instant(a.get("acknowledged_at")) {
        return Some("acknowledged_at is not an RFC 3339 date-time".into());
    }
    None
}

/// The first defect of an acknowledgment's form, in the fixed order of design § 2.
pub(crate) fn acknowledgment_form_error(v: &Value) -> Option<String> {
    let Some(a) = v.as_object() else { return Some("not an object".into()) };
    acknowledgment_fields_error(a, &ACK_FIELDS)
        .or_else(|| signature_slot_error(a.get("composite_sig").unwrap_or(&Value::Null), "composite_sig"))
}

/// The first defect of an awareness threshold's form, with the domain of design § 2.1.
pub(crate) fn threshold_form_error(v: &Value) -> Option<String> {
    let Some(u) = v.as_object() else { return Some("not an object".into()) };
    if let Some(e) = members_error(u, &THRESHOLD_FIELDS) {
        return Some(e);
    }
    if u.get("dcp_version").and_then(Value::as_str) != Some("2.0") {
        return Some("dcp_version must be \"2.0\"".into());
    }
    for f in ["threshold_id", "agent_id", "human_id"] {
        if !min_length(u.get(f), 6) {
            return Some(format!("{f} must be a string of at least 6 code points"));
        }
    }
    if !is_nonce(u.get("session_nonce")) {
        return Some("session_nonce is not 64 lowercase hex digits".into());
    }
    if !is_instant(u.get("timestamp")) {
        return Some("timestamp is not an RFC 3339 date-time".into());
    }
    let rules = match u.get("threshold_rules").and_then(Value::as_array) {
        Some(r) if !r.is_empty() => r,
        _ => return Some("threshold_rules must be a non-empty array".into()),
    };
    for (i, raw) in rules.iter().enumerate() {
        let at = format!("threshold_rules[{i}]");
        let Some(r) = raw.as_object() else { return Some(format!("{at} is not an object")) };
        if let Some(e) = members_error(r, &RULE_FIELDS) {
            return Some(format!("{at}: {e}"));
        }
        if !min_length(r.get("dimension"), 1) {
            return Some(format!("{at}.dimension must be a non-empty string"));
        }
        if !r.get("operator").and_then(Value::as_str).is_some_and(|o| RULE_OPERATORS.contains(&o)) {
            return Some(format!("{at}.operator is not gt, lt, gte, lte or eq"));
        }
        if !r.get("value").is_some_and(is_safe_integer_value) {
            return Some(format!("{at}.value is not an integer of ±(2^53 − 1)"));
        }
        if !r.get("action_if_triggered").and_then(Value::as_str).is_some_and(|a| RULE_ACTIONS.contains(&a)) {
            return Some(format!("{at}.action_if_triggered is not notify, escalate or block"));
        }
    }
    if let Some(e) = signature_slot_error(u.get("composite_sig").unwrap_or(&Value::Null), "composite_sig") {
        return Some(e);
    }
    canonicalize_v2(&unsigned(v)).err().map(|e| format!("not canonicalizable under dcp-jcs-v1: {e}"))
}

// ── Hashes (design § 2) ──

fn digest(v: &Value) -> Result<String, String> {
    canonicalize_v2(v).map(|c| format!("sha256:{}", hex::encode(Sha256::digest(c.as_bytes()))))
}

fn unsigned(record: &Value) -> Value {
    let mut m = record.as_object().cloned().unwrap_or_default();
    m.remove("composite_sig");
    Value::Object(m)
}

/// The mandate without `human_composite_sig` and `delegator_composite_sig` (DCP-09 § 3.4).
pub(crate) fn mandate_hash(mandate: &Value) -> Result<String, String> {
    let mut m = mandate.as_object().cloned().unwrap_or_default();
    m.remove("human_composite_sig");
    m.remove("delegator_composite_sig");
    digest(&Value::Object(m))
}

/// The chain_hash of each mandate: the digest of the array of mandate_hash from the root to it.
pub(crate) fn chain_hashes(mandates: &[Value]) -> Result<(Vec<String>, Vec<String>), String> {
    let hashes = mandates.iter().map(mandate_hash).collect::<Result<Vec<_>, _>>()?;
    let chains = (0..hashes.len()).map(|i| digest(&json!(hashes[..=i]))).collect::<Result<Vec<_>, _>>()?;
    Ok((hashes, chains))
}

pub(crate) fn threshold_hash(threshold: &Value) -> Result<String, String> {
    digest(&unsigned(threshold))
}

fn instant(v: Option<&Value>) -> i64 {
    v.and_then(Value::as_str).and_then(parse_rfc3339_millis).unwrap_or_default()
}

// ── Creation (design § 3.2) ──

/// Sign the acknowledgment of the last mandate of `params.mandate_chain`, linked to `params.awareness_threshold`.
/// Computes mandate_hash, chain_hash and awareness_threshold_hash from the inputs and takes no digest from the
/// caller. The inputs are shared borrows and are not modified. Before anything is signed, the keys' public
/// metadata and every field the acknowledgment carries are checked.
pub fn create_mandate_acknowledgment(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: MandateAcknowledgmentParams<'_>,
) -> Result<Value, MandateAcknowledgmentError> {
    let fail = |m: String| Err(MandateAcknowledgmentError(m));
    if classical_key.alg != "ed25519" {
        return fail("the classical key must be ed25519".into());
    }
    if pq_key.alg != "ml-dsa-65" && pq_key.alg != "slh-dsa-192f" {
        return fail("the PQ key must be ml-dsa-65 or slh-dsa-192f".into());
    }
    // The public metadata the signature slot will carry: a canonical public key of the algorithm's size, and its
    // derived kid (V2-13).
    for (name, key) in [("classical", classical_key), ("pq", pq_key)] {
        let entry = json!({"kid": key.kid, "alg": key.alg, "public_key_b64": key.public_key_b64});
        if let Some(e) = used_key_error(Some(&entry), &key.kid, &key.alg, &format!("{name} key")) {
            return fail(e);
        }
    }
    let chain = params.mandate_chain;
    if chain.is_empty() {
        return fail("the mandate chain must be a non-empty array".into());
    }
    for (i, m) in chain.iter().enumerate() {
        if let Some(e) = mandate_preflight(m, i).into_iter().next() {
            return fail(e);
        }
        if i > 0 && m.get("parent_mandate_id") != chain[i - 1].get("mandate_id") {
            return fail(format!("mandate[{i}] does not name mandate[{}] as its parent", i - 1));
        }
    }
    let u = params.awareness_threshold;
    if let Some(e) = threshold_form_error(u) {
        return fail(format!("the awareness threshold: {e}"));
    }
    if params.acknowledgment_id.chars().count() < 6 {
        return fail("the acknowledgment id must be at least 6 Unicode scalar values".into());
    }
    let acknowledged_at = params.acknowledged_at.map(str::to_string).unwrap_or_else(utc_now_iso_pub);
    if !is_instant(Some(&Value::from(acknowledged_at.clone()))) {
        return fail("acknowledged_at is not an RFC 3339 date-time".into());
    }
    let m = &chain[chain.len() - 1];
    for f in ["agent_id", "human_id", "session_nonce"] {
        if u.get(f) != m.get(f) {
            return fail(format!("the threshold's {f} is not the mandate's"));
        }
    }
    let at = parse_rfc3339_millis(&acknowledged_at).unwrap_or_default();
    if at < instant(m.get("timestamp")) {
        return fail("acknowledged_at is before the mandate timestamp".into());
    }
    if at < instant(u.get("timestamp")) {
        return fail("acknowledged_at is before the threshold timestamp".into());
    }
    if at > instant(m.get("valid_until")) {
        return fail("acknowledged_at is after the mandate valid_until".into());
    }
    let (hashes, chains) = chain_hashes(chain).map_err(|e| MandateAcknowledgmentError(format!("a mandate cannot be hashed: {e}")))?;
    let threshold_digest = threshold_hash(u).map_err(|e| MandateAcknowledgmentError(format!("the threshold cannot be hashed: {e}")))?;
    let mut payload = json!({
        "dcp_version": "2.0",
        "acknowledgment_format": MANDATE_ACKNOWLEDGMENT_FORMAT,
        "acknowledgment_id": params.acknowledgment_id,
        "mandate_id": m.get("mandate_id"),
        "mandate_hash": hashes[hashes.len() - 1],
        "chain_hash": chains[chains.len() - 1],
        "session_nonce": m.get("session_nonce"),
        "human_id": m.get("human_id"),
        "agent_id": m.get("agent_id"),
        "awareness_threshold_id": u.get("threshold_id"),
        "awareness_threshold_hash": threshold_digest,
        "acknowledged_at": acknowledged_at,
    });
    // Every computed field, before signing: a mandate field copied here must give an acknowledgment of the form
    // design § 2 requires, which the mandate preflight alone does not ensure.
    let unsigned_fields: Vec<&str> = ACK_FIELDS.iter().copied().filter(|f| *f != "composite_sig").collect();
    if let Some(e) = acknowledgment_fields_error(payload.as_object().expect("an object"), &unsigned_fields) {
        return fail(format!("the acknowledgment would not have its form: {e}"));
    }
    let canonical = canonicalize_v2(&payload).map_err(MandateAcknowledgmentError)?;
    let sig = composite_sign(classical_provider, pq_provider, CTX_MANDATE_ACKNOWLEDGMENT, canonical.as_bytes(), classical_key, pq_key)
        .map_err(|e| MandateAcknowledgmentError(format!("signing: {e}")))?;
    payload["composite_sig"] = serde_json::to_value(sig).map_err(|e| MandateAcknowledgmentError(e.to_string()))?;
    if let Some(e) = acknowledgment_form_error(&payload) {
        return fail(format!("the signed acknowledgment does not have its form: {e}"));
    }
    Ok(payload)
}

// ── Evaluation (design § 4) ──

struct Codes(Vec<AdmissionError>);

impl Codes {
    fn add(&mut self, code: &'static str, message: String) {
        self.0.push(AdmissionError { code, message: bounded(message) });
    }
}

fn s<'a>(v: &'a Value, f: &str) -> &'a str {
    v.get(f).and_then(Value::as_str).unwrap_or_default()
}

/// Evaluate the activation of a delegation (design § 4): the delegated admission at one instant, then the
/// acknowledgments of every mandate of its chain. An invalid operator configuration is the same
/// [`AdmissionConfigError`] as `admit_delegated_bundle_v2`'s; every problem with the evidence or the
/// acknowledgments is a code in the result.
pub fn evaluate_delegation_activation_v2(
    evidence: &ActivationEvidence<'_>,
    operator: &DelegatedOperator<'_>,
) -> Result<DelegationActivationResult, AdmissionConfigError> {
    // ── 0–2. F2's configuration (errors return), then the composition, always ──
    let snapshot = take_delegated_snapshot(operator)?;
    let (composition, verified) = compose_delegated(&evidence.evidence, &snapshot)?;
    let acks = evidence.acknowledgments;
    let thresholds = evidence.awareness_thresholds;
    let mut codes = Codes(Vec::new());
    let mut out = DelegationActivationResult {
        composition,
        activation: "not_evaluated",
        delegation_active: false,
        action_authorized: false,
        acknowledgments: Vec::new(),
        inputs: ActivationInputs { now: snapshot.now, acknowledgments: acks.len(), awareness_thresholds: thresholds.len() },
        errors: Vec::new(),
    };
    let Some(verified) = verified.filter(|_| out.composition.admitted) else {
        return Ok(out);
    };
    out.activation = "evaluated";
    let ids: Vec<&str> = verified.mandates.iter().map(|m| s(m, "mandate_id")).collect();
    out.acknowledgments = ids
        .iter()
        .map(|id| AcknowledgmentEntry { mandate_id: id.to_string(), acknowledgment_id: None, awareness_threshold_id: None, verified: false })
        .collect();
    let finish = |mut out: DelegationActivationResult, codes: Codes| {
        out.delegation_active = activation_holds(&codes, &out.acknowledgments);
        out.errors = codes.0;
        Ok(out)
    };

    // ── 3. Form ──
    for (i, a) in acks.iter().enumerate() {
        if let Some(e) = acknowledgment_form_error(a) {
            codes.add("ACK_FORM_INVALID", format!("acknowledgments[{i}]: {e}"));
        }
    }
    for (i, u) in thresholds.iter().enumerate() {
        if let Some(e) = threshold_form_error(u) {
            codes.add("ACK_THRESHOLD_INVALID", format!("awareness_thresholds[{i}]: {e}"));
        }
    }
    if !codes.0.is_empty() {
        return finish(out, codes);
    }

    // ── 4. Cardinality, in the order of design § 7.2 ──
    let by_mandate: Vec<Vec<&Value>> = ids.iter().map(|id| acks.iter().filter(|a| s(a, "mandate_id") == *id).collect()).collect();
    for (id, list) in ids.iter().zip(&by_mandate) {
        match list.len() {
            0 => codes.add("ACK_MISSING", format!("mandate {} has no acknowledgment", printable_str(id))),
            1 => {}
            n => codes.add("ACK_DUPLICATE", format!("mandate {} has {n} acknowledgments", printable_str(id))),
        }
    }
    for (i, a) in acks.iter().enumerate() {
        if !ids.contains(&s(a, "mandate_id")) {
            codes.add("ACK_UNEXPECTED", format!("acknowledgments[{i}] acknowledges {}, not in the chain", printable(a.get("mandate_id"))));
        }
    }
    let second_occurrences = |values: Vec<&str>| -> Vec<usize> {
        let mut seen: HashMap<&str, usize> = HashMap::new();
        let mut out = Vec::new();
        for (i, v) in values.into_iter().enumerate() {
            let n = seen.entry(v).or_default();
            *n += 1;
            if *n == 2 {
                out.push(i);
            }
        }
        out
    };
    for i in second_occurrences(acks.iter().map(|a| s(a, "acknowledgment_id")).collect()) {
        codes.add("ACK_DUPLICATE", format!("acknowledgment_id {} is repeated", printable(acks[i].get("acknowledgment_id"))));
    }
    for i in second_occurrences(thresholds.iter().map(|u| s(u, "threshold_id")).collect()) {
        codes.add("ACK_THRESHOLD_DUPLICATE", format!("threshold_id {} is repeated", printable(thresholds[i].get("threshold_id"))));
    }
    let threshold_ids: Vec<&str> = thresholds.iter().map(|u| s(u, "threshold_id")).collect();
    for (i, a) in acks.iter().enumerate() {
        if !threshold_ids.contains(&s(a, "awareness_threshold_id")) {
            codes.add(
                "ACK_THRESHOLD_MISSING",
                format!("acknowledgments[{i}] names threshold {}, which was not given", printable(a.get("awareness_threshold_id"))),
            );
        }
    }
    for i in second_occurrences(acks.iter().map(|a| s(a, "awareness_threshold_id")).collect()) {
        codes.add(
            "ACK_THRESHOLD_REUSED",
            format!("threshold {} is named by more than one acknowledgment", printable(acks[i].get("awareness_threshold_id"))),
        );
    }
    let named: HashSet<&str> = acks.iter().map(|a| s(a, "awareness_threshold_id")).collect();
    for (i, u) in thresholds.iter().enumerate() {
        if !named.contains(s(u, "threshold_id")) {
            codes.add("ACK_THRESHOLD_UNEXPECTED", format!("awareness_thresholds[{i}] ({}) is named by no acknowledgment", printable(u.get("threshold_id"))));
        }
    }
    for (i, list) in by_mandate.iter().enumerate() {
        if list.len() != 1 {
            continue;
        }
        out.acknowledgments[i].acknowledgment_id = Some(s(list[0], "acknowledgment_id").to_string());
        let matching: Vec<&Value> = thresholds.iter().filter(|u| s(u, "threshold_id") == s(list[0], "awareness_threshold_id")).collect();
        if matching.len() == 1 {
            out.acknowledgments[i].awareness_threshold_id = Some(s(matching[0], "threshold_id").to_string());
        }
    }
    if !codes.0.is_empty() {
        return finish(out, codes);
    }

    // ── 5–8. Per mandate, chain order: A bindings, B keys and policy, C signatures, D own time ──
    let pairs: Vec<(&Value, &Value)> = by_mandate
        .iter()
        .map(|list| {
            let k = list[0];
            let u = thresholds.iter().find(|u| s(u, "threshold_id") == s(k, "awareness_threshold_id")).expect("one threshold");
            (k, u)
        })
        .collect();
    let Some((hashes, chains)) = verified_chain_hashes(verified.mandates, &mut codes) else {
        return finish(out, codes);
    };
    let n = ids.len();
    let mut self_valid = vec![false; n];
    let mut pair_keys: Vec<Vec<Value>> = vec![Vec::new(); n];
    for i in 0..n {
        if let Some(keys) = evaluate_pair(i, pairs[i], &verified, &hashes[i], &chains[i], &mut codes) {
            self_valid[i] = true;
            pair_keys[i] = keys;
        }
    }

    // ── 9. T5: the parent acknowledged before the sub-mandate was issued ──
    let mut t5_failed = vec![false; n];
    for i in 1..n {
        if !self_valid[i - 1] {
            continue;
        }
        if instant(pairs[i - 1].0.get("acknowledged_at")) > instant(verified.mandates[i].get("timestamp")) {
            codes.add(
                "ACK_TIME_INVALID",
                format!("T5: the acknowledgment of mandate {} is after the issuance of mandate {}", printable_str(ids[i - 1]), printable_str(ids[i])),
            );
            t5_failed[i - 1] = true;
        }
    }

    // ── 10. Revocation of the keys only acknowledgments and thresholds use, in the composition's snapshot ──
    let mut revoked_pair = vec![false; n];
    let mut users: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, keys) in pair_keys.iter().enumerate() {
        if !self_valid[i] {
            continue;
        }
        for key in keys {
            let kid = s(key, "kid").to_string();
            if verified.checked_kids.contains(&kid) {
                continue;
            }
            users.entry(kid).or_default().push(i);
        }
    }
    let statuses = verified.revocation.and_then(|r| r.get("keys")).and_then(Value::as_object);
    let mut kids: Vec<&String> = users.keys().collect();
    kids.sort();
    for kid in kids {
        match statuses.and_then(|m| m.get(kid.as_str())).and_then(Value::as_str) {
            Some("not_revoked") => continue,
            Some("revoked") => codes.add("ACK_KEY_REVOKED", format!("key {kid} is revoked")),
            _ => codes.add("ACK_KEY_REVOCATION_UNKNOWN", format!("the revocation status of key {kid} is unknown")),
        }
        for &i in &users[kid] {
            revoked_pair[i] = true;
        }
    }

    // ── 11. Result ──
    for i in 0..n {
        out.acknowledgments[i].verified = self_valid[i] && !t5_failed[i] && !revoked_pair[i];
    }
    finish(out, codes)
}

/// Fail-closed: the delegation is active only with no code and every acknowledgment verified. Each path that leaves
/// an acknowledgment unverified adds a code; the second condition keeps activation off should one ever not.
fn activation_holds(codes: &Codes, entries: &[AcknowledgmentEntry]) -> bool {
    codes.0.is_empty() && entries.iter().all(|e| e.verified)
}

/// The mandate_hash and chain_hash of the verified chain. Invariant: the composition verified every mandate over
/// its dcp-jcs-v1 bytes, so they hash. Should they not, the failure is recorded as ACK_CHAIN_MISMATCH (no
/// chain_hash can match a chain that does not hash) and no digest is made up.
fn verified_chain_hashes(mandates: &[Value], codes: &mut Codes) -> Option<(Vec<String>, Vec<String>)> {
    match chain_hashes(mandates) {
        Ok(h) => Some(h),
        Err(e) => {
            codes.add("ACK_CHAIN_MISMATCH", format!("the verified chain cannot be hashed: {e}"));
            None
        }
    }
}

/// Phases A to D for mandate i (design § 4.2): each phase runs all its checks, and a phase that adds a code skips
/// the later phases of this mandate. Returns the four resolved keys when every phase passed, else None; every None
/// comes with at least one code.
fn evaluate_pair(
    i: usize,
    (k, u): (&Value, &Value),
    verified: &DelegatedVerified<'_>,
    mandate_digest: &str,
    chain_digest: &str,
    codes: &mut Codes,
) -> Option<Vec<Value>> {
    let m = &verified.mandates[i];
    let label = format!("mandate {}", printable(m.get("mandate_id")));
    let fail = |codes: &mut Codes, code: &'static str, message: String| codes.add(code, format!("{label}: {message}"));
    // A phase that adds a code skips the later phases of this mandate.
    let mut start = codes.0.len();
    let mut phase_failed = |codes: &Codes| {
        let failed = codes.0.len() > start;
        start = codes.0.len();
        failed
    };

    // A. Bindings, in the order of design § 4.4
    if s(k, "mandate_hash") != mandate_digest {
        fail(codes, "ACK_MANDATE_MISMATCH", "mandate_hash is not the hash of the mandate".into());
    }
    for f in ["session_nonce", "human_id", "agent_id"] {
        if k.get(f) != m.get(f) {
            fail(codes, "ACK_MANDATE_MISMATCH", format!("{f} is not the mandate's"));
        }
    }
    if s(k, "chain_hash") != chain_digest {
        fail(codes, "ACK_CHAIN_MISMATCH", "chain_hash is not the hash of the chain up to the mandate".into());
    }
    if threshold_hash(u).ok().as_deref() != Some(s(k, "awareness_threshold_hash")) {
        fail(codes, "ACK_THRESHOLD_MISMATCH", "awareness_threshold_hash is not the hash of the threshold".into());
    }
    for f in ["agent_id", "human_id", "session_nonce"] {
        if u.get(f) != m.get(f) {
            fail(codes, "ACK_THRESHOLD_MISMATCH", format!("the threshold's {f} is not the mandate's"));
        }
    }
    if phase_failed(codes) {
        return None;
    }

    // B. Keys, in the passport the composition verified for the mandate's agent, then the policy
    let agent_id = s(m, "agent_id");
    let list: &[Value] = verified.agent_keys.get(agent_id).map(Vec::as_slice).unwrap_or(&[]);
    // Invariant: step 3 made both composite_sig slots hybrid, so both read. Should one not, the failure is recorded
    // under that record's form code and the pair is not self-valid.
    let read = |r: &Value| {
        serde_json::from_value::<CompositeSignature>(r["composite_sig"].clone()).ok().and_then(|cs| Some((cs.pq.clone()?, cs)))
    };
    let (threshold_sig, acknowledgment_sig) = (read(u), read(k));
    if threshold_sig.is_none() {
        fail(codes, "ACK_THRESHOLD_INVALID", "the threshold's composite_sig cannot be read as a hybrid signature".into());
    }
    if acknowledgment_sig.is_none() {
        fail(codes, "ACK_FORM_INVALID", "the acknowledgment's composite_sig cannot be read as a hybrid signature".into());
    }
    let (Some((upq, ucs)), Some((kpq, kcs))) = (threshold_sig, acknowledgment_sig) else {
        return None; // the codes are recorded above
    };
    let components: [(&str, &SignatureEntry, &str); 4] = [
        ("threshold classical", &ucs.classical, "classical"),
        ("threshold pq", &upq, "pq"),
        ("acknowledgment classical", &kcs.classical, "classical"),
        ("acknowledgment pq", &kpq, "pq"),
    ];
    let mut resolved: Vec<Value> = Vec::new();
    for (at, entry, _) in components {
        if let Err(problem) = signer_key(list, entry, verified.now) {
            let code = if find_key(list, &entry.kid).is_some() { "ACK_KEY_INVALID" } else { "ACK_KEY_UNKNOWN" };
            fail(codes, code, format!("{at}: {problem} in the passport of {}", printable_str(agent_id)));
            continue;
        }
        let key = find_key(list, &entry.kid);
        if let Some(e) = used_key_error(key, &entry.kid, &entry.alg, at) {
            fail(codes, "ACK_KEY_INVALID", e);
            continue;
        }
        resolved.push(key.cloned().unwrap_or_default());
    }
    let has = |l: &[String], alg: &str| l.iter().any(|a| a == alg);
    for (at, entry, kind) in components {
        if kind == "classical" && verified.mode == "pq_only" {
            continue;
        }
        let accepted = if kind == "classical" { &verified.policy.accepted_classical_algs } else { &verified.policy.accepted_pq_algs };
        if !has(accepted, &entry.alg) {
            fail(codes, "ACK_ALGORITHM_REJECTED", format!("{at}: {} is not accepted by the verifier policy", entry.alg));
        }
        if has(&verified.policy.advisory_rejected_algs, &entry.alg) {
            fail(codes, "ACK_ALGORITHM_REJECTED", format!("{at}: {} is rejected by an active advisory", entry.alg));
        }
    }
    if phase_failed(codes) {
        return None;
    }

    // C. Signatures: the threshold under Awareness, then the acknowledgment under its own context
    let verifies = |context: &str, record: &Value, cs: &CompositeSignature, classical: &Value, pq: &Value| -> bool {
        let Ok(canonical) = canonicalize_v2(&unsigned(record)) else { return false };
        let (Ok(cp), Some(Ok(pp))) = (provider_for_alg(&cs.classical.alg), cs.pq.as_ref().map(|p| provider_for_alg(&p.alg))) else {
            return false;
        };
        composite_verify(cp.as_ref(), Some(pp.as_ref()), context, canonical.as_bytes(), cs, s(classical, "public_key_b64"), Some(s(pq, "public_key_b64")))
            .is_ok_and(|r| r.valid && r.classical_valid && r.pq_valid)
    };
    if !verifies(CTX_AWARENESS, u, &ucs, &resolved[0], &resolved[1]) {
        fail(codes, "ACK_THRESHOLD_SIGNATURE_INVALID", "the threshold does not verify under DCP-AI.v2.Awareness".into());
    }
    if !verifies(CTX_MANDATE_ACKNOWLEDGMENT, k, &kcs, &resolved[2], &resolved[3]) {
        fail(codes, "ACK_SIGNATURE_INVALID", "the acknowledgment does not verify under DCP-AI.v2.MandateAcknowledgment".into());
    }
    if phase_failed(codes) {
        return None;
    }

    // D. Own time, T1 to T4 (design § 6)
    let at = instant(k.get("acknowledged_at"));
    if at < instant(m.get("timestamp")) {
        fail(codes, "ACK_TIME_INVALID", "T1: acknowledged_at is before the mandate timestamp".into());
    }
    if at < instant(u.get("timestamp")) {
        fail(codes, "ACK_TIME_INVALID", "T2: acknowledged_at is before the threshold timestamp".into());
    }
    if at > instant(m.get("valid_until")) {
        fail(codes, "ACK_TIME_INVALID", "T3: acknowledged_at is after the mandate valid_until".into());
    }
    if at > verified.now + SESSION_CLOCK_SKEW_MS {
        fail(codes, "ACK_TIME_INVALID", "T4: acknowledged_at is after now plus the clock skew".into());
    }
    if phase_failed(codes) {
        None
    } else {
        Some(resolved)
    }
}

#[cfg(test)]
mod tests {
    //! What needs the module's internals: the record tables against their schemas and the integer domain.
    use super::*;

    fn schema(name: &str) -> Value {
        let path = format!("{}/../../schemas/v2/{}", env!("CARGO_MANIFEST_DIR"), name);
        serde_json::from_str(&std::fs::read_to_string(path).expect("schema")).expect("json")
    }

    fn sorted(mut v: Vec<String>) -> Vec<String> {
        v.sort();
        v
    }

    fn keys(v: &Value) -> Vec<String> {
        sorted(v.as_object().unwrap().keys().cloned().collect())
    }

    fn strs(v: &Value) -> Vec<String> {
        sorted(v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect())
    }

    fn owned(v: &[&str]) -> Vec<String> {
        sorted(v.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn record_tables_match_the_schemas() {
        let ack = schema("mandate_acknowledgment.schema.json");
        assert_eq!(ack["additionalProperties"], Value::Bool(false));
        assert_eq!(keys(&ack["properties"]), owned(&ACK_FIELDS));
        assert_eq!(strs(&ack["required"]), owned(&ACK_FIELDS));
        assert_eq!(ack["properties"]["acknowledgment_format"]["const"], MANDATE_ACKNOWLEDGMENT_FORMAT);
        let th = schema("awareness_threshold.schema.json");
        assert_eq!(th["additionalProperties"], Value::Bool(false));
        assert_eq!(keys(&th["properties"]), owned(&THRESHOLD_FIELDS));
        assert_eq!(strs(&th["required"]), owned(&THRESHOLD_FIELDS));
        let rule = &th["properties"]["threshold_rules"]["items"];
        assert_eq!(keys(&rule["properties"]), owned(&RULE_FIELDS));
        assert_eq!(strs(&rule["required"]), owned(&RULE_FIELDS));
        assert_eq!(rule["properties"]["operator"]["enum"], json!(RULE_OPERATORS));
        assert_eq!(rule["properties"]["action_if_triggered"]["enum"], json!(RULE_ACTIONS));
    }

    #[test]
    fn the_integer_domain() {
        let parse = |t: &str| -> Value { serde_json::from_str(t).unwrap() };
        for (text, ok) in [
            ("9007199254740991", true),
            ("-9007199254740991", true),
            ("9007199254740992", false),
            ("-9007199254740992", false),
            ("5.0", true),
            ("1.5", false),
            ("true", false),
            ("\"1\"", false),
            ("9007199254740992.0", false),
        ] {
            assert_eq!(is_safe_integer_value(&parse(text)), ok, "{text}");
        }
    }

    fn code_list(codes: &Codes) -> Vec<&'static str> {
        codes.0.iter().map(|e| e.code).collect()
    }

    /// Internal invariants, not a remote attack: no public input reaches these paths (the composition hashes every
    /// mandate it verifies; step 3 makes both composite_sig slots hybrid). Were one reached, it records a code and
    /// the delegation is not activated.
    #[test]
    fn invariant_failures_are_recorded_and_never_activate() {
        // A chain that does not hash: a recorded ACK_CHAIN_MISMATCH, no digests.
        let mut codes = Codes(Vec::new());
        assert!(verified_chain_hashes(&[json!({"x": 1.5})], &mut codes).is_none());
        assert_eq!(code_list(&codes), ["ACK_CHAIN_MISMATCH"]);

        // Phase A passes; neither composite_sig reads as a hybrid signature: a code for each, not self-valid.
        let m = json!({"mandate_id": "mandate-1", "session_nonce": "n", "human_id": "human-1", "agent_id": "agent-1"});
        let u = json!({"session_nonce": "n", "human_id": "human-1", "agent_id": "agent-1", "composite_sig": {"pq": null}});
        let mandates = [m];
        let (hashes, chains) = chain_hashes(&mandates).unwrap();
        let k = json!({
            "mandate_hash": hashes[0], "chain_hash": chains[0], "awareness_threshold_hash": threshold_hash(&u).unwrap(),
            "session_nonce": "n", "human_id": "human-1", "agent_id": "agent-1", "composite_sig": null,
        });
        let verified = DelegatedVerified {
            now: 0,
            mandates: &mandates,
            agent_keys: HashMap::new(),
            policy: crate::v2::types::VerifierPolicy::default(),
            mode: "hybrid_required".into(),
            revocation: None,
            checked_kids: HashSet::new(),
        };
        let mut codes = Codes(Vec::new());
        assert!(evaluate_pair(0, (&k, &u), &verified, &hashes[0], &chains[0], &mut codes).is_none());
        assert_eq!(code_list(&codes), ["ACK_THRESHOLD_INVALID", "ACK_FORM_INVALID"]);

        // Activation needs no code and every acknowledgment verified.
        let entry = |verified| AcknowledgmentEntry { mandate_id: "mandate-1".into(), acknowledgment_id: None, awareness_threshold_id: None, verified };
        assert!(activation_holds(&Codes(Vec::new()), &[entry(true)]));
        assert!(!activation_holds(&Codes(Vec::new()), &[entry(true), entry(false)]));
        assert!(!activation_holds(&codes, &[entry(true)]));
    }
}
