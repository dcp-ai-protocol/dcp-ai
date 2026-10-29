// External conformance wrapper for the Go SDK (contract dcp-ai-conformance-external/1,
// tools/conformance/README.md). Reads one request on stdin and writes one response on stdout.
//
// canonicalize: the input bytes must be UTF-8 (checked first, because encoding/json would replace
// invalid bytes), then json.Unmarshal into interface{} as the SDK's own interop test does (a failure is
// rejected/parse), then ONE call to v2.CanonicalizeV2. Only its documented rejection ("non-integer float
// at" / "non-finite float at", a plain error with no stable type or code) is rejected/profile; any other
// error is an error. digest: v2.SHA256Hex / v2.SHA3256Hex of the decoded bytes. Contracts /2 and /3 (opt-in) are
// described where they are handled below.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"runtime"
	"runtime/debug"
	"sort"
	"time"
	"unicode/utf8"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

const contract = "dcp-ai-conformance-external/1"
const contractV2 = "dcp-ai-conformance-external/2"
const contractV3 = "dcp-ai-conformance-external/3"

// evidence is set when the request is contract /2 (opt-in): dual_merkle_root, composite_verify and
// verify_signed_bundle_v2 are then accepted, one call per case to v2.DualMerkleRoot, v2.CompositeVerify or
// v2.VerifySignedBundleV2At, with the Ed25519 and ML-DSA-65 providers registered as the SDK's interop tests do.
var evidence bool

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// The kit's contract: RFC 3339 with an explicit zone (Z or ±HH:MM).
var rfc3339 = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)

func registry() *v2.AlgorithmRegistry {
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	return reg
}

func runEvidenceCase(id, op string, c map[string]json.RawMessage) map[string]interface{} {
	switch op {
	case "dual_merkle_root":
		if !exactKeys(c, "id", "op", "leaves") || jsonKind(c["leaves"]) != '[' {
			fail("case " + id + ": dual_merkle_root needs exactly id, op and a leaves array")
		}
		var raws []json.RawMessage
		if json.Unmarshal(c["leaves"], &raws) != nil {
			fail("case " + id + ": leaves must be an array")
		}
		leaves := make([]v2.DualHash, 0, len(raws))
		for _, r := range raws {
			var l map[string]json.RawMessage
			if jsonKind(r) != '{' || json.Unmarshal(r, &l) != nil || !exactKeys(l, "sha256", "sha3_256") {
				fail("case " + id + ": a leaf must be {sha256, sha3_256}")
			}
			leaf := v2.DualHash{SHA256: mustStr(l, "sha256", "case "+id), SHA3256: mustStr(l, "sha3_256", "case "+id)}
			if !hex64.MatchString(leaf.SHA256) || !hex64.MatchString(leaf.SHA3256) {
				fail("case " + id + ": a leaf must be lowercase 64-hex strings")
			}
			leaves = append(leaves, leaf)
		}
		if len(leaves) == 0 {
			fail("case " + id + ": leaves must not be empty")
		}
		root, ok := v2.DualMerkleRoot(leaves)
		if !ok {
			return map[string]interface{}{"id": id, "status": "error", "message": "DualMerkleRoot returned no root"}
		}
		return map[string]interface{}{"id": id, "status": "ok", "sha256": root.SHA256, "sha3_256": root.SHA3256}
	case "composite_verify":
		if !exactKeys(c, "id", "op", "context", "payload_b64", "composite_sig", "classical_public_key_b64", "pq_public_key_b64") || jsonKind(c["composite_sig"]) != '{' {
			fail("case " + id + ": composite_verify fields do not match")
		}
		payload, ok := decodeBase64Strict(mustStr(c, "payload_b64", "case "+id))
		if !ok {
			fail("case " + id + ": payload_b64 is not canonical base64")
		}
		pq := ""
		if jsonKind(c["pq_public_key_b64"]) != 'n' {
			pq = mustStr(c, "pq_public_key_b64", "case "+id)
		}
		var sig v2.CompositeSignature
		if err := json.Unmarshal(c["composite_sig"], &sig); err != nil {
			fail("case " + id + ": composite_sig: " + err.Error())
		}
		r, err := v2.CompositeVerify(registry(), mustStr(c, "context", "case "+id), payload, &sig, mustStr(c, "classical_public_key_b64", "case "+id), pq)
		if err != nil {
			return map[string]interface{}{"id": id, "status": "error", "message": fmt.Sprintf("%T: %s", err, err.Error())}
		}
		return map[string]interface{}{"id": id, "status": "ok", "valid": r.Valid, "classical_valid": r.ClassicalValid, "pq_valid": r.PQValid}
	default: // verify_signed_bundle_v2
		if !exactKeys(c, "id", "op", "bundle_b64", "policy", "verification_time") || jsonKind(c["policy"]) != '{' {
			fail("case " + id + ": verify_signed_bundle_v2 fields do not match")
		}
		bundle, ok := decodeBase64Strict(mustStr(c, "bundle_b64", "case "+id))
		if !ok {
			fail("case " + id + ": bundle_b64 is not canonical base64")
		}
		t := mustStr(c, "verification_time", "case "+id)
		now, err := time.Parse(time.RFC3339Nano, t)
		if err != nil || !rfc3339.MatchString(t) {
			fail("case " + id + ": verification_time is not RFC 3339")
		}
		var policy v2.VerifierPolicy
		if err := json.Unmarshal(c["policy"], &policy); err != nil {
			fail("case " + id + ": policy: " + err.Error())
		}
		if !utf8.Valid(bundle) || !json.Valid(bundle) {
			return map[string]interface{}{"id": id, "status": "rejected", "code": "parse"}
		}
		r := v2.VerifySignedBundleV2At(registry(), bundle, policy, now)
		errs := r.Errors
		if errs == nil {
			errs = []string{}
		}
		return map[string]interface{}{"id": id, "status": "ok", "verified": r.Verified, "errors": errs}
	}
}

