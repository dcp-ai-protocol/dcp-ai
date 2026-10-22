//! DCP-09 v2.0 Delegation & Representation — Rust port.
//!
//! Delegation mandates (human → agent authority), sub-mandates and mandate
//! chains (agent → agent, DCP-09 §3.5), mandate verification and revocation.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, composite_verify, CompositeKeyInfo};
use crate::v2::composite_sig::{CompositeSignature, SignatureEntry};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::{CTX_DELEGATION, CTX_SUB_MANDATE};
use crate::v2::lifecycle::{unix_now_millis, utc_now_iso_pub as utc_now_iso};
use crate::v2::security_tier::{max_tier, SecurityTier};
use crate::v2::session_nonce::parse_rfc3339_millis;
use crate::v2::verify_bundle::provider_for_alg;

pub struct DelegationMandateParams<'a> {
    pub mandate_id: &'a str,
    pub session_nonce: &'a str,
    pub human_id: &'a str,
    pub agent_id: &'a str,
    pub authority_scope: Vec<Value>,
    pub valid_from: &'a str,
    pub valid_until: &'a str,
    pub revocable: bool,
}

/// Whether a delegate may sub-delegate, and the greatest `delegation_depth`
/// any descendant may reach (DCP-09 §3.5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubDelegationPolicy {
    pub permitted: bool,
    pub max_depth: u64,
}

/// The DCP-09 §3.5 chain fields of a mandate; both are left out of the wire
/// object when `None`, so a plain root mandate is unchanged byte for byte.
#[derive(Debug, Default, Clone)]
pub struct MandateChainOptions {
    pub sub_delegation: Option<SubDelegationPolicy>,
    pub minimum_security_tier: Option<String>,
}

fn insert_chain_fields(payload: &mut Value, options: &MandateChainOptions) {
    if let Some(obj) = payload.as_object_mut() {
        if let Some(policy) = &options.sub_delegation {
            obj.insert(
                "sub_delegation".into(),
                json!({ "permitted": policy.permitted, "max_depth": policy.max_depth }),
            );
        }
        if let Some(tier) = &options.minimum_security_tier {
            obj.insert("minimum_security_tier".into(), Value::String(tier.clone()));
        }
    }
}

fn sign_mandate(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    context: &str,
    payload: Value,
    field: &str,
) -> Result<Value, CryptoError> {
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        context,
        canonical.as_bytes(),
        classical_key,
        pq_key,
    )?;
    let mut out = payload;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            field.into(),
            serde_json::to_value(&composite)
                .map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

/// Create a delegation mandate signed by the human principal.
/// The output carries the signature in the `human_composite_sig` field, not
/// `composite_sig`, to distinguish the human-principal witness on the mandate.
pub fn create_delegation_mandate(
    human_classical_provider: &dyn CryptoProvider,
    human_pq_provider: &dyn CryptoProvider,
    human_classical_key: &CompositeKeyInfo,
    human_pq_key: &CompositeKeyInfo,
    params: DelegationMandateParams<'_>,
) -> Result<Value, CryptoError> {
    create_delegation_mandate_with_options(
        human_classical_provider,
        human_pq_provider,
        human_classical_key,
        human_pq_key,
        params,
        &MandateChainOptions::default(),
    )
}

/// `create_delegation_mandate` with the DCP-09 §3.5 chain fields: a
/// `sub_delegation` policy that lets the agent sub-delegate, and a
/// `minimum_security_tier` floor.
pub fn create_delegation_mandate_with_options(
    human_classical_provider: &dyn CryptoProvider,
    human_pq_provider: &dyn CryptoProvider,
    human_classical_key: &CompositeKeyInfo,
    human_pq_key: &CompositeKeyInfo,
    params: DelegationMandateParams<'_>,
    options: &MandateChainOptions,
) -> Result<Value, CryptoError> {
    let mut payload = json!({
        "dcp_version": "2.0",
        "mandate_id": params.mandate_id,
        "session_nonce": params.session_nonce,
        "human_id": params.human_id,
        "agent_id": params.agent_id,
        "authority_scope": params.authority_scope,
        "valid_from": params.valid_from,
        "valid_until": params.valid_until,
        "revocable": params.revocable,
        "timestamp": utc_now_iso(),
    });
    insert_chain_fields(&mut payload, options);
    sign_mandate(
        human_classical_provider,
        human_pq_provider,
        human_classical_key,
        human_pq_key,
        CTX_DELEGATION,
        payload,
        "human_composite_sig",
    )
}

