// Mandate chain child for the Go SDK (contract dcp-ai-perf-mandate/1, tools/conformance/perf-scale.js), built from this
// checkout through the wrapper module's replace of ../../../../sdks/go. Timed per call: json.Unmarshal of the workload
// bytes, a {chain, keys} document (chain into []map[string]interface{}, keys into v2.MandateChainKeys, as the
// conformance wrapper does), then v2.VerifyMandateChain(registry, chain, no revoked mandate, keys, now). The registry
// is set up once. A malformed request exits 2. Build: go build -mod=readonly -o <.build path> ./perfmandate.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
	"runtime/debug"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

const contract = "dcp-ai-perf-mandate/1"

type workload struct {
	ID          string `json:"id"`
	InputB64    string `json:"input_b64"`
	InputSHA256 string `json:"input_sha256"`
	Expect      struct {
		Verified *bool `json:"verified"`
	} `json:"expect"`
	bytes []byte
}

type request struct {
	Contract         string     `json:"contract"`
	RunID            string     `json:"run_id"`
	Nonce            string     `json:"nonce"`
	VerificationTime string     `json:"verification_time"`
	Warmup           int        `json:"warmup"`
	Samples          int        `json:"samples"`
	Workloads        []workload `json:"workloads"`
}

type document struct {
	Chain []map[string]interface{} `json:"chain"`
	Keys  v2.MandateChainKeys      `json:"keys"`
}

func refuse(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "perf child: "+format+"\n", args...)
	os.Exit(2)
}

func readRequest() (request, time.Time) {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		refuse("cannot read stdin: %v", err)
	}
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(raw, &shape); err != nil || len(shape) != 7 {
		refuse("the request must be exactly a %s request", contract)
	}
	var req request
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.Contract != contract || req.Warmup < 1 || req.Samples < 1 || len(req.Workloads) == 0 {
		refuse("the request has the wrong shape")
	}
	now, err := time.Parse(time.RFC3339, req.VerificationTime)
	if err != nil || now.IsZero() {
		refuse("verification_time is not an RFC 3339 instant this API can take")
	}
	seen := map[string]bool{}
	for i := range req.Workloads {
		w := &req.Workloads[i]
		if w.ID == "" || seen[w.ID] || w.Expect.Verified == nil {
			refuse("a workload has the wrong shape")
		}
		seen[w.ID] = true
		data, err := base64.StdEncoding.Strict().DecodeString(w.InputB64)
		sum := sha256.Sum256(data)
		if err != nil || base64.StdEncoding.EncodeToString(data) != w.InputB64 || hex.EncodeToString(sum[:]) != w.InputSHA256 {
			refuse("workload %s: input_b64 does not match input_sha256", w.ID)
		}
		w.bytes = data
	}
	return req, now
}

// verify is the timed call: decoding of the workload bytes, then the SDK's chain verification. A document that does
// not decode is a malformed result, never a rejection.
func verify(reg *v2.AlgorithmRegistry, data []byte, now time.Time) (*v2.MandateChainResult, bool) {
	var doc document
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, false
	}
	r := v2.VerifyMandateChain(reg, doc.Chain, map[string]bool{}, doc.Keys, now)
	return &r, true
}

func problem(expect bool, r *v2.MandateChainResult, ok bool) string {
	switch {
	case !ok || r == nil:
		return "malformed_result"
	case r.Valid != expect:
		return "verdict"
	case r.Valid && len(r.Errors) > 0:
		return "contradiction"
	case !r.Valid && len(r.Errors) == 0:
		return "no_errors"
	}
	return ""
}

func main() {
	req, now := readRequest()
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})

	first := map[string][]string{}
	samples := map[string][]int64{}
	var failure map[string]any
measure:
	for _, phase := range []struct {
		name   string
		rounds int
	}{{"warmup", req.Warmup}, {"sample", req.Samples}} {
		for index := 0; index < phase.rounds; index++ {
			for _, w := range req.Workloads {
				t0 := time.Now()
				r, ok := verify(reg, w.bytes, now)
				d := time.Since(t0)
				if why := problem(*w.Expect.Verified, r, ok); why != "" {
					errs := []string{}
					if r != nil {
						errs = append(errs, r.Errors...)
					}
					failure = map[string]any{"id": w.ID, "phase": phase.name, "index": index, "verified": r != nil && r.Valid, "errors": errs, "reason": why}
					break measure
				}
				if _, seen := first[w.ID]; !seen {
					first[w.ID] = append([]string{}, r.Errors...)
				}
				if phase.name == "sample" {
					samples[w.ID] = append(samples[w.ID], d.Nanoseconds())
				}
			}
		}
	}

	deps := map[string]string{}
	if info, ok := debug.ReadBuildInfo(); ok {
		deps[info.Main.Path] = info.Main.Version
		for _, d := range info.Deps {
			v := d.Version
			if d.Replace != nil {
				v = d.Version + " => " + d.Replace.Path
			}
			deps[d.Path] = v
		}
	}
	implementation := map[string]any{
		"sdk": "go", "entrypoint": "VerifyMandateChain", "source": "checkout", "clock": "time.Since (monotonic)", "unit": "ns",
		"runtime": map[string]any{"go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0), "gogc": os.Getenv("GOGC")},
		"loaded":  map[string]any{"modules": deps},
	}
	out := map[string]any{"contract": contract, "run_id": req.RunID, "nonce": req.Nonce, "implementation": implementation}
	if failure != nil {
		out["status"] = "check_failed"
		out["failure"] = failure
	} else {
		results := make([]map[string]any, 0, len(req.Workloads))
		for _, w := range req.Workloads {
			results = append(results, map[string]any{"id": w.ID, "verified": *w.Expect.Verified, "errors_first": first[w.ID],
				"warmup_checked": req.Warmup, "checked": req.Samples, "samples_ns": samples[w.ID]})
		}
		out["status"] = "ok"
		out["results"] = results
	}
	b, err := json.Marshal(out)
	if err != nil {
		fmt.Fprintf(os.Stderr, "perf child: %v\n", err)
		os.Exit(1)
	}
	os.Stdout.Write(b)
}
