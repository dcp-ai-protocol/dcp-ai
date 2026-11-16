package v2_test

// Delegated admission (MP-02 F2): the shared vectors of tests/interop/v2/delegated_admission_vectors.json
// through the public API, and what the vectors cannot express: the internal floor against the public
// verifier, the policy contract (R4) and the public gate it leaves unchanged, the snapshot of the inputs,
// loaded and raw configuration, and the verifier policy and mandate preflight against their schemas. Mirrors
// sdks/typescript/src/__tests__/delegated-admission.test.ts.

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type delegatedCase struct {
	Name                    string   `json:"name"`
	Group                   string   `json:"group"`
	Rule                    string   `json:"rule"`
	Leaf                    string   `json:"leaf"`
	Chain                   []string `json:"chain"`
	Delegators              []string `json:"delegators"`
	Profile                 *string  `json:"profile"`
	Policy                  *string  `json:"policy"`
	MaxRevocationAgeSeconds *int     `json:"max_revocation_age_seconds"`
	Trust                   string   `json:"trust"`
	Revocation              *string  `json:"revocation"`
	MandateRevocation       *string  `json:"mandate_revocation"`
	Expected                struct {
		Admitted           bool     `json:"admitted"`
		DelegationVerified bool     `json:"delegation_verified"`
		Codes              []string `json:"codes"`
		SecurityTier       *string  `json:"security_tier"`
		VerificationMode   *string  `json:"verification_mode"`
		EffectiveFloor     *string  `json:"effective_floor"`
		Activation         string   `json:"activation"`
	} `json:"expected"`
	ExpectedRaw           map[string]json.RawMessage `json:"-"`
	ControlPublicAdmitted *bool                      `json:"control_public_admitted"`
}

type delegatedVectors struct {
	Now                string                     `json:"now"`
	SignedBundles      map[string]json.RawMessage `json:"signed_bundles"`
	Mandates           map[string]json.RawMessage `json:"mandates"`
	TrustSets          map[string]json.RawMessage `json:"trust_sets"`
	Profiles           map[string]json.RawMessage `json:"profiles"`
	Policies           map[string]json.RawMessage `json:"policies"`
	Revocations        map[string]json.RawMessage `json:"revocations"`
	MandateRevocations map[string]json.RawMessage `json:"mandate_revocations"`
	Cases              []json.RawMessage          `json:"cases"`
	ConfigCases        []struct {
		Name     string                 `json:"name"`
		Operator map[string]interface{} `json:"operator"`
		Code     string                 `json:"expected_code"`
	} `json:"config_cases"`
}

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func loadDelegated(t *testing.T) (*delegatedVectors, []delegatedCase, time.Time) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "tests", "interop", "v2", "delegated_admission_vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v delegatedVectors
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	cases := make([]delegatedCase, len(v.Cases))
	for i, raw := range v.Cases {
		if err := json.Unmarshal(raw, &cases[i]); err != nil {
			t.Fatal(err)
		}
		var whole struct {
			Expected map[string]json.RawMessage `json:"expected"`
		}
		_ = json.Unmarshal(raw, &whole)
		cases[i].ExpectedRaw = whole.Expected
	}
	now, err := time.Parse(time.RFC3339Nano, v.Now)
	if err != nil {
		t.Fatal(err)
	}
	return &v, cases, now
}

func delegatedRegistry(ed v2.CryptoProvider) *v2.AlgorithmRegistry {
	reg := v2.NewAlgorithmRegistry()
	if ed == nil {
		ed = &providers.Ed25519Provider{}
	}
	reg.RegisterSigner(ed)
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	reg.RegisterSigner(&providers.SlhDsa192fProvider{})
	return reg
}

