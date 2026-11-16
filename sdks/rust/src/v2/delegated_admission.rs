//! Delegated admission (opt-in): a leaf bundle admitted together with the DCP-09 mandate chain it acts under
//! and a bundle of every delegating agent, at one instant, against the operator's trust set, policy and
//! revocation sources. Rust port of the TypeScript SDK's core/delegated-admission.ts; design:
//! docs/reviews/mp02-security-composition-design.md (v0.2 § 1) and its policy contract (R4).
//!
//! Everything is verified here, from the evidence itself: no verification result, key map or boolean is taken
//! from the caller. The chain floor (DCP-09 § 3.5.2 rule 6) is fed to the leaf's own tier computation, so it
//! raises the mode its signatures are verified in. Admission is not authorization: `action_authorized` is
//! always false, and activation (the agent's acknowledgment, DCP-09 § 3.3) is not evaluated yet.
//!
//! Existing APIs are unchanged: `verify_mandate_chain`, `verify_signed_bundle_v2_at` and
//! `admit_signed_bundle_v2` keep their behavior; the stricter checks below apply to this function only. The
//! evidence and the configuration are taken by shared reference: they cannot change during the call.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::v2::admission::{
    bundle_of, evaluate_admission_v2, fail, integer, payload_field, printable, printable_str, resolve_strict_v1_profile,
    revocation_subjects, string_list, AdmissionConfigError, AdmissionError, AdmissionOptions, AdmissionResult,
    PrincipalTrustStore, StrictV1Profile,
};
use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::crypto_provider::derive_kid;
use crate::v2::delegation::{verify_mandate_chain, MandateChainKeys};
use crate::v2::lifecycle::unix_now_millis;
use crate::v2::schema_v2::is_schema_date_time;
use crate::v2::session_nonce::parse_rfc3339_millis;
use crate::v2::types::VerifierPolicy;
use crate::v2::verify_bundle::{canonical_b64, verify_signed_bundle_v2_at_floor, SESSION_CLOCK_SKEW_MS};

const CONFIG_INVALID_VALUE: &str = "CONFIG_INVALID_VALUE";
const CONFIG_UNKNOWN_FIELD: &str = "CONFIG_UNKNOWN_FIELD";
const CONFIG_PROFILE_CONTRADICTION: &str = "CONFIG_PROFILE_CONTRADICTION";
const MAX_SECONDS: u64 = 300;
/// The largest `max_session_duration_seconds` this API takes: an int32, held by every SDK without overflow. A
/// domain of this API's operator parameter, not a protocol limit.
const POLICY_CONTRACT_MAX_SESSION: i64 = 2_147_483_647;
const TIERS: [&str; 4] = ["routine", "standard", "elevated", "maximum"];
const MODES: [&str; 4] = ["classical_only", "pq_only", "hybrid_required", "hybrid_preferred"];
const KEY_BYTES: [(&str, usize); 3] = [("ed25519", 32), ("ml-dsa-65", 1952), ("slh-dsa-192f", 48)];
const SIG_BYTES: [(&str, usize); 3] = [("ed25519", 64), ("ml-dsa-65", 3309), ("slh-dsa-192f", 35664)];

// The shape of schemas/v2/delegation_mandate.schema.json, checked by the parity test.
const MANDATE_FIELDS: [&str; 16] = [
    "dcp_version", "mandate_id", "session_nonce", "human_id", "agent_id", "authority_scope", "valid_from",
    "valid_until", "revocable", "timestamp", "parent_mandate_id", "delegation_depth", "sub_delegation",
    "minimum_security_tier", "human_composite_sig", "delegator_composite_sig",
];
const MANDATE_REQUIRED: [&str; 10] = [
    "dcp_version", "mandate_id", "session_nonce", "human_id", "agent_id", "authority_scope", "valid_from",
    "valid_until", "revocable", "timestamp",
];
const SCOPE_FIELDS: [&str; 4] = ["domain", "actions_permitted", "data_classes", "limits"];
const SCOPE_REQUIRED: [&str; 2] = ["domain", "actions_permitted"];
const SUB_DELEGATION_FIELDS: [&str; 2] = ["permitted", "max_depth"];

/// One member of schemas/v2/verifier_policy.schema.json: its type ("string", "boolean", "integer",
/// "string_array", "mode" or "risk_overrides"), its minimum and its minimum number of items.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PolicyField {
    name: &'static str,
    kind: &'static str,
    minimum: Option<i64>,
    min_items: Option<usize>,
}

const fn field(name: &'static str, kind: &'static str, minimum: Option<i64>, min_items: Option<usize>) -> PolicyField {
    PolicyField { name, kind, minimum, min_items }
}

// The members of schemas/v2/verifier_policy.schema.json, checked by the parity test.
const POLICY_FIELDS: [PolicyField; 18] = [
    field("default_mode", "mode", None, None),
    field("risk_overrides", "risk_overrides", None, None),
    field("min_classical", "integer", Some(0), None),
    field("min_pq", "integer", Some(0), None),
    field("accepted_classical_algs", "string_array", None, Some(1)),
    field("accepted_pq_algs", "string_array", None, None),
    field("accepted_hash_algs", "string_array", None, Some(1)),
    field("require_session_binding", "boolean", None, None),
    field("require_composite_binding", "boolean", None, None),
    field("max_key_age_days", "integer", Some(1), None),
    field("allow_v1_bundles", "boolean", None, None),
    field("allow_classical_fallback_disable", "boolean", None, None),
    field("warn_classical_only_deprecated", "boolean", None, None),
    field("advisory_rejected_algs", "string_array", None, None),
    field("require_session_expiry", "boolean", None, None),
    field("max_session_duration_seconds", "integer", Some(0), None),
    field("require_audience_binding", "boolean", None, None),
    field("verifier_id", "string", None, None),
];
const POLICY_REQUIRED: [&str; 11] = [
    "default_mode", "risk_overrides", "min_classical", "min_pq", "accepted_classical_algs", "accepted_pq_algs",
    "accepted_hash_algs", "require_session_binding", "require_composite_binding", "max_key_age_days",
    "allow_v1_bundles",
];

/// What the request may carry.
#[derive(Debug, Clone, Copy)]
pub struct DelegatedEvidence<'a> {
    /// The bundle of the acting agent: the `agent_id` of the chain's last mandate.
    pub signed_bundle: &'a Value,
    /// The mandate chain, root first.
    pub mandate_chain: &'a [Value],
    /// One bundle of each delegating agent (every mandate's `agent_id` but the last).
    pub delegator_bundles: &'a [Value],
}

/// What only the operator sets (spec/profiles/admission A2), never the request.
#[derive(Debug, Clone, Copy, Default)]
pub struct DelegatedOperator<'a> {
    /// A loaded trust store, used as it is (it cannot change after loading), or `trust_set`, loaded at the
    /// call. Exactly one is required.
    pub trust: Option<&'a PrincipalTrustStore>,
    pub trust_set: Option<&'a Value>,
    /// A loaded strict-v1 profile, or `profile_config`, resolved at the call. At most one; a profile excludes
    /// `policy` and `max_revocation_age_seconds`.
    pub profile: Option<&'a StrictV1Profile>,
    pub profile_config: Option<&'a Value>,
    /// The verifier policy without a profile, as JSON: checked against schemas/v2/verifier_policy.schema.json
    /// and the policy contract (R4) before use. None: `VerifierPolicy::default()`.
    pub policy: Option<&'a Value>,
    /// The snapshot for every agent and key of the composition, and the one for every mandate of the chain
    /// (`{"checked_at", "mandates": {id: status}}`). None or `Value::Null`: the source could not answer.
    pub revocation: Option<&'a Value>,
    pub mandate_revocation: Option<&'a Value>,
    /// Required without a profile, from 1 to 300; with a profile the profile's applies.
    pub max_revocation_age_seconds: Option<u64>,
    /// Milliseconds since the Unix epoch, read once; default the system clock.
    pub now_ms: Option<i64>,
}

