package dcp

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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
// error_contains, and the classical-only routine control must get its
// expected verdict.
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
		MustRejectBundles []struct {
			Name          string          `json:"name"`
			ErrorContains string          `json:"error_contains"`
			SignedBundle  json.RawMessage `json:"signed_bundle"`
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
			for _, b := range vecs.MustRejectBundles {
				t.Run(b.Name, func(t *testing.T) {
					rejects(t, v2.VerifySignedBundleV2WithPolicy(reg, b.SignedBundle, policy), b.ErrorContains)
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
// BuildBundleV2 and signed with SignBundleV2 passes VerifySignedBundleV2.
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

	audit1 := v2.AuditEventV2{DCPVersion: "2.0", AuditID: "audit-1", SessionNonce: nonce, PrevHash: "GENESIS", HashAlg: "sha256"}
	canonical, err := v2.CanonicalizeV2(audit1)
	if err != nil {
		t.Fatal(err)
	}
	audit2 := audit1
	audit2.AuditID, audit2.PrevHash = "audit-2", "sha256:"+v2.SHA256Hex([]byte(canonical))

	bundle, err := v2.BuildBundleV2(v2.BundleBuildInput{
		RPR:          sign(v2.CtxResponsiblePrincipal, map[string]interface{}{"human_id": "h-1", "session_nonce": nonce, "binding_keys": principal.entries}, principal),
		Passport:     sign(v2.CtxAgentPassport, map[string]interface{}{"agent_id": "a-1", "session_nonce": nonce, "keys": agent.entries}, agent),
		Intent:       sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce}, agent),
		Policy:       sign(v2.CtxPolicyDecision, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "risk_score": 200}, agent),
		AuditEntries: []v2.AuditEventV2{audit1, audit2},
		SessionNonce: nonce,
	})
	if err != nil {
		t.Fatal(err)
	}
	signed, err := v2.SignBundleV2(reg, bundle, principal.classical, &principal.pq)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(signed)
	if err != nil {
		t.Fatal(err)
	}
	if r := v2.VerifySignedBundleV2(reg, data); !r.Verified {
		t.Fatalf("built bundle must verify: %v", r.Errors)
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
