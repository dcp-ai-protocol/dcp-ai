package v2_test

// Admission (spec/profiles/admission): the shared vectors in
// tests/interop/v2/admission_vectors.json, through the public API, and what
// the vectors cannot express.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type admissionExpected struct {
	Verified          bool     `json:"verified"`
	PrincipalTrust    string   `json:"principal_trust"`
	ProfileCompliance string   `json:"profile_compliance"`
	Admitted          bool     `json:"admitted"`
	RecordedDecision  *string  `json:"recorded_decision"`
	ActionAuthorized  bool     `json:"action_authorized"`
	Codes             []string `json:"codes"`
}

type admissionVectors struct {
	VerifierID    string                     `json:"verifier_id"`
	SignedBundles map[string]json.RawMessage `json:"signed_bundles"`
	TrustSets     map[string]json.RawMessage `json:"trust_sets"`
	Profiles      map[string]json.RawMessage `json:"profiles"`
	Cases         []struct {
		Name       string            `json:"name"`
		Rule       string            `json:"rule"`
		Bundle     string            `json:"bundle"`
		Now        string            `json:"now"`
		Profile    *string           `json:"profile"`
		Trust      *string           `json:"trust"`
		Revocation json.RawMessage   `json:"revocation"`
		Expected   admissionExpected `json:"expected"`
	} `json:"cases"`
	ConfigCases []struct {
		Name         string          `json:"name"`
		Rule         string          `json:"rule"`
		Kind         string          `json:"kind"`
		Config       json.RawMessage `json:"config"`
		ExpectedCode string          `json:"expected_code"`
	} `json:"config_cases"`
	AcceptedProfiles []struct {
		Name                              string          `json:"name"`
		Config                            json.RawMessage `json:"config"`
		ExpectedMaxSessionDurationSeconds int             `json:"expected_max_session_duration_seconds"`
		ExpectedMaxRevocationAgeSeconds   int             `json:"expected_max_revocation_age_seconds"`
	} `json:"accepted_profiles"`
}

func loadAdmissionVectors(t *testing.T) *admissionVectors {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "interop", "v2", "admission_vectors.json"))
	if err != nil {
		t.Fatalf("read admission vectors: %v", err)
	}
	var vecs admissionVectors
	if err := json.Unmarshal(data, &vecs); err != nil {
		t.Fatalf("parse admission vectors: %v", err)
	}
	if len(vecs.Cases) == 0 || len(vecs.ConfigCases) == 0 || len(vecs.AcceptedProfiles) == 0 {
		t.Fatal("admission vectors are empty")
	}
	return &vecs
}

func admissionRegistry() *v2.AlgorithmRegistry {
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	return reg
}

func mustInstant(t *testing.T, s string) time.Time {
	t.Helper()
	at, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return at
}

func configCode(err error) string {
	var ce *v2.AdmissionConfigError
	if errors.As(err, &ce) {
		return ce.Code
	}
	return ""
}

func uniqueSortedCodes(errs []v2.AdmissionError) []string {
	codes := []string{}
	for _, e := range errs {
		if !slices.Contains(codes, e.Code) {
			codes = append(codes, e.Code)
		}
	}
	sort.Strings(codes)
	return codes
}