/// Fields a delegating agent sets on a sub-mandate; `human_id`,
/// `parent_mandate_id` and `delegation_depth` come from the parent.
pub struct SubMandateParams<'a> {
    pub mandate_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub authority_scope: Vec<Value>,
    pub valid_from: &'a str,
    pub valid_until: &'a str,
    pub revocable: bool,
    pub options: MandateChainOptions,
}

/// Create a sub-mandate (DCP-09 §3.5): the agent holding `parent` passes a
/// narrower authority on to `params.agent_id`, signing with its own keys under
/// the SubMandate context. Nothing is checked here; `verify_mandate_chain` is
/// the gate, so a sub-mandate wider than its parent is one no verifier accepts.
pub fn create_sub_mandate(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    parent: &Value,
    params: SubMandateParams<'_>,
) -> Result<Value, CryptoError> {
    let parent_depth = parent
        .get("delegation_depth")
        .and_then(as_uint)
        .unwrap_or(0);
    let mut payload = json!({
        "dcp_version": "2.0",
        "mandate_id": params.mandate_id,
        "session_nonce": params.session_nonce,
        "human_id": parent.get("human_id").cloned().unwrap_or(Value::Null),
        "agent_id": params.agent_id,
        "authority_scope": params.authority_scope,
        "valid_from": params.valid_from,
        "valid_until": params.valid_until,
        "revocable": params.revocable,
        "timestamp": utc_now_iso(),
        "parent_mandate_id": parent.get("mandate_id").cloned().unwrap_or(Value::Null),
        "delegation_depth": parent_depth + 1,
    });
    insert_chain_fields(&mut payload, &params.options);
    sign_mandate(
        classical_provider,
        pq_provider,
        classical_key,
        pq_key,
        CTX_SUB_MANDATE,
        payload,
        "delegator_composite_sig",
    )
}

#[derive(Debug, Clone)]
pub struct MandateValidity {
    pub valid: bool,
    pub reason: Option<String>,
}

/// Check whether a mandate is currently valid (not expired, not revoked).
pub fn verify_mandate_validity(
    mandate: &Value,
    revoked_mandate_ids: &HashSet<String>,
) -> MandateValidity {
    let mandate_id = mandate
        .get("mandate_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !mandate_id.is_empty() && revoked_mandate_ids.contains(mandate_id) {
        return MandateValidity {
            valid: false,
            reason: Some("Mandate has been revoked".into()),
        };
    }
    let valid_from = mandate
        .get("valid_from")
        .and_then(Value::as_str)
        .unwrap_or("");
    let valid_until = mandate
        .get("valid_until")
        .and_then(Value::as_str)
        .unwrap_or("");
    let now = utc_now_iso();
    // Lexicographic comparison works for ISO-8601 UTC strings.
    if valid_from > now.as_str() {
        return MandateValidity {
            valid: false,
            reason: Some("Mandate is not yet valid".into()),
        };
    }
    if valid_until < now.as_str() {
        return MandateValidity {
            valid: false,
            reason: Some("Mandate has expired".into()),
        };
    }
    MandateValidity {
        valid: true,
        reason: None,
    }
}

// ── Mandate chains (DCP-09 §3.5.2) ──

