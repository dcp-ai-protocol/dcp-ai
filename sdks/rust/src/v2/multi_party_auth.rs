//! Multi-party authorization: the structural check, and the opt-in mpa-v1 profile
//! (spec/profiles/multi-party).
//!
//! Three layers, each with its own answer:
//!
//! - structure: [`check_multi_party_authorization_structure`]. Is the record well formed? It
//!   verifies no signature.
//! - verification: which parties signed exactly this request, with the keys the operator trusts
//!   for them.
//! - authorization: whether those parties are enough for this operation on this target, for this
//!   verifier, now.
//!
//! [`evaluate_multi_party_authorization`] gives the last two; only it produces `authorized`.
//!
//! Each party signs {operation, operation_payload, party_id, role} under
//! DCP-AI.v2.MultiPartyAuth, as in v2.0. Under mpa-v1 the operation_payload is
//! {request, parameters}, so the target, the audience and the validity window are signed too. Who
//! the parties of a target are, their roles and the threshold come from the operator's policy set;
//! their keys come from the operator's principal trust set. Nothing in the record stands for
//! either.
//!
//! Deterministic and offline. It keeps no state: evaluating a request does not consume it (single
//! use is the executor's, which must consume request_id and execute atomically).

use std::collections::{HashMap, HashSet};
use std::fmt;

use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::v2::admission::{integer, printable, printable_str, PrincipalTrustStore, TrustedKeyState};
use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, composite_verify, CompositeKeyInfo};
use crate::v2::composite_sig::{CompositeSignature, SignatureEntry};
use crate::v2::crypto_provider::CryptoProvider;
use crate::v2::domain_separation::CTX_MULTI_PARTY_AUTH;
use crate::v2::session_nonce::{parse_rfc3339_millis, rfc3339_from_millis};
use crate::v2::verify_bundle::{provider_for_alg, SESSION_CLOCK_SKEW_MS};

/// The profile identifier.
pub const MPA_V1: &str = "mpa-v1";
/// The most authorizations a record may carry under the profile.
pub const MPA_V1_MAX_AUTHORIZATIONS: usize = 16;
/// The longest validity window an operator may allow, in seconds.
pub const MPA_V1_MAX_VALIDITY_SECONDS: u64 = 86_400;

const MAX_REQUEST_ID: usize = 128;
const MAX_IDENTIFIER: usize = 256;
const MAX_MESSAGE: usize = 300;
const OPERATIONS: [&str; 4] = ["revoke_agent", "rotate_org_key", "change_jurisdiction", "modify_recovery_config"];
const ROLES: [&str; 3] = ["owner", "org_admin", "recovery_contact"];
// The slots of a hybrid signature, as the default verifier policy has them.
const CLASSICAL_ALGS: [&str; 1] = ["ed25519"];
const PQ_ALGS: [&str; 2] = ["ml-dsa-65", "slh-dsa-192f"];

// ── Structure: the shape, and nothing else ──

/// The shape policy of [`check_multi_party_authorization_structure`]. Not the operator's policy
/// set: that is [`MultiPartyPolicyStore`].
#[derive(Debug, Clone)]
pub struct MultiPartyPolicy {
    pub required_parties: usize,
    pub allowed_roles: Vec<String>,
    pub require_owner: bool,
}

impl MultiPartyPolicy {
    pub fn default_for(op: &str) -> Option<Self> {
        match op {
            "revoke_agent" => Some(Self {
                required_parties: 2,
                allowed_roles: vec!["owner".into(), "org_admin".into(), "recovery_contact".into()],
                require_owner: true,
            }),
            "rotate_org_key" | "change_jurisdiction" => Some(Self {
                required_parties: 2,
                allowed_roles: vec!["owner".into(), "org_admin".into()],
                require_owner: true,
            }),
            "modify_recovery_config" => Some(Self {
                required_parties: 2,
                allowed_roles: vec!["owner".into(), "org_admin".into(), "recovery_contact".into()],
                require_owner: true,
            }),
            _ => None,
        }
    }
}

/// The outcome of [`check_multi_party_authorization_structure`].
#[derive(Debug, Clone)]
pub struct MpaCheck {
    pub valid: bool,
    pub errors: Vec<String>,
}