/// The chain of a delegated admission.
#[derive(Debug, Clone, Serialize)]
pub struct DelegatedChain {
    pub depth: usize,
    pub mandate_ids: Vec<String>,
    /// The verified chain's effective tier, or None.
    pub effective_floor: Option<String>,
    /// A copy of the leaf mandate's `authority_scope`, not evaluated against any action.
    pub leaf_authority_scope: Value,
}

/// What a delegated admission was evaluated against.
#[derive(Debug, Clone, Serialize)]
pub struct DelegatedInputs {
    pub now: i64,
    pub leaf_bundle_sha256: Option<String>,
    pub trust_set_version: String,
    pub revocation_checked_at: Option<String>,
    pub mandate_revocation_checked_at: Option<String>,
}

/// The outcome of [`admit_delegated_bundle_v2`]. Serializes with the field names of the design.
#[derive(Debug, Clone, Serialize)]
pub struct DelegatedAdmissionResult {
    /// The leaf, the chain and every delegator verified, anchored and not revoked, with no code added.
    pub admitted: bool,
    /// The chain verified with keys taken from the verified bundles and is tied to the principal and the leaf.
    pub delegation_verified: bool,
    /// Always "not_evaluated": the agent's acknowledgment (DCP-09 § 3.3) is not evaluated yet.
    pub activation: &'static str,
    /// Always false.
    pub delegation_active: bool,
    /// Always false: admission authorizes no action.
    pub action_authorized: bool,
    /// The leaf's tier and mode, from its verification with the chain floor; None when it did not verify.
    pub security_tier: Option<String>,
    pub verification_mode: Option<String>,
    pub chain: Option<DelegatedChain>,
    pub leaf: Option<AdmissionResult>,
    pub delegators: Vec<AdmissionResult>,
    pub inputs: DelegatedInputs,
    pub errors: Vec<AdmissionError>,
}

struct Codes {
    errors: Vec<AdmissionError>,
    problem: bool,
}

impl Codes {
    fn add(&mut self, code: &'static str, message: impl Into<String>) {
        self.errors.push(AdmissionError { code, message: crate::v2::admission::bounded(message.into()) });
    }
    /// A code that also means the delegation is not verified.
    fn problem(&mut self, code: &'static str, message: impl Into<String>) {
        self.problem = true;
        self.add(code, message);
    }
}

// ── Verifier policy without a profile: schema, then the policy contract (R4) ──

fn all_pq(m: &Map<String, Value>) -> bool {
    m.get("default_mode").and_then(Value::as_str) == Some("pq_only")
        && ["low", "medium", "high"]
            .iter()
            .all(|t| m.get("risk_overrides").and_then(|o| o.get(*t)).and_then(Value::as_str) == Some("pq_only"))
}

/// A verifier policy given without a profile, checked against the policy schema (no unknown member:
/// CONFIG_UNKNOWN_FIELD; every required member, each of its type, enumeration and bounds: CONFIG_INVALID_VALUE;
/// an integer is a JSON integer, 300 or 300.0, never a bool), then against the policy contract. Nothing is
/// defaulted or converted beyond reading each JSON integer as the field's integer type.
fn check_verifier_policy(value: &Value) -> Result<VerifierPolicy, AdmissionConfigError> {
    let Some(m) = value.as_object() else {
        return fail(CONFIG_INVALID_VALUE, "policy must be an object");
    };
    let mut keys: Vec<&String> = m.keys().collect();
    keys.sort();
    for key in &keys {
        if !POLICY_FIELDS.iter().any(|f| f.name == key.as_str()) {
            return fail(CONFIG_UNKNOWN_FIELD, format!("policy: unknown field {}", printable_str(key)));
        }
    }
    for key in POLICY_REQUIRED {
        if !m.contains_key(key) {
            return fail(CONFIG_INVALID_VALUE, format!("policy.{} is required", key));
        }
    }
    for key in keys {
        let rule = POLICY_FIELDS.iter().find(|f| f.name == key.as_str()).expect("checked above");
        let v = &m[key];
        let bad = |what: &str| fail::<()>(CONFIG_INVALID_VALUE, format!("policy.{} {}", key, what));
        match rule.kind {
            "string" if !v.is_string() => bad("must be a string")?,
            "boolean" if !v.is_boolean() => bad("must be a boolean")?,
            "integer" => match integer(v) {
                None => bad("must be an integer")?,
                Some(i) if rule.minimum.is_some_and(|min| i < min) => bad(&format!("must be at least {}", rule.minimum.unwrap_or(0)))?,
                _ => {}
            },
            "string_array" => match string_list(v) {
                None => bad("must be a list of strings")?,
                Some(l) if rule.min_items.is_some_and(|min| l.len() < min) => {
                    bad(&format!("must have at least {} item(s)", rule.min_items.unwrap_or(0)))?
                }
                _ => {}
            },
            "mode" if !v.as_str().is_some_and(|s| MODES.contains(&s)) => bad("must be a verification mode")?,
            "risk_overrides" => {
                let Some(o) = v.as_object() else {
                    return fail(CONFIG_INVALID_VALUE, "policy.risk_overrides must be an object");
                };
                let mut tiers: Vec<&String> = o.keys().collect();
                tiers.sort();
                for tier in tiers {
                    if !["low", "medium", "high"].contains(&tier.as_str()) {
                        return fail(CONFIG_UNKNOWN_FIELD, format!("policy.risk_overrides: unknown field {}", printable_str(tier)));
                    }
                }
                for tier in ["low", "medium", "high"] {
                    if !o.get(tier).and_then(Value::as_str).is_some_and(|s| MODES.contains(&s)) {
                        bad(&format!(".{} must be a verification mode", tier))?;
                    }
                }
            }
            _ => {}
        }
    }
    check_policy_contract(m)?;
    let s = |k: &str| m.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let b = |k: &str| m.get(k).and_then(Value::as_bool).unwrap_or(false);
    let list = |k: &str| m.get(k).and_then(string_list).unwrap_or_default();
    let int = |k: &str| m.get(k).and_then(integer).unwrap_or(0);
    let overrides = m["risk_overrides"].as_object().map(|o| {
        o.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string())).collect::<HashMap<_, _>>()
    });
    Ok(VerifierPolicy {
        default_mode: s("default_mode"),
        risk_overrides: overrides.unwrap_or_default(),
        min_classical: u32::try_from(int("min_classical")).unwrap_or(u32::MAX),
        min_pq: u32::try_from(int("min_pq")).unwrap_or(u32::MAX),
        accepted_classical_algs: list("accepted_classical_algs"),
        accepted_pq_algs: list("accepted_pq_algs"),
        accepted_hash_algs: list("accepted_hash_algs"),
        require_session_binding: b("require_session_binding"),
        require_composite_binding: b("require_composite_binding"),
        max_key_age_days: u32::try_from(int("max_key_age_days")).unwrap_or(u32::MAX),
        allow_v1_bundles: b("allow_v1_bundles"),
        allow_classical_fallback_disable: b("allow_classical_fallback_disable"),
        warn_classical_only_deprecated: b("warn_classical_only_deprecated"),
        advisory_rejected_algs: list("advisory_rejected_algs"),
        max_session_duration_seconds: m.get("max_session_duration_seconds").and_then(integer).map(|i| i as u64),
        require_session_expiry: b("require_session_expiry"),
        require_audience_binding: b("require_audience_binding"),
        verifier_id: m.get("verifier_id").and_then(Value::as_str).map(str::to_string),
    })
}

