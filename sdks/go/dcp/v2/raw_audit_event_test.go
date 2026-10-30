package v2_test

// RawAuditEventV2 through the shared vectors tests/interop/v2/audit_entry_roundtrip_vectors.json: the hand-written
// dcp-jcs-v1 text of each entry kept through a decode and encode, literal bytes included (P1); the typed struct's
// current losses (P2: observed behaviour, not a norm); the committed bundle (P3); the typed view (P4); refused
// inputs (P5); copies, atomicity, nil and zero values (P6); and the no-repair controls on string_evidence_bundle
// (N0 to N3 required, N4 observed).

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type roundtripVectors struct {
	Entries []struct {
		Name            string          `json:"name"`
		Entry           json.RawMessage `json:"entry"`
		EntryJSON       *string         `json:"entry_json"`
		Canonical       string          `json:"canonical"`
		CanonicalSHA256 string          `json:"canonical_sha256"`
	} `json:"entries"`
	StringEvidenceBundle struct {
		VerificationTime string          `json:"verification_time"`
		VerifierPolicy   json.RawMessage `json:"verifier_policy"`
		SignedBundle     json.RawMessage `json:"signed_bundle"`
		Mutations        []struct {
			Name       string   `json:"name"`
			EntryIndex int      `json:"entry_index"`
			Op         string   `json:"op"`
			Path       []string `json:"path"`
			Value      any      `json:"value"`
		} `json:"mutations"`
	} `json:"string_evidence_bundle"`
}