/// Check the shape of a record: how many authorizations it lists, with which roles, and that each
/// carries a composite_sig.
///
/// It verifies no signature, knows no party and reads no operator policy, so `valid` says nothing
/// about who signed or whether the operation is authorized: for that,
/// [`evaluate_multi_party_authorization`].
pub fn check_multi_party_authorization_structure(mpa: &Value, policy: Option<&MultiPartyPolicy>) -> MpaCheck {
    let op = mpa.get("operation").and_then(Value::as_str).unwrap_or("");
    let owned_policy: Option<MultiPartyPolicy>;
    let effective: Option<&MultiPartyPolicy> = match policy {
        Some(p) => Some(p),
        None => {
            owned_policy = MultiPartyPolicy::default_for(op);
            owned_policy.as_ref()
        }
    };
    let Some(p) = effective else {
        return MpaCheck {
            valid: false,
            errors: vec![format!("No policy defined for operation: {op}")],
        };
    };

    let auths = mpa
        .get("authorizations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut errors = Vec::new();
    if auths.len() < p.required_parties {
        errors.push(format!(
            "Insufficient authorizations: {} < {}",
            auths.len(),
            p.required_parties
        ));
    }
    if p.require_owner {
        let has_owner = auths
            .iter()
            .any(|a| a.get("role").and_then(Value::as_str) == Some("owner"));
        if !has_owner {
            errors.push("Owner authorization required but not present".into());
        }
    }
    for auth in &auths {
        let role = auth.get("role").and_then(Value::as_str).unwrap_or("").to_string();
        if !p.allowed_roles.iter().any(|r| r == &role) {
            errors.push(format!("Role {role} not allowed for operation {op}"));
        }
        let party_id = auth
            .get("party_id")
            .and_then(Value::as_str)
            .unwrap_or("<unknown>");
        if auth.get("composite_sig").map(Value::is_null).unwrap_or(true) {
            errors.push(format!("Missing composite_sig for party {party_id}"));
        }
    }

    MpaCheck {
        valid: errors.is_empty(),
        errors,
    }
}

/// The former name of [`check_multi_party_authorization_structure`], with the same result.
#[deprecated(
    note = "it verifies no signature and authorizes nothing: it checks the shape of the record. Use check_multi_party_authorization_structure for that, and evaluate_multi_party_authorization for the decision"
)]
pub fn verify_multi_party_authorization(mpa: &Value, policy: Option<&MultiPartyPolicy>) -> MpaCheck {
    check_multi_party_authorization_structure(mpa, policy)
}

// ── Configuration errors and small helpers ──

/// A policy set, or what the executor states, that cannot be used. `code` is one of the CONFIG_*
/// codes of spec/profiles/multi-party § 5.3.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultiPartyConfigError {
    pub code: &'static str,
    pub message: String,
}

impl fmt::Display for MultiPartyConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for MultiPartyConfigError {}

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

fn fail<T>(code: &'static str, message: impl Into<String>) -> Result<T, MultiPartyConfigError> {
    Err(MultiPartyConfigError { code, message: bounded(message.into()) })
}

const INVALID: &str = "CONFIG_INVALID_VALUE";

/// A string of 1 to `max` Unicode code points.
fn bounded_str(value: Option<&Value>, max: usize) -> Option<&str> {
    let s = value?.as_str()?;
    (!s.is_empty() && s.len() <= 4 * max && s.chars().count() <= max).then_some(s)
}

/// Whether `m` has exactly these members.
fn exactly(m: &Map<String, Value>, members: &[&str]) -> bool {
    m.len() == members.len() && members.iter().all(|k| m.contains_key(*k))
}

fn unknown_field(m: &Map<String, Value>, allowed: &[&str], at: &str) -> Result<(), MultiPartyConfigError> {
    match m.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => fail("CONFIG_UNKNOWN_FIELD", format!("{at}: unknown field {}", printable_str(key))),
        None => Ok(()),
    }
}

// ── Operator policy (§ 2.3) ──

/// What the operator asks of one operation on one target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultiPartyOperationRule {
    pub required_parties: usize,
    pub allowed_roles: Vec<String>,
    pub required_roles: Vec<String>,
}

#[derive(Debug, Clone)]
struct Subject {
    /// party_id → the role the operator gives it on this target.
    parties: HashMap<String, String>,
    operations: HashMap<String, MultiPartyOperationRule>,
}

/// A validated policy set (schemas/v2/multi_party_policy_set.schema.json, spec/profiles/multi-party
/// § 2.3). Load it with [`MultiPartyPolicyStore::from_json`]; it cannot be changed afterwards.
#[derive(Debug, Clone)]
pub struct MultiPartyPolicyStore {
    version: String,
    audience: String,
    max_validity_seconds: u64,
    /// target → its parties and the operations they may authorize.
    subjects: HashMap<String, Subject>,
}

fn role_list(value: Option<&Value>, at: &str) -> Result<Vec<String>, MultiPartyConfigError> {
    let mut roles: Vec<String> = Vec::new();
    let listed = value.and_then(Value::as_array).is_some_and(|items| {
        items.iter().all(|item| match item.as_str() {
            Some(role) if ROLES.contains(&role) && !roles.iter().any(|r| r == role) => {
                roles.push(role.to_string());
                true
            }
            _ => false,
        })
    });
    if listed {
        Ok(roles)
    } else {
        fail(INVALID, format!("{at} must list roles, each once"))
    }
}

