package dcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// Secondary SHA3-256 fields (spec/VERIFICATION.md V2-11 and its erratum of
// 27/10/2026), through the shared vectors tests/interop/v2/secondary_sha3_vectors.json:
// the verifier, admission and the experimental candidate verifier (v1 route).

type secondaryPart struct {
	AuditEntries json.RawMessage `json:"audit_entries"`
	Manifest     json.RawMessage `json:"manifest"`
	Signature    json.RawMessage `json:"signature"`
}

type secondaryCase struct {
	secondaryPart
	Name          string         `json:"name"`
	Group         string         `json:"group"`
	Expect        string         `json:"expect"`
	ErrorContains string         `json:"error_contains"`
	Control       *secondaryPart `json:"control"`
}

type secondaryVectors struct {
	VerificationTime string `json:"verification_time"`
	Base             struct {
		Artifacts     map[string]json.RawMessage `json:"artifacts"`
		PrincipalKeys []map[string]interface{}   `json:"principal_keys"`
	} `json:"base"`
	Cases []secondaryCase `json:"cases"`
}

func loadSecondaryVectors(t *testing.T) secondaryVectors {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "secondary_sha3_vectors.json"))
	if err != nil {
		t.Fatalf("read secondary vectors: %v", err)
	}
	var v secondaryVectors
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("parse secondary vectors: %v", err)
	}
	names, accept, reject, groups := map[string]bool{}, 0, 0, map[string]bool{}
	for _, c := range v.Cases {
		names[c.Name] = true
		groups[c.Group] = true
		switch c.Expect {
		case "accept":
			accept++
		case "reject":
			reject++
			if c.Control == nil || c.ErrorContains == "" {
				t.Fatalf("%s: a reject case needs a control and error_contains", c.Name)
			}
		default:
			t.Fatalf("%s: unknown expect %q", c.Name, c.Expect)
		}
	}
	if len(v.Cases) != 51 || len(names) != 51 || accept != 22 || reject != 29 {
		t.Fatalf("expected 51 unique cases (22 accept, 29 reject), got %d cases, %d names, %d accept, %d reject", len(v.Cases), len(names), accept, reject)
	}
	for _, g := range []string{"root", "chain", "intent", "mixed"} {
		if !groups[g] {
			t.Fatalf("no %s case", g)
		}
	}
	return v
}

func (v secondaryVectors) assemble(t *testing.T, p secondaryPart) []byte {
	t.Helper()
	bundle := map[string]json.RawMessage{
		"dcp_bundle_version": json.RawMessage(`"2.0"`),
		"manifest":           p.Manifest,
		"audit_entries":      p.AuditEntries,
	}
	for k, a := range v.Base.Artifacts {
		bundle[k] = a
	}
	out, err := json.Marshal(map[string]interface{}{"bundle": bundle, "signature": p.Signature})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestSecondarySHA3Vectors(t *testing.T) {
	vecs := loadSecondaryVectors(t)
	now, err := time.Parse(time.RFC3339, vecs.VerificationTime)
	if err != nil {
		t.Fatal(err)
	}
	reg := newRegistry()
	policy := v2.DefaultVerifierPolicy()

	keys := make([]map[string]interface{}, 0, len(vecs.Base.PrincipalKeys))
	for _, k := range vecs.Base.PrincipalKeys {
		keys = append(keys, map[string]interface{}{"kid": k["kid"], "alg": k["alg"], "public_key_b64": k["public_key_b64"], "status": "active"})
	}
	var rpr struct {
		Payload struct {
			HumanID string `json:"human_id"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(vecs.Base.Artifacts["responsible_principal_record"], &rpr); err != nil {
		t.Fatal(err)
	}
	trustJSON, _ := json.Marshal(map[string]interface{}{
		"trust_set_version": "2026-10-27.secondary",
		"principals":        []interface{}{map[string]interface{}{"human_id": rpr.Payload.HumanID, "keys": keys}},
	})
	trust, err := v2.NewPrincipalTrustStore(trustJSON)
	if err != nil {
		t.Fatalf("trust store: %v", err)
	}
	// The vectors name dcp-jcs-v1 in the manifest, so the router must accept it to take the v1 route.
	candidate, err := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{
		Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v1", "dcp-jcs-v2"}, Historical: "encoding_json",
	})
	if err != nil {
		t.Fatalf("candidate verifier: %v", err)
	}

	for _, c := range vecs.Cases {
		c := c
		t.Run(c.Name, func(t *testing.T) {
			signed := vecs.assemble(t, c.secondaryPart)
			r := v2.VerifySignedBundleV2At(reg, signed, policy, now)
			ok := c.Expect == "accept"
			if ok {
				if !r.Verified || len(r.Errors) != 0 {
					t.Fatalf("expected acceptance, got %v", r.Errors)
				}
			} else {
				if r.Verified {
					t.Fatalf("expected rejection naming %q", c.ErrorContains)
				}
				found := false
				for _, e := range r.Errors {
					found = found || strings.Contains(e, c.ErrorContains)
					if !strings.Contains(e, "secondary") {
						t.Fatalf("unexpected error besides the secondary defect: %q (all: %v)", e, r.Errors)
					}
				}
				if !found {
					t.Fatalf("no error names %q: %v", c.ErrorContains, r.Errors)
				}
				if ctl := v2.VerifySignedBundleV2At(reg, vecs.assemble(t, *c.Control), policy, now); !ctl.Verified || len(ctl.Errors) != 0 {
					t.Fatalf("control rejected: %v", ctl.Errors)
				}
			}

			adm, err := v2.AdmitSignedBundleV2(reg, signed, v2.AdmitOptions{Trust: trust, Now: now})
			if err != nil {
				t.Fatalf("admission: %v", err)
			}
			if adm.Verified != ok || adm.Admitted != ok || adm.ActionAuthorized {
				t.Fatalf("admission verified=%v admitted=%v action_authorized=%v, expected %v and false", adm.Verified, adm.Admitted, adm.ActionAuthorized, ok)
			}
			routed, err := candidate.VerifyAt(reg, signed, policy, now)
			if err != nil {
				t.Fatalf("candidate verify: %v", err)
			}
			if routed.Entered != "dcp-jcs-v1" || routed.Verification == nil || routed.Verification.Verified != ok {
				t.Fatalf("candidate route entered %q, verified %v, expected %v", routed.Entered, routed.Verification != nil && routed.Verification.Verified, ok)
			}
		})
	}
}
