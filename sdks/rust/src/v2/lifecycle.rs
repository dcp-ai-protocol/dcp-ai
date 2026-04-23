//! DCP-05 v2.0 Agent Lifecycle Management — Rust port.
//!
//! State machine: commissioned -> active -> declining -> decommissioned.
//! Mirrors `sdks/typescript/src/core/lifecycle.ts` exactly.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_LIFECYCLE;

// ── Lifecycle state machine ──

/// Return `true` iff the lifecycle transition from->to is allowed.
pub fn validate_state_transition(from: &str, to: &str) -> bool {
    match from {
        "commissioned" => matches!(to, "active" | "decommissioned"),
        "active" => matches!(to, "declining" | "decommissioned"),
        "declining" => matches!(to, "decommissioned" | "active"),
        "decommissioned" => false,
        _ => false,
    }
}

// ── Vitality scoring ──

/// Metric weights match the TS/Python implementations.
const W_TASK_COMPLETION: f64 = 0.3;
const W_ERROR_RATE: f64 = 0.25;
const W_HUMAN_SATISFACTION: f64 = 0.25;
const W_POLICY_ALIGNMENT: f64 = 0.2;

/// Vitality metrics in the [0.0, 1.0] range per field.
pub struct VitalityMetricsFloat {
    pub task_completion_rate: f64,
    pub error_rate: f64,
    pub human_satisfaction: f64,
    pub policy_alignment: f64,
}

/// Compute a vitality score in `0..=1000` from metrics.
/// `error_rate` is inverted (lower error = higher score).
pub fn compute_vitality_score(m: &VitalityMetricsFloat) -> u32 {
    let raw = m.task_completion_rate * W_TASK_COMPLETION
        + (1.0 - m.error_rate) * W_ERROR_RATE
        + m.human_satisfaction * W_HUMAN_SATISFACTION
        + m.policy_alignment * W_POLICY_ALIGNMENT;
    let clamped = raw.max(0.0).min(1.0);
    (clamped * 1000.0).round() as u32
}

// ── Artifact creation ──

pub(crate) fn utc_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs() as i64;
    let millis = d.subsec_millis();
    let (y, mo, d, h, mi, s) = civil_from_secs(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, mo, d, h, mi, s, millis
    )
}

/// Expose the timestamp helper for sibling modules (succession).
pub(crate) fn utc_now_iso_pub() -> String {
    utc_now_iso()
}

/// Convert seconds since epoch to (year, month, day, hour, minute, second) UTC.
fn civil_from_secs(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    // Howard Hinnant's civil_from_days algorithm.
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400) as u32;
    let z = days + 719_468;
    let era = if z >= 0 { z / 146_097 } else { (z - 146_096) / 146_097 };
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let h = tod / 3600;
    let mi = (tod % 3600) / 60;
    let s = tod % 60;
    (y, m, d, h, mi, s)
}

/// Parameters for creating a commissioning certificate.
pub struct CommissioningParams<'a> {
    pub agent_id: &'a str,
    pub session_nonce: &'a str,
    pub human_id: &'a str,
    pub commissioning_authority: &'a str,
    pub purpose: &'a str,
    pub initial_capabilities: Vec<String>,
    pub risk_tier: &'a str,
    pub principal_binding_reference: &'a str,
}

/// Create a commissioning certificate for a new agent.
pub fn create_commissioning_certificate(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: CommissioningParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "agent_id": params.agent_id,
        "session_nonce": params.session_nonce,
        "human_id": params.human_id,
        "commissioning_authority": params.commissioning_authority,
        "timestamp": utc_now_iso(),
        "purpose": params.purpose,
        "initial_capabilities": params.initial_capabilities,
        "risk_tier": params.risk_tier,
        "principal_binding_reference": params.principal_binding_reference,
    });

    Ok(finalize_lifecycle_payload(
        classical_provider,
        pq_provider,
        classical_key,
        pq_key,
        payload,
    )?)
}

/// Parameters for creating a vitality report.
pub struct VitalityReportParams<'a> {
    pub agent_id: &'a str,
    pub session_nonce: &'a str,
    pub state: &'a str,
    /// Metrics serialized as integers (0 or 1) on the wire — DCP v2.0 forbids
    /// floats in canonicalization. Pass per-metric integer values that honour
    /// the protocol's 0..=1 bounds. Use `compute_vitality_score` with floats
    /// to derive the numeric score.
    pub metrics: VitalityMetricsInt,
    pub prev_report_hash: &'a str,
}

