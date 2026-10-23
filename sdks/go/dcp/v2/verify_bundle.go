package v2

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"time"
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
		AdvisoryRejectedAlgs:    []string{},
	}
}

// VerifySignedBundleV2 performs full V2 bundle verification against a JSON-encoded
// signed bundle under DefaultVerifierPolicy. It validates structure, manifest hash
// consistency, session nonce binding, cross-artifact consistency (V2-14), the
// principal's composite signature over the manifest, each artifact's and each PQ
// checkpoint's composite signature, and audit hash chain integrity.
func VerifySignedBundleV2(registry *AlgorithmRegistry, signedBundleJSON []byte) *V2VerificationResult {
	return VerifySignedBundleV2WithPolicy(registry, signedBundleJSON, DefaultVerifierPolicy())
}

// VerifySignedBundleV2WithPolicy verifies a V2 signed bundle against the stricter
// of the policy mode (DefaultMode, or the RiskOverrides entry for the passport's
// risk_tier) and the security tier's mode (spec §14.3).
// Besides DefaultMode and RiskOverrides, only the Phase 3 fields and the session
// and audience fields are enforced, as in the TypeScript SDK:
// AdvisoryRejectedAlgs, WarnClassicalOnlyDeprecated,
// AllowClassicalFallbackDisable, MaxSessionDurationSeconds,
// RequireSessionExpiry, RequireAudienceBinding and VerifierID. A policy that
// changes any other field fails verification instead of having the setting
// ignored.
func VerifySignedBundleV2WithPolicy(registry *AlgorithmRegistry, signedBundleJSON []byte, policy VerifierPolicy) *V2VerificationResult {
	result := &V2VerificationResult{
		DCPVersion: "2.0",
		Errors:     []string{},
		Warnings:   []string{},
	}
	enforced := DefaultVerifierPolicy()
	enforced.DefaultMode, enforced.RiskOverrides = policy.DefaultMode, policy.RiskOverrides
	enforced.AllowClassicalFallbackDisable = policy.AllowClassicalFallbackDisable
	enforced.WarnClassicalOnlyDeprecated = policy.WarnClassicalOnlyDeprecated
	enforced.AdvisoryRejectedAlgs = policy.AdvisoryRejectedAlgs
	enforced.MaxSessionDurationSeconds = policy.MaxSessionDurationSeconds
	enforced.RequireSessionExpiry = policy.RequireSessionExpiry
	enforced.RequireAudienceBinding, enforced.VerifierID = policy.RequireAudienceBinding, policy.VerifierID
	if !reflect.DeepEqual(policy, enforced) {
		result.Errors = append(result.Errors, "Verifier policy sets fields this verifier does not enforce: only DefaultMode, RiskOverrides, MaxSessionDurationSeconds, RequireSessionExpiry, RequireAudienceBinding, VerifierID and the Phase 3 fields may differ from DefaultVerifierPolicy")
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
	} else if !IsValidSessionNonce(manifestNonce) {
		// Every artifact must carry this nonce, so a malformed one is malformed everywhere (V2-4).
		result.Errors = append(result.Errors, fmt.Sprintf("Invalid session_nonce in manifest: %q", manifestNonce))
	}
	result.SessionBindingValid = IsValidSessionNonce(manifestNonce)

	// Per spec/CANONICALIZATION_PROFILE.md § 4: a missing canonicalization_profile
	// MUST be assumed equal to the only profile defined today, "dcp-jcs-v1".
	// An unknown value is rejected; future profiles will register their own
	// canonicalizer here.
	if profile, ok := manifest["canonicalization_profile"]; ok && profile != "dcp-jcs-v1" {
		result.Errors = append(result.Errors, fmt.Sprintf("Unknown canonicalization_profile: %v", profile))
	}

	verifyManifestHashes(bundle, manifest, result)
	verifySessionNonceConsistency(bundle, manifestNonce, result)
	verifySessionTimes(manifest, policy, result)
	verifyAudience(manifest, policy, result)
	verifyConsistency(bundle, result)
	mode := resolveVerificationMode(bundle, policy, result)
	if mode == "" {
		result.Errors = append(result.Errors, "Unknown verification mode in verifier policy")
		return result
	}
	verifyBundleSignature(registry, bundle, signature, manifest, mode, policy, result)
	verifySignatureMetadata(bundle, signature, manifest, result)
	verifyArtifactSignatures(registry, bundle, mode, policy, result)
	verifyPQCheckpoints(registry, bundle, manifest, mode, policy, result)
	verifyAuditTrail(bundle, manifest, result)
	verifyKeyValidity(bundle, result)

	result.Verified = len(result.Errors) == 0
	return result
}