func TestAdmissionVectors(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()

	// Profiles and trust stores are loaded once and shared by the parallel
	// cases: they are read-only once loaded.
	profiles := map[string]*v2.StrictV1Profile{}
	for name, raw := range vecs.Profiles {
		p, err := v2.ResolveStrictV1Profile(raw)
		if err != nil {
			t.Fatalf("profile %s: %v", name, err)
		}
		profiles[name] = p
	}
	stores := map[string]*v2.PrincipalTrustStore{}
	for name, raw := range vecs.TrustSets {
		s, err := v2.NewPrincipalTrustStore(raw)
		if err != nil {
			t.Fatalf("trust set %s: %v", name, err)
		}
		stores[name] = s
	}

	for _, c := range vecs.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			opts := v2.AdmitOptions{Revocation: c.Revocation, Now: mustInstant(t, c.Now)}
			if c.Profile != nil {
				opts.Profile = profiles[*c.Profile]
			}
			if c.Trust != nil {
				opts.Trust = stores[*c.Trust]
			}
			r, err := v2.AdmitSignedBundleV2(reg, vecs.SignedBundles[c.Bundle], opts)
			if err != nil {
				t.Fatalf("%s: %v", c.Rule, err)
			}
			got := admissionExpected{
				Verified:          r.Verified,
				PrincipalTrust:    r.PrincipalTrust,
				ProfileCompliance: r.ProfileCompliance,
				Admitted:          r.Admitted,
				RecordedDecision:  r.RecordedDecision,
				ActionAuthorized:  r.ActionAuthorized,
				Codes:             uniqueSortedCodes(r.Errors),
			}
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(c.Expected)
			if string(gotJSON) != string(wantJSON) {
				t.Errorf("%s:\n got  %s\n want %s\n errors %+v", c.Rule, gotJSON, wantJSON, r.Errors)
			}
			if (r.Profile != nil) != (c.Profile != nil) || (r.Profile != nil && *r.Profile != v2.StrictV1) {
				t.Errorf("profile = %v, want strict-v1 iff a profile is given", r.Profile)
			}
			switch {
			case c.Trust == nil && r.TrustSetVersion != nil:
				t.Errorf("trust_set_version = %q without a trust set", *r.TrustSetVersion)
			case c.Trust != nil && (r.TrustSetVersion == nil || *r.TrustSetVersion != stores[*c.Trust].Version()):
				t.Errorf("trust_set_version = %v, want %q", r.TrustSetVersion, stores[*c.Trust].Version())
			}
		})
	}
}

func TestAdmissionConfigVectors(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	for _, c := range vecs.ConfigCases {
		t.Run(c.Kind+"/"+c.Name, func(t *testing.T) {
			var err error
			switch c.Kind {
			case "trust_set":
				_, err = v2.NewPrincipalTrustStore(c.Config)
			case "profile":
				_, err = v2.ResolveStrictV1Profile(c.Config)
			default:
				t.Fatalf("unknown kind %q", c.Kind)
			}
			if code := configCode(err); code != c.ExpectedCode {
				t.Errorf("%s: got %v, want %s", c.Rule, err, c.ExpectedCode)
			}
			if err != nil && !strings.HasPrefix(err.Error(), c.ExpectedCode+": ") {
				t.Errorf("Error() = %q, want the %s: prefix", err.Error(), c.ExpectedCode)
			}
		})
	}
}

func TestAdmissionAcceptedProfiles(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()
	now := mustInstant(t, "2026-11-02T10:01:00.000Z")
	for _, c := range vecs.AcceptedProfiles {
		t.Run(c.Name, func(t *testing.T) {
			p, err := v2.ResolveStrictV1Profile(c.Config)
			if err != nil {
				t.Fatal(err)
			}
			if p.MaxSessionDurationSeconds() != c.ExpectedMaxSessionDurationSeconds ||
				p.MaxRevocationAgeSeconds() != c.ExpectedMaxRevocationAgeSeconds ||
				p.VerifierPolicy().MaxSessionDurationSeconds != c.ExpectedMaxSessionDurationSeconds {
				t.Errorf("limits %d/%d (policy %d), want %d/%d", p.MaxSessionDurationSeconds(), p.MaxRevocationAgeSeconds(),
					p.VerifierPolicy().MaxSessionDurationSeconds, c.ExpectedMaxSessionDurationSeconds, c.ExpectedMaxRevocationAgeSeconds)
			}
			// The verifier enforces every field of the profile's policy rather
			// than failing closed on it.
			r := v2.VerifySignedBundleV2At(reg, vecs.SignedBundles["base"], p.VerifierPolicy(), now)
			if strings.Contains(strings.Join(r.Errors, "\n"), "does not enforce") {
				t.Errorf("the verifier refuses the profile's policy: %v", r.Errors)
			}
		})
	}
}

