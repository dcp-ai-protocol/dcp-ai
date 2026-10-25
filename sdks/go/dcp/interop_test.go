package dcp

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

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

type blindedRPRVectors struct {
	Vectors []struct {
		Name          string                 `json:"name"`
		RPR           map[string]interface{} `json:"rpr"`
		PIIHash       string                 `json:"pii_hash"`
		LegacyPIIHash string                 `json:"legacy_pii_hash"`
		Blinded       map[string]interface{} `json:"blinded"`
	} `json:"vectors"`
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

type securityTierCase struct {
	Name           string                 `json:"name"`
	Intent         map[string]interface{} `json:"intent"`
	PolicyDecision map[string]interface{} `json:"policy_decision"`
	Expected       v2.SecurityTierResult  `json:"expected"`
}

type interopVectors struct {
	TestKeys                map[string]testKey           `json:"test_keys"`
	KidDerivation           map[string]kidDerivEntry     `json:"kid_derivation"`
	Canonicalization        map[string]canonEntry        `json:"canonicalization"`
	PayloadHashes           map[string]hashEntry         `json:"payload_hashes"`
	BlindedRPR              blindedRPRVectors            `json:"blinded_rpr"`
	DomainSepMsgs           map[string]string            `json:"domain_separated_messages"`
	DomainSepAllCtx         domainSepAllCtx              `json:"domain_separation_all_contexts"`
	Ed25519Signatures       map[string]sigEntry          `json:"ed25519_signatures"`
	CompositeSignatures     map[string]compositeSigEntry `json:"composite_signatures"`
	ClassicalOnlySignatures map[string]compositeSigEntry `json:"classical_only_signatures"`
	AttackVectors           map[string]json.RawMessage   `json:"attack_vectors"`
	SessionSplicing         sessionSplicingData          `json:"session_splicing"`
	SecurityTier            struct {
		Cases         []securityTierCase `json:"cases"`
		EffectiveMode struct {
			Cases []struct {
				PolicyMode string `json:"policy_mode"`
				Tier       string `json:"tier"`
				Expected   string `json:"expected"`
			} `json:"cases"`
		} `json:"effective_mode"`
	} `json:"security_tier"`
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
		// edge_cases is a separate block exercised by TestCanonicalizationEdgeCases.
		if entry.ExpectedCanonical == "" {
			continue
		}
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
		// Skip the edge_cases sub-block (no precomputed payload hashes).
		if entry.ExpectedCanonical == "" {
			continue
		}
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

func TestInteropBlindedRPR(t *testing.T) {
	vecs := loadVectors(t)
	if len(vecs.BlindedRPR.Vectors) == 0 {
		t.Fatal("no blinded_rpr vectors found")
	}
	for _, vec := range vecs.BlindedRPR.Vectors {
		t.Run(vec.Name, func(t *testing.T) {
			if got, err := v2.ComputePIIHash(vec.RPR); err != nil || got != vec.PIIHash {
				t.Errorf("salted pii_hash: got %s (%v), want %s", got, err, vec.PIIHash)
			}
			legacy := map[string]interface{}{}
			for k, v := range vec.RPR {
				if k != "pii_salt" {
					legacy[k] = v
				}
			}
			if got, err := v2.ComputePIIHash(legacy); err != nil || got != vec.LegacyPIIHash {
				t.Errorf("legacy pii_hash: got %s (%v), want %s", got, err, vec.LegacyPIIHash)
			}
			blinded, err := v2.BlindRPR(vec.RPR)
			if err != nil {
				t.Fatalf("BlindRPR: %v", err)
			}
			got, _ := v2.CanonicalizeV2(blinded)
			want, _ := v2.CanonicalizeV2(vec.Blinded)
			if got != want {
				t.Errorf("blinded RPR:\n  got:  %s\n  want: %s", got, want)
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
		"SubMandate":              v2.CtxSubMandate,
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

// ---------------------------------------------------------------------------
// 11. Security Tier (spec §14.2)
// ---------------------------------------------------------------------------

func TestInteropSecurityTier(t *testing.T) {
	cases := loadVectors(t).SecurityTier.Cases
	if len(cases) == 0 {
		t.Fatal("no security_tier vectors found")
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			got := v2.ComputeSecurityTier(v2.SecurityTierInputFromPayloads(c.Intent, c.PolicyDecision))
			if got != c.Expected {
				t.Fatalf("got %+v, want %+v", got, c.Expected)
			}
		})
	}
}

// TestCanonicalizationEdgeCases verifies that the Go canonicalizer matches
// the dcp-jcs-v1 profile fixtures shipped in the shared interop_vectors.json.
// All four core SDKs (TS, Python, Rust, Go) must agree byte-for-byte on the
// `canonical` output and on the rejection of the `expects_error` cases.
func TestCanonicalizationEdgeCases(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	vecPath := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "interop_vectors.json")
	data, err := os.ReadFile(vecPath)
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var top map[string]interface{}
	if err := json.Unmarshal(data, &top); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	canon, _ := top["canonicalization"].(map[string]interface{})
	edge, _ := canon["edge_cases"].(map[string]interface{})
	vectors, _ := edge["vectors"].([]interface{})
	if len(vectors) == 0 {
		t.Fatal("no edge_case vectors found")
	}
	for _, v := range vectors {
		vec, _ := v.(map[string]interface{})
		name, _ := vec["name"].(string)
		t.Run(name, func(t *testing.T) {
			var payload interface{}
			if rawJSON, ok := vec["input_json"].(string); ok {
				if err := json.Unmarshal([]byte(rawJSON), &payload); err != nil {
					t.Fatalf("parse input_json: %v", err)
				}
			} else if input, ok := vec["input"]; ok {
				payload = input
			} else {
				t.Fatalf("vector has neither input nor input_json")
			}

			expectErr, _ := vec["expects_error"].(bool)
			got, err := v2.CanonicalizeV2(payload)
			if expectErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			want, _ := vec["canonical"].(string)
			if got != want {
				t.Fatalf("canonical mismatch:\n  got:  %s\n  want: %s", got, want)
			}
		})
	}
}

// TestSignedBundleVectors runs v2.VerifySignedBundleV2WithPolicy over the shared
// bundle_vectors.json under every verification mode: the signed bundle must
// verify, each must_reject case's mutations (VERIFICATION.md V2-7 / V2-8) and
// each must_reject_bundles entry must be rejected with an error naming
// error_contains, each must_accept_bundles entry must verify (both under each
// mode's policy with the case's verifier_policy_overrides fields replaced), and
// the classical-only routine control must get its expected verdict.
func TestSignedBundleVectors(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	vecPath := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "bundle_vectors.json")
	data, err := os.ReadFile(vecPath)
	if err != nil {
		t.Fatalf("read bundle vectors: %v", err)
	}
	var vecs struct {
		SignedBundle json.RawMessage `json:"signed_bundle"`
		MustReject   []struct {
			Name          string `json:"name"`
			ErrorContains string `json:"error_contains"`
			Mutations     []struct {
				Path  []string    `json:"path"`
				Value interface{} `json:"value"`
			} `json:"mutations"`
		} `json:"must_reject"`
		MustAcceptBundles []struct {
			Name                    string                     `json:"name"`
			SignedBundle            json.RawMessage            `json:"signed_bundle"`
			VerifierPolicyOverrides map[string]json.RawMessage `json:"verifier_policy_overrides"`
		} `json:"must_accept_bundles"`
		MustRejectBundles []struct {
			Name                    string                     `json:"name"`
			ErrorContains           string                     `json:"error_contains"`
			SignedBundle            json.RawMessage            `json:"signed_bundle"`
			VerifierPolicyOverrides map[string]json.RawMessage `json:"verifier_policy_overrides"`
		} `json:"must_reject_bundles"`
		Control struct {
			SignedBundle   json.RawMessage `json:"signed_bundle"`
			VerifiedByMode map[string]bool `json:"verified_by_mode"`
		} `json:"classical_only_routine_bundle"`
	}
	if err := json.Unmarshal(data, &vecs); err != nil {
		t.Fatalf("parse bundle vectors: %v", err)
	}
	reg := newRegistry()
	// withOverrides is policy with the overrides' fields replaced; a field that
	// is not a VerifierPolicy field fails the test.
	withOverrides := func(t *testing.T, policy v2.VerifierPolicy, overrides map[string]json.RawMessage) v2.VerifierPolicy {
		t.Helper()
		if len(overrides) == 0 {
			return policy
		}
		raw, err := json.Marshal(policy)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			t.Fatal(err)
		}
		for k, v := range overrides {
			fields[k] = v
		}
		if raw, err = json.Marshal(fields); err != nil {
			t.Fatal(err)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		var merged v2.VerifierPolicy
		if err := dec.Decode(&merged); err != nil {
			t.Fatalf("verifier_policy_overrides: %v", err)
		}
		return merged
	}
	rejects := func(t *testing.T, r *v2.V2VerificationResult, errorContains string) {
		t.Helper()
		if r.Verified {
			t.Fatal("bundle must be rejected")
		}
		if !strings.Contains(strings.ToLower(strings.Join(r.Errors, "\n")), errorContains) {
			t.Fatalf("no error mentions %q: %v", errorContains, r.Errors)
		}
	}

	for _, mode := range []string{"classical_only", "hybrid_preferred", "hybrid_required", "pq_only"} {
		policy := v2.DefaultVerifierPolicy()
		policy.DefaultMode = mode
		policy.RiskOverrides = map[string]string{"low": mode, "medium": mode, "high": mode}
		t.Run(mode, func(t *testing.T) {
			if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, policy); !r.Verified {
				t.Fatalf("signed_bundle must verify: %v", r.Errors)
			}
			for _, m := range vecs.MustReject {
				t.Run(m.Name, func(t *testing.T) {
					var sb map[string]interface{}
					if err := json.Unmarshal(vecs.SignedBundle, &sb); err != nil {
						t.Fatal(err)
					}
					for _, mut := range m.Mutations {
						node := sb
						for _, key := range mut.Path[:len(mut.Path)-1] {
							node = node[key].(map[string]interface{})
						}
						node[mut.Path[len(mut.Path)-1]] = mut.Value
					}
					mutated, err := json.Marshal(sb)
					if err != nil {
						t.Fatal(err)
					}
					rejects(t, v2.VerifySignedBundleV2WithPolicy(reg, mutated, policy), m.ErrorContains)
				})
			}
			for _, b := range vecs.MustAcceptBundles {
				t.Run(b.Name, func(t *testing.T) {
					casePolicy := withOverrides(t, policy, b.VerifierPolicyOverrides)
					if r := v2.VerifySignedBundleV2WithPolicy(reg, b.SignedBundle, casePolicy); !r.Verified {
						t.Fatalf("must verify: %v", r.Errors)
					}
				})
			}
			for _, b := range vecs.MustRejectBundles {
				t.Run(b.Name, func(t *testing.T) {
					casePolicy := withOverrides(t, policy, b.VerifierPolicyOverrides)
					rejects(t, v2.VerifySignedBundleV2WithPolicy(reg, b.SignedBundle, casePolicy), b.ErrorContains)
				})
			}
			r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.Control.SignedBundle, policy)
			if r.Verified != vecs.Control.VerifiedByMode[mode] {
				t.Errorf("classical_only_routine_bundle: verified=%v, want %v (errors %v)", r.Verified, vecs.Control.VerifiedByMode[mode], r.Errors)
			}
		})
	}

	// DefaultVerifierPolicy maps the low-risk passport to classical_only; the
	// result reports the tier and the mode the tier raised it to.
	if r := v2.VerifySignedBundleV2(reg, vecs.Control.SignedBundle); !r.Verified || r.ResolvedTier != "routine" || r.VerificationMode != "classical_only" {
		t.Errorf("control: verified=%v tier=%s mode=%s", r.Verified, r.ResolvedTier, r.VerificationMode)
	}
	if r := v2.VerifySignedBundleV2(reg, vecs.MustRejectBundles[0].SignedBundle); r.Verified || r.ResolvedTier != "elevated" || r.VerificationMode != "hybrid_required" {
		t.Errorf("%s: verified=%v tier=%s mode=%s", vecs.MustRejectBundles[0].Name, r.Verified, r.ResolvedTier, r.VerificationMode)
	}
	unknown := v2.DefaultVerifierPolicy()
	unknown.DefaultMode, unknown.RiskOverrides = "strict", nil
	if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, unknown); r.Verified {
		t.Error("an unknown policy mode must fail closed")
	}
	// The verifier enforces only DefaultMode and RiskOverrides, so another
	// setting must not pass silently.
	tuned := v2.DefaultVerifierPolicy()
	tuned.AcceptedClassicalAlgs = []string{"ed448"}
	if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, tuned); r.Verified {
		t.Error("a policy field the verifier does not enforce must fail closed")
	}
	// The accepted algorithms are enforced, as in the TS verifier: a subset
	// that keeps the bundle's algorithms verifies, one that drops its PQ
	// algorithm does not. AllowV1Bundles false changes nothing for a V2 bundle.
	subset := v2.DefaultVerifierPolicy()
	subset.AcceptedPQAlgs, subset.AllowV1Bundles = []string{"ml-dsa-65"}, false
	if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, subset); !r.Verified {
		t.Errorf("accepted_pq_algs [ml-dsa-65] and allow_v1_bundles false must verify an ML-DSA-65 bundle: %v", r.Errors)
	}
	subset.AcceptedPQAlgs = []string{"slh-dsa-192f"}
	if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, subset); r.Verified || !strings.Contains(strings.Join(r.Errors, "\n"), "PQ algorithm ml-dsa-65 not accepted by verifier policy") {
		t.Errorf("accepted_pq_algs without ml-dsa-65 must reject an ML-DSA-65 signature: %v", r.Errors)
	}
	// MaxSessionDurationSeconds bounds the signed window from session_issued_at
	// to session_expires_at (V2-4), whatever the verification time: a maximum of
	// exactly that duration verifies and one second less does not.
	var signed struct {
		Bundle struct {
			Manifest struct {
				SessionIssuedAt  string `json:"session_issued_at"`
				SessionExpiresAt string `json:"session_expires_at"`
			} `json:"manifest"`
		} `json:"bundle"`
	}
	if err := json.Unmarshal(vecs.SignedBundle, &signed); err != nil {
		t.Fatal(err)
	}
	issued, err1 := time.Parse(time.RFC3339, signed.Bundle.Manifest.SessionIssuedAt)
	expires, err2 := time.Parse(time.RFC3339, signed.Bundle.Manifest.SessionExpiresAt)
	if err1 != nil || err2 != nil {
		t.Fatalf("signed_bundle session window: %v %v", err1, err2)
	}
	bounded := v2.DefaultVerifierPolicy()
	bounded.MaxSessionDurationSeconds = int(expires.Unix() - issued.Unix())
	if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, bounded); !r.Verified {
		t.Errorf("a session of exactly MaxSessionDurationSeconds must verify: %v", r.Errors)
	}
	bounded.MaxSessionDurationSeconds--
	if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, bounded); r.Verified || !strings.Contains(strings.Join(r.Errors, "\n"), "Session duration") {
		t.Errorf("a session longer than MaxSessionDurationSeconds must fail: %v", r.Errors)
	}
}

