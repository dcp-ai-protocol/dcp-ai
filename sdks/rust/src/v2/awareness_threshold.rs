//! DCP-09 v2.0 Awareness Threshold Engine — Rust port.
//!
//! Significance scoring operates in 0..=1000 (millipoints).

use std::collections::BTreeSet;

use serde_json::{json, Value};

use crate::v2::canonicalize::canonicalize_v2;
use crate::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use crate::v2::crypto_provider::{CryptoError, CryptoProvider};
use crate::v2::domain_separation::CTX_AWARENESS;
use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

#[derive(Debug, Clone, Default)]
pub struct SignificanceContext {
    pub financial_impact: Option<f64>,
    pub data_sensitivity: Option<f64>,
    pub relationship_impact: Option<f64>,
    pub irreversibility: Option<f64>,
    pub precedent_setting: Option<f64>,
}

/// Evaluate the significance of an action in `0..=1000`.
pub fn evaluate_significance(ctx: &SignificanceContext) -> u32 {
    let weights: [(f64, f64); 5] = [
        (ctx.financial_impact.unwrap_or(0.0), 0.25),
        (ctx.data_sensitivity.unwrap_or(0.0), 0.20),
        (ctx.relationship_impact.unwrap_or(0.0), 0.20),
        (ctx.irreversibility.unwrap_or(0.0), 0.20),
        (ctx.precedent_setting.unwrap_or(0.0), 0.15),
    ];
    let mut total = 0.0;
    for (v, w) in weights {
        let clamped = v.max(0.0).min(1.0);
        total += clamped * w;
    }
    (total * 1000.0).round() as u32
}

fn evaluate_operator(op: &str, actual: f64, threshold: f64) -> bool {
    match op {
        "gt" => actual > threshold,
        "lt" => actual < threshold,
        "gte" => actual >= threshold,
        "lte" => actual <= threshold,
        "eq" => (actual - threshold).abs() < f64::EPSILON,
        _ => false,
    }
}

#[derive(Debug, Clone, Default)]
pub struct NotifyResult {
    pub notify: bool,
    pub triggered_rules: Vec<Value>,
    pub actions: Vec<String>,
}

/// Given a significance score and a set of threshold rules, determine whether
/// a human should be notified and which actions to take.
pub fn should_notify_human(significance: f64, thresholds: &[Value]) -> NotifyResult {
    let mut triggered = Vec::new();
    let mut action_set = BTreeSet::<String>::new();
    let mut actions_ordered = Vec::new();

    for rule in thresholds {
        let dim = rule.get("dimension").and_then(Value::as_str).unwrap_or("");
        let op = rule.get("operator").and_then(Value::as_str).unwrap_or("");
        let val = rule.get("value").and_then(Value::as_f64).unwrap_or(0.0);
        let actual = if dim == "significance" { significance } else { 0.0 };
        if evaluate_operator(op, actual, val) {
            triggered.push(rule.clone());
            if let Some(action) = rule.get("action_if_triggered").and_then(Value::as_str) {
                if action_set.insert(action.to_string()) {
                    actions_ordered.push(action.to_string());
                }
            }
        }
    }
    NotifyResult {
        notify: !triggered.is_empty(),
        triggered_rules: triggered,
        actions: actions_ordered,
    }
}

pub struct AwarenessThresholdParams<'a> {
    pub threshold_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub human_id: &'a str,
    pub threshold_rules: Vec<Value>,
}

pub fn create_awareness_threshold(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: AwarenessThresholdParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "threshold_id": params.threshold_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "human_id": params.human_id,
        "threshold_rules": params.threshold_rules,
        "timestamp": utc_now_iso(),
    });
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        CTX_AWARENESS,
        canonical.as_bytes(),
        classical_key,
        pq_key,
    )?;
    let mut out = payload;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "composite_sig".into(),
            serde_json::to_value(&composite).map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}

pub struct AdvisoryDeclarationParams<'a> {
    pub declaration_id: &'a str,
    pub session_nonce: &'a str,
    pub agent_id: &'a str,
    pub human_id: &'a str,
    pub significance_score: u32,
    pub action_summary: &'a str,
    pub recommended_response: &'a str,
    pub response_deadline: &'a str,
}

pub fn create_advisory_declaration(
    classical_provider: &dyn CryptoProvider,
    pq_provider: &dyn CryptoProvider,
    classical_key: &CompositeKeyInfo,
    pq_key: &CompositeKeyInfo,
    params: AdvisoryDeclarationParams<'_>,
) -> Result<Value, CryptoError> {
    let payload = json!({
        "dcp_version": "2.0",
        "declaration_id": params.declaration_id,
        "session_nonce": params.session_nonce,
        "agent_id": params.agent_id,
        "human_id": params.human_id,
        "significance_score": params.significance_score,
        "action_summary": params.action_summary,
        "recommended_response": params.recommended_response,
        "response_deadline": params.response_deadline,
        "human_response": Value::Null,
        "proceeded_without_response": false,
        "timestamp": utc_now_iso(),
    });
    let canonical = canonicalize_v2(&payload).map_err(CryptoError::SignatureError)?;
    let composite = composite_sign(
        classical_provider,
        pq_provider,
        CTX_AWARENESS,
        canonical.as_bytes(),
        classical_key,
        pq_key,
    )?;
    let mut out = payload;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "composite_sig".into(),
            serde_json::to_value(&composite).map_err(|e| CryptoError::SignatureError(e.to_string()))?,
        );
    }
    Ok(out)
}
