//! V2 bundle building and signing (spec/BUNDLE.md): the native counterpart of
//! `BundleBuilderV2` / `signBundleV2` in TypeScript and Python and of
//! `BuildBundleV2` / `SignBundleV2` in Go. Like Go, it does not take PQ
//! checkpoints yet; the TypeScript and Python builders do.

use serde_json::{json, Value};

use super::canonicalize::canonicalize_v2;
use super::composite_ops::{composite_sign, CompositeKeyInfo};
use super::domain_separation::CTX_BUNDLE;
use super::dual_hash::{dual_hash_canonical, dual_merkle_root, DualHash};
use super::lifecycle::utc_now_iso;
use super::session_nonce::verify_session_binding;
use super::signed_payload::{prepare_payload, SignedPayload};
use super::verify_bundle::provider_for_alg;

/// Build a V2 `CitizenshipBundle` from the four signed artifacts and the audit
/// trail. The RPR is signed with the principal's binding keys, the passport,
/// intent and policy decision with the agent's keys (`prepare_payload` and
/// `composite_sign` under their `CTX_*` contexts).
///
/// Every artifact and audit entry must carry `session_nonce`. The manifest
/// holds the SHA-256 audit Merkle root and, as in Go, the SHA3-256 one in
/// `audit_merkle_root_secondary`. An empty audit trail gets roots of 64
/// zeros, which spec/VERIFICATION.md allows, as in Go; the TypeScript and
/// Python builders refuse it.
pub fn build_bundle_v2(
    rpr: &SignedPayload,
    passport: &SignedPayload,
    intent: &SignedPayload,
    policy: &SignedPayload,
    audit_entries: &[Value],
    session_nonce: &str,
) -> Result<Value, String> {
    let signed = [
        ("responsible_principal_record", rpr),
        ("agent_passport", passport),
        ("intent", intent),
        ("policy_decision", policy),
    ];
    let mut hashes = Vec::with_capacity(signed.len());
    for (name, sp) in signed {
        let (_, hash) = prepare_payload(&sp.payload).map_err(|e| format!("{name}: {e}"))?;
        if sp.payload_hash != hash {
            return Err(format!("{name}: payload_hash does not match its payload"));
        }
        hashes.push(hash);
    }

    let artifacts: Vec<Value> = signed
        .iter()
        .map(|(_, sp)| sp.payload.clone())
        .chain(audit_entries.iter().cloned())
        .collect();
    let binding = verify_session_binding(&artifacts);
    if !binding.valid {
        return Err(format!(
            "Session nonce validation failed: {}",
            binding.error.unwrap_or_default()
        ));
    }
    if binding.nonce.as_deref() != Some(session_nonce) {
        return Err(format!(
            "Session nonce mismatch: builder={session_nonce}, artifacts={}",
            binding.nonce.unwrap_or_default()
        ));
    }

    let leaves = audit_entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            canonicalize_v2(e)
                .map(|c| dual_hash_canonical(&c))
                .map_err(|err| format!("audit_entries[{i}]: {err}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let root = dual_merkle_root(&leaves).unwrap_or_else(|| DualHash {
        sha256: "0".repeat(64),
        sha3_256: "0".repeat(64),
    });

    let manifest = json!({
        "session_nonce": session_nonce,
        "rpr_hash": hashes[0],
        "passport_hash": hashes[1],
        "intent_hash": hashes[2],
        "policy_hash": hashes[3],
        "audit_merkle_root": format!("sha256:{}", root.sha256),
        "audit_merkle_root_secondary": format!("sha3-256:{}", root.sha3_256),
        "audit_count": audit_entries.len(),
        "canonicalization_profile": "dcp-jcs-v1",
    });
    let artifact = |sp: &SignedPayload| serde_json::to_value(sp).map_err(|e| e.to_string());
    Ok(json!({
        "dcp_bundle_version": "2.0",
        "manifest": manifest,
        "responsible_principal_record": artifact(rpr)?,
        "agent_passport": artifact(passport)?,
        "intent": artifact(intent)?,
        "policy_decision": artifact(policy)?,
        "audit_entries": audit_entries,
    }))
}

