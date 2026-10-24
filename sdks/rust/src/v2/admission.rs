//! Admission of V2 signed bundles: principal trust and the `strict-v1` profile
//! (spec/profiles/admission). Deterministic and offline: the caller supplies the
//! trust set, the revocation snapshot and the clock. Verification itself is
//! [`verify_signed_bundle_v2_at`]'s; admission only reads its result.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fmt;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::v2::crypto_provider::derive_kid;
use crate::v2::lifecycle::unix_now_millis;
use crate::v2::session_nonce::parse_rfc3339_millis;
use crate::v2::types::VerifierPolicy;
use crate::v2::verify_bundle::{
    canonical_b64, verify_signed_bundle_v2_at, SignerKeyUse, V2VerificationResult, SESSION_CLOCK_SKEW_MS,
};

/// The profile identifier.
pub const STRICT_V1: &str = "strict-v1";

/// The longest session and the oldest revocation snapshot `strict-v1` accepts, in seconds.
pub const STRICT_V1_MAX_SECONDS: u64 = 300;

const CONFIG_UNKNOWN_FIELD: &str = "CONFIG_UNKNOWN_FIELD";
const CONFIG_INVALID_VALUE: &str = "CONFIG_INVALID_VALUE";
const CONFIG_PROFILE_CONTRADICTION: &str = "CONFIG_PROFILE_CONTRADICTION";

/// The longest error message, in characters (spec/profiles/admission § 5.3).
const MAX_MESSAGE: usize = 500;

/// A trust set or profile that cannot be loaded, or an admission configuration
/// that contradicts the profile. `code` is one of the `CONFIG_*` codes of
/// spec/profiles/admission § 5.3.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmissionConfigError {
    pub code: &'static str,
    pub message: String,
}

impl fmt::Display for AdmissionConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AdmissionConfigError {}

fn fail<T>(code: &'static str, message: impl Into<String>) -> Result<T, AdmissionConfigError> {
    Err(AdmissionConfigError { code, message: bounded(message.into()) })
}

/// At most [`MAX_MESSAGE`] characters, the last one `…` when the message was cut.
fn bounded(message: String) -> String {
    match message.char_indices().nth(MAX_MESSAGE) {
        None => message,
        Some(_) => {
            let (cut, _) = message.char_indices().nth(MAX_MESSAGE - 1).unwrap_or((0, ' '));
            format!("{}…", &message[..cut])
        }
    }
}

/// A short printable form of an untrusted value: a string quoted and cut at 80
/// characters, the type of an array or object.
fn printable(value: Option<&Value>) -> String {
    match value {
        None => "absent".to_string(),
        Some(Value::String(s)) => match s.char_indices().nth(80) {
            None => Value::String(s.clone()).to_string(),
            Some((cut, _)) => Value::String(format!("{}…", &s[..cut])).to_string(),
        },
        Some(Value::Array(_)) => "an array".to_string(),
        Some(Value::Object(_)) => "an object".to_string(),
        Some(other) => other.to_string(),
    }
}

fn printable_str(value: &str) -> String {
    printable(Some(&Value::String(value.to_string())))
}

fn reject_unknown_fields(value: &Map<String, Value>, allowed: &[&str], at: &str) -> Result<(), AdmissionConfigError> {
    match value.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => fail(CONFIG_UNKNOWN_FIELD, format!("{}: unknown field {}", at, printable_str(key))),
        None => Ok(()),
    }
}

/// The value of a JSON number with an integer value: `300`, `300.0` and `3e2`
/// are integers, `120.5` and `"300"` are not. Values beyond the range of i64
/// saturate, which keeps them outside every bound checked here.
fn integer(value: &Value) -> Option<i64> {
    if let Some(i) = value.as_i64() {
        return Some(i);
    }
    if value.as_u64().is_some() {
        return Some(i64::MAX);
    }
    let f = value.as_f64()?;
    (f.is_finite() && f.fract() == 0.0).then_some(f as i64)
}

fn string_list(value: &Value) -> Option<Vec<String>> {
    value.as_array()?.iter().map(|s| s.as_str().map(str::to_string)).collect()
}

// ── Trust set (§ 2.2) ──

/// The public key sizes of the algorithms a trust set may list.
const KEY_BYTES: [(&str, usize); 3] = [("ed25519", 32), ("ml-dsa-65", 1952), ("slh-dsa-192f", 48)];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyStatus {
    Active,
    Revoked,
    Expired,
}

#[derive(Debug, Clone)]
struct TrustedKey {
    alg: String,
    bytes: Vec<u8>,
    status: KeyStatus,
    not_before: Option<i64>,
    expires_at: Option<i64>,
}

/// A validated principal trust set (schemas/v2/principal_trust_set.schema.json,
/// spec/profiles/admission § 2.2). Load it with [`PrincipalTrustStore::from_json`].
#[derive(Debug, Clone)]
pub struct PrincipalTrustStore {
    version: String,
    /// human_id → kid → trusted key.
    principals: HashMap<String, HashMap<String, TrustedKey>>,
}

/// An optional RFC 3339 instant: None when absent or null, an error for anything else.
fn optional_instant(value: Option<&Value>, at: &str) -> Result<Option<i64>, AdmissionConfigError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_str().and_then(parse_rfc3339_millis) {
            Some(t) => Ok(Some(t)),
            None => fail(CONFIG_INVALID_VALUE, format!("{} is not an RFC 3339 timestamp", at)),
        },
    }
}

