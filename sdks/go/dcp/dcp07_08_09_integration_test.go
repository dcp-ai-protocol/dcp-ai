package dcp_test

import (
	"strings"
	"testing"
	"time"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// ── DCP-07 ──

func TestDisputeLifecycle(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	dispute, err := v2.CreateDispute(reg, ck, pqk, v2.DisputeParams{
		DisputeID:         "disp_001",
		SessionNonce:      strings.Repeat("a", 64),
		InitiatorAgentID:  "agent_A",
		RespondentAgentID: "agent_B",
		DisputeType:       "authority_conflict",
		EvidenceHashes:    []string{"sha256:" + strings.Repeat("0", 64)},
	})
	if err != nil {
		t.Fatalf("CreateDispute: %v", err)
	}
	if dispute["escalation_level"] != "direct_negotiation" {
		t.Fatalf("escalation_level = %v", dispute["escalation_level"])
	}
	if dispute["status"] != "open" {
		t.Fatalf("status = %v", dispute["status"])
	}

	esc, err := v2.EscalateDispute(reg, ck, pqk, dispute, strings.Repeat("b", 64))
	if err != nil {
		t.Fatalf("EscalateDispute: %v", err)
	}
	if esc["escalation_level"] != "contextual_arbitration" {
		t.Fatalf("unexpected level: %v", esc["escalation_level"])
	}
	finalD, err := v2.EscalateDispute(reg, ck, pqk, esc, strings.Repeat("c", 64))
	if err != nil {
		t.Fatalf("second escalate: %v", err)
	}
	if finalD["escalation_level"] != "human_appeal" {
		t.Fatalf("unexpected level: %v", finalD["escalation_level"])
	}
	if _, err := v2.EscalateDispute(reg, ck, pqk, finalD, strings.Repeat("d", 64)); err == nil {
		t.Fatalf("expected error escalating past human_appeal")
	}
	resolved, err := v2.ResolveDispute(reg, ck, pqk, finalD, strings.Repeat("e", 64))
	if err != nil {
		t.Fatalf("ResolveDispute: %v", err)
	}
	if resolved["status"] != "resolved" {
		t.Fatalf("resolved status = %v", resolved["status"])
	}
}

func TestCreateObjection(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	alt := "Narrow scope"
	obj, err := v2.CreateObjection(reg, ck, pqk, v2.ObjectionParams{
		ObjectionID:             "obj_001",
		SessionNonce:            strings.Repeat("a", 64),
		AgentID:                 "agent_A",
		DirectiveHash:           "sha256:" + strings.Repeat("0", 64),
		ObjectionType:           "ethical_concern",
		Reasoning:               "Would cause harm",
		ProposedAlternative:     &alt,
		HumanEscalationRequired: true,
	})
	if err != nil {
		t.Fatalf("CreateObjection: %v", err)
	}
	if obj["objection_type"] != "ethical_concern" {
		t.Fatalf("objection_type mismatch")
	}
	if obj["human_escalation_required"] != true {
		t.Fatalf("human_escalation_required mismatch")
	}
}

func TestArbitrationPanel(t *testing.T) {
	p, err := v2.CreateArbitrationPanel([]string{"a1", "a2", "a3"}, 2)
	if err != nil {
		t.Fatalf("CreateArbitrationPanel: %v", err)
	}
	if p.Threshold != 2 || len(p.ArbitratorIDs) != 3 {
		t.Fatalf("panel: %+v", p)
	}
	if _, err := v2.CreateArbitrationPanel([]string{"a1"}, 3); err == nil {
		t.Fatalf("expected error for insufficient arbitrators")
	}
	if _, err := v2.CreateArbitrationPanel([]string{"a1"}, 0); err == nil {
		t.Fatalf("expected error for invalid threshold")
	}
}

func TestLookupPrecedent(t *testing.T) {
	js := []map[string]interface{}{
		{"category": "privacy", "applicable_contexts": []string{"healthcare", "finance"}},
		{"category": "privacy", "applicable_contexts": []string{"retail"}},
		{"category": "safety", "applicable_contexts": []string{"healthcare"}},
	}
	if got := v2.LookupPrecedent(js, "privacy", nil); len(got) != 2 {
		t.Fatalf("privacy matches: %d", len(got))
	}
	ctx := "healthcare"
	if got := v2.LookupPrecedent(js, "privacy", &ctx); len(got) != 1 {
		t.Fatalf("privacy+healthcare matches: %d", len(got))
	}
	if got := v2.LookupPrecedent(js, "nonexistent", nil); len(got) != 0 {
		t.Fatalf("nonexistent matches: %d", len(got))
	}
}

func TestArbitrationSigning(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	res, err := v2.SubmitResolution(reg, ck, pqk, v2.SubmitResolutionParams{
		DisputeID:           "disp_001",
		SessionNonce:        strings.Repeat("a", 64),
		ArbitratorIDs:       []string{"a1", "a2"},
		Resolution:          "cease",
		Binding:             true,
		PrecedentReferences: []string{"juris_001"},
	})
	if err != nil {
		t.Fatalf("SubmitResolution: %v", err)
	}
	sig, ok := res["composite_sig"].(*v2.CompositeSignature)
	if !ok || sig.Binding != "pq_over_classical" {
		t.Fatalf("bad composite_sig: %#v", res["composite_sig"])
	}

	jb, err := v2.BuildJurisprudenceBundle(reg, ck, pqk, v2.JurisprudenceParams{
		JurisprudenceID:     "juris_001",
		SessionNonce:        strings.Repeat("a", 64),
		DisputeID:           "disp_001",
		ResolutionID:        "res_001",
		Category:            "privacy",
		PrecedentSummary:    "Agent may not disclose PII",
		ApplicableContexts:  []string{"healthcare", "finance"},
		AuthorityLevel:      "advisory",
	})
	if err != nil {
		t.Fatalf("BuildJurisprudenceBundle: %v", err)
	}
	if jb["category"] != "privacy" {
		t.Fatalf("category mismatch")
	}
}

// ── DCP-08 ──

func TestRightsAndCompliance(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)

	_, err := v2.DeclareRights(reg, ck, pqk, v2.DeclareRightsParams{
		DeclarationID: "decl_001",
		SessionNonce:  strings.Repeat("a", 64),
		AgentID:       "agent_A",
		Rights:        []map[string]interface{}{{"right_type": "data_access", "scope": "public"}},
		Jurisdiction:  "US-CA",
	})
	if err != nil {
		t.Fatalf("DeclareRights: %v", err)
	}
	_, err = v2.RecordObligation(reg, ck, pqk, v2.ObligationParams{
		ObligationID:     "obl_001",
		SessionNonce:     strings.Repeat("a", 64),
		AgentID:          "agent_A",
		HumanID:          "h1",
		ObligationType:   "retention",
		ComplianceStatus: "compliant",
		EvidenceHashes:   []string{"sha256:" + strings.Repeat("0", 64)},
	})
	if err != nil {
		t.Fatalf("RecordObligation: %v", err)
	}
	_, err = v2.ReportViolation(reg, ck, pqk, v2.ViolationParams{
		ViolationID:    "viol_001",
		SessionNonce:   strings.Repeat("a", 64),
		AgentID:        "agent_A",
		ViolatedRight:  "privacy",
		EvidenceHashes: []string{"sha256:" + strings.Repeat("0", 64)},
		DisputeID:      nil,
	})
	if err != nil {
		t.Fatalf("ReportViolation: %v", err)
	}

	r := v2.CheckRightsCompliance(
		nil,
		[]map[string]interface{}{
			{"obligation_id": "o1", "obligation_type": "retention", "compliance_status": "compliant"},
			{"obligation_id": "o2", "obligation_type": "deletion", "compliance_status": "non_compliant"},
		},
	)
	if r.Compliant {
		t.Fatalf("expected non-compliant")
	}
	if len(r.Violations) != 1 {
		t.Fatalf("violations: %v", r.Violations)
	}
}

