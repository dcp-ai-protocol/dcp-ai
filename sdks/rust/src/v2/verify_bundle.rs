//! V2 signed bundle verification (spec/VERIFICATION.md, V2 checklist).

use std::collections::HashSet;
use std::fmt::Display;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;

use crate::providers::ed25519::Ed25519Provider;
use crate::providers::ml_dsa_65::MlDsa65Provider;
use crate::providers::slh_dsa_192f::SlhDsa192fProvider;
use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_verify, CompositeVerifyResult};
use crate::v2::composite_sig::CompositeSignature;
use crate::v2::crypto_provider::{derive_kid, CryptoProvider};
use crate::v2::domain_separation::{
    CTX_AGENT_PASSPORT, CTX_AUDIT_EVENT, CTX_BUNDLE, CTX_INTENT, CTX_POLICY_DECISION, CTX_RESPONSIBLE_PRINCIPAL,
};
use crate::crypto::merkle_root_from_hex_leaves;
use crate::v2::dual_hash;
use crate::v2::lifecycle::unix_now_millis;
use crate::v2::pq_checkpoint::audit_events_merkle_root;
use crate::v2::session_nonce::parse_rfc3339_millis;
use crate::v2::security_tier::{compute_security_tier, effective_verification_mode};
use crate::v2::types::VerifierPolicy;

/// Outcome of a V2 signed bundle verification.
#[derive(Debug, Default, Serialize)]
pub struct V2VerificationResult {
    pub verified: bool,
    pub dcp_version: String,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub classical_valid: bool,
    pub pq_valid: bool,
    pub session_binding_valid: bool,
    pub manifest_valid: bool,
    /// The mode the bundle was checked against: the stricter of the policy mode
    /// and the security tier's mode (spec §14.3).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub verification_mode: String,
    /// The security tier of the bundle's intent and policy decision.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub resolved_tier: String,
}

/// Verify a V2 signed bundle under the default verifier policy: structure,
/// manifest hashes, session nonce binding, the composite signatures over the
/// manifest and over each artifact, and the audit hash chain.
pub fn verify_signed_bundle_v2(signed_bundle: &Value) -> V2VerificationResult {
    verify_signed_bundle_v2_with_policy(signed_bundle, &VerifierPolicy::default())
}

