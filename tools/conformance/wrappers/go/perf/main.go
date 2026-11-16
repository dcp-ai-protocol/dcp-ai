// Performance child for the Go SDK (dcp-ai-perf/1, tools/conformance/perf.js), built from this checkout through the
// wrapper module's replace of ../../../../sdks/go. Timed per call: v2.VerifySignedBundleV2At(registry, bytes, policy,
// now), whose bytes API includes the parsing. The registry and the policy are set up once. A malformed request
// exits 2. Build: go build -mod=readonly -o <.build path> ./perf (tools/conformance-perf.js does it).
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

const contract = "dcp-ai-perf/1"

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
	Contract         string          `json:"contract"`
	RunID            string          `json:"run_id"`
	Nonce            string          `json:"nonce"`
	VerificationTime string          `json:"verification_time"`
	Policy           json.RawMessage `json:"policy"`
	Warmup           int             `json:"warmup"`
	Samples          int             `json:"samples"`
	Workloads        []workload      `json:"workloads"`
}

func refuse(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "perf child: "+format+"\n", args...)
	os.Exit(2)
}

func readRequest() (request, time.Time, v2.VerifierPolicy) {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		refuse("cannot read stdin: %v", err)
	}
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(raw, &shape); err != nil || len(shape) != 8 {
		refuse("the request must be exactly a %s request", contract)
	}
	var req request
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.Contract != contract || req.Warmup < 1 || req.Samples < 1 || len(req.Workloads) == 0 {
		refuse("the request has the wrong shape")
	}
	now, err := time.Parse(time.RFC3339, req.VerificationTime)
	if err != nil {
		refuse("verification_time is not an RFC 3339 instant")
	}
	var policy v2.VerifierPolicy
	if err := json.Unmarshal(req.Policy, &policy); err != nil || len(req.Policy) == 0 || req.Policy[0] != '{' {
		refuse("policy is not a verifier policy object")
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
	return req, now, policy
}

func problem(expect bool, r *v2.V2VerificationResult) string {
	switch {
	case r == nil:
		return "malformed_result"
	case r.Verified != expect:
		return "verdict"
	case r.Verified && len(r.Errors) > 0:
		return "contradiction"
	case !r.Verified && len(r.Errors) == 0:
		return "no_errors"
	}
	return ""
}

func main() {
	req, now, policy := readRequest()
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
				r := v2.VerifySignedBundleV2At(reg, w.bytes, policy, now)
				d := time.Since(t0)
				if why := problem(*w.Expect.Verified, r); why != "" {
					errs := []string{}
					if r != nil {
						errs = append(errs, r.Errors...)
					}
					failure = map[string]any{"id": w.ID, "phase": phase.name, "index": index, "verified": r != nil && r.Verified, "errors": errs, "reason": why}
					break measure
				}
				if _, ok := first[w.ID]; !ok {
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
	gogc := os.Getenv("GOGC")
	implementation := map[string]any{
		"sdk": "go", "entrypoint": "VerifySignedBundleV2At", "source": "checkout", "clock": "time.Since (monotonic)", "unit": "ns",
		"runtime": map[string]any{"go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0), "gogc": gogc},
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
