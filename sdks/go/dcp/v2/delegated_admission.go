package v2

// Delegated admission (opt-in): a leaf bundle admitted together with the DCP-09 mandate chain it acts under
// and a bundle of every delegating agent, at one instant, against the operator's trust set, policy and
// revocation sources. Go port of the TypeScript SDK's core/delegated-admission.ts; design:
// docs/reviews/mp02-security-composition-design.md (v0.2 § 1).
//
// Everything is verified here, from the evidence itself: no verification result, key map or boolean is taken
// from the caller. The chain floor (DCP-09 § 3.5.2 rule 6) is fed to the leaf's own tier computation, so it
// raises the mode its signatures are verified in. Admission is not authorization: ActionAuthorized is always
// false, and activation (the agent's acknowledgment, DCP-09 § 3.3) is not evaluated yet.
//
// Existing APIs are unchanged: VerifyMandateChain, VerifySignedBundleV2At and AdmitSignedBundleV2 keep their
// behavior; the stricter checks below apply to this function only.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
)

// DelegatedEvidence is what the request may carry: JSON documents, copied before anything is read.
type DelegatedEvidence struct {
	// SignedBundle is the bundle of the acting agent: the agent_id of the chain's last mandate.
	SignedBundle []byte
	// MandateChain is the JSON array of the mandate chain, root first.
	MandateChain []byte
	// DelegatorBundles holds one bundle of each delegating agent (every mandate's agent_id but the last).
	DelegatorBundles [][]byte
}

// DelegatedOperator is what only the operator sets (spec/profiles/admission A2), never the request.
type DelegatedOperator struct {
	// Trust is a store from NewPrincipalTrustStore, used as it is (it cannot change after loading), or
	// TrustSetJSON a trust set, loaded at the call. Exactly one is required.
	Trust        *PrincipalTrustStore
	TrustSetJSON json.RawMessage
	// Profile is a strict-v1 profile from ResolveStrictV1Profile, or ProfileJSON its configuration, loaded at
	// the call. At most one; a profile excludes Policy and MaxRevocationAgeSeconds.
	Profile     *StrictV1Profile
	ProfileJSON json.RawMessage
	// Policy is the verifier policy without a profile, as JSON: it is checked against
	// schemas/v2/verifier_policy.schema.json (unknown members, types, enumerations, bounds) before use. nil:
	// DefaultVerifierPolicy.
	Policy json.RawMessage
	// Revocation is the snapshot for every agent and key of the composition; MandateRevocation the snapshot
	// for every mandate of the chain ({"checked_at", "mandates": {id: status}}). nil or null: the source could
	// not answer.
	Revocation        json.RawMessage
	MandateRevocation json.RawMessage
	// MaxRevocationAgeSeconds is required without a profile, from 1 to 300; with a profile it must be 0, and
	// the profile's applies.
	MaxRevocationAgeSeconds int
	// Now is the instant of every check, read once. Zero: the current time.
	Now time.Time
}

// DelegatedChain describes the chain of a delegated admission.
type DelegatedChain struct {
	Depth      int      `json:"depth"`
	MandateIDs []string `json:"mandate_ids"`
	// EffectiveFloor is the verified chain's effective tier, or nil.
	EffectiveFloor *string `json:"effective_floor"`
	// LeafAuthorityScope is a copy of the leaf mandate's authority_scope, not evaluated against any action.
	LeafAuthorityScope interface{} `json:"leaf_authority_scope"`
}

// DelegatedInputs records what a delegated admission was evaluated against.
type DelegatedInputs struct {
	Now                        int64   `json:"now"`
	LeafBundleSHA256           *string `json:"leaf_bundle_sha256"`
	TrustSetVersion            string  `json:"trust_set_version"`
	RevocationCheckedAt        *string `json:"revocation_checked_at"`
	MandateRevocationCheckedAt *string `json:"mandate_revocation_checked_at"`
}

// DelegatedAdmissionResult is the outcome of AdmitDelegatedBundleV2.
type DelegatedAdmissionResult struct {
	// Admitted: the leaf, the chain and every delegator verified, anchored and not revoked, with no code added.
	Admitted bool `json:"admitted"`
	// DelegationVerified: the chain verified with keys taken from the verified bundles and is tied to the
	// principal and the leaf.
	DelegationVerified bool `json:"delegation_verified"`
	// Activation is "not_evaluated": the agent's acknowledgment (DCP-09 § 3.3) is not evaluated yet.
	Activation string `json:"activation"`
	// DelegationActive and ActionAuthorized are always false.
	DelegationActive bool `json:"delegation_active"`
	ActionAuthorized bool `json:"action_authorized"`
	// SecurityTier and VerificationMode are the leaf's, from its verification with the chain floor; nil when
	// it did not verify.
	SecurityTier     *string            `json:"security_tier"`
	VerificationMode *string            `json:"verification_mode"`
	Chain            *DelegatedChain    `json:"chain"`
	Leaf             *AdmissionResult   `json:"leaf"`
	Delegators       []*AdmissionResult `json:"delegators"`
	Inputs           DelegatedInputs    `json:"inputs"`
	Errors           []AdmissionError   `json:"errors"`
}

const delegatedMaxSeconds = 300

var (
	delegatedNonce    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	delegatedKid      = regexp.MustCompile(`^[0-9a-f]{32}$`)
	delegatedSigBytes = map[string]int{"ed25519": 64, "ml-dsa-65": 3309, "slh-dsa-192f": 35664}
	delegatedTiers    = []string{"routine", "standard", "elevated", "maximum"}
)

// The shape of schemas/v2/delegation_mandate.schema.json, checked by the parity test (through export_test.go).
var (
	mandateFields       = []string{"dcp_version", "mandate_id", "session_nonce", "human_id", "agent_id", "authority_scope", "valid_from", "valid_until", "revocable", "timestamp", "parent_mandate_id", "delegation_depth", "sub_delegation", "minimum_security_tier", "human_composite_sig", "delegator_composite_sig"}
	mandateRequired     = []string{"dcp_version", "mandate_id", "session_nonce", "human_id", "agent_id", "authority_scope", "valid_from", "valid_until", "revocable", "timestamp"}
	scopeFields         = []string{"domain", "actions_permitted", "data_classes", "limits"}
	scopeRequired       = []string{"domain", "actions_permitted"}
	subDelegationFields = []string{"permitted", "max_depth"}
)

// policyFieldRule is one member of schemas/v2/verifier_policy.schema.json: its type ("string", "boolean",
// "integer", "string_array", "mode" or "risk_overrides"), and its minimum or minimum number of items (-1 none).
type policyFieldRule struct {
	Type     string
	Minimum  int
	MinItems int
}

