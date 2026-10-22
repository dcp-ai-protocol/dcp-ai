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
 * bundle's policy decision payload only (0 without one). A missing, mistyped
 * or unknown action_type, estimated_impact or data_classes value, or a
 * risk_score that is not an integer from 0 to 1000, gives at least "elevated",
 * and an explicit intent.security_tier can only raise the result, as can
 * mandateChainTier, the effective tier of a verified delegation chain
 * (DCP-09 §3.5): a floor that never lowers the tier.
 */
export function computeSecurityTier(intent, policyDecision, mandateChainTier) {
  const raw = intent && typeof intent === "object" ? intent : {};
  const riskScore = policyDecision == null ? 0 : policyDecision.risk_score;
  const scoreKnown = Number.isInteger(riskScore) && riskScore >= 0 && riskScore <= 1000;
  const score = scoreKnown ? riskScore : 0;
  const dataClasses = Array.isArray(raw.data_classes) ? raw.data_classes : [undefined];
  const unknownValue =
    !scoreKnown ||
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

  for (const floor of [raw.security_tier, mandateChainTier]) {
    if (floor === undefined || floor === null) continue;
    const known = TIERS.includes(floor) ? floor : "elevated";
    if (TIERS.indexOf(known) > TIERS.indexOf(tier)) tier = known;
  }
  return tier;
}
