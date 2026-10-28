# Published npm packages

Verified on 28/10/2026: `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1 and `@dcp-ai/cli` 2.1.1 are published with the `latest` tag; the other ten packages below are unchanged. Package versions are separate from the DCP wire/specification version and repository tags.

On 26/10/2026, 13 versions were published with the `latest` tag: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` 2.1.0, `@dcp-ai/cli` 2.1.0 and the ten packages still listed below. Their registry integrity matched the tested tarballs, and a fresh installation from npm passed 383 checks.

| Package | Version |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.1 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.1 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.1 |
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
npm install @dcp-ai/sdk@^2.2.1
npm install @dcp-ai/wasm@^2.1.1
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.1 dcp-ai --help
```

Each npm publication covers npm only. It does not publish a Python package to PyPI, a Rust crate to crates.io, a Go module tag or a container image. Check each SDK’s release status before using source-checkout examples in those ecosystems. The repository root still uses a local SDK to test the checked-out source; this is a development choice, not an npm availability limitation.

Since 2.2.0, `@dcp-ai/sdk` includes principal trust, `strict-v1`, the verifier fixes and experimental candidate APIs. `@dcp-ai/express` and `@dcp-ai/openclaw` 2.1.0 include corrected V2 signature verification and the documented admission controls. Their 2.0.0 releases remain affected; see [SECURITY.md](../SECURITY.md). Publication does not make a verified bundle trusted or authorize an action.

In `@dcp-ai/sdk` 2.2.0 and later and `@dcp-ai/wasm` 2.1.0 and later, `dcp-jcs-v2` remains experimental, non-normative and opt-in. `dcp-jcs-v1` remains the only normative default. Scaffolders and bridge helpers keep the limitations stated in their READMEs; publishing them does not turn demo flows into production verifiers.

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [Python 2.10.1](PYTHON_RELEASE.md), [Go v2.11.1](GO_RELEASE.md) and [Rust 2.11.1](RUST_RELEASE.md).
