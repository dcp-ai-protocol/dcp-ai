// Package v2 — DCP-09 Delegation & Representation (Go port).

package v2

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"time"
)

// SubDelegationPolicy says whether a delegate may sub-delegate, and the
// greatest delegation_depth any descendant may reach (DCP-09 §3.5).
type SubDelegationPolicy struct {
	Permitted bool `json:"permitted"`
	MaxDepth  int  `json:"max_depth"`
}

// DelegationMandateParams bundles inputs for CreateDelegationMandate.
// SubDelegation and MinimumSecurityTier are the DCP-09 §3.5 chain fields; a
// mandate without them is unchanged on the wire.
type DelegationMandateParams struct {
	MandateID           string
	SessionNonce        string
	HumanID             string
	AgentID             string
	AuthorityScope      []map[string]interface{}
	ValidFrom           string // ISO-8601
	ValidUntil          string // ISO-8601
	Revocable           bool
	SubDelegation       *SubDelegationPolicy
	MinimumSecurityTier string
}

// chainFields are left out of the wire object when absent, so a plain root
// mandate stays byte-identical.
func chainFields(payload map[string]interface{}, sub *SubDelegationPolicy, tier string) {
	if sub != nil {
		payload["sub_delegation"] = map[string]interface{}{"permitted": sub.Permitted, "max_depth": sub.MaxDepth}
	}
	if tier != "" {
		payload["minimum_security_tier"] = tier
	}
}

// CreateDelegationMandate produces a mandate signed by the human principal.
// The signature is placed in `human_composite_sig` (not `composite_sig`) to
// distinguish the human-principal witness on the artefact.
func CreateDelegationMandate(
	registry *AlgorithmRegistry,
	humanClassicalKey CompositeKeyInfo,
	humanPQKey CompositeKeyInfo,
	p DelegationMandateParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":      "2.0",
		"mandate_id":       p.MandateID,
		"session_nonce":    p.SessionNonce,
		"human_id":         p.HumanID,
		"agent_id":         p.AgentID,
		"authority_scope":  p.AuthorityScope,
		"valid_from":       p.ValidFrom,
		"valid_until":      p.ValidUntil,
		"revocable":        p.Revocable,
		"timestamp":        utcNowISO(),
	}
	chainFields(payload, p.SubDelegation, p.MinimumSecurityTier)
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxDelegation, []byte(canonical), humanClassicalKey, humanPQKey)
	if err != nil {
		return nil, err
	}
	payload["human_composite_sig"] = sig
	return payload, nil
}

// SubMandateParams bundles inputs for CreateSubMandate. human_id,
// parent_mandate_id and delegation_depth come from the parent mandate.
type SubMandateParams struct {
	MandateID           string
	SessionNonce        string
	AgentID             string
	AuthorityScope      []map[string]interface{}
	ValidFrom           string // ISO-8601
	ValidUntil          string // ISO-8601
	Revocable           bool
	SubDelegation       *SubDelegationPolicy
	MinimumSecurityTier string
}

// CreateSubMandate produces a sub-mandate (DCP-09 §3.5): the agent holding
// `parent` passes a narrower authority on to p.AgentID, signing with its own
// keys under the SubMandate context into `delegator_composite_sig`. Nothing is
// checked here; VerifyMandateChain is the gate, so a sub-mandate wider than
// its parent is simply one no verifier accepts.
func CreateSubMandate(
	registry *AlgorithmRegistry,
	delegatorClassicalKey CompositeKeyInfo,
	delegatorPQKey CompositeKeyInfo,
	parent map[string]interface{},
	p SubMandateParams,
) (map[string]interface{}, error) {
	parentDepth, _ := asInteger(parent["delegation_depth"])
	payload := map[string]interface{}{
		"dcp_version":       "2.0",
		"mandate_id":        p.MandateID,
		"session_nonce":     p.SessionNonce,
		"human_id":          parent["human_id"],
		"agent_id":          p.AgentID,
		"authority_scope":   p.AuthorityScope,
		"valid_from":        p.ValidFrom,
		"valid_until":       p.ValidUntil,
		"revocable":         p.Revocable,
		"timestamp":         utcNowISO(),
		"parent_mandate_id": parent["mandate_id"],
		"delegation_depth":  parentDepth + 1,
	}
	chainFields(payload, p.SubDelegation, p.MinimumSecurityTier)
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxSubMandate, []byte(canonical), delegatorClassicalKey, delegatorPQKey)
	if err != nil {
		return nil, err
	}
	payload["delegator_composite_sig"] = sig
	return payload, nil
}

