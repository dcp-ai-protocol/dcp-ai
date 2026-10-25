//! EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 4): producers of new candidate evidence.
//!
//! - [`sign_payload`] signs one artifact `{payload, payload_hash, composite_sig}`. It signs no profile:
//!   the artifact has the form and the domain context of today's artifacts.
//! - [`sign_bundle`] assembles a bundle whose new manifest commits to
//!   `canonicalization_profile: "dcp-jcs-v2"`, and signs that manifest.
//!
//! Inputs are [`CandidateInput::Bytes`] (original bytes, checked by the phase 1 ingress before anything
//! parses them: the way for JSON received from elsewhere) or [`CandidateInput::Value`] (a
//! `serde_json::Value`: integers in range, and integral floats normalized to the integer). Every part is
//! kept whole as a `Value`, extensions of an artifact or a `composite_sig` included: no typed struct
//! drops a member. Rejections of this experimental contract are [`ProduceError::Reject`], returned before
//! any signer is called; they are not a normative activation of the profile. Errors of the key or the
//! provider stay today's errors. Nothing here relabels received evidence or recomputes a received
//! commitment; `build_bundle_v2`, `sign_bundle_v2` and the verifiers are unchanged.

use serde_json::{json, Map, Value};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{classical_only_sign, composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::CryptoProvider;
use crate::v2::domain_separation::*;
use crate::v2::dual_hash::{dual_hash_canonical, dual_merkle_root, sha256_hex};
use crate::v2::experimental_candidate_ingress::{experimental_candidate_ingress, CandidateIngressOutcome};
use crate::v2::experimental_candidate_router::{CandidateRoute, CandidateRouter, CandidateRouterConfig, HistoricalAdapter};
use crate::v2::lifecycle::utc_now_iso;
use crate::v2::session_nonce::{is_valid_session_nonce, parse_rfc3339_millis, verify_session_binding};
use crate::v2::signed_payload::prepare_payload;
use crate::v2::verify_bundle::provider_for_alg;

const MAX_SAFE: i64 = 9_007_199_254_740_991; // 2^53-1
const MAX_DEPTH: usize = 64;

/// Original bytes, or a host value.
#[derive(Debug, Clone)]
pub enum CandidateInput {
    Bytes(Vec<u8>),
    Value(Value),
}

/// The signing keys: hybrid with `pq`, classical-only without.
pub struct CandidateKeys {
    pub classical: CompositeKeyInfo,
    pub pq: Option<CompositeKeyInfo>,
}

/// A rejection of the experimental producer contract: `part` names the input; `offset` is a byte
/// offset in that input's bytes, `path` a JSON Pointer in its value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProduceRejection {
    pub class: String,
    pub part: String,
    pub path: Option<String>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProduceError {
    #[error("{} in {}", .0.class, .0.part)]
    Reject(ProduceRejection),
    /// A misuse of the API (a context outside the closed set, a key without a kid); never the data.
    #[error("experimental candidate producer: {0}")]
    Usage(String),
    /// The provider's or the key's error, as today.
    #[error("{0}")]
    Provider(String),
    #[error("experimental candidate producer: internal error: {0}")]
    Internal(String),
}

fn reject(class: &str, part: &str, path: Option<String>) -> ProduceError {
    ProduceError::Reject(ProduceRejection { class: class.into(), part: part.into(), path, offset: None })
}

pub struct ProducedPayload {
    pub bytes: Vec<u8>,
    pub signed_payload: Value,
}

pub struct ProducedBundle {
    pub bytes: Vec<u8>,
    pub signed_bundle: Value,
}

pub struct BundleParts {
    pub rpr: CandidateInput,
    pub passport: CandidateInput,
    pub intent: CandidateInput,
    pub policy_decision: CandidateInput,
    pub audit_entries: Vec<CandidateInput>,
    pub pq_checkpoints: Vec<CandidateInput>,
}

pub struct BundleSigner {
    pub signer_type: String,
    pub signer_id: String,
    pub keys: CandidateKeys,
}

/// With an expiry, `session_issued_at` is required: the start is never stamped from the clock.
/// `created_at` goes outside every signature and is not protected; `None` is the clock. `dual_hash`
/// adds the SHA3 root and `hash_alg` `sha256+sha3-256`.
#[derive(Default)]
pub struct BundleOptions {
    pub session_nonce: String,
    pub session_issued_at: Option<String>,
    pub session_expires_at: Option<String>,
    pub intended_verifier: Option<String>,
    pub created_at: Option<String>,
    pub dual_hash: bool,
}

fn pointer(path: &str, key: &str) -> String {
    format!("{}/{}", path, key.replace('~', "~0").replace('/', "~1"))
}

/// A host value checked against the exact domain and copied, at most 64 levels deep.
fn exact_copy(v: &Value, part: &str, path: &str, depth: usize) -> Result<Value, ProduceError> {
    let at = || Some(path.to_string());
    match v {
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(v.clone()),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                // Bounds compared directly: i64::MIN has no absolute value.
                return if !(-MAX_SAFE..=MAX_SAFE).contains(&i) { Err(reject("NUMBER_OUT_OF_RANGE", part, at())) } else { Ok(json!(i)) };
            }
            if n.as_u64().is_some() {
                return Err(reject("NUMBER_OUT_OF_RANGE", part, at()));
            }
            match n.as_f64() {
                Some(f) if !f.is_finite() => Err(reject("NUMBER_NOT_FINITE", part, at())),
                Some(f) if f.fract() != 0.0 => Err(reject("NUMBER_NOT_INTEGER", part, at())),
                Some(f) if f.abs() > MAX_SAFE as f64 => Err(reject("NUMBER_OUT_OF_RANGE", part, at())),
                Some(f) => Ok(json!(f as i64)), // 1.0 is 1, -0.0 is 0
                None => Err(reject("TYPE_UNSUPPORTED", part, at())),
            }
        }
        Value::Array(a) => {
            if depth + 1 > MAX_DEPTH {
                return Err(reject("DEPTH_EXCEEDED", part, at()));
            }
            let mut out = Vec::with_capacity(a.len());
            for (i, x) in a.iter().enumerate() {
                out.push(exact_copy(x, part, &pointer(path, &i.to_string()), depth + 1)?);
            }
            Ok(Value::Array(out))
        }
        Value::Object(o) => {
            if depth + 1 > MAX_DEPTH {
                return Err(reject("DEPTH_EXCEEDED", part, at()));
            }
            let mut out = Map::new();
            for (k, x) in o {
                out.insert(k.clone(), exact_copy(x, part, &pointer(path, k), depth + 1)?);
            }
            Ok(Value::Object(out))
        }
    }
}