/// On-the-wire integer representation of vitality metrics.
pub struct VitalityMetricsInt {
    pub task_completion_rate: u32,
    pub error_rate: u32,
    pub human_satisfaction: u32,
    pub policy_alignment: u32,
}

/// Create a vitality report hash-chained to the previous one.
pub fn create_vitality_report(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: VitalityReportParams<'_>,
) -> Result<Value, CryptoError> {
    let vitality_score = compute_vitality_score(&VitalityMetricsFloat {
        task_completion_rate: params.metrics.task_completion_rate as f64,
        error_rate: params.metrics.error_rate as f64,
        human_satisfaction: params.metrics.human_satisfaction as f64,
        policy_alignment: params.metrics.policy_alignment as f64,
    });

    let payload = json!({
        "dcp_version": "2.0",
        "agent_id": params.agent_id,
        "session_nonce": params.session_nonce,
        "timestamp": utc_now_iso(),
        "vitality_score": vitality_score,
        "state": params.state,
        "metrics": {
            "task_completion_rate": params.metrics.task_completion_rate,
            "error_rate": params.metrics.error_rate,
            "human_satisfaction": params.metrics.human_satisfaction,
            "policy_alignment": params.metrics.policy_alignment,
        },
        "prev_report_hash": params.prev_report_hash,
    });

    finalize_lifecycle_payload(
        classical_provider,
        pq_provider,
        classical_key,
        pq_key,
        payload,
    )
}

/// Compute the `sha256:<hex>` hash of a vitality report, with `composite_sig` excluded.
pub fn hash_vitality_report(report: &Value) -> Result<String, String> {
    let mut payload = report.clone();
    if let Some(obj) = payload.as_object_mut() {
        obj.remove("composite_sig");
    }
    let canonical = canonicalize_v2(&payload)?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

/// Parameters for creating a decommissioning record.
pub struct DecommissioningParams<'a> {
    pub agent_id: &'a str,
    pub session_nonce: &'a str,
    pub human_id: &'a str,
    pub termination_mode: &'a str,
    pub reason: &'a str,
    pub final_vitality_score: u32,
    pub successor_agent_id: Option<&'a str>,
    pub data_disposition: &'a str,
}

/// Create a decommissioning record.
pub fn create_decommissioning_record(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: DecommissioningParams<'_>,
) -> Result<Value, CryptoError> {
    let successor: Value = match params.successor_agent_id {
        Some(s) => Value::String(s.to_string()),
        None => Value::Null,
    };
    let payload = json!({
        "dcp_version": "2.0",
        "agent_id": params.agent_id,
        "session_nonce": params.session_nonce,
        "human_id": params.human_id,
        "timestamp": utc_now_iso(),
        "termination_mode": params.termination_mode,
        "reason": params.reason,
        "final_vitality_score": params.final_vitality_score,
        "successor_agent_id": successor,
        "data_disposition": params.data_disposition,
    });

    finalize_lifecycle_payload(
        classical_provider,
        pq_provider,
        classical_key,
        pq_key,
        payload,
    )
}

