//! DCP v2.0 Algorithm Advisory helpers — Rust port.
//!
//! Mirrors the Python `algorithm_advisory.check_advisory`,
//! `evaluate_advisories`, and `apply_advisories_to_policy`. Advisory
//! payloads are passed as `serde_json::Value` to avoid tying the helpers
//! to a concrete struct schema.

use std::collections::BTreeSet;

use serde_json::{json, Value};

/// Seconds since the Unix epoch of an RFC 3339 timestamp, offsets included.
fn parse_iso_epoch_secs(ts: &str) -> Option<i64> {
    crate::v2::session_nonce::parse_rfc3339_millis(ts).map(|ms| ms.div_euclid(1000))
}

fn now_epoch_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Result of checking a single advisory.
#[derive(Debug, Clone)]
pub struct AdvisoryCheckResult {
    pub affected_algorithms: Vec<String>,
    pub action: String,
    pub severity: String,
    pub advisory_id: String,
    pub description: String,
    pub grace_period_expired: bool,
}

/// Evaluate whether an advisory's grace period has expired at `now_secs`.
pub fn check_advisory(advisory: &Value, now_secs: Option<i64>) -> AdvisoryCheckResult {
    let effective = advisory
        .get("effective_date")
        .and_then(Value::as_str)
        .and_then(parse_iso_epoch_secs)
        .unwrap_or(0);
    let grace_days = advisory
        .get("grace_period_days")
        .and_then(Value::as_i64)
        .unwrap_or(90);
    let grace_end = effective + grace_days * 86_400;
    let now = now_secs.unwrap_or_else(now_epoch_secs);

    AdvisoryCheckResult {
        affected_algorithms: advisory
            .get("affected_algorithms")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default(),
        action: advisory
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        severity: advisory
            .get("severity")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        advisory_id: advisory
            .get("advisory_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        description: advisory
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        grace_period_expired: now >= grace_end,
    }
}

#[derive(Debug, Clone, Default)]
pub struct AdvisoryEvaluation {
    pub deprecated: BTreeSet<String>,
    pub warned: BTreeSet<String>,
    pub revoked: BTreeSet<String>,
    pub active_advisories: Vec<AdvisoryCheckResult>,
}

/// Evaluate a list of advisories into deprecated / warned / revoked sets.
pub fn evaluate_advisories(advisories: &[Value], now_secs: Option<i64>) -> AdvisoryEvaluation {
    let now = now_secs.unwrap_or_else(now_epoch_secs);
    let mut out = AdvisoryEvaluation::default();

    for advisory in advisories {
        let effective = advisory
            .get("effective_date")
            .and_then(Value::as_str)
            .and_then(parse_iso_epoch_secs)
            .unwrap_or(i64::MAX);
        if now < effective {
            continue;
        }
        let result = check_advisory(advisory, Some(now));
        for alg in &result.affected_algorithms {
            match result.action.as_str() {
                "revoke" => {
                    out.revoked.insert(alg.clone());
                }
                "deprecate" => {
                    if result.grace_period_expired {
                        out.deprecated.insert(alg.clone());
                    } else {
                        out.warned.insert(alg.clone());
                    }
                }
                "warn" => {
                    out.warned.insert(alg.clone());
                }
                _ => {}
            }
        }
        out.active_advisories.push(result);
    }
    out
}

#[derive(Debug, Clone, Default)]
pub struct PolicyFilterOutcome {
    pub filtered_algs: Vec<String>,
    pub removed_algs: Vec<String>,
    pub warnings: Vec<String>,
}

/// Apply an `AdvisoryEvaluation` to a list of accepted algorithms.
pub fn apply_advisories_to_policy(
    accepted_algs: &[String],
    advisory_result: &AdvisoryEvaluation,
) -> PolicyFilterOutcome {
    let blocked: BTreeSet<&String> = advisory_result
        .deprecated
        .iter()
        .chain(advisory_result.revoked.iter())
        .collect();

    let mut out = PolicyFilterOutcome::default();
    for alg in accepted_algs {
        if blocked.contains(alg) {
            out.removed_algs.push(alg.clone());
        } else {
            out.filtered_algs.push(alg.clone());
            if advisory_result.warned.contains(alg) {
                out.warnings
                    .push(format!("Algorithm {alg} has an active advisory warning"));
            }
        }
    }
    out
}

/// Convenience: build an `AlgorithmAdvisory` JSON value with sensible defaults.
pub fn build_algorithm_advisory(
    advisory_id: &str,
    severity: &str,
    affected_algorithms: Vec<String>,
    action: &str,
    effective_date: &str,
    description: &str,
    issuer: &str,
) -> Value {
    json!({
        "type": "algorithm_advisory",
        "advisory_id": advisory_id,
        "severity": severity,
        "affected_algorithms": affected_algorithms,
        "action": action,
        "replacement_algorithms": [],
        "effective_date": effective_date,
        "grace_period_days": 90,
        "description": description,
        "issued_at": effective_date,
        "issuer": issuer,
    })
}