fn read_input(input: &CandidateInput, part: &str, path: &str) -> Result<Value, ProduceError> {
    match input {
        CandidateInput::Bytes(b) => match experimental_candidate_ingress(b).map_err(|e| ProduceError::Internal(e.to_string()))? {
            CandidateIngressOutcome::Accept { value, .. } => Ok(value),
            CandidateIngressOutcome::Reject { class, offset } => Err(ProduceError::Reject(ProduceRejection {
                class: class.as_str().into(),
                part: part.into(),
                path: (!path.is_empty()).then(|| path.to_string()),
                offset: Some(offset),
            })),
        },
        CandidateInput::Value(v) => exact_copy(v, part, path, 0),
    }
}

/// The pointer of the first container that opens a level beyond `limit`, or `None`.
fn too_deep(v: &Value, limit: usize, path: &str, depth: usize) -> Option<String> {
    let children: Vec<(String, &Value)> = match v {
        Value::Array(a) => a.iter().enumerate().map(|(i, x)| (i.to_string(), x)).collect(),
        Value::Object(o) => o.iter().map(|(k, x)| (k.clone(), x)).collect(),
        _ => return None,
    };
    if depth + 1 > limit {
        return Some(path.to_string());
    }
    children.into_iter().find_map(|(k, x)| too_deep(x, limit, &pointer(path, &k), depth + 1))
}

fn check_keys(k: &CandidateKeys) -> Result<(), ProduceError> {
    for key in std::iter::once(&k.classical).chain(k.pq.iter()) {
        if key.kid.is_empty() || key.alg.is_empty() || key.secret_key_b64.is_empty() {
            return Err(ProduceError::Usage("a key needs a kid, an alg and a secret key".into()));
        }
    }
    Ok(())
}

const CONTEXTS: [&str; 19] = [
    CTX_AGENT_PASSPORT, CTX_RESPONSIBLE_PRINCIPAL, CTX_INTENT, CTX_POLICY_DECISION, CTX_AUDIT_EVENT, CTX_BUNDLE,
    CTX_REVOCATION, CTX_KEY_ROTATION, CTX_PROOF_OF_POSSESSION, CTX_JURISDICTION_ATTESTATION, CTX_HUMAN_CONFIRMATION,
    CTX_MULTI_PARTY_AUTH, CTX_LIFECYCLE, CTX_SUCCESSION, CTX_DISPUTE, CTX_RIGHTS, CTX_DELEGATION, CTX_AWARENESS,
    CTX_SUB_MANDATE,
];

/// How the signers find a provider; the public functions use the built-in providers.
pub(crate) type Providers<'a> = &'a dyn Fn(&str) -> Result<Box<dyn CryptoProvider>, String>;

fn builtin(alg: &str) -> Result<Box<dyn CryptoProvider>, String> {
    provider_for_alg(alg)
}

fn sign_with(providers: Providers, context: &str, data: &[u8], k: &CandidateKeys) -> Result<Value, ProduceError> {
    let classical = providers(&k.classical.alg).map_err(ProduceError::Provider)?;
    let cs = match &k.pq {
        Some(pq) => {
            let pq_provider = providers(&pq.alg).map_err(ProduceError::Provider)?;
            composite_sign(classical.as_ref(), pq_provider.as_ref(), context, data, &k.classical, pq)
        }
        None => classical_only_sign(classical.as_ref(), context, data, &k.classical),
    }
    .map_err(|e| ProduceError::Provider(e.to_string()))?;
    serde_json::to_value(cs).map_err(|e| ProduceError::Internal(e.to_string()))
}

fn canonical(v: &Value) -> Result<Vec<u8>, ProduceError> {
    canonicalize_v2(v).map(String::into_bytes).map_err(ProduceError::Internal)
}

fn payload_hash(payload: &Value) -> Result<(Vec<u8>, String), ProduceError> {
    prepare_payload(payload).map_err(ProduceError::Internal)
}

/// EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 4): signs one artifact under `context` (one of
/// the `CTX_*` constants) over the canonical bytes of the payload's exact value. The payload must be an
/// object and the artifact must fit in 64 levels (the payload in 63): its own bytes go through the ingress.
pub fn sign_payload(context: &str, input: &CandidateInput, keys: &CandidateKeys) -> Result<ProducedPayload, ProduceError> {
    sign_payload_with(&builtin, context, input, keys)
}