func evidenceOf(v *delegatedVectors, c delegatedCase) v2.DelegatedEvidence {
	chain := make([]json.RawMessage, len(c.Chain))
	for i, n := range c.Chain {
		chain[i] = v.Mandates[n]
	}
	chainJSON, _ := json.Marshal(chain)
	delegators := make([][]byte, len(c.Delegators))
	for i, n := range c.Delegators {
		delegators[i] = bytes.Clone(v.SignedBundles[n])
	}
	return v2.DelegatedEvidence{SignedBundle: bytes.Clone(v.SignedBundles[c.Leaf]), MandateChain: chainJSON, DelegatorBundles: delegators}
}

func operatorOf(v *delegatedVectors, c delegatedCase, now time.Time) v2.DelegatedOperator {
	op := v2.DelegatedOperator{TrustSetJSON: bytes.Clone(v.TrustSets[c.Trust]), Now: now}
	if c.Profile != nil {
		op.ProfileJSON = bytes.Clone(v.Profiles[*c.Profile])
	}
	if c.Policy != nil {
		op.Policy = bytes.Clone(v.Policies[*c.Policy])
	}
	if c.MaxRevocationAgeSeconds != nil {
		op.MaxRevocationAgeSeconds = *c.MaxRevocationAgeSeconds
	}
	if c.Revocation != nil {
		op.Revocation = bytes.Clone(v.Revocations[*c.Revocation])
	}
	if c.MandateRevocation != nil {
		op.MandateRevocation = bytes.Clone(v.MandateRevocations[*c.MandateRevocation])
	}
	return op
}