// admission is set when the request is contract /3 (opt-in, spec/profiles/admission): admit_signed_bundle_v2 and
// load_admission_config are then accepted, one call per case to v2.AdmitSignedBundleV2 (the combined function, at the
// request's now, never the system clock), after v2.ResolveStrictV1Profile and v2.NewPrincipalTrustStore load the
// operator's configuration, or one call to either loader. Only a *v2.AdmissionConfigError (errors.As) is a rejection,
// with its Code; any other error is an error. DCP_CONFORMANCE_WRAPPER_FAULT (self-tests only) can only turn an answer
// into an error: "untyped" replaces each SDK call by an untyped error carrying a configuration code, "panic" panics.
var admission bool

// /3's now is exactly YYYY-MM-DDTHH:mm:ss.sssZ, a real date in the years 0001-9999: time.Parse refuses an impossible
// date, the round trip any other spelling of the same instant, and year 0000 is refused explicitly.
var nowMs = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)

const nowLayout = "2006-01-02T15:04:05.000Z"

func fault() error {
	switch os.Getenv("DCP_CONFORMANCE_WRAPPER_FAULT") {
	case "untyped":
		return errors.New("CONFIG_INVALID_VALUE: injected by DCP_CONFORMANCE_WRAPPER_FAULT")
	case "panic":
		panic("injected by DCP_CONFORMANCE_WRAPPER_FAULT")
	}
	return nil
}

// classify turns an SDK error into the result: rejected for the SDK's typed configuration error, else an error.
func classify(id string, err error) map[string]interface{} {
	var ce *v2.AdmissionConfigError
	if errors.As(err, &ce) {
		return map[string]interface{}{"id": id, "status": "rejected", "code": ce.Code}
	}
	msg := fmt.Sprintf("%T: %s", err, err.Error())
	if len(msg) > 500 {
		msg = msg[:500]
	}
	return map[string]interface{}{"id": id, "status": "error", "message": msg}
}