pub(crate) fn sign_payload_with(providers: Providers, context: &str, input: &CandidateInput, keys: &CandidateKeys) -> Result<ProducedPayload, ProduceError> {
    if !CONTEXTS.contains(&context) {
        return Err(ProduceError::Usage("context must be one of the DCP contexts".into()));
    }
    check_keys(keys)?;
    let payload = read_input(input, "payload", "")?;
    if !payload.is_object() {
        return Err(reject("TYPE_UNSUPPORTED", "payload", Some(String::new())));
    }
    if let Some(deep) = too_deep(&payload, MAX_DEPTH - 1, "", 0) {
        return Err(reject("DEPTH_EXCEEDED", "payload", Some(deep)));
    }
    let (canonical_bytes, hash) = payload_hash(&payload)?;

    let composite = sign_with(providers, context, &canonical_bytes, keys)?;

    let signed = json!({"payload": payload, "payload_hash": hash, "composite_sig": composite});
    let bytes = canonical(&signed)?;
    match experimental_candidate_ingress(&bytes) {
        Ok(CandidateIngressOutcome::Accept { canonical_sha256, .. }) if canonical_sha256 == sha256_hex(&bytes) => {}
        _ => return Err(ProduceError::Internal("a signed artifact the candidate ingress does not give back as is".into())),
    }
    Ok(ProducedPayload { bytes, signed_payload: signed })
}

fn read_artifact(input: &CandidateInput, part: &str) -> Result<Value, ProduceError> {
    let a = read_input(input, part, "")?;
    let Some(o) = a.as_object() else { return Err(reject("TYPE_UNSUPPORTED", part, Some(String::new()))) };
    let Some(payload) = o.get("payload").filter(|p| p.is_object()) else {
        return Err(reject("TYPE_UNSUPPORTED", part, Some("/payload".into())));
    };
    if !o.get("composite_sig").is_some_and(Value::is_object) {
        return Err(reject("TYPE_UNSUPPORTED", part, Some("/composite_sig".into())));
    }
    // The received commitment is checked, never recomputed into the artifact.
    if o.get("payload_hash").and_then(Value::as_str) != Some(payload_hash(payload)?.1.as_str()) {
        return Err(reject("COMMITMENT_MISMATCH", part, Some("/payload_hash".into())));
    }
    Ok(a)
}

fn optional(v: &Option<String>, path: &str) -> Result<Option<String>, ProduceError> {
    match v {
        Some(s) if s.is_empty() => Err(ProduceError::Usage(format!("options{} must be a non-empty string", path))),
        other => Ok(other.clone()),
    }
}

/// EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 4): assembles a bundle from its parts and signs
/// a new manifest that commits to `canonicalization_profile: "dcp-jcs-v2"`. Every part is kept whole:
/// members it does not know are kept; those outside a payload, an entry, a checkpoint or the manifest
/// are not signed, so their integrity is not claimed. An empty audit trail has `audit_count` 0 and the
/// root of 64 zeros.
pub fn sign_bundle(parts: &BundleParts, signer: &BundleSigner, options: &BundleOptions) -> Result<ProducedBundle, ProduceError> {
    sign_bundle_with(&builtin, parts, signer, options)
}