impl PrincipalTrustStore {
    /// Validate a trust set and return it as a store. Returns the first problem
    /// found as an [`AdmissionConfigError`].
    pub fn from_json(trust_set: &Value) -> Result<PrincipalTrustStore, AdmissionConfigError> {
        let Some(set) = trust_set.as_object() else {
            return fail(CONFIG_INVALID_VALUE, "the trust set must be an object");
        };
        reject_unknown_fields(set, &["trust_set_version", "principals"], "trust set")?;
        let version = match set.get("trust_set_version") {
            Some(Value::String(version)) if !version.is_empty() => version.clone(),
            _ => return fail(CONFIG_INVALID_VALUE, "trust_set_version must be a non-empty string"),
        };
        let Some(list) = set.get("principals").and_then(Value::as_array) else {
            return fail(CONFIG_INVALID_VALUE, "principals must be an array");
        };

        let mut principals = HashMap::with_capacity(list.len());
        let mut kids = HashSet::new();
        for (i, principal) in list.iter().enumerate() {
            let at = format!("principals[{}]", i);
            let Some(p) = principal.as_object() else {
                return fail(CONFIG_INVALID_VALUE, format!("{} must be an object", at));
            };
            reject_unknown_fields(p, &["human_id", "keys"], &at)?;
            let human_id = match p.get("human_id") {
                Some(Value::String(human_id)) if !human_id.is_empty() => human_id.clone(),
                _ => return fail("CONFIG_TRUST_EMPTY_ID", format!("{}.human_id must be a non-empty string", at)),
            };
            if principals.contains_key(&human_id) {
                return fail(
                    "CONFIG_TRUST_DUPLICATE",
                    format!("{}: human_id {} is listed twice", at, printable_str(&human_id)),
                );
            }
            let key_list = match p.get("keys").and_then(Value::as_array) {
                Some(keys) if !keys.is_empty() => keys,
                _ => return fail(CONFIG_INVALID_VALUE, format!("{}.keys must be a non-empty array", at)),
            };

            let mut keys = HashMap::with_capacity(key_list.len());
            for (j, key) in key_list.iter().enumerate() {
                let at = format!("{}.keys[{}]", at, j);
                let Some(k) = key.as_object() else {
                    return fail(CONFIG_INVALID_VALUE, format!("{} must be an object", at));
                };
                reject_unknown_fields(k, &["kid", "alg", "public_key_b64", "status", "not_before", "expires_at"], &at)?;
                let known =
                    k.get("alg").and_then(Value::as_str).and_then(|alg| KEY_BYTES.iter().find(|(a, _)| *a == alg));
                let Some(&(alg, size)) = known else {
                    return fail(
                        "CONFIG_TRUST_MALFORMED_KEY",
                        format!("{}.alg {} is not ed25519, ml-dsa-65 or slh-dsa-192f", at, printable(k.get("alg"))),
                    );
                };
                let bytes = k.get("public_key_b64").and_then(Value::as_str).and_then(canonical_b64);
                let Some(bytes) = bytes.filter(|bytes| bytes.len() == size) else {
                    return fail(
                        "CONFIG_TRUST_MALFORMED_KEY",
                        format!("{}.public_key_b64 is not a canonical base64 {} public key", at, alg),
                    );
                };
                let kid = match k.get("kid") {
                    Some(Value::String(kid)) if *kid == derive_kid(alg, &bytes) => kid.clone(),
                    other => {
                        return fail(
                            "CONFIG_TRUST_KID_NOT_DERIVED",
                            format!("{}.kid {} is not derived from its key", at, printable(other)),
                        )
                    }
                };
                if kids.contains(&kid) {
                    return fail(
                        "CONFIG_TRUST_DUPLICATE",
                        format!("{}: kid {} is listed twice in the trust set", at, kid),
                    );
                }
                let status = match k.get("status").and_then(Value::as_str) {
                    Some("active") => KeyStatus::Active,
                    Some("revoked") => KeyStatus::Revoked,
                    Some("expired") => KeyStatus::Expired,
                    _ => {
                        return fail(CONFIG_INVALID_VALUE, format!("{}.status must be active, revoked or expired", at))
                    }
                };
                kids.insert(kid.clone());
                let not_before = optional_instant(k.get("not_before"), &format!("{}.not_before", at))?;
                let expires_at = optional_instant(k.get("expires_at"), &format!("{}.expires_at", at))?;
                keys.insert(kid, TrustedKey { alg: alg.to_string(), bytes, status, not_before, expires_at });
            }
            principals.insert(human_id, keys);
        }
        Ok(PrincipalTrustStore { version, principals })
    }

    /// The trust set's `trust_set_version`.
    pub fn version(&self) -> &str {
        &self.version
    }
}

// ── strict-v1 profile (§ 4.1) ──

/// A validated `strict-v1` profile with the verifier policy it enforces. Load
/// it with [`resolve_strict_v1_profile`]; it cannot be changed afterwards.
#[derive(Debug, Clone)]
pub struct StrictV1Profile {
    verifier_id: String,
    max_session_duration_seconds: u64,
    max_revocation_age_seconds: u64,
    policy: VerifierPolicy,
}

