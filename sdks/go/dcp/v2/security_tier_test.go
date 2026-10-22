package v2

import (
	"encoding/json"
	"testing"
)

// The shared table lives in tests/interop/v2/interop_vectors.json
// (TestInteropSecurityTier). These cases cover the typed Go API.

func TestSecurityTier_TypedInput(t *testing.T) {
	cases := []struct {
		name  string
		input SecurityTierInput
		want  SecurityTierResult
	}{
		{"routine", SecurityTierInput{DataClasses: []string{"none"}, ActionType: "browse", EstimatedImpact: "low"},
			SecurityTierResult{"routine", "classical_only", 50}},
		{"standard by risk score", SecurityTierInput{RiskScore: 200, DataClasses: []string{}, ActionType: "api_call", EstimatedImpact: "low"},
			SecurityTierResult{"standard", "hybrid_preferred", 10}},
		{"standard by medium impact", SecurityTierInput{DataClasses: []string{"contact_info"}, ActionType: "send_email", EstimatedImpact: "medium"},
			SecurityTierResult{"standard", "hybrid_preferred", 10}},
		{"elevated by financial_data", SecurityTierInput{DataClasses: []string{"financial_data"}, ActionType: "api_call", EstimatedImpact: "low"},
			SecurityTierResult{"elevated", "hybrid_required", 1}},
		{"elevated by initiate_payment", SecurityTierInput{DataClasses: []string{"none"}, ActionType: "initiate_payment", EstimatedImpact: "low"},
			SecurityTierResult{"elevated", "hybrid_required", 1}},
		{"maximum by children_data", SecurityTierInput{DataClasses: []string{"children_data"}, ActionType: "browse", EstimatedImpact: "low"},
			SecurityTierResult{"maximum", "hybrid_required", 1}},
		{"maximum by risk score", SecurityTierInput{RiskScore: 800, DataClasses: []string{"none"}, ActionType: "browse", EstimatedImpact: "low"},
			SecurityTierResult{"maximum", "hybrid_required", 1}},
		{"old payment vocabulary fails closed", SecurityTierInput{DataClasses: []string{"none"}, ActionType: "payment", EstimatedImpact: "low"},
			SecurityTierResult{"elevated", "hybrid_required", 1}},
		{"old biometric class fails closed", SecurityTierInput{DataClasses: []string{"biometric"}, ActionType: "browse", EstimatedImpact: "low"},
			SecurityTierResult{"elevated", "hybrid_required", 1}},
		{"nil data classes fail closed", SecurityTierInput{ActionType: "browse", EstimatedImpact: "low"},
			SecurityTierResult{"elevated", "hybrid_required", 1}},
		{"zero value fails closed", SecurityTierInput{},
			SecurityTierResult{"elevated", "hybrid_required", 1}},
		{"explicit tier raises", SecurityTierInput{DataClasses: []string{"none"}, ActionType: "browse", EstimatedImpact: "low", SecurityTier: "maximum"},
			SecurityTierResult{"maximum", "hybrid_required", 1}},
		{"explicit tier cannot lower", SecurityTierInput{DataClasses: []string{"pii"}, ActionType: "browse", EstimatedImpact: "low", SecurityTier: "routine"},
			SecurityTierResult{"elevated", "hybrid_required", 1}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ComputeSecurityTier(c.input); got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestSecurityTierInputFromPayloads_GoValues(t *testing.T) {
	// Maps built in Go (not decoded from JSON) carry int and []string values.
	intent := map[string]interface{}{"action_type": "browse", "data_classes": []string{"none"}, "estimated_impact": "low"}
	for _, score := range []interface{}{900, int64(900), 900.0, json.Number("900")} {
		got := ComputeSecurityTier(SecurityTierInputFromPayloads(intent, map[string]interface{}{"risk_score": score}))
		if got.Tier != "maximum" {
			t.Fatalf("risk_score %T: got %s, want maximum", score, got.Tier)
		}
	}
	if got := SecurityTierInputFromPayloads(intent, map[string]interface{}{"risk_score": 1e300}).RiskScore; got != 1000 {
		t.Fatalf("huge risk_score: got %d, want 1000", got)
	}
	if got := ComputeSecurityTier(SecurityTierInputFromPayloads(intent, nil)); got.Tier != "routine" {
		t.Fatalf("nil policy decision: got %s, want routine", got.Tier)
	}
}

func TestSecurityTierHelpers_UnknownNamesFailClosed(t *testing.T) {
	for _, name := range []string{"bogus", "", "Maximum"} {
		if got := TierToVerificationMode(name); got != "hybrid_required" {
			t.Errorf("TierToVerificationMode(%q) = %s, want hybrid_required", name, got)
		}
		if got := TierToCheckpointInterval(name); got != 1 {
			t.Errorf("TierToCheckpointInterval(%q) = %d, want 1", name, got)
		}
		if got := MaxTier(name, "routine"); got != "elevated" {
			t.Errorf("MaxTier(%q, routine) = %s, want elevated", name, got)
		}
		if got := MaxTier("routine", name); got != "elevated" {
			t.Errorf("MaxTier(routine, %q) = %s, want elevated", name, got)
		}
		if got := MaxTier(name, "maximum"); got != "maximum" {
			t.Errorf("MaxTier(%q, maximum) = %s, want maximum", name, got)
		}
	}
}
