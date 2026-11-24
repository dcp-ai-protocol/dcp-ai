// Multi-party authorization: the opt-in mpa-v1 profile (spec/profiles/multi-party).
//
// Three layers, each with its own answer:
//
//   - structure: CheckMultiPartyAuthorizationStructure. Is the record well
//     formed? It verifies no signature.
//   - verification: which parties signed exactly this request, with the keys the
//     operator trusts for them.
//   - authorization: whether those parties are enough for this operation on this
//     target, for this verifier, now.
//
// EvaluateMultiPartyAuthorization gives the last two; only it produces
// Authorized.
//
// Each party signs {operation, operation_payload, party_id, role} under
// DCP-AI.v2.MultiPartyAuth, as in v2.0. Under mpa-v1 the operation_payload is
// {request, parameters}, so the target, the audience and the validity window are
// signed too. Who the parties of a target are, their roles and the threshold come
// from the operator's policy set; their keys come from the operator's principal
// trust set. Nothing in the record stands for either.
//
// Deterministic and offline. It keeps no state: evaluating a request does not
// consume it (single use is the executor's, which must consume request_id and
// execute atomically).

package v2

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"regexp"
	"slices"
	"strconv"
	"time"
	"unicode/utf8"
)

const (
	// MPAV1 is the profile identifier.
	MPAV1 = "mpa-v1"
	// MPAV1MaxAuthorizations is the most authorizations a record may carry under the profile.
	MPAV1MaxAuthorizations = 16
	// MPAV1MaxValiditySeconds is the longest validity window an operator may allow.
	MPAV1MaxValiditySeconds = 86400

	mpaMaxRequestID  = 128
	mpaMaxIdentifier = 256
	mpaMaxMessage    = 300
)