impl StrictV1Profile {
    /// Always [`STRICT_V1`].
    pub fn profile(&self) -> &'static str {
        STRICT_V1
    }

    /// The verifier the bundle's signed `intended_verifier` must name.
    pub fn verifier_id(&self) -> &str {
        &self.verifier_id
    }

    /// The effective maximum session duration: the smaller of the profile's
    /// and its `verifier_policy`'s.
    pub fn max_session_duration_seconds(&self) -> u64 {
        self.max_session_duration_seconds
    }

    /// The oldest revocation snapshot admitted, in seconds.
    pub fn max_revocation_age_seconds(&self) -> u64 {
        self.max_revocation_age_seconds
    }

    /// The verifier policy the profile verifies with.
    pub fn policy(&self) -> &VerifierPolicy {
        &self.policy
    }
}

const MODES: [&str; 4] = ["classical_only", "hybrid_preferred", "hybrid_required", "pq_only"];
const ACCEPTED_CLASSICAL_ALGS: [&str; 1] = ["ed25519"];
const ACCEPTED_PQ_ALGS: [&str; 2] = ["ml-dsa-65", "slh-dsa-192f"];
const ACCEPTED_HASH_ALGS: [&str; 2] = ["sha256", "sha384"];

/// The `verifier_policy` fields a profile may set, in the order they are
/// checked (schemas/v2/admission_profile.schema.json).
const POLICY_FIELDS: [&str; 18] = [
    "default_mode",
    "risk_overrides",
    "min_classical",
    "min_pq",
    "accepted_classical_algs",
    "accepted_pq_algs",
    "accepted_hash_algs",
    "require_session_binding",
    "require_composite_binding",
    "require_session_expiry",
    "require_audience_binding",
    "allow_v1_bundles",
    "allow_classical_fallback_disable",
    "warn_classical_only_deprecated",
    "advisory_rejected_algs",
    "max_key_age_days",
    "max_session_duration_seconds",
    "verifier_id",
];

/// A strict-v1 limit in seconds: an integer from 1 to `max`, default `max`.
fn profile_seconds(value: Option<&Value>, field: &str, max: u64) -> Result<u64, AdmissionConfigError> {
    let Some(value) = value else { return Ok(max) };
    let Some(seconds) = integer(value) else {
        return fail(CONFIG_INVALID_VALUE, format!("{} must be an integer", field));
    };
    match u64::try_from(seconds) {
        Ok(seconds) if (1..=max).contains(&seconds) => Ok(seconds),
        _ => fail(CONFIG_PROFILE_CONTRADICTION, format!("{} must be from 1 to {} under strict-v1", field, max)),
    }
}

/// A boolean policy field that only `fixed` keeps the profile's guarantee.
fn fixed_boolean(value: &Value, field: &str, fixed: bool) -> Result<(), AdmissionConfigError> {
    match value.as_bool() {
        None => fail(CONFIG_INVALID_VALUE, format!("verifier_policy.{} must be a boolean", field)),
        Some(v) if v != fixed => {
            fail(CONFIG_PROFILE_CONTRADICTION, format!("strict-v1 requires verifier_policy.{} to be {}", field, fixed))
        }
        Some(_) => Ok(()),
    }
}

fn hybrid_required(value: &Value, field: &str) -> Result<(), AdmissionConfigError> {
    match value.as_str() {
        Some(mode) if !MODES.contains(&mode) => {
            fail(CONFIG_INVALID_VALUE, format!("{} must be a verification mode", field))
        }
        None => fail(CONFIG_INVALID_VALUE, format!("{} must be a verification mode", field)),
        Some("hybrid_required") => Ok(()),
        Some(_) => fail(
            CONFIG_PROFILE_CONTRADICTION,
            format!("strict-v1 requires {} to be hybrid_required (pq_only drops the classical signature)", field),
        ),
    }
}

/// A non-negative integer policy field. The policy holds it as a u32; a larger
/// value saturates, which bounds the same way.
fn non_negative(value: &Value, field: &str) -> Result<u32, AdmissionConfigError> {
    match integer(value) {
        Some(n) if n >= 0 => Ok(u32::try_from(n).unwrap_or(u32::MAX)),
        _ => fail(CONFIG_INVALID_VALUE, format!("verifier_policy.{} must be a non-negative integer", field)),
    }
}

