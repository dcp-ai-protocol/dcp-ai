package v2_test

// Experimental candidate dcp-jcs-v2, phase 4 (Go): the producers, as the TypeScript ones. Positives are
// verified by the phase 3 bytes verifier, and VerifySignedBundleV2At still refuses their profile. Every
// rejection of the contract happens with zero calls to the real signers (counted by wrapping the real
// providers; each call still signs). Host values: exact types only, no struct converted, json.Number
// materialized by the candidate's number rules.

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

var p4Signs int

type p4Counting struct {
	v2.CryptoProvider
}

func (c p4Counting) Sign(message []byte, secretKeyB64 string) ([]byte, error) {
	p4Signs++
	return c.CryptoProvider.Sign(message, secretKeyB64)
}

var p4Now = time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)

func p4Registries() (*v2.AlgorithmRegistry, *v2.AlgorithmRegistry) {
	sign := v2.NewAlgorithmRegistry()
	sign.RegisterSigner(p4Counting{&providers.Ed25519Provider{}})
	sign.RegisterSigner(p4Counting{&providers.MlDsa65Provider{}})
	verify := v2.NewAlgorithmRegistry()
	verify.RegisterSigner(&providers.Ed25519Provider{})
	verify.RegisterSigner(&providers.MlDsa65Provider{})
	return sign, verify
}

func p4Keys(t *testing.T) v2.ExperimentalCandidateKeys {
	t.Helper()
	c, err := (&providers.Ed25519Provider{}).GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	p, err := (&providers.MlDsa65Provider{}).GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	return v2.ExperimentalCandidateKeys{
		Classical: v2.CompositeKeyInfo{Kid: c.Kid, Alg: "ed25519", SecretKeyB64: c.SecretKeyB64, PublicKeyB64: c.PublicKeyB64},
		PQ:        &v2.CompositeKeyInfo{Kid: p.Kid, Alg: "ml-dsa-65", SecretKeyB64: p.SecretKeyB64, PublicKeyB64: p.PublicKeyB64},
	}
}

func p4Sha(t *testing.T, v any) string {
	t.Helper()
	c, err := v2.CanonicalizeV2(v)
	if err != nil {
		t.Fatal(err)
	}
	return "sha256:" + v2.SHA256Hex([]byte(c))
}

func p4Str(s string) *string { return &s }

type p4Scenario struct {
	parts    v2.ExperimentalCandidateBundleParts
	signer   v2.ExperimentalCandidateBundleSigner
	options  v2.ExperimentalCandidateBundleOptions
	payloads map[string]map[string]any
	entries  []map[string]any
}

type p4Opts struct {
	classical bool
	target    map[string]any
	intent    map[string]any
	passport  map[string]any
	policy    map[string]any
	noEntries bool
	asBytes   bool
}

