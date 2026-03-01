package v2

import (
	"encoding/json"
	"testing"
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
				map[string]interface{}{"audit_id": "a1", "prev_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000"},
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
		if e == "Audit hash chain broken at entry 1" {
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
