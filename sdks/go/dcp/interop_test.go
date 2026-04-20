package dcp

import (
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

type testKey struct {
	Kid          string `json:"kid"`
	Alg          string `json:"alg"`
	PublicKeyB64 string `json:"public_key_b64"`
}

type kidDerivEntry struct {
	Alg          string `json:"alg"`
	PublicKeyB64 string `json:"public_key_b64"`
	ExpectedKid  string `json:"expected_kid"`
}

type canonEntry struct {
	Input             interface{} `json:"input"`
	ExpectedCanonical string      `json:"expected_canonical"`
}

type hashEntry struct {
	SHA256  string `json:"sha256"`
	SHA3256 string `json:"sha3_256"`
}

type domainSepAllCtx struct {
	PayloadCanonical string            `json:"payload_canonical"`
	DsmHex           map[string]string `json:"dsm_hex"`
}

type sigEntry struct {
	Context    string `json:"context"`
	PayloadKey string `json:"payload_key"`
	SignerKid  string `json:"signer_kid"`
	SigB64     string `json:"sig_b64"`
}

type compositeSigEntry struct {
	Context      string                `json:"context"`
	PayloadKey   string                `json:"payload_key"`
	CompositeSig v2.CompositeSignature `json:"composite_sig"`
}

type attackVectorStd struct {
	Context      string                `json:"context"`
	PayloadKey   string                `json:"payload_key"`
	CompositeSig v2.CompositeSignature `json:"composite_sig"`
}

type attackVectorCrossCtx struct {
	SignContext   string                `json:"sign_context"`
	VerifyContext string               `json:"verify_context"`
	PayloadKey   string                `json:"payload_key"`
	CompositeSig v2.CompositeSignature `json:"composite_sig"`
}

type sessionArtifact struct {
	Nonce             string                 `json:"nonce"`
	Passport          map[string]interface{} `json:"passport,omitempty"`
	Intent            map[string]interface{} `json:"intent,omitempty"`
	PassportCanonical string                 `json:"passport_canonical,omitempty"`
	IntentCanonical   string                 `json:"intent_canonical,omitempty"`
	PassportCompSig   v2.CompositeSignature  `json:"passport_composite_sig,omitempty"`
	IntentCompSig     v2.CompositeSignature  `json:"intent_composite_sig,omitempty"`
}

type sessionSplicingData struct {
	SessionA sessionArtifact `json:"session_a"`
	SessionB sessionArtifact `json:"session_b"`
}

type interopVectors struct {
	TestKeys                map[string]testKey           `json:"test_keys"`
	KidDerivation           map[string]kidDerivEntry     `json:"kid_derivation"`
	Canonicalization        map[string]canonEntry        `json:"canonicalization"`
	PayloadHashes           map[string]hashEntry         `json:"payload_hashes"`
	DomainSepMsgs           map[string]string            `json:"domain_separated_messages"`
	DomainSepAllCtx         domainSepAllCtx              `json:"domain_separation_all_contexts"`
	Ed25519Signatures       map[string]sigEntry          `json:"ed25519_signatures"`
	CompositeSignatures     map[string]compositeSigEntry `json:"composite_signatures"`
	ClassicalOnlySignatures map[string]compositeSigEntry `json:"classical_only_signatures"`
	AttackVectors           map[string]json.RawMessage   `json:"attack_vectors"`
	SessionSplicing         sessionSplicingData          `json:"session_splicing"`
}

func loadVectors(t *testing.T) *interopVectors {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	vecPath := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "interop_vectors.json")
	data, err := os.ReadFile(vecPath)
	if err != nil {
		t.Fatalf("read interop vectors: %v", err)
	}
	var vecs interopVectors
	if err := json.Unmarshal(data, &vecs); err != nil {
		t.Fatalf("parse interop vectors: %v", err)
	}
	return &vecs
}

func newRegistry() *v2.AlgorithmRegistry {
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	return reg
}

func parseAV(t *testing.T, raw json.RawMessage) attackVectorStd {
	t.Helper()
	var av attackVectorStd
	if err := json.Unmarshal(raw, &av); err != nil {
		t.Fatalf("parse attack vector: %v", err)
	}
	return av
}

func parseCrossCtxAV(t *testing.T, raw json.RawMessage) attackVectorCrossCtx {
	t.Helper()
	var av attackVectorCrossCtx
	if err := json.Unmarshal(raw, &av); err != nil {
		t.Fatalf("parse cross-ctx attack vector: %v", err)
	}
	return av
}