func p4Build(t *testing.T, reg *v2.AlgorithmRegistry, principal, agent v2.ExperimentalCandidateKeys, o p4Opts) p4Scenario {
	t.Helper()
	nonce := v2.GenerateSessionNonce()
	pk, ak := principal, agent
	if o.classical {
		pk.PQ, ak.PQ = nil, nil
	}
	keyEntries := func(k v2.ExperimentalCandidateKeys, expires any) []any {
		list := []v2.CompositeKeyInfo{k.Classical}
		if k.PQ != nil {
			list = append(list, *k.PQ)
		}
		out := []any{}
		for _, x := range list {
			out = append(out, map[string]any{"kid": x.Kid, "alg": x.Alg, "public_key_b64": x.PublicKeyB64, "created_at": "2026-10-21T00:00:00Z", "expires_at": expires, "status": "active"})
		}
		return out
	}
	merge := func(base, extra map[string]any) map[string]any {
		for k, v := range extra {
			base[k] = v
		}
		return base
	}
	rpr := map[string]any{"dcp_version": "2.0", "human_id": "human:candidate-principal", "session_nonce": nonce, "legal_name": "Candidate Principal",
		"entity_type": "natural_person", "jurisdiction": "US-CA", "liability_mode": "owner_responsible", "override_rights": true,
		"issued_at": "2026-10-21T00:00:00Z", "expires_at": nil, "contact": nil, "binding_keys": keyEntries(pk, nil)}
	passport := merge(map[string]any{"dcp_version": "2.0", "agent_id": "agent:candidate-bot", "session_nonce": nonce, "keys": keyEntries(ak, "2099-12-31T18:59:59-05:00"),
		"principal_binding_reference": "human:candidate-principal", "capabilities": []any{"browse", "api_call"}, "risk_tier": "medium",
		"created_at": "2026-10-21T00:00:00Z", "status": "active"}, o.passport)
	target := merge(map[string]any{"channel": "email", "to": "bob@example.com", "domain": "example.com"}, nil)
	intent := merge(map[string]any{"dcp_version": "2.0", "intent_id": "intent:candidate-001", "session_nonce": nonce, "agent_id": "agent:candidate-bot",
		"human_id": "human:candidate-principal", "timestamp": "2026-10-21T12:00:00Z", "action_type": "send_email", "target": target,
		"data_classes": []any{"contact_info"}, "estimated_impact": "medium", "requires_consent": false}, o.intent)
	if tgt, ok := intent["target"].(map[string]any); ok {
		intent["target"] = merge(tgt, o.target)
	}
	policy := merge(map[string]any{"dcp_version": "2.0", "intent_id": "intent:candidate-001", "session_nonce": nonce, "decision": "approve", "risk_score": 450,
		"reasons": []any{"Known recipient domain"}, "required_confirmation": nil, "applied_policy_hash": p4Sha(t, map[string]any{"policy": "default"}),
		"timestamp": "2026-10-21T12:00:01Z"}, o.policy)
	n := 2
	if o.noEntries {
		n = 0
	}
	entries := []map[string]any{}
	for i := 0; i < n; i++ {
		prev := "GENESIS"
		if i > 0 {
			prev = p4Sha(t, entries[i-1])
		}
		entries = append(entries, map[string]any{"dcp_version": "2.0", "audit_id": "audit:candidate-00" + string(rune('1'+i)), "session_nonce": nonce,
			"prev_hash": prev, "hash_alg": "sha256", "timestamp": "2026-10-21T12:0" + string(rune('1'+i)) + ":00Z", "agent_id": "agent:candidate-bot",
			"human_id": "human:candidate-principal", "intent_id": "intent:candidate-001", "intent_hash": p4Sha(t, intent), "policy_decision": "approved",
			"outcome": "email_sent", "evidence": map[string]any{"tool": "smtp", "result_ref": nil, "evidence_hash": nil}, "pq_checkpoint_ref": nil})
	}
	artifact := func(context string, payload map[string]any, k v2.ExperimentalCandidateKeys) v2.ExperimentalCandidateInput {
		r, err := v2.ExperimentalCandidateSignPayload(reg, context, v2.ExperimentalCandidateHostValue(payload), k)
		if err != nil {
			t.Fatalf("sign %s: %v", context, err)
		}
		if o.asBytes {
			return v2.ExperimentalCandidateBytes(r.Bytes)
		}
		return v2.ExperimentalCandidateHostValue(r.SignedPayload)
	}
	parts := v2.ExperimentalCandidateBundleParts{
		RPR:            artifact(v2.CtxResponsiblePrincipal, rpr, pk),
		Passport:       artifact(v2.CtxAgentPassport, passport, ak),
		Intent:         artifact(v2.CtxIntent, intent, ak),
		PolicyDecision: artifact(v2.CtxPolicyDecision, policy, ak),
	}
	for _, e := range entries {
		if o.asBytes {
			b, _ := json.Marshal(e)
			parts.AuditEntries = append(parts.AuditEntries, v2.ExperimentalCandidateBytes(b))
		} else {
			parts.AuditEntries = append(parts.AuditEntries, v2.ExperimentalCandidateHostValue(e))
		}
	}
	return p4Scenario{
		parts:    parts,
		signer:   v2.ExperimentalCandidateBundleSigner{SignerType: "human", SignerID: "human:candidate-principal", Keys: pk},
		options:  v2.ExperimentalCandidateBundleOptions{SessionNonce: nonce, SessionIssuedAt: p4Str("2026-10-21T00:00:00Z"), SessionExpiresAt: p4Str("2099-12-31T23:59:59+05:00"), CreatedAt: p4Str("2026-10-21T12:05:00Z")},
		payloads: map[string]map[string]any{"rpr": rpr, "passport": passport, "intent": intent, "policy": policy},
		entries:  entries,
	}
}