func runAdmissionCase(id, op string, c map[string]json.RawMessage) map[string]interface{} {
	if op == "load_admission_config" {
		if !exactKeys(c, "id", "op", "kind", "config") {
			fail("case " + id + ": load_admission_config fields do not match")
		}
		kind := mustStr(c, "kind", "case "+id)
		if kind != "trust_set" && kind != "profile" {
			fail("case " + id + ": kind must be trust_set or profile")
		}
		if err := fault(); err != nil {
			return classify(id, err)
		}
		if kind == "trust_set" {
			if _, err := v2.NewPrincipalTrustStore(c["config"]); err != nil {
				return classify(id, err)
			}
			return map[string]interface{}{"id": id, "status": "ok", "accepted": true}
		}
		p, err := v2.ResolveStrictV1Profile(c["config"])
		if err != nil {
			return classify(id, err)
		}
		return map[string]interface{}{"id": id, "status": "ok", "accepted": true,
			"max_session_duration_seconds": p.MaxSessionDurationSeconds(), "max_revocation_age_seconds": p.MaxRevocationAgeSeconds()}
	}
	if !exactKeys(c, "id", "op", "bundle_b64", "now", "profile", "trust_set", "verifier_policy", "revocation") {
		fail("case " + id + ": admit_signed_bundle_v2 fields do not match")
	}
	bundle, ok := decodeBase64Strict(mustStr(c, "bundle_b64", "case "+id))
	if !ok || !utf8.Valid(bundle) || !json.Valid(bundle) {
		fail("case " + id + ": bundle_b64 is not canonical base64 of UTF-8 JSON")
	}
	t := mustStr(c, "now", "case "+id)
	now, err := time.Parse(nowLayout, t)
	if err != nil || !nowMs.MatchString(t) || now.UTC().Format(nowLayout) != t || now.Year() < 1 {
		fail("case " + id + ": now is not YYYY-MM-DDTHH:mm:ss.sssZ with a real date in the years 0001-9999")
	}
	for _, k := range []string{"profile", "trust_set", "verifier_policy", "revocation"} {
		if kind := jsonKind(c[k]); kind != 'n' && kind != '{' {
			fail("case " + id + ": " + k + " must be an object or null")
		}
	}
	var snapshot json.RawMessage
	hasProfile, hasRevocation := jsonKind(c["profile"]) == '{', jsonKind(c["revocation"]) == '{'
	if hasRevocation {
		var rev map[string]json.RawMessage
		if json.Unmarshal(c["revocation"], &rev) != nil {
			fail("case " + id + ": revocation must be an object")
		}
		state, _ := str(rev, "state")
		switch {
		case state == "unavailable" && exactKeys(rev, "state"):
		case state == "snapshot" && exactKeys(rev, "state", "snapshot") && jsonKind(rev["snapshot"]) == '{':
			// An object, complete or not: the SDK judges its content.
			snapshot = rev["snapshot"]
		default:
			fail("case " + id + ": revocation is {state: unavailable} or {state: snapshot, snapshot: <object>}")
		}
	}
	if hasProfile != hasRevocation {
		fail("case " + id + ": revocation is given exactly under a profile")
	}
	if err := fault(); err != nil {
		return classify(id, err)
	}
	opts := v2.AdmitOptions{Now: now, Revocation: snapshot}
	if hasProfile {
		if opts.Profile, err = v2.ResolveStrictV1Profile(c["profile"]); err != nil {
			return classify(id, err)
		}
	}
	if jsonKind(c["trust_set"]) == '{' {
		if opts.Trust, err = v2.NewPrincipalTrustStore(c["trust_set"]); err != nil {
			return classify(id, err)
		}
	}
	if jsonKind(c["verifier_policy"]) == '{' {
		var policy v2.VerifierPolicy
		if err := json.Unmarshal(c["verifier_policy"], &policy); err != nil {
			return classify(id, fmt.Errorf("verifier_policy: %w", err))
		}
		opts.Policy = &policy
	}
	r, err := v2.AdmitSignedBundleV2(registry(), bundle, opts)
	if err != nil {
		return classify(id, err)
	}
	if r.Verification == nil {
		return map[string]interface{}{"id": id, "status": "error", "message": "the admission result has no verification"}
	}
	codes := make([]string, 0, len(r.Errors))
	for _, e := range r.Errors {
		codes = append(codes, e.Code)
	}
	return map[string]interface{}{"id": id, "status": "ok", "verified": r.Verified, "principal_trust": r.PrincipalTrust, "profile": r.Profile,
		"profile_compliance": r.ProfileCompliance, "admitted": r.Admitted, "action_authorized": r.ActionAuthorized,
		"recorded_decision": r.RecordedDecision, "trust_set_version": r.TrustSetVersion, "codes": codes, "verification_verified": r.Verification.Verified}
}

var documentedRejection = regexp.MustCompile(`^non-(integer|finite) float at `)

func fail(msg string) {
	fmt.Fprintf(os.Stderr, "go wrapper: %s\n", msg)
	os.Exit(2)
}