func readVectorFile(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "interop", "v2", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func roundtripCorpus(t *testing.T) roundtripVectors {
	t.Helper()
	var v roundtripVectors
	if err := json.Unmarshal(readVectorFile(t, "audit_entry_roundtrip_vectors.json"), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// The entry's bytes as given: entry_json verbatim, or the entry object exactly as it is written in the file.
func entryBytes(e struct {
	Name            string          `json:"name"`
	Entry           json.RawMessage `json:"entry"`
	EntryJSON       *string         `json:"entry_json"`
	Canonical       string          `json:"canonical"`
	CanonicalSHA256 string          `json:"canonical_sha256"`
}) []byte {
	if e.EntryJSON != nil {
		return []byte(*e.EntryJSON)
	}
	return e.Entry
}

func canonicalOf(t *testing.T, b []byte) string {
	t.Helper()
	c, err := v2.CanonicalizeV2(json.RawMessage(b))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func decodeAny(t *testing.T, b []byte) any {
	t.Helper()
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var v any
	if err := d.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func rawRoundtrip(t *testing.T, entry any) any {
	var r v2.RawAuditEventV2
	if err := json.Unmarshal(mustMarshal(t, entry), &r); err != nil {
		t.Fatal(err)
	}
	return decodeAny(t, mustMarshal(t, r))
}

func typedRoundtrip(t *testing.T, entry any) any {
	var e v2.AuditEventV2
	if err := json.Unmarshal(mustMarshal(t, entry), &e); err != nil {
		t.Fatal(err)
	}
	return decodeAny(t, mustMarshal(t, e))
}

func withEntries(t *testing.T, bundle any, f func(*testing.T, any) any) any {
	out := decodeAny(t, mustMarshal(t, bundle))
	entries := out.(map[string]any)["bundle"].(map[string]any)["audit_entries"].([]any)
	for i, e := range entries {
		entries[i] = f(t, e)
	}
	return out
}

type verdict struct {
	verified bool
	errors   []string
}

func verifyAt(t *testing.T, bundle any, policy v2.VerifierPolicy, at string) verdict {
	t.Helper()
	now, err := time.Parse(time.RFC3339, at)
	if err != nil {
		t.Fatal(err)
	}
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	r := v2.VerifySignedBundleV2At(reg, mustMarshal(t, bundle), policy, now)
	return verdict{r.Verified, append([]string{}, r.Errors...)}
}

func TestRawAuditEventV2KeepsHandWrittenCanonicalText(t *testing.T) { // P1
	v := roundtripCorpus(t)
	if len(v.Entries) != 14 {
		t.Fatalf("%d entries", len(v.Entries))
	}
	for _, e := range v.Entries {
		in := entryBytes(e)
		sum := sha256.Sum256([]byte(e.Canonical))
		if hex.EncodeToString(sum[:]) != e.CanonicalSHA256 {
			t.Errorf("%s: committed SHA-256", e.Name)
		}
		// The Go canonicalizer agrees with the hand-written text (cross-SDK contrast).
		if got := canonicalOf(t, in); got != e.Canonical {
			t.Errorf("%s: CanonicalizeV2\n got %s\nwant %s", e.Name, got, e.Canonical)
		}
		var r v2.RawAuditEventV2
		if err := json.Unmarshal(in, &r); err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		if !bytes.Equal(r.Bytes(), in) {
			t.Errorf("%s: Bytes() is not the literal input", e.Name)
		}
		if m, _ := r.MarshalJSON(); !bytes.Equal(m, in) {
			t.Errorf("%s: MarshalJSON() is not the literal input", e.Name)
		}
		if got := canonicalOf(t, mustMarshal(t, r)); got != e.Canonical {
			t.Errorf("%s: dcp-jcs-v1 text after json.Marshal: %s", e.Name, got)
		}
	}
}

func TestAuditEventV2LossesAreObservedBehaviourNotANorm(t *testing.T) { // P2
	// Observed behaviour of AuditEventV2 today, pinned so that a change is noticed; the protocol requires nothing here.
	v := roundtripCorpus(t)
	var changed []string
	for _, e := range v.Entries {
		if canonicalOf(t, mustMarshal(t, typedRoundtrip(t, decodeAny(t, entryBytes(e))))) != e.Canonical {
			changed = append(changed, e.Name)
		}
	}
	sort.Strings(changed)
	want := []string{"evidence_all_null", "evidence_extra_members", "evidence_null_and_absent", "integers_at_safe_limits",
		"pq_checkpoint_ref_absent", "secondaries_null", "unicode_key_order_by_code_point", "unknown_entry_member"}
	if !reflect.DeepEqual(changed, want) {
		t.Fatalf("observed typed losses changed: %v", changed)
	}
}

func bundleVectors(t *testing.T) (any, v2.VerifierPolicy) {
	var b struct {
		SignedBundle json.RawMessage   `json:"signed_bundle"`
		Policy       v2.VerifierPolicy `json:"default_verifier_policy"`
	}
	if err := json.Unmarshal(readVectorFile(t, "bundle_vectors.json"), &b); err != nil {
		t.Fatal(err)
	}
	return decodeAny(t, b.SignedBundle), b.Policy
}

func TestCommittedBundleVerifiesThroughRawEntries(t *testing.T) { // P3
	signed, policy := bundleVectors(t)
	const at = "2026-10-22T00:00:00Z"
	if r := verifyAt(t, signed, policy, at); !r.verified {
		t.Fatalf("committed bundle: %v", r.errors)
	}
	if r := verifyAt(t, withEntries(t, signed, rawRoundtrip), policy, at); !r.verified {
		t.Fatalf("through RawAuditEventV2: %v", r.errors)
	}
	// Observed, not required: the typed struct drops the committed null evidence members, so the chain breaks.
	if verifyAt(t, withEntries(t, signed, typedRoundtrip), policy, at).verified {
		t.Fatal("observed typed-struct behaviour changed: the committed bundle verifies after a typed round trip")
	}
}

func TestRawAuditEventV2TypedIsTheTypedDecode(t *testing.T) { // P4
	v := roundtripCorpus(t)
	inputs := [][]byte{[]byte(`{"audit_id":"only","evidence":"not an object"}`)}
	for _, e := range v.Entries {
		inputs = append(inputs, entryBytes(e))
	}
	for _, in := range inputs {
		r, err := v2.NewRawAuditEventV2(in)
		if err != nil {
			t.Fatal(err)
		}
		view, viewErr := r.Typed()
		var decoded v2.AuditEventV2
		decErr := json.Unmarshal(in, &decoded)
		if (viewErr == nil) != (decErr == nil) {
			t.Fatalf("Typed and the typed decode disagree: %v / %v", viewErr, decErr)
		}
		if viewErr == nil && !reflect.DeepEqual(view, decoded) {
			t.Fatalf("Typed differs from the typed decode for %s", in)
		}
	}
}

func TestRawAuditEventV2RefusesAnythingButOneObject(t *testing.T) { // P5
	for _, in := range []string{`[]`, `"s"`, `1`, `true`, `null`, ``, ` `, `{} {}`, `{}x`, `{`, `{"a":1,}`, ` [ ]`} {
		if _, err := v2.NewRawAuditEventV2([]byte(in)); err == nil {
			t.Errorf("accepted %q", in)
		}
	}
	for _, ok := range []string{`{}`, " \n{\"a\": null}\t"} {
		if _, err := v2.NewRawAuditEventV2([]byte(ok)); err != nil {
			t.Errorf("refused %q: %v", ok, err)
		}
	}
	var list []v2.RawAuditEventV2
	for _, bad := range []string{`[{}, 1]`, `[{}, null]`} {
		if err := json.Unmarshal([]byte(bad), &list); err == nil {
			t.Errorf("a list with %s decoded", bad)
		}
	}
	if err := json.Unmarshal([]byte(`[{}, {"a": null}]`), &list); err != nil || len(list) != 2 {
		t.Fatalf("a valid list: %v, %d", err, len(list))
	}
}

func TestRawAuditEventV2CopiesAtomicityNilAndZero(t *testing.T) { // P6
	in := []byte(`{"evidence":{"tool":null},"a":1}`)
	want := append([]byte{}, in...)
	r, err := v2.NewRawAuditEventV2(in)
	if err != nil {
		t.Fatal(err)
	}
	in[2] = 'X' // the caller's buffer
	out := r.Bytes()
	out[2] = 'Y' // a returned copy
	m, _ := r.MarshalJSON()
	m[2] = 'Z' // another returned copy
	if !bytes.Equal(r.Bytes(), want) {
		t.Fatalf("aliased: %s", r.Bytes())
	}
	buf := []byte(`{"b":2}`)
	var u v2.RawAuditEventV2
	if err := u.UnmarshalJSON(buf); err != nil {
		t.Fatal(err)
	}
	buf[2] = 'X'
	if string(u.Bytes()) != `{"b":2}` {
		t.Fatalf("UnmarshalJSON aliased its input: %s", u.Bytes())
	}
	// A failed UnmarshalJSON keeps the previous value: the error must be checked.
	for _, bad := range []string{`[1]`, `{} {}`, `null`, ``} {
		if err := u.UnmarshalJSON([]byte(bad)); err == nil {
			t.Fatalf("UnmarshalJSON(%q) succeeded", bad)
		}
		if string(u.Bytes()) != `{"b":2}` {
			t.Fatalf("UnmarshalJSON(%q) changed the value: %s", bad, u.Bytes())
		}
	}
	var nilPtr *v2.RawAuditEventV2
	if err := nilPtr.UnmarshalJSON([]byte(`{}`)); err == nil {
		t.Fatal("UnmarshalJSON on a nil pointer succeeded")
	}
	var zero v2.RawAuditEventV2
	if _, err := zero.MarshalJSON(); err == nil {
		t.Fatal("the zero value marshals")
	}
	if zero.Bytes() != nil {
		t.Fatal("the zero value has bytes")
	}
	if _, err := zero.Typed(); err == nil {
		t.Fatal("the zero value has a typed view")
	}
	if _, err := json.Marshal(struct{ E v2.RawAuditEventV2 }{}); err == nil {
		t.Fatal("a struct holding the zero value marshals")
	}
	// A nil pointer is encoded as null by encoding/json itself, without calling MarshalJSON.
	if b, err := json.Marshal(struct{ E *v2.RawAuditEventV2 }{}); err != nil || string(b) != `{"E":null}` {
		t.Fatalf("nil pointer: %s, %v", b, err)
	}
}

func TestRawAuditEventV2NeverRepairsAndKeepsErrors(t *testing.T) { // N0 to N4
	v := roundtripCorpus(t)
	s := v.StringEvidenceBundle
	var policy v2.VerifierPolicy
	if err := json.Unmarshal(s.VerifierPolicy, &policy); err != nil {
		t.Fatal(err)
	}
	signed := decodeAny(t, s.SignedBundle)
	// N0: nothing to lose, so the bundle verifies as is and through both types.
	for label, b := range map[string]any{"as is": signed, "raw": withEntries(t, signed, rawRoundtrip), "typed": withEntries(t, signed, typedRoundtrip)} {
		if r := verifyAt(t, b, policy, s.VerificationTime); !r.verified {
			t.Fatalf("N0 %s: %v", label, r.errors)
		}
	}
	if len(s.Mutations) != 8 {
		t.Fatalf("%d mutations", len(s.Mutations))
	}
	var typedVerified []string
	for _, m := range s.Mutations {
		mutated := decodeAny(t, mustMarshal(t, signed))
		node := mutated.(map[string]any)["bundle"].(map[string]any)["audit_entries"].([]any)[m.EntryIndex].(map[string]any)
		for _, k := range m.Path[:len(m.Path)-1] {
			node = node[k].(map[string]any)
		}
		last := m.Path[len(m.Path)-1]
		switch m.Op {
		case "set":
			node[last] = m.Value
		case "delete":
			if _, ok := node[last]; !ok {
				t.Fatalf("%s: nothing to delete", m.Name)
			}
			delete(node, last)
		default:
			t.Fatalf("unknown op %s", m.Op)
		}
		// N1: every mutation breaks verification before any round trip.
		before := verifyAt(t, mutated, policy, s.VerificationTime)
		if before.verified || len(before.errors) == 0 {
			t.Fatalf("%s: the mutation alone must fail", m.Name)
		}
		// N2: through RawAuditEventV2, exactly the same errors, never verified.
		if after := verifyAt(t, withEntries(t, mutated, rawRoundtrip), policy, s.VerificationTime); !reflect.DeepEqual(after, before) {
			t.Fatalf("%s: raw round trip %v, want %v", m.Name, after, before)
		}
		// N4 (observed, not required): the typed struct may restore the signed bytes.
		if verifyAt(t, withEntries(t, mutated, typedRoundtrip), policy, s.VerificationTime).verified {
			typedVerified = append(typedVerified, m.Name)
		}
	}
	sort.Strings(typedVerified)
	want := []string{"evidence_member_added", "evidence_member_added_last_entry", "intent_hash_secondary_null", "pq_checkpoint_ref_removed",
		"prev_hash_secondary_null", "prev_hash_secondary_null_last_entry", "unknown_entry_member_added"}
	if !reflect.DeepEqual(typedVerified, want) {
		t.Fatalf("observed typed-struct behaviour changed: %v", typedVerified)
	}
	// N3: a bundle the typed struct broke stays broken, with the same errors, through RawAuditEventV2.
	base, basePolicy := bundleVectors(t)
	broken := withEntries(t, base, typedRoundtrip)
	errs := verifyAt(t, broken, basePolicy, "2026-10-22T00:00:00Z")
	if errs.verified {
		t.Fatal("the typed round trip did not break the committed bundle")
	}
	if again := verifyAt(t, withEntries(t, broken, rawRoundtrip), basePolicy, "2026-10-22T00:00:00Z"); !reflect.DeepEqual(again, errs) {
		t.Fatalf("N3: %v, want %v", again, errs)
	}
}
