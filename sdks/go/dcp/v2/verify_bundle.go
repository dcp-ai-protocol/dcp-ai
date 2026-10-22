package v2

import (
	"encoding/json"
	"fmt"
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
}

// VerifySignedBundleV2 performs full V2 bundle verification against a JSON-encoded
// signed bundle. It validates structure, manifest hash consistency, session nonce
// binding, the composite signatures over the manifest and over each artifact,
// and audit hash chain integrity.
func VerifySignedBundleV2(registry *AlgorithmRegistry, signedBundleJSON []byte) *V2VerificationResult {
	result := &V2VerificationResult{
		DCPVersion: "2.0",
		Errors:     []string{},
		Warnings:   []string{},
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
	verifyBundleSignature(registry, bundle, signature, manifest, result)
	verifyArtifactSignatures(registry, bundle, result)
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

func verifyBundleSignature(registry *AlgorithmRegistry, bundle, signature, manifest map[string]interface{}, result *V2VerificationResult) {
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

	if !cvr.Valid {
		result.Errors = append(result.Errors, "Bundle signature verification failed")
	}

	if cs.Binding == "classical_only" {
		result.Warnings = append(result.Warnings, "Bundle uses classical_only binding (no PQ protection)")
	}
}

// verifyArtifactSignatures checks each artifact's own composite_sig
// (VERIFICATION.md V2-8): the principal signs the RPR with its binding_keys,
// the agent signs the rest with its passport keys.
func verifyArtifactSignatures(registry *AlgorithmRegistry, bundle map[string]interface{}, result *V2VerificationResult) {
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
		switch {
		case err != nil:
			result.Errors = append(result.Errors, fmt.Sprintf("%s signature: %s", a.field, err))
		case !cvr.Valid:
			result.Errors = append(result.Errors, fmt.Sprintf("%s signature verification failed", a.field))
		case cs.Binding == "classical_only":
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s uses classical_only binding (no PQ protection)", a.field))
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
