package dcp_test

import (
	"strings"
	"testing"
	"time"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// ── Advisory ──

func TestAdvisoryGraceExpired(t *testing.T) {
	adv := v2.BuildAlgorithmAdvisory(
		"adv_001", "medium", []string{"ed25519"}, "deprecate",
		"2020-01-01T00:00:00Z", "old", "issuer_X",
	)
	r := v2.CheckAdvisory(adv, time.Now().UTC())
	if !r.GracePeriodExpired {
		t.Fatalf("grace should be expired")
	}
}

func TestAdvisoryEvaluationRoutes(t *testing.T) {
	advs := []map[string]interface{}{
		v2.BuildAlgorithmAdvisory("adv_001", "medium", []string{"ed25519"}, "deprecate", "2020-01-01T00:00:00Z", "", "i"),
		v2.BuildAlgorithmAdvisory("adv_002", "low", []string{"ml-dsa-65"}, "warn", "2020-01-01T00:00:00Z", "", "i"),
		v2.BuildAlgorithmAdvisory("adv_003", "critical", []string{"md5"}, "revoke", "2020-01-01T00:00:00Z", "", "i"),
	}
	eval := v2.EvaluateAdvisories(advs, time.Time{})
	if _, ok := eval.Deprecated["ed25519"]; !ok {
		t.Fatalf("ed25519 should be deprecated")
	}
	if _, ok := eval.Warned["ml-dsa-65"]; !ok {
		t.Fatalf("ml-dsa-65 should be warned")
	}
	if _, ok := eval.Revoked["md5"]; !ok {
		t.Fatalf("md5 should be revoked")
	}
	if len(eval.ActiveAdvisories) != 3 {
		t.Fatalf("expected 3 active advisories, got %d", len(eval.ActiveAdvisories))
	}
}

func TestAdvisoryFutureAdvisorySkipped(t *testing.T) {
	adv := v2.BuildAlgorithmAdvisory("adv_fut", "medium", []string{"X"}, "deprecate", "2099-01-01T00:00:00Z", "", "i")
	eval := v2.EvaluateAdvisories([]map[string]interface{}{adv}, time.Time{})
	if len(eval.Deprecated) != 0 || len(eval.ActiveAdvisories) != 0 {
		t.Fatalf("future advisory should be skipped")
	}
}

func TestApplyAdvisoriesToPolicy(t *testing.T) {
	advs := []map[string]interface{}{
		v2.BuildAlgorithmAdvisory("adv_001", "medium", []string{"ed25519"}, "deprecate", "2020-01-01T00:00:00Z", "", "i"),
		v2.BuildAlgorithmAdvisory("adv_002", "low", []string{"ml-dsa-65"}, "warn", "2020-01-01T00:00:00Z", "", "i"),
	}
	eval := v2.EvaluateAdvisories(advs, time.Time{})
	out := v2.ApplyAdvisoriesToPolicy([]string{"ed25519", "ml-dsa-65", "slh-dsa-192f"}, eval)
	if len(out.RemovedAlgs) != 1 || out.RemovedAlgs[0] != "ed25519" {
		t.Fatalf("removed: %v", out.RemovedAlgs)
	}
	if len(out.FilteredAlgs) != 2 {
		t.Fatalf("filtered: %v", out.FilteredAlgs)
	}
	if len(out.Warnings) != 1 || !strings.Contains(out.Warnings[0], "ml-dsa-65") {
		t.Fatalf("warnings: %v", out.Warnings)
	}
}

// ── Blinded RPR ──

func sampleRPR() map[string]interface{} {
	return map[string]interface{}{
		"dcp_version":       "2.0",
		"human_id":          "human_1",
		"session_nonce":     strings.Repeat("a", 64),
		"contact":           "dan@example.com",
		"legal_name":        "Dan Example",
		"entity_type":       "individual",
		"jurisdiction":      "US-CA",
		"liability_mode":    "direct",
		"override_rights":   []string{"revoke"},
		"issued_at":         "2026-04-01T00:00:00Z",
		"expires_at":        "2027-04-01T00:00:00Z",
		"binding_keys":      []string{},
	}
}

func TestComputePIIHash(t *testing.T) {
	h1, err := v2.ComputePIIHash(sampleRPR())
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	h2, _ := v2.ComputePIIHash(sampleRPR())
	if h1 != h2 {
		t.Fatalf("not deterministic")
	}
	if !strings.HasPrefix(h1, "sha256:") || len(h1) != len("sha256:")+64 {
		t.Fatalf("bad shape: %s", h1)
	}
}

func TestBlindRPRStripsPII(t *testing.T) {
	full := sampleRPR()
	b, err := v2.BlindRPR(full)
	if err != nil {
		t.Fatalf("BlindRPR: %v", err)
	}
	if b["blinded"] != true {
		t.Fatalf("blinded flag missing")
	}
	if b["contact"] != nil {
		t.Fatalf("contact should be absent")
	}
	if b["legal_name"] != nil {
		t.Fatalf("legal_name should be absent")
	}
	if !v2.IsBlindedRPR(b) {
		t.Fatalf("IsBlindedRPR false")
	}
}

func TestVerifyBlindedRPRHappy(t *testing.T) {
	full := sampleRPR()
	b, _ := v2.BlindRPR(full)
	r := v2.VerifyBlindedRPR(full, b)
	if !r.Valid {
		t.Fatalf("errors: %v", r.Errors)
	}
}

func TestVerifyBlindedRPRTampered(t *testing.T) {
	full := sampleRPR()
	b, _ := v2.BlindRPR(full)
	b["jurisdiction"] = "TAMPERED"
	r := v2.VerifyBlindedRPR(full, b)
	if r.Valid {
		t.Fatalf("expected invalid")
	}
}

// ── MPA ──

func mkAuth(party, role string, hasSig bool) map[string]interface{} {
	var sig interface{}
	if hasSig {
		sig = map[string]interface{}{
			"classical": map[string]interface{}{"alg": "ed25519", "kid": party, "sig_b64": "AAAA"},
			"pq":        nil,
			"binding":   "classical_only",
		}
	}
	return map[string]interface{}{
		"party_id":       party,
		"role":           role,
		"composite_sig":  sig,
	}
}

func mkMPA(op string, auths []map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"type":              "multi_party_authorization",
		"operation":         op,
		"operation_payload": map[string]interface{}{},
		"required_parties":  2,
		"authorizations":    auths,
	}
}

