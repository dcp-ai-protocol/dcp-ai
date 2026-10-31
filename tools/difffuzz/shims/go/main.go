// Go SDK shim for the differential fuzzer.
//
// Usage: go run . [mode] [--loop]
//
//	stdin: one signed bundle (JSON document); with --loop, one compact JSON
//	       document per line.
//	stdout: one line per document: {"valid": bool, "errors": [string]}
//	mode: empty for DefaultVerifierPolicy, or a verification mode applied to
//	      DefaultMode and to every risk tier (as the interop tests do).
//
// Exit code 0 for a verdict; anything else (a panic) is a crash of the verifier.
//
// Usage: go-shim --batch   (the driver's protocol, dcp-difffuzz/2; see README.md)
//
//	stdin: one request {protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}; stdout: one response
//	with exactly one result per case: verdict {verified, errors} (nil errors are written as []), parse_rejected
//	{message}, error {message} (the SDK panicked) or unsupported. Each case is verified under its own explicit
//	policy with VerifySignedBundleV2At at now_ms. A malformed request exits 2.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func badRequest(why string) {
	fmt.Fprintln(os.Stderr, "invalid request: "+why)
	os.Exit(2)
}

func hasExactKeys(m map[string]json.RawMessage, keys ...string) bool {
	if len(m) != len(keys) {
		return false
	}
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			return false
		}
	}
	return true
}

func batch(reg *v2.AlgorithmRegistry) {
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		badRequest(err.Error())
	}
	var req map[string]json.RawMessage
	var protocol, runID, nonce string
	var nowMs int64
	var cases []map[string]json.RawMessage
	if json.Unmarshal(data, &req) != nil || !hasExactKeys(req, "protocol", "run_id", "nonce", "now_ms", "cases") ||
		json.Unmarshal(req["protocol"], &protocol) != nil || protocol != "dcp-difffuzz/2" ||
		json.Unmarshal(req["run_id"], &runID) != nil || json.Unmarshal(req["nonce"], &nonce) != nil ||
		json.Unmarshal(req["now_ms"], &nowMs) != nil || json.Unmarshal(req["cases"], &cases) != nil {
		badRequest("envelope")
	}
	now := time.UnixMilli(nowMs).UTC()
	results := make([]map[string]interface{}, 0, len(cases))
	for _, c := range cases {
		var id, b64 string
		var policy v2.VerifierPolicy
		if !hasExactKeys(c, "id", "policy", "bundle_b64") || json.Unmarshal(c["id"], &id) != nil ||
			json.Unmarshal(c["bundle_b64"], &b64) != nil || len(c["policy"]) == 0 || c["policy"][0] != '{' ||
			json.Unmarshal(c["policy"], &policy) != nil {
			badRequest("case fields")
		}
		bundle, err := base64.StdEncoding.DecodeString(b64)
		if err != nil || base64.StdEncoding.EncodeToString(bundle) != b64 {
			badRequest("case " + id + ": bundle_b64 is not canonical base64")
		}
		if !utf8.Valid(bundle) || !json.Valid(bundle) {
			results = append(results, map[string]interface{}{"id": id, "status": "parse_rejected", "message": "not UTF-8 JSON (utf8.Valid, json.Valid)"})
			continue
		}
		results = append(results, verifyOne(reg, id, bundle, policy, now))
	}
	out, err := json.Marshal(map[string]interface{}{"protocol": protocol, "run_id": runID, "nonce": nonce, "results": results})
	if err != nil {
		panic(err)
	}
	fmt.Println(string(out))
}

// verifyOne turns a panic of the SDK into an error result, never a verdict.
func verifyOne(reg *v2.AlgorithmRegistry, id string, bundle []byte, policy v2.VerifierPolicy, now time.Time) (res map[string]interface{}) {
	defer func() {
		if p := recover(); p != nil {
			msg := fmt.Sprint(p)
			if len(msg) > 500 {
				msg = msg[:500]
			}
			res = map[string]interface{}{"id": id, "status": "error", "message": "panic: " + msg}
		}
	}()
	r := v2.VerifySignedBundleV2At(reg, bundle, policy, now)
	errs := r.Errors
	if errs == nil {
		errs = []string{}
	}
	return map[string]interface{}{"id": id, "status": "verdict", "verified": r.Verified, "errors": errs}
}

func main() {
	loop, mode, isBatch := false, "", false
	for _, a := range os.Args[1:] {
		if a == "--batch" {
			isBatch = true
		} else if a == "--loop" {
			loop = true
		} else if !strings.HasPrefix(a, "--") && mode == "" {
			mode = a
		}
	}
	policy := v2.DefaultVerifierPolicy()
	if mode != "" {
		policy.DefaultMode = mode
		policy.RiskOverrides = map[string]string{"low": mode, "medium": mode, "high": mode}
	}
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	if isBatch {
		batch(reg)
		return
	}

	verdict := func(doc []byte) {
		r := v2.VerifySignedBundleV2WithPolicy(reg, doc, policy)
		out, _ := json.Marshal(map[string]interface{}{"valid": r.Verified, "errors": r.Errors})
		fmt.Println(string(out))
	}

	if !loop {
		doc, err := io.ReadAll(os.Stdin)
		if err != nil {
			panic(err)
		}
		verdict(doc)
		return
	}
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 1<<20), 64<<20)
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) == "" {
			continue
		}
		verdict(sc.Bytes())
	}
	if err := sc.Err(); err != nil {
		panic(err)
	}
}
