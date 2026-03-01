package v2

import "testing"

func TestSecurityTier_Routine(t *testing.T) {
	r := ComputeSecurityTier(SecurityTierInput{
		RiskScore:   100,
		DataClasses: []string{"general"},
		ActionType:  "read",
	})
	if r.Tier != "routine" {
		t.Fatalf("expected routine, got %s", r.Tier)
	}
	if r.VerificationMode != "classical_only" {
		t.Fatalf("expected classical_only, got %s", r.VerificationMode)
	}
	if r.CheckpointInterval != 50 {
		t.Fatalf("expected interval 50, got %d", r.CheckpointInterval)
	}
}

func TestSecurityTier_Standard(t *testing.T) {
	r := ComputeSecurityTier(SecurityTierInput{
		RiskScore:   300,
		DataClasses: []string{"general"},
		ActionType:  "read",
	})
	if r.Tier != "standard" {
		t.Fatalf("expected standard, got %s", r.Tier)
	}
	if r.VerificationMode != "hybrid_preferred" {
		t.Fatalf("expected hybrid_preferred, got %s", r.VerificationMode)
	}
	if r.CheckpointInterval != 10 {
		t.Fatalf("expected interval 10, got %d", r.CheckpointInterval)
	}
}

func TestSecurityTier_Elevated_ByScore(t *testing.T) {
	r := ComputeSecurityTier(SecurityTierInput{
		RiskScore:   600,
		DataClasses: []string{},
		ActionType:  "read",
	})
	if r.Tier != "elevated" {
		t.Fatalf("expected elevated, got %s", r.Tier)
	}
	if r.VerificationMode != "hybrid_required" {
		t.Fatalf("expected hybrid_required, got %s", r.VerificationMode)
	}
}

func TestSecurityTier_Elevated_ByDataClass(t *testing.T) {
	r := ComputeSecurityTier(SecurityTierInput{
		RiskScore:   100,
		DataClasses: []string{"financial"},
		ActionType:  "read",
	})
	if r.Tier != "elevated" {
		t.Fatalf("expected elevated, got %s", r.Tier)
	}
}

func TestSecurityTier_Elevated_ByPayment(t *testing.T) {
	r := ComputeSecurityTier(SecurityTierInput{
		RiskScore:   100,
		DataClasses: []string{},
		ActionType:  "payment",
	})
	if r.Tier != "elevated" {
		t.Fatalf("expected elevated, got %s", r.Tier)
	}
}

func TestSecurityTier_Elevated_ByTransfer(t *testing.T) {
	r := ComputeSecurityTier(SecurityTierInput{
		RiskScore:   50,
		DataClasses: []string{},
		ActionType:  "transfer",
	})
	if r.Tier != "elevated" {
		t.Fatalf("expected elevated, got %s", r.Tier)
	}
}

func TestSecurityTier_Maximum_ByScore(t *testing.T) {
	r := ComputeSecurityTier(SecurityTierInput{
		RiskScore:   900,
		DataClasses: []string{},
		ActionType:  "read",
	})
	if r.Tier != "maximum" {
		t.Fatalf("expected maximum, got %s", r.Tier)
	}
	if r.VerificationMode != "hybrid_required" {
		t.Fatalf("expected hybrid_required, got %s", r.VerificationMode)
	}
	if r.CheckpointInterval != 1 {
		t.Fatalf("expected interval 1, got %d", r.CheckpointInterval)
	}
}

func TestSecurityTier_Maximum_ByDataClass(t *testing.T) {
	cases := []string{"credentials", "children_data", "biometric"}
	for _, dc := range cases {
		t.Run(dc, func(t *testing.T) {
			r := ComputeSecurityTier(SecurityTierInput{
				RiskScore:   10,
				DataClasses: []string{dc},
				ActionType:  "read",
			})
			if r.Tier != "maximum" {
				t.Fatalf("expected maximum for %s, got %s", dc, r.Tier)
			}
		})
	}
}

func TestSecurityTier_MediumDataClasses(t *testing.T) {
	cases := []string{"pii", "financial", "health", "legal"}
	for _, dc := range cases {
		t.Run(dc, func(t *testing.T) {
			r := ComputeSecurityTier(SecurityTierInput{
				RiskScore:   10,
				DataClasses: []string{dc},
				ActionType:  "read",
			})
			if r.Tier != "elevated" {
				t.Fatalf("expected elevated for %s, got %s", dc, r.Tier)
			}
		})
	}
}

func TestSecurityTier_ZeroRiskScore(t *testing.T) {
	r := ComputeSecurityTier(SecurityTierInput{
		RiskScore:   0,
		DataClasses: []string{},
		ActionType:  "",
	})
	if r.Tier != "routine" {
		t.Fatalf("expected routine, got %s", r.Tier)
	}
}