// An integer is a JSON number with an integer value, read as JSON.parse reads
// it; verifier_policy fields are checked in the order JSON.parse gives them
// (array indices first), so the first problem is the reference's.
func TestAdmissionProfileNumbersAndFieldOrder(t *testing.T) {
	profile := func(extra string) string {
		return `{"profile":"strict-v1","verifier_id":"verifier:acme-api"` + extra + `}`
	}
	for _, c := range []struct {
		config      string
		wantCode    string
		wantSession int
	}{
		{profile(`,"max_session_duration_seconds":1e2`), "", 100},
		{profile(`,"max_session_duration_seconds":300.0`), "", 300},
		{profile(`,"max_session_duration_seconds":2.0e1,"verifier_policy":{"max_session_duration_seconds":1.5e1}`), "", 15},
		{profile(`,"max_session_duration_seconds":120.5`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"max_session_duration_seconds":1e400`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"max_session_duration_seconds":-0`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"max_session_duration_seconds":1e-400`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"max_revocation_age_seconds":"300"`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"max_session_duration_seconds":null`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"verifier_policy":{"min_pq":-1}`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"verifier_policy":{"min_pq":"1"}`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"verifier_policy":{"min_classical":1.0,"min_pq":1e0,"max_key_age_days":365}`), "", 300},
		{profile(`,"verifier_policy":{"max_key_age_days":0}`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"verifier_policy":{"accepted_hash_algs":["sha384","sha256"]}`), "", 300},
		{profile(`,"verifier_policy":{"accepted_hash_algs":["sha256","sha256"]}`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"verifier_policy":{"accepted_hash_algs":["sha256","sha384","sha256"]}`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"verifier_policy":{"accepted_hash_algs":"sha256"}`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"verifier_policy":{"max_key_age_days":0.5}`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"verifier_policy":null`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"verifier_id":null`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"verifier_policy":{"default_mode":"pq_only","fail_open":true}`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"verifier_policy":{"fail_open":true,"default_mode":"pq_only"}`), "CONFIG_UNKNOWN_FIELD", 0},
		{profile(`,"verifier_policy":{"default_mode":"pq_only","7":true}`), "CONFIG_UNKNOWN_FIELD", 0},
		{profile(`,"verifier_policy":{"risk_overrides":{"low":"pq_only","medium":"none"}}`), "CONFIG_PROFILE_CONTRADICTION", 0},
		{profile(`,"verifier_policy":{"risk_overrides":{"medium":"none","low":"pq_only"}}`), "CONFIG_INVALID_VALUE", 0},
		{profile(`,"verifier_policy":{"risk_overrides":{"medium":"none","critical":"hybrid_required"}}`), "CONFIG_UNKNOWN_FIELD", 0},
		{`{"profile":"strict-v1"`, "CONFIG_INVALID_VALUE", 0},
		{profile(``) + `{}`, "CONFIG_INVALID_VALUE", 0},
		{`["strict-v1"]`, "CONFIG_INVALID_VALUE", 0},
	} {
		p, err := v2.ResolveStrictV1Profile([]byte(c.config))
		if code := configCode(err); code != c.wantCode {
			t.Errorf("%s: got %v, want %q", c.config, err, c.wantCode)
		} else if err == nil && p.MaxSessionDurationSeconds() != c.wantSession {
			t.Errorf("%s: max session %d, want %d", c.config, p.MaxSessionDurationSeconds(), c.wantSession)
		}
	}
	for _, config := range []string{`{"trust_set_version":"v","principals":[]`, `null`, `{"trust_set_version":"v","principals":{}}`} {
		if _, err := v2.NewPrincipalTrustStore([]byte(config)); configCode(err) != "CONFIG_INVALID_VALUE" {
			t.Errorf("%s: %v", config, err)
		}
	}
	if s, err := v2.NewPrincipalTrustStore([]byte(`{"trust_set_version":"v","principals":[]}`)); err != nil || s.Version() != "v" {
		t.Errorf("a trust set with no principals is valid: %v", err)
	}
}

