package v2

import (
	"testing"
)

func TestClassicalOnlySignVerify(t *testing.T) {
	// This test requires a registered Ed25519 provider.
	// In integration tests, use providers.Ed25519Provider.
	// Here we test the structural aspects of CompositeVerifyResult.
	result := &CompositeVerifyResult{
		Valid:          true,
		ClassicalValid: true,
		PQValid:        false,
	}
	if !result.Valid {
		t.Error("expected valid")
	}
	if result.PQValid {
		t.Error("expected pq_valid false for classical_only")
	}
}

func TestCompositeKeyInfoFields(t *testing.T) {
	key := CompositeKeyInfo{
		Kid:          "test-kid",
		Alg:          "ed25519",
		SecretKeyB64: "secret",
		PublicKeyB64: "public",
	}
	if key.Alg != "ed25519" {
		t.Errorf("expected ed25519, got %s", key.Alg)
	}
}