func p4ProduceAndVerify(t *testing.T, reg, verifyReg *v2.AlgorithmRegistry, s p4Scenario) map[string]any {
	t.Helper()
	out, err := v2.ExperimentalCandidateSignBundle(reg, s.parts, s.signer, s.options)
	if err != nil {
		t.Fatalf("produce: %v", err)
	}
	verifier, _ := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v2"}, Historical: "encoding_json"})
	r, err := verifier.VerifyAt(verifyReg, out.Bytes, v2.DefaultVerifierPolicy(), p4Now)
	if err != nil || r.Entered != "dcp-jcs-v2" || !r.Verification.Verified {
		t.Fatalf("phase 3 verification: %v %s %+v", err, r.Entered, r.Verification)
	}
	today := v2.VerifySignedBundleV2At(verifyReg, out.Bytes, v2.DefaultVerifierPolicy(), p4Now)
	if today.Verified || !strings.Contains(strings.Join(today.Errors, "|"), "Unknown canonicalization_profile: dcp-jcs-v2") {
		t.Fatalf("today's API: %+v", today.Errors)
	}
	var unit map[string]any
	if err := json.Unmarshal(out.Bytes, &unit); err != nil {
		t.Fatal(err)
	}
	return unit
}

// p4Rejected requires a contract rejection with this class (and part), and no signer call.
func p4Rejected(t *testing.T, label, class, part string, run func() error) *v2.ExperimentalCandidateProduceError {
	t.Helper()
	p4Signs = 0
	err := run()
	var pe *v2.ExperimentalCandidateProduceError
	if !errors.As(err, &pe) || pe.Class != class || (part != "" && pe.Part != part) {
		t.Fatalf("%s: %v, want %s in %s", label, err, class, part)
	}
	if p4Signs != 0 {
		t.Fatalf("%s: %d signer calls", label, p4Signs)
	}
	return pe
}

func p4Usage(t *testing.T, label string, run func() error) {
	t.Helper()
	p4Signs = 0
	if err := run(); !errors.Is(err, v2.ErrExperimentalCandidateUsage) || p4Signs != 0 {
		t.Fatalf("%s: %v (%d signer calls), want a usage error", label, err, p4Signs)
	}
}

func p4Nest(n int, leaf any) any {
	if n == 0 {
		return leaf
	}
	return []any{p4Nest(n-1, leaf)}
}