/// The policy contract of the composition (design R4): the members no verifier applies as a control must take
/// the values that add none. min_pq 1; min_classical 1, or 0 when every mode is pq_only;
/// require_composite_binding true, or false when every mode is pq_only; require_session_binding true;
/// accepted_hash_algs exactly the set {sha256, sha384}; max_key_age_days 365 (it changes warnings only, never a
/// verdict); max_session_duration_seconds from 0 to 2147483647. The other members are applied by every SDK
/// verifier, or have no effect by norm (allow_v1_bundles: admission § 5.1 step 2; the warnings of V2-10).
/// Anything else is CONFIG_INVALID_VALUE: a control that would not be applied.
fn check_policy_contract(m: &Map<String, Value>) -> Result<(), AdmissionConfigError> {
    let pq = all_pq(m);
    let int = |k: &str| m.get(k).and_then(integer);
    let invalid = |what: &str| fail::<()>(CONFIG_INVALID_VALUE, format!("policy contract: {}", what));
    if int("min_pq") != Some(1) {
        invalid("min_pq must be 1: the effective mode decides whether a PQ component is required")?;
    }
    if !(int("min_classical") == Some(1) || (int("min_classical") == Some(0) && pq)) {
        invalid("min_classical must be 1, or 0 when every mode is pq_only")?;
    }
    if !(m.get("require_composite_binding").and_then(Value::as_bool) == Some(true) || pq) {
        invalid("require_composite_binding must be true, or false when every mode is pq_only")?;
    }
    if m.get("require_session_binding").and_then(Value::as_bool) != Some(true) {
        invalid("require_session_binding must be true (V2-4)")?;
    }
    let hashes = m.get("accepted_hash_algs").and_then(string_list).unwrap_or_default();
    if !crate::v2::verify_bundle::is_default_hash_set(&hashes) {
        invalid("accepted_hash_algs must be the set sha256, sha384")?;
    }
    if int("max_key_age_days") != Some(365) {
        invalid("max_key_age_days must be 365")?;
    }
    if m.contains_key("max_session_duration_seconds") && int("max_session_duration_seconds").is_some_and(|i| i > POLICY_CONTRACT_MAX_SESSION) {
        invalid(&format!("max_session_duration_seconds must be at most {}", POLICY_CONTRACT_MAX_SESSION))?;
    }
    Ok(())
}

// ── Mandate preflight (this function only) ──

pub(crate) fn min_length(v: Option<&Value>, n: usize) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| s.chars().count() >= n)
}

fn non_empty_string_list(v: &Value) -> bool {
    v.as_array().is_some_and(|items| items.iter().all(|s| s.as_str().is_some_and(|s| !s.is_empty())))
}

pub(crate) fn sorted_keys(m: &Map<String, Value>) -> Vec<&String> {
    let mut keys: Vec<&String> = m.keys().collect();
    keys.sort();
    keys
}

