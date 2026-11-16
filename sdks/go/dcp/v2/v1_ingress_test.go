package v2_test

// Admission from bytes (MP-02 F3): tests/interop/v2/v1_ingress_vectors.json with the two candidate corpora it
// pins, the signed bundles of delegated_admission_vectors.json, the private copy of the caller's slice (just
// before the decoder and just before the bridge to AdmitSignedBundleV2), and a decoder fault injected by these
// tests only. Mirrors sdks/typescript/src/__tests__/v1-ingress.test.ts.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type f3Expected struct {
	Ingress      string `json:"ingress"`
	Canonical    string `json:"canonical"`
	CanonicalSHA string `json:"canonical_sha256"`
	Layer        string `json:"layer"`
	Class        string `json:"class"`
	Offset       *int   `json:"offset"`
}

type f3Vectors struct {
	Sources []struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
		Count  int    `json:"count"`
	} `json:"sources"`
	DomainDifferences []struct {
		ID          string `json:"id"`
		InputSHA256 string `json:"input_sha256"`
		Expected    struct {
			Layer  string `json:"layer"`
			Class  string `json:"class"`
			Offset int    `json:"offset"`
		} `json:"expected"`
	} `json:"domain_differences"`
	Cases []struct {
		ID          string     `json:"id"`
		Group       string     `json:"group"`
		InputJSON   string     `json:"input_json"`
		InputSHA256 string     `json:"input_sha256"`
		Expected    f3Expected `json:"expected"`
	} `json:"cases"`
}

type f3SourceCase struct {
	ID              string          `json:"id"`
	Mode            string          `json:"mode"`
	Transport       string          `json:"transport"`
	InputJSON       *string         `json:"input_json"`
	InputHex        *string         `json:"input_hex"`
	InputSHA256     string          `json:"input_sha256"`
	Expected        json.RawMessage `json:"expected"`
	RejectClass     string          `json:"reject_class"`
	CanonicalSHA256 string          `json:"canonical_sha256"`
}

