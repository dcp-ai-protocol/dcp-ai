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
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func main() {
	loop, mode := false, ""
	for _, a := range os.Args[1:] {
		if a == "--loop" {
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