// policyFields and policyRequired are the members of schemas/v2/verifier_policy.schema.json, checked by the
// parity test (through export_test.go).
var (
	policyFields = map[string]policyFieldRule{
		"default_mode":                     {"mode", -1, -1},
		"risk_overrides":                   {"risk_overrides", -1, -1},
		"min_classical":                    {"integer", 0, -1},
		"min_pq":                           {"integer", 0, -1},
		"accepted_classical_algs":          {"string_array", -1, 1},
		"accepted_pq_algs":                 {"string_array", -1, -1},
		"accepted_hash_algs":               {"string_array", -1, 1},
		"require_session_binding":          {"boolean", -1, -1},
		"require_composite_binding":        {"boolean", -1, -1},
		"max_key_age_days":                 {"integer", 1, -1},
		"allow_v1_bundles":                 {"boolean", -1, -1},
		"allow_classical_fallback_disable": {"boolean", -1, -1},
		"warn_classical_only_deprecated":   {"boolean", -1, -1},
		"advisory_rejected_algs":           {"string_array", -1, -1},
		"require_session_expiry":           {"boolean", -1, -1},
		"max_session_duration_seconds":     {"integer", 0, -1},
		"require_audience_binding":         {"boolean", -1, -1},
		"verifier_id":                      {"string", -1, -1},
	}
	policyRequired = []string{"default_mode", "risk_overrides", "min_classical", "min_pq", "accepted_classical_algs", "accepted_pq_algs", "accepted_hash_algs", "require_session_binding", "require_composite_binding", "max_key_age_days", "allow_v1_bundles"}
)

var policyModes = []string{"classical_only", "pq_only", "hybrid_required", "hybrid_preferred"}

// checkVerifierPolicy checks a verifier policy given without a profile against the policy schema: no unknown
// member (CONFIG_UNKNOWN_FIELD), every required member, each member of its type, enumeration and bounds
// (CONFIG_INVALID_VALUE). An integer is a JSON integer (300 or 300.0, never a bool or 300.5). It returns the
// policy the verifier takes; nothing is defaulted.
func checkVerifierPolicy(raw json.RawMessage) (VerifierPolicy, error) {
	decoded, err := decodeJSONValue(raw)
	if err != nil {
		return VerifierPolicy{}, configError("CONFIG_INVALID_VALUE", "policy is not JSON: %v", err)
	}
	m, ok := decoded.(map[string]interface{})
	if !ok {
		return VerifierPolicy{}, configError("CONFIG_INVALID_VALUE", "policy must be an object")
	}
	for _, k := range slices.Sorted(mapsKeys(m)) {
		if _, known := policyFields[k]; !known {
			return VerifierPolicy{}, configError("CONFIG_UNKNOWN_FIELD", "policy: unknown field %s", printable(k))
		}
	}
	for _, k := range policyRequired {
		if _, present := m[k]; !present {
			return VerifierPolicy{}, configError("CONFIG_INVALID_VALUE", "policy.%s is required", k)
		}
	}
	for _, k := range slices.Sorted(mapsKeys(m)) {
		rule, value := policyFields[k], m[k]
		bad := func(what string) error { return configError("CONFIG_INVALID_VALUE", "policy.%s %s", k, what) }
		switch rule.Type {
		case "string":
			if _, ok := value.(string); !ok {
				return VerifierPolicy{}, bad("must be a string")
			}
		case "boolean":
			if _, ok := value.(bool); !ok {
				return VerifierPolicy{}, bad("must be a boolean")
			}
		case "integer":
			f, ok := jsonInteger(value)
			if !ok {
				return VerifierPolicy{}, bad("must be an integer")
			}
			if rule.Minimum >= 0 && f < float64(rule.Minimum) {
				return VerifierPolicy{}, bad(fmt.Sprintf("must be at least %d", rule.Minimum))
			}
		case "string_array":
			list, ok := stringList(value)
			if !ok {
				return VerifierPolicy{}, bad("must be a list of strings")
			}
			if rule.MinItems >= 0 && len(list) < rule.MinItems {
				return VerifierPolicy{}, bad(fmt.Sprintf("must have at least %d item(s)", rule.MinItems))
			}
		case "mode":
			if s, ok := value.(string); !ok || !slices.Contains(policyModes, s) {
				return VerifierPolicy{}, bad("must be a verification mode")
			}
		case "risk_overrides":
			o, ok := value.(map[string]interface{})
			if !ok {
				return VerifierPolicy{}, bad("must be an object")
			}
			for _, tier := range slices.Sorted(mapsKeys(o)) {
				if !slices.Contains([]string{"low", "medium", "high"}, tier) {
					return VerifierPolicy{}, configError("CONFIG_UNKNOWN_FIELD", "policy.risk_overrides: unknown field %s", printable(tier))
				}
			}
			for _, tier := range []string{"low", "medium", "high"} {
				if s, ok := o[tier].(string); !ok || !slices.Contains(policyModes, s) {
					return VerifierPolicy{}, bad("." + tier + " must be a verification mode")
				}
			}
		}
	}
	if err := checkPolicyContract(m); err != nil {
		return VerifierPolicy{}, err
	}
	integer := func(k string) int { f, _ := jsonInteger(m[k]); return int(f) }
	boolean := func(k string) bool { b, _ := m[k].(bool); return b }
	list := func(k string) []string { l, _ := stringList(m[k]); return l }
	overrides := map[string]string{}
	for tier, mode := range m["risk_overrides"].(map[string]interface{}) {
		overrides[tier] = mode.(string)
	}
	policy := VerifierPolicy{
		DefaultMode:                   m["default_mode"].(string),
		RiskOverrides:                 overrides,
		MinClassical:                  integer("min_classical"),
		MinPQ:                         integer("min_pq"),
		AcceptedClassicalAlgs:         list("accepted_classical_algs"),
		AcceptedPQAlgs:                list("accepted_pq_algs"),
		AcceptedHashAlgs:              list("accepted_hash_algs"),
		RequireSessionBinding:         boolean("require_session_binding"),
		RequireCompositeBinding:       boolean("require_composite_binding"),
		MaxKeyAgeDays:                 integer("max_key_age_days"),
		AllowV1Bundles:                boolean("allow_v1_bundles"),
		AllowClassicalFallbackDisable: boolean("allow_classical_fallback_disable"),
		WarnClassicalOnlyDeprecated:   boolean("warn_classical_only_deprecated"),
		AdvisoryRejectedAlgs:          list("advisory_rejected_algs"),
		MaxSessionDurationSeconds:     integer("max_session_duration_seconds"),
		RequireSessionExpiry:          boolean("require_session_expiry"),
		RequireAudienceBinding:        boolean("require_audience_binding"),
	}
	if id, ok := m["verifier_id"].(string); ok {
		policy.VerifierID = id
	}
	return policy, nil
}

