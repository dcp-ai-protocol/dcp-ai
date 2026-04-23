# Architecture map

This document is a 2-minute orientation for new contributors. It explains **where each piece lives and why** — enough to route a PR or a bug report without guessing.

For the protocol normative spec see [`spec/`](../spec/README.md). For how to run tests and build, see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Mental model

DCP-AI is a **portable accountability layer** for AI agents. The repository layers, from most-normative to most-operational:

```
┌───────────────────────────────────────────────────────────────────┐
│  spec/ + schemas/           ← source of truth (what IS DCP)        │
│  ─────────────────────                                             │
│  tests/                     ← conformance + interop + NIST KAT     │
│  ─────────────────────                                             │
│  sdks/{ts,py,rust,go,wasm}  ← reference implementations            │
│  ─────────────────────                                             │
│  integrations/              ← bindings for popular frameworks      │
│  cli/                       ← interactive CLI (@dcp-ai/cli)        │
│  packages/create-*          ← npm create scaffolders               │
│  ─────────────────────                                             │
│  services/                  ← operational infra (anchor, log, …)   │
│  contracts/                 ← on-chain artifacts (DCPAnchor.sol)   │
│  ─────────────────────                                             │
│  docs/ + docs-site/ + site/ ← hand-written docs + generated site   │
│  playground/                ← in-browser interactive demo          │
└───────────────────────────────────────────────────────────────────┘
```

The further up in that stack you are, the stricter the change review:
spec edits need all five SDKs to stay in lockstep; a doc edit is self-contained.

## Top-level directories

| Path | What it is | Publish target |
|---|---|---|
| [`spec/`](../spec/) | Normative specifications DCP-01 through DCP-09, plus profile extensions (crypto, A2A, governance). Canonical English, with community translations. | — |
| [`schemas/`](../schemas/) | JSON Schema (draft 2020-12) definitions for every artifact in the protocol. v1 (9 schemas) + v2 (22 schemas). | — |
| [`tests/conformance/`](../tests/conformance/) | Cross-SDK conformance suite that every SDK must pass. This is the gate that keeps wire compatibility honest. | — |
| [`tests/interop/`](../tests/interop/) | Interop vectors: canonicalization, domain separation, composite signing, session splicing, stripping attacks. | — |
| [`tests/nist-kat/`](../tests/nist-kat/) | NIST Known Answer Tests for ML-DSA-65 / SLH-DSA-192f / ML-KEM-768. | — |
| [`sdks/typescript/`](../sdks/typescript/) | Reference TypeScript SDK. | npm `@dcp-ai/sdk` |
| [`sdks/python/`](../sdks/python/) | Reference Python SDK. | PyPI `dcp-ai` |
| [`sdks/rust/`](../sdks/rust/) | Reference Rust SDK (also compiled to WASM). | crates.io `dcp-ai` |
| [`sdks/go/`](../sdks/go/) | Reference Go SDK. | Go modules `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` |
| [`sdks/wasm/`](../sdks/wasm/) | WebAssembly bundle of the Rust SDK for browser + Node. | npm `@dcp-ai/wasm` |
| [`integrations/`](../integrations/) | 10 framework bindings: Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen. | npm `@dcp-ai/<name>` |
| [`packages/create-*`](../packages/) | Scaffolders invoked via `npm create @dcp-ai/<framework>`. One per mainline framework. | npm `@dcp-ai/create-<name>` |
| [`cli/`](../cli/) | Interactive wizard CLI — alternative to `bin/dcp.js` for new users. | npm `@dcp-ai/cli` |
| [`bin/`](../bin/) | Reference JavaScript CLI used by the conformance suite. | Bundled with root `dcp-ai` npm. |
| [`services/`](../services/) | Operational microservices: anchor (Zenodo-style persistence), transparency-log (hash-chained log), revocation. | Docker images → GHCR |
| [`contracts/ethereum/`](../contracts/ethereum/) | `DCPAnchor.sol` + Foundry tests. | On-chain deploy |
| [`api/`](../api/) | Wire-format artifacts: OpenAPI (`openapi.yaml`) + Protocol Buffers (`proto/`). | — |
| [`lib/`](../lib/) | Entry-point exports used by the root `dcp-ai` npm package. | Bundled with root npm. |
| [`tools/`](../tools/) | Repo-internal CLIs (`validate.js`, `conformance.js`, `crypto.js`, `merkle.js`). Not published. | — |
| [`scripts/`](../scripts/) | One-off build helpers (example generators, protocol fingerprint emit). | — |
| [`docs/`](../docs/) | Hand-written docs: QUICKSTART, OBSERVABILITY, ARCHITECTURE (this file), SECURITY notes, migration guides. | Consumed by MkDocs. |
| [`docs-site/`](../docs-site/) | MkDocs configuration + Jinja templates for docs.dcp-ai.org. | GitHub Pages. |
| [`site/`](../site/) | dcp-ai.org static marketing site. | Cloudflare Pages / GitHub Pages. |
| [`playground/`](../playground/) | In-browser interactive playground (React + WASM SDK). | Hosted at dcp-ai.org/playground. |
| [`templates/`](../templates/) | Source templates consumed by the `packages/create-*` scaffolders. | — |
| [`deploy/`](../deploy/) | Fly.io / deployment configs for services. | — |
| [`keys/`](../keys/) | Demo keys used by conformance tests and examples. **Do not use in production.** | — |
| [`credentials/`](../credentials/) | JSON-LD @context files served at dcp-ai.org/credentials/v2. | GitHub Pages. |

