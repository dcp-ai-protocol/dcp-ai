// Adaptive security tier (spec/DCP-AI-v2.0.md § 14.2), the rule of
// computeSecurityTier in sdks/typescript/src/core/security-tier.ts.
// ponytail: a copy because the root depends on the published @dcp-ai/sdk;
// import computeSecurityTier from it once a release takes the policy decision.

// Values allowed by schemas/v2/intent.schema.json.
const ACTION_TYPES = new Set([
  "browse", "api_call", "send_email", "create_calendar_event",
  "initiate_payment", "update_crm", "write_file", "execute_code",
]);
const DATA_CLASSES = new Set([
  "none", "contact_info", "pii", "credentials",
  "financial_data", "health_data", "children_data", "company_confidential",
]);
const IMPACTS = new Set(["low", "medium", "high"]);
const MAXIMUM_DATA_CLASSES = new Set(["credentials", "children_data"]);
const ELEVATED_DATA_CLASSES = new Set(["pii", "financial_data", "health_data"]);
const TIERS = ["routine", "standard", "elevated", "maximum"];

/**
 * The security tier of an intent payload, with risk_score read from the
 * bundle's policy decision payload only (0 without one, or if it is not a
 * number). A missing, mistyped or unknown action_type, estimated_impact or
 * data_classes value gives at least "elevated", and an explicit
 * intent.security_tier can only raise the result.
 */
export function computeSecurityTier(intent, policyDecision) {
  const raw = intent && typeof intent === "object" ? intent : {};
  const riskScore = policyDecision?.risk_score;
  const score = typeof riskScore === "number" ? riskScore : 0;
  const dataClasses = Array.isArray(raw.data_classes) ? raw.data_classes : [undefined];
  const unknownValue =
    !ACTION_TYPES.has(raw.action_type) ||
    !IMPACTS.has(raw.estimated_impact) ||
    dataClasses.some((d) => !DATA_CLASSES.has(d));

  let tier;
  if (score >= 800 || dataClasses.some((d) => MAXIMUM_DATA_CLASSES.has(d))) {
    tier = "maximum";
  } else if (
    score >= 500 ||
    unknownValue ||
    dataClasses.some((d) => ELEVATED_DATA_CLASSES.has(d)) ||
    raw.action_type === "initiate_payment" ||
    raw.estimated_impact === "high"
  ) {
    tier = "elevated";
  } else if (score >= 200 || raw.estimated_impact === "medium") {
    tier = "standard";
  } else {
    tier = "routine";
  }

  const explicit = raw.security_tier;
  if (explicit === undefined || explicit === null) return tier;
  const floor = TIERS.includes(explicit) ? explicit : "elevated";
  return TIERS.indexOf(floor) > TIERS.indexOf(tier) ? floor : tier;
}