func TestMPAValid(t *testing.T) {
	m := mkMPA("revoke_agent", []map[string]interface{}{
		mkAuth("p1", "owner", true),
		mkAuth("p2", "org_admin", true),
	})
	r := v2.VerifyMultiPartyAuthorization(m, nil)
	if !r.Valid {
		t.Fatalf("errors: %v", r.Errors)
	}
}

func TestMPARejectsInsufficient(t *testing.T) {
	m := mkMPA("revoke_agent", []map[string]interface{}{mkAuth("p1", "owner", true)})
	r := v2.VerifyMultiPartyAuthorization(m, nil)
	if r.Valid {
		t.Fatalf("expected invalid")
	}
}

func TestMPARequiresOwner(t *testing.T) {
	m := mkMPA("revoke_agent", []map[string]interface{}{
		mkAuth("p1", "org_admin", true),
		mkAuth("p2", "recovery_contact", true),
	})
	r := v2.VerifyMultiPartyAuthorization(m, nil)
	if r.Valid {
		t.Fatalf("expected invalid")
	}
}

func TestMPAUnknownOperation(t *testing.T) {
	m := mkMPA("unknown_op", []map[string]interface{}{mkAuth("p1", "owner", true)})
	r := v2.VerifyMultiPartyAuthorization(m, nil)
	if r.Valid {
		t.Fatalf("expected invalid")
	}
}

func TestMPAMissingSig(t *testing.T) {
	m := mkMPA("revoke_agent", []map[string]interface{}{
		mkAuth("p1", "owner", true),
		mkAuth("p2", "org_admin", false),
	})
	r := v2.VerifyMultiPartyAuthorization(m, nil)
	if r.Valid {
		t.Fatalf("expected invalid")
	}
}