// policyContractMaxSession is the largest max_session_duration_seconds this API takes: an int32, so every
// SDK holds it without overflow. It is a domain of this API's operator parameter, not a protocol limit.
const policyContractMaxSession = 2147483647

// checkPolicyContract is the policy contract of the composition (design R4): the values of the members no
// verifier applies as a control are the ones that add none. min_pq 1; min_classical 1, or 0 when every mode
// is pq_only; require_composite_binding true, or false when every mode is pq_only; require_session_binding
// true; accepted_hash_algs exactly the set {sha256, sha384}; max_key_age_days 365 (it only changes
// warnings, never a verdict); max_session_duration_seconds from 0 to 2147483647. The other members are
// applied by every SDK verifier, or have no effect by norm (allow_v1_bundles, admission § 5.1 step 2; the
// warnings of V2-10). Anything else is CONFIG_INVALID_VALUE: a control that would not be applied.
func checkPolicyContract(m map[string]interface{}) error {
	overrides, _ := m["risk_overrides"].(map[string]interface{})
	allPQ := m["default_mode"] == "pq_only" && overrides["low"] == "pq_only" && overrides["medium"] == "pq_only" && overrides["high"] == "pq_only"
	integer := func(k string) float64 { f, _ := jsonInteger(m[k]); return f }
	invalid := func(format string, args ...interface{}) error {
		return configError("CONFIG_INVALID_VALUE", "policy contract: "+format, args...)
	}
	if integer("min_pq") != 1 {
		return invalid("min_pq must be 1: the effective mode decides whether a PQ component is required")
	}
	if c := integer("min_classical"); c != 1 && !(c == 0 && allPQ) {
		return invalid("min_classical must be 1, or 0 when every mode is pq_only")
	}
	if b, _ := m["require_composite_binding"].(bool); !b && !allPQ {
		return invalid("require_composite_binding must be true, or false when every mode is pq_only")
	}
	if b, _ := m["require_session_binding"].(bool); !b {
		return invalid("require_session_binding must be true (V2-4)")
	}
	if hashes, _ := stringList(m["accepted_hash_algs"]); !isDefaultHashSet(hashes) {
		return invalid("accepted_hash_algs must be the set sha256, sha384")
	}
	if integer("max_key_age_days") != 365 {
		return invalid("max_key_age_days must be 365")
	}
	if raw, present := m["max_session_duration_seconds"]; present {
		if f, _ := jsonInteger(raw); f > policyContractMaxSession {
			return invalid("max_session_duration_seconds must be at most %d", policyContractMaxSession)
		}
	}
	return nil
}

// isDefaultHashSet: exactly sha256 and sha384, in any order, each once.
func isDefaultHashSet(hashes []string) bool {
	return len(hashes) == 2 && slices.Contains(hashes, "sha256") && slices.Contains(hashes, "sha384")
}

// allModesPQOnly: the policy's default mode and every risk override are pq_only.
func allModesPQOnly(p VerifierPolicy) bool {
	if p.DefaultMode != "pq_only" {
		return false
	}
	for _, tier := range []string{"low", "medium", "high"} {
		if p.RiskOverrides[tier] != "pq_only" {
			return false
		}
	}
	return true
}

func mapsKeys(m map[string]interface{}) func(func(string) bool) {
	return func(yield func(string) bool) {
		for k := range m {
			if !yield(k) {
				return
			}
		}
	}
}

// ── Mandate preflight (this function only) ──

// jsonIntegerValue is a decoded JSON integer (float64 from encoding/json, or json.Number): 1 and 1.0 are, a
// bool and 1.5 are not.
func jsonIntegerValue(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, !math.IsInf(x, 0) && !math.IsNaN(x) && x == math.Trunc(x)
	case json.Number:
		return jsonInteger(x)
	}
	return 0, false
}

func minLength(v interface{}, n int) bool {
	s, ok := v.(string)
	return ok && len([]rune(s)) >= n
}

func nonEmptyStringList(v interface{}) bool {
	list, ok := stringList(v)
	return ok && !slices.Contains(list, "")
}

func signatureSlotError(sig interface{}, field string) string {
	s, ok := sig.(map[string]interface{})
	if !ok {
		return field + " is not an object"
	}
	for _, k := range slices.Sorted(mapsKeys(s)) {
		if !slices.Contains([]string{"classical", "pq", "binding"}, k) {
			return fmt.Sprintf("%s has unknown member %s", field, printable(k))
		}
	}
	if s["binding"] != "pq_over_classical" {
		return field + " binding must be pq_over_classical"
	}
	for _, c := range []struct {
		name string
		algs []string
	}{{"classical", []string{"ed25519"}}, {"pq", []string{"ml-dsa-65", "slh-dsa-192f"}}} {
		at := field + "." + c.name
		entry, ok := s[c.name].(map[string]interface{})
		if !ok {
			return at + " is not an object"
		}
		for _, k := range slices.Sorted(mapsKeys(entry)) {
			if !slices.Contains([]string{"alg", "kid", "sig_b64"}, k) {
				return fmt.Sprintf("%s has unknown member %s", at, printable(k))
			}
		}
		alg, _ := entry["alg"].(string)
		if !slices.Contains(c.algs, alg) {
			return fmt.Sprintf("%s.alg %s is not a %s algorithm", at, printable(entry["alg"]), c.name)
		}
		if kid, ok := entry["kid"].(string); !ok || !delegatedKid.MatchString(kid) {
			return at + ".kid is not 32 lowercase hex digits"
		}
		raw, canonical := canonicalB64Bytes(entry["sig_b64"])
		if !canonical {
			return at + ".sig_b64 is not canonical base64 (V2-5)"
		}
		if len(raw) != delegatedSigBytes[alg] {
			return fmt.Sprintf("%s.sig_b64 is %d bytes, not a %s signature (%d)", at, len(raw), alg, delegatedSigBytes[alg])
		}
	}
	return ""
}

