package v2

import (
	"encoding/json"
	"math"
	"slices"
)

// SecurityTierResult describes the computed security tier and its parameters.
type SecurityTierResult struct {
	Tier               string `json:"tier"`
	VerificationMode   string `json:"verification_mode"`
	CheckpointInterval int    `json:"checkpoint_interval"`
}

// SecurityTierInput holds the signed fields the adaptive security tier reads
// (spec §14.2). RiskScore comes from the bundle's PolicyDecision, never from
// the intent, and a value outside 0..1000 counts as unknown; the other fields
// are intent fields. SecurityTier is the intent's explicit security_tier and
// can only raise the result, as can MandateChainTier, the effective tier of a
// verified delegation chain (VerifyMandateChain, DCP-09 §3.5): a floor that
// never lowers the tier.
type SecurityTierInput struct {
	RiskScore        int      `json:"risk_score"`
	DataClasses      []string `json:"data_classes"`
	ActionType       string   `json:"action_type"`
	EstimatedImpact  string   `json:"estimated_impact"`
	SecurityTier     string   `json:"security_tier,omitempty"`
	MandateChainTier string   `json:"mandate_chain_tier,omitempty"`
}

// Values allowed by schemas/v2/intent.schema.json.
var (
	schemaActionTypes = map[string]bool{
		"browse": true, "api_call": true, "send_email": true, "create_calendar_event": true,
		"initiate_payment": true, "update_crm": true, "write_file": true, "execute_code": true,
	}
	schemaDataClasses = map[string]bool{
		"none": true, "contact_info": true, "pii": true, "credentials": true,
		"financial_data": true, "health_data": true, "children_data": true, "company_confidential": true,
	}
	schemaImpacts       = map[string]bool{"low": true, "medium": true, "high": true}
	maximumDataClasses  = map[string]bool{"credentials": true, "children_data": true}
	elevatedDataClasses = map[string]bool{"pii": true, "financial_data": true, "health_data": true}
)

// ComputeSecurityTier determines the adaptive security tier (routine,
// standard, elevated, maximum) and its verification mode and PQ checkpoint
// interval. A value outside the intent schema, including a missing action
// type, impact or data class list, fails closed to at least elevated. An
// explicit SecurityTier or MandateChainTier can only raise the result; an
// unknown name there counts as elevated.
func ComputeSecurityTier(input SecurityTierInput) SecurityTierResult {
	maximum, elevated := false, false
	score := input.RiskScore
	scoreUnknown := score < 0 || score > 1000
	if scoreUnknown {
		score = 0
	}
	unknown := scoreUnknown || input.DataClasses == nil ||
		!schemaActionTypes[input.ActionType] || !schemaImpacts[input.EstimatedImpact]
	for _, dc := range input.DataClasses {
		maximum = maximum || maximumDataClasses[dc]
		elevated = elevated || elevatedDataClasses[dc]
		unknown = unknown || !schemaDataClasses[dc]
	}

	var tier string
	switch {
	case score >= 800 || maximum:
		tier = "maximum"
	case score >= 500 || elevated || unknown ||
		input.ActionType == "initiate_payment" || input.EstimatedImpact == "high":
		tier = "elevated"
	case score >= 200 || input.EstimatedImpact == "medium":
		tier = "standard"
	default:
		tier = "routine"
	}

	if input.SecurityTier != "" {
		tier = MaxTier(tier, input.SecurityTier)
	}
	if input.MandateChainTier != "" {
		tier = MaxTier(tier, input.MandateChainTier)
	}

	return SecurityTierResult{
		Tier:               tier,
		VerificationMode:   TierToVerificationMode(tier),
		CheckpointInterval: TierToCheckpointInterval(tier),
	}
}

// SecurityTierInputFromPayloads builds the tier input from a decoded intent
// payload and the bundle's PolicyDecision payload (nil when there is none).
// Values of the wrong type become unknown values, so they fail closed; in a
// policy decision, a risk_score that is not an integer from 0 to 1000, or none,
// becomes RiskScore -1 (unknown). Without a policy decision RiskScore is 0.
func SecurityTierInputFromPayloads(intent, policyDecision map[string]interface{}) SecurityTierInput {
	var in SecurityTierInput
	in.ActionType, _ = intent["action_type"].(string)
	in.EstimatedImpact, _ = intent["estimated_impact"].(string)

	switch dcs := intent["data_classes"].(type) {
	case []string:
		in.DataClasses = dcs
	case []interface{}:
		in.DataClasses = make([]string, len(dcs))
		for i, dc := range dcs {
			in.DataClasses[i], _ = dc.(string) // a non-string becomes "", which is unknown
		}
	}

	if st, ok := intent["security_tier"]; ok && st != nil {
		in.SecurityTier, _ = st.(string)
		if in.SecurityTier == "" {
			in.SecurityTier = "invalid" // present but empty or not a string
		}
	}

	if policyDecision != nil {
		score, ok := 0.0, true
		switch v := policyDecision["risk_score"].(type) {
		case float64:
			score = v
		case int:
			score = float64(v)
		case int64:
			score = float64(v)
		case json.Number:
			var err error
			score, err = v.Float64()
			ok = err == nil
		default:
			ok = false
		}
		in.RiskScore = -1
		if ok && score == math.Trunc(score) && score >= 0 && score <= 1000 {
			in.RiskScore = int(score)
		}
	}
	return in
}

// ── v2.4 helpers — parity with the other SDKs ──

var tierRank = map[string]int{
	"routine":  0,
	"standard": 1,
	"elevated": 2,
	"maximum":  3,
}

// knownTier returns tier, or "elevated" for a name that is not a tier, so an
// unknown name fails closed.
func knownTier(tier string) string {
	if _, ok := tierRank[tier]; ok {
		return tier
	}
	return "elevated"
}

// MaxTier returns the stricter (higher-rank) of the two tiers. An unknown tier
// name counts as elevated.
func MaxTier(a, b string) string {
	a, b = knownTier(a), knownTier(b)
	if tierRank[a] >= tierRank[b] {
		return a
	}
	return b
}

// TierToVerificationMode maps a tier to its verification-mode string; an
// unknown tier name maps to hybrid_required.
func TierToVerificationMode(tier string) string {
	switch knownTier(tier) {
	case "maximum", "elevated":
		return "hybrid_required"
	case "standard":
		return "hybrid_preferred"
	default:
		return "classical_only"
	}
}

// TierToCheckpointInterval maps a tier to its PQ-checkpoint interval; an unknown
// tier name maps to 1 (every event).
func TierToCheckpointInterval(tier string) int {
	switch knownTier(tier) {
	case "maximum", "elevated":
		return 1
	case "standard":
		return 10
	default:
		return 50
	}
}

var modeStrictness = []string{"classical_only", "hybrid_preferred", "hybrid_required"}

// EffectiveVerificationMode returns the mode a verifier enforces (spec §14.3):
// the stricter of its policy mode and the tier's mode. The tier only adds a PQ
// requirement, so a pq_only policy stays pq_only; an unknown policy mode counts
// as hybrid_required.
func EffectiveVerificationMode(policyMode, tier string) string {
	if policyMode == "pq_only" {
		return "pq_only"
	}
	rank := slices.Index(modeStrictness, policyMode)
	if rank < 0 {
		return "hybrid_required"
	}
	return modeStrictness[max(rank, slices.Index(modeStrictness, TierToVerificationMode(tier)))]
}