func f3SHA(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func f3Str(s string) *string { return &s }
func f3Int(i int) *int       { return &i }

func f3Accepted(unitSHA, canonicalSHA string) v2.IngressOutcome {
	return v2.IngressOutcome{Accepted: true, UnitSHA256: unitSHA, CanonicalSHA256: f3Str(canonicalSHA)}
}

func f3Rejected(layer, class string, offset *int, unitSHA string) v2.IngressOutcome {
	return v2.IngressOutcome{Layer: f3Str(layer), Class: f3Str(class), Offset: offset, UnitSHA256: unitSHA}
}

func f3Load(t *testing.T) *f3Vectors {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "tests", "interop", "v2", "v1_ingress_vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v f3Vectors
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return &v
}

// f3Strict is the strict-v1 configuration the signed bundles are admitted under.
func f3Strict(t *testing.T, v *delegatedVectors) v2.AdmitOptions {
	t.Helper()
	profile, err := v2.ResolveStrictV1Profile(v.Profiles["strict"])
	if err != nil {
		t.Fatal(err)
	}
	store, err := v2.NewPrincipalTrustStore(v.TrustSets["base"])
	if err != nil {
		t.Fatal(err)
	}
	return v2.AdmitOptions{Profile: profile, Trust: store, Revocation: v.Revocations["all_not_revoked"]}
}

func f3JSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestV1IngressSourceCorpora(t *testing.T) {
	v := f3Load(t)
	reg := delegatedRegistry(nil)
	differences := map[string]int{}
	for i, d := range v.DomainDifferences {
		differences[d.ID] = i
	}
	if len(differences) != 30 {
		t.Fatalf("%d domain differences, want 30", len(differences))
	}
	seen := map[string]bool{}
	var counts []int
	for _, s := range v.Sources {
		raw, err := os.ReadFile(filepath.Join(repoRoot(t), s.Path))
		if err != nil {
			t.Fatal(err)
		}
		if f3SHA(raw) != s.SHA256 {
			t.Fatalf("%s: sha256 %s, pinned %s", s.Path, f3SHA(raw), s.SHA256)
		}
		var file struct {
			Cases []f3SourceCase `json:"cases"`
		}
		if err := json.Unmarshal(raw, &file); err != nil {
			t.Fatal(err)
		}
		var cases []f3SourceCase
		for _, c := range file.Cases {
			if strings.HasSuffix(s.Path, "baseline-corpus.json") || (c.Mode == "document" && c.Transport == "bare") {
				cases = append(cases, c)
			}
		}
		if len(cases) != s.Count {
			t.Fatalf("%s: %d cases, want %d", s.Path, len(cases), s.Count)
		}
		counts = append(counts, len(cases))
		for _, c := range cases {
			seen[c.ID] = true
			t.Run(c.ID, func(t *testing.T) {
				unit := []byte{}
				if c.InputHex != nil {
					unit, err = hex.DecodeString(*c.InputHex)
					if err != nil {
						t.Fatal(err)
					}
				} else {
					unit = []byte(*c.InputJSON)
				}
				if f3SHA(unit) != c.InputSHA256 {
					t.Fatalf("input sha256 %s, want %s", f3SHA(unit), c.InputSHA256)
				}
				r, err := v2.AdmitSignedBundleV2FromBytes(reg, unit, v2.AdmitOptions{})
				if err != nil {
					t.Fatal(err)
				}
				var accepted bool
				var exp struct {
					Result          string `json:"result"`
					Class           string `json:"class"`
					Offset          *int   `json:"offset"`
					CanonicalSHA256 string `json:"canonical_sha256"`
				}
				var word string
				if json.Unmarshal(c.Expected, &word) == nil {
					accepted = word == "accept"
				} else {
					if err := json.Unmarshal(c.Expected, &exp); err != nil {
						t.Fatal(err)
					}
					accepted = exp.Result == "accept"
				}
				var want v2.IngressOutcome
				if i, ok := differences[c.ID]; ok {
					d := v.DomainDifferences[i]
					if !accepted || d.InputSHA256 != c.InputSHA256 {
						t.Fatalf("a domain difference must be a case the scanner accepts, with the same bytes")
					}
					want = f3Rejected(d.Expected.Layer, d.Expected.Class, f3Int(d.Expected.Offset), c.InputSHA256)
				} else if !accepted {
					scanned, err := v2.ExperimentalCandidateIngress(unit)
					if err != nil || scanned.Accepted {
						t.Fatalf("the scanner accepts a case its corpus rejects: %v", err)
					}
					class := c.RejectClass
					if word == "" {
						class = exp.Class
						if scanned.Offset != *exp.Offset {
							t.Fatalf("scanner offset %d, corpus %d", scanned.Offset, *exp.Offset)
						}
					}
					if scanned.Class != class {
						t.Fatalf("scanner class %s, corpus %s", scanned.Class, class)
					}
					want = f3Rejected("scanner", class, f3Int(scanned.Offset), c.InputSHA256)
				} else {
					canonical := c.CanonicalSHA256
					if word == "" {
						canonical = exp.CanonicalSHA256
					}
					want = f3Accepted(c.InputSHA256, canonical)
				}
				if !reflect.DeepEqual(r.Ingress, want) {
					t.Fatalf("ingress %s, want %s", f3JSON(t, r.Ingress), f3JSON(t, want))
				}
				if want.Accepted {
					if r.Admission == nil || r.Admission.Verified || r.Admission.Admitted {
						t.Fatalf("a unit that is not a signed bundle must reach admission and be rejected: %s", f3JSON(t, r.Admission))
					}
				} else if r.Admission != nil || r.Value != nil {
					t.Fatalf("a rejected ingress has no admission or value")
				}
			})
		}
	}
	if !reflect.DeepEqual(counts, []int{87, 81}) {
		t.Fatalf("counts %v", counts)
	}
	for id := range differences {
		if !seen[id] {
			t.Fatalf("domain difference %s is not a corpus case", id)
		}
	}
}

func TestV1IngressNewCases(t *testing.T) {
	v := f3Load(t)
	reg := delegatedRegistry(nil)
	if len(v.Cases) != 26 {
		t.Fatalf("%d new cases, want 26", len(v.Cases))
	}
	for _, c := range v.Cases {
		t.Run(c.Group+"/"+c.ID, func(t *testing.T) {
			unit := []byte(c.InputJSON)
			if f3SHA(unit) != c.InputSHA256 {
				t.Fatalf("input sha256 %s, want %s", f3SHA(unit), c.InputSHA256)
			}
			r, err := v2.AdmitSignedBundleV2FromBytes(reg, unit, v2.AdmitOptions{})
			if err != nil {
				t.Fatal(err)
			}
			e := c.Expected
			if e.Ingress == "accept" {
				if f3SHA([]byte(e.Canonical)) != e.CanonicalSHA {
					t.Fatalf("the vector's canonical text and hash differ")
				}
				if want := f3Accepted(c.InputSHA256, e.CanonicalSHA); !reflect.DeepEqual(r.Ingress, want) {
					t.Fatalf("ingress %s, want %s", f3JSON(t, r.Ingress), f3JSON(t, want))
				}
				var parsed any
				if err := json.Unmarshal(unit, &parsed); err != nil || !reflect.DeepEqual(r.Value, parsed) {
					t.Fatalf("value %v, want %v", r.Value, parsed)
				}
				// not a signed bundle: admission runs over the copy and rejects it, with no decoder fault
				if r.Admission == nil || r.Admission.Verified || r.Admission.Admitted {
					t.Fatalf("admission %s", f3JSON(t, r.Admission))
				}
				return
			}
			want := f3Rejected(e.Layer, e.Class, e.Offset, c.InputSHA256)
			if !reflect.DeepEqual(r.Ingress, want) || r.Admission != nil || r.Value != nil {
				t.Fatalf("ingress %s, want %s", f3JSON(t, r.Ingress), f3JSON(t, want))
			}
		})
	}
}

func TestV1IngressEmptyInputIsAScannerRejection(t *testing.T) {
	for name, in := range map[string][]byte{"nil": nil, "empty": {}} {
		r, err := v2.AdmitSignedBundleV2FromBytes(delegatedRegistry(nil), in, v2.AdmitOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if want := f3Rejected("scanner", "SYNTAX", f3Int(0), f3SHA(nil)); !reflect.DeepEqual(r.Ingress, want) || r.Admission != nil {
			t.Fatalf("%s: %s", name, f3JSON(t, r.Ingress))
		}
	}
}

func TestV1IngressSignedBundles(t *testing.T) {
	v, _, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	opts := f3Strict(t, v)
	opts.Now = now
	names := make([]string, 0, len(v.SignedBundles))
	for name := range v.SignedBundles {
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) != 16 {
		t.Fatalf("%d signed bundles, want 16", len(names))
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			indented := []byte(v.SignedBundles[name])
			var compact bytes.Buffer
			if err := json.Compact(&compact, indented); err != nil {
				t.Fatal(err)
			}
			expected, err := v2.AdmitSignedBundleV2(reg, compact.Bytes(), opts)
			if err != nil {
				t.Fatal(err)
			}
			if name == "orch" && !expected.Admitted {
				t.Fatalf("orch is not admitted: %s", f3JSON(t, expected))
			}
			var parsed any
			if err := json.Unmarshal(indented, &parsed); err != nil {
				t.Fatal(err)
			}
			var canonicals []string
			for _, in := range [][]byte{compact.Bytes(), indented} {
				r, err := v2.AdmitSignedBundleV2FromBytes(reg, in, opts)
				if err != nil {
					t.Fatal(err)
				}
				if !r.Ingress.Accepted || f3JSON(t, r.Admission) != f3JSON(t, expected) || !reflect.DeepEqual(r.Value, parsed) {
					t.Fatalf("ingress %s admission %s, want %s", f3JSON(t, r.Ingress), f3JSON(t, r.Admission), f3JSON(t, expected))
				}
				canonicals = append(canonicals, *r.Ingress.CanonicalSHA256)
			}
			if canonicals[0] != canonicals[1] {
				t.Fatalf("compact and indented canonical differ: %v", canonicals)
			}
		})
	}
}