pub(crate) fn signature_slot_error(sig: &Value, field: &str) -> Option<String> {
    let Some(s) = sig.as_object() else {
        return Some(format!("{} is not an object", field));
    };
    if let Some(k) = sorted_keys(s).into_iter().find(|k| !["classical", "pq", "binding"].contains(&k.as_str())) {
        return Some(format!("{} has unknown member {}", field, printable_str(k)));
    }
    if s.get("binding").and_then(Value::as_str) != Some("pq_over_classical") {
        return Some(format!("{} binding must be pq_over_classical", field));
    }
    for (component, algs) in [("classical", &["ed25519"][..]), ("pq", &["ml-dsa-65", "slh-dsa-192f"][..])] {
        let at = format!("{}.{}", field, component);
        let Some(entry) = s.get(component).and_then(Value::as_object) else {
            return Some(format!("{} is not an object", at));
        };
        if let Some(k) = sorted_keys(entry).into_iter().find(|k| !["alg", "kid", "sig_b64"].contains(&k.as_str())) {
            return Some(format!("{} has unknown member {}", at, printable_str(k)));
        }
        let Some(alg) = entry.get("alg").and_then(Value::as_str).filter(|a| algs.contains(a)) else {
            return Some(format!("{}.alg {} is not a {} algorithm", at, printable(entry.get("alg")), component));
        };
        let kid_ok = entry
            .get("kid")
            .and_then(Value::as_str)
            .is_some_and(|k| k.len() == 32 && k.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
        if !kid_ok {
            return Some(format!("{}.kid is not 32 lowercase hex digits", at));
        }
        let Some(bytes) = entry.get("sig_b64").and_then(Value::as_str).and_then(canonical_b64) else {
            return Some(format!("{}.sig_b64 is not canonical base64 (V2-5)", at));
        };
        let size = SIG_BYTES.iter().find(|(a, _)| *a == alg).map(|(_, n)| *n).unwrap_or(0);
        if bytes.len() != size {
            return Some(format!("{}.sig_b64 is {} bytes, not a {} signature ({})", at, bytes.len(), alg, size));
        }
    }
    None
}

/// authority_scope as the schema has it: a non-empty array of closed objects; domain a non-empty string;
/// actions_permitted and data_classes lists of non-empty strings (an empty list is allowed); limits an object
/// whose members are not constrained here (the schema leaves it open).
fn scope_shape_errors(scope: Option<&Value>) -> Vec<String> {
    let Some(items) = scope.and_then(Value::as_array).filter(|a| !a.is_empty()) else {
        return vec!["authority_scope must be a non-empty array".to_string()];
    };
    let mut errors = Vec::new();
    for (j, item) in items.iter().enumerate() {
        let w = format!("authority_scope[{}]", j);
        let Some(e) = item.as_object() else {
            errors.push(format!("{} is not an object", w));
            continue;
        };
        for k in sorted_keys(e) {
            if !SCOPE_FIELDS.contains(&k.as_str()) {
                errors.push(format!("{} has unknown member {}", w, printable_str(k)));
            }
        }
        for k in SCOPE_REQUIRED {
            if !e.contains_key(k) {
                errors.push(format!("{} is missing {}", w, k));
            }
        }
        if e.contains_key("domain") && !min_length(e.get("domain"), 1) {
            errors.push(format!("{}.domain must be a non-empty string", w));
        }
        for k in ["actions_permitted", "data_classes"] {
            if e.get(k).is_some_and(|v| !non_empty_string_list(v)) {
                errors.push(format!("{}.{} must be a list of non-empty strings", w, k));
            }
        }
        if e.get("limits").is_some_and(|l| !l.is_object()) {
            errors.push(format!("{}.limits must be an object", w));
        }
    }
    errors
}

pub(crate) fn mandate_preflight(value: &Value, i: usize) -> Vec<String> {
    let at = |e: String| format!("mandate[{}]: {}", i, e);
    let Some(m) = value.as_object() else {
        return vec![at("not an object".into())];
    };
    let mut errors = Vec::new();
    for k in sorted_keys(m) {
        if !MANDATE_FIELDS.contains(&k.as_str()) {
            errors.push(at(format!("unknown field {}", printable_str(k))));
        }
    }
    for k in MANDATE_REQUIRED {
        if !m.contains_key(k) {
            errors.push(at(format!("missing {}", k)));
        }
    }
    if m.get("dcp_version").and_then(Value::as_str) != Some("2.0") {
        errors.push(at("dcp_version must be \"2.0\"".into()));
    }
    let nonce_ok = m
        .get("session_nonce")
        .and_then(Value::as_str)
        .is_some_and(|n| n.len() == 64 && n.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
    if !nonce_ok {
        errors.push(at("session_nonce is not 64 lowercase hex digits".into()));
    }
    for f in ["mandate_id", "human_id", "agent_id"] {
        if !min_length(m.get(f), 6) {
            errors.push(at(format!("{} must be a string of at least 6 characters", f)));
        }
    }
    let has_parent = m.contains_key("parent_mandate_id");
    if has_parent && !min_length(m.get("parent_mandate_id"), 6) {
        errors.push(at("parent_mandate_id must be a string of at least 6 characters".into()));
    }
    if !m.get("revocable").is_some_and(Value::is_boolean) {
        errors.push(at("revocable must be a boolean".into()));
    }
    for f in ["valid_from", "valid_until", "timestamp"] {
        let ok = m.get(f).and_then(Value::as_str).is_some_and(|s| is_schema_date_time(s) && parse_rfc3339_millis(s).is_some());
        if !ok {
            errors.push(at(format!("{} is not an RFC 3339 date-time", f)));
        }
    }
    let depth = m.get("delegation_depth").map(integer);
    if let Some(d) = depth {
        if !d.is_some_and(|d| d >= 0) {
            errors.push(at("delegation_depth must be an integer >= 0".into()));
        }
    }
    // The schema's oneOf: a root has no parent and depth 0 or none; a sub-mandate has both, depth >= 1.
    if i == 0 {
        if has_parent {
            errors.push(at("a root mandate has no parent_mandate_id".into()));
        }
        if depth.is_some_and(|d| d != Some(0)) {
            errors.push(at("a root mandate has delegation_depth 0".into()));
        }
    } else {
        if !has_parent {
            errors.push(at("missing parent_mandate_id".into()));
        }
        match depth {
            None => errors.push(at("missing delegation_depth".into())),
            Some(Some(d)) if d < 1 => errors.push(at("a sub-mandate has delegation_depth >= 1".into())),
            _ => {}
        }
    }
    errors.extend(scope_shape_errors(m.get("authority_scope")).into_iter().map(at));
    if let Some(sd) = m.get("sub_delegation") {
        match sd.as_object() {
            None => errors.push(at("sub_delegation is not an object".into())),
            Some(sd) => {
                for k in sorted_keys(sd) {
                    if !SUB_DELEGATION_FIELDS.contains(&k.as_str()) {
                        errors.push(at(format!("sub_delegation has unknown member {}", printable_str(k))));
                    }
                }
                if !sd.get("permitted").is_some_and(Value::is_boolean) {
                    errors.push(at("sub_delegation.permitted must be a boolean".into()));
                }
                if !sd.get("max_depth").and_then(integer).is_some_and(|d| d >= 0) {
                    errors.push(at("sub_delegation.max_depth must be an integer >= 0".into()));
                }
            }
        }
    }
    if let Some(tier) = m.get("minimum_security_tier") {
        if !tier.as_str().is_some_and(|t| TIERS.contains(&t)) {
            errors.push(at("minimum_security_tier is not routine, standard, elevated or maximum".into()));
        }
    }
    // The slot of the mandate's depth, and only that one (the schema's oneOf; DCP-09 § 3.5.1).
    let (field, other) = if i == 0 {
        ("human_composite_sig", "delegator_composite_sig")
    } else {
        ("delegator_composite_sig", "human_composite_sig")
    };
    match m.get(field) {
        None => errors.push(at(format!("missing {}", field))),
        Some(sig) => {
            if let Some(e) = signature_slot_error(sig, field) {
                errors.push(at(e));
            }
        }
    }
    if m.contains_key(other) {
        errors.push(at(format!("{} is not allowed at this depth", other)));
    }
    errors
}

fn tier_rank(t: &str) -> usize {
    TIERS.iter().position(|x| *x == t).unwrap_or(2)
}

/// The highest `minimum_security_tier` of the chain; a name that is not a tier counts as elevated.
fn provisional_floor(chain: &[Value]) -> Option<&'static str> {
    let mut floor: Option<&'static str> = None;
    for m in chain {
        let Some(raw) = m.get("minimum_security_tier") else { continue };
        let tier = raw.as_str().and_then(|t| TIERS.iter().find(|x| **x == t)).copied().unwrap_or("elevated");
        floor = Some(match floor {
            Some(f) if tier_rank(f) >= tier_rank(tier) => f,
            _ => tier,
        });
    }
    floor
}

// ── Revocation snapshots (§ 4.3 of the admission profile, for any subjects) ──

fn snapshot_checks(snapshot: Option<&Value>, maps: &[(&str, &str, &[String])], max_age: u64, now: i64, codes: &mut Codes) {
    let label = maps.iter().map(|(kind, _, _)| *kind).collect::<Vec<_>>().join(" and ");
    let Some(snapshot) = snapshot.filter(|s| !s.is_null()) else {
        codes.add("REVOCATION_UNAVAILABLE", format!("no {} revocation status could be obtained", label));
        return;
    };
    let checked_at = snapshot.get("checked_at").and_then(Value::as_str).and_then(parse_rfc3339_millis);
    let valid = snapshot.as_object().is_some_and(|o| o.len() == maps.len() + 1)
        && checked_at.is_some()
        && maps.iter().all(|(_, field, _)| {
            snapshot.get(*field).and_then(Value::as_object).is_some_and(|statuses| {
                statuses.values().all(|s| matches!(s.as_str(), Some("revoked" | "not_revoked" | "unknown")))
            })
        });
    let Some(checked_at) = checked_at.filter(|_| valid) else {
        codes.add("REVOCATION_INVALID", format!("the {} revocation snapshot is malformed", label));
        return;
    };
    if checked_at > now.saturating_add(SESSION_CLOCK_SKEW_MS) {
        codes.add("REVOCATION_INVALID", format!("the {} revocation snapshot is dated in the future", label));
        return;
    }
    if i128::from(now) - i128::from(checked_at) > i128::from(max_age) * 1000 {
        codes.add("REVOCATION_STALE", format!("the {} revocation snapshot is older than {} s", label, max_age));
    }
    for (kind, field, ids) in maps {
        for id in ids.iter() {
            match snapshot.get(*field).and_then(|m| m.get(id)).and_then(Value::as_str) {
                Some("revoked") => codes.add("REVOCATION_REVOKED", format!("{} {} is revoked", kind, printable_str(id))),
                Some("not_revoked") => {}
                _ => codes.add("REVOCATION_UNKNOWN", format!("the revocation status of {} {} is unknown", kind, printable_str(id))),
            }
        }
    }
}

// ── Keys ──

pub(crate) fn used_key_error(key: Option<&Value>, kid: &str, alg: &str, at: &str) -> Option<String> {
    let key = key?; // the chain verifier reports a kid it cannot find
    if key.get("alg").and_then(Value::as_str) != Some(alg) {
        return Some(format!("{}: key {} is {}, not {}", at, kid, printable(key.get("alg")), alg));
    }
    let size = KEY_BYTES.iter().find(|(a, _)| *a == alg).map(|(_, n)| *n).unwrap_or(0);
    let Some(bytes) = key.get("public_key_b64").and_then(Value::as_str).and_then(canonical_b64).filter(|b| b.len() == size) else {
        return Some(format!("{}: key {} is not a canonical base64 {} public key", at, kid, alg));
    };
    (derive_kid(alg, &bytes) != kid).then(|| format!("{}: kid {} is not derived from its key (V2-13)", at, kid))
}

fn keys_of(signed_bundle: &Value, artifact: &str, field: &str) -> Vec<Value> {
    payload_field(bundle_of(signed_bundle), artifact, field).and_then(Value::as_array).cloned().unwrap_or_default()
}

pub(crate) fn find_key<'a>(keys: &'a [Value], kid: &str) -> Option<&'a Value> {
    keys.iter().find(|k| k.get("kid").and_then(Value::as_str) == Some(kid))
}