/// Validate a `strict-v1` configuration (schemas/v2/admission_profile.schema.json,
/// spec/profiles/admission § 4.1) and return the profile with the verifier
/// policy it enforces. Returns the first problem found as an
/// [`AdmissionConfigError`]. A `verifier_policy` field outside the schema is
/// reported before any value; the others are checked in the schema's order.
pub fn resolve_strict_v1_profile(config: &Value) -> Result<StrictV1Profile, AdmissionConfigError> {
    let Some(c) = config.as_object() else {
        return fail(CONFIG_INVALID_VALUE, "the profile configuration must be an object");
    };
    reject_unknown_fields(
        c,
        &["profile", "verifier_id", "max_session_duration_seconds", "max_revocation_age_seconds", "verifier_policy"],
        "profile",
    )?;
    if c.get("profile").and_then(Value::as_str) != Some(STRICT_V1) {
        return fail(CONFIG_INVALID_VALUE, format!("profile {} is not \"strict-v1\"", printable(c.get("profile"))));
    }
    let verifier_id = match c.get("verifier_id") {
        None | Some(Value::Null) => return fail(CONFIG_PROFILE_CONTRADICTION, "strict-v1 requires verifier_id"),
        Some(Value::String(id)) if id.is_empty() => {
            return fail(CONFIG_PROFILE_CONTRADICTION, "strict-v1 requires a non-empty verifier_id")
        }
        Some(Value::String(id)) => id.clone(),
        Some(_) => return fail(CONFIG_INVALID_VALUE, "verifier_id must be a string"),
    };
    let mut max_session =
        profile_seconds(c.get("max_session_duration_seconds"), "max_session_duration_seconds", STRICT_V1_MAX_SECONDS)?;
    let max_revocation =
        profile_seconds(c.get("max_revocation_age_seconds"), "max_revocation_age_seconds", STRICT_V1_MAX_SECONDS)?;

    let owned = |algs: &[&str]| algs.iter().map(|alg| alg.to_string()).collect::<Vec<_>>();
    let mut policy = VerifierPolicy {
        default_mode: "hybrid_required".into(),
        risk_overrides: ["low", "medium", "high"]
            .iter()
            .map(|tier| (tier.to_string(), "hybrid_required".into()))
            .collect(),
        min_classical: 1,
        min_pq: 1,
        accepted_classical_algs: owned(&ACCEPTED_CLASSICAL_ALGS),
        accepted_pq_algs: owned(&ACCEPTED_PQ_ALGS),
        accepted_hash_algs: owned(&ACCEPTED_HASH_ALGS),
        require_session_binding: true,
        require_composite_binding: true,
        allow_v1_bundles: false,
        allow_classical_fallback_disable: false,
        warn_classical_only_deprecated: false,
        advisory_rejected_algs: Vec::new(),
        require_session_expiry: true,
        require_audience_binding: true,
        verifier_id: Some(verifier_id.clone()),
        ..VerifierPolicy::default()
    };

    if let Some(overrides) = c.get("verifier_policy") {
        let Some(overrides) = overrides.as_object() else {
            return fail(CONFIG_INVALID_VALUE, "verifier_policy must be an object");
        };
        reject_unknown_fields(overrides, &POLICY_FIELDS, "verifier_policy")?;
        for field in POLICY_FIELDS {
            let Some(value) = overrides.get(field) else { continue };
            match field {
                "require_session_binding"
                | "require_composite_binding"
                | "require_session_expiry"
                | "require_audience_binding" => fixed_boolean(value, field, true)?,
                "allow_v1_bundles" | "allow_classical_fallback_disable" => fixed_boolean(value, field, false)?,
                "default_mode" => hybrid_required(value, "verifier_policy.default_mode")?,
                "risk_overrides" => {
                    let Some(tiers) = value.as_object() else {
                        return fail(CONFIG_INVALID_VALUE, "verifier_policy.risk_overrides must be an object");
                    };
                    reject_unknown_fields(tiers, &["low", "medium", "high"], "verifier_policy.risk_overrides")?;
                    for tier in ["low", "medium", "high"] {
                        if let Some(mode) = tiers.get(tier) {
                            hybrid_required(mode, &format!("verifier_policy.risk_overrides.{}", tier))?;
                        }
                    }
                }
                "min_classical" | "min_pq" => {
                    let n = non_negative(value, field)?;
                    if n < 1 {
                        return fail(
                            CONFIG_PROFILE_CONTRADICTION,
                            format!("strict-v1 requires verifier_policy.{} of at least 1", field),
                        );
                    }
                    if field == "min_classical" {
                        policy.min_classical = n;
                    } else {
                        policy.min_pq = n;
                    }
                }
                "accepted_classical_algs" | "accepted_pq_algs" | "accepted_hash_algs" => {
                    let Some(algs) = string_list(value) else {
                        return fail(
                            CONFIG_INVALID_VALUE,
                            format!("verifier_policy.{} must be a list of strings", field),
                        );
                    };
                    let (allowed, slot): (&[&str], &mut Vec<String>) = match field {
                        "accepted_classical_algs" => (&ACCEPTED_CLASSICAL_ALGS, &mut policy.accepted_classical_algs),
                        "accepted_pq_algs" => (&ACCEPTED_PQ_ALGS, &mut policy.accepted_pq_algs),
                        _ => (&ACCEPTED_HASH_ALGS, &mut policy.accepted_hash_algs),
                    };
                    if algs.is_empty() || algs.iter().any(|alg| !allowed.contains(&alg.as_str())) {
                        return fail(
                            CONFIG_PROFILE_CONTRADICTION,
                            format!(
                                "strict-v1 requires verifier_policy.{} to be a non-empty subset of {}",
                                field,
                                allowed.join(", ")
                            ),
                        );
                    }
                    *slot = algs;
                }
                "advisory_rejected_algs" => match string_list(value) {
                    Some(algs) => policy.advisory_rejected_algs = algs,
                    None => {
                        return fail(
                            CONFIG_INVALID_VALUE,
                            "verifier_policy.advisory_rejected_algs must be a list of strings",
                        )
                    }
                },
                "max_key_age_days" => policy.max_key_age_days = non_negative(value, field)?,
                "warn_classical_only_deprecated" => match value.as_bool() {
                    Some(warn) => policy.warn_classical_only_deprecated = warn,
                    None => {
                        return fail(
                            CONFIG_INVALID_VALUE,
                            "verifier_policy.warn_classical_only_deprecated must be a boolean",
                        )
                    }
                },
                "max_session_duration_seconds" => {
                    let Some(seconds) = integer(value) else {
                        return fail(
                            CONFIG_INVALID_VALUE,
                            "verifier_policy.max_session_duration_seconds must be an integer",
                        );
                    };
                    match u64::try_from(seconds) {
                        Ok(seconds) if (1..=max_session).contains(&seconds) => max_session = seconds,
                        _ => {
                            return fail(
                                CONFIG_PROFILE_CONTRADICTION,
                                format!(
                                    "verifier_policy.max_session_duration_seconds must be from 1 to {} under strict-v1",
                                    max_session
                                ),
                            )
                        }
                    }
                }
                "verifier_id" => match value.as_str() {
                    None => return fail(CONFIG_INVALID_VALUE, "verifier_policy.verifier_id must be a string"),
                    Some(id) if id != verifier_id => {
                        return fail(
                            CONFIG_PROFILE_CONTRADICTION,
                            "verifier_policy.verifier_id differs from the profile verifier_id",
                        )
                    }
                    Some(_) => {}
                },
                // A field listed above without a rule is refused, never ignored.
                other => {
                    return fail(CONFIG_UNKNOWN_FIELD, format!("verifier_policy: unknown field {}", printable_str(other)))
                }
            }
        }
    }
    policy.max_session_duration_seconds = Some(max_session);

    Ok(StrictV1Profile {
        verifier_id,
        max_session_duration_seconds: max_session,
        max_revocation_age_seconds: max_revocation,
        policy,
    })
}

