package dcp

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// mandate_chain_vectors.json (DCP-09 §3.5): every must_accept chain verifies
// at verification_time with the expected depth and effective tier, every
// must_reject chain is rejected with an error naming error_contains, and the
// tier_floor cases give the expected security tier.
func TestMandateChainVectors(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "mandate_chain_vectors.json"))
	if err != nil {
		t.Fatalf("read mandate chain vectors: %v", err)
	}
	var vecs struct {
		VerificationTime string              `json:"verification_time"`
		Keys             v2.MandateChainKeys `json:"keys"`
		MustAccept       []struct {
			Name              string                   `json:"name"`
			Chain             []map[string]interface{} `json:"chain"`
			RevokedMandateIDs []string                 `json:"revoked_mandate_ids"`
			Expected          struct {
				Depth         int     `json:"depth"`
				EffectiveTier *string `json:"effective_tier"`
			} `json:"expected"`
		} `json:"must_accept"`
		MustReject []struct {
			Name              string                   `json:"name"`
			Chain             []map[string]interface{} `json:"chain"`
			RevokedMandateIDs []string                 `json:"revoked_mandate_ids"`
			VerificationTime  string                   `json:"verification_time"`
			ErrorContains     string                   `json:"error_contains"`
		} `json:"must_reject"`
		TierFloor struct {
			Cases []struct {
				Name             string                 `json:"name"`
				Intent           map[string]interface{} `json:"intent"`
				PolicyDecision   map[string]interface{} `json:"policy_decision"`
				MandateChainTier *string                `json:"mandate_chain_tier"`
				Expected         string                 `json:"expected"`
			} `json:"cases"`
		} `json:"tier_floor"`
	}
	if err := json.Unmarshal(data, &vecs); err != nil {
		t.Fatalf("parse mandate chain vectors: %v", err)
	}
	reg := newRegistry()
	instant := func(s string) time.Time {
		at, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatalf("verification_time %q: %v", s, err)
		}
		return at
	}
	revokedSet := func(ids []string) map[string]bool {
		revoked := map[string]bool{}
		for _, id := range ids {
			revoked[id] = true
		}
		return revoked
	}

	if len(vecs.MustAccept) == 0 {
		t.Fatal("no must_accept chains")
	}
	for _, c := range vecs.MustAccept {
		t.Run("accept/"+c.Name, func(t *testing.T) {
			r := v2.VerifyMandateChain(reg, c.Chain, revokedSet(c.RevokedMandateIDs), vecs.Keys, instant(vecs.VerificationTime))
			if !r.Valid || len(r.Errors) != 0 {
				t.Fatalf("must verify: %v", r.Errors)
			}
			wantTier := ""
			if c.Expected.EffectiveTier != nil {
				wantTier = *c.Expected.EffectiveTier
			}
			if r.Depth != c.Expected.Depth || r.EffectiveTier != wantTier {
				t.Fatalf("depth %d tier %q, want %d %q", r.Depth, r.EffectiveTier, c.Expected.Depth, wantTier)
			}
		})
	}
	if len(vecs.MustReject) <= 10 {
		t.Fatalf("only %d must_reject chains", len(vecs.MustReject))
	}
	for _, c := range vecs.MustReject {
		t.Run("reject/"+c.Name, func(t *testing.T) {
			at := vecs.VerificationTime
			if c.VerificationTime != "" {
				at = c.VerificationTime
			}
			r := v2.VerifyMandateChain(reg, c.Chain, revokedSet(c.RevokedMandateIDs), vecs.Keys, instant(at))
			if r.Valid {
				t.Fatal("must be rejected")
			}
			if !strings.Contains(strings.ToLower(strings.Join(r.Errors, "\n")), c.ErrorContains) {
				t.Fatalf("no error mentions %q: %v", c.ErrorContains, r.Errors)
			}
		})
	}
	if len(vecs.TierFloor.Cases) == 0 {
		t.Fatal("no tier_floor cases")
	}
	for _, c := range vecs.TierFloor.Cases {
		t.Run("tier_floor/"+c.Name, func(t *testing.T) {
			in := v2.SecurityTierInputFromPayloads(c.Intent, c.PolicyDecision)
			if c.MandateChainTier != nil {
				in.MandateChainTier = *c.MandateChainTier
			}
			if got := v2.ComputeSecurityTier(in).Tier; got != c.Expected {
				t.Fatalf("tier %q, want %q", got, c.Expected)
			}
		})
	}
}