func TestAdmissionSignerKeys(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()
	now := mustInstant(t, "2026-11-02T10:01:00.000Z")
	r := v2.VerifySignedBundleV2At(reg, vecs.SignedBundles["base"], v2.DefaultVerifierPolicy(), now)
	if !r.Verified {
		t.Fatalf("base must verify at %s: %v", now, r.Errors)
	}
	var sb struct {
		Bundle struct {
			RPR struct {
				Payload struct {
					BindingKeys []struct {
						Kid          string `json:"kid"`
						Alg          string `json:"alg"`
						PublicKeyB64 string `json:"public_key_b64"`
					} `json:"binding_keys"`
				} `json:"payload"`
			} `json:"responsible_principal_record"`
		} `json:"bundle"`
	}
	if err := json.Unmarshal(vecs.SignedBundles["base"], &sb); err != nil {
		t.Fatal(err)
	}
	rpr := sb.Bundle.RPR.Payload.BindingKeys
	for _, signature := range []string{"bundle", "responsible_principal_record"} {
		var got []v2.SignerKeyUse
		for _, k := range r.SignerKeys {
			if k.Signature == signature {
				got = append(got, k)
			}
		}
		want := []v2.SignerKeyUse{
			{Signature: signature, Component: "classical", Kid: rpr[0].Kid, Alg: rpr[0].Alg, PublicKeyB64: rpr[0].PublicKeyB64, Verified: true},
			{Signature: signature, Component: "pq", Kid: rpr[1].Kid, Alg: rpr[1].Alg, PublicKeyB64: rpr[1].PublicKeyB64, Verified: true},
		}
		if !slices.Equal(got, want) {
			t.Errorf("%s signer keys = %+v, want %+v", signature, got, want)
		}
	}
	var signatures []string
	for _, k := range r.SignerKeys {
		if !slices.Contains(signatures, k.Signature) {
			signatures = append(signatures, k.Signature)
		}
	}
	if want := []string{"bundle", "responsible_principal_record", "agent_passport", "intent", "policy_decision"}; !slices.Equal(signatures, want) {
		t.Errorf("signatures = %v, want %v", signatures, want)
	}
	raw, _ := json.Marshal(r)
	if !strings.Contains(string(raw), `"signer_keys":[{"signature":"bundle","component":"classical","kid":"`) {
		t.Errorf("JSON form lacks signer_keys: %s", raw)
	}

	// A result that never reached a signature still has an empty list.
	if r := v2.VerifySignedBundleV2(reg, []byte(`{}`)); r.SignerKeys == nil || len(r.SignerKeys) != 0 {
		t.Errorf("signer keys of an empty bundle = %v, want []", r.SignerKeys)
	}
}

func TestAdmissionVerifyWithoutAtUsesTheSystemClock(t *testing.T) {
	// The base bundle's session runs from 10:00 to 10:05 on 2 November 2026:
	// outside it, on the system clock, it does not verify; at the vector's now
	// it does.
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()
	base := vecs.SignedBundles["base"]
	if r := v2.VerifySignedBundleV2At(reg, base, v2.DefaultVerifierPolicy(), mustInstant(t, "2026-11-02T10:01:00.000Z")); !r.Verified {
		t.Fatalf("base must verify at the vector's now: %v", r.Errors)
	}
	before := time.Now()
	plain := v2.VerifySignedBundleV2(reg, base)
	withPolicy := v2.VerifySignedBundleV2WithPolicy(reg, base, v2.DefaultVerifierPolicy())
	after := time.Now()
	inWindow := func(at time.Time) bool {
		return !at.Before(mustInstant(t, "2026-11-02T09:59:30Z")) && !at.After(mustInstant(t, "2026-11-02T10:05:00Z"))
	}
	if inWindow(before) == inWindow(after) {
		for _, r := range []*v2.V2VerificationResult{plain, withPolicy} {
			if r.Verified != inWindow(before) {
				t.Errorf("verified = %v on the system clock %s: %v", r.Verified, before, r.Errors)
			}
		}
	}
}

