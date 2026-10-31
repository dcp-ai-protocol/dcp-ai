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
// Usage: go-shim --batch   (the driver's protocol, dcp-difffuzz/3; see README.md)
//
//	stdin: one request {protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}; stdout: one response
//	with exactly one result per case: verdict {verified, errors[, truncated]} (nil errors are written as []),
//	parse_rejected {message}, error {message} (the SDK panicked) or unsupported. Each case is verified under its own
//	explicit policy with VerifySignedBundleV2At at now_ms. A malformed request exits 2. In a verdict, errors is the
//	SDK's list bounded by bounded() below.
//
// Usage: go-shim --bound-selftest   stdin {lists: [[string]]}, stdout {bounded: [bounded(list)]}; no SDK call.
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
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

const errorsMax, errorCodePointsMax = 8, 256

// bounded is protocol /3: at most errorsMax errors of at most errorCodePointsMax code points (as range counts them:
// an invalid UTF-8 byte is one), each a literal prefix, and a marker whenever anything was cut. The sha256 takes each
// original as its UTF-8 length (4 bytes, big-endian) then its bytes, each invalid byte as U+FFFD.
func bounded(errs []string) ([]string, map[string]interface{}) {
	over := len(errs) > errorsMax
	total := 0
	for _, e := range errs {
		n := utf8.RuneCountInString(e)
		total += n
		over = over || n > errorCodePointsMax
	}
	if !over {
		return errs, nil
	}
	h := sha256.New()
	var n [4]byte
	for _, e := range errs {
		b := wellFormed(e)
		binary.BigEndian.PutUint32(n[:], uint32(len(b)))
		h.Write(n[:])
		h.Write(b)
	}
	kept := make([]string, 0, errorsMax)
	for _, e := range errs {
		if len(kept) == errorsMax {
			break
		}
		kept = append(kept, prefix(e, errorCodePointsMax))
	}
	return kept, map[string]interface{}{"original_count": len(errs), "kept": len(kept), "original_code_points": total, "sha256": hex.EncodeToString(h.Sum(nil))}
}

// prefix keeps the first `keep` code points of s, counted as range counts them.
func prefix(s string, keep int) string {
	n := 0
	for i := range s {
		if n == keep {
			return s[:i]
		}
		n++
	}
	return s
}

// wellFormed is s in UTF-8 with each invalid byte replaced by U+FFFD, as encoding/json writes it.
func wellFormed(s string) []byte {
	if utf8.ValidString(s) {
		return []byte(s)
	}
	b := make([]byte, 0, len(s)+8)
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b = append(b, "\uFFFD"...)
		} else {
			b = append(b, s[i:i+size]...)
		}
		i += size
	}
	return b
}

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
		json.Unmarshal(req["protocol"], &protocol) != nil || protocol != "dcp-difffuzz/3" ||
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
	errs, truncated := bounded(errs)
	res = map[string]interface{}{"id": id, "status": "verdict", "verified": r.Verified, "errors": errs}
	if truncated != nil {
		res["truncated"] = truncated
	}
	return res
}

func main() {
	loop, mode, isBatch, boundSelftest := false, "", false, false
	for _, a := range os.Args[1:] {
		if a == "--batch" {
			isBatch = true
		} else if a == "--bound-selftest" {
			boundSelftest = true
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
	if boundSelftest {
		var in struct{ Lists [][]string }
		data, err := io.ReadAll(os.Stdin)
		if err != nil || json.Unmarshal(data, &in) != nil {
			badRequest("bound selftest input")
		}
		out := make([]map[string]interface{}, 0, len(in.Lists))
		for _, l := range in.Lists {
			if l == nil {
				l = []string{}
			}
			kept, truncated := bounded(l)
			o := map[string]interface{}{"errors": kept}
			if truncated != nil {
				o["truncated"] = truncated
			}
			out = append(out, o)
		}
		b, _ := json.Marshal(map[string]interface{}{"bounded": out})
		fmt.Println(string(b))
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
