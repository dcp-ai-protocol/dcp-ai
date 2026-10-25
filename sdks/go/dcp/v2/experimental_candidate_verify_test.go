package v2_test

// Experimental candidate dcp-jcs-v2, phase 3: the bytes verifier against the public signed vectors
// (tests/interop/candidate/phase3-signed-vectors.json) and the controls of the contract: the verifiers
// entered (one at most, through the test-only probe), the decoder calls, parity of the delegation with
// VerifySignedBundleV2At on the unit bytes, the canonical bytes of every committed value, the profile
// policy, the closed adapter name (the exported adapter changed before and after creation changes
// nothing), buffers the caller mutates, and today's API still refusing dcp-jcs-v2.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type p3Expected struct {
	Route struct {
		Outcome        string          `json:"outcome"`
		Class          *string         `json:"class"`
		Detail         *string         `json:"detail"`
		Offset         *int            `json:"offset"`
		Profile        json.RawMessage `json:"profile"`
		ProfileSource  *string         `json:"profile_source"`
		WarningClasses []string        `json:"warning_classes"`
		Historical     *string         `json:"historical"`
	} `json:"route"`
	AdapterCalls int    `json:"adapter_calls"`
	Entered      string `json:"entered"`
	Verification *struct {
		Verified      bool                `json:"verified"`
		ErrorsContain map[string][]string `json:"errors_contain"`
	} `json:"verification"`
	ManifestSHA256  string `json:"manifest_sha256"`
	CanonicalSHA256 string `json:"canonical_sha256"`
}

type p3Case struct {
	ID    string `json:"id"`
	Input struct {
		Base  string           `json:"base"`
		Edits []map[string]any `json:"edits"`
	} `json:"input"`
	InputSHA256      string                `json:"input_sha256"`
	Transport        string                `json:"transport"`
	AcceptedProfiles []string              `json:"accepted_profiles"`
	VerifierPolicy   string                `json:"verifier_policy"`
	Expected         p3Expected            `json:"expected"`
	ByAdapter        map[string]p3Expected `json:"by_adapter"`
}

type p3Vectors struct {
	NowMs            int64                     `json:"now_ms"`
	VerifierPolicies map[string]map[string]any `json:"verifier_policies"`
	Bases            map[string]struct {
		InputJSON string `json:"input_json"`
	} `json:"bases"`
	Cases []p3Case `json:"cases"`
}

// p3ApprovedIDs are the 57 case IDs approved for phase 3, written here: the vectors must carry
// exactly these, each once.
var p3ApprovedIDs = []string{
	"P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08",
	"P09", "P10", "P11", "P12", "P13-800", "P13-801", "P13-5000", "P14",
	"R01", "R02", "R03", "R04", "R05a", "R05b-v2", "R06", "R07",
	"R08", "R09", "R10", "R11", "R12", "R13", "R14", "R15",
	"R16", "F01", "F02", "F03", "F04", "F05", "F06", "F07",
	"F08", "F09", "F10", "F11", "F12", "F13", "F14", "D01",
	"D02", "D03", "D04", "R05b-both", "D05", "D06", "D07", "D08",
	"D09",
}

// p3IDProblem says why ids is not exactly the approved set, each once (repeated, missing, unknown), or "".
func p3IDProblem(ids []string) string {
	seen := map[string]bool{}
	repeated, missing, unknown := []string{}, []string{}, []string{}
	for _, id := range ids {
		if seen[id] {
			repeated = append(repeated, id)
		}
		seen[id] = true
		if !slices.Contains(p3ApprovedIDs, id) && !slices.Contains(unknown, id) {
			unknown = append(unknown, id)
		}
	}
	for _, id := range p3ApprovedIDs {
		if !seen[id] {
			missing = append(missing, id)
		}
	}
	if len(repeated)+len(missing)+len(unknown) == 0 {
		return ""
	}
	return fmt.Sprintf("repeated %v, missing %v, unknown %v", repeated, missing, unknown)
}

