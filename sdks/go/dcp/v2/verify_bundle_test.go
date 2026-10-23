package v2

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
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

func TestVerifyBundleV2_MissingBundle(t *testing.T) {
	reg := NewAlgorithmRegistry()
	result := VerifySignedBundleV2(reg, []byte(`{"signature":{}}`))
	if result.Verified {
		t.Fatal("expected verification to fail for missing bundle")
	}
	if len(result.Errors) == 0 {
		t.Fatal("expected errors")
	}
}

func TestVerifyBundleV2_MissingSignature(t *testing.T) {
	reg := NewAlgorithmRegistry()
	result := VerifySignedBundleV2(reg, []byte(`{"bundle":{}}`))
	if result.Verified {
		t.Fatal("expected verification to fail for missing signature")
	}
}

func TestVerifyBundleV2_InvalidJSON(t *testing.T) {
	reg := NewAlgorithmRegistry()
	result := VerifySignedBundleV2(reg, []byte(`not json`))
	if result.Verified {
		t.Fatal("expected verification to fail for invalid JSON")
	}
}

func TestVerifyBundleV2_InvalidVersion(t *testing.T) {
	reg := NewAlgorithmRegistry()
	bundle := map[string]interface{}{
		"bundle": map[string]interface{}{
			"dcp_bundle_version": "1.0",
			"manifest":           map[string]interface{}{"session_nonce": "abc"},
		},
		"signature": map[string]interface{}{},
	}
	data, _ := json.Marshal(bundle)
	result := VerifySignedBundleV2(reg, data)
	if result.Verified {
		t.Fatal("expected verification to fail for wrong version")
	}
	found := false
	for _, e := range result.Errors {
		if e == "Invalid dcp_bundle_version" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected 'Invalid dcp_bundle_version' error")
	}
}

func TestVerifyBundleV2_SessionNonceMismatch(t *testing.T) {
	reg := NewAlgorithmRegistry()
	reg.RegisterSigner(&mockProvider{alg: "ed25519", sigSize: 64})

	bundle := map[string]interface{}{
		"bundle": map[string]interface{}{
			"dcp_bundle_version": "2.0",
			"manifest":           map[string]interface{}{"session_nonce": "nonce-a"},
			"responsible_principal_record": map[string]interface{}{
				"payload": map[string]interface{}{"session_nonce": "nonce-a"},
			},
			"agent_passport": map[string]interface{}{
				"payload": map[string]interface{}{
					"session_nonce": "nonce-b",
					"keys":         []interface{}{},
				},
			},
			"intent": map[string]interface{}{
				"payload": map[string]interface{}{"session_nonce": "nonce-a"},
			},
			"policy_decision": map[string]interface{}{
				"payload": map[string]interface{}{"session_nonce": "nonce-a"},
			},
		},
		"signature": map[string]interface{}{
			"composite_sig": map[string]interface{}{
				"classical": map[string]interface{}{"alg": "ed25519", "kid": "k1", "sig_b64": "AAAA"},
				"binding":   "classical_only",
			},
		},
	}
	data, _ := json.Marshal(bundle)
	result := VerifySignedBundleV2(reg, data)
	if result.SessionBindingValid {
		t.Fatal("expected session binding to be invalid")
	}
}

