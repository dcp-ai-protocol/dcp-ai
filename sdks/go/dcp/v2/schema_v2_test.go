package v2_test

// V2-2 in front of the public Go verifiers: VerifySignedBundleV2, VerifySignedBundleV2WithPolicy,
// VerifySignedBundleV2At, AdmitSignedBundleV2 and the experimental candidate verifier, over the signed cases of
// tests/interop/v2/schema_validation/, with the deeper checks the historical rows used to reach kept covered
// (regression_map.json, deep_negatives.json). Counting providers show where a rejection happens.

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// countingProvider counts the signature operations of a real provider.
type countingProvider struct {
	v2.CryptoProvider
	calls *atomic.Int64
}

func (c countingProvider) Verify(message, signature []byte, publicKeyB64 string) (bool, error) {
	c.calls.Add(1)
	return c.CryptoProvider.Verify(message, signature, publicKeyB64)
}

func (c countingProvider) Sign(message []byte, secretKeyB64 string) ([]byte, error) {
	c.calls.Add(1)
	return c.CryptoProvider.Sign(message, secretKeyB64)
}

func countingRegistry() (*v2.AlgorithmRegistry, *atomic.Int64) {
	calls := &atomic.Int64{}
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(countingProvider{&providers.Ed25519Provider{}, calls})
	reg.RegisterSigner(countingProvider{&providers.MlDsa65Provider{}, calls})
	return reg, calls
}

func schemaFile(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "interop", "v2", "schema_validation", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

type wiringCase struct {
	Name   string `json:"name"`
	Expect struct {
		Verified bool `json:"verified"`
	} `json:"expect"`
	Target *struct {
		Instance string `json:"instance"`
		Keyword  string `json:"keyword"`
	} `json:"target"`
	SignedBundle     json.RawMessage `json:"signed_bundle"`
	SignedBundleText *string         `json:"signed_bundle_text"`
}

type wiringCases struct {
	VerificationTime string          `json:"verification_time"`
	VerifierPolicy   json.RawMessage `json:"verifier_policy"`
	Cases            []wiringCase    `json:"cases"`
}

func loadWiring(t *testing.T) (wiringCases, v2.VerifierPolicy, time.Time) {
	t.Helper()
	var w wiringCases
	if err := json.Unmarshal(schemaFile(t, "wiring_cases.json"), &w); err != nil {
		t.Fatal(err)
	}
	var policy v2.VerifierPolicy
	dec := json.NewDecoder(bytes.NewReader(w.VerifierPolicy))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&policy); err != nil {
		t.Fatal(err)
	}
	return w, policy, mustInstant(t, w.VerificationTime)
}

// bytes of the case as signed: the text when the case has one, else its JSON as written.
func (c wiringCase) data() []byte {
	if c.SignedBundleText != nil {
		return []byte(*c.SignedBundleText)
	}
	return append([]byte(nil), c.SignedBundle...)
}

func (c wiringCase) target() string {
	instance := c.Target.Instance
	if instance == "" {
		instance = "/"
	}
	return "schema: " + instance + " " + c.Target.Keyword
}

// expectV22Only: rejected by V2-2 alone, the target among the errors, the established result shape and no signer.
func expectV22Only(t *testing.T, label string, r *v2.V2VerificationResult, target string) {
	t.Helper()
	found := false
	for _, e := range r.Errors {
		if !strings.HasPrefix(e, "schema: ") {
			t.Errorf("%s: %q is not a V2-2 error: %q", label, e, r.Errors)
		}
		found = found || e == target || strings.HasPrefix(e, target+" ")
	}
	if r.Verified || !found || r.DCPVersion != "2.0" || r.Warnings == nil || len(r.Warnings) != 0 ||
		r.SignerKeys == nil || len(r.SignerKeys) != 0 || r.ClassicalValid || r.PQValid || r.SessionBindingValid || r.ManifestValid {
		t.Errorf("%s: %+v, want a V2-2 rejection naming %s", label, r, target)
	}
}

