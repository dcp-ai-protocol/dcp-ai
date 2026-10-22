package v2

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
)

// V2VerificationResult describes the outcome of a V2 signed bundle verification.
type V2VerificationResult struct {
	Verified            bool     `json:"verified"`
	DCPVersion          string   `json:"dcp_version"`
	Errors              []string `json:"errors"`
	Warnings            []string `json:"warnings"`
	ClassicalValid      bool     `json:"classical_valid"`
	PQValid             bool     `json:"pq_valid"`
	SessionBindingValid bool     `json:"session_binding_valid"`
	ManifestValid       bool     `json:"manifest_valid"`
	// VerificationMode is the mode the bundle was checked against and
	// ResolvedTier the security tier of its intent and policy decision.
	VerificationMode string `json:"verification_mode"`
	ResolvedTier     string `json:"resolved_tier"`
}

// DefaultVerifierPolicy returns the default verifier policy, the same as
// DEFAULT_VERIFIER_POLICY in the TypeScript SDK.
func DefaultVerifierPolicy() VerifierPolicy {
	return VerifierPolicy{
		DefaultMode: "hybrid_preferred",
		RiskOverrides: map[string]string{
			"low":    "classical_only",
			"medium": "hybrid_preferred",
			"high":   "hybrid_required",
		},
		MinClassical:            1,
		MinPQ:                   1,
		AcceptedClassicalAlgs:   []string{"ed25519"},
		AcceptedPQAlgs:          []string{"ml-dsa-65", "slh-dsa-192f"},
		AcceptedHashAlgs:        []string{"sha256", "sha384"},
		RequireSessionBinding:   true,
		RequireCompositeBinding: true,
		MaxKeyAgeDays:           365,
		AllowV1Bundles:          true,
	}
}

// VerifySignedBundleV2 performs full V2 bundle verification against a JSON-encoded
// signed bundle under DefaultVerifierPolicy. It validates structure, manifest hash
// consistency, session nonce binding, the composite signatures over the manifest
// and over each artifact, and audit hash chain integrity.
func VerifySignedBundleV2(registry *AlgorithmRegistry, signedBundleJSON []byte) *V2VerificationResult {
	return VerifySignedBundleV2WithPolicy(registry, signedBundleJSON, DefaultVerifierPolicy())
}

// VerifySignedBundleV2WithPolicy verifies a V2 signed bundle against the stricter
// of the policy mode (DefaultMode, or the RiskOverrides entry for the passport's
// risk_tier) and the security tier's mode (spec §14.3).
// Only DefaultMode and RiskOverrides are enforced; a policy that changes any
// other field fails verification instead of having the setting ignored.
func VerifySignedBundleV2WithPolicy(registry *AlgorithmRegistry, signedBundleJSON []byte, policy VerifierPolicy) *V2VerificationResult {
	result := &V2VerificationResult{
		DCPVersion: "2.0",
		Errors:     []string{},
		Warnings:   []string{},
	}
	enforced := DefaultVerifierPolicy()
	enforced.DefaultMode, enforced.RiskOverrides = policy.DefaultMode, policy.RiskOverrides
	if !reflect.DeepEqual(policy, enforced) {
		result.Errors = append(result.Errors, "Verifier policy sets fields this verifier does not enforce: only DefaultMode and RiskOverrides may differ from DefaultVerifierPolicy")
		return result
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(signedBundleJSON, &raw); err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("JSON parse error: %s", err))
		return result
	}

	bundle, ok := raw["bundle"].(map[string]interface{})
	if !ok {
		result.Errors = append(result.Errors, "Missing bundle field")
		return result
	}
	signature, ok := raw["signature"].(map[string]interface{})
	if !ok {
		result.Errors = append(result.Errors, "Missing signature field")
		return result
	}

	if v, _ := bundle["dcp_bundle_version"].(string); v != "2.0" {
		result.Errors = append(result.Errors, "Invalid dcp_bundle_version")
	}

	manifest, hasManifest := bundle["manifest"].(map[string]interface{})
	if !hasManifest {
		result.Errors = append(result.Errors, "Missing manifest in bundle")
	}
	result.ManifestValid = hasManifest

	for _, field := range []string{"responsible_principal_record", "agent_passport", "intent", "policy_decision"} {
		if _, ok := bundle[field]; !ok {
			result.Errors = append(result.Errors, fmt.Sprintf("Missing %s in bundle", field))
		}
	}

	manifestNonce, _ := manifest["session_nonce"].(string)
	if manifestNonce == "" {
		result.Errors = append(result.Errors, "Missing session_nonce in manifest")
	}
	result.SessionBindingValid = manifestNonce != ""

	// Per spec/CANONICALIZATION_PROFILE.md § 4: a missing canonicalization_profile
	// MUST be assumed equal to the only profile defined today, "dcp-jcs-v1".
	// An unknown value is rejected; future profiles will register their own
	// canonicalizer here.
	if profile, ok := manifest["canonicalization_profile"].(string); ok && profile != "dcp-jcs-v1" {
		result.Errors = append(result.Errors, fmt.Sprintf("Unknown canonicalization_profile: %s", profile))
	}

	verifyManifestHashes(bundle, manifest, result)
	verifySessionNonceConsistency(bundle, manifestNonce, result)
	mode := resolveVerificationMode(bundle, policy, result)
	if mode == "" {
		result.Errors = append(result.Errors, "Unknown verification mode in verifier policy")
		return result
	}
	verifyBundleSignature(registry, bundle, signature, manifest, mode, result)
	verifyArtifactSignatures(registry, bundle, mode, result)
	verifyAuditHashChain(bundle, result)

	result.Verified = len(result.Errors) == 0
	return result
}

