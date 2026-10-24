package v2

// Admission of V2 signed bundles: principal trust and the strict-v1 profile
// (spec/profiles/admission). Deterministic and offline: the caller supplies
// the trust set, the revocation snapshot and the clock. Verification itself is
// VerifySignedBundleV2At's; admission only reads its result.

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"math"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// StrictV1 is the identifier of the strict-v1 admission profile.
const StrictV1 = "strict-v1"

// StrictV1MaxSeconds is the longest session and the oldest revocation
// snapshot strict-v1 accepts, in seconds.
const StrictV1MaxSeconds = 300

// AdmissionConfigError is a trust set or profile that cannot be loaded, or
// admission options that contradict the profile. Code is one of the CONFIG_*
// codes of spec/profiles/admission § 5.3.
type AdmissionConfigError struct {
	Code    string
	Message string
}

func (e *AdmissionConfigError) Error() string { return e.Code + ": " + e.Message }

func configError(code, format string, args ...interface{}) error {
	return &AdmissionConfigError{Code: code, Message: bounded(fmt.Sprintf(format, args...))}
}

// maxAdmissionMessage bounds every admission and configuration message, in
// characters.
const maxAdmissionMessage = 500

func bounded(message string) string {
	if utf8.RuneCountInString(message) <= maxAdmissionMessage {
		return message
	}
	return string([]rune(message)[:maxAdmissionMessage-1]) + "…"
}

// printable is a short printable form of an untrusted value.
func printable(value interface{}) string {
	switch v := value.(type) {
	case string:
		if utf8.RuneCountInString(v) > 80 {
			v = string([]rune(v)[:80]) + "…"
		}
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		_ = enc.Encode(v)
		return strings.TrimSuffix(buf.String(), "\n")
	case nil:
		return "null"
	case map[string]interface{}:
		return "an object"
	case []interface{}:
		return "an array"
	default:
		return fmt.Sprint(v)
	}
}

// decodeJSONValue decodes exactly one JSON value, keeping numbers as
// json.Number so that an integer can be told from a fraction.
func decodeJSONValue(data []byte) (interface{}, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var v interface{}
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, fmt.Errorf("data after the JSON value")
	}
	return v, nil
}