pub(crate) fn sign_bundle_with(providers: Providers, parts: &BundleParts, signer: &BundleSigner, options: &BundleOptions) -> Result<ProducedBundle, ProduceError> {
    if signer.signer_type.is_empty() || signer.signer_id.is_empty() {
        return Err(ProduceError::Usage("signer type and id must be non-empty".into()));
    }
    check_keys(&signer.keys)?;
    if !is_valid_session_nonce(&options.session_nonce) {
        return Err(reject("SESSION_INVALID", "options", Some("/session_nonce".into())));
    }
    let issued_at = optional(&options.session_issued_at, "/session_issued_at")?;
    let expires_at = optional(&options.session_expires_at, "/session_expires_at")?;
    let intended = optional(&options.intended_verifier, "/intended_verifier")?;
    let created_at = match optional(&options.created_at, "/created_at")? {
        Some(c) if parse_rfc3339_millis(&c).is_none() => return Err(ProduceError::Usage("options.created_at must be an RFC 3339 date".into())),
        Some(c) => c,
        None => utc_now_iso(),
    };
    let issued = match &issued_at {
        Some(s) => Some(parse_rfc3339_millis(s).ok_or_else(|| reject("SESSION_INVALID", "options", Some("/session_issued_at".into())))?),
        None => None,
    };
    if let Some(s) = &expires_at {
        let expires = parse_rfc3339_millis(s).ok_or_else(|| reject("SESSION_INVALID", "options", Some("/session_expires_at".into())))?;
        let Some(issued) = issued else { return Err(reject("SESSION_ISSUED_AT_REQUIRED", "options", Some("/session_issued_at".into()))) };
        if issued > expires {
            return Err(reject("SESSION_INVALID", "options", Some("/session_expires_at".into())));
        }
    }

    let named = [
        (&parts.rpr, "rpr", "responsible_principal_record", "rpr_hash"),
        (&parts.passport, "passport", "agent_passport", "passport_hash"),
        (&parts.intent, "intent", "intent", "intent_hash"),
        (&parts.policy_decision, "policy_decision", "policy_decision", "policy_hash"),
    ];
    let artifacts = named.iter().map(|(input, part, _, _)| read_artifact(input, part)).collect::<Result<Vec<_>, _>>()?;
    let mut entries = Vec::new();
    for (i, input) in parts.audit_entries.iter().enumerate() {
        let e = read_input(input, "audit_entries", &format!("/{}", i))?;
        if !e.is_object() {
            return Err(reject("TYPE_UNSUPPORTED", "audit_entries", Some(format!("/{}", i))));
        }
        entries.push(e);
    }
    let mut checkpoints = Vec::new();
    for (i, input) in parts.pq_checkpoints.iter().enumerate() {
        let c = read_input(input, "pq_checkpoints", &format!("/{}", i))?;
        if !c.get("checkpoint_id").is_some_and(Value::is_string) {
            return Err(reject("TYPE_UNSUPPORTED", "pq_checkpoints", Some(format!("/{}", i))));
        }
        checkpoints.push(c);
    }

    // The chain is checked, never inferred or repaired: a new chain starts at GENESIS.
    let mut leaves = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        let expected = if i == 0 { "GENESIS".to_string() } else { format!("sha256:{}", sha256_hex(&canonical(&entries[i - 1])?)) };
        if e.get("prev_hash").and_then(Value::as_str) != Some(expected.as_str()) {
            let class = if i == 0 { "CHAIN_NOT_GENESIS" } else { "CHAIN_BREAK" };
            return Err(reject(class, "audit_entries", Some(format!("/{}/prev_hash", i))));
        }
        leaves.push(dual_hash_canonical(&canonicalize_v2(e).map_err(ProduceError::Internal)?));
    }
    let bound: Vec<Value> = artifacts.iter().map(|a| a["payload"].clone()).chain(entries.iter().cloned()).chain(checkpoints.iter().cloned()).collect();
    let binding = verify_session_binding(&bound);
    if !binding.valid || binding.nonce.as_deref() != Some(options.session_nonce.as_str()) {
        return Err(ProduceError::Reject(ProduceRejection { class: "SESSION_INVALID".into(), part: "parts".into(), path: None, offset: None }));
    }
    if artifacts[0]["payload"].get("human_id").and_then(Value::as_str) != Some(signer.signer_id.as_str()) {
        return Err(reject("SIGNER_MISMATCH", "signer", Some("/signer_id".into())));
    }

    let zeros = "0".repeat(64);
    let roots = dual_merkle_root(&leaves);
    let mut manifest = Map::new();
    manifest.insert("session_nonce".into(), json!(options.session_nonce));
    for ((_, _, _, hash_key), a) in named.iter().zip(&artifacts) {
        manifest.insert((*hash_key).into(), a["payload_hash"].clone());
    }
    manifest.insert("audit_merkle_root".into(), json!(format!("sha256:{}", roots.as_ref().map_or(zeros.as_str(), |r| r.sha256.as_str()))));
    manifest.insert("audit_count".into(), json!(entries.len()));
    manifest.insert("canonicalization_profile".into(), json!("dcp-jcs-v2"));
    if options.dual_hash {
        manifest.insert("audit_merkle_root_secondary".into(), json!(format!("sha3-256:{}", roots.as_ref().map_or(zeros.as_str(), |r| r.sha3_256.as_str()))));
    }
    if !checkpoints.is_empty() {
        manifest.insert("pq_checkpoints".into(), Value::Array(checkpoints.iter().map(|c| c["checkpoint_id"].clone()).collect()));
    }
    for (key, value) in [("session_issued_at", &issued_at), ("session_expires_at", &expires_at), ("intended_verifier", &intended)] {
        if let Some(v) = value {
            manifest.insert(key.into(), json!(v));
        }
    }
    let manifest = Value::Object(manifest);
    let mut bundle = Map::new();
    bundle.insert("dcp_bundle_version".into(), json!("2.0"));
    bundle.insert("manifest".into(), manifest.clone());
    for ((_, _, member, _), a) in named.iter().zip(artifacts) {
        bundle.insert((*member).into(), a);
    }
    bundle.insert("audit_entries".into(), Value::Array(entries));
    if !checkpoints.is_empty() {
        bundle.insert("pq_checkpoints".into(), Value::Array(checkpoints));
    }
    let bundle = Value::Object(bundle);
    let keys = &signer.keys;
    let kids: Vec<Value> = std::iter::once(&keys.classical).chain(keys.pq.iter()).map(|k| json!(k.kid)).collect();
    let signature = |manifest_hash: &str, composite: Value| {
        json!({
            "hash_alg": if options.dual_hash { "sha256+sha3-256" } else { "sha256" },
            "created_at": created_at,
            "signer": {"type": signer.signer_type, "id": signer.signer_id, "kids": kids},
            "manifest_hash": manifest_hash,
            "composite_sig": composite,
        })
    };
    // The final unit's skeleton, its signature included, must fit in 64 levels before anything is signed.
    let entry = |k: &CompositeKeyInfo| json!({"alg": k.alg, "kid": k.kid, "sig_b64": ""});
    let placeholder = json!({
        "classical": entry(&keys.classical),
        "pq": keys.pq.as_ref().map(entry),
        "binding": if keys.pq.is_some() { "pq_over_classical" } else { "classical_only" },
    });
    let skeleton = json!({"bundle": bundle, "signature": signature(&format!("sha256:{}", zeros), placeholder)});
    if let Some(deep) = too_deep(&skeleton, MAX_DEPTH, "", 0) {
        return Err(reject("DEPTH_EXCEEDED", "unit", Some(deep)));
    }
    let manifest_bytes = canonical(&manifest)?;

    let composite = sign_with(providers, CTX_BUNDLE, &manifest_bytes, keys)?;

    let signed = json!({"bundle": bundle, "signature": signature(&format!("sha256:{}", sha256_hex(&manifest_bytes)), composite)});
    let bytes = canonical(&signed)?;
    let router = CandidateRouter::new(CandidateRouterConfig {
        transport: "bare".into(),
        accepted_profiles: json!(["dcp-jcs-v2"]),
        historical: Some(HistoricalAdapter::serde_json_from_slice()),
    })
    .map_err(|e| ProduceError::Internal(e.to_string()))?;
    match router.route(&bytes) {
        Ok(CandidateRoute::Candidate { canonical_sha256, .. }) if canonical_sha256 == sha256_hex(&bytes) => {}
        _ => return Err(ProduceError::Internal("a produced unit the candidate route does not give back as is".into())),
    }
    Ok(ProducedBundle { bytes, signed_bundle: signed })
}

