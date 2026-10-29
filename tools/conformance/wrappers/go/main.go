// External conformance wrapper for the Go SDK (contract dcp-ai-conformance-external/1,
// tools/conformance/README.md). Reads one request on stdin and writes one response on stdout.
//
// canonicalize: the input bytes must be UTF-8 (checked first, because encoding/json would replace
// invalid bytes), then json.Unmarshal into interface{} as the SDK's own interop test does (a failure is
// rejected/parse), then ONE call to v2.CanonicalizeV2. Only its documented rejection ("non-integer float
// at" / "non-finite float at", a plain error with no stable type or code) is rejected/profile; any other
// error is an error. digest: v2.SHA256Hex / v2.SHA3256Hex of the decoded bytes.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"runtime"
	"runtime/debug"
	"sort"
	"unicode/utf8"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

const contract = "dcp-ai-conformance-external/1"

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
	if mustStr(req, "contract", "the request") != contract {
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
		"contract": contract,
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
