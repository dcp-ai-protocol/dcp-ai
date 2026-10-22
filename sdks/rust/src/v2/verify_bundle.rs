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
use crate::v2::dual_hash;
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
/// `risk_tier`) and the security tier's mode (spec §14.3). Only those two
/// fields are enforced; a policy that changes any other field fails
/// verification instead of having the setting ignored.
pub fn verify_signed_bundle_v2_with_policy(signed_bundle: &Value, policy: &VerifierPolicy) -> V2VerificationResult {
    let mut r = V2VerificationResult { dcp_version: "2.0".into(), ..Default::default() };
    let enforced = VerifierPolicy {
        default_mode: policy.default_mode.clone(),
        risk_overrides: policy.risk_overrides.clone(),
        ..VerifierPolicy::default()
    };
    if *policy != enforced {
        r.errors.push(
            "Verifier policy sets fields this verifier does not enforce: only default_mode and risk_overrides may differ from the default"
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

    // Verify manifest hashes against actual artifact hashes
    if let Some(manifest) = bundle.get("manifest") {
        for (field, hash_key) in &[
            ("responsible_principal_record", "rpr_hash"),
            ("agent_passport", "passport_hash"),
            ("intent", "intent_hash"),
            ("policy_decision", "policy_hash"),
        ] {
            if let (Some(artifact), Some(expected)) = (
                bundle.get(*field).and_then(|a| a.get("payload")),
                manifest.get(*hash_key).and_then(|h| h.as_str()),
            ) {
                if let Ok(canonical) = canonicalize_v2(artifact) {
                    let dh = dual_hash::dual_hash_canonical(&canonical);
                    let computed = format!("sha256:{}", dh.sha256);
                    if computed != expected {
                        r.errors.push(format!("Manifest {} mismatch", hash_key));
                    }
                }
            }
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
                    match check_mode(mode, &cs, &result) {
                        Err(e) => r.errors.push(format!("Bundle {}", e)),
                        Ok(Some(w)) => r.warnings.push(format!("Bundle {}", w)),
                        Ok(None) => {}
                    }
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
            Ok((cs, result)) => match check_mode(mode, &cs, &result) {
                Err(e) => r.errors.push(format!("{} {}", field, e)),
                Ok(Some(w)) => r.warnings.push(format!("{} {}", field, w)),
                Ok(None) => {}
            },
        }
    }

    // Verify audit entry hash chain
    if let Some(entries) = bundle.get("audit_entries").and_then(|e| e.as_array()) {
        let mut expected_prev = "sha256:".to_string() + &"0".repeat(64);
        for (i, entry) in entries.iter().enumerate() {
            if let Some(prev) = entry.get("prev_hash").and_then(|p| p.as_str()) {
                if i > 0 && prev != expected_prev {
                    r.errors.push(format!("Audit hash chain broken at entry {}", i));
                    break;
                }
            }
            if let Ok(canonical) = canonicalize_v2(entry) {
                let dh = dual_hash::dual_hash_canonical(&canonical);
                expected_prev = format!("sha256:{}", dh.sha256);
            }
        }
    }

    r.session_binding_valid = !manifest_nonce.is_empty();
    r.manifest_valid = bundle.get("manifest").is_some();
    r.verified = r.errors.is_empty();
    r
}

/// Apply the verification mode to one verified composite signature
/// (VERIFICATION.md V2-7, V2-10): `Err` rejects it, `Ok(Some(_))` is a warning.
/// A PQ signature that is present must verify in every mode; `result.valid`
/// covers both components for pq_over_classical.
fn check_mode(mode: &str, cs: &CompositeSignature, result: &CompositeVerifyResult) -> Result<Option<String>, String> {
    match mode {
        "pq_only" if cs.binding != "pq_over_classical" || !result.pq_valid => {
            Err("PQ signature invalid or missing (pq_only)".into())
        }
        "pq_only" if !result.classical_valid => Ok(Some("classical signature not verified in pq_only mode".into())),
        "pq_only" => Ok(None),
        "hybrid_required" if cs.binding != "pq_over_classical" => {
            Err(format!("hybrid_required needs a pq_over_classical signature, got {}", cs.binding))
        }
        _ if !result.valid => Err("signature verification failed".into()),
        "hybrid_preferred" if cs.binding == "classical_only" => {
            Ok(Some("classical_only binding (no PQ protection)".into()))
        }
        _ => Ok(None),
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
