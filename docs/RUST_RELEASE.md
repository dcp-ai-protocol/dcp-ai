# Published Rust crate

Verified on 05/11/2026: [`dcp-ai` 2.13.0](https://crates.io/crates/dcp-ai/2.13.0) is available on crates.io ([what changed](#what-changed-in-2130)). The previous releases, [2.11.1](https://crates.io/crates/dcp-ai/2.11.1), verified on 28/10/2026, and [2.11.0](https://crates.io/crates/dcp-ai/2.11.0), verified on 26/10/2026, keep their notes below. The crate version is independent of the DCP wire/specification version. The Rust crate is published independently of npm, Python, Go and containers.

## Install

Run from your application crate using a current stable Rust toolchain. Commit the resulting `Cargo.toml` and `Cargo.lock`. These examples allow compatible 2.x updates; use `=2.13.0` in the manifest if an exact version is required.

```bash
cargo add dcp-ai@2.13.0
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.13.0"
```

Optional OTLP export and WebAssembly bindings are selected with `otlp` and `wasm`. Enable only the features your target needs. The separate npm WASM package is not republished by this Rust release.

## What changed in 2.11.1

It verifies the secondary SHA3-256 fields of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: `audit_merkle_root_secondary` (the SHA3-256 tree built like the primary one; `sha3-256:` followed by 64 zeros for an empty trail), each `prev_hash_secondary` (`"GENESIS"` on the first entry, then the SHA3-256 of the entry before it as carried) and each `intent_hash_secondary` (the SHA3-256 of the intent payload). Absent fields are not required, so a verified bundle may lack a complete secondary chain. A present field that is `null`, not a string or inconsistent is rejected: this is an acceptance change for evidence that carries such fields, which 2.11.0 accepted. APIs, result fields, `dcp-jcs-v1`, the experimental opt-in `dcp-jcs-v2` APIs and `hash_alg` handling are unchanged. Verification is still not principal trust, admission or authorization. Telemetry reports `2.11.1`.

## Upgrade and compatibility

2.11.0 (26/10/2026) included, and 2.11.1 keeps, corrected V2 principal/key/artifact/checkpoint verification, explicit principal trust and `strict-v1`, delegation chains, V2 bundle building/signing and experimental candidate APIs. The ten-field `V2VerificationResult` API remains compatible; signer details are available separately. In 2.11.0 telemetry reported `2.11.0`. See the [SDK README](../sdks/rust/README.md), [admission guide](ADMISSION.md) and [security policy](../SECURITY.md).

Verification is stricter than 2.10.0: malformed or inconsistent evidence previously accepted can be rejected. Preserve historical evidence rather than rewriting it. `dcp-jcs-v1` remains the normative default; `dcp-jcs-v2` is experimental, non-normative and explicitly opt-in. Verification does not grant principal trust, admission or authorization. Rust still lacks A2A AES-256-GCM session encryption and its replay window, and the V2 builder does not generate PQ checkpoints. In 2.11.0 the verifier checked the primary audit chain but not the optional secondary SHA3-256 fields; 2.11.1 checks them when present.

## Validation

For 2.13.0, the release workflow published the crate from `main` (`46b142bd`). Every file of the registry crate matches the artifact tested before publication except `.cargo_vcs_info.json`, which records that commit instead of the build commit of the candidate. A consumer resolving 2.13.0 from crates.io, in a fresh Cargo home and without a path dependency or patch, passed the external conformance kit (697 cases in seven catalogs) and the default-profile check: the golden `dcp-jcs-v1` bundle verifies, and the same bundle declaring `dcp-jcs-v2` is rejected.

For 2.11.1, the release workflow published the crate; every file of the registry crate matches the reviewed one except `.cargo_vcs_info.json`, which records the clean commit on `main`. An external consumer resolving 2.11.1 from crates.io passed 73 tests.

For 2.11.0 (26/10/2026), the default suite passed 261 tests and the all-features suite passed 267, including doctests. The WASM library and tests compiled for `wasm32-unknown-unknown`; this compilation is not a browser runtime test. Cargo packaged and verified 71 files, and publication dry-run passed. An external consumer passed 72 tests against the extracted crate, covering admission, compatibility, candidate ingress/router and verifier regressions; its inverted negative control failed as expected. After publication, a fresh registry cache resolved exactly 2.11.0 without a local path or patch, and the same 72 tests passed. The registry archive checksum and packaged source bytes matched the reviewed release. Shared fixtures for these tests come from the repository; applications do not need those fixtures.

## What changed in 2.13.0

2.13.0 was published on crates.io on 05/11/2026 by the release workflow, from `main` (`46b142bd`). It supersedes 2.12.0 below, which was never published. Compared with 2.11.1, 2.13.0:

- **Runs V2-2 schema validation (acceptance change).** `verify_signed_bundle_v2`, `…_with_policy` and `…_at`, the WASM build included, validate the signed bundle envelope and the four payloads against `schemas/v2` before any hash, key or signature check. Schema-invalid bundles accepted before now fail with `schema: <pointer> <keyword>` diagnostics.
- **Adds `RawAuditEventV2` and `RawAuditEventError`**, as in 2.12.0 below.
- **Corrects `wasm_dual_merkle_root`** (with the `wasm` feature), as in 2.12.0 below. Roots computed with the old helper stay as recorded; see [Migrating `dualMerkleRoot` results](NPM_RELEASES.md#migrating-dualmerkleroot-results).
- **Aligns the mandate checks.** `verify_mandate_validity` compares the window as instants, no longer as text, and `verify_mandate_validity_at` (new) takes the verification time. `verify_mandate_chain` rejects a root mandate that repeats a domain.

Telemetry reports `2.13.0`. The wire format, the signatures, the profiles, `dcp-jcs-v1` as the normative default and the experimental opt-in `dcp-jcs-v2` APIs are unchanged, and the crate now includes the Apache-2.0 `LICENSE`. The npm package built from this Rust source is `@dcp-ai/wasm` 2.1.3, also published on 05/11/2026 (see [npm packages](NPM_RELEASES.md)). The README inside the published crate is the one prepared before publication and reads "prepared, not published"; a published crate cannot change. See the [SDK README](../sdks/rust/README.md) and the [changelog](../CHANGELOG.md#unreleased).

## Prepared, not published: 2.12.0

2.12.0 is prepared in the repository on 30/10/2026 but not published on crates.io. At preparation time the install commands stayed on 2.11.1; the current ones, above, name 2.13.0. Compared with 2.11.1, 2.12.0:

- **Adds `dcp_ai::v2::types::RawAuditEventV2` and `RawAuditEventError`.** `RawAuditEventV2` holds a received audit entry as the decoded `serde_json::Value`, so every member keeps its presence and `null`-ness, unknown members included. It keeps the decoded value, not the original text: serializing it or canonicalizing it with `dcp-jcs-v1` gives the bytes of that value. `typed()` is a lossy view; `AuditEventV2` keeps its behavior. Whole-bundle parsing, verification and canonicalization are unchanged.
- **Corrects `wasm_dual_merkle_root` (with the `wasm` feature).** It now computes the dual Merkle root with the reduction of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) that the bundle verifier uses (raw 32-byte digests, the last node duplicated on an odd layer), and it returns an error for a leaf that is not a 32-byte hex digest instead of accepting malformed input. The npm package built from this crate is `@dcp-ai/wasm` 2.1.2, also prepared and not published (see [npm packages](NPM_RELEASES.md)).

The other APIs, `dcp-jcs-v1` and the experimental opt-in `dcp-jcs-v2` APIs are unchanged; new tests of the experimental candidate change no default. Telemetry reports `2.12.0`. The crate no longer contains the translated READMEs, which are now in the repository's `i18n/` tree. See the [SDK README](../sdks/rust/README.md) and the [changelog](../CHANGELOG.md).

> **Note (05/11/2026).** The comparison above was written on 30/10/2026 for the prepared 2.12.0, which is still not published. `main` has changed verification since then: every V2 verifier, the WASM build included, runs V2-2 schema validation (#116, 02/11/2026), and the mandate validity helper, the chain time checks and the check of repeated root domains changed (#117 to #119). These changes are not in the 2.12.0 described above, which was never published; 2.13.0 above contains them and supersedes it, and the manifests on `main` carry 2.13.0. See the [audit dossier](conformance/AUDIT_DOSSIER.md#artifacts).

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [npm packages](NPM_RELEASES.md), [Python 2.10.2](PYTHON_RELEASE.md) and [Go v2.13.0](GO_RELEASE.md).
