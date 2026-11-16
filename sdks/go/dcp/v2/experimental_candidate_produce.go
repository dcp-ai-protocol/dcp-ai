package v2

// EXPERIMENTAL, opt-in (candidate dcp-jcs-v2, phase 4): producers of new candidate evidence.
//
//   - ExperimentalCandidateSignPayload signs one artifact {payload, payload_hash, composite_sig}. It signs
//     no profile: the artifact has the form and the domain context of today's artifacts.
//   - ExperimentalCandidateSignBundle assembles a bundle whose new manifest commits to
//     canonicalization_profile "dcp-jcs-v2", and signs that manifest.
//
// Inputs are ExperimentalCandidateBytes (original bytes, checked by the phase 1 ingress before anything
// parses them: the way for JSON received from elsewhere) or ExperimentalCandidateHostValue (a value of the
// exact types only: map[string]any, []any, string, bool, nil, the integer types and integral floats, and
// json.Number materialized as an exact integer by the candidate's number rules). No struct is ever
// converted, so no field is lost: a struct is TYPE_UNSUPPORTED. The assembly works on those values, never
// on BundleManifest, AuditEventV2 or PQCheckpoint. Rejections of this experimental contract are
// *ExperimentalCandidateProduceError, returned before any signer is called; they are not a normative
// activation of the profile. Errors of the key, the registry or the provider stay today's errors.
//
// Nothing here relabels received evidence or recomputes a received commitment. BuildBundleV2,
// SignBundleV2 and the verifiers are unchanged; only their primitives are reused.

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

const candidateProduceMaxDepth = 64

// ErrExperimentalCandidateUsage marks a misuse of the producer API (a parameter of the wrong shape, a
// context outside the closed set); it is never a rejection of the data.
var ErrExperimentalCandidateUsage = errors.New("experimental candidate producer: usage")

// ExperimentalCandidateProduceError is a rejection of the experimental producer contract, returned
// before any signer is called. Part names the input; Offset is a byte offset in that input's bytes,
// Path a JSON Pointer in its value.
type ExperimentalCandidateProduceError struct {
	Class  string
	Part   string
	Path   *string
	Offset *int
}

func (e *ExperimentalCandidateProduceError) Error() string {
	s := e.Class + " in " + e.Part
	if e.Path != nil {
		p := *e.Path
		if p == "" {
			p = "/"
		}
		s += " at " + p
	}
	if e.Offset != nil {
		s += fmt.Sprintf(" (byte %d)", *e.Offset)
	}
	return s
}

func produceReject(class, part, path string) error {
	return &ExperimentalCandidateProduceError{Class: class, Part: part, Path: &path}
}

func produceUsage(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrExperimentalCandidateUsage, fmt.Sprintf(format, args...))
}

// ExperimentalCandidateInput is original bytes or a host value; its zero value is neither.
type ExperimentalCandidateInput struct {
	kind  int // 1 bytes, 2 value
	bytes []byte
	value any
}

// ExperimentalCandidateBytes is an input of original bytes (copied when read).
func ExperimentalCandidateBytes(b []byte) ExperimentalCandidateInput {
	return ExperimentalCandidateInput{kind: 1, bytes: b}
}

// ExperimentalCandidateHostValue is an input of a host value of the exact types.
func ExperimentalCandidateHostValue(v any) ExperimentalCandidateInput {
	return ExperimentalCandidateInput{kind: 2, value: v}
}

// ExperimentalCandidateKeys are the signing keys: hybrid with PQ, classical-only without.
type ExperimentalCandidateKeys struct {
	Classical CompositeKeyInfo
	PQ        *CompositeKeyInfo
}

// ExperimentalCandidateProducedPayload is an artifact's canonical bytes (usable as an
// ExperimentalCandidateBytes part of a bundle) and its exact value.
type ExperimentalCandidateProducedPayload struct {
	Bytes         []byte
	SignedPayload map[string]any
}

