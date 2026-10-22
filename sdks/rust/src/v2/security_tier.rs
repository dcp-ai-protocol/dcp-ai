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

// Values allowed by schemas/v2/intent.schema.json.
const ACTION_TYPES: &[&str] = &[
    "browse",
    "api_call",
    "send_email",
    "create_calendar_event",
    "initiate_payment",
    "update_crm",
    "write_file",
    "execute_code",
];
const DATA_CLASSES: &[&str] = &[
    "none",
    "contact_info",
    "pii",
    "credentials",
    "financial_data",
    "health_data",
    "children_data",
    "company_confidential",
];
const IMPACTS: &[&str] = &["low", "medium", "high"];
const MAXIMUM_DATA_CLASSES: &[&str] = &["credentials", "children_data"];
const ELEVATED_DATA_CLASSES: &[&str] = &["pii", "financial_data", "health_data"];
const TIERS: [SecurityTier; 4] = [
    SecurityTier::Routine,
    SecurityTier::Standard,
    SecurityTier::Elevated,
    SecurityTier::Maximum,
];

fn is_one_of(value: Option<&Value>, allowed: &[&str]) -> bool {
    value.and_then(Value::as_str).is_some_and(|s| allowed.contains(&s))
}

/// Compute the security tier (spec §14.2) from an intent and the bundle's
/// policy decision. `risk_score` is read from the policy decision only; with
/// no policy decision it counts as 0, as does a non-numeric value. A value
/// outside the intent schema enums, including a missing `action_type`,
/// `estimated_impact` or `data_classes`, fails closed to at least `Elevated`.
/// An explicit `security_tier` on the intent can only raise the result.
pub fn compute_security_tier(intent: &Value, policy_decision: Option<&Value>) -> SecurityTier {
    let score = policy_decision
        .and_then(|p| p.get("risk_score"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    // A missing or non-array data_classes counts as one unknown value.
    let unknown_list = [Value::Null];
    let data_classes = intent
        .get("data_classes")
        .and_then(Value::as_array)
        .map_or(&unknown_list[..], Vec::as_slice);
    let action_type = intent.get("action_type");
    let impact = intent.get("estimated_impact");
    let unknown = !is_one_of(action_type, ACTION_TYPES)
        || !is_one_of(impact, IMPACTS)
        || data_classes.iter().any(|d| !is_one_of(Some(d), DATA_CLASSES));

    let tier = if score >= 800.0
        || data_classes.iter().any(|d| is_one_of(Some(d), MAXIMUM_DATA_CLASSES))
    {
        SecurityTier::Maximum
    } else if score >= 500.0
        || unknown
        || data_classes.iter().any(|d| is_one_of(Some(d), ELEVATED_DATA_CLASSES))
        || is_one_of(action_type, &["initiate_payment"])
        || is_one_of(impact, &["high"])
    {
        SecurityTier::Elevated
    } else if score >= 200.0 || is_one_of(impact, &["medium"]) {
        SecurityTier::Standard
    } else {
        SecurityTier::Routine
    };

    match intent.get("security_tier") {
        None | Some(Value::Null) => tier,
        Some(explicit) => {
            let explicit = TIERS.into_iter().find(|t| explicit.as_str() == Some(t.as_str()));
            max_tier(tier, explicit.unwrap_or(SecurityTier::Elevated))
        }
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