fn component<'a>(mandate: &'a Value, i: usize, name: &str) -> (&'a str, &'a str) {
    let slot = if i == 0 { "human_composite_sig" } else { "delegator_composite_sig" };
    let entry = &mandate[slot][name];
    (entry["kid"].as_str().unwrap_or_default(), entry["alg"].as_str().unwrap_or_default())
}

/// What admit_delegated_bundle_v2 reads from its operator, loaded once (F4 design § 10.1). The evidence is a
/// shared borrow and needs no copy.
pub(crate) struct DelegatedSnapshot<'a> {
    pub(crate) now: i64,
    trust: Cow<'a, PrincipalTrustStore>,
    profile: Option<Cow<'a, StrictV1Profile>>,
    policy: VerifierPolicy,
    max_age: u64,
    revocation: Option<&'a Value>,
    mandate_revocation: Option<&'a Value>,
}

/// What an admitted composition verified, as references to its inputs or values derived from them during that
/// composition. Read by the mandate acknowledgment only; never modified.
pub(crate) struct DelegatedVerified<'a> {
    pub(crate) now: i64,
    pub(crate) mandates: &'a [Value],
    /// The passport keys of every agent of the chain (the delegators and the leaf), from bundles that verified.
    pub(crate) agent_keys: HashMap<String, Vec<Value>>,
    pub(crate) policy: VerifierPolicy,
    /// The leaf's verification mode, the one step 7 applied.
    pub(crate) mode: String,
    pub(crate) revocation: Option<&'a Value>,
    /// The key ids step 10 looked up in `revocation`.
    pub(crate) checked_kids: HashSet<String>,
}

/// Admit a leaf bundle with the mandate chain it acts under (design § 1.3). An invalid operator configuration
/// is an [`AdmissionConfigError`]; every problem with the evidence is a code in the result.
pub fn admit_delegated_bundle_v2(
    evidence: &DelegatedEvidence<'_>,
    operator: &DelegatedOperator<'_>,
) -> Result<DelegatedAdmissionResult, AdmissionConfigError> {
    let snapshot = take_delegated_snapshot(operator)?;
    Ok(compose_delegated(evidence, &snapshot)?.0)
}

/// Step 0 of admit_delegated_bundle_v2: the operator configuration, loaded once, with the same errors in the same
/// order.
pub(crate) fn take_delegated_snapshot<'a>(operator: &DelegatedOperator<'a>) -> Result<DelegatedSnapshot<'a>, AdmissionConfigError> {
    // ── 0. Configuration ──
    let now = operator.now_ms.unwrap_or_else(|| unix_now_millis() as i64);
    let trust: Cow<'a, PrincipalTrustStore> = match (operator.trust, operator.trust_set) {
        (Some(_), Some(_)) => return fail(CONFIG_INVALID_VALUE, "give a loaded trust store or a trust set, not both"),
        (None, None) => return fail(CONFIG_INVALID_VALUE, "delegated admission requires a trust set"),
        (Some(store), None) => Cow::Borrowed(store),
        (None, Some(set)) => Cow::Owned(PrincipalTrustStore::from_json(set)?),
    };
    let profile: Option<Cow<'a, StrictV1Profile>> = match (operator.profile, operator.profile_config) {
        (Some(_), Some(_)) => return fail(CONFIG_INVALID_VALUE, "give a loaded profile or its configuration, not both"),
        (Some(p), None) => Some(Cow::Borrowed(p)),
        (None, Some(config)) => Some(Cow::Owned(resolve_strict_v1_profile(config)?)),
        (None, None) => None,
    };
    let (policy, max_age) = match profile.as_deref() {
        Some(p) => {
            if operator.policy.is_some() {
                return fail(CONFIG_PROFILE_CONTRADICTION, "a strict-v1 profile sets its own verifier policy; do not pass one");
            }
            if operator.max_revocation_age_seconds.is_some() {
                return fail(CONFIG_PROFILE_CONTRADICTION, "a strict-v1 profile sets max_revocation_age_seconds; do not pass one");
            }
            (p.policy().clone(), p.max_revocation_age_seconds())
        }
        None => {
            let Some(max_age) = operator.max_revocation_age_seconds.filter(|m| (1..=MAX_SECONDS).contains(m)) else {
                return fail(CONFIG_INVALID_VALUE, format!("without a profile, max_revocation_age_seconds must be from 1 to {}", MAX_SECONDS));
            };
            let policy = match operator.policy {
                Some(p) => check_verifier_policy(p)?,
                None => check_verifier_policy(&serde_json::to_value(VerifierPolicy::default()).map_err(|e| {
                    AdmissionConfigError { code: CONFIG_INVALID_VALUE, message: format!("the default policy cannot be encoded: {}", e) }
                })?)?,
            };
            (policy, max_age)
        }
    };
    Ok(DelegatedSnapshot {
        now,
        trust,
        profile,
        policy,
        max_age,
        revocation: operator.revocation,
        mandate_revocation: operator.mandate_revocation,
    })
}

