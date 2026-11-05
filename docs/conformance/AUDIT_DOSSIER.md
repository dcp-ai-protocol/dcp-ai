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
| Algorithms | [tests/nist-kat](../../tests/nist-kat/README.md): RFC 8032 vectors for Ed25519; size, round-trip, wrong-key and cross-SDK tests for ML-DSA-65; NIST ACVP vectors, with the SHA-256 of their source files, for ML-KEM-768 and SLH-DSA-192f. Passing them is not NIST validation of a cryptographic module |

## Artifacts

Three things are distinct; never read one as another.

| Artifact | Versions | What it contains |
|---|---|---|
| Reviewed source | `main` at the baseline | Every fix below |
| Published (05/11/2026) | `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0, Rust `dcp-ai` 2.13.0 | Every SDK change below |
| Prepared on 30/10/2026 (#114), never published, superseded | Go v2.12.0, Rust `dcp-ai` 2.12.0, `@dcp-ai/wasm` 2.1.2 | #106 (WASM), #107 and #112; not #103 or #116 to #119 |
| Published earlier (28/10/2026) | `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `@dcp-ai/cli` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1, Rust `dcp-ai` 2.11.1 | The verifier fixes of 26/10/2026 and the secondary SHA3-256 checks of 28/10/2026; none of the fixes below |

A version number alone does not identify an artifact. The manifests on `main` carry the numbers published on 05/11/2026; the candidate of 30/10/2026 used Go and Rust 2.12.0 and `@dcp-ai/wasm` 2.1.2 for fewer changes, and those numbers are not reused. Use the registry identifiers below or the hashes of what you built. The npm tarballs are the files tested before publication; the PyPI files and the crate were rebuilt from `main` and contain the same files as the tested artifacts, except the crate's `.cargo_vcs_info.json`, which names `main`. After publication, on 05/11/2026, the public registries were read again over normal TLS: the latest versions were the ones above, with the identifiers below.

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
- **Simulated HSM provider.** `HsmCryptoProvider` is a simulated pattern and must not be used for real evidence ([NIST_CONFORMITY.md](../NIST_CONFORMITY.md)).
- **Key recovery.** The shares are not encrypted with the hybrid KEM.
- **Reference server.** It checks the structure of an advisory's signature, not the signature itself ([server/README.md](../../server/README.md)).
- **WASM.** It exports no mandate chain verification.
- **Rust.** It lacks A2A AES-256-GCM session encryption and its replay window ([RUST_RELEASE.md](../RUST_RELEASE.md)).
- **Versions published before 05/11/2026.** They lack the changes listed under [Artifacts](#artifacts).
- **Differential and fuzz campaigns.** They are finite, not exhaustive. Inputs that contract `/4` cannot carry to every SDK are measured apart ([differential harnesses](../../tools/difffuzz/README.md#mandate-chains)).
- **Performance.** No speed requirement is checked. The [performance baseline](../../tools/conformance/README.md#performance-baseline) and the [bounded workload scaling](../../tools/conformance/README.md#bounded-workload-scaling) are local measurements of method, added after the baseline commit; neither is an audit result.
- **Not covered.** Container images, deployments, service tokens and operator configuration.

## Reporting

Report security issues as [SECURITY.md](../../SECURITY.md) describes. It sets out the contacts, the scope (including bounded local reproductions of resource exhaustion) and the reward policy: rewards are case by case, with no guaranteed or fixed amount.