// arrayIndex reports whether k is a JavaScript array index ("0" to
// "4294967294", no leading zero), which a JavaScript object lists first, in
// ascending order.
func arrayIndex(k string) (uint64, bool) {
	if k == "" || (len(k) > 1 && k[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseUint(k, 10, 64)
	return n, err == nil && n < math.MaxUint32
}

// orderedKeys returns the keys of m in the order JSON.parse gives the object
// raw its properties, so that fields are checked in the order the reference
// implementation checks them: array indices ascending, then the other keys
// in the order raw first lists them. Keys raw does not yield come last,
// sorted.
func orderedKeys(m map[string]interface{}, raw json.RawMessage) []string {
	keys := documentKeys(m, raw)
	var indices []string
	for _, k := range keys {
		if _, ok := arrayIndex(k); ok {
			indices = append(indices, k)
		}
	}
	if len(indices) == 0 {
		return keys
	}
	slices.SortFunc(indices, func(a, b string) int {
		x, _ := arrayIndex(a)
		y, _ := arrayIndex(b)
		return cmp.Compare(x, y)
	})
	for _, k := range keys {
		if _, ok := arrayIndex(k); !ok {
			indices = append(indices, k)
		}
	}
	return indices
}

// documentKeys returns the keys of m in the order the JSON object raw first
// lists them; keys raw does not yield come last, sorted.
func documentKeys(m map[string]interface{}, raw json.RawMessage) []string {
	keys := make([]string, 0, len(m))
	seen := map[string]bool{}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err == nil && tok == json.Delim('{') {
		for dec.More() {
			tok, err := dec.Token()
			if err != nil {
				break
			}
			if k, ok := tok.(string); ok && !seen[k] {
				if _, in := m[k]; in {
					seen[k] = true
					keys = append(keys, k)
				}
			}
			var skip json.RawMessage
			if err := dec.Decode(&skip); err != nil {
				break
			}
		}
	}
	var rest []string
	for k := range m {
		if !seen[k] {
			rest = append(rest, k)
		}
	}
	sort.Strings(rest)
	return append(keys, rest...)
}

// rawMember returns the raw JSON of a member of the JSON object raw.
func rawMember(raw json.RawMessage, name string) json.RawMessage {
	var members map[string]json.RawMessage
	if json.Unmarshal(raw, &members) != nil {
		return nil
	}
	return members[name]
}

func rejectUnknownFields(value map[string]interface{}, allowed []string, where string) error {
	keys := slices.Sorted(maps.Keys(value))
	for _, k := range keys {
		if !slices.Contains(allowed, k) {
			return configError("CONFIG_UNKNOWN_FIELD", "%s: unknown field %s", where, printable(k))
		}
	}
	return nil
}

// jsonInteger returns a json.Number with an integer value (1e2 and 300.0
// are integers, 120.5 is not), read as a double as JSON.parse reads it: a
// number too large for a double is not one, one too small is 0.
func jsonInteger(value interface{}) (float64, bool) {
	n, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	f, err := strconv.ParseFloat(string(n), 64)
	if (err != nil && !errors.Is(err, strconv.ErrRange)) || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, false
	}
	return f, true
}

// clampInt converts an integral double to int, saturating far beyond any
// meaningful policy value.
func clampInt(f float64) int {
	return int(math.Max(math.Min(f, math.MaxInt32), math.MinInt32))
}

func stringList(value interface{}) ([]string, bool) {
	items, ok := value.([]interface{})
	if !ok {
		return nil, false
	}
	list := make([]string, 0, len(items))
	for _, item := range items {
		s, ok := item.(string)
		if !ok {
			return nil, false
		}
		list = append(list, s)
	}
	return list, true
}

// ── Trust set (§ 2.2) ──

type trustedKey struct {
	alg       string
	bytes     []byte
	status    string
	notBefore *time.Time
	expiresAt *time.Time
}

// PrincipalTrustStore is a validated trust set: create it with
// NewPrincipalTrustStore. It cannot be changed after loading.
type PrincipalTrustStore struct {
	version string
	// human_id → kid → trusted key.
	principals map[string]map[string]trustedKey
	loaded     bool
}

// Version is the trust set's trust_set_version.
func (s *PrincipalTrustStore) Version() string { return s.version }

var trustKeyBytes = map[string]int{"ed25519": 32, "ml-dsa-65": 1952, "slh-dsa-192f": 48}

// optionalInstant reads an optional RFC 3339 field: nil when absent or null.
func optionalInstant(obj map[string]interface{}, field, where string) (*time.Time, error) {
	raw, present := obj[field]
	if !present || raw == nil {
		return nil, nil
	}
	t, ok := parseRFC3339(raw)
	if !ok {
		return nil, configError("CONFIG_INVALID_VALUE", "%s.%s is not an RFC 3339 timestamp", where, field)
	}
	return &t, nil
}

// NewPrincipalTrustStore validates a JSON trust set
// (schemas/v2/principal_trust_set.schema.json, spec/profiles/admission § 2.2)
// and returns it as a store. It returns an *AdmissionConfigError for the first
// problem found.
func NewPrincipalTrustStore(trustSetJSON []byte) (*PrincipalTrustStore, error) {
	decoded, err := decodeJSONValue(trustSetJSON)
	if err != nil {
		return nil, configError("CONFIG_INVALID_VALUE", "the trust set is not valid JSON")
	}
	set, ok := decoded.(map[string]interface{})
	if !ok {
		return nil, configError("CONFIG_INVALID_VALUE", "the trust set must be an object")
	}
	if err := rejectUnknownFields(set, []string{"trust_set_version", "principals"}, "trust set"); err != nil {
		return nil, err
	}
	version, ok := set["trust_set_version"].(string)
	if !ok || version == "" {
		return nil, configError("CONFIG_INVALID_VALUE", "trust_set_version must be a non-empty string")
	}
	principals, ok := set["principals"].([]interface{})
	if !ok {
		return nil, configError("CONFIG_INVALID_VALUE", "principals must be an array")
	}

	store := &PrincipalTrustStore{version: version, principals: map[string]map[string]trustedKey{}, loaded: true}
	kids := map[string]bool{}
	for i, rawPrincipal := range principals {
		where := fmt.Sprintf("principals[%d]", i)
		p, ok := rawPrincipal.(map[string]interface{})
		if !ok {
			return nil, configError("CONFIG_INVALID_VALUE", "%s must be an object", where)
		}
		if err := rejectUnknownFields(p, []string{"human_id", "keys"}, where); err != nil {
			return nil, err
		}
		humanID, ok := p["human_id"].(string)
		if !ok || humanID == "" {
			return nil, configError("CONFIG_TRUST_EMPTY_ID", "%s.human_id must be a non-empty string", where)
		}
		if _, dup := store.principals[humanID]; dup {
			return nil, configError("CONFIG_TRUST_DUPLICATE", "%s: human_id %s is listed twice", where, printable(humanID))
		}
		keys, ok := p["keys"].([]interface{})
		if !ok || len(keys) == 0 {
			return nil, configError("CONFIG_INVALID_VALUE", "%s.keys must be a non-empty array", where)
		}

		trusted := map[string]trustedKey{}
		for j, rawKey := range keys {
			at := fmt.Sprintf("%s.keys[%d]", where, j)
			k, ok := rawKey.(map[string]interface{})
			if !ok {
				return nil, configError("CONFIG_INVALID_VALUE", "%s must be an object", at)
			}
			if err := rejectUnknownFields(k, []string{"kid", "alg", "public_key_b64", "status", "not_before", "expires_at"}, at); err != nil {
				return nil, err
			}
			alg, _ := k["alg"].(string)
			size, known := trustKeyBytes[alg]
			if !known {
				return nil, configError("CONFIG_TRUST_MALFORMED_KEY", "%s.alg %s is not ed25519, ml-dsa-65 or slh-dsa-192f", at, printable(k["alg"]))
			}
			keyBytes, ok := canonicalB64Bytes(k["public_key_b64"])
			if !ok || len(keyBytes) != size {
				return nil, configError("CONFIG_TRUST_MALFORMED_KEY", "%s.public_key_b64 is not a canonical base64 %s public key", at, alg)
			}
			kid, ok := k["kid"].(string)
			if !ok || DeriveKid(alg, keyBytes) != kid {
				return nil, configError("CONFIG_TRUST_KID_NOT_DERIVED", "%s.kid %s is not derived from its key", at, printable(k["kid"]))
			}
			if kids[kid] {
				return nil, configError("CONFIG_TRUST_DUPLICATE", "%s: kid %s is listed twice in the trust set", at, kid)
			}
			status, _ := k["status"].(string)
			if status != "active" && status != "revoked" && status != "expired" {
				return nil, configError("CONFIG_INVALID_VALUE", "%s.status must be active, revoked or expired", at)
			}
			kids[kid] = true
			notBefore, err := optionalInstant(k, "not_before", at)
			if err != nil {
				return nil, err
			}
			expiresAt, err := optionalInstant(k, "expires_at", at)
			if err != nil {
				return nil, err
			}
			trusted[kid] = trustedKey{alg: alg, bytes: keyBytes, status: status, notBefore: notBefore, expiresAt: expiresAt}
		}
		store.principals[humanID] = trusted
	}
	return store, nil
}

// ── strict-v1 profile (§ 4.1) ──

// StrictV1Profile is a validated strict-v1 profile: create it with
// ResolveStrictV1Profile. Its getters return copies, so a loaded profile
// cannot be weakened.
type StrictV1Profile struct {
	verifierID    string
	maxSession    int
	maxRevocation int
	policy        VerifierPolicy
	loaded        bool
}

// VerifierID is the verifier the bundle's signed intended_verifier must name.
func (p *StrictV1Profile) VerifierID() string { return p.verifierID }

// MaxSessionDurationSeconds is the effective longest signed session window.
func (p *StrictV1Profile) MaxSessionDurationSeconds() int { return p.maxSession }

// MaxRevocationAgeSeconds is the oldest revocation snapshot the profile accepts.
func (p *StrictV1Profile) MaxRevocationAgeSeconds() int { return p.maxRevocation }

// VerifierPolicy returns a copy of the verifier policy the profile verifies
// with.
func (p *StrictV1Profile) VerifierPolicy() VerifierPolicy {
	c := p.policy
	c.RiskOverrides = maps.Clone(p.policy.RiskOverrides)
	c.AcceptedClassicalAlgs = slices.Clone(p.policy.AcceptedClassicalAlgs)
	c.AcceptedPQAlgs = slices.Clone(p.policy.AcceptedPQAlgs)
	c.AcceptedHashAlgs = slices.Clone(p.policy.AcceptedHashAlgs)
	c.AdvisoryRejectedAlgs = slices.Clone(p.policy.AdvisoryRejectedAlgs)
	return c
}

var (
	verificationModes = []string{"classical_only", "hybrid_preferred", "hybrid_required", "pq_only"}
	strictAlgSubsets  = map[string][]string{
		"accepted_classical_algs": {"ed25519"},
		"accepted_pq_algs":        {"ml-dsa-65", "slh-dsa-192f"},
		"accepted_hash_algs":      {"sha256", "sha384"},
	}
)

// profileSeconds reads a strict-v1 limit in seconds: an integer from 1 to
// StrictV1MaxSeconds, StrictV1MaxSeconds when absent.
func profileSeconds(c map[string]interface{}, field string) (int, error) {
	value, present := c[field]
	if !present {
		return StrictV1MaxSeconds, nil
	}
	f, ok := jsonInteger(value)
	if !ok {
		return 0, configError("CONFIG_INVALID_VALUE", "%s must be an integer", field)
	}
	if f < 1 || f > StrictV1MaxSeconds {
		return 0, configError("CONFIG_PROFILE_CONTRADICTION", "%s must be from 1 to %d under strict-v1", field, StrictV1MaxSeconds)
	}
	return int(f), nil
}

// fixedBoolean checks a boolean policy field only fixed keeps the profile's
// guarantee for.
func fixedBoolean(value interface{}, field string, fixed bool) error {
	b, ok := value.(bool)
	if !ok {
		return configError("CONFIG_INVALID_VALUE", "verifier_policy.%s must be a boolean", field)
	}
	if b != fixed {
		return configError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires verifier_policy.%s to be %t", field, fixed)
	}
	return nil
}

func hybridRequired(value interface{}, field string) error {
	mode, _ := value.(string)
	if !slices.Contains(verificationModes, mode) {
		return configError("CONFIG_INVALID_VALUE", "%s must be a verification mode", field)
	}
	if mode != "hybrid_required" {
		return configError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires %s to be hybrid_required (pq_only drops the classical signature)", field)
	}
	return nil
}

// strictV1Policy is the verifier policy strict-v1 requires (§ 4.1).
func strictV1Policy(verifierID string) VerifierPolicy {
	p := DefaultVerifierPolicy()
	p.DefaultMode = "hybrid_required"
	p.RiskOverrides = map[string]string{"low": "hybrid_required", "medium": "hybrid_required", "high": "hybrid_required"}
	p.MinClassical, p.MinPQ = 1, 1
	p.AcceptedClassicalAlgs = slices.Clone(strictAlgSubsets["accepted_classical_algs"])
	p.AcceptedPQAlgs = slices.Clone(strictAlgSubsets["accepted_pq_algs"])
	p.AcceptedHashAlgs = slices.Clone(strictAlgSubsets["accepted_hash_algs"])
	p.RequireSessionBinding, p.RequireCompositeBinding = true, true
	p.AllowV1Bundles, p.AllowClassicalFallbackDisable = false, false
	p.WarnClassicalOnlyDeprecated = false
	p.AdvisoryRejectedAlgs = []string{}
	p.RequireSessionExpiry, p.RequireAudienceBinding = true, true
	p.VerifierID = verifierID
	return p
}

// ResolveStrictV1Profile validates a JSON strict-v1 configuration
// (schemas/v2/admission_profile.schema.json, spec/profiles/admission § 4.1)
// and returns the profile with the verifier policy it enforces. It returns an
// *AdmissionConfigError for the first problem found; verifier_policy fields
// are checked in the order the configuration lists them.
func ResolveStrictV1Profile(configJSON []byte) (*StrictV1Profile, error) {
	decoded, err := decodeJSONValue(configJSON)
	if err != nil {
		return nil, configError("CONFIG_INVALID_VALUE", "the profile configuration is not valid JSON")
	}
	c, ok := decoded.(map[string]interface{})
	if !ok {
		return nil, configError("CONFIG_INVALID_VALUE", "the profile configuration must be an object")
	}
	if err := rejectUnknownFields(c, []string{"profile", "verifier_id", "max_session_duration_seconds", "max_revocation_age_seconds", "verifier_policy"}, "profile"); err != nil {
		return nil, err
	}
	if c["profile"] != StrictV1 {
		return nil, configError("CONFIG_INVALID_VALUE", "profile %s is not \"strict-v1\"", printable(c["profile"]))
	}
	if raw, present := c["verifier_id"]; !present || raw == nil {
		return nil, configError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires verifier_id")
	}
	verifierID, ok := c["verifier_id"].(string)
	if !ok {
		return nil, configError("CONFIG_INVALID_VALUE", "verifier_id must be a string")
	}
	if verifierID == "" {
		return nil, configError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires a non-empty verifier_id")
	}
	maxSession, err := profileSeconds(c, "max_session_duration_seconds")
	if err != nil {
		return nil, err
	}
	maxRevocation, err := profileSeconds(c, "max_revocation_age_seconds")
	if err != nil {
		return nil, err
	}

	policy := strictV1Policy(verifierID)
	if rawPolicy, present := c["verifier_policy"]; present {
		vp, ok := rawPolicy.(map[string]interface{})
		if !ok {
			return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy must be an object")
		}
		vpJSON := rawMember(configJSON, "verifier_policy")
		for _, field := range orderedKeys(vp, vpJSON) {
			value := vp[field]
			switch field {
			case "require_session_binding", "require_composite_binding", "require_session_expiry", "require_audience_binding":
				if err := fixedBoolean(value, field, true); err != nil {
					return nil, err
				}
			case "allow_v1_bundles", "allow_classical_fallback_disable":
				if err := fixedBoolean(value, field, false); err != nil {
					return nil, err
				}
			case "default_mode":
				if err := hybridRequired(value, "verifier_policy.default_mode"); err != nil {
					return nil, err
				}
			case "risk_overrides":
				overrides, ok := value.(map[string]interface{})
				if !ok {
					return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy.risk_overrides must be an object")
				}
				if err := rejectUnknownFields(overrides, []string{"low", "medium", "high"}, "verifier_policy.risk_overrides"); err != nil {
					return nil, err
				}
				for _, tier := range orderedKeys(overrides, rawMember(vpJSON, "risk_overrides")) {
					if err := hybridRequired(overrides[tier], "verifier_policy.risk_overrides."+tier); err != nil {
						return nil, err
					}
				}
			case "min_classical", "min_pq":
				f, ok := jsonInteger(value)
				if !ok || f < 0 {
					return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy.%s must be a non-negative integer", field)
				}
				if f < 1 {
					return nil, configError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires verifier_policy.%s of at least 1", field)
				}
				if field == "min_classical" {
					policy.MinClassical = clampInt(f)
				} else {
					policy.MinPQ = clampInt(f)
				}
			case "accepted_classical_algs", "accepted_pq_algs", "accepted_hash_algs":
				list, ok := stringList(value)
				if !ok {
					return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy.%s must be a list of strings", field)
				}
				allowed := strictAlgSubsets[field]
				if len(list) == 0 || slices.ContainsFunc(list, func(alg string) bool { return !slices.Contains(allowed, alg) }) {
					return nil, configError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires verifier_policy.%s to be a non-empty subset of %s", field, strings.Join(allowed, ", "))
				}
				switch field {
				case "accepted_classical_algs":
					policy.AcceptedClassicalAlgs = list
				case "accepted_pq_algs":
					policy.AcceptedPQAlgs = list
				default:
					policy.AcceptedHashAlgs = list
				}
			case "advisory_rejected_algs":
				list, ok := stringList(value)
				if !ok {
					return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy.advisory_rejected_algs must be a list of strings")
				}
				policy.AdvisoryRejectedAlgs = list
			case "max_key_age_days":
				f, ok := jsonInteger(value)
				if !ok || f < 0 {
					return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy.max_key_age_days must be a non-negative integer")
				}
				policy.MaxKeyAgeDays = clampInt(f)
			case "warn_classical_only_deprecated":
				b, ok := value.(bool)
				if !ok {
					return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy.warn_classical_only_deprecated must be a boolean")
				}
				policy.WarnClassicalOnlyDeprecated = b
			case "max_session_duration_seconds":
				f, ok := jsonInteger(value)
				if !ok {
					return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy.max_session_duration_seconds must be an integer")
				}
				if f < 1 || f > float64(maxSession) {
					return nil, configError("CONFIG_PROFILE_CONTRADICTION", "verifier_policy.max_session_duration_seconds must be from 1 to %d under strict-v1", maxSession)
				}
				maxSession = int(f)
			case "verifier_id":
				id, ok := value.(string)
				if !ok {
					return nil, configError("CONFIG_INVALID_VALUE", "verifier_policy.verifier_id must be a string")
				}
				if id != verifierID {
					return nil, configError("CONFIG_PROFILE_CONTRADICTION", "verifier_policy.verifier_id differs from the profile verifier_id")
				}
			default:
				return nil, configError("CONFIG_UNKNOWN_FIELD", "verifier_policy: unknown field %s", printable(field))
			}
		}
	}
	policy.MaxSessionDurationSeconds = maxSession

	return &StrictV1Profile{verifierID: verifierID, maxSession: maxSession, maxRevocation: maxRevocation, policy: policy, loaded: true}, nil
}

// ── Revocation (§ 2.4, § 4.3) ──

// RevocationSubjectSet is what a revocation source must answer for (§ 2.4).
type RevocationSubjectSet struct {
	AgentIDs []string `json:"agent_ids"`
	Kids     []string `json:"kids"`
}

var principalSignatures = []string{"bundle", "responsible_principal_record"}

func signerKeysOf(v *V2VerificationResult) []SignerKeyUse {
	if v == nil {
		return nil
	}
	return v.SignerKeys
}

// decodeSignedBundle decodes a signed bundle as a JSON object; anything else
// is an empty one.
func decodeSignedBundle(signedBundleJSON []byte) map[string]interface{} {
	var sb map[string]interface{}
	if json.Unmarshal(signedBundleJSON, &sb) != nil {
		return nil
	}
	return sb
}

// RevocationSubjects returns the revocation subjects of a signed bundle
// (§ 2.4): the passport agent_id, and the kid of every signer key that
// verified, sorted.
func RevocationSubjects(signedBundleJSON []byte, v *V2VerificationResult) RevocationSubjectSet {
	return revocationSubjectsOf(decodeSignedBundle(signedBundleJSON), v)
}

func revocationSubjectsOf(sb map[string]interface{}, v *V2VerificationResult) RevocationSubjectSet {
	bundle, _ := sb["bundle"].(map[string]interface{})
	subjects := RevocationSubjectSet{AgentIDs: []string{}, Kids: []string{}}
	if agentID, ok := artifactPayload(bundle, "agent_passport")["agent_id"].(string); ok {
		subjects.AgentIDs = append(subjects.AgentIDs, agentID)
	}
	for _, k := range signerKeysOf(v) {
		if k.Verified && !slices.Contains(subjects.Kids, k.Kid) {
			subjects.Kids = append(subjects.Kids, k.Kid)
		}
	}
	sort.Strings(subjects.Kids)
	return subjects
}

type revocationSnapshot struct {
	checkedAt time.Time
	agents    map[string]string
	keys      map[string]string
}

// parseRevocationSnapshot reads a snapshot that follows
// schemas/v2/revocation_snapshot.schema.json.
func parseRevocationSnapshot(data []byte) (*revocationSnapshot, bool) {
	decoded, err := decodeJSONValue(data)
	if err != nil {
		return nil, false
	}
	obj, ok := decoded.(map[string]interface{})
	if !ok || rejectUnknownFields(obj, []string{"checked_at", "agents", "keys"}, "revocation snapshot") != nil {
		return nil, false
	}
	checkedAt, ok := parseRFC3339(obj["checked_at"])
	if !ok {
		return nil, false
	}
	statuses := func(raw interface{}) (map[string]string, bool) {
		m, ok := raw.(map[string]interface{})
		if !ok {
			return nil, false
		}
		out := make(map[string]string, len(m))
		for id, s := range m {
			status, _ := s.(string)
			if status != "revoked" && status != "not_revoked" && status != "unknown" {
				return nil, false
			}
			out[id] = status
		}
		return out, true
	}
	agents, okAgents := statuses(obj["agents"])
	keys, okKeys := statuses(obj["keys"])
	if !okAgents || !okKeys {
		return nil, false
	}
	return &revocationSnapshot{checkedAt: checkedAt, agents: agents, keys: keys}, true
}

// ── Admission (§ 5) ──

// AdmissionError is one code added during admission (§ 5.3) and why.
type AdmissionError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// AdmissionResult is the outcome of admission (§ 5.2).
type AdmissionResult struct {
	// Verified is the verifier's verdict, with its meaning unchanged.
	Verified bool `json:"verified"`
	// Verification is the verifier's full result.
	Verification *V2VerificationResult `json:"verification"`
	// PrincipalTrust is trusted, untrusted or not_evaluated.
	PrincipalTrust string `json:"principal_trust"`
	// Profile is "strict-v1", or nil without a profile.
	Profile *string `json:"profile"`
	// ProfileCompliance is compliant, non_compliant or not_evaluated.
	ProfileCompliance string `json:"profile_compliance"`
	// Admitted says the bundle is admitted as evidence under this configuration.
	Admitted bool `json:"admitted"`
	// ActionAuthorized is always false: admission does not authorize an action (§ 7).
	ActionAuthorized bool `json:"action_authorized"`
	// RecordedDecision is the policy decision's decision (approve, escalate,
	// block) of a verified bundle, else nil.
	RecordedDecision *string `json:"recorded_decision"`
	// TrustSetVersion is the trust set's version, or nil without one.
	TrustSetVersion *string `json:"trust_set_version"`
	// Errors lists every code added, in the order of § 5.1.
	Errors []AdmissionError `json:"errors"`
}

// AdmissionOptions configures EvaluateAdmissionV2.
type AdmissionOptions struct {
	// Profile is a strict-v1 profile from ResolveStrictV1Profile, or nil.
	Profile *StrictV1Profile
	// Trust is a trust store from NewPrincipalTrustStore, or nil. Required
	// with a profile.
	Trust *PrincipalTrustStore
	// Revocation is the revocation snapshot, evaluated under a profile only.
	// nil or null: the source could not answer.
	Revocation json.RawMessage
	// Now is the instant of every time check; it must be set, to the instant
	// the verification used.
	Now time.Time
}

// AdmitOptions configures AdmitSignedBundleV2.
type AdmitOptions struct {
	// Profile is a strict-v1 profile from ResolveStrictV1Profile; it sets the
	// verifier policy.
	Profile *StrictV1Profile
	// Policy is the verifier policy without a profile. Default
	// DefaultVerifierPolicy(). It must be nil with a profile.
	Policy *VerifierPolicy
	// Trust is a trust store from NewPrincipalTrustStore. Required with a
	// profile.
	Trust *PrincipalTrustStore
	// Revocation is the revocation snapshot (nil or null: unavailable).
	Revocation json.RawMessage
	// Now is the instant of every time check. Zero: the current time.
	Now time.Time
}

func profileNotLoaded(profile *StrictV1Profile) error {
	if profile != nil && !profile.loaded {
		return configError("CONFIG_INVALID_VALUE", "the profile was not loaded with ResolveStrictV1Profile")
	}
	return nil
}

// checkConfig refuses a profile or trust store this package did not load,
// and a profile without a trust store.
func checkConfig(profile *StrictV1Profile, trust *PrincipalTrustStore) error {
	if err := profileNotLoaded(profile); err != nil {
		return err
	}
	if trust != nil && !trust.loaded {
		return configError("CONFIG_INVALID_VALUE", "the trust set was not loaded with NewPrincipalTrustStore")
	}
	if profile != nil && trust == nil {
		return configError("CONFIG_PROFILE_CONTRADICTION", "strict-v1 requires a trust set")
	}
	return nil
}

type admission struct {
	errors []AdmissionError
}

func (a *admission) add(code, format string, args ...interface{}) {
	a.errors = append(a.errors, AdmissionError{Code: code, Message: bounded(fmt.Sprintf(format, args...))})
}

// sessionChecks is P2 and P3 (§ 4.2).
func (a *admission) sessionChecks(manifest map[string]interface{}, profile *StrictV1Profile, now time.Time) {
	audience, ok := manifest["intended_verifier"].(string)
	switch {
	case !ok || audience == "":
		a.add("PROFILE_AUDIENCE_MISSING", "the signed manifest has no intended_verifier")
	case audience != profile.verifierID:
		a.add("PROFILE_AUDIENCE_MISMATCH", "the bundle is intended for verifier %s, not this one", printable(audience))
	}

	issuedRaw, issuedPresent := manifest["session_issued_at"]
	expiresRaw, expiresPresent := manifest["session_expires_at"]
	issuedMissing := !issuedPresent || issuedRaw == nil
	expiresMissing := !expiresPresent || expiresRaw == nil
	if issuedMissing {
		a.add("PROFILE_SESSION_START_MISSING", "the signed manifest has no session_issued_at")
	}
	if expiresMissing {
		a.add("PROFILE_SESSION_EXPIRY_MISSING", "the signed manifest has no session_expires_at")
	}
	var issued, expires time.Time
	issuedOK, expiresOK := false, false
	if !issuedMissing {
		issued, issuedOK = parseRFC3339(issuedRaw)
	}
	if !expiresMissing {
		expires, expiresOK = parseRFC3339(expiresRaw)
	}
	if (!issuedMissing && !issuedOK) || (!expiresMissing && !expiresOK) {
		a.add("PROFILE_SESSION_TIME_INVALID", "session_issued_at or session_expires_at is not an RFC 3339 timestamp")
		return
	}
	if issuedMissing || expiresMissing {
		return
	}
	if issued.After(expires) {
		a.add("PROFILE_SESSION_TIME_INVALID", "session_issued_at is after session_expires_at")
		return
	}
	if issued.After(now.Add(sessionClockSkew)) {
		a.add("PROFILE_SESSION_NOT_STARTED", "session_issued_at is in the future")
	}
	if expires.Before(now) {
		a.add("PROFILE_SESSION_EXPIRED", "the session has expired")
	}
	if lasts := expires.UnixMilli() - issued.UnixMilli(); lasts > int64(profile.maxSession)*1000 {
		a.add("PROFILE_SESSION_TOO_LONG", "the session lasts %s s, more than %d s",
			strconv.FormatFloat(float64(lasts)/1000, 'f', -1, 64), profile.maxSession)
	}
}

// hybridDeclared is the structural part of P4: both principal signatures
// declare a hybrid signature.
func (a *admission) hybridDeclared(sb, bundle map[string]interface{}) {
	signature, _ := sb["signature"].(map[string]interface{})
	rpr, _ := bundle["responsible_principal_record"].(map[string]interface{})
	for _, s := range []struct {
		name string
		sig  interface{}
	}{{"bundle", signature["composite_sig"]}, {"responsible_principal_record", rpr["composite_sig"]}} {
		sig, ok := s.sig.(map[string]interface{})
		_, hasPQ := sig["pq"].(map[string]interface{})
		if !ok || sig["binding"] != "pq_over_classical" || !hasPQ {
			a.add("PROFILE_HYBRID_REQUIRED", "the %s signature is not a hybrid (pq_over_classical) signature", s.name)
		}
	}
}

// hybridVerified is P4 after verification: both components of both principal
// signatures verified, in hybrid_required.
func (a *admission) hybridVerified(v *V2VerificationResult) {
	if v.VerificationMode != "hybrid_required" {
		a.add("PROFILE_HYBRID_REQUIRED", "the bundle was verified in %s, not hybrid_required", v.VerificationMode)
	}
	keys := signerKeysOf(v)
	for _, signature := range principalSignatures {
		for _, component := range []string{"classical", "pq"} {
			if !slices.ContainsFunc(keys, func(k SignerKeyUse) bool {
				return k.Signature == signature && k.Component == component && k.Verified
			}) {
				a.add("PROFILE_HYBRID_REQUIRED", "the %s signature has no verified %s component", signature, component)
			}
		}
	}
}

// principalTrust is § 3: whether every verified component of the principal
// signatures is a trusted key of the principal.
func (a *admission) principalTrust(bundle map[string]interface{}, v *V2VerificationResult, store *PrincipalTrustStore, now time.Time) bool {
	humanIDRaw := artifactPayload(bundle, "responsible_principal_record")["human_id"]
	humanID, isString := humanIDRaw.(string)
	trusted, known := store.principals[humanID]
	if !isString || !known {
		a.add("TRUST_PRINCIPAL_UNKNOWN", "principal %s is not in trust set %s", printable(humanIDRaw), printable(store.version))
		return false
	}
	ok := true
	reject := func(code, format string, args ...interface{}) {
		a.add(code, format, args...)
		ok = false
	}
	var uses []SignerKeyUse
	for _, k := range signerKeysOf(v) {
		if k.Verified && slices.Contains(principalSignatures, k.Signature) {
			uses = append(uses, k)
		}
	}
	if len(uses) == 0 {
		reject("TRUST_KEY_NOT_ANCHORED", "no principal signature component verified")
	}
	for _, use := range uses {
		where := fmt.Sprintf("%s %s key %s", use.Signature, use.Component, use.Kid)
		key, found := trusted[use.Kid]
		keyBytes, canonical := canonicalB64Bytes(use.PublicKeyB64)
		switch {
		case !found || key.alg != use.Alg || !canonical || !bytes.Equal(keyBytes, key.bytes):
			reject("TRUST_KEY_NOT_ANCHORED", "%s is not a trusted key of the principal", where)
		case key.status == "revoked":
			reject("TRUST_KEY_REVOKED", "%s is revoked in the trust set", where)
		case key.status == "expired" || (key.expiresAt != nil && key.expiresAt.Before(now)):
			reject("TRUST_KEY_EXPIRED", "%s has expired in the trust set", where)
		case key.notBefore != nil && key.notBefore.After(now):
			reject("TRUST_KEY_NOT_YET_VALID", "%s is not valid yet in the trust set", where)
		}
	}
	return ok
}

// revocationChecks is § 4.3.
func (a *admission) revocationChecks(subjects RevocationSubjectSet, raw json.RawMessage, profile *StrictV1Profile, now time.Time) {
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || string(trimmed) == "null" {
		a.add("REVOCATION_UNAVAILABLE", "no revocation status could be obtained")
		return
	}
	snapshot, ok := parseRevocationSnapshot(raw)
	if !ok {
		a.add("REVOCATION_INVALID", "the revocation snapshot is malformed")
		return
	}
	if snapshot.checkedAt.After(now.Add(sessionClockSkew)) {
		a.add("REVOCATION_INVALID", "the revocation snapshot is dated in the future")
		return
	}
	if now.UnixMilli()-snapshot.checkedAt.UnixMilli() > int64(profile.maxRevocation)*1000 {
		a.add("REVOCATION_STALE", "the revocation snapshot is older than %d s", profile.maxRevocation)
	}
	for _, kind := range []struct {
		name     string
		ids      []string
		statuses map[string]string
	}{{"agent", subjects.AgentIDs, snapshot.agents}, {"key", subjects.Kids, snapshot.keys}} {
		for _, id := range kind.ids {
			switch kind.statuses[id] {
			case "revoked":
				a.add("REVOCATION_REVOKED", "%s %s is revoked", kind.name, printable(id))
			case "not_revoked":
			default:
				a.add("REVOCATION_UNKNOWN", "the revocation status of %s %s is unknown", kind.name, printable(id))
			}
		}
	}
}

// EvaluateAdmissionV2 admits a signed bundle given the verifier's result for
// it at opts.Now, under the profile's policy when there is one (§ 5). It does
// no cryptography and no I/O. It returns an *AdmissionConfigError for a zero
// Now, a profile or trust store not loaded by this package, or a profile
// without a trust store.
func EvaluateAdmissionV2(signedBundleJSON []byte, v *V2VerificationResult, opts AdmissionOptions) (*AdmissionResult, error) {
	if opts.Now.IsZero() {
		return nil, configError("CONFIG_INVALID_VALUE", "now must be set")
	}
	if err := checkConfig(opts.Profile, opts.Trust); err != nil {
		return nil, err
	}
	now := truncateToMillis(opts.Now.Round(0))
	profile, trust := opts.Profile, opts.Trust

	a := &admission{errors: []AdmissionError{}}
	sb := decodeSignedBundle(signedBundleJSON)
	bundle, _ := sb["bundle"].(map[string]interface{})
	result := &AdmissionResult{
		Verification:      v,
		PrincipalTrust:    "not_evaluated",
		ProfileCompliance: "not_evaluated",
	}
	if profile != nil {
		name := StrictV1
		result.Profile = &name
	}
	if trust != nil {
		version := trust.version
		result.TrustSetVersion = &version
	}

	if profile != nil && bundle["dcp_bundle_version"] != "2.0" {
		a.add("PROFILE_V2_REQUIRED", "strict-v1 admits V2 bundles only")
		result.ProfileCompliance = "non_compliant"
		result.Errors = a.errors
		return result, nil
	}

	if profile != nil {
		manifest, _ := bundle["manifest"].(map[string]interface{})
		a.sessionChecks(manifest, profile, now)
		a.hybridDeclared(sb, bundle)
	}
	verified := v != nil && v.Verified
	if !verified {
		var reasons []string
		if v != nil {
			reasons = v.Errors[:min(len(v.Errors), 3)]
		}
		if len(reasons) > 0 {
			a.add("VERIFICATION_FAILED", "the bundle did not verify: %s", strings.Join(reasons, "; "))
		} else {
			a.add("VERIFICATION_FAILED", "the bundle did not verify")
		}
	}
	if trust != nil && verified {
		if a.principalTrust(bundle, v, trust, now) {
			result.PrincipalTrust = "trusted"
		} else {
			result.PrincipalTrust = "untrusted"
		}
	}
	if profile != nil && verified {
		a.hybridVerified(v)
		a.revocationChecks(revocationSubjectsOf(sb, v), opts.Revocation, profile, now)
	}

	if profile != nil {
		profileFailed := slices.ContainsFunc(a.errors, func(e AdmissionError) bool {
			return strings.HasPrefix(e.Code, "PROFILE_") || strings.HasPrefix(e.Code, "REVOCATION_")
		})
		if verified && !profileFailed {
			result.ProfileCompliance = "compliant"
		} else {
			result.ProfileCompliance = "non_compliant"
		}
	}
	result.Verified = verified
	result.Admitted = verified &&
		(trust == nil || result.PrincipalTrust == "trusted") &&
		(profile == nil || result.ProfileCompliance == "compliant")
	if decision, ok := artifactPayload(bundle, "policy_decision")["decision"].(string); verified && ok {
		result.RecordedDecision = &decision
	}
	result.Errors = a.errors
	return result, nil
}

// AdmitSignedBundleV2 verifies a signed bundle at opts.Now (under the
// profile's policy when there is one) and evaluates its admission (§ 5.1). A
// non-V2 bundle under a profile is not verified at all (P1). It returns an
// *AdmissionConfigError for a profile with a caller policy, a profile without
// a trust store, or a profile or trust store not loaded by this package.
func AdmitSignedBundleV2(registry *AlgorithmRegistry, signedBundleJSON []byte, opts AdmitOptions) (*AdmissionResult, error) {
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	if err := profileNotLoaded(opts.Profile); err != nil {
		return nil, err
	}
	if opts.Profile != nil && opts.Policy != nil {
		return nil, configError("CONFIG_PROFILE_CONTRADICTION", "a strict-v1 profile sets its own verifier policy; do not pass one")
	}
	if err := checkConfig(opts.Profile, opts.Trust); err != nil {
		return nil, err
	}

	var verification *V2VerificationResult
	bundle, _ := decodeSignedBundle(signedBundleJSON)["bundle"].(map[string]interface{})
	if opts.Profile != nil && bundle["dcp_bundle_version"] != "2.0" {
		verification = &V2VerificationResult{
			DCPVersion: "2.0",
			Errors:     []string{"strict-v1 admits V2 bundles only"},
			Warnings:   []string{},
			SignerKeys: []SignerKeyUse{},
		}
	} else {
		policy := DefaultVerifierPolicy()
		switch {
		case opts.Profile != nil:
			policy = opts.Profile.VerifierPolicy()
		case opts.Policy != nil:
			policy = *opts.Policy
		}
		verification = VerifySignedBundleV2At(registry, signedBundleJSON, policy, now)
	}
	return EvaluateAdmissionV2(signedBundleJSON, verification, AdmissionOptions{
		Profile:    opts.Profile,
		Trust:      opts.Trust,
		Revocation: opts.Revocation,
		Now:        now,
	})
}
