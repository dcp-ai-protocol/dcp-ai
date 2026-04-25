package dcp_test

// NIST KAT (Known Answer Test) compliance tests for the Go SDK.
//
// Ed25519: RFC 8032 Section 7.1 deterministic test vectors.
// ML-DSA-65: FIPS 204 property-based compliance (sizes, round-trip,
// wrong-key / wrong-message rejection, deterministic kid).
//
// Fixtures live at tests/nist-kat/ (shared with the TypeScript, Python,
// and Rust SDKs). This file closes the parity gap with test_nist_kat.py
// and nist_kat.rs so the Go SDK is on the same footing as the other
// three SDKs for NIST compliance claims.

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// ─── Helpers ───────────────────────────────────────────────────────────────

func katDir(t *testing.T) string {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	// sdks/go/dcp/nist_kat_test.go -> ../../../tests/nist-kat (three levels up).
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "nist-kat")
}

func loadKAT(t *testing.T, subdir string) map[string]interface{} {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(katDir(t), subdir, "vectors.json"))
	if err != nil {
		t.Fatalf("read KAT %s: %v", subdir, err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("parse KAT %s: %v", subdir, err)
	}
	return out
}

// ─── Ed25519 — RFC 8032 ────────────────────────────────────────────────────

func TestEd25519RFC8032Sign(t *testing.T) {
	kat := loadKAT(t, "ed25519")
	vectors, ok := kat["test_vectors"].([]interface{})
	if !ok || len(vectors) == 0 {
		t.Fatalf("no test_vectors in ed25519 KAT")
	}
	for _, raw := range vectors {
		vec := raw.(map[string]interface{})
		name := vec["name"].(string)
		t.Run(name, func(t *testing.T) {
			sk, _ := hex.DecodeString(vec["secret_key_hex"].(string))
			pk, _ := hex.DecodeString(vec["public_key_hex"].(string))
			msg, _ := hex.DecodeString(vec["message_hex"].(string))
			want, _ := hex.DecodeString(vec["signature_hex"].(string))

			// RFC 8032 uses a 32-byte seed; Go stdlib ed25519 expands to 64.
			priv := ed25519.NewKeyFromSeed(sk)
			derivedPub := priv.Public().(ed25519.PublicKey)
			if hex.EncodeToString(derivedPub) != hex.EncodeToString(pk) {
				t.Fatalf("derived public key mismatch")
			}

			sig := ed25519.Sign(priv, msg)
			if hex.EncodeToString(sig) != hex.EncodeToString(want) {
				t.Fatalf("signature mismatch:\n  got:  %x\n  want: %x", sig, want)
			}
		})
	}
}

func TestEd25519RFC8032Verify(t *testing.T) {
	kat := loadKAT(t, "ed25519")
	for _, raw := range kat["test_vectors"].([]interface{}) {
		vec := raw.(map[string]interface{})
		t.Run(vec["name"].(string), func(t *testing.T) {
			pk, _ := hex.DecodeString(vec["public_key_hex"].(string))
			msg, _ := hex.DecodeString(vec["message_hex"].(string))
			sig, _ := hex.DecodeString(vec["signature_hex"].(string))
			if !ed25519.Verify(pk, msg, sig) {
				t.Fatalf("RFC 8032 signature failed to verify")
			}
		})
	}
}

func TestEd25519RFC8032TamperedFails(t *testing.T) {
	kat := loadKAT(t, "ed25519")
	vec := kat["test_vectors"].([]interface{})[1].(map[string]interface{})
	pk, _ := hex.DecodeString(vec["public_key_hex"].(string))
	msg, _ := hex.DecodeString(vec["message_hex"].(string))
	sig, _ := hex.DecodeString(vec["signature_hex"].(string))

	tamperedMsg := append([]byte{}, msg...)
	tamperedMsg = append(tamperedMsg, 0xff)
	if ed25519.Verify(pk, tamperedMsg, sig) {
		t.Fatalf("tampered message must fail verification")
	}

	tamperedSig := append([]byte{}, sig...)
	tamperedSig[0] ^= 0x01
	if ed25519.Verify(pk, msg, tamperedSig) {
		t.Fatalf("tampered signature must fail verification")
	}
}

// ─── Ed25519 provider — via v2 crypto_provider abstraction ─────────────────