impl MultiPartyPolicyStore {
    /// Validate a policy set and return it as a store, or the first problem found. There are no
    /// defaults: an operation the operator does not list for a target is not authorized.
    pub fn from_json(policy_set: &Value) -> Result<MultiPartyPolicyStore, MultiPartyConfigError> {
        let Some(set) = policy_set.as_object() else {
            return fail(INVALID, "the policy set must be an object");
        };
        unknown_field(set, &["policy_set_version", "profile", "audience", "max_validity_seconds", "subjects"], "policy set")?;
        let Some(version) = set.get("policy_set_version").and_then(Value::as_str).filter(|v| !v.is_empty()) else {
            return fail(INVALID, "policy_set_version must be a non-empty string");
        };
        if set.get("profile").and_then(Value::as_str) != Some(MPA_V1) {
            return fail(INVALID, format!("profile must be {MPA_V1}"));
        }
        let Some(audience) = bounded_str(set.get("audience"), MAX_IDENTIFIER) else {
            return fail(INVALID, "audience must be a string of 1 to 256 characters");
        };
        let Some(seconds) = set.get("max_validity_seconds").and_then(integer).filter(|s| (1..=MPA_V1_MAX_VALIDITY_SECONDS as i64).contains(s)) else {
            return fail(INVALID, format!("max_validity_seconds must be an integer from 1 to {MPA_V1_MAX_VALIDITY_SECONDS}"));
        };
        let Some(list) = set.get("subjects").and_then(Value::as_array) else {
            return fail(INVALID, "subjects must be an array");
        };

        let mut subjects: HashMap<String, Subject> = HashMap::new();
        for (i, item) in list.iter().enumerate() {
            let at = format!("subjects[{i}]");
            let Some(subject) = item.as_object() else {
                return fail(INVALID, format!("{at} must be an object"));
            };
            unknown_field(subject, &["target", "parties", "operations"], &at)?;
            let Some(target) = bounded_str(subject.get("target"), MAX_IDENTIFIER) else {
                return fail(INVALID, format!("{at}.target must be a string of 1 to 256 characters"));
            };
            if subjects.contains_key(target) {
                return fail("CONFIG_MPA_DUPLICATE", format!("{at}: target {} is listed twice", printable_str(target)));
            }
            let Some(party_list) = subject.get("parties").and_then(Value::as_array).filter(|p| !p.is_empty()) else {
                return fail(INVALID, format!("{at}.parties must be a non-empty array"));
            };

            let mut parties: HashMap<String, String> = HashMap::new();
            for (j, p) in party_list.iter().enumerate() {
                let at = format!("{at}.parties[{j}]");
                let Some(party) = p.as_object() else {
                    return fail(INVALID, format!("{at} must be an object"));
                };
                unknown_field(party, &["party_id", "role"], &at)?;
                let Some(id) = party.get("party_id").and_then(Value::as_str).filter(|id| !id.is_empty()) else {
                    return fail(INVALID, format!("{at}.party_id must be a non-empty string"));
                };
                let Some(role) = party.get("role").and_then(Value::as_str).filter(|r| ROLES.contains(r)) else {
                    return fail(INVALID, format!("{at}.role {} is not a role", printable(party.get("role"))));
                };
                if parties.contains_key(id) {
                    return fail("CONFIG_MPA_DUPLICATE", format!("{at}: party {} is listed twice for the target", printable_str(id)));
                }
                parties.insert(id.to_string(), role.to_string());
            }

            let Some(rules) = subject.get("operations").and_then(Value::as_object) else {
                return fail(INVALID, format!("{at}.operations must be an object"));
            };
            let mut operations: HashMap<String, MultiPartyOperationRule> = HashMap::new();
            for (operation, value) in rules {
                let at = format!("{at}.operations.{}", printable_str(operation));
                if !OPERATIONS.contains(&operation.as_str()) {
                    return fail(INVALID, format!("{at} is not an operation"));
                }
                let Some(rule) = value.as_object() else {
                    return fail(INVALID, format!("{at} must be an object"));
                };
                unknown_field(rule, &["required_parties", "allowed_roles", "required_roles"], &at)?;
                let Some(required) = rule.get("required_parties").and_then(integer).filter(|n| *n >= 2) else {
                    return fail(INVALID, format!("{at}.required_parties must be an integer of at least 2"));
                };
                let allowed = role_list(rule.get("allowed_roles"), &format!("{at}.allowed_roles"))?;
                let required_roles = role_list(rule.get("required_roles"), &format!("{at}.required_roles"))?;
                if allowed.is_empty() {
                    return fail(INVALID, format!("{at}.allowed_roles must not be empty"));
                }
                if required_roles.iter().any(|r| !allowed.contains(r)) {
                    return fail(INVALID, format!("{at}.required_roles must be among allowed_roles"));
                }
                let eligible: Vec<&String> = parties.values().filter(|role| allowed.contains(role)).collect();
                if required > eligible.len() as i64 {
                    return fail("CONFIG_MPA_UNSATISFIABLE", format!("{at}: {required} parties are required and {} have an allowed role", eligible.len()));
                }
                if required_roles.iter().any(|r| !eligible.contains(&r)) {
                    return fail("CONFIG_MPA_UNSATISFIABLE", format!("{at}: no party holds a required role"));
                }
                operations.insert(operation.clone(), MultiPartyOperationRule { required_parties: required as usize, allowed_roles: allowed, required_roles });
            }
            subjects.insert(target.to_string(), Subject { parties, operations });
        }
        Ok(MultiPartyPolicyStore { version: version.to_string(), audience: audience.to_string(), max_validity_seconds: seconds as u64, subjects })
    }

    /// The policy set's `policy_set_version`.
    pub fn version(&self) -> &str {
        &self.version
    }

