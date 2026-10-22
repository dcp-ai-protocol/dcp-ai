//! V2 signed bundle verification (spec/VERIFICATION.md, V2 checklist).

use serde::Serialize;
use serde_json::Value;

use crate::providers::ed25519::Ed25519Provider;
use crate::providers::ml_dsa_65::MlDsa65Provider;
use crate::providers::slh_dsa_192f::SlhDsa192fProvider;
use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_verify, CompositeVerifyResult};
use crate::v2::composite_sig::CompositeSignature;
use crate::v2::crypto_provider::CryptoProvider;
use crate::v2::domain_separation::{
    CTX_AGENT_PASSPORT, CTX_BUNDLE, CTX_INTENT, CTX_POLICY_DECISION, CTX_RESPONSIBLE_PRINCIPAL,
};
use crate::crypto::merkle_root_from_hex_leaves;
use crate::v2::dual_hash;
use crate::v2::lifecycle::unix_now_millis;
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
/// fields, only the Phase 3 ones are enforced, as in the TypeScript SDK:
/// `advisory_rejected_algs`, `warn_classical_only_deprecated` and
/// `allow_classical_fallback_disable`. A policy that changes any other field
/// fails verification instead of having the setting ignored.
pub fn verify_signed_bundle_v2_with_policy(signed_bundle: &Value, policy: &VerifierPolicy) -> V2VerificationResult {
    let mut r = V2VerificationResult { dcp_version: "2.0".into(), ..Default::default() };
    let enforced = VerifierPolicy {
        default_mode: policy.default_mode.clone(),
        risk_overrides: policy.risk_overrides.clone(),
        allow_classical_fallback_disable: policy.allow_classical_fallback_disable,
        warn_classical_only_deprecated: policy.warn_classical_only_deprecated,
        advisory_rejected_algs: policy.advisory_rejected_algs.clone(),
        ..VerifierPolicy::default()
    };
    if *policy != enforced {
        r.errors.push(
            "Verifier policy sets fields this verifier does not enforce: only default_mode, risk_overrides and the Phase 3 fields may differ from the default"
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
        let expires = manifest.get("session_expires_at");
        match check_expiry(expires) {
            Ok(()) => {}
            Err(Expiry::Invalid) => r.errors.push(format!("Invalid session_expires_at: {}", display(expires))),
            Err(Expiry::Passed) => r.errors.push(format!("Session expired at {}", display(expires))),
        }
    }

    // Session nonce consistency across artifacts
    if !manifest_nonce.is_empty() {
        for field in &["responsible_principal_record", "agent_passport", "intent", "policy_decision"] {
            if let Some(nonce) = bundle.get(*field)
                .and_then(|a| a.get("payload"))
                .and_then(|p| p.get("session_nonce"))
                .and_then(|n| n.as_str())
            {
                if nonce != manifest_nonce {
                    r.errors.push(format!("Session nonce mismatch in {}", field));
                    break;
                }
            }
        }
    }

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

    // Bundle composite_sig over the manifest: signed by the agent or by its principal.
    let rpr_keys = payload_keys(bundle, "responsible_principal_record", "binding_keys");
    let agent_keys = payload_keys(bundle, "agent_passport", "keys");
    match (signature.get("composite_sig"), bundle.get("manifest")) {
        (None, _) => r.errors.push("Missing composite_sig in signature".to_string()),
        (Some(_), None) => {}
        (Some(cs_val), Some(manifest)) => {
            let keys: Vec<&Value> = agent_keys.iter().chain(rpr_keys.iter()).copied().collect();
            match verify_composite_sig(CTX_BUNDLE, manifest, Some(cs_val), &keys) {
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

    // Each artifact's own composite_sig (V2-8): the principal signs the RPR
    // with its binding_keys, the agent signs the rest with its passport keys.
    for (field, context, keys) in [
        ("responsible_principal_record", CTX_RESPONSIBLE_PRINCIPAL, &rpr_keys),
        ("agent_passport", CTX_AGENT_PASSPORT, &agent_keys),
        ("intent", CTX_INTENT, &agent_keys),
        ("policy_decision", CTX_POLICY_DECISION, &agent_keys),
    ] {
        let Some(artifact) = bundle.get(field) else { continue }; // reported as missing above
        let Some(payload) = artifact.get("payload").filter(|p| p.is_object()) else {
            r.errors.push(format!("{} is not a SignedPayload object", field));
            continue;
        };
        match verify_composite_sig(context, payload, artifact.get("composite_sig"), keys) {
            Err(e) => r.errors.push(format!("{} signature: {}", field, e)),
            Ok((cs, result)) => {
                let (errors, warnings) = check_mode(mode, policy, &cs, &result);
                r.errors.extend(errors.iter().map(|e| format!("{} {}", field, e)));
                r.warnings.extend(warnings.iter().map(|w| format!("{} {}", field, w)));
            }
        }
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

/// Why an expiry fails.
enum Expiry {
    Invalid,
    Passed,
}

/// An optional expiry (`session_expires_at`, a key's `expires_at`): absent or
/// null never expires; anything else must be an RFC 3339 timestamp still in
/// the future.
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

/// Public key and algorithm of the key entry with that kid.
fn find_key<'a>(keys: &[&'a Value], kid: &str) -> Option<(&'a str, &'a str)> {
    let key = keys.iter().find(|k| k.get("kid").and_then(|v| v.as_str()) == Some(kid))?;
    Some((
        key.get("public_key_b64").and_then(|v| v.as_str())?,
        key.get("alg").and_then(|v| v.as_str()).unwrap_or(""),
    ))
}

pub(crate) fn provider_for_alg(alg: &str) -> Result<Box<dyn CryptoProvider>, String> {
    match alg {
        "ed25519" => Ok(Box::new(Ed25519Provider)),
        "ml-dsa-65" => Ok(Box::new(MlDsa65Provider)),
        "slh-dsa-192f" => Ok(Box::new(SlhDsa192fProvider)),
        _ => Err(format!("Unknown algorithm: {}", alg)),
    }
}

/// Verify a composite_sig over `payload` with the keys it names by kid
/// (VERIFICATION.md V2-6, V2-7): pq_over_classical is valid only when both
/// components verify; classical_only carries no PQ signature.
fn verify_composite_sig(
    context: &str,
    payload: &Value,
    cs_val: Option<&Value>,
    keys: &[&Value],
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
        .ok_or_else(|| format!("classical signer key kid={} not found", cs.classical.kid))?;
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
                .ok_or_else(|| format!("PQ signer key kid={} not found", entry.kid))?;
            if alg != entry.alg {
                return Err(format!("PQ signer key kid={} is {}, not {}", entry.kid, alg, entry.alg));
            }
            (Some(provider_for_alg(&entry.alg)?), Some(pk))
        }
        None => (None, None),
    };
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
}