// MandateValidity is the outcome of VerifyMandateValidity.
type MandateValidity struct {
	Valid  bool
	Reason string
}

// VerifyMandateValidity checks mandate expiry and revocation.
func VerifyMandateValidity(mandate map[string]interface{}, revokedMandateIDs map[string]bool) MandateValidity {
	id, _ := mandate["mandate_id"].(string)
	if revokedMandateIDs[id] {
		return MandateValidity{Valid: false, Reason: "Mandate has been revoked"}
	}
	validFrom, _ := mandate["valid_from"].(string)
	validUntil, _ := mandate["valid_until"].(string)
	now := time.Now().UTC()
	vf, err := time.Parse(time.RFC3339, validFrom)
	if err == nil && vf.After(now) {
		return MandateValidity{Valid: false, Reason: "Mandate is not yet valid"}
	}
	vu, err := time.Parse(time.RFC3339, validUntil)
	if err == nil && vu.Before(now) {
		return MandateValidity{Valid: false, Reason: "Mandate has expired"}
	}
	return MandateValidity{Valid: true}
}

// RevocationOutcome is the result of RevokeDelegation.
type RevocationOutcome struct {
	Revoked bool
	Reason  string
}

// RevokeDelegation marks a mandate as revoked, mutating `revokedMandateIDs`.
// Non-revocable mandates return {Revoked: false, Reason: "Mandate is not revocable"}.
func RevokeDelegation(mandate map[string]interface{}, revokedMandateIDs map[string]bool) RevocationOutcome {
	revocable, _ := mandate["revocable"].(bool)
	if !revocable {
		return RevocationOutcome{Revoked: false, Reason: "Mandate is not revocable"}
	}
	if id, ok := mandate["mandate_id"].(string); ok && id != "" {
		revokedMandateIDs[id] = true
	}
	return RevocationOutcome{Revoked: true}
}

// InteractionParams bundles inputs for GenerateInteractionRecord.
type InteractionParams struct {
	InteractionID          string
	SessionNonce           string
	AgentID                string
	CounterpartyAgentID    string
	PublicLayer            map[string]string
	PrivateLayerHash       string
	MandateID              string
}

// GenerateInteractionRecord signs a dual-layer interaction record.
func GenerateInteractionRecord(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p InteractionParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":              "2.0",
		"interaction_id":           p.InteractionID,
		"session_nonce":            p.SessionNonce,
		"agent_id":                 p.AgentID,
		"counterparty_agent_id":    p.CounterpartyAgentID,
		"public_layer":             p.PublicLayer,
		"private_layer_hash":       p.PrivateLayerHash,
		"mandate_id":               p.MandateID,
		"timestamp":                utcNowISO(),
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxDelegation, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}

// ── Mandate chains (DCP-09 §3.5.2) ──

// MandateChainKeys are the keys a chain is verified against; each list holds
// decoded key entries looked up by kid, as the bundle verifier does.
type MandateChainKeys struct {
	// HumanKeys are the human principal's keys (the RPR binding_keys): they verify the root's human_composite_sig.
	HumanKeys []interface{} `json:"human_keys"`
	// AgentKeys are each delegating agent's passport keys by agent_id: they verify the delegator_composite_sig of its sub-mandates.
	AgentKeys map[string][]interface{} `json:"agent_keys"`
}