func TestEd25519ProviderKidDeterministic(t *testing.T) {
	provider := &providers.Ed25519Provider{}
	kp, err := provider.GenerateKeypair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}
	pkBytes, _ := base64.StdEncoding.DecodeString(kp.PublicKeyB64)

	// kid = hex(SHA-256("ed25519" || 0x00 || pubkey))[0:32]
	kid := v2.DeriveKid("ed25519", pkBytes)
	if len(kid) != 32 {
		t.Fatalf("kid length = %d, want 32", len(kid))
	}
	again := v2.DeriveKid("ed25519", pkBytes)
	if again != kid {
		t.Fatalf("kid is not deterministic")
	}

	// Sanity: matches our direct hash
	h := sha256.New()
	h.Write([]byte("ed25519"))
	h.Write([]byte{0x00})
	h.Write(pkBytes)
	expected := hex.EncodeToString(h.Sum(nil))[:32]
	if kid != expected {
		t.Fatalf("kid = %s, want %s", kid, expected)
	}
}

func TestEd25519ProviderSignVerifyRoundtrip(t *testing.T) {
	provider := &providers.Ed25519Provider{}
	kp, err := provider.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	msg := []byte("hello world")
	sig, err := provider.Sign(msg, kp.SecretKeyB64)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	ok, err := provider.Verify(msg, sig, kp.PublicKeyB64)
	if err != nil || !ok {
		t.Fatalf("roundtrip verify failed: ok=%v err=%v", ok, err)
	}
}

func TestEd25519ProviderWrongKeyFails(t *testing.T) {
	provider := &providers.Ed25519Provider{}
	kpA, _ := provider.GenerateKeypair()
	kpB, _ := provider.GenerateKeypair()
	msg := []byte("payload")
	sig, _ := provider.Sign(msg, kpA.SecretKeyB64)
	ok, _ := provider.Verify(msg, sig, kpB.PublicKeyB64)
	if ok {
		t.Fatalf("verify with wrong key must fail")
	}
}

// ─── ML-DSA-65 (FIPS 204) — property tests ─────────────────────────────────

func TestMlDsa65FipsSizes(t *testing.T) {
	kat := loadKAT(t, "ml-dsa-65")
	props := kat["properties"].(map[string]interface{})

	expectedPk := int(props["public_key_size"].(float64))
	expectedSig := int(props["signature_size"].(float64))

	provider := &providers.MlDsa65Provider{}
	kp, err := provider.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	pkBytes, err := base64.StdEncoding.DecodeString(kp.PublicKeyB64)
	if err != nil {
		t.Fatalf("decode pk: %v", err)
	}
	if len(pkBytes) != expectedPk {
		t.Fatalf("ML-DSA-65 pk size = %d, FIPS 204 wants %d", len(pkBytes), expectedPk)
	}

	sig, err := provider.Sign([]byte("test"), kp.SecretKeyB64)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if len(sig) != expectedSig {
		t.Fatalf("ML-DSA-65 sig size = %d, FIPS 204 wants %d", len(sig), expectedSig)
	}
}

func TestMlDsa65KidDeterministic(t *testing.T) {
	provider := &providers.MlDsa65Provider{}
	kp, err := provider.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	pkBytes, _ := base64.StdEncoding.DecodeString(kp.PublicKeyB64)
	k1 := v2.DeriveKid("ml-dsa-65", pkBytes)
	k2 := v2.DeriveKid("ml-dsa-65", pkBytes)
	if k1 != k2 {
		t.Fatalf("ml-dsa-65 kid not deterministic: %s vs %s", k1, k2)
	}
	if len(k1) != 32 {
		t.Fatalf("kid length = %d, want 32", len(k1))
	}
}

func TestMlDsa65SignVerifyRoundtrip(t *testing.T) {
	provider := &providers.MlDsa65Provider{}
	kp, err := provider.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	msg := []byte("payload under ml-dsa-65")
	sig, err := provider.Sign(msg, kp.SecretKeyB64)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	ok, err := provider.Verify(msg, sig, kp.PublicKeyB64)
	if err != nil || !ok {
		t.Fatalf("roundtrip verify failed: ok=%v err=%v", ok, err)
	}
}

func TestMlDsa65WrongKeyFails(t *testing.T) {
	provider := &providers.MlDsa65Provider{}
	kpA, _ := provider.GenerateKeypair()
	kpB, _ := provider.GenerateKeypair()
	msg := []byte("payload")
	sig, _ := provider.Sign(msg, kpA.SecretKeyB64)
	ok, _ := provider.Verify(msg, sig, kpB.PublicKeyB64)
	if ok {
		t.Fatalf("verify with wrong key must fail")
	}
}

func TestMlDsa65WrongMessageFails(t *testing.T) {
	provider := &providers.MlDsa65Provider{}
	kp, _ := provider.GenerateKeypair()
	sig, _ := provider.Sign([]byte("message A"), kp.SecretKeyB64)
	ok, _ := provider.Verify([]byte("message B"), sig, kp.PublicKeyB64)
	if ok {
		t.Fatalf("verify with tampered message must fail")
	}
}