func verifyManifestHashes(bundle, manifest map[string]interface{}, result *V2VerificationResult) {
	if manifest == nil {
		return
	}

	hashFields := []struct {
		artifactKey string
		hashKey     string
	}{
		{"responsible_principal_record", "rpr_hash"},
		{"agent_passport", "passport_hash"},
		{"intent", "intent_hash"},
		{"policy_decision", "policy_hash"},
	}

	for _, hf := range hashFields {
		artifact, ok := bundle[hf.artifactKey].(map[string]interface{})
		if !ok {
			continue
		}
		payload := artifact["payload"]
		if payload == nil {
			continue
		}
		expected, _ := manifest[hf.hashKey].(string)
		if expected == "" {
			continue
		}

		canonical, err := CanonicalizeV2(payload)
		if err != nil {
			continue
		}
		dh := DualHashCanonical(canonical)
		computed := "sha256:" + dh.SHA256
		if computed != expected {
			result.Errors = append(result.Errors, fmt.Sprintf("Manifest %s mismatch", hf.hashKey))
		}
	}
}

func verifySessionNonceConsistency(bundle map[string]interface{}, manifestNonce string, result *V2VerificationResult) {
	if manifestNonce == "" {
		return
	}
	for _, field := range []string{"responsible_principal_record", "agent_passport", "intent", "policy_decision"} {
		artifact, ok := bundle[field].(map[string]interface{})
		if !ok {
			continue
		}
		payload, ok := artifact["payload"].(map[string]interface{})
		if !ok {
			continue
		}
		nonce, _ := payload["session_nonce"].(string)
		if nonce != "" && nonce != manifestNonce {
			result.Errors = append(result.Errors, fmt.Sprintf("Session nonce mismatch in %s", field))
			result.SessionBindingValid = false
			return
		}
	}
}

// resolveVerificationMode sets the bundle's security tier and returns the mode it
// is checked against: the agent's risk_tier and intent can raise the policy mode
// but never take it below the tier's mode. It returns "" for a policy mode that
// is not a verification mode.
func resolveVerificationMode(bundle map[string]interface{}, policy VerifierPolicy, result *V2VerificationResult) string {
	payload := func(field string) map[string]interface{} {
		sp, _ := bundle[field].(map[string]interface{})
		p, _ := sp["payload"].(map[string]interface{})
		return p
	}
	policyMode := policy.DefaultMode
	riskTier, _ := payload("agent_passport")["risk_tier"].(string)
	if override, ok := policy.RiskOverrides[riskTier]; ok && riskTier != "" {
		policyMode = override
	}
	if policyMode != "pq_only" && !slices.Contains(modeStrictness, policyMode) {
		return ""
	}
	tier := ComputeSecurityTier(SecurityTierInputFromPayloads(payload("intent"), payload("policy_decision")))
	result.ResolvedTier = tier.Tier
	result.VerificationMode = EffectiveVerificationMode(policyMode, tier.Tier)
	return result.VerificationMode
}

