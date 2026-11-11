<sub>**English** · [中文](../../i18n/zh-CN/docs/conformance/AUDIT_DOSSIER.md) · [Español](../../i18n/es/docs/conformance/AUDIT_DOSSIER.md) · [日本語](../../i18n/ja/docs/conformance/AUDIT_DOSSIER.md) · [Português](../../i18n/pt-BR/docs/conformance/AUDIT_DOSSIER.md)</sub>

# Audit dossier

This is the entry point for an independent security review of DCP-AI. It says what to review, how to reproduce the repository's evidence, what that evidence shows and what it leaves out. It is not a specification, a certification or an audit report. The repository contains no report of an independent external audit, and it does not certify work done outside it.

- The normative documents are in [spec/](../../spec/README.md).
- The [security coverage map](SECURITY_COVERAGE.md) maps each requirement to its tests.
- The [implementer guide](IMPLEMENTER_GUIDE.md) explains how to report results.

## Review baseline

- **Source baseline:** commit `45ac32f07f004e858e11dcc23ff72c3e5c7762b8` on `main`, of 05/11/2026 (#123). It contains every fix listed under [Artifacts](#artifacts) and the clarifications of that date to [VERIFICATION.md](../../spec/VERIFICATION.md) Step V2-10 and [DCP-09](../../spec/DCP-09.md) §3.5.2.
- **Later commits:** the mandate chain differential harness and the five-SDK bundle comparison (#124) came after the baseline, and so did this dossier. A document cannot name its own final commit. Record the exact commit you review and use this file as a guide to it, not as evidence about it.
- **Outside the baseline:** container images, deployments and operator configuration.

## Pilot validation freeze (MP-06)

This later snapshot is separate from the review baseline above. **Source:** `7dd8293d6f6c3d328fc0ff3906978200e55139db` (PR #138); tree `de40444aa1fc1bafef6ab7cf3b772664427b43dc`. It is an internal validation for bounded pilots, not an external audit, a deployment or a new registry release. `dcp-jcs-v1` and existing defaults are unchanged.

The scope covers hybrid evidence verification, explicit principal trust, strict admission, opt-in delegated admission and the separate mandate acknowledgment in TypeScript, Python, Go and Rust. WASM covers verification and primitives through its installed browser API; it does **not** support mandate chains, admission or activation. Express and FastAPI are optional adapters. Action authorization, tenant configuration, revocation freshness, TLS and key custody remain application/operator responsibilities. The [operational limits](../OPERATIONAL_LIMITS.md) and [optional rehearsal](../../tools/enterprise-rehearsal/README.md) describe that boundary.

### Evidence and artifact identity

The [CI of the frozen revision](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42539293814) passed its selected jobs. SDK/integration jobs skipped by path filters are covered by the successful MP-03 revision `df2df0de103777bb9e28cf70cc64d52f8df7d4b4`, with identical production subtrees and relevant build/test inputs. These are reused runs, not new executions. Locally installed artifacts were tested separately, including the Python sdist and the WASM tarball in a browser. The eight public catalogs passed for each full SDK; WASM passed only the six catalogs it supports. Focused composition, acknowledgment and byte-ingress controls, the original F1–F4 and principal-trust regressions, and provider evidence remain linked to their actual tested objects. The unchanged MP-05 HTTP rehearsal (200/200 steps) is reused.

The artifacts below are **local, unpublished bytes**, even though their embedded version numbers match existing releases. The TS, Express and Python artifacts originated at `b3d41bd0`; all 256 source files recorded by their preparation manifest match the frozen revision. Go, Rust and WASM were built from the frozen export. Do not substitute registry packages by matching the version number.

| Artifact | Local version | SHA-256 |
|---|---|---|
| `Go module zip` | `v2.13.0` | `a2e113c663b791c3b0908e135f2a1e2433ffea1301b1be2540a2fa3539c6ca41` |
| `Rust .crate` | `2.13.0` | `192d58c182e9c115b5fa7e6af17dd790eaa37a68a4501e4985dc11ae5b157d39` |
| `@dcp-ai/wasm tarball` | `2.1.3` | `501d24d7ae9a2923931edf4e9e8df902f353a87ff911906901f34b33d1ac052d` |
| `@dcp-ai/sdk tarball` | `2.3.0` | `1e4b27bb82c70ab327227f5bb029eb2b01b0cdc643aeec206327bdaf5a94dd9c` |
| `@dcp-ai/express tarball` | `2.1.0` | `bf2b6de539b9e3687ffd272c7015d9ff0a6288fdd65f86ce7662838b50ead969` |
| `Python wheel` | `2.10.2` | `e20473aecf6f75ff6e01db4a9ce12bd33ef59000607b9cba47f197b4b2e8d317` |
| `Python sdist` | `2.10.2` | `ad0e17c7850916777a5df379c6217e16eb1fcc82b2b465b53624c9eb985919fa` |


Go was consumed through a local file proxy without `replace`; Rust through a path dependency on the extracted `.crate`; npm/Python through installed packages. Go validation used the patched 1.26.10 toolchain, without changing the module or dependencies. Retain the exact artifacts, dependency inventory, commands and reports for a pilot: a hash identifies bytes but does not make temporary artifacts downloadable. A rebuild must be checked and retested; WASM byte reproducibility was not established. Public reproduction starts with the [conformance kit](../../tools/conformance/README.md) and the [rehearsal instructions](../../tools/enterprise-rehearsal/README.md), using an explicit revision and installed package paths. This page summarizes internal evidence; it does not claim every local probe is a published test tool.

### Limits and remaining release work

- The frozen Express tarball lacks `LICENSE`; include the license before distributing it. The local WASM binary contains a build-cache path; remap paths and review rebuilt bytes before publication. Neither artifact is offered here as a release download.
- Dependency review is a dated snapshot, not a guarantee. The optional Rust OTLP graph selects `anyhow`/`tokio` versions with advisories [RUSTSEC-2026-0190](https://osv.dev/vulnerability/RUSTSEC-2026-0190) and [RUSTSEC-2026-0386](https://osv.dev/vulnerability/RUSTSEC-2026-0386); default and WASM builds do not select those crates. OTLP is not validated by this freeze and needs separate dependency remediation before use.
- CodeQL alerts #58/#59 remain open in a conformance self-test; triage found interpolation of a fixed-corpus hexadecimal hash, not a demonstrated remote production path. Dependabot reported no open alerts. The secret-scanning API was unavailable; that is missing coverage, not zero findings.
- The prior dossier exclusions remain: unresolved specification contradictions, optional extensions, operator infrastructure and untested environments do not become supported through this freeze. Finite tests do not establish absence of vulnerabilities.
- Packaging fixes, new versions, registry-installed checks and explicit publication authorization are still required before releasing the post-baseline changes. Images and deployments need their own validation. Documentation integration does not publish packages.

> **Note (09/11/2026).** The items above describe the MP-06 snapshot and its local artifacts, which are unchanged. For the versions published on 09/11/2026, the WASM path remapping, the CLI `LICENSE` and the OTLP minimums are in place; see [Publication of 09/11/2026](#publication-of-09112026). `@dcp-ai/express` 2.1.0 was not republished.

## Publication of 09/11/2026

**Source:** `main` at `cdb7099b8b6dc2a78b54928250752fd0bbd9c770` ([PR #140](https://github.com/dcp-ai-protocol/dcp-ai/pull/140)), tree `af69307b663381ce776ad3115f76fe82f225a789`, the tree of the reviewed export of the candidates. The [CI of that commit](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42557635924) passed, and so did the release workflows that rebuilt and published the [PyPI](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42559171389) and [crates.io](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42559174109) files; these runs are the project's own checks, not an external audit. Six versions were published from it: `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0 and `@dcp-ai/cli` 2.2.0 on npm, `dcp-ai` 2.11.0 on PyPI, Rust `dcp-ai` 2.14.0 on crates.io and the Go module v2.14.0. It is a registry release after internal validation, not an external audit or a certification. `@dcp-ai/express` 2.1.0 and the other npm adapters were not republished.

| Registry | Version | Identifier |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.4.0 | `sha512-4IsY/ctFqLf5vvOS6bWUdN63NCbMoi6N0qnAceYG8AINnqm7+cRyG5stO+P4ZM8ROM2uyhI09AlcQDhdJVhIeQ==` |
| npm `@dcp-ai/wasm` | 2.2.0 | `sha512-eu9NiNXl99hCKz/xpUPteaZGF+ea0+WTQ/6mZu2RIkuP2eTMsym0Bbp7gTbqB1LaaGMGuRFYAjK8wSVIGt/AAA==` |
| npm `@dcp-ai/cli` | 2.2.0 | `sha512-/UR5K7/PctZX8Do6CULz1ua1eEwt19Jo/Q/adkMq806uRjZ2gh10W0FnfrzJVJPjskadK/tma2aXisU+z1Hx7Q==` |
| PyPI `dcp-ai` | 2.11.0 | wheel `2e7776e1c3675f9f4a3c088d6115b728d6e33c72c69a2e624b1771ab9fa45f53`, sdist `9d4a545376e2a9a0afa61b0845ef5bf992b9c92ac5390da95a35333327397da7` (SHA-256) |
| crates.io `dcp-ai` | 2.14.0 | `704028282d977973fc84e6fbaa495159e43ecec5951cf2f1b5ea9d3e70515424` (checksum) |
| Go module `sdks/go/v2` | v2.14.0 | tag `sdks/go/v2.14.0`, commit `cdb7099b8b6dc2a78b54928250752fd0bbd9c770`, `h1:9O4n7vn3YqOhKlyUg/cm0OnouQi4QbU7mHbIh1BM5Z8=` |

- **Identity with the tested artifacts.** The npm tarballs are the files tested before publication, with the same `sha512` integrity. The PyPI wheel and sdist and the crate were rebuilt from `main` by the release workflows and contain the same source files as the tested artifacts; the Python files differ only in metadata (Metadata-Version 2.5 and hatchling 1.33.0 instead of 2.4 and 1.27.0, with the RECORD recomputed), and the crate adds `.cargo_vcs_info.json`, which names `main`. The Go module the proxy serves has the same 106 files and the same `h1` as the tested module; only the zip compression differs.
- **Installed from the registries.** Fresh consumers installed each package by name and version, without `file:`, path dependencies, `replace`, `[patch]` or overrides: the PyPI wheel and sdist (the sdist built by pip), the crate with its default and `otlp` features, the npm SDK, CLI and WASM with `@dcp-ai/express` 2.1.0, which resolved the one `@dcp-ai/sdk` 2.4.0, and the Go module through `proxy.golang.org` with the checksum database on and Go 1.26.10. The composition, acknowledgment, ingress and P-ED-1 checks, the CLI suites and the WASM checks gave the same results as on the tested artifacts.
- **Release validation.** [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md) describes the tool that repeats this installation from the registries and runs the external catalogs against the installed packages, and records the complete local macOS and GitHub Ubuntu 24.04 campaigns of 10/11/2026. It is the project's own check, not an external audit.
- **Packaging items of the MP-06 freeze.** For these versions, the WASM binary is built without local build paths and a release gate checks the packed files, `@dcp-ai/cli` ships `LICENSE`, and the Rust `otlp` feature requires `anyhow` 1.0.103 and `tokio` 1.53.3 or later; the default and `wasm` builds select neither. The `LICENSE` added to `integrations/express` is in the repository only: the published `@dcp-ai/express` 2.1.0 tarball still has none.
- **Not covered.** The exclusions of the MP-06 freeze above and of [Known limits and exclusions](#known-limits-and-exclusions) still apply, except the packaging and dependency items closed here for these versions: the WASM build paths, the CLI `LICENSE` and the OTLP minimums. The MP-06 snapshot above is kept as it was recorded. Finite checks do not establish the absence of vulnerabilities.

## Reproduce

From a checkout of the commit under review, with Node 22, Python 3.10+, Go (the version in `sdks/go/go.mod`) and a stable Rust toolchain (with `wasm32-unknown-unknown` and wasm-pack for WASM). The installs use the committed locks where they exist. The Python SDK has none: `pip install -e ".[dev]"` resolves the versions available when you install.

At the baseline:

```bash
(cd sdks/typescript && npm ci && npm run build && npm test) && npm ci --ignore-scripts
npm run conformance
(cd sdks/python && pip install -e ".[dev]" && pytest)
(cd sdks/go && go test ./...)
(cd sdks/rust && cargo test --locked)
(cd sdks/wasm && npm ci && npm run build && npm test)
node tools/conformance/wrappers/build.mjs all
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog delegation --report /tmp/delegation-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
```

From #124 or later only (these commands do not exist at the baseline):

```bash
node tools/difffuzz/run.mjs --sdks five --iterations 60 --report /tmp/difffuzz-five.json
node tools/difffuzz/run-mandates.mjs --iterations 120 --report /tmp/mandates.json
```

- **What a pass shows.** A run shows that these cases pass with the argv that was run, nothing more.
- **WASM.** `npm test` in `sdks/wasm` compiles only the TypeScript layer and needs `pkg/dcp_ai_bg.wasm`, which `npm run build` produces.
- **More commands.** The [conformance kit](../../tools/conformance/README.md) lists every catalog and its wrappers; the [differential harnesses](../../tools/difffuzz/README.md) list their bounds.
- **Reference runs.** CI runs the same suites in `.github/workflows/ci.yml` and `difffuzz.yml`.

## Record what you ran

- **Source.** The exact commit (`git rev-parse HEAD`) and whether the worktree differs from it (`git status --porcelain`, and `git diff` if it does).
- **Toolchains and artifacts.** Toolchain versions, and the versions and hashes of the artifacts you ran: the TypeScript `dist`, built binaries, the WASM package and the resolved Python packages (`python -m pip freeze`). The kit and the differential harnesses record most of these in their reports.
- **Reports.** Keep the report files with their hashes.
- **Provenance.** The `implementation` name and version a wrapper declares in a report is its own statement, not authenticated provenance; the hashes of what you built and ran are the evidence.

## What to review

| Layer | Paths | What a pass does not establish |
|---|---|---|
| Protocol core and profiles | `spec/`, `schemas/`; canonicalization `dcp-jcs-v1` | Normative text; `dcp-jcs-v2` is experimental and opt-in, never a default |
| SDK verifiers | `sdks/typescript`, `sdks/python`, `sdks/go`, `sdks/rust`, `sdks/wasm` | A verified bundle is not principal trust, admission or authorization; each is a separate API ([ADMISSION.md](../ADMISSION.md)) |
| Conformance and differential tooling | `tools/conformance`, `tools/difffuzz`, `tests/` | Test infrastructure, not part of the protocol |
| Reference services | `server/`, `services/` (anchor, transparency log, revocation) | Deployment choices, not normative; verifiers work without them |
| Adapters and scaffolders | `integrations/`, `packages/`, the FastAPI integration in the Python SDK | Optional; some published versions are affected ([SECURITY.md](../../SECURITY.md#supported-versions)) |
| Operator | Keys, trust anchors, admission configuration, service tokens, deployments | The repository makes no guarantee about them |

## Requirements to tests

| Area | Where it is mapped |
|---|---|
| V2 verification, V2-1 to V2-14 | [V2 verification map](SECURITY_COVERAGE.md#v2-verification-map), with its [schema boundary](SECURITY_COVERAGE.md#schema-and-cryptographic-api-boundary) |
| Verifier policy, including the clarification of V2-10 | [Verifier policy samples](SECURITY_COVERAGE.md#verifier-policy-samples) |
| Structural rules | [Structural samples](SECURITY_COVERAGE.md#structural-samples) |
| Admission and `strict-v1` | [Admission map](SECURITY_COVERAGE.md#admission-map) |
| DCP-09 mandate chains | [Delegation map](SECURITY_COVERAGE.md#delegation-map) |
| Agreement between SDKs | [Differential samples](SECURITY_COVERAGE.md#differential-samples) |
| Algorithms | [tests/nist-kat](../../tests/nist-kat/README.md): RFC 8032 vectors for Ed25519; size, round-trip, wrong-key and cross-SDK tests for ML-DSA-65, and 204 verification cases with an empty context (NIST ACVP tc39 and 203 C2SP Wycheproof cases, which are not a NIST source) in the four SDKs and on wasm32; NIST ACVP vectors, with the SHA-256 of their source files, for ML-KEM-768 and SLH-DSA-192f. Passing them is not NIST validation of a cryptographic module |

## Artifacts

Three things are distinct; never read one as another.

| Artifact | Versions | What it contains |
|---|---|---|
| Reviewed source | `main` at the baseline | Every fix below |
| Published (09/11/2026) | `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0, `@dcp-ai/cli` 2.2.0, `dcp-ai` 2.11.0 (PyPI), Go v2.14.0, Rust `dcp-ai` 2.14.0 | Every SDK change below, plus P-ED-1 and the opt-in delegated admission APIs ([Publication of 09/11/2026](#publication-of-09112026)) |
| Published (05/11/2026) | `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0, Rust `dcp-ai` 2.13.0 | Every SDK change below |
| Prepared on 30/10/2026 (#114), never published, superseded | Go v2.12.0, Rust `dcp-ai` 2.12.0, `@dcp-ai/wasm` 2.1.2 | #106 (WASM), #107 and #112; not #103 or #116 to #119 |
| Published earlier (28/10/2026) | `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `@dcp-ai/cli` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1, Rust `dcp-ai` 2.11.1 | The verifier fixes of 26/10/2026 and the secondary SHA3-256 checks of 28/10/2026; none of the fixes below |

A version number alone does not identify an artifact. The manifests on `main` carry the numbers published on 09/11/2026; the candidate of 30/10/2026 used Go and Rust 2.12.0 and `@dcp-ai/wasm` 2.1.2 for fewer changes, and those numbers are not reused. Use the registry identifiers below or the hashes of what you built. For the versions of 05/11/2026, the npm tarballs are the files tested before publication; the PyPI files and the crate were rebuilt from `main` and contain the same files as the tested artifacts, except the crate's `.cargo_vcs_info.json`, which names `main`. After publication, on 05/11/2026, the public registries were read again over normal TLS: the latest versions were the ones above, with the identifiers below.

| Registry | Version | Identifier |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.3.0 | `sha512-5IsrDMKE3NM8e5jVLFIaigNFHIni/aIzD9Q4zNYZu6sTLfsPk/zqRxi9ccjtGSTiaftTba3LD/1JA4Gi0uS1bw==` |
| npm `@dcp-ai/wasm` | 2.1.3 | `sha512-ToL7ZE+8mEvKJCO5DXxJm+GS2nrQ2tInHYJn+cWqLWxT+eMss9ka9MVp30LNmopO+MTqgwBs1hmAy6TOI5wDIA==` |
| npm `@dcp-ai/cli` | 2.1.1 | `sha512-Qmuq5FiT+TUW3nZ4HCp/DUXdF6JVYB6vaCmNZL/qK8EWiSpP5gzgesSwK0zzlOQL20SJJditRR0h5YIQ7gxIMw==` |
| PyPI `dcp-ai` | 2.10.2 | wheel `825de9d6dce5ec2737d38534e7c3d357edbded437912605a549cde75518f198b`, sdist `6005f342a0a24bee331c30be2fb2bc89a1306a21de399051cd1cef3cc96297e4` (SHA-256) |
| crates.io `dcp-ai` | 2.13.0 | `579f070ad23c531147ef91287d610c6dc317bef997e2791a24a5070a4c0c13a1` (checksum) |
| Go module `sdks/go/v2` | v2.13.0 | tag `sdks/go/v2.13.0`, commit `46b142bd7e42601acd912f156bbfcd9f5204a4be` (05/11/2026), `h1:bRkqSUWHQ/qTywPmKWRdzg2bBWI0RG1ZZAlb6IafnyU=` |

SDK changes after the versions of 28/10/2026, published on 05/11/2026:

| Change | Commit | SDKs | Published |
|---|---|---|---|
| `VerificationCache` keys and isolation (#103) | `e711179a` | TypeScript | Yes, 05/11/2026 |
| WASM `dualMerkleRoot` follows V2-11 (#106) | `cac0a5f6` | Rust (`wasm` feature), WASM | Yes, 05/11/2026 (prepared on 30/10/2026) |
| `VerifyPayloadHash` checks the normative prefixed hash (#107) | `24e70d56` | Go | Yes, 05/11/2026 (prepared on 30/10/2026) |
| `RawAuditEventV2` keeps received audit entries (#112) | `6dc97d59` | Go, Rust | Yes, 05/11/2026 (prepared on 30/10/2026) |
| V2-2 schema validation inside every V2 verifier (#116) | `0ebd2849` | TypeScript, Python, Go, Rust, WASM | Yes, 05/11/2026 |
| Mandate validity helpers aligned (#117) | `614b1c56` | TypeScript, Python, Go, Rust | Yes, 05/11/2026 |
| Mandate chain time checks aligned (#118) | `7619ff95` | TypeScript, Python, Go, Rust | Yes, 05/11/2026 |
| Repeated domains in a standalone root mandate rejected (#119) | `c154192f` | TypeScript, Python, Go, Rust | Yes, 05/11/2026 |

Other changes after the versions of 28/10/2026:

- **Reference transparency log.** #120 (`c59ce5ba`) binds gossip alerts to the witnessed log identity, and #122 (`d45c5a7b`) polls peers added at run time. This service is not distributed as a package.
- **Specification and conformance kit.** #121 (`0dcbd8dc`) adds the delegation catalog. #123 (`45ac32f0`) adds the clarifications of V2-10 and DCP-09 §3.5.2, policy catalog 2.0 and delegation catalog 2.0.0. No SDK changes.
- **Registry users.** The SDK changes in the table above reach them with the versions of 05/11/2026; earlier versions keep the limits listed here. The transparency log, the specification and the conformance kit are not part of those packages: they are used from the repository.

## Known limits and exclusions

- **Audit record.** [AUDIT-v2.0-FINAL.md](../../spec/AUDIT-v2.0-FINAL.md) is an internal historical record of 26/02/2026, with a current context note. It is not an external audit.
- **No HSM provider.** The simulated `HsmCryptoProvider` was removed from the TypeScript source on 06/11/2026; no SDK has an HSM provider, the reference server advertises `hsm_provider: false` and `dcp audit gaps` keeps Gap #11 open ([NIST_CONFORMITY.md](../NIST_CONFORMITY.md)).
- **Key recovery.** The shares are not encrypted with the hybrid KEM.
- **Reference server.** It checks the structure of an advisory's signature, not the signature itself ([server/README.md](../../server/README.md)).
- **WASM.** It exports no mandate chain verification.
- **Rust.** It lacks A2A AES-256-GCM session encryption and its replay window ([RUST_RELEASE.md](../RUST_RELEASE.md)).
- **Versions published before 05/11/2026.** They lack the changes listed under [Artifacts](#artifacts).
- **Versions published before 09/11/2026.** They lack P-ED-1 (except where the official PyNaCl build behind the Python SDK already rejected those signatures) and the opt-in delegated admission APIs.
- **Differential and fuzz campaigns.** They are finite, not exhaustive. Inputs that contract `/4` cannot carry to every SDK are measured apart ([differential harnesses](../../tools/difffuzz/README.md#mandate-chains)).
- **Performance.** No speed requirement is checked. The [performance baseline](../../tools/conformance/README.md#performance-baseline) and the [bounded workload scaling](../../tools/conformance/README.md#bounded-workload-scaling) are local measurements of method, added after the baseline commit; neither is an audit result.
- **Not covered.** Container images, deployments, service tokens and operator configuration.

## Reporting

Report security issues as [SECURITY.md](../../SECURITY.md) describes. It sets out the contacts, the scope (including bounded local reproductions of resource exhaustion) and the reward policy: rewards are case by case, with no guaranteed or fixed amount.