// MandateChainResult is the outcome of VerifyMandateChain.
type MandateChainResult struct {
	Valid bool `json:"valid"`
	// Errors is empty when valid; every error names the mandate by its index in the chain.
	Errors []string `json:"errors"`
	// Depth is the leaf's delegation_depth when valid, 0 otherwise.
	Depth int `json:"depth"`
	// EffectiveTier is the greatest minimum_security_tier along the chain, or "" when no mandate sets one.
	EffectiveTier string `json:"effective_tier"`
}

var mandateTierRank = map[string]int{"routine": 0, "standard": 1, "elevated": 2, "maximum": 3}

// asInteger reads a JSON integer however it was decoded or built; a float with
// a fractional part, a bool or a string is not one.
func asInteger(v interface{}) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int32:
		return int(n), true
	case int64:
		return int(n), true
	case float64:
		if n == math.Trunc(n) && !math.IsInf(n, 0) {
			return int(n), true
		}
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return int(i), true
		}
		if f, err := n.Float64(); err == nil && f == math.Trunc(f) {
			return int(f), true
		}
	}
	return 0, false
}

// maxComparableLimit bounds the numeric limits a chain verifier compares:
// ±(2^53-1) are the integers every SDK reads exactly, whether it parses JSON
// numbers as float64, as json.Number or as arbitrary-precision integers.
// Beyond it a float64 verifier and an exact one disagree on what a mandate
// says, so such a limit is not comparable (DCP-09 §3.5.2 rule 5).
const maxComparableLimit = 1<<53 - 1

// isNumber says whether a value is a JSON number however it was decoded or
// built: a json.Number or any Go integer or float kind; a bool is not one.
func isNumber(v interface{}) bool {
	if _, ok := v.(json.Number); ok {
		return true
	}
	switch reflect.ValueOf(v).Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr,
		reflect.Float32, reflect.Float64:
		return true
	}
	return false
}

// comparableLimit reads a numeric limit as the integer it denotes, when it is
// an integer within ±maxComparableLimit. A fraction, anything larger and a
// json.Number strconv cannot parse (such as "1e999999999") are not.
func comparableLimit(v interface{}) (int64, bool) {
	if x, ok := v.(json.Number); ok {
		if i, err := x.Int64(); err == nil {
			return i, -maxComparableLimit <= i && i <= maxComparableLimit
		}
		f, err := x.Float64()
		if err != nil {
			return 0, false
		}
		return comparableLimit(f)
	}
	var n int64
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		n = rv.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		if rv.Uint() > maxComparableLimit {
			return 0, false
		}
		n = int64(rv.Uint())
	case reflect.Float32, reflect.Float64:
		f := rv.Float()
		if f != math.Trunc(f) || math.Abs(f) > maxComparableLimit {
			return 0, false
		}
		n = int64(f)
	default:
		return 0, false
	}
	return n, -maxComparableLimit <= n && n <= maxComparableLimit
}

func isNonEmptyString(v interface{}) bool {
	s, ok := v.(string)
	return ok && s != ""
}

// asStringList reads a list of strings whether decoded ([]interface{}) or built ([]string).
func asStringList(v interface{}) ([]string, bool) {
	switch list := v.(type) {
	case []string:
		return list, true
	case []interface{}:
		out := make([]string, len(list))
		for i, item := range list {
			s, ok := item.(string)
			if !ok {
				return nil, false
			}
			out[i] = s
		}
		return out, true
	}
	return nil, false
}

// scopeEntry is one validated authority_scope item.
type scopeEntry struct {
	domain         string
	actions        []string
	dataClasses    []string
	hasDataClasses bool
	limits         map[string]interface{}
	hasLimits      bool
}