// checkMode applies the verification mode to one verified composite signature
// (VERIFICATION.md V2-7, V2-9). A PQ signature that is present must verify in
// every mode; cvr.Valid covers both components for pq_over_classical.
func checkMode(mode string, cs *CompositeSignature, cvr *CompositeVerifyResult) (err, warning string) {
	switch {
	case mode == "pq_only":
		if cs.Binding != "pq_over_classical" || !cvr.PQValid {
			return "PQ signature invalid or missing (pq_only)", ""
		}
		if !cvr.ClassicalValid {
			return "", "classical signature not verified in pq_only mode"
		}
	case mode == "hybrid_required" && cs.Binding != "pq_over_classical":
		return "hybrid_required needs a pq_over_classical signature, got " + cs.Binding, ""
	case !cvr.Valid:
		return "signature verification failed", ""
	case cs.Binding == "classical_only" && mode == "hybrid_preferred":
		return "", "classical_only binding (no PQ protection)"
	}
	return "", ""
}

// payloadKeys returns the key entries listed under field in an artifact's payload.
func payloadKeys(bundle map[string]interface{}, artifact, field string) []interface{} {
	sp, _ := bundle[artifact].(map[string]interface{})
	payload, _ := sp["payload"].(map[string]interface{})
	keys, _ := payload[field].([]interface{})
	return keys
}

// The algorithms each composite signature slot may hold.
var (
	classicalAlgs = map[string]bool{"ed25519": true}
	pqAlgs        = map[string]bool{"ml-dsa-65": true, "slh-dsa-192f": true}
)

// findKeyByKid returns the public key and algorithm of the entry with that kid.
func findKeyByKid(keys []interface{}, kid string) (pk, alg string) {
	for _, k := range keys {
		entry, _ := k.(map[string]interface{})
		if id, _ := entry["kid"].(string); id != "" && id == kid {
			pk, _ = entry["public_key_b64"].(string)
			alg, _ = entry["alg"].(string)
			return pk, alg
		}
	}
	return "", ""
}

// verifyCompositeSig verifies a composite_sig over payload with the keys it
// names by kid (VERIFICATION.md V2-6, V2-7): pq_over_classical is valid only
// when both components verify; classical_only carries no PQ signature.
func verifyCompositeSig(registry *AlgorithmRegistry, context string, payload, csRaw interface{}, keys []interface{}) (*CompositeSignature, *CompositeVerifyResult, error) {
	if csRaw == nil {
		return nil, nil, fmt.Errorf("missing composite_sig")
	}
	csBytes, err := json.Marshal(csRaw)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid composite_sig structure")
	}
	var cs CompositeSignature
	if err := json.Unmarshal(csBytes, &cs); err != nil {
		return nil, nil, fmt.Errorf("invalid composite_sig structure")
	}

	// Ed25519 cannot stand in for the PQ signature, nor ML-DSA for the classical one.
	if !classicalAlgs[cs.Classical.Alg] {
		return nil, nil, fmt.Errorf("classical slot holds %q, which is not a classical algorithm", cs.Classical.Alg)
	}
	if cs.PQ != nil && !pqAlgs[cs.PQ.Alg] {
		return nil, nil, fmt.Errorf("PQ slot holds %q, which is not a PQ algorithm", cs.PQ.Alg)
	}

	classicalPK, classicalAlg := findKeyByKid(keys, cs.Classical.Kid)
	if classicalPK == "" {
		return nil, nil, fmt.Errorf("classical signer key kid=%s not found", cs.Classical.Kid)
	}
	if classicalAlg != cs.Classical.Alg {
		return nil, nil, fmt.Errorf("classical signer key kid=%s is %s, not %s", cs.Classical.Kid, classicalAlg, cs.Classical.Alg)
	}
	var pqPK string
	if cs.PQ != nil {
		var pqAlg string
		if pqPK, pqAlg = findKeyByKid(keys, cs.PQ.Kid); pqPK == "" {
			return nil, nil, fmt.Errorf("PQ signer key kid=%s not found", cs.PQ.Kid)
		}
		if pqAlg != cs.PQ.Alg {
			return nil, nil, fmt.Errorf("PQ signer key kid=%s is %s, not %s", cs.PQ.Kid, pqAlg, cs.PQ.Alg)
		}
	}

	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, nil, fmt.Errorf("canonicalize: %w", err)
	}
	cvr, err := CompositeVerify(registry, context, []byte(canonical), &cs, classicalPK, pqPK)
	if err != nil {
		return nil, nil, err
	}
	return &cs, cvr, nil
}