func TestAdmissionRevocationSubjects(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()
	base := vecs.SignedBundles["base"]
	r := v2.VerifySignedBundleV2At(reg, base, v2.DefaultVerifierPolicy(), mustInstant(t, "2026-11-02T10:01:00.000Z"))
	subjects := v2.RevocationSubjects(base, r)
	if !slices.Equal(subjects.AgentIDs, []string{"agent:acme-bot"}) {
		t.Errorf("agent_ids = %v", subjects.AgentIDs)
	}
	var kids []string
	for _, k := range r.SignerKeys {
		if !slices.Contains(kids, k.Kid) {
			kids = append(kids, k.Kid)
		}
	}
	sort.Strings(kids)
	if !slices.Equal(subjects.Kids, kids) || len(kids) != 4 {
		t.Errorf("kids = %v, want the 4 signer kids %v", subjects.Kids, kids)
	}
	if empty := v2.RevocationSubjects([]byte(`not json`), nil); empty.AgentIDs == nil || empty.Kids == nil || len(empty.AgentIDs)+len(empty.Kids) != 0 {
		t.Errorf("subjects of nothing = %+v", empty)
	}
}

func TestAdmissionProfileCannotBeWeakened(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	p, err := v2.ResolveStrictV1Profile(vecs.Profiles["strict"])
	if err != nil {
		t.Fatal(err)
	}
	weakened := p.VerifierPolicy()
	weakened.DefaultMode = "classical_only"
	weakened.RiskOverrides["high"] = "classical_only"
	weakened.AllowV1Bundles = true
	weakened.RequireAudienceBinding = false
	weakened.AcceptedPQAlgs[0] = "none"
	weakened.AdvisoryRejectedAlgs = append(weakened.AdvisoryRejectedAlgs, "ed25519")

	policy := p.VerifierPolicy()
	want := map[string]string{"low": "hybrid_required", "medium": "hybrid_required", "high": "hybrid_required"}
	if policy.DefaultMode != "hybrid_required" || len(policy.RiskOverrides) != 3 || policy.RiskOverrides["low"] != want["low"] ||
		policy.RiskOverrides["medium"] != want["medium"] || policy.RiskOverrides["high"] != want["high"] ||
		policy.AllowV1Bundles || !policy.RequireSessionBinding || !policy.RequireSessionExpiry || !policy.RequireAudienceBinding ||
		policy.VerifierID != vecs.VerifierID || policy.MaxSessionDurationSeconds != 300 ||
		!slices.Equal(policy.AcceptedPQAlgs, []string{"ml-dsa-65", "slh-dsa-192f"}) || len(policy.AdvisoryRejectedAlgs) != 0 {
		t.Errorf("the profile's policy changed through a returned copy: %+v", policy)
	}
	if p.VerifierID() != vecs.VerifierID || p.MaxSessionDurationSeconds() != 300 || p.MaxRevocationAgeSeconds() != 300 {
		t.Errorf("profile %s/%d/%d", p.VerifierID(), p.MaxSessionDurationSeconds(), p.MaxRevocationAgeSeconds())
	}

	// A profile or trust store that this package did not load is refused, not
	// taken as an empty one.
	reg := admissionRegistry()
	trust, err := v2.NewPrincipalTrustStore(vecs.TrustSets["principal"])
	if err != nil {
		t.Fatal(err)
	}
	now := mustInstant(t, "2026-11-02T10:01:00.000Z")
	if _, err := v2.AdmitSignedBundleV2(reg, vecs.SignedBundles["base"], v2.AdmitOptions{Profile: &v2.StrictV1Profile{}, Trust: trust, Now: now}); configCode(err) != "CONFIG_INVALID_VALUE" {
		t.Errorf("a zero profile: %v", err)
	}
	if _, err := v2.AdmitSignedBundleV2(reg, vecs.SignedBundles["base"], v2.AdmitOptions{Trust: &v2.PrincipalTrustStore{}, Now: now}); configCode(err) != "CONFIG_INVALID_VALUE" {
		t.Errorf("a zero trust store: %v", err)
	}
}