// ---------------------------------------------------------------------------
// 1. Kid Derivation
// ---------------------------------------------------------------------------

func TestInteropKidDerivation(t *testing.T) {
	vecs := loadVectors(t)
	for name, kd := range vecs.KidDerivation {
		t.Run(name, func(t *testing.T) {
			pkBytes, err := base64.StdEncoding.DecodeString(kd.PublicKeyB64)
			if err != nil {
				t.Fatalf("decode pk: %v", err)
			}
			kid := v2.DeriveKid(kd.Alg, pkBytes)
			if kid != kd.ExpectedKid {
				t.Errorf("kid mismatch: got %s, want %s", kid, kd.ExpectedKid)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 2. Canonicalization
// ---------------------------------------------------------------------------

func TestInteropCanonicalization(t *testing.T) {
	vecs := loadVectors(t)
	for name, entry := range vecs.Canonicalization {
		t.Run(name, func(t *testing.T) {
			canonical, err := v2.CanonicalizeV2(entry.Input)
			if err != nil {
				t.Fatalf("canonicalize: %v", err)
			}
			if canonical != entry.ExpectedCanonical {
				t.Errorf("canonical mismatch:\n  got:  %s\n  want: %s", canonical, entry.ExpectedCanonical)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 3. Payload Hashes
// ---------------------------------------------------------------------------

func TestInteropPayloadHashes(t *testing.T) {
	vecs := loadVectors(t)
	for name, entry := range vecs.Canonicalization {
		hashes := vecs.PayloadHashes[name]
		t.Run(name+"_sha256", func(t *testing.T) {
			computed := v2.SHA256Hex([]byte(entry.ExpectedCanonical))
			if computed != hashes.SHA256 {
				t.Errorf("sha256 mismatch: got %s, want %s", computed, hashes.SHA256)
			}
		})
		t.Run(name+"_sha3_256", func(t *testing.T) {
			computed := v2.SHA3256Hex([]byte(entry.ExpectedCanonical))
			if computed != hashes.SHA3256 {
				t.Errorf("sha3-256 mismatch: got %s, want %s", computed, hashes.SHA3256)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 4. Domain-Separated Messages
// ---------------------------------------------------------------------------

func TestInteropDomainSeparation(t *testing.T) {
	vecs := loadVectors(t)
	payloadBytes := []byte(vecs.DomainSepAllCtx.PayloadCanonical)
	ctxMap := map[string]string{
		"AgentPassport":           v2.CtxAgentPassport,
		"ResponsiblePrincipal":            v2.CtxResponsiblePrincipal,
		"Intent":                  v2.CtxIntent,
		"PolicyDecision":          v2.CtxPolicyDecision,
		"AuditEvent":              v2.CtxAuditEvent,
		"Bundle":                  v2.CtxBundle,
		"Revocation":              v2.CtxRevocation,
		"KeyRotation":             v2.CtxKeyRotation,
		"ProofOfPossession":       v2.CtxProofOfPossession,
		"JurisdictionAttestation": v2.CtxJurisdictionAttestation,
		"HumanConfirmation":       v2.CtxHumanConfirmation,
		"MultiPartyAuth":          v2.CtxMultiPartyAuth,
		"Lifecycle":               v2.CtxLifecycle,
		"Succession":              v2.CtxSuccession,
		"Dispute":                 v2.CtxDispute,
		"Rights":                  v2.CtxRights,
		"Delegation":              v2.CtxDelegation,
		"Awareness":               v2.CtxAwareness,
	}
	seen := map[string]bool{}
	for name, ctx := range ctxMap {
		dsm, err := v2.DomainSeparatedMessage(ctx, payloadBytes)
		if err != nil {
			t.Fatalf("dsm for %s: %v", name, err)
		}
		hexVal := hex.EncodeToString(dsm)
		expected, ok := vecs.DomainSepAllCtx.DsmHex[name]
		if !ok {
			t.Errorf("missing DSM vector for %s", name)
			continue
		}
		if hexVal != expected {
			t.Errorf("DSM mismatch for %s", name)
		}
		seen[hexVal] = true
	}
	if len(seen) != len(ctxMap) {
		t.Errorf("DSMs not all distinct: %d unique of %d", len(seen), len(ctxMap))
	}
}

// ---------------------------------------------------------------------------
// 5. Ed25519 Signature Verification
// ---------------------------------------------------------------------------

func TestInteropEd25519Signatures(t *testing.T) {
	vecs := loadVectors(t)
	ed := &providers.Ed25519Provider{}
	for sigName, entry := range vecs.Ed25519Signatures {
		t.Run(sigName, func(t *testing.T) {
			canonical := vecs.Canonicalization[entry.PayloadKey].ExpectedCanonical
			dsm, err := v2.DomainSeparatedMessage(entry.Context, []byte(canonical))
			if err != nil {
				t.Fatalf("dsm: %v", err)
			}
			sigBytes, err := base64.StdEncoding.DecodeString(entry.SigB64)
			if err != nil {
				t.Fatalf("decode sig: %v", err)
			}
			valid, err := ed.Verify(dsm, sigBytes, vecs.TestKeys["ed25519"].PublicKeyB64)
			if err != nil {
				t.Fatalf("verify: %v", err)
			}
			if !valid {
				t.Error("expected valid Ed25519 signature")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 6. Composite Signature Verification
// ---------------------------------------------------------------------------

func TestInteropCompositeSignatures(t *testing.T) {
	vecs := loadVectors(t)
	reg := newRegistry()
	for compName, entry := range vecs.CompositeSignatures {
		t.Run(compName, func(t *testing.T) {
			canonical := vecs.Canonicalization[entry.PayloadKey].ExpectedCanonical
			result, err := v2.CompositeVerify(
				reg, entry.Context, []byte(canonical), &entry.CompositeSig,
				vecs.TestKeys["ed25519"].PublicKeyB64,
				vecs.TestKeys["ml_dsa_65"].PublicKeyB64,
			)
			if err != nil {
				t.Fatalf("verify: %v", err)
			}
			if !result.Valid {
				t.Error("expected valid composite signature")
			}
			if !result.ClassicalValid {
				t.Error("expected classical valid")
			}
			if !result.PQValid {
				t.Error("expected PQ valid")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 7. Classical-Only Signature Verification
// ---------------------------------------------------------------------------

func TestInteropClassicalOnly(t *testing.T) {
	vecs := loadVectors(t)
	reg := newRegistry()
	for name, entry := range vecs.ClassicalOnlySignatures {
		t.Run(name, func(t *testing.T) {
			canonical := vecs.Canonicalization[entry.PayloadKey].ExpectedCanonical
			result, err := v2.CompositeVerify(
				reg, entry.Context, []byte(canonical), &entry.CompositeSig,
				vecs.TestKeys["ed25519"].PublicKeyB64, "",
			)
			if err != nil {
				t.Fatalf("verify: %v", err)
			}
			if !result.Valid || !result.ClassicalValid {
				t.Error("expected valid classical-only sig")
			}
			if result.PQValid {
				t.Error("expected PQ false for classical_only")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 8. Stripping Attack Resistance
// ---------------------------------------------------------------------------

func TestInteropStrippingPQRemoval(t *testing.T) {
	vecs := loadVectors(t)
	reg := newRegistry()
	av := parseAV(t, vecs.AttackVectors["stripping_pq_removal"])
	canonical := vecs.Canonicalization[av.PayloadKey].ExpectedCanonical
	result, err := v2.CompositeVerify(
		reg, av.Context, []byte(canonical), &av.CompositeSig,
		vecs.TestKeys["ed25519"].PublicKeyB64, vecs.TestKeys["ml_dsa_65"].PublicKeyB64,
	)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if result.Valid {
		t.Error("stripped PQ should fail")
	}
}

func TestInteropStrippingWithDowngrade(t *testing.T) {
	vecs := loadVectors(t)
	reg := newRegistry()
	av := parseAV(t, vecs.AttackVectors["stripping_pq_with_downgrade"])
	canonical := vecs.Canonicalization[av.PayloadKey].ExpectedCanonical
	result, err := v2.CompositeVerify(
		reg, av.Context, []byte(canonical), &av.CompositeSig,
		vecs.TestKeys["ed25519"].PublicKeyB64, "",
	)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !result.ClassicalValid {
		t.Error("classical should still verify")
	}
	if result.PQValid {
		t.Error("PQ should be invalid")
	}
}

func TestInteropTamperedClassical(t *testing.T) {
	vecs := loadVectors(t)
	reg := newRegistry()
	av := parseAV(t, vecs.AttackVectors["tampered_classical_sig"])
	canonical := vecs.Canonicalization[av.PayloadKey].ExpectedCanonical
	result, err := v2.CompositeVerify(
		reg, av.Context, []byte(canonical), &av.CompositeSig,
		vecs.TestKeys["ed25519"].PublicKeyB64, vecs.TestKeys["ml_dsa_65"].PublicKeyB64,
	)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if result.Valid || result.ClassicalValid {
		t.Error("tampered classical should fail")
	}
}

func TestInteropTamperedPQ(t *testing.T) {
	vecs := loadVectors(t)
	reg := newRegistry()
	av := parseAV(t, vecs.AttackVectors["tampered_pq_sig"])
	canonical := vecs.Canonicalization[av.PayloadKey].ExpectedCanonical
	result, err := v2.CompositeVerify(
		reg, av.Context, []byte(canonical), &av.CompositeSig,
		vecs.TestKeys["ed25519"].PublicKeyB64, vecs.TestKeys["ml_dsa_65"].PublicKeyB64,
	)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if result.Valid || result.PQValid {
		t.Error("tampered PQ should fail")
	}
}

// ---------------------------------------------------------------------------
// 9. Cross-Context Replay
// ---------------------------------------------------------------------------

func TestInteropCrossContextReplay(t *testing.T) {
	vecs := loadVectors(t)
	reg := newRegistry()
	av := parseCrossCtxAV(t, vecs.AttackVectors["cross_context_replay"])
	canonical := vecs.Canonicalization[av.PayloadKey].ExpectedCanonical

	t.Run("wrong_context_fails", func(t *testing.T) {
		result, err := v2.CompositeVerify(
			reg, av.VerifyContext, []byte(canonical), &av.CompositeSig,
			vecs.TestKeys["ed25519"].PublicKeyB64, vecs.TestKeys["ml_dsa_65"].PublicKeyB64,
		)
		if err != nil {
			t.Fatalf("verify: %v", err)
		}
		if result.Valid {
			t.Error("cross-context replay should fail")
		}
	})

	t.Run("correct_context_passes", func(t *testing.T) {
		result, err := v2.CompositeVerify(
			reg, av.SignContext, []byte(canonical), &av.CompositeSig,
			vecs.TestKeys["ed25519"].PublicKeyB64, vecs.TestKeys["ml_dsa_65"].PublicKeyB64,
		)
		if err != nil {
			t.Fatalf("verify: %v", err)
		}
		if !result.Valid {
			t.Error("correct context should pass")
		}
	})
}

// ---------------------------------------------------------------------------
// 10. Session Splicing
// ---------------------------------------------------------------------------

func TestInteropSessionSplicing(t *testing.T) {
	vecs := loadVectors(t)
	reg := newRegistry()
	sa := vecs.SessionSplicing.SessionA
	sb := vecs.SessionSplicing.SessionB

	t.Run("nonces_differ", func(t *testing.T) {
		if sa.Nonce == sb.Nonce {
			t.Error("session nonces must differ")
		}
	})

	t.Run("passport_a_verifies", func(t *testing.T) {
		result, err := v2.CompositeVerify(
			reg, v2.CtxAgentPassport, []byte(sa.PassportCanonical), &sa.PassportCompSig,
			vecs.TestKeys["ed25519"].PublicKeyB64, vecs.TestKeys["ml_dsa_65"].PublicKeyB64,
		)
		if err != nil {
			t.Fatalf("verify: %v", err)
		}
		if !result.Valid {
			t.Error("passport A should verify")
		}
	})

	t.Run("intent_b_verifies", func(t *testing.T) {
		result, err := v2.CompositeVerify(
			reg, v2.CtxIntent, []byte(sb.IntentCanonical), &sb.IntentCompSig,
			vecs.TestKeys["ed25519"].PublicKeyB64, vecs.TestKeys["ml_dsa_65"].PublicKeyB64,
		)
		if err != nil {
			t.Fatalf("verify: %v", err)
		}
		if !result.Valid {
			t.Error("intent B should verify")
		}
	})

	t.Run("nonce_mismatch_detected", func(t *testing.T) {
		pNonce, _ := sa.Passport["session_nonce"].(string)
		iNonce, _ := sb.Intent["session_nonce"].(string)
		if pNonce == iNonce {
			t.Error("must detect nonce mismatch across sessions")
		}
	})
}