/// The keys a chain is verified against; each list is looked up by kid, as the
/// bundle verifier does.
#[derive(Debug, Clone, Deserialize)]
pub struct MandateChainKeys {
    /// Keys of the human principal (the RPR binding_keys): verify the root's `human_composite_sig`.
    pub human_keys: Vec<Value>,
    /// Passport keys of each delegating agent, by agent_id: verify the `delegator_composite_sig` of its sub-mandates.
    pub agent_keys: HashMap<String, Vec<Value>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MandateChainResult {
    pub valid: bool,
    /// Empty when valid; every error names the mandate by its index in the chain.
    pub errors: Vec<String>,
    /// The leaf's `delegation_depth` when valid, 0 otherwise.
    pub depth: usize,
    /// The greatest `minimum_security_tier` along the chain, or None when no mandate sets one.
    pub effective_tier: Option<SecurityTier>,
}

const TIER_NAMES: [&str; 4] = ["routine", "standard", "elevated", "maximum"];
const CLASSICAL_ALGS: [&str; 1] = ["ed25519"];
const PQ_ALGS: [&str; 2] = ["ml-dsa-65", "slh-dsa-192f"];

fn tier_rank(name: &str) -> Option<usize> {
    TIER_NAMES.iter().position(|t| *t == name)
}

/// A JSON number with no fraction, as an unsigned integer.
fn as_uint(v: &Value) -> Option<u64> {
    let n = v.as_number()?;
    n.as_u64().or_else(|| {
        n.as_f64()
            .filter(|f| f.fract() == 0.0 && *f >= 0.0 && *f <= u64::MAX as f64)
            .map(|f| f as u64)
    })
}

fn is_nonempty_str(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| !s.is_empty())
}

fn is_str_list(v: &Value) -> bool {
    v.as_array().is_some_and(|a| a.iter().all(Value::is_string))
}

fn scope_entry_ok(e: &Value) -> bool {
    e.as_object().is_some_and(|o| {
        is_nonempty_str(o.get("domain"))
            && o.get("actions_permitted").is_some_and(is_str_list)
            && o.get("data_classes").is_none_or(is_str_list)
            && o.get("limits").is_none_or(Value::is_object)
    })
}

fn sub_delegation_ok(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.get("permitted").is_some_and(Value::is_boolean)
            && o.get("max_depth").is_some_and(|d| as_uint(d).is_some())
    })
}