    /// The verifier the requests must be for.
    pub fn audience(&self) -> &str {
        &self.audience
    }

    /// The longest validity window the operator accepts, in seconds.
    pub fn max_validity_seconds(&self) -> u64 {
        self.max_validity_seconds
    }
}

// ── The request and the signing side (§ 2.2) ──

/// What [`create_multi_party_request`] builds a request from.
#[derive(Debug, Clone, Copy)]
pub struct MultiPartyRequestInput<'a> {
    /// The object of the operation, as the operator's policy set names it.
    pub target: &'a str,
    /// The verifier that may act on the authorization.
    pub audience: &'a str,
    /// The parameters of the operation, an object; None is the empty object.
    pub parameters: Option<&'a Value>,
    /// How long the request is valid, in seconds (1 to 86400; the operator may allow less).
    pub validity_seconds: u64,
    /// Milliseconds since the Unix epoch; the system clock when None.
    pub issued_at_ms: Option<i64>,
    /// A unique identifier; 16 random bytes when None.
    pub request_id: Option<&'a str>,
}

/// Build the operation_payload every party signs: {request, parameters}. An error for a request
/// the profile would refuse.
pub fn create_multi_party_request(input: &MultiPartyRequestInput) -> Result<Value, MultiPartyConfigError> {
    let text = |s: &str| Value::String(s.to_string());
    if bounded_str(Some(&text(input.target)), MAX_IDENTIFIER).is_none() {
        return fail(INVALID, "target must be a string of 1 to 256 characters");
    }
    if bounded_str(Some(&text(input.audience)), MAX_IDENTIFIER).is_none() {
        return fail(INVALID, "audience must be a string of 1 to 256 characters");
    }
    if !(1..=MPA_V1_MAX_VALIDITY_SECONDS).contains(&input.validity_seconds) {
        return fail(INVALID, format!("validity_seconds must be from 1 to {MPA_V1_MAX_VALIDITY_SECONDS}"));
    }
    let request_id = match input.request_id {
        Some(id) => id.to_string(),
        None => {
            let mut random = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut random);
            format!("mpa:{}", hex::encode(random))
        }
    };
    if bounded_str(Some(&text(&request_id)), MAX_REQUEST_ID).is_none() {
        return fail(INVALID, "request_id must be a string of 1 to 128 characters");
    }
    let parameters = input.parameters.cloned().unwrap_or_else(|| json!({}));
    if !parameters.is_object() || canonicalize_v2(&parameters).is_err() {
        return fail(INVALID, "parameters must be an object representable in dcp-jcs-v1");
    }
    let issued = input.issued_at_ms.unwrap_or_else(|| {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
    });
    Ok(json!({
        "request": {
            "profile": MPA_V1,
            "request_id": request_id,
            "target": input.target,
            "audience": input.audience,
            "issued_at": rfc3339_from_millis(issued),
            "expires_at": rfc3339_from_millis(issued.saturating_add(input.validity_seconds as i64 * 1000)),
        },
        "parameters": parameters,
    }))
}

fn signed_bytes(operation: &str, operation_payload: &Value, party_id: &str, role: &str) -> Result<Vec<u8>, String> {
    canonicalize_v2(&json!({ "operation": operation, "operation_payload": operation_payload, "party_id": party_id, "role": role }))
        .map(String::into_bytes)
}

/// One party's authorization: its composite signature over
/// {operation, operation_payload, party_id, role}.
#[allow(clippy::too_many_arguments)]
pub fn create_party_authorization(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    operation: &str,
    operation_payload: &Value,
    party_id: &str,
    role: &str,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
) -> Result<Value, String> {
    let signed = signed_bytes(operation, operation_payload, party_id, role)?;
    let sig = composite_sign(classical_provider, pq_provider, CTX_MULTI_PARTY_AUTH, &signed, classical_key, pq_key)
        .map_err(|e| format!("{e:?}"))?;
    let composite_sig = serde_json::to_value(&sig).map_err(|e| e.to_string())?;
    Ok(json!({ "party_id": party_id, "role": role, "composite_sig": composite_sig }))
}

/// Put the parties' authorizations in one record. `required_parties` fills the schema's field (2
/// when less): it is not signed and no evaluation reads it.
pub fn build_multi_party_authorization(operation: &str, operation_payload: &Value, authorizations: Vec<Value>, required_parties: u64) -> Value {
    json!({
        "type": "multi_party_authorization",
        "operation": operation,
        "operation_payload": operation_payload,
        "required_parties": required_parties.max(2),
        "authorizations": authorizations,
    })
}

// ── Evaluation: verification and authorization (§ 4) ──

/// What the executor is about to do. The authorization must be for exactly this.
#[derive(Debug, Clone, Copy)]
pub struct MultiPartyExpected<'a> {
    pub operation: &'a str,
    pub target: &'a str,
    /// The parameters of the operation: an object.
    pub parameters: &'a Value,
}

/// The operator's configuration and the executor's intention. `policy` and `trust` come from their
/// loaders, never from the record or the request.
#[derive(Debug, Clone, Copy)]
pub struct MultiPartyOptions<'a> {
    pub policy: &'a MultiPartyPolicyStore,
    pub trust: &'a PrincipalTrustStore,
    pub expected: MultiPartyExpected<'a>,
    /// Milliseconds since the Unix epoch.
    pub now_ms: i64,
}

