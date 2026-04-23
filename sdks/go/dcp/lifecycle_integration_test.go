package dcp_test

import (
	"strings"
	"testing"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func buildRegistry(t *testing.T) *v2.AlgorithmRegistry {
	t.Helper()
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	return reg
}

func makeKeys(t *testing.T, reg *v2.AlgorithmRegistry) (v2.CompositeKeyInfo, v2.CompositeKeyInfo) {
	t.Helper()
	ed, _ := reg.GetSigner("ed25519")
	pq, _ := reg.GetSigner("ml-dsa-65")
	edKp, err := ed.GenerateKeypair()
	if err != nil {
		t.Fatalf("ed keygen: %v", err)
	}
	pqKp, err := pq.GenerateKeypair()
	if err != nil {
		t.Fatalf("pq keygen: %v", err)
	}
	return v2.CompositeKeyInfo{
			Kid:          edKp.Kid,
			Alg:          "ed25519",
			SecretKeyB64: edKp.SecretKeyB64,
			PublicKeyB64: edKp.PublicKeyB64,
		}, v2.CompositeKeyInfo{
			Kid:          pqKp.Kid,
			Alg:          "ml-dsa-65",
			SecretKeyB64: pqKp.SecretKeyB64,
			PublicKeyB64: pqKp.PublicKeyB64,
		}
}

func TestValidateStateTransition(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{"commissioned", "active", true},
		{"commissioned", "decommissioned", true},
		{"active", "declining", true},
		{"declining", "active", true},
		{"decommissioned", "active", false},
		{"commissioned", "declining", false},
		{"bogus", "active", false},
	}
	for _, c := range cases {
		if got := v2.ValidateStateTransition(c.from, c.to); got != c.want {
			t.Errorf("ValidateStateTransition(%q, %q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestComputeVitalityScore(t *testing.T) {
	perfect := v2.ComputeVitalityScore(v2.VitalityMetricsFloat{
		TaskCompletionRate: 1.0, ErrorRate: 0.0, HumanSatisfaction: 1.0, PolicyAlignment: 1.0,
	})
	if perfect != 1000 {
		t.Errorf("perfect score = %d, want 1000", perfect)
	}
	worst := v2.ComputeVitalityScore(v2.VitalityMetricsFloat{
		TaskCompletionRate: 0.0, ErrorRate: 1.0, HumanSatisfaction: 0.0, PolicyAlignment: 0.0,
	})
	if worst != 0 {
		t.Errorf("worst score = %d, want 0", worst)
	}
}

func TestCreateCommissioningCertificate(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	cert, err := v2.CreateCommissioningCertificate(reg, ck, pqk, v2.CommissioningParams{
		AgentID:                   "agent_123",
		SessionNonce:              strings.Repeat("a", 64),
		HumanID:                   "human_456",
		CommissioningAuthority:    "org.example",
		Purpose:                   "Research assistant",
		InitialCapabilities:       []string{"read_email", "draft_response"},
		RiskTier:                  "medium",
		PrincipalBindingReference: "rpr_hash_abc",
	})
	if err != nil {
		t.Fatalf("CreateCommissioningCertificate: %v", err)
	}
	if cert["dcp_version"] != "2.0" {
		t.Fatalf("expected dcp_version 2.0, got %v", cert["dcp_version"])
	}
	sig, ok := cert["composite_sig"].(*v2.CompositeSignature)
	if !ok || sig.Binding != "pq_over_classical" {
		t.Fatalf("expected pq_over_classical composite_sig, got %#v", cert["composite_sig"])
	}
}

func TestCreateVitalityReportAndHash(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	report, err := v2.CreateVitalityReport(reg, ck, pqk, v2.VitalityReportParams{
		AgentID:        "agent_123",
		SessionNonce:   strings.Repeat("a", 64),
		State:          "active",
		Metrics:        v2.VitalityMetricsInt{TaskCompletionRate: 1, ErrorRate: 0, HumanSatisfaction: 1, PolicyAlignment: 1},
		PrevReportHash: "GENESIS",
	})
	if err != nil {
		t.Fatalf("CreateVitalityReport: %v", err)
	}
	if report["state"] != "active" {
		t.Fatalf("state = %v, want active", report["state"])
	}
	if report["vitality_score"].(int) != 1000 {
		t.Fatalf("vitality_score = %v, want 1000", report["vitality_score"])
	}
	h, err := v2.HashVitalityReport(report)
	if err != nil {
		t.Fatalf("HashVitalityReport: %v", err)
	}
	if !strings.HasPrefix(h, "sha256:") || len(h) != len("sha256:")+64 {
		t.Fatalf("unexpected hash format: %s", h)
	}
}

func TestCreateDecommissioningRecord(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)

	succ := "agent_789"
	record, err := v2.CreateDecommissioningRecord(reg, ck, pqk, v2.DecommissioningParams{
		AgentID:            "agent_123",
		SessionNonce:       strings.Repeat("a", 64),
		HumanID:            "human_456",
		TerminationMode:    "planned_retirement",
		Reason:             "project_closure",
		FinalVitalityScore: 842,
		SuccessorAgentID:   &succ,
		DataDisposition:    "transferred",
	})
	if err != nil {
		t.Fatalf("CreateDecommissioningRecord: %v", err)
	}
	if record["successor_agent_id"] != "agent_789" {
		t.Fatalf("successor = %v, want agent_789", record["successor_agent_id"])
	}

	record2, err := v2.CreateDecommissioningRecord(reg, ck, pqk, v2.DecommissioningParams{
		AgentID:            "agent_123",
		SessionNonce:       strings.Repeat("a", 64),
		HumanID:            "human_456",
		TerminationMode:    "termination_for_cause",
		Reason:             "policy_violation",
		FinalVitalityScore: 120,
		SuccessorAgentID:   nil,
		DataDisposition:    "destroyed",
	})
	if err != nil {
		t.Fatalf("CreateDecommissioningRecord(nil successor): %v", err)
	}
	if record2["successor_agent_id"] != nil {
		t.Fatalf("expected nil successor_agent_id, got %v", record2["successor_agent_id"])
	}
}
