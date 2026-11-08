package v2

// Mandate acknowledgment (opt-in, MP-02 F4): DCP-09 § 3.3 steps 4–6. The delegate agent signs a separate,
// versioned record (format dcp09-mandate-ack-v1, context DCP-AI.v2.MandateAcknowledgment) that binds one mandate
// of a chain, the chain up to it and the agent's awareness threshold. Go port of the TypeScript SDK's
// core/mandate-acknowledgment.ts; design: docs/reviews/mp02-acknowledgment-design.md v0.2.
//
// EvaluateDelegationActivationV2 copies the evidence, the acknowledgments, the thresholds and the configuration,
// runs the delegated admission (F2) over the copies at one instant, and evaluates the acknowledgments only when
// that composition is admitted, with the agents, keys, policy, mode and revocation snapshot the composition
// verified. Nothing is taken from the caller as a result, key or digest. An active delegation authorizes no
// action: ActionAuthorized is always false, and neither authority_scope nor threshold_rules is evaluated.
//
// Go receives each acknowledgment and threshold as bytes (design § 2.2), so its verdict is a verdict on bytes:
// each element goes through the existing candidate scanner and its canonical bytes are compared with
// CanonicalizeV2 of what json.Unmarshal decodes, before the value is used. A difference is ACK_PARSER_MISMATCH,
// a local fault of Go's parser, not a verdict on the data. nil and empty slices are the same: no element.

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
	"time"
	"unicode/utf8"
)

// MandateAcknowledgmentFormat is the version of the acknowledgment record.
const MandateAcknowledgmentFormat = "dcp09-mandate-ack-v1"

// ActivationEvidence is the evidence of AdmitDelegatedBundleV2 plus the acknowledgments and the thresholds they
// name, each the JSON bytes of one record. A nil slice and an empty one are the same: no element.
type ActivationEvidence struct {
	DelegatedEvidence
	Acknowledgments     [][]byte
	AwarenessThresholds [][]byte
}

// AcknowledgmentEntry reports the acknowledgment of one mandate of the chain.
type AcknowledgmentEntry struct {
	MandateID            string  `json:"mandate_id"`
	AcknowledgmentID     *string `json:"acknowledgment_id"`
	AwarenessThresholdID *string `json:"awareness_threshold_id"`
	Verified             bool    `json:"verified"`
}

// ActivationInputs records the instant and the number of elements evaluated.
type ActivationInputs struct {
	Now                 int64 `json:"now"`
	Acknowledgments     int   `json:"acknowledgments"`
	AwarenessThresholds int   `json:"awareness_thresholds"`
}

// DelegationActivationResult is the outcome of EvaluateDelegationActivationV2.
type DelegationActivationResult struct {
	// Composition is exactly AdmitDelegatedBundleV2's result over the same copies and instant.
	Composition *DelegatedAdmissionResult `json:"composition"`
	// Activation is "evaluated" if and only if the composition is admitted, else "not_evaluated".
	Activation string `json:"activation"`
	// DelegationActive: activation evaluated and no acknowledgment error.
	DelegationActive bool `json:"delegation_active"`
	// ActionAuthorized is always false: activation authorizes no action.
	ActionAuthorized bool `json:"action_authorized"`
	// Acknowledgments has one entry per mandate, chain order; empty when not evaluated.
	Acknowledgments []AcknowledgmentEntry `json:"acknowledgments"`
	Inputs          ActivationInputs      `json:"inputs"`
	// Errors are in the normative order of design § 7.2.
	Errors []AdmissionError `json:"errors"`
}

// MandateAcknowledgmentParams are the inputs of CreateMandateAcknowledgment.
type MandateAcknowledgmentParams struct {
	// MandateChain is the JSON array of the chain, root first, ending with the acknowledged mandate.
	MandateChain []byte
	// AwarenessThreshold is the JSON of the signed threshold of the same agent.
	AwarenessThreshold []byte
	AcknowledgmentID   string
	// AcknowledgedAt is RFC 3339; empty: the system clock, UTC, milliseconds.
	AcknowledgedAt string
}

// ── Form (design § 2, § 2.1 and § 2.2) ──