func p4Path(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

func TestExperimentalCandidateProduce(t *testing.T) {
	reg, verifyReg := p4Registries()
	principal, agent := p4Keys(t), p4Keys(t)
	classical := agent
	classical.PQ = nil
	sign := func(v any) (v2.ExperimentalCandidateProducedPayload, error) {
		return v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateHostValue(v), agent)
	}

	t.Run("signPayload signs the exact value without a profile", func(t *testing.T) {
		p4Signs = 0
		r, err := sign(map[string]any{"a": 1, "b": "x", "c": []any{true, nil}})
		if err != nil || p4Signs != 2 || strings.Contains(string(r.Bytes), "canonicalization_profile") {
			t.Fatalf("%v %d %s", err, p4Signs, r.Bytes)
		}
		again, _ := v2.ExperimentalCandidateIngress(r.Bytes)
		if !again.Accepted || string(again.Canonical) != string(r.Bytes) {
			t.Fatal("the artifact's bytes are not their own canonical form")
		}
		p4Signs = 0
		r, err = v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateHostValue(map[string]any{"a": 1}), classical)
		if err != nil || p4Signs != 1 || r.SignedPayload["composite_sig"].(map[string]any)["binding"] != "classical_only" {
			t.Fatalf("classical-only: %v %d", err, p4Signs)
		}
	})

	t.Run("exact numbers: bytes, json.Number and host integer kinds", func(t *testing.T) {
		long := "1." + strings.Repeat("0", 800)
		r, err := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateBytes([]byte(`{"n":`+long+`}`)), agent)
		if err != nil || !strings.Contains(string(r.Bytes), `"payload":{"n":1}`) {
			t.Fatalf("bytes: %v %s", err, r.Bytes)
		}
		r, err = sign(map[string]any{"j": json.Number(long), "k": json.Number("1e2"), "m": json.Number("-0"), "u": uint64(9007199254740991), "i8": int8(-5), "f": 2.0, "z": math.Copysign(0, -1), "f32": float32(3)})
		want := `"payload":{"f":2,"f32":3,"i8":-5,"j":1,"k":100,"m":0,"u":9007199254740991,"z":0}`
		if err != nil || !strings.Contains(string(r.Bytes), want) {
			t.Fatalf("host: %v %s", err, r.Bytes)
		}
		for label, c := range map[string]struct {
			v     any
			class string
		}{
			"NaN": {math.NaN(), "NUMBER_NOT_FINITE"}, "Inf": {math.Inf(1), "NUMBER_NOT_FINITE"}, "fraction": {0.5, "NUMBER_NOT_INTEGER"},
			"2^53 float": {float64(1 << 53), "NUMBER_OUT_OF_RANGE"}, "2^53 int": {int64(1 << 53), "NUMBER_OUT_OF_RANGE"},
			"uint64 max": {uint64(math.MaxUint64), "NUMBER_OUT_OF_RANGE"}, "json fraction": {json.Number("1.0000000000000001"), "NUMBER_NOT_INTEGER"},
			"json range": {json.Number("9007199254740992"), "NUMBER_OUT_OF_RANGE"}, "json NaN": {json.Number("NaN"), "TYPE_UNSUPPORTED"},
		} {
			v := c.v
			pe := p4Rejected(t, label, c.class, "payload", func() error { _, err := sign(map[string]any{"n": v}); return err })
			if p4Path(pe.Path) != "/n" {
				t.Errorf("%s: path %s", label, p4Path(pe.Path))
			}
		}
	})

	// Gate 2 (§4.1 of the phase 4 contract): each R and T cell of Go, by corpus ID, as the value of the corpus
	// document. R: the exact value (int64, a float64 that holds it, or the literal kept as json.Number); T: the
	// float64 a parser would give, whose class changes. n-overflow and n-huge-exponent cannot be materialized
	// as integers (N), but their literals are kept as json.Number and refused before anything is canonicalized
	// or signed; the 5000-digit exponent of the corpus is passed as is, never built into a number. The 9
	// parser IDs (P) are documented, not tested.
	t.Run("gate 2: the host-value cells of the corpus IDs", func(t *testing.T) {
		for _, c := range []struct {
			id, cell string
			v        any
			class    string
		}{
			{"n-two53", "R", int64(1 << 53), "NUMBER_OUT_OF_RANGE"},
			{"n-1e20", "R", 1e20, "NUMBER_OUT_OF_RANGE"},
			{"n-1e21", "R", 1e21, "NUMBER_OUT_OF_RANGE"},
			{"n-fraction", "R", 0.5, "NUMBER_NOT_INTEGER"},
			{"n-two53-plus-one", "R", int64(1<<53 + 1), "NUMBER_OUT_OF_RANGE"},
			{"n-neg-two53-plus-one", "R", int64(-(1<<53 + 1)), "NUMBER_OUT_OF_RANGE"},
			{"n-int64-max", "R", int64(math.MaxInt64), "NUMBER_OUT_OF_RANGE"},
			{"n-sci-over", "R", int64(9007199254740993), "NUMBER_OUT_OF_RANGE"},
			{"n-overflow", "R json.Number", json.Number("1e400"), "NUMBER_OUT_OF_RANGE"},
			{"n-overflow", "T", math.Inf(1), "NUMBER_NOT_FINITE"},
			{"n-huge-exponent", "R json.Number", json.Number("1e" + strings.Repeat("9", 5000)), "NUMBER_OUT_OF_RANGE"},
			{"n-huge-exponent", "T", math.Inf(1), "NUMBER_NOT_FINITE"},
			{"n-nan", "T", math.NaN(), "NUMBER_NOT_FINITE"},
			{"n-negative-infinity", "T", math.Inf(-1), "NUMBER_NOT_FINITE"},
		} {
			v := c.v
			pe := p4Rejected(t, c.id+" "+c.cell, c.class, "payload", func() error { _, err := sign(map[string]any{"n": v}); return err })
			if p4Path(pe.Path) != "/n" {
				t.Errorf("%s: path %s", c.id, p4Path(pe.Path))
			}
		}
		for _, levels := range []int{65, 129} {
			p4Rejected(t, fmt.Sprintf("s-depth-%d", levels), "DEPTH_EXCEEDED", "payload", func() error { _, err := sign(p4Nest(levels, 1)); return err })
		}
	})

	t.Run("no struct, pointer or foreign type is converted; invalid UTF-8 and cycles are refused", func(t *testing.T) {
		type passportStruct struct{ AgentID string }
		for label, v := range map[string]any{"struct": passportStruct{"a"}, "pointer": &passportStruct{"a"}, "typed map": map[string]string{"a": "b"},
			"typed slice": []string{"a"}, "func": func() {}, "complex": complex(1, 2)} {
			x := v
			p4Rejected(t, label, "TYPE_UNSUPPORTED", "payload", func() error { _, err := sign(map[string]any{"v": x}); return err })
		}
		p4Rejected(t, "string", "UTF8_INVALID", "payload", func() error { _, err := sign(map[string]any{"s": "a\xffb"}); return err })
		pe := p4Rejected(t, "key", "UTF8_INVALID", "payload", func() error { _, err := sign(map[string]any{"o": map[string]any{"k\xff": 1}}); return err })
		if !strings.HasPrefix(p4Path(pe.Path), "/o/") {
			t.Errorf("key path %s", p4Path(pe.Path))
		}
		cycle := map[string]any{}
		cycle["self"] = cycle
		p4Rejected(t, "cycle", "DEPTH_EXCEEDED", "payload", func() error { _, err := sign(cycle); return err })
	})

	t.Run("the artifact fits in 64 levels; the payload is an object; usage", func(t *testing.T) {
		if _, err := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateHostValue(map[string]any{"d": p4Nest(62, 0)}), classical); err != nil {
			t.Fatal(err)
		}
		p4Rejected(t, "depth 64", "DEPTH_EXCEEDED", "payload", func() error { _, err := sign(map[string]any{"d": p4Nest(63, 0)}); return err })
		p4Rejected(t, "array", "TYPE_UNSUPPORTED", "payload", func() error { _, err := sign([]any{1}); return err })
		p4Rejected(t, "nil", "TYPE_UNSUPPORTED", "payload", func() error { _, err := sign(nil); return err })
		p4Usage(t, "zero input", func() error {
			_, err := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateInput{}, agent)
			return err
		})
		p4Usage(t, "context", func() error {
			_, err := v2.ExperimentalCandidateSignPayload(reg, "DCP-AI.v2.Unknown", v2.ExperimentalCandidateHostValue(map[string]any{}), agent)
			return err
		})
		p4Usage(t, "key", func() error {
			_, err := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateHostValue(map[string]any{}), v2.ExperimentalCandidateKeys{})
			return err
		})
	})

	t.Run("bundles verified by phase 3 and refused by today's API", func(t *testing.T) {
		unit := p4ProduceAndVerify(t, reg, verifyReg, p4Build(t, reg, principal, agent, p4Opts{}))
		m := unit["bundle"].(map[string]any)["manifest"].(map[string]any)
		if m["canonicalization_profile"] != "dcp-jcs-v2" || unit["signature"].(map[string]any)["created_at"] != "2026-10-21T12:05:00Z" || m["audit_merkle_root_secondary"] != nil {
			t.Fatalf("manifest %v", m)
		}
		s := p4Build(t, reg, principal, agent, p4Opts{asBytes: true})
		p4ProduceAndVerify(t, reg, verifyReg, s)

		s = p4Build(t, reg, principal, agent, p4Opts{})
		// An artifact signed by today's API (SignPayload), used as it is.
		v1, err := v2.SignPayload(reg, v2.CtxIntent, s.payloads["intent"], agent.Classical, agent.PQ)
		if err != nil {
			t.Fatal(err)
		}
		cs, hash := v1.CompositeSig, v1.PayloadHash
		s.parts.Intent = v2.ExperimentalCandidateHostValue(map[string]any{"payload": s.payloads["intent"], "payload_hash": hash, "composite_sig": map[string]any{
			"classical": map[string]any{"alg": cs.Classical.Alg, "kid": cs.Classical.Kid, "sig_b64": cs.Classical.SigB64},
			"pq":        map[string]any{"alg": cs.PQ.Alg, "kid": cs.PQ.Kid, "sig_b64": cs.PQ.SigB64}, "binding": cs.Binding}})
		p4ProduceAndVerify(t, reg, verifyReg, s) // an artifact signed by today's API, used as it is

		s = p4Build(t, reg, principal, agent, p4Opts{classical: true, passport: map[string]any{"risk_tier": "low"}, policy: map[string]any{"risk_score": 0},
			intent: map[string]any{"action_type": "browse", "target": map[string]any{"channel": "web"}, "data_classes": []any{"none"}, "estimated_impact": "low"}})
		unit = p4ProduceAndVerify(t, reg, verifyReg, s)
		if unit["signature"].(map[string]any)["composite_sig"].(map[string]any)["binding"] != "classical_only" {
			t.Fatal("classical-only bundle")
		}

		s = p4Build(t, reg, principal, agent, p4Opts{})
		s.options.DualHash = true
		unit = p4ProduceAndVerify(t, reg, verifyReg, s)
		if !strings.HasPrefix(unit["bundle"].(map[string]any)["manifest"].(map[string]any)["audit_merkle_root_secondary"].(string), "sha3-256:") || unit["signature"].(map[string]any)["hash_alg"] != "sha256+sha3-256" {
			t.Fatal("dual hash")
		}

		s = p4Build(t, reg, principal, agent, p4Opts{noEntries: true})
		s.options.DualHash = true
		unit = p4ProduceAndVerify(t, reg, verifyReg, s)
		m = unit["bundle"].(map[string]any)["manifest"].(map[string]any)
		if m["audit_count"] != float64(0) || m["audit_merkle_root"] != "sha256:"+strings.Repeat("0", 64) || m["audit_merkle_root_secondary"] != "sha3-256:"+strings.Repeat("0", 64) {
			t.Fatalf("empty audit: %v", m)
		}
	})

	t.Run("a checkpoint and every extension are kept", func(t *testing.T) {
		s := p4Build(t, reg, principal, agent, p4Opts{target: map[string]any{"x_payload_ext": map[string]any{"kept": 1}}})
		s.entries[1]["x_entry_ext"] = "kept"
		s.parts.AuditEntries = []v2.ExperimentalCandidateInput{v2.ExperimentalCandidateHostValue(s.entries[0]), v2.ExperimentalCandidateHostValue(s.entries[1])}
		intentOut, _ := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateHostValue(s.payloads["intent"]), agent)
		art := intentOut.SignedPayload
		art["x_artifact_ext"] = "unsigned"
		art["composite_sig"].(map[string]any)["x_sig_ext"] = "unsigned"
		s.parts.Intent = v2.ExperimentalCandidateHostValue(art)
		first, err := v2.ExperimentalCandidateSignBundle(reg, s.parts, s.signer, s.options)
		if err != nil {
			t.Fatal(err)
		}
		root := first.SignedBundle["bundle"].(map[string]any)["manifest"].(map[string]any)["audit_merkle_root"]
		cp := map[string]any{"checkpoint_id": "ckpt-1", "session_nonce": s.options.SessionNonce, "x_checkpoint_ext": []any{1, 2}, "merkle_root": root,
			"event_range": map[string]any{"from_audit_id": s.entries[0]["audit_id"], "to_audit_id": s.entries[1]["audit_id"], "count": 2}}
		canonical, _, _ := v2.PreparePayload(cp)
		cs, err := v2.CompositeSign(reg, v2.CtxAuditEvent, canonical, agent.Classical, *agent.PQ)
		if err != nil {
			t.Fatal(err)
		}
		cp["composite_sig"] = map[string]any{"classical": map[string]any{"alg": cs.Classical.Alg, "kid": cs.Classical.Kid, "sig_b64": cs.Classical.SigB64},
			"pq": map[string]any{"alg": cs.PQ.Alg, "kid": cs.PQ.Kid, "sig_b64": cs.PQ.SigB64}, "binding": cs.Binding}
		s.parts.PQCheckpoints = []v2.ExperimentalCandidateInput{v2.ExperimentalCandidateHostValue(cp)}
		unit := p4ProduceAndVerify(t, reg, verifyReg, s)
		b := unit["bundle"].(map[string]any)
		intent := b["intent"].(map[string]any)
		checks := map[string]bool{
			"payload":    intent["payload"].(map[string]any)["target"].(map[string]any)["x_payload_ext"] != nil,
			"entry":      b["audit_entries"].([]any)[1].(map[string]any)["x_entry_ext"] == "kept",
			"checkpoint": b["pq_checkpoints"].([]any)[0].(map[string]any)["x_checkpoint_ext"] != nil,
			"artifact":   intent["x_artifact_ext"] == "unsigned",
			"composite":  intent["composite_sig"].(map[string]any)["x_sig_ext"] == "unsigned",
			"listed":     b["manifest"].(map[string]any)["pq_checkpoints"].([]any)[0] == "ckpt-1",
		}
		for k, ok := range checks {
			if !ok {
				t.Errorf("%s extension lost", k)
			}
		}
	})

	t.Run("the boundaries of §9 and the depth of the final unit", func(t *testing.T) {
		e000, smile := string(rune(0xE000)), string(rune(0x1F600))
		target := map[string]any{"limits": map[string]any{"max": int64(9007199254740991), "min": int64(-9007199254740991)},
			"keys": map[string]any{smile: 2, e000: 1}, "__proto__": "data",
			"strings": []any{string(rune(0xFEFF)) + "start", string(rune(0xFFFD)), string(rune(0x2028)), string(rune(0))}}
		s := p4Build(t, reg, principal, agent, p4Opts{target: target})
		out, err := v2.ExperimentalCandidateSignBundle(reg, s.parts, s.signer, s.options)
		if err != nil {
			t.Fatal(err)
		}
		if i, j := strings.Index(string(out.Bytes), `"`+e000+`"`), strings.Index(string(out.Bytes), `"`+smile+`"`); i < 0 || j < 0 || i > j {
			t.Error("keys not in code point order")
		}
		p4ProduceAndVerify(t, reg, verifyReg, s)
		p4ProduceAndVerify(t, reg, verifyReg, p4Build(t, reg, principal, agent, p4Opts{target: map[string]any{"d": p4Nest(59, "deep")}})) // payload 61, unit 64
		s = p4Build(t, reg, principal, agent, p4Opts{target: map[string]any{"d": p4Nest(60, "deep")}})                                    // payload 62, unit 65
		pe := p4Rejected(t, "unit depth", "DEPTH_EXCEEDED", "unit", func() error {
			_, err := v2.ExperimentalCandidateSignBundle(reg, s.parts, s.signer, s.options)
			return err
		})
		if !strings.HasPrefix(p4Path(pe.Path), "/bundle/intent/payload/target/d") {
			t.Errorf("unit depth path %s", p4Path(pe.Path))
		}
	})

	t.Run("rejections before any signer: commitments, chain, session, signer, received bytes", func(t *testing.T) {
		s := p4Build(t, reg, principal, agent, p4Opts{})
		run := func(parts v2.ExperimentalCandidateBundleParts, signer v2.ExperimentalCandidateBundleSigner, options v2.ExperimentalCandidateBundleOptions) func() error {
			return func() error { _, err := v2.ExperimentalCandidateSignBundle(reg, parts, signer, options); return err }
		}
		changed, _ := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateHostValue(s.payloads["intent"]), agent)
		changed.SignedPayload["payload"].(map[string]any)["action_type"] = "send_fax"
		bad := s.parts
		bad.Intent = v2.ExperimentalCandidateHostValue(changed.SignedPayload)
		if pe := p4Rejected(t, "commitment", "COMMITMENT_MISMATCH", "intent", run(bad, s.signer, s.options)); p4Path(pe.Path) != "/payload_hash" {
			t.Error(p4Path(pe.Path))
		}
		first := map[string]any{}
		for k, v := range s.entries[0] {
			first[k] = v
		}
		first["prev_hash"] = p4Sha(t, map[string]any{"earlier": "v1 evidence"})
		chain := s.parts
		chain.AuditEntries = []v2.ExperimentalCandidateInput{v2.ExperimentalCandidateHostValue(first), v2.ExperimentalCandidateHostValue(s.entries[1])}
		p4Rejected(t, "genesis", "CHAIN_NOT_GENESIS", "audit_entries", run(chain, s.signer, s.options))
		second := map[string]any{}
		for k, v := range s.entries[1] {
			second[k] = v
		}
		second["prev_hash"] = "sha256:" + strings.Repeat("0", 64)
		chain.AuditEntries = []v2.ExperimentalCandidateInput{v2.ExperimentalCandidateHostValue(s.entries[0]), v2.ExperimentalCandidateHostValue(second)}
		p4Rejected(t, "break", "CHAIN_BREAK", "audit_entries", run(chain, s.signer, s.options))
		opts := s.options
		opts.SessionNonce = v2.GenerateSessionNonce()
		p4Rejected(t, "nonce", "SESSION_INVALID", "parts", run(s.parts, s.signer, opts))
		opts = s.options
		opts.SessionNonce = "x"
		p4Rejected(t, "nonce format", "SESSION_INVALID", "options", run(s.parts, s.signer, opts))
		opts = s.options
		opts.SessionIssuedAt = p4Str("2100-01-01T00:00:00Z")
		p4Rejected(t, "issued after expiry", "SESSION_INVALID", "options", run(s.parts, s.signer, opts))
		opts = s.options
		opts.SessionIssuedAt = nil
		p4Rejected(t, "no start", "SESSION_ISSUED_AT_REQUIRED", "options", run(s.parts, s.signer, opts))
		other := s.signer
		other.SignerID = "human:else"
		p4Rejected(t, "signer", "SIGNER_MISMATCH", "signer", run(s.parts, other, s.options))
		entry, _ := json.Marshal(s.entries[1])
		text := string(entry)
		for label, c := range map[string]struct {
			data   []byte
			class  string
			offset int
		}{
			"BOM":       {append([]byte{0xef, 0xbb, 0xbf}, entry...), "BOM", 0},
			"SYNTAX":    {entry[:len(entry)-1], "SYNTAX", len(entry) - 1},
			"DUPLICATE": {[]byte(strings.Replace(text, `"outcome":"email_sent"`, `"outcome":"email_sent","outcome":"email_sent"`, 1)), "DUPLICATE_KEY", -1},
			"FRACTION":  {[]byte(strings.Replace(text, `"hash_alg":"sha256"`, `"hash_alg":"sha256","n":1.5`, 1)), "NUMBER_NOT_INTEGER", -1},
			"UTF8":      {append(append(append([]byte{}, entry[:20]...), 0xff), entry[20:]...), "UTF8_INVALID", 20},
		} {
			parts := s.parts
			parts.AuditEntries = []v2.ExperimentalCandidateInput{v2.ExperimentalCandidateHostValue(s.entries[0]), v2.ExperimentalCandidateBytes(c.data)}
			pe := p4Rejected(t, label, c.class, "audit_entries", run(parts, s.signer, s.options))
			if p4Path(pe.Path) != "/1" || (c.offset >= 0 && (pe.Offset == nil || *pe.Offset != c.offset)) {
				t.Errorf("%s: path %s offset %v", label, p4Path(pe.Path), pe.Offset)
			}
		}
	})

	t.Run("outputs never alias the inputs", func(t *testing.T) {
		s := p4Build(t, reg, principal, agent, p4Opts{})
		out, err := v2.ExperimentalCandidateSignBundle(reg, s.parts, s.signer, s.options)
		if err != nil {
			t.Fatal(err)
		}
		before := string(out.Bytes)
		s.entries[1]["outcome"] = "changed"
		s.payloads["intent"]["action_type"] = "changed"
		after, _ := v2.CanonicalizeV2(out.SignedBundle)
		if after != before {
			t.Error("the produced value shares the caller's maps")
		}
	})
}