// TestDefaultVerifierPolicyVector decodes the TypeScript DEFAULT_VERIFIER_POLICY
// strictly: every field, Phase 3 included, must be a VerifierPolicy field. It must
// equal DefaultVerifierPolicy(), and its advisory_rejected_algs is enforced.
func TestDefaultVerifierPolicyVector(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "bundle_vectors.json"))
	if err != nil {
		t.Fatalf("read bundle vectors: %v", err)
	}
	var vecs struct {
		DefaultVerifierPolicy json.RawMessage `json:"default_verifier_policy"`
		SignedBundle          json.RawMessage `json:"signed_bundle"`
	}
	if err := json.Unmarshal(data, &vecs); err != nil {
		t.Fatalf("parse bundle vectors: %v", err)
	}
	decode := func(raw []byte) v2.VerifierPolicy {
		t.Helper()
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		var p v2.VerifierPolicy
		if err := dec.Decode(&p); err != nil {
			t.Fatalf("decode policy: %v", err)
		}
		return p
	}
	reg := newRegistry()

	policy := decode(vecs.DefaultVerifierPolicy)
	if !reflect.DeepEqual(policy, v2.DefaultVerifierPolicy()) {
		t.Fatalf("TS default policy %+v differs from DefaultVerifierPolicy() %+v", policy, v2.DefaultVerifierPolicy())
	}
	if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, policy); !r.Verified {
		t.Fatalf("signed_bundle must verify under the TS default policy: %v", r.Errors)
	}

	var fields map[string]interface{}
	if err := json.Unmarshal(vecs.DefaultVerifierPolicy, &fields); err != nil {
		t.Fatal(err)
	}
	fields["advisory_rejected_algs"] = []string{"ml-dsa-65"}
	raw, _ := json.Marshal(fields)
	r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, decode(raw))
	if r.Verified || !strings.Contains(strings.Join(r.Errors, "\n"), "rejected by active advisory") {
		t.Fatalf("an advisory-rejected algorithm must fail verification: %v", r.Errors)
	}

	// The schema's session and audience fields decode into VerifierPolicy, and
	// the verifier enforces them instead of failing closed on them.
	delete(fields, "advisory_rejected_algs")
	fields["require_session_expiry"] = true
	fields["max_session_duration_seconds"] = 3_000_000_000
	fields["require_audience_binding"] = true
	fields["verifier_id"] = "verifier:acme"
	raw, _ = json.Marshal(fields)
	want := v2.DefaultVerifierPolicy()
	want.AdvisoryRejectedAlgs = nil
	want.RequireSessionExpiry, want.MaxSessionDurationSeconds = true, 3_000_000_000
	want.RequireAudienceBinding, want.VerifierID = true, "verifier:acme"
	if got := decode(raw); !reflect.DeepEqual(got, want) {
		t.Fatalf("decoded %+v, want %+v", got, want)
	} else if r := v2.VerifySignedBundleV2WithPolicy(reg, vecs.SignedBundle, got); r.Verified ||
		strings.Contains(strings.Join(r.Errors, "\n"), "does not enforce") ||
		!strings.Contains(strings.Join(r.Errors, "\n"), "Policy requires audience binding") {
		t.Fatalf("signed_bundle has no intended_verifier: %v", r.Errors)
	}
}