// ExperimentalCandidateBundleParts are the parts of a bundle.
type ExperimentalCandidateBundleParts struct {
	RPR, Passport, Intent, PolicyDecision ExperimentalCandidateInput
	AuditEntries                          []ExperimentalCandidateInput
	PQCheckpoints                         []ExperimentalCandidateInput
}

// ExperimentalCandidateBundleSigner is the bundle's signer: the responsible principal.
type ExperimentalCandidateBundleSigner struct {
	SignerType, SignerID string
	Keys                 ExperimentalCandidateKeys
}

// ExperimentalCandidateBundleOptions are the session and the signature metadata. With an expiry,
// SessionIssuedAt is required: the start is never stamped from the clock. CreatedAt goes outside every
// signature and is not protected; nil is the clock. DualHash adds the SHA3 root and hash_alg
// sha256+sha3-256.
type ExperimentalCandidateBundleOptions struct {
	SessionNonce                                        string
	SessionIssuedAt, SessionExpiresAt, IntendedVerifier *string
	CreatedAt                                           *string
	DualHash                                            bool
}

// ExperimentalCandidateProducedBundle is the unit's canonical bytes and its exact value.
type ExperimentalCandidateProducedBundle struct {
	Bytes        []byte
	SignedBundle map[string]any
}

func candidatePointer(path string, key any) string {
	s := fmt.Sprint(key)
	return path + "/" + strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}

// candidateExactCopy checks a host value against the exact domain and copies it, at most 64 levels deep.
func candidateExactCopy(v any, part, path string, depth int) (any, error) {
	integer := func(n int64, ok bool) (any, error) {
		if !ok || n > candidateMaxSafe || n < -candidateMaxSafe {
			return nil, produceReject("NUMBER_OUT_OF_RANGE", part, path)
		}
		return n, nil
	}
	float := func(f float64) (any, error) {
		switch {
		case math.IsNaN(f) || math.IsInf(f, 0):
			return nil, produceReject("NUMBER_NOT_FINITE", part, path)
		case f != math.Trunc(f):
			return nil, produceReject("NUMBER_NOT_INTEGER", part, path)
		case math.Abs(f) > candidateMaxSafe:
			return nil, produceReject("NUMBER_OUT_OF_RANGE", part, path)
		}
		return int64(f), nil // 1.0 is 1, -0.0 is 0
	}
	switch t := v.(type) {
	case nil:
		return nil, nil
	case bool:
		return t, nil
	case string:
		if !utf8.ValidString(t) {
			return nil, produceReject("UTF8_INVALID", part, path)
		}
		return t, nil
	case int:
		return integer(int64(t), true)
	case int8:
		return integer(int64(t), true)
	case int16:
		return integer(int64(t), true)
	case int32:
		return integer(int64(t), true)
	case int64:
		return integer(t, true)
	case uint:
		return integer(int64(t), uint64(t) <= candidateMaxSafe)
	case uint8:
		return integer(int64(t), true)
	case uint16:
		return integer(int64(t), true)
	case uint32:
		return integer(int64(t), true)
	case uint64:
		return integer(int64(t), t <= candidateMaxSafe)
	case float32:
		return float(float64(t))
	case float64:
		return float(t)
	case json.Number:
		// The literal's exact value, by the candidate's number rules: never through encoding/json.
		r, err := ExperimentalCandidateIngress([]byte(t))
		if err != nil {
			return nil, err
		}
		if !r.Accepted {
			if r.Class == "NUMBER_NOT_INTEGER" || r.Class == "NUMBER_OUT_OF_RANGE" {
				return nil, produceReject(r.Class, part, path)
			}
			return nil, produceReject("TYPE_UNSUPPORTED", part, path)
		}
		if _, ok := r.Value.(int64); !ok {
			return nil, produceReject("TYPE_UNSUPPORTED", part, path)
		}
		return r.Value, nil
	case []any:
		if depth+1 > candidateProduceMaxDepth {
			return nil, produceReject("DEPTH_EXCEEDED", part, path)
		}
		out := make([]any, len(t))
		for i, x := range t {
			c, err := candidateExactCopy(x, part, candidatePointer(path, i), depth+1)
			if err != nil {
				return nil, err
			}
			out[i] = c
		}
		return out, nil
	case map[string]any:
		if depth+1 > candidateProduceMaxDepth {
			return nil, produceReject("DEPTH_EXCEEDED", part, path)
		}
		out := make(map[string]any, len(t))
		for k, x := range t {
			at := candidatePointer(path, k)
			if !utf8.ValidString(k) {
				return nil, produceReject("UTF8_INVALID", part, at)
			}
			c, err := candidateExactCopy(x, part, at, depth+1)
			if err != nil {
				return nil, err
			}
			out[k] = c
		}
		return out, nil
	}
	return nil, produceReject("TYPE_UNSUPPORTED", part, path) // structs, pointers and every other type
}