// parseScope validates authority_scope: a non-empty list of entries with a
// domain, actions_permitted, optional data_classes and optional object limits.
func parseScope(v interface{}) ([]scopeEntry, bool) {
	var items []interface{}
	switch list := v.(type) {
	case []interface{}:
		items = list
	case []map[string]interface{}:
		for _, m := range list {
			items = append(items, m)
		}
	default:
		return nil, false
	}
	if len(items) == 0 {
		return nil, false
	}
	out := make([]scopeEntry, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]interface{})
		if !ok || !isNonEmptyString(m["domain"]) {
			return nil, false
		}
		e := scopeEntry{domain: m["domain"].(string)}
		if e.actions, ok = asStringList(m["actions_permitted"]); !ok {
			return nil, false
		}
		if raw, present := m["data_classes"]; present {
			if e.dataClasses, ok = asStringList(raw); !ok {
				return nil, false
			}
			e.hasDataClasses = true
		}
		if raw, present := m["limits"]; present {
			if e.limits, ok = raw.(map[string]interface{}); !ok {
				return nil, false
			}
			e.hasLimits = true
		}
		out = append(out, e)
	}
	return out, true
}

// subDelegationPolicy reads a sub_delegation object: permitted (bool) and max_depth (integer >= 0).
func subDelegationPolicy(v interface{}) (SubDelegationPolicy, bool) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return SubDelegationPolicy{}, false
	}
	permitted, ok := m["permitted"].(bool)
	if !ok {
		return SubDelegationPolicy{}, false
	}
	maxDepth, ok := asInteger(m["max_depth"])
	if !ok || maxDepth < 0 {
		return SubDelegationPolicy{}, false
	}
	return SubDelegationPolicy{Permitted: permitted, MaxDepth: maxDepth}, true
}

func canonicalEqual(a, b interface{}) bool {
	ca, errA := CanonicalizeV2(a)
	cb, errB := CanonicalizeV2(b)
	return errA == nil && errB == nil && ca == cb
}

// mandateShapeErrors lists the errors in one mandate's own fields, whatever its position in the chain.
func mandateShapeErrors(m map[string]interface{}) []string {
	var errors []string
	for _, field := range []string{"mandate_id", "human_id", "agent_id"} {
		if !isNonEmptyString(m[field]) {
			errors = append(errors, "missing or invalid "+field)
		}
	}
	for _, field := range []string{"valid_from", "valid_until"} {
		if _, ok := parseRFC3339(m[field]); !ok {
			errors = append(errors, "missing or invalid "+field)
		}
	}
	if scope, ok := parseScope(m["authority_scope"]); !ok {
		errors = append(errors, "missing or invalid authority_scope")
	} else {
		for _, e := range scope {
			for key, v := range e.limits {
				if _, ok := comparableLimit(v); isNumber(v) && !ok {
					errors = append(errors, fmt.Sprintf("limits.%s for domain %q is not comparable", key, e.domain))
				}
			}
		}
	}
	if raw, present := m["sub_delegation"]; present {
		if _, ok := subDelegationPolicy(raw); !ok {
			errors = append(errors, "invalid sub_delegation")
		}
	}
	if raw, present := m["minimum_security_tier"]; present {
		if tier, ok := raw.(string); !ok || mandateTierRank[tier] == 0 && tier != "routine" {
			errors = append(errors, "invalid minimum_security_tier")
		}
	}
	return errors
}

func containsAll(superset, subset []string) bool {
	set := make(map[string]bool, len(superset))
	for _, s := range superset {
		set[s] = true
	}
	for _, s := range subset {
		if !set[s] {
			return false
		}
	}
	return true
}

