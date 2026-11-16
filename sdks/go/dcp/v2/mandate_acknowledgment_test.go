package v2_test

// Mandate acknowledgment (MP-02 F4): the frozen tests/interop/v2/mandate_acknowledgment_vectors.json through the
// public API, with every record given as the bytes the file holds (json.RawMessage), and what the vectors cannot
// express: the composition equal to AdmitDelegatedBundleV2, nil and empty slices, the bytes contract of design
// § 2.2 (the long-mantissa case chosen by the real parse, and a private altered decoder), the snapshot against a
// provider that changes the caller's slices, an altered PQ component with a valid classical one, the creation
// contract, the new context and the record tables against their schemas. Mirrors
// sdks/typescript/src/__tests__/mandate-acknowledgment.test.ts.
//
// Four PREC cases give a container that is not an array; [][]byte cannot represent one, so they do not apply to
// this typed API and are counted as excluded, not converted.

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
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

type ackExpected struct {
	CompositionAdmitted bool     `json:"composition_admitted"`
	Activation          string   `json:"activation"`
	DelegationActive    bool     `json:"delegation_active"`
	Codes               []string `json:"codes"`
	Verified            []bool   `json:"verified"`
}

type ackCase struct {
	Name                    string          `json:"name"`
	Group                   string          `json:"group"`
	Rule                    string          `json:"rule"`
	Leaf                    string          `json:"leaf"`
	Chain                   []string        `json:"chain"`
	Delegators              []string        `json:"delegators"`
	Acknowledgments         json.RawMessage `json:"acknowledgments"`
	AwarenessThresholds     json.RawMessage `json:"awareness_thresholds"`
	Profile                 *string         `json:"profile"`
	Policy                  *string         `json:"policy"`
	MaxRevocationAgeSeconds *int            `json:"max_revocation_age_seconds"`
	Trust                   string          `json:"trust"`
	Revocation              string          `json:"revocation"`
	MandateRevocation       string          `json:"mandate_revocation"`
	Expected                ackExpected     `json:"expected"`
}

type ackReplace struct {
	Container string `json:"container"`
	Index     int    `json:"index"`
}

type ackVectors struct {
	Now              string `json:"now"`
	DomainSeparation struct {
		Context          string `json:"context"`
		PayloadCanonical string `json:"payload_canonical"`
		DsmHex           string `json:"dsm_hex"`
	} `json:"domain_separation"`
	SignedBundles       map[string]json.RawMessage `json:"signed_bundles"`
	Mandates            map[string]json.RawMessage `json:"mandates"`
	AwarenessThresholds map[string]json.RawMessage `json:"awareness_thresholds"`
	Acknowledgments     map[string]json.RawMessage `json:"acknowledgments"`
	TrustSets           map[string]json.RawMessage `json:"trust_sets"`
	Profiles            map[string]json.RawMessage `json:"profiles"`
	Policies            map[string]json.RawMessage `json:"policies"`
	Revocations         map[string]json.RawMessage `json:"revocations"`
	MandateRevocations  map[string]json.RawMessage `json:"mandate_revocations"`
	Cases               []ackCase                  `json:"cases"`
	TextCases           []struct {
		Name          string     `json:"name"`
		BaseCase      string     `json:"base_case"`
		Replace       ackReplace `json:"replace"`
		Text          string     `json:"text"`
		ExpectedCodes []string   `json:"expected_codes"`
	} `json:"text_cases"`
	GoBytesCases []struct {
		Name                    string     `json:"name"`
		BaseCase                string     `json:"base_case"`
		Replace                 ackReplace `json:"replace"`
		GoText                  string     `json:"go_text"`
		ExpectedExactValue      float64    `json:"expected_exact_value"`
		ExpectedCanonicalOf     string     `json:"expected_canonical_of"`
		ExpectedCanonicalSHA256 string     `json:"expected_canonical_sha256"`
		Expectations            map[string]struct {
			Activation       string   `json:"activation"`
			DelegationActive bool     `json:"delegation_active"`
			Codes            []string `json:"codes"`
		} `json:"expectations"`
	} `json:"go_bytes_cases"`
}

const frozenAckCorpus = "e98a14a0ef8ecaff7a08bf394b7555f0d0ae69c29aac1b6b1ec75527f9503f8b"