func codesOf(r *v2.DelegatedAdmissionResult) []string {
	set := map[string]bool{}
	for _, e := range r.Errors {
		set[e.Code] = true
	}
	out := make([]string, 0, len(set))
	for c := range set {
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}

func caseNamed(t *testing.T, cases []delegatedCase, name string) delegatedCase {
	t.Helper()
	for _, c := range cases {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no case %s", name)
	return delegatedCase{}
}

func TestDelegatedAdmissionVectors(t *testing.T) {
	v, cases, now := loadDelegated(t)
	if len(cases) != 71 || len(v.ConfigCases) != 6 {
		t.Fatalf("expected 71 + 6 cases, got %d + %d", len(cases), len(v.ConfigCases))
	}
	reg := delegatedRegistry(nil)
	for _, c := range cases {
		t.Run(c.Group+"/"+c.Name, func(t *testing.T) {
			r, err := v2.AdmitDelegatedBundleV2(reg, evidenceOf(v, c), operatorOf(v, c, now))
			if err != nil {
				t.Fatalf("configuration error: %v", err)
			}
			want := slices.Clone(c.Expected.Codes)
			sort.Strings(want)
			if r.Admitted != c.Expected.Admitted || r.DelegationVerified != c.Expected.DelegationVerified || !slices.Equal(codesOf(r), want) {
				msgs := make([]string, len(r.Errors))
				for i, e := range r.Errors {
					msgs[i] = e.Message
				}
				t.Fatalf("got admitted=%v delegation_verified=%v codes=%v, want %v %v %v (%s)\n%s", r.Admitted, r.DelegationVerified, codesOf(r), c.Expected.Admitted, c.Expected.DelegationVerified, want, c.Rule, strings.Join(msgs, "\n"))
			}
			if r.Activation != "not_evaluated" || r.DelegationActive || r.ActionAuthorized {
				t.Fatal("activation or authorization")
			}
			str := func(p *string) string {
				if p == nil {
					return "<null>"
				}
				return *p
			}
			if _, set := c.ExpectedRaw["security_tier"]; set && str(r.SecurityTier) != str(c.Expected.SecurityTier) {
				t.Fatalf("security_tier %s, want %s", str(r.SecurityTier), str(c.Expected.SecurityTier))
			}
			if _, set := c.ExpectedRaw["verification_mode"]; set && str(r.VerificationMode) != str(c.Expected.VerificationMode) {
				t.Fatalf("verification_mode %s, want %s", str(r.VerificationMode), str(c.Expected.VerificationMode))
			}
			if _, set := c.ExpectedRaw["effective_floor"]; set {
				var got *string
				if r.Chain != nil {
					got = r.Chain.EffectiveFloor
				}
				if str(got) != str(c.Expected.EffectiveFloor) {
					t.Fatalf("effective_floor %s, want %s", str(got), str(c.Expected.EffectiveFloor))
				}
			}
			if c.ControlPublicAdmitted != nil {
				var policy v2.VerifierPolicy
				if err := json.Unmarshal(v.Policies[*c.Policy], &policy); err != nil {
					t.Fatal(err)
				}
				store, err := v2.NewPrincipalTrustStore(v.TrustSets[c.Trust])
				if err != nil {
					t.Fatal(err)
				}
				pub, err := v2.AdmitSignedBundleV2(reg, v.SignedBundles[c.Leaf], v2.AdmitOptions{Policy: &policy, Trust: store, Now: now})
				if err != nil || pub.Admitted != *c.ControlPublicAdmitted {
					t.Fatalf("public admission control: %v %v", err, pub)
				}
			}
		})
	}
	for _, c := range v.ConfigCases {
		t.Run("config/"+c.Name, func(t *testing.T) {
			op := v2.DelegatedOperator{
				Revocation:        v.Revocations["all_not_revoked"],
				MandateRevocation: v.MandateRevocations["all_not_revoked"],
				Now:               now,
			}
			if s, ok := c.Operator["trust"].(string); ok {
				op.TrustSetJSON = v.TrustSets[s]
			}
			if s, ok := c.Operator["profile"].(string); ok {
				op.ProfileJSON = v.Profiles[s]
			}
			if s, ok := c.Operator["policy"].(string); ok {
				op.Policy = v.Policies[s]
			}
			if f, ok := c.Operator["max_revocation_age_seconds"].(float64); ok {
				op.MaxRevocationAgeSeconds = int(f)
			}
			chain, _ := json.Marshal([]json.RawMessage{v.Mandates["root"]})
			_, err := v2.AdmitDelegatedBundleV2(reg, v2.DelegatedEvidence{SignedBundle: v.SignedBundles["orch"], MandateChain: chain}, op)
			var cfg *v2.AdmissionConfigError
			if !errors.As(err, &cfg) || cfg.Code != c.Code {
				t.Fatalf("got %v, want %s", err, c.Code)
			}
		})
	}
}

// ── The floor reaches the verification (design 1.4) ──

func TestDelegatedFloorReachesVerification(t *testing.T) {
	v, _, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	var weak v2.VerifierPolicy
	if err := json.Unmarshal(v.Policies["weak_classical"], &weak); err != nil {
		t.Fatal(err)
	}
	bundle := v.SignedBundles["orch_classical_only"]
	pub := v2.VerifySignedBundleV2At(reg, bundle, weak, now)
	if !pub.Verified || pub.VerificationMode != "classical_only" {
		t.Fatalf("public: %v %s %v", pub.Verified, pub.VerificationMode, pub.Errors)
	}
	floored := v2.VerifySignedBundleV2AtFloorForTests(reg, bundle, weak, now, "elevated")
	if floored.Verified || floored.VerificationMode != "hybrid_required" || floored.ResolvedTier != "elevated" {
		t.Fatalf("floored: %v %s %s", floored.Verified, floored.VerificationMode, floored.ResolvedTier)
	}
	for name, b := range v.SignedBundles {
		for _, policy := range []v2.VerifierPolicy{v2.DefaultVerifierPolicy(), weak} {
			a, _ := json.Marshal(v2.VerifySignedBundleV2At(reg, b, policy, now))
			c, _ := json.Marshal(v2.VerifySignedBundleV2AtFloorForTests(reg, b, policy, now, ""))
			if !bytes.Equal(a, c) {
				t.Fatalf("%s: the internal step without a floor differs from the public verifier", name)
			}
		}
	}
}

// ── The policy contract (R4) and the unchanged public gate ──

func policyJSON(t *testing.T, base json.RawMessage, change map[string]interface{}) json.RawMessage {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(base, &m); err != nil {
		t.Fatal(err)
	}
	for k, val := range change {
		if val == nil {
			delete(m, k)
		} else {
			m[k] = val
		}
	}
	out, _ := json.Marshal(m)
	return out
}

func TestDelegatedPublicGateIsUnchanged(t *testing.T) {
	v, _, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	var preset v2.VerifierPolicy
	if err := json.Unmarshal(v.Policies["pq_only"], &preset); err != nil {
		t.Fatal(err)
	}
	pub := v2.VerifySignedBundleV2At(reg, v.SignedBundles["orch"], preset, now)
	if pub.Verified || !strings.Contains(strings.Join(pub.Errors, " "), "does not enforce") {
		t.Fatalf("the public gate must still refuse the pq_only preset: %v", pub.Errors)
	}
	reversed := v2.DefaultVerifierPolicy()
	reversed.AcceptedHashAlgs = []string{"sha384", "sha256"}
	if r := v2.VerifySignedBundleV2At(reg, v.SignedBundles["orch"], reversed, now); r.Verified {
		t.Fatal("the public gate must still refuse reversed accepted_hash_algs")
	}
	// The contract-checked step takes them, and verifies as the defaults do.
	if r := v2.VerifySignedBundleV2AtContractForTests(reg, v.SignedBundles["orch"], preset, now); !r.Verified || r.VerificationMode != "pq_only" {
		t.Fatalf("contract-checked pq_only preset: %v %v", r.Verified, r.Errors)
	}
	if r := v2.VerifySignedBundleV2AtContractForTests(reg, v.SignedBundles["orch"], reversed, now); !r.Verified {
		t.Fatalf("contract-checked reversed hashes: %v", r.Errors)
	}
	// Only the contract's values: min_classical 0 outside pq_only is still refused.
	mixed := preset
	mixed.RiskOverrides = map[string]string{"low": "pq_only", "medium": "pq_only", "high": "hybrid_required"}
	if r := v2.VerifySignedBundleV2AtContractForTests(reg, v.SignedBundles["orch"], mixed, now); r.Verified {
		t.Fatal("min_classical 0 with a mode other than pq_only must be refused")
	}
}

func TestDelegatedPolicyContract(t *testing.T) {
	v, cases, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	weakCase := caseNamed(t, cases, "no_floor_weak_policy")
	pqCase := caseNamed(t, cases, "pq_only_stays_with_routine_floor")
	run := func(c delegatedCase, policy json.RawMessage) (*v2.DelegatedAdmissionResult, error) {
		op := operatorOf(v, c, now)
		op.Policy = policy
		return v2.AdmitDelegatedBundleV2(reg, evidenceOf(v, c), op)
	}
	defaultJSON, _ := json.Marshal(v2.DefaultVerifierPolicy())
	accepted := []struct {
		name   string
		c      delegatedCase
		policy json.RawMessage
	}{
		{"weak_classical with reversed hashes", weakCase, policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"accepted_hash_algs": []string{"sha384", "sha256"}})},
		{"DEFAULT with reversed hashes", weakCase, policyJSON(t, defaultJSON, map[string]interface{}{"accepted_hash_algs": []string{"sha384", "sha256"}})},
		{"PQ_ONLY preset with reversed hashes", pqCase, policyJSON(t, v.Policies["pq_only"], map[string]interface{}{"accepted_hash_algs": []string{"sha384", "sha256"}})},
		{"integral floats", weakCase, policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_key_age_days": json.Number("365.0"), "min_pq": json.Number("1.0"), "min_classical": json.Number("1.0")})},
		{"max_session_duration_seconds 0", weakCase, policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_session_duration_seconds": 0})},
		{"max_session_duration_seconds 2147483647", weakCase, policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_session_duration_seconds": 2147483647})},
		{"max_session_duration_seconds 300.0", weakCase, policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_session_duration_seconds": json.Number("300.0")})},
	}
	for _, a := range accepted {
		r, err := run(a.c, a.policy)
		if err != nil || !r.Admitted {
			t.Fatalf("%s: %v %v", a.name, err, r)
		}
	}
	refused := []struct {
		name, code string
		policy     json.RawMessage
	}{
		{"min_pq 2 (R4)", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"min_pq": 2})},
		{"min_classical 2 (R4)", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"min_classical": 2})},
		{"accepted_hash_algs sha384 (R4)", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"accepted_hash_algs": []string{"sha384"}})},
		{"max_key_age_days 1 (R4)", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_key_age_days": 1})},
		{"max_key_age_days 364", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_key_age_days": 364})},
		{"min_pq 0", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"min_pq": 0})},
		{"min_classical 0 outside pq_only", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"min_classical": 0})},
		{"require_composite_binding false outside pq_only", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"require_composite_binding": false})},
		{"require_composite_binding false with one hybrid_required override", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["pq_only"], map[string]interface{}{"risk_overrides": map[string]string{"low": "pq_only", "medium": "pq_only", "high": "hybrid_required"}})},
		{"require_session_binding false", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"require_session_binding": false})},
		{"accepted_hash_algs sha256 twice", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"accepted_hash_algs": []string{"sha256", "sha256"}})},
		{"accepted_hash_algs with a third", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"accepted_hash_algs": []string{"sha256", "sha384", "sha512"}})},
		{"max_session_duration_seconds 2147483648", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_session_duration_seconds": 2147483648})},
		{"max_session_duration_seconds -1", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_session_duration_seconds": -1})},
		{"max_session_duration_seconds true", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_session_duration_seconds": true})},
		{"max_session_duration_seconds 1.5", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_session_duration_seconds": 1.5})},
		// R2: the schema.
		{"require_session_binding 0 (R2)", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"require_session_binding": 0})},
		{"unknown member (R2)", "CONFIG_UNKNOWN_FIELD", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"unknown_setting": true})},
		{`max_key_age_days "365" (R2)`, "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_key_age_days": "365"})},
		{"max_key_age_days true", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"max_key_age_days": true})},
		{"unknown mode", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"default_mode": "hybrid"})},
		{"risk tier missing", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"risk_overrides": map[string]string{"low": "classical_only", "medium": "classical_only"}})},
		{"unknown risk tier", "CONFIG_UNKNOWN_FIELD", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"risk_overrides": map[string]string{"low": "classical_only", "medium": "classical_only", "high": "classical_only", "extreme": "pq_only"}})},
		{"empty classical list", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"accepted_classical_algs": []string{}})},
		{"required member missing", "CONFIG_INVALID_VALUE", policyJSON(t, v.Policies["weak_classical"], map[string]interface{}{"allow_v1_bundles": nil})},
		{"not JSON", "CONFIG_INVALID_VALUE", json.RawMessage(`{"default_mode":`)},
	}
	for _, r := range refused {
		_, err := run(weakCase, r.policy)
		var cfg *v2.AdmissionConfigError
		if !errors.As(err, &cfg) || cfg.Code != r.code {
			t.Fatalf("%s: got %v, want %s", r.name, err, r.code)
		}
	}
}