// attenuationError says why `child` is not within `parent` (rule 5 of DCP-09 §3.5.2), or "" when it is.
func attenuationError(parent, child []scopeEntry) string {
	byDomain := make(map[string]scopeEntry, len(parent))
	for _, p := range parent {
		if _, dup := byDomain[p.domain]; dup {
			return fmt.Sprintf("authority_scope domain %q is duplicated in the parent", p.domain)
		}
		byDomain[p.domain] = p
	}
	seen := make(map[string]bool, len(child))
	for _, c := range child {
		if seen[c.domain] {
			return fmt.Sprintf("authority_scope domain %q is duplicated", c.domain)
		}
		seen[c.domain] = true
		p, ok := byDomain[c.domain]
		if !ok {
			return fmt.Sprintf("authority_scope domain %q is not in the parent", c.domain)
		}
		if !containsAll(p.actions, c.actions) {
			return fmt.Sprintf("actions_permitted for domain %q is not a subset of the parent", c.domain)
		}
		// A child without data_classes would not be bound by the parent's, so it must restate a subset.
		if p.hasDataClasses && !c.hasDataClasses {
			return fmt.Sprintf("data_classes for domain %q missing", c.domain)
		}
		if c.hasDataClasses {
			if !p.hasDataClasses {
				return fmt.Sprintf("data_classes for domain %q present but the parent has none", c.domain)
			}
			if !containsAll(p.dataClasses, c.dataClasses) {
				return fmt.Sprintf("data_classes for domain %q is not a subset of the parent", c.domain)
			}
		}
		if p.hasLimits {
			if !c.hasLimits {
				return fmt.Sprintf("limits for domain %q missing", c.domain)
			}
			for key, pv := range p.limits {
				cv, present := c.limits[key]
				if !present {
					return fmt.Sprintf("limits.%s for domain %q missing", key, c.domain)
				}
				// A number may only shrink; anything else must stay identical. A number outside
				// ±(2^53-1), or a number against a non-number, is not comparable.
				if isNumber(pv) || isNumber(cv) {
					pi, pOK := comparableLimit(pv)
					ci, cOK := comparableLimit(cv)
					if !pOK || !cOK {
						return fmt.Sprintf("limits.%s for domain %q is not comparable", key, c.domain)
					}
					if ci > pi {
						return fmt.Sprintf("limits.%s for domain %q is not within the parent", key, c.domain)
					}
				} else if !canonicalEqual(pv, cv) {
					return fmt.Sprintf("limits.%s for domain %q is not within the parent", key, c.domain)
				}
			}
		}
	}
	return ""
}

// signerKey returns the key entry a signature slot names, or why none can verify it.
func signerKey(keys []interface{}, entry SignatureEntry, now time.Time) (map[string]interface{}, string) {
	if entry.Kid == "" || entry.Alg == "" {
		return nil, "malformed signature entry"
	}
	for _, k := range keys {
		key, ok := k.(map[string]interface{})
		if !ok || key["kid"] != entry.Kid {
			continue
		}
		if alg, _ := key["alg"].(string); alg != entry.Alg {
			return nil, fmt.Sprintf("signer key kid=%s is %s, not %s", entry.Kid, alg, entry.Alg)
		}
		if status, _ := key["status"].(string); status != "active" {
			return nil, fmt.Sprintf("signer key kid=%s is %s", entry.Kid, status)
		}
		if raw, present := key["expires_at"]; present && raw != nil {
			if expires, ok := parseRFC3339(raw); !ok || expires.Before(now) {
				return nil, fmt.Sprintf("signer key kid=%s has expired or has an invalid expires_at", entry.Kid)
			}
		}
		return key, ""
	}
	return nil, fmt.Sprintf("signer key kid=%s not found", entry.Kid)
}

