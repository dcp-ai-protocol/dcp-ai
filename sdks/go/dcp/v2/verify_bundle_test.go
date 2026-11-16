package v2

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

type mockProvider struct {
	alg     string
	sigSize int
}

func (m *mockProvider) Alg() string         { return m.alg }
func (m *mockProvider) KeySize() int         { return 32 }
func (m *mockProvider) SigSize() int         { return m.sigSize }
func (m *mockProvider) IsConstantTime() bool { return true }
func (m *mockProvider) GenerateKeypair() (*GeneratedKeypair, error) {
	return nil, nil
}
func (m *mockProvider) Sign(message []byte, secretKeyB64 string) ([]byte, error) {
	return nil, nil
}
func (m *mockProvider) Verify(message []byte, signature []byte, publicKeyB64 string) (bool, error) {
	return true, nil
}

// unitVerify verifies, at its verification time and under the given profile, the schema-valid signed base of
// tests/interop/v2/schema_validation/wiring_cases.json after edit. Its registry holds mock providers that accept every
// signature: each unit test below reaches one check past V2-2 over schema-valid input, next to a positive control;
// the real signatures are the interop rows' (dcp/interop_test.go) and the 57 signed cases' (schema_v2_test.go).
func unitVerify(t *testing.T, profile string, edit func(sb map[string]interface{})) *V2VerificationResult {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "interop", "v2", "schema_validation", "wiring_cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var w struct {
		VerificationTime string `json:"verification_time"`
		Cases            []struct {
			Name         string                 `json:"name"`
			SignedBundle map[string]interface{} `json:"signed_bundle"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &w); err != nil {
		t.Fatal(err)
	}
	now, err := time.Parse(time.RFC3339, w.VerificationTime)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range w.Cases {
		if c.Name != "base" {
			continue
		}
		edit(c.SignedBundle)
		raw, err := json.Marshal(c.SignedBundle)
		if err != nil {
			t.Fatal(err)
		}
		reg := NewAlgorithmRegistry()
		reg.RegisterSigner(&mockProvider{alg: "ed25519", sigSize: 64})
		reg.RegisterSigner(&mockProvider{alg: "ml-dsa-65", sigSize: 3309})
		return verifySignedBundleV2AtProfile(reg, raw, DefaultVerifierPolicy(), now, profile)
	}
	t.Fatal("no base case in wiring_cases.json")
	return nil
}

func at(sb map[string]interface{}, path ...string) map[string]interface{} {
	node := sb
	for _, k := range path {
		node = node[k].(map[string]interface{})
	}
	return node
}

func unchanged(map[string]interface{}) {}

// errorWith is the first error that starts with prefix, and whether some error is a V2-2 one.
func errorWith(r *V2VerificationResult, prefix string) (found string, schema bool) {
	for _, e := range r.Errors {
		if found == "" && strings.HasPrefix(e, prefix) {
			found = e
		}
		schema = schema || strings.HasPrefix(e, "schema: ")
	}
	return found, schema
}

func expectErrors(t *testing.T, r *V2VerificationResult, want ...string) {
	t.Helper()
	got := append([]string(nil), r.Errors...)
	sort.Strings(got)
	sort.Strings(want)
	if r.Verified || !reflect.DeepEqual(got, want) {
		t.Fatalf("verified %v, errors %q, want %q", r.Verified, got, want)
	}
}

func TestVerifyBundleV2_UnitControl(t *testing.T) {
	r := unitVerify(t, "dcp-jcs-v1", unchanged)
	if !r.Verified || len(r.Errors) != 0 || !r.SessionBindingValid || !r.ManifestValid {
		t.Fatalf("the unit base must verify: %+v", r)
	}
}

// A missing bundle or signature is now a V2-2 error (required); "Missing bundle field" and "Missing signature field"
// apply the same rule and are no longer reachable.
func TestVerifyBundleV2_MissingBundle(t *testing.T) {
	expectErrors(t, unitVerify(t, "dcp-jcs-v1", func(sb map[string]interface{}) { delete(sb, "bundle") }), "schema: / required bundle")
}

func TestVerifyBundleV2_MissingSignature(t *testing.T) {
	expectErrors(t, unitVerify(t, "dcp-jcs-v1", func(sb map[string]interface{}) { delete(sb, "signature") }), "schema: / required signature")
}

// The parser contract is kept before V2-2.
func TestVerifyBundleV2_InvalidJSON(t *testing.T) {
	reg := NewAlgorithmRegistry()
	result := VerifySignedBundleV2(reg, []byte(`not json`))
	if result.Verified || len(result.Errors) != 1 || !strings.HasPrefix(result.Errors[0], "JSON parse error: ") {
		t.Fatalf("expected the JSON parse error alone: %v", result.Errors)
	}
}

// dcp_bundle_version is const "2.0" in V2-2; "Invalid dcp_bundle_version" applies the same rule.
func TestVerifyBundleV2_InvalidVersion(t *testing.T) {
	r := unitVerify(t, "dcp-jcs-v1", func(sb map[string]interface{}) { at(sb, "bundle")["dcp_bundle_version"] = "1.0" })
	expectErrors(t, r, "schema: /bundle/dcp_bundle_version const")
}

func TestVerifyBundleV2_SessionNonceMismatch(t *testing.T) {
	r := unitVerify(t, "dcp-jcs-v1", func(sb map[string]interface{}) {
		at(sb, "bundle", "agent_passport", "payload")["session_nonce"] = strings.Repeat("f", 64)
	})
	if found, schema := errorWith(r, "Session nonce mismatch in agent_passport"); found == "" || schema || r.SessionBindingValid || r.Verified {
		t.Fatalf("expected the V2-4 nonce mismatch past V2-2: binding %v, %v", r.SessionBindingValid, r.Errors)
	}
}

// An audit entry with another session_nonce (V2-4) is rejected. A canonicalization_profile that is not "dcp-jcs-v1"
// is now a V2-2 error (const) on this route; the profile check stays reachable on the candidate route, where an
// absent field is not the accepted profile.
func TestVerifyBundleV2_AuditNonceAndProfile(t *testing.T) {
	r := unitVerify(t, "dcp-jcs-v1", func(sb map[string]interface{}) {
		sb["bundle"].(map[string]interface{})["audit_entries"].([]interface{})[0].(map[string]interface{})["session_nonce"] = strings.Repeat("f", 64)
	})
	if found, schema := errorWith(r, "Session nonce mismatch in audit_entries[0]"); found == "" || schema || r.SessionBindingValid {
		t.Fatalf("audit entry nonce: %v", r.Errors)
	}
	if found, _ := errorWith(unitVerify(t, "dcp-jcs-v1", unchanged), "Session nonce mismatch"); found != "" {
		t.Fatalf("same nonce reported as a mismatch: %s", found)
	}
	const where = "schema: /bundle/manifest/canonicalization_profile "
	for _, c := range []struct {
		profile interface{}
		want    []string
	}{
		{1, []string{where + "const", where + "type"}},
		{"dcp-jcs-v2", []string{where + "const"}},
		{nil, []string{where + "const", where + "type"}},
	} {
		r := unitVerify(t, "dcp-jcs-v1", func(sb map[string]interface{}) { at(sb, "bundle", "manifest")["canonicalization_profile"] = c.profile })
		expectErrors(t, r, c.want...)
	}
	for _, c := range []struct {
		profile, accepted string
		unknown           bool
	}{{"", "dcp-jcs-v1", false}, {"dcp-jcs-v1", "dcp-jcs-v1", false}, {"", "dcp-jcs-v2", true}, {"dcp-jcs-v2", "dcp-jcs-v2", false}} {
		r := unitVerify(t, c.accepted, func(sb map[string]interface{}) {
			if c.profile == "" {
				delete(at(sb, "bundle", "manifest"), "canonicalization_profile")
			} else {
				at(sb, "bundle", "manifest")["canonicalization_profile"] = c.profile
			}
		})
		found, schema := errorWith(r, "Unknown canonicalization_profile: ")
		if (found != "") != c.unknown || schema {
			t.Fatalf("profile %q under %s: %v", c.profile, c.accepted, r.Errors)
		}
	}
}

// The four artifacts are required by V2-2; "Missing <artifact> in bundle" applies the same rule.
func TestVerifyBundleV2_MissingArtifacts(t *testing.T) {
	r := unitVerify(t, "dcp-jcs-v1", func(sb map[string]interface{}) {
		for _, k := range []string{"responsible_principal_record", "agent_passport", "intent", "policy_decision"} {
			delete(at(sb, "bundle"), k)
		}
	})
	expectErrors(t, r, "schema: /bundle required agent_passport", "schema: /bundle required intent",
		"schema: /bundle required policy_decision", "schema: /bundle required responsible_principal_record")
}

func TestVerifyBundleV2_AuditChainBroken(t *testing.T) {
	r := unitVerify(t, "dcp-jcs-v1", func(sb map[string]interface{}) {
		sb["bundle"].(map[string]interface{})["audit_entries"].([]interface{})[1].(map[string]interface{})["prev_hash"] = "sha256:" + strings.Repeat("0", 64)
	})
	if found, schema := errorWith(r, "Audit hash chain broken at entry 1"); found == "" || schema || r.Verified {
		t.Fatalf("expected audit chain broken error past V2-2, got: %v", r.Errors)
	}
}

// An early V2-2 failure keeps the established result shape, with no signer observations.
func TestVerifyBundleV2_ResultStructure(t *testing.T) {
	reg := NewAlgorithmRegistry()
	result := VerifySignedBundleV2(reg, []byte(`{}`))
	if result.DCPVersion != "2.0" {
		t.Fatal("expected dcp_version 2.0")
	}
	if result.Verified || !reflect.DeepEqual(result.Errors, []string{"schema: / required bundle", "schema: / required signature"}) {
		t.Fatalf("errors %v", result.Errors)
	}
	if result.Warnings == nil || len(result.Warnings) != 0 || result.SignerKeys == nil || len(result.SignerKeys) != 0 {
		t.Fatalf("result shape: %+v", result)
	}
}

// verifyManifestHashes must fail closed when a hash cannot be checked
// (VERIFICATION.md V2-3), not skip the artifact.
func TestVerifyManifestHashes_FailsClosed(t *testing.T) {
	fields := map[string]string{
		"responsible_principal_record": "rpr_hash", "agent_passport": "passport_hash",
		"intent": "intent_hash", "policy_decision": "policy_hash",
	}
	build := func() (bundle, manifest map[string]interface{}) {
		bundle, manifest = map[string]interface{}{}, map[string]interface{}{}
		for field, key := range fields {
			payload := map[string]interface{}{"artifact": field}
			canonical, _ := CanonicalizeV2(payload)
			hash := "sha256:" + DualHashCanonical(canonical).SHA256
			bundle[field] = map[string]interface{}{"payload": payload, "payload_hash": hash}
			manifest[key] = hash
		}
		return bundle, manifest
	}
	errorsFor := func(mutate func(bundle, manifest map[string]interface{})) []string {
		bundle, manifest := build()
		mutate(bundle, manifest)
		result := &V2VerificationResult{}
		verifyManifestHashes(bundle, manifest, result)
		return result.Errors
	}

	if errs := errorsFor(func(_, _ map[string]interface{}) {}); len(errs) != 0 {
		t.Fatalf("consistent bundle: %v", errs)
	}
	for name, mutate := range map[string]func(bundle, manifest map[string]interface{}){
		"manifest hash missing": func(_, m map[string]interface{}) { delete(m, "intent_hash") },
		"payload missing":       func(b, _ map[string]interface{}) { delete(b["intent"].(map[string]interface{}), "payload") },
		"payload not canonical": func(b, _ map[string]interface{}) {
			b["intent"].(map[string]interface{})["payload"] = map[string]interface{}{"amount": 1.5}
		},
		"payload_hash wrong": func(b, _ map[string]interface{}) {
			b["intent"].(map[string]interface{})["payload_hash"] = "sha256:" + strings.Repeat("0", 64)
		},
	} {
		if errs := errorsFor(mutate); len(errs) == 0 {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// TestParseRFC3339Vectors runs the shared rfc3339 vectors: each input parses
// to its instant in Unix milliseconds, or is rejected.
func TestParseRFC3339Vectors(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "interop", "v2", "interop_vectors.json"))
	if err != nil {
		t.Fatalf("read interop vectors: %v", err)
	}
	var vecs struct {
		RFC3339 struct {
			Cases []struct {
				Input   interface{} `json:"input"`
				EpochMs *int64      `json:"epoch_ms"`
			} `json:"cases"`
		} `json:"rfc3339"`
	}
	if err := json.Unmarshal(data, &vecs); err != nil {
		t.Fatalf("parse interop vectors: %v", err)
	}
	if len(vecs.RFC3339.Cases) == 0 {
		t.Fatal("no rfc3339 cases")
	}
	for _, c := range vecs.RFC3339.Cases {
		got, ok := parseRFC3339(c.Input)
		switch {
		case c.EpochMs == nil && ok:
			t.Errorf("%v: parsed as %v, want it rejected", c.Input, got)
		case c.EpochMs != nil && (!ok || got.UnixMilli() != *c.EpochMs):
			t.Errorf("%v: got %v (ok=%v), want %d", c.Input, got.UnixMilli(), ok, *c.EpochMs)
		}
	}
}

// Timestamps compare at millisecond precision, for years 0000 to 9999
// (VERIFICATION.md V2-4): what is below the millisecond decides nothing.
func TestSessionTimesMillisecondPrecision(t *testing.T) {
	errorsFor := func(manifest map[string]interface{}, maxSession int) []string {
		policy := DefaultVerifierPolicy()
		policy.MaxSessionDurationSeconds = maxSession
		result := &V2VerificationResult{}
		verifySessionTimes(manifest, policy, truncateToMillis(time.Now().Round(0)), result)
		return result.Errors
	}
	issued, _ := time.Parse(time.RFC3339, "2026-10-21T00:00:00Z")
	expires, _ := time.Parse(time.RFC3339, "2099-12-31T18:59:59Z")
	exact := int(expires.Unix() - issued.Unix())

	// The maximum plus 0.0005 s is the maximum.
	window := map[string]interface{}{"session_issued_at": "2026-10-21T00:00:00Z", "session_expires_at": "2099-12-31T18:59:59.0005Z"}
	if errs := errorsFor(window, exact); len(errs) != 0 {
		t.Fatalf("max + 0.0005 s: %v", errs)
	}
	window["session_expires_at"] = "2099-12-31T18:59:59.001Z"
	if errs := errorsFor(window, exact); len(errs) != 1 || !strings.HasPrefix(errs[0], "Session duration") {
		t.Fatalf("max + 0.001 s: %v", errs)
	}

	// An issue time .0009 s and an expiry .0001 s into the same millisecond.
	second := time.Now().Add(10 * time.Second).UTC().Format("2006-01-02T15:04:05")
	same := map[string]interface{}{"session_issued_at": second + ".0009Z", "session_expires_at": second + ".0001Z"}
	if errs := errorsFor(same, 0); len(errs) != 0 {
		t.Fatalf("same millisecond: %v", errs)
	}

	// Years 0000 and 9999, and a window longer than time.Duration holds.
	wide := map[string]interface{}{"session_issued_at": "0000-01-01T00:00:00Z", "session_expires_at": "9999-12-31T23:59:59.999Z"}
	if errs := errorsFor(wide, 1<<40); len(errs) != 0 {
		t.Fatalf("years 0000 to 9999: %v", errs)
	}
	if errs := errorsFor(wide, 300*365*24*3600); len(errs) != 1 || !strings.HasPrefix(errs[0], "Session duration") {
		t.Fatalf("a 10000 year session under a 300 year maximum: %v", errs)
	}

	// A maximum needs both ends of the session.
	if errs := errorsFor(map[string]interface{}{"session_issued_at": "2026-10-21T00:00:00Z"}, 3600); len(errs) != 1 || !strings.Contains(errs[0], "session_expires_at") {
		t.Fatalf("no session_expires_at under a maximum: %v", errs)
	}
}

// A key is canonical base64 before its kid is derived (VERIFICATION.md V2-13).
func TestKeyIdentityCanonicalBase64(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	b64 := base64.StdEncoding.EncodeToString(key)
	kid := DeriveKid("ed25519", key)
	if err := keyIdentityError(kid, "ed25519", b64); err != nil {
		t.Fatalf("canonical key: %v", err)
	}
	last := strings.IndexByte(b64, '=') - 1
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	trailingBit := b64[:last] + string(alphabet[strings.IndexByte(alphabet, b64[last])^1]) + b64[last+1:]
	for name, v := range map[string]interface{}{
		"trailing bit": trailingBit,
		"unpadded":     strings.TrimRight(b64, "="),
		"line break":   b64[:8] + "\n" + b64[8:],
		"url-safe":     strings.NewReplacer("+", "-", "/", "_").Replace(base64.StdEncoding.EncodeToString([]byte{0xfb, 0xff, 0xfe})),
		"not a string": 42,
	} {
		err := keyIdentityError(kid, "ed25519", v)
		if err == nil || !strings.Contains(err.Error(), "canonical base64") {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := keyIdentityError(strings.Repeat("a", 32), "ed25519", b64); err == nil || !strings.Contains(err.Error(), "not derived") {
		t.Errorf("kid not derived: %v", err)
	}
}