/// Verify a V2 signed bundle against the stricter of the policy mode
/// (`default_mode`, or the `risk_overrides` entry for the passport's
/// `risk_tier`) and the security tier's mode (spec §14.3). Besides those two
/// fields, only these are enforced, as in the TypeScript SDK: the Phase 3
/// `advisory_rejected_algs`, `warn_classical_only_deprecated` and
/// `allow_classical_fallback_disable`, `max_session_duration_seconds`,
/// `require_session_expiry`, and `require_audience_binding` with
/// `verifier_id`. A policy that changes any other field fails verification
/// instead of having the setting ignored.
pub fn verify_signed_bundle_v2_with_policy(signed_bundle: &Value, policy: &VerifierPolicy) -> V2VerificationResult {
    let mut r = V2VerificationResult { dcp_version: "2.0".into(), ..Default::default() };
    let enforced = VerifierPolicy {
        default_mode: policy.default_mode.clone(),
        risk_overrides: policy.risk_overrides.clone(),
        allow_classical_fallback_disable: policy.allow_classical_fallback_disable,
        warn_classical_only_deprecated: policy.warn_classical_only_deprecated,
        advisory_rejected_algs: policy.advisory_rejected_algs.clone(),
        max_session_duration_seconds: policy.max_session_duration_seconds,
        require_session_expiry: policy.require_session_expiry,
        require_audience_binding: policy.require_audience_binding,
        verifier_id: policy.verifier_id.clone(),
        ..VerifierPolicy::default()
    };
    if *policy != enforced {
        r.errors.push(
            "Verifier policy sets fields this verifier does not enforce: only default_mode, risk_overrides, the Phase 3 fields, max_session_duration_seconds, require_session_expiry, require_audience_binding and verifier_id may differ from the default"
                .to_string(),
        );
        return r;
    }

    let bundle = match signed_bundle.get("bundle") {
        Some(b) => b,
        None => {
            r.errors.push("Missing bundle field".into());
            return r;
        }
    };
    let signature = match signed_bundle.get("signature") {
        Some(s) => s,
        None => {
            r.errors.push("Missing signature field".into());
            return r;
        }
    };

    if bundle.get("dcp_bundle_version").and_then(|v| v.as_str()) != Some("2.0") {
        r.errors.push("Invalid dcp_bundle_version".to_string());
    }
    if bundle.get("manifest").is_none() {
        r.errors.push("Missing manifest in bundle".to_string());
    }
    for field in &["responsible_principal_record", "agent_passport", "intent", "policy_decision"] {
        if bundle.get(*field).is_none() {
            r.errors.push(format!("Missing {} in bundle", field));
        }
    }

    let manifest_nonce = bundle.get("manifest")
        .and_then(|m| m.get("session_nonce"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    if manifest_nonce.is_empty() {
        r.errors.push("Missing session_nonce in manifest".to_string());
    }

    // Artifact hashes against their payload_hash and the manifest (V2-3)
    if let Some(manifest) = bundle.get("manifest") {
        r.errors.extend(manifest_hash_errors(bundle, manifest));
        let now = unix_now_millis() as i64;
        r.errors.extend(session_time_errors(manifest, policy.max_session_duration_seconds, now));
        r.errors.extend(manifest_policy_errors(manifest, policy));
    }

    // Per spec/CANONICALIZATION_PROFILE.md § 4 a missing canonicalization_profile
    // means dcp-jcs-v1; any other value, string or not, is rejected.
    if let Some(profile) = bundle.get("manifest").and_then(|m| m.get("canonicalization_profile")) {
        if profile.as_str() != Some("dcp-jcs-v1") {
            r.errors.push(format!("Unknown canonicalization_profile: {}", display(Some(profile))));
        }
    }

    // Session nonce consistency across artifacts, audit entries and checkpoints (V2-4)
    if !manifest_nonce.is_empty() {
        r.errors.extend(session_nonce_errors(bundle, manifest_nonce));
    }

    // The passport, intent, policy decision and audit entries name the same
    // principal, agent and intent (V2-14).
    r.errors.extend(consistency_errors(bundle));

    // Verification mode: the agent's risk_tier and intent can raise the policy
    // mode but never take it below the security tier's mode.
    let payload_of = |field: &str| bundle.get(field).and_then(|a| a.get("payload"));
    let risk_tier = payload_of("agent_passport")
        .and_then(|p| p.get("risk_tier"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let policy_mode = policy
        .risk_overrides
        .get(risk_tier)
        .filter(|_| !risk_tier.is_empty())
        .unwrap_or(&policy.default_mode);
    if !matches!(policy_mode.as_str(), "classical_only" | "hybrid_preferred" | "hybrid_required" | "pq_only") {
        r.errors.push("Unknown verification mode in verifier policy".to_string());
        return r;
    }
    let tier = compute_security_tier(payload_of("intent").unwrap_or(&Value::Null), payload_of("policy_decision"));
    let mode = effective_verification_mode(policy_mode, tier);
    r.resolved_tier = tier.as_str().to_string();
    r.verification_mode = mode.to_string();
    if mode == "classical_only" && policy.warn_classical_only_deprecated {
        r.warnings.push("DEPRECATION: classical_only mode is deprecated in Phase 3".to_string());
    }

    // Bundle composite_sig over the manifest (V2-6, V2-7). The signer is the
    // principal: only the RPR binding_keys verify it. The agent signs its own
    // passport, so its keys cannot vouch for the principal.
    let rpr_keys = payload_keys(bundle, "responsible_principal_record", "binding_keys");
    let agent_keys = payload_keys(bundle, "agent_passport", "keys");
    match (signature.get("composite_sig"), bundle.get("manifest")) {
        (None, _) => r.errors.push("Missing composite_sig in signature".to_string()),
        (Some(_), None) => {}
        (Some(cs_val), Some(manifest)) => {
            match verify_composite_sig(CTX_BUNDLE, manifest, Some(cs_val), &rpr_keys, RPR_KEYS) {
                Ok((cs, result)) => {
                    r.classical_valid = result.classical_valid;
                    r.pq_valid = result.pq_valid;
                    let (errors, warnings) = check_mode(mode, policy, &cs, &result);
                    r.errors.extend(errors.iter().map(|e| format!("Bundle {}", e)));
                    r.warnings.extend(warnings.iter().map(|w| format!("Bundle {}", w)));
                }
                Err(e) => r.errors.push(format!("Bundle signature: {}", e)),
            }
        }
    }
    r.errors.extend(signature_block_errors(bundle, signature));

    // Each artifact's own composite_sig (V2-8): the principal signs the RPR
    // with its binding_keys, the agent signs the rest with its passport keys.
    for (field, context, keys, keys_label) in [
        ("responsible_principal_record", CTX_RESPONSIBLE_PRINCIPAL, &rpr_keys, RPR_KEYS),
        ("agent_passport", CTX_AGENT_PASSPORT, &agent_keys, PASSPORT_KEYS),
        ("intent", CTX_INTENT, &agent_keys, PASSPORT_KEYS),
        ("policy_decision", CTX_POLICY_DECISION, &agent_keys, PASSPORT_KEYS),
    ] {
        let Some(artifact) = bundle.get(field) else { continue }; // reported as missing above
        let Some(payload) = artifact.get("payload").filter(|p| p.is_object()) else {
            r.errors.push(format!("{} is not a SignedPayload object", field));
            continue;
        };
        match verify_composite_sig(context, payload, artifact.get("composite_sig"), keys, keys_label) {
            Err(e) => r.errors.push(format!("{} signature: {}", field, e)),
            Ok((cs, result)) => {
                let (errors, warnings) = check_mode(mode, policy, &cs, &result);
                r.errors.extend(errors.iter().map(|e| format!("{} {}", field, e)));
                r.warnings.extend(warnings.iter().map(|w| format!("{} {}", field, w)));
            }
        }
    }

    // PQ checkpoints, signed by the agent (V2-12).
    if let Some(manifest) = bundle.get("manifest") {
        r.errors.extend(checkpoint_errors(bundle, manifest, mode, policy, &agent_keys));
    }

    // Audit entries tied to the signed manifest, and the validity of every
    // key that can sign (V2-13): the passport keys and the RPR binding_keys.
    if let Some(manifest) = bundle.get("manifest") {
        r.errors.extend(audit_trail_errors(bundle, manifest));
    }
    for key in agent_keys.iter().chain(rpr_keys.iter()) {
        let kid = key.get("kid").and_then(Value::as_str).unwrap_or("");
        if let Some(status @ ("revoked" | "expired")) = key.get("status").and_then(Value::as_str) {
            r.errors.push(format!("Key {} is {}", kid, status));
        }
        match check_expiry(key.get("expires_at")) {
            Ok(()) => {}
            Err(Expiry::Invalid) => {
                r.errors.push(format!("Key {} has an invalid expires_at: {}", kid, display(key.get("expires_at"))))
            }
            Err(Expiry::Passed) => r.errors.push(format!("Key {} has expired", kid)),
        }
    }

    r.session_binding_valid = !manifest_nonce.is_empty();
    r.manifest_valid = bundle.get("manifest").is_some();
    r.verified = r.errors.is_empty();
    r
}

/// Apply the verification mode and the policy's Phase 3 settings to one verified
/// composite signature (VERIFICATION.md V2-7, V2-10), as the TypeScript verifier
/// does. Returns its errors and warnings. A PQ signature that is present must
/// verify in every mode; `result.valid` covers both components for pq_over_classical.
fn check_mode(
    mode: &str,
    policy: &VerifierPolicy,
    cs: &CompositeSignature,
    result: &CompositeVerifyResult,
) -> (Vec<String>, Vec<String>) {
    let (mut errors, mut warnings) = (Vec::new(), Vec::new());
    let rejected = &policy.advisory_rejected_algs;
    if mode != "pq_only" && rejected.contains(&cs.classical.alg) {
        errors.push(format!("Classical algorithm {} rejected by active advisory", cs.classical.alg));
    }
    if let Some(pq) = cs.pq.as_ref().filter(|pq| rejected.contains(&pq.alg)) {
        errors.push(format!("PQ algorithm {} rejected by active advisory", pq.alg));
    }
    if policy.warn_classical_only_deprecated && cs.binding == "classical_only" {
        warnings.push("DEPRECATION: classical-only signatures are deprecated. Migrate to hybrid or pq_only.".into());
    }
    match mode {
        "pq_only" if cs.binding != "pq_over_classical" || !result.pq_valid => {
            errors.push("PQ signature invalid or missing (pq_only)".into())
        }
        "pq_only" if !result.classical_valid && !policy.allow_classical_fallback_disable => {
            warnings.push("classical signature not verified in pq_only mode".into())
        }
        "pq_only" => {}
        "hybrid_required" if cs.binding != "pq_over_classical" => {
            errors.push(format!("hybrid_required needs a pq_over_classical signature, got {}", cs.binding))
        }
        _ if !result.valid => errors.push("signature verification failed".into()),
        "hybrid_preferred" if cs.binding == "classical_only" => {
            warnings.push("classical_only binding (no PQ protection)".into())
        }
        _ => {}
    }
    (errors, warnings)
}

/// Recompute each artifact's hash and check it against its `payload_hash` and
/// the manifest (VERIFICATION.md V2-3). A hash that cannot be checked, because
/// the payload or the manifest field is missing or the payload cannot be
/// canonicalized, is an error.
fn manifest_hash_errors(bundle: &Value, manifest: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    for (field, hash_key) in [
        ("responsible_principal_record", "rpr_hash"),
        ("agent_passport", "passport_hash"),
        ("intent", "intent_hash"),
        ("policy_decision", "policy_hash"),
    ] {
        let Some(artifact) = bundle.get(field) else { continue }; // reported as missing
        let computed = match artifact.get("payload").filter(|p| !p.is_null()).map(canonicalize_v2) {
            Some(Ok(canonical)) => format!("sha256:{}", dual_hash::dual_hash_canonical(&canonical).sha256),
            _ => {
                errors.push(format!("Cannot hash {} payload", field));
                continue;
            }
        };
        if artifact.get("payload_hash").and_then(Value::as_str) != Some(computed.as_str()) {
            errors.push(format!("{}: payload_hash mismatch", field));
        }
        if manifest.get(hash_key).and_then(Value::as_str) != Some(computed.as_str()) {
            errors.push(format!("Manifest {} mismatch", hash_key));
        }
    }
    errors
}

/// Tie the audit entries to the signed manifest, as the TS verifier does:
/// `audit_count`, `audit_merkle_root` and the `prev_hash` chain from GENESIS.
fn audit_trail_errors(bundle: &Value, manifest: &Value) -> Vec<String> {
    let Some(entries) = bundle.get("audit_entries").and_then(Value::as_array) else {
        return vec!["Missing audit_entries in bundle".to_string()];
    };
    let mut errors = Vec::new();
    if manifest.get("audit_count").and_then(Value::as_f64) != Some(entries.len() as f64) {
        errors.push(format!(
            "Manifest audit_count={} but bundle has {} entries",
            manifest.get("audit_count").unwrap_or(&Value::Null),
            entries.len()
        ));
    }
    let mut leaves = Vec::with_capacity(entries.len());
    let mut prev = "GENESIS".to_string();
    for (i, entry) in entries.iter().enumerate() {
        let Ok(canonical) = canonicalize_v2(entry) else {
            errors.push(format!("Cannot hash audit entry {}", i));
            return errors;
        };
        if entry.get("prev_hash").and_then(Value::as_str) != Some(prev.as_str()) {
            errors.push(format!("Audit hash chain broken at entry {}: expected {}", i, prev));
            return errors;
        }
        let leaf = dual_hash::dual_hash_canonical(&canonical).sha256;
        prev = format!("sha256:{}", leaf);
        leaves.push(leaf);
    }
    // An empty audit trail has the root 64 zeros (VERIFICATION.md V2-3), as the
    // wasm bundle builder writes it.
    let root = merkle_root_from_hex_leaves(&leaves).unwrap_or_else(|| "0".repeat(64));
    if manifest.get("audit_merkle_root").and_then(Value::as_str) != Some(format!("sha256:{}", root).as_str()) {
        errors.push("Manifest audit_merkle_root mismatch".to_string());
    }
    errors
}

/// The first artifact payload, audit entry or PQ checkpoint whose
/// `session_nonce` is missing or not the manifest's (VERIFICATION.md V2-4):
/// every one carries it. A missing artifact is reported on its own.
fn session_nonce_errors(bundle: &Value, manifest_nonce: &str) -> Vec<String> {
    let error = |carrier: Option<&Value>, at: &dyn Display| match carrier.and_then(|c| c.get("session_nonce")) {
        None | Some(Value::Null) => Some(format!("Session nonce missing in {}", at)),
        Some(nonce) if nonce.as_str() != Some(manifest_nonce) => Some(format!("Session nonce mismatch in {}", at)),
        Some(_) => None,
    };
    for field in ["responsible_principal_record", "agent_passport", "intent", "policy_decision"] {
        let Some(artifact) = bundle.get(field) else { continue };
        if let Some(e) = error(artifact.get("payload"), &field) {
            return vec![e];
        }
    }
    for field in ["audit_entries", "pq_checkpoints"] {
        let entries = bundle.get(field).and_then(Value::as_array).into_iter().flatten();
        for (i, entry) in entries.enumerate() {
            if let Some(e) = error(Some(entry), &format_args!("{}[{}]", field, i)) {
                return vec![e];
            }
        }
    }
    Vec::new()
}

/// How far in the future a signed session start may be (VERIFICATION.md V2-4),
/// the clock skew DCP-04 allows for timestamps.
const SESSION_CLOCK_SKEW_MS: i64 = 30_000;

/// The manifest's signed session window (VERIFICATION.md V2-4).
/// `session_expires_at` must not have passed. A `session_issued_at` must not be
/// more than [`SESSION_CLOCK_SKEW_MS`] in the future nor after
/// `session_expires_at`. Both are RFC 3339 timestamps; absent or null is no
/// value. `max_session_duration_seconds` bounds `session_expires_at` minus
/// `session_issued_at` and requires both: a session without an expiry does not
/// count as one that never ends, and `signature.created_at`, outside the signed
/// manifest, is never read. Instants compare at millisecond precision. `now`
/// is the verification time in Unix milliseconds.
fn session_time_errors(manifest: &Value, max_seconds: Option<u64>, now: i64) -> Vec<String> {
    let present = |key: &str| manifest.get(key).filter(|v| !v.is_null());
    let mut errors = Vec::new();

    let expires_raw = present("session_expires_at");
    let mut expires = None;
    if let Some(raw) = expires_raw {
        match raw.as_str().and_then(parse_rfc3339_millis) {
            None => errors.push(format!("Invalid session_expires_at: {}", display(Some(raw)))),
            Some(t) if t < now => errors.push(format!("Session expired at {}", display(Some(raw)))),
            Some(t) => expires = Some(t),
        }
    }

    let issued_raw = present("session_issued_at");
    let mut issued = None;
    if let Some(raw) = issued_raw {
        match raw.as_str().and_then(parse_rfc3339_millis) {
            None => errors.push(format!("Invalid session_issued_at: {}", display(Some(raw)))),
            Some(t) if t > now.saturating_add(SESSION_CLOCK_SKEW_MS) => {
                errors.push(format!("session_issued_at {} is in the future", display(Some(raw))))
            }
            Some(t) if expires.is_some_and(|e| t > e) => {
                errors.push("session_issued_at is after session_expires_at".to_string())
            }
            Some(t) => issued = Some(t),
        }
    }

    let Some(max) = max_seconds.filter(|max| *max > 0) else { return errors };
    match (expires_raw, expires, issued_raw, issued) {
        (None, ..) => {
            errors.push("Policy max_session_duration_seconds requires session_expires_at in the manifest".to_string())
        }
        (Some(_), Some(_), None, _) => {
            errors.push("Policy max_session_duration_seconds requires session_issued_at in the manifest".to_string())
        }
        (_, Some(expires), _, Some(issued)) => {
            let duration_ms = i128::from(expires) - i128::from(issued);
            if duration_ms > i128::from(max) * 1000 {
                errors.push(format!(
                    "Session duration {}s exceeds policy max of {}s",
                    duration_ms as f64 / 1000.0,
                    max
                ));
            }
        }
        _ => {} // an invalid or passed time, reported above
    }
    errors
}

/// What the verifier policy demands of the manifest, as in TypeScript:
/// `require_session_expiry` needs `session_expires_at`, and
/// `require_audience_binding` needs `intended_verifier`, which must be
/// `verifier_id` when that is set. An `intended_verifier` that is empty or not
/// a string counts as none.
fn manifest_policy_errors(manifest: &Value, policy: &VerifierPolicy) -> Vec<String> {
    let mut errors = Vec::new();
    if policy.require_session_expiry && manifest.get("session_expires_at").is_none_or(Value::is_null) {
        errors.push("Policy requires session_expires_at but manifest does not include it".to_string());
    }
    if policy.require_audience_binding {
        match manifest.get("intended_verifier").and_then(Value::as_str).filter(|v| !v.is_empty()) {
            None => errors
                .push("Policy requires audience binding but manifest does not include intended_verifier".to_string()),
            Some(intended) => match policy.verifier_id.as_deref() {
                Some(verifier_id) if !verifier_id.is_empty() && verifier_id != intended => {
                    errors.push(format!("Bundle intended for verifier '{}', not '{}'", intended, verifier_id))
                }
                _ => {}
            },
        }
    }
    errors
}

/// The unsigned signature block does not contradict what is signed
/// (VERIFICATION.md V2-4): `signer.id` is the RPR human_id, `signer.kids` are
/// the composite_sig kids, the classical one and then the PQ one when present,
/// `manifest_hash` is `sha256:` and the SHA-256 of the canonical manifest, and
/// `hash_alg` is `sha256` or `sha256+sha3-256`.
fn signature_block_errors(bundle: &Value, signature: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let signer = signature.get("signer");
    let signer_id = signer.and_then(|s| s.get("id"));
    let human_id =
        bundle.get("responsible_principal_record").and_then(|a| a.get("payload")).and_then(|p| p.get("human_id"));
    if !same_id(signer_id, human_id) {
        errors.push(format!("Bundle signature: signer id {} is not the RPR human_id", display(signer_id)));
    }
    let cs = signature.get("composite_sig");
    let kid = |slot: &str| cs.and_then(|c| c.get(slot)).and_then(|entry| entry.get("kid"));
    let mut signed = vec![kid("classical")];
    if cs.and_then(|c| c.get("pq")).is_some_and(|pq| !pq.is_null()) {
        signed.push(kid("pq"));
    }
    let kids = signer.and_then(|s| s.get("kids")).and_then(Value::as_array);
    let named = kids.is_some_and(|kids| {
        kids.len() == signed.len() && kids.iter().zip(&signed).all(|(kid, signed)| same_id(Some(kid), *signed))
    });
    if !named {
        errors.push("Bundle signature: signer kids do not name the bundle signature keys".to_string());
    }
    let manifest_hash = bundle
        .get("manifest")
        .and_then(|m| canonicalize_v2(m).ok())
        .map(|c| format!("sha256:{}", dual_hash::dual_hash_canonical(&c).sha256));
    let signed_hash = signature.get("manifest_hash");
    if manifest_hash.is_none() || signed_hash.and_then(Value::as_str) != manifest_hash.as_deref() {
        errors
            .push(format!("Bundle signature: manifest_hash {} is not the hash of the manifest", display(signed_hash)));
    }
    let hash_alg = signature.get("hash_alg");
    if !matches!(hash_alg.and_then(Value::as_str), Some("sha256" | "sha256+sha3-256")) {
        errors.push(format!("Bundle signature: hash_alg {} is not sha256 or sha256+sha3-256", display(hash_alg)));
    }
    errors
}

/// Two identifiers that are the same string; two missing ones are not the same.
fn same_id(a: Option<&Value>, b: Option<&Value>) -> bool {
    matches!((a, b), (Some(Value::String(a)), Some(Value::String(b))) if a == b)
}

/// The artifacts describe one action, by one agent, for one principal
/// (VERIFICATION.md V2-14). The signatures say who signed each one; these
/// checks tie them together. A missing artifact or payload fails them, on top
/// of the error that reports it.
fn consistency_errors(bundle: &Value) -> Vec<String> {
    let payload = |field: &str| bundle.get(field).and_then(|a| a.get("payload")).unwrap_or(&Value::Null);
    let rpr = payload("responsible_principal_record");
    let passport = payload("agent_passport");
    let intent = payload("intent");
    let decision = payload("policy_decision");
    let (human_id, agent_id, intent_id) = (rpr.get("human_id"), passport.get("agent_id"), intent.get("intent_id"));
    let mut errors = Vec::new();

    let status = passport.get("status");
    if !matches!(status.and_then(Value::as_str), Some("active" | "declining")) {
        errors.push(format!("agent_passport status is {}, not active (DCP-05 § 3.1)", display(status)));
    }
    let expires = rpr.get("expires_at");
    match check_expiry(expires) {
        Ok(()) => {}
        Err(Expiry::Invalid) => {
            errors.push(format!("responsible_principal_record has an invalid expires_at: {}", display(expires)))
        }
        Err(Expiry::Passed) => errors.push(format!("responsible_principal_record expired at {}", display(expires))),
    }
    if !same_id(passport.get("principal_binding_reference"), human_id) {
        errors.push("agent_passport principal_binding_reference is not the RPR human_id".to_string());
    }
    if !same_id(intent.get("agent_id"), agent_id) {
        errors.push("intent agent_id is not the passport agent_id".to_string());
    }
    if !same_id(intent.get("human_id"), human_id) {
        errors.push("intent human_id is not the RPR human_id".to_string());
    }
    if !same_id(decision.get("intent_id"), intent_id) {
        errors.push("policy_decision intent_id is not the intent intent_id".to_string());
    }
    // What an audit entry records for the policy decision. An escalated or
    // blocked action is valid evidence too.
    let recorded = match decision.get("decision").and_then(Value::as_str) {
        Some("approve") => Some("approved"),
        Some("escalate") => Some("escalated"),
        Some("block") => Some("blocked"),
        _ => None,
    };

    // The intent's payload hash, in the form of the manifest's intent_hash.
    let intent_hash = intent
        .is_object()
        .then(|| canonicalize_v2(intent).ok())
        .flatten()
        .map(|c| Value::String(format!("sha256:{}", dual_hash::dual_hash_canonical(&c).sha256)));
    let entries = bundle.get("audit_entries").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    for (i, entry) in entries.iter().enumerate() {
        if !same_id(entry.get("intent_id"), intent_id) {
            errors.push(format!("audit_entries[{}] intent_id is not the intent intent_id", i));
        }
        if !same_id(entry.get("intent_hash"), intent_hash.as_ref()) {
            errors.push(format!("audit_entries[{}] intent_hash is not the intent payload hash", i));
        }
        if !same_id(entry.get("agent_id"), agent_id) {
            errors.push(format!("audit_entries[{}] agent_id is not the passport agent_id", i));
        }
        if !same_id(entry.get("human_id"), human_id) {
            errors.push(format!("audit_entries[{}] human_id is not the RPR human_id", i));
        }
        if recorded.is_none() || entry.get("policy_decision").and_then(Value::as_str) != recorded {
            errors.push(format!(
                "audit_entries[{}] policy_decision {} does not record the decision {}",
                i,
                display(entry.get("policy_decision")),
                display(decision.get("decision"))
            ));
        }
    }
    errors
}

/// The bundle carries exactly the checkpoints its signed manifest lists, once
/// each; each covers a contiguous run of audit entries, with their Merkle
/// root, and is signed by the agent with both algorithms, the PQ one alone
/// under pq_only (VERIFICATION.md V2-12).
fn checkpoint_errors(
    bundle: &Value,
    manifest: &Value,
    mode: &str,
    policy: &VerifierPolicy,
    passport_keys: &[&Value],
) -> Vec<String> {
    // Absent or null lists nothing.
    fn list(value: Option<&Value>) -> Option<&[Value]> {
        match value {
            None | Some(Value::Null) => Some(&[]),
            Some(v) => v.as_array().map(Vec::as_slice),
        }
    }
    let (Some(listed), Some(carried)) = (list(manifest.get("pq_checkpoints")), list(bundle.get("pq_checkpoints")))
    else {
        return vec!["pq_checkpoints: manifest list and bundle checkpoints must be arrays".to_string()];
    };

    let mut errors = Vec::new();
    let mut by_id: Vec<(&str, &Value)> = Vec::with_capacity(carried.len());
    let mut carried_ids = HashSet::with_capacity(carried.len());
    for cp in carried {
        match cp.get("checkpoint_id").and_then(Value::as_str) {
            Some(id) if carried_ids.insert(id) => by_id.push((id, cp)),
            _ => errors.push(format!(
                "pq_checkpoints: checkpoint {} is missing an id or carried twice",
                display(cp.get("checkpoint_id"))
            )),
        }
    }
    let mut listed_ids = HashSet::with_capacity(listed.len());
    for id in listed {
        match id.as_str() {
            Some(id) if !listed_ids.insert(id) => {
                errors.push("pq_checkpoints: the manifest lists a checkpoint twice".to_string())
            }
            Some(id) if carried_ids.contains(id) => {}
            _ => errors
                .push(format!("pq_checkpoints: manifest lists {}, which the bundle does not carry", display(Some(id)))),
        }
    }
    for (id, _) in &by_id {
        if !listed_ids.contains(id) {
            errors.push(format!("pq_checkpoints: {} is not listed in the manifest", id));
        }
    }
    if !errors.is_empty() {
        return errors;
    }

    let entries = bundle.get("audit_entries").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    let cp_mode = if mode == "pq_only" { "pq_only" } else { "hybrid_required" };
    for (id, cp) in by_id {
        let label = format!("pq_checkpoints[{}]", id);
        if !same_id(cp.get("session_nonce"), manifest.get("session_nonce")) {
            errors.push(format!("{}: session_nonce is not the manifest's", label));
            continue;
        }
        let range = cp.get("event_range").filter(|r| r.is_object());
        let position = |key: &str| {
            let audit_id = range?.get(key);
            entries.iter().position(|e| same_id(e.get("audit_id"), audit_id))
        };
        let count = range.and_then(|r| r.get("count")).and_then(Value::as_f64);
        let run = match (position("from_audit_id"), position("to_audit_id")) {
            (Some(from), Some(to)) if to >= from && count == Some((to - from + 1) as f64) => entries.get(from..=to),
            _ => None,
        };
        let Some(run) = run else {
            errors.push(format!("{}: event_range does not match the audit entries", label));
            continue;
        };
        let root = audit_events_merkle_root(run).ok().map(|root| format!("sha256:{}", root));
        if root.is_none() || cp.get("merkle_root").and_then(Value::as_str) != root.as_deref() {
            errors.push(format!("{}: merkle_root does not match its audit entries", label));
            continue;
        }
        let mut payload = cp.clone();
        let sig = payload.as_object_mut().and_then(|p| p.remove("composite_sig"));
        match verify_composite_sig(CTX_AUDIT_EVENT, &payload, sig.as_ref(), passport_keys, PASSPORT_KEYS) {
            Err(e) => errors.push(format!("{}: {}", label, e)),
            Ok((cs, result)) => {
                // The verdict comes from the mode's errors, as for every artifact.
                let (sig_errors, _) = check_mode(cp_mode, policy, &cs, &result);
                errors.extend(sig_errors.iter().map(|e| format!("{}: {}", label, e)));
            }
        }
    }
    errors
}

/// Why an expiry fails.
enum Expiry {
    Invalid,
    Passed,
}

/// An optional expiry (a key's or the RPR's `expires_at`): absent or null
/// never expires; anything else must be an RFC 3339 timestamp still in the
/// future.
fn check_expiry(value: Option<&Value>) -> Result<(), Expiry> {
    match value {
        None | Some(Value::Null) => Ok(()),
        Some(v) => match v.as_str().and_then(parse_rfc3339_millis) {
            None => Err(Expiry::Invalid),
            Some(t) if t < unix_now_millis() as i64 => Err(Expiry::Passed),
            Some(_) => Ok(()),
        },
    }
}

/// A JSON value for an error message, strings without their quotes.
fn display(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => "null".into(),
    }
}

/// Key entries listed under `field` in an artifact's payload.
fn payload_keys<'a>(bundle: &'a Value, artifact: &str, field: &str) -> Vec<&'a Value> {
    bundle.get(artifact)
        .and_then(|a| a.get("payload"))
        .and_then(|p| p.get(field))
        .and_then(|k| k.as_array())
        .map(|keys| keys.iter().collect())
        .unwrap_or_default()
}

/// The algorithms each composite signature slot may hold.
const CLASSICAL_ALGS: [&str; 1] = ["ed25519"];
const PQ_ALGS: [&str; 2] = ["ml-dsa-65", "slh-dsa-192f"];

/// The key lists signers are looked up in, as error messages name them.
const RPR_KEYS: &str = "RPR binding_keys";
const PASSPORT_KEYS: &str = "passport keys";

/// Public key and algorithm of the key entry with that kid.
fn find_key<'a>(keys: &[&'a Value], kid: &str) -> Option<(&'a str, &'a str)> {
    let key = keys.iter().find(|k| k.get("kid").and_then(|v| v.as_str()) == Some(kid))?;
    Some((
        key.get("public_key_b64").and_then(|v| v.as_str())?,
        key.get("alg").and_then(|v| v.as_str()).unwrap_or(""),
    ))
}