func TestSchemaThe57SignedCasesThroughThePublicAPIsNegativesBeforeAnyProvider(t *testing.T) {
	w, policy, now := loadWiring(t)
	if len(w.Cases) != 57 {
		t.Fatalf("%d cases", len(w.Cases))
	}
	candidate, err := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v1"}, Historical: "encoding_json"})
	if err != nil {
		t.Fatal(err)
	}
	positives, negatives := 0, 0
	for _, c := range w.Cases {
		data := c.data()
		frozen := append([]byte(nil), data...)
		reg, calls := countingRegistry()
		r := v2.VerifySignedBundleV2At(reg, data, policy, now)
		if c.Expect.Verified {
			positives++
			if !r.Verified || len(r.Errors) != 0 || calls.Load() == 0 {
				t.Errorf("%s: %v (provider calls %d)", c.Name, r.Errors, calls.Load())
			}
		} else {
			negatives++
			expectV22Only(t, c.Name+" At", r, c.target())
			// The same through the other public entry points; none reaches a provider.
			expectV22Only(t, c.Name+" WithPolicy", v2.VerifySignedBundleV2WithPolicy(reg, data, policy), c.target())
			expectV22Only(t, c.Name+" default", v2.VerifySignedBundleV2(reg, data), c.target())
			adm, err := v2.AdmitSignedBundleV2(reg, data, v2.AdmitOptions{Now: now})
			if err != nil || adm.Verified || adm.Admitted || adm.ActionAuthorized || adm.PrincipalTrust != "not_evaluated" {
				t.Errorf("%s admission: %v %+v", c.Name, err, adm)
			} else {
				expectV22Only(t, c.Name+" admission", adm.Verification, c.target())
			}
			routed, err := candidate.VerifyAt(reg, data, policy, now)
			if err != nil || routed.Entered != "dcp-jcs-v1" || routed.Verification == nil {
				t.Errorf("%s candidate: %v %+v", c.Name, err, routed)
			} else {
				expectV22Only(t, c.Name+" candidate", routed.Verification, c.target())
			}
			if calls.Load() != 0 {
				t.Errorf("%s: %d provider calls before V2-2 refused it", c.Name, calls.Load())
			}
		}
		if !bytes.Equal(data, frozen) {
			t.Errorf("%s: the input bytes were written", c.Name)
		}
	}
	if positives != 13 || negatives != 44 {
		t.Fatalf("%d positives, %d negatives", positives, negatives)
	}
}

func TestSchemaC4NullSessionTimesFailTheSchema(t *testing.T) {
	w, policy, now := loadWiring(t)
	for _, name := range []string{"c4_session_expires_at_null", "c4_session_issued_at_null"} {
		for _, c := range w.Cases {
			if c.Name != name {
				continue
			}
			reg, _ := countingRegistry()
			if r := v2.VerifySignedBundleV2At(reg, c.data(), policy, now); !reflect.DeepEqual(r.Errors, []string{"schema: " + c.Target.Instance + " type"}) {
				t.Errorf("%s: %v", name, r.Errors)
			}
		}
	}
}

// The policy contract and the parser contract come before V2-2, as they did.
func TestSchemaThePolicyAndParserContractsAreKeptBeforeV22(t *testing.T) {
	reg, calls := countingRegistry()
	policy := v2.DefaultVerifierPolicy()
	policy.MinClassical = 5 // a field this verifier does not enforce
	if r := v2.VerifySignedBundleV2WithPolicy(reg, []byte(`{}`), policy); len(r.Errors) != 1 || !strings.Contains(r.Errors[0], "does not enforce") {
		t.Errorf("policy: %v", r.Errors)
	}
	for _, in := range []string{`not json`, `{"bundle":`, `[]`, `"signed"`, `7`, `true`, `{"signature":{},"bundle":{"x":1e400}}`} {
		if r := v2.VerifySignedBundleV2(reg, []byte(in)); len(r.Errors) != 1 || !strings.HasPrefix(r.Errors[0], "JSON parse error: ") {
			t.Errorf("%s: %v", in, r.Errors)
		}
	}
	// A null root decodes to nothing in the historical map: V2-2 validates it as null.
	if r := v2.VerifySignedBundleV2(reg, []byte(`null`)); !reflect.DeepEqual(r.Errors, []string{"schema: / type"}) {
		t.Errorf("null: %v", r.Errors)
	}
	if calls.Load() != 0 {
		t.Errorf("%d provider calls", calls.Load())
	}
}