/// One code of the evaluation, with a bounded message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MultiPartyError {
    pub code: &'static str,
    pub message: String,
}

/// One authorization of the record: the signed party_id and role, and whether its signature
/// verified (None: not evaluated).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MultiPartyPartyResult {
    pub party_id: String,
    pub role: String,
    pub verified: Option<bool>,
}

/// The result of [`evaluate_multi_party_authorization`] (spec/profiles/multi-party § 5.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MultiPartyEvaluation {
    pub profile: &'static str,
    /// `valid` or `invalid`.
    pub structure: &'static str,
    /// `verified`, `failed`, or `not_evaluated` when no signature was read.
    pub verification: &'static str,
    /// The decision. True only when no phase added a code.
    pub authorized: bool,
    /// The signed operation, target, request_id and expires_at of a well-formed record, else None.
    pub operation: Option<String>,
    pub target: Option<String>,
    pub request_id: Option<String>,
    pub expires_at: Option<String>,
    pub parties: Vec<MultiPartyPartyResult>,
    pub parties_counted: Option<usize>,
    /// The operator's threshold for the operation on the target, or None when no rule was found.
    pub required_parties: Option<usize>,
    pub policy_set_version: String,
    pub trust_set_version: String,
    pub errors: Vec<MultiPartyError>,
}

impl MultiPartyEvaluation {
    fn add(&mut self, code: &'static str, message: impl Into<String>) {
        self.errors.push(MultiPartyError { code, message: bounded(message.into()) });
    }
}

fn is_kid(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_sig_b64(s: &str) -> bool {
    let body = s.trim_end_matches('=');
    (8..=66476).contains(&s.len())
        && s.len() - body.len() <= 2
        && !body.is_empty()
        && body.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
}

fn is_signature_part(value: &Value) -> bool {
    value.as_object().is_some_and(|part| {
        exactly(part, &["alg", "kid", "sig_b64"])
            && part["alg"].is_string()
            && part["kid"].as_str().is_some_and(is_kid)
            && part["sig_b64"].as_str().is_some_and(is_sig_b64)
    })
}

/// schemas/v2/multi_party_authorization.schema.json, by hand.
fn conforms_to_schema(record: &Value) -> bool {
    let Some(r) = record.as_object() else { return false };
    if !exactly(r, &["type", "operation", "operation_payload", "required_parties", "authorizations"]) {
        return false;
    }
    if r["type"].as_str() != Some("multi_party_authorization")
        || !r["operation"].as_str().is_some_and(|o| OPERATIONS.contains(&o))
        || !r["operation_payload"].is_object()
        || !integer(&r["required_parties"]).is_some_and(|n| n >= 2)
    {
        return false;
    }
    let Some(authorizations) = r["authorizations"].as_array().filter(|a| !a.is_empty()) else { return false };
    authorizations.iter().all(|a| {
        let Some(auth) = a.as_object() else { return false };
        if !exactly(auth, &["party_id", "role", "composite_sig"]) || !auth["party_id"].is_string() || !auth["role"].as_str().is_some_and(|role| ROLES.contains(&role)) {
            return false;
        }
        let Some(sig) = auth["composite_sig"].as_object() else { return false };
        exactly(sig, &["classical", "pq", "binding"])
            && is_signature_part(&sig["classical"])
            && (sig["pq"].is_null() || is_signature_part(&sig["pq"]))
            && matches!(sig["binding"].as_str(), Some("pq_over_classical" | "classical_only"))
    })
}

/// schemas/v2/multi_party_request.schema.json, by hand, with the instants parsed as everywhere else.
fn conforms_to_request(payload: &Map<String, Value>) -> bool {
    let instant = |v: Option<&Value>| v.and_then(Value::as_str).and_then(parse_rfc3339_millis).is_some();
    exactly(payload, &["request", "parameters"])
        && payload["parameters"].is_object()
        && payload["request"].as_object().is_some_and(|request| {
            exactly(request, &["profile", "request_id", "target", "audience", "issued_at", "expires_at"])
                && request["profile"].as_str() == Some(MPA_V1)
                && bounded_str(request.get("request_id"), MAX_REQUEST_ID).is_some()
                && bounded_str(request.get("target"), MAX_IDENTIFIER).is_some()
                && bounded_str(request.get("audience"), MAX_IDENTIFIER).is_some()
                && instant(request.get("issued_at"))
                && instant(request.get("expires_at"))
        })
}

/// The first structural problem of a record, in the order of § 4, or None.
fn structure_code(record: &Value) -> Option<&'static str> {
    if !conforms_to_schema(record) {
        return Some("MPA_SCHEMA_INVALID");
    }
    let payload = record["operation_payload"].as_object()?;
    if !payload.contains_key("request") {
        return Some("MPA_REQUEST_MISSING");
    }
    if !conforms_to_request(payload) {
        return Some("MPA_REQUEST_INVALID");
    }
    if canonicalize_v2(&record["operation_payload"]).is_err() {
        return Some("MPA_NOT_REPRESENTABLE");
    }
    (record["authorizations"].as_array().map_or(0, Vec::len) > MPA_V1_MAX_AUTHORIZATIONS).then_some("MPA_TOO_MANY_AUTHORIZATIONS")
}

