# Published Go module

Verified on 26/10/2026: Go SDK `v2.11.0` is published through the [`sdks/go/v2.11.0` tag](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go). The module and its import paths retain `/v2`. The SDK version is independent of the DCP wire/specification version. Go requires no separate registry token: consumers resolve the repository tag through the Go module system.

## Install

Requires Go 1.25+. Run from your application module. Refresh and commit your application’s `go.mod` and `go.sum`:

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
go mod verify
```

## Upgrade and compatibility

This release includes V1 invalid-key-length error handling, corrected V2 principal/key/artifact/checkpoint verification, explicit principal trust and `strict-v1`, delegation chains, and concurrent A2A sessions with replay protection. SDK telemetry reports `2.11.0`. See the [SDK README](../sdks/go/README.md), [admission guide](ADMISSION.md) and [security policy](../SECURITY.md).

Verification is stricter than v2.10.0: malformed or inconsistent evidence previously accepted can be rejected. Preserve historical evidence instead of rewriting it. `dcp-jcs-v1` remains the normative default; `dcp-jcs-v2` APIs remain experimental, non-normative and explicitly opt-in. Verification is not principal trust, admission or authorization. The optional secondary SHA3-256 audit chain is still outside the verifier’s documented checks.

## Validation

The default suite and the `-race -tags otlp` suite each passed 1,154 tests/subtests; one test is intentionally reserved for the separate live producer/consumer matrix. `go mod tidy -diff`, build and vet passed. An external consumer passed 137 tests/subtests; its deliberately inverted runner control failed as expected. The published module was downloaded into a fresh cache through the public proxy with checksum verification; its source bytes matched the reviewed commit. The external consumer then passed without any local `replace` directive. Rust publication remains pending separately; this Go release does not republish npm, Python or containers.