/// Steps 1 to 11 of admit_delegated_bundle_v2 over a snapshot, with the same codes, order and early returns. The
/// verified data is None unless the result is admitted.
pub(crate) fn compose_delegated<'a>(
    evidence: &DelegatedEvidence<'a>,
    snapshot: &DelegatedSnapshot<'a>,
) -> Result<(DelegatedAdmissionResult, Option<DelegatedVerified<'a>>), AdmissionConfigError> {
    let now = snapshot.now;
    let trust: &PrincipalTrustStore = &snapshot.trust;
    let profile: Option<&StrictV1Profile> = snapshot.profile.as_deref();
    let (policy, max_age) = (&snapshot.policy, snapshot.max_age);
    let revocation = snapshot.revocation;
    let mandate_revocation = snapshot.mandate_revocation;
    let checked_at = |s: Option<&Value>| s.and_then(|s| s.get("checked_at")).and_then(Value::as_str).map(str::to_string);

    let mut codes = Codes { errors: Vec::new(), problem: false };
    let mut result = DelegatedAdmissionResult {
        admitted: false,
        delegation_verified: false,
        activation: "not_evaluated",
        delegation_active: false,
        action_authorized: false,
        security_tier: None,
        verification_mode: None,
        chain: None,
        leaf: None,
        delegators: Vec::new(),
        inputs: DelegatedInputs {
            now,
            leaf_bundle_sha256: canonicalize_v2(evidence.signed_bundle).ok().map(|c| hex::encode(Sha256::digest(c.as_bytes()))),
            trust_set_version: trust.version().to_string(),
            revocation_checked_at: checked_at(revocation),
            mandate_revocation_checked_at: checked_at(mandate_revocation),
        },
        errors: Vec::new(),
    };
    let leaf_bundle = evidence.signed_bundle;
    let mandates = evidence.mandate_chain;
    let delegator_bundles = evidence.delegator_bundles;

    // ── 1. Form and preflight ──
    if mandates.is_empty() {
        codes.add("DELEGATION_CHAIN_INVALID", "the mandate chain is empty");
        result.errors = codes.errors;
        return Ok((result, None));
    }
    for (i, m) in mandates.iter().enumerate() {
        for e in mandate_preflight(m, i) {
            codes.add("DELEGATION_CHAIN_INVALID", e);
        }
    }
    if !codes.errors.is_empty() {
        result.errors = codes.errors;
        return Ok((result, None));
    }
    let mandate_ids: Vec<String> = mandates.iter().map(|m| m["mandate_id"].as_str().unwrap_or_default().to_string()).collect();
    let agent_ids: Vec<String> = mandates.iter().map(|m| m["agent_id"].as_str().unwrap_or_default().to_string()).collect();
    for (kind, ids) in [("mandate_id", &mandate_ids), ("agent_id", &agent_ids)] {
        let (mut seen, mut reported) = (HashSet::new(), HashSet::new());
        for id in ids {
            if !seen.insert(id) && reported.insert(id) {
                codes.add("DELEGATION_REPEATED_ID", format!("{} {} appears more than once in the chain", kind, printable_str(id)));
            }
        }
    }
    if !codes.errors.is_empty() {
        result.errors = codes.errors;
        return Ok((result, None));
    }
    let human_id = mandates[0]["human_id"].as_str().unwrap_or_default();
    let leaf_agent = agent_ids[agent_ids.len() - 1].as_str();
    let delegating_agents = &agent_ids[..agent_ids.len() - 1];

    // ── 2. Provisional floor: it can only make the bundle checks stricter ──
    let floor = provisional_floor(mandates);

    // ── 3. Bundles: verified at the same instant with the floor, then admitted ──
    let admit = |bundle: &Value| -> Result<AdmissionResult, AdmissionConfigError> {
        let details = verify_signed_bundle_v2_at_floor(bundle, policy, now, "dcp-jcs-v1", floor, true);
        evaluate_admission_v2(bundle, &details, &AdmissionOptions { profile, trust: Some(trust), revocation, now_ms: now })
    };
    let leaf = admit(leaf_bundle)?;
    let mut delegators = Vec::with_capacity(delegator_bundles.len());
    for b in delegator_bundles {
        delegators.push(admit(b)?);
    }
    // The leaf's own codes, but revocation, which step 10 evaluates once for every subject.
    for e in &leaf.errors {
        if !e.code.starts_with("REVOCATION_") {
            codes.add(e.code, format!("leaf: {}", e.message));
        }
    }

    // ── 4. Links ──
    let leaf_id = payload_field(bundle_of(leaf_bundle), "agent_passport", "agent_id");
    if leaf_id.and_then(Value::as_str) != Some(leaf_agent) {
        codes.problem(
            "DELEGATION_LEAF_MISMATCH",
            format!("the leaf bundle's agent {} is not the last mandate's agent {}", printable(leaf_id), printable_str(leaf_agent)),
        );
    }
    let leaf_principal = payload_field(bundle_of(leaf_bundle), "responsible_principal_record", "human_id");
    if leaf_principal.and_then(Value::as_str) != Some(human_id) {
        codes.problem(
            "DELEGATION_PRINCIPAL_MISMATCH",
            format!("the leaf bundle's principal {} is not the chain's {}", printable(leaf_principal), printable_str(human_id)),
        );
    }
    let mut by_agent: HashMap<String, usize> = HashMap::new();
    for (i, bundle) in delegator_bundles.iter().enumerate() {
        let agent = payload_field(bundle_of(bundle), "agent_passport", "agent_id");
        let principal = payload_field(bundle_of(bundle), "responsible_principal_record", "human_id");
        if principal.and_then(Value::as_str) != Some(human_id) {
            codes.problem(
                "DELEGATION_PRINCIPAL_MISMATCH",
                format!("delegator_bundles[{}]: principal {} is not the chain's {}", i, printable(principal), printable_str(human_id)),
            );
        }
        match agent.and_then(Value::as_str) {
            Some(id) if delegating_agents.iter().any(|a| a == id) => {
                if by_agent.contains_key(id) {
                    codes.problem("DELEGATION_DELEGATOR_UNEXPECTED", format!("delegator_bundles[{}]: a second bundle of agent {}", i, printable_str(id)));
                } else {
                    by_agent.insert(id.to_string(), i);
                }
            }
            _ => codes.problem(
                "DELEGATION_DELEGATOR_UNEXPECTED",
                format!("delegator_bundles[{}]: agent {} delegates nothing in this chain", i, printable(agent)),
            ),
        }
        if !delegators[i].admitted {
            let list = delegators[i].errors.iter().map(|e| e.code).collect::<Vec<_>>().join(", ");
            codes.problem("DELEGATION_DELEGATOR_NOT_ADMITTED", format!("delegator_bundles[{}] is not admitted: {}", i, list));
        }
    }
    for id in delegating_agents {
        if !by_agent.contains_key(id) {
            codes.problem("DELEGATION_DELEGATOR_MISSING", format!("no bundle of delegating agent {}", printable_str(id)));
        }
    }

    // ── 5. Keys of every actor: the principal, each delegator and the leaf ──
    // Only from bundles that verified: an unverified bundle's keys are not the agent's keys.
    let leaf_verified = leaf.verified;
    let human_keys = if leaf_verified { keys_of(leaf_bundle, "responsible_principal_record", "binding_keys") } else { Vec::new() };
    let mut principal_lists = vec![human_keys.clone()];
    let mut agent_keys: HashMap<String, Vec<Value>> = HashMap::new();
    let mut actors: Vec<(String, Vec<Vec<Value>>)> = Vec::new();
    let mut agents: Vec<&String> = by_agent.keys().collect();
    agents.sort();
    for id in agents {
        let i = by_agent[id];
        if !delegators[i].verified {
            continue;
        }
        principal_lists.push(keys_of(&delegator_bundles[i], "responsible_principal_record", "binding_keys"));
        let keys = keys_of(&delegator_bundles[i], "agent_passport", "keys");
        actors.push((format!("delegator {}", id), vec![keys.clone()]));
        agent_keys.insert(id.clone(), keys);
    }
    actors.insert(0, ("principal".to_string(), principal_lists));
    if leaf_verified {
        actors.push((format!("leaf {}", leaf_agent), vec![keys_of(leaf_bundle, "agent_passport", "keys")]));
    }
    let (mut kid_owner, mut key_owner, mut kid_key) = (HashMap::new(), HashMap::new(), HashMap::new());
    for (label, lists) in &actors {
        for list in lists {
            let mut seen = HashSet::new();
            for entry in list {
                let (Some(kid), Some(alg), Some(pk)) = (
                    entry.get("kid").and_then(Value::as_str),
                    entry.get("alg").and_then(Value::as_str),
                    entry.get("public_key_b64").and_then(Value::as_str),
                ) else {
                    continue;
                };
                let identity = format!("{}\u{0}{}", alg, pk);
                if !seen.insert(kid.to_string()) {
                    codes.problem("DELEGATION_KEY_AMBIGUOUS", format!("{}: kid {} is listed twice in one key list", label, kid));
                }
                for (owners, id) in [(&mut kid_owner, kid.to_string()), (&mut key_owner, identity.clone())] {
                    match owners.get(&id) {
                        Some(owner) if owner != label => {
                            let message = format!("kid {}: the same key belongs to {} and {}", kid, owner, label);
                            codes.problem("DELEGATION_KEY_AMBIGUOUS", message);
                        }
                        Some(_) => {}
                        None => {
                            owners.insert(id, label.clone());
                        }
                    }
                }
                if kid_key.get(kid).is_some_and(|known: &String| *known != identity) {
                    codes.problem("DELEGATION_KEY_AMBIGUOUS", format!("{}: kid {} names two different keys", label, kid));
                }
                kid_key.insert(kid.to_string(), identity);
            }
        }
    }

    // The keys each mandate signature names, with their identity checked here (the chain verifier does not).
    let mut used_kids: HashSet<String> = HashSet::new();
    for (i, m) in mandates.iter().enumerate() {
        let list: &[Value] = if i == 0 { &human_keys } else { agent_keys.get(&agent_ids[i - 1]).map(Vec::as_slice).unwrap_or(&[]) };
        for name in ["classical", "pq"] {
            let (kid, alg) = component(m, i, name);
            used_kids.insert(kid.to_string());
            if let Some(e) = used_key_error(find_key(list, kid), kid, alg, &format!("mandate[{}] {}", i, name)) {
                codes.problem("DELEGATION_CHAIN_INVALID", e);
            }
        }
    }

    // ── 6. The chain, with the history API unchanged ──
    let revoked: HashSet<String> = mandate_revocation
        .and_then(|s| s.get("mandates"))
        .and_then(Value::as_object)
        .map(|o| o.iter().filter(|(_, v)| v.as_str() == Some("revoked")).map(|(k, _)| k.clone()).collect())
        .unwrap_or_default();
    let (mut chain_valid, mut chain_floor) = (false, None);
    if leaf_verified {
        let verdict = verify_mandate_chain(
            mandates,
            &revoked,
            &MandateChainKeys { human_keys: human_keys.clone(), agent_keys: agent_keys.clone() },
            Some(now),
        );
        chain_valid = verdict.valid;
        let effective = verdict.effective_tier.map(|t| t.as_str());
        if !verdict.valid {
            for e in verdict.errors {
                codes.problem("DELEGATION_CHAIN_INVALID", e);
            }
        } else if effective != floor {
            codes.problem(
                "DELEGATION_FLOOR_MISMATCH",
                format!("the verified chain floor {:?} is not the floor the bundles were verified with ({:?})", effective, floor),
            );
        } else {
            chain_floor = effective;
        }
    } else {
        codes.problem("DELEGATION_CHAIN_INVALID", "the chain is not verified: the leaf bundle, whose RPR holds the principal keys, did not verify");
    }

    // ── 7. Verifier policy on every chain signature component ──
    let mode = Some(leaf.verification.result.verification_mode.as_str()).filter(|m| !m.is_empty()).unwrap_or("hybrid_required");
    let has = |list: &[String], alg: &str| list.iter().any(|a| a == alg);
    for (i, m) in mandates.iter().enumerate() {
        let (_, classical) = component(m, i, "classical");
        let (_, pq) = component(m, i, "pq");
        if mode != "pq_only" {
            if !has(&policy.accepted_classical_algs, classical) {
                codes.problem("DELEGATION_ALGORITHM_REJECTED", format!("mandate[{}]: classical algorithm {} is not accepted by the verifier policy", i, classical));
            }
            if has(&policy.advisory_rejected_algs, classical) {
                codes.problem("DELEGATION_ALGORITHM_REJECTED", format!("mandate[{}]: classical algorithm {} is rejected by an active advisory", i, classical));
            }
        }
        if !has(&policy.accepted_pq_algs, pq) {
            codes.problem("DELEGATION_ALGORITHM_REJECTED", format!("mandate[{}]: PQ algorithm {} is not accepted by the verifier policy", i, pq));
        }
        if has(&policy.advisory_rejected_algs, pq) {
            codes.problem("DELEGATION_ALGORITHM_REJECTED", format!("mandate[{}]: PQ algorithm {} is rejected by an active advisory", i, pq));
        }
    }

    // ── 8. The root's components, each anchored in the current trust set ──
    if !trust.knows_principal(human_id) {
        codes.problem(
            "TRUST_PRINCIPAL_UNKNOWN",
            format!("mandate[0]: principal {} is not in trust set {}", printable_str(human_id), printable_str(trust.version())),
        );
    } else {
        for name in ["classical", "pq"] {
            let (kid, _) = component(&mandates[0], 0, name);
            let Some(key) = find_key(&human_keys, kid) else { continue }; // the chain verifier reports it
            let alg = key.get("alg").and_then(Value::as_str).unwrap_or_default();
            let pk = key.get("public_key_b64").and_then(Value::as_str).unwrap_or_default();
            if let Some((code, why)) = trust.key_error(human_id, kid, alg, pk, now) {
                codes.problem(code, format!("mandate[0] {} key {} {}", name, kid, why));
            }
        }
    }

    // ── 9. session_nonce: the explicit rule ──
    // A mandate's nonce is its issuance session's; each bundle is an action session. No equality is required
    // between a mandate and any bundle, or between mandates; within each bundle V2-4 applies (step 3).

    // ── 10. Revocation of every subject of the composition ──
    let mut kids: HashSet<String> = used_kids;
    kids.extend(revocation_subjects(leaf_bundle, &leaf.verification).kids);
    for (bundle, admission) in delegator_bundles.iter().zip(&delegators) {
        kids.extend(revocation_subjects(bundle, &admission.verification).kids);
    }
    let mut kids: Vec<String> = kids.into_iter().collect();
    kids.sort();
    snapshot_checks(revocation, &[("agent", "agents", agent_ids.as_slice()), ("key", "keys", kids.as_slice())], max_age, now, &mut codes);
    snapshot_checks(mandate_revocation, &[("mandate", "mandates", mandate_ids.as_slice())], max_age, now, &mut codes);

    // ── 11. Result ──
    let delegation_verified = chain_valid && chain_floor == floor && !codes.problem;
    result.admitted =
        codes.errors.is_empty() && leaf.admitted && delegators.iter().all(|d| d.admitted) && delegation_verified;
    result.delegation_verified = delegation_verified;
    if leaf_verified {
        result.security_tier = Some(leaf.verification.result.resolved_tier.clone());
        result.verification_mode = Some(leaf.verification.result.verification_mode.clone());
    }
    result.chain = Some(DelegatedChain {
        depth: mandates.len() - 1,
        mandate_ids,
        effective_floor: chain_floor.map(str::to_string),
        leaf_authority_scope: mandates[mandates.len() - 1]["authority_scope"].clone(),
    });
    let verified = result.admitted.then(|| {
        // Admitted: the leaf and every delegator verified, so each agent's passport keys are its verified keys.
        let mut keys = agent_keys.clone();
        keys.insert(leaf_agent.to_string(), keys_of(leaf_bundle, "agent_passport", "keys"));
        DelegatedVerified {
            now,
            mandates,
            agent_keys: keys,
            policy: policy.clone(),
            mode: mode.to_string(),
            revocation,
            checked_kids: kids.iter().cloned().collect(),
        }
    });
    result.leaf = Some(leaf);
    result.delegators = delegators;
    result.errors = codes.errors;
    Ok((result, verified))
}