// chainKeys generates an Ed25519 + ML-DSA-65 key pair for one chain actor.
func chainKeys(t *testing.T, reg *v2.AlgorithmRegistry) (v2.CompositeKeyInfo, v2.CompositeKeyInfo) {
	t.Helper()
	ed, _ := reg.GetSigner("ed25519")
	pq, _ := reg.GetSigner("ml-dsa-65")
	edKp, err := ed.GenerateKeypair()
	if err != nil {
		t.Fatalf("ed25519 keygen: %v", err)
	}
	pqKp, err := pq.GenerateKeypair()
	if err != nil {
		t.Fatalf("ml-dsa-65 keygen: %v", err)
	}
	return v2.CompositeKeyInfo{Kid: edKp.Kid, Alg: "ed25519", SecretKeyB64: edKp.SecretKeyB64, PublicKeyB64: edKp.PublicKeyB64},
		v2.CompositeKeyInfo{Kid: pqKp.Kid, Alg: "ml-dsa-65", SecretKeyB64: pqKp.SecretKeyB64, PublicKeyB64: pqKp.PublicKeyB64}
}

func chainKeyEntries(keys ...v2.CompositeKeyInfo) []interface{} {
	entries := make([]interface{}, 0, len(keys))
	for _, k := range keys {
		entries = append(entries, map[string]interface{}{
			"kid": k.Kid, "alg": k.Alg, "public_key_b64": k.PublicKeyB64,
			"created_at": "2026-10-21T00:00:00Z", "expires_at": nil, "status": "active",
		})
	}
	return entries
}