#[cfg(test)]
mod tests {
    //! The producers, as the TypeScript ones: positives verified by the phase 3 bytes verifier and
    //! refused by today's API; every rejection with zero calls to the real signers (counted by wrapping
    //! the real providers; each call still signs); extensions kept as Value.
    use super::*;
    use crate::providers::{ed25519::Ed25519Provider, ml_dsa_65::MlDsa65Provider};
    use crate::v2::crypto_provider::{CryptoError, GeneratedKeypair};
    use crate::v2::experimental_candidate_verify::CandidateVerifier;
    use crate::v2::session_nonce::generate_session_nonce;
    use crate::v2::types::VerifierPolicy;
    use crate::v2::verify_bundle::verify_signed_bundle_v2_at;
    use std::cell::Cell;

    const NOW: i64 = 1_792_886_400_000; // 2026-10-25T00:00:00Z

    thread_local! { static SIGNS: Cell<usize> = const { Cell::new(0) }; }

    struct Counting(Box<dyn CryptoProvider>);
    impl CryptoProvider for Counting {
        fn alg(&self) -> &str { self.0.alg() }
        fn key_size(&self) -> usize { self.0.key_size() }
        fn sig_size(&self) -> usize { self.0.sig_size() }
        fn is_constant_time(&self) -> bool { self.0.is_constant_time() }
        fn generate_keypair(&self) -> Result<GeneratedKeypair, CryptoError> { self.0.generate_keypair() }
        fn sign(&self, m: &[u8], sk: &str) -> Result<Vec<u8>, CryptoError> {
            SIGNS.with(|s| s.set(s.get() + 1));
            self.0.sign(m, sk)
        }
        fn verify(&self, m: &[u8], s: &[u8], pk: &str) -> Result<bool, CryptoError> { self.0.verify(m, s, pk) }
    }
    fn counting(alg: &str) -> Result<Box<dyn CryptoProvider>, String> {
        Ok(Box::new(Counting(provider_for_alg(alg)?)))
    }
    fn signs() -> usize { SIGNS.with(Cell::get) }
    fn reset() { SIGNS.with(|s| s.set(0)) }

    fn key(p: &dyn CryptoProvider, alg: &str) -> CompositeKeyInfo {
        let k = p.generate_keypair().unwrap();
        CompositeKeyInfo { kid: k.kid, alg: alg.into(), secret_key_b64: k.secret_key_b64, public_key_b64: k.public_key_b64 }
    }
    fn keys(pq: bool) -> CandidateKeys {
        CandidateKeys { classical: key(&Ed25519Provider, "ed25519"), pq: pq.then(|| key(&MlDsa65Provider, "ml-dsa-65")) }
    }
    fn copy(k: &CandidateKeys) -> CandidateKeys {
        let c = |x: &CompositeKeyInfo| CompositeKeyInfo { kid: x.kid.clone(), alg: x.alg.clone(), secret_key_b64: x.secret_key_b64.clone(), public_key_b64: x.public_key_b64.clone() };
        CandidateKeys { classical: c(&k.classical), pq: k.pq.as_ref().map(c) }
    }
    fn sha(v: &Value) -> String { format!("sha256:{}", sha256_hex(canonicalize_v2(v).unwrap().as_bytes())) }

    struct Scenario { parts: BundleParts, signer: BundleSigner, options: BundleOptions, entries: Vec<Value>, intent: Value }

    #[derive(Default)]
    struct Opts { classical: bool, target: Option<Value>, routine: bool, no_entries: bool, as_bytes: bool }

