package v2_test

// Gate 7, dcp-jcs-v1 side (docs/proposals/canonicalization-candidate/README.md §9): a defect of each unit class,
// injected at byte level into a dcp-jcs-v1 bundle, keeps today's verdict. The public fixture
// tests/interop/candidate/gate7-v1-negatives.json has 38 cases over the frozen phase 3 bases with a reasoned
// expectation for each of 10 configurations; this file runs the Go one (38 checks) and, apart, the 3 envelope
// boundary cases (no equivalence claimed).
//
// For each case the experimental verifier (§17, bare, ["dcp-jcs-v1"]) and today's route of this SDK
// (VerifySignedBundleV2At on the bytes, which parses them itself) get the same bytes, clock and policy. Their results
// must be deeply equal on every field of V2VerificationResult and both must match the expectation. Today's parse
// failure comes back in band; it counts as one only in strict form and corroborated by encoding/json refusing the
// same bytes. A panic or an error of either side is never parity and never a rejection. The verifiers really
// entered are observed through the test-only probe, and the public verifier must give the same result.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

const g7Config = "go.encoding_json"

// The fields of V2VerificationResult: equality between the routes is deep equality over exactly these.
var g7Declared = []string{"Verified", "DCPVersion", "Errors", "Warnings", "ClassicalValid", "PQValid", "SessionBindingValid", "ManifestValid", "VerificationMode", "ResolvedTier", "SignerKeys"}

type g7Shape struct {
	Verified      bool      `json:"verified"`
	ErrorsContain []string  `json:"errors_contain"`
	ErrorCount    int       `json:"error_count"`
	Warnings      *[]string `json:"warnings"`
	Fields        struct {
		ManifestValid    *bool   `json:"manifest_valid"`
		VerificationMode *string `json:"verification_mode"`
		ResolvedTier     *string `json:"resolved_tier"`
	} `json:"fields"`
}

type g7Expect struct {
	Route        json.RawMessage `json:"route"`
	AdapterCalls int             `json:"adapter_calls"`
	Entered      string          `json:"entered"`
	Today        *struct {
		Outcome string  `json:"outcome"`
		Kind    *string `json:"kind"`
	} `json:"today"`
	Verification *string `json:"verification"`
}

type g7Case struct {
	ID          string              `json:"id"`
	Base        string              `json:"base"`
	Mutation    *string             `json:"mutation"`
	Edits       []map[string]any    `json:"edits"`
	InputSHA256 string              `json:"input_sha256"`
	Expected    map[string]g7Expect `json:"expected"`
}

type g7Fixture struct {
	NowMs          int64    `json:"now_ms"`
	Configurations []string `json:"configurations"`
	Bases          map[string]struct {
		InputSHA256 string `json:"input_sha256"`
	} `json:"bases"`
	Mutations map[string]struct {
		Edits []map[string]any `json:"edits"`
	} `json:"mutations"`
	Shapes   map[string]g7Shape `json:"verification_shapes"`
	Cases    []g7Case           `json:"cases"`
	Boundary struct {
		Cases []g7Case `json:"cases"`
	} `json:"boundary"`
	bases map[string][]byte
}

