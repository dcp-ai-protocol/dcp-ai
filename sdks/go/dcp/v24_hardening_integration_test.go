package dcp_test

import (
	"strings"
	"testing"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// ── session nonce ──

func TestGenerateSessionNonceShape(t *testing.T) {
	n := v2.GenerateSessionNonce()
	if len(n) != 64 {
		t.Fatalf("len=%d", len(n))
	}
	if !v2.IsValidSessionNonce(n) {
		t.Fatalf("invalid nonce: %s", n)
	}
}

func TestSessionBindingHelpers(t *testing.T) {
	nonce := strings.Repeat("a", 64)
	ok := v2.VerifySessionBinding([]map[string]interface{}{
		{"session_nonce": nonce},
		{"session_nonce": nonce},
	})
	if !ok.Valid {
		t.Fatalf("expected valid, got error=%s", ok.Error)
	}
	bad := v2.VerifySessionBinding([]map[string]interface{}{
		{"session_nonce": nonce},
		{"session_nonce": strings.Repeat("b", 64)},
	})
	if bad.Valid {
		t.Fatalf("expected invalid")
	}
	empty := v2.VerifySessionBinding(nil)
	if empty.Valid {
		t.Fatalf("expected empty to fail")
	}
}

func TestSessionExpiry(t *testing.T) {
	past := v2.GenerateSessionExpiry(-1, "")
	if !v2.IsSessionExpired(past) {
		t.Fatalf("expected %s to be expired", past)
	}
	fut := v2.GenerateSessionExpiry(60, "")
	if v2.IsSessionExpired(fut) {
		t.Fatalf("expected %s NOT expired", fut)
	}
	// tier-default expiry for routine should also be in the future
	tierExp := v2.GenerateSessionExpiry(0, "routine")
	if v2.IsSessionExpired(tierExp) {
		t.Fatalf("tier-default expiry should not already be expired")
	}
}

// ── security tier helpers ──

func TestTierHelpers(t *testing.T) {
	if v2.MaxTier("routine", "maximum") != "maximum" {
		t.Fatalf("MaxTier routine,maximum")
	}
	if v2.MaxTier("elevated", "standard") != "elevated" {
		t.Fatalf("MaxTier elevated,standard")
	}
	if v2.TierToVerificationMode("maximum") != "hybrid_required" {
		t.Fatalf("TierToVerificationMode maximum")
	}
	if v2.TierToVerificationMode("routine") != "classical_only" {
		t.Fatalf("TierToVerificationMode routine")
	}
	if v2.TierToCheckpointInterval("routine") != 50 {
		t.Fatalf("interval routine")
	}
	if v2.TierToCheckpointInterval("maximum") != 1 {
		t.Fatalf("interval maximum")
	}
}

// ── emergency revocation ──

func TestEmergencyRevocationRoundTrip(t *testing.T) {
	pair := v2.GenerateEmergencyRevocationToken()
	if !strings.HasPrefix(pair.EmergencyRevocationToken, "sha256:") {
		t.Fatalf("token prefix: %s", pair.EmergencyRevocationToken)
	}
	if len(pair.RevocationSecret) != 64 {
		t.Fatalf("secret length: %d", len(pair.RevocationSecret))
	}
	if !v2.VerifyEmergencyRevocationSecret(pair.RevocationSecret, pair.EmergencyRevocationToken) {
		t.Fatalf("round-trip failed")
	}
	if v2.VerifyEmergencyRevocationSecret(strings.Repeat("f", 64), pair.EmergencyRevocationToken) {
		t.Fatalf("wrong secret should not verify")
	}
	if v2.VerifyEmergencyRevocationSecret(pair.RevocationSecret, "md5:0") {
		t.Fatalf("bad prefix should not verify")
	}
	if v2.VerifyEmergencyRevocationSecret("ab", pair.EmergencyRevocationToken) {
		t.Fatalf("bad length should not verify")
	}
	req := v2.BuildEmergencyRevocation("agent_X", "human_1", pair.RevocationSecret)
	if req["type"] != "emergency_revocation" {
		t.Fatalf("type mismatch")
	}
	if req["reason"] != "key_compromise_emergency" {
		t.Fatalf("reason mismatch")
	}
}

// ── PQ checkpoint ──

func mkEvent(i int) map[string]interface{} {
	return map[string]interface{}{
		"audit_id":      strings.Repeat("e", 0) + "evt_" + fmtInt(i),
		"session_nonce": strings.Repeat("a", 64),
		"seq":           i,
	}
}

func fmtInt(i int) string {
	const digits = "0123456789"
	if i == 0 {
		return "000"
	}
	out := make([]byte, 0, 3)
	for i > 0 {
		out = append([]byte{digits[i%10]}, out...)
		i /= 10
	}
	for len(out) < 3 {
		out = append([]byte{'0'}, out...)
	}
	return string(out)
}

func TestAuditEventsMerkleRoot(t *testing.T) {
	events := []map[string]interface{}{mkEvent(1), mkEvent(2), mkEvent(3), mkEvent(4)}
	r1, err := v2.AuditEventsMerkleRoot(events)
	if err != nil {
		t.Fatalf("root err: %v", err)
	}
	r2, _ := v2.AuditEventsMerkleRoot(events)
	if r1 != r2 {
		t.Fatalf("not deterministic")
	}
	if len(r1) != 64 {
		t.Fatalf("len=%d", len(r1))
	}
	if _, err := v2.AuditEventsMerkleRoot(nil); err == nil {
		t.Fatalf("expected error on empty")
	}
}

func TestCreatePQCheckpoint(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	events := []map[string]interface{}{mkEvent(1), mkEvent(2), mkEvent(3), mkEvent(4), mkEvent(5)}
	ckpt, err := v2.CreatePQCheckpoint(reg, ck, pqk, events, strings.Repeat("a", 64))
	if err != nil {
		t.Fatalf("CreatePQCheckpoint: %v", err)
	}
	rg, _ := ckpt["event_range"].(map[string]interface{})
	if rg["count"] != 5 {
		t.Fatalf("count=%v", rg["count"])
	}
	mr, _ := ckpt["merkle_root"].(string)
	if !strings.HasPrefix(mr, "sha256:") {
		t.Fatalf("merkle_root=%s", mr)
	}
	sig, ok := ckpt["composite_sig"].(*v2.CompositeSignature)
	if !ok || sig.Binding != "pq_over_classical" {
		t.Fatalf("composite_sig=%#v", ckpt["composite_sig"])
	}
}

func TestPQCheckpointManagerFlushInterval(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	mgr, err := v2.NewPQCheckpointManager(3, reg, strings.Repeat("a", 64), ck, pqk)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if mgr.Interval() != 3 {
		t.Fatalf("interval=%d", mgr.Interval())
	}
	for i := 1; i <= 2; i++ {
		got, err := mgr.RecordEvent(mkEvent(i))
		if err != nil {
			t.Fatalf("record: %v", err)
		}
		if got != nil {
			t.Fatalf("unexpected flush at %d", i)
		}
	}
	got, err := mgr.RecordEvent(mkEvent(3))
	if err != nil {
		t.Fatalf("record3: %v", err)
	}
	if got == nil {
		t.Fatalf("expected flush at interval")
	}
	// second batch manual flush
	_, _ = mgr.RecordEvent(mkEvent(4))
	_, _ = mgr.RecordEvent(mkEvent(5))
	got, err = mgr.Flush()
	if err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got == nil {
		t.Fatalf("expected checkpoint on flush")
	}
	if len(mgr.Checkpoints()) != 2 {
		t.Fatalf("checkpoints=%d", len(mgr.Checkpoints()))
	}
}

func TestPQCheckpointManagerTierDerivesInterval(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	mgr := v2.NewPQCheckpointManagerWithTier("routine", reg, strings.Repeat("a", 64), ck, pqk)
	if mgr.Interval() != 50 {
		t.Fatalf("routine interval=%d", mgr.Interval())
	}
	mgr.SetTier("maximum")
	if mgr.Interval() != 1 {
		t.Fatalf("maximum interval=%d", mgr.Interval())
	}
}