// ── DCP-09 ──

func TestDelegationMandateLifecycle(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	now := time.Now().UTC()
	mand, err := v2.CreateDelegationMandate(reg, ck, pqk, v2.DelegationMandateParams{
		MandateID:      "mand_001",
		SessionNonce:   strings.Repeat("a", 64),
		HumanID:        "human_1",
		AgentID:        "agent_A",
		AuthorityScope: []map[string]interface{}{{"domain": "email", "actions": []string{"read"}, "constraints": map[string]interface{}{}}},
		ValidFrom:      now.Add(-1 * time.Hour).Format(time.RFC3339),
		ValidUntil:     now.Add(1 * time.Hour).Format(time.RFC3339),
		Revocable:      true,
	})
	if err != nil {
		t.Fatalf("CreateDelegationMandate: %v", err)
	}
	if _, ok := mand["human_composite_sig"].(*v2.CompositeSignature); !ok {
		t.Fatalf("expected human_composite_sig to be a *CompositeSignature")
	}
	if _, ok := mand["composite_sig"]; ok {
		t.Fatalf("composite_sig should be absent for mandate")
	}

	revoked := map[string]bool{}
	ver := v2.VerifyMandateValidity(mand, revoked)
	if !ver.Valid {
		t.Fatalf("expected valid, reason=%q", ver.Reason)
	}
	rev := v2.RevokeDelegation(mand, revoked)
	if !rev.Revoked {
		t.Fatalf("expected revoked")
	}
	if !revoked["mand_001"] {
		t.Fatalf("revocation set mutation failed")
	}
	after := v2.VerifyMandateValidity(mand, revoked)
	if after.Valid {
		t.Fatalf("expected invalid after revoke")
	}
}

func TestNonRevocableMandate(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	now := time.Now().UTC()
	mand, _ := v2.CreateDelegationMandate(reg, ck, pqk, v2.DelegationMandateParams{
		MandateID:      "mand_fixed",
		SessionNonce:   strings.Repeat("a", 64),
		HumanID:        "human_1",
		AgentID:        "agent_A",
		AuthorityScope: []map[string]interface{}{},
		ValidFrom:      now.Add(-1 * time.Hour).Format(time.RFC3339),
		ValidUntil:     now.Add(1 * time.Hour).Format(time.RFC3339),
		Revocable:      false,
	})
	revoked := map[string]bool{}
	rev := v2.RevokeDelegation(mand, revoked)
	if rev.Revoked {
		t.Fatalf("non-revocable should stay unrevoked")
	}
	if len(revoked) != 0 {
		t.Fatalf("revoked set unexpectedly mutated")
	}
}