var (
	mpaOperations = []string{"revoke_agent", "rotate_org_key", "change_jurisdiction", "modify_recovery_config"}
	mpaRoles      = []string{"owner", "org_admin", "recovery_contact"}
	mpaKid        = regexp.MustCompile(`^[0-9a-f]{32}$`)
	mpaSigB64     = regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`)
)

// MultiPartyConfigError is a policy set, or what the executor states, that
// cannot be used. Code is one of the CONFIG_* codes of
// spec/profiles/multi-party § 5.3.
type MultiPartyConfigError struct {
	Code    string
	Message string
}

func (e *MultiPartyConfigError) Error() string { return e.Code + ": " + e.Message }

func mpaBounded(message string) string {
	if utf8.RuneCountInString(message) <= mpaMaxMessage {
		return message
	}
	return string([]rune(message)[:mpaMaxMessage-1]) + "…"
}

func mpaConfigError(code, format string, args ...interface{}) error {
	return &MultiPartyConfigError{Code: code, Message: mpaBounded(fmt.Sprintf(format, args...))}
}

// mpaString is a string of 1 to max Unicode code points.
func mpaString(v interface{}, max int) (string, bool) {
	s, ok := v.(string)
	return s, ok && s != "" && utf8.RuneCountInString(s) <= max
}

func mpaObject(v interface{}) (map[string]interface{}, bool) {
	m, ok := v.(map[string]interface{})
	return m, ok && m != nil
}

// mpaExactly reports whether m has exactly these members.
func mpaExactly(m map[string]interface{}, members ...string) bool {
	if len(m) != len(members) {
		return false
	}
	for _, k := range members {
		if _, ok := m[k]; !ok {
			return false
		}
	}
	return true
}

func mpaUnknownField(m map[string]interface{}, allowed []string, where string) error {
	for _, k := range slices.Sorted(maps.Keys(m)) {
		if !slices.Contains(allowed, k) {
			return mpaConfigError("CONFIG_UNKNOWN_FIELD", "%s: unknown field %s", where, printable(k))
		}
	}
	return nil
}

// ── Operator policy (§ 2.3) ──

// MultiPartyOperationRule is what the operator asks of one operation on one target.
type MultiPartyOperationRule struct {
	RequiredParties int
	AllowedRoles    []string
	RequiredRoles   []string
}

type multiPartySubject struct {
	// party_id → the role the operator gives it on this target.
	parties    map[string]string
	operations map[string]MultiPartyOperationRule
}

// MultiPartyPolicyStore is a validated policy set: create it with
// NewMultiPartyPolicyStore. It cannot be changed after loading.
type MultiPartyPolicyStore struct {
	version            string
	audience           string
	maxValiditySeconds int
	// target → its parties and the operations they may authorize.
	subjects map[string]multiPartySubject
	loaded   bool
}

// Version is the policy set's policy_set_version.
func (s *MultiPartyPolicyStore) Version() string { return s.version }

// Audience is the verifier the requests must be for.
func (s *MultiPartyPolicyStore) Audience() string { return s.audience }

// MaxValiditySeconds is the longest validity window the operator accepts.
func (s *MultiPartyPolicyStore) MaxValiditySeconds() int { return s.maxValiditySeconds }

func mpaRoleList(v interface{}, where string) ([]string, error) {
	items, ok := v.([]interface{})
	roles := make([]string, 0, len(items))
	for _, item := range items {
		role, isString := item.(string)
		if !isString || !slices.Contains(mpaRoles, role) || slices.Contains(roles, role) {
			ok = false
			break
		}
		roles = append(roles, role)
	}
	if !ok {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s must list roles, each once", where)
	}
	return roles, nil
}

// NewMultiPartyPolicyStore validates a policy set
// (schemas/v2/multi_party_policy_set.schema.json, spec/profiles/multi-party
// § 2.3) and returns it as a store. It returns a *MultiPartyConfigError for the
// first problem found. There are no defaults: an operation the operator does not
// list for a target is not authorized.
func NewMultiPartyPolicyStore(policySetJSON []byte) (*MultiPartyPolicyStore, error) {
	decoded, err := decodeJSONValue(policySetJSON)
	set, ok := mpaObject(decoded)
	if err != nil || !ok {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "the policy set must be a JSON object")
	}
	if !mpaWellFormedText(policySetJSON) { // read as U+FFFD, a target or a party would be another one
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "the policy set must be well-formed text: UTF-8, with no unpaired surrogate")
	}
	if err := mpaUnknownField(set, []string{"policy_set_version", "profile", "audience", "max_validity_seconds", "subjects"}, "policy set"); err != nil {
		return nil, err
	}
	version, _ := set["policy_set_version"].(string)
	if version == "" {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "policy_set_version must be a non-empty string")
	}
	if set["profile"] != MPAV1 {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "profile must be %s", MPAV1)
	}
	audience, ok := mpaString(set["audience"], mpaMaxIdentifier)
	if !ok {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "audience must be a string of 1 to 256 characters")
	}
	seconds, ok := jsonInteger(set["max_validity_seconds"])
	if !ok || seconds < 1 || seconds > MPAV1MaxValiditySeconds {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "max_validity_seconds must be an integer from 1 to %d", MPAV1MaxValiditySeconds)
	}
	list, ok := set["subjects"].([]interface{})
	if !ok {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "subjects must be an array")
	}

	subjects := make(map[string]multiPartySubject, len(list))
	for i, item := range list {
		where := fmt.Sprintf("subjects[%d]", i)
		subject, ok := mpaObject(item)
		if !ok {
			return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s must be an object", where)
		}
		if err := mpaUnknownField(subject, []string{"target", "parties", "operations"}, where); err != nil {
			return nil, err
		}
		target, ok := mpaString(subject["target"], mpaMaxIdentifier)
		if !ok {
			return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s.target must be a string of 1 to 256 characters", where)
		}
		if _, twice := subjects[target]; twice {
			return nil, mpaConfigError("CONFIG_MPA_DUPLICATE", "%s: target %s is listed twice", where, printable(target))
		}
		partyList, ok := subject["parties"].([]interface{})
		if !ok || len(partyList) == 0 {
			return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s.parties must be a non-empty array", where)
		}

		parties := make(map[string]string, len(partyList))
		for j, p := range partyList {
			at := fmt.Sprintf("%s.parties[%d]", where, j)
			party, ok := mpaObject(p)
			if !ok {
				return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s must be an object", at)
			}
			if err := mpaUnknownField(party, []string{"party_id", "role"}, at); err != nil {
				return nil, err
			}
			id, _ := party["party_id"].(string)
			if id == "" {
				return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s.party_id must be a non-empty string", at)
			}
			role, isString := party["role"].(string)
			if !isString || !slices.Contains(mpaRoles, role) {
				return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s.role %s is not a role", at, printable(party["role"]))
			}
			if _, twice := parties[id]; twice {
				return nil, mpaConfigError("CONFIG_MPA_DUPLICATE", "%s: party %s is listed twice for the target", at, printable(id))
			}
			parties[id] = role
		}

		rules, ok := mpaObject(subject["operations"])
		if !ok {
			return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s.operations must be an object", where)
		}
		operations := make(map[string]MultiPartyOperationRule, len(rules))
		for _, operation := range slices.Sorted(maps.Keys(rules)) {
			at := fmt.Sprintf("%s.operations.%s", where, printable(operation))
			if !slices.Contains(mpaOperations, operation) {
				return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s is not an operation", at)
			}
			rule, ok := mpaObject(rules[operation])
			if !ok {
				return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s must be an object", at)
			}
			if err := mpaUnknownField(rule, []string{"required_parties", "allowed_roles", "required_roles"}, at); err != nil {
				return nil, err
			}
			required, ok := jsonInteger(rule["required_parties"])
			if !ok || required < 2 {
				return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s.required_parties must be an integer of at least 2", at)
			}
			allowed, err := mpaRoleList(rule["allowed_roles"], at+".allowed_roles")
			if err != nil {
				return nil, err
			}
			requiredRoles, err := mpaRoleList(rule["required_roles"], at+".required_roles")
			if err != nil {
				return nil, err
			}
			if len(allowed) == 0 {
				return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s.allowed_roles must not be empty", at)
			}
			for _, r := range requiredRoles {
				if !slices.Contains(allowed, r) {
					return nil, mpaConfigError("CONFIG_INVALID_VALUE", "%s.required_roles must be among allowed_roles", at)
				}
			}
			var eligible []string
			for _, role := range parties {
				if slices.Contains(allowed, role) {
					eligible = append(eligible, role)
				}
			}
			if required > MPAV1MaxAuthorizations {
				return nil, mpaConfigError("CONFIG_MPA_UNSATISFIABLE", "%s: %.0f parties are required and a record holds at most %d authorizations", at, required, MPAV1MaxAuthorizations)
			}
			if required > float64(len(eligible)) { // compared as read: a huge threshold is unreachable, not out of range
				return nil, mpaConfigError("CONFIG_MPA_UNSATISFIABLE", "%s: %.0f parties are required and %d have an allowed role", at, required, len(eligible))
			}
			for _, r := range requiredRoles {
				if !slices.Contains(eligible, r) {
					return nil, mpaConfigError("CONFIG_MPA_UNSATISFIABLE", "%s: no party holds a required role", at)
				}
			}
			operations[operation] = MultiPartyOperationRule{RequiredParties: int(required), AllowedRoles: allowed, RequiredRoles: requiredRoles}
		}
		subjects[target] = multiPartySubject{parties: parties, operations: operations}
	}
	return &MultiPartyPolicyStore{version: version, audience: audience, maxValiditySeconds: int(seconds), subjects: subjects, loaded: true}, nil
}

// ── The request and the signing side (§ 2.2) ──

// MultiPartyRequestInput is what NewMultiPartyRequest builds a request from.
type MultiPartyRequestInput struct {
	// Target is the object of the operation, as the operator's policy set names it.
	Target string
	// Audience is the verifier that may act on the authorization.
	Audience string
	// Parameters of the operation; nil is the empty object. They are JSON as Go
	// spells it: nil, a bool, a string of UTF-8, a number, and a []interface{}
	// or a map[string]interface{} of those.
	Parameters map[string]interface{}
	// ValiditySeconds is how long the request is valid (1 to 86400; the operator may allow less).
	ValiditySeconds int
	// IssuedAt defaults to the system clock.
	IssuedAt time.Time
	// RequestID is a unique identifier; 16 random bytes by default.
	RequestID string
}

const mpaInstant = "2006-01-02T15:04:05.000Z"

// NewMultiPartyRequest builds the operation_payload every party signs:
// {request, parameters}. It returns a *MultiPartyConfigError for a request the
// profile would refuse.
func NewMultiPartyRequest(in MultiPartyRequestInput) (map[string]interface{}, error) {
	if !mpaText(in.Target, mpaMaxIdentifier) {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "Target must be a string of 1 to 256 characters")
	}
	if !mpaText(in.Audience, mpaMaxIdentifier) {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "Audience must be a string of 1 to 256 characters")
	}
	if in.ValiditySeconds < 1 || in.ValiditySeconds > MPAV1MaxValiditySeconds {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "ValiditySeconds must be from 1 to %d", MPAV1MaxValiditySeconds)
	}
	id := in.RequestID
	if id == "" {
		random := make([]byte, 16)
		if _, err := rand.Read(random); err != nil {
			return nil, fmt.Errorf("request_id: %w", err)
		}
		id = "mpa:" + hex.EncodeToString(random)
	}
	if !mpaText(id, mpaMaxRequestID) {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "RequestID must be a string of 1 to 128 characters")
	}
	parameters := in.Parameters
	if parameters == nil {
		parameters = map[string]interface{}{}
	}
	if _, err := mpaCanonical(parameters, mpaMaxDepth-1); err != nil {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "Parameters must be %s", mpaData)
	}
	issued := in.IssuedAt
	if issued.IsZero() {
		issued = time.Now()
	}
	issued = issued.UTC()
	return map[string]interface{}{
		"request": map[string]interface{}{
			"profile":    MPAV1,
			"request_id": id,
			"target":     in.Target,
			"audience":   in.Audience,
			"issued_at":  issued.Format(mpaInstant),
			"expires_at": issued.Add(time.Duration(in.ValiditySeconds) * time.Second).Format(mpaInstant),
		},
		"parameters": parameters,
	}, nil
}

// mpaLargestInteger is 2^53 - 1. Past it a binary64, which is what dcp-jcs-v1
// reads a number into, no longer holds every integer, and two SDKs would write
// two different texts for the same signed number.
const mpaLargestInteger = 1<<53 - 1

const mpaRange = "-(2^53 - 1) to 2^53 - 1"

// mpaMaxDepth is how deep operation_payload may nest (§ 2.2): it is the first
// level and parameters the second.
const mpaMaxDepth = 32

const mpaData = "JSON data: well-formed text, integers within " + mpaRange + ", nested no deeper than the profile allows"

// mpaProfileData reports whether a value read by decodeJSONValue nests at most
// levels deep and holds only numbers the profile compares: integers within
// mpaRange.
func mpaProfileData(v interface{}, levels int) bool {
	switch val := v.(type) {
	case json.Number:
		if n, err := val.Int64(); err == nil {
			return n >= -mpaLargestInteger && n <= mpaLargestInteger
		}
		f, err := val.Float64() // "1e2" and "1.0" are integers of the profile; a text past int64 is not
		return err == nil && f == math.Trunc(f) && math.Abs(f) <= mpaLargestInteger
	case []interface{}:
		if levels < 1 {
			return false
		}
		for _, member := range val {
			if !mpaProfileData(member, levels-1) {
				return false
			}
		}
	case map[string]interface{}:
		if levels < 1 {
			return false
		}
		for _, member := range val {
			if !mpaProfileData(member, levels-1) {
				return false
			}
		}
	}
	return true
}

// mpaWellFormedText reports whether the strings of a JSON text, already read
// by a decoder, are text every SDK reads alike: UTF-8, with no escape of a
// surrogate that is not half of a pair. encoding/json reads both as U+FFFD, so
// they are looked for in the text itself.
func mpaWellFormedText(text []byte) bool {
	if !utf8.Valid(text) {
		return false
	}
	unit := func(at int) (uint64, bool) { // the code unit of an escape \uXXXX starting at text[at]
		if at+6 > len(text) || text[at] != '\\' || text[at+1] != 'u' {
			return 0, false
		}
		n, err := strconv.ParseUint(string(text[at+2:at+6]), 16, 16)
		return n, err == nil
	}
	for i := 0; i < len(text); i++ {
		if text[i] != '\\' { // in JSON a backslash is only ever inside a string
			continue
		}
		u, isUnit := unit(i)
		if !isUnit {
			i++ // a two-character escape
			continue
		}
		switch {
		case u >= 0xD800 && u <= 0xDBFF:
			low, ok := unit(i + 6)
			if !ok || low < 0xDC00 || low > 0xDFFF {
				return false
			}
			i += 6
		case u >= 0xDC00 && u <= 0xDFFF:
			return false
		}
		i += 5
	}
	return true
}

// The algorithms of a hybrid signature of the profile (§ 4): its own, not the
// ones of a verifier policy.
var (
	mpaClassicalAlgs = []string{"ed25519"}
	mpaPQAlgs        = []string{"ml-dsa-65", "slh-dsa-192f"}
)

// mpaPlain reports whether a caller's value is JSON as Go spells it, nesting at
// most levels deep: nil, a bool, a string of UTF-8, a number of the language or
// a json.Number, and a []interface{} or a map[string]interface{} of those. It
// is what the other SDKs take. Any other value would get its JSON from
// encoding/json, where a tag or a method of the type decides what is written
// and bytes that are not UTF-8 become U+FFFD with nothing left to tell.
func mpaPlain(v interface{}, levels int) bool {
	switch val := v.(type) {
	case nil, bool, json.Number,
		int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return true
	case string:
		return utf8.ValidString(val)
	case []interface{}:
		if levels < 1 { // also a slice that holds itself
			return false
		}
		for _, member := range val {
			if !mpaPlain(member, levels-1) {
				return false
			}
		}
		return true
	case map[string]interface{}:
		if levels < 1 { // also a map that holds itself
			return false
		}
		for name, member := range val {
			if !utf8.ValidString(name) || !mpaPlain(member, levels-1) {
				return false
			}
		}
		return true
	}
	return false
}

// mpaCanonical is CanonicalizeV2 for a value the caller built, nesting at most
// levels deep. It is refused when it is not mpaPlain or holds a number outside
// mpaRange (an int64, a uint64 or a float64 past it is read from its exact
// digits, before any rounding).
func mpaCanonical(v interface{}, levels int) (string, error) {
	if !mpaPlain(v, levels) {
		return "", fmt.Errorf("not %s", mpaData)
	}
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	decoded, err := decodeJSONValue(data)
	if err != nil {
		return "", err
	}
	if !mpaProfileData(decoded, levels) {
		return "", fmt.Errorf("not %s", mpaData)
	}
	return CanonicalizeV2(v)
}

// mpaText is mpaString for what a caller states: a Go string may hold bytes
// that are not UTF-8, and those are not text.
func mpaText(s string, max int) bool {
	_, ok := mpaString(s, max)
	return ok && utf8.ValidString(s)
}

func mpaSignedBytes(operation, operationPayload, partyID, role interface{}) ([]byte, error) {
	canonical, err := CanonicalizeV2(map[string]interface{}{"operation": operation, "operation_payload": operationPayload, "party_id": partyID, "role": role})
	return []byte(canonical), err
}

// CreatePartyAuthorization is one party's authorization: its composite signature
// over {operation, operation_payload, party_id, role}.
func CreatePartyAuthorization(registry *AlgorithmRegistry, operation string, operationPayload map[string]interface{}, partyID, role string, classicalKey, pqKey CompositeKeyInfo) (map[string]interface{}, error) {
	if registry == nil {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "the registry must not be nil")
	}
	signed, err := mpaSignedBytes(operation, operationPayload, partyID, role)
	if err != nil {
		return nil, err
	}
	sig, err := CompositeSign(registry, CtxMultiPartyAuth, signed, classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	entry := func(e SignatureEntry) map[string]interface{} {
		return map[string]interface{}{"alg": e.Alg, "kid": e.Kid, "sig_b64": e.SigB64}
	}
	composite := map[string]interface{}{"classical": entry(sig.Classical), "pq": nil, "binding": sig.Binding}
	if sig.PQ != nil {
		composite["pq"] = entry(*sig.PQ)
	}
	return map[string]interface{}{"party_id": partyID, "role": role, "composite_sig": composite}, nil
}

// BuildMultiPartyAuthorization puts the parties' authorizations in one record.
// requiredParties fills the schema's field (2 when less): it is not signed and no
// evaluation reads it.
func BuildMultiPartyAuthorization(operation string, operationPayload map[string]interface{}, authorizations []map[string]interface{}, requiredParties int) map[string]interface{} {
	entries := make([]interface{}, len(authorizations))
	for i, a := range authorizations {
		entries[i] = a
	}
	return map[string]interface{}{
		"type":              "multi_party_authorization",
		"operation":         operation,
		"operation_payload": operationPayload,
		"required_parties":  max(requiredParties, 2),
		"authorizations":    entries,
	}
}

// ── Evaluation: verification and authorization (§ 4) ──

// MultiPartyExpected is what the executor is about to do. The authorization must
// be for exactly this.
type MultiPartyExpected struct {
	Operation string
	Target    string
	// Parameters of the operation; nil is the empty object. They are JSON as Go
	// spells it: nil, a bool, a string of UTF-8, a number, and a []interface{}
	// or a map[string]interface{} of those.
	Parameters map[string]interface{}
}

// MultiPartyOptions is the operator's configuration and the executor's
// intention. Policy and Trust come from their loaders, never from the record or
// the request.
type MultiPartyOptions struct {
	Policy   *MultiPartyPolicyStore
	Trust    *PrincipalTrustStore
	Expected MultiPartyExpected
	// Now defaults to the system clock.
	Now time.Time
}

// MultiPartyError is one code of the evaluation, with a bounded message.
type MultiPartyError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// MultiPartyPartyResult is one authorization of the record: the signed party_id
// and role, and whether its signature verified (nil: not evaluated).
type MultiPartyPartyResult struct {
	PartyID  string `json:"party_id"`
	Role     string `json:"role"`
	Verified *bool  `json:"verified"`
}

// MultiPartyEvaluation is the result of EvaluateMultiPartyAuthorization
// (spec/profiles/multi-party § 5.2). Authorized is the decision: true only when
// no phase added a code.
type MultiPartyEvaluation struct {
	Profile      string `json:"profile"`
	Structure    string `json:"structure"`
	Verification string `json:"verification"`
	Authorized   bool   `json:"authorized"`
	// The signed operation, target, request_id and expires_at of a well-formed record, else nil.
	Operation *string                 `json:"operation"`
	Target    *string                 `json:"target"`
	RequestID *string                 `json:"request_id"`
	ExpiresAt *string                 `json:"expires_at"`
	Parties   []MultiPartyPartyResult `json:"parties"`
	// PartiesCounted is nil when no signature was verified.
	PartiesCounted *int `json:"parties_counted"`
	// RequiredParties is the operator's threshold, or nil when no rule was found.
	RequiredParties  *int              `json:"required_parties"`
	PolicySetVersion string            `json:"policy_set_version"`
	TrustSetVersion  string            `json:"trust_set_version"`
	Errors           []MultiPartyError `json:"errors"`
}

func (r *MultiPartyEvaluation) add(code, format string, args ...interface{}) {
	r.Errors = append(r.Errors, MultiPartyError{Code: code, Message: mpaBounded(fmt.Sprintf(format, args...))})
}

func mpaSignaturePart(v interface{}) bool {
	part, ok := mpaObject(v)
	if !ok || !mpaExactly(part, "alg", "kid", "sig_b64") {
		return false
	}
	_, algOK := part["alg"].(string)
	kid, kidOK := part["kid"].(string)
	sig, sigOK := part["sig_b64"].(string)
	return algOK && kidOK && mpaKid.MatchString(kid) && sigOK && len(sig) >= 8 && len(sig) <= 66476 && mpaSigB64.MatchString(sig)
}

// mpaConformsToSchema is schemas/v2/multi_party_authorization.schema.json, by hand.
func mpaConformsToSchema(v interface{}) (map[string]interface{}, bool) {
	record, ok := mpaObject(v)
	if !ok || !mpaExactly(record, "type", "operation", "operation_payload", "required_parties", "authorizations") {
		return nil, false
	}
	operation, _ := record["operation"].(string)
	if record["type"] != "multi_party_authorization" || !slices.Contains(mpaOperations, operation) {
		return nil, false
	}
	if _, ok := mpaObject(record["operation_payload"]); !ok {
		return nil, false
	}
	if required, ok := jsonInteger(record["required_parties"]); !ok || required < 2 {
		return nil, false
	}
	authorizations, ok := record["authorizations"].([]interface{})
	if !ok || len(authorizations) == 0 {
		return nil, false
	}
	for _, a := range authorizations {
		auth, ok := mpaObject(a)
		if !ok || !mpaExactly(auth, "party_id", "role", "composite_sig") {
			return nil, false
		}
		_, idOK := auth["party_id"].(string)
		role, roleOK := auth["role"].(string)
		sig, sigOK := mpaObject(auth["composite_sig"])
		if !idOK || !roleOK || !slices.Contains(mpaRoles, role) || !sigOK || !mpaExactly(sig, "classical", "pq", "binding") {
			return nil, false
		}
		if !mpaSignaturePart(sig["classical"]) || (sig["pq"] != nil && !mpaSignaturePart(sig["pq"])) {
			return nil, false
		}
		if sig["binding"] != "pq_over_classical" && sig["binding"] != "classical_only" {
			return nil, false
		}
	}
	return record, true
}

// mpaConformsToRequest is schemas/v2/multi_party_request.schema.json, by hand,
// with the instants parsed as everywhere else.
func mpaConformsToRequest(payload map[string]interface{}) bool {
	request, ok := mpaObject(payload["request"])
	if !ok || !mpaExactly(payload, "request", "parameters") || !mpaExactly(request, "profile", "request_id", "target", "audience", "issued_at", "expires_at") {
		return false
	}
	if _, ok := mpaObject(payload["parameters"]); !ok || request["profile"] != MPAV1 {
		return false
	}
	_, idOK := mpaString(request["request_id"], mpaMaxRequestID)
	_, targetOK := mpaString(request["target"], mpaMaxIdentifier)
	_, audienceOK := mpaString(request["audience"], mpaMaxIdentifier)
	_, issuedOK := parseRFC3339(request["issued_at"])
	_, expiresOK := parseRFC3339(request["expires_at"])
	return idOK && targetOK && audienceOK && issuedOK && expiresOK
}

// mpaStructure returns the record, or the first structural problem in the order of § 4.
func mpaStructure(recordJSON []byte) (map[string]interface{}, string) {
	decoded, err := decodeJSONValue(recordJSON)
	if err != nil {
		return nil, "MPA_SCHEMA_INVALID"
	}
	record, ok := mpaConformsToSchema(decoded)
	if !ok {
		return nil, "MPA_SCHEMA_INVALID"
	}
	// The decoder has already put U+FFFD where the text was not well formed: read the record's own bytes. Outside
	// operation_payload such text is no party_id of the schema; inside it, it is not data of the profile (below).
	var members map[string]json.RawMessage
	if err := json.Unmarshal(recordJSON, &members); err != nil {
		return nil, "MPA_SCHEMA_INVALID"
	}
	rawPayload := members["operation_payload"]
	if !mpaWellFormedText(bytes.Replace(recordJSON, rawPayload, []byte("{}"), 1)) {
		return nil, "MPA_SCHEMA_INVALID"
	}
	payload := record["operation_payload"].(map[string]interface{})
	if _, has := payload["request"]; !has {
		return nil, "MPA_REQUEST_MISSING"
	}
	if !mpaConformsToRequest(payload) {
		return nil, "MPA_REQUEST_INVALID"
	}
	if !mpaWellFormedText(rawPayload) {
		return nil, "MPA_NOT_REPRESENTABLE"
	}
	if !mpaProfileData(payload, mpaMaxDepth) {
		return nil, "MPA_NOT_REPRESENTABLE"
	}
	if _, err := CanonicalizeV2(payload); err != nil {
		return nil, "MPA_NOT_REPRESENTABLE"
	}
	if len(record["authorizations"].([]interface{})) > MPAV1MaxAuthorizations {
		return nil, "MPA_TOO_MANY_AUTHORIZATIONS"
	}
	return record, ""
}

// mpaKeyCode says why a trusted key cannot count at now, the first that applies, or "".
func mpaKeyCode(key trustedKey, found bool, alg string, now time.Time) string {
	switch {
	case !found || key.alg != alg:
		return "MPA_KEY_NOT_ANCHORED"
	case key.status == "revoked":
		return "MPA_KEY_REVOKED"
	case key.status == "expired" || (key.expiresAt != nil && key.expiresAt.Before(now)):
		return "MPA_KEY_EXPIRED"
	case key.notBefore != nil && key.notBefore.After(now):
		return "MPA_KEY_NOT_YET_VALID"
	}
	return ""
}

// EvaluateMultiPartyAuthorization decides whether a multi-party authorization
// authorizes what the executor is about to do (spec/profiles/multi-party § 4).
// recordJSON is the record as received.
//
// Strict: any authorization that fails refuses the record. A phase that adds a
// code stops the next ones, so no signature of a malformed, foreign or expired
// request is verified.
//
// It returns a *MultiPartyConfigError, and no result, when the stores did not
// come from their loaders or Expected is unusable: that is the caller's
// mistake, not a verdict on the record.
func EvaluateMultiPartyAuthorization(registry *AlgorithmRegistry, recordJSON []byte, opts MultiPartyOptions) (*MultiPartyEvaluation, error) {
	policy, trust := opts.Policy, opts.Trust
	if registry == nil {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "the registry must not be nil")
	}
	if policy == nil || !policy.loaded {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "the policy store must come from NewMultiPartyPolicyStore")
	}
	if trust == nil || !trust.loaded {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "the trust store must come from NewPrincipalTrustStore")
	}
	expected := opts.Expected
	if !slices.Contains(mpaOperations, expected.Operation) {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "Expected.Operation %s is not an operation", printable(expected.Operation))
	}
	if !mpaText(expected.Target, mpaMaxIdentifier) {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "Expected.Target must be a string of 1 to 256 characters")
	}
	if expected.Parameters == nil {
		expected.Parameters = map[string]interface{}{}
	}
	expectedParameters, err := mpaCanonical(expected.Parameters, mpaMaxDepth-1)
	if err != nil {
		return nil, mpaConfigError("CONFIG_INVALID_VALUE", "Expected.Parameters must be %s", mpaData)
	}
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = truncateToMillis(now) // as the instants of the record are read, and as the other SDKs take the clock

	result := &MultiPartyEvaluation{
		Profile:          MPAV1,
		Structure:        "valid",
		Verification:     "not_evaluated",
		Parties:          []MultiPartyPartyResult{},
		PolicySetVersion: policy.version,
		TrustSetVersion:  trust.version,
		Errors:           []MultiPartyError{},
	}

	// 1. Structure: the first failure, and nothing else is read.
	record, malformed := mpaStructure(recordJSON)
	if malformed != "" {
		result.Structure = "invalid"
		result.add(malformed, "the record is not a well-formed mpa-v1 multi-party authorization")
		return result, nil
	}
	operation := record["operation"].(string)
	payload := record["operation_payload"].(map[string]interface{})
	request := payload["request"].(map[string]interface{})
	authorizations := record["authorizations"].([]interface{})
	target, requestID, expiresAt := request["target"].(string), request["request_id"].(string), request["expires_at"].(string)
	result.Operation, result.Target, result.RequestID, result.ExpiresAt = &operation, &target, &requestID, &expiresAt
	for _, a := range authorizations {
		auth := a.(map[string]interface{})
		result.Parties = append(result.Parties, MultiPartyPartyResult{PartyID: auth["party_id"].(string), Role: auth["role"].(string)})
	}

	// 2. Binding: this operation, on this target, with these parameters, for this verifier, now.
	if operation != expected.Operation {
		result.add("MPA_OPERATION_MISMATCH", "the record authorizes %s, not %s", operation, expected.Operation)
	}
	if target != expected.Target {
		result.add("MPA_TARGET_MISMATCH", "the request is for target %s", printable(target))
	}
	if parameters, err := CanonicalizeV2(payload["parameters"]); err != nil || parameters != expectedParameters {
		result.add("MPA_PARAMETERS_MISMATCH", "the signed parameters are not the ones about to be used")
	}
	if request["audience"] != policy.audience {
		result.add("MPA_AUDIENCE_MISMATCH", "the request is for audience %s", printable(request["audience"]))
	}
	issued, _ := parseRFC3339(request["issued_at"])
	expires, _ := parseRFC3339(request["expires_at"])
	if issued.After(now.Add(sessionClockSkew)) {
		result.add("MPA_NOT_YET_VALID", "issued_at is in the future")
	}
	if !expires.After(now) {
		result.add("MPA_EXPIRED", "expires_at has passed")
	}
	if !expires.After(issued) || expires.Sub(issued) > time.Duration(policy.maxValiditySeconds)*time.Second {
		result.add("MPA_VALIDITY_INVALID", "the validity window must be positive and at most %d seconds", policy.maxValiditySeconds)
	}
	subject, knownTarget := policy.subjects[target]
	rule, listed := subject.operations[operation]
	switch {
	case !knownTarget:
		result.add("MPA_TARGET_UNKNOWN", "the operator has no parties for target %s", printable(target))
	case !listed:
		result.add("MPA_OPERATION_NOT_ALLOWED", "the operator does not list %s for the target", operation)
	default:
		required := rule.RequiredParties
		result.RequiredParties = &required
	}
	if len(result.Errors) > 0 {
		return result, nil
	}

	// 3. Parties: distinct parties of the target, each with the role the operator gives it.
	seen := map[string]bool{}
	for _, p := range result.Parties {
		role, isParty := subject.parties[p.PartyID]
		if !isParty {
			result.add("MPA_PARTY_UNKNOWN", "%s is not a party of the target", printable(p.PartyID))
			continue
		}
		if seen[p.PartyID] {
			result.add("MPA_PARTY_DUPLICATE", "%s is listed more than once", printable(p.PartyID))
		}
		seen[p.PartyID] = true
		if p.Role != role {
			result.add("MPA_ROLE_MISMATCH", "%s signed as %s; the operator has it as %s", printable(p.PartyID), p.Role, role)
		}
		if !slices.Contains(rule.AllowedRoles, role) {
			result.add("MPA_ROLE_NOT_ALLOWED", "the role %s may not authorize %s", role, operation)
		}
	}
	if len(result.Errors) > 0 {
		return result, nil
	}

	// 4. Verification: every authorization is a hybrid signature, by the party's trusted keys, over this request.
	counted := 0
	for i, a := range authorizations {
		before := len(result.Errors)
		party := result.Parties[i]
		sig := a.(map[string]interface{})["composite_sig"].(map[string]interface{})
		classical := sig["classical"].(map[string]interface{})
		pq, hasPQ := mpaObject(sig["pq"])
		classicalAlg, _ := classical["alg"].(string)
		pqAlg, _ := pq["alg"].(string)
		if sig["binding"] != "pq_over_classical" || !hasPQ || !slices.Contains(mpaClassicalAlgs, classicalAlg) || !slices.Contains(mpaPQAlgs, pqAlg) {
			result.add("MPA_HYBRID_REQUIRED", "%s: a classical and a post-quantum signature are both required", printable(party.PartyID))
		} else {
			trusted := trust.principals[party.PartyID]
			classicalKid, pqKid := classical["kid"].(string), pq["kid"].(string)
			classicalKey, classicalFound := trusted[classicalKid]
			pqKey, pqFound := trusted[pqKid]
			if code := mpaKeyCode(classicalKey, classicalFound, classicalAlg, now); code != "" {
				result.add(code, "%s: key %s cannot count", printable(party.PartyID), classicalKid)
			}
			if code := mpaKeyCode(pqKey, pqFound, pqAlg, now); code != "" {
				result.add(code, "%s: key %s cannot count", printable(party.PartyID), pqKid)
			}
			if len(result.Errors) == before {
				_, classicalCanonical := canonicalB64Bytes(classical["sig_b64"])
				_, pqCanonical := canonicalB64Bytes(pq["sig_b64"])
				valid := false
				if signed, err := mpaSignedBytes(operation, payload, party.PartyID, party.Role); err == nil && classicalCanonical && pqCanonical {
					composite := &CompositeSignature{
						Classical: SignatureEntry{Alg: classicalAlg, Kid: classicalKid, SigB64: classical["sig_b64"].(string)},
						PQ:        &SignatureEntry{Alg: pqAlg, Kid: pqKid, SigB64: pq["sig_b64"].(string)},
						Binding:   "pq_over_classical",
					}
					// An algorithm the registry cannot verify, or a malformed signature, is an error here: not valid.
					verified, err := CompositeVerify(registry, CtxMultiPartyAuth, signed, composite,
						base64.StdEncoding.EncodeToString(classicalKey.bytes), base64.StdEncoding.EncodeToString(pqKey.bytes))
					valid = err == nil && verified != nil && verified.Valid
				}
				if !valid {
					result.add("MPA_SIGNATURE_INVALID", "%s: the signature does not verify", printable(party.PartyID))
				}
			}
		}
		verified := len(result.Errors) == before
		result.Parties[i].Verified = &verified
		if verified {
			counted++
		}
	}
	result.PartiesCounted = &counted
	if len(result.Errors) > 0 {
		result.Verification = "failed"
		return result, nil
	}
	result.Verification = "verified"

	// 5. Decision: enough parties, and the roles the operator requires.
	if counted < rule.RequiredParties {
		result.add("MPA_THRESHOLD_NOT_MET", "%d parties authorized; the operator requires %d", counted, rule.RequiredParties)
	}
	for _, role := range rule.RequiredRoles {
		held := false
		for _, p := range result.Parties {
			held = held || subject.parties[p.PartyID] == role
		}
		if !held {
			result.add("MPA_REQUIRED_ROLE_MISSING", "no %s authorized the operation", role)
		}
	}
	result.Authorized = len(result.Errors) == 0
	return result, nil
}