const candidateMaxSafe = 9007199254740991 // 2^53-1

// candidateReadInput checks and copies an input; bytes go through the phase 1 ingress.
func candidateReadInput(in ExperimentalCandidateInput, part, path string) (any, error) {
	switch in.kind {
	case 1:
		r, err := ExperimentalCandidateIngress(append([]byte(nil), in.bytes...))
		if err != nil {
			return nil, err
		}
		if !r.Accepted {
			offset := r.Offset
			e := &ExperimentalCandidateProduceError{Class: r.Class, Part: part, Offset: &offset}
			if path != "" {
				e.Path = &path
			}
			return nil, e
		}
		return r.Value, nil
	case 2:
		return candidateExactCopy(in.value, part, path, 0)
	}
	return nil, produceUsage("%s must be ExperimentalCandidateBytes or ExperimentalCandidateHostValue", part)
}

// candidateTooDeep is the pointer of the first container that opens a level beyond limit, or nil.
func candidateTooDeep(v any, limit int, path string, depth int) *string {
	switch t := v.(type) {
	case map[string]any:
		if depth+1 > limit {
			return &path
		}
		for k, x := range t {
			if p := candidateTooDeep(x, limit, candidatePointer(path, k), depth+1); p != nil {
				return p
			}
		}
	case []any:
		if depth+1 > limit {
			return &path
		}
		for i, x := range t {
			if p := candidateTooDeep(x, limit, candidatePointer(path, i), depth+1); p != nil {
				return p
			}
		}
	}
	return nil
}

func candidateCheckKeys(k ExperimentalCandidateKeys, part string) error {
	check := func(name string, key CompositeKeyInfo) error {
		if key.Kid == "" || key.Alg == "" || key.SecretKeyB64 == "" {
			return produceUsage("%s.%s needs a kid, an alg and a secret key", part, name)
		}
		if !utf8.ValidString(key.Kid) {
			return produceReject("UTF8_INVALID", part, "/"+name+"/kid")
		}
		if !utf8.ValidString(key.Alg) {
			return produceReject("UTF8_INVALID", part, "/"+name+"/alg")
		}
		return nil
	}
	if err := check("classical", k.Classical); err != nil {
		return err
	}
	if k.PQ != nil {
		return check("pq", *k.PQ)
	}
	return nil
}

var candidateContexts = map[string]bool{
	CtxAgentPassport: true, CtxResponsiblePrincipal: true, CtxIntent: true, CtxPolicyDecision: true,
	CtxAuditEvent: true, CtxBundle: true, CtxRevocation: true, CtxKeyRotation: true, CtxProofOfPossession: true,
	CtxJurisdictionAttestation: true, CtxHumanConfirmation: true, CtxMultiPartyAuth: true, CtxLifecycle: true,
	CtxSuccession: true, CtxDispute: true, CtxRights: true, CtxDelegation: true, CtxAwareness: true, CtxSubMandate: true,
}