func TestSignificanceScoring(t *testing.T) {
	low := v2.EvaluateSignificance(v2.SignificanceContext{})
	if low != 0 {
		t.Fatalf("low = %d", low)
	}
	high := v2.EvaluateSignificance(v2.SignificanceContext{
		FinancialImpact: 1.0, DataSensitivity: 1.0, RelationshipImpact: 1.0, Irreversibility: 1.0, PrecedentSetting: 1.0,
	})
	if high != 1000 {
		t.Fatalf("high = %d", high)
	}
}

func TestShouldNotifyHuman(t *testing.T) {
	rule := map[string]interface{}{"dimension": "significance", "operator": "gt", "value": float64(500), "action_if_triggered": "notify"}
	trig := v2.ShouldNotifyHuman(600, []map[string]interface{}{rule})
	if !trig.Notify || len(trig.Actions) != 1 || trig.Actions[0] != "notify" {
		t.Fatalf("trigger = %+v", trig)
	}
	miss := v2.ShouldNotifyHuman(100, []map[string]interface{}{rule})
	if miss.Notify {
		t.Fatalf("should not notify")
	}
}

func TestAwarenessThresholdArtifacts(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	th, err := v2.CreateAwarenessThreshold(reg, ck, pqk, v2.AwarenessThresholdParams{
		ThresholdID:    "th_001",
		SessionNonce:   strings.Repeat("a", 64),
		AgentID:        "agent_A",
		HumanID:        "h1",
		ThresholdRules: []map[string]interface{}{{"dimension": "significance", "operator": "gt", "value": 500, "action_if_triggered": "notify"}},
	})
	if err != nil {
		t.Fatalf("CreateAwarenessThreshold: %v", err)
	}
	sig, ok := th["composite_sig"].(*v2.CompositeSignature)
	if !ok || sig.Binding != "pq_over_classical" {
		t.Fatalf("sig = %#v", th["composite_sig"])
	}

	adv, err := v2.CreateAdvisoryDeclaration(reg, ck, pqk, v2.AdvisoryDeclarationParams{
		DeclarationID:       "adv_001",
		SessionNonce:        strings.Repeat("a", 64),
		AgentID:             "agent_A",
		HumanID:             "h1",
		SignificanceScore:   650,
		ActionSummary:       "Proposed payment over threshold",
		RecommendedResponse: "Require human confirmation",
		ResponseDeadline:    "2026-04-30T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateAdvisoryDeclaration: %v", err)
	}
	if adv["significance_score"] != 650 {
		t.Fatalf("score = %v", adv["significance_score"])
	}
	if adv["human_response"] != nil {
		t.Fatalf("human_response should start nil, got %v", adv["human_response"])
	}
	if adv["proceeded_without_response"] != false {
		t.Fatalf("proceeded_without_response should start false")
	}
}

func TestPrincipalMirror(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	entries := []map[string]interface{}{
		{"event": "start"}, {"event": "step"}, {"event": "end"},
	}
	mirror, err := v2.GenerateMirror(reg, ck, pqk, v2.MirrorParams{
		MirrorID:        "mir_001",
		SessionNonce:    strings.Repeat("a", 64),
		AgentID:         "agent_A",
		HumanID:         "human_1",
		Period:          map[string]string{"from": "2026-04-01", "to": "2026-04-22"},
		AuditEntries:    entries,
		Narrative:       "Agent completed 3 tasks.",
		DecisionSummary: "All within policy.",
	})
	if err != nil {
		t.Fatalf("GenerateMirror: %v", err)
	}
	if mirror["action_count"] != 3 {
		t.Fatalf("action_count = %v", mirror["action_count"])
	}
	h, _ := mirror["audit_chain_hash"].(string)
	if !strings.HasPrefix(h, "sha256:") {
		t.Fatalf("audit_chain_hash = %q", h)
	}
}

func TestGenerateInteractionRecord(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	rec, err := v2.GenerateInteractionRecord(reg, ck, pqk, v2.InteractionParams{
		InteractionID:       "int_001",
		SessionNonce:        strings.Repeat("a", 64),
		AgentID:             "agent_A",
		CounterpartyAgentID: "agent_B",
		PublicLayer:         map[string]string{"terms": "t", "decisions": "d", "commitments": "c"},
		PrivateLayerHash:    "sha256:" + strings.Repeat("0", 64),
		MandateID:           "mand_001",
	})
	if err != nil {
		t.Fatalf("GenerateInteractionRecord: %v", err)
	}
	sig, ok := rec["composite_sig"].(*v2.CompositeSignature)
	if !ok || sig.Binding != "pq_over_classical" {
		t.Fatalf("sig = %#v", rec["composite_sig"])
	}
}