// scopeShapeErrors is authority_scope as the schema has it: a non-empty array of closed objects; domain a
// non-empty string; actions_permitted and data_classes lists of non-empty strings (an empty list is allowed);
// limits an object whose members are not constrained here (the schema leaves it open).
func scopeShapeErrors(scope interface{}) []string {
	items, ok := scope.([]interface{})
	if !ok || len(items) == 0 {
		return []string{"authority_scope must be a non-empty array"}
	}
	var errors []string
	for j, item := range items {
		w := fmt.Sprintf("authority_scope[%d]", j)
		e, ok := item.(map[string]interface{})
		if !ok {
			errors = append(errors, w+" is not an object")
			continue
		}
		for _, k := range slices.Sorted(mapsKeys(e)) {
			if !slices.Contains(scopeFields, k) {
				errors = append(errors, fmt.Sprintf("%s has unknown member %s", w, printable(k)))
			}
		}
		for _, k := range scopeRequired {
			if _, present := e[k]; !present {
				errors = append(errors, w+" is missing "+k)
			}
		}
		if d, present := e["domain"]; present && !minLength(d, 1) {
			errors = append(errors, w+".domain must be a non-empty string")
		}
		for _, k := range []string{"actions_permitted", "data_classes"} {
			if v, present := e[k]; present && !nonEmptyStringList(v) {
				errors = append(errors, w+"."+k+" must be a list of non-empty strings")
			}
		}
		if l, present := e["limits"]; present {
			if _, ok := l.(map[string]interface{}); !ok {
				errors = append(errors, w+".limits must be an object")
			}
		}
	}
	return errors
}

func mandatePreflight(value interface{}, i int) []string {
	at := func(e string) string { return fmt.Sprintf("mandate[%d]: %s", i, e) }
	m, ok := value.(map[string]interface{})
	if !ok {
		return []string{at("not an object")}
	}
	var errors []string
	for _, k := range slices.Sorted(mapsKeys(m)) {
		if !slices.Contains(mandateFields, k) {
			errors = append(errors, at("unknown field "+printable(k)))
		}
	}
	for _, k := range mandateRequired {
		if _, present := m[k]; !present {
			errors = append(errors, at("missing "+k))
		}
	}
	if m["dcp_version"] != "2.0" {
		errors = append(errors, at(`dcp_version must be "2.0"`))
	}
	if nonce, ok := m["session_nonce"].(string); !ok || !delegatedNonce.MatchString(nonce) {
		errors = append(errors, at("session_nonce is not 64 lowercase hex digits"))
	}
	for _, f := range []string{"mandate_id", "human_id", "agent_id"} {
		if !minLength(m[f], 6) {
			errors = append(errors, at(f+" must be a string of at least 6 characters"))
		}
	}
	_, hasParent := m["parent_mandate_id"]
	if hasParent && !minLength(m["parent_mandate_id"], 6) {
		errors = append(errors, at("parent_mandate_id must be a string of at least 6 characters"))
	}
	if _, ok := m["revocable"].(bool); !ok {
		errors = append(errors, at("revocable must be a boolean"))
	}
	for _, f := range []string{"valid_from", "valid_until", "timestamp"} {
		s, ok := m[f].(string)
		if _, parsed := parseRFC3339(m[f]); !ok || !schemaIsDateTime(s) || !parsed {
			errors = append(errors, at(f+" is not an RFC 3339 date-time"))
		}
	}
	rawDepth, hasDepth := m["delegation_depth"]
	depth, depthOK := jsonIntegerValue(rawDepth)
	if hasDepth && !(depthOK && depth >= 0) {
		errors = append(errors, at("delegation_depth must be an integer >= 0"))
	}
	// The schema's oneOf: a root has no parent and depth 0 or none; a sub-mandate has both, depth >= 1.
	if i == 0 {
		if hasParent {
			errors = append(errors, at("a root mandate has no parent_mandate_id"))
		}
		if hasDepth && !(depthOK && depth == 0) {
			errors = append(errors, at("a root mandate has delegation_depth 0"))
		}
	} else {
		if !hasParent {
			errors = append(errors, at("missing parent_mandate_id"))
		}
		if !hasDepth {
			errors = append(errors, at("missing delegation_depth"))
		} else if depthOK && depth < 1 {
			errors = append(errors, at("a sub-mandate has delegation_depth >= 1"))
		}
	}
	for _, e := range scopeShapeErrors(m["authority_scope"]) {
		errors = append(errors, at(e))
	}
	if raw, present := m["sub_delegation"]; present {
		sd, ok := raw.(map[string]interface{})
		if !ok {
			errors = append(errors, at("sub_delegation is not an object"))
		} else {
			for _, k := range slices.Sorted(mapsKeys(sd)) {
				if !slices.Contains(subDelegationFields, k) {
					errors = append(errors, at("sub_delegation has unknown member "+printable(k)))
				}
			}
			if _, ok := sd["permitted"].(bool); !ok {
				errors = append(errors, at("sub_delegation.permitted must be a boolean"))
			}
			if d, ok := jsonIntegerValue(sd["max_depth"]); !ok || d < 0 {
				errors = append(errors, at("sub_delegation.max_depth must be an integer >= 0"))
			}
		}
	}
	if raw, present := m["minimum_security_tier"]; present {
		if s, ok := raw.(string); !ok || !slices.Contains(delegatedTiers, s) {
			errors = append(errors, at("minimum_security_tier is not routine, standard, elevated or maximum"))
		}
	}
	// The slot of the mandate's depth, and only that one (the schema's oneOf; DCP-09 § 3.5.1).
	field, other := "human_composite_sig", "delegator_composite_sig"
	if i > 0 {
		field, other = other, field
	}
	if sig, present := m[field]; !present {
		errors = append(errors, at("missing "+field))
	} else if e := signatureSlotError(sig, field); e != "" {
		errors = append(errors, at(e))
	}
	if _, present := m[other]; present {
		errors = append(errors, at(other+" is not allowed at this depth"))
	}
	return errors
}

// provisionalFloor is the highest minimum_security_tier of the chain; a name that is not a tier counts as
// elevated; "" when no mandate sets one.
func provisionalFloor(chain []map[string]interface{}) string {
	floor := ""
	for _, m := range chain {
		raw, present := m["minimum_security_tier"]
		if !present {
			continue
		}
		tier, _ := raw.(string)
		if !slices.Contains(delegatedTiers, tier) {
			tier = "elevated"
		}
		if floor == "" {
			floor = tier
		} else {
			floor = MaxTier(floor, tier)
		}
	}
	return floor
}

// ── Revocation snapshots (§ 4.3 of the admission profile, for any subjects) ──

type snapshotMap struct {
	kind, field string
	ids         []string
}