// ── Revocation (§ 2.4, § 4.3) ──

/// What a revocation source must answer for (§ 2.4).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct RevocationSubjects {
    /// The passport `agent_id`, when it is a string.
    pub agent_ids: Vec<String>,
    /// The kid of every signer key that verified, all signatures included, sorted.
    pub kids: Vec<String>,
}

/// The principal signatures (§ 2.3).
const PRINCIPAL_SIGNATURES: [&str; 2] = ["bundle", "responsible_principal_record"];

/// A field of an artifact's payload, when the artifact and its payload are objects.
fn payload_field<'a>(bundle: Option<&'a Value>, artifact: &str, field: &str) -> Option<&'a Value> {
    bundle?.get(artifact)?.get("payload")?.as_object()?.get(field)
}

/// The bundle of a signed bundle, when both are objects.
fn bundle_of(signed_bundle: &Value) -> Option<&Value> {
    signed_bundle.get("bundle").filter(|bundle| bundle.is_object())
}

/// The revocation subjects of a bundle (§ 2.4): the passport `agent_id` and
/// the kid of every signer key that verified, sorted.
pub fn revocation_subjects(signed_bundle: &Value, verification: &V2VerificationResult) -> RevocationSubjects {
    let agent_id = payload_field(bundle_of(signed_bundle), "agent_passport", "agent_id").and_then(Value::as_str);
    let kids: BTreeSet<&str> = verification.signer_keys.iter().filter(|k| k.verified).map(|k| k.kid.as_str()).collect();
    RevocationSubjects {
        agent_ids: agent_id.map(|id| vec![id.to_string()]).unwrap_or_default(),
        kids: kids.into_iter().map(str::to_string).collect(),
    }
}

/// The `checked_at` of a snapshot within schemas/v2/revocation_snapshot.schema.json, or None.
fn snapshot_checked_at(snapshot: &Value) -> Option<i64> {
    let s = snapshot.as_object()?;
    if s.keys().any(|k| !matches!(k.as_str(), "checked_at" | "agents" | "keys")) {
        return None;
    }
    let checked_at = s.get("checked_at")?.as_str().and_then(parse_rfc3339_millis)?;
    let statuses = |map: Option<&Value>| {
        map.and_then(Value::as_object).is_some_and(|map| {
            map.values().all(|status| matches!(status.as_str(), Some("revoked" | "not_revoked" | "unknown")))
        })
    };
    (statuses(s.get("agents")) && statuses(s.get("keys"))).then_some(checked_at)
}

// ── Admission (§ 5) ──

/// Whether the principal is one the operator trusts (§ 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalTrust {
    Trusted,
    Untrusted,
    /// No trust set, or the bundle did not verify.
    NotEvaluated,
}

/// Whether the bundle meets the profile (§ 5.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileCompliance {
    Compliant,
    NonCompliant,
    /// No profile.
    NotEvaluated,
}

/// One admission code (§ 5.3) with a bounded message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AdmissionError {
    pub code: &'static str,
    pub message: String,
}

/// The admission result (§ 5.2). Serializes with the field names of the spec.
#[derive(Debug, Clone, Serialize)]
pub struct AdmissionResult {
    /// The verifier's verdict, with its meaning unchanged.
    pub verified: bool,
    /// The verifier's full result.
    pub verification: V2VerificationResult,
    pub principal_trust: PrincipalTrust,
    /// [`STRICT_V1`], or None without a profile.
    pub profile: Option<&'static str>,
    pub profile_compliance: ProfileCompliance,
    /// The bundle is admitted as evidence under this configuration.
    pub admitted: bool,
    /// Always false: admission does not authorize an action (§ 7).
    pub action_authorized: bool,
    /// The policy decision's `decision` (approve, escalate, block) of a verified bundle.
    pub recorded_decision: Option<String>,
    pub trust_set_version: Option<String>,
    /// Every code added, in the order of § 5.1.
    pub errors: Vec<AdmissionError>,
}