// The members of schemas/v2/mandate_acknowledgment.schema.json and of awareness_threshold.schema.json, all
// required; checked by the parity test (through export_test.go).
var (
	ackFields       = []string{"dcp_version", "acknowledgment_format", "acknowledgment_id", "mandate_id", "mandate_hash", "chain_hash", "session_nonce", "human_id", "agent_id", "awareness_threshold_id", "awareness_threshold_hash", "acknowledged_at", "composite_sig"}
	thresholdFields = []string{"dcp_version", "threshold_id", "session_nonce", "agent_id", "human_id", "threshold_rules", "timestamp", "composite_sig"}
	ruleFields      = []string{"dimension", "operator", "value", "action_if_triggered"}
	ruleOperators   = []string{"gt", "lt", "gte", "lte", "eq"}
	ruleActions     = []string{"notify", "escalate", "block"}
	ackDigest       = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

const maxSafeInteger = 9007199254740991

func membersError(v map[string]interface{}, fields []string) string {
	for _, k := range slices.Sorted(mapsKeys(v)) {
		if !slices.Contains(fields, k) {
			return "unknown member " + printable(k)
		}
	}
	for _, k := range fields {
		if _, ok := v[k]; !ok {
			return "missing " + k
		}
	}
	return ""
}

// illFormedString is where the first string (a value or a member name) that is not valid UTF-8 is. After the
// scanner and encoding/json no string can be, so this guards the creator's string arguments and values built in
// memory.
func illFormedString(v interface{}, where string) string {
	switch x := v.(type) {
	case string:
		if !utf8.ValidString(x) {
			return where
		}
	case []interface{}:
		for i, e := range x {
			if bad := illFormedString(e, fmt.Sprintf("%s[%d]", where, i)); bad != "" {
				return bad
			}
		}
	case map[string]interface{}:
		for _, k := range slices.Sorted(mapsKeys(x)) {
			if !utf8.ValidString(k) {
				return where + " member name"
			}
			if bad := illFormedString(x[k], where+"."+k); bad != "" {
				return bad
			}
		}
	}
	return ""
}

func isInstant(v interface{}) bool {
	s, ok := v.(string)
	_, parsed := parseRFC3339(v)
	return ok && schemaIsDateTime(s) && parsed
}

// isSafeIntegerValue is design § 2.1: an integer value of ±(2^53 − 1); a bool is another type.
func isSafeIntegerValue(v interface{}) bool {
	f, ok := v.(float64)
	return ok && f == math.Trunc(f) && math.Abs(f) <= maxSafeInteger
}

func acknowledgmentFieldsError(a map[string]interface{}, fields []string) string {
	if e := membersError(a, fields); e != "" {
		return e
	}
	if bad := illFormedString(a, "acknowledgment"); bad != "" {
		return bad + " is not Unicode scalar values"
	}
	if a["dcp_version"] != "2.0" {
		return `dcp_version must be "2.0"`
	}
	if a["acknowledgment_format"] != MandateAcknowledgmentFormat {
		return `acknowledgment_format must be "` + MandateAcknowledgmentFormat + `"`
	}
	for _, f := range []string{"acknowledgment_id", "mandate_id", "human_id", "agent_id", "awareness_threshold_id"} {
		if !minLength(a[f], 6) {
			return f + " must be a string of at least 6 code points"
		}
	}
	for _, f := range []string{"mandate_hash", "chain_hash", "awareness_threshold_hash"} {
		if s, ok := a[f].(string); !ok || !ackDigest.MatchString(s) {
			return f + " is not sha256: and 64 lowercase hex digits"
		}
	}
	if s, ok := a["session_nonce"].(string); !ok || !delegatedNonce.MatchString(s) {
		return "session_nonce is not 64 lowercase hex digits"
	}
	if !isInstant(a["acknowledged_at"]) {
		return "acknowledged_at is not an RFC 3339 date-time"
	}
	return ""
}

// acknowledgmentFormError is the first defect of an acknowledgment's form, in the fixed order of design § 2.
func acknowledgmentFormError(v interface{}) string {
	a, ok := v.(map[string]interface{})
	if !ok {
		return "not an object"
	}
	if e := acknowledgmentFieldsError(a, ackFields); e != "" {
		return e
	}
	return signatureSlotError(a["composite_sig"], "composite_sig")
}

// thresholdFormError is the first defect of an awareness threshold's form, with the domain of design § 2.1.
func thresholdFormError(v interface{}) string {
	u, ok := v.(map[string]interface{})
	if !ok {
		return "not an object"
	}
	if e := membersError(u, thresholdFields); e != "" {
		return e
	}
	if bad := illFormedString(u, "threshold"); bad != "" {
		return bad + " is not Unicode scalar values"
	}
	if u["dcp_version"] != "2.0" {
		return `dcp_version must be "2.0"`
	}
	for _, f := range []string{"threshold_id", "agent_id", "human_id"} {
		if !minLength(u[f], 6) {
			return f + " must be a string of at least 6 code points"
		}
	}
	if s, ok := u["session_nonce"].(string); !ok || !delegatedNonce.MatchString(s) {
		return "session_nonce is not 64 lowercase hex digits"
	}
	if !isInstant(u["timestamp"]) {
		return "timestamp is not an RFC 3339 date-time"
	}
	rules, ok := u["threshold_rules"].([]interface{})
	if !ok || len(rules) == 0 {
		return "threshold_rules must be a non-empty array"
	}
	for i, raw := range rules {
		at := fmt.Sprintf("threshold_rules[%d]", i)
		r, ok := raw.(map[string]interface{})
		if !ok {
			return at + " is not an object"
		}
		if e := membersError(r, ruleFields); e != "" {
			return at + ": " + e
		}
		if !minLength(r["dimension"], 1) {
			return at + ".dimension must be a non-empty string"
		}
		if op, ok := r["operator"].(string); !ok || !slices.Contains(ruleOperators, op) {
			return at + ".operator is not gt, lt, gte, lte or eq"
		}
		if !isSafeIntegerValue(r["value"]) {
			return at + ".value is not an integer of ±(2^53 − 1)"
		}
		if act, ok := r["action_if_triggered"].(string); !ok || !slices.Contains(ruleActions, act) {
			return at + ".action_if_triggered is not notify, escalate or block"
		}
	}
	if e := signatureSlotError(u["composite_sig"], "composite_sig"); e != "" {
		return e
	}
	if _, err := CanonicalizeV2(unsignedRecord(u)); err != nil {
		return "not canonicalizable under dcp-jcs-v1: " + err.Error()
	}
	return ""
}

// ingestRecord is the bytes contract of design § 2.2 for one record: ingestValue, and the value as an object
// (anything else fails the record's form).
func ingestRecord(raw []byte, decode func([]byte) (any, error)) (map[string]interface{}, string, string) {
	value, kind, message := ingestValue(raw, decode)
	m, _ := value.(map[string]interface{})
	return m, kind, message
}

// ingestValue is the bytes contract of design § 2.2: the existing scanner over the bytes (UTF-8, lone surrogates,
// duplicate keys, integer values within ±(2^53 − 1), depth), then the decoder, and the comparison of
// CanonicalizeV2 of the decoded value with the scanner's canonical bytes. Integer values written as 5.0 pass,
// as everywhere in F4; the literal rule of F3 does not apply. It returns the value, or a rejection: kind "form"
// (the scanner's class and offset) or "parser". Nothing is repaired: invalid bytes are not replaced, repeated
// keys are not collapsed.
func ingestValue(raw []byte, decode func([]byte) (any, error)) (any, string, string) {
	scanned, err := ExperimentalCandidateIngress(raw)
	if err != nil {
		return nil, "form", "the scanner failed: " + err.Error()
	}
	if !scanned.Accepted {
		return nil, "form", fmt.Sprintf("bytes rejected: %s at offset %d", scanned.Class, scanned.Offset)
	}
	value, err := decode(raw)
	if err != nil {
		return nil, "parser", "the decoder failed: " + err.Error()
	}
	canonical, err := CanonicalizeV2(value)
	if err != nil || !bytes.Equal([]byte(canonical), scanned.Canonical) {
		return nil, "parser", "the decoded value does not reproduce the scanner's canonical bytes"
	}
	return value, "", ""
}

// ── Hashes (design § 2) ──

func ackDigestOf(v interface{}) (string, error) {
	canonical, err := CanonicalizeV2(v)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func unsignedRecord(r map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(r))
	for k, v := range r {
		if k != "composite_sig" {
			out[k] = v
		}
	}
	return out
}

// mandateHashOf is the digest of the mandate without human_composite_sig and delegator_composite_sig (§ 3.4).
func mandateHashOf(m map[string]interface{}) (string, error) {
	payload := make(map[string]interface{}, len(m))
	for k, v := range m {
		if k != "human_composite_sig" && k != "delegator_composite_sig" {
			payload[k] = v
		}
	}
	return ackDigestOf(payload)
}

// chainHashesOf is the chain_hash of each mandate: the digest of the array of mandate_hash from the root to it.
func chainHashesOf(mandates []map[string]interface{}) ([]string, []string, error) {
	hashes := make([]string, len(mandates))
	for i, m := range mandates {
		h, err := mandateHashOf(m)
		if err != nil {
			return nil, nil, err
		}
		hashes[i] = h
	}
	chains := make([]string, len(mandates))
	for i := range mandates {
		prefix := make([]interface{}, i+1)
		for j := 0; j <= i; j++ {
			prefix[j] = hashes[j]
		}
		c, err := ackDigestOf(prefix)
		if err != nil {
			return nil, nil, err
		}
		chains[i] = c
	}
	return hashes, chains, nil
}

func thresholdHashOf(u map[string]interface{}) (string, error) {
	return ackDigestOf(unsignedRecord(u))
}

func compositeOf(v interface{}) (*CompositeSignature, bool) {
	var cs CompositeSignature
	raw, err := json.Marshal(v)
	if err != nil || json.Unmarshal(raw, &cs) != nil || cs.PQ == nil {
		return nil, false
	}
	return &cs, true
}

// ── Creation (design § 3.2) ──

// CreateMandateAcknowledgment signs the acknowledgment of the last mandate of p.MandateChain, linked to
// p.AwarenessThreshold. It computes mandate_hash, chain_hash and awareness_threshold_hash from the inputs and
// takes no digest from the caller. The byte slices are copied and the keys are values, so nothing the caller
// holds is read after the copy or modified. Errors name kids, never a secret.
//
// Creation guard (opt-in to this new API only): a signature commits to what it signs, so both the chain and the
// threshold go through the bytes contract of design § 2.2 before anything is decoded for use. Bytes that the
// decoder would repair (an escaped lone surrogate, invalid UTF-8) or collapse (a repeated key), and bytes whose
// decoded value does not reproduce the scanner's canonical bytes, are rejected before signing. AdmitDelegatedBundleV2
// and the evaluation keep decoding mandates as F2 does.
func CreateMandateAcknowledgment(registry *AlgorithmRegistry, classicalKey, pqKey CompositeKeyInfo, p MandateAcknowledgmentParams) (map[string]interface{}, error) {
	return createMandateAcknowledgment(registry, classicalKey, pqKey, p, decodeIngressJSON)
}

func createMandateAcknowledgment(registry *AlgorithmRegistry, classicalKey, pqKey CompositeKeyInfo, p MandateAcknowledgmentParams, decode func([]byte) (any, error)) (map[string]interface{}, error) {
	fail := func(format string, args ...interface{}) (map[string]interface{}, error) {
		return nil, fmt.Errorf("create mandate acknowledgment: "+format, args...)
	}
	chainJSON, thresholdJSON := bytes.Clone(p.MandateChain), bytes.Clone(p.AwarenessThreshold)
	if classicalKey.Alg != "ed25519" {
		return fail("the classical key must be ed25519")
	}
	if pqKey.Alg != "ml-dsa-65" && pqKey.Alg != "slh-dsa-192f" {
		return fail("the PQ key must be ml-dsa-65 or slh-dsa-192f")
	}
	// The public metadata the signature slot will carry: a canonical public key of the algorithm's size, and its
	// derived kid (V2-13).
	for _, k := range []struct {
		name string
		key  CompositeKeyInfo
	}{{"classical", classicalKey}, {"pq", pqKey}} {
		entry := map[string]interface{}{"kid": k.key.Kid, "alg": k.key.Alg, "public_key_b64": k.key.PublicKeyB64}
		if e := usedKeyError(entry, k.key.Kid, k.key.Alg, k.name+" key"); e != "" {
			return fail("%s", e)
		}
	}

	chainValue, kind, message := ingestValue(chainJSON, decode)
	if kind != "" {
		return fail("the mandate chain: %s", message)
	}
	items, ok := chainValue.([]interface{})
	if !ok || len(items) == 0 {
		return fail("the mandate chain must be a non-empty array")
	}
	mandates := make([]map[string]interface{}, len(items))
	for i, item := range items {
		if errs := mandatePreflight(item, i); len(errs) > 0 {
			return fail("%s", errs[0])
		}
		mandates[i] = item.(map[string]interface{})
		if i > 0 && mandates[i]["parent_mandate_id"] != mandates[i-1]["mandate_id"] {
			return fail("mandate[%d] does not name mandate[%d] as its parent", i, i-1)
		}
	}
	u, kind, message := ingestRecord(thresholdJSON, decode)
	if kind != "" {
		return fail("the awareness threshold: %s", message)
	}
	if e := thresholdFormError(u); e != "" {
		return fail("the awareness threshold: %s", e)
	}
	if !utf8.ValidString(p.AcknowledgmentID) || utf8.RuneCountInString(p.AcknowledgmentID) < 6 {
		return fail("the acknowledgment id must be at least 6 Unicode scalar values")
	}
	acknowledgedAt := p.AcknowledgedAt
	if acknowledgedAt == "" {
		acknowledgedAt = time.Now().UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
	}
	at, parsed := parseRFC3339(acknowledgedAt)
	if !parsed || !schemaIsDateTime(acknowledgedAt) {
		return fail("acknowledged_at is not an RFC 3339 date-time")
	}

	m := mandates[len(mandates)-1]
	for _, f := range []string{"agent_id", "human_id", "session_nonce"} {
		if u[f] != m[f] {
			return fail("the threshold's %s is not the mandate's", f)
		}
	}
	mandateTime, _ := parseRFC3339(m["timestamp"])
	thresholdTime, _ := parseRFC3339(u["timestamp"])
	validUntil, _ := parseRFC3339(m["valid_until"])
	switch {
	case at.Before(mandateTime):
		return fail("acknowledged_at is before the mandate timestamp")
	case at.Before(thresholdTime):
		return fail("acknowledged_at is before the threshold timestamp")
	case at.After(validUntil):
		return fail("acknowledged_at is after the mandate valid_until")
	}

	hashes, chains, err := chainHashesOf(mandates)
	if err != nil {
		return fail("a mandate of the chain cannot be hashed under dcp-jcs-v1: %v", err)
	}
	thresholdHash, err := thresholdHashOf(u)
	if err != nil {
		return fail("the threshold cannot be hashed under dcp-jcs-v1: %v", err)
	}
	payload := map[string]interface{}{
		"dcp_version":              "2.0",
		"acknowledgment_format":    MandateAcknowledgmentFormat,
		"acknowledgment_id":        p.AcknowledgmentID,
		"mandate_id":               m["mandate_id"],
		"mandate_hash":             hashes[len(hashes)-1],
		"chain_hash":               chains[len(chains)-1],
		"session_nonce":            m["session_nonce"],
		"human_id":                 m["human_id"],
		"agent_id":                 m["agent_id"],
		"awareness_threshold_id":   u["threshold_id"],
		"awareness_threshold_hash": thresholdHash,
		"acknowledged_at":          acknowledgedAt,
	}
	// Every computed field, before signing: a mandate field copied here must give an acknowledgment of the form
	// design § 2 requires, which the mandate preflight alone does not ensure.
	unsigned := slices.DeleteFunc(slices.Clone(ackFields), func(f string) bool { return f == "composite_sig" })
	if e := acknowledgmentFieldsError(payload, unsigned); e != "" {
		return fail("the acknowledgment would not have its form: %s", e)
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return fail("the acknowledgment cannot be canonicalized: %v", err)
	}
	sig, err := CompositeSign(registry, CtxMandateAcknowledgment, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return fail("signing: %v", err)
	}
	var slot interface{}
	if raw, err := json.Marshal(sig); err != nil || json.Unmarshal(raw, &slot) != nil {
		return fail("the signature cannot be encoded")
	}
	payload["composite_sig"] = slot
	if e := acknowledgmentFormError(payload); e != "" {
		return fail("the signed acknowledgment does not have its form: %s", e)
	}
	return payload, nil
}

// ── Evaluation (design § 4) ──

// EvaluateDelegationActivationV2 evaluates the activation of a delegation (design § 4): the delegated admission
// over one copy of everything, then the acknowledgments of every mandate of its chain. It returns an
// *AdmissionConfigError for an invalid operator configuration, as AdmitDelegatedBundleV2 does; every problem
// with the evidence or the acknowledgments is a code in the result. Nothing is promised if another goroutine of
// the caller changes the byte slices while they are copied: that is a data race of the caller.
func EvaluateDelegationActivationV2(registry *AlgorithmRegistry, evidence ActivationEvidence, operator DelegatedOperator) (*DelegationActivationResult, error) {
	return evaluateDelegationActivation(registry, evidence, operator, decodeIngressJSON)
}

type ackPair struct {
	k, u map[string]interface{}
}

func evaluateDelegationActivation(registry *AlgorithmRegistry, evidence ActivationEvidence, operator DelegatedOperator, decode func([]byte) (any, error)) (*DelegationActivationResult, error) {
	// ── 0–1. F2's snapshot (configuration errors return), then a copy of every element ──
	snapshot, err := takeDelegatedSnapshot(evidence.DelegatedEvidence, operator)
	if err != nil {
		return nil, err
	}
	ackJSON := make([][]byte, len(evidence.Acknowledgments))
	for i, b := range evidence.Acknowledgments {
		ackJSON[i] = bytes.Clone(b)
	}
	thresholdJSON := make([][]byte, len(evidence.AwarenessThresholds))
	for i, b := range evidence.AwarenessThresholds {
		thresholdJSON[i] = bytes.Clone(b)
	}

	// ── 2. The composition, always ──
	composition, verified, err := composeDelegated(registry, snapshot)
	if err != nil {
		return nil, err
	}
	a := &admission{errors: []AdmissionError{}}
	out := &DelegationActivationResult{
		Composition:     composition,
		Activation:      "not_evaluated",
		Acknowledgments: []AcknowledgmentEntry{},
		Inputs:          ActivationInputs{Now: snapshot.now.UnixMilli(), Acknowledgments: len(ackJSON), AwarenessThresholds: len(thresholdJSON)},
	}
	finish := func() (*DelegationActivationResult, error) {
		out.Errors = a.errors
		out.DelegationActive = out.Activation == "evaluated" && len(a.errors) == 0
		return out, nil
	}
	if !composition.Admitted || verified == nil {
		return finish()
	}
	out.Activation = "evaluated"
	ids := make([]string, len(verified.mandates))
	for i, m := range verified.mandates {
		ids[i] = m["mandate_id"].(string)
		out.Acknowledgments = append(out.Acknowledgments, AcknowledgmentEntry{MandateID: ids[i]})
	}

	// ── 3. Form: the bytes contract, then the value ──
	acks := make([]map[string]interface{}, len(ackJSON))
	for i, raw := range ackJSON {
		v, kind, message := ingestRecord(raw, decode)
		switch {
		case kind == "parser":
			a.add("ACK_PARSER_MISMATCH", "acknowledgments[%d]: %s", i, message)
		case kind != "":
			a.add("ACK_FORM_INVALID", "acknowledgments[%d]: %s", i, message)
		default:
			if e := acknowledgmentFormError(v); e != "" {
				a.add("ACK_FORM_INVALID", "acknowledgments[%d]: %s", i, e)
			}
			acks[i] = v
		}
	}
	thresholds := make([]map[string]interface{}, len(thresholdJSON))
	for i, raw := range thresholdJSON {
		v, kind, message := ingestRecord(raw, decode)
		switch {
		case kind == "parser":
			a.add("ACK_PARSER_MISMATCH", "awareness_thresholds[%d]: %s", i, message)
		case kind != "":
			a.add("ACK_THRESHOLD_INVALID", "awareness_thresholds[%d]: %s", i, message)
		default:
			if e := thresholdFormError(v); e != "" {
				a.add("ACK_THRESHOLD_INVALID", "awareness_thresholds[%d]: %s", i, e)
			}
			thresholds[i] = v
		}
	}
	if len(a.errors) > 0 {
		return finish()
	}

	// ── 4. Cardinality, in the order of design § 7.2 ──
	str := func(m map[string]interface{}, f string) string { s, _ := m[f].(string); return s }
	byMandate := make([][]map[string]interface{}, len(ids))
	for i, id := range ids {
		for _, k := range acks {
			if str(k, "mandate_id") == id {
				byMandate[i] = append(byMandate[i], k)
			}
		}
		switch {
		case len(byMandate[i]) == 0:
			a.add("ACK_MISSING", "mandate %s has no acknowledgment", printable(id))
		case len(byMandate[i]) > 1:
			a.add("ACK_DUPLICATE", "mandate %s has %d acknowledgments", printable(id), len(byMandate[i]))
		}
	}
	for i, k := range acks {
		if !slices.Contains(ids, str(k, "mandate_id")) {
			a.add("ACK_UNEXPECTED", "acknowledgments[%d] acknowledges %s, not in the chain", i, printable(k["mandate_id"]))
		}
	}
	secondOccurrences := func(values []string) []int {
		seen, out := map[string]int{}, []int{}
		for i, v := range values {
			seen[v]++
			if seen[v] == 2 {
				out = append(out, i)
			}
		}
		return out
	}
	field := func(records []map[string]interface{}, f string) []string {
		out := make([]string, len(records))
		for i, r := range records {
			out[i] = str(r, f)
		}
		return out
	}
	for _, i := range secondOccurrences(field(acks, "acknowledgment_id")) {
		a.add("ACK_DUPLICATE", "acknowledgment_id %s is repeated", printable(acks[i]["acknowledgment_id"]))
	}
	for _, i := range secondOccurrences(field(thresholds, "threshold_id")) {
		a.add("ACK_THRESHOLD_DUPLICATE", "threshold_id %s is repeated", printable(thresholds[i]["threshold_id"]))
	}
	thresholdIDs := field(thresholds, "threshold_id")
	for i, k := range acks {
		if !slices.Contains(thresholdIDs, str(k, "awareness_threshold_id")) {
			a.add("ACK_THRESHOLD_MISSING", "acknowledgments[%d] names threshold %s, which was not given", i, printable(k["awareness_threshold_id"]))
		}
	}
	for _, i := range secondOccurrences(field(acks, "awareness_threshold_id")) {
		a.add("ACK_THRESHOLD_REUSED", "threshold %s is named by more than one acknowledgment", printable(acks[i]["awareness_threshold_id"]))
	}
	named := field(acks, "awareness_threshold_id")
	for i, u := range thresholds {
		if !slices.Contains(named, str(u, "threshold_id")) {
			a.add("ACK_THRESHOLD_UNEXPECTED", "awareness_thresholds[%d] (%s) is named by no acknowledgment", i, printable(u["threshold_id"]))
		}
	}
	for i, list := range byMandate {
		if len(list) != 1 {
			continue
		}
		ackID := str(list[0], "acknowledgment_id")
		out.Acknowledgments[i].AcknowledgmentID = &ackID
		var matching []string
		for _, u := range thresholds {
			if str(u, "threshold_id") == str(list[0], "awareness_threshold_id") {
				matching = append(matching, str(u, "threshold_id"))
			}
		}
		if len(matching) == 1 {
			out.Acknowledgments[i].AwarenessThresholdID = &matching[0]
		}
	}
	if len(a.errors) > 0 {
		return finish()
	}

	// ── 5–8. Per mandate, chain order: A bindings, B keys and policy, C signatures, D own time ──
	pairs := make([]ackPair, len(ids))
	for i, list := range byMandate {
		for _, u := range thresholds {
			if str(u, "threshold_id") == str(list[0], "awareness_threshold_id") {
				pairs[i] = ackPair{k: list[0], u: u}
			}
		}
	}
	hashes, chains, err := chainHashesOf(verified.mandates)
	if err != nil {
		return nil, fmt.Errorf("mandate acknowledgment: the verified chain cannot be hashed: %w", err)
	}
	n := len(ids)
	selfValid := make([]bool, n)
	pairKeys := make([][]map[string]interface{}, n)
	for i := range ids {
		if keys := evaluateAckPair(i, pairs[i], verified, hashes[i], chains[i], registry, a); keys != nil {
			selfValid[i], pairKeys[i] = true, keys
		}
	}

	// ── 9. T5: the parent acknowledged before the sub-mandate was issued ──
	t5Failed := make([]bool, n)
	for i := 1; i < n; i++ {
		if !selfValid[i-1] {
			continue
		}
		parentAck, _ := parseRFC3339(pairs[i-1].k["acknowledged_at"])
		issued, _ := parseRFC3339(verified.mandates[i]["timestamp"])
		if parentAck.After(issued) {
			a.add("ACK_TIME_INVALID", "T5: the acknowledgment of mandate %s is after the issuance of mandate %s", printable(ids[i-1]), printable(ids[i]))
			t5Failed[i-1] = true
		}
	}

	// ── 10. Revocation of the keys only acknowledgments and thresholds use, in the composition's snapshot ──
	revokedPair := make([]bool, n)
	users := map[string][]int{}
	for i, keys := range pairKeys {
		if !selfValid[i] {
			continue
		}
		for _, key := range keys {
			kid, _ := key["kid"].(string)
			if verified.checkedKids[kid] {
				continue
			}
			users[kid] = append(users[kid], i)
		}
	}
	statuses := map[string]interface{}{}
	if decoded, err := decodeJSONValue(verified.revocation); err == nil {
		if obj, ok := decoded.(map[string]interface{}); ok {
			if keys, ok := obj["keys"].(map[string]interface{}); ok {
				statuses = keys
			}
		}
	}
	kids := make([]string, 0, len(users))
	for kid := range users {
		kids = append(kids, kid)
	}
	sort.Strings(kids)
	for _, kid := range kids {
		switch statuses[kid] {
		case "not_revoked":
			continue
		case "revoked":
			a.add("ACK_KEY_REVOKED", "key %s is revoked", kid)
		default:
			a.add("ACK_KEY_REVOCATION_UNKNOWN", "the revocation status of key %s is unknown", kid)
		}
		for _, i := range users[kid] {
			revokedPair[i] = true
		}
	}

	// ── 11. Result ──
	for i := range ids {
		out.Acknowledgments[i].Verified = selfValid[i] && !t5Failed[i] && !revokedPair[i]
	}
	return finish()
}

// evaluateAckPair runs phases A to D for mandate i (design § 4.2): each phase runs all its checks, and a phase
// that adds a code skips the later phases of this mandate. It returns the four resolved keys when every phase
// passed, else nil.
func evaluateAckPair(i int, p ackPair, verified *delegatedVerified, mandateHash, chainHash string, registry *AlgorithmRegistry, a *admission) []map[string]interface{} {
	k, u := p.k, p.u
	m := verified.mandates[i]
	label := "mandate " + printable(m["mandate_id"])
	failed := false
	fail := func(code, format string, args ...interface{}) {
		failed = true
		a.add(code, "%s: %s", label, fmt.Sprintf(format, args...))
	}

	// A. Bindings, in the order of design § 4.4
	if k["mandate_hash"] != mandateHash {
		fail("ACK_MANDATE_MISMATCH", "mandate_hash is not the hash of the mandate")
	}
	if k["session_nonce"] != m["session_nonce"] {
		fail("ACK_MANDATE_MISMATCH", "session_nonce is not the mandate's")
	}
	if k["human_id"] != m["human_id"] {
		fail("ACK_MANDATE_MISMATCH", "human_id is not the mandate's")
	}
	if k["agent_id"] != m["agent_id"] {
		fail("ACK_MANDATE_MISMATCH", "agent_id is not the mandate's")
	}
	if k["chain_hash"] != chainHash {
		fail("ACK_CHAIN_MISMATCH", "chain_hash is not the hash of the chain up to the mandate")
	}
	if th, err := thresholdHashOf(u); err != nil || k["awareness_threshold_hash"] != th {
		fail("ACK_THRESHOLD_MISMATCH", "awareness_threshold_hash is not the hash of the threshold")
	}
	for _, f := range []string{"agent_id", "human_id", "session_nonce"} {
		if u[f] != m[f] {
			fail("ACK_THRESHOLD_MISMATCH", "the threshold's %s is not the mandate's", f)
		}
	}
	if failed {
		return nil
	}

	// B. Keys, in the passport the composition verified for the mandate's agent, then the policy
	agentID, _ := m["agent_id"].(string)
	list := verified.agentKeys[agentID]
	ucs, _ := compositeOf(u["composite_sig"])
	kcs, _ := compositeOf(k["composite_sig"])
	components := []struct {
		where string
		entry SignatureEntry
		kind  string
	}{
		{"threshold classical", ucs.Classical, "classical"},
		{"threshold pq", *ucs.PQ, "pq"},
		{"acknowledgment classical", kcs.Classical, "classical"},
		{"acknowledgment pq", *kcs.PQ, "pq"},
	}
	var resolved []map[string]interface{}
	for _, c := range components {
		key, problem := signerKey(list, c.entry, verified.now)
		if problem != "" {
			code := "ACK_KEY_UNKNOWN"
			if findKey(list, c.entry.Kid) != nil {
				code = "ACK_KEY_INVALID"
			}
			fail(code, "%s: %s in the passport of %s", c.where, problem, printable(agentID))
			continue
		}
		if e := usedKeyError(key, c.entry.Kid, c.entry.Alg, c.where); e != "" {
			fail("ACK_KEY_INVALID", "%s", e)
			continue
		}
		resolved = append(resolved, key)
	}
	for _, c := range components {
		if c.kind == "classical" && verified.mode == "pq_only" {
			continue
		}
		accepted := verified.policy.AcceptedPQAlgs
		if c.kind == "classical" {
			accepted = verified.policy.AcceptedClassicalAlgs
		}
		if !slices.Contains(accepted, c.entry.Alg) {
			fail("ACK_ALGORITHM_REJECTED", "%s: %s is not accepted by the verifier policy", c.where, c.entry.Alg)
		}
		if slices.Contains(verified.policy.AdvisoryRejectedAlgs, c.entry.Alg) {
			fail("ACK_ALGORITHM_REJECTED", "%s: %s is rejected by an active advisory", c.where, c.entry.Alg)
		}
	}
	if failed {
		return nil
	}

	// C. Signatures: the threshold under Awareness, then the acknowledgment under its own context
	verifies := func(context string, record map[string]interface{}, cs *CompositeSignature, classical, pq map[string]interface{}) bool {
		canonical, err := CanonicalizeV2(unsignedRecord(record))
		if err != nil {
			return false
		}
		classicalPK, _ := classical["public_key_b64"].(string)
		pqPK, _ := pq["public_key_b64"].(string)
		r, err := CompositeVerify(registry, context, []byte(canonical), cs, classicalPK, pqPK)
		return err == nil && r.Valid && r.ClassicalValid && r.PQValid
	}
	if !verifies(CtxAwareness, u, ucs, resolved[0], resolved[1]) {
		fail("ACK_THRESHOLD_SIGNATURE_INVALID", "the threshold does not verify under DCP-AI.v2.Awareness")
	}
	if !verifies(CtxMandateAcknowledgment, k, kcs, resolved[2], resolved[3]) {
		fail("ACK_SIGNATURE_INVALID", "the acknowledgment does not verify under DCP-AI.v2.MandateAcknowledgment")
	}
	if failed {
		return nil
	}

	// D. Own time, T1 to T4 (design § 6)
	at, _ := parseRFC3339(k["acknowledged_at"])
	mandateTime, _ := parseRFC3339(m["timestamp"])
	thresholdTime, _ := parseRFC3339(u["timestamp"])
	validUntil, _ := parseRFC3339(m["valid_until"])
	if at.Before(mandateTime) {
		fail("ACK_TIME_INVALID", "T1: acknowledged_at is before the mandate timestamp")
	}
	if at.Before(thresholdTime) {
		fail("ACK_TIME_INVALID", "T2: acknowledged_at is before the threshold timestamp")
	}
	if at.After(validUntil) {
		fail("ACK_TIME_INVALID", "T3: acknowledged_at is after the mandate valid_until")
	}
	if at.After(verified.now.Add(sessionClockSkew)) {
		fail("ACK_TIME_INVALID", "T4: acknowledged_at is after now plus the clock skew")
	}
	if failed {
		return nil
	}
	return resolved
}
