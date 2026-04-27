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
// binding, cryptographic composite signatures, and audit hash chain integrity.
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

func verifyBundleSignature(registry *AlgorithmRegistry, bundle, signature, manifest map[string]interface{}, result *V2VerificationResult) {
	csRaw, ok := signature["composite_sig"]
	if !ok {
		result.Errors = append(result.Errors, "Missing composite_sig in signature")
		return
	}

	csBytes, err := json.Marshal(csRaw)
	if err != nil {
		result.Errors = append(result.Errors, "Invalid composite_sig structure")
		return
	}
	var cs CompositeSignature
	if err := json.Unmarshal(csBytes, &cs); err != nil {
		result.Errors = append(result.Errors, "Invalid composite_sig structure")
		return
	}

	passport, ok := bundle["agent_passport"].(map[string]interface{})
	if !ok {
		result.Warnings = append(result.Warnings, "No agent_passport found in bundle")
		return
	}
	payload, ok := passport["payload"].(map[string]interface{})
	if !ok {
		result.Warnings = append(result.Warnings, "No payload in agent_passport")
		return
	}
	keysRaw, ok := payload["keys"].([]interface{})
	if !ok {
		result.Warnings = append(result.Warnings, "No keys in agent passport payload")
		return
	}

	var classicalPK, pqPK string
	for _, kRaw := range keysRaw {
		keyMap, ok := kRaw.(map[string]interface{})
		if !ok {
			continue
		}
		alg, _ := keyMap["alg"].(string)
		pk, _ := keyMap["public_key_b64"].(string)
		switch alg {
		case "ed25519":
			classicalPK = pk
		case "ml-dsa-65":
			pqPK = pk
		}
	}

	if manifest == nil {
		return
	}

	canonical, err := CanonicalizeV2(manifest)
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("Canonicalize manifest error: %s", err))
		return
	}

	if classicalPK == "" {
		result.Warnings = append(result.Warnings, "No classical public key found in passport")
		return
	}

	cvr, err := CompositeVerify(registry, CtxBundle, []byte(canonical), &cs, classicalPK, pqPK)
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("Signature verify error: %s", err))
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