func loadAckVectors(t *testing.T) (*ackVectors, []byte, time.Time) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "tests", "interop", "v2", "mandate_acknowledgment_vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v ackVectors
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	now, err := time.Parse(time.RFC3339Nano, v.Now)
	if err != nil {
		t.Fatal(err)
	}
	return &v, data, now
}

// names is the list of record names of a container, or ok false for a container that is not an array.
func names(raw json.RawMessage) ([]string, bool) {
	var list []string
	if json.Unmarshal(raw, &list) != nil {
		return nil, false
	}
	return list, true
}

func ackOperator(v *ackVectors, c ackCase, now time.Time) v2.DelegatedOperator {
	op := v2.DelegatedOperator{
		TrustSetJSON:      v.TrustSets[c.Trust],
		Revocation:        v.Revocations[c.Revocation],
		MandateRevocation: v.MandateRevocations[c.MandateRevocation],
		Now:               now,
	}
	if c.Profile != nil {
		op.ProfileJSON = v.Profiles[*c.Profile]
	}
	if c.Policy != nil {
		op.Policy = v.Policies[*c.Policy]
	}
	if c.MaxRevocationAgeSeconds != nil {
		op.MaxRevocationAgeSeconds = *c.MaxRevocationAgeSeconds
	}
	return op
}

func rawList(from map[string]json.RawMessage, ns []string) [][]byte {
	out := make([][]byte, len(ns))
	for i, n := range ns {
		out[i] = bytes.Clone(from[n])
	}
	return out
}

// ackEvidence builds the typed evidence of a case whose containers are arrays.
func ackEvidence(t *testing.T, v *ackVectors, c ackCase) v2.ActivationEvidence {
	t.Helper()
	acks, ok1 := names(c.Acknowledgments)
	thresholds, ok2 := names(c.AwarenessThresholds)
	if !ok1 || !ok2 {
		t.Fatalf("%s: a container that is not an array cannot be represented", c.Name)
	}
	chain := make([][]byte, len(c.Chain))
	for i, n := range c.Chain {
		chain[i] = v.Mandates[n]
	}
	return v2.ActivationEvidence{
		DelegatedEvidence: v2.DelegatedEvidence{
			SignedBundle:     bytes.Clone(v.SignedBundles[c.Leaf]),
			MandateChain:     append(append([]byte("["), bytes.Join(chain, []byte(","))...), ']'),
			DelegatorBundles: rawList(v.SignedBundles, c.Delegators),
		},
		Acknowledgments:     rawList(v.Acknowledgments, acks),
		AwarenessThresholds: rawList(v.AwarenessThresholds, thresholds),
	}
}

func ackOutcome(r *v2.DelegationActivationResult) ackExpected {
	out := ackExpected{
		CompositionAdmitted: r.Composition.Admitted,
		Activation:          r.Activation,
		DelegationActive:    r.DelegationActive,
		Codes:               []string{},
		Verified:            []bool{},
	}
	for _, e := range r.Errors {
		out.Codes = append(out.Codes, e.Code)
	}
	for _, a := range r.Acknowledgments {
		out.Verified = append(out.Verified, a.Verified)
	}
	return out
}

func ackJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func caseByName(t *testing.T, v *ackVectors, name string) ackCase {
	t.Helper()
	for _, c := range v.Cases {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no case %s", name)
	return ackCase{}
}

func TestMandateAcknowledgmentCorpus(t *testing.T) {
	v, data, now := loadAckVectors(t)
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != frozenAckCorpus {
		t.Fatalf("the corpus is not the frozen one")
	}
	if len(v.Cases) != 93 || len(v.TextCases) != 3 || len(v.GoBytesCases) != 1 {
		t.Fatalf("%d cases, %d text cases, %d Go bytes cases", len(v.Cases), len(v.TextCases), len(v.GoBytesCases))
	}
	reg := delegatedRegistry(nil)
	var excluded []string
	applicable := 0
	for _, c := range v.Cases {
		_, ok1 := names(c.Acknowledgments)
		_, ok2 := names(c.AwarenessThresholds)
		if !ok1 || !ok2 {
			excluded = append(excluded, c.Name)
			continue
		}
		applicable++
		t.Run(c.Group+"/"+c.Name, func(t *testing.T) {
			evidence := ackEvidence(t, v, c)
			r, err := v2.EvaluateDelegationActivationV2(reg, evidence, ackOperator(v, c, now))
			if err != nil {
				t.Fatal(err)
			}
			if got := ackOutcome(r); !reflect.DeepEqual(got, c.Expected) {
				t.Fatalf("got %s, want %s; %s", ackJSON(t, got), ackJSON(t, c.Expected), ackJSON(t, r.Errors))
			}
			if r.ActionAuthorized || r.Composition.ActionAuthorized || r.Composition.Activation != "not_evaluated" {
				t.Fatal("activation or authorization")
			}
			f2, err := v2.AdmitDelegatedBundleV2(reg, evidence.DelegatedEvidence, ackOperator(v, c, now))
			if err != nil || ackJSON(t, r.Composition) != ackJSON(t, f2) {
				t.Fatalf("the composition differs from AdmitDelegatedBundleV2: %v", err)
			}
			acks, _ := names(c.Acknowledgments)
			thresholds, _ := names(c.AwarenessThresholds)
			if r.Inputs.Acknowledgments != len(acks) || r.Inputs.AwarenessThresholds != len(thresholds) || r.Inputs.Now != now.UnixMilli() {
				t.Fatalf("inputs %+v", r.Inputs)
			}
		})
	}
	sort.Strings(excluded)
	want := []string{"acknowledgments_not_an_array", "both_containers_invalid", "rejected_composition_invalid_container", "thresholds_not_an_array"}
	if applicable != 89 || !reflect.DeepEqual(excluded, want) {
		t.Fatalf("applicable %d, excluded %v", applicable, excluded)
	}
}

func TestMandateAcknowledgmentNilAndEmptySlices(t *testing.T) {
	v, _, now := loadAckVectors(t)
	reg := delegatedRegistry(nil)
	c := caseByName(t, v, "no_acknowledgments")
	for name, set := range map[string]func(*v2.ActivationEvidence){
		"nil":   func(e *v2.ActivationEvidence) { e.Acknowledgments, e.AwarenessThresholds = nil, nil },
		"empty": func(e *v2.ActivationEvidence) { e.Acknowledgments, e.AwarenessThresholds = [][]byte{}, [][]byte{} },
	} {
		evidence := ackEvidence(t, v, c)
		set(&evidence)
		r, err := v2.EvaluateDelegationActivationV2(reg, evidence, ackOperator(v, c, now))
		if err != nil {
			t.Fatal(err)
		}
		if got := ackOutcome(r); !reflect.DeepEqual(got, c.Expected) || r.Inputs.Acknowledgments != 0 {
			t.Fatalf("%s: got %s, want %s", name, ackJSON(t, got), ackJSON(t, c.Expected))
		}
	}
}

func TestMandateAcknowledgmentTextCasesAsBytes(t *testing.T) {
	v, _, now := loadAckVectors(t)
	reg := delegatedRegistry(nil)
	for _, tc := range v.TextCases {
		t.Run(tc.Name, func(t *testing.T) {
			base := caseByName(t, v, tc.BaseCase)
			evidence := ackEvidence(t, v, base)
			target := &evidence.AwarenessThresholds
			if tc.Replace.Container == "acknowledgments" {
				target = &evidence.Acknowledgments
			}
			(*target)[tc.Replace.Index] = []byte(tc.Text)
			r, err := v2.EvaluateDelegationActivationV2(reg, evidence, ackOperator(v, base, now))
			if err != nil {
				t.Fatal(err)
			}
			if got := ackOutcome(r).Codes; !reflect.DeepEqual(got, tc.ExpectedCodes) || r.DelegationActive {
				t.Fatalf("codes %v, want %v", got, tc.ExpectedCodes)
			}
		})
	}
}

// The long-mantissa case (design § 2.2): Go decodes go_text with its real parser and the expectation is chosen
// by whether that value reproduces the canonical bytes of the exact value; no runtime's behavior is assumed.
func TestMandateAcknowledgmentGoBytesCaseChosenByTheRealParse(t *testing.T) {
	v, _, now := loadAckVectors(t)
	reg := delegatedRegistry(nil)
	for _, g := range v.GoBytesCases {
		scanned, err := v2.ExperimentalCandidateIngress([]byte(v.AwarenessThresholds["thr_root_one"]))
		if err != nil || !scanned.Accepted {
			t.Fatal("the host threshold is not accepted by the scanner")
		}
		sum := sha256.Sum256(scanned.Canonical)
		if g.ExpectedCanonicalOf != "awareness_thresholds.thr_root_one" || hex.EncodeToString(sum[:]) != g.ExpectedCanonicalSHA256 || g.ExpectedExactValue != 1 {
			t.Fatal("the case's canonical bytes are not the host threshold's")
		}
		var parsed any
		matches := false
		if json.Unmarshal([]byte(g.GoText), &parsed) == nil {
			if canonical, err := v2.CanonicalizeV2(parsed); err == nil {
				matches = bytes.Equal([]byte(canonical), scanned.Canonical)
			}
		}
		branch := "parser_differs_or_fails"
		if matches {
			branch = "parser_matches_canonical"
		}
		t.Logf("runtime observation: json.Unmarshal of the long mantissa %s", map[bool]string{true: "reproduces the exact value", false: "does not reproduce the exact value"}[matches])
		want := g.Expectations[branch]
		base := caseByName(t, v, g.BaseCase)
		evidence := ackEvidence(t, v, base)
		evidence.AwarenessThresholds[g.Replace.Index] = []byte(g.GoText)
		r, err := v2.EvaluateDelegationActivationV2(reg, evidence, ackOperator(v, base, now))
		if err != nil {
			t.Fatal(err)
		}
		got := ackOutcome(r)
		if got.Activation != want.Activation || got.DelegationActive != want.DelegationActive || !reflect.DeepEqual(got.Codes, want.Codes) {
			t.Fatalf("%s: got %s, want %+v", branch, ackJSON(t, got), want)
		}
	}
}

// A private decoder that alters every decoded object exercises ACK_PARSER_MISMATCH whatever the runtime does.
func TestMandateAcknowledgmentAlteredDecoder(t *testing.T) {
	v, _, now := loadAckVectors(t)
	reg := delegatedRegistry(nil)
	base := caseByName(t, v, "root_only")
	altered := func(b []byte) (any, error) {
		var x any
		if err := json.Unmarshal(b, &x); err != nil {
			return nil, err
		}
		if m, ok := x.(map[string]interface{}); ok {
			m["extra"] = true
		}
		return x, nil
	}
	failing := func([]byte) (any, error) { return nil, errors.New("broken decoder") }
	for name, decode := range map[string]func([]byte) (any, error){"altered": altered, "failing": failing} {
		r, err := v2.EvaluateDelegationActivationWithDecoderForTests(reg, ackEvidence(t, v, base), ackOperator(v, base, now), decode)
		if err != nil {
			t.Fatal(err)
		}
		if got := ackOutcome(r); got.Activation != "evaluated" || got.DelegationActive || !reflect.DeepEqual(got.Codes, []string{"ACK_PARSER_MISMATCH", "ACK_PARSER_MISMATCH"}) {
			t.Fatalf("%s: got %s", name, ackJSON(t, got))
		}
	}
	r, err := v2.EvaluateDelegationActivationWithDecoderForTests(reg, ackEvidence(t, v, base), ackOperator(v, base, now), func(b []byte) (any, error) {
		var x any
		err := json.Unmarshal(b, &x)
		return x, err
	})
	if err != nil || !r.DelegationActive {
		t.Fatalf("the real decoder through the same route: %v %s", err, ackJSON(t, ackOutcome(r)))
	}
}

func TestMandateAcknowledgmentSnapshot(t *testing.T) {
	v, _, now := loadAckVectors(t)
	c := caseByName(t, v, "depth_two_any_order")
	evidence := ackEvidence(t, v, c)
	before := ackJSON(t, evidence)
	tampering := &tamperingEd25519{tamper: func() {
		for _, list := range [][][]byte{evidence.Acknowledgments, evidence.AwarenessThresholds, evidence.DelegatorBundles} {
			for _, b := range list {
				for i := range b {
					b[i] = ' '
				}
			}
		}
		for i := range evidence.MandateChain {
			evidence.MandateChain[i] = ' '
		}
	}}
	r, err := v2.EvaluateDelegationActivationV2(delegatedRegistry(tampering), evidence, ackOperator(v, c, now))
	if err != nil {
		t.Fatal(err)
	}
	if !tampering.once || ackJSON(t, evidence) == before {
		t.Fatal("the provider did not change the caller's slices")
	}
	if got := ackOutcome(r); !reflect.DeepEqual(got, c.Expected) {
		t.Fatalf("got %s, want %s", ackJSON(t, got), ackJSON(t, c.Expected))
	}
}

func flipPQ(t *testing.T, raw []byte) []byte {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	pq := m["composite_sig"].(map[string]interface{})["pq"].(map[string]interface{})
	sig, _ := base64.StdEncoding.DecodeString(pq["sig_b64"].(string))
	sig[200] ^= 1
	pq["sig_b64"] = base64.StdEncoding.EncodeToString(sig)
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestMandateAcknowledgmentAlteredPQWithValidClassical(t *testing.T) {
	v, _, now := loadAckVectors(t)
	reg := delegatedRegistry(nil)
	base := caseByName(t, v, "root_only")
	for _, policy := range []string{"profile strict", "pq_only", "weak_classical"} {
		for _, target := range []struct{ container, code string }{{"awareness_thresholds", "ACK_THRESHOLD_SIGNATURE_INVALID"}, {"acknowledgments", "ACK_SIGNATURE_INVALID"}} {
			t.Run(target.container+" under "+policy, func(t *testing.T) {
				c := base
				if policy != "profile strict" {
					p, maxAge := policy, 300
					c.Profile, c.Policy, c.MaxRevocationAgeSeconds = nil, &p, &maxAge
				}
				evidence := ackEvidence(t, v, c)
				if target.container == "acknowledgments" {
					evidence.Acknowledgments[0] = flipPQ(t, evidence.Acknowledgments[0])
				} else {
					evidence.AwarenessThresholds[0] = flipPQ(t, evidence.AwarenessThresholds[0])
				}
				r, err := v2.EvaluateDelegationActivationV2(reg, evidence, ackOperator(v, c, now))
				if err != nil {
					t.Fatal(err)
				}
				if got := ackOutcome(r); !got.CompositionAdmitted || got.DelegationActive || !reflect.DeepEqual(got.Codes, []string{target.code}) {
					t.Fatalf("got %s", ackJSON(t, got))
				}
			})
		}
	}
}

func TestMandateAcknowledgmentContext(t *testing.T) {
	v, _, _ := loadAckVectors(t)
	d := v.DomainSeparation
	if d.Context != v2.CtxMandateAcknowledgment {
		t.Fatal("context")
	}
	dsm, err := v2.DomainSeparatedMessage(v2.CtxMandateAcknowledgment, []byte(d.PayloadCanonical))
	if err != nil || hex.EncodeToString(dsm) != d.DsmHex {
		t.Fatalf("the domain-separated message is not the corpus vector: %v", err)
	}
	if !v2.ValidContextForTests(v2.CtxMandateAcknowledgment) || v2.CandidateContextForTests(v2.CtxMandateAcknowledgment) {
		t.Fatal("the context must be valid and kept out of the experimental producer")
	}
}

func TestMandateAcknowledgmentTablesMatchSchemas(t *testing.T) {
	read := func(name string) map[string]interface{} {
		data, err := os.ReadFile(filepath.Join(repoRoot(t), "schemas", "v2", name))
		if err != nil {
			t.Fatal(err)
		}
		var s map[string]interface{}
		if err := json.Unmarshal(data, &s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	keysOf := func(m interface{}) []string {
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
		return out
	}
	sorted := func(l []string) []string { c := slices.Clone(l); sort.Strings(c); return c }
	ack := read("mandate_acknowledgment.schema.json")
	if ack["additionalProperties"] != false || !reflect.DeepEqual(keysOf(ack["properties"]), sorted(v2.AckFieldsForTests)) || !reflect.DeepEqual(sorted(strs(ack["required"])), sorted(v2.AckFieldsForTests)) {
		t.Fatal("acknowledgment table")
	}
	if ack["properties"].(map[string]interface{})["acknowledgment_format"].(map[string]interface{})["const"] != v2.MandateAcknowledgmentFormat {
		t.Fatal("format")
	}
	th := read("awareness_threshold.schema.json")
	if th["additionalProperties"] != false || !reflect.DeepEqual(keysOf(th["properties"]), sorted(v2.ThresholdFieldsForTests)) || !reflect.DeepEqual(sorted(strs(th["required"])), sorted(v2.ThresholdFieldsForTests)) {
		t.Fatal("threshold table")
	}
	rule := th["properties"].(map[string]interface{})["threshold_rules"].(map[string]interface{})["items"].(map[string]interface{})
	props := rule["properties"].(map[string]interface{})
	if !reflect.DeepEqual(keysOf(props), sorted(v2.RuleFieldsForTests)) || !reflect.DeepEqual(sorted(strs(rule["required"])), sorted(v2.RuleFieldsForTests)) ||
		!reflect.DeepEqual(strs(props["operator"].(map[string]interface{})["enum"]), v2.RuleOperatorsForTests) ||
		!reflect.DeepEqual(strs(props["action_if_triggered"].(map[string]interface{})["enum"]), v2.RuleActionsForTests) {
		t.Fatal("rule table")
	}
}

func TestMandateAcknowledgmentIntegerDomain(t *testing.T) {
	for _, c := range []struct {
		v  interface{}
		ok bool
	}{{9007199254740991.0, true}, {-9007199254740991.0, true}, {9007199254740992.0, false}, {-9007199254740992.0, false}, {5.0, true}, {1.5, false}, {true, false}, {"1", false}} {
		if v2.IsSafeIntegerValueForTests(c.v) != c.ok {
			t.Fatalf("%v", c.v)
		}
	}
}

// ── Creation (design § 3.2) ──

type countingEd25519 struct {
	providers.Ed25519Provider
	signs int
}

func (p *countingEd25519) Sign(message []byte, secretKeyB64 string) ([]byte, error) {
	p.signs++
	return p.Ed25519Provider.Sign(message, secretKeyB64)
}

func freshAckKeys(t *testing.T) (v2.CompositeKeyInfo, v2.CompositeKeyInfo) {
	t.Helper()
	c, err := (&providers.Ed25519Provider{}).GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	p, err := (&providers.MlDsa65Provider{}).GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	return v2.CompositeKeyInfo{Kid: c.Kid, Alg: "ed25519", SecretKeyB64: c.SecretKeyB64, PublicKeyB64: c.PublicKeyB64},
		v2.CompositeKeyInfo{Kid: p.Kid, Alg: "ml-dsa-65", SecretKeyB64: p.SecretKeyB64, PublicKeyB64: p.PublicKeyB64}
}

func creationChain(v *ackVectors, root string) []byte {
	return append(append(append([]byte("["), v.Mandates[root]...), ','), append(append([]byte{}, v.Mandates["sub"]...), ']')...)
}

func creationThreshold(t *testing.T, v *ackVectors, classical, pq v2.CompositeKeyInfo, over map[string]interface{}) []byte {
	t.Helper()
	var sub map[string]interface{}
	if err := json.Unmarshal(v.Mandates["sub"], &sub); err != nil {
		t.Fatal(err)
	}
	payload := map[string]interface{}{
		"dcp_version": "2.0", "threshold_id": "threshold:creation", "session_nonce": sub["session_nonce"], "agent_id": sub["agent_id"],
		"human_id": sub["human_id"], "threshold_rules": []interface{}{map[string]interface{}{"dimension": "spend", "operator": "gt", "value": 100, "action_if_triggered": "notify"}},
		"timestamp": "2026-11-02T01:00:00.000Z",
	}
	for k, x := range over {
		payload[k] = x
	}
	canonical, err := v2.CanonicalizeV2(payload)
	if err != nil {
		t.Fatal(err)
	}
	sig, err := v2.CompositeSign(delegatedRegistry(nil), v2.CtxAwareness, []byte(canonical), classical, pq)
	if err != nil {
		t.Fatal(err)
	}
	payload["composite_sig"] = sig
	out, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestCreateMandateAcknowledgment(t *testing.T) {
	v, _, _ := loadAckVectors(t)
	classical, pq := freshAckKeys(t)
	params := v2.MandateAcknowledgmentParams{
		MandateChain:       creationChain(v, "root"),
		AwarenessThreshold: creationThreshold(t, v, classical, pq, nil),
		AcknowledgmentID:   "ack:creation",
		AcknowledgedAt:     "2026-11-02T02:00:00Z",
	}
	before := ackJSON(t, params)
	a, err := v2.CreateMandateAcknowledgment(delegatedRegistry(nil), classical, pq, params)
	if err != nil {
		t.Fatal(err)
	}
	if ackJSON(t, params) != before {
		t.Fatal("an input was modified")
	}
	if e := v2.AcknowledgmentFormErrorForTests(a); e != "" {
		t.Fatal(e)
	}
	var root, sub, threshold map[string]interface{}
	_ = json.Unmarshal(v.Mandates["root"], &root)
	_ = json.Unmarshal(v.Mandates["sub"], &sub)
	_ = json.Unmarshal(params.AwarenessThreshold, &threshold)
	mh, _ := v2.MandateHashForTests(sub)
	ch, _ := v2.ChainHashesForTests([]map[string]interface{}{root, sub})
	th, _ := v2.ThresholdHashForTests(threshold)
	want := map[string]interface{}{
		"dcp_version": "2.0", "acknowledgment_format": v2.MandateAcknowledgmentFormat, "acknowledgment_id": "ack:creation",
		"mandate_id": sub["mandate_id"], "mandate_hash": mh, "chain_hash": ch[1], "session_nonce": sub["session_nonce"],
		"human_id": sub["human_id"], "agent_id": sub["agent_id"], "awareness_threshold_id": "threshold:creation",
		"awareness_threshold_hash": th, "acknowledged_at": "2026-11-02T02:00:00Z",
	}
	unsigned := map[string]interface{}{}
	for k, x := range a {
		if k != "composite_sig" {
			unsigned[k] = x
		}
	}
	if !reflect.DeepEqual(unsigned, want) {
		t.Fatalf("got %s", ackJSON(t, unsigned))
	}
	canonical, _ := v2.CanonicalizeV2(unsigned)
	raw, _ := json.Marshal(a["composite_sig"])
	var cs v2.CompositeSignature
	if err := json.Unmarshal(raw, &cs); err != nil {
		t.Fatal(err)
	}
	r, err := v2.CompositeVerify(delegatedRegistry(nil), v2.CtxMandateAcknowledgment, []byte(canonical), &cs, classical.PublicKeyB64, pq.PublicKeyB64)
	if err != nil || !r.Valid || !r.ClassicalValid || !r.PQValid {
		t.Fatal("the acknowledgment does not verify")
	}
}

func TestCreateMandateAcknowledgmentRejectsWithoutSigning(t *testing.T) {
	v, _, _ := loadAckVectors(t)
	classical, pq := freshAckKeys(t)
	thr := func(over map[string]interface{}) []byte { return creationThreshold(t, v, classical, pq, over) }
	var sub map[string]interface{}
	_ = json.Unmarshal(v.Mandates["sub"], &sub)
	var root map[string]interface{}
	_ = json.Unmarshal(v.Mandates["root"], &root)
	type rejection struct {
		name      string
		classical v2.CompositeKeyInfo
		pq        v2.CompositeKeyInfo
		params    v2.MandateAcknowledgmentParams
	}
	base := func() v2.MandateAcknowledgmentParams {
		return v2.MandateAcknowledgmentParams{MandateChain: creationChain(v, "root"), AwarenessThreshold: thr(nil), AcknowledgmentID: "ack:creation", AcknowledgedAt: "2026-11-02T02:00:00Z"}
	}
	with := func(edit func(*v2.MandateAcknowledgmentParams)) v2.MandateAcknowledgmentParams {
		p := base()
		edit(&p)
		return p
	}
	badPQ, badClassical := pq, classical
	badPQ.Kid = "x"
	badClassical.Kid = pq.Kid
	bigValue := thr(map[string]interface{}{"threshold_rules": []interface{}{map[string]interface{}{"dimension": "spend", "operator": "gt", "value": 9007199254740991, "action_if_triggered": "notify"}}})
	bigValue = bytes.Replace(bigValue, []byte(`"value":9007199254740991`), []byte(`"value":9007199254740992`), 1)
	cases := []rejection{
		{"an acknowledgment id that is not valid UTF-8 (the Go form of the independent review's lone surrogate)", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) { p.AcknowledgmentID = "ack:lone-\xed\xa0\x80" })},
		{"a pq kid that is not the derived kid (independent review)", classical, badPQ, base()},
		{"a classical kid of another key", badClassical, pq, base()},
		{"a threshold of another agent", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) {
			p.AwarenessThreshold = thr(map[string]interface{}{"agent_id": root["agent_id"]})
		})},
		{"a threshold of another session", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) {
			p.AwarenessThreshold = thr(map[string]interface{}{"session_nonce": root["session_nonce"]})
		})},
		{"an instant before the mandate", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) {
			p.AwarenessThreshold = thr(map[string]interface{}{"timestamp": "2026-11-01T00:00:00Z"})
			p.AcknowledgedAt = "2026-11-01T23:59:59.999Z"
		})},
		{"an instant before the threshold", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) { p.AcknowledgedAt = "2026-11-02T00:30:00Z" })},
		{"an instant after valid_until", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) { p.AcknowledgedAt = "2027-11-01T00:00:00.001Z" })},
		{"a threshold value outside +-(2^53 - 1), rejected by the bytes contract", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) { p.AwarenessThreshold = bigValue })},
		{"an identifier of five astral code points", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) { p.AcknowledgmentID = "😀😀😀😀😀" })},
		{"a chain whose sub-mandate does not name its parent", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) { p.MandateChain = creationChain(v, "root_future") })},
		{"a threshold given as bytes with a lone surrogate escape", classical, pq, with(func(p *v2.MandateAcknowledgmentParams) {
			p.AwarenessThreshold = bytes.Replace(thr(nil), []byte(`"dimension":"spend"`), []byte(`"dimension":"spend\ud800"`), 1)
		})},
	}
	// The creation guard on the raw chain (independent review): bytes the decoder would repair or collapse.
	chain := creationChain(v, "root")
	if bytes.Count(chain, []byte(`"mandate:acme-sub"`)) != 1 {
		t.Fatal("the sub-mandate id is not unique in the chain")
	}
	rawChain := func(old, new string) v2.MandateAcknowledgmentParams {
		return with(func(p *v2.MandateAcknowledgmentParams) {
			p.MandateChain = bytes.Replace(chain, []byte(old), []byte(new), 1)
		})
	}
	cases = append(cases,
		rejection{"a raw chain whose mandate_id escapes a lone surrogate", classical, pq, rawChain(`"mandate:acme-sub"`, `"mandate:\ud800"`)},
		rejection{"a raw chain with a byte that is not UTF-8", classical, pq, rawChain(`"mandate:acme-sub"`, "\"mandate:acme-\xffsub\"")},
		rejection{"a raw chain with a repeated key", classical, pq, rawChain(`"mandate_id": "mandate:acme-sub"`, `"mandate_id": "mandate:other-x", "mandate_id": "mandate:acme-sub"`)},
	)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			spy := &countingEd25519{}
			_, err := v2.CreateMandateAcknowledgment(delegatedRegistry(spy), c.classical, c.pq, c.params)
			if err == nil || !strings.HasPrefix(err.Error(), "create mandate acknowledgment: ") {
				t.Fatalf("not rejected: %v", err)
			}
			if spy.signs != 0 {
				t.Fatalf("signed %d times before rejecting", spy.signs)
			}
			if strings.HasPrefix(c.name, "a raw chain") && !strings.Contains(err.Error(), "the mandate chain: bytes rejected: ") {
				t.Fatalf("not rejected by the bytes contract of the chain: %v", err)
			}
			if strings.Contains(err.Error(), classical.SecretKeyB64) || strings.Contains(err.Error(), pq.SecretKeyB64) {
				t.Fatal("the error names a secret")
			}
		})
	}
	_ = sub
}