fn finalize_lifecycle_payload(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    payload: Value,
) -> Result<Value, CryptoError> {
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        CTX_LIFECYCLE,
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
    use crate::providers::ed25519::Ed25519Provider;
    use crate::providers::ml_dsa_65::MlDsa65Provider;

    fn make_keys() -> (CompositeKeyInfo, CompositeKeyInfo) {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let ed_kp = ed.generate_keypair().unwrap();
        let pq_kp = pq.generate_keypair().unwrap();
        (
            CompositeKeyInfo {
                kid: ed_kp.kid,
                alg: "ed25519".into(),
                secret_key_b64: ed_kp.secret_key_b64,
                public_key_b64: ed_kp.public_key_b64,
            },
            CompositeKeyInfo {
                kid: pq_kp.kid,
                alg: "ml-dsa-65".into(),
                secret_key_b64: pq_kp.secret_key_b64,
                public_key_b64: pq_kp.public_key_b64,
            },
        )
    }

    #[test]
    fn state_transitions_respect_the_machine() {
        assert!(validate_state_transition("commissioned", "active"));
        assert!(validate_state_transition("commissioned", "decommissioned"));
        assert!(validate_state_transition("active", "declining"));
        assert!(validate_state_transition("declining", "active"));
        assert!(!validate_state_transition("decommissioned", "active"));
        assert!(!validate_state_transition("commissioned", "declining"));
        assert!(!validate_state_transition("bogus", "active"));
    }

    #[test]
    fn vitality_score_bounds() {
        let perfect = compute_vitality_score(&VitalityMetricsFloat {
            task_completion_rate: 1.0,
            error_rate: 0.0,
            human_satisfaction: 1.0,
            policy_alignment: 1.0,
        });
        assert_eq!(perfect, 1000);

        let zero_perf = compute_vitality_score(&VitalityMetricsFloat {
            task_completion_rate: 0.0,
            error_rate: 1.0,
            human_satisfaction: 0.0,
            policy_alignment: 0.0,
        });
        assert_eq!(zero_perf, 0);
    }

    #[test]
    fn commissioning_certificate_has_composite_sig() {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let (ck, pqk) = make_keys();
        let cert = create_commissioning_certificate(
            &ed,
            &pq,
            &ck,
            &pqk,
            CommissioningParams {
                agent_id: "agent_123",
                session_nonce: &"a".repeat(64),
                human_id: "human_456",
                commissioning_authority: "org.example",
                purpose: "Research assistant",
                initial_capabilities: vec!["read_email".into(), "draft_response".into()],
                risk_tier: "medium",
                principal_binding_reference: "rpr_hash_abc",
            },
        )
        .unwrap();

        assert_eq!(cert["dcp_version"], "2.0");
        assert_eq!(cert["agent_id"], "agent_123");
        assert_eq!(cert["composite_sig"]["binding"], "pq_over_classical");
    }

    #[test]
    fn vitality_report_with_integer_metrics() {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let (ck, pqk) = make_keys();
        let report = create_vitality_report(
            &ed,
            &pq,
            &ck,
            &pqk,
            VitalityReportParams {
                agent_id: "agent_123",
                session_nonce: &"a".repeat(64),
                state: "active",
                metrics: VitalityMetricsInt {
                    task_completion_rate: 1,
                    error_rate: 0,
                    human_satisfaction: 1,
                    policy_alignment: 1,
                },
                prev_report_hash: "GENESIS",
            },
        )
        .unwrap();

        assert_eq!(report["state"], "active");
        assert_eq!(report["vitality_score"], 1000);
        assert_eq!(report["prev_report_hash"], "GENESIS");
    }

    #[test]
    fn hash_vitality_report_is_deterministic() {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let (ck, pqk) = make_keys();
        let report = create_vitality_report(
            &ed,
            &pq,
            &ck,
            &pqk,
            VitalityReportParams {
                agent_id: "agent_123",
                session_nonce: &"a".repeat(64),
                state: "active",
                metrics: VitalityMetricsInt {
                    task_completion_rate: 1,
                    error_rate: 0,
                    human_satisfaction: 1,
                    policy_alignment: 1,
                },
                prev_report_hash: "GENESIS",
            },
        )
        .unwrap();
        let h1 = hash_vitality_report(&report).unwrap();
        let h2 = hash_vitality_report(&report).unwrap();
        assert_eq!(h1, h2);
        assert!(h1.starts_with("sha256:"));
        assert_eq!(h1.len(), "sha256:".len() + 64);
    }

    #[test]
    fn decommissioning_without_successor() {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let (ck, pqk) = make_keys();
        let record = create_decommissioning_record(
            &ed,
            &pq,
            &ck,
            &pqk,
            DecommissioningParams {
                agent_id: "agent_123",
                session_nonce: &"a".repeat(64),
                human_id: "human_456",
                termination_mode: "termination_for_cause",
                reason: "policy_violation",
                final_vitality_score: 120,
                successor_agent_id: None,
                data_disposition: "destroyed",
            },
        )
        .unwrap();
        assert!(record["successor_agent_id"].is_null());
        assert_eq!(record["data_disposition"], "destroyed");
    }
}