fn canonical_equal(a: &Value, b: &Value) -> bool {
    match (canonicalize_v2(a), canonicalize_v2(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn instant(m: &Map<String, Value>, field: &str) -> i64 {
    // Shape checks have already parsed both validity fields.
    m.get(field)
        .and_then(Value::as_str)
        .and_then(parse_rfc3339_millis)
        .unwrap_or(0)
}

/// Errors in one mandate's own fields, whatever its position in the chain.
fn shape_errors(m: &Map<String, Value>) -> Vec<String> {
    let mut errors = Vec::new();
    for field in ["mandate_id", "human_id", "agent_id"] {
        if !is_nonempty_str(m.get(field)) {
            errors.push(format!("missing or invalid {field}"));
        }
    }
    for field in ["valid_from", "valid_until"] {
        if m.get(field)
            .and_then(Value::as_str)
            .and_then(parse_rfc3339_millis)
            .is_none()
        {
            errors.push(format!("missing or invalid {field}"));
        }
    }
    let scope_ok = m
        .get("authority_scope")
        .and_then(Value::as_array)
        .is_some_and(|scope| !scope.is_empty() && scope.iter().all(scope_entry_ok));
    if !scope_ok {
        errors.push("missing or invalid authority_scope".into());
    }
    if m.get("sub_delegation")
        .is_some_and(|v| !sub_delegation_ok(v))
    {
        errors.push("invalid sub_delegation".into());
    }
    if m.get("minimum_security_tier")
        .is_some_and(|v| v.as_str().and_then(tier_rank).is_none())
    {
        errors.push("invalid minimum_security_tier".into());
    }
    errors
}

fn scope_of(m: &Map<String, Value>) -> &[Value] {
    m.get("authority_scope")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn str_set(v: Option<&Value>) -> HashSet<&str> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

/// Why `child` is not within `parent` (rule 5 of DCP-09 §3.5.2), or None when it is.
/// A JSON number as the exact integer it denotes, or None when it is not a wire integer. A
/// float counts only without a fractional part; i128 holds every such f64 below 2^127.
fn exact_integer(v: &Value) -> Option<i128> {
    if let Some(i) = v.as_i64() {
        return Some(i128::from(i));
    }
    if let Some(u) = v.as_u64() {
        return Some(i128::from(u));
    }
    let f = v.as_f64()?;
    (f.is_finite() && f.fract() == 0.0 && f.abs() < 2f64.powi(127)).then(|| f as i128)
}

/// `child <= parent` for two JSON numbers, compared as exact integers whatever their
/// representation: through f64 a child of 2^53 + 1 would pass as equal to a parent of 2^53,
/// and a parent of 2^53 + 3 would round up to a child of 2^53 + 4. A number with a
/// fractional part is not a wire integer and is not comparable.
fn number_within(child: &Value, parent: &Value) -> bool {
    matches!((exact_integer(child), exact_integer(parent)), (Some(c), Some(p)) if c <= p)
}

fn attenuation_error(parent: &[Value], child: &[Value]) -> Option<String> {
    let mut by_domain: HashMap<&str, &Map<String, Value>> = HashMap::new();
    // shape_errors has already rejected these shapes; here they are "not comparable", never "fine".
    for p in parent {
        let Some(p) = p.as_object() else {
            return Some("authority_scope entry of the parent is not comparable".into());
        };
        let Some(domain) = p.get("domain").and_then(Value::as_str) else {
            return Some("authority_scope domain of the parent is not comparable".into());
        };
        if by_domain.insert(domain, p).is_some() {
            return Some(format!(
                "authority_scope domain \"{domain}\" is duplicated in the parent"
            ));
        }
    }
    let mut seen = HashSet::new();
    for c in child {
        let Some(c) = c.as_object() else {
            return Some("authority_scope entry is not comparable".into());
        };
        let Some(domain) = c.get("domain").and_then(Value::as_str) else {
            return Some("authority_scope domain is not comparable".into());
        };
        if !seen.insert(domain) {
            return Some(format!("authority_scope domain \"{domain}\" is duplicated"));
        }
        let Some(p) = by_domain.get(domain) else {
            return Some(format!(
                "authority_scope domain \"{domain}\" is not in the parent"
            ));
        };
        if !str_set(c.get("actions_permitted")).is_subset(&str_set(p.get("actions_permitted"))) {
            return Some(format!(
                "actions_permitted for domain \"{domain}\" is not a subset of the parent"
            ));
        }
        if c.contains_key("data_classes") {
            if !p.contains_key("data_classes") {
                return Some(format!(
                    "data_classes for domain \"{domain}\" present but the parent has none"
                ));
            }
            if !str_set(c.get("data_classes")).is_subset(&str_set(p.get("data_classes"))) {
                return Some(format!(
                    "data_classes for domain \"{domain}\" is not a subset of the parent"
                ));
            }
        }
        if let Some(p_limits) = p.get("limits").and_then(Value::as_object) {
            let Some(c_limits) = c.get("limits").and_then(Value::as_object) else {
                return Some(format!("limits for domain \"{domain}\" missing"));
            };
            for (key, pv) in p_limits {
                let Some(cv) = c_limits.get(key) else {
                    return Some(format!("limits.{key} for domain \"{domain}\" missing"));
                };
                // A number may only shrink; anything else must stay identical. Mixed types are not comparable.
                let within = match (pv.is_number(), cv.is_number()) {
                    (true, true) => number_within(cv, pv),
                    (false, false) => canonical_equal(pv, cv),
                    _ => false,
                };
                if !within {
                    return Some(format!(
                        "limits.{key} for domain \"{domain}\" is not within the parent"
                    ));
                }
            }
        }
    }
    None
}

/// The public key of the entry a signature slot names, or why none can verify it.
fn signer_key<'a>(keys: &'a [Value], entry: &SignatureEntry, now: i64) -> Result<&'a str, String> {
    if entry.kid.is_empty() || entry.alg.is_empty() {
        return Err("malformed signature entry".into());
    }
    let key = keys
        .iter()
        .find(|k| k.get("kid").and_then(Value::as_str) == Some(entry.kid.as_str()))
        .ok_or_else(|| format!("signer key kid={} not found", entry.kid))?;
    let alg = key.get("alg").and_then(Value::as_str).unwrap_or("");
    if alg != entry.alg {
        return Err(format!(
            "signer key kid={} is {}, not {}",
            entry.kid, alg, entry.alg
        ));
    }
    let status = key
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("undefined");
    if status != "active" {
        return Err(format!("signer key kid={} is {}", entry.kid, status));
    }
    match key.get("expires_at") {
        None | Some(Value::Null) => {}
        Some(expires_at) => {
            let valid = expires_at
                .as_str()
                .and_then(parse_rfc3339_millis)
                .is_some_and(|t| t >= now);
            if !valid {
                return Err(format!(
                    "signer key kid={} has expired or has an invalid expires_at",
                    entry.kid
                ));
            }
        }
    }
    key.get("public_key_b64")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("signer key kid={} has no public_key_b64", entry.kid))
}

/// Verify `field` of `mandate`, a pq_over_classical composite signature over
/// the mandate without its signature fields.
fn mandate_sig_error(
    context: &str,
    mandate: &Map<String, Value>,
    field: &str,
    keys: Option<&[Value]>,
    keys_label: &str,
    now: i64,
) -> Option<String> {
    let malformed = || format!("{field} must be a pq_over_classical composite signature");
    let cs: CompositeSignature = match mandate.get(field).cloned().map(serde_json::from_value) {
        Some(Ok(cs)) => cs,
        _ => return Some(malformed()),
    };
    let pq = match (&cs.pq, cs.binding.as_str()) {
        (Some(pq), "pq_over_classical") => pq,
        _ => return Some(malformed()),
    };
    if !CLASSICAL_ALGS.contains(&cs.classical.alg.as_str()) {
        return Some(format!(
            "{field} classical slot holds {}, which is not a classical algorithm",
            cs.classical.alg
        ));
    }
    if !PQ_ALGS.contains(&pq.alg.as_str()) {
        return Some(format!(
            "{field} PQ slot holds {}, which is not a PQ algorithm",
            pq.alg
        ));
    }
    let Some(keys) = keys else {
        return Some(format!("{field}: no keys for {keys_label}"));
    };
    let classical_pk = match signer_key(keys, &cs.classical, now) {
        Ok(pk) => pk,
        Err(e) => return Some(format!("{field}: {e} in {keys_label}")),
    };
    let pq_pk = match signer_key(keys, pq, now) {
        Ok(pk) => pk,
        Err(e) => return Some(format!("{field}: {e} in {keys_label}")),
    };

    let payload: Map<String, Value> = mandate
        .iter()
        .filter(|(k, _)| {
            k.as_str() != "human_composite_sig" && k.as_str() != "delegator_composite_sig"
        })
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let verified = canonicalize_v2(&Value::Object(payload)).and_then(|canonical| {
        let classical = provider_for_alg(&cs.classical.alg)?;
        let pq_provider = provider_for_alg(&pq.alg)?;
        composite_verify(
            classical.as_ref(),
            Some(pq_provider.as_ref()),
            context,
            canonical.as_bytes(),
            &cs,
            classical_pk,
            Some(pq_pk),
        )
        .map(|r| r.valid)
        .map_err(|e| e.to_string())
    });
    match verified {
        Ok(true) => None,
        Ok(false) => Some(format!("{field} does not verify")),
        Err(e) => Some(format!("{field} verification error: {e}")),
    }
}

/// Verify a mandate chain, root first (DCP-09 §3.5.2): the root carries a
/// valid human signature (`keys.human_keys`); each sub-mandate links to the
/// previous mandate, is signed by that mandate's agent
/// (`keys.agent_keys[agent_id]`), is permitted by the chain's `sub_delegation`
/// policies, lies inside its parent's validity window, only narrows the
/// parent's authority and never lowers its `minimum_security_tier`; and no
/// mandate is revoked, so a revoked ancestor invalidates every descendant.
/// Anything unknown, missing for the depth or not comparable fails closed.
/// `now_millis` is the verification time (None: the current time).
pub fn verify_mandate_chain(
    chain: &[Value],
    revoked_mandate_ids: &HashSet<String>,
    keys: &MandateChainKeys,
    now_millis: Option<i64>,
) -> MandateChainResult {
    let now = now_millis.unwrap_or_else(|| unix_now_millis() as i64);
    let invalid = |errors: Vec<String>| MandateChainResult {
        valid: false,
        errors,
        depth: 0,
        effective_tier: None,
    };
    if chain.is_empty() {
        return invalid(vec!["chain must be a non-empty list of mandates".into()]);
    }

    let mut effective: Option<SecurityTier> = None;
    let mut max_depth = u64::MAX; // the smallest sub_delegation.max_depth of the ancestors so far
    let mut parent: Option<&Map<String, Value>> = None;
    for (i, item) in chain.iter().enumerate() {
        let at = |error: String| format!("mandate[{i}]: {error}");
        let Some(m) = item.as_object() else {
            return invalid(vec![at("not an object".into())]);
        };
        let shape = shape_errors(m);
        if !shape.is_empty() {
            return invalid(shape.into_iter().map(|e| at(e)).collect());
        }

        let mut errors = Vec::new();
        let slots_right;
        match parent {
            None => {
                if m.get("delegation_depth")
                    .is_some_and(|d| as_uint(d) != Some(0))
                {
                    errors.push(at("root must have delegation_depth 0".into()));
                }
                if m.contains_key("parent_mandate_id") {
                    errors.push(at("root must not have parent_mandate_id".into()));
                }
                slots_right = m.contains_key("human_composite_sig")
                    && !m.contains_key("delegator_composite_sig");
                if !slots_right {
                    errors.push(at(
                        "root must carry human_composite_sig and no delegator_composite_sig".into(),
                    ));
                }
            }
            Some(p) => {
                let expected_depth = p.get("delegation_depth").and_then(as_uint).unwrap_or(0) + 1;
                let depth = m.get("delegation_depth").and_then(as_uint);
                if depth != Some(expected_depth) {
                    errors.push(at(format!("delegation_depth must be {expected_depth}")));
                }
                if m.get("parent_mandate_id") != p.get("mandate_id") {
                    errors.push(at(
                        "parent_mandate_id must equal the parent mandate_id".into()
                    ));
                }
                slots_right = m.contains_key("delegator_composite_sig")
                    && !m.contains_key("human_composite_sig");
                if !slots_right {
                    errors.push(at(
                        "sub-mandate must carry delegator_composite_sig and no human_composite_sig"
                            .into(),
                    ));
                }
                let policy = p
                    .get("sub_delegation")
                    .and_then(Value::as_object)
                    .filter(|policy| policy.get("permitted") == Some(&Value::Bool(true)));
                match policy {
                    None => errors.push(at("parent does not permit sub-delegation".into())),
                    Some(policy) => {
                        max_depth =
                            max_depth.min(policy.get("max_depth").and_then(as_uint).unwrap_or(0))
                    }
                }
                if let Some(d) = depth.filter(|d| *d > max_depth) {
                    errors.push(at(format!(
                        "delegation_depth {d} exceeds sub_delegation.max_depth {max_depth}"
                    )));
                }
                if m.get("human_id") != p.get("human_id") {
                    errors.push(at("human_id differs from the parent".into()));
                }
                if instant(m, "valid_from") < instant(p, "valid_from") {
                    errors.push(at("valid_from is before the parent valid_from".into()));
                }
                if instant(m, "valid_until") > instant(p, "valid_until") {
                    errors.push(at("valid_until is after the parent valid_until".into()));
                }
                if let Some(e) = attenuation_error(scope_of(p), scope_of(m)) {
                    errors.push(at(e));
                }
                if let Some(parent_rank) = p
                    .get("minimum_security_tier")
                    .and_then(Value::as_str)
                    .and_then(tier_rank)
                {
                    let child_rank = m
                        .get("minimum_security_tier")
                        .and_then(Value::as_str)
                        .and_then(tier_rank);
                    if !child_rank.is_some_and(|r| r >= parent_rank) {
                        errors.push(at("minimum_security_tier is below the parent".into()));
                    }
                }
            }
        }

        if m.get("mandate_id")
            .and_then(Value::as_str)
            .is_some_and(|id| revoked_mandate_ids.contains(id))
        {
            errors.push(at("revoked".into()));
        }
        if instant(m, "valid_from") > now {
            errors.push(at("not yet valid at the verification time".into()));
        }
        if instant(m, "valid_until") < now {
            errors.push(at("expired at the verification time".into()));
        }

        // The signature is the costly check; only a mandate whose slots are right can have the right one.
        if slots_right {
            let sig_error = match parent {
                None => mandate_sig_error(
                    CTX_DELEGATION,
                    m,
                    "human_composite_sig",
                    Some(&keys.human_keys),
                    "human_keys",
                    now,
                ),
                Some(p) => {
                    let agent_id = p.get("agent_id").and_then(Value::as_str).unwrap_or("");
                    mandate_sig_error(
                        CTX_SUB_MANDATE,
                        m,
                        "delegator_composite_sig",
                        keys.agent_keys.get(agent_id).map(Vec::as_slice),
                        &format!("agent_keys of {agent_id}"),
                        now,
                    )
                }
            };
            if let Some(e) = sig_error {
                errors.push(at(e));
            }
        }
        if !errors.is_empty() {
            return invalid(errors);
        }

        if let Some(tier) = m
            .get("minimum_security_tier")
            .and_then(Value::as_str)
            .and_then(SecurityTier::parse)
        {
            effective = Some(match effective {
                None => tier,
                Some(current) => max_tier(current, tier),
            });
        }
        parent = Some(m);
    }
    MandateChainResult {
        valid: true,
        errors: Vec::new(),
        depth: chain.len() - 1,
        effective_tier: effective,
    }
}

#[derive(Debug, Clone)]
pub struct RevocationOutcome {
    pub revoked: bool,
    pub reason: Option<String>,
}

/// Mark a mandate as revoked. Mutates `revoked_mandate_ids`. Non-revocable
/// mandates are returned as `revoked: false` with a reason string.
pub fn revoke_delegation(
    mandate: &Value,
    revoked_mandate_ids: &mut HashSet<String>,
) -> RevocationOutcome {
    if !mandate
        .get("revocable")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return RevocationOutcome {
            revoked: false,
            reason: Some("Mandate is not revocable".into()),
        };
    }
    if let Some(id) = mandate.get("mandate_id").and_then(Value::as_str) {
        revoked_mandate_ids.insert(id.to_string());
    }
    RevocationOutcome {
        revoked: true,
        reason: None,
    }
}