// A human → orchestrator → subagent → tool chain built with the SDK verifies,
// a root without the chain fields is unchanged on the wire, and a revoked
// root or a chain out of order never verifies.
func TestMandateChainBuilders(t *testing.T) {
	reg := newRegistry()
	humanC, humanPQ := chainKeys(t, reg)
	orchC, orchPQ := chainKeys(t, reg)
	subC, subPQ := chainKeys(t, reg)
	toolC, toolPQ := chainKeys(t, reg)
	scope := []map[string]interface{}{
		{"domain": "email", "actions_permitted": []string{"read", "draft", "send"}, "data_classes": []string{"contact_info"}, "limits": map[string]interface{}{"max_messages_per_day": 100, "region": "EU"}},
		{"domain": "calendar", "actions_permitted": []string{"read", "create_event"}},
	}
	const validFrom, validUntil = "2026-01-01T00:00:00Z", "2099-01-01T00:00:00Z"

	plain, err := v2.CreateDelegationMandate(reg, humanC, humanPQ, v2.DelegationMandateParams{
		MandateID: "mandate:root", SessionNonce: strings.Repeat("a", 64), HumanID: "human:alice", AgentID: "agent:orchestrator",
		AuthorityScope: scope, ValidFrom: validFrom, ValidUntil: validUntil, Revocable: true,
	})
	if err != nil {
		t.Fatalf("CreateDelegationMandate: %v", err)
	}
	if len(plain) != 11 {
		t.Fatalf("a root without chain fields has %d keys, want the 11 original ones: %v", len(plain), plain)
	}

	root, err := v2.CreateDelegationMandate(reg, humanC, humanPQ, v2.DelegationMandateParams{
		MandateID: "mandate:root", SessionNonce: strings.Repeat("b", 64), HumanID: "human:alice", AgentID: "agent:orchestrator",
		AuthorityScope: scope, ValidFrom: validFrom, ValidUntil: validUntil, Revocable: true,
		SubDelegation: &v2.SubDelegationPolicy{Permitted: true, MaxDepth: 2}, MinimumSecurityTier: "standard",
	})
	if err != nil {
		t.Fatalf("CreateDelegationMandate: %v", err)
	}
	sub1, err := v2.CreateSubMandate(reg, orchC, orchPQ, root, v2.SubMandateParams{
		MandateID: "mandate:sub-1", SessionNonce: strings.Repeat("c", 64), AgentID: "agent:subagent",
		AuthorityScope: []map[string]interface{}{{"domain": "email", "actions_permitted": []string{"read", "draft"}, "data_classes": []string{"contact_info"}, "limits": map[string]interface{}{"max_messages_per_day": 20, "region": "EU", "approval": true}}},
		ValidFrom:      validFrom, ValidUntil: validUntil, Revocable: true,
		SubDelegation: &v2.SubDelegationPolicy{Permitted: true, MaxDepth: 2}, MinimumSecurityTier: "elevated",
	})
	if err != nil {
		t.Fatalf("CreateSubMandate: %v", err)
	}
	sub2, err := v2.CreateSubMandate(reg, subC, subPQ, sub1, v2.SubMandateParams{
		MandateID: "mandate:sub-2", SessionNonce: strings.Repeat("d", 64), AgentID: "agent:tool",
		AuthorityScope: []map[string]interface{}{{"domain": "email", "actions_permitted": []string{"read"}, "data_classes": []string{}, "limits": map[string]interface{}{"max_messages_per_day": 5, "region": "EU", "approval": true}}},
		ValidFrom:      validFrom, ValidUntil: validUntil, Revocable: true, MinimumSecurityTier: "maximum",
	})
	if err != nil {
		t.Fatalf("CreateSubMandate: %v", err)
	}
	if sub1["parent_mandate_id"] != "mandate:root" || sub1["delegation_depth"] != 1 || sub1["human_id"] != "human:alice" {
		t.Fatalf("sub1 link fields: %v", sub1)
	}
	if sub2["parent_mandate_id"] != "mandate:sub-1" || sub2["delegation_depth"] != 2 {
		t.Fatalf("sub2 link fields: %v", sub2)
	}
	if _, has := sub1["human_composite_sig"]; has {
		t.Fatal("a sub-mandate must not carry human_composite_sig")
	}

	keys := v2.MandateChainKeys{
		HumanKeys: chainKeyEntries(humanC, humanPQ),
		AgentKeys: map[string][]interface{}{
			"agent:orchestrator": chainKeyEntries(orchC, orchPQ),
			"agent:subagent":     chainKeyEntries(subC, subPQ),
			"agent:tool":         chainKeyEntries(toolC, toolPQ),
		},
	}
	chain := []map[string]interface{}{root, sub1, sub2}
	none := map[string]bool{}
	if r := v2.VerifyMandateChain(reg, chain, none, keys, time.Time{}); !r.Valid || r.Depth != 2 || r.EffectiveTier != "maximum" {
		t.Fatalf("chain must verify with depth 2 and tier maximum: %+v", r)
	}
	if r := v2.VerifyMandateChain(reg, chain[:1], none, keys, time.Time{}); !r.Valid || r.Depth != 0 || r.EffectiveTier != "standard" {
		t.Fatalf("root alone must verify with depth 0 and tier standard: %+v", r)
	}
	if r := v2.VerifyMandateChain(reg, chain, map[string]bool{"mandate:root": true}, keys, time.Time{}); r.Valid || len(r.Errors) != 1 || r.Errors[0] != "mandate[0]: revoked" {
		t.Fatalf("a revoked root must invalidate the chain: %+v", r)
	}
	if r := v2.VerifyMandateChain(reg, []map[string]interface{}{sub1, root}, none, keys, time.Time{}); r.Valid {
		t.Fatal("a chain out of order must not verify")
	}
	if r := v2.VerifyMandateChain(reg, nil, none, keys, time.Time{}); r.Valid {
		t.Fatal("an empty chain must not verify")
	}
	// A key that is not active cannot vouch for a hop.
	revokedKey := v2.MandateChainKeys{HumanKeys: keys.HumanKeys, AgentKeys: map[string][]interface{}{"agent:orchestrator": {
		map[string]interface{}{"kid": orchC.Kid, "alg": orchC.Alg, "public_key_b64": orchC.PublicKeyB64, "created_at": "2026-10-21T00:00:00Z", "expires_at": nil, "status": "revoked"},
		chainKeyEntries(orchPQ)[0],
	}}}
	if r := v2.VerifyMandateChain(reg, chain[:2], none, revokedKey, time.Time{}); r.Valid || !strings.Contains(strings.Join(r.Errors, ","), "delegator_composite_sig") {
		t.Fatalf("a revoked delegator key must fail the hop: %+v", r)
	}
	late, _ := time.Parse(time.RFC3339, "2100-01-01T00:00:00Z")
	if r := v2.VerifyMandateChain(reg, chain[:2], none, keys, late); r.Valid || !strings.Contains(strings.Join(r.Errors, ","), "expired") {
		t.Fatalf("an expired chain must not verify: %+v", r)
	}
}

