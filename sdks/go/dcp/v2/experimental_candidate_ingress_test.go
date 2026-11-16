package v2_test

// Experimental candidate ingress (phase 1): the public corpus cases that test one unit from its
// bytes, and focused examples. Bundle cases (selection, policy, configuration, migration, historical
// parsers) and transport envelopes, the obsolete depth rule among them, belong to later phases: they
// are counted here, not run.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type candidateCase struct {
	ID           string          `json:"id"`
	Mode         string          `json:"mode"`
	Transport    string          `json:"transport"`
	Options      json.RawMessage `json:"options"`
	InputJSON    *string         `json:"input_json"`
	InputHex     *string         `json:"input_hex"`
	InputSHA256  string          `json:"input_sha256"`
	Expected     json.RawMessage `json:"expected"`
	Canonical    string          `json:"canonical"`
	CanonicalSHA string          `json:"canonical_sha256"`
	RejectClass  string          `json:"reject_class"`
}

func loadCandidateCases(t *testing.T, name string) []candidateCase {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docs", "proposals", "canonicalization-candidate", name))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []candidateCase `json:"cases"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	return file.Cases
}

func candidateInput(t *testing.T, c candidateCase) []byte {
	t.Helper()
	var b []byte
	if c.InputHex != nil {
		var err error
		if b, err = hex.DecodeString(*c.InputHex); err != nil {
			t.Fatal(err)
		}
	} else {
		b = []byte(*c.InputJSON)
	}
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != c.InputSHA256 {
		t.Fatalf("%s: input bytes do not match input_sha256", c.ID)
	}
	return b
}

func ingest(t *testing.T, input []byte) v2.ExperimentalCandidateIngressResult {
	t.Helper()
	r, err := v2.ExperimentalCandidateIngress(input)
	if err != nil {
		t.Fatalf("internal error on %q: %v", input, err)
	}
	return r
}

func wantReject(t *testing.T, input []byte, class string, offset int) {
	t.Helper()
	r := ingest(t, input)
	if r.Accepted || r.Class != class || r.Offset != offset {
		t.Errorf("%.80q: got accepted=%v %s@%d, want %s@%d", input, r.Accepted, r.Class, r.Offset, class, offset)
	}
}

func wantCanonical(t *testing.T, input []byte, canonical string) {
	t.Helper()
	r := ingest(t, input)
	if !r.Accepted || string(r.Canonical) != canonical {
		t.Errorf("%.80q: got accepted=%v %q (%s@%d), want %q", input, r.Accepted, r.Canonical, r.Class, r.Offset, canonical)
	}
}

// checkV1Output: the dcp-jcs-v1 canonicalizer over the materialized value gives the same bytes.
func checkV1Output(t *testing.T, id string, r v2.ExperimentalCandidateIngressResult) {
	t.Helper()
	v1, err := v2.CanonicalizeV2(r.Value)
	if err != nil || v1 != string(r.Canonical) {
		t.Errorf("%s: dcp-jcs-v1 output %q (%v), candidate %q", id, v1, err, r.Canonical)
	}
}

func TestExperimentalCandidateIngressCorpus(t *testing.T) {
	baseline := loadCandidateCases(t, "baseline-corpus.json")
	design := loadCandidateCases(t, "corpus.json")
	var document []candidateCase
	bundles, envelopes := 0, 0
	for _, c := range design {
		switch {
		case c.Mode == "document" && c.Transport == "bare" && c.Options == nil:
			document = append(document, c)
		case c.Mode == "bundle":
			bundles++
		case c.Mode == "document" && c.Transport == "envelope":
			envelopes++
		}
	}
	if len(baseline) != 87 || len(document) != 81 || bundles != 77 || envelopes != 29 || len(design) != 187 {
		t.Fatalf("corpus counts changed: %d baseline, %d document, %d bundle, %d envelope, %d design",
			len(baseline), len(document), bundles, envelopes, len(design))
	}
	for _, c := range baseline {
		r := ingest(t, candidateInput(t, c))
		if c.RejectClass != "" {
			if r.Accepted || r.Class != c.RejectClass {
				t.Errorf("baseline %s: got accepted=%v %s, want %s", c.ID, r.Accepted, r.Class, c.RejectClass)
			}
			continue
		}
		if !r.Accepted || string(r.Canonical) != c.Canonical || r.CanonicalSHA256 != c.CanonicalSHA {
			t.Errorf("baseline %s: got accepted=%v %q (%s@%d)", c.ID, r.Accepted, r.Canonical, r.Class, r.Offset)
			continue
		}
		checkV1Output(t, c.ID, r)
	}
	for _, c := range document {
		var want struct {
			Result          string `json:"result"`
			Class           string `json:"class"`
			Offset          int    `json:"offset"`
			CanonicalSHA256 string `json:"canonical_sha256"`
		}
		if err := json.Unmarshal(c.Expected, &want); err != nil {
			t.Fatal(err)
		}
		r := ingest(t, candidateInput(t, c))
		if want.Result == "accept" {
			sum := sha256.Sum256(r.Canonical)
			if !r.Accepted || r.CanonicalSHA256 != want.CanonicalSHA256 || hex.EncodeToString(sum[:]) != r.CanonicalSHA256 {
				t.Errorf("design %s: got accepted=%v %s (%s@%d)", c.ID, r.Accepted, r.CanonicalSHA256, r.Class, r.Offset)
				continue
			}
			checkV1Output(t, c.ID, r)
		} else if r.Accepted || r.Class != want.Class || r.Offset != want.Offset {
			t.Errorf("design %s: got accepted=%v %s@%d, want %s@%d", c.ID, r.Accepted, r.Class, r.Offset, want.Class, want.Offset)
		}
	}
}