pub struct InteractionParams<'a> {
    pub interaction_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub counterparty_agent_id: &'a str,
    pub public_layer: Value,
    pub private_layer_hash: &'a str,
    pub mandate_id: &'a str,
}

pub fn generate_interaction_record(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: InteractionParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "interaction_id": params.interaction_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "counterparty_agent_id": params.counterparty_agent_id,
        "public_layer": params.public_layer,
        "private_layer_hash": params.private_layer_hash,
        "mandate_id": params.mandate_id,
        "timestamp": utc_now_iso(),
    });
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        CTX_DELEGATION,
        canonical.as_bytes(),
        classical_key,
        pq_key,
    )?;
    let mut out = payload;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "composite_sig".into(),
            serde_json::to_value(&composite)
                .map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A scope entry that is not an object, or whose domain is not a string, is "not
    /// comparable": a rejection, never a silent "within the parent".
    #[test]
    fn attenuation_error_rejects_malformed_entries() {
        let ok = json!({"domain": "email", "actions_permitted": ["read"]});
        for (parent, child) in [
            (vec![json!("email")], vec![ok.clone()]),
            (
                vec![json!({"domain": 5, "actions_permitted": ["read"]})],
                vec![ok.clone()],
            ),
            (vec![ok.clone()], vec![json!(null)]),
            (
                vec![ok.clone()],
                vec![json!({"domain": ["email"], "actions_permitted": []})],
            ),
        ] {
            let error =
                attenuation_error(&parent, &child).expect("malformed entries must not pass");
            assert!(
                error.contains("authority_scope") && error.contains("not comparable"),
                "{error}"
            );
        }
        assert_eq!(attenuation_error(&[ok.clone()], &[ok]), None);
    }

    /// Limits compare as exact integers whatever their JSON representation; a fraction is
    /// not comparable.
    #[test]
    fn limits_compare_exactly_across_representations() {
        let entry =
            |n: Value| vec![json!({"domain": "api", "actions_permitted": [], "limits": {"n": n}})];
        let parent = entry(json!(9007199254740995u64)); // 2^53 + 3, which f64 rounds to 2^53 + 4
        assert!(attenuation_error(&parent, &entry(json!(9007199254740996.0))).is_some());
        assert!(attenuation_error(&parent, &entry(json!(9007199254740996u64))).is_some());
        assert_eq!(
            attenuation_error(&parent, &entry(json!(9007199254740994.0))),
            None
        );
        assert_eq!(attenuation_error(&parent, &entry(json!(-1))), None);
        assert!(attenuation_error(&parent, &entry(json!(1.5))).is_some());
        assert!(attenuation_error(&entry(json!(1.5)), &entry(json!(1))).is_some());
    }
}
