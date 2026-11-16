package dcp_test

// NIST KAT (Known Answer Test) compliance tests for the Go SDK.
//
// Ed25519: RFC 8032 Section 7.1 deterministic test vectors.
// ML-DSA-65: FIPS 204 property-based compliance (sizes, round-trip,
// wrong-key / wrong-message rejection, deterministic kid).
// ML-DSA-65: independent verification vectors (NIST ACVP tc39 + Wycheproof),
// empty context.
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

// ─── ML-DSA-65 — independent verification vectors (NIST ACVP tc39 + Wycheproof) ───
//
// The provider verifies with the empty FIPS 204 context, so only cases whose
// context is empty go through it; the others are checked as excluded. Values
// are copied verbatim from the pinned sources (tests/nist-kat/README.md).

const mlDsa65Wycheproof = "wycheproof_mldsa_65_verify_test.json"
const mlDsa65NistTG3 = "acvp_sigver_tg3.json"

var mlDsa65VectorProvider mlDsa65Verifier = &providers.MlDsa65Provider{}

// Wycheproof cases whose public key is not 1952 bytes, and the provider's error for them.
var mlDsa65PkLengthIDs = map[int]bool{69: true, 70: true, 158: true, 159: true}

const mlDsa65PkLengthError = "unmarshal ml-dsa-65 pk: packed public key must be of mldsa65.PublicKeySize bytes"

type mlDsa65Verifier interface {
	Verify(message []byte, signature []byte, publicKeyB64 string) (bool, error)
}

type mlDsa65VectorCase struct {
	source       string
	id           int
	pk, msg, sig string
	valid        bool
}

type mlDsa65Corpus struct {
	wyBytes, nistBytes        []byte
	wyAlgorithm               string
	wyNumberOfTests           int
	tgID                      int
	parameterSet, iface, mode string
	nistTests                 int
	cases                     []mlDsa65VectorCase
	excludedWy, excludedNist  []int
}