func TestV1IngressRejectsTheTransportRewriteThatTheBytesAPIAdmits(t *testing.T) {
	v, _, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	opts := f3Strict(t, v)
	opts.Now = now
	var compact bytes.Buffer
	if err := json.Compact(&compact, v.SignedBundles["orch"]); err != nil {
		t.Fatal(err)
	}
	text := compact.String()
	if strings.Count(text, `"risk_score":100,`) != 1 {
		t.Fatal(`want one "risk_score":100,`)
	}
	rewritten := []byte(strings.Replace(text, `"risk_score":100,`, `"risk_score":100.0,`, 1))
	direct, err := v2.AdmitSignedBundleV2(reg, rewritten, opts)
	if err != nil || !direct.Admitted {
		t.Fatalf("AdmitSignedBundleV2 admits the rewritten bytes: %v %s", err, f3JSON(t, direct))
	}
	r, err := v2.AdmitSignedBundleV2FromBytes(reg, rewritten, opts)
	if err != nil {
		t.Fatal(err)
	}
	want := f3Rejected("domain", "NUMBER_NOT_PORTABLE", f3Int(bytes.Index(rewritten, []byte("100.0"))), f3SHA(rewritten))
	if !reflect.DeepEqual(r.Ingress, want) || r.Admission != nil {
		t.Fatalf("ingress %s, want %s", f3JSON(t, r.Ingress), f3JSON(t, want))
	}
}

