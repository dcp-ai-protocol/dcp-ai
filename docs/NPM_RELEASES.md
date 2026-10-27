# Published npm packages

Verified on 26/10/2026. These 13 exact versions are published with the `latest` tag. Their registry integrity matched the tested tarballs, and a fresh installation from npm passed 383 checks. Package versions are separate from the DCP wire/specification version and repository tags.

| Package | Version |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.0 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.0 |
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

## Install the published versions

```bash
npm install @dcp-ai/sdk@^2.2.0
npm install @dcp-ai/wasm@^2.1.0
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.0 dcp-ai --help
```

This publication covers npm only. It does not publish a Python package to PyPI, a Rust crate to crates.io, a Go module tag or a container image. Check each SDK’s release status before using source-checkout examples in those ecosystems. The repository root still uses a local SDK to test the checked-out source; this is a development choice, not an npm availability limitation.

`@dcp-ai/sdk` 2.2.0 includes principal trust, `strict-v1`, the verifier fixes and experimental candidate APIs. `@dcp-ai/express` and `@dcp-ai/openclaw` 2.1.0 include corrected V2 signature verification and the documented admission controls. Their 2.0.0 releases remain affected; see [SECURITY.md](../SECURITY.md). Publication does not make a verified bundle trusted or authorize an action.

In both `@dcp-ai/sdk` 2.2.0 and `@dcp-ai/wasm` 2.1.0, `dcp-jcs-v2` remains experimental, non-normative and opt-in. `dcp-jcs-v1` remains the only normative default. Scaffolders and bridge helpers keep the limitations stated in their READMEs; publishing them does not turn demo flows into production verifiers.

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [Python 2.10.0](PYTHON_RELEASE.md), [Go v2.11.0](GO_RELEASE.md) and [Rust 2.11.0](RUST_RELEASE.md).
