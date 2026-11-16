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
| [`spec/`](../spec/) | Normative specifications DCP-01 through DCP-09, plus profile extensions (crypto, A2A, governance, admission). The English text is normative; the translations are informative. | — |
| [`schemas/`](../schemas/) | JSON Schema (draft 2020-12) definitions for every artifact in the protocol. v1 (9 schemas) + v2 (42 schemas). | — |
| [`tests/conformance/`](../tests/conformance/) | Cross-SDK conformance suite that every SDK must pass. This is the gate that keeps wire compatibility honest. | — |
| [`tests/interop/`](../tests/interop/) | Interop vectors: canonicalization, domain separation, composite signing, session splicing, stripping attacks. | — |
| [`tests/nist-kat/`](../tests/nist-kat/) | RFC 8032 Ed25519 vectors, ML-DSA-65 property tests, and NIST ACVP vectors for SLH-DSA-192f / ML-KEM-768. | — |
| [`sdks/typescript/`](../sdks/typescript/) | Reference TypeScript SDK. | npm `@dcp-ai/sdk` |
| [`sdks/python/`](../sdks/python/) | Reference Python SDK. | PyPI `dcp-ai` |
| [`sdks/rust/`](../sdks/rust/) | Reference Rust SDK (also compiled to WASM). | crates.io `dcp-ai` |
| [`sdks/go/`](../sdks/go/) | Reference Go SDK. | Go modules `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` |
| [`sdks/wasm/`](../sdks/wasm/) | WebAssembly bundle of the Rust SDK for browser + Node. | npm `@dcp-ai/wasm` |
| [`integrations/`](../integrations/) | 10 framework bindings: Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen. | npm `@dcp-ai/<name>` (six packages); PyPI `dcp-ai[<extra>]` (FastAPI, LangChain, OpenAI, CrewAI) |
| [`packages/create-*`](../packages/) | Scaffolders invoked via `npm create @dcp-ai/<framework>`. One per mainline framework. | npm `@dcp-ai/create-<name>` |
| [`cli/`](../cli/) | Interactive wizard CLI — alternative to `bin/dcp.js` for new users. | npm `@dcp-ai/cli` |
| [`bin/`](../bin/) | Reference JavaScript CLI used by the conformance suite. | Root package (not published to npm); run from a checkout. |
| [`services/`](../services/) | Reference operational services: anchor (batches hashes in memory; no on-chain submission yet), transparency-log (Merkle-tree log with signed tree heads and gossip), revocation. | Docker images → GHCR |
| [`contracts/ethereum/`](../contracts/ethereum/) | `DCPAnchor.sol` + Foundry tests. | On-chain deploy |
| [`api/`](../api/) | Wire-format artifacts: OpenAPI (`openapi.yaml`) + Protocol Buffers (`proto/`). | — |
| [`lib/`](../lib/) | The reference verification library (`lib/verify.js`) and helpers used by the root package, the server and the services. | Root package (not published to npm). |
| [`tools/`](../tools/) | Repo-internal CLIs (`validate.js`, `conformance.js`, `crypto.js`, `merkle.js`). Not published. | — |
| [`scripts/`](../scripts/) | One-off build helpers (example generators, protocol fingerprint emit). | — |
| [`docs/`](../docs/) | Hand-written docs: QUICKSTART, OBSERVABILITY, ARCHITECTURE (this file), SECURITY notes, migration guides. | Consumed by MkDocs. |
| `i18n/` | Translations of the public documents: `i18n/<locale>/` holds the Spanish, Brazilian Portuguese, Japanese or Simplified Chinese translation of each document at the same path as its English source, which prevails where they differ. | Consumed by MkDocs, one site per language. |
| `docs-site/` | Generated and not tracked (`.gitignore`): the per-language staging tree that `scripts/docs_site.py` writes for the MkDocs build. The site configuration is [`mkdocs.yml`](../mkdocs.yml). | — |
| `site/` | Generated and not tracked (`.gitignore`): the five-language documentation site that `bash scripts/build-docs-site.sh` builds. | GitHub Pages, by `.github/workflows/docs.yml`. |
| [`playground/`](../playground/) | In-browser interactive playground (plain JavaScript; Ed25519 with `tweetnacl`, SHA-256 with WebCrypto; its ML-DSA / SLH-DSA signatures are simulated, as the page says). | Hosted at docs.dcp-ai.org/playground/. |
| [`templates/`](../templates/) | Source templates consumed by the `packages/create-*` scaffolders. | — |
| [`deploy/`](../deploy/) | Fly.io / deployment configs for services. | — |
| [`keys/`](../keys/) | Demo keys used by conformance tests and examples. **Do not use in production.** | — |
| [`credentials/`](../credentials/) | JSON-LD @context files served at dcp-ai.org/credentials/v2. | GitHub Pages. |

