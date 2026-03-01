package v2

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildBundleV2_Structure(t *testing.T) {
	input := BundleBuildInput{
		RPR:          map[string]interface{}{"human_id": "h1", "session_nonce": "n1"},
		Passport:     map[string]interface{}{"agent_id": "a1", "session_nonce": "n1"},
		Intent:       map[string]interface{}{"intent_id": "i1", "session_nonce": "n1"},
		Policy:       map[string]interface{}{"intent_id": "i1", "session_nonce": "n1", "risk_score": 100},
		AuditEntries: []interface{}{},
		SessionNonce: "n1",
	}

	bundle, err := BuildBundleV2(input)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	if bundle.DCPBundleVersion != "2.0" {
		t.Fatalf("expected version 2.0, got %s", bundle.DCPBundleVersion)
	}
	if bundle.Manifest.SessionNonce != "n1" {
		t.Fatalf("expected session nonce n1, got %s", bundle.Manifest.SessionNonce)
	}
	if !strings.HasPrefix(bundle.Manifest.RPRHash, "sha256:") {
		t.Fatalf("rpr_hash should start with sha256:, got %s", bundle.Manifest.RPRHash)
	}
	if !strings.HasPrefix(bundle.Manifest.PassportHash, "sha256:") {
		t.Fatal("passport_hash should start with sha256:")
	}
	if !strings.HasPrefix(bundle.Manifest.IntentHash, "sha256:") {
		t.Fatal("intent_hash should start with sha256:")
	}
	if !strings.HasPrefix(bundle.Manifest.PolicyHash, "sha256:") {
		t.Fatal("policy_hash should start with sha256:")
	}
	if !strings.HasPrefix(bundle.Manifest.AuditMerkleRoot, "sha256:") {
		t.Fatal("audit_merkle_root should start with sha256:")
	}
	if !strings.HasPrefix(bundle.Manifest.AuditMerkleRootSecondary, "sha3-256:") {
		t.Fatal("audit_merkle_root_secondary should start with sha3-256:")
	}
}

func TestBuildBundleV2_ManifestHashConsistency(t *testing.T) {
	payload := map[string]interface{}{"test": "data", "session_nonce": "n1"}
	input := BundleBuildInput{
		RPR:          payload,
		Passport:     payload,
		Intent:       payload,
		Policy:       payload,
		AuditEntries: []interface{}{},
		SessionNonce: "n1",
	}

	bundle, err := BuildBundleV2(input)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	dh := DualHashCanonical(canonical)
	expectedHash := "sha256:" + dh.SHA256

	if bundle.Manifest.RPRHash != expectedHash {
		t.Fatalf("rpr hash mismatch: got %s, want %s", bundle.Manifest.RPRHash, expectedHash)
	}
}

func TestBuildBundleV2_WithAuditEntries(t *testing.T) {
	input := BundleBuildInput{
		RPR:      map[string]interface{}{"session_nonce": "n1"},
		Passport: map[string]interface{}{"session_nonce": "n1"},
		Intent:   map[string]interface{}{"session_nonce": "n1"},
		Policy:   map[string]interface{}{"session_nonce": "n1"},
		AuditEntries: []interface{}{
			map[string]interface{}{"audit_id": "a1"},
			map[string]interface{}{"audit_id": "a2"},
		},
		SessionNonce: "n1",
	}

	bundle, err := BuildBundleV2(input)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if bundle.Manifest.AuditCount != 2 {
		t.Fatalf("expected audit count 2, got %d", bundle.Manifest.AuditCount)
	}
	root := bundle.Manifest.AuditMerkleRoot
	if root == "sha256:"+strings.Repeat("0", 64) {
		t.Fatal("audit merkle root should not be all zeros when entries exist")
	}
}