// p3Load reads the vectors and, before any case runs, requires exactly the approved case IDs.
func p3Load(t *testing.T) p3Vectors {
	t.Helper()
	var v p3Vectors
	if err := json.Unmarshal(repoFile(t, "tests", "interop", "candidate", "phase3-signed-vectors.json"), &v); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(v.Cases))
	for _, c := range v.Cases {
		ids = append(ids, c.ID)
	}
	if problem := p3IDProblem(ids); problem != "" {
		t.Fatalf("phase 3 vectors: not the approved case IDs: %s", problem)
	}
	return v
}

func TestExperimentalCandidateApprovedIDs(t *testing.T) {
	v := p3Load(t)
	ids := []string{}
	for _, c := range v.Cases {
		ids = append(ids, c.ID)
	}
	without := slices.DeleteFunc(slices.Clone(ids), func(id string) bool { return id == "F07" })
	renamed := slices.Clone(ids)
	renamed[slices.Index(renamed, "P05")] = "P99"
	for _, tc := range []struct {
		ids  []string
		want string
	}{
		{ids, ""},
		{p3ApprovedIDs, ""},
		{without, "repeated [], missing [F07], unknown []"},
		{append(slices.Clone(ids), "D03"), "repeated [D03], missing [], unknown []"},
		{renamed, "repeated [], missing [P05], unknown [P99]"},
	} {
		if got := p3IDProblem(tc.ids); got != tc.want {
			t.Errorf("%q, want %q", got, tc.want)
		}
	}
}

