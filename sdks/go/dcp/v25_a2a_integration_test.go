package dcp_test

import (
	"strings"
	"testing"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func mkAgent(id string, caps []string, status string) map[string]interface{} {
	return map[string]interface{}{
		"agent_id":                id,
		"agent_name":              id,
		"capabilities":            caps,
		"bundle_endpoint":         "https://x/" + id,
		"a2a_endpoint":            "wss://x/" + id,
		"a2a_transports":          []string{"websocket"},
		"security_tier_minimum":   "standard",
		"supported_algorithms":    map[string]interface{}{"signing": []string{"ed25519"}, "kem": []string{"x25519-ml-kem-768"}},
		"status":                  status,
		"updated_at":              "2026-04-01T00:00:00Z",
	}
}

func TestA2ADirectoryBasic(t *testing.T) {
	dir := v2.CreateAgentDirectoryA2A("Ex", []map[string]interface{}{
		mkAgent("a1", []string{"read"}, "active"),
	})
	if dir["organization"] != "Ex" {
		t.Fatalf("organization")
	}
}

func TestA2AFindByCapability(t *testing.T) {
	dir := v2.CreateAgentDirectoryA2A("", []map[string]interface{}{
		mkAgent("agent_A", []string{"read", "write"}, "active"),
		mkAgent("agent_B", []string{"admin"}, "active"),
		mkAgent("agent_C", []string{"read"}, "revoked"),
	})
	a := v2.FindAgentByCapability(dir, []string{"read"})
	if a == nil || a["agent_id"] != "agent_A" {
		t.Fatalf("unexpected find result: %v", a)
	}
	b := v2.FindAgentByCapability(dir, []string{"admin"})
	if b == nil || b["agent_id"] != "agent_B" {
		t.Fatalf("unexpected: %v", b)
	}
	if v2.FindAgentByCapability(dir, []string{"missing"}) != nil {
		t.Fatalf("expected nil for missing capability")
	}
	if v2.FindAgentByID(dir, "agent_A") == nil {
		t.Fatalf("FindAgentByID failed")
	}
	if v2.FindAgentByID(dir, "agent_C") != nil {
		t.Fatalf("revoked agent should not be findable")
	}
}

func TestA2AValidateDirectoryEntry(t *testing.T) {
	errs := v2.ValidateDirectoryEntry(map[string]interface{}{
		"agent_id":     "",
		"capabilities": []string{},
		"status":       "bogus",
	})
	hasPrefix := func(needle string) bool {
		for _, e := range errs {
			if strings.Contains(e, needle) {
				return true
			}
		}
		return false
	}
	if !hasPrefix("agent_id") || !hasPrefix("capabilities") || !hasPrefix("Invalid status") {
		t.Fatalf("errs=%v", errs)
	}
}

func TestA2AHandshakeShape(t *testing.T) {
	h := v2.CreateHello(
		map[string]interface{}{"bundle": "stub"},
		"pub",
		[]string{"read"},
		"standard",
	)
	if h["type"] != "A2A_HELLO" || h["protocol_version"] != "2.0" {
		t.Fatalf("hello shape")
	}
	if s, ok := h["nonce"].(string); !ok || len(s) != 64 {
		t.Fatalf("nonce bad")
	}
	w := v2.CreateWelcome(
		map[string]interface{}{"bundle": "stub"},
		"respkem",
		"ctb64",
		"elevated",
	)
	if w["type"] != "A2A_WELCOME" || w["resolved_security_tier"] != "elevated" {
		t.Fatalf("welcome shape")
	}
}

func TestA2ADeriveSessionID(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = 0x01
	}
	a := strings.Repeat("a", 64)
	b := strings.Repeat("b", 64)
	s1, err := v2.DeriveSessionID("agent_L", "agent_R", a, b, key)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	s2, _ := v2.DeriveSessionID("agent_L", "agent_R", a, b, key)
	if s1 != s2 {
		t.Fatalf("not deterministic")
	}
	if len(s1) != 64 {
		t.Fatalf("len=%d", len(s1))
	}
}

func TestA2ACloseMessage(t *testing.T) {
	c := v2.CreateCloseMessage("sess_001", "complete", 42, "sha256:0")
	if c["type"] != "A2A_CLOSE" || c["reason"] != "complete" {
		t.Fatalf("shape")
	}
	if c["final_sequence"] != uint64(42) {
		t.Fatalf("final_sequence: %v", c["final_sequence"])
	}
}

// ── Session round trip ──

func pairSessions(t *testing.T) (*v2.A2ASession, *v2.A2ASession) {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = 'k'
	}
	left, err := v2.CreateA2ASession("sess_x", key, "agent_L", "agent_R", "standard", 1000)
	if err != nil {
		t.Fatalf("CreateA2ASession: %v", err)
	}
	right, err := v2.CreateA2ASession("sess_x", key, "agent_R", "agent_L", "standard", 1000)
	if err != nil {
		t.Fatalf("CreateA2ASession: %v", err)
	}
	return left, right
}

func TestA2ASessionKeyLengthEnforced(t *testing.T) {
	if _, err := v2.CreateA2ASession("x", []byte("short"), "l", "r", "routine", 1000); err == nil {
		t.Fatalf("expected error for short key")
	}
}

func TestA2ASessionRoundTrip(t *testing.T) {
	left, right := pairSessions(t)
	msg, err := v2.EncryptMessage(left, map[string]interface{}{"hello": "world", "n": 42})
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	got, err := v2.DecryptMessage(right, msg)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got["hello"] != "world" {
		t.Fatalf("roundtrip lost payload: %v", got)
	}
	if left.MessageCounterSend != 1 || right.MessageCounterRecv != 1 {
		t.Fatalf("counters not advanced")
	}
}

func TestA2ACannotSendOnClosed(t *testing.T) {
	left, _ := pairSessions(t)
	left.Status = "closed"
	if _, err := v2.EncryptMessage(left, map[string]interface{}{"x": 1}); err == nil {
		t.Fatalf("expected error on closed session")
	}
}

func TestA2ANeedsRekeying(t *testing.T) {
	left, _ := pairSessions(t)
	left.MessageCounterSend = 999
	if v2.NeedsRekeying(left) {
		t.Fatalf("should not rekey yet")
	}
	left.MessageCounterSend = 1000
	if !v2.NeedsRekeying(left) {
		t.Fatalf("should rekey at interval")
	}
}

func TestA2AResumeProof(t *testing.T) {
	left, _ := pairSessions(t)
	p := v2.GenerateResumeProof(left, 10)
	if !v2.VerifyResumeProof(left, 10, p) {
		t.Fatalf("resume proof should verify")
	}
	if v2.VerifyResumeProof(left, 11, p) {
		t.Fatalf("resume proof should fail for different seq")
	}
}
