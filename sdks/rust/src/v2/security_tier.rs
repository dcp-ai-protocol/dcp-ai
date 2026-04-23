//! DCP v2.0 Adaptive Security Tier Engine — Rust port.

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SecurityTier {
    Routine,
    Standard,
    Elevated,
    Maximum,
}

impl SecurityTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            SecurityTier::Routine => "routine",
            SecurityTier::Standard => "standard",
            SecurityTier::Elevated => "elevated",
            SecurityTier::Maximum => "maximum",
        }
    }

    fn rank(&self) -> u8 {
        match self {
            SecurityTier::Routine => 0,
            SecurityTier::Standard => 1,
            SecurityTier::Elevated => 2,
            SecurityTier::Maximum => 3,
        }
    }
}

const SENSITIVE_DATA_CLASSES: &[&str] = &[
    "pii",
    "financial_data",
    "health_data",
    "credentials",
    "children_data",
];
const HIGH_VALUE_DATA_CLASSES: &[&str] = &["credentials", "children_data"];

/// Compute the security tier for an intent.
pub fn compute_security_tier(intent: &Value) -> SecurityTier {
    let score = intent.get("risk_score").and_then(Value::as_i64).unwrap_or(0);
    let data_classes: Vec<&str> = intent
        .get("data_classes")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let has_high_value = data_classes.iter().any(|d| HIGH_VALUE_DATA_CLASSES.contains(d));
    let has_sensitive = data_classes.iter().any(|d| SENSITIVE_DATA_CLASSES.contains(d));
    let is_payment = intent.get("action_type").and_then(Value::as_str) == Some("initiate_payment");

    if score >= 800 || has_high_value {
        SecurityTier::Maximum
    } else if score >= 500 || has_sensitive || is_payment {
        SecurityTier::Elevated
    } else if score >= 200 {
        SecurityTier::Standard
    } else {
        SecurityTier::Routine
    }
}

/// Return the stricter of two tiers.
pub fn max_tier(a: SecurityTier, b: SecurityTier) -> SecurityTier {
    if a.rank() >= b.rank() { a } else { b }
}

/// Map a tier to its verification mode string.
pub fn tier_to_verification_mode(tier: SecurityTier) -> &'static str {
    match tier {
        SecurityTier::Routine => "classical_only",
        SecurityTier::Standard => "hybrid_preferred",
        SecurityTier::Elevated | SecurityTier::Maximum => "hybrid_required",
    }
}

/// Map a tier to its PQ-checkpoint interval.
pub fn tier_to_checkpoint_interval(tier: SecurityTier) -> u32 {
    match tier {
        SecurityTier::Routine => 50,
        SecurityTier::Standard => 10,
        SecurityTier::Elevated | SecurityTier::Maximum => 1,
    }
}