// An audit entry with another session_nonce (V2-4) and a canonicalization_profile
// that is not the string "dcp-jcs-v1" are rejected.
func TestVerifyBundleV2_AuditNonceAndProfile(t *testing.T) {
	reg := NewAlgorithmRegistry()
	build := func(auditNonce string, profile interface{}) []byte {
		manifest := map[string]interface{}{"session_nonce": "nonce-a"}
		if profile != nil {
			manifest["canonicalization_profile"] = profile
		}
		artifact := map[string]interface{}{"payload": map[string]interface{}{"session_nonce": "nonce-a"}}
		data, _ := json.Marshal(map[string]interface{}{
			"bundle": map[string]interface{}{
				"dcp_bundle_version":           "2.0",
				"manifest":                     manifest,
				"responsible_principal_record": artifact,
				"agent_passport":               artifact,
				"intent":                       artifact,
				"policy_decision":              artifact,
				"audit_entries":                []interface{}{map[string]interface{}{"session_nonce": auditNonce}},
			},
			"signature": map[string]interface{}{},
		})
		return data
	}
	hasError := func(result *V2VerificationResult, want string) bool {
		for _, e := range result.Errors {
			if strings.HasPrefix(e, want) {
				return true
			}
		}
		return false
	}
	if r := VerifySignedBundleV2(reg, build("nonce-b", nil)); !hasError(r, "Session nonce mismatch in audit_entries[0]") || r.SessionBindingValid {
		t.Fatalf("audit entry nonce: %v", r.Errors)
	}
	if r := VerifySignedBundleV2(reg, build("nonce-a", nil)); hasError(r, "Session nonce mismatch in audit_entries[0]") {
		t.Fatalf("same nonce reported as a mismatch: %v", r.Errors)
	}
	for _, profile := range []interface{}{1, "dcp-jcs-v2", json.RawMessage("null")} {
		r := VerifySignedBundleV2(reg, build("nonce-a", profile))
		if !hasError(r, "Unknown canonicalization_profile: ") {
			t.Fatalf("profile %v: %v", profile, r.Errors)
		}
	}
	if r := VerifySignedBundleV2(reg, build("nonce-a", "dcp-jcs-v1")); hasError(r, "Unknown canonicalization_profile: ") {
		t.Fatalf("dcp-jcs-v1 rejected: %v", r.Errors)
	}
}

func TestVerifyBundleV2_MissingArtifacts(t *testing.T) {
	reg := NewAlgorithmRegistry()
	bundle := map[string]interface{}{
		"bundle": map[string]interface{}{
			"dcp_bundle_version": "2.0",
			"manifest":           map[string]interface{}{"session_nonce": "abc"},
		},
		"signature": map[string]interface{}{},
	}
	data, _ := json.Marshal(bundle)
	result := VerifySignedBundleV2(reg, data)
	if result.Verified {
		t.Fatal("expected verification to fail for missing artifacts")
	}
	missingCount := 0
	for _, e := range result.Errors {
		if len(e) > 8 && e[:7] == "Missing" {
			missingCount++
		}
	}
	if missingCount < 4 {
		t.Fatalf("expected at least 4 missing artifact errors, got %d", missingCount)
	}
}

func TestVerifyBundleV2_AuditChainBroken(t *testing.T) {
	reg := NewAlgorithmRegistry()
	reg.RegisterSigner(&mockProvider{alg: "ed25519", sigSize: 64})

	bundle := map[string]interface{}{
		"bundle": map[string]interface{}{
			"dcp_bundle_version": "2.0",
			"manifest":           map[string]interface{}{"session_nonce": "n1"},
			"responsible_principal_record": map[string]interface{}{
				"payload": map[string]interface{}{"session_nonce": "n1"},
			},
			"agent_passport": map[string]interface{}{
				"payload": map[string]interface{}{
					"session_nonce": "n1",
					"keys": []interface{}{
						map[string]interface{}{"alg": "ed25519", "public_key_b64": "dGVzdA=="},
					},
				},
			},
			"intent": map[string]interface{}{
				"payload": map[string]interface{}{"session_nonce": "n1"},
			},
			"policy_decision": map[string]interface{}{
				"payload": map[string]interface{}{"session_nonce": "n1"},
			},
			"audit_entries": []interface{}{
				map[string]interface{}{"audit_id": "a1", "prev_hash": "GENESIS"},
				map[string]interface{}{"audit_id": "a2", "prev_hash": "sha256:wrong"},
			},
		},
		"signature": map[string]interface{}{
			"composite_sig": map[string]interface{}{
				"classical": map[string]interface{}{"alg": "ed25519", "kid": "k1", "sig_b64": "AAAA"},
				"binding":   "classical_only",
			},
		},
	}
	data, _ := json.Marshal(bundle)
	result := VerifySignedBundleV2(reg, data)
	found := false
	for _, e := range result.Errors {
		if strings.HasPrefix(e, "Audit hash chain broken at entry 1") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected audit chain broken error, got: %v", result.Errors)
	}
}

func TestVerifyBundleV2_ResultStructure(t *testing.T) {
	reg := NewAlgorithmRegistry()
	result := VerifySignedBundleV2(reg, []byte(`{}`))
	if result.DCPVersion != "2.0" {
		t.Fatal("expected dcp_version 2.0")
	}
	if result.Errors == nil {
		t.Fatal("errors should not be nil")
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
		verifySessionTimes(manifest, policy, result)
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