func TestAdmissionConfigurationContradictions(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()
	base := vecs.SignedBundles["base"]
	now := mustInstant(t, "2026-11-02T10:01:00.000Z")
	profile, err := v2.ResolveStrictV1Profile(vecs.Profiles["strict"])
	if err != nil {
		t.Fatal(err)
	}
	trust, err := v2.NewPrincipalTrustStore(vecs.TrustSets["principal"])
	if err != nil {
		t.Fatal(err)
	}
	verification := v2.VerifySignedBundleV2At(reg, base, v2.DefaultVerifierPolicy(), now)

	if _, err := v2.EvaluateAdmissionV2(base, verification, v2.AdmissionOptions{Profile: profile, Now: now}); configCode(err) != "CONFIG_PROFILE_CONTRADICTION" {
		t.Errorf("evaluate, profile without trust: %v", err)
	}
	if _, err := v2.AdmitSignedBundleV2(reg, base, v2.AdmitOptions{Profile: profile, Now: now}); configCode(err) != "CONFIG_PROFILE_CONTRADICTION" {
		t.Errorf("admit, profile without trust: %v", err)
	}
	policy := v2.DefaultVerifierPolicy()
	if _, err := v2.AdmitSignedBundleV2(reg, base, v2.AdmitOptions{Profile: profile, Trust: trust, Policy: &policy, Now: now}); configCode(err) != "CONFIG_PROFILE_CONTRADICTION" {
		t.Errorf("admit, profile with a caller policy: %v", err)
	}
	if _, err := v2.EvaluateAdmissionV2(base, verification, v2.AdmissionOptions{Trust: trust}); configCode(err) != "CONFIG_INVALID_VALUE" {
		t.Errorf("evaluate without now: %v", err)
	}
}

