# Published Go module

Verified on 28/10/2026: Go SDK `v2.11.1` is published through the [`sdks/go/v2.11.1` tag](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.1/sdks/go), and the public module proxy and checksum database serve it. The previous release, `v2.11.0` ([`sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)), was verified on 26/10/2026; its notes are kept below. The module and its import paths retain `/v2`. The SDK version is independent of the DCP wire/specification version. Go requires no separate registry token: consumers resolve the repository tag through the Go module system.

## Install

Requires Go 1.25+. Run from your application module. Refresh and commit your application’s `go.mod` and `go.sum`:

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
go mod verify
```

## What changed in v2.11.1

It verifies the secondary SHA3-256 fields of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: `audit_merkle_root_secondary` (the SHA3-256 tree built like the primary one; `sha3-256:` followed by 64 zeros for an empty trail), each `prev_hash_secondary` (`"GENESIS"` on the first entry, then the SHA3-256 of the entry before it as carried) and each `intent_hash_secondary` (the SHA3-256 of the intent payload). Absent fields are not required, so a verified bundle may lack a complete secondary chain. A present field that is `null`, not a string or inconsistent is rejected: this is an acceptance change for evidence that carries such fields, which v2.11.0 accepted. APIs, result fields, `dcp-jcs-v1`, the experimental opt-in `dcp-jcs-v2` APIs and `hash_alg` handling are unchanged. Verification is still not principal trust, admission or authorization. SDK telemetry reports `2.11.1`.

## Upgrade and compatibility

v2.11.0 (26/10/2026) included, and v2.11.1 keeps, V1 invalid-key-length error handling, corrected V2 principal/key/artifact/checkpoint verification, explicit principal trust and `strict-v1`, delegation chains, and concurrent A2A sessions with replay protection. In v2.11.0 SDK telemetry reported `2.11.0`. See the [SDK README](../sdks/go/README.md), [admission guide](ADMISSION.md) and [security policy](../SECURITY.md).

Verification is stricter than v2.10.0: malformed or inconsistent evidence previously accepted can be rejected. Preserve historical evidence instead of rewriting it. `dcp-jcs-v1` remains the normative default; `dcp-jcs-v2` APIs remain experimental, non-normative and explicitly opt-in. Verification is not principal trust, admission or authorization. In v2.11.0 the optional secondary SHA3-256 fields were outside the verifier’s checks; v2.11.1 checks them when present.

## Validation

For v2.11.1, the 84 files of the module zip served by the proxy are identical to `main` (Go adds the repository’s root `LICENSE` to the zip), and the proxy and checksum database confirmed the version. An external consumer resolving `v2.11.1` from the proxy, without a local `replace`, passed 189 tests.

For v2.11.0 (26/10/2026), the default suite and the `-race -tags otlp` suite each passed 1,154 tests/subtests; one test is intentionally reserved for the separate live producer/consumer matrix. `go mod tidy -diff`, build and vet passed. An external consumer passed 137 tests/subtests; its deliberately inverted runner control failed as expected. The published module was downloaded into a fresh cache through the public proxy with checksum verification; its source bytes matched the reviewed commit. The external consumer then passed without any local `replace` directive. For the separate Rust publication, see [Rust](RUST_RELEASE.md).

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [npm packages](NPM_RELEASES.md), [Python 2.10.1](PYTHON_RELEASE.md) and [Rust 2.11.1](RUST_RELEASE.md).