func (a *admission) snapshotChecks(raw json.RawMessage, maps []snapshotMap, maxAge int, now time.Time) {
	kinds := make([]string, len(maps))
	for i, m := range maps {
		kinds[i] = m.kind
	}
	label := strings.Join(kinds, " and ")
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || string(trimmed) == "null" {
		a.add("REVOCATION_UNAVAILABLE", "no %s revocation status could be obtained", label)
		return
	}
	decoded, err := decodeJSONValue(raw)
	obj, isObject := decoded.(map[string]interface{})
	valid := err == nil && isObject && len(obj) == len(maps)+1
	checkedAt, parsed := time.Time{}, false
	if valid {
		checkedAt, parsed = parseRFC3339(obj["checked_at"])
		valid = parsed
		for _, m := range maps {
			statuses, ok := obj[m.field].(map[string]interface{})
			if !ok {
				valid = false
				break
			}
			for _, s := range statuses {
				if s != "revoked" && s != "not_revoked" && s != "unknown" {
					valid = false
				}
			}
		}
	}
	if !valid {
		a.add("REVOCATION_INVALID", "the %s revocation snapshot is malformed", label)
		return
	}
	if checkedAt.After(now.Add(sessionClockSkew)) {
		a.add("REVOCATION_INVALID", "the %s revocation snapshot is dated in the future", label)
		return
	}
	if now.UnixMilli()-checkedAt.UnixMilli() > int64(maxAge)*1000 {
		a.add("REVOCATION_STALE", "the %s revocation snapshot is older than %d s", label, maxAge)
	}
	for _, m := range maps {
		statuses := obj[m.field].(map[string]interface{})
		for _, id := range m.ids {
			switch statuses[id] {
			case "revoked":
				a.add("REVOCATION_REVOKED", "%s %s is revoked", m.kind, printable(id))
			case "not_revoked":
			default:
				a.add("REVOCATION_UNKNOWN", "the revocation status of %s %s is unknown", m.kind, printable(id))
			}
		}
	}
}

// ── Keys ──

func usedKeyError(key map[string]interface{}, kid, alg, where string) string {
	if key == nil {
		return "" // the chain verifier reports a kid it cannot find
	}
	if key["alg"] != alg {
		return fmt.Sprintf("%s: key %s is %s, not %s", where, kid, printable(key["alg"]), alg)
	}
	raw, canonical := canonicalB64Bytes(key["public_key_b64"])
	if !canonical || len(raw) != trustKeyBytes[alg] {
		return fmt.Sprintf("%s: key %s is not a canonical base64 %s public key", where, kid, alg)
	}
	if DeriveKid(alg, raw) != kid {
		return fmt.Sprintf("%s: kid %s is not derived from its key (V2-13)", where, kid)
	}
	return ""
}

func payloadField(sb map[string]interface{}, artifact, field string) interface{} {
	bundle, _ := sb["bundle"].(map[string]interface{})
	return artifactPayload(bundle, artifact)[field]
}

func keysOf(sb map[string]interface{}, artifact, field string) []interface{} {
	keys, _ := payloadField(sb, artifact, field).([]interface{})
	return keys
}

func findKey(keys []interface{}, kid string) map[string]interface{} {
	for _, k := range keys {
		if m, ok := k.(map[string]interface{}); ok && m["kid"] == kid {
			return m
		}
	}
	return nil
}

// AdmitDelegatedBundleV2 admits a leaf bundle with the mandate chain it acts under (design § 1.3). It returns
// an *AdmissionConfigError for an invalid operator configuration; every problem with the evidence is a code
// in the result.
//
// The registry is a capability the operator trusts: it is used as given, not copied, and must not change
// during the call. Every byte slice of the evidence and of the configuration is copied before anything is
// read, and only the copies are read. Nothing is promised if another goroutine of the caller changes them
// while they are copied: that is a data race of the caller.
func AdmitDelegatedBundleV2(registry *AlgorithmRegistry, evidence DelegatedEvidence, operator DelegatedOperator) (*DelegatedAdmissionResult, error) {
	snapshot, err := takeDelegatedSnapshot(evidence, operator)
	if err != nil {
		return nil, err
	}
	result, _, err := composeDelegated(registry, snapshot)
	return result, err
}

// delegatedSnapshot is everything AdmitDelegatedBundleV2 reads from its caller: the loaded configuration and a
// copy of every byte slice (F4 design § 10.1).
type delegatedSnapshot struct {
	now                           time.Time
	trust                         *PrincipalTrustStore
	profile                       *StrictV1Profile
	policy                        VerifierPolicy
	maxAge                        int
	revocation, mandateRevocation json.RawMessage
	leafJSON, chainJSON           []byte
	delegatorJSON                 [][]byte
}

// delegatedVerified is what an admitted composition verified, as references to the snapshot's copies or values
// decoded from them during that composition. Read by the mandate acknowledgment only; never modified.
type delegatedVerified struct {
	now      time.Time
	mandates []map[string]interface{}
	agentIDs []string
	// agentKeys are the passport keys of every agent of the chain (the delegators and the leaf), from bundles that
	// verified.
	agentKeys map[string][]interface{}
	policy    VerifierPolicy
	// mode is the leaf's verification mode, the one step 7 applied.
	mode       string
	revocation json.RawMessage
	// checkedKids are the key ids step 10 looked up in revocation.
	checkedKids map[string]bool
}