/// What [`evaluate_admission_v2`] evaluates a verification result with.
#[derive(Debug, Clone, Copy)]
pub struct AdmissionOptions<'a> {
    /// A `strict-v1` profile. It requires `trust`.
    pub profile: Option<&'a StrictV1Profile>,
    pub trust: Option<&'a PrincipalTrustStore>,
    /// The revocation snapshot, evaluated under a profile only. None or
    /// `Value::Null`: the source could not answer.
    pub revocation: Option<&'a Value>,
    /// The instant every time check uses, in milliseconds since the Unix epoch.
    pub now_ms: i64,
}

/// What [`admit_signed_bundle_v2`] verifies and evaluates a bundle with.
#[derive(Debug, Clone, Default)]
pub struct AdmitOptions<'a> {
    /// A `strict-v1` profile: it sets the verifier policy, and requires `trust`.
    pub profile: Option<&'a StrictV1Profile>,
    /// The verifier policy without a profile; default [`VerifierPolicy::default`].
    pub policy: Option<VerifierPolicy>,
    pub trust: Option<&'a PrincipalTrustStore>,
    /// The revocation snapshot, evaluated under a profile only. None or
    /// `Value::Null`: the source could not answer.
    pub revocation: Option<&'a Value>,
    /// Milliseconds since the Unix epoch; default the system clock.
    pub now_ms: Option<i64>,
}

#[derive(Default)]
struct Codes(Vec<AdmissionError>);

impl Codes {
    fn add(&mut self, code: &'static str, message: impl Into<String>) {
        self.0.push(AdmissionError { code, message: bounded(message.into()) });
    }
}

/// P2 and P3: the signed audience and session window.
fn session_checks(manifest: Option<&Value>, profile: &StrictV1Profile, now: i64, codes: &mut Codes) {
    let field = |key: &str| manifest.and_then(|m| m.get(key));
    match field("intended_verifier").and_then(Value::as_str).filter(|audience| !audience.is_empty()) {
        None => codes.add("PROFILE_AUDIENCE_MISSING", "the signed manifest has no intended_verifier"),
        Some(audience) if audience != profile.verifier_id => codes.add(
            "PROFILE_AUDIENCE_MISMATCH",
            format!("the bundle is intended for verifier {}, not this one", printable_str(audience)),
        ),
        Some(_) => {}
    }

    let issued_raw = field("session_issued_at").filter(|v| !v.is_null());
    let expires_raw = field("session_expires_at").filter(|v| !v.is_null());
    if issued_raw.is_none() {
        codes.add("PROFILE_SESSION_START_MISSING", "the signed manifest has no session_issued_at");
    }
    if expires_raw.is_none() {
        codes.add("PROFILE_SESSION_EXPIRY_MISSING", "the signed manifest has no session_expires_at");
    }
    let issued = issued_raw.map(|raw| raw.as_str().and_then(parse_rfc3339_millis));
    let expires = expires_raw.map(|raw| raw.as_str().and_then(parse_rfc3339_millis));
    if matches!(issued, Some(None)) || matches!(expires, Some(None)) {
        codes.add(
            "PROFILE_SESSION_TIME_INVALID",
            "session_issued_at or session_expires_at is not an RFC 3339 timestamp",
        );
        return;
    }
    let (Some(Some(issued)), Some(Some(expires))) = (issued, expires) else { return };
    if issued > expires {
        codes.add("PROFILE_SESSION_TIME_INVALID", "session_issued_at is after session_expires_at");
        return;
    }
    if issued > now.saturating_add(SESSION_CLOCK_SKEW_MS) {
        codes.add("PROFILE_SESSION_NOT_STARTED", "session_issued_at is in the future");
    }
    if expires < now {
        codes.add("PROFILE_SESSION_EXPIRED", "the session has expired");
    }
    let duration_ms = i128::from(expires) - i128::from(issued);
    let max = profile.max_session_duration_seconds;
    if duration_ms > i128::from(max) * 1000 {
        codes.add(
            "PROFILE_SESSION_TOO_LONG",
            format!("the session lasts {} s, more than {} s", duration_ms as f64 / 1000.0, max),
        );
    }
}

/// P4, structural part: both principal signatures declare a hybrid signature.
fn hybrid_declared(signed_bundle: &Value, bundle: Option<&Value>, codes: &mut Codes) {
    let signatures = [
        ("bundle", signed_bundle.get("signature").and_then(|s| s.get("composite_sig"))),
        (
            "responsible_principal_record",
            bundle.and_then(|b| b.get("responsible_principal_record")).and_then(|r| r.get("composite_sig")),
        ),
    ];
    for (name, sig) in signatures {
        let hybrid = sig.and_then(Value::as_object).is_some_and(|sig| {
            sig.get("binding").and_then(Value::as_str) == Some("pq_over_classical")
                && sig.get("pq").is_some_and(Value::is_object)
        });
        if !hybrid {
            codes.add(
                "PROFILE_HYBRID_REQUIRED",
                format!("the {} signature is not a hybrid (pq_over_classical) signature", name),
            );
        }
    }
}

/// P4, after verification: both components of both principal signatures
/// verified, in hybrid_required.
fn hybrid_verified(verification: &V2VerificationResult, codes: &mut Codes) {
    if verification.verification_mode != "hybrid_required" {
        let mode = if verification.verification_mode.is_empty() { "no mode" } else { &verification.verification_mode };
        codes.add("PROFILE_HYBRID_REQUIRED", format!("the bundle was verified in {}, not hybrid_required", mode));
    }
    for signature in PRINCIPAL_SIGNATURES {
        for component in ["classical", "pq"] {
            let verified = verification
                .signer_keys
                .iter()
                .any(|k| k.signature == signature && k.component == component && k.verified);
            if !verified {
                codes.add(
                    "PROFILE_HYBRID_REQUIRED",
                    format!("the {} signature has no verified {} component", signature, component),
                );
            }
        }
    }
}

