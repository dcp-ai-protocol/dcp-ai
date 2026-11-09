# Published Go module

Verified on 09/11/2026: Go SDK `v2.14.0` is published through the [`sdks/go/v2.14.0` tag](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.14.0/sdks/go), and the public module proxy and checksum database serve it ([what changed](#what-changed-in-v2140)). The previous releases, `v2.13.0` ([`sdks/go/v2.13.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.13.0/sdks/go)), verified on 05/11/2026, `v2.11.1` ([`sdks/go/v2.11.1`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.1/sdks/go)), verified on 28/10/2026, and `v2.11.0` ([`sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)), verified on 26/10/2026, keep their notes below. The module and its import paths retain `/v2`. The SDK version is independent of the DCP wire/specification version. Go requires no separate registry token: consumers resolve the repository tag through the Go module system.

## Install

Requires Go 1.25+. Run from your application module. Refresh and commit your application’s `go.mod` and `go.sum`:

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.14.0
go mod verify
```

## What changed in v2.11.1

It verifies the secondary SHA3-256 fields of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: `audit_merkle_root_secondary` (the SHA3-256 tree built like the primary one; `sha3-256:` followed by 64 zeros for an empty trail), each `prev_hash_secondary` (`"GENESIS"` on the first entry, then the SHA3-256 of the entry before it as carried) and each `intent_hash_secondary` (the SHA3-256 of the intent payload). Absent fields are not required, so a verified bundle may lack a complete secondary chain. A present field that is `null`, not a string or inconsistent is rejected: this is an acceptance change for evidence that carries such fields, which v2.11.0 accepted. APIs, result fields, `dcp-jcs-v1`, the experimental opt-in `dcp-jcs-v2` APIs and `hash_alg` handling are unchanged. Verification is still not principal trust, admission or authorization. SDK telemetry reports `2.11.1`.

## Upgrade and compatibility

v2.11.0 (26/10/2026) included, and v2.11.1 keeps, V1 invalid-key-length error handling, corrected V2 principal/key/artifact/checkpoint verification, explicit principal trust and `strict-v1`, delegation chains, and concurrent A2A sessions with replay protection. In v2.11.0 SDK telemetry reported `2.11.0`. See the [SDK README](../sdks/go/README.md), [admission guide](ADMISSION.md) and [security policy](../SECURITY.md).

Verification is stricter than v2.10.0: malformed or inconsistent evidence previously accepted can be rejected. Preserve historical evidence instead of rewriting it. `dcp-jcs-v1` remains the normative default; `dcp-jcs-v2` APIs remain experimental, non-normative and explicitly opt-in. Verification is not principal trust, admission or authorization. In v2.11.0 the optional secondary SHA3-256 fields were outside the verifier’s checks; v2.11.1 checks them when present.

## Validation

For v2.13.0, the module that the public proxy serves for the `sdks/go/v2.13.0` tag (commit `46b142bd`) contains the same 92 files as the module tested before publication, and the checksum database records the tested module's hash, `h1:bRkqSUWHQ/qTywPmKWRdzg2bBWI0RG1ZZAlb6IafnyU=`. Consumers resolving v2.13.0 through `proxy.golang.org`, with the checksum database on and without a local `replace`, passed the external conformance kit (697 cases in seven catalogs), the checks of the APIs that change in v2.13.0 and the default-profile check.

For v2.11.1, the 84 files of the module zip served by the proxy are identical to `main` (Go adds the repository’s root `LICENSE` to the zip), and the proxy and checksum database confirmed the version. An external consumer resolving `v2.11.1` from the proxy, without a local `replace`, passed 189 tests.

For v2.11.0 (26/10/2026), the default suite and the `-race -tags otlp` suite each passed 1,154 tests/subtests; one test is intentionally reserved for the separate live producer/consumer matrix. `go mod tidy -diff`, build and vet passed. An external consumer passed 137 tests/subtests; its deliberately inverted runner control failed as expected. The published module was downloaded into a fresh cache through the public proxy with checksum verification; its source bytes matched the reviewed commit. The external consumer then passed without any local `replace` directive. For the separate Rust publication, see [Rust](RUST_RELEASE.md).

## What changed in v2.13.0

v2.13.0 was published on 05/11/2026 through the `sdks/go/v2.13.0` tag on `main` (`46b142bd`). It supersedes v2.12.0 below, which was never tagged. Compared with v2.11.1, v2.13.0:

- **Runs V2-2 schema validation (acceptance change).** `v2.VerifySignedBundleV2` and its variants validate the signed bundle envelope and the four payloads against `schemas/v2` before any hash, key or signature check. Schema-invalid bundles accepted before now fail with `schema: <pointer> <keyword>` diagnostics.
- **Corrects `v2.VerifyPayloadHash` (acceptance change)**, as in v2.12.0 below: `true` only for `"sha256:"` followed by the SHA-256 of the canonical payload, as `SignPayload` writes it; a bare digest is `false`.
- **Adds `v2.RawAuditEventV2`**, as in v2.12.0 below.
- **Aligns the mandate checks.** `v2.VerifyMandateValidity` applies one contract and `v2.VerifyMandateValidityAt` (new) takes the verification time; a missing or malformed date, accepted before, is invalid. `v2.VerifyMandateChain` reads every time the same way and rejects a root mandate that repeats a domain.

`SDKVersion` is `2.13.0`. The wire format, the signatures, the profiles, `dcp-jcs-v1` as the normative default and the experimental opt-in `dcp-jcs-v2` APIs are unchanged. Preserve historical evidence instead of rewriting it: a bundle that the new checks reject stays as it was received. The SDK README in the published module is the one prepared before publication: it reads "prepared, not published", and its `v2.VerifyPayloadHash` row and `v2.RawAuditEventV2` paragraph still read "prepared for v2.12.0". A published module cannot change; the README in the repository describes v2.13.0. See the [SDK README](../sdks/go/README.md) and the [changelog](../CHANGELOG.md#unreleased).

## Prepared, not published: v2.12.0

v2.12.0 is prepared in the repository on 30/10/2026 but not published: the `sdks/go/v2.12.0` tag does not exist, so the module proxy does not serve this version and `go get` cannot resolve it. At preparation time the install command stayed on v2.11.1; the current version is in [Published versions](README.md#published-versions). Compared with v2.11.1, v2.12.0:

- **Corrects `v2.VerifyPayloadHash` (acceptance change).** It returns `true` only when `payload_hash` is exactly `"sha256:"` followed by the lowercase hex SHA-256 of the `dcp-jcs-v1` canonical payload. The output of `v2.SignPayload` is now accepted and a bare digest is now rejected; v2.11.1 did the opposite. The function checks hash consistency only, not the signature, the keys, the policy, principal trust or admission. Bundle verification never used it and does not change.
- **Adds `v2.RawAuditEventV2`.** It keeps a received audit entry’s literal bytes, so explicit `null` and unknown members survive forwarding; `Typed()` is a lossy view. `AuditEventV2` and the other typed structs remain producer types and keep their behavior.

The other APIs, bundle verification, `dcp-jcs-v1` and the experimental opt-in `dcp-jcs-v2` APIs are unchanged; new tests of the experimental candidate change no default. SDK telemetry reports `2.12.0`. The module no longer contains the translated READMEs, which are now in the repository’s `i18n/` tree. See the [SDK README](../sdks/go/README.md) and the [changelog](../CHANGELOG.md).

> **Note (05/11/2026).** The comparison above was written on 30/10/2026 for the prepared v2.12.0, which is still not published. `main` has changed verification since then: every V2 verifier runs V2-2 schema validation (#116, 02/11/2026), and the mandate validity helper, the chain time checks and the check of repeated root domains changed (#117 to #119). These changes are not in the v2.12.0 described above, which was never tagged; v2.13.0 above contains them and supersedes it, and the manifests on `main` carry v2.13.0. See the [audit dossier](conformance/AUDIT_DOSSIER.md#artifacts).

## What changed in v2.14.0

v2.14.0 was published on 09/11/2026 through the `sdks/go/v2.14.0` tag on `main` (`cdb7099b`). The module the proxy serves has the same 106 files and the same hash, `h1:9O4n7vn3YqOhKlyUg/cm0OnouQi4QbU7mHbIh1BM5Z8=`, as the module tested before publication; only the zip compression differs. Consumers resolving v2.14.0 through `proxy.golang.org`, with the checksum database on, without a local `replace` and with Go 1.26.10, installed that module and gave the same API results as the tested one. Compared with v2.13.0:

- **Added (opt-in).** `v2.AdmitDelegatedBundleV2`, `v2.AdmitSignedBundleV2FromBytes`, `v2.CreateMandateAcknowledgment` and `v2.EvaluateDelegationActivationV2` ([changelog](../CHANGELOG.md#unreleased)).
- **Acceptance change.** P-ED-1 in V1 object verification and the default V2 Ed25519 provider.
- **Fix.** The SLH-DSA-192f provider reads keys without a panic. `SDKVersion` is `2.14.0`.

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [npm packages](NPM_RELEASES.md), [Python 2.11.0](PYTHON_RELEASE.md) and [Rust 2.14.0](RUST_RELEASE.md).