## How the pieces talk to each other

- **Spec → SDKs.** `spec/` and `schemas/` are read by humans; SDKs implement them. Every SDK re-implements canonicalization, hashing, signing, verification to produce wire-compatible artifacts. The conformance suite in `tests/conformance/` runs the same vectors against every SDK in CI.
- **SDKs → integrations.** Each `integrations/*` package pulls its language's SDK as a dependency — e.g. `@dcp-ai/express` depends on `@dcp-ai/sdk`. No integration reimplements crypto.
- **Integrations → scaffolders.** `packages/create-*` ship the minimal glue a user needs to start a project on top of a specific integration.
- **SDKs → services.** Operational services use an SDK internally for signing/verification; they don't fork the crypto.
- **Root `dcp-ai` npm.** The top-level `package.json` publishes the reference CLI + verification library (`bin/dcp.js`, `lib/verify.js`). It's the original entry point; most new users arrive via an SDK or a scaffolder instead.

## Where to change what

| You want to… | Edit |
|---|---|
| Propose a new artifact or tighten a schema | `spec/` + `schemas/`, then update every SDK in lockstep and add a conformance vector in `tests/conformance/`. |
| Fix a crypto bug in one language | `sdks/<language>/`. Add a regression test. If the bug could affect other languages, add a shared interop vector in `tests/interop/`. |
| Add a framework integration | `integrations/<framework>/`. Consume the SDK of the matching language as a dependency. Add a scaffolder in `packages/create-<framework>/` if it's mainline. |
| Change the marketing site | `site/`. |
| Change the technical docs site | `docs/` (content) and/or `docs-site/` (config/templates). |
| Change the interactive demo | `playground/`. |
| Deploy or re-deploy a service | `services/<name>/` + `deploy/fly/`. |
| Release a new SDK version | Bump the respective `package.json` / `Cargo.toml` / `pyproject.toml` / git tag; CI detects and publishes via `.github/workflows/publish*.yml`. Skip-if-already-published is built in. |

## What's deliberately NOT in this repo

- **Dashboard web app** — lives in `dcp-db/` (React + Vite + Supabase). Consumes the SDKs but is an application on top of the protocol, not part of it.
- **Marketing landing page** — lives in `dcp-landing/`.
- **Demo MCP server** — lives in `dcp-demo/` (Python, uses local SDKs via path deps).
- **Agent workers** — live in `dcp-agents/`.

All four are sibling repos at `github.com/dcp-ai-protocol/<name>`. The boundary is simple: if a component is normative protocol, reference implementation, operational infra, or a canonical integration, it lives here. If it's an end-user application or a specific deployment, it lives in its own repo.

## Why monorepo today

A protocol with five SDKs lives or dies by keeping them wire-compatible. Reviewing one PR that touches all five together — and running the conformance suite against all five on every PR — is the lightest-weight way to enforce that invariant. The moment a specific SDK or a specific component grows its own community and its own cadence, splitting it out is a reasonable response. Until then, the overhead of coordinating multiple repos exceeds the benefits.

Further reading: the governance model in [`GOVERNANCE.md`](../GOVERNANCE.md) and the forward-looking direction in [`ROADMAP.md`](../ROADMAP.md).