func TestSchemaCombinedAdmissionPositiveSchemaNegativeAndTrust(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	profile, err := v2.ResolveStrictV1Profile(vecs.Profiles["strict"])
	if err != nil {
		t.Fatal(err)
	}
	trust, err := v2.NewPrincipalTrustStore(vecs.TrustSets["principal"])
	if err != nil {
		t.Fatal(err)
	}
	empty, err := v2.NewPrincipalTrustStore([]byte(`{"trust_set_version":"v","principals":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	var opts v2.AdmitOptions
	for _, c := range vecs.Cases {
		if c.Name == "A_known_principal_strict" {
			opts = v2.AdmitOptions{Profile: profile, Trust: trust, Revocation: c.Revocation, Now: mustInstant(t, c.Now)}
		}
	}
	base := vecs.SignedBundles["base"]
	reg, _ := countingRegistry()
	ok, err := v2.AdmitSignedBundleV2(reg, base, opts)
	if err != nil || !ok.Verified || !ok.Admitted || ok.PrincipalTrust != "trusted" || ok.ActionAuthorized {
		t.Fatalf("positive: %v %+v", err, ok)
	}
	bad := append([]byte(`{"x_ext":1,`), bytes.TrimSpace(base)[1:]...)
	for name, o := range map[string]v2.AdmitOptions{"strict": opts, "empty trust": {Trust: empty, Now: opts.Now}, "no trust": {Now: opts.Now}} {
		reg, calls := countingRegistry()
		r, err := v2.AdmitSignedBundleV2(reg, bad, o)
		if err != nil || r.Verified || r.Admitted || r.PrincipalTrust != "not_evaluated" || r.RecordedDecision != nil || calls.Load() != 0 {
			t.Errorf("%s negative: %v %+v (provider calls %d)", name, err, r, calls.Load())
		} else if !reflect.DeepEqual(r.Verification.Errors, []string{"schema: / additionalProperties x_ext"}) {
			t.Errorf("%s negative: %v", name, r.Verification.Errors)
		}
	}
	// An explicit empty trust set trusts nobody; without one, trust is not evaluated and the verified bundle is
	// admitted (both as before V2-2).
	if r, err := v2.AdmitSignedBundleV2(reg, base, v2.AdmitOptions{Trust: empty, Now: opts.Now}); err != nil || !r.Verified || r.Admitted || r.PrincipalTrust != "untrusted" {
		t.Errorf("empty trust: %v %+v", err, r)
	}
	if r, err := v2.AdmitSignedBundleV2(reg, base, v2.AdmitOptions{Now: opts.Now}); err != nil || !r.Verified || !r.Admitted || r.PrincipalTrust != "not_evaluated" {
		t.Errorf("no trust: %v %+v", err, r)
	}
}

func TestSchemaCandidatePositiveSchemaNegativeNoOptInAndDefaultSeparation(t *testing.T) {
	v := p3Load(t)
	now := time.UnixMilli(v.NowMs)
	policy := v2.DefaultVerifierPolicy()
	text := []byte(v.Bases["B-v2"].InputJSON)
	optIn, err := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v2"}, Historical: "encoding_json"})
	if err != nil {
		t.Fatal(err)
	}
	reg, _ := countingRegistry()
	ok, err := optIn.VerifyAt(reg, text, policy, now)
	if err != nil || ok.Entered != "dcp-jcs-v2" || ok.Verification == nil || !ok.Verification.Verified {
		t.Fatalf("candidate positive: %v %+v", err, ok)
	}
	reg, calls := countingRegistry()
	bad, err := optIn.VerifyAt(reg, append([]byte(`{"x_ext":1,`), bytes.TrimSpace(text)[1:]...), policy, now)
	if err != nil || bad.Entered != "dcp-jcs-v2" || bad.Verification == nil || calls.Load() != 0 {
		t.Fatalf("candidate negative: %v %+v", err, bad)
	}
	expectV22Only(t, "candidate negative", bad.Verification, "schema: / additionalProperties x_ext")
	// No opt-in: the public verifier refuses the candidate identifier by V2-2 (const dcp-jcs-v1).
	if r := v2.VerifySignedBundleV2At(reg, text, policy, now); !reflect.DeepEqual(r.Errors, []string{"schema: /bundle/manifest/canonicalization_profile const"}) {
		t.Errorf("today's API: %v", r.Errors)
	}
	// Default separation: a v1-only verifier does not take the candidate, and a candidate-only one not dcp-jcs-v1.
	v1only, _ := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v1"}, Historical: "encoding_json"})
	if r, err := v1only.VerifyAt(reg, text, policy, now); err != nil || r.Entered != "none" || r.Route.Outcome != "reject" || r.Verification != nil {
		t.Errorf("v1-only on the candidate: %v %+v", err, r)
	}
	w, wpolicy, wnow := loadWiring(t)
	if r, err := optIn.VerifyAt(reg, w.Cases[0].data(), wpolicy, wnow); err != nil || r.Entered != "none" || r.Route.Class != "PROFILE_NOT_ACCEPTED" {
		t.Errorf("candidate-only on dcp-jcs-v1: %v %+v", err, r)
	}
	if r, err := v1only.VerifyAt(reg, w.Cases[0].data(), wpolicy, wnow); err != nil || r.Entered != "dcp-jcs-v1" || !r.Verification.Verified {
		t.Errorf("v1-only on dcp-jcs-v1: %v %+v", err, r)
	}
}

// The regression rows: each historical document fails V2-2 alone, and the rows that keep its deeper check covered
// pass it (dcp/interop_test.go and dcp/secondary_sha3_test.go assert their exact errors).
func TestSchemaThe56RegressionRowsAndTheirCoverage(t *testing.T) {
	var m struct {
		Rows []struct {
			Fixture      string `json:"fixture"`
			Name         string `json:"name"`
			DeepCoverage struct {
				Kind    string   `json:"kind"`
				Fixture string   `json:"fixture"`
				Rows    []string `json:"rows"`
				Cases   []string `json:"cases"`
				Also    *struct {
					Kind    string   `json:"kind"`
					Fixture string   `json:"fixture"`
					Rows    []string `json:"rows"`
				} `json:"also"`
			} `json:"deep_coverage"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(schemaFile(t, "regression_map.json"), &m); err != nil {
		t.Fatal(err)
	}
	var deep struct {
		Cases []struct {
			Name string `json:"name"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(schemaFile(t, "deep_negatives.json"), &deep); err != nil {
		t.Fatal(err)
	}
	docs := historicalDocs(t)
	reg := v2.NewAlgorithmRegistry() // no provider: a schema-valid document fails later, never at V2-2
	v22 := func(name string) (onlySchema, anySchema bool) {
		doc, ok := docs[name]
		if !ok {
			t.Fatalf("no historical row %s", name)
		}
		r := v2.VerifySignedBundleV2At(reg, doc, v2.DefaultVerifierPolicy(), time.UnixMilli(0))
		onlySchema = len(r.Errors) > 0
		for _, e := range r.Errors {
			s := strings.HasPrefix(e, "schema: ")
			onlySchema, anySchema = onlySchema && s, anySchema || s
		}
		return onlySchema, anySchema
	}
	counts := map[string]int{}
	for _, r := range m.Rows {
		counts[filepath.Base(r.Fixture)]++
		if only, _ := v22(filepath.Base(r.Fixture) + ":" + r.Name); !only {
			t.Errorf("%s: not refused by V2-2 alone", r.Name)
		}
		cov := r.DeepCoverage
		groups := [][]string{}
		fixtures := []string{}
		if cov.Kind == "schema_valid_rows" {
			groups, fixtures = append(groups, cov.Rows), append(fixtures, cov.Fixture)
		}
		if cov.Also != nil && cov.Also.Kind == "schema_valid_rows" {
			groups, fixtures = append(groups, cov.Also.Rows), append(fixtures, cov.Also.Fixture)
		}
		for i, rows := range groups {
			for _, n := range rows {
				if _, any := v22(filepath.Base(fixtures[i]) + ":" + n); any {
					t.Errorf("%s: coverage row %s is not schema-valid", r.Name, n)
				}
			}
		}
		switch cov.Kind {
		case "schema_valid_rows", "helper", "structural":
		case "deep_negatives":
			for _, n := range cov.Cases {
				found := false
				for _, d := range deep.Cases {
					found = found || d.Name == n
				}
				if !found {
					t.Errorf("%s: no deep negative %s", r.Name, n)
				}
			}
		default:
			t.Errorf("%s: coverage %s", r.Name, cov.Kind)
		}
	}
	if counts["bundle_vectors.json"] != 43 || counts["secondary_sha3_vectors.json"] != 13 {
		t.Errorf("rows %v", counts)
	}
}

// historicalDocs are the historical reject documents by "<fixture>:<name>" (bundle_vectors.json rows and the
// secondary_sha3_vectors.json cases), as the regression map reads them.
func historicalDocs(t *testing.T) map[string][]byte {
	t.Helper()
	read := func(name string) []byte {
		data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "interop", "v2", name))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	var b struct {
		SignedBundle json.RawMessage `json:"signed_bundle"`
		MustReject   []struct {
			Name      string `json:"name"`
			Mutations []struct {
				Path  []string `json:"path"`
				Value any      `json:"value"`
			} `json:"mutations"`
		} `json:"must_reject"`
		Bundles []struct {
			Name         string          `json:"name"`
			SignedBundle json.RawMessage `json:"signed_bundle"`
		} `json:"must_reject_bundles"`
		Accept []struct {
			Name         string          `json:"name"`
			SignedBundle json.RawMessage `json:"signed_bundle"`
		} `json:"must_accept_bundles"`
	}
	if err := json.Unmarshal(read("bundle_vectors.json"), &b); err != nil {
		t.Fatal(err)
	}
	out := map[string][]byte{}
	for _, m := range b.MustReject {
		var d map[string]any
		_ = json.Unmarshal(b.SignedBundle, &d)
		for _, mut := range m.Mutations {
			node := d
			for _, k := range mut.Path[:len(mut.Path)-1] {
				node = node[k].(map[string]any)
			}
			node[mut.Path[len(mut.Path)-1]] = mut.Value
		}
		out["bundle_vectors.json:"+m.Name], _ = json.Marshal(d)
	}
	for _, x := range append(b.Bundles, b.Accept...) {
		out["bundle_vectors.json:"+x.Name] = x.SignedBundle
	}
	var s struct {
		Base struct {
			Artifacts map[string]json.RawMessage `json:"artifacts"`
		} `json:"base"`
		Cases []struct {
			Name         string          `json:"name"`
			Manifest     json.RawMessage `json:"manifest"`
			AuditEntries json.RawMessage `json:"audit_entries"`
			Signature    json.RawMessage `json:"signature"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(read("secondary_sha3_vectors.json"), &s); err != nil {
		t.Fatal(err)
	}
	for _, c := range s.Cases {
		bundle := map[string]json.RawMessage{"dcp_bundle_version": json.RawMessage(`"2.0"`), "manifest": c.Manifest, "audit_entries": c.AuditEntries}
		for k, v := range s.Base.Artifacts {
			bundle[k] = v
		}
		out["secondary_sha3_vectors.json:"+c.Name], _ = json.Marshal(map[string]any{"bundle": bundle, "signature": c.Signature})
	}
	return out
}

// Schema-valid signed negatives that reach the checks the historical rows reached with schema-invalid input: the
// temporal parsers of V2-4, V2-13 and V2-14 and the canonicalization of a fraction in an open, committed member.
func TestSchemaTheDeepNegativesReachTheTemporalParsersAndTheCanonicalizerPastV22(t *testing.T) {
	var d struct {
		VerificationTime string          `json:"verification_time"`
		VerifierPolicy   json.RawMessage `json:"verifier_policy"`
		Cases            []struct {
			Name               string            `json:"name"`
			ErrorContainsBySDK map[string]string `json:"error_contains_by_sdk"`
			SignedBundle       json.RawMessage   `json:"signed_bundle"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(schemaFile(t, "deep_negatives.json"), &d); err != nil {
		t.Fatal(err)
	}
	var policy v2.VerifierPolicy
	if err := json.Unmarshal(d.VerifierPolicy, &policy); err != nil {
		t.Fatal(err)
	}
	if len(d.Cases) != 7 {
		t.Fatalf("%d cases", len(d.Cases))
	}
	for _, c := range d.Cases {
		reg, _ := countingRegistry()
		r := v2.VerifySignedBundleV2At(reg, c.SignedBundle, policy, mustInstant(t, d.VerificationTime))
		want, ok := c.ErrorContainsBySDK["go"]
		if !ok {
			t.Errorf("%s: no go wording for %q", c.Name, r.Errors)
		}
		text := strings.Join(r.Errors, "\n")
		if r.Verified || strings.Contains(text, "schema: ") || !strings.Contains(strings.ToLower(text), strings.ToLower(want)) {
			t.Errorf("%s: %v, want past V2-2 with %q", c.Name, r.Errors, want)
		}
	}
}
