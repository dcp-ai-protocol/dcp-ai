package v2

// SecurityTierResult describes the computed security tier and its parameters.
type SecurityTierResult struct {
	Tier               string `json:"tier"`
	VerificationMode   string `json:"verification_mode"`
	CheckpointInterval int    `json:"checkpoint_interval"`
}

// SecurityTierInput holds the fields used to compute adaptive security tier.
type SecurityTierInput struct {
	RiskScore   int      `json:"risk_score"`
	DataClasses []string `json:"data_classes"`
	ActionType  string   `json:"action_type"`
}

var highSensitivityClasses = map[string]bool{
	"credentials":  true,
	"children_data": true,
	"biometric":    true,
}

var mediumSensitivityClasses = map[string]bool{
	"pii":       true,
	"financial": true,
	"health":    true,
	"legal":     true,
}

// ComputeSecurityTier determines the adaptive security tier from an intent's
// risk profile. Tiers: routine, standard, elevated, maximum.
func ComputeSecurityTier(input SecurityTierInput) SecurityTierResult {
	hasHigh := false
	hasMedium := false
	for _, dc := range input.DataClasses {
		if highSensitivityClasses[dc] {
			hasHigh = true
		}
		if mediumSensitivityClasses[dc] {
			hasMedium = true
		}
	}

	isPayment := input.ActionType == "payment" || input.ActionType == "transfer"

	var tier string
	switch {
	case input.RiskScore >= 800 || hasHigh:
		tier = "maximum"
	case input.RiskScore >= 500 || hasMedium || isPayment:
		tier = "elevated"
	case input.RiskScore >= 200:
		tier = "standard"
	default:
		tier = "routine"
	}

	var mode string
	var interval int
	switch tier {
	case "maximum":
		mode = "hybrid_required"
		interval = 1
	case "elevated":
		mode = "hybrid_required"
		interval = 1
	case "standard":
		mode = "hybrid_preferred"
		interval = 10
	default:
		mode = "classical_only"
		interval = 50
	}

	return SecurityTierResult{
		Tier:               tier,
		VerificationMode:   mode,
		CheckpointInterval: interval,
	}
}
