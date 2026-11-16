package v2

// V2-2 in the Go SDK, the internal interpreter (schema_v2.go) over the shared corpus of
// tests/interop/v2/schema_validation/: its value set, the programs, the date-time boundary, the error budget and the
// one-time initialization. schema_v2_test.go runs the gate through the public APIs.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

func schemaRepoFile(t *testing.T, parts ...string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

type schemaCorpus struct {
	Instance json.RawMessage `json:"instance"`
	Cases    []struct {
		ID         string   `json:"id"`
		RawReplace []string `json:"raw_replace"`
		Mutation   *struct {
			Op    string          `json:"op"`
			Path  []any           `json:"path"`
			Value json.RawMessage `json:"value"`
			Count int             `json:"count"`
		} `json:"mutation"`
		Expect struct {
			Schema struct {
				Valid       bool `json:"valid"`
				Attribution *struct {
					Instance string `json:"instance"`
					Keyword  string `json:"keyword"`
				} `json:"attribution"`
			} `json:"schema"`
		} `json:"expect"`
	} `json:"cases"`
}

func loadSchemaCorpus(t *testing.T) (schemaCorpus, []byte) {
	t.Helper()
	var c schemaCorpus
	if err := json.Unmarshal(schemaRepoFile(t, "tests", "interop", "v2", "schema_validation", "schema_cases.json"), &c); err != nil {
		t.Fatal(err)
	}
	// The instance as JSON.stringify writes it (compact, members in order), the text raw_replace edits.
	var text bytes.Buffer
	if err := json.Compact(&text, c.Instance); err != nil {
		t.Fatal(err)
	}
	return c, text.Bytes()
}

// schemaInstance is a fresh decoded copy of the corpus instance.
func schemaInstance(t *testing.T) map[string]any {
	t.Helper()
	_, text := loadSchemaCorpus(t)
	var d map[string]any
	if err := json.Unmarshal(text, &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func schemaV1(t *testing.T, doc any) schemaResult {
	t.Helper()
	r, err := validateSignedBundleV2Schema(doc, "dcp-jcs-v1")
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func schemaPairs(r schemaResult) [][2]string {
	out := [][2]string{}
	for _, e := range r.Errors {
		out = append(out, [2]string{e.Instance, e.Keyword})
	}
	return out
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSchemaIRIsTheStagedIRWithItsSHA256AndTheNotice(t *testing.T) {
	staged := strings.TrimRight(string(schemaRepoFile(t, "tools", "schema-ir", "staging", "ir.json")), "\n")
	if staged != schemaV2IR {
		t.Fatal("schema_v2_generated.go is not the staged IR")
	}
	if sum := sha256.Sum256([]byte(schemaV2IR)); hex.EncodeToString(sum[:]) != schemaV2IRSHA256 {
		t.Fatal("the IR does not match its sha256")
	}
	var ir struct {
		Format  string `json:"format"`
		Sources []struct {
			File   string `json:"file"`
			SHA256 string `json:"sha256"`
		} `json:"sources"`
	}
	if err := json.Unmarshal([]byte(schemaV2IR), &ir); err != nil || ir.Format != "dcp-ai.v2-schema-ir/1" || len(ir.Sources) != 11 {
		t.Fatalf("IR %s with %d sources: %v", ir.Format, len(ir.Sources), err)
	}
	for _, s := range ir.Sources {
		if sum := sha256.Sum256(schemaRepoFile(t, strings.Split(s.File, "/")...)); hex.EncodeToString(sum[:]) != s.SHA256 {
			t.Errorf("%s changed since the IR was generated", s.File)
		}
	}
	source, err := os.ReadFile("schema_v2.go")
	if err != nil || !bytes.Contains(source, []byte("Copyright (c) 2020 Evgeny Poberezkin")) || !bytes.Contains(source, []byte("MIT License")) {
		t.Fatal("the ported notice is missing")
	}
}

// Each case through the decoder the verifier uses (encoding/json into interface{}) and the interpreter, and through
// the verifier route itself, which keeps its parser contract first: a parser rejection is reported as one, never as
// a schema verdict.
func TestSchemaThe468CasesVerdictAttributionAndNothingWritten(t *testing.T) {
	corpus, text := loadSchemaCorpus(t)
	if len(corpus.Cases) != 468 {
		t.Fatalf("%d cases", len(corpus.Cases))
	}
	if r := schemaV1(t, schemaInstance(t)); !r.Valid {
		t.Fatalf("the instance: %v", r.Errors)
	}
	var decoderRejected, routeParser []string
	valid, invalid := 0, 0
	for _, c := range corpus.Cases {
		var doc any
		var data []byte
		if c.RawReplace != nil {
			if bytes.Count(text, []byte(c.RawReplace[0])) != 1 {
				t.Fatalf("%s: raw_replace target", c.ID)
			}
			data = bytes.Replace(text, []byte(c.RawReplace[0]), []byte(c.RawReplace[1]), 1)
			if err := json.Unmarshal(data, &doc); err != nil {
				// The decoder refuses it before any schema check (1e400 overflows binary64).
				decoderRejected = append(decoderRejected, c.ID)
				if c.Expect.Schema.Valid {
					t.Errorf("%s: a schema-valid case the decoder refuses: %v", c.ID, err)
				}
				doc = nil
			}
		} else {
			if err := json.Unmarshal(text, &doc); err != nil {
				t.Fatal(err)
			}
			if m := c.Mutation; m != nil {
				switch m.Op {
				case "set":
					var v any
					if err := json.Unmarshal(m.Value, &v); err != nil {
						t.Fatalf("%s: %v", c.ID, err)
					}
					if len(m.Path) == 0 {
						doc = v
					} else {
						schemaSetAt(t, doc, m.Path, v, false)
					}
				case "delete":
					schemaSetAt(t, doc, m.Path, nil, true)
				case "many":
					for i := 0; i < m.Count; i++ {
						doc.(map[string]any)[fmt.Sprintf("x_unknown_%02d", i)] = float64(i)
					}
				default:
					t.Fatalf("%s: op %s", c.ID, m.Op)
				}
			}
			data = mustJSON(t, doc)
		}
		if !slicesContains(decoderRejected, c.ID) {
			before := mustJSON(t, doc)
			r := schemaV1(t, doc)
			if r.Valid != c.Expect.Schema.Valid {
				t.Errorf("%s: valid %v, want %v: %v", c.ID, r.Valid, c.Expect.Schema.Valid, r.Errors)
			}
			if a := c.Expect.Schema.Attribution; a != nil && !slicesContains(schemaPairs(r), [2]string{a.Instance, a.Keyword}) {
				t.Errorf("%s: not attributed to %s %s: %v", c.ID, a.Instance, a.Keyword, r.Errors)
			}
			if !bytes.Equal(mustJSON(t, doc), before) {
				t.Errorf("%s: the value was written", c.ID)
			}
			if r.Valid {
				valid++
			} else {
				invalid++
			}
		}

		// The verifier route on the bytes. No provider is registered: a schema-valid case fails later, never at V2-2.
		frozen := append([]byte(nil), data...)
		rr := verifySignedBundleV2AtProfile(NewAlgorithmRegistry(), data, DefaultVerifierPolicy(), time.Unix(0, 0), "dcp-jcs-v1")
		if !bytes.Equal(data, frozen) {
			t.Errorf("%s: the input bytes were written", c.ID)
		}
		schemaLines := 0
		for _, e := range rr.Errors {
			if strings.HasPrefix(e, "schema: ") {
				schemaLines++
			}
		}
		switch {
		case len(rr.Errors) == 1 && strings.HasPrefix(rr.Errors[0], "JSON parse error: "):
			routeParser = append(routeParser, c.ID)
			if c.Expect.Schema.Valid {
				t.Errorf("%s: the historical parser refuses a schema-valid case", c.ID)
			}
		case c.Expect.Schema.Valid:
			if schemaLines != 0 {
				t.Errorf("%s: schema errors on a schema-valid case: %v", c.ID, rr.Errors)
			}
		default:
			a := c.Expect.Schema.Attribution
			target := "schema: " + a.Instance + " " + a.Keyword
			if a.Instance == "" {
				target = "schema: / " + a.Keyword
			}
			found := false
			for _, e := range rr.Errors {
				found = found || e == target || strings.HasPrefix(e, target+" ")
			}
			if schemaLines != len(rr.Errors) || !found || len(rr.SignerKeys) != 0 {
				t.Errorf("%s: route errors %v, want V2-2 alone with %s", c.ID, rr.Errors, target)
			}
		}
	}
	// The decoder's one overflow; on the verifier route also the non-object roots, which the historical parser (into
	// a map) refuses before V2-2, as it did before (a null root is validated as null).
	if want := []string{"raw:audit_count 1e400 (non-finite after parsing)"}; !reflect.DeepEqual(decoderRejected, want) {
		t.Errorf("decoder rejections %v", decoderRejected)
	}
	if want := []string{"type@/", "raw:audit_count 1e400 (non-finite after parsing)"}; !sameSet(routeParser, want) {
		t.Errorf("route parser rejections %v", routeParser)
	}
	t.Logf("interpreter: %d valid, %d invalid, %d refused by the decoder; route: %d parser rejections", valid, invalid, len(decoderRejected), len(routeParser))
}

func schemaSetAt(t *testing.T, doc any, path []any, v any, del bool) {
	t.Helper()
	node := doc
	for i, k := range path {
		last := i == len(path)-1
		switch n := node.(type) {
		case map[string]any:
			key := k.(string)
			if last {
				if del {
					delete(n, key)
				} else {
					n[key] = v
				}
				return
			}
			node = n[key]
		case []any:
			idx := int(k.(float64))
			if last {
				n[idx] = v
				return
			}
			node = n[idx]
		default:
			t.Fatalf("path %v", path)
		}
	}
}

func slicesContains[T comparable](s []T, v T) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func sameSet(a, b []string) bool {
	x, y := append([]string(nil), a...), append([]string(nil), b...)
	sort.Strings(x)
	sort.Strings(y)
	return reflect.DeepEqual(x, y)
}

func schemaAt(t *testing.T, f func(d map[string]any)) schemaResult {
	t.Helper()
	d := schemaInstance(t)
	f(d)
	return schemaV1(t, d)
}

func obj(v any, path ...string) map[string]any {
	n := v.(map[string]any)
	for _, k := range path {
		n = n[k].(map[string]any)
	}
	return n
}

func TestSchemaPayloadsAreClosedAndOpenObjectsStayOpen(t *testing.T) {
	r := schemaAt(t, func(d map[string]any) { obj(d, "bundle", "intent", "payload")["x_unknown"] = 1.0 })
	if got := schemaPairs(r); !reflect.DeepEqual(got, [][2]string{{"/bundle/intent/payload", "additionalProperties"}}) {
		t.Fatal(got)
	}
	r = schemaAt(t, func(d map[string]any) {
		obj(d, "bundle")["x"] = map[string]any{"deep": []any{1.0, []any{2.0, map[string]any{"three": nil}}}}
		obj(d, "bundle", "intent", "payload", "target")["x"] = "open"
		obj(d, "bundle", "policy_decision", "payload")["required_confirmation"] = map[string]any{"type": "human_approve", "x": "open"}
		obj(d, "bundle")["audit_entries"].([]any)[0].(map[string]any)["evidence"].(map[string]any)["x"] = "open"
	})
	if !r.Valid {
		t.Fatal(r.Errors)
	}
}

// The native value set is the decoder's: nil, bool, float64, string, []any and map[string]any. Any other Go value
// is not a JSON value where a schema visits it.
func TestSchemaTheNativeBoundaryOfNumbersStringsListsAndKeys(t *testing.T) {
	setCount := func(v any) func(d map[string]any) {
		return func(d map[string]any) { obj(d, "bundle", "manifest")["audit_count"] = v }
	}
	if !schemaAt(t, setCount(3.0)).Valid || !schemaAt(t, setCount(float64(1<<62))).Valid {
		t.Error("a finite float64 with no fraction is an integer")
	}
	for _, bad := range []any{3.5, true, false, "3", math.NaN(), math.Inf(1), math.Inf(-1), nil, 3, int64(3), json.Number("3")} {
		if r := schemaAt(t, setCount(bad)); r.Valid {
			t.Errorf("%#v is an integer", bad)
		}
	}
	// absent and null differ
	if !schemaAt(t, func(d map[string]any) {
		obj(d, "bundle", "responsible_principal_record", "payload")["expires_at"] = nil
	}).Valid {
		t.Error("expires_at null")
	}
	r := schemaAt(t, func(d map[string]any) {
		delete(obj(d, "bundle", "responsible_principal_record", "payload"), "expires_at")
	})
	if len(r.Errors) != 1 || r.Errors[0].Keyword != "required" || r.Errors[0].Member != "expires_at" {
		t.Error(r.Errors)
	}
	// a []any is an array and a map[string]any an object; typed Go containers are neither
	r = schemaAt(t, func(d map[string]any) {
		s := obj(d, "signature", "signer")
		kids := []string{}
		for _, k := range s["kids"].([]any) {
			kids = append(kids, k.(string))
		}
		s["kids"] = kids
	})
	if got := schemaPairs(r); !reflect.DeepEqual(got, [][2]string{{"/signature/signer/kids", "type"}}) {
		t.Error(got)
	}
	r = schemaAt(t, func(d map[string]any) { obj(d, "signature")["signer"] = map[string]string{"type": "human"} })
	if got := schemaPairs(r); !reflect.DeepEqual(got, [][2]string{{"/signature/signer", "type"}}) {
		t.Error(got)
	}
	// open members are not visited by V2-2 (bundle.x is unsigned: no later check may read it either)
	if !schemaAt(t, func(d map[string]any) {
		obj(d, "bundle")["x"] = map[string]any{"a": math.NaN(), "f": func() {}, "c": make(chan int), "t": []int{1, 2}}
	}).Valid {
		t.Error("an open member was visited")
	}
	// code points: an astral character counts one, and so does the U+FFFD the decoder gives a lone surrogate
	jur := func(v string) bool {
		return schemaAt(t, func(d map[string]any) {
			obj(d, "bundle", "responsible_principal_record", "payload")["jurisdiction"] = v
		}).Valid
	}
	var lone string
	if err := json.Unmarshal([]byte(`"\ud800\ud800"`), &lone); err != nil || lone != "��" {
		t.Fatalf("decoder: %q %v", lone, err)
	}
	if !jur("\U0001F600\U0001F600") || jur("\U0001F600") || !jur(lone) || jur("�") {
		t.Error("lengths are not in code points")
	}
}

func TestSchemaOneOfIsOneBranchReportedOnce(t *testing.T) {
	pq := func(v any) schemaResult {
		return schemaAt(t, func(d map[string]any) { obj(d, "signature", "composite_sig")["pq"] = v })
	}
	orig := obj(schemaInstance(t), "signature", "composite_sig", "pq")
	if !pq(nil).Valid || !pq(orig).Valid {
		t.Fatal("null and the signature are the two branches")
	}
	withX := map[string]any{"x": 1.0}
	for k, v := range orig {
		withX[k] = v
	}
	for _, v := range []any{map[string]any{}, false, "x", withX} {
		if got := schemaPairs(pq(v)); !reflect.DeepEqual(got, [][2]string{{"/signature/composite_sig/pq", "oneOf"}}) {
			t.Errorf("%v: %v", v, got)
		}
	}
}

// Each program against Go's RE2 compilation of its anchored ASCII source: there ^ and $ (no m flag) are the ends of
// the text, a full match, as in ECMAScript.
func TestSchemaEachPatternProgramAnswersAsItsAnchoredSource(t *testing.T) {
	ir, err := loadSchemaIR()
	if err != nil {
		t.Fatal(err)
	}
	rnd := rand.New(rand.NewSource(20261102))
	alphabet := []string{"0", "9", "a", "f", "g", "A", "G", ":", "=", "+", "/", " ", "\n", "\r", " ", "١", "\U0001F600", "s", "h", "E", "N"}
	for i := range ir.Patterns {
		p := &ir.Patterns[i]
		re := regexp.MustCompile(p.Source)
		samples := []string{"", "GENESIS", "GENESIS\n", "AAAA==", "AAAA===", "sha256:" + strings.Repeat("a", 64), "sha256:" + strings.Repeat("a", 64) + "\n", strings.Repeat("a", 32), strings.Repeat("a", 64)}
		for n := 0; n < 2000; n++ {
			var b strings.Builder
			for k := rnd.Intn(72); k > 0; k-- {
				b.WriteString(alphabet[rnd.Intn(len(alphabet))])
			}
			samples = append(samples, b.String())
		}
		for _, s := range samples {
			if schemaMatchProgram(p, s) != re.MatchString(s) {
				t.Errorf("%s on %q", p.Source, s)
			}
		}
	}
}

func TestSchemaDateTimeIsTheAjvFormatsBoundaryOnTheSharedCasesAndEveryBMPSeparator(t *testing.T) {
	var d struct {
		Cases []struct {
			Value    string `json:"value"`
			Accepted bool   `json:"accepted"`
		} `json:"cases"`
		SeparatorScalars []string `json:"separator_scalars"`
	}
	if err := json.Unmarshal(schemaRepoFile(t, "tests", "interop", "v2", "schema_validation", "date_time_cases.json"), &d); err != nil {
		t.Fatal(err)
	}
	if len(d.Cases) == 0 || len(d.SeparatorScalars) != 27 {
		t.Fatalf("%d cases, %d separators", len(d.Cases), len(d.SeparatorScalars))
	}
	for _, c := range d.Cases {
		if schemaIsDateTime(c.Value) != c.Accepted {
			t.Errorf("%q: accepted %v, want %v", c.Value, !c.Accepted, c.Accepted)
		}
	}
	var accepted []string
	for cp := rune(0); cp < 0x10000; cp++ {
		if cp >= 0xd800 && cp <= 0xdfff {
			continue
		}
		if schemaIsDateTime("2000-01-01" + string(cp) + "00:00:00Z") {
			accepted = append(accepted, fmt.Sprintf("U+%04X", cp))
		}
	}
	if !reflect.DeepEqual(accepted, d.SeparatorScalars) {
		t.Errorf("separators %v", accepted)
	}
}

func TestSchemaTheErrorBudgetAndBoundedEscapedDiagnostics(t *testing.T) {
	many := func(n int) schemaResult {
		return schemaAt(t, func(d map[string]any) {
			for i := 0; i < n; i++ {
				d[fmt.Sprintf("x_%d", i)] = float64(i)
			}
		})
	}
	r16, r17 := many(16), many(17)
	if len(r16.Errors) != 16 || r16.Truncated || r16.Valid {
		t.Errorf("16: %d %v %v", len(r16.Errors), r16.Truncated, r16.Valid)
	}
	if len(r17.Errors) != schemaErrorsCap || !r17.Truncated || r17.Valid {
		t.Errorf("17: %d %v %v", len(r17.Errors), r17.Truncated, r17.Valid)
	}
	if lines := schemaDiagnostics(r17); len(lines) != 17 || lines[16] != "schema: further errors not listed" {
		t.Errorf("17: %v", lines)
	}
	lines := schemaDiagnostics(schemaAt(t, func(d map[string]any) {
		d[strings.Repeat("x", 1<<20)] = strings.Repeat("v", 1<<20)
		d[strings.Repeat("~/", 100)] = 1.0
		obj(d, "bundle", "manifest")["intended_verifier"] = strings.Repeat("w", 5000)
	}))
	all := strings.Join(lines, "\n")
	if strings.Contains(all, "vvvv") || strings.Contains(all, "wwww") {
		t.Error("a value is echoed")
	}
	cut := false
	for _, l := range lines {
		if utf8.RuneCountInString(l) >= 200 {
			t.Errorf("a line of %d code points", utf8.RuneCountInString(l))
		}
		cut = cut || (strings.HasPrefix(l, "schema: / additionalProperties ~0~1") && strings.HasSuffix(l, "…[cut]"))
	}
	if !cut {
		t.Errorf("no escaped and cut member: %v", lines)
	}
}

func TestSchemaTheOverlayChangesOneConstInBothDirections(t *testing.T) {
	errorsFor := func(p any, profile string) [][2]string {
		d := schemaInstance(t)
		if p == nil {
			delete(obj(d, "bundle", "manifest"), "canonicalization_profile")
		} else {
			obj(d, "bundle", "manifest")["canonicalization_profile"] = p
		}
		r, err := validateSignedBundleV2Schema(d, profile)
		if err != nil {
			t.Fatal(err)
		}
		return schemaPairs(r)
	}
	none, constant := [][2]string{}, [][2]string{{"/bundle/manifest/canonicalization_profile", "const"}}
	if !reflect.DeepEqual(errorsFor("dcp-jcs-v1", "dcp-jcs-v1"), none) || !reflect.DeepEqual(errorsFor("dcp-jcs-v2", "dcp-jcs-v2"), none) {
		t.Error("each profile under its own name")
	}
	if !reflect.DeepEqual(errorsFor("dcp-jcs-v2", "dcp-jcs-v1"), constant) || !reflect.DeepEqual(errorsFor("dcp-jcs-v1", "dcp-jcs-v2"), constant) {
		t.Error("each profile under the other's name")
	}
	if !reflect.DeepEqual(errorsFor(nil, "dcp-jcs-v2"), none) {
		t.Error("absent under the candidate profile")
	}
	if _, err := validateSignedBundleV2Schema(map[string]any{}, "dcp-jcs-v3"); err == nil {
		t.Error("an unknown profile")
	}
}

// The IR is initialized once and read-only afterwards: 32 goroutines initialize and use it at the same time (run
// with -race).
func TestSchemaConcurrentInitializationAndUse(t *testing.T) {
	schemaOnce, schemaLoaded, schemaErr = sync.Once{}, nil, nil
	text := mustJSON(t, schemaInstance(t))
	var wg sync.WaitGroup
	failures := make(chan string, 64)
	for g := 0; g < 32; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			var d map[string]any
			_ = json.Unmarshal(text, &d)
			if g%2 == 1 {
				obj(d, "bundle", "intent", "payload")["x"] = 1.0
			}
			r, err := validateSignedBundleV2Schema(d, "dcp-jcs-v1")
			if err != nil || r.Valid != (g%2 == 0) {
				failures <- fmt.Sprintf("%d: %v %v", g, err, r.Errors)
			}
		}(g)
	}
	wg.Wait()
	close(failures)
	for f := range failures {
		t.Error(f)
	}
}

// The historical V2-9 rows used names like constructor; V2-2 now refuses them, so the lookups are tested directly:
// ComputeSecurityTier (public) and the mode lookup of resolveVerificationMode.
func TestSchemaTheTierAndModeLookupsKeepTheirGuardForNamesOutsideTheEnums(t *testing.T) {
	d := schemaInstance(t)
	intent, policy := obj(d, "bundle", "intent", "payload"), map[string]any{"risk_score": 0.0}
	with := func(field, name string) map[string]any {
		m := map[string]any{}
		for k, v := range intent {
			m[k] = v
		}
		m[field] = name
		return m
	}
	unknown := ComputeSecurityTier(SecurityTierInputFromPayloads(with("action_type", "zz-unknown"), policy)).Tier
	modeOf := func(riskTier string) string {
		bundle := map[string]any{"agent_passport": map[string]any{"payload": map[string]any{"risk_tier": riskTier}},
			"intent": map[string]any{"payload": intent}, "policy_decision": map[string]any{"payload": policy}}
		return resolveVerificationMode(bundle, DefaultVerifierPolicy(), &V2VerificationResult{})
	}
	for _, name := range []string{"constructor", "__proto__", "toString", "hasOwnProperty", "__class__", "__dict__"} {
		for _, field := range []string{"action_type", "estimated_impact", "security_tier"} {
			tier := ComputeSecurityTier(SecurityTierInputFromPayloads(with(field, name), policy)).Tier
			if !slicesContains([]string{"routine", "standard", "elevated", "maximum"}, tier) || (field != "security_tier" && tier != unknown) {
				t.Errorf("%s=%s: tier %q", field, name, tier)
			}
		}
		if got, want := modeOf(name), modeOf("zz-unknown"); got != want || got == "" {
			t.Errorf("risk_tier %s: mode %q, want %q", name, got, want)
		}
	}
}