/// Why a trusted key cannot count at `now`, the first that applies, or None.
fn key_code(key: Option<(&str, &[u8], TrustedKeyState)>, alg: &str) -> Option<&'static str> {
    match key {
        Some((key_alg, _, state)) if key_alg == alg => match state {
            TrustedKeyState::Usable => None,
            TrustedKeyState::Revoked => Some("MPA_KEY_REVOKED"),
            TrustedKeyState::Expired => Some("MPA_KEY_EXPIRED"),
            TrustedKeyState::NotYetValid => Some("MPA_KEY_NOT_YET_VALID"),
        },
        _ => Some("MPA_KEY_NOT_ANCHORED"),
    }
}

type ProviderFor<'a> = &'a dyn Fn(&str) -> Result<Box<dyn CryptoProvider>, String>;

/// Decide whether a multi-party authorization authorizes what the executor is about to do
/// (spec/profiles/multi-party § 4). `record` is the record as parsed JSON.
///
/// Strict: any authorization that fails refuses the record. A phase that adds a code stops the
/// next ones, so no signature of a malformed, foreign or expired request is verified.
///
/// An error, and no result, when `expected` is unusable: that is the caller's mistake, not a
/// verdict on the record.
pub fn evaluate_multi_party_authorization(record: &Value, options: &MultiPartyOptions) -> Result<MultiPartyEvaluation, MultiPartyConfigError> {
    evaluate_with(record, options, &provider_for_alg)
}