func candidateSign(registry *AlgorithmRegistry, context string, data []byte, k ExperimentalCandidateKeys) (*CompositeSignature, error) {
	if k.PQ != nil {
		return CompositeSign(registry, context, data, k.Classical, *k.PQ)
	}
	return ClassicalOnlySign(registry, context, data, k.Classical)
}

func candidateCompositeValue(cs *CompositeSignature) map[string]any {
	entry := func(e SignatureEntry) map[string]any {
		return map[string]any{"alg": e.Alg, "kid": e.Kid, "sig_b64": e.SigB64}
	}
	out := map[string]any{"classical": entry(cs.Classical), "pq": nil, "binding": cs.Binding}
	if cs.PQ != nil {
		out["pq"] = entry(*cs.PQ)
	}
	return out
}

// candidatePayloadHash is the canonical bytes of a payload and its "sha256:" hash, as SignPayload writes it.
func candidatePayloadHash(payload any) ([]byte, string, error) {
	canonical, _, err := PreparePayload(payload)
	if err != nil {
		return nil, "", err
	}
	return canonical, "sha256:" + SHA256Hex(canonical), nil
}

func candidateCanonicalBytes(v any) ([]byte, error) {
	s, err := CanonicalizeV2(v)
	return []byte(s), err
}

// ExperimentalCandidateSignPayload is EXPERIMENTAL, opt-in (candidate dcp-jcs-v2, phase 4): it signs one
// artifact under context (one of the Ctx constants) over the canonical bytes of the payload's exact
// value. The payload must be an object and the artifact must fit in 64 levels (the payload in 63): its
// own bytes go through the ingress.
func ExperimentalCandidateSignPayload(registry *AlgorithmRegistry, context string, input ExperimentalCandidateInput, keys ExperimentalCandidateKeys) (ExperimentalCandidateProducedPayload, error) {
	var none ExperimentalCandidateProducedPayload
	if !candidateContexts[context] {
		return none, produceUsage("context must be one of the DCP contexts")
	}
	if err := candidateCheckKeys(keys, "keys"); err != nil {
		return none, err
	}
	v, err := candidateReadInput(input, "payload", "")
	if err != nil {
		return none, err
	}
	payload, ok := v.(map[string]any)
	if !ok {
		return none, produceReject("TYPE_UNSUPPORTED", "payload", "")
	}
	if deep := candidateTooDeep(payload, candidateProduceMaxDepth-1, "", 0); deep != nil {
		return none, produceReject("DEPTH_EXCEEDED", "payload", *deep)
	}
	canonical, payloadHash, err := candidatePayloadHash(payload)
	if err != nil {
		return none, fmt.Errorf("%w: %v", ErrExperimentalCandidateInternal, err)
	}

	cs, err := candidateSign(registry, context, canonical, keys)
	if err != nil {
		return none, err
	}

	signed := map[string]any{"payload": payload, "payload_hash": payloadHash, "composite_sig": candidateCompositeValue(cs)}
	out, err := candidateCanonicalBytes(signed)
	if err != nil {
		return none, fmt.Errorf("%w: %v", ErrExperimentalCandidateInternal, err)
	}
	if again, err := ExperimentalCandidateIngress(out); err != nil || !again.Accepted || again.CanonicalSHA256 != SHA256Hex(out) {
		return none, fmt.Errorf("%w: a signed artifact the candidate ingress does not give back as is", ErrExperimentalCandidateInternal)
	}
	return ExperimentalCandidateProducedPayload{Bytes: out, SignedPayload: signed}, nil
}

func candidateReadArtifact(in ExperimentalCandidateInput, part string) (map[string]any, error) {
	v, err := candidateReadInput(in, part, "")
	if err != nil {
		return nil, err
	}
	a, ok := v.(map[string]any)
	if !ok {
		return nil, produceReject("TYPE_UNSUPPORTED", part, "")
	}
	payload, ok := a["payload"].(map[string]any)
	if !ok {
		return nil, produceReject("TYPE_UNSUPPORTED", part, "/payload")
	}
	if _, ok := a["composite_sig"].(map[string]any); !ok {
		return nil, produceReject("TYPE_UNSUPPORTED", part, "/composite_sig")
	}
	// The received commitment is checked, never recomputed into the artifact.
	_, hash, err := candidatePayloadHash(payload)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrExperimentalCandidateInternal, err)
	}
	if got, _ := a["payload_hash"].(string); got != hash {
		return nil, produceReject("COMMITMENT_MISMATCH", part, "/payload_hash")
	}
	return a, nil
}