func verifyBundleSignature(registry *AlgorithmRegistry, bundle, signature, manifest map[string]interface{}, mode string, result *V2VerificationResult) {
	csRaw, ok := signature["composite_sig"]
	if !ok {
		result.Errors = append(result.Errors, "Missing composite_sig in signature")
		return
	}
	if manifest == nil {
		return
	}

	// The bundle is signed by the agent or by its principal.
	keys := append(append([]interface{}{}, payloadKeys(bundle, "agent_passport", "keys")...),
		payloadKeys(bundle, "responsible_principal_record", "binding_keys")...)
	cs, cvr, err := verifyCompositeSig(registry, CtxBundle, manifest, csRaw, keys)
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("Bundle signature: %s", err))
		return
	}

	result.ClassicalValid = cvr.ClassicalValid
	result.PQValid = cvr.PQValid

	if e, w := checkMode(mode, cs, cvr); e != "" {
		result.Errors = append(result.Errors, "Bundle "+e)
	} else if w != "" {
		result.Warnings = append(result.Warnings, "Bundle "+w)
	}
}

// verifyArtifactSignatures checks each artifact's own composite_sig
// (VERIFICATION.md V2-8): the principal signs the RPR with its binding_keys,
// the agent signs the rest with its passport keys.
func verifyArtifactSignatures(registry *AlgorithmRegistry, bundle map[string]interface{}, mode string, result *V2VerificationResult) {
	rprKeys := payloadKeys(bundle, "responsible_principal_record", "binding_keys")
	agentKeys := payloadKeys(bundle, "agent_passport", "keys")
	artifacts := []struct {
		field, context string
		keys           []interface{}
	}{
		{"responsible_principal_record", CtxResponsiblePrincipal, rprKeys},
		{"agent_passport", CtxAgentPassport, agentKeys},
		{"intent", CtxIntent, agentKeys},
		{"policy_decision", CtxPolicyDecision, agentKeys},
	}
	for _, a := range artifacts {
		raw, present := bundle[a.field]
		if !present {
			continue // reported as missing by VerifySignedBundleV2
		}
		sp, _ := raw.(map[string]interface{})
		payload, ok := sp["payload"].(map[string]interface{})
		if !ok {
			result.Errors = append(result.Errors, fmt.Sprintf("%s is not a SignedPayload object", a.field))
			continue
		}
		cs, cvr, err := verifyCompositeSig(registry, a.context, payload, sp["composite_sig"], a.keys)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s signature: %s", a.field, err))
			continue
		}
		if e, w := checkMode(mode, cs, cvr); e != "" {
			result.Errors = append(result.Errors, fmt.Sprintf("%s %s", a.field, e))
		} else if w != "" {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s %s", a.field, w))
		}
	}
}

func verifyAuditHashChain(bundle map[string]interface{}, result *V2VerificationResult) {
	entriesRaw, ok := bundle["audit_entries"].([]interface{})
	if !ok {
		return
	}

	expectedPrev := "sha256:" + strings.Repeat("0", 64)
	for i, entryRaw := range entriesRaw {
		entry, ok := entryRaw.(map[string]interface{})
		if !ok {
			continue
		}
		if i > 0 {
			prevHash, _ := entry["prev_hash"].(string)
			if prevHash != expectedPrev {
				result.Errors = append(result.Errors, fmt.Sprintf("Audit hash chain broken at entry %d", i))
				break
			}
		}
		canonical, err := CanonicalizeV2(entry)
		if err != nil {
			continue
		}
		dh := DualHashCanonical(canonical)
		expectedPrev = "sha256:" + dh.SHA256
	}
}