func g7Load(t *testing.T) *g7Fixture {
	t.Helper()
	dir := filepath.Join("..", "..", "..", "..", "tests", "interop", "candidate")
	var f g7Fixture
	data, err := os.ReadFile(filepath.Join(dir, "gate7-v1-negatives.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	var p3 struct {
		NowMs int64 `json:"now_ms"`
		Bases map[string]struct {
			InputJSON string `json:"input_json"`
		} `json:"bases"`
	}
	data, err = os.ReadFile(filepath.Join(dir, "phase3-signed-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &p3); err != nil {
		t.Fatal(err)
	}
	if p3.NowMs != f.NowMs {
		t.Fatalf("now_ms %d is not the phase 3 instant %d", f.NowMs, p3.NowMs)
	}
	f.bases = map[string][]byte{}
	for name := range f.Bases {
		f.bases[name] = []byte(p3.Bases[name].InputJSON)
	}
	return &f
}

func g7Sha(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

// g7Apply is the fixture's edit grammar, written here independently of the Python checker.
func g7Apply(t *testing.T, base []byte, edits []map[string]any) []byte {
	t.Helper()
	out := append([]byte{}, base...)
	unhex := func(s any) []byte {
		b, err := hex.DecodeString(s.(string))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	for _, e := range edits {
		switch {
		case e["prefix"] != nil:
			out = append([]byte(e["prefix"].(string)), out...)
		case e["prefix_hex"] != nil:
			out = append(unhex(e["prefix_hex"]), out...)
		case e["append"] != nil:
			out = append(out, []byte(e["append"].(string))...)
		case e["append_hex"] != nil:
			out = append(out, unhex(e["append_hex"])...)
		case e["drop_last"] != nil:
			out = out[:len(out)-int(e["drop_last"].(float64))]
		case e["replace_once"] != nil:
			find := []byte(e["replace_once"].(string))
			if bytes.Count(out, find) != 1 {
				t.Fatalf("anchor not unique: %s", find)
			}
			with := []byte(fmt.Sprint(e["with"]))
			if e["with_hex"] != nil {
				with = unhex(e["with_hex"])
			}
			out = bytes.Replace(out, find, with, 1)
		default:
			t.Fatalf("unknown edit %v", e)
		}
	}
	return out
}

func (f *g7Fixture) input(t *testing.T, c g7Case) []byte {
	if c.Mutation == nil && c.Edits == nil {
		return append([]byte{}, f.bases[c.Base]...)
	}
	edits := c.Edits
	if c.Mutation != nil {
		edits = f.Mutations[*c.Mutation].Edits
	}
	return g7Apply(t, f.bases[c.Base], edits)
}

// ── The two routes, each classified into exactly one outcome ──

type g7Today struct {
	outcome string // verified_result, in_band_parse_error or verifier_error
	kind    string
	result  *v2.V2VerificationResult
	message string
}

type g7Exp struct {
	outcome string // returned or verifier_error
	r       v2.ExperimentalCandidateVerification
	calls   int
	entries []string
	message string
}

// g7StrictParseFailure is the in-band shape of a parse failure: one "JSON parse error: " and nothing else set.
func g7StrictParseFailure(r *v2.V2VerificationResult) bool {
	return !r.Verified && r.DCPVersion == "2.0" && len(r.Errors) == 1 && strings.HasPrefix(r.Errors[0], "JSON parse error: ") &&
		len(r.Warnings) == 0 && !r.ClassicalValid && !r.PQValid && !r.SessionBindingValid && !r.ManifestValid &&
		r.VerificationMode == "" && r.ResolvedTier == "" && len(r.SignerKeys) == 0
}

func g7RunToday(reg *v2.AlgorithmRegistry, data []byte, now time.Time) (out g7Today) {
	defer func() {
		if p := recover(); p != nil {
			out = g7Today{outcome: "verifier_error", message: fmt.Sprint(p)}
		}
	}()
	return g7ClassifyToday(data, v2.VerifySignedBundleV2At(reg, data, v2.DefaultVerifierPolicy(), now))
}

// g7ClassifyToday classifies what VerifySignedBundleV2At returned for data. A parse failure counts only in
// strict form and corroborated by encoding/json refusing the same bytes; an uncorroborated one is a
// verifier_error, never a rejection. Anything else is a verified_result.
func g7ClassifyToday(data []byte, r *v2.V2VerificationResult) g7Today {
	if !g7StrictParseFailure(r) {
		return g7Today{outcome: "verified_result", result: r}
	}
	var probe any
	if json.Unmarshal(data, &probe) == nil {
		return g7Today{outcome: "verifier_error", message: "an in-band parse failure that encoding/json does not corroborate: " + r.Errors[0]}
	}
	return g7Today{outcome: "in_band_parse_error", kind: "JSON parse error", result: r}
}

func g7RunExperimental(reg *v2.AlgorithmRegistry, data []byte, transport string, now time.Time) (out g7Exp) {
	defer func() {
		if p := recover(); p != nil {
			out = g7Exp{outcome: "verifier_error", message: fmt.Sprint(p)}
		}
	}()
	cfg := v2.ExperimentalCandidateVerifierConfig{Transport: transport, AcceptedProfiles: []string{"dcp-jcs-v1"}, Historical: "encoding_json"}
	entries := []string{}
	decodes := 0
	verifier, err := v2.NewExperimentalCandidateVerifierForTests(cfg, func(e string) { entries = append(entries, e) }, &decodes)
	if err != nil {
		return g7Exp{outcome: "verifier_error", message: err.Error()}
	}
	r, err := verifier.VerifyAt(reg, data, v2.DefaultVerifierPolicy(), now)
	if err != nil {
		return g7Exp{outcome: "verifier_error", message: err.Error()}
	}
	// The public verifier, without probe or counter, gives the same result.
	plain, err := v2.NewExperimentalCandidateVerifier(cfg)
	if err != nil {
		return g7Exp{outcome: "verifier_error", message: err.Error()}
	}
	if again, err := plain.VerifyAt(reg, data, v2.DefaultVerifierPolicy(), now); err != nil || !reflect.DeepEqual(again, r) {
		return g7Exp{outcome: "verifier_error", message: fmt.Sprintf("the public verifier differs from the probed one: %v", err)}
	}
	return g7Exp{outcome: "returned", r: r, calls: decodes, entries: entries}
}

// ── The judgement: pure, so the self-tests can feed it fakes ──

func g7RouteShape(route v2.ExperimentalCandidateRoute, transport bool) map[string]any {
	switch route.Outcome {
	case "v1_path":
		classes := []string{}
		for _, w := range route.Warnings {
			classes = append(classes, w.Class)
		}
		h := "failed"
		if route.Historical != nil && route.Historical.OK {
			h = "decoded"
		}
		return map[string]any{"outcome": "v1_path", "profile_source": route.ProfileSource, "warning_classes": classes, "historical": h}
	case "reject":
		if transport {
			return map[string]any{"outcome": "reject", "class": route.Class, "detail": route.Detail}
		}
		var offset any
		if route.Offset != nil {
			offset = *route.Offset
		}
		return map[string]any{"outcome": "reject", "class": route.Class, "offset": offset}
	}
	return map[string]any{"outcome": route.Outcome}
}

func g7SameJSON(a any, b json.RawMessage) bool {
	x, _ := json.Marshal(a)
	var y any
	_ = json.Unmarshal(b, &y)
	z, _ := json.Marshal(y)
	return bytes.Equal(x, z)
}

func g7ShapeProblems(r *v2.V2VerificationResult, s g7Shape) []string {
	var p []string
	if r.Verified != s.Verified {
		p = append(p, fmt.Sprintf("verified %v, expected %v", r.Verified, s.Verified))
	}
	if len(r.Errors) != s.ErrorCount {
		p = append(p, fmt.Sprintf("%d errors, expected %d: %q", len(r.Errors), s.ErrorCount, r.Errors))
	}
	for _, sub := range s.ErrorsContain {
		found := false
		for _, e := range r.Errors {
			found = found || strings.Contains(e, sub)
		}
		if !found {
			p = append(p, fmt.Sprintf("no error contains %q: %q", sub, r.Errors))
		}
	}
	if s.Warnings == nil || !reflect.DeepEqual(append([]string{}, r.Warnings...), append([]string{}, (*s.Warnings)...)) {
		p = append(p, fmt.Sprintf("warnings %q, expected %v", r.Warnings, s.Warnings))
	}
	str := func(v string) *string {
		if v == "" {
			return nil
		}
		return &v
	}
	if s.Fields.ManifestValid == nil || r.ManifestValid != *s.Fields.ManifestValid {
		p = append(p, fmt.Sprintf("manifest_valid %v, expected %v", r.ManifestValid, s.Fields.ManifestValid))
	}
	for name, pair := range map[string][2]*string{"verification_mode": {str(r.VerificationMode), s.Fields.VerificationMode}, "resolved_tier": {str(r.ResolvedTier), s.Fields.ResolvedTier}} {
		if !reflect.DeepEqual(pair[0], pair[1]) {
			p = append(p, fmt.Sprintf("%s %v, expected %v", name, pair[0], pair[1]))
		}
	}
	return p
}

func g7Judge(f *g7Fixture, e g7Expect, today *g7Today, x g7Exp, transport bool) []string {
	if x.outcome == "verifier_error" {
		return []string{"experimental verifier_error: " + x.message}
	}
	if today != nil && today.outcome == "verifier_error" {
		return []string{"today verifier_error: " + today.message}
	}
	var p []string
	if got := g7RouteShape(x.r.Route, transport); !g7SameJSON(got, e.Route) {
		p = append(p, fmt.Sprintf("route %v, expected %s", got, e.Route))
	}
	if x.calls != e.AdapterCalls {
		p = append(p, fmt.Sprintf("adapter calls %d, expected %d", x.calls, e.AdapterCalls))
	}
	if x.r.Entered != e.Entered {
		p = append(p, fmt.Sprintf("entered %s, expected %s", x.r.Entered, e.Entered))
	}
	wanted, implied := []string{}, []string{}
	if e.Entered != "none" {
		wanted = []string{"dcp-jcs-v1"}
	}
	if x.r.Entered != "none" {
		implied = []string{x.r.Entered}
	}
	if !reflect.DeepEqual(append([]string{}, x.entries...), wanted) {
		p = append(p, fmt.Sprintf("verifier entries %v, expected %v", x.entries, wanted))
	}
	if !reflect.DeepEqual(append([]string{}, x.entries...), implied) {
		p = append(p, fmt.Sprintf("verifier entries %v contradict entered %s", x.entries, x.r.Entered))
	}
	v := x.r.Verification
	switch {
	case e.Verification == nil && v != nil:
		p = append(p, "a verification where none was expected")
	case e.Verification != nil && v == nil:
		p = append(p, "no verification, expected "+*e.Verification)
	case e.Verification != nil:
		for _, m := range g7ShapeProblems(v, f.Shapes[*e.Verification]) {
			p = append(p, "experimental: "+m)
		}
	}
	if today == nil {
		return p
	}
	switch {
	case today.outcome != e.Today.Outcome:
		p = append(p, fmt.Sprintf("today %s, expected %s", today.outcome, e.Today.Outcome))
	case today.outcome == "in_band_parse_error":
		if e.Today.Kind == nil || today.kind != *e.Today.Kind {
			p = append(p, fmt.Sprintf("today in-band error %s, expected %v", today.kind, e.Today.Kind))
		}
		if v != nil && !reflect.DeepEqual(*today.result, *v) {
			p = append(p, fmt.Sprintf("the routes differ: today %+v / experimental %+v", *today.result, *v))
		}
	case today.outcome == "verified_result":
		if e.Verification != nil {
			for _, m := range g7ShapeProblems(today.result, f.Shapes[*e.Verification]) {
				p = append(p, "today: "+m)
			}
		}
		if v == nil {
			p = append(p, "today verified a result but the experimental route entered no verifier")
		} else if !reflect.DeepEqual(*today.result, *v) {
			p = append(p, fmt.Sprintf("the routes differ: today %+v / experimental %+v", *today.result, *v))
		}
	}
	return p
}

type g7Outcome struct {
	id       string
	problems []string
}

// g7Gate: a failed or missing control invalidates every case of its base.
func g7Gate(results []g7Outcome) []g7Outcome {
	out := make([]g7Outcome, 0, len(results))
	for _, r := range results {
		if strings.HasSuffix(r.id, "C00") {
			out = append(out, r)
			continue
		}
		id := r.id[:6] + "C00"
		var control *g7Outcome
		for i := range results {
			if results[i].id == id {
				control = &results[i]
			}
		}
		switch {
		case control == nil:
			r.problems = append([]string{"control_missing: " + id}, r.problems...)
		case len(control.problems) > 0:
			r.problems = append([]string{"control_failed: " + id}, r.problems...)
		}
		out = append(out, r)
	}
	return out
}

func g7Registry() *v2.AlgorithmRegistry { return p3Registry() }

func (f *g7Fixture) runCase(t *testing.T, reg *v2.AlgorithmRegistry, c g7Case, now time.Time) ([]string, g7Today, g7Exp) {
	data := f.input(t, c)
	frozen := append([]byte{}, data...)
	today := g7RunToday(reg, data, now)
	x := g7RunExperimental(reg, data, "bare", now)
	p := g7Judge(f, c.Expected[g7Config], &today, x, false)
	if !bytes.Equal(data, frozen) {
		p = append(p, "the input buffer was changed")
	}
	return p, today, x
}

func (f *g7Fixture) byID(id string) g7Case {
	for _, c := range f.Cases {
		if c.ID == id {
			return c
		}
	}
	panic(id)
}

func TestGate7Fixture(t *testing.T) {
	f := g7Load(t)
	var ids []string
	for _, c := range f.Cases {
		ids = append(ids, c.ID)
		if len(c.Expected) != 10 {
			t.Errorf("%s: %d configurations", c.ID, len(c.Expected))
		}
		if got := g7Sha(f.input(t, c)); got != c.InputSHA256 {
			t.Errorf("%s: input hash %s", c.ID, got)
		}
	}
	var want []string
	for _, tag := range []string{"V1", "AB"} {
		for i := 0; i <= 18; i++ {
			if i == 0 {
				want = append(want, "G7-"+tag+"-C00")
			} else {
				want = append(want, fmt.Sprintf("G7-%s-M%02d", tag, i))
			}
		}
	}
	if !reflect.DeepEqual(ids, want) {
		t.Errorf("case IDs %v, want %v", ids, want)
	}
	if len(f.Configurations) != 10 || !strings.Contains(strings.Join(f.Configurations, ","), g7Config) {
		t.Errorf("configurations %v", f.Configurations)
	}
	for name, b := range f.Bases {
		if g7Sha(f.bases[name]) != b.InputSHA256 {
			t.Errorf("base %s hash", name)
		}
	}
	for _, c := range f.Boundary.Cases {
		if got := g7Sha(f.input(t, c)); got != c.InputSHA256 {
			t.Errorf("%s: input hash %s", c.ID, got)
		}
	}
	// The declared fields are every field of the result type: a new field forces a decision here.
	var fields []string
	rt := reflect.TypeOf(v2.V2VerificationResult{})
	for i := 0; i < rt.NumField(); i++ {
		fields = append(fields, rt.Field(i).Name)
	}
	if !reflect.DeepEqual(fields, g7Declared) {
		t.Errorf("V2VerificationResult fields %v, declared %v", fields, g7Declared)
	}
}

func TestGate7Cases(t *testing.T) {
	f := g7Load(t)
	reg := g7Registry()
	now := time.UnixMilli(f.NowMs)
	var results []g7Outcome
	for _, c := range f.Cases {
		p, _, _ := f.runCase(t, reg, c, now)
		results = append(results, g7Outcome{c.ID, p})
	}
	if len(results) != 38 { // completeness: zero executed checks can never pass
		t.Fatalf("%d checks", len(results))
	}
	for _, r := range g7Gate(results) {
		if len(r.problems) > 0 {
			t.Errorf("%s %s: %s", g7Config, r.id, strings.Join(r.problems, " | "))
		}
	}
}

func TestGate7EnvelopeBoundary(t *testing.T) {
	f := g7Load(t)
	reg := g7Registry()
	now := time.UnixMilli(f.NowMs)
	bare := g7RunExperimental(reg, f.input(t, f.byID("G7-V1-C00")), "bare", now)
	checks := 0
	for _, c := range f.Boundary.Cases {
		x := g7RunExperimental(reg, f.input(t, c), "envelope", now)
		if p := g7Judge(f, c.Expected[g7Config], nil, x, true); len(p) > 0 {
			t.Errorf("%s: %s", c.ID, strings.Join(p, " | "))
		}
		if c.ID == "G7E-1" && !reflect.DeepEqual(x.r.Verification, bare.r.Verification) {
			t.Errorf("G7E-1 differs from the bare control: %+v / %+v", x.r.Verification, bare.r.Verification)
		}
		checks++
	}
	if checks != 3 {
		t.Fatalf("%d boundary checks", checks)
	}
}

func TestGate7JudgementCanFail(t *testing.T) {
	f := g7Load(t)
	reg := g7Registry()
	now := time.UnixMilli(f.NowMs)
	control := f.byID("G7-V1-C00")
	exp := control.Expected[g7Config]
	has := func(p []string, prefix string) bool {
		for _, m := range p {
			if strings.HasPrefix(m, prefix) {
				return true
			}
		}
		return false
	}

	t.Run("the experimental route outside the bundle window", func(t *testing.T) {
		data := f.input(t, control)
		today := g7RunToday(reg, data, now)
		late := g7RunExperimental(reg, data, "bare", time.Date(2100, 1, 2, 0, 0, 0, 0, time.UTC))
		if !has(g7Judge(f, exp, &today, late, false), "the routes differ") {
			t.Error("not reported")
		}
	})
	t.Run("one changed error entry", func(t *testing.T) {
		m10 := f.byID("G7-V1-M10")
		p, today, x := f.runCase(t, reg, m10, now)
		if len(p) > 0 {
			t.Fatal(p)
		}
		altered := *x.r.Verification
		altered.Errors = append([]string{}, altered.Errors...)
		altered.Errors[0] += " (altered)"
		x.r.Verification = &altered
		if !has(g7Judge(f, m10.Expected[g7Config], &today, x, false), "the routes differ") {
			t.Error("not reported")
		}
	})
	t.Run("a verifier error, even on both sides", func(t *testing.T) {
		boom := g7Today{outcome: "verifier_error", message: "provider exploded"}
		got := g7Judge(f, exp, &boom, g7Exp{outcome: "verifier_error", message: "provider exploded"}, false)
		if !reflect.DeepEqual(got, []string{"experimental verifier_error: provider exploded"}) {
			t.Error(got)
		}
	})
	t.Run("a second, a candidate or a missing entry", func(t *testing.T) {
		_, today, x := f.runCase(t, reg, control, now)
		if !reflect.DeepEqual(x.entries, []string{"dcp-jcs-v1"}) {
			t.Fatal(x.entries)
		}
		for _, entries := range [][]string{{"dcp-jcs-v1", "dcp-jcs-v1"}, {"dcp-jcs-v2"}, {}} {
			y := x
			y.entries = entries
			if !has(g7Judge(f, exp, &today, y, false), "verifier entries") {
				t.Errorf("%v not reported", entries)
			}
		}
		g7e2 := f.Boundary.Cases[1]
		rejected := g7RunExperimental(reg, f.input(t, g7e2), "envelope", now)
		if len(rejected.entries) != 0 {
			t.Fatal(rejected.entries)
		}
		rejected.entries = []string{"dcp-jcs-v1"}
		if !has(g7Judge(f, g7e2.Expected[g7Config], nil, rejected, true), "verifier entries") {
			t.Error("an entry under G7E-2 not reported")
		}
	})
	t.Run("a missing control", func(t *testing.T) {
		out := g7Gate([]g7Outcome{{id: "G7-V1-M01"}})
		if !reflect.DeepEqual(out[0].problems, []string{"control_missing: G7-V1-C00"}) {
			t.Error(out[0].problems)
		}
	})
	t.Run("the in-band parse classifier", func(t *testing.T) {
		valid := f.input(t, control)
		invalid := f.input(t, f.byID("G7-V1-M04")) // a trailing comma: encoding/json refuses it
		fake := func() *v2.V2VerificationResult {
			return &v2.V2VerificationResult{DCPVersion: "2.0", Errors: []string{"JSON parse error: invented"}, Warnings: []string{}, SignerKeys: []v2.SignerKeyUse{}}
		}
		// A strict parse failure on bytes encoding/json accepts is not corroborated: a verifier_error.
		if got := g7ClassifyToday(valid, fake()); got.outcome != "verifier_error" || !strings.Contains(got.message, "does not corroborate") {
			t.Errorf("fake parse error on a valid base: %+v", got)
		}
		// The real in-band failure on bytes encoding/json refuses is recognized.
		real := v2.VerifySignedBundleV2At(reg, invalid, v2.DefaultVerifierPolicy(), now)
		if got := g7ClassifyToday(invalid, real); got.outcome != "in_band_parse_error" || got.kind != "JSON parse error" || got.result != real {
			t.Errorf("real parse error: %+v", got)
		}
		// The same shape with a warning is not a strict parse failure: it stays a result.
		warned := fake()
		warned.Warnings = []string{"w"}
		if got := g7ClassifyToday(invalid, warned); got.outcome != "verified_result" {
			t.Errorf("a parse failure with a warning: %+v", got)
		}
		// A full result on the valid base is a result.
		if got := g7ClassifyToday(valid, v2.VerifySignedBundleV2At(reg, valid, v2.DefaultVerifierPolicy(), now)); got.outcome != "verified_result" {
			t.Errorf("the control: %+v", got)
		}
	})
	t.Run("fakes that reject or accept everything", func(t *testing.T) {
		reject := g7Exp{outcome: "returned", r: v2.ExperimentalCandidateVerification{Route: v2.ExperimentalCandidateRoute{Outcome: "reject", Class: "SYNTAX", Offset: new(int)}, Entered: "none"}, calls: 1, entries: []string{}}
		inBand := g7Today{outcome: "in_band_parse_error", kind: "JSON parse error", result: &v2.V2VerificationResult{}}
		var out []g7Outcome
		for _, c := range f.Cases {
			out = append(out, g7Outcome{c.ID, g7Judge(f, c.Expected[g7Config], &inBand, reject, false)})
		}
		failedControls := 0
		for _, o := range g7Gate(out) {
			if len(o.problems) == 0 {
				t.Errorf("%s passed a reject-everything fake", o.id)
			} else if strings.HasPrefix(o.problems[0], "control_failed") {
				failedControls++
			}
		}
		if failedControls != 36 {
			t.Errorf("%d control_failed, want 36", failedControls)
		}
		_, today, x := f.runCase(t, reg, control, now)
		negatives := 0
		for _, c := range f.Cases {
			if v := c.Expected[g7Config].Verification; v != nil && *v == "go.ok" {
				continue
			}
			negatives++
			if len(g7Judge(f, c.Expected[g7Config], &today, x, false)) == 0 {
				t.Errorf("%s passed an accept-everything fake", c.ID)
			}
		}
		if negatives < 10 {
			t.Errorf("only %d negatives", negatives)
		}
	})
}
