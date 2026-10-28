# Published Rust crate

Verified on 28/10/2026: [`dcp-ai` 2.11.1](https://crates.io/crates/dcp-ai/2.11.1) is available on crates.io. The previous release, [2.11.0](https://crates.io/crates/dcp-ai/2.11.0), was verified on 26/10/2026; its notes are kept below. The crate version is independent of the DCP wire/specification version. The Rust crate is published independently of npm, Python, Go and containers.

## Install

Run from your application crate using a current stable Rust toolchain. Commit the resulting `Cargo.toml` and `Cargo.lock`. These examples allow compatible 2.x updates; use `=2.11.1` in the manifest if an exact version is required.

```bash
cargo add dcp-ai@2.11.1
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.11.1"
```

Optional OTLP export and WebAssembly bindings are selected with `otlp` and `wasm`. Enable only the features your target needs. The separate npm WASM package is not republished by this Rust release.

## What changed in 2.11.1

It verifies the secondary SHA3-256 fields of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: `audit_merkle_root_secondary` (the SHA3-256 tree built like the primary one; `sha3-256:` followed by 64 zeros for an empty trail), each `prev_hash_secondary` (`"GENESIS"` on the first entry, then the SHA3-256 of the entry before it as carried) and each `intent_hash_secondary` (the SHA3-256 of the intent payload). Absent fields are not required, so a verified bundle may lack a complete secondary chain. A present field that is `null`, not a string or inconsistent is rejected: this is an acceptance change for evidence that carries such fields, which 2.11.0 accepted. APIs, result fields, `dcp-jcs-v1`, the experimental opt-in `dcp-jcs-v2` APIs and `hash_alg` handling are unchanged. Verification is still not principal trust, admission or authorization. Telemetry reports `2.11.1`.

## Upgrade and compatibility

2.11.0 (26/10/2026) included, and 2.11.1 keeps, corrected V2 principal/key/artifact/checkpoint verification, explicit principal trust and `strict-v1`, delegation chains, V2 bundle building/signing and experimental candidate APIs. The ten-field `V2VerificationResult` API remains compatible; signer details are available separately. In 2.11.0 telemetry reported `2.11.0`. See the [SDK README](../sdks/rust/README.md), [admission guide](ADMISSION.md) and [security policy](../SECURITY.md).

Verification is stricter than 2.10.0: malformed or inconsistent evidence previously accepted can be rejected. Preserve historical evidence rather than rewriting it. `dcp-jcs-v1` remains the normative default; `dcp-jcs-v2` is experimental, non-normative and explicitly opt-in. Verification does not grant principal trust, admission or authorization. Rust still lacks A2A AES-256-GCM session encryption and its replay window, and the V2 builder does not generate PQ checkpoints. In 2.11.0 the verifier checked the primary audit chain but not the optional secondary SHA3-256 fields; 2.11.1 checks them when present.

## Validation

For 2.11.1, the release workflow published the crate; every file of the registry crate matches the reviewed one except `.cargo_vcs_info.json`, which records the clean commit on `main`. An external consumer resolving 2.11.1 from crates.io passed 73 tests.

For 2.11.0 (26/10/2026), the default suite passed 261 tests and the all-features suite passed 267, including doctests. The WASM library and tests compiled for `wasm32-unknown-unknown`; this compilation is not a browser runtime test. Cargo packaged and verified 71 files, and publication dry-run passed. An external consumer passed 72 tests against the extracted crate, covering admission, compatibility, candidate ingress/router and verifier regressions; its inverted negative control failed as expected. After publication, a fresh registry cache resolved exactly 2.11.0 without a local path or patch, and the same 72 tests passed. The registry archive checksum and packaged source bytes matched the reviewed release. Shared fixtures for these tests come from the repository; applications do not need those fixtures.

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [npm packages](NPM_RELEASES.md), [Python 2.10.1](PYTHON_RELEASE.md) and [Go v2.11.1](GO_RELEASE.md).