func p3Case_(t *testing.T, v p3Vectors, id string) p3Case {
	t.Helper()
	for _, c := range v.Cases {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("no case %s", id)
	return p3Case{}
}

// p3Input is the input of a case: its base, then each edit in order on the bytes.
func p3Input(t *testing.T, v p3Vectors, c p3Case) []byte {
	t.Helper()
	latin1 := func(s string) []byte {
		b := make([]byte, 0, len(s))
		for _, r := range s {
			b = append(b, byte(r))
		}
		return b
	}
	unhex := func(s any) []byte {
		b, err := hex.DecodeString(s.(string))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	buf := latin1(v.Bases[c.Input.Base].InputJSON)
	for _, e := range c.Input.Edits {
		switch {
		case e["find"] != nil:
			find := latin1(e["find"].(string))
			if bytes.Count(buf, find) != 1 {
				t.Fatalf("%s: find must occur exactly once", c.ID)
			}
			var by []byte
			if r, ok := e["replace"].(string); ok {
				by = latin1(r)
			} else {
				by = unhex(e["replace_hex"])
			}
			buf = bytes.Replace(buf, find, by, 1)
		case e["prefix"] != nil:
			buf = append(append(latin1(e["prefix"].(string)), buf...), latin1(e["suffix"].(string))...)
		case e["prefix_hex"] != nil:
			buf = append(unhex(e["prefix_hex"]), buf...)
		case e["drop_last"] != nil:
			buf = buf[:len(buf)-int(e["drop_last"].(float64))]
		default:
			t.Fatalf("%s: unknown edit %v", c.ID, e)
		}
	}
	return buf
}

// p3Policy is the default by omission for "default"; otherwise the fields of the written policy that
// Go's verifier takes (its mode and risk overrides).
func p3Policy(v p3Vectors, name string) v2.VerifierPolicy {
	p := v2.DefaultVerifierPolicy()
	if name == "default" {
		return p
	}
	written := v.VerifierPolicies[name]
	p.DefaultMode = written["default_mode"].(string)
	p.RiskOverrides = map[string]string{}
	for k, m := range written["risk_overrides"].(map[string]any) {
		p.RiskOverrides[k] = m.(string)
	}
	return p
}

func p3Registry() *v2.AlgorithmRegistry {
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	return reg
}

func p3Check(t *testing.T, label string, r v2.ExperimentalCandidateVerification, exp p3Expected) {
	t.Helper()
	er := exp.Route
	if r.Route.Outcome != er.Outcome {
		t.Fatalf("%s: outcome %s, want %s (%+v)", label, r.Route.Outcome, er.Outcome, r.Route)
	}
	if er.Class != nil && r.Route.Class != *er.Class {
		t.Errorf("%s: class %s, want %s", label, r.Route.Class, *er.Class)
	}
	if er.Detail != nil && r.Route.Detail != *er.Detail {
		t.Errorf("%s: detail %s, want %s", label, r.Route.Detail, *er.Detail)
	}
	if er.Offset != nil && (r.Route.Offset == nil || *r.Route.Offset != *er.Offset) {
		t.Errorf("%s: offset %v, want %d", label, r.Route.Offset, *er.Offset)
	}
	if len(er.Profile) > 0 {
		want := ""
		if string(er.Profile) != "null" {
			_ = json.Unmarshal(er.Profile, &want)
		}
		if r.Route.Profile != want {
			t.Errorf("%s: profile %q, want %q", label, r.Route.Profile, want)
		}
	}
	if er.ProfileSource != nil && r.Route.ProfileSource != *er.ProfileSource {
		t.Errorf("%s: profile source %s, want %s", label, r.Route.ProfileSource, *er.ProfileSource)
	}
	if er.WarningClasses != nil {
		got := []string{}
		for _, w := range r.Route.Warnings {
			got = append(got, w.Class)
		}
		if !reflect.DeepEqual(got, er.WarningClasses) {
			t.Errorf("%s: warnings %v, want %v", label, got, er.WarningClasses)
		}
	}
	if er.Historical != nil {
		got := "failed"
		if r.Route.Historical.OK {
			got = "decoded"
		}
		if got != *er.Historical {
			t.Errorf("%s: historical %s, want %s", label, got, *er.Historical)
		}
	}
	if r.Entered != exp.Entered {
		t.Errorf("%s: entered %s, want %s", label, r.Entered, exp.Entered)
	}
	if exp.Verification == nil {
		if r.Verification != nil {
			t.Errorf("%s: a verification where none was expected: %+v", label, r.Verification)
		}
		return
	}
	if r.Verification == nil {
		t.Fatalf("%s: no verification", label)
	}
	if r.Verification.Verified != exp.Verification.Verified {
		t.Errorf("%s: verified %v, want %v: %v", label, r.Verification.Verified, exp.Verification.Verified, r.Verification.Errors)
	}
	if exp.Verification.Verified && len(r.Verification.Errors) != 0 {
		t.Errorf("%s: errors on a verified bundle: %v", label, r.Verification.Errors)
	}
	for _, s := range exp.Verification.ErrorsContain["go"] {
		found := false
		for _, e := range r.Verification.Errors {
			found = found || strings.Contains(e, s)
		}
		if !found {
			t.Errorf("%s: no error contains %q: %v", label, s, r.Verification.Errors)
		}
	}
}

func TestExperimentalCandidateVerifySignedVectors(t *testing.T) {
	v := p3Load(t)
	reg := p3Registry()
	now := time.UnixMilli(v.NowMs)
	for _, c := range v.Cases {
		exp := c.Expected
		if e, ok := c.ByAdapter["go:encoding_json"]; ok {
			exp = e
		}
		data := p3Input(t, v, c)
		if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != c.InputSHA256 {
			t.Fatalf("%s: input hash", c.ID)
		}
		cfg := v2.ExperimentalCandidateVerifierConfig{Transport: c.Transport, AcceptedProfiles: c.AcceptedProfiles, Historical: "encoding_json"}
		var entries []string
		decodes := 0
		verifier, err := v2.NewExperimentalCandidateVerifierForTests(cfg, func(e string) { entries = append(entries, e) }, &decodes)
		if err != nil {
			t.Fatal(err)
		}
		policy := p3Policy(v, c.VerifierPolicy)
		r, err := verifier.VerifyAt(reg, data, policy, now)
		if err != nil {
			t.Fatalf("%s: %v", c.ID, err)
		}
		p3Check(t, c.ID, r, exp)
		if decodes != exp.AdapterCalls {
			t.Errorf("%s: %d decoder calls, want %d", c.ID, decodes, exp.AdapterCalls)
		}
		want := []string{}
		if exp.Entered != "none" {
			want = []string{exp.Entered}
		}
		if got := append([]string{}, entries...); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: verifiers entered %v, want %v", c.ID, got, want)
		}

		if r.Route.Outcome == "candidate" && exp.ManifestSHA256 != "" {
			if r.Route.CanonicalSHA256 != exp.CanonicalSHA256 {
				t.Errorf("%s: canonical hash %s", c.ID, r.Route.CanonicalSHA256)
			}
			var parsed map[string]any
			if err := json.Unmarshal(r.Route.Canonical, &parsed); err != nil {
				t.Fatal(err)
			}
			manifest, _ := v2.CanonicalizeV2(parsed["bundle"].(map[string]any)["manifest"])
			sum := sha256.Sum256([]byte(manifest))
			if got := "sha256:" + hex.EncodeToString(sum[:]); got != exp.ManifestSHA256 || parsed["signature"].(map[string]any)["manifest_hash"] != got {
				t.Errorf("%s: manifest hash %s", c.ID, got)
			}
		}
		// Delegation: exactly VerifySignedBundleV2At on the unit bytes, as a current caller.
		if r.Entered == "dcp-jcs-v1" {
			if direct := v2.VerifySignedBundleV2At(reg, r.Route.Unit.Bytes, policy, now); !reflect.DeepEqual(direct, r.Verification) {
				t.Errorf("%s: delegation differs from VerifySignedBundleV2At: %+v vs %+v", c.ID, r.Verification, direct)
			}
		}
		// The verifier without probe or counter gives the same result.
		plain, err := v2.NewExperimentalCandidateVerifier(cfg)
		if err != nil {
			t.Fatal(err)
		}
		if again, _ := plain.VerifyAt(reg, data, policy, now); !reflect.DeepEqual(again, r) {
			t.Errorf("%s: the plain verifier differs", c.ID)
		}
	}
}

// p3SameExact compares an exact value (int64 integers) with another exact or decoded value: integers
// by numeric value, whatever their type.
func p3SameExact(a, b any) bool {
	num := func(x any) (float64, bool) {
		switch n := x.(type) {
		case int64:
			return float64(n), true
		case float64:
			return n, true
		}
		return 0, false
	}
	if x, ok := num(a); ok {
		y, ok := num(b)
		return ok && x == y
	}
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for k, x := range av {
			if y, ok := bv[k]; !ok || !p3SameExact(x, y) {
				return false
			}
		}
		return true
	case []any:
		bv, ok := b.([]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if !p3SameExact(av[i], bv[i]) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(a, b)
}

// p3Committed is every committed value of a unit (the unit, the manifest, the four payloads, the audit
// entries and the checkpoints without their signature) and every object or array inside them, in a
// fixed order, so the same walk over two trees of the same value pairs their nodes.
func p3Committed(unit map[string]any) []any {
	b := unit["bundle"].(map[string]any)
	roots := []any{unit, b["manifest"]}
	for _, n := range []string{"responsible_principal_record", "agent_passport", "intent", "policy_decision"} {
		roots = append(roots, b[n].(map[string]any)["payload"])
	}
	roots = append(roots, b["audit_entries"].([]any)...)
	if cps, ok := b["pq_checkpoints"].([]any); ok {
		for _, cp := range cps {
			payload := map[string]any{}
			for k, x := range cp.(map[string]any) {
				if k != "composite_sig" {
					payload[k] = x
				}
			}
			roots = append(roots, payload)
		}
	}
	var out []any
	var walk func(x any)
	walk = func(x any) {
		switch xv := x.(type) {
		case map[string]any:
			out = append(out, xv)
			keys := make([]string, 0, len(xv))
			for k := range xv {
				keys = append(keys, k)
			}
			sortStrings(keys)
			for _, k := range keys {
				walk(xv[k])
			}
		case []any:
			out = append(out, xv)
			for _, y := range xv {
				walk(y)
			}
		}
	}
	for _, r := range roots {
		walk(r)
	}
	return out
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// Go's verifier reads the candidate's canonical bytes with encoding/json: for every committed value of
// the positives, CanonicalizeV2 of the decoded node is the candidate canonical form of the exact node.
func TestExperimentalCandidateCanonicalBytesOfEveryCommittedValue(t *testing.T) {
	v := p3Load(t)
	reg := p3Registry()
	var positives []string
	for _, c := range v.Cases {
		if c.Expected.ManifestSHA256 == "" {
			continue
		}
		positives = append(positives, c.ID)
		verifier, _ := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: c.Transport, AcceptedProfiles: c.AcceptedProfiles, Historical: "encoding_json"})
		r, err := verifier.VerifyAt(reg, p3Input(t, v, c), v2.DefaultVerifierPolicy(), time.UnixMilli(v.NowMs))
		if err != nil || r.Route.Outcome != "candidate" {
			t.Fatalf("%s: %v %s", c.ID, err, r.Route.Outcome)
		}
		var decoded map[string]any
		if err := json.Unmarshal(r.Route.Canonical, &decoded); err != nil {
			t.Fatal(err)
		}
		exact := p3Committed(r.Route.Value.(map[string]any))
		read := p3Committed(decoded)
		if len(exact) != len(read) {
			t.Fatalf("%s: %d exact nodes, %d decoded", c.ID, len(exact), len(read))
		}
		checkpoint := false
		for i, node := range read {
			canonical, err := v2.CanonicalizeV2(node)
			if err != nil {
				t.Fatalf("%s: %v", c.ID, err)
			}
			again, err := v2.ExperimentalCandidateIngress([]byte(canonical))
			if err != nil || !again.Accepted {
				t.Fatalf("%s: the canonical bytes are not accepted: %v %+v", c.ID, err, again)
			}
			if string(again.Canonical) != canonical || !p3SameExact(again.Value, exact[i]) || !p3SameExact(exact[i], node) {
				t.Fatalf("%s: node %d differs: %.80s", c.ID, i, canonical)
			}
			if m, ok := node.(map[string]any); ok && m["checkpoint_id"] != nil {
				checkpoint = true
			}
		}
		if c.ID == "P10" && !checkpoint {
			t.Errorf("P10: the checkpoint is not among the committed values")
		}
	}
	if len(positives) != 16 {
		t.Fatalf("%d positives", len(positives))
	}
}

func TestExperimentalCandidateVerifyExactIntegers(t *testing.T) {
	v := p3Load(t)
	limits := map[string]any{"exact_one": int64(1), "ten": int64(10), "hundred": int64(100), "zero": int64(0), "max_safe": int64(9007199254740991), "min_safe": int64(-9007199254740991)}
	for _, id := range []string{"P04", "P13-800", "P13-801", "P13-5000", "P14"} {
		c := p3Case_(t, v, id)
		verifier, _ := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: c.AcceptedProfiles, Historical: "encoding_json"})
		r, _ := verifier.VerifyAt(p3Registry(), p3Input(t, v, c), v2.DefaultVerifierPolicy(), time.UnixMilli(v.NowMs))
		target := r.Route.Value.(map[string]any)["bundle"].(map[string]any)["intent"].(map[string]any)["payload"].(map[string]any)["target"].(map[string]any)
		if !reflect.DeepEqual(target["limits"], limits) {
			t.Errorf("%s: %v", id, target["limits"])
		}
		if !r.Verification.Verified {
			t.Errorf("%s: %v", id, r.Verification.Errors)
		}
	}
}