/// Why a key entry cannot verify a signature (VERIFICATION.md V2-13), if it
/// cannot: its `public_key_b64` must be canonical base64 (RFC 4648 § 4,
/// padded, zero trailing bits), so every verifier decodes the same bytes, and
/// its kid derived from its alg and those bytes, so no key list can claim
/// another party's kid.
fn key_identity_error(kid: &str, alg: &str, public_key_b64: &str) -> Option<String> {
    // The strict engine refuses missing padding and trailing bits; re-encoding
    // confirms the bytes have no other spelling.
    let Some(pk) = BASE64.decode(public_key_b64).ok().filter(|pk| BASE64.encode(pk) == public_key_b64) else {
        return Some(format!("key {} public_key_b64 is not canonical base64 (V2-13)", kid));
    };
    (derive_kid(alg, &pk) != kid).then(|| format!("key {} is not derived from its public key (V2-13)", kid))
}

pub(crate) fn provider_for_alg(alg: &str) -> Result<Box<dyn CryptoProvider>, String> {
    match alg {
        "ed25519" => Ok(Box::new(Ed25519Provider)),
        "ml-dsa-65" => Ok(Box::new(MlDsa65Provider)),
        "slh-dsa-192f" => Ok(Box::new(SlhDsa192fProvider)),
        _ => Err(format!("Unknown algorithm: {}", alg)),
    }
}