func TestSignBundleV2_ClassicalOnly(t *testing.T) {
	reg := NewAlgorithmRegistry()
	reg.RegisterSigner(&mockProvider{alg: "ed25519", sigSize: 64})

	input := BundleBuildInput{
		RPR:          map[string]interface{}{"session_nonce": "n1"},
		Passport:     map[string]interface{}{"session_nonce": "n1"},
		Intent:       map[string]interface{}{"session_nonce": "n1"},
		Policy:       map[string]interface{}{"session_nonce": "n1"},
		AuditEntries: []interface{}{},
		SessionNonce: "n1",
	}

	bundle, err := BuildBundleV2(input)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	signed, err := SignBundleV2(reg, bundle, CompositeKeyInfo{
		Kid:          "k1",
		Alg:          "ed25519",
		SecretKeyB64: "dGVzdA==",
	}, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if signed.Signature.HashAlg != "sha256" {
		t.Fatalf("expected hash_alg sha256, got %s", signed.Signature.HashAlg)
	}
	if signed.Signature.CompositeSig.Binding != "classical_only" {
		t.Fatalf("expected classical_only binding, got %s", signed.Signature.CompositeSig.Binding)
	}
	if len(signed.Signature.Signer.Kids) != 1 {
		t.Fatalf("expected 1 kid, got %d", len(signed.Signature.Signer.Kids))
	}
	if !strings.HasPrefix(signed.Signature.ManifestHash, "sha256:") {
		t.Fatal("manifest_hash should start with sha256:")
	}
}

func TestSignBundleV2_Composite(t *testing.T) {
	reg := NewAlgorithmRegistry()
	reg.RegisterSigner(&mockProvider{alg: "ed25519", sigSize: 64})
	reg.RegisterSigner(&mockProvider{alg: "ml-dsa-65", sigSize: 3309})

	input := BundleBuildInput{
		RPR:          map[string]interface{}{"session_nonce": "n1"},
		Passport:     map[string]interface{}{"session_nonce": "n1"},
		Intent:       map[string]interface{}{"session_nonce": "n1"},
		Policy:       map[string]interface{}{"session_nonce": "n1"},
		AuditEntries: []interface{}{},
		SessionNonce: "n1",
	}

	bundle, err := BuildBundleV2(input)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	pqKey := CompositeKeyInfo{
		Kid:          "k2",
		Alg:          "ml-dsa-65",
		SecretKeyB64: "dGVzdA==",
	}

	signed, err := SignBundleV2(reg, bundle, CompositeKeyInfo{
		Kid:          "k1",
		Alg:          "ed25519",
		SecretKeyB64: "dGVzdA==",
	}, &pqKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if signed.Signature.CompositeSig.Binding != "pq_over_classical" {
		t.Fatalf("expected pq_over_classical, got %s", signed.Signature.CompositeSig.Binding)
	}
	if len(signed.Signature.Signer.Kids) != 2 {
		t.Fatalf("expected 2 kids, got %d", len(signed.Signature.Signer.Kids))
	}
}

func TestSignBundleV2_ProducesValidJSON(t *testing.T) {
	reg := NewAlgorithmRegistry()
	reg.RegisterSigner(&mockProvider{alg: "ed25519", sigSize: 64})

	input := BundleBuildInput{
		RPR:          map[string]interface{}{"session_nonce": "n1"},
		Passport:     map[string]interface{}{"session_nonce": "n1"},
		Intent:       map[string]interface{}{"session_nonce": "n1"},
		Policy:       map[string]interface{}{"session_nonce": "n1"},
		AuditEntries: []interface{}{},
		SessionNonce: "n1",
	}

	bundle, _ := BuildBundleV2(input)
	signed, _ := SignBundleV2(reg, bundle, CompositeKeyInfo{
		Kid: "k1", Alg: "ed25519", SecretKeyB64: "dGVzdA==",
	}, nil)

	data, err := json.Marshal(signed)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := parsed["bundle"]; !ok {
		t.Fatal("signed bundle JSON missing 'bundle' field")
	}
	if _, ok := parsed["signature"]; !ok {
		t.Fatal("signed bundle JSON missing 'signature' field")
	}
}