// parseInstant parses an RFC 3339 timestamp string.
func parseInstant(v interface{}) (time.Time, bool) {
	s, _ := v.(string)
	t, err := time.Parse(time.RFC3339, s)
	return t, err == nil
}

// TestSignedBundleHostileShapes: the checks of VERIFICATION.md V2-4, V2-12 and V2-14
// read decoded JSON, so a value of the wrong shape anywhere they look is an
// error, never a panic. Each case changes the must_accept bundle
// pq_checkpoint_over_the_trail at one path.
func TestSignedBundleHostileShapes(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "bundle_vectors.json"))
	if err != nil {
		t.Fatalf("read bundle vectors: %v", err)
	}
	var vecs struct {
		MustAcceptBundles []struct {
			Name         string          `json:"name"`
			SignedBundle json.RawMessage `json:"signed_bundle"`
		} `json:"must_accept_bundles"`
	}
	if err := json.Unmarshal(data, &vecs); err != nil {
		t.Fatalf("parse bundle vectors: %v", err)
	}
	var base json.RawMessage
	for _, b := range vecs.MustAcceptBundles {
		if b.Name == "pq_checkpoint_over_the_trail" {
			base = b.SignedBundle
		}
	}
	if base == nil {
		t.Fatal("no pq_checkpoint_over_the_trail bundle")
	}
	reg := newRegistry()
	if r := v2.VerifySignedBundleV2(reg, base); !r.Verified {
		t.Fatalf("base bundle must verify: %v", r.Errors)
	}

	jsonValue := func(s string) interface{} {
		var v interface{}
		if err := json.Unmarshal([]byte(s), &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct {
		path          string // dot-separated; a number indexes an array
		value         string // JSON
		errorContains string // "" when any error will do
		maxSession    int    // the policy's MaxSessionDurationSeconds
	}{
		{"bundle.manifest.session_issued_at", `5`, "session_issued_at", 0},
		{"bundle.manifest.session_issued_at", `{"t": [1]}`, "session_issued_at", 0},
		{"bundle.manifest.session_issued_at", `"2026-10-21"`, "session_issued_at", 0},
		{"bundle.manifest.session_issued_at", `"2100-01-01T00:00:00Z"`, "session_issued_at", 0},
		{"bundle.manifest.session_issued_at", `null`, "session_issued_at", 3600},
		{"bundle.manifest.session_issued_at", `["2026-10-21T00:00:00Z"]`, "session_issued_at", 3600},
		{"bundle.manifest.session_expires_at", `{"t": 1}`, "session_expires_at", 3600},
		{"signature.signer", `"human:interop-principal"`, "signer id", 0},
		{"signature.signer", `null`, "signer kids", 0},
		{"signature.signer.id", `{"id": [1]}`, "signer id", 0},
		{"signature.signer.kids", `"kids"`, "signer kids", 0},
		{"signature.signer.kids", `[1, {"a": 2}]`, "signer kids", 0},
		{"signature.signer.kids", `[]`, "signer kids", 0},
		{"signature.composite_sig.pq", `null`, "signer kids", 0},
		{"signature.composite_sig.classical", `[]`, "signer kids", 0},
		{"bundle.audit_entries.0.policy_decision", `["approved"]`, "audit_entries[0] policy_decision", 0},
		{"bundle.audit_entries.0.policy_decision", `null`, "audit_entries[0] policy_decision", 0},
		{"bundle.policy_decision.payload.decision", `["approve"]`, "audit_entries[0] policy_decision", 0},
		{"bundle.policy_decision.payload.decision", `"constructor"`, "audit_entries[0] policy_decision", 0},
		{"bundle.manifest.session_expires_at", `null`, "requires session_expires_at", 3600},
		{"signature.manifest_hash", `null`, "manifest_hash", 0},
		{"signature.manifest_hash", `{"sha256": 1}`, "manifest_hash", 0},
		{"signature.hash_alg", `["sha256"]`, "hash_alg", 0},
		{"signature.hash_alg", `"SHA256"`, "hash_alg", 0},
		{"bundle.agent_passport.payload.keys.0.public_key_b64", `7`, "canonical base64", 0},
		{"bundle.agent_passport.payload.keys.0.public_key_b64", `null`, "canonical base64", 0},
		{"bundle.responsible_principal_record.payload.binding_keys.1.public_key_b64", `"QUFB\nQUFB"`, "canonical base64", 0},
		{"bundle.responsible_principal_record.payload.session_nonce", `null`, "nonce", 0},
		{"bundle.intent.payload.session_nonce", `["nonce"]`, "nonce", 0},
		{"bundle.audit_entries.1.session_nonce", `{"n": 1}`, "nonce", 0},
		{"bundle.pq_checkpoints.0.session_nonce", `null`, "nonce", 0},
		{"signature.composite_sig.classical.sig_b64", `"AAAA\nAAAA"`, "classical sig_b64 is not canonical base64", 0},
		{"signature.composite_sig.classical.sig_b64", `"AB=="`, "classical sig_b64 is not canonical base64", 0},
		{"signature.composite_sig.classical.sig_b64", `"-_8="`, "classical sig_b64 is not canonical base64", 0},
		{"signature.composite_sig.classical.sig_b64", `5`, "composite_sig", 0},
		{"signature.composite_sig.pq.sig_b64", `"AAA"`, "pq sig_b64 is not canonical base64", 0},
		{"signature.composite_sig.pq.sig_b64", `"AAAA===="`, "pq sig_b64 is not canonical base64", 0},
		{"bundle.responsible_principal_record.composite_sig.classical.sig_b64", `"AAAA "`, "responsible_principal_record signature: classical sig_b64", 0},
		{"bundle.policy_decision.composite_sig.pq.sig_b64", `"AAAA\r\n"`, "policy_decision signature: pq sig_b64", 0},
		{"bundle.pq_checkpoints.0.composite_sig.classical.sig_b64", `"AB=="`, "pq_checkpoints[ckpt-interop-001]: classical sig_b64", 0},
		{"bundle.pq_checkpoints.0.composite_sig.pq.sig_b64", `"AAAA\nAAAA"`, "pq_checkpoints[ckpt-interop-001]: pq sig_b64", 0},
		{"bundle.pq_checkpoints", `{}`, "must be arrays", 0},
		{"bundle.pq_checkpoints", `"ckpt-interop-001"`, "must be arrays", 0},
		{"bundle.manifest.pq_checkpoints", `{"ckpt-interop-001": true}`, "must be arrays", 0},
		{"bundle.manifest.pq_checkpoints", `[["ckpt-interop-001"], {"a": [1]}, null, 1]`, "does not carry", 0},
		{"bundle.manifest.pq_checkpoints", `["ckpt-interop-001", "ckpt-interop-001"]`, "twice", 0},
		{"bundle.pq_checkpoints", `[null, 1, "s", [], {}]`, "missing an id", 0},
		{"bundle.pq_checkpoints.0.checkpoint_id", `{"x": [1]}`, "missing an id", 0},
		{"bundle.pq_checkpoints.0.session_nonce", `["nonce"]`, "nonce", 0},
		{"bundle.pq_checkpoints.0.event_range", `"audit-1..audit-2"`, "event_range does not match", 0},
		{"bundle.pq_checkpoints.0.event_range", `null`, "event_range does not match", 0},
		{"bundle.pq_checkpoints.0.event_range.from_audit_id", `{"a": 1}`, "event_range does not match", 0},
		{"bundle.pq_checkpoints.0.event_range.count", `"2"`, "event_range does not match", 0},
		{"bundle.pq_checkpoints.0.event_range.count", `2.5`, "event_range does not match", 0},
		{"bundle.pq_checkpoints.0.merkle_root", `5`, "merkle_root does not match", 0},
		{"bundle.pq_checkpoints.0.composite_sig", `null`, "pq_checkpoints[ckpt-interop-001]", 0},
		{"bundle.pq_checkpoints.0.composite_sig", `{"classical": 1, "pq": [], "binding": {}}`, "pq_checkpoints[ckpt-interop-001]", 0},
		{"bundle.audit_entries", `{}`, "", 0},
		{"bundle.audit_entries.1", `null`, "", 0},
		{"bundle.audit_entries.0.audit_id", `{"a": [1]}`, "event_range does not match", 0},
		{"bundle.audit_entries.0.intent_hash", `["sha256:00"]`, "audit_entries[0] intent_hash", 0},
		{"bundle.agent_passport.payload.status", `["active"]`, "agent_passport status", 0},
		{"bundle.agent_passport.payload.status", `null`, "agent_passport status", 0},
		{"bundle.agent_passport.payload", `[]`, "", 0},
		{"bundle.agent_passport.payload.keys", `[{"kid": 1, "alg": [], "public_key_b64": {}}]`, "", 0},
		{"bundle.responsible_principal_record.payload.expires_at", `{"t": 1}`, "invalid expires_at", 0},
		{"bundle.responsible_principal_record.payload.human_id", `7`, "principal_binding_reference", 0},
		{"bundle.responsible_principal_record.payload.binding_keys", `"keys"`, "rpr binding_keys", 0},
		{"bundle.intent.payload", `"intent"`, "", 0},
		{"bundle.intent.payload", `null`, "", 0},
		{"bundle.intent", `[]`, "", 0},
		{"bundle.policy_decision.payload.intent_id", `{"id": 1}`, "policy_decision intent_id", 0},
	}
	for _, c := range cases {
		t.Run(c.path+"="+c.value, func(t *testing.T) {
			var sb interface{}
			if err := json.Unmarshal(base, &sb); err != nil {
				t.Fatal(err)
			}
			keys := strings.Split(c.path, ".")
			node := sb
			for i, key := range keys {
				last := i == len(keys)-1
				switch n := node.(type) {
				case map[string]interface{}:
					if last {
						n[key] = jsonValue(c.value)
					}
					node = n[key]
				case []interface{}:
					idx := 0
					if _, err := fmt.Sscan(key, &idx); err != nil || idx >= len(n) {
						t.Fatalf("bad index %s", key)
					}
					if last {
						n[idx] = jsonValue(c.value)
					}
					node = n[idx]
				default:
					t.Fatalf("path %s does not exist", c.path)
				}
			}
			mutated, err := json.Marshal(sb)
			if err != nil {
				t.Fatal(err)
			}
			for _, mode := range []string{"classical_only", "hybrid_preferred", "hybrid_required", "pq_only"} {
				policy := v2.DefaultVerifierPolicy()
				policy.DefaultMode = mode
				policy.RiskOverrides = map[string]string{"low": mode, "medium": mode, "high": mode}
				policy.MaxSessionDurationSeconds = c.maxSession
				r := v2.VerifySignedBundleV2WithPolicy(reg, mutated, policy)
				if r.Verified {
					t.Fatalf("%s: must be rejected", mode)
				}
				if !strings.Contains(strings.ToLower(strings.Join(r.Errors, "\n")), strings.ToLower(c.errorContains)) {
					t.Fatalf("%s: no error mentions %q: %v", mode, c.errorContains, r.Errors)
				}
			}
		})
	}
}

type testSigner struct {
	classical, pq v2.CompositeKeyInfo
	entries       []interface{}
}

func newTestSigner(t *testing.T) testSigner {
	t.Helper()
	ed, err := (&providers.Ed25519Provider{}).GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	pq, err := (&providers.MlDsa65Provider{}).GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	s := testSigner{
		classical: v2.CompositeKeyInfo{Kid: ed.Kid, Alg: "ed25519", SecretKeyB64: ed.SecretKeyB64, PublicKeyB64: ed.PublicKeyB64},
		pq:        v2.CompositeKeyInfo{Kid: pq.Kid, Alg: "ml-dsa-65", SecretKeyB64: pq.SecretKeyB64, PublicKeyB64: pq.PublicKeyB64},
	}
	for _, k := range []v2.CompositeKeyInfo{s.classical, s.pq} {
		s.entries = append(s.entries, map[string]interface{}{
			"kid": k.Kid, "alg": k.Alg, "public_key_b64": k.PublicKeyB64, "status": "active",
		})
	}
	return s
}

// TestBuildSignVerifyBundleV2: a bundle built from signed artifacts with
// BuildBundleV2 and signed with SignBundleV2 passes VerifySignedBundleV2, with
// and without a PQ checkpoint from CreatePQCheckpoint. The artifacts name one
// principal, agent and intent, and the audit entries carry the intent's
// payload hash (VERIFICATION.md V2-14).
func TestBuildSignVerifyBundleV2(t *testing.T) {
	reg := newRegistry()
	principal, agent := newTestSigner(t), newTestSigner(t)
	nonce := strings.Repeat("ab", 32)
	sign := func(context string, payload map[string]interface{}, s testSigner) v2.SignedPayload {
		t.Helper()
		sp, err := v2.SignPayload(reg, context, payload, s.classical, &s.pq)
		if err != nil {
			t.Fatal(err)
		}
		return sp
	}

	intent := sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "agent_id": "a-1", "human_id": "h-1", "session_nonce": nonce}, agent)
	intentCanonical, err := v2.CanonicalizeV2(intent.Payload)
	if err != nil {
		t.Fatal(err)
	}
	audit1 := v2.AuditEventV2{
		DCPVersion: "2.0", AuditID: "audit-1", SessionNonce: nonce, PrevHash: "GENESIS", HashAlg: "sha256",
		AgentID: "a-1", HumanID: "h-1", IntentID: "i-1", IntentHash: "sha256:" + v2.SHA256Hex([]byte(intentCanonical)),
		PolicyDecision: "approved",
	}
	canonical, err := v2.CanonicalizeV2(audit1)
	if err != nil {
		t.Fatal(err)
	}
	audit2 := audit1
	audit2.AuditID, audit2.PrevHash = "audit-2", "sha256:"+v2.SHA256Hex([]byte(canonical))

	passport := map[string]interface{}{
		"agent_id": "a-1", "session_nonce": nonce, "keys": agent.entries, "status": "active", "principal_binding_reference": "h-1",
	}
	bundle, err := v2.BuildBundleV2(v2.BundleBuildInput{
		RPR:          sign(v2.CtxResponsiblePrincipal, map[string]interface{}{"human_id": "h-1", "session_nonce": nonce, "binding_keys": principal.entries}, principal),
		Passport:     sign(v2.CtxAgentPassport, passport, agent),
		Intent:       intent,
		Policy:       sign(v2.CtxPolicyDecision, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "risk_score": 200, "decision": "approve"}, agent),
		AuditEntries: []v2.AuditEventV2{audit1, audit2},
		SessionNonce: nonce,
	})
	if err != nil {
		t.Fatal(err)
	}
	var lastSigned []byte
	verifyWith := func(bundle *v2.CitizenshipBundleV2, policy v2.VerifierPolicy) *v2.V2VerificationResult {
		t.Helper()
		signed, err := v2.SignBundleV2(reg, bundle, principal.classical, &principal.pq)
		if err != nil {
			t.Fatal(err)
		}
		if lastSigned, err = json.Marshal(signed); err != nil {
			t.Fatal(err)
		}
		return v2.VerifySignedBundleV2WithPolicy(reg, lastSigned, policy)
	}
	verify := func(bundle *v2.CitizenshipBundleV2) *v2.V2VerificationResult {
		t.Helper()
		return verifyWith(bundle, v2.DefaultVerifierPolicy())
	}
	if r := verify(bundle); !r.Verified {
		t.Fatalf("built bundle must verify: %v", r.Errors)
	}

	// The signed session window (V2-4): SignBundleV2 signs a manifest's
	// SessionExpiresAt with SessionIssuedAt, the signing time unless set, and
	// leaves the caller's bundle alone.
	bounded := v2.DefaultVerifierPolicy()
	bounded.MaxSessionDurationSeconds = 3600
	windowed := *bundle
	windowed.Manifest.SessionExpiresAt = time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339)
	if r := verifyWith(&windowed, bounded); !r.Verified {
		t.Fatalf("a 30 minute session must verify under a one hour maximum: %v", r.Errors)
	}
	var out struct {
		Bundle struct {
			Manifest map[string]interface{} `json:"manifest"`
		} `json:"bundle"`
	}
	if err := json.Unmarshal(lastSigned, &out); err != nil {
		t.Fatal(err)
	}
	if _, ok := parseInstant(out.Bundle.Manifest["session_issued_at"]); !ok || windowed.Manifest.SessionIssuedAt != "" {
		t.Fatalf("signed session_issued_at %v, caller's %q", out.Bundle.Manifest["session_issued_at"], windowed.Manifest.SessionIssuedAt)
	}
	windowed.Manifest.SessionIssuedAt = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	if r := verifyWith(&windowed, bounded); r.Verified || !strings.Contains(strings.Join(r.Errors, "\n"), "Session duration") {
		t.Fatalf("a session issued two hours ago must exceed a one hour maximum: %v", r.Errors)
	}

	// A checkpoint over the audit trail, listed in the manifest (V2-12).
	withCheckpoint := func(s testSigner) *v2.CitizenshipBundleV2 {
		t.Helper()
		var events []map[string]interface{}
		raw, err := json.Marshal(bundle.AuditEntries)
		if err == nil {
			err = json.Unmarshal(raw, &events)
		}
		if err != nil {
			t.Fatal(err)
		}
		cp, err := v2.CreatePQCheckpoint(reg, s.classical, s.pq, events, nonce)
		if err != nil {
			t.Fatal(err)
		}
		var typed v2.PQCheckpoint
		if raw, err = json.Marshal(cp); err == nil {
			err = json.Unmarshal(raw, &typed)
		}
		if err != nil {
			t.Fatal(err)
		}
		b := *bundle
		b.PQCheckpoints = []v2.PQCheckpoint{typed}
		b.Manifest.PQCheckpoints = []string{typed.CheckpointID}
		return &b
	}
	if r := verify(withCheckpoint(agent)); !r.Verified {
		t.Fatalf("bundle with the agent's checkpoint must verify: %v", r.Errors)
	}
	// The agent signs checkpoints: the principal's keys are not passport keys.
	if r := verify(withCheckpoint(principal)); r.Verified || !strings.Contains(strings.Join(r.Errors, "\n"), "not found in passport keys") {
		t.Fatalf("a checkpoint signed by the principal must be rejected: %v", r.Errors)
	}

	// RequireSessionExpiry, RequireAudienceBinding and VerifierID, as the
	// TypeScript verifier applies them.
	bound := *bundle
	bound.Manifest.SessionExpiresAt = time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	bound.Manifest.IntendedVerifier = "verifier:acme"
	for _, c := range []struct {
		name          string
		bundle        *v2.CitizenshipBundleV2
		edit          func(p *v2.VerifierPolicy)
		errorContains string // "" when the bundle must verify
	}{
		{"expiry required and present", &bound, func(p *v2.VerifierPolicy) { p.RequireSessionExpiry = true }, ""},
		{"expiry required and absent", bundle, func(p *v2.VerifierPolicy) { p.RequireSessionExpiry = true },
			"Policy requires session_expires_at but manifest does not include it"},
		{"audience required and present", &bound, func(p *v2.VerifierPolicy) { p.RequireAudienceBinding = true }, ""},
		{"audience required and absent", bundle, func(p *v2.VerifierPolicy) { p.RequireAudienceBinding = true },
			"Policy requires audience binding but manifest does not include intended_verifier"},
		{"audience is this verifier", &bound, func(p *v2.VerifierPolicy) { p.RequireAudienceBinding, p.VerifierID = true, "verifier:acme" }, ""},
		{"audience is another verifier", &bound, func(p *v2.VerifierPolicy) { p.RequireAudienceBinding, p.VerifierID = true, "verifier:other" },
			"Bundle intended for verifier 'verifier:acme', not 'verifier:other'"},
		{"verifier id alone binds nothing", bundle, func(p *v2.VerifierPolicy) { p.VerifierID = "verifier:other" }, ""},
	} {
		policy := v2.DefaultVerifierPolicy()
		c.edit(&policy)
		r := verifyWith(c.bundle, policy)
		switch {
		case c.errorContains == "" && !r.Verified:
			t.Errorf("%s: must verify: %v", c.name, r.Errors)
		case c.errorContains != "" && (r.Verified || !strings.Contains(strings.Join(r.Errors, "\n"), c.errorContains)):
			t.Errorf("%s: want an error %q, got verified=%v %v", c.name, c.errorContains, r.Verified, r.Errors)
		}
	}
}