## How the pieces talk to each other

- **Spec → SDKs.** `spec/` and `schemas/` are read by humans; SDKs implement them. Every SDK re-implements canonicalization, hashing, signing, verification to produce wire-compatible artifacts. The conformance suite in `tests/conformance/` runs the same vectors against every SDK in CI.
- **SDKs → integrations.** Each `integrations/*` package pulls its language's SDK as a dependency — e.g. `@dcp-ai/express` depends on `@dcp-ai/sdk`. No integration reimplements crypto.
- **Integrations → scaffolders.** `packages/create-*` ship the minimal glue a user needs to start a project on top of a specific integration.
- **SDKs → services.** The verification server and the revocation service verify through `lib/verify.js` and `@dcp-ai/sdk`. The transparency log signs its tree heads with `tweetnacl` directly, and the anchor service only hashes.
- **Root package (`dcp-ai`, not published to npm).** The top-level `package.json` holds the reference CLI + verification library (`bin/dcp.js`, `lib/verify.js`) and the conformance harness. V1 is verified in place; V2 is schema-validated there and then verified by `@dcp-ai/sdk`, so there is a single V2 implementation. It's the original entry point; most new users arrive via an SDK or a scaffolder instead.

## Where to change what

| You want to… | Edit |
|---|---|
| Propose a new artifact or tighten a schema | `spec/` + `schemas/`, then update every SDK in lockstep and add a conformance vector in `tests/conformance/`. |
| Fix a crypto bug in one language | `sdks/<language>/`. Add a regression test. If the bug could affect other languages, add a shared interop vector in `tests/interop/`. |
| Add a framework integration | `integrations/<framework>/`. Consume the SDK of the matching language as a dependency. Add a scaffolder in `packages/create-<framework>/` if it's mainline. |
| Change the marketing site | Not in this repository (see [Scope boundary](#scope-boundary)). |
| Change the documentation site | The Markdown sources and their four translations, `mkdocs.yml`, and the list of published documents in `scripts/docs-i18n.json`; `docs-site/` and `site/` are generated. See [CONTRIBUTING.md](../CONTRIBUTING.md#documentation-and-translations). |
| Change the interactive demo | `playground/`. |
| Deploy or re-deploy a service | `services/<name>/` + `deploy/fly/`. |
| Release a new SDK version | Bump the respective `package.json` / `Cargo.toml` / `pyproject.toml` / git tag; CI detects and publishes via `.github/workflows/publish*.yml`. Skip-if-already-published is built in. |

## Scope boundary

The monorepo contains the **protocol and its reference implementations**: spec, schemas, the five SDKs, framework integrations, scaffolders, CLI, operational services, smart contracts, docs, and the interactive playground. That's everything a third party needs to adopt DCP-AI.

End-user applications (dashboards, agents, demos) and marketing surfaces are intentionally **not** in this repo. They belong in whatever codebase hosts them — they're applications on top of the protocol, not part of it.

## Why monorepo today

A protocol with five SDKs lives or dies by keeping them wire-compatible. Reviewing one PR that touches all five together — and running the conformance suite against all five on every PR — is the lightest-weight way to enforce that invariant. The moment a specific SDK or a specific component grows its own community and its own cadence, splitting it out is a reasonable response. Until then, the overhead of coordinating multiple repos exceeds the benefits.

Further reading: the governance model in [`GOVERNANCE.md`](../GOVERNANCE.md) and the forward-looking direction in [`ROADMAP.md`](../ROADMAP.md).