func keys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func exactKeys(m map[string]json.RawMessage, want ...string) bool {
	sort.Strings(want)
	got := keys(m)
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// jsonKind is the first byte of a JSON value: '"' string, '{' object, '[' array (json.Unmarshal would
// accept null for all three and leave a zero value, so the kind is checked explicitly).
func jsonKind(raw json.RawMessage) byte {
	t := bytes.TrimSpace(raw)
	if len(t) == 0 {
		return 0
	}
	return t[0]
}

// str returns m[k] only when it is present and a JSON string.
func str(m map[string]json.RawMessage, k string) (string, bool) {
	raw, ok := m[k]
	if !ok || jsonKind(raw) != '"' {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// mustStr is str for a required field: a missing or non-string value is an invalid request (exit 2).
func mustStr(m map[string]json.RawMessage, k, where string) string {
	s, ok := str(m, k)
	if !ok {
		fail(where + ": " + k + " must be a string")
	}
	return s
}

// decodeBase64Strict accepts only canonical RFC 4648 base64 with padding.
func decodeBase64Strict(s string) ([]byte, bool) {
	b, err := base64.StdEncoding.Strict().DecodeString(s)
	if err != nil || base64.StdEncoding.EncodeToString(b) != s {
		return nil, false
	}
	return b, true
}

func sdkVersion() (string, string) {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown", "unknown"
	}
	for _, d := range info.Deps {
		if d.Path == "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2" {
			if d.Replace != nil {
				return "local checkout (replace " + d.Replace.Path + ")", d.Path
			}
			return d.Version, d.Path
		}
	}
	return "unknown", "unknown"
}

func runCase(raw json.RawMessage) map[string]interface{} {
	var c map[string]json.RawMessage
	if jsonKind(raw) != '{' || json.Unmarshal(raw, &c) != nil {
		fail("a case must be an object")
	}
	id := mustStr(c, "id", "a case")
	op := mustStr(c, "op", "case "+id)
	if evidence && (op == "dual_merkle_root" || op == "composite_verify" || op == "verify_signed_bundle_v2") {
		return runEvidenceCase(id, op, c)
	}
	if admission && (op == "admit_signed_bundle_v2" || op == "load_admission_config") {
		return runAdmissionCase(id, op, c)
	}
	switch op {
	case "canonicalize":
		if !exactKeys(c, "id", "op", "profile", "input_b64") {
			fail("case fields do not match op canonicalize")
		}
	case "digest":
		if !exactKeys(c, "id", "op", "alg", "input_b64") {
			fail("case fields do not match op digest")
		}
	default:
		return map[string]interface{}{"id": id, "status": "unsupported"}
	}
	input, ok := decodeBase64Strict(mustStr(c, "input_b64", "case "+id))
	if !ok {
		fail("case " + id + ": input_b64 is not canonical base64")
	}
	if op == "digest" {
		switch mustStr(c, "alg", "case "+id) {
		case "sha256":
			return map[string]interface{}{"id": id, "status": "ok", "hex": v2.SHA256Hex(input)}
		case "sha3-256":
			return map[string]interface{}{"id": id, "status": "ok", "hex": v2.SHA3256Hex(input)}
		}
		return map[string]interface{}{"id": id, "status": "unsupported"}
	}
	if mustStr(c, "profile", "case "+id) != "dcp-jcs-v1" {
		return map[string]interface{}{"id": id, "status": "unsupported"}
	}
	if !utf8.Valid(input) {
		return map[string]interface{}{"id": id, "status": "rejected", "code": "parse"}
	}
	var value interface{}
	if err := json.Unmarshal(input, &value); err != nil {
		return map[string]interface{}{"id": id, "status": "rejected", "code": "parse"}
	}
	out, err := v2.CanonicalizeV2(value)
	if err != nil {
		if documentedRejection.MatchString(err.Error()) {
			return map[string]interface{}{"id": id, "status": "rejected", "code": "profile"}
		}
		msg := fmt.Sprintf("%T: %s", err, err.Error())
		if len(msg) > 500 {
			msg = msg[:500]
		}
		return map[string]interface{}{"id": id, "status": "error", "message": msg}
	}
	return map[string]interface{}{"id": id, "status": "ok", "output_b64": base64.StdEncoding.EncodeToString([]byte(out))}
}

func main() {
	data, err := io.ReadAll(os.Stdin)
	if err != nil || !utf8.Valid(data) {
		fail("the request is not UTF-8")
	}
	var req map[string]json.RawMessage
	if jsonKind(data) != '{' {
		fail("the request must be a JSON object")
	}
	if err := json.Unmarshal(data, &req); err != nil {
		fail("the request is not JSON: " + err.Error())
	}
	if !exactKeys(req, "contract", "run_id", "nonce", "cases") {
		fail("the request needs exactly contract, run_id, nonce and cases")
	}
	switch mustStr(req, "contract", "the request") {
	case contract:
	case contractV2:
		evidence = true
	case contractV3:
		admission = true
	default:
		fail("unknown contract")
	}
	runID := mustStr(req, "run_id", "the request")
	nonce := mustStr(req, "nonce", "the request")
	var cases []json.RawMessage
	if jsonKind(req["cases"]) != '[' || json.Unmarshal(req["cases"], &cases) != nil {
		fail("cases must be an array")
	}
	results := make([]map[string]interface{}, 0, len(cases))
	for _, c := range cases {
		results = append(results, runCase(c))
	}
	version, module := sdkVersion()
	resp := map[string]interface{}{
		"contract": mustStr(req, "contract", "the request"),
		"run_id":   runID,
		"nonce":    nonce,
		"implementation": map[string]interface{}{
			"name":          "dcp-ai Go SDK via tools/conformance/wrappers/go",
			"version":       version,
			"resolved_from": module,
			"runtime":       runtime.Version(),
		},
		"results": results,
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(resp); err != nil {
		fail("cannot encode the response: " + err.Error())
	}
	os.Stdout.Write(buf.Bytes())
}