/// § 3: whether every verified component of the principal signatures is a
/// trusted key of the principal.
fn principal_trust(
    bundle: Option<&Value>,
    verification: &V2VerificationResult,
    store: &PrincipalTrustStore,
    now: i64,
    codes: &mut Codes,
) -> bool {
    let human_id = payload_field(bundle, "responsible_principal_record", "human_id");
    let Some(trusted) = human_id.and_then(Value::as_str).and_then(|id| store.principals.get(id)) else {
        codes.add(
            "TRUST_PRINCIPAL_UNKNOWN",
            format!("principal {} is not in trust set {}", printable(human_id), printable_str(&store.version)),
        );
        return false;
    };
    let uses: Vec<&SignerKeyUse> = verification
        .signer_keys
        .iter()
        .filter(|k| PRINCIPAL_SIGNATURES.contains(&k.signature.as_str()) && k.verified)
        .collect();
    let mut ok = true;
    if uses.is_empty() {
        codes.add("TRUST_KEY_NOT_ANCHORED", "no principal signature component verified");
        ok = false;
    }
    for used in uses {
        let at = format!("{} {} key {}", used.signature, used.component, used.kid);
        let key = trusted.get(&used.kid);
        let bytes = canonical_b64(&used.public_key_b64);
        let rejection = match key {
            Some(key) if key.alg == used.alg && bytes.as_deref() == Some(key.bytes.as_slice()) => {
                if key.status == KeyStatus::Revoked {
                    Some(("TRUST_KEY_REVOKED", "is revoked in the trust set"))
                } else if key.status == KeyStatus::Expired || key.expires_at.is_some_and(|t| t < now) {
                    Some(("TRUST_KEY_EXPIRED", "has expired in the trust set"))
                } else if key.not_before.is_some_and(|t| t > now) {
                    Some(("TRUST_KEY_NOT_YET_VALID", "is not valid yet in the trust set"))
                } else {
                    None
                }
            }
            _ => Some(("TRUST_KEY_NOT_ANCHORED", "is not a trusted key of the principal")),
        };
        if let Some((code, why)) = rejection {
            codes.add(code, format!("{} {}", at, why));
            ok = false;
        }
    }
    ok
}

/// § 4.3.
fn revocation_checks(
    subjects: &RevocationSubjects,
    snapshot: Option<&Value>,
    profile: &StrictV1Profile,
    now: i64,
    codes: &mut Codes,
) {
    let Some(snapshot) = snapshot.filter(|s| !s.is_null()) else {
        codes.add("REVOCATION_UNAVAILABLE", "no revocation status could be obtained");
        return;
    };
    let Some(checked_at) = snapshot_checked_at(snapshot) else {
        codes.add("REVOCATION_INVALID", "the revocation snapshot is malformed");
        return;
    };
    if checked_at > now.saturating_add(SESSION_CLOCK_SKEW_MS) {
        codes.add("REVOCATION_INVALID", "the revocation snapshot is dated in the future");
        return;
    }
    let max = profile.max_revocation_age_seconds;
    if i128::from(now) - i128::from(checked_at) > i128::from(max) * 1000 {
        codes.add("REVOCATION_STALE", format!("the revocation snapshot is older than {} s", max));
    }
    for (kind, ids, map) in [("agent", &subjects.agent_ids, "agents"), ("key", &subjects.kids, "keys")] {
        for id in ids {
            match snapshot.get(map).and_then(|m| m.get(id)).and_then(Value::as_str) {
                Some("revoked") => {
                    codes.add("REVOCATION_REVOKED", format!("{} {} is revoked", kind, printable_str(id)))
                }
                Some("not_revoked") => {}
                _ => codes.add(
                    "REVOCATION_UNKNOWN",
                    format!("the revocation status of {} {} is unknown", kind, printable_str(id)),
                ),
            }
        }
    }
}

/// § 5: admit a bundle given [`verify_signed_bundle_v2_at`]'s result for it
/// at `options.now_ms` (under the profile's policy when there is one). No
/// cryptography and no I/O. A profile without a trust set is a configuration
/// error (`CONFIG_PROFILE_CONTRADICTION`).
pub fn evaluate_admission_v2(
    signed_bundle: &Value,
    verification: &V2VerificationResult,
    options: &AdmissionOptions<'_>,
) -> Result<AdmissionResult, AdmissionConfigError> {
    evaluate(signed_bundle, verification.clone(), options)
}