// Integer limits compare exactly: a map built in Go (int) or decoded with
// UseNumber (json.Number) keeps 2^53+1 exact, so the signature over the
// canonical bytes verifies, and a float64 comparison would take it for equal
// to a parent of 2^53.
func TestMandateChainLimitsCompareIntegersExactly(t *testing.T) {
	reg := newRegistry()
	humanC, humanPQ := chainKeys(t, reg)
	orchC, orchPQ := chainKeys(t, reg)
	const validFrom, validUntil = "2026-01-01T00:00:00Z", "2099-01-01T00:00:00Z"
	root, err := v2.CreateDelegationMandate(reg, humanC, humanPQ, v2.DelegationMandateParams{
		MandateID: "mandate:root", SessionNonce: strings.Repeat("a", 64), HumanID: "human:alice", AgentID: "agent:orchestrator",
		AuthorityScope: []map[string]interface{}{{"domain": "api", "actions_permitted": []string{"call"}, "limits": map[string]interface{}{"n": 1 << 53}}},
		ValidFrom:      validFrom, ValidUntil: validUntil, Revocable: true,
		SubDelegation: &v2.SubDelegationPolicy{Permitted: true, MaxDepth: 1},
	})
	if err != nil {
		t.Fatalf("CreateDelegationMandate: %v", err)
	}
	keys := v2.MandateChainKeys{
		HumanKeys: chainKeyEntries(humanC, humanPQ),
		AgentKeys: map[string][]interface{}{"agent:orchestrator": chainKeyEntries(orchC, orchPQ)},
	}
	subWith := func(n int) map[string]interface{} {
		sub, err := v2.CreateSubMandate(reg, orchC, orchPQ, root, v2.SubMandateParams{
			MandateID: "mandate:sub", SessionNonce: strings.Repeat("b", 64), AgentID: "agent:subagent",
			AuthorityScope: []map[string]interface{}{{"domain": "api", "actions_permitted": []string{"call"}, "limits": map[string]interface{}{"n": n}}},
			ValidFrom:      validFrom, ValidUntil: validUntil, Revocable: true,
		})
		if err != nil {
			t.Fatalf("CreateSubMandate: %v", err)
		}
		return sub
	}
	// decoded re-reads the chain as JSON with UseNumber, as a verifier that keeps every digit would.
	decoded := func(chain []map[string]interface{}) []map[string]interface{} {
		raw, err := json.Marshal(chain)
		if err != nil {
			t.Fatal(err)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var out []map[string]interface{}
		if err := dec.Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	equal := []map[string]interface{}{root, subWith(1 << 53)}
	looser := []map[string]interface{}{root, subWith(1<<53 + 1)}
	for name, chain := range map[string][]map[string]interface{}{"built": equal, "decoded": decoded(equal)} {
		if r := v2.VerifyMandateChain(reg, chain, map[string]bool{}, keys, time.Time{}); !r.Valid {
			t.Fatalf("%s: an equal limit must verify: %v", name, r.Errors)
		}
	}
	for name, chain := range map[string][]map[string]interface{}{"built": looser, "decoded": decoded(looser)} {
		r := v2.VerifyMandateChain(reg, chain, map[string]bool{}, keys, time.Time{})
		if r.Valid || !strings.Contains(strings.Join(r.Errors, "\n"), "limits.n") {
			t.Fatalf("%s: a limit of 2^53+1 must be rejected as looser than 2^53: valid=%v %v", name, r.Valid, r.Errors)
		}
	}
}