func TestDelegatedPolicyTableMatchesSchema(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "schemas", "v2", "verifier_policy.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		AdditionalProperties bool                              `json:"additionalProperties"`
		Required             []string                          `json:"required"`
		Properties           map[string]map[string]interface{} `json:"properties"`
	}
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	fields := v2.PolicyFieldsForTests()
	names := make([]string, 0, len(fields))
	for k := range fields {
		names = append(names, k)
	}
	sort.Strings(names)
	props := make([]string, 0, len(schema.Properties))
	for k := range schema.Properties {
		props = append(props, k)
	}
	sort.Strings(props)
	if schema.AdditionalProperties || !slices.Equal(names, props) {
		t.Fatalf("members %v, schema %v", names, props)
	}
	required := slices.Clone(v2.PolicyRequiredForTests)
	sort.Strings(required)
	schemaRequired := slices.Clone(schema.Required)
	sort.Strings(schemaRequired)
	if !slices.Equal(required, schemaRequired) {
		t.Fatalf("required %v, schema %v", required, schemaRequired)
	}
	modes := schema.Properties["default_mode"]["enum"]
	for name, rule := range fields {
		s := schema.Properties[name]
		switch rule.Type {
		case "mode":
			if s["type"] != "string" || !reflect.DeepEqual(s["enum"], modes) {
				t.Fatalf("%s: %v", name, s)
			}
		case "risk_overrides":
			if s["additionalProperties"] != false || !reflect.DeepEqual(s["required"], []interface{}{"low", "medium", "high"}) {
				t.Fatalf("%s: %v", name, s)
			}
		case "string_array":
			minItems := -1
			if f, ok := s["minItems"].(float64); ok {
				minItems = int(f)
			}
			if s["type"] != "array" || !reflect.DeepEqual(s["items"], map[string]interface{}{"type": "string"}) || minItems != rule.MinItems {
				t.Fatalf("%s: %v", name, s)
			}
		default:
			minimum := -1
			if f, ok := s["minimum"].(float64); ok {
				minimum = int(f)
			}
			if s["type"] != rule.Type || minimum != rule.Minimum {
				t.Fatalf("%s: %v vs %+v", name, s, rule)
			}
		}
	}
}