fn evaluate(
    signed_bundle: &Value,
    verification: V2VerificationResult,
    options: &AdmissionOptions<'_>,
) -> Result<AdmissionResult, AdmissionConfigError> {
    let AdmissionOptions { profile, trust, revocation, now_ms: now } = *options;
    if profile.is_some() && trust.is_none() {
        return fail(CONFIG_PROFILE_CONTRADICTION, "strict-v1 requires a trust set");
    }
    let mut codes = Codes::default();
    let bundle = bundle_of(signed_bundle);
    let mut result = AdmissionResult {
        verified: false,
        verification,
        principal_trust: PrincipalTrust::NotEvaluated,
        profile: profile.map(|_| STRICT_V1),
        profile_compliance: ProfileCompliance::NonCompliant,
        admitted: false,
        action_authorized: false,
        recorded_decision: None,
        trust_set_version: trust.map(|t| t.version.clone()),
        errors: Vec::new(),
    };

    // P1: nothing else is evaluated.
    if profile.is_some() && bundle.and_then(|b| b.get("dcp_bundle_version")).and_then(Value::as_str) != Some("2.0") {
        codes.add("PROFILE_V2_REQUIRED", "strict-v1 admits V2 bundles only");
        result.errors = codes.0;
        return Ok(result);
    }

    if let Some(profile) = profile {
        session_checks(bundle.and_then(|b| b.get("manifest")).filter(|m| m.is_object()), profile, now, &mut codes);
        hybrid_declared(signed_bundle, bundle, &mut codes);
    }
    let verified = result.verification.verified;
    if !verified {
        let reasons = result.verification.errors.iter().take(3).cloned().collect::<Vec<_>>().join("; ");
        let message = if reasons.is_empty() {
            "the bundle did not verify".to_string()
        } else {
            format!("the bundle did not verify: {}", reasons)
        };
        codes.add("VERIFICATION_FAILED", message);
    }
    if let (Some(store), true) = (trust, verified) {
        result.principal_trust = if principal_trust(bundle, &result.verification, store, now, &mut codes) {
            PrincipalTrust::Trusted
        } else {
            PrincipalTrust::Untrusted
        };
    }
    if let (Some(profile), true) = (profile, verified) {
        hybrid_verified(&result.verification, &mut codes);
        let subjects = revocation_subjects(signed_bundle, &result.verification);
        revocation_checks(&subjects, revocation, profile, now, &mut codes);
    }

    let profile_failed = codes.0.iter().any(|e| e.code.starts_with("PROFILE_") || e.code.starts_with("REVOCATION_"));
    result.profile_compliance = match profile {
        None => ProfileCompliance::NotEvaluated,
        Some(_) if verified && !profile_failed => ProfileCompliance::Compliant,
        Some(_) => ProfileCompliance::NonCompliant,
    };
    result.verified = verified;
    result.admitted = verified
        && (trust.is_none() || result.principal_trust == PrincipalTrust::Trusted)
        && (profile.is_none() || result.profile_compliance == ProfileCompliance::Compliant);
    result.recorded_decision = payload_field(bundle, "policy_decision", "decision")
        .and_then(Value::as_str)
        .filter(|_| verified)
        .map(str::to_string);
    result.errors = codes.0;
    Ok(result)
}

/// Verify a signed bundle at `options.now_ms` (the system clock by default),
/// under the profile's policy when there is one, and evaluate its admission
/// (§ 5.1). A non-V2 bundle under a profile is not verified at all (P1). A
/// profile with a caller policy, or without a trust set, is a configuration
/// error (`CONFIG_PROFILE_CONTRADICTION`).
pub fn admit_signed_bundle_v2(
    signed_bundle: &Value,
    options: &AdmitOptions<'_>,
) -> Result<AdmissionResult, AdmissionConfigError> {
    let now = options.now_ms.unwrap_or_else(|| unix_now_millis() as i64);
    let profile = options.profile;
    if profile.is_some() && options.policy.is_some() {
        return fail(CONFIG_PROFILE_CONTRADICTION, "a strict-v1 profile sets its own verifier policy; do not pass one");
    }
    if profile.is_some() && options.trust.is_none() {
        return fail(CONFIG_PROFILE_CONTRADICTION, "strict-v1 requires a trust set");
    }
    let is_v2 =
        bundle_of(signed_bundle).and_then(|b| b.get("dcp_bundle_version")).and_then(Value::as_str) == Some("2.0");
    let default_policy = VerifierPolicy::default();
    let verification = match profile {
        Some(_) if !is_v2 => V2VerificationResult {
            dcp_version: "2.0".into(),
            errors: vec!["strict-v1 admits V2 bundles only".into()],
            ..Default::default()
        },
        Some(profile) => verify_signed_bundle_v2_at(signed_bundle, &profile.policy, now),
        None => verify_signed_bundle_v2_at(signed_bundle, options.policy.as_ref().unwrap_or(&default_policy), now),
    };
    evaluate(
        signed_bundle,
        verification,
        &AdmissionOptions { profile, trust: options.trust, revocation: options.revocation, now_ms: now },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn messages_are_bounded() {
        assert_eq!(bounded("short".into()), "short");
        let exact = "é".repeat(MAX_MESSAGE);
        assert_eq!(bounded(exact.clone()), exact);
        let cut = bounded("é".repeat(MAX_MESSAGE + 1));
        assert_eq!(cut.chars().count(), MAX_MESSAGE);
        assert!(cut.ends_with('…'));
        assert_eq!(printable(Some(&json!("a".repeat(81)))), format!("\"{}…\"", "a".repeat(80)));
        assert_eq!(printable(Some(&json!([1]))), "an array");
        assert_eq!(printable(None), "absent");
    }

    #[test]
    fn integers_are_numbers_with_an_integer_value() {
        for (value, want) in [
            (json!(300), Some(300)),
            (json!(300.0), Some(300)),
            (serde_json::from_str::<Value>("1e2").unwrap(), Some(100)),
            (json!(-1), Some(-1)),
            (json!(u64::MAX), Some(i64::MAX)),
            (json!(120.5), None),
            (json!("300"), None),
            (Value::Null, None),
        ] {
            assert_eq!(integer(&value), want, "{value}");
        }
    }
}
