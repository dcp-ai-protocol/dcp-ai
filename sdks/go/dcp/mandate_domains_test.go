package dcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type domainCase struct {
	Name              string                   `json:"name"`
	Chain             []map[string]interface{} `json:"chain"`
	RevokedMandateIDs []string                 `json:"revoked_mandate_ids"`
	Expected          *struct {
		Depth         int     `json:"depth"`
		EffectiveTier *string `json:"effective_tier"`
	} `json:"expected"`
	Errors []string `json:"errors"`
}

// mandate_domain_vectors.json (DCP-09 §3.5.2 rule 5): a domain that appears
// twice in one mandate, at every depth, the root included, with domains
// compared as exact strings, on real signatures. The verdicts are the
// protocol's; the exact error lists are this SDK's diagnostics, checked as a
// regression.
func TestMandateDomainVectors(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "mandate_domain_vectors.json"))
	if err != nil {
		t.Fatalf("read mandate domain vectors: %v", err)
	}
	var v struct {
		VerificationTime string              `json:"verification_time"`
		Keys             v2.MandateChainKeys `json:"keys"`
		MustAccept       []domainCase        `json:"must_accept"`
		MustReject       []domainCase        `json:"must_reject"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("parse mandate domain vectors: %v", err)
	}
	if len(v.MustAccept) != 8 || len(v.MustReject) != 15 {
		t.Fatalf("%d must_accept and %d must_reject, want 8 and 15", len(v.MustAccept), len(v.MustReject))
	}
	now, err := time.Parse(time.RFC3339, v.VerificationTime)
	if err != nil {
		t.Fatalf("verification time: %v", err)
	}
	reg := newRegistry()
	seen := map[string]bool{}
	for _, c := range append(append([]domainCase{}, v.MustAccept...), v.MustReject...) {
		if seen[c.Name] {
			t.Fatalf("duplicate case name %s", c.Name)
		}
		seen[c.Name] = true
	}
	for _, c := range v.MustAccept {
		r := v2.VerifyMandateChain(reg, c.Chain, revokedSet(c.RevokedMandateIDs), v.Keys, now)
		if !r.Valid || len(r.Errors) != 0 || r.Depth != c.Expected.Depth || (r.EffectiveTier != "") != (c.Expected.EffectiveTier != nil) {
			t.Errorf("%s: %+v", c.Name, r)
		}
	}
	for _, c := range v.MustReject {
		r := v2.VerifyMandateChain(reg, c.Chain, revokedSet(c.RevokedMandateIDs), v.Keys, now)
		if r.Valid || !reflect.DeepEqual(r.Errors, c.Errors) || r.Depth != 0 || r.EffectiveTier != "" {
			t.Errorf("%s: want errors %q, got %+v", c.Name, c.Errors, r)
		}
	}
}