// ── Mandate preflight against schemas/v2/delegation_mandate.schema.json ──

func TestDelegatedMandatePreflightMatchesSchema(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "schemas", "v2", "delegation_mandate.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	var schema map[string]interface{}
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	keys := func(m interface{}) []string {
		out := []string{}
		for k := range m.(map[string]interface{}) {
			out = append(out, k)
		}
		sort.Strings(out)
		return out
	}
	strs := func(l interface{}) []string {
		out := []string{}
		for _, x := range l.([]interface{}) {
			out = append(out, x.(string))
		}
		sort.Strings(out)
		return out
	}
	sorted := func(l []string) []string { c := slices.Clone(l); sort.Strings(c); return c }
	props := schema["properties"].(map[string]interface{})
	scope := props["authority_scope"].(map[string]interface{})
	item := scope["items"].(map[string]interface{})
	itemProps := item["properties"].(map[string]interface{})
	sd := props["sub_delegation"].(map[string]interface{})
	checks := []bool{
		schema["additionalProperties"] == false,
		slices.Equal(sorted(v2.MandateFieldsForTests), keys(props)),
		slices.Equal(sorted(v2.MandateRequiredForTests), strs(schema["required"])),
		scope["minItems"] == float64(1),
		item["additionalProperties"] == false,
		slices.Equal(sorted(v2.ScopeFieldsForTests), keys(itemProps)),
		slices.Equal(sorted(v2.ScopeRequiredForTests), strs(item["required"])),
		reflect.DeepEqual(itemProps["domain"], map[string]interface{}{"type": "string", "minLength": float64(1)}),
		reflect.DeepEqual(itemProps["actions_permitted"], map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string", "minLength": float64(1)}}),
		reflect.DeepEqual(itemProps["data_classes"], itemProps["actions_permitted"]),
		reflect.DeepEqual(itemProps["limits"], map[string]interface{}{"type": "object"}), // open
		sd["additionalProperties"] == false,
		slices.Equal(sorted(v2.SubDelegationFieldsForTests), keys(sd["properties"])),
		slices.Equal(sorted(v2.SubDelegationFieldsForTests), strs(sd["required"])),
	}
	for i, ok := range checks {
		if !ok {
			t.Fatalf("schema parity check %d fails", i)
		}
	}
}

func TestDelegatedPreflightRejects(t *testing.T) {
	v, cases, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	c := caseNamed(t, cases, "principal_orchestrator_subagent")
	run := func(edit func(chain []map[string]interface{})) *v2.DelegatedAdmissionResult {
		chain := make([]map[string]interface{}, len(c.Chain))
		for i, n := range c.Chain {
			if err := json.Unmarshal(v.Mandates[n], &chain[i]); err != nil {
				t.Fatal(err)
			}
		}
		edit(chain)
		ev := evidenceOf(v, c)
		ev.MandateChain, _ = json.Marshal(chain)
		r, err := v2.AdmitDelegatedBundleV2(reg, ev, operatorOf(v, c, now))
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	scope0 := func(m map[string]interface{}) map[string]interface{} {
		return m["authority_scope"].([]interface{})[0].(map[string]interface{})
	}
	for _, x := range []struct {
		name, message string
		edit          func(chain []map[string]interface{})
	}{
		{"root with parent_mandate_id", "a root mandate has no parent_mandate_id", func(c []map[string]interface{}) { c[0]["parent_mandate_id"] = "mandate:parent" }},
		{"root with delegation_depth 1", "a root mandate has delegation_depth 0", func(c []map[string]interface{}) { c[0]["delegation_depth"] = 1 }},
		{"sub-mandate without delegation_depth", "missing delegation_depth", func(c []map[string]interface{}) { delete(c[1], "delegation_depth") }},
		{"sub-mandate without parent_mandate_id", "missing parent_mandate_id", func(c []map[string]interface{}) { delete(c[1], "parent_mandate_id") }},
		{"scope entry without actions_permitted", "is missing actions_permitted", func(c []map[string]interface{}) { delete(scope0(c[1]), "actions_permitted") }},
		{"limits that is not an object", "limits must be an object", func(c []map[string]interface{}) { scope0(c[1])["limits"] = []interface{}{} }},
		{"unknown tier", "minimum_security_tier is not", func(c []map[string]interface{}) { c[0]["minimum_security_tier"] = "critical" }},
		{"delegation_depth true", "delegation_depth must be an integer", func(c []map[string]interface{}) { c[1]["delegation_depth"] = true }},
	} {
		r := run(x.edit)
		if !slices.Equal(codesOf(r), []string{"DELEGATION_CHAIN_INVALID"}) || !slices.ContainsFunc(r.Errors, func(e v2.AdmissionError) bool { return strings.Contains(e.Message, x.message) }) {
			t.Fatalf("%s: %v %v", x.name, codesOf(r), r.Errors)
		}
	}
	// An integral float depth is an integer, and canonicalizes as 1: the signature still verifies.
	if r := run(func(c []map[string]interface{}) { c[1]["delegation_depth"] = 1.0 }); !r.Admitted {
		t.Fatalf("delegation_depth 1.0: %v", r.Errors)
	}
}

// ── Snapshot, configuration and evidence ──

type tamperingEd25519 struct {
	providers.Ed25519Provider
	once   bool
	tamper func()
}

func (p *tamperingEd25519) Verify(message, signature []byte, publicKeyB64 string) (bool, error) {
	if !p.once {
		p.once = true
		p.tamper()
	}
	return p.Ed25519Provider.Verify(message, signature, publicKeyB64)
}

func TestDelegatedSnapshot(t *testing.T) {
	v, cases, now := loadDelegated(t)
	c := caseNamed(t, cases, "principal_orchestrator_subagent")
	baseline, err := v2.AdmitDelegatedBundleV2(delegatedRegistry(nil), evidenceOf(v, c), operatorOf(v, c, now))
	if err != nil || !baseline.Admitted {
		t.Fatalf("baseline: %v %v", err, baseline)
	}
	ev, op := evidenceOf(v, c), operatorOf(v, c, now)
	zero := func(b []byte) {
		for i := range b {
			b[i] = ' '
		}
	}
	// The first signature verification comes after the snapshot, on this goroutine: overwrite every input.
	p := &tamperingEd25519{tamper: func() {
		zero(ev.SignedBundle)
		zero(ev.MandateChain)
		for _, d := range ev.DelegatorBundles {
			zero(d)
		}
		zero(op.TrustSetJSON)
		zero(op.ProfileJSON)
		zero(op.Revocation)
		zero(op.MandateRevocation)
	}}
	r, err := v2.AdmitDelegatedBundleV2(delegatedRegistry(p), ev, op)
	if err != nil || !p.once || !r.Admitted || len(r.Errors) != 0 {
		t.Fatalf("after the snapshot: %v %v %v", err, p.once, r)
	}
	a, _ := json.Marshal(baseline.Inputs)
	b, _ := json.Marshal(r.Inputs)
	if !bytes.Equal(a, b) {
		t.Fatalf("inputs %s, want %s", b, a)
	}
}

func TestDelegatedLoadedAndRawConfiguration(t *testing.T) {
	v, cases, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	c := caseNamed(t, cases, "principal_orchestrator_subagent")
	store, err := v2.NewPrincipalTrustStore(v.TrustSets[c.Trust])
	if err != nil {
		t.Fatal(err)
	}
	profile, err := v2.ResolveStrictV1Profile(v.Profiles[*c.Profile])
	if err != nil {
		t.Fatal(err)
	}
	op := operatorOf(v, c, now)
	op.TrustSetJSON, op.ProfileJSON, op.Trust, op.Profile = nil, nil, store, profile
	loaded, err := v2.AdmitDelegatedBundleV2(reg, evidenceOf(v, c), op)
	if err != nil || !loaded.Admitted {
		t.Fatalf("loaded: %v %v", err, loaded)
	}
	both := operatorOf(v, c, now)
	both.Trust = store
	var cfg *v2.AdmissionConfigError
	if _, err := v2.AdmitDelegatedBundleV2(reg, evidenceOf(v, c), both); !errors.As(err, &cfg) || cfg.Code != "CONFIG_INVALID_VALUE" {
		t.Fatalf("a loaded store and a trust set: %v", err)
	}
	unloaded := operatorOf(v, c, now)
	unloaded.TrustSetJSON, unloaded.Trust = nil, &v2.PrincipalTrustStore{}
	if _, err := v2.AdmitDelegatedBundleV2(reg, evidenceOf(v, c), unloaded); !errors.As(err, &cfg) || cfg.Code != "CONFIG_INVALID_VALUE" {
		t.Fatalf("a store not loaded by the package: %v", err)
	}
}

func TestDelegatedEvidenceMustBeJSON(t *testing.T) {
	v, cases, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	c := caseNamed(t, cases, "principal_orchestrator_subagent")
	for name, edit := range map[string]func(*v2.DelegatedEvidence){
		"leaf not JSON":         func(e *v2.DelegatedEvidence) { e.SignedBundle = []byte(`{"bundle":`) },
		"chain not JSON":        func(e *v2.DelegatedEvidence) { e.MandateChain = []byte(`[`) },
		"chain not an array":    func(e *v2.DelegatedEvidence) { e.MandateChain = []byte(`{}`) },
		"delegator not JSON":    func(e *v2.DelegatedEvidence) { e.DelegatorBundles[0] = []byte(`nope`) },
		"trailing data in leaf": func(e *v2.DelegatedEvidence) { e.SignedBundle = append(bytes.Clone(e.SignedBundle), []byte(` {}`)...) },
	} {
		ev := evidenceOf(v, c)
		edit(&ev)
		r, err := v2.AdmitDelegatedBundleV2(reg, ev, operatorOf(v, c, now))
		if err != nil || r.Admitted || !slices.Equal(codesOf(r), []string{"DELEGATION_INPUT_INVALID"}) {
			t.Fatalf("%s: %v %v", name, err, r)
		}
	}
}