#[cfg(test)]
mod tests {
    //! What needs the crate's internals: the floor step against the public verifier, the contract-checked gate,
    //! and the private tables against their schemas.
    use super::*;
    use crate::v2::verify_bundle::verify_signed_bundle_v2_at;

    fn vectors() -> Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/delegated_admission_vectors.json");
        serde_json::from_str(&std::fs::read_to_string(path).expect("vectors")).expect("json")
    }

    fn schema(name: &str) -> Value {
        let path = format!("{}/../../schemas/v2/{}", env!("CARGO_MANIFEST_DIR"), name);
        serde_json::from_str(&std::fs::read_to_string(path).expect("schema")).expect("json")
    }

    fn now(v: &Value) -> i64 {
        parse_rfc3339_millis(v["now"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn floor_step_rejects_what_the_public_verifier_accepts() {
        let v = vectors();
        let weak: VerifierPolicy = serde_json::from_value(v["policies"]["weak_classical"].clone()).unwrap();
        let bundle = &v["signed_bundles"]["orch_classical_only"];
        let public = verify_signed_bundle_v2_at(bundle, &weak, now(&v));
        assert!(public.result.verified, "{:?}", public.result.errors);
        assert_eq!(public.result.verification_mode, "classical_only");
        let floored = verify_signed_bundle_v2_at_floor(bundle, &weak, now(&v), "dcp-jcs-v1", Some("elevated"), false);
        assert!(!floored.result.verified);
        assert_eq!(floored.result.verification_mode, "hybrid_required");
        assert_eq!(floored.result.resolved_tier, "elevated");
        for (name, b) in v["signed_bundles"].as_object().unwrap() {
            for policy in [VerifierPolicy::default(), weak.clone()] {
                let a = serde_json::to_string(&verify_signed_bundle_v2_at(b, &policy, now(&v))).unwrap();
                let c = serde_json::to_string(&verify_signed_bundle_v2_at_floor(b, &policy, now(&v), "dcp-jcs-v1", None, false)).unwrap();
                assert_eq!(a, c, "{}", name);
            }
        }
    }

    #[test]
    fn public_gate_is_unchanged_and_the_contract_checked_gate_takes_only_contract_values() {
        let v = vectors();
        let preset: VerifierPolicy = serde_json::from_value(v["policies"]["pq_only"].clone()).unwrap();
        let orch = &v["signed_bundles"]["orch"];
        let public = verify_signed_bundle_v2_at(orch, &preset, now(&v));
        assert!(!public.result.verified && public.result.errors.join(" ").contains("does not enforce"));
        let mut reversed = VerifierPolicy::default();
        reversed.accepted_hash_algs = vec!["sha384".into(), "sha256".into()];
        assert!(!verify_signed_bundle_v2_at(orch, &reversed, now(&v)).result.verified);
        let checked = verify_signed_bundle_v2_at_floor(orch, &preset, now(&v), "dcp-jcs-v1", None, true);
        assert!(checked.result.verified && checked.result.verification_mode == "pq_only", "{:?}", checked.result.errors);
        assert!(verify_signed_bundle_v2_at_floor(orch, &reversed, now(&v), "dcp-jcs-v1", None, true).result.verified);
        let mut mixed = preset.clone();
        mixed.risk_overrides.insert("high".into(), "hybrid_required".into());
        assert!(!verify_signed_bundle_v2_at_floor(orch, &mixed, now(&v), "dcp-jcs-v1", None, true).result.verified);
    }

    #[test]
    fn policy_table_matches_the_schema() {
        let s = schema("verifier_policy.schema.json");
        assert_eq!(s["additionalProperties"], Value::Bool(false));
        let mut names: Vec<&str> = POLICY_FIELDS.iter().map(|f| f.name).collect();
        names.sort();
        let mut props: Vec<&str> = s["properties"].as_object().unwrap().keys().map(String::as_str).collect();
        props.sort();
        assert_eq!(names, props);
        let mut required: Vec<&str> = POLICY_REQUIRED.to_vec();
        required.sort();
        let mut schema_required: Vec<&str> = s["required"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
        schema_required.sort();
        assert_eq!(required, schema_required);
        let modes = &s["properties"]["default_mode"]["enum"];
        for f in POLICY_FIELDS {
            let p = &s["properties"][f.name];
            match f.kind {
                "mode" => assert_eq!((&p["type"], &p["enum"]), (&Value::from("string"), modes)),
                "risk_overrides" => {
                    assert_eq!(p["additionalProperties"], Value::Bool(false));
                    assert_eq!(p["required"], serde_json::json!(["low", "medium", "high"]));
                }
                "string_array" => {
                    assert_eq!(p["type"], "array");
                    assert_eq!(p["items"], serde_json::json!({"type": "string"}));
                    assert_eq!(p["minItems"].as_u64().map(|n| n as usize), f.min_items, "{}", f.name);
                }
                kind => {
                    assert_eq!(p["type"], kind, "{}", f.name);
                    assert_eq!(p["minimum"].as_i64(), f.minimum, "{}", f.name);
                }
            }
        }
    }

    #[test]
    fn preflight_tables_match_the_mandate_schema() {
        let s = schema("delegation_mandate.schema.json");
        fn sorted<'a>(mut v: Vec<&'a str>) -> Vec<&'a str> {
            v.sort();
            v
        }
        fn keys(v: &Value) -> Vec<&str> {
            sorted(v.as_object().unwrap().keys().map(String::as_str).collect())
        }
        fn strs(v: &Value) -> Vec<&str> {
            sorted(v.as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect())
        }
        assert_eq!(s["additionalProperties"], Value::Bool(false));
        assert_eq!(sorted(MANDATE_FIELDS.to_vec()), keys(&s["properties"]));
        assert_eq!(sorted(MANDATE_REQUIRED.to_vec()), strs(&s["required"]));
        let scope = &s["properties"]["authority_scope"];
        assert_eq!(scope["minItems"], 1);
        let item = &scope["items"];
        assert_eq!(item["additionalProperties"], Value::Bool(false));
        assert_eq!(sorted(SCOPE_FIELDS.to_vec()), keys(&item["properties"]));
        assert_eq!(sorted(SCOPE_REQUIRED.to_vec()), strs(&item["required"]));
        assert_eq!(item["properties"]["domain"], serde_json::json!({"type": "string", "minLength": 1}));
        let list = serde_json::json!({"type": "array", "items": {"type": "string", "minLength": 1}});
        assert_eq!(item["properties"]["actions_permitted"], list);
        assert_eq!(item["properties"]["data_classes"], list);
        assert_eq!(item["properties"]["limits"], serde_json::json!({"type": "object"})); // open
        let sd = &s["properties"]["sub_delegation"];
        assert_eq!(sd["additionalProperties"], Value::Bool(false));
        assert_eq!(sorted(SUB_DELEGATION_FIELDS.to_vec()), keys(&sd["properties"]));
        assert_eq!(sorted(SUB_DELEGATION_FIELDS.to_vec()), strs(&sd["required"]));
    }
}