func TestAdmissionPermissiveVerificationIsNotCompliant(t *testing.T) {
	// The caller passes the result of a classical_only verification: the
	// profile notices.
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()
	base := vecs.SignedBundles["base"]
	now := mustInstant(t, "2026-11-02T10:01:00.000Z")
	permissive := v2.DefaultVerifierPolicy()
	permissive.DefaultMode = "classical_only"
	permissive.RiskOverrides = map[string]string{"low": "classical_only", "medium": "classical_only", "high": "classical_only"}
	verification := v2.VerifySignedBundleV2At(reg, base, permissive, now)
	profile, _ := v2.ResolveStrictV1Profile(vecs.Profiles["strict"])
	trust, _ := v2.NewPrincipalTrustStore(vecs.TrustSets["principal"])
	var caseA json.RawMessage
	for _, c := range vecs.Cases {
		if c.Name == "A_known_principal_strict" {
			caseA = c.Revocation
		}
	}
	r, err := v2.EvaluateAdmissionV2(base, verification, v2.AdmissionOptions{Profile: profile, Trust: trust, Revocation: caseA, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if r.Admitted || !slices.Contains(uniqueSortedCodes(r.Errors), "PROFILE_HYBRID_REQUIRED") {
		t.Errorf("admitted=%v errors=%+v", r.Admitted, r.Errors)
	}
}

func TestAdmissionDoesNotAuthorizeAnAction(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()
	profile, _ := v2.ResolveStrictV1Profile(vecs.Profiles["strict"])
	trust, _ := v2.NewPrincipalTrustStore(vecs.TrustSets["principal"])
	for _, c := range vecs.Cases {
		if c.Name != "A_known_principal_strict" {
			continue
		}
		r, err := v2.AdmitSignedBundleV2(reg, vecs.SignedBundles["base"], v2.AdmitOptions{
			Profile: profile, Trust: trust, Revocation: c.Revocation, Now: mustInstant(t, c.Now),
		})
		if err != nil {
			t.Fatal(err)
		}
		if !r.Admitted || r.RecordedDecision == nil || *r.RecordedDecision != "approve" || r.ActionAuthorized {
			t.Errorf("admitted=%v decision=%v action_authorized=%v", r.Admitted, r.RecordedDecision, r.ActionAuthorized)
		}
		// The JSON form keeps the names of § 5.2.
		raw, _ := json.Marshal(r)
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"verified", "verification", "principal_trust", "profile", "profile_compliance", "admitted", "action_authorized", "recorded_decision", "trust_set_version", "errors"} {
			if _, ok := fields[name]; !ok {
				t.Errorf("JSON form lacks %s: %s", name, raw)
			}
		}
		if len(fields) != 10 || string(fields["action_authorized"]) != "false" || string(fields["errors"]) != "[]" {
			t.Errorf("JSON form: %s", raw)
		}
	}
	// Without a profile or trust set, the absent values are JSON null.
	r, err := v2.AdmitSignedBundleV2(reg, []byte(`{}`), v2.AdmitOptions{Now: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(r)
	for _, want := range []string{`"profile":null`, `"recorded_decision":null`, `"trust_set_version":null`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("JSON form lacks %s: %s", want, raw)
		}
	}
}

func TestAdmissionMessagesAreBoundedWithoutKeyMaterial(t *testing.T) {
	vecs := loadAdmissionVectors(t)
	reg := admissionRegistry()
	var sb map[string]interface{}
	if err := json.Unmarshal(vecs.SignedBundles["base"], &sb); err != nil {
		t.Fatal(err)
	}
	rpr := sb["bundle"].(map[string]interface{})["responsible_principal_record"].(map[string]interface{})
	rpr["payload"].(map[string]interface{})["human_id"] = strings.Repeat("x", 100_000)
	sb["bundle"].(map[string]interface{})["manifest"].(map[string]interface{})["intended_verifier"] = strings.Repeat("y", 100_000)
	huge, _ := json.Marshal(sb)

	trust, _ := v2.NewPrincipalTrustStore(vecs.TrustSets["principal"])
	profile, _ := v2.ResolveStrictV1Profile(vecs.Profiles["strict"])
	now := mustInstant(t, "2026-11-02T10:01:00.000Z")
	var all []v2.AdmissionError
	for _, opts := range []v2.AdmitOptions{{Trust: trust, Now: now}, {Profile: profile, Trust: trust, Now: now}} {
		r, err := v2.AdmitSignedBundleV2(reg, huge, opts)
		if err != nil {
			t.Fatal(err)
		}
		if len(r.Errors) == 0 {
			t.Fatal("expected errors")
		}
		all = append(all, r.Errors...)
	}
	_, err := v2.NewPrincipalTrustStore([]byte(`{"trust_set_version":"v","principals":[{"human_id":"h","keys":[{"kid":"` + strings.Repeat("k", 10_000) + `"}]}],"` + strings.Repeat("z", 10_000) + `":1}`))
	if err == nil {
		t.Fatal("expected a configuration error")
	}
	all = append(all, v2.AdmissionError{Code: configCode(err), Message: err.(*v2.AdmissionConfigError).Message})
	for _, e := range all {
		if n := utf8.RuneCountInString(e.Message); n > 500 {
			t.Errorf("%s message of %d characters", e.Code, n)
		}
	}
	var set struct {
		Principals []struct {
			Keys []struct {
				PublicKeyB64 string `json:"public_key_b64"`
			} `json:"keys"`
		} `json:"principals"`
	}
	if err := json.Unmarshal(vecs.TrustSets["principal"], &set); err != nil {
		t.Fatal(err)
	}
	text, _ := json.Marshal(all)
	for _, k := range set.Principals[0].Keys {
		if strings.Contains(string(text), k.PublicKeyB64) {
			t.Error("an admission message contains a trusted public key")
		}
	}
}