func TestInteropEffectiveVerificationMode(t *testing.T) {
	cases := loadVectors(t).SecurityTier.EffectiveMode.Cases
	if len(cases) == 0 {
		t.Fatal("no effective_mode vectors found")
	}
	for _, c := range cases {
		if got := v2.EffectiveVerificationMode(c.PolicyMode, c.Tier); got != c.Expected {
			t.Errorf("%s + %s: got %s, want %s", c.PolicyMode, c.Tier, got, c.Expected)
		}
	}
}

// TestMalformedSessionNonceRejected: a bundle whose artifacts all share a
// session nonce that is not 64 lowercase hex characters is rejected, as the
// TypeScript, Python and Rust verifiers reject it (VERIFICATION.md V2-4).
func TestMalformedSessionNonceRejected(t *testing.T) {
	reg := newRegistry()
	principal, agent := newTestSigner(t), newTestSigner(t)
	for _, tc := range []struct {
		nonce string
		valid bool
	}{{strings.Repeat("ab", 32), true}, {strings.Repeat("AB", 32), false}, {"abcdef", false}} {
		sign := func(context string, payload map[string]interface{}, s testSigner) v2.SignedPayload {
			t.Helper()
			sp, err := v2.SignPayload(reg, context, payload, s.classical, &s.pq)
			if err != nil {
				t.Fatal(err)
			}
			return sp
		}
		intent := sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "agent_id": "a-1", "human_id": "h-1", "session_nonce": tc.nonce}, agent)
		intentCanonical, err := v2.CanonicalizeV2(intent.Payload)
		if err != nil {
			t.Fatal(err)
		}
		audit := v2.AuditEventV2{
			DCPVersion: "2.0", AuditID: "audit-1", SessionNonce: tc.nonce, PrevHash: "GENESIS", HashAlg: "sha256",
			AgentID: "a-1", HumanID: "h-1", IntentID: "i-1", IntentHash: "sha256:" + v2.SHA256Hex([]byte(intentCanonical)),
			PolicyDecision: "approved",
		}
		bundle, err := v2.BuildBundleV2(v2.BundleBuildInput{
			RPR:          sign(v2.CtxResponsiblePrincipal, map[string]interface{}{"human_id": "h-1", "session_nonce": tc.nonce, "binding_keys": principal.entries}, principal),
			Passport:     sign(v2.CtxAgentPassport, map[string]interface{}{"agent_id": "a-1", "session_nonce": tc.nonce, "keys": agent.entries, "status": "active", "principal_binding_reference": "h-1"}, agent),
			Intent:       intent,
			Policy:       sign(v2.CtxPolicyDecision, map[string]interface{}{"intent_id": "i-1", "session_nonce": tc.nonce, "risk_score": 200, "decision": "approve"}, agent),
			AuditEntries: []v2.AuditEventV2{audit},
			SessionNonce: tc.nonce,
		})
		if err != nil {
			t.Fatal(err)
		}
		signed, err := v2.SignBundleV2(reg, bundle, principal.classical, &principal.pq)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(signed)
		if err != nil {
			t.Fatal(err)
		}
		r := v2.VerifySignedBundleV2WithPolicy(reg, raw, v2.DefaultVerifierPolicy())
		if r.Verified != tc.valid {
			t.Errorf("nonce %q: verified %v, want %v: %v", tc.nonce, r.Verified, tc.valid, r.Errors)
		}
		if !tc.valid && !strings.Contains(strings.Join(r.Errors, "\n"), "Invalid session_nonce") {
			t.Errorf("nonce %q: errors %v, want Invalid session_nonce", tc.nonce, r.Errors)
		}
	}
}
