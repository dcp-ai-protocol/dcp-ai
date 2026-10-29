package v2_test

// VerifyPayloadHash accepts exactly the normative payload_hash, "sha256:" followed by the lowercase hex SHA-256
// of the dcp-jcs-v1 bytes (schemas/v2/signed_payload.schema.json), as SignPayload writes it. A bare digest,
// which the helper accepted before, is a mismatch. PreparePayload keeps returning the bare digest. The helper
// checks hash consistency only, never the signature.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func spRegistry() *v2.AlgorithmRegistry {
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	return reg
}

func spKey(t *testing.T, p v2.CryptoProvider, alg string) v2.CompositeKeyInfo {
	t.Helper()
	k, err := p.GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	return v2.CompositeKeyInfo{Kid: k.Kid, Alg: alg, SecretKeyB64: k.SecretKeyB64, PublicKeyB64: k.PublicKeyB64}
}

func spPayload() map[string]interface{} {
	return map[string]interface{}{"intent_id": "intent:payload-hash", "risk_score": 7, "target": map[string]interface{}{"channel": "api"}}
}

func spSigned(t *testing.T) v2.SignedPayload {
	t.Helper()
	sp, err := v2.SignPayload(spRegistry(), v2.CtxIntent, spPayload(), spKey(t, &providers.Ed25519Provider{}, "ed25519"), nil)
	if err != nil {
		t.Fatal(err)
	}
	return sp
}

func spVerify(t *testing.T, sp *v2.SignedPayload) bool {
	t.Helper()
	ok, err := v2.VerifyPayloadHash(sp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	return ok
}

func TestVerifyPayloadHashAcceptsSignPayloadOutput(t *testing.T) {
	reg := spRegistry()
	classical := spKey(t, &providers.Ed25519Provider{}, "ed25519")
	pq := spKey(t, &providers.MlDsa65Provider{}, "ml-dsa-65")
	for _, c := range []struct {
		name string
		pq   *v2.CompositeKeyInfo
	}{{"classical_only", nil}, {"hybrid", &pq}} {
		t.Run(c.name, func(t *testing.T) {
			sp, err := v2.SignPayload(reg, v2.CtxIntent, spPayload(), classical, c.pq)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(sp.PayloadHash, "sha256:") {
				t.Fatalf("SignPayload wrote %q", sp.PayloadHash)
			}
			canonical, _, err := v2.PreparePayload(sp.Payload)
			if err != nil {
				t.Fatal(err)
			}
			pqPub := ""
			if c.pq != nil {
				pqPub = c.pq.PublicKeyB64
			}
			r, err := v2.CompositeVerify(reg, v2.CtxIntent, canonical, &sp.CompositeSig, classical.PublicKeyB64, pqPub)
			if err != nil || !r.Valid {
				t.Fatalf("the positive must carry a real valid signature: %+v, %v", r, err)
			}
			if !spVerify(t, &sp) {
				t.Fatal("SignPayload output must verify")
			}
		})
	}
}

// Hash consistency says nothing about the signature: a broken signature leaves the hash consistent.
func TestVerifyPayloadHashIgnoresTheSignature(t *testing.T) {
	sp := spSigned(t)
	sp.CompositeSig.Classical.SigB64 = "AAAA"
	if !spVerify(t, &sp) {
		t.Fatal("the payload hash is still consistent")
	}
}

func TestVerifyPayloadHashAcceptsCommittedArtifacts(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "interop", "v2", "bundle_vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		SignedBundle struct {
			Bundle map[string]json.RawMessage `json:"bundle"`
		} `json:"signed_bundle"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"responsible_principal_record", "agent_passport", "intent", "policy_decision"} {
		t.Run(name, func(t *testing.T) {
			var sp v2.SignedPayload
			if err := json.Unmarshal(vectors.SignedBundle.Bundle[name], &sp); err != nil {
				t.Fatal(err)
			}
			if !spVerify(t, &sp) {
				t.Fatalf("committed %s (payload_hash %s) must verify", name, sp.PayloadHash)
			}
		})
	}
}

func TestVerifyPayloadHashRejectsEveryOtherValue(t *testing.T) {
	sp := spSigned(t)
	hex := strings.TrimPrefix(sp.PayloadHash, "sha256:")
	other := v2.SHA256Hex([]byte("another payload"))
	mixed := strings.ToUpper(hex[:1]) + hex[1:]
	if mixed == hex {
		mixed = hex[:63] + strings.ToUpper(hex[63:])
	}
	for name, value := range map[string]string{
		"bare digest (accepted before)": hex,
		"uppercase prefix":              "SHA256:" + hex,
		"another algorithm":             "sha3-256:" + hex,
		"double prefix":                 "sha256:sha256:" + hex,
		"uppercase hex":                 "sha256:" + strings.ToUpper(hex),
		"mixed-case hex":                "sha256:" + mixed,
		"space after the colon":         "sha256: " + hex,
		"leading space":                 " sha256:" + hex,
		"trailing space":                "sha256:" + hex + " ",
		"trailing newline":              "sha256:" + hex + "\n",
		"one byte too long":             "sha256:" + hex + "00",
		"twice the digest":              "sha256:" + hex + hex,
		"one byte too short":            "sha256:" + hex[:62],
		"prefix only":                   "sha256:",
		"not hex":                       "sha256:" + strings.Repeat("z", 64),
		"another digest":                "sha256:" + other,
		"empty":                         "",
	} {
		t.Run(name, func(t *testing.T) {
			c := sp
			c.PayloadHash = value
			if spVerify(t, &c) {
				t.Fatalf("%q must not verify", value)
			}
		})
	}
	t.Run("tampered payload", func(t *testing.T) {
		c := sp
		p := spPayload()
		p["risk_score"] = 8
		c.Payload = p
		if spVerify(t, &c) {
			t.Fatal("a changed payload must not verify")
		}
	})
}

func TestVerifyPayloadHashErrors(t *testing.T) {
	if ok, err := v2.VerifyPayloadHash(nil); ok || err == nil || err.Error() != "nil signed payload" {
		t.Fatalf("nil: %v, %v", ok, err)
	}
	sp := spSigned(t)
	sp.Payload = map[string]interface{}{"fraction": 1.5}
	ok, err := v2.VerifyPayloadHash(&sp)
	if ok || err == nil || !strings.HasPrefix(err.Error(), "canonicalize payload: ") || !strings.Contains(err.Error(), "non-integer") {
		t.Fatalf("fraction: %v, %v", ok, err)
	}
}

func TestPreparePayloadStaysBare(t *testing.T) {
	sp := spSigned(t)
	canonical, hash, err := v2.PreparePayload(spPayload())
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(hash) {
		t.Fatalf("PreparePayload must keep returning the bare lowercase digest, got %q", hash)
	}
	if "sha256:"+hash != sp.PayloadHash || hash != v2.SHA256Hex(canonical) {
		t.Fatalf("payload_hash is \"sha256:\" + the PreparePayload digest: %q vs %q", hash, sp.PayloadHash)
	}
}