    fn scenario(principal: &CandidateKeys, agent: &CandidateKeys, o: Opts) -> Scenario {
        let nonce = generate_session_nonce();
        let strip = |k: &CandidateKeys| { let mut c = copy(k); if o.classical { c.pq = None; } c };
        let (pk, ak) = (strip(principal), strip(agent));
        let entries_of = |k: &CandidateKeys, expires: Value| -> Value {
            Value::Array(std::iter::once(&k.classical).chain(k.pq.iter()).map(|x| json!({"kid": x.kid, "alg": x.alg, "public_key_b64": x.public_key_b64,
                "created_at": "2026-10-21T00:00:00Z", "expires_at": expires, "status": "active"})).collect())
        };
        let rpr = json!({"dcp_version": "2.0", "human_id": "human:candidate-principal", "session_nonce": nonce, "legal_name": "Candidate Principal",
            "entity_type": "natural_person", "jurisdiction": "US-CA", "liability_mode": "owner_responsible", "override_rights": true,
            "issued_at": "2026-10-21T00:00:00Z", "expires_at": null, "contact": null, "binding_keys": entries_of(&pk, Value::Null)});
        let passport = json!({"dcp_version": "2.0", "agent_id": "agent:candidate-bot", "session_nonce": nonce, "keys": entries_of(&ak, json!("2099-12-31T18:59:59-05:00")),
            "principal_binding_reference": "human:candidate-principal", "capabilities": ["browse", "api_call"], "risk_tier": if o.routine { "low" } else { "medium" },
            "created_at": "2026-10-21T00:00:00Z", "status": "active"});
        let mut target = if o.routine { json!({"channel": "web"}) } else { json!({"channel": "email", "to": "bob@example.com", "domain": "example.com"}) };
        if let Some(Value::Object(extra)) = &o.target { for (k, v) in extra { target[k] = v.clone(); } }
        let intent = json!({"dcp_version": "2.0", "intent_id": "intent:candidate-001", "session_nonce": nonce, "agent_id": "agent:candidate-bot",
            "human_id": "human:candidate-principal", "timestamp": "2026-10-21T12:00:00Z", "action_type": if o.routine { "browse" } else { "send_email" },
            "target": target, "data_classes": if o.routine { json!(["none"]) } else { json!(["contact_info"]) },
            "estimated_impact": if o.routine { "low" } else { "medium" }, "requires_consent": false});
        let policy = json!({"dcp_version": "2.0", "intent_id": "intent:candidate-001", "session_nonce": nonce, "decision": "approve",
            "risk_score": if o.routine { 0 } else { 450 }, "reasons": ["Known recipient domain"], "required_confirmation": null,
            "applied_policy_hash": sha(&json!({"policy": "default"})), "timestamp": "2026-10-21T12:00:01Z"});
        let mut entries: Vec<Value> = Vec::new();
        for i in 0..if o.no_entries { 0 } else { 2 } {
            let prev = if i == 0 { json!("GENESIS") } else { json!(sha(&entries[i - 1])) };
            entries.push(json!({"dcp_version": "2.0", "audit_id": format!("audit:candidate-00{}", i + 1), "session_nonce": nonce, "prev_hash": prev,
                "hash_alg": "sha256", "timestamp": format!("2026-10-21T12:0{}:00Z", i + 1), "agent_id": "agent:candidate-bot",
                "human_id": "human:candidate-principal", "intent_id": "intent:candidate-001", "intent_hash": sha(&intent), "policy_decision": "approved",
                "outcome": "email_sent", "evidence": {"tool": "smtp", "result_ref": null, "evidence_hash": null}, "pq_checkpoint_ref": null}));
        }
        let artifact = |context: &str, payload: &Value, k: &CandidateKeys| {
            let r = sign_payload_with(&counting, context, &CandidateInput::Value(payload.clone()), k).unwrap();
            if o.as_bytes { CandidateInput::Bytes(r.bytes) } else { CandidateInput::Value(r.signed_payload) }
        };
        let parts = BundleParts {
            rpr: artifact(CTX_RESPONSIBLE_PRINCIPAL, &rpr, &pk),
            passport: artifact(CTX_AGENT_PASSPORT, &passport, &ak),
            intent: artifact(CTX_INTENT, &intent, &ak),
            policy_decision: artifact(CTX_POLICY_DECISION, &policy, &ak),
            audit_entries: entries.iter().map(|e| if o.as_bytes { CandidateInput::Bytes(serde_json::to_vec(e).unwrap()) } else { CandidateInput::Value(e.clone()) }).collect(),
            pq_checkpoints: vec![],
        };
        Scenario {
            parts,
            signer: BundleSigner { signer_type: "human".into(), signer_id: "human:candidate-principal".into(), keys: pk },
            options: BundleOptions { session_nonce: nonce, session_issued_at: Some("2026-10-21T00:00:00Z".into()),
                session_expires_at: Some("2099-12-31T23:59:59+05:00".into()), created_at: Some("2026-10-21T12:05:00Z".into()), ..Default::default() },
            entries, intent,
        }
    }

    fn produce_and_verify(s: &Scenario) -> Value {
        let out = sign_bundle_with(&counting, &s.parts, &s.signer, &s.options).unwrap();
        let verifier = CandidateVerifier::new(CandidateRouterConfig { transport: "bare".into(), accepted_profiles: json!(["dcp-jcs-v2"]),
            historical: Some(HistoricalAdapter::serde_json_from_slice()) }).unwrap();
        let r = verifier.verify_at(&out.bytes, &VerifierPolicy::default(), NOW).unwrap();
        let v = r.verification.unwrap();
        assert_eq!((r.entered, v.result.verified), ("dcp-jcs-v2", true), "{:?}", v.result.errors);
        let unit: Value = serde_json::from_slice(&out.bytes).unwrap();
        let today = verify_signed_bundle_v2_at(&unit, &VerifierPolicy::default(), NOW);
        assert!(!today.result.verified && today.result.errors.iter().any(|e| e == "Unknown canonicalization_profile: dcp-jcs-v2"));
        unit
    }

    fn rejected(run: impl FnOnce() -> Result<(), ProduceError>, class: &str, part: &str) -> ProduceRejection {
        reset();
        match run() {
            Err(ProduceError::Reject(r)) => {
                assert_eq!((r.class.as_str(), r.part.as_str()), (class, part), "{r:?}");
                assert_eq!(signs(), 0, "signer calls");
                r
            }
            other => panic!("{class}: {other:?}"),
        }
    }

    fn nest(n: usize, leaf: Value) -> Value { (0..n).fold(leaf, |v, _| json!([v])) }