func loadMlDsa65Corpus(t *testing.T) mlDsa65Corpus {
	t.Helper()
	dir := filepath.Join(katDir(t), "ml-dsa-65")
	var c mlDsa65Corpus
	var err error
	if c.wyBytes, err = os.ReadFile(filepath.Join(dir, mlDsa65Wycheproof)); err != nil {
		t.Fatalf("read Wycheproof corpus: %v", err)
	}
	if c.nistBytes, err = os.ReadFile(filepath.Join(dir, mlDsa65NistTG3)); err != nil {
		t.Fatalf("read NIST tg3 corpus: %v", err)
	}
	var wy struct {
		Algorithm     string `json:"algorithm"`
		NumberOfTests int    `json:"numberOfTests"`
		TestGroups    []struct {
			PublicKey string `json:"publicKey"`
			Tests     []struct {
				TcID   int     `json:"tcId"`
				Msg    string  `json:"msg"`
				Sig    string  `json:"sig"`
				Ctx    *string `json:"ctx"`
				Result string  `json:"result"`
			} `json:"tests"`
		} `json:"testGroups"`
	}
	if err := json.Unmarshal(c.wyBytes, &wy); err != nil {
		t.Fatalf("parse Wycheproof corpus: %v", err)
	}
	var nist struct {
		TestGroup struct {
			TgID               int    `json:"tgId"`
			ParameterSet       string `json:"parameterSet"`
			SignatureInterface string `json:"signatureInterface"`
			PreHash            string `json:"preHash"`
			Tests              []struct {
				TcID       int    `json:"tcId"`
				TestPassed bool   `json:"testPassed"`
				Pk         string `json:"pk"`
				Message    string `json:"message"`
				Context    string `json:"context"`
				Signature  string `json:"signature"`
			} `json:"tests"`
		} `json:"testGroup"`
	}
	if err := json.Unmarshal(c.nistBytes, &nist); err != nil {
		t.Fatalf("parse NIST tg3 corpus: %v", err)
	}
	c.wyAlgorithm, c.wyNumberOfTests = wy.Algorithm, wy.NumberOfTests
	for _, g := range wy.TestGroups {
		for _, tc := range g.Tests {
			if tc.Ctx != nil && *tc.Ctx != "" {
				c.excludedWy = append(c.excludedWy, tc.TcID)
				continue
			}
			c.cases = append(c.cases, mlDsa65VectorCase{"wycheproof", tc.TcID, g.PublicKey, tc.Msg, tc.Sig, tc.Result == "valid"})
		}
	}
	g := nist.TestGroup
	c.tgID, c.parameterSet, c.iface, c.mode, c.nistTests = g.TgID, g.ParameterSet, g.SignatureInterface, g.PreHash, len(g.Tests)
	for _, tc := range g.Tests {
		if tc.Context != "" {
			c.excludedNist = append(c.excludedNist, tc.TcID)
			continue
		}
		c.cases = append(c.cases, mlDsa65VectorCase{"nist", tc.TcID, tc.Pk, tc.Message, tc.Signature, tc.TestPassed})
	}
	return c
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestMlDsa65VectorCorpusIntegrity(t *testing.T) {
	c := loadMlDsa65Corpus(t)
	if h := sha256.Sum256(c.wyBytes); hex.EncodeToString(h[:]) != "1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034" {
		t.Errorf("Wycheproof corpus sha256 = %x", h)
	}
	if h := sha256.Sum256(c.nistBytes); hex.EncodeToString(h[:]) != "bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8" {
		t.Errorf("NIST tg3 corpus sha256 = %x", h)
	}
	if c.wyAlgorithm != "ML-DSA-65" || c.wyNumberOfTests != 210 {
		t.Errorf("Wycheproof header = %s/%d", c.wyAlgorithm, c.wyNumberOfTests)
	}
	if c.tgID != 3 || c.parameterSet != "ML-DSA-65" || c.iface != "external" || c.mode != "pure" || c.nistTests != 15 {
		t.Errorf("NIST group = %d/%s/%s/%s/%d", c.tgID, c.parameterSet, c.iface, c.mode, c.nistTests)
	}
	valid, nistIDs := 0, []int{}
	for _, tc := range c.cases {
		if tc.valid {
			valid++
		}
		if tc.source == "nist" {
			nistIDs = append(nistIDs, tc.id)
		}
	}
	if len(c.cases) != 204 || valid != 77 {
		t.Errorf("applicable cases = %d (valid %d), want 204 (77)", len(c.cases), valid)
	}
	if !equalInts(c.excludedWy, []int{3, 4, 5, 153, 154, 155, 156}) {
		t.Errorf("Wycheproof exclusions = %v", c.excludedWy)
	}
	if !equalInts(c.excludedNist, []int{31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45}) {
		t.Errorf("NIST exclusions = %v", c.excludedNist)
	}
	if !equalInts(nistIDs, []int{39}) {
		t.Errorf("NIST applicable = %v", nistIDs)
	}
}

func TestMlDsa65VectorProviderIsSDKProvider(t *testing.T) {
	if _, ok := mlDsa65VectorProvider.(*providers.MlDsa65Provider); !ok {
		t.Fatalf("vector provider is %T, want *providers.MlDsa65Provider", mlDsa65VectorProvider)
	}
}

func TestMlDsa65VectorVerdicts(t *testing.T) {
	c := loadMlDsa65Corpus(t)
	executed, errored := 0, []int{}
	for _, tc := range c.cases {
		msg, err1 := hex.DecodeString(tc.msg)
		sig, err2 := hex.DecodeString(tc.sig)
		pk, err3 := hex.DecodeString(tc.pk)
		if err1 != nil || err2 != nil || err3 != nil {
			t.Fatalf("%s %d: hex decode", tc.source, tc.id)
		}
		got, err := mlDsa65VectorProvider.Verify(msg, sig, base64.StdEncoding.EncodeToString(pk))
		executed++
		if err != nil {
			// An error is a rejection only for the Wycheproof cases whose public
			// key is not 1952 bytes, and only with the expected length error.
			if tc.valid || tc.source != "wycheproof" || !mlDsa65PkLengthIDs[tc.id] || len(pk) == 1952 ||
				err.Error() != mlDsa65PkLengthError {
				t.Errorf("%s %d: unexpected error %v", tc.source, tc.id, err)
			}
			errored = append(errored, tc.id)
			continue
		}
		if got != tc.valid {
			t.Errorf("%s %d: %v -> %v", tc.source, tc.id, tc.valid, got)
		}
	}
	t.Logf("executed %d, rejected by error %v", executed, errored)
	if !equalInts(errored, []int{69, 70, 158, 159}) {
		t.Errorf("rejected by error %v, want [69 70 158 159]", errored)
	}
	if executed != 204 {
		t.Fatalf("executed %d cases, want 204", executed)
	}
}