// verifyManifestHashes recomputes each artifact's hash and checks it against
// its payload_hash and the manifest (VERIFICATION.md V2-3). A hash that cannot
// be checked, because the payload or the manifest field is missing or the
// payload cannot be canonicalized, is an error.
func verifyManifestHashes(bundle, manifest map[string]interface{}, result *V2VerificationResult) {
	if manifest == nil {
		return // reported as missing by VerifySignedBundleV2
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
			continue // reported by VerifySignedBundleV2 and verifyArtifactSignatures
		}
		canonical, err := CanonicalizeV2(artifact["payload"])
		if artifact["payload"] == nil || err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Cannot hash %s payload", hf.artifactKey))
			continue
		}
		computed := "sha256:" + DualHashCanonical(canonical).SHA256
		if payloadHash, _ := artifact["payload_hash"].(string); payloadHash != computed {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: payload_hash mismatch", hf.artifactKey))
		}
		if expected, _ := manifest[hf.hashKey].(string); expected != computed {
			result.Errors = append(result.Errors, fmt.Sprintf("Manifest %s mismatch", hf.hashKey))
		}
	}
}

// rfc3339Pattern is the timestamp shape every SDK accepts: a time and a Z or
// ±hh:mm offset are required. time.Parse checks the other ranges, but not the
// offset's (it takes +24:00).
var rfc3339Pattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$`)

// parseRFC3339 returns the instant of an RFC 3339 timestamp with a Z or ±hh:mm
// offset, at millisecond precision: digits beyond milliseconds are dropped, as
// every SDK does (VERIFICATION.md V2-4). Years 0000 to 9999 are valid. A
// non-string, a date without a time, a time without an offset or an impossible
// date, time or offset is not one.
func parseRFC3339(v interface{}) (time.Time, bool) {
	s, _ := v.(string)
	m := rfc3339Pattern.FindStringSubmatch(s)
	if m == nil || m[3] > "23" || m[4] > "59" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, s)
	return truncateToMillis(t), err == nil
}

// truncateToMillis drops what is below the millisecond, for any year.
func truncateToMillis(t time.Time) time.Time {
	return t.Add(-time.Duration(t.Nanosecond() % int(time.Millisecond)))
}

// nowMillis is the verification time at the precision timestamps compare at.
func nowMillis() time.Time {
	return truncateToMillis(time.Now().Round(0))
}

// sessionClockSkew is how far in the future a signed session start may be
// (VERIFICATION.md V2-4), the clock skew DCP-04 allows for timestamps.
const sessionClockSkew = 30 * time.Second

// secondsBetween is to minus from in seconds, from their milliseconds, without
// time.Duration's saturation at about 292 years.
func secondsBetween(from, to time.Time) float64 {
	return float64(to.UnixMilli()-from.UnixMilli()) / 1000
}

// verifySessionTimes checks the manifest's signed session window
// (VERIFICATION.md V2-4). session_expires_at must not have passed. A
// session_issued_at must not be more than sessionClockSkew in the future nor
// after session_expires_at. Both must be RFC 3339 timestamps, compared at
// millisecond precision; absent or null is no value. The policy's
// MaxSessionDurationSeconds bounds session_expires_at minus session_issued_at
// and requires both: signature.created_at is outside the signed manifest and
// is never read, and a session without an expiry is not one that never ends.
// RequireSessionExpiry requires session_expires_at under any policy.
func verifySessionTimes(manifest map[string]interface{}, policy VerifierPolicy, result *V2VerificationResult) {
	now := nowMillis()
	fail := func(format string, args ...interface{}) {
		result.Errors = append(result.Errors, fmt.Sprintf(format, args...))
	}

	var expires time.Time
	expiresPresent, hasExpires := false, false
	if raw, ok := manifest["session_expires_at"]; ok && raw != nil {
		expiresPresent = true
		var valid bool
		switch expires, valid = parseRFC3339(raw); {
		case !valid:
			fail("Invalid session_expires_at: %v", raw)
		case expires.Before(now):
			fail("Session expired at %v", raw)
		default:
			hasExpires = true
		}
	}

	var issued time.Time
	issuedPresent, hasIssued := false, false
	if raw, ok := manifest["session_issued_at"]; ok && raw != nil {
		issuedPresent = true
		var valid bool
		switch issued, valid = parseRFC3339(raw); {
		case !valid:
			fail("Invalid session_issued_at: %v", raw)
		case issued.After(now.Add(sessionClockSkew)):
			fail("session_issued_at %v is in the future", raw)
		case hasExpires && issued.After(expires):
			fail("session_issued_at is after session_expires_at")
		default:
			hasIssued = true
		}
	}

	if !expiresPresent && policy.RequireSessionExpiry {
		fail("Policy requires session_expires_at but manifest does not include it")
	}
	if policy.MaxSessionDurationSeconds <= 0 {
		return
	}
	switch {
	case !expiresPresent:
		fail("Policy max_session_duration_seconds requires session_expires_at in the manifest")
	case !hasExpires:
		// An invalid or passed expiry, reported above.
	case !issuedPresent:
		fail("Policy max_session_duration_seconds requires session_issued_at in the manifest")
	case hasIssued:
		if d := secondsBetween(issued, expires); d > float64(policy.MaxSessionDurationSeconds) {
			fail("Session duration %.0fs exceeds policy max of %ds", d, policy.MaxSessionDurationSeconds)
		}
	}
}

// verifyAudience applies the policy's audience binding: with
// RequireAudienceBinding the manifest must name its intended_verifier, and
// with VerifierID set too, name this verifier.
func verifyAudience(manifest map[string]interface{}, policy VerifierPolicy, result *V2VerificationResult) {
	if !policy.RequireAudienceBinding {
		return
	}
	intended, _ := manifest["intended_verifier"].(string)
	switch {
	case intended == "":
		result.Errors = append(result.Errors, "Policy requires audience binding but manifest does not include intended_verifier")
	case policy.VerifierID != "" && intended != policy.VerifierID:
		result.Errors = append(result.Errors, fmt.Sprintf("Bundle intended for verifier '%s', not '%s'", intended, policy.VerifierID))
	}
}

// sameID reports whether two identifiers are the same string; two missing or
// non-string values are not the same.
func sameID(a, b interface{}) bool {
	sa, okA := a.(string)
	sb, okB := b.(string)
	return okA && okB && sa == sb
}

// verifyConsistency checks that the artifacts describe one action, by one
// agent, for one principal (VERIFICATION.md V2-14). The signatures say who
// signed each artifact; these checks tie them together. It reads the decoded
// JSON, so a missing or non-string identifier never matches.
func verifyConsistency(bundle map[string]interface{}, result *V2VerificationResult) {
	rpr := artifactPayload(bundle, "responsible_principal_record")
	passport := artifactPayload(bundle, "agent_passport")
	intent := artifactPayload(bundle, "intent")
	policy := artifactPayload(bundle, "policy_decision")
	fail := func(format string, args ...interface{}) {
		result.Errors = append(result.Errors, fmt.Sprintf(format, args...))
	}

	if status, _ := passport["status"].(string); status != "active" && status != "declining" {
		fail("agent_passport status is %v, not active (DCP-05 § 3.1)", passport["status"])
	}
	if raw, ok := rpr["expires_at"]; ok && raw != nil {
		switch expires, valid := parseRFC3339(raw); {
		case !valid:
			fail("responsible_principal_record has an invalid expires_at: %v", raw)
		case expires.Before(time.Now()):
			fail("responsible_principal_record expired at %v", raw)
		}
	}
	if !sameID(passport["principal_binding_reference"], rpr["human_id"]) {
		fail("agent_passport principal_binding_reference is not the RPR human_id")
	}
	if !sameID(intent["agent_id"], passport["agent_id"]) {
		fail("intent agent_id is not the passport agent_id")
	}
	if !sameID(intent["human_id"], rpr["human_id"]) {
		fail("intent human_id is not the RPR human_id")
	}
	if !sameID(policy["intent_id"], intent["intent_id"]) {
		fail("policy_decision intent_id is not the intent intent_id")
	}
	// What an audit entry records for the policy decision. An escalated or
	// blocked action is valid evidence too.
	decision, _ := policy["decision"].(string)
	recorded, known := auditedDecision[decision]

	// The intent's payload hash, in the manifest's intent_hash form. An intent
	// that cannot be hashed (reported by verifyManifestHashes) matches nothing.
	var intentHash interface{}
	if sp, _ := bundle["intent"].(map[string]interface{}); sp["payload"] != nil {
		if canonical, err := CanonicalizeV2(sp["payload"]); err == nil {
			intentHash = "sha256:" + DualHashCanonical(canonical).SHA256
		}
	}
	entries, _ := bundle["audit_entries"].([]interface{})
	for i, raw := range entries {
		entry, _ := raw.(map[string]interface{})
		if !sameID(entry["intent_id"], intent["intent_id"]) {
			fail("audit_entries[%d] intent_id is not the intent intent_id", i)
		}
		if !sameID(entry["intent_hash"], intentHash) {
			fail("audit_entries[%d] intent_hash is not the intent payload hash", i)
		}
		if !sameID(entry["agent_id"], passport["agent_id"]) {
			fail("audit_entries[%d] agent_id is not the passport agent_id", i)
		}
		if !sameID(entry["human_id"], rpr["human_id"]) {
			fail("audit_entries[%d] human_id is not the RPR human_id", i)
		}
		if !known || !sameID(entry["policy_decision"], recorded) {
			fail("audit_entries[%d] policy_decision %v does not record the decision %v", i, entry["policy_decision"], policy["decision"])
		}
	}
}

// auditedDecision is what an audit entry's policy_decision records for each
// policy decision (VERIFICATION.md V2-14).
var auditedDecision = map[string]string{"approve": "approved", "escalate": "escalated", "block": "blocked"}

func verifySessionNonceConsistency(bundle map[string]interface{}, manifestNonce string, result *V2VerificationResult) {
	if manifestNonce == "" {
		return
	}
	// check reports a session_nonce that is missing or not the manifest's.
	check := func(where string, carrier interface{}) bool {
		obj, _ := carrier.(map[string]interface{})
		raw, present := obj["session_nonce"]
		switch {
		case !present || raw == nil:
			result.Errors = append(result.Errors, fmt.Sprintf("Missing session_nonce in %s", where))
		case !sameID(raw, manifestNonce):
			result.Errors = append(result.Errors, fmt.Sprintf("Session nonce mismatch in %s", where))
		default:
			return true
		}
		result.SessionBindingValid = false
		return false
	}
	for _, field := range []string{"responsible_principal_record", "agent_passport", "intent", "policy_decision"} {
		artifact, ok := bundle[field].(map[string]interface{})
		if !ok {
			continue // reported as missing by VerifySignedBundleV2
		}
		if !check(field, artifact["payload"]) {
			return
		}
	}
	// Every audit entry and carried PQ checkpoint carries it too (V2-4).
	for _, field := range []string{"audit_entries", "pq_checkpoints"} {
		entries, _ := bundle[field].([]interface{})
		for i, raw := range entries {
			if !check(fmt.Sprintf("%s[%d]", field, i), raw) {
				return
			}
		}
	}
}

// resolveVerificationMode sets the bundle's security tier and returns the mode it
// is checked against: the agent's risk_tier and intent can raise the policy mode
// but never take it below the tier's mode. It returns "" for a policy mode that
// is not a verification mode.
func resolveVerificationMode(bundle map[string]interface{}, policy VerifierPolicy, result *V2VerificationResult) string {
	policyMode := policy.DefaultMode
	riskTier, _ := artifactPayload(bundle, "agent_passport")["risk_tier"].(string)
	if override, ok := policy.RiskOverrides[riskTier]; ok && riskTier != "" {
		policyMode = override
	}
	if policyMode != "pq_only" && !slices.Contains(modeStrictness, policyMode) {
		return ""
	}
	tier := ComputeSecurityTier(SecurityTierInputFromPayloads(artifactPayload(bundle, "intent"), artifactPayload(bundle, "policy_decision")))
	result.ResolvedTier = tier.Tier
	result.VerificationMode = EffectiveVerificationMode(policyMode, tier.Tier)
	if result.VerificationMode == "classical_only" && policy.WarnClassicalOnlyDeprecated {
		result.Warnings = append(result.Warnings, "DEPRECATION: classical_only mode is deprecated in Phase 3")
	}
	return result.VerificationMode
}

// checkMode applies the verification mode and the policy's Phase 3 settings to
// one verified composite signature (VERIFICATION.md V2-7, V2-10), as the TS
// verifier does. A PQ signature that is present must verify in every mode;
// cvr.Valid covers both components for pq_over_classical.
func checkMode(mode string, policy VerifierPolicy, cs *CompositeSignature, cvr *CompositeVerifyResult) (errs, warnings []string) {
	if mode != "pq_only" && slices.Contains(policy.AdvisoryRejectedAlgs, cs.Classical.Alg) {
		errs = append(errs, fmt.Sprintf("Classical algorithm %s rejected by active advisory", cs.Classical.Alg))
	}
	if cs.PQ != nil && slices.Contains(policy.AdvisoryRejectedAlgs, cs.PQ.Alg) {
		errs = append(errs, fmt.Sprintf("PQ algorithm %s rejected by active advisory", cs.PQ.Alg))
	}
	if policy.WarnClassicalOnlyDeprecated && cs.Binding == "classical_only" {
		warnings = append(warnings, "DEPRECATION: classical-only signatures are deprecated. Migrate to hybrid or pq_only.")
	}
	switch {
	case mode == "pq_only":
		if cs.Binding != "pq_over_classical" || !cvr.PQValid {
			errs = append(errs, "PQ signature invalid or missing (pq_only)")
		} else if !cvr.ClassicalValid && !policy.AllowClassicalFallbackDisable {
			warnings = append(warnings, "classical signature not verified in pq_only mode")
		}
	case mode == "hybrid_required" && cs.Binding != "pq_over_classical":
		errs = append(errs, "hybrid_required needs a pq_over_classical signature, got "+cs.Binding)
	case !cvr.Valid:
		errs = append(errs, "signature verification failed")
	case cs.Binding == "classical_only" && mode == "hybrid_preferred":
		warnings = append(warnings, "classical_only binding (no PQ protection)")
	}
	return errs, warnings
}

// artifactPayload returns an artifact's payload object, or nil when the
// artifact or its payload is not a JSON object.
func artifactPayload(bundle map[string]interface{}, artifact string) map[string]interface{} {
	sp, _ := bundle[artifact].(map[string]interface{})
	payload, _ := sp["payload"].(map[string]interface{})
	return payload
}

// payloadKeys returns the key entries listed under field in an artifact's payload.
func payloadKeys(bundle map[string]interface{}, artifact, field string) []interface{} {
	keys, _ := artifactPayload(bundle, artifact)[field].([]interface{})
	return keys
}

// The algorithms each composite signature slot may hold.
var (
	classicalAlgs = map[string]bool{"ed25519": true}
	pqAlgs        = map[string]bool{"ml-dsa-65": true, "slh-dsa-192f": true}
)

// findKeyByKid returns the entry with that kid, or nil.
func findKeyByKid(keys []interface{}, kid string) map[string]interface{} {
	for _, k := range keys {
		entry, _ := k.(map[string]interface{})
		if id, _ := entry["kid"].(string); id != "" && id == kid {
			return entry
		}
	}
	return nil
}

// canonicalB64Bytes returns the bytes of v when it is canonical base64 (RFC
// 4648 § 4: standard alphabet, padded, zero trailing bits and nothing else, not
// even the line breaks the decoder skips).
func canonicalB64Bytes(v interface{}) ([]byte, bool) {
	s, ok := v.(string)
	if !ok {
		return nil, false
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(s)
	if err != nil || base64.StdEncoding.EncodeToString(raw) != s {
		return nil, false
	}
	return raw, true
}

// keyIdentityError says why a key entry cannot verify a signature
// (VERIFICATION.md V2-13): its public_key_b64 is not canonical base64, so
// verifiers could decode different bytes, or its kid is not derived from its
// alg and those bytes. It returns nil for a key that can.
func keyIdentityError(kid, alg string, publicKeyB64 interface{}) error {
	raw, ok := canonicalB64Bytes(publicKeyB64)
	if !ok {
		return fmt.Errorf("key %s public_key_b64 is not canonical base64 (V2-13)", kid)
	}
	if DeriveKid(alg, raw) != kid {
		return fmt.Errorf("key %s is not derived from its public key (V2-13)", kid)
	}
	return nil
}

// verifyCompositeSig verifies a composite_sig over payload with the keys it
// names by kid in keys, the list keysLabel names (VERIFICATION.md V2-6, V2-7):
// pq_over_classical is valid only when both components verify; classical_only
// carries no PQ signature. A key whose kid is not derived from it verifies
// nothing (V2-13).
func verifyCompositeSig(registry *AlgorithmRegistry, context string, payload, csRaw interface{}, keys []interface{}, keysLabel string) (*CompositeSignature, *CompositeVerifyResult, error) {
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

	classicalKey := findKeyByKid(keys, cs.Classical.Kid)
	if classicalKey == nil {
		return nil, nil, fmt.Errorf("classical signer key kid=%s not found in %s", cs.Classical.Kid, keysLabel)
	}
	classicalAlg, _ := classicalKey["alg"].(string)
	if classicalAlg != cs.Classical.Alg {
		return nil, nil, fmt.Errorf("classical signer key kid=%s is %s, not %s", cs.Classical.Kid, classicalAlg, cs.Classical.Alg)
	}
	var pqKey map[string]interface{}
	if cs.PQ != nil {
		if pqKey = findKeyByKid(keys, cs.PQ.Kid); pqKey == nil {
			return nil, nil, fmt.Errorf("PQ signer key kid=%s not found in %s", cs.PQ.Kid, keysLabel)
		}
		if pqAlg, _ := pqKey["alg"].(string); pqAlg != cs.PQ.Alg {
			return nil, nil, fmt.Errorf("PQ signer key kid=%s is %s, not %s", cs.PQ.Kid, pqAlg, cs.PQ.Alg)
		}
	}
	if err := keyIdentityError(cs.Classical.Kid, cs.Classical.Alg, classicalKey["public_key_b64"]); err != nil {
		return nil, nil, err
	}
	classicalPK, _ := classicalKey["public_key_b64"].(string)
	var pqPK string
	if pqKey != nil {
		if err := keyIdentityError(cs.PQ.Kid, cs.PQ.Alg, pqKey["public_key_b64"]); err != nil {
			return nil, nil, err
		}
		pqPK, _ = pqKey["public_key_b64"].(string)
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

func verifyBundleSignature(registry *AlgorithmRegistry, bundle, signature, manifest map[string]interface{}, mode string, policy VerifierPolicy, result *V2VerificationResult) {
	csRaw, ok := signature["composite_sig"]
	if !ok {
		result.Errors = append(result.Errors, "Missing composite_sig in signature")
		return
	}
	if manifest == nil {
		return
	}

	// The signer is the principal: only the RPR binding_keys verify it
	// (VERIFICATION.md V2-6, V2-7). The agent signs its own passport, so its
	// keys cannot vouch for the principal.
	keys := payloadKeys(bundle, "responsible_principal_record", "binding_keys")
	cs, cvr, err := verifyCompositeSig(registry, CtxBundle, manifest, csRaw, keys, "RPR binding_keys")
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("Bundle signature: %s", err))
		return
	}

	result.ClassicalValid = cvr.ClassicalValid
	result.PQValid = cvr.PQValid

	errs, warnings := checkMode(mode, policy, cs, cvr)
	for _, e := range errs {
		result.Errors = append(result.Errors, "Bundle "+e)
	}
	for _, w := range warnings {
		result.Warnings = append(result.Warnings, "Bundle "+w)
	}
}

// verifySignatureMetadata checks that the unsigned signature block does not
// contradict what is signed (VERIFICATION.md V2-4): signer.id is the RPR
// human_id, signer.kids are the composite_sig kids (the classical one and then
// the PQ one when present), manifest_hash is the SHA-256 of the canonical
// manifest and hash_alg is sha256 or sha256+sha3-256.
func verifySignatureMetadata(bundle, signature, manifest map[string]interface{}, result *V2VerificationResult) {
	signer, _ := signature["signer"].(map[string]interface{})
	if !sameID(signer["id"], artifactPayload(bundle, "responsible_principal_record")["human_id"]) {
		result.Errors = append(result.Errors, fmt.Sprintf("Bundle signature: signer id %v is not the RPR human_id", signer["id"]))
	}
	cs, _ := signature["composite_sig"].(map[string]interface{})
	classical, _ := cs["classical"].(map[string]interface{})
	signed := []interface{}{classical["kid"]}
	if pq := cs["pq"]; pq != nil {
		pqEntry, _ := pq.(map[string]interface{})
		signed = append(signed, pqEntry["kid"])
	}
	kids, ok := signer["kids"].([]interface{})
	match := ok && len(kids) == len(signed)
	for i := 0; match && i < len(kids); i++ {
		match = sameID(kids[i], signed[i])
	}
	if !match {
		result.Errors = append(result.Errors, "Bundle signature: signer kids do not name the bundle signature keys")
	}
	var manifestHash interface{}
	if canonical, err := CanonicalizeV2(manifest); manifest != nil && err == nil {
		manifestHash = "sha256:" + DualHashCanonical(canonical).SHA256
	}
	if !sameID(signature["manifest_hash"], manifestHash) {
		result.Errors = append(result.Errors, "Bundle signature: manifest_hash is not the hash of the manifest")
	}
	if alg, _ := signature["hash_alg"].(string); alg != "sha256" && alg != "sha256+sha3-256" {
		result.Errors = append(result.Errors, fmt.Sprintf("Bundle signature: hash_alg %v is not sha256 or sha256+sha3-256", signature["hash_alg"]))
	}
}

// verifyArtifactSignatures checks each artifact's own composite_sig
// (VERIFICATION.md V2-8): the principal signs the RPR with its binding_keys,
// the agent signs the rest with its passport keys.
func verifyArtifactSignatures(registry *AlgorithmRegistry, bundle map[string]interface{}, mode string, policy VerifierPolicy, result *V2VerificationResult) {
	rprKeys := payloadKeys(bundle, "responsible_principal_record", "binding_keys")
	agentKeys := payloadKeys(bundle, "agent_passport", "keys")
	artifacts := []struct {
		field, context, keysLabel string
		keys                      []interface{}
	}{
		{"responsible_principal_record", CtxResponsiblePrincipal, "RPR binding_keys", rprKeys},
		{"agent_passport", CtxAgentPassport, "passport keys", agentKeys},
		{"intent", CtxIntent, "passport keys", agentKeys},
		{"policy_decision", CtxPolicyDecision, "passport keys", agentKeys},
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
		cs, cvr, err := verifyCompositeSig(registry, a.context, payload, sp["composite_sig"], a.keys, a.keysLabel)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s signature: %s", a.field, err))
			continue
		}
		errs, warnings := checkMode(mode, policy, cs, cvr)
		for _, e := range errs {
			result.Errors = append(result.Errors, fmt.Sprintf("%s %s", a.field, e))
		}
		for _, w := range warnings {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s %s", a.field, w))
		}
	}
}

// jsonArray returns v as a JSON array: absent or null is an empty one, and
// ok is false for any other value that is not an array.
func jsonArray(v interface{}) (arr []interface{}, ok bool) {
	if v == nil {
		return []interface{}{}, true
	}
	arr, ok = v.([]interface{})
	return arr, ok
}

// auditIndex returns the index of the first audit entry whose audit_id is id,
// or -1.
func auditIndex(entries []interface{}, id interface{}) int {
	for i, raw := range entries {
		if entry, _ := raw.(map[string]interface{}); sameID(entry["audit_id"], id) {
			return i
		}
	}
	return -1
}

// verifyPQCheckpoints checks the bundle's PQ checkpoints (VERIFICATION.md
// V2-12): the bundle carries exactly the checkpoints its signed manifest lists,
// once each; each has the manifest's session_nonce, covers a contiguous run of
// audit entries with their Merkle root, and is signed by the agent with both
// algorithms (the PQ one alone under pq_only), with the passport keys.
func verifyPQCheckpoints(registry *AlgorithmRegistry, bundle, manifest map[string]interface{}, mode string, policy VerifierPolicy, result *V2VerificationResult) {
	if manifest == nil {
		return // reported as missing by VerifySignedBundleV2
	}
	listed, listedOK := jsonArray(manifest["pq_checkpoints"])
	carried, carriedOK := jsonArray(bundle["pq_checkpoints"])
	if !listedOK || !carriedOK {
		result.Errors = append(result.Errors, "pq_checkpoints: manifest list and bundle checkpoints must be arrays")
		return
	}
	var errs []string
	var ids []string
	byID := map[string]map[string]interface{}{}
	for _, raw := range carried {
		cp, _ := raw.(map[string]interface{})
		id, ok := cp["checkpoint_id"].(string)
		if _, dup := byID[id]; !ok || dup {
			errs = append(errs, fmt.Sprintf("pq_checkpoints: checkpoint %v is missing an id or carried twice", cp["checkpoint_id"]))
			continue
		}
		byID[id] = cp
		ids = append(ids, id)
	}
	listedIDs := map[string]bool{}
	for _, raw := range listed {
		id, ok := raw.(string)
		switch {
		case ok && listedIDs[id]:
			errs = append(errs, fmt.Sprintf("pq_checkpoints: the manifest lists %s twice", id))
		case !ok || byID[id] == nil:
			errs = append(errs, fmt.Sprintf("pq_checkpoints: manifest lists %v, which the bundle does not carry", raw))
		}
		if ok {
			listedIDs[id] = true
		}
	}
	for _, id := range ids {
		if !listedIDs[id] {
			errs = append(errs, fmt.Sprintf("pq_checkpoints: %s is not listed in the manifest", id))
		}
	}
	if len(errs) > 0 {
		result.Errors = append(result.Errors, errs...)
		return
	}

	entries, _ := bundle["audit_entries"].([]interface{})
	passportKeys := payloadKeys(bundle, "agent_passport", "keys")
	cpMode := "hybrid_required"
	if mode == "pq_only" {
		cpMode = "pq_only"
	}
	for _, id := range ids {
		cp := byID[id]
		fail := func(msg string) {
			result.Errors = append(result.Errors, fmt.Sprintf("pq_checkpoints[%s]: %s", id, msg))
		}
		if !sameID(cp["session_nonce"], manifest["session_nonce"]) {
			fail("session_nonce is not the manifest's")
			continue
		}
		rng, _ := cp["event_range"].(map[string]interface{})
		from, to := auditIndex(entries, rng["from_audit_id"]), auditIndex(entries, rng["to_audit_id"])
		if count, ok := rng["count"].(float64); from < 0 || to < from || !ok || count != float64(to-from+1) {
			fail("event_range does not match the audit entries")
			continue
		}
		run := make([]map[string]interface{}, 0, to-from+1)
		for _, raw := range entries[from : to+1] {
			if entry, ok := raw.(map[string]interface{}); ok {
				run = append(run, entry)
			}
		}
		root, err := AuditEventsMerkleRoot(run)
		if err != nil || len(run) != to-from+1 || !sameID(cp["merkle_root"], "sha256:"+root) {
			fail("merkle_root does not match its audit entries")
			continue
		}
		payload := make(map[string]interface{}, len(cp))
		for k, v := range cp {
			if k != "composite_sig" {
				payload[k] = v
			}
		}
		cs, cvr, err := verifyCompositeSig(registry, CtxAuditEvent, payload, cp["composite_sig"], passportKeys, "passport keys")
		if err != nil {
			fail(err.Error())
			continue
		}
		modeErrs, warnings := checkMode(cpMode, policy, cs, cvr)
		for _, e := range modeErrs {
			fail(e)
		}
		for _, w := range warnings {
			result.Warnings = append(result.Warnings, fmt.Sprintf("pq_checkpoints[%s]: %s", id, w))
		}
	}
}

// verifyAuditTrail ties the audit entries to the signed manifest, as the TS
// verifier does: audit_count, audit_merkle_root, and the prev_hash chain that
// starts at GENESIS.
func verifyAuditTrail(bundle, manifest map[string]interface{}, result *V2VerificationResult) {
	if manifest == nil {
		return // reported as missing by VerifySignedBundleV2
	}
	entries, ok := bundle["audit_entries"].([]interface{})
	if !ok {
		result.Errors = append(result.Errors, "Missing audit_entries in bundle")
		return
	}
	if count, ok := manifest["audit_count"].(float64); !ok || count != float64(len(entries)) {
		result.Errors = append(result.Errors, fmt.Sprintf("Manifest audit_count=%v but bundle has %d entries", manifest["audit_count"], len(entries)))
	}

	leaves := make([]string, 0, len(entries))
	prev := "GENESIS"
	for i, raw := range entries {
		entry, _ := raw.(map[string]interface{})
		canonical, err := CanonicalizeV2(raw)
		if entry == nil || err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Cannot hash audit entry %d", i))
			return
		}
		if prevHash, _ := entry["prev_hash"].(string); prevHash != prev {
			result.Errors = append(result.Errors, fmt.Sprintf("Audit hash chain broken at entry %d: expected %s", i, prev))
			return
		}
		leaf := DualHashCanonical(canonical).SHA256
		leaves = append(leaves, leaf)
		prev = "sha256:" + leaf
	}
	// An empty audit trail has the root 64 zeros (VERIFICATION.md V2-3), as
	// BuildBundleV2 writes it.
	expected := strings.Repeat("0", 64)
	if len(leaves) > 0 {
		expected = computeMerkleRoot(leaves, merkleHashSHA256)
	}
	if root, _ := manifest["audit_merkle_root"].(string); root != "sha256:"+expected {
		result.Errors = append(result.Errors, "Manifest audit_merkle_root mismatch")
	}
}

// verifyKeyValidity rejects a revoked or expired key among those that can sign:
// the passport keys and the RPR binding_keys (VERIFICATION.md V2-13).
func verifyKeyValidity(bundle map[string]interface{}, result *V2VerificationResult) {
	keys := append(append([]interface{}{}, payloadKeys(bundle, "agent_passport", "keys")...),
		payloadKeys(bundle, "responsible_principal_record", "binding_keys")...)
	now := time.Now()
	for _, raw := range keys {
		key, _ := raw.(map[string]interface{})
		kid, _ := key["kid"].(string)
		if status, _ := key["status"].(string); status == "revoked" || status == "expired" {
			result.Errors = append(result.Errors, fmt.Sprintf("Key %s is %s", kid, status))
		}
		if raw, ok := key["expires_at"]; ok && raw != nil {
			switch expires, valid := parseRFC3339(raw); {
			case !valid:
				result.Errors = append(result.Errors, fmt.Sprintf("Key %s has an invalid expires_at: %v", kid, raw))
			case expires.Before(now):
				result.Errors = append(result.Errors, fmt.Sprintf("Key %s has expired", kid))
			}
		}
	}
}