// mandateSigError verifies `field` of `m`, a pq_over_classical composite
// signature over the mandate without its signature fields, and says why it
// does not verify, or "" when it does.
func mandateSigError(registry *AlgorithmRegistry, context string, m map[string]interface{}, field string, keys []interface{}, keysLabel string, now time.Time) string {
	var cs CompositeSignature
	if raw, err := json.Marshal(m[field]); err != nil || json.Unmarshal(raw, &cs) != nil || cs.PQ == nil || cs.Binding != "pq_over_classical" {
		return field + " must be a pq_over_classical composite signature"
	}
	if !classicalAlgs[cs.Classical.Alg] {
		return fmt.Sprintf("%s classical slot holds %s, which is not a classical algorithm", field, cs.Classical.Alg)
	}
	if !pqAlgs[cs.PQ.Alg] {
		return fmt.Sprintf("%s PQ slot holds %s, which is not a PQ algorithm", field, cs.PQ.Alg)
	}
	if keys == nil {
		return fmt.Sprintf("%s: no keys for %s", field, keysLabel)
	}
	classicalKey, problem := signerKey(keys, cs.Classical, now)
	if problem != "" {
		return fmt.Sprintf("%s: %s in %s", field, problem, keysLabel)
	}
	pqKey, problem := signerKey(keys, *cs.PQ, now)
	if problem != "" {
		return fmt.Sprintf("%s: %s in %s", field, problem, keysLabel)
	}

	payload := make(map[string]interface{}, len(m))
	for k, v := range m {
		if k != "human_composite_sig" && k != "delegator_composite_sig" {
			payload[k] = v
		}
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return fmt.Sprintf("%s verification error: %v", field, err)
	}
	classicalPK, _ := classicalKey["public_key_b64"].(string)
	pqPK, _ := pqKey["public_key_b64"].(string)
	result, err := CompositeVerify(registry, context, []byte(canonical), &cs, classicalPK, pqPK)
	if err != nil {
		return fmt.Sprintf("%s verification error: %v", field, err)
	}
	if !result.Valid {
		return field + " does not verify"
	}
	return ""
}

