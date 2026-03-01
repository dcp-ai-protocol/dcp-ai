package providers

import (
	"encoding/base64"
	"testing"
)

func TestMlKem768_Alg(t *testing.T) {
	p := &MlKem768Provider{}
	if p.Alg() != "ml-kem-768" {
		t.Fatalf("expected ml-kem-768, got %s", p.Alg())
	}
}

func TestMlKem768_GenerateKeypair(t *testing.T) {
	p := &MlKem768Provider{}
	kp, err := p.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	if kp.Kid == "" {
		t.Fatal("kid should not be empty")
	}
	if kp.PublicKeyB64 == "" {
		t.Fatal("public key should not be empty")
	}
	if kp.SecretKeyB64 == "" {
		t.Fatal("secret key should not be empty")
	}

	pkBytes, err := base64.StdEncoding.DecodeString(kp.PublicKeyB64)
	if err != nil {
		t.Fatalf("decode pk: %v", err)
	}
	if len(pkBytes) == 0 {
		t.Fatal("public key bytes should not be empty")
	}
}

func TestMlKem768_RoundTrip(t *testing.T) {
	p := &MlKem768Provider{}
	kp, err := p.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}

	result, err := p.Encapsulate(kp.PublicKeyB64)
	if err != nil {
		t.Fatalf("encapsulate: %v", err)
	}

	if result.CiphertextB64 == "" {
		t.Fatal("ciphertext should not be empty")
	}
	if result.SharedSecretB64 == "" {
		t.Fatal("shared secret should not be empty")
	}

	ss, err := p.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
	if err != nil {
		t.Fatalf("decapsulate: %v", err)
	}

	expected, _ := base64.StdEncoding.DecodeString(result.SharedSecretB64)
	if len(ss) != len(expected) {
		t.Fatalf("shared secret length mismatch: %d != %d", len(ss), len(expected))
	}
	for i := range ss {
		if ss[i] != expected[i] {
			t.Fatalf("shared secret mismatch at byte %d", i)
		}
	}
}

func TestMlKem768_MultipleRoundTrips(t *testing.T) {
	p := &MlKem768Provider{}
	kp, err := p.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}

	for i := 0; i < 3; i++ {
		result, err := p.Encapsulate(kp.PublicKeyB64)
		if err != nil {
			t.Fatalf("encapsulate %d: %v", i, err)
		}
		ss, err := p.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
		if err != nil {
			t.Fatalf("decapsulate %d: %v", i, err)
		}
		expected, _ := base64.StdEncoding.DecodeString(result.SharedSecretB64)
		for j := range ss {
			if ss[j] != expected[j] {
				t.Fatalf("round trip %d: shared secret mismatch at byte %d", i, j)
			}
		}
	}
}

func TestMlKem768_DifferentKeypairsProduceDifferentSecrets(t *testing.T) {
	p := &MlKem768Provider{}
	kp1, _ := p.GenerateKeypair()
	kp2, _ := p.GenerateKeypair()

	if kp1.PublicKeyB64 == kp2.PublicKeyB64 {
		t.Fatal("two keypairs should have different public keys")
	}
	if kp1.Kid == kp2.Kid {
		t.Fatal("two keypairs should have different kids")
	}
}

func TestMlKem768_InvalidPublicKey(t *testing.T) {
	p := &MlKem768Provider{}
	_, err := p.Encapsulate(base64.StdEncoding.EncodeToString([]byte("short")))
	if err == nil {
		t.Fatal("expected error for invalid public key")
	}
}

func TestMlKem768_InvalidSecretKey(t *testing.T) {
	p := &MlKem768Provider{}
	kp, _ := p.GenerateKeypair()
	result, _ := p.Encapsulate(kp.PublicKeyB64)
	_, err := p.Decapsulate(result.CiphertextB64, base64.StdEncoding.EncodeToString([]byte("short")))
	if err == nil {
		t.Fatal("expected error for invalid secret key")
	}
}