func TestExperimentalCandidateVerifierConfiguration(t *testing.T) {
	for _, accepted := range []any{nil, []string{}, []string{"dcp-jcs-v3"}, []string{"dcp-jcs-v2", "dcp-jcs-v2"}, "dcp-jcs-v2"} {
		_, err := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: accepted, Historical: "encoding_json"})
		var ce *v2.ExperimentalCandidateConfigError
		if !errors.As(err, &ce) || ce.Code != "POLICY_INVALID" {
			t.Errorf("%v: %v", accepted, err)
		}
	}
	for _, name := range []string{"", "Encoding_JSON", "encoding_json ", "serde_json_from_slice"} {
		_, err := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v1"}, Historical: name})
		var ce *v2.ExperimentalCandidateConfigError
		if !errors.As(err, &ce) || ce.Code != "CONFIG_INVALID" || ce.Detail != "HISTORICAL_ADAPTER" {
			t.Errorf("%q: %v", name, err)
		}
	}
}

// The exported adapter has mutable fields; the verifier never reads them, before or after creation.
func TestExperimentalCandidateVerifierIgnoresTheExportedAdapter(t *testing.T) {
	v := p3Load(t)
	reg := p3Registry()
	now := time.UnixMilli(v.NowMs)
	d01, d09 := p3Input(t, v, p3Case_(t, v, "D01")), p3Input(t, v, p3Case_(t, v, "D09"))
	cfg := v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v1"}, Historical: "encoding_json"}
	before, _ := v2.NewExperimentalCandidateVerifier(cfg)
	want1, _ := before.VerifyAt(reg, d01, v2.DefaultVerifierPolicy(), now)
	want9, _ := before.VerifyAt(reg, d09, v2.DefaultVerifierPolicy(), now)

	saved := v2.ExperimentalHistoricalEncodingJSON
	defer func() { v2.ExperimentalHistoricalEncodingJSON = saved }()
	v2.ExperimentalHistoricalEncodingJSON.Name = "tampered"
	v2.ExperimentalHistoricalEncodingJSON.Decode = func([]byte) (any, error) {
		return map[string]any{"bundle": map[string]any{"manifest": map[string]any{"canonicalization_profile": "dcp-jcs-v2"}}}, nil
	}
	after, _ := v2.NewExperimentalCandidateVerifier(cfg)
	for _, verifier := range []*v2.ExperimentalCandidateVerifier{before, after} {
		got1, err := verifier.VerifyAt(reg, d01, v2.DefaultVerifierPolicy(), now)
		got9, _ := verifier.VerifyAt(reg, d09, v2.DefaultVerifierPolicy(), now)
		if err != nil || !reflect.DeepEqual(got1, want1) || !reflect.DeepEqual(got9, want9) || !got1.Verification.Verified {
			t.Errorf("the exported adapter reached the verifier: %v %+v", err, got1.Route.Historical)
		}
		if _, _, name := verifier.Configuration(); name != "encoding_json" {
			t.Errorf("configuration names %q", name)
		}
	}
}