// A decoder that does not reproduce the scanner's canonical bytes is rejected before signing; the real decoder
// through the same route signs (the valid control).
func TestCreateMandateAcknowledgmentParserDiscrepancy(t *testing.T) {
	v, _, _ := loadAckVectors(t)
	classical, pq := freshAckKeys(t)
	params := v2.MandateAcknowledgmentParams{
		MandateChain:       creationChain(v, "root"),
		AwarenessThreshold: creationThreshold(t, v, classical, pq, nil),
		AcknowledgmentID:   "ack:creation",
		AcknowledgedAt:     "2026-11-02T02:00:00Z",
	}
	real := func(b []byte) (any, error) {
		var x any
		err := json.Unmarshal(b, &x)
		return x, err
	}
	altered := func(b []byte) (any, error) {
		x, err := real(b)
		switch y := x.(type) {
		case map[string]interface{}:
			y["extra"] = true
		case []interface{}:
			if len(y) > 0 {
				if m, ok := y[0].(map[string]interface{}); ok {
					m["extra"] = true
				}
			}
		}
		return x, err
	}
	spy := &countingEd25519{}
	if _, err := v2.CreateMandateAcknowledgmentWithDecoderForTests(delegatedRegistry(spy), classical, pq, params, altered); err == nil || !strings.Contains(err.Error(), "does not reproduce the scanner's canonical bytes") || spy.signs != 0 {
		t.Fatalf("altered decoder: %v, %d signatures", err, spy.signs)
	}
	control := &countingEd25519{}
	a, err := v2.CreateMandateAcknowledgmentWithDecoderForTests(delegatedRegistry(control), classical, pq, params, real)
	if err != nil || control.signs == 0 || v2.AcknowledgmentFormErrorForTests(a) != "" {
		t.Fatalf("the valid control does not sign: %v", err)
	}
}
