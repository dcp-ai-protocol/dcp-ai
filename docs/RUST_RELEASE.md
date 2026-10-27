# Published Rust crate

Verified on 26/10/2026: [`dcp-ai` 2.11.0](https://crates.io/crates/dcp-ai/2.11.0) is available on crates.io. The crate version is independent of the DCP wire/specification version. This publication updates Rust only; npm, Python, Go and containers are separate releases.

## Install

Run from your application crate using a current stable Rust toolchain. Commit the resulting `Cargo.toml` and `Cargo.lock`. These examples allow compatible 2.x updates; use `=2.11.0` in the manifest if an exact version is required.

```bash
cargo add dcp-ai@2.11.0
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.11.0"
```

Optional OTLP export and WebAssembly bindings are selected with `otlp` and `wasm`. Enable only the features your target needs. The separate npm WASM package is not republished by this Rust release.

## Upgrade and compatibility

This release includes corrected V2 principal/key/artifact/checkpoint verification, explicit principal trust and `strict-v1`, delegation chains, V2 bundle building/signing and experimental candidate APIs. The ten-field `V2VerificationResult` API remains compatible; signer details are available separately. Telemetry reports `2.11.0`. See the [SDK README](../sdks/rust/README.md), [admission guide](ADMISSION.md) and [security policy](../SECURITY.md).

Verification is stricter than 2.10.0: malformed or inconsistent evidence previously accepted can be rejected. Preserve historical evidence rather than rewriting it. `dcp-jcs-v1` remains the normative default; `dcp-jcs-v2` is experimental, non-normative and explicitly opt-in. Verification does not grant principal trust, admission or authorization. Rust still lacks A2A AES-256-GCM session encryption and its replay window, and the V2 builder does not generate PQ checkpoints. The verifier checks the primary audit chain but does not recompute the optional secondary SHA3-256 chain/root.

## Validation

The default suite passed 261 tests and the all-features suite passed 267, including doctests. The WASM library and tests compiled for `wasm32-unknown-unknown`; this compilation is not a browser runtime test. Cargo packaged and verified 71 files, and publication dry-run passed. An external consumer passed 72 tests against the extracted crate, covering admission, compatibility, candidate ingress/router and verifier regressions; its inverted negative control failed as expected. After publication, a fresh registry cache resolved exactly 2.11.0 without a local path or patch, and the same 72 tests passed. The registry archive checksum and packaged source bytes matched the reviewed release. Shared fixtures for these tests come from the repository; applications do not need those fixtures.