fn evaluate_with(record: &Value, options: &MultiPartyOptions, provider_for: ProviderFor) -> Result<MultiPartyEvaluation, MultiPartyConfigError> {
    let (policy, trust, expected, now) = (options.policy, options.trust, &options.expected, options.now_ms);
    if !OPERATIONS.contains(&expected.operation) {
        return fail(INVALID, format!("expected.operation {} is not an operation", printable_str(expected.operation)));
    }
    if bounded_str(Some(&Value::String(expected.target.to_string())), MAX_IDENTIFIER).is_none() {
        return fail(INVALID, "expected.target must be a string of 1 to 256 characters");
    }
    let Some(expected_parameters) = expected.parameters.is_object().then(|| canonicalize_v2(expected.parameters).ok()).flatten() else {
        return fail(INVALID, "expected.parameters must be an object representable in dcp-jcs-v1");
    };

    let mut result = MultiPartyEvaluation {
        profile: MPA_V1,
        structure: "valid",
        verification: "not_evaluated",
        authorized: false,
        operation: None,
        target: None,
        request_id: None,
        expires_at: None,
        parties: Vec::new(),
        parties_counted: None,
        required_parties: None,
        policy_set_version: policy.version.clone(),
        trust_set_version: trust.version().to_string(),
        errors: Vec::new(),
    };

    // 1. Structure: the first failure, and nothing else is read.
    if let Some(malformed) = structure_code(record) {
        result.structure = "invalid";
        result.add(malformed, "the record is not a well-formed mpa-v1 multi-party authorization");
        return Ok(result);
    }
    let text = |v: &Value| v.as_str().unwrap_or_default().to_string();
    let operation = text(&record["operation"]);
    let payload = &record["operation_payload"];
    let (request, parameters) = (&payload["request"], &payload["parameters"]);
    let authorizations = record["authorizations"].as_array().cloned().unwrap_or_default();
    let target = text(&request["target"]);
    result.operation = Some(operation.clone());
    result.target = Some(target.clone());
    result.request_id = Some(text(&request["request_id"]));
    result.expires_at = Some(text(&request["expires_at"]));
    result.parties = authorizations
        .iter()
        .map(|a| MultiPartyPartyResult { party_id: text(&a["party_id"]), role: text(&a["role"]), verified: None })
        .collect();

    // 2. Binding: this operation, on this target, with these parameters, for this verifier, now.
    if operation != expected.operation {
        result.add("MPA_OPERATION_MISMATCH", format!("the record authorizes {operation}, not {}", expected.operation));
    }
    if target != expected.target {
        result.add("MPA_TARGET_MISMATCH", format!("the request is for target {}", printable_str(&target)));
    }
    if canonicalize_v2(parameters).ok().as_ref() != Some(&expected_parameters) {
        result.add("MPA_PARAMETERS_MISMATCH", "the signed parameters are not the ones about to be used");
    }
    if request["audience"].as_str() != Some(policy.audience.as_str()) {
        result.add("MPA_AUDIENCE_MISMATCH", format!("the request is for audience {}", printable(request.get("audience"))));
    }
    let instant = |v: &Value| v.as_str().and_then(parse_rfc3339_millis).unwrap_or(i64::MIN);
    let (issued, expires) = (instant(&request["issued_at"]), instant(&request["expires_at"]));
    if issued > now.saturating_add(SESSION_CLOCK_SKEW_MS) {
        result.add("MPA_NOT_YET_VALID", "issued_at is in the future");
    }
    if expires <= now {
        result.add("MPA_EXPIRED", "expires_at has passed");
    }
    if expires <= issued || expires.saturating_sub(issued) > (policy.max_validity_seconds as i64).saturating_mul(1000) {
        result.add("MPA_VALIDITY_INVALID", format!("the validity window must be positive and at most {} seconds", policy.max_validity_seconds));
    }
    let subject = policy.subjects.get(&target);
    let rule = subject.and_then(|s| s.operations.get(&operation));
    match (subject, rule) {
        (None, _) => result.add("MPA_TARGET_UNKNOWN", format!("the operator has no parties for target {}", printable_str(&target))),
        (Some(_), None) => result.add("MPA_OPERATION_NOT_ALLOWED", format!("the operator does not list {operation} for the target")),
        (Some(_), Some(rule)) => result.required_parties = Some(rule.required_parties),
    }
    let (Some(subject), Some(rule), true) = (subject, rule, result.errors.is_empty()) else {
        return Ok(result);
    };

    // 3. Parties: distinct parties of the target, each with the role the operator gives it.
    let mut seen: HashSet<String> = HashSet::new();
    for party in result.parties.clone() {
        let Some(role) = subject.parties.get(&party.party_id) else {
            result.add("MPA_PARTY_UNKNOWN", format!("{} is not a party of the target", printable_str(&party.party_id)));
            continue;
        };
        if !seen.insert(party.party_id.clone()) {
            result.add("MPA_PARTY_DUPLICATE", format!("{} is listed more than once", printable_str(&party.party_id)));
        }
        if &party.role != role {
            result.add("MPA_ROLE_MISMATCH", format!("{} signed as {}; the operator has it as {role}", printable_str(&party.party_id), party.role));
        }
        if !rule.allowed_roles.contains(role) {
            result.add("MPA_ROLE_NOT_ALLOWED", format!("the role {role} may not authorize {operation}"));
        }
    }
    if !result.errors.is_empty() {
        return Ok(result);
    }

    // 4. Verification: every authorization is a hybrid signature, by the party's trusted keys, over this request.
    let mut counted = 0;
    for (i, auth) in authorizations.iter().enumerate() {
        let before = result.errors.len();
        let (party_id, role) = (result.parties[i].party_id.clone(), result.parties[i].role.clone());
        let sig = &auth["composite_sig"];
        let (classical, pq) = (&sig["classical"], &sig["pq"]);
        let (classical_alg, pq_alg) = (classical["alg"].as_str().unwrap_or_default(), pq["alg"].as_str().unwrap_or_default());
        if sig["binding"].as_str() != Some("pq_over_classical") || !pq.is_object() || !CLASSICAL_ALGS.contains(&classical_alg) || !PQ_ALGS.contains(&pq_alg) {
            result.add("MPA_HYBRID_REQUIRED", format!("{}: a classical and a post-quantum signature are both required", printable_str(&party_id)));
        } else {
            let (classical_kid, pq_kid) = (classical["kid"].as_str().unwrap_or_default(), pq["kid"].as_str().unwrap_or_default());
            let classical_key = trust.key_state(&party_id, classical_kid, now);
            let pq_key = trust.key_state(&party_id, pq_kid, now);
            for (key, alg, kid) in [(classical_key, classical_alg, classical_kid), (pq_key, pq_alg, pq_kid)] {
                if let Some(code) = key_code(key, alg) {
                    result.add(code, format!("{}: key {kid} cannot count", printable_str(&party_id)));
                }
            }
            if let (Some((_, classical_bytes, _)), Some((_, pq_bytes, _)), true) = (classical_key, pq_key, result.errors.len() == before) {
                let (classical_sig, pq_sig) = (text(&classical["sig_b64"]), text(&pq["sig_b64"]));
                let b64 = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
                // An algorithm no provider verifies, or a malformed signature, is an error here: not valid. So is a
                // signature that is not canonical base64: composite_verify decodes with the strict engine.
                let verify = || -> Result<bool, String> {
                    let composite = CompositeSignature {
                        classical: SignatureEntry { alg: classical_alg.to_string(), kid: classical_kid.to_string(), sig_b64: classical_sig.clone() },
                        pq: Some(SignatureEntry { alg: pq_alg.to_string(), kid: pq_kid.to_string(), sig_b64: pq_sig.clone() }),
                        binding: "pq_over_classical".to_string(),
                    };
                    let (classical_provider, pq_provider) = (provider_for(classical_alg)?, provider_for(pq_alg)?);
                    let signed = signed_bytes(&operation, payload, &party_id, &role)?;
                    composite_verify(classical_provider.as_ref(), Some(pq_provider.as_ref()), CTX_MULTI_PARTY_AUTH, &signed, &composite, &b64(classical_bytes), Some(&b64(pq_bytes)))
                        .map(|verified| verified.valid)
                        .map_err(|e| format!("{e:?}"))
                };
                if !verify().unwrap_or(false) {
                    result.add("MPA_SIGNATURE_INVALID", format!("{}: the signature does not verify", printable_str(&party_id)));
                }
            }
        }
        let verified = result.errors.len() == before;
        result.parties[i].verified = Some(verified);
        if verified {
            counted += 1;
        }
    }
    result.parties_counted = Some(counted);
    if !result.errors.is_empty() {
        result.verification = "failed";
        return Ok(result);
    }
    result.verification = "verified";

    // 5. Decision: enough parties, and the roles the operator requires.
    if counted < rule.required_parties {
        result.add("MPA_THRESHOLD_NOT_MET", format!("{counted} parties authorized; the operator requires {}", rule.required_parties));
    }
    let roles: HashSet<&String> = result.parties.iter().filter_map(|p| subject.parties.get(&p.party_id)).collect();
    for role in &rule.required_roles {
        if !roles.contains(role) {
            result.add("MPA_REQUIRED_ROLE_MISSING", format!("no {role} authorized the operation"));
        }
    }
    result.authorized = result.errors.is_empty();
    Ok(result)
}

