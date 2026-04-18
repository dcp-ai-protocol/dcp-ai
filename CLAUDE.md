# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**dcp-ai** is the reference implementation of the Digital Citizenship Protocol for AI Agents — a portable accountability layer that lets any verifier evaluate who is responsible for an agent, what it declared it intended to do, what policy outcome was applied, and what audit evidence was produced. All artifacts are cryptographically signed, hash-chained, and independently verifiable.

This is a polyglot monorepo. The root `package.json` is the reference Node.js implementation; each SDK and integration under `sdks/` and `integrations/` is independently installable with its own build tooling.

## Build & Test Commands

### Root (reference JS implementation)

```bash
npm install
npm test                       # alias for conformance
npm run conformance            # V1 + V2 protocol conformance (schemas + examples)
npm run validate               # Validate bundles against JSON schemas
npm run server                 # Start verification server (port 3000)
npm run examples:generate      # Generate V1 example bundles
npm run examples:generate:v2   # Generate V2 example bundles
npx prettier --write .
npx eslint --fix .
```

The `dcp` CLI is the lower-level reference binary (`bin/dcp.js`). The interactive wizard lives in `cli/` and is published as `@dcp-ai/cli`.

### SDKs (each is independent)

```bash
cd sdks/typescript && npm install && npm run test      # Vitest + coverage; tsup build
cd sdks/python     && pip install -e ".[dev]" && pytest -v
cd sdks/go         && go test ./...
cd sdks/rust       && cargo test
cd sdks/wasm       && npm test                          # requires wasm-pack
```

Run a single TS test: `cd sdks/typescript && npx vitest run path/to/file.test.ts`.
Run a single Python test: `cd sdks/python && pytest tests/test_foo.py::test_bar -v`.

Python SDK optional extras (from `sdks/python/pyproject.toml`): `fastapi`, `langchain`, `openai`, `crewai`, `dev`.

### Services & contracts

- `server/` — reference verification HTTP API (port 3000, `npm run server`)
- `services/anchor/` — blockchain anchoring (port 3001)
- `services/transparency-log/` — CT-style Merkle log (port 3002)
- `services/revocation/` — agent revocation registry (port 3003)
- `contracts/ethereum/DCPAnchor.sol` — EVM L2 anchor contract
- `docker/` — `docker compose up -d` starts the full service stack

## Architecture

### Protocol layers

1. **Core** (`spec/core/`, `spec/DCP-01..04.md`) — the minimum interoperable protocol. Six artifacts: Responsible Principal Record, Agent Passport, Intent Declaration, Policy Decision, Action Evidence (hash-chained audit entries), Bundle Manifest.
2. **Profiles** (`spec/profiles/`) — optional extensions: `crypto/` (algorithms, hybrid PQ, crypto-agility, verifier policy), `a2a/` (agent-to-agent discovery/handshake/transport), `governance/` (risk tiers, revocation, key recovery).
3. **Services** — operational infrastructure, not normative.

Released protocol versions coexist: V1 uses classical Ed25519; V2.0 adds hybrid post-quantum. `lib/verify.js` auto-detects via `dcp_version === "2.0"` / `signature.binding === "composite"` / presence of `bundle_manifest`. Schemas are split under `schemas/v1/` (9 schemas) and `schemas/v2/` (21 schemas). Any change that affects the wire format must update the matching JSON Schema — conformance validates every example against its schema.

### Key components

- `lib/verify.js` — the package main export; programmatic verification API used by both the CLI and `server/`
- `bin/dcp.js` — reference CLI (bundle sign/verify, key gen); validates paths are inside CWD via `safePath()`
- `cli/` — separate npm package `@dcp-ai/cli` (depends on `sdks/typescript` via `file:` link) with interactive wizard and starter templates
- `tools/` — `validate.js`, `conformance.js`, `crypto.js` (classical + composite verify), `merkle.js` (canonicalization, dual SHA-256 + SHA3-256 hash chains, Merkle roots), `bundle_sign.js`, `bundle_verify.js`
- `schemas/` — JSON Schema draft 2020-12; loaded by Ajv with `ajv-formats` in `lib/verify.js`
- `api/openapi.yaml` + `api/proto/` — REST + gRPC contracts
- `tests/conformance/` (examples + V2 fixtures), `tests/interop/v2/` (cross-SDK), `tests/nist-kat/` (NIST Known Answer Tests for Ed25519 and ML-DSA-65)

### Python SDK layout (`sdks/python/dcp_ai/`)

- Top-level V1: `bundle.py`, `crypto.py`, `merkle.py`, `models.py` (Pydantic v2), `schema.py`, `verify.py`, `cli.py` (Typer, entry point `dcp`)
- V2 subpackage `v2/`: `composite_ops.py`, `composite_sig.py`, `canonicalize.py`, `domain_separation.py`, `dual_hash.py`, `crypto_provider.py` + `crypto_registry.py`, `blinded_rpr.py`, `multi_party_auth.py`, `proof_of_possession.py`, `signed_payload.py`, `algorithm_advisory.py`
- `providers/` — pluggable signature providers: `ed25519_provider.py`, `ml_dsa_65_provider.py`, `slh_dsa_192f_provider.py`. New algorithms plug in here and register with `crypto_registry`.

### Cryptography

V2 implements a 4-tier security model (Routine → Standard → Elevated → Maximum) using hybrid classical + post-quantum primitives:

| Algorithm | Standard | Purpose |
|-----------|----------|---------|
| Ed25519 | RFC 8032 | classical signatures |
| ML-DSA-65 | FIPS 204 | PQ signatures (Dilithium) |
| ML-KEM-768 | FIPS 203 | PQ KEM (Kyber) |
| SLH-DSA-192f | FIPS 205 | hash-based backup signatures (SPHINCS+) |
| SHA-256 + SHA3-256 | FIPS 180-4 / 202 | dual hash chains for audit integrity |

Node dependencies: `tweetnacl` (Ed25519), `@noble/post-quantum` (ML-DSA, ML-KEM, SLH-DSA), `secrets.js-grempe` (Shamir split for recovery). Audit chains are dual-hashed (SHA-256 + SHA3-256) so V2 bundles survive a single-hash break.

### Integrations (`integrations/`)

Ten framework bindings, each its own package: `express`, `fastapi`, `langchain`, `openai`, `crewai`, `openclaw`, `w3c-did`, `google-a2a`, `anthropic-mcp`, `autogen`. TypeScript integrations typically depend on `sdks/typescript` via a local link; Python integrations are exposed through `dcp-ai[<extra>]` extras.

## Code Style

- **JS/TS**: Prettier (100 col, single quotes, trailing commas, 2-space indent). ESLint: `prefer-const`, `no-var`, unused vars prefixed with `_`.
- **Python**: Python 3.10+, Pydantic v2 models, Typer CLI.

## Commit Conventions

Conventional commits: `<type>(<scope>): <summary>`.

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
- Scopes: `core`, `sdk/ts`, `sdk/py`, `sdk/go`, `sdk/rust`, `sdk/wasm`, `integration/<name>`, `ci`

Examples: `feat(sdk/ts): add post-quantum signature support`, `fix(core): correct Merkle root for single-entry chains`.