func TestExperimentalCandidateIngressUTF8AndBOM(t *testing.T) {
	for _, bad := range []string{"\xc0\x80", "\xe0\x80\x80", "\xed\xa0\x80", "\xf4\x90\x80\x80", "\xf5", "\x80", "\xe2\x82"} {
		wantReject(t, []byte(`{"s":"`+bad+`"}`), "UTF8_INVALID", 6)
	}
	wantReject(t, []byte("[,\"\xff\"]"), "UTF8_INVALID", 3) // the encoding layer wins over grammar
	wantReject(t, []byte("\xef\xbb\xbf{\"a\":1}"), "BOM", 0)
	wantReject(t, []byte("\xef\xbb\xbf[\"\xff\"]"), "BOM", 0)
	wantCanonical(t, []byte("[\"\xef\xbb\xbfx\"]"), "[\"\xef\xbb\xbfx\"]")
}

func TestExperimentalCandidateIngressKeys(t *testing.T) {
	wantReject(t, []byte(`{"a":1,"\u0061":2}`), "DUPLICATE_KEY", 7)
	wantReject(t, []byte(`{"\u00e9":1,"é":2}`), "DUPLICATE_KEY", 12)
	wantReject(t, []byte(`{"\ud83d\ude00":1,"😀":2}`), "DUPLICATE_KEY", 18)
	wantCanonical(t, []byte(`{"é":1,"e\u0301":2}`), "{\"e\u0301\":2,\"é\":1}")
	wantReject(t, []byte(`{"\ud800":1,"\ud800":2}`), "SURROGATE_UNPAIRED", 2)
	r := ingest(t, []byte(`{"__proto__":{"x":1},"y":[]}`))
	want := map[string]any{"__proto__": map[string]any{"x": int64(1)}, "y": []any{}}
	if !r.Accepted || !reflect.DeepEqual(r.Value, want) || string(r.Canonical) != `{"__proto__":{"x":1},"y":[]}` {
		t.Errorf("__proto__: got %#v %q", r.Value, r.Canonical)
	}
	wantReject(t, []byte(`{"__proto__":1,"__proto__":2}`), "DUPLICATE_KEY", 15)
}

func TestExperimentalCandidateIngressNumbers(t *testing.T) {
	wantCanonical(t, []byte(`[9007199254740991,-9007199254740991,-0,-0.0e-0,0e99999999999999999999999]`),
		`[9007199254740991,-9007199254740991,0,0,0]`)
	wantCanonical(t, []byte(`[100000000000000000000e-5,1.5e1,100e-2,1E+2]`), `[1000000000000000,15,1,100]`)
	wantCanonical(t, []byte("[1"+strings.Repeat("0", 100000)+"e-100000]"), "[1]")
	wantCanonical(t, []byte("[0."+strings.Repeat("0", 50000)+"1e50001]"), "[1]")
	for text, class := range map[string]string{
		"[9007199254740992]":           "NUMBER_OUT_OF_RANGE",
		"[1e21]":                       "NUMBER_OUT_OF_RANGE",
		"[1e99999999999999999999999]":  "NUMBER_OUT_OF_RANGE",
		"[1e-99999999999999999999999]": "NUMBER_NOT_INTEGER",
		"[1.0000000000000001]":         "NUMBER_NOT_INTEGER",
		"[4503599627370497.5e40]":      "NUMBER_OUT_OF_RANGE",
		"[0.5e-400000000000]":          "NUMBER_NOT_INTEGER",
	} {
		wantReject(t, []byte(text), class, 1)
	}
}

func TestExperimentalCandidateIngressStrings(t *testing.T) {
	wantCanonical(t, []byte(`["\ud83d\ude00"]`), "[\"😀\"]")
	for _, text := range []string{`["\ud83d"]`, `["\ude00"]`, `["\ud83d\u0041"]`, `["\ud83d\ud83d\ude00"]`, `["\ud83dx"]`} {
		wantReject(t, []byte(text), "SURROGATE_UNPAIRED", 2)
	}
	wantReject(t, []byte(`["\ud83d\uZZZZ"]`), "SYNTAX", 10)
	wantCanonical(t, []byte(`["\u0000\u001f\b\t\n\f\r\"\\\/\u007f\u2028"]`), "[\"\\u0000\\u001f\\b\\t\\n\\f\\r\\\"\\\\/\x7f\u2028\"]")
}

func TestExperimentalCandidateIngressDepth(t *testing.T) {
	wantCanonical(t, []byte(strings.Repeat("[", 64)+strings.Repeat("]", 64)), strings.Repeat("[", 64)+strings.Repeat("]", 64))
	wantReject(t, []byte(strings.Repeat("[", 65)+strings.Repeat("]", 65)), "DEPTH_EXCEEDED", 64)
	wantReject(t, []byte(strings.Repeat("[", 65)+"1.5"+strings.Repeat("]", 65)), "DEPTH_EXCEEDED", 64)
	wantReject(t, []byte(strings.Repeat("[", 20000)+strings.Repeat("]", 20000)), "DEPTH_EXCEEDED", 64)
	wantReject(t, []byte(strings.Repeat("[", 20000)+strings.Repeat("]", 19999)), "SYNTAX", 39999)
	wantReject(t, []byte(strings.Repeat("[", 20000)+strings.Repeat("]", 19999)+"}"), "SYNTAX", 39999)
	wantReject(t, []byte(`{"a":1,"a":2,}`), "SYNTAX", 13) // grammar wins over a value-level defect
}