#[cfg(test)]
mod tests {
    //! What needs the provider seam: how many signatures an evaluation verifies, and an algorithm no
    //! provider verifies. The vectors and the public API are in tests/multi_party.rs.
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    struct Counting(Box<dyn CryptoProvider>, Arc<AtomicUsize>);
    impl CryptoProvider for Counting {
        fn alg(&self) -> &str {
            self.0.alg()
        }
        fn key_size(&self) -> usize {
            self.0.key_size()
        }
        fn sig_size(&self) -> usize {
            self.0.sig_size()
        }
        fn is_constant_time(&self) -> bool {
            self.0.is_constant_time()
        }
        fn generate_keypair(&self) -> Result<crate::v2::crypto_provider::GeneratedKeypair, crate::v2::crypto_provider::CryptoError> {
            self.0.generate_keypair()
        }
        fn sign(&self, message: &[u8], secret_key_b64: &str) -> Result<Vec<u8>, crate::v2::crypto_provider::CryptoError> {
            self.0.sign(message, secret_key_b64)
        }
        fn verify(&self, message: &[u8], signature: &[u8], public_key_b64: &str) -> Result<bool, crate::v2::crypto_provider::CryptoError> {
            self.1.fetch_add(1, Ordering::SeqCst);
            self.0.verify(message, signature, public_key_b64)
        }
    }

    fn vectors() -> Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/interop/v2/multi_party_vectors.json");
        serde_json::from_str(&std::fs::read_to_string(path).expect("read multi-party vectors")).expect("parse")
    }

    fn evaluate(v: &Value, name: &str, provider_for: ProviderFor) -> MultiPartyEvaluation {
        let case = v["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).expect(name);
        let policy = MultiPartyPolicyStore::from_json(&v["policy_sets"][case["policy_set"].as_str().unwrap()]).expect("policy set");
        let trust = PrincipalTrustStore::from_json(&v["trust_sets"][case["trust_set"].as_str().unwrap()]).expect("trust set");
        let expected = MultiPartyExpected {
            operation: case["expected"]["operation"].as_str().unwrap(),
            target: case["expected"]["target"].as_str().unwrap(),
            parameters: &case["expected"]["parameters"],
        };
        let options = MultiPartyOptions { policy: &policy, trust: &trust, expected, now_ms: case["now_ms"].as_i64().unwrap() };
        evaluate_with(&v["records"][case["record"].as_str().unwrap()], &options, provider_for).expect("a result")
    }

    #[test]
    fn verifies_no_signature_of_a_request_refused_earlier() {
        let v = vectors();
        for name in ["seventeen_authorizations", "without_request", "another_audience", "expired", "target_the_operator_does_not_have", "same_party_twice", "self_assigned_role", "sixteen_authorizations"] {
            let calls = Arc::new(AtomicUsize::new(0));
            let counting = |alg: &str| provider_for_alg(alg).map(|p| Box::new(Counting(p, calls.clone())) as Box<dyn CryptoProvider>);
            assert!(!evaluate(&v, name, &counting).authorized, "{name}");
            assert_eq!(calls.load(Ordering::SeqCst), 0, "{name}");
        }
        let calls = Arc::new(AtomicUsize::new(0));
        let counting = |alg: &str| provider_for_alg(alg).map(|p| Box::new(Counting(p, calls.clone())) as Box<dyn CryptoProvider>);
        assert!(evaluate(&v, "two_of_three", &counting).authorized);
        assert_eq!(calls.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn an_algorithm_no_provider_verifies_refuses() {
        let v = vectors();
        let classical_only = |alg: &str| if alg == "ed25519" { provider_for_alg(alg) } else { Err(format!("no provider for {alg}")) };
        let r = evaluate(&v, "two_of_three", &classical_only);
        let codes: HashSet<&str> = r.errors.iter().map(|e| e.code).collect();
        assert!(!r.authorized);
        assert_eq!(r.verification, "failed");
        assert_eq!(codes, HashSet::from(["MPA_SIGNATURE_INVALID"]));
    }

    #[test]
    fn messages_are_bounded_in_characters() {
        assert_eq!(bounded("é".repeat(300)).chars().count(), 300);
        let cut = bounded("é".repeat(301));
        assert_eq!(cut.chars().count(), 300);
        assert!(cut.ends_with('…'));
    }
}