// f3Caller returns the caller's slice: a subslice at offset 8 of a larger array, between bytes that are not
// JSON, and the original bytes.
func f3Caller(t *testing.T, v *delegatedVectors) (caller, original []byte) {
	t.Helper()
	var compact bytes.Buffer
	if err := json.Compact(&compact, v.SignedBundles["orch"]); err != nil {
		t.Fatal(err)
	}
	original = compact.Bytes()
	backing := bytes.Repeat([]byte("X"), len(original)+16)
	copy(backing[8:], original)
	return backing[8 : 8+len(original)], original
}

func f3MutateRiskScore(t *testing.T, caller []byte) {
	t.Helper()
	at := bytes.Index(caller, []byte(`"risk_score":100,`))
	if at < 0 {
		t.Fatal("no risk_score to change")
	}
	copy(caller[at:], `"risk_score":999,`)
}

func TestV1IngressPrivateCopy(t *testing.T) {
	v, _, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	opts := f3Strict(t, v)
	opts.Now = now

	t.Run("hashes the subslice only", func(t *testing.T) {
		caller, original := f3Caller(t, v)
		r, err := v2.AdmitSignedBundleV2FromBytes(reg, caller, opts)
		if err != nil || r.Ingress.UnitSHA256 != f3SHA(original) || r.Admission == nil || !r.Admission.Admitted {
			t.Fatalf("%v %s %s", err, f3JSON(t, r.Ingress), f3JSON(t, r.Admission))
		}
	})

	for _, point := range []string{"just before the decoder", "just before the bridge"} {
		t.Run("the caller's slice changed "+point+" does not reach the result", func(t *testing.T) {
			caller, original := f3Caller(t, v)
			expected, err := v2.AdmitSignedBundleV2(reg, original, opts)
			if err != nil || !expected.Admitted {
				t.Fatalf("%v %s", err, f3JSON(t, expected))
			}
			clean, err := v2.AdmitSignedBundleV2FromBytes(reg, original, opts)
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			mutate := func() {
				calls++
				f3MutateRiskScore(t, caller) // the caller's original slice, not the argument
			}
			var decode func([]byte) (any, error)
			var beforeAdmit func()
			if point == "just before the decoder" {
				decode = func(unit []byte) (any, error) {
					mutate()
					var raw any
					err := json.Unmarshal(unit, &raw)
					return raw, err
				}
			} else {
				beforeAdmit = mutate
			}
			r, err := v2.AdmitFromBytesForTests(reg, caller, opts, decode, beforeAdmit)
			if err != nil {
				t.Fatal(err)
			}
			if calls != 1 || !bytes.Contains(caller, []byte(`"risk_score":999,`)) {
				t.Fatalf("the mutation did not run once: %d", calls)
			}
			if want := f3Accepted(f3SHA(original), *clean.Ingress.CanonicalSHA256); !reflect.DeepEqual(r.Ingress, want) {
				t.Fatalf("ingress %s, want %s", f3JSON(t, r.Ingress), f3JSON(t, want))
			}
			if f3JSON(t, r.Admission) != f3JSON(t, expected) {
				t.Fatalf("admission %s, want %s", f3JSON(t, r.Admission), f3JSON(t, expected))
			}
			if !reflect.DeepEqual(r.Value, clean.Value) {
				t.Fatalf("value differs from the original's")
			}
		})
	}

	t.Run("the caller changing its slice during verification or after the call changes nothing", func(t *testing.T) {
		caller, original := f3Caller(t, v)
		tampering := &tamperingEd25519{tamper: func() { f3MutateRiskScore(t, caller) }}
		r, err := v2.AdmitSignedBundleV2FromBytes(delegatedRegistry(tampering), caller, opts)
		if err != nil {
			t.Fatal(err)
		}
		if !tampering.once || !bytes.Contains(caller, []byte(`"risk_score":999,`)) {
			t.Fatal("the provider did not change the caller's slice")
		}
		if r.Ingress.UnitSHA256 != f3SHA(original) || r.Admission == nil || !r.Admission.Admitted {
			t.Fatalf("%s %s", f3JSON(t, r.Ingress), f3JSON(t, r.Admission))
		}
		before := f3JSON(t, r)
		for i := range caller {
			caller[i] = ' '
		}
		if f3JSON(t, r) != before {
			t.Fatal("the result changed with the caller's slice")
		}
	})
}