// takeDelegatedSnapshot is step 0 of AdmitDelegatedBundleV2: the operator configuration, read once, then a copy
// of every byte slice. It returns the same configuration errors as before, in the same order.
func takeDelegatedSnapshot(evidence DelegatedEvidence, operator DelegatedOperator) (*delegatedSnapshot, error) {
	now := operator.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = truncateToMillis(now.Round(0))

	trust := operator.Trust
	switch {
	case trust != nil && len(operator.TrustSetJSON) > 0:
		return nil, configError("CONFIG_INVALID_VALUE", "give a loaded trust store or a trust set, not both")
	case trust != nil && !trust.loaded:
		return nil, configError("CONFIG_INVALID_VALUE", "the trust set was not loaded with NewPrincipalTrustStore")
	case trust == nil && len(operator.TrustSetJSON) == 0:
		return nil, configError("CONFIG_INVALID_VALUE", "delegated admission requires a trust set")
	case trust == nil:
		loaded, err := NewPrincipalTrustStore(bytes.Clone(operator.TrustSetJSON))
		if err != nil {
			return nil, err
		}
		trust = loaded
	}

	profile := operator.Profile
	if profile != nil && len(operator.ProfileJSON) > 0 {
		return nil, configError("CONFIG_INVALID_VALUE", "give a loaded profile or its configuration, not both")
	}
	if err := profileNotLoaded(profile); err != nil {
		return nil, err
	}
	if profile == nil && len(operator.ProfileJSON) > 0 {
		loaded, err := ResolveStrictV1Profile(bytes.Clone(operator.ProfileJSON))
		if err != nil {
			return nil, err
		}
		profile = loaded
	}
	var policy VerifierPolicy
	maxAge := 0
	if profile != nil {
		if operator.Policy != nil {
			return nil, configError("CONFIG_PROFILE_CONTRADICTION", "a strict-v1 profile sets its own verifier policy; do not pass one")
		}
		if operator.MaxRevocationAgeSeconds != 0 {
			return nil, configError("CONFIG_PROFILE_CONTRADICTION", "a strict-v1 profile sets max_revocation_age_seconds; do not pass one")
		}
		policy, maxAge = profile.VerifierPolicy(), profile.maxRevocation
	} else {
		if operator.MaxRevocationAgeSeconds < 1 || operator.MaxRevocationAgeSeconds > delegatedMaxSeconds {
			return nil, configError("CONFIG_INVALID_VALUE", "without a profile, MaxRevocationAgeSeconds must be from 1 to %d", delegatedMaxSeconds)
		}
		maxAge = operator.MaxRevocationAgeSeconds
		raw := bytes.Clone(operator.Policy)
		if raw == nil {
			def, err := json.Marshal(DefaultVerifierPolicy())
			if err != nil {
				return nil, configError("CONFIG_INVALID_VALUE", "the default policy cannot be encoded: %v", err)
			}
			raw = def
		}
		checked, err := checkVerifierPolicy(raw)
		if err != nil {
			return nil, err
		}
		policy = checked
	}
	revocation := bytes.Clone(operator.Revocation)
	mandateRevocation := bytes.Clone(operator.MandateRevocation)
	leafJSON := bytes.Clone(evidence.SignedBundle)
	chainJSON := bytes.Clone(evidence.MandateChain)
	delegatorJSON := make([][]byte, len(evidence.DelegatorBundles))
	for i, b := range evidence.DelegatorBundles {
		delegatorJSON[i] = bytes.Clone(b)
	}
	return &delegatedSnapshot{
		now: now, trust: trust, profile: profile, policy: policy, maxAge: maxAge,
		revocation: revocation, mandateRevocation: mandateRevocation,
		leafJSON: leafJSON, chainJSON: chainJSON, delegatorJSON: delegatorJSON,
	}, nil
}