/// Composite-sign the manifest of a bundle from [`build_bundle_v2`] and return
/// the `{bundle, signature}` envelope. The signer is the responsible principal,
/// as in the Go `SignBundleV2`: `signer.type` is `"human"` and `signer.id` the
/// RPR's `human_id`. Manifest fields that must be signed, such as
/// `session_expires_at` or `intended_verifier`, go into `bundle["manifest"]`
/// before this call. A manifest with `session_expires_at` and without
/// `session_issued_at` gets `session_issued_at` set to now before it is signed,
/// as in TypeScript: the session start a verifier's maximum session duration
/// is measured from (spec/VERIFICATION.md V2-4).
pub fn sign_bundle_v2(
    mut bundle: Value,
    classical: &CompositeKeyInfo,
    pq: &CompositeKeyInfo,
) -> Result<Value, String> {
    if let Some(manifest) = bundle.get_mut("manifest").and_then(Value::as_object_mut) {
        let set = |field: &str| manifest.get(field).is_some_and(|v| !v.is_null());
        if set("session_expires_at") && !set("session_issued_at") {
            manifest.insert("session_issued_at".into(), json!(utc_now_iso()));
        }
    }
    let manifest = bundle.get("manifest").ok_or("Missing manifest in bundle")?;
    let signer_id = bundle
        .pointer("/responsible_principal_record/payload/human_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or("responsible_principal_record has no human_id to name as the bundle signer")?
        .to_string();
    let (manifest_bytes, manifest_hash) = prepare_payload(manifest)?;
    let sig = composite_sign(
        provider_for_alg(&classical.alg)?.as_ref(),
        provider_for_alg(&pq.alg)?.as_ref(),
        CTX_BUNDLE,
        &manifest_bytes,
        classical,
        pq,
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({
        "bundle": bundle,
        "signature": {
            "hash_alg": "sha256",
            "created_at": utc_now_iso(),
            "signer": {"type": "human", "id": signer_id, "kids": [classical.kid, pq.kid]},
            "manifest_hash": manifest_hash,
            "composite_sig": sig,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{ed25519::Ed25519Provider, ml_dsa_65::MlDsa65Provider};
    use crate::v2::crypto_provider::CryptoProvider;
    use crate::v2::domain_separation::{
        CTX_AGENT_PASSPORT, CTX_INTENT, CTX_POLICY_DECISION, CTX_RESPONSIBLE_PRINCIPAL,
    };
    use crate::v2::dual_hash::{sha256_hex, sha3_256_hex};
    use crate::v2::session_nonce::parse_rfc3339_millis;
    use crate::v2::types::VerifierPolicy;
    use crate::v2::verify_bundle::{verify_signed_bundle_v2, verify_signed_bundle_v2_with_policy};

    fn key(p: &dyn CryptoProvider) -> CompositeKeyInfo {
        let k = p.generate_keypair().unwrap();
        CompositeKeyInfo {
            kid: k.kid,
            alg: p.alg().to_string(),
            secret_key_b64: k.secret_key_b64,
            public_key_b64: k.public_key_b64,
        }
    }

    fn entries(keys: &[&CompositeKeyInfo; 2]) -> Value {
        json!(keys
            .iter()
            .map(|k| json!({"kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64, "status": "active"}))
            .collect::<Vec<_>>())
    }

    fn sign(context: &str, payload: Value, keys: &[&CompositeKeyInfo; 2]) -> SignedPayload {
        let (bytes, payload_hash) = prepare_payload(&payload).unwrap();
        let composite_sig = composite_sign(
            &Ed25519Provider,
            &MlDsa65Provider,
            context,
            &bytes,
            keys[0],
            keys[1],
        )
        .unwrap();
        SignedPayload {
            payload,
            payload_hash,
            composite_sig,
        }
    }

    #[test]
    fn build_sign_verify_and_rejections() {
        let (hc, hp, ac, ap) = (
            key(&Ed25519Provider),
            key(&MlDsa65Provider),
            key(&Ed25519Provider),
            key(&MlDsa65Provider),
        );
        let (human, agent) = ([&hc, &hp], [&ac, &ap]);
        let nonce = "ab".repeat(32);
        let rpr = sign(
            CTX_RESPONSIBLE_PRINCIPAL,
            json!({"human_id": "human-1", "session_nonce": nonce, "binding_keys": entries(&human)}),
            &human,
        );
        let passport = sign(
            CTX_AGENT_PASSPORT,
            json!({
                "agent_id": "agent-1", "session_nonce": nonce, "keys": entries(&agent),
                "principal_binding_reference": "human-1", "status": "active",
            }),
            &agent,
        );
        let intent = sign(
            CTX_INTENT,
            json!({"intent_id": "i-1", "session_nonce": nonce, "agent_id": "agent-1", "human_id": "human-1"}),
            &agent,
        );
        let policy = sign(
            CTX_POLICY_DECISION,
            json!({"intent_id": "i-1", "session_nonce": nonce, "risk_score": 200, "decision": "approve"}),
            &agent,
        );
        // Audit entries name the intent, by id and payload hash, the agent and
        // the principal, and record the policy decision (V2-14).
        let entry = |audit_id: &str, prev_hash: String| {
            json!({
                "audit_id": audit_id, "session_nonce": nonce, "prev_hash": prev_hash,
                "intent_id": "i-1", "intent_hash": intent.payload_hash, "agent_id": "agent-1", "human_id": "human-1",
                "policy_decision": "approved",
            })
        };
        let a1 = entry("a-1", "GENESIS".into());
        let a1_hash = sha256_hex(canonicalize_v2(&a1).unwrap().as_bytes());
        let a2 = entry("a-2", format!("sha256:{a1_hash}"));
        let trail = [a1, a2];

        let bundle = build_bundle_v2(&rpr, &passport, &intent, &policy, &trail, &nonce).unwrap();
        let signed = sign_bundle_v2(bundle, &hc, &hp).unwrap();
        let result = verify_signed_bundle_v2(&signed);
        assert!(result.verified, "{:?}", result.errors);
        assert_eq!(signed["signature"]["signer"]["id"], "human-1");
        let created_at = signed["signature"]["created_at"].as_str().unwrap();
        assert!(parse_rfc3339_millis(created_at).is_some(), "{created_at}");
        // SHA3-256 leaves joined by SHA3-256, as in TypeScript and Python.
        let leaf = |e: &Value| {
            hex::decode(dual_hash_canonical(&canonicalize_v2(e).unwrap()).sha3_256).unwrap()
        };
        let sha3_root = sha3_256_hex(&[leaf(&trail[0]), leaf(&trail[1])].concat());
        assert_eq!(
            signed["bundle"]["manifest"]["audit_merkle_root_secondary"],
            format!("sha3-256:{sha3_root}")
        );
        let empty = build_bundle_v2(&rpr, &passport, &intent, &policy, &[], &nonce).unwrap();
        assert_eq!(
            empty["manifest"]["audit_merkle_root"],
            format!("sha256:{}", "0".repeat(64))
        );
        let result = verify_signed_bundle_v2(&sign_bundle_v2(empty, &hc, &hp).unwrap());
        assert!(result.verified, "{:?}", result.errors);
        assert!(signed["bundle"]["manifest"]
            .get("session_issued_at")
            .is_none());

        // A session that expires gets its signed start, which a maximum session
        // duration is measured from (V2-4); a start already set is kept.
        let mut expiring =
            build_bundle_v2(&rpr, &passport, &intent, &policy, &trail, &nonce).unwrap();
        expiring["manifest"]["session_expires_at"] = json!("2099-12-31T23:59:59Z");
        let signed = sign_bundle_v2(expiring.clone(), &hc, &hp).unwrap();
        let issued_at = signed["bundle"]["manifest"]["session_issued_at"]
            .as_str()
            .unwrap();
        assert!(parse_rfc3339_millis(issued_at).is_some(), "{issued_at}");
        let within = VerifierPolicy {
            max_session_duration_seconds: Some(3_000_000_000),
            ..VerifierPolicy::default()
        };
        let result = verify_signed_bundle_v2_with_policy(&signed, &within);
        assert!(result.verified, "{:?}", result.errors);
        expiring["manifest"]["session_issued_at"] = json!("2026-10-21T00:00:00Z");
        let signed = sign_bundle_v2(expiring, &hc, &hp).unwrap();
        assert_eq!(
            signed["bundle"]["manifest"]["session_issued_at"],
            "2026-10-21T00:00:00Z"
        );

        let build = |trail: &[Value], nonce: &str, rpr: &SignedPayload| {
            build_bundle_v2(rpr, &passport, &intent, &policy, trail, nonce).unwrap_err()
        };
        assert!(build(&trail, &"cd".repeat(32), &rpr).contains("Session nonce mismatch"));
        let stray =
            json!({"audit_id": "a-3", "session_nonce": "cd".repeat(32), "prev_hash": "GENESIS"});
        assert!(build(&[stray], &nonce, &rpr).contains("Session nonce validation failed"));
        let mut stale = rpr.clone();
        stale.payload["human_id"] = json!("human-2");
        assert!(build(&trail, &nonce, &stale).contains("payload_hash does not match"));

        let bundle = build_bundle_v2(&rpr, &passport, &intent, &policy, &trail, &nonce).unwrap();
        for human_id in [Value::Null, json!("")] {
            let mut anonymous = bundle.clone();
            anonymous["responsible_principal_record"]["payload"]["human_id"] = human_id;
            assert!(sign_bundle_v2(anonymous, &hc, &hp)
                .unwrap_err()
                .contains("no human_id"));
        }
    }
}
