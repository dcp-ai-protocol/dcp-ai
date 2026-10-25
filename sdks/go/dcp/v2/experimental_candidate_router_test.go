package v2_test

// Experimental candidate router (phase 2), by phase: configuration, transport, selection and policy on
// walkable units, the historical adapter on the units it decides (public fixture of measured decoders),
// v1 parity on really signed bundles, laziness, the adapter contract and byte ownership. Candidate
// verification is phase 3: corpus expectations accept_v2 and COMMITMENT_MISMATCH are checked only as
// "candidate". The grammar walker is checked in the package's internal test.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type routerCase struct {
	ID          string          `json:"id"`
	Group       string          `json:"group"`
	Mode        string          `json:"mode"`
	Transport   string          `json:"transport"`
	Options     json.RawMessage `json:"options"`
	Policy      json.RawMessage `json:"policy"`
	Historical  json.RawMessage `json:"historical"`
	InputJSON   *string         `json:"input_json"`
	InputHex    *string         `json:"input_hex"`
	InputSHA256 string          `json:"input_sha256"`
	Expected    map[string]any  `json:"expected"`
}

func repoFile(t *testing.T, parts ...string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func routerCases(t *testing.T) []routerCase {
	var file struct {
		Cases []routerCase `json:"cases"`
	}
	if err := json.Unmarshal(repoFile(t, "docs", "proposals", "canonicalization-candidate", "corpus.json"), &file); err != nil {
		t.Fatal(err)
	}
	return file.Cases
}

func routerInput(t *testing.T, c routerCase) []byte {
	t.Helper()
	var b []byte
	if c.InputHex != nil {
		b, _ = hex.DecodeString(*c.InputHex)
	} else {
		b = []byte(*c.InputJSON)
	}
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != c.InputSHA256 {
		t.Fatalf("%s: input does not match input_sha256", c.ID)
	}
	return b
}

func policyOf(t *testing.T, raw json.RawMessage) any {
	if raw == nil {
		return nil
	}
	var p any
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

type countingAdapter struct {
	v2.ExperimentalHistoricalAdapter
	calls int
}

func counting(inner v2.ExperimentalHistoricalAdapter) *countingAdapter {
	c := &countingAdapter{}
	c.Name = inner.Name
	c.Decode = func(u []byte) (any, error) { c.calls++; return inner.Decode(u) }
	return c
}

func newRouter(t *testing.T, transport string, policy any, adapter *v2.ExperimentalHistoricalAdapter) *v2.ExperimentalCandidateRouter {
	t.Helper()
	r, err := v2.NewExperimentalCandidateRouter(v2.ExperimentalCandidateRouterConfig{Transport: transport, AcceptedProfiles: policy, Historical: adapter})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func route(t *testing.T, r *v2.ExperimentalCandidateRouter, input []byte) v2.ExperimentalCandidateRoute {
	t.Helper()
	out, err := r.Route(input)
	if err != nil {
		t.Fatalf("route: %v", err)
	}
	return out
}

func intOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return float64(*p)
}

func warningsOf(r v2.ExperimentalCandidateRoute) []any {
	out := []any{}
	for _, w := range r.Warnings {
		out = append(out, map[string]any{"class": w.Class, "offset": float64(w.Offset)})
	}
	return out
}

func unitWith(profile, extra string) []byte {
	return []byte(`{"bundle":{"manifest":{"canonicalization_profile":` + profile + `}},"signature":{}` + extra + `}`)
}

var both = []string{"dcp-jcs-v1", "dcp-jcs-v2"}
var bomV1 = append([]byte("\xef\xbb\xbf"), unitWith(`"dcp-jcs-v1"`, "")...)

func obsolete(c routerCase) bool { return strings.Contains(string(c.Options), `"transport"`) }

func TestExperimentalCandidateRouterConfiguration(t *testing.T) {
	cases := routerCases(t)
	configured, envelopes, routed, historical := 0, 0, 0, 0
	for _, c := range cases {
		switch {
		case c.Group == "configuration":
			configured++
			_, err := v2.NewExperimentalCandidateRouter(v2.ExperimentalCandidateRouterConfig{Transport: "bare", AcceptedProfiles: policyOf(t, c.Policy), Historical: &v2.ExperimentalHistoricalEncodingJSON})
			var cfg *v2.ExperimentalCandidateConfigError
			if !errors.As(err, &cfg) || cfg.Code != c.Expected["class"] || cfg.Detail != c.Expected["detail"] {
				t.Errorf("%s: %v, want %v/%v", c.ID, err, c.Expected["class"], c.Expected["detail"])
			}
		case c.Mode == "document" && c.Transport == "envelope" && !obsolete(c):
			envelopes++
		case c.Mode == "bundle" && c.Historical == nil && !obsolete(c):
			routed++
		case c.Historical != nil:
			historical++
		}
	}
	if [4]int{configured, envelopes, routed, historical} != [4]int{9, 28, 58, 9} {
		t.Fatalf("counts %d %d %d %d", configured, envelopes, routed, historical)
	}
	for detail, cfg := range map[string]v2.ExperimentalCandidateRouterConfig{
		"TRANSPORT":          {Transport: "header", AcceptedProfiles: both, Historical: &v2.ExperimentalHistoricalEncodingJSON},
		"HISTORICAL_ADAPTER": {Transport: "bare", AcceptedProfiles: both},
	} {
		var e *v2.ExperimentalCandidateConfigError
		if _, err := v2.NewExperimentalCandidateRouter(cfg); !errors.As(err, &e) || e.Detail != detail {
			t.Errorf("%s: %v", detail, err)
		}
	}
	if _, err := v2.NewExperimentalCandidateRouter(v2.ExperimentalCandidateRouterConfig{Transport: "bare", AcceptedProfiles: both, Historical: &v2.ExperimentalHistoricalAdapter{Name: "x"}}); err == nil {
		t.Error("an adapter without Decode was accepted")
	}

	// A private snapshot: later changes to the configuration change nothing.
	policy := []string{"dcp-jcs-v1"}
	adapter := counting(v2.ExperimentalHistoricalEncodingJSON)
	cfg := v2.ExperimentalCandidateRouterConfig{Transport: "bare", AcceptedProfiles: policy, Historical: &adapter.ExperimentalHistoricalAdapter}
	r, err := v2.NewExperimentalCandidateRouter(cfg)
	if err != nil {
		t.Fatal(err)
	}
	replaced := 0
	policy[0] = "dcp-jcs-v2"
	cfg.Transport = "envelope"
	adapter.Decode = func([]byte) (any, error) { replaced++; return nil, nil }
	adapter.Name = "replaced"
	_, accepted, _ := r.Configuration()
	accepted[0] = "dcp-jcs-v2"
	if out := route(t, r, unitWith(`"dcp-jcs-v2"`, "")); out.Class != "PROFILE_NOT_ACCEPTED" {
		t.Errorf("v2 under a v1 snapshot: %+v", out)
	}
	if out := route(t, r, unitWith(`"dcp-jcs-v1"`, "")); out.Outcome != "v1_path" || out.Historical.Adapter != "encoding_json" {
		t.Errorf("v1: %+v", out)
	}
	transport, accepted, name := r.Configuration()
	if adapter.calls != 1 || replaced != 0 || transport != "bare" || !reflect.DeepEqual(accepted, []string{"dcp-jcs-v1"}) || name != "encoding_json" {
		t.Errorf("snapshot: calls %d, replaced %d, %s %v %s", adapter.calls, replaced, transport, accepted, name)
	}
}

func TestExperimentalCandidateRouterTransportAndSelection(t *testing.T) {
	for _, c := range routerCases(t) {
		if obsolete(c) || c.Group == "configuration" || c.Historical != nil {
			continue
		}
		input := routerInput(t, c)
		e := c.Expected
		if c.Mode == "document" {
			if c.Transport != "envelope" {
				continue
			}
			x, err := v2.ExperimentalCandidateExtractUnit(input, "envelope")
			if err != nil {
				t.Fatal(err)
			}
			if cls := e["class"]; cls == "TRANSPORT_INVALID" || cls == "TRANSPORT_AMBIGUOUS" {
				if !x.Rejected || x.Class != cls || x.Detail != e["detail"] || intOrNil(x.TransportOffset) != e["transport_offset"] {
					t.Errorf("%s: %+v", c.ID, x)
				}
				continue
			}
			if x.Rejected {
				t.Errorf("%s: rejected %+v", c.ID, x)
				continue
			}
			if u, ok := e["unit"].([]any); ok && (float64(x.Start) != u[0] || float64(x.End) != u[1]) {
				t.Errorf("%s: unit %d-%d, want %v", c.ID, x.Start, x.End, u)
			}
			r, _ := v2.ExperimentalCandidateIngress(input[x.Start:x.End])
			if e["result"] == "accept" && (!r.Accepted || r.CanonicalSHA256 != e["canonical_sha256"]) || e["result"] != "accept" && (r.Accepted || r.Class != e["class"] || float64(r.Offset) != e["offset"]) {
				t.Errorf("%s: %+v", c.ID, r)
			}
			continue
		}
		adapter := counting(v2.ExperimentalHistoricalEncodingJSON)
		out := route(t, newRouter(t, c.Transport, policyOf(t, c.Policy), &adapter.ExperimentalHistoricalAdapter), input)
		if u, ok := e["unit"].([]any); ok && out.Unit != nil && (float64(out.Unit.Start) != u[0] || float64(out.Unit.End) != u[1]) {
			t.Errorf("%s: unit %+v, want %v", c.ID, out.Unit, u)
		}
		switch {
		case e["result"] == "accept_v2" || e["class"] == "COMMITMENT_MISMATCH":
			if out.Outcome != "candidate" || !reflect.DeepEqual(out.Attempts, []string{"dcp-jcs-v2"}) || adapter.calls != 0 {
				t.Errorf("%s: %+v (calls %d)", c.ID, out, adapter.calls)
			}
		case e["result"] == "v1_path":
			attempts := []any{}
			for _, a := range out.Attempts {
				attempts = append(attempts, a)
			}
			if out.Outcome != "v1_path" || out.Profile != "dcp-jcs-v1" || !reflect.DeepEqual(attempts, e["attempts"]) || !reflect.DeepEqual(warningsOf(out), e["warnings"]) || adapter.calls != 1 {
				t.Errorf("%s: %+v (calls %d)", c.ID, out, adapter.calls)
			}
		default:
			profile, _ := e["profile"].(string)
			if out.Outcome != "reject" || out.Class != e["class"] || intOrNil(out.Offset) != e["offset"] || out.Profile != profile || len(out.Attempts) != 0 || adapter.calls != 0 {
				t.Errorf("%s: %+v (calls %d)", c.ID, out, adapter.calls)
			}
		}
	}
}

func TestExperimentalCandidateRouterHistoricalFixture(t *testing.T) {
	var fixture struct {
		Cases []struct {
			ID          string   `json:"id"`
			InputHex    string   `json:"input_hex"`
			InputSHA256 string   `json:"input_sha256"`
			Policy      []string `json:"policy"`
			Adapters    map[string]struct {
				DecoderReading string         `json:"decoder_reading"`
				Expected       map[string]any `json:"expected"`
			} `json:"adapters"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(repoFile(t, "tests", "interop", "candidate", "phase2-adapter-expectations.json"), &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) != 16 {
		t.Fatalf("%d fixture cases", len(fixture.Cases))
	}
	for _, c := range fixture.Cases {
		input, _ := hex.DecodeString(c.InputHex)
		sum := sha256.Sum256(input)
		if hex.EncodeToString(sum[:]) != c.InputSHA256 {
			t.Fatalf("%s: input hash", c.ID)
		}
		row := c.Adapters["go.encoding_json"]
		reading := "fails" // the fixture reading is the decoder's own, re-measured here
		if v, err := v2.ExperimentalHistoricalEncodingJSON.Decode(input); err == nil {
			reading = "absent"
			if b, ok := v.(map[string]any)["bundle"].(map[string]any); ok {
				if m, ok := b["manifest"].(map[string]any); ok {
					if f, ok := m["canonicalization_profile"]; ok {
						reading = "other"
						if s, ok := f.(string); ok && (s == "dcp-jcs-v1" || s == "dcp-jcs-v2") {
							reading = s
						}
					}
				}
			}
		}
		if reading != row.DecoderReading {
			t.Errorf("%s: decoder reading %s, fixture %s", c.ID, reading, row.DecoderReading)
		}
		adapter := counting(v2.ExperimentalHistoricalEncodingJSON)
		out := route(t, newRouter(t, "bare", c.Policy, &adapter.ExperimentalHistoricalAdapter), input)
		e := row.Expected
		if float64(adapter.calls) != e["adapter_calls"] {
			t.Errorf("%s: %d adapter calls, want %v", c.ID, adapter.calls, e["adapter_calls"])
		}
		if e["outcome"] == "reject" {
			profile, _ := e["profile"].(string)
			if out.Outcome != "reject" || out.Class != e["class"] || intOrNil(out.Offset) != e["offset"] || out.Profile != profile {
				t.Errorf("%s: %+v, want %v", c.ID, out, e)
			}
			continue
		}
		historical := "failed"
		if out.Historical != nil && out.Historical.OK {
			historical = "decoded"
		}
		if out.Outcome != "v1_path" || out.ProfileSource != e["profile_source"] || !reflect.DeepEqual(warningsOf(out), e["warnings"]) || historical != e["historical"] {
			t.Errorf("%s: %+v, want %v", c.ID, out, e)
		}
	}
}

func TestExperimentalCandidateRouterV1Parity(t *testing.T) {
	var vectors, admission map[string]any
	decode := func(data []byte, into *map[string]any) {
		d := json.NewDecoder(bytes.NewReader(data))
		d.UseNumber()
		if err := d.Decode(into); err != nil {
			t.Fatal(err)
		}
	}
	decode(repoFile(t, "tests", "interop", "v2", "bundle_vectors.json"), &vectors)
	decode(repoFile(t, "tests", "interop", "v2", "admission_vectors.json"), &admission)
	dump := func(v any) []byte {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	text := dump(vectors["signed_bundle"])
	profile := []byte(`"canonicalization_profile":"dcp-jcs-v1"`)
	if bytes.Count(text, profile) != 1 {
		t.Fatal("the signed bundle does not carry one explicit profile")
	}
	action := bytes.Index(text, []byte(`"action_type":"`)) + len(`"action_type":"`)
	repl := func(old, new string) []byte { return bytes.Replace(text, []byte(old), []byte(new), 1) }
	tail := func(extra string) []byte { return append(append([]byte(nil), text[:len(text)-1]...), extra...) }
	splice := func(with []byte) []byte {
		return append(append(append([]byte(nil), text[:action]...), with...), text[action+1:]...)
	}
	p := string(profile)
	variants := map[string][]byte{
		"bom":                          append([]byte("\xef\xbb\xbf"), text...),
		"dup-profile-unknown-then-v1":  repl(p, `"canonicalization_profile":"dcp-jcs-v9",`+p),
		"dup-profile-v2-then-v1":       repl(p, `"canonicalization_profile":"dcp-jcs-v2",`+p),
		"dup-profile-v1-then-unknown":  repl(p, p+`,"canonicalization_profile":"dcp-jcs-v9"`),
		"dup-manifest-empty-then-real": repl(`"manifest":{`, `"manifest":{},"manifest":{`),
		"dup-bundle-empty-then-real":   repl(`{"bundle":{`, `{"bundle":{},"bundle":{`),
		"utf8-ff-in-intent":            splice([]byte{0xff}),
		"ufffd-literal-in-intent":      splice([]byte{0xef, 0xbf, 0xbd}),
		"trailing-comma":               tail(",}"),
		"inf-unsigned":                 tail(`,"x":1e999}`),
		"nan-unsigned":                 tail(`,"x":NaN}`),
		"lone-surrogate-unsigned":      tail(`,"x":"\` + `ud800"}`),
		"inf-profile":                  repl(p, `"canonicalization_profile":1e999`),
		"nan-before-v1":                repl(p, `"canonicalization_profile":NaN,`+p),
		"inf-before-v1":                repl(p, `"canonicalization_profile":1e999,`+p),
	}
	nowVectors := time.UnixMilli(1793491200000)
	var nowAdmission time.Time
	for _, c := range admission["cases"].([]any) {
		if c.(map[string]any)["name"] == "A_known_principal_strict" {
			nowAdmission, _ = time.Parse(time.RFC3339Nano, c.(map[string]any)["now"].(string))
		}
	}
	type input struct {
		label string
		data  []byte
		now   time.Time
	}
	inputs := []input{{"signed_bundle", text, nowVectors}, {"classical_only", dump(vectors["classical_only_routine_bundle"].(map[string]any)["signed_bundle"]), nowVectors}}
	for _, key := range []string{"must_accept_bundles", "must_reject_bundles"} {
		for _, c := range vectors[key].([]any) {
			inputs = append(inputs, input{fmt.Sprint(key, " ", c.(map[string]any)["name"]), dump(c.(map[string]any)["signed_bundle"]), nowVectors})
		}
	}
	for k, v := range admission["signed_bundles"].(map[string]any) {
		inputs = append(inputs, input{"admission " + k, dump(v), nowAdmission})
	}
	for k, v := range variants {
		inputs = append(inputs, input{"variant " + k, v, nowVectors})
	}
	if len(inputs) != 2+len(vectors["must_accept_bundles"].([]any))+len(vectors["must_reject_bundles"].([]any))+20+15 {
		t.Fatalf("%d parity inputs", len(inputs))
	}
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	r := newRouter(t, "bare", []string{"dcp-jcs-v1"}, &v2.ExperimentalHistoricalEncodingJSON)
	var differences []string
	accepted := 0
	for _, in := range inputs {
		// Go's v1 verifier takes the bytes: today's verdict, and the delegated unit through the same call.
		today := v2.VerifySignedBundleV2At(reg, in.data, v2.DefaultVerifierPolicy(), in.now).Verified
		out := route(t, r, in.data)
		if out.Outcome == "candidate" {
			t.Fatalf("%s: candidate under a v1-only policy", in.label)
		}
		routed := out.Outcome == "v1_path" && v2.VerifySignedBundleV2At(reg, out.Unit.Bytes, v2.DefaultVerifierPolicy(), in.now).Verified
		if routed != today {
			differences = append(differences, fmt.Sprintf("%s: today %v, routed %v (%s %s)", in.label, today, routed, out.Outcome, out.Class))
		}
		if today {
			accepted++
		}
	}
	if len(differences) > 0 || accepted <= 10 {
		t.Fatalf("differences %v, accepted %d", differences, accepted)
	}
}

func TestExperimentalCandidateRouterAdapterContract(t *testing.T) {
	claimsV2 := &v2.ExperimentalHistoricalAdapter{Name: "claims-v2", Decode: func([]byte) (any, error) {
		return map[string]any{"bundle": map[string]any{"manifest": map[string]any{"canonicalization_profile": "dcp-jcs-v2"}}}, nil
	}}
	if out := route(t, newRouter(t, "bare", both, claimsV2), append([]byte("\xef\xbb\xbf"), unitWith(`"dcp-jcs-v2"`, "")...)); out.Class != "BOM" {
		t.Errorf("a historical v2 reading selected %+v", out)
	}
	adapter := counting(v2.ExperimentalHistoricalEncodingJSON)
	r := newRouter(t, "bare", both, &adapter.ExperimentalHistoricalAdapter)
	route(t, r, unitWith(`"dcp-jcs-v2"`, ""))
	route(t, r, unitWith(`"DCP-JCS-V2"`, ""))
	route(t, r, unitWith(`"dcp-jcs-v2"`, `,"x":1.5`))
	if adapter.calls != 0 {
		t.Errorf("consulted %d times before it was needed", adapter.calls)
	}
	route(t, r, unitWith(`"dcp-jcs-v1"`, ""))
	route(t, r, bomV1)
	if adapter.calls != 2 {
		t.Errorf("consulted %d times", adapter.calls)
	}

	shared := map[string]any{"a": 1.0}
	cyclic := map[string]any{}
	cyclic["self"] = cyclic
	type custom struct{ A int }
	for i, bad := range []func([]byte) (any, error){
		func([]byte) (any, error) { return 1, nil },
		func([]byte) (any, error) { return []string{"x"}, nil },
		func([]byte) (any, error) { return map[string]string{}, nil },
		func([]byte) (any, error) { return custom{}, nil },
		func([]byte) (any, error) { return map[string]any{"a": shared, "b": shared}, nil },
		func([]byte) (any, error) { return cyclic, nil },
		func([]byte) (any, error) { return nil, errors.New("not a refusal") },
		func([]byte) (any, error) { panic("synthetic") },
	} {
		_, err := newRouter(t, "bare", both, &v2.ExperimentalHistoricalAdapter{Name: "custom", Decode: bad}).Route(bomV1)
		var adapterErr *v2.ExperimentalCandidateAdapterError
		if !errors.As(err, &adapterErr) {
			t.Errorf("bad adapter %d: %v", i, err)
		}
	}
	refuses := &v2.ExperimentalHistoricalAdapter{Name: "refuses", Decode: func([]byte) (any, error) {
		return nil, fmt.Errorf("%w: no", v2.ErrHistoricalDecodeFailure)
	}}
	if out := route(t, newRouter(t, "bare", both, refuses), bomV1); out.Class != "BOM" {
		t.Errorf("a refusal of the data: %+v", out)
	}
}

func TestExperimentalCandidateRouterOwnership(t *testing.T) {
	// Not walkable (invalid UTF-8), so the adapter decides; encoding/json repairs the byte and reads v1.
	original := unitWith(`"dcp-jcs-v1"`, ",\"x\":\"\xff\"")
	input := append([]byte(nil), original...)
	mutating := &v2.ExperimentalHistoricalAdapter{Name: "mutating", Decode: func(u []byte) (any, error) {
		v, err := v2.ExperimentalHistoricalEncodingJSON.Decode(u)
		for i := range u {
			u[i] = 0
		}
		for i := range input {
			input[i] = ' '
		}
		return v, err
	}}
	r := newRouter(t, "bare", both, mutating)
	first := route(t, r, input)
	if first.Outcome != "v1_path" || !bytes.Equal(first.Unit.Bytes, original) {
		t.Fatalf("first: %+v", first)
	}
	for i := range first.Unit.Bytes {
		first.Unit.Bytes[i] = 1 // the returned copy is mutable; nothing else changes
	}
	if second := route(t, r, original); second.Outcome != "v1_path" || !bytes.Equal(second.Unit.Bytes, original) {
		t.Fatalf("second: %+v", second)
	}
}

func TestExperimentalCandidateRouterBoundaries(t *testing.T) {
	if _, err := v2.ExperimentalCandidateExtractUnit([]byte("{}"), "header"); err == nil {
		t.Error("an unknown transport was accepted")
	}
	env := newRouter(t, "envelope", both, &v2.ExperimentalHistoricalEncodingJSON)
	out := route(t, env, []byte("{\"signed_bundle\":{\"x\":\"\xff\"}}"))
	if out.Outcome != "v1_path" || out.ProfileSource != "historical" || out.Unit.Start != 17 || out.Unit.End != 26 ||
		!reflect.DeepEqual(out.Warnings, []v2.ExperimentalCandidateWarning{{Class: "UTF8_INVALID", Offset: 6, TransportOffset: 23}}) {
		t.Errorf("invalid UTF-8 inside the unit: %+v", out) // encoding/json repairs it and reads no profile: absent
	}
	out = route(t, env, []byte(`{"a":1,"signed_bundle":{"bundle":{"manifest":{"canonicalization_profile":"x"}}}}`))
	if out.Class != "PROFILE_UNKNOWN" || *out.Offset != 50 || *out.TransportOffset != 73 || out.Unit.Start != 23 || out.Unit.End != 79 {
		t.Errorf("offsets: %+v", out)
	}
	out = route(t, env, []byte(`{"signed_bundle":1,"signed_bundle":2}`))
	if out.Class != "TRANSPORT_AMBIGUOUS" || out.Offset != nil || *out.TransportOffset != 19 || out.Unit != nil {
		t.Errorf("repeated: %+v", out)
	}
	deep := []byte(`{"signed_bundle":` + strings.Repeat("[", 20000) + strings.Repeat("]", 20000) + `}`)
	if x, _ := v2.ExperimentalCandidateExtractUnit(deep, "envelope"); x.Rejected || x.Start != 17 || x.End != 40017 {
		t.Errorf("deep extraction: %+v", x)
	}
	out = route(t, env, deep)
	if out.Outcome != "v1_path" || out.ProfileSource != "absent" || !reflect.DeepEqual(out.Warnings, []v2.ExperimentalCandidateWarning{{Class: "DEPTH_EXCEEDED", Offset: 64, TransportOffset: 81}}) {
		t.Errorf("deep: %+v", out.Warnings)
	}
}