/// Verify a composite_sig over `payload` with the keys it names by kid, looked
/// up in `keys` only (VERIFICATION.md V2-6, V2-7), each kid derived from its
/// key (V2-13): pq_over_classical is valid only when both components verify;
/// classical_only carries no PQ signature.
fn verify_composite_sig(
    context: &str,
    payload: &Value,
    cs_val: Option<&Value>,
    keys: &[&Value],
    keys_label: &str,
) -> Result<(CompositeSignature, CompositeVerifyResult), String> {
    let cs: CompositeSignature = serde_json::from_value(cs_val.ok_or("missing composite_sig")?.clone())
        .map_err(|_| "invalid composite_sig structure".to_string())?;
    // Ed25519 cannot stand in for the PQ signature, nor ML-DSA for the classical one.
    if !CLASSICAL_ALGS.contains(&cs.classical.alg.as_str()) {
        return Err(format!("classical slot holds {}, which is not a classical algorithm", cs.classical.alg));
    }
    if let Some(entry) = &cs.pq {
        if !PQ_ALGS.contains(&entry.alg.as_str()) {
            return Err(format!("PQ slot holds {}, which is not a PQ algorithm", entry.alg));
        }
    }

    let (classical_pk, classical_alg) = find_key(keys, &cs.classical.kid)
        .ok_or_else(|| format!("classical signer key kid={} not found in {}", cs.classical.kid, keys_label))?;
    if classical_alg != cs.classical.alg {
        return Err(format!(
            "classical signer key kid={} is {}, not {}",
            cs.classical.kid, classical_alg, cs.classical.alg
        ));
    }
    let classical = provider_for_alg(&cs.classical.alg)?;
    let (pq, pq_pk) = match &cs.pq {
        Some(entry) => {
            let (pk, alg) = find_key(keys, &entry.kid)
                .ok_or_else(|| format!("PQ signer key kid={} not found in {}", entry.kid, keys_label))?;
            if alg != entry.alg {
                return Err(format!("PQ signer key kid={} is {}, not {}", entry.kid, alg, entry.alg));
            }
            (Some(provider_for_alg(&entry.alg)?), Some(pk))
        }
        None => (None, None),
    };
    let pq_signer = cs.pq.as_ref().zip(pq_pk).map(|(entry, pk)| (entry.kid.as_str(), entry.alg.as_str(), pk));
    for (kid, alg, pk) in [(cs.classical.kid.as_str(), classical_alg, classical_pk)].into_iter().chain(pq_signer) {
        if let Some(error) = key_identity_error(kid, alg, pk) {
            return Err(error);
        }
    }
    let canonical = canonicalize_v2(payload)?;
    let result = composite_verify(
        classical.as_ref(), pq.as_deref(), context, canonical.as_bytes(), &cs, classical_pk, pq_pk,
    )
    .map_err(|e| e.to_string())?;
    Ok((cs, result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A bundle whose four artifact hashes all match, with their manifest.
    fn consistent() -> (Value, Value) {
        let mut bundle = json!({});
        let mut manifest = json!({});
        for (field, key) in [
            ("responsible_principal_record", "rpr_hash"),
            ("agent_passport", "passport_hash"),
            ("intent", "intent_hash"),
            ("policy_decision", "policy_hash"),
        ] {
            let payload = json!({ "artifact": field });
            let hash = format!("sha256:{}", dual_hash::dual_hash_canonical(&canonicalize_v2(&payload).unwrap()).sha256);
            bundle[field] = json!({ "payload": payload, "payload_hash": hash });
            manifest[key] = json!(hash);
        }
        (bundle, manifest)
    }

    #[test]
    fn every_carrier_has_the_manifest_nonce() {
        let bundle = json!({
            "intent": { "payload": { "session_nonce": "a" } },
            "audit_entries": [{ "session_nonce": "a" }, { "session_nonce": "b" }],
        });
        assert_eq!(session_nonce_errors(&bundle, "a"), vec!["Session nonce mismatch in audit_entries[1]"]);
        let same = json!({ "audit_entries": [{ "session_nonce": "a" }, { "session_nonce": "a" }] });
        assert!(session_nonce_errors(&same, "a").is_empty());
        let artifact = json!({ "agent_passport": { "payload": { "session_nonce": "b" } } });
        assert_eq!(session_nonce_errors(&artifact, "a"), vec!["Session nonce mismatch in agent_passport"]);
        // A carrier without the nonce is rejected too (V2-4).
        let cases = [
            (json!({ "audit_entries": [{ "session_nonce": "a" }, { "prev_hash": "GENESIS" }] }), "audit_entries[1]"),
            (json!({ "pq_checkpoints": [{ "session_nonce": null }] }), "pq_checkpoints[0]"),
            (
                json!({ "responsible_principal_record": { "payload": { "human_id": "h" } } }),
                "responsible_principal_record",
            ),
            (json!({ "policy_decision": { "payload": null } }), "policy_decision"),
            (json!({ "audit_entries": [7] }), "audit_entries[0]"),
        ];
        for (bundle, at) in cases {
            assert_eq!(session_nonce_errors(&bundle, "a"), vec![format!("Session nonce missing in {at}")], "{bundle}");
        }
        assert_eq!(session_nonce_errors(&json!({ "intent": { "payload": { "session_nonce": 1 } } }), "a").len(), 1);
    }

    #[test]
    fn canonicalization_profile_must_be_dcp_jcs_v1() {
        let policy = VerifierPolicy::default();
        let with_profile = |profile: Value| {
            let mut manifest = json!({ "session_nonce": "a" });
            manifest["canonicalization_profile"] = profile;
            json!({ "bundle": { "dcp_bundle_version": "2.0", "manifest": manifest }, "signature": {} })
        };
        for profile in [json!("dcp-jcs-v2"), json!(1), Value::Null] {
            let result = verify_signed_bundle_v2_with_policy(&with_profile(profile.clone()), &policy);
            assert!(
                result.errors.iter().any(|e| e.starts_with("Unknown canonicalization_profile: ")),
                "{profile}: {:?}",
                result.errors
            );
        }
        let result = verify_signed_bundle_v2_with_policy(&with_profile(json!("dcp-jcs-v1")), &policy);
        assert!(!result.errors.iter().any(|e| e.contains("canonicalization_profile")), "{:?}", result.errors);
    }

    #[test]
    fn manifest_hashes_fail_closed() {
        let (bundle, manifest) = consistent();
        assert!(manifest_hash_errors(&bundle, &manifest).is_empty());

        let mutations: [(&str, fn(&mut Value, &mut Value)); 4] = [
            ("manifest hash missing", |_, m| { m.as_object_mut().unwrap().remove("intent_hash"); }),
            ("payload missing", |b, _| { b["intent"].as_object_mut().unwrap().remove("payload"); }),
            ("payload not canonical", |b, _| b["intent"]["payload"] = json!({ "amount": 1.5 })),
            ("payload_hash wrong", |b, _| b["intent"]["payload_hash"] = json!(format!("sha256:{}", "0".repeat(64)))),
        ];
        for (name, mutate) in mutations {
            let (mut b, mut m) = consistent();
            mutate(&mut b, &mut m);
            assert!(!manifest_hash_errors(&b, &m).is_empty(), "{name}: expected an error");
        }
    }

    #[test]
    fn session_window_is_signed() {
        let now = parse_rfc3339_millis("2026-10-23T00:00:00Z").unwrap();
        let errors = |manifest: Value, max: Option<u64>| session_time_errors(&manifest, max, now).join("\n");
        let window =
            |issued: Value, expires: &str| json!({ "session_issued_at": issued, "session_expires_at": expires });
        let far = "2099-12-31T23:59:59Z";
        let issued = json!("2026-10-21T00:00:00Z");

        // The duration runs from the signed start, about 2.3e9 seconds here.
        for max in [None, Some(0), Some(3_000_000_000), Some(u64::MAX)] {
            assert_eq!(errors(window(issued.clone(), far), max), "", "{max:?}");
        }
        assert!(errors(window(issued.clone(), far), Some(3600)).starts_with("Session duration "));
        // Up to 30 seconds ahead of the verifier's clock; absent or null is no
        // start, which only a maximum session duration requires.
        assert_eq!(errors(window(json!("2026-10-23T00:00:30Z"), far), Some(3_000_000_000)), "");
        for manifest in [json!({ "session_expires_at": far }), window(Value::Null, far), json!({})] {
            assert_eq!(errors(manifest.clone(), None), "", "{manifest}");
        }
        // Years 0000 to 9999; instants at millisecond precision, the 0.0009 s
        // past the maximum dropped (2026-10-21 to 2099-12-31T18:59:59 is
        // 2309885999 s).
        assert_eq!(errors(window(json!("0000-01-01T00:00:00Z"), "9999-12-31T23:59:59Z"), None), "");
        let ms = window(issued.clone(), "2099-12-31T18:59:59.0009Z");
        assert_eq!(errors(ms.clone(), Some(2_309_885_999)), "");
        assert!(errors(ms, Some(2_309_885_998)).starts_with("Session duration "));

        let cases = [
            // A maximum needs both ends: no expiry is not a session that never ends.
            (json!({}), Some(3600), "Policy max_session_duration_seconds requires session_expires_at in the manifest"),
            (json!({ "session_issued_at": issued }), Some(3600), "requires session_expires_at"),
            (window(issued.clone(), "x"), Some(3600), "Invalid session_expires_at: x"),
            (window(Value::Null, far), Some(3600), "Policy max_session_duration_seconds requires session_issued_at"),
            (json!({ "session_expires_at": far }), Some(3600), "requires session_issued_at in the manifest"),
            (
                window(json!("2026-10-23T00:00:31Z"), far),
                None,
                "session_issued_at 2026-10-23T00:00:31Z is in the future",
            ),
            (window(json!("2026-10-21"), far), None, "Invalid session_issued_at: 2026-10-21"),
            (window(json!(1), far), Some(3600), "Invalid session_issued_at: 1"),
            (window(json!("2026-10-23T00:00:20Z"), "2026-10-23T00:00:10Z"), None, "session_issued_at is after"),
            (window(issued.clone(), "2026-10-22T00:00:00Z"), Some(3600), "Session expired at"),
            (window(issued.clone(), "tomorrow"), None, "Invalid session_expires_at: tomorrow"),
        ];
        for (manifest, max, want) in cases {
            let got = errors(manifest.clone(), max);
            assert!(got.contains(want), "{manifest} {max:?}: {want}: {got}");
        }
    }

    #[test]
    fn identifiers_match_only_as_equal_strings() {
        assert!(same_id(Some(&json!("a")), Some(&json!("a"))));
        for (a, b) in [
            (None, None),
            (Some(Value::Null), Some(Value::Null)),
            (Some(json!(1)), Some(json!(1))),
            (Some(json!("a")), Some(json!("b"))),
        ] {
            assert!(!same_id(a.as_ref(), b.as_ref()), "{a:?} {b:?}");
        }
        // Missing artifacts and identifiers fail V2-14 instead of matching each other.
        let errors = consistency_errors(&json!({ "intent": { "payload": 1 }, "audit_entries": [{}] })).join("\n");
        for want in [
            "agent_passport status is null",
            "agent_passport principal_binding_reference",
            "intent agent_id",
            "intent human_id",
            "policy_decision intent_id",
            "audit_entries[0] intent_id",
            "audit_entries[0] intent_hash",
            "audit_entries[0] agent_id",
            "audit_entries[0] human_id",
        ] {
            assert!(errors.contains(want), "{want}: {errors}");
        }
    }

    #[test]
    fn checkpoints_fail_closed() {
        let policy = VerifierPolicy::default();
        let entries = json!([{ "audit_id": "a" }, { "audit_id": "b" }]);
        let root = |run: &[Value]| format!("sha256:{}", audit_events_merkle_root(run).unwrap());
        let cp = json!({
            "checkpoint_id": "c", "session_nonce": "n", "merkle_root": root(entries.as_array().unwrap()),
            "event_range": { "from_audit_id": "a", "to_audit_id": "b", "count": 2 },
        });
        let errors = |listed: Value, carried: Value| {
            let bundle = json!({ "audit_entries": entries, "pq_checkpoints": carried });
            let manifest = json!({ "session_nonce": "n", "pq_checkpoints": listed });
            checkpoint_errors(&bundle, &manifest, "hybrid_preferred", &policy, &[]).join("\n")
        };
        assert_eq!(errors(Value::Null, Value::Null), "");
        assert_eq!(errors(json!([]), json!([])), "");
        let cases = [
            (json!({}), json!([]), "must be arrays"),
            (json!([]), json!("c"), "must be arrays"),
            (json!(["c"]), json!([]), "manifest lists c, which the bundle does not carry"),
            (json!([1]), json!([]), "manifest lists 1, which the bundle does not carry"),
            (json!([]), json!([cp]), "c is not listed in the manifest"),
            (json!(["c", "c"]), json!([cp]), "the manifest lists a checkpoint twice"),
            (json!(["c"]), json!([cp, cp]), "checkpoint c is missing an id or carried twice"),
            (json!(["c"]), json!([7]), "checkpoint null is missing an id or carried twice"),
        ];
        for (listed, carried, want) in cases {
            let got = errors(listed.clone(), carried);
            assert!(got.contains(want), "{listed}: {want}: {got}");
        }

        // The checkpoint over both entries is checked down to its signature.
        assert!(errors(json!(["c"]), json!([cp])).contains("pq_checkpoints[c]: missing composite_sig"));
        let range =
            |from: &str, to: &str, count: Value| json!({ "from_audit_id": from, "to_audit_id": to, "count": count });
        let mutations = [
            ("session_nonce", json!("m"), "session_nonce is not the manifest's"),
            ("session_nonce", Value::Null, "session_nonce is not the manifest's"),
            ("event_range", json!("a..b"), "event_range does not match"),
            ("event_range", range("b", "a", json!(0)), "event_range does not match"),
            ("event_range", range("a", "z", json!(2)), "event_range does not match"),
            ("event_range", range("a", "b", json!("2")), "event_range does not match"),
            ("event_range", json!({ "count": 2 }), "event_range does not match"),
            ("merkle_root", json!(root(&entries.as_array().unwrap()[..1])), "merkle_root does not match"),
            ("merkle_root", Value::Null, "merkle_root does not match"),
        ];
        for (field, value, want) in mutations {
            let mut mutated = cp.clone();
            mutated[field] = value.clone();
            let got = errors(json!(["c"]), json!([mutated]));
            assert!(got.contains(&format!("pq_checkpoints[c]: {want}")), "{field}={value}: {got}");
        }
    }

    #[test]
    fn policy_demands_on_the_manifest() {
        let policy = |expiry: bool, audience: bool, verifier_id: Option<&str>| VerifierPolicy {
            require_session_expiry: expiry,
            require_audience_binding: audience,
            verifier_id: verifier_id.map(str::to_string),
            ..VerifierPolicy::default()
        };
        let manifest = json!({ "session_expires_at": "2099-12-31T23:59:59Z", "intended_verifier": "verifier:a" });
        let errors = |manifest: &Value, policy: &VerifierPolicy| manifest_policy_errors(manifest, policy).join("\n");
        // Off by default; on, a manifest that has what they ask passes.
        for p in [policy(false, false, None), policy(true, true, None), policy(true, true, Some("verifier:a"))] {
            assert_eq!(errors(&manifest, &p), "", "{p:?}");
        }
        assert_eq!(
            errors(&json!({}), &policy(false, false, Some("verifier:a"))),
            "",
            "verifier_id alone binds nothing"
        );
        assert_eq!(errors(&manifest, &policy(false, true, Some(""))), "", "an empty verifier_id is none");

        let expiry = "Policy requires session_expires_at but manifest does not include it";
        let audience = "Policy requires audience binding but manifest does not include intended_verifier";
        let cases = [
            (json!({}), policy(true, false, None), expiry),
            (json!({ "session_expires_at": null }), policy(true, false, None), expiry),
            (json!({}), policy(false, true, None), audience),
            (json!({ "intended_verifier": "" }), policy(false, true, None), audience),
            (json!({ "intended_verifier": 7 }), policy(false, true, Some("7")), audience),
            (
                manifest.clone(),
                policy(false, true, Some("verifier:b")),
                "Bundle intended for verifier 'verifier:a', not 'verifier:b'",
            ),
        ];
        for (manifest, policy, want) in cases {
            assert_eq!(errors(&manifest, &policy), want, "{manifest}");
        }
    }

    #[test]
    fn keys_are_canonical_base64_and_name_their_kid() {
        let raw = [7u8; 32];
        let (pk, kid) = (BASE64.encode(raw), derive_kid("ed25519", &raw));
        assert_eq!(key_identity_error(&kid, "ed25519", &pk), None);
        // The same bytes with a trailing bit set, without padding, with a line
        // break, in the URL-safe alphabet: a lenient decoder reads them all.
        const B64: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let last = pk.find('=').unwrap() - 1;
        let flipped = B64.as_bytes()[B64.find(&pk[last..last + 1]).unwrap() ^ 1] as char;
        let trailing = format!("{}{}{}", &pk[..last], flipped, &pk[last + 1..]);
        let url_safe = BASE64.encode([0xfb; 32]).replace('+', "-");
        for bad in [trailing, pk.trim_end_matches('=').to_string(), format!("{pk}\n"), url_safe] {
            let error = key_identity_error(&kid, "ed25519", &bad);
            assert!(error.as_deref().is_some_and(|e| e.contains("is not canonical base64 (V2-13)")), "{bad:?}");
        }
        // Canonical but not this kid's key: another key, another alg, no bytes at all.
        let other = "0".repeat(32);
        assert!(key_identity_error(&other, "ed25519", &pk).is_some_and(|e| e.contains("is not derived")));
        assert!(key_identity_error(&kid, "ed25519", "").is_some_and(|e| e.contains("is not derived")));
        assert!(key_identity_error(&kid, "ml-dsa-65", &pk).is_some_and(|e| e.contains("is not derived")));
    }

    #[test]
    fn signature_block_does_not_contradict_the_manifest() {
        let bundle = json!({
            "manifest": { "session_nonce": "n" },
            "responsible_principal_record": { "payload": { "human_id": "h" } },
        });
        let canonical = canonicalize_v2(&bundle["manifest"]).unwrap();
        let hash = format!("sha256:{}", dual_hash::dual_hash_canonical(&canonical).sha256);
        let signature = |hash_alg: Value, manifest_hash: Value| {
            json!({
                "hash_alg": hash_alg, "manifest_hash": manifest_hash,
                "signer": { "id": "h", "kids": ["c"] }, "composite_sig": { "classical": { "kid": "c" }, "pq": null },
            })
        };
        for alg in ["sha256", "sha256+sha3-256"] {
            assert_eq!(signature_block_errors(&bundle, &signature(json!(alg), json!(hash))), Vec::<String>::new());
        }
        let other = format!("sha256:{}", "0".repeat(64));
        let cases = [
            (json!("md5"), json!(hash), "Bundle signature: hash_alg md5 is not sha256 or sha256+sha3-256"),
            (Value::Null, json!(hash), "hash_alg null"),
            (json!("sha256"), json!(other), "manifest_hash sha256:000"),
            (json!("sha256"), json!(hash.trim_start_matches("sha256:")), "is not the hash of the manifest"),
            (json!("sha256"), Value::Null, "manifest_hash null is not the hash of the manifest"),
        ];
        for (alg, manifest_hash, want) in cases {
            let errors = signature_block_errors(&bundle, &signature(alg, manifest_hash)).join("\n");
            assert!(errors.contains(want), "{want}: {errors}");
        }
        let unhashable =
            json!({ "manifest": { "n": 1.5 }, "responsible_principal_record": { "payload": { "human_id": "h" } } });
        let errors = signature_block_errors(&unhashable, &signature(json!("sha256"), json!(hash))).join("\n");
        assert!(errors.contains("is not the hash of the manifest"), "{errors}");
    }

    /// A checkpoint signature is judged by the mode, as an artifact's is: under
    /// pq_only the classical signature is not required (V2-12).
    #[test]
    fn checkpoint_signature_is_judged_by_the_mode() {
        use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
        let key = |p: &dyn CryptoProvider| {
            let k = p.generate_keypair().unwrap();
            CompositeKeyInfo {
                kid: k.kid,
                alg: p.alg().to_string(),
                secret_key_b64: k.secret_key_b64,
                public_key_b64: k.public_key_b64,
            }
        };
        let (signer, listed, pq) = (key(&Ed25519Provider), key(&Ed25519Provider), key(&MlDsa65Provider));
        // The classical signature is by another key than the one its kid names;
        // the PQ signature, over it, is valid.
        let classical = CompositeKeyInfo { kid: listed.kid.clone(), ..signer };
        let entry = |k: &CompositeKeyInfo| json!({ "kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64 });
        let passport_keys = [entry(&listed), entry(&pq)];
        let entries = json!([{ "audit_id": "a" }]);
        let root = audit_events_merkle_root(entries.as_array().unwrap()).unwrap();
        let mut cp = json!({
            "checkpoint_id": "c", "session_nonce": "n", "merkle_root": format!("sha256:{}", root),
            "event_range": { "from_audit_id": "a", "to_audit_id": "a", "count": 1 },
        });
        let canonical = canonicalize_v2(&cp).unwrap();
        let sig =
            composite_sign(&Ed25519Provider, &MlDsa65Provider, CTX_AUDIT_EVENT, canonical.as_bytes(), &classical, &pq);
        cp["composite_sig"] = serde_json::to_value(sig.unwrap()).unwrap();

        let bundle = json!({ "audit_entries": entries, "pq_checkpoints": [cp] });
        let manifest = json!({ "session_nonce": "n", "pq_checkpoints": ["c"] });
        let keys: Vec<&Value> = passport_keys.iter().collect();
        let policy = VerifierPolicy::default();
        assert_eq!(checkpoint_errors(&bundle, &manifest, "pq_only", &policy, &keys), Vec::<String>::new());
        for mode in ["classical_only", "hybrid_preferred", "hybrid_required"] {
            let errors = checkpoint_errors(&bundle, &manifest, mode, &policy, &keys).join("\n");
            assert!(errors.contains("pq_checkpoints[c]: signature verification failed"), "{mode}: {errors}");
        }
    }
}