func TestV1IngressDecoderFault(t *testing.T) {
	v, _, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	opts := f3Strict(t, v)
	opts.Now = now
	_, unit := f3Caller(t, v)
	fault := f3Rejected("parser", "INGRESS_PARSER_MISMATCH", nil, f3SHA(unit))
	decode := func(u []byte) (any, error) {
		var raw any
		err := json.Unmarshal(u, &raw)
		return raw, err
	}
	cases := map[string]struct {
		in     []byte
		decode func([]byte) (any, error)
		fault  bool
	}{
		"the correct decoder admits": {unit, decode, false},
		"a decoder that returns another value": {unit, func(u []byte) (any, error) {
			raw, err := decode(u)
			raw.(map[string]any)["extra"] = 1.0
			return raw, err
		}, true},
		"a decoder that changes a number to a non-integer": {[]byte(`{"n":1}`), func([]byte) (any, error) {
			return map[string]any{"n": 1.5}, nil
		}, true},
		"a decoder that fails": {unit, func([]byte) (any, error) { return nil, errors.New("broken decoder") }, true},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			r, err := v2.AdmitFromBytesForTests(reg, c.in, opts, c.decode, nil)
			if err != nil {
				t.Fatal(err)
			}
			if !c.fault {
				if !r.Ingress.Accepted || r.Admission == nil || !r.Admission.Admitted {
					t.Fatalf("%s %s", f3JSON(t, r.Ingress), f3JSON(t, r.Admission))
				}
				return
			}
			want := fault
			want.UnitSHA256 = f3SHA(c.in)
			if !reflect.DeepEqual(r.Ingress, want) || r.Admission != nil || r.Value != nil {
				t.Fatalf("ingress %s, want %s", f3JSON(t, r.Ingress), f3JSON(t, want))
			}
		})
	}
}