// composeDelegated is steps 1 to 11 of AdmitDelegatedBundleV2 over a snapshot, with the same codes, order and
// early returns. The verified data is nil unless the result is admitted.
func composeDelegated(registry *AlgorithmRegistry, s *delegatedSnapshot) (*DelegatedAdmissionResult, *delegatedVerified, error) {
	now, trust, profile, policy, maxAge := s.now, s.trust, s.profile, s.policy, s.maxAge
	revocation, mandateRevocation := s.revocation, s.mandateRevocation
	leafJSON, chainJSON, delegatorJSON := s.leafJSON, s.chainJSON, s.delegatorJSON

	a := &admission{errors: []AdmissionError{}}
	checkedAt := func(raw json.RawMessage) *string {
		var s struct {
			CheckedAt *string `json:"checked_at"`
		}
		if json.Unmarshal(raw, &s) != nil {
			return nil
		}
		return s.CheckedAt
	}
	result := &DelegatedAdmissionResult{
		Activation: "not_evaluated",
		Delegators: []*AdmissionResult{},
		Inputs: DelegatedInputs{
			Now:                        now.UnixMilli(),
			TrustSetVersion:            trust.version,
			RevocationCheckedAt:        checkedAt(revocation),
			MandateRevocationCheckedAt: checkedAt(mandateRevocation),
		},
	}
	finish := func() (*DelegatedAdmissionResult, *delegatedVerified, error) {
		result.Errors = a.errors
		return result, nil, nil
	}

	// The documents, decoded once from the copies.
	var leafValue interface{}
	if err := json.Unmarshal(leafJSON, &leafValue); err != nil {
		a.add("DELEGATION_INPUT_INVALID", "SignedBundle is not JSON: %v", err)
		return finish()
	}
	var chainValue interface{}
	if err := json.Unmarshal(chainJSON, &chainValue); err != nil {
		a.add("DELEGATION_INPUT_INVALID", "MandateChain is not JSON: %v", err)
		return finish()
	}
	chainItems, isArray := chainValue.([]interface{})
	if !isArray {
		a.add("DELEGATION_INPUT_INVALID", "MandateChain is not an array")
		return finish()
	}
	delegatorValues := make([]map[string]interface{}, len(delegatorJSON))
	for i, b := range delegatorJSON {
		var v interface{}
		if err := json.Unmarshal(b, &v); err != nil {
			a.add("DELEGATION_INPUT_INVALID", "DelegatorBundles[%d] is not JSON: %v", i, err)
			return finish()
		}
		delegatorValues[i], _ = v.(map[string]interface{})
	}
	leafMap, _ := leafValue.(map[string]interface{})
	if canonical, err := CanonicalizeV2(leafValue); err == nil {
		sum := sha256.Sum256([]byte(canonical))
		digest := hex.EncodeToString(sum[:])
		result.Inputs.LeafBundleSHA256 = &digest
	}

	// ── 1. Form and preflight ──
	if len(chainItems) == 0 {
		a.add("DELEGATION_CHAIN_INVALID", "the mandate chain is empty")
		return finish()
	}
	for i, item := range chainItems {
		for _, e := range mandatePreflight(item, i) {
			a.add("DELEGATION_CHAIN_INVALID", "%s", e)
		}
	}
	if len(a.errors) > 0 {
		return finish()
	}
	mandates := make([]map[string]interface{}, len(chainItems))
	mandateIDs := make([]string, len(chainItems))
	agentIDs := make([]string, len(chainItems))
	for i, item := range chainItems {
		mandates[i] = item.(map[string]interface{})
		mandateIDs[i] = mandates[i]["mandate_id"].(string)
		agentIDs[i] = mandates[i]["agent_id"].(string)
	}
	for _, kind := range []struct {
		name string
		ids  []string
	}{{"mandate_id", mandateIDs}, {"agent_id", agentIDs}} {
		seen, reported := map[string]bool{}, map[string]bool{}
		for _, id := range kind.ids {
			if seen[id] && !reported[id] {
				a.add("DELEGATION_REPEATED_ID", "%s %s appears more than once in the chain", kind.name, printable(id))
				reported[id] = true
			}
			seen[id] = true
		}
	}
	if len(a.errors) > 0 {
		return finish()
	}
	humanID := mandates[0]["human_id"].(string)
	leafAgent := agentIDs[len(agentIDs)-1]
	delegatingAgents := agentIDs[:len(agentIDs)-1]

	// ── 2. Provisional floor: it can only make the bundle checks stricter ──
	floor := provisionalFloor(mandates)

	// ── 3. Bundles: verified at the same instant with the floor, then admitted ──
	admit := func(bundleJSON []byte) (*AdmissionResult, error) {
		v := verifySignedBundleV2AtFloor(registry, bundleJSON, policy, now, "dcp-jcs-v1", floor, true)
		return EvaluateAdmissionV2(bundleJSON, v, AdmissionOptions{Profile: profile, Trust: trust, Revocation: revocation, Now: now})
	}
	leaf, err := admit(leafJSON)
	if err != nil {
		return nil, nil, err
	}
	result.Leaf = leaf
	for _, b := range delegatorJSON {
		d, err := admit(b)
		if err != nil {
			return nil, nil, err
		}
		result.Delegators = append(result.Delegators, d)
	}
	// The leaf's own codes, but revocation, which step 10 evaluates once for every subject.
	for _, e := range leaf.Errors {
		if !strings.HasPrefix(e.Code, "REVOCATION_") {
			a.add(e.Code, "leaf: %s", e.Message)
		}
	}

	// ── 4. Links ──
	delegationProblem := false
	problem := func(code, format string, args ...interface{}) {
		delegationProblem = true
		a.add(code, format, args...)
	}
	if id := payloadField(leafMap, "agent_passport", "agent_id"); id != leafAgent {
		problem("DELEGATION_LEAF_MISMATCH", "the leaf bundle's agent %s is not the last mandate's agent %s", printable(id), printable(leafAgent))
	}
	if p := payloadField(leafMap, "responsible_principal_record", "human_id"); p != humanID {
		problem("DELEGATION_PRINCIPAL_MISMATCH", "the leaf bundle's principal %s is not the chain's %s", printable(p), printable(humanID))
	}
	byAgent := map[string]int{}
	for i, d := range delegatorValues {
		agent := payloadField(d, "agent_passport", "agent_id")
		if p := payloadField(d, "responsible_principal_record", "human_id"); p != humanID {
			problem("DELEGATION_PRINCIPAL_MISMATCH", "DelegatorBundles[%d]: principal %s is not the chain's %s", i, printable(p), printable(humanID))
		}
		id, isString := agent.(string)
		_, twice := byAgent[id]
		switch {
		case !isString || !slices.Contains(delegatingAgents, id):
			problem("DELEGATION_DELEGATOR_UNEXPECTED", "DelegatorBundles[%d]: agent %s delegates nothing in this chain", i, printable(agent))
		case twice:
			problem("DELEGATION_DELEGATOR_UNEXPECTED", "DelegatorBundles[%d]: a second bundle of agent %s", i, printable(id))
		default:
			byAgent[id] = i
		}
		if !result.Delegators[i].Admitted {
			codes := make([]string, len(result.Delegators[i].Errors))
			for j, e := range result.Delegators[i].Errors {
				codes[j] = e.Code
			}
			problem("DELEGATION_DELEGATOR_NOT_ADMITTED", "DelegatorBundles[%d] is not admitted: %s", i, strings.Join(codes, ", "))
		}
	}
	for _, id := range delegatingAgents {
		if _, ok := byAgent[id]; !ok {
			problem("DELEGATION_DELEGATOR_MISSING", "no bundle of delegating agent %s", printable(id))
		}
	}

	// ── 5. Keys of every actor: the principal, each delegator and the leaf ──
	// Only from bundles that verified: an unverified bundle's keys are not the agent's keys.
	type actor struct {
		label string
		lists [][]interface{}
	}
	leafVerified := leaf.Verified
	principal := actor{label: "principal"}
	if leafVerified {
		principal.lists = append(principal.lists, keysOf(leafMap, "responsible_principal_record", "binding_keys"))
	}
	agentKeys := map[string][]interface{}{}
	var others []actor
	for _, id := range slices.Sorted(func(yield func(string) bool) {
		for k := range byAgent {
			if !yield(k) {
				return
			}
		}
	}) {
		i := byAgent[id]
		if !result.Delegators[i].Verified {
			continue
		}
		principal.lists = append(principal.lists, keysOf(delegatorValues[i], "responsible_principal_record", "binding_keys"))
		agentKeys[id] = keysOf(delegatorValues[i], "agent_passport", "keys")
		others = append(others, actor{label: "delegator " + id, lists: [][]interface{}{agentKeys[id]}})
	}
	actors := append([]actor{principal}, others...)
	if leafVerified {
		actors = append(actors, actor{label: "leaf " + leafAgent, lists: [][]interface{}{keysOf(leafMap, "agent_passport", "keys")}})
	}
	kidOwner, keyOwner, kidKey := map[string]string{}, map[string]string{}, map[string]string{}
	for _, ac := range actors {
		for _, list := range ac.lists {
			seen := map[string]bool{}
			for _, raw := range list {
				entry, ok := raw.(map[string]interface{})
				kid, okKid := entry["kid"].(string)
				alg, okAlg := entry["alg"].(string)
				pk, okPK := entry["public_key_b64"].(string)
				if !ok || !okKid || !okAlg || !okPK {
					continue
				}
				identity := alg + "\x00" + pk
				if seen[kid] {
					problem("DELEGATION_KEY_AMBIGUOUS", "%s: kid %s is listed twice in one key list", ac.label, kid)
				}
				seen[kid] = true
				for _, o := range []struct {
					owners map[string]string
					id     string
				}{{kidOwner, kid}, {keyOwner, identity}} {
					if owner, known := o.owners[o.id]; known && owner != ac.label {
						problem("DELEGATION_KEY_AMBIGUOUS", "kid %s: the same key belongs to %s and %s", kid, owner, ac.label)
					} else {
						o.owners[o.id] = ac.label
					}
				}
				if known, ok := kidKey[kid]; ok && known != identity {
					problem("DELEGATION_KEY_AMBIGUOUS", "%s: kid %s names two different keys", ac.label, kid)
				}
				kidKey[kid] = identity
			}
		}
	}

	// The keys each mandate signature names, with their identity checked here (the chain verifier does not).
	var humanKeys []interface{}
	if leafVerified {
		humanKeys = keysOf(leafMap, "responsible_principal_record", "binding_keys")
	}
	slotOf := func(i int) map[string]interface{} {
		field := "delegator_composite_sig"
		if i == 0 {
			field = "human_composite_sig"
		}
		return mandates[i][field].(map[string]interface{})
	}
	component := func(sig map[string]interface{}, name string) (kid, alg string) {
		entry := sig[name].(map[string]interface{})
		return entry["kid"].(string), entry["alg"].(string)
	}
	listOf := func(i int) []interface{} {
		if i == 0 {
			return humanKeys
		}
		return agentKeys[agentIDs[i-1]]
	}
	usedKids := map[string]bool{}
	for i := range mandates {
		for _, name := range []string{"classical", "pq"} {
			kid, alg := component(slotOf(i), name)
			usedKids[kid] = true
			if e := usedKeyError(findKey(listOf(i), kid), kid, alg, fmt.Sprintf("mandate[%d] %s", i, name)); e != "" {
				problem("DELEGATION_CHAIN_INVALID", "%s", e)
			}
		}
	}

	// ── 6. The chain, with the history API unchanged ──
	revoked := map[string]bool{}
	if decoded, err := decodeJSONValue(mandateRevocation); err == nil {
		if obj, ok := decoded.(map[string]interface{}); ok {
			if statuses, ok := obj["mandates"].(map[string]interface{}); ok {
				for id, s := range statuses {
					if s == "revoked" {
						revoked[id] = true
					}
				}
			}
		}
	}
	chainFloor, chainValid := "", false
	if leafVerified {
		verdict := VerifyMandateChain(registry, mandates, revoked, MandateChainKeys{HumanKeys: humanKeys, AgentKeys: agentKeys}, now)
		chainValid = verdict.Valid
		switch {
		case !verdict.Valid:
			for _, e := range verdict.Errors {
				problem("DELEGATION_CHAIN_INVALID", "%s", e)
			}
		case verdict.EffectiveTier != floor:
			problem("DELEGATION_FLOOR_MISMATCH", "the verified chain floor %q is not the floor the bundles were verified with (%q)", verdict.EffectiveTier, floor)
		default:
			chainFloor = verdict.EffectiveTier
		}
	} else {
		problem("DELEGATION_CHAIN_INVALID", "the chain is not verified: the leaf bundle, whose RPR holds the principal keys, did not verify")
	}

	// ── 7. Verifier policy on every chain signature component ──
	mode := "hybrid_required"
	if leaf.Verification != nil && leaf.Verification.VerificationMode != "" {
		mode = leaf.Verification.VerificationMode
	}
	for i := range mandates {
		_, classical := component(slotOf(i), "classical")
		_, pq := component(slotOf(i), "pq")
		if mode != "pq_only" {
			if !slices.Contains(policy.AcceptedClassicalAlgs, classical) {
				problem("DELEGATION_ALGORITHM_REJECTED", "mandate[%d]: classical algorithm %s is not accepted by the verifier policy", i, classical)
			}
			if slices.Contains(policy.AdvisoryRejectedAlgs, classical) {
				problem("DELEGATION_ALGORITHM_REJECTED", "mandate[%d]: classical algorithm %s is rejected by an active advisory", i, classical)
			}
		}
		if !slices.Contains(policy.AcceptedPQAlgs, pq) {
			problem("DELEGATION_ALGORITHM_REJECTED", "mandate[%d]: PQ algorithm %s is not accepted by the verifier policy", i, pq)
		}
		if slices.Contains(policy.AdvisoryRejectedAlgs, pq) {
			problem("DELEGATION_ALGORITHM_REJECTED", "mandate[%d]: PQ algorithm %s is rejected by an active advisory", i, pq)
		}
	}

	// ── 8. The root's components, each anchored in the current trust set ──
	if trusted, known := trust.principals[humanID]; !known {
		problem("TRUST_PRINCIPAL_UNKNOWN", "mandate[0]: principal %s is not in trust set %s", printable(humanID), printable(trust.version))
	} else {
		for _, name := range []string{"classical", "pq"} {
			kid, _ := component(slotOf(0), name)
			key := findKey(humanKeys, kid)
			if key == nil {
				continue // the chain verifier reports it
			}
			alg, _ := key["alg"].(string)
			if code, message := trustedKeyError(trusted, kid, alg, key["public_key_b64"], fmt.Sprintf("mandate[0] %s key %s", name, kid), now); code != "" {
				problem(code, "%s", message)
			}
		}
	}

	// ── 9. session_nonce: the explicit rule ──
	// A mandate's nonce is its issuance session's; each bundle is an action session. No equality is required
	// between a mandate and any bundle, or between mandates; within each bundle V2-4 applies (step 3).

	// ── 10. Revocation of every subject of the composition ──
	kids := map[string]bool{}
	for kid := range usedKids {
		kids[kid] = true
	}
	for _, s := range revocationSubjectsOf(leafMap, leaf.Verification).Kids {
		kids[s] = true
	}
	for i, d := range result.Delegators {
		for _, s := range revocationSubjectsOf(delegatorValues[i], d.Verification).Kids {
			kids[s] = true
		}
	}
	sortedKids := make([]string, 0, len(kids))
	for kid := range kids {
		sortedKids = append(sortedKids, kid)
	}
	sort.Strings(sortedKids)
	a.snapshotChecks(revocation, []snapshotMap{{"agent", "agents", agentIDs}, {"key", "keys", sortedKids}}, maxAge, now)
	a.snapshotChecks(mandateRevocation, []snapshotMap{{"mandate", "mandates", mandateIDs}}, maxAge, now)

	// ── 11. Result ──
	delegationVerified := chainValid && chainFloor == floor && !delegationProblem
	admitted := len(a.errors) == 0 && leaf.Admitted && delegationVerified
	for _, d := range result.Delegators {
		admitted = admitted && d.Admitted
	}
	result.Admitted = admitted
	result.DelegationVerified = delegationVerified
	if leafVerified && leaf.Verification != nil {
		tier, mode := leaf.Verification.ResolvedTier, leaf.Verification.VerificationMode
		result.SecurityTier, result.VerificationMode = &tier, &mode
	}
	var scopeCopy interface{}
	if scope, err := json.Marshal(mandates[len(mandates)-1]["authority_scope"]); err == nil {
		_ = json.Unmarshal(scope, &scopeCopy)
	}
	result.Chain = &DelegatedChain{Depth: len(mandates) - 1, MandateIDs: mandateIDs, LeafAuthorityScope: scopeCopy}
	if chainFloor != "" {
		f := chainFloor
		result.Chain.EffectiveFloor = &f
	}
	if !admitted {
		return finish()
	}
	// Admitted: the leaf and every delegator verified, so each agent's passport keys are its verified keys.
	verifiedKeys := map[string][]interface{}{leafAgent: keysOf(leafMap, "agent_passport", "keys")}
	for _, id := range delegatingAgents {
		verifiedKeys[id] = agentKeys[id]
	}
	out, _, _ := finish()
	return out, &delegatedVerified{
		now: now, mandates: mandates, agentIDs: agentIDs, agentKeys: verifiedKeys, policy: policy, mode: mode,
		revocation: revocation, checkedKids: kids,
	}, nil
}