    #[test]
    fn sign_payload_exact_value_without_a_profile() {
        let agent = keys(true);
        reset();
        let r = sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!({"a": 1, "b": "x"})), &agent).unwrap();
        assert_eq!(signs(), 2);
        assert!(!String::from_utf8_lossy(&r.bytes).contains("canonicalization_profile"));
        let long = format!("{{\"n\":1.{}}}", "0".repeat(800));
        let r = sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Bytes(long.into_bytes()), &agent).unwrap();
        assert!(String::from_utf8(r.bytes).unwrap().contains(r#""payload":{"n":1}"#));
        let r = sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!({"a": 1.0, "b": -0.0, "c": 9007199254740991u64})), &agent).unwrap();
        assert_eq!(r.signed_payload["payload"], json!({"a": 1, "b": 0, "c": 9007199254740991i64}));
        for (v, class) in [(json!(0.5), "NUMBER_NOT_INTEGER"), (json!(9007199254740992u64), "NUMBER_OUT_OF_RANGE"), (json!(1e21), "NUMBER_OUT_OF_RANGE"),
            (json!(u64::MAX), "NUMBER_OUT_OF_RANGE"), (json!(-9007199254740992i64), "NUMBER_OUT_OF_RANGE")] {
            let r = rejected(|| sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!({"n": v})), &agent).map(|_| ()), class, "payload");
            assert_eq!(r.path.as_deref(), Some("/n"));
        }
        let ok = sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!({"d": nest(62, json!(0))})), &agent).unwrap();
        assert!(matches!(experimental_candidate_ingress(&ok.bytes), Ok(CandidateIngressOutcome::Accept { .. })));
        rejected(|| sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!({"d": nest(63, json!(0))})), &agent).map(|_| ()), "DEPTH_EXCEEDED", "payload");
        rejected(|| sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!([1])), &agent).map(|_| ()), "TYPE_UNSUPPORTED", "payload");
        reset();
        assert!(matches!(sign_payload_with(&counting, "DCP-AI.v2.Unknown", &CandidateInput::Value(json!({})), &agent), Err(ProduceError::Usage(_))));
        assert_eq!(signs(), 0);
        let classical = CandidateKeys { classical: copy(&agent).classical, pq: None };
        reset();
        let r = sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!({"a": 1})), &classical).unwrap();
        assert_eq!((signs(), r.signed_payload["composite_sig"]["binding"].as_str()), (1, Some("classical_only")));
    }

    #[test]
    fn the_i64_limits_are_out_of_range_without_any_signer() {
        let (principal, agent) = (keys(true), keys(true));
        for n in [i64::MIN, i64::MAX, -9_007_199_254_740_992, 9_007_199_254_740_992] {
            let r = rejected(|| sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!({"n": n})), &agent).map(|_| ()), "NUMBER_OUT_OF_RANGE", "payload");
            assert_eq!(r.path.as_deref(), Some("/n"));
            let s = scenario(&principal, &agent, Opts::default());
            let mut entry = s.entries[1].clone();
            entry["n"] = json!(n);
            let parts = BundleParts { audit_entries: vec![CandidateInput::Value(s.entries[0].clone()), CandidateInput::Value(entry)], ..clone_parts(&s.parts) };
            let r = rejected(|| sign_bundle_with(&counting, &parts, &s.signer, &s.options).map(|_| ()), "NUMBER_OUT_OF_RANGE", "audit_entries");
            assert_eq!(r.path.as_deref(), Some("/1/n"));
        }
        for n in [-9_007_199_254_740_991i64, 9_007_199_254_740_991] {
            assert!(sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(json!({"n": n})), &agent).is_ok());
        }
    }

    #[test]
    fn bundles_verified_by_phase_3_and_refused_by_todays_api() {
        let (principal, agent) = (keys(true), keys(true));
        let unit = produce_and_verify(&scenario(&principal, &agent, Opts::default()));
        assert_eq!(unit["bundle"]["manifest"]["canonicalization_profile"], "dcp-jcs-v2");
        assert!(unit["bundle"]["manifest"].get("audit_merkle_root_secondary").is_none());
        produce_and_verify(&scenario(&principal, &agent, Opts { as_bytes: true, ..Default::default() }));
        let unit = produce_and_verify(&scenario(&principal, &agent, Opts { classical: true, routine: true, ..Default::default() }));
        assert_eq!(unit["signature"]["composite_sig"]["binding"], "classical_only");
        let mut s = scenario(&principal, &agent, Opts::default());
        s.options.dual_hash = true;
        let unit = produce_and_verify(&s);
        assert_eq!(unit["signature"]["hash_alg"], "sha256+sha3-256");
        let mut s = scenario(&principal, &agent, Opts { no_entries: true, ..Default::default() });
        s.options.dual_hash = true;
        let unit = produce_and_verify(&s);
        let m = &unit["bundle"]["manifest"];
        assert_eq!((m["audit_count"].as_u64(), m["audit_merkle_root"].as_str()), (Some(0), Some(format!("sha256:{}", "0".repeat(64)).as_str())));
        assert_eq!(m["audit_merkle_root_secondary"].as_str(), Some(format!("sha3-256:{}", "0".repeat(64)).as_str()));
    }

    #[test]
    fn checkpoint_extensions_boundaries_and_depth() {
        let (principal, agent) = (keys(true), keys(true));
        let mut s = scenario(&principal, &agent, Opts { target: Some(json!({"x_payload_ext": {"kept": 1}, "limits": {"max": 9007199254740991i64, "min": -9007199254740991i64},
            "keys": {"\u{1F600}": 2, "\u{E000}": 1}, "strings": ["\u{FEFF}start", "\u{FFFD}", "\u{2028}", "\u{0}"], "__proto__": "data"})), ..Default::default() });
        s.entries[1]["x_entry_ext"] = json!("kept");
        s.parts.audit_entries = s.entries.iter().cloned().map(CandidateInput::Value).collect();
        let mut intent = sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(s.intent.clone()), &agent).unwrap().signed_payload;
        intent["x_artifact_ext"] = json!("unsigned");
        intent["composite_sig"]["x_sig_ext"] = json!("unsigned");
        s.parts.intent = CandidateInput::Value(intent);
        let root = sign_bundle_with(&counting, &s.parts, &s.signer, &s.options).unwrap().signed_bundle["bundle"]["manifest"]["audit_merkle_root"].clone();
        let mut cp = json!({"checkpoint_id": "ckpt-1", "session_nonce": s.options.session_nonce, "x_checkpoint_ext": [1, 2], "merkle_root": root,
            "event_range": {"from_audit_id": s.entries[0]["audit_id"], "to_audit_id": s.entries[1]["audit_id"], "count": 2}});
        let (bytes, _) = prepare_payload(&cp).unwrap();
        cp["composite_sig"] = sign_with(&counting, CTX_AUDIT_EVENT, &bytes, &agent).unwrap();
        s.parts.pq_checkpoints = vec![CandidateInput::Value(cp)];
        let unit = produce_and_verify(&s);
        let b = &unit["bundle"];
        assert_eq!(b["manifest"]["pq_checkpoints"], json!(["ckpt-1"]));
        assert_eq!(b["intent"]["payload"]["target"]["x_payload_ext"], json!({"kept": 1}));
        assert_eq!((b["audit_entries"][1]["x_entry_ext"].as_str(), b["pq_checkpoints"][0]["x_checkpoint_ext"].clone()), (Some("kept"), json!([1, 2])));
        assert_eq!((b["intent"]["x_artifact_ext"].as_str(), b["intent"]["composite_sig"]["x_sig_ext"].as_str()), (Some("unsigned"), Some("unsigned")));
        let text = canonicalize_v2(&unit).unwrap();
        assert!(text.find("\"\u{E000}\"").unwrap() < text.find("\"\u{1F600}\"").unwrap(), "code point order");
        produce_and_verify(&scenario(&principal, &agent, Opts { target: Some(json!({"d": nest(59, json!("deep"))})), ..Default::default() })); // unit 64
        let s = scenario(&principal, &agent, Opts { target: Some(json!({"d": nest(60, json!("deep"))})), ..Default::default() }); // unit 65
        let r = rejected(|| sign_bundle_with(&counting, &s.parts, &s.signer, &s.options).map(|_| ()), "DEPTH_EXCEEDED", "unit");
        assert!(r.path.unwrap().starts_with("/bundle/intent/payload/target/d"));
    }

    #[test]
    fn rejections_before_any_signer() {
        let (principal, agent) = (keys(true), keys(true));
        let s = scenario(&principal, &agent, Opts::default());
        let run = |parts: &BundleParts, signer: &BundleSigner, options: &BundleOptions| sign_bundle_with(&counting, parts, signer, options).map(|_| ());
        let mut changed = sign_payload_with(&counting, CTX_INTENT, &CandidateInput::Value(s.intent.clone()), &agent).unwrap().signed_payload;
        changed["payload"]["action_type"] = json!("send_fax");
        let parts = BundleParts { intent: CandidateInput::Value(changed), ..clone_parts(&s.parts) };
        assert_eq!(rejected(|| run(&parts, &s.signer, &s.options), "COMMITMENT_MISMATCH", "intent").path.as_deref(), Some("/payload_hash"));
        let mut first = s.entries[0].clone();
        first["prev_hash"] = json!(sha(&json!({"earlier": "v1 evidence"})));
        let parts = BundleParts { audit_entries: vec![CandidateInput::Value(first), CandidateInput::Value(s.entries[1].clone())], ..clone_parts(&s.parts) };
        rejected(|| run(&parts, &s.signer, &s.options), "CHAIN_NOT_GENESIS", "audit_entries");
        let mut second = s.entries[1].clone();
        second["prev_hash"] = json!(format!("sha256:{}", "0".repeat(64)));
        let parts = BundleParts { audit_entries: vec![CandidateInput::Value(s.entries[0].clone()), CandidateInput::Value(second)], ..clone_parts(&s.parts) };
        rejected(|| run(&parts, &s.signer, &s.options), "CHAIN_BREAK", "audit_entries");
        let with = |f: &dyn Fn(&mut BundleOptions)| { let mut o = clone_options(&s.options); f(&mut o); o };
        rejected(|| run(&s.parts, &s.signer, &with(&|o| o.session_nonce = generate_session_nonce())), "SESSION_INVALID", "parts");
        rejected(|| run(&s.parts, &s.signer, &with(&|o| o.session_nonce = "x".into())), "SESSION_INVALID", "options");
        rejected(|| run(&s.parts, &s.signer, &with(&|o| o.session_issued_at = Some("2100-01-01T00:00:00Z".into()))), "SESSION_INVALID", "options");
        rejected(|| run(&s.parts, &s.signer, &with(&|o| o.session_issued_at = None)), "SESSION_ISSUED_AT_REQUIRED", "options");
        let other = BundleSigner { signer_type: "human".into(), signer_id: "human:else".into(), keys: copy(&s.signer.keys) };
        rejected(|| run(&s.parts, &other, &s.options), "SIGNER_MISMATCH", "signer");
        let entry = serde_json::to_string(&s.entries[1]).unwrap();
        for (data, class, offset) in [
            ([b"\xef\xbb\xbf".as_slice(), entry.as_bytes()].concat(), "BOM", Some(0)),
            (entry.as_bytes()[..entry.len() - 1].to_vec(), "SYNTAX", Some(entry.len() - 1)),
            (entry.replace(r#""outcome":"email_sent""#, r#""outcome":"email_sent","outcome":"email_sent""#).into_bytes(), "DUPLICATE_KEY", None),
            (entry.replace(r#""hash_alg":"sha256""#, r#""hash_alg":"sha256","n":1.5"#).into_bytes(), "NUMBER_NOT_INTEGER", None),
            ([&entry.as_bytes()[..20], b"\xff", &entry.as_bytes()[20..]].concat(), "UTF8_INVALID", Some(20)),
        ] {
            let parts = BundleParts { audit_entries: vec![CandidateInput::Value(s.entries[0].clone()), CandidateInput::Bytes(data)], ..clone_parts(&s.parts) };
            let r = rejected(|| run(&parts, &s.signer, &s.options), class, "audit_entries");
            assert_eq!(r.path.as_deref(), Some("/1"));
            if let Some(o) = offset { assert_eq!(r.offset, Some(o)); }
        }
    }

    fn clone_parts(p: &BundleParts) -> BundleParts {
        BundleParts { rpr: p.rpr.clone(), passport: p.passport.clone(), intent: p.intent.clone(), policy_decision: p.policy_decision.clone(),
            audit_entries: p.audit_entries.clone(), pq_checkpoints: p.pq_checkpoints.clone() }
    }
    fn clone_options(o: &BundleOptions) -> BundleOptions {
        BundleOptions { session_nonce: o.session_nonce.clone(), session_issued_at: o.session_issued_at.clone(), session_expires_at: o.session_expires_at.clone(),
            intended_verifier: o.intended_verifier.clone(), created_at: o.created_at.clone(), dual_hash: o.dual_hash }
    }
}