func TestExperimentalCandidateVerifierMutatedBuffer(t *testing.T) {
	v := p3Load(t)
	reg := p3Registry()
	now := time.UnixMilli(v.NowMs)
	verifier, _ := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v2"}, Historical: "encoding_json"})
	data := p3Input(t, v, p3Case_(t, v, "P01"))
	r, err := verifier.VerifyAt(reg, data, v2.DefaultVerifierPolicy(), now)
	if err != nil || !r.Verification.Verified {
		t.Fatalf("%v %+v", err, r.Verification)
	}
	for i := range data {
		data[i] = ' '
	}
	if sum := sha256.Sum256(r.Route.Unit.Bytes); hex.EncodeToString(sum[:]) != p3Case_(t, v, "P01").InputSHA256 {
		t.Error("the route shares the caller's buffer")
	}
}

func TestExperimentalCandidateTodaysAPIStillRefusesV2(t *testing.T) {
	v := p3Load(t)
	r := v2.VerifySignedBundleV2At(p3Registry(), p3Input(t, v, p3Case_(t, v, "P01")), v2.DefaultVerifierPolicy(), time.UnixMilli(v.NowMs))
	if r.Verified || !strings.Contains(fmt.Sprint(r.Errors), "Unknown canonicalization_profile: dcp-jcs-v2") {
		t.Errorf("%v %v", r.Verified, r.Errors)
	}
}