// VerifyMandateChain verifies a mandate chain, root first (DCP-09 §3.5.2): the
// root carries a valid human signature; each sub-mandate links to the previous
// mandate, is signed by that mandate's agent, is permitted by the chain's
// sub_delegation policies, lies inside its parent's validity window, only
// narrows the parent's authority and never lowers its minimum_security_tier;
// and no mandate is revoked, so a revoked ancestor invalidates every
// descendant. Anything unknown, missing for the depth or not comparable fails
// closed. `now` is the verification time; the zero time means the current time.
func VerifyMandateChain(registry *AlgorithmRegistry, chain []map[string]interface{}, revokedMandateIDs map[string]bool, keys MandateChainKeys, now time.Time) MandateChainResult {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	invalid := func(errors []string) MandateChainResult {
		return MandateChainResult{Valid: false, Errors: errors}
	}
	if len(chain) == 0 {
		return invalid([]string{"chain must be a non-empty list of mandates"})
	}
	if keys.HumanKeys == nil || keys.AgentKeys == nil {
		return invalid([]string{"keys must have human_keys and agent_keys"})
	}

	effective := ""
	maxDepth := math.MaxInt // the smallest sub_delegation.max_depth of the ancestors so far
	var parent map[string]interface{}
	for i, m := range chain {
		at := func(err string) string { return fmt.Sprintf("mandate[%d]: %s", i, err) }
		if m == nil {
			return invalid([]string{at("not an object")})
		}
		if shape := mandateShapeErrors(m); len(shape) > 0 {
			errors := make([]string, len(shape))
			for j, e := range shape {
				errors[j] = at(e)
			}
			return invalid(errors)
		}

		var errors []string
		_, hasHumanSig := m["human_composite_sig"]
		_, hasDelegatorSig := m["delegator_composite_sig"]
		var slotsRight bool
		if parent == nil {
			if raw, present := m["delegation_depth"]; present {
				if d, ok := asInteger(raw); !ok || d != 0 {
					errors = append(errors, at("root must have delegation_depth 0"))
				}
			}
			if _, present := m["parent_mandate_id"]; present {
				errors = append(errors, at("root must not have parent_mandate_id"))
			}
			slotsRight = hasHumanSig && !hasDelegatorSig
			if !slotsRight {
				errors = append(errors, at("root must carry human_composite_sig and no delegator_composite_sig"))
			}
		} else {
			parentDepth, _ := asInteger(parent["delegation_depth"])
			expectedDepth := parentDepth + 1
			depth, depthOK := asInteger(m["delegation_depth"])
			if !depthOK || depth != expectedDepth {
				errors = append(errors, at(fmt.Sprintf("delegation_depth must be %d", expectedDepth)))
			}
			if id, ok := m["parent_mandate_id"].(string); !ok || id != parent["mandate_id"] {
				errors = append(errors, at("parent_mandate_id must equal the parent mandate_id"))
			}
			slotsRight = hasDelegatorSig && !hasHumanSig
			if !slotsRight {
				errors = append(errors, at("sub-mandate must carry delegator_composite_sig and no human_composite_sig"))
			}
			if policy, ok := subDelegationPolicy(parent["sub_delegation"]); !ok || !policy.Permitted {
				errors = append(errors, at("parent does not permit sub-delegation"))
			} else {
				maxDepth = min(maxDepth, policy.MaxDepth)
			}
			if depthOK && depth > maxDepth {
				errors = append(errors, at(fmt.Sprintf("delegation_depth %d exceeds sub_delegation.max_depth %d", depth, maxDepth)))
			}
			if m["human_id"] != parent["human_id"] {
				errors = append(errors, at("human_id differs from the parent"))
			}
			from, _ := parseRFC3339(m["valid_from"])
			until, _ := parseRFC3339(m["valid_until"])
			parentFrom, _ := parseRFC3339(parent["valid_from"])
			parentUntil, _ := parseRFC3339(parent["valid_until"])
			if from.Before(parentFrom) {
				errors = append(errors, at("valid_from is before the parent valid_from"))
			}
			if until.After(parentUntil) {
				errors = append(errors, at("valid_until is after the parent valid_until"))
			}
			parentScope, _ := parseScope(parent["authority_scope"])
			scope, _ := parseScope(m["authority_scope"])
			if problem := attenuationError(parentScope, scope); problem != "" {
				errors = append(errors, at(problem))
			}
			if parentTier, present := parent["minimum_security_tier"]; present {
				tier, _ := m["minimum_security_tier"].(string)
				rank, known := mandateTierRank[tier]
				if !known || rank < mandateTierRank[parentTier.(string)] {
					errors = append(errors, at("minimum_security_tier is below the parent"))
				}
			}
		}

		if revokedMandateIDs[m["mandate_id"].(string)] {
			errors = append(errors, at("revoked"))
		}
		from, _ := parseRFC3339(m["valid_from"])
		until, _ := parseRFC3339(m["valid_until"])
		if from.After(now) {
			errors = append(errors, at("not yet valid at the verification time"))
		}
		if until.Before(now) {
			errors = append(errors, at("expired at the verification time"))
		}

		// The signature is the costly check; only a mandate whose slots are right can have the right one.
		if slotsRight {
			var problem string
			if parent == nil {
				problem = mandateSigError(registry, CtxDelegation, m, "human_composite_sig", keys.HumanKeys, "human_keys", now)
			} else {
				agentID, _ := parent["agent_id"].(string)
				problem = mandateSigError(registry, CtxSubMandate, m, "delegator_composite_sig", keys.AgentKeys[agentID], "agent_keys of "+agentID, now)
			}
			if problem != "" {
				errors = append(errors, at(problem))
			}
		}
		if len(errors) > 0 {
			return invalid(errors)
		}

		if tier, present := m["minimum_security_tier"]; present {
			if effective == "" {
				effective = tier.(string)
			} else {
				effective = MaxTier(effective, tier.(string))
			}
		}
		parent = m
	}
	return MandateChainResult{Valid: true, Errors: []string{}, Depth: len(chain) - 1, EffectiveTier: effective}
}