func candidateOptional(v *string, part, path string) (*string, error) {
	if v == nil {
		return nil, nil
	}
	if *v == "" {
		return nil, produceUsage("%s%s must be a non-empty string", part, path)
	}
	if !utf8.ValidString(*v) {
		return nil, produceReject("UTF8_INVALID", part, path)
	}
	s := *v
	return &s, nil
}

// ExperimentalCandidateSignBundle is EXPERIMENTAL, opt-in (candidate dcp-jcs-v2, phase 4): it assembles a
// bundle from its parts and signs a new manifest that commits to canonicalization_profile "dcp-jcs-v2".
// Every part is copied whole: members it does not know are kept; those outside a payload, an entry, a
// checkpoint or the manifest are not signed, so their integrity is not claimed. An empty audit trail has
// audit_count 0 and the root of 64 zeros.
func ExperimentalCandidateSignBundle(registry *AlgorithmRegistry, parts ExperimentalCandidateBundleParts, signer ExperimentalCandidateBundleSigner, options ExperimentalCandidateBundleOptions) (ExperimentalCandidateProducedBundle, error) {
	var none ExperimentalCandidateProducedBundle
	if signer.SignerType == "" || signer.SignerID == "" {
		return none, produceUsage("signer type and id must be non-empty")
	}
	if !utf8.ValidString(signer.SignerType) {
		return none, produceReject("UTF8_INVALID", "signer", "/signer_type")
	}
	if !utf8.ValidString(signer.SignerID) {
		return none, produceReject("UTF8_INVALID", "signer", "/signer_id")
	}
	if err := candidateCheckKeys(signer.Keys, "signer.keys"); err != nil {
		return none, err
	}
	if !IsValidSessionNonce(options.SessionNonce) {
		return none, produceReject("SESSION_INVALID", "options", "/session_nonce")
	}
	issuedAt, err := candidateOptional(options.SessionIssuedAt, "options", "/session_issued_at")
	if err != nil {
		return none, err
	}
	expiresAt, err := candidateOptional(options.SessionExpiresAt, "options", "/session_expires_at")
	if err != nil {
		return none, err
	}
	intended, err := candidateOptional(options.IntendedVerifier, "options", "/intended_verifier")
	if err != nil {
		return none, err
	}
	createdAt := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	if c, err := candidateOptional(options.CreatedAt, "options", "/created_at"); err != nil {
		return none, err
	} else if c != nil {
		if _, ok := parseRFC3339(*c); !ok {
			return none, produceUsage("options.created_at must be an RFC 3339 date")
		}
		createdAt = *c
	}
	var issued, expires time.Time
	if issuedAt != nil {
		t, ok := parseRFC3339(*issuedAt)
		if !ok {
			return none, produceReject("SESSION_INVALID", "options", "/session_issued_at")
		}
		issued = t
	}
	if expiresAt != nil {
		t, ok := parseRFC3339(*expiresAt)
		if !ok {
			return none, produceReject("SESSION_INVALID", "options", "/session_expires_at")
		}
		if issuedAt == nil {
			return none, produceReject("SESSION_ISSUED_AT_REQUIRED", "options", "/session_issued_at")
		}
		expires = t
		if issued.After(expires) {
			return none, produceReject("SESSION_INVALID", "options", "/session_expires_at")
		}
	}

	named := []struct {
		in      ExperimentalCandidateInput
		part    string
		member  string
		hashKey string
	}{
		{parts.RPR, "rpr", "responsible_principal_record", "rpr_hash"},
		{parts.Passport, "passport", "agent_passport", "passport_hash"},
		{parts.Intent, "intent", "intent", "intent_hash"},
		{parts.PolicyDecision, "policy_decision", "policy_decision", "policy_hash"},
	}
	artifacts := make([]map[string]any, len(named))
	for i, n := range named {
		a, err := candidateReadArtifact(n.in, n.part)
		if err != nil {
			return none, err
		}
		artifacts[i] = a
	}
	entries := make([]map[string]any, 0, len(parts.AuditEntries))
	for i, in := range parts.AuditEntries {
		v, err := candidateReadInput(in, "audit_entries", fmt.Sprintf("/%d", i))
		if err != nil {
			return none, err
		}
		e, ok := v.(map[string]any)
		if !ok {
			return none, produceReject("TYPE_UNSUPPORTED", "audit_entries", fmt.Sprintf("/%d", i))
		}
		entries = append(entries, e)
	}
	checkpoints := make([]map[string]any, 0, len(parts.PQCheckpoints))
	for i, in := range parts.PQCheckpoints {
		v, err := candidateReadInput(in, "pq_checkpoints", fmt.Sprintf("/%d", i))
		if err != nil {
			return none, err
		}
		c, ok := v.(map[string]any)
		if _, isID := c["checkpoint_id"].(string); !ok || !isID {
			return none, produceReject("TYPE_UNSUPPORTED", "pq_checkpoints", fmt.Sprintf("/%d", i))
		}
		checkpoints = append(checkpoints, c)
	}

	// The chain is checked, never inferred or repaired: a new chain starts at GENESIS.
	var sha256Leaves, sha3Leaves []string
	for i, e := range entries {
		canonical, err := CanonicalizeV2(e)
		if err != nil {
			return none, fmt.Errorf("%w: %v", ErrExperimentalCandidateInternal, err)
		}
		expected := "GENESIS"
		if i > 0 {
			prev, _ := CanonicalizeV2(entries[i-1])
			expected = "sha256:" + SHA256Hex([]byte(prev))
		}
		if got, _ := e["prev_hash"].(string); got != expected {
			class := "CHAIN_BREAK"
			if i == 0 {
				class = "CHAIN_NOT_GENESIS"
			}
			return none, produceReject(class, "audit_entries", fmt.Sprintf("/%d/prev_hash", i))
		}
		dh := DualHashCanonical(canonical)
		sha256Leaves = append(sha256Leaves, dh.SHA256)
		sha3Leaves = append(sha3Leaves, dh.SHA3256)
	}
	bound := []map[string]interface{}{}
	for _, a := range artifacts {
		bound = append(bound, a["payload"].(map[string]any))
	}
	bound = append(append(bound, entries...), checkpoints...)
	if b := VerifySessionBinding(bound); !b.Valid || b.Nonce != options.SessionNonce {
		return none, &ExperimentalCandidateProduceError{Class: "SESSION_INVALID", Part: "parts"}
	}
	if id, _ := artifacts[0]["payload"].(map[string]any)["human_id"].(string); id != signer.SignerID {
		return none, produceReject("SIGNER_MISMATCH", "signer", "/signer_id")
	}

	zeros := strings.Repeat("0", 64)
	root, root3 := zeros, zeros
	if len(entries) > 0 {
		root, root3 = computeMerkleRoot(sha256Leaves, merkleHashSHA256), computeMerkleRoot(sha3Leaves, merkleHashSHA3)
	}
	manifest := map[string]any{
		"session_nonce":            options.SessionNonce,
		"audit_merkle_root":        "sha256:" + root,
		"audit_count":              int64(len(entries)),
		"canonicalization_profile": "dcp-jcs-v2",
	}
	for i, n := range named {
		manifest[n.hashKey] = artifacts[i]["payload_hash"]
	}
	if options.DualHash {
		manifest["audit_merkle_root_secondary"] = "sha3-256:" + root3
	}
	if len(checkpoints) > 0 {
		ids := make([]any, len(checkpoints))
		for i, c := range checkpoints {
			ids[i] = c["checkpoint_id"]
		}
		manifest["pq_checkpoints"] = ids
	}
	if issuedAt != nil {
		manifest["session_issued_at"] = *issuedAt
	}
	if expiresAt != nil {
		manifest["session_expires_at"] = *expiresAt
	}
	if intended != nil {
		manifest["intended_verifier"] = *intended
	}
	bundle := map[string]any{"dcp_bundle_version": "2.0", "manifest": manifest}
	for i, n := range named {
		bundle[n.member] = artifacts[i]
	}
	entryValues := make([]any, len(entries))
	for i, e := range entries {
		entryValues[i] = e
	}
	bundle["audit_entries"] = entryValues
	if len(checkpoints) > 0 {
		cps := make([]any, len(checkpoints))
		for i, c := range checkpoints {
			cps[i] = c
		}
		bundle["pq_checkpoints"] = cps
	}
	kids := []any{signer.Keys.Classical.Kid}
	binding := "classical_only"
	if signer.Keys.PQ != nil {
		kids = append(kids, signer.Keys.PQ.Kid)
		binding = "pq_over_classical"
	}
	hashAlg := "sha256"
	if options.DualHash {
		hashAlg = "sha256+sha3-256"
	}
	signature := func(manifestHash string, composite map[string]any) map[string]any {
		return map[string]any{
			"hash_alg":      hashAlg,
			"created_at":    createdAt,
			"signer":        map[string]any{"type": signer.SignerType, "id": signer.SignerID, "kids": kids},
			"manifest_hash": manifestHash,
			"composite_sig": composite,
		}
	}
	// The final unit's skeleton, its signature included, must fit in 64 levels before anything is signed.
	entry := func(k CompositeKeyInfo) map[string]any {
		return map[string]any{"alg": k.Alg, "kid": k.Kid, "sig_b64": ""}
	}
	placeholder := map[string]any{"classical": entry(signer.Keys.Classical), "pq": nil, "binding": binding}
	if signer.Keys.PQ != nil {
		placeholder["pq"] = entry(*signer.Keys.PQ)
	}
	skeleton := map[string]any{"bundle": bundle, "signature": signature("sha256:"+zeros, placeholder)}
	if deep := candidateTooDeep(skeleton, candidateProduceMaxDepth, "", 0); deep != nil {
		return none, produceReject("DEPTH_EXCEEDED", "unit", *deep)
	}
	manifestBytes, err := candidateCanonicalBytes(manifest)
	if err != nil {
		return none, fmt.Errorf("%w: %v", ErrExperimentalCandidateInternal, err)
	}

	cs, err := candidateSign(registry, CtxBundle, manifestBytes, signer.Keys)
	if err != nil {
		return none, err
	}

	signed := map[string]any{"bundle": bundle, "signature": signature("sha256:"+SHA256Hex(manifestBytes), candidateCompositeValue(cs))}
	out, err := candidateCanonicalBytes(signed)
	if err != nil {
		return none, fmt.Errorf("%w: %v", ErrExperimentalCandidateInternal, err)
	}
	// The private encoding/json decoder: a walkable candidate unit never consults it.
	adapter := &ExperimentalHistoricalAdapter{Name: "encoding_json", Decode: decodeEncodingJSON}
	router, err := NewExperimentalCandidateRouter(ExperimentalCandidateRouterConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v2"}, Historical: adapter})
	if err != nil {
		return none, fmt.Errorf("%w: %v", ErrExperimentalCandidateInternal, err)
	}
	route, err := router.Route(out)
	if err != nil || route.Outcome != "candidate" || route.CanonicalSHA256 != SHA256Hex(out) {
		return none, fmt.Errorf("%w: a produced unit the candidate route does not give back as is", ErrExperimentalCandidateInternal)
	}
	return ExperimentalCandidateProducedBundle{Bytes: out, SignedBundle: signed}, nil
}
