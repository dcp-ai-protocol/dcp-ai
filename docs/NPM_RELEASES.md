# Published npm packages

Verified on 09/11/2026: `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0 and `@dcp-ai/cli` 2.2.0 are published with the `latest` tag; the other ten packages below are unchanged ([what changed](#what-changed-on-09112026)). On 05/11/2026, `@dcp-ai/sdk` 2.3.0 and `@dcp-ai/wasm` 2.1.3 were published with the `latest` tag ([what changed](#what-changed-on-05112026)), and on 28/10/2026, `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1 and `@dcp-ai/cli` 2.1.1. Package versions are separate from the DCP wire/specification version and repository tags.

On 26/10/2026, 13 versions were published with the `latest` tag: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` 2.1.0, `@dcp-ai/cli` 2.1.0 and the ten packages still listed below. Their registry integrity matched the tested tarballs, and a fresh installation from npm passed 383 checks.

| Package | Version |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.4.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.2.0 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.2.0 |
| [`@dcp-ai/anthropic-mcp`](https://www.npmjs.com/package/@dcp-ai/anthropic-mcp) | 2.1.0 |
| [`@dcp-ai/autogen`](https://www.npmjs.com/package/@dcp-ai/autogen) | 2.0.1 |
| [`@dcp-ai/express`](https://www.npmjs.com/package/@dcp-ai/express) | 2.1.0 |
| [`@dcp-ai/google-a2a`](https://www.npmjs.com/package/@dcp-ai/google-a2a) | 2.1.0 |
| [`@dcp-ai/openclaw`](https://www.npmjs.com/package/@dcp-ai/openclaw) | 2.1.0 |
| [`@dcp-ai/w3c-did`](https://www.npmjs.com/package/@dcp-ai/w3c-did) | 2.0.1 |
| [`@dcp-ai/create-crewai`](https://www.npmjs.com/package/@dcp-ai/create-crewai) | 2.0.1 |
| [`@dcp-ai/create-express`](https://www.npmjs.com/package/@dcp-ai/create-express) | 2.0.1 |
| [`@dcp-ai/create-langchain`](https://www.npmjs.com/package/@dcp-ai/create-langchain) | 2.0.1 |
| [`@dcp-ai/create-openai`](https://www.npmjs.com/package/@dcp-ai/create-openai) | 2.0.1 |

## What changed on 28/10/2026

`@dcp-ai/sdk` 2.2.1 and `@dcp-ai/wasm` 2.1.1 verify the optional secondary SHA3-256 fields of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: absent fields are not required, so a verified bundle may lack a complete secondary chain, and a present field that is `null`, not a string or inconsistent is rejected. `@dcp-ai/cli` 2.1.1 requires `@dcp-ai/sdk` `^2.2.1`, and `--version` reports `2.1.1`. APIs, result fields, `dcp-jcs-v1`, the experimental opt-in `dcp-jcs-v2` APIs and `hash_alg` handling are unchanged. The published adapters `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` and `@dcp-ai/google-a2a` 2.1.0 were not republished: they depend on `@dcp-ai/sdk` `^2.2.0` and get the secondary checks once your lockfile resolves `@dcp-ai/sdk` 2.2.1 or later.

The three registry tarballs are byte-identical to the reviewed artifacts, with matching `sha512` integrity. A fresh consumer installing from npm, without local overrides, passed 411 secondary SHA3-256 verdicts and 87 controls, 340 regression checks and 80 CLI checks (`--version` 2.1.1); the `@dcp-ai/wasm` package from the registry passed 167 checks in a real browser.

## Install the published versions

```bash
npm install @dcp-ai/sdk@^2.4.0
npm install @dcp-ai/wasm@^2.2.0
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.2.0 dcp-ai --help
```

Each npm publication covers npm only. It does not publish a Python package to PyPI, a Rust crate to crates.io, a Go module tag or a container image. Check each SDK’s release status before using source-checkout examples in those ecosystems. The repository root still uses a local SDK to test the checked-out source; this is a development choice, not an npm availability limitation.

Since 2.2.0, `@dcp-ai/sdk` includes principal trust, `strict-v1`, the verifier fixes and experimental candidate APIs. `@dcp-ai/express` and `@dcp-ai/openclaw` 2.1.0 include corrected V2 signature verification and the documented admission controls. Their 2.0.0 releases remain affected; see [SECURITY.md](../SECURITY.md). Publication does not make a verified bundle trusted or authorize an action.

In `@dcp-ai/sdk` 2.2.0 and later and `@dcp-ai/wasm` 2.1.0 and later, `dcp-jcs-v2` remains experimental, non-normative and opt-in. `dcp-jcs-v1` remains the only normative default. Scaffolders and bridge helpers keep the limitations stated in their READMEs; publishing them does not turn demo flows into production verifiers.

## What changed on 05/11/2026

`@dcp-ai/sdk` 2.3.0 and `@dcp-ai/wasm` 2.1.3 were published on 05/11/2026 from the tarballs tested before publication. They supersede the `@dcp-ai/wasm` 2.1.2 candidate of 30/10/2026 below, which was never published.

`@dcp-ai/sdk` 2.3.0, compared with 2.2.1:

- **V2-2 schema validation (acceptance change).** `verifySignedBundleV2`, the combined admission API and the experimental candidate verifier validate the signed bundle envelope and the four payloads against `schemas/v2` before any hash, key or signature check. Schema-invalid bundles accepted before, such as unknown members in closed objects or `null` session times in the manifest, now return `verified: false` with `schema: <pointer> <keyword>` diagnostics.
- **Mandates.** `verifyMandateValidity` applies one contract and takes an optional `now`; a missing or malformed date, accepted before, is invalid. `verifyMandateChain` reads every time the same way and rejects a root mandate that repeats a domain.
- **`VerificationCache`.** New opt-in `context` and `agentIds` options. Invalid options throw, `set` and `get` copy results, an entry expires at exactly its TTL on the monotonic clock, and `invalidateByAgent` now removes entries.

`@dcp-ai/wasm` 2.1.3, compared with 2.1.1:

- **`dualMerkleRoot` follows V2-11 (acceptance change).** It and the raw export `wasm_dual_merkle_root` compute the dual Merkle root with the reduction of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) that `verifyBundle` already used (raw 32-byte digests, the last node duplicated on an odd layer). 2.1.1 and earlier hash the hex text and carry an odd last node up unchanged, so their roots of two or more leaves differ. A leaf that is not a 32-byte hex digest is now an error, and roots are returned in lowercase.
- **V2-2 schema validation (acceptance change).** `verifyBundle` and `wasm_verify_signed_bundle_v2` validate the envelope and the four payloads against `schemas/v2` before any hash, key or signature check.
- **No JavaScript API is added.** The WebAssembly comes from the Rust `dcp-ai` 2.13.0 source, also published on 05/11/2026 (see [Rust](RUST_RELEASE.md)).

Both packages keep the wire format, the signatures, the profiles, `dcp-jcs-v1` as the normative default and the experimental opt-in `dcp-jcs-v2` APIs, and both include the Apache-2.0 `LICENSE`. The README inside each published tarball is the one prepared before publication: it reads "prepared, not published", and in the WASM README the `dualMerkleRoot` row of the Hash Operations table still reads "Prepared for 2.1.2". Published tarballs cannot change; this page and the READMEs in the repository describe the published versions.

The registry tarballs of `@dcp-ai/sdk` 2.3.0 and `@dcp-ai/wasm` 2.1.3 are byte-identical to the tested artifacts, with the same `sha512` integrity. A fresh consumer installing them from npm, without overrides, passed the external conformance kit (697 cases in seven catalogs for the SDK, 460 in the five catalogs that `@dcp-ai/wasm` supports), and the WASM package served from that installation passed 14 checks in a browser.

### Migrating `dualMerkleRoot` results

The correction changes the roots that the helper computes, not the evidence you already hold:

- **Keep historical evidence as it is.** Roots computed with `@dcp-ai/wasm` 2.1.1 or earlier, and any bundle, signature, anchor or log entry that carries them, stay as they were recorded. Do not recompute them with 2.1.3 and replace the stored values to make them match: that rewrites signed or anchored evidence and invalidates its signatures.
- **Record which version computed a root.** A root of two or more leaves from 2.1.1 or earlier is not the V2-11 root of the same leaves. To check it, recompute it with the version that produced it, or compute the V2-11 root next to it and keep both values.
- **New roots** come from 2.1.3 or from the other SDKs, which already follow V2-11. The Merkle reduction used by bundle verification is unchanged; `verifyBundle` already used V2-11. The new V2-2 schema checks described above do change acceptance.

### CLI and adapters

`@dcp-ai/cli` and the npm adapters get no new version. Their published ranges (`^2.2.1` for the CLI, `^2.2.0` for the adapters) accept `@dcp-ai/sdk` 2.3.0. They were checked twice: before publication, installed from npm with `@dcp-ai/sdk` resolved to the candidate through an override; after publication, installed from npm without any override, when their own ranges resolved one `@dcp-ai/sdk` 2.3.0 from the registry, with the tested integrity. Both times:

- **Checked functionally:** `@dcp-ai/cli` 2.1.1 (`--version`, a valid V2 bundle, and a schema-invalid one, which the CLI's own schema check rejects before the SDK runs), and `@dcp-ai/express` and `@dcp-ai/openclaw` 2.1.0 (regression checks of their admission and verification fixes).
- **Checked for installation only:** `@dcp-ai/anthropic-mcp` and `@dcp-ai/google-a2a` (one resolved `@dcp-ai/sdk` 2.3.0, the accepted range and the import of their entry point), and the packages that do not depend on the SDK (the entry point parses). This is not integration testing.

## Prepared, not published: `@dcp-ai/wasm` 2.1.2

`@dcp-ai/wasm` 2.1.2 is prepared in the repository on 30/10/2026 but not published on npm. At preparation time the table and the install commands stayed on the registry versions of then; the current ones are above.

It corrects `dualMerkleRoot` and the raw export `wasm_dual_merkle_root`: they now compute the dual Merkle root with the reduction of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) that `verifyBundle` already used (raw 32-byte digests, the last node duplicated on an odd layer). 2.1.1 and earlier hash the hex text and carry an odd last node up unchanged, so their roots of two or more leaves differ from V2-11. Malformed leaves, which 2.1.1 and earlier accepted, are now an error: each leaf must be a 32-byte hex digest. Uppercase hex is accepted and the root is returned in lowercase. An empty array gives the same error as before (`dualMerkleRoot` throws), and the result keeps its two fields, `sha256` and `sha3_256`.

`verifyBundle`, the other APIs, `dcp-jcs-v1` and the experimental opt-in `dcp-jcs-v2` APIs are unchanged, and no JavaScript API is added. The tarball no longer contains the translated READMEs, which are now in the repository’s `i18n/` tree. The WebAssembly comes from Rust `dcp-ai` 2.12.0, also prepared and not published (see [Rust](RUST_RELEASE.md)).

> **Note (05/11/2026).** The paragraphs above were written on 30/10/2026 for the prepared 2.1.2, which was never published. Since #116 (02/11/2026), `verifyBundle` on `main` runs V2-2 schema validation in the Rust core it wraps; 2.1.2 does not contain that change, and 2.1.3 above does. 2.1.3 supersedes 2.1.2, and the manifests on `main` carry 2.1.3. Text and tables that name 2.1.2, including the `dualMerkleRoot` row of the WASM README, are historical. See the [audit dossier](conformance/AUDIT_DOSSIER.md#artifacts).

## What changed on 09/11/2026

`@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0 and `@dcp-ai/cli` 2.2.0 were published on 09/11/2026 from the tarballs tested before publication, built from `main` (`cdb7099b`); their registry `sha512` integrity is the tested one. A fresh consumer installing the three by name and version from npm, with `@dcp-ai/express` 2.1.0 and without `file:` or overrides, resolved one `@dcp-ai/sdk` 2.4.0 for the CLI and the adapter, and gave the same API, CLI and WASM results as the tested tarballs.

- **`@dcp-ai/sdk` 2.4.0:** opt-in delegated admission, admission from bytes and mandate acknowledgment; the Ed25519 acceptance change P-ED-1 ([changelog](../CHANGELOG.md#unreleased)).
- **`@dcp-ai/wasm` 2.2.0:** errors told apart from values (`canonicalize`, `hashObject`, `deriveKid`), P-ED-1 in the Rust provider, and a binary built without the builder's local paths; no admission or mandate chain API.
- **`@dcp-ai/cli` 2.2.0:** P-ED-1 in `dcp-ai verify`, `@dcp-ai/sdk` `^2.4.0`, `LICENSE` in the package, and the version read from `package.json`; see [the CLI guide](../cli/README.md).
- The adapters get no new version; their `^2.2.0` ranges resolve `@dcp-ai/sdk` 2.4.0 on a new installation, and P-ED-1 with it. `@dcp-ai/express` 2.1.0 keeps its published files, which include no `LICENSE`; the file added to `integrations/express` is in the repository only.

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [Python 2.11.0](PYTHON_RELEASE.md), [Go v2.14.0](GO_RELEASE.md) and [Rust 2.14.0](RUST_RELEASE.md).
