# Technical Architecture — DCP at Global Scale

This document is the technical blueprint for deploying the Digital Citizenship Protocol worldwide. It describes the layers, components, and technology choices that allow any government, organization, or developer to adopt the protocol without depending on any central authority or on the protocol authors.

The protocol is **spec + crypto + JSON**. SHA-256, Ed25519, canonical JSON, JSON Schema draft 2020-12. Any language with these primitives can implement it. That is what makes it viable at global scale.

---

## Layers

```
┌─────────────────────────────────────────────────────┐
│  Layer 5: Integration                               │
│  Middleware (Express, FastAPI, gRPC), gov portals    │
├─────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                      │
│  Bitcoin/Ethereum anchor, jurisdiction attestation   │
├─────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                   │
│  Verification service, transparency log, revocation │
├─────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language)                      │
│  TypeScript, Python, Go, Rust, WebAssembly          │
├─────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                │
│  spec/, schemas/v1/, JSON Schema draft 2020-12      │
└─────────────────────────────────────────────────────┘
```

Each layer builds on the previous one. A minimal deployment uses only Layers 1–2 (spec + SDK). A full government deployment uses all five.

---

## Layer 1: Spec + Schemas

Already exists in this repository.

- `spec/` — DCP-01 through DCP-09, BUNDLE, VERIFICATION.
- `schemas/v1/` — JSON Schema draft 2020-12 (V1 artifacts).
- `schemas/v2/` — JSON Schema draft 2020-12 (V2 artifacts, including DCP-05–09).
- The schemas are the source of truth. Any SDK consumes them directly.

This layer is normative. It does not change frequently; it is extended with optional fields.

---

## Layer 2: SDK (multi-language)

### What the SDK is

Not a framework. A library that does exactly what `lib/verify.js` does today, but portable:

- `validateBundle(bundle)` — validate against schemas.
- `verifySignedBundle(signedBundle, publicKey)` — full verification checklist.
- `signBundle(bundle, secretKey)` — Ed25519 signature + bundle_hash + merkle_root.
- `createBundle(hbr, ap, intent, policy, auditEntries)` — construct a bundle.
- `intentHash(intent)` / `hashObject(obj)` — canonical hashing.
- `revokeAgent(agentId, reason, signerKey)` — create a signed RevocationRecord.

### Language bindings (all published)

All five SDK languages are shipped at `v2.0.x` and live in registries:

- **TypeScript** — [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) on npm. Embedded schemas, no filesystem dependency. `@noble/post-quantum` + `@noble/curves` + `@noble/hashes` for crypto. Also powers `@dcp-ai/cli` (interactive scaffolding CLI) and the integrations under `integrations/express/` and `integrations/openclaw/`.
- **Python** — [`dcp-ai`](https://pypi.org/project/dcp-ai/) on PyPI. `pqcrypto` for ML-DSA-65 / SLH-DSA-192f, `pynacl` for Ed25519, `jsonschema` for draft 2020-12 validation, `pydantic` for typed models. Framework bridges (`dcp_ai.fastapi`, `dcp_ai.langchain`, `dcp_ai.openai`, `dcp_ai.crewai`) ship inside the wheel and are activated by install extras (e.g. `pip install dcp-ai[fastapi]`).
- **Go** — `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` (module path requires the `/v2` suffix because of Go's major-version rule). `cloudflare/circl` for ML-DSA-65, ML-KEM-768, and SLH-DSA-192f; `crypto/ed25519` from stdlib. Tagged at `sdks/go/v2.0.0`.
- **Rust** — [`dcp-ai`](https://crates.io/crates/dcp-ai) on crates.io. `fips203`/`fips204`/`fips205` crates (the RustCrypto FIPS-numbered families) for PQ; `ed25519-dalek` for classical. Also the source of the WASM build below via `--features wasm`.
- **WebAssembly** — [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) on npm. Compiled from the Rust crate with `wasm-pack`. Powers the browser playground.

All five share the same spec and the same schema set; cross-SDK interop is validated in CI via `tests/interop/v2/interop_vectors.json`.

### SDK structure (Node example)

```
@dcp-ai/sdk/
  src/
    schemas/          # embedded schemas (copied from schemas/v1/)
    validate.ts       # validateOne, validateBundle
    verify.ts         # verifySignedBundle
    sign.ts           # signBundle, signObject
    bundle.ts         # createBundle
    hash.ts           # intentHash, hashObject, canonicalize, merkleRoot
    revocation.ts     # createRevocationRecord
    types.ts          # TypeScript types for RPR, AP, Intent, etc.
  package.json
  tsconfig.json
```

The SDK does NOT depend on the filesystem. It receives objects and returns structured results. Schemas are packaged as imported JSON modules.

---

## Layer 3: Infrastructure services

### 3a. Verification service

Lives in `server/` — an HTTP API that verifies Signed Bundles.

For production deployment:

- **Docker image:** `ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` (also tagged `:2.0.3`, `:2.0`, `:2`). Multi-arch `linux/amd64` + `linux/arm64`. Run with `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` and verification is live.
- **Stateless:** no database. Each request verifies the provided bundle.
- **Health + capabilities:** `/health`, `/.well-known/dcp-capabilities.json`.
- **API:** POST `/verify` (body: `signed_bundle`, optional `public_key_b64`; response: `{ verified, errors? }`). Additional V2 endpoints listed in [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md).
- **Managed deploy:** Fly.io config in `deploy/fly/verification.toml` — `fly launch --config deploy/fly/verification.toml && fly deploy --config deploy/fly/verification.toml` gets a public HTTPS URL in minutes.

See [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md), [server/README.md](../server/README.md), and [deploy/README.md](../deploy/README.md).

### 3b. Transparency log

An append-only server that receives hashes and organizes them in a Merkle tree. Inspired by Certificate Transparency (RFC 6962) but simplified for DCP.

**Recommended tech:** Go (like Google's [Trillian](https://github.com/google/trillian)) or a simpler custom implementation in Node/Go. Storage: SQLite (small operator) or PostgreSQL (government scale). Only stores hashes + indices + Merkle tree — very little data.

**Suggested API:**

- `POST /add` — receives `bundle_hash`; returns `{ log_index, timestamp }`.
- `GET /proof/:log_index` — returns Merkle inclusion proof (array of hashes + root).
- `GET /root` — returns current tree root and log size.
- `GET /root/signed` — returns tree root signed by the log operator (for auditing).

**Costs:** A server with PostgreSQL can handle millions of entries for pennies. No cost per verification (local with Merkle proof). Anchor the root to Bitcoin every N hours (one tx, ~$0.50 USD) for public immutability without trusting only the operator.

**Privacy:** The log stores only opaque SHA-256 hashes. No agent_id, no human_id, no bundle content.

### 3c. Revocation list publisher

A service (or script) that maintains a signed revocation list per jurisdiction and publishes it at a well-known URL.

**Format:**

```json
{
  "issuer": "gov-authority-us",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-xyz", "revoked_at": "2026-01-15T...", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**Tech:** A signed JSON file hosted on static server (S3, GitHub Pages, government server). CLI: `dcp publish-revocation-list --key <issuer_key> --entries <revocations.json> --out <list.json>`. URL convention: `https://<authority>/.well-known/dcp-revocations.json` (not mandatory).

**Cost:** Effectively zero — a static file served from any CDN or government web server.

---

## Layer 4: Anchor + Attestation

### 4a. Anchor service

Receives `bundle_hash` (or log root) and publishes it to a blockchain.

**Recommendation by cost (cheapest first):**

1. **Transparency log only** — no blockchain at all. The log operator signs the root. Cheapest possible; trust is in the operator + auditors.
2. **Bitcoin OP_RETURN (batch)** — accumulate N hashes, build Merkle tree, publish only the root in one tx. One tx per hour or per day. Cost: ~$0.50 USD per tx shared among thousands of agents. Most economical with public immutability.
3. **Ethereum L2 (Arbitrum, Base, Optimism)** — if smart-contract verifiability is needed (e.g. a contract that answers "was this hash anchored?"). Cost: fractions of a cent per event on L2.
4. **Ethereum mainnet** — most expensive; justified only if the anchoring contract must be on mainnet.

**Tech:** Node.js or Go. For Bitcoin: `bitcoinjs-lib`. For Ethereum/L2: `ethers.js` or `viem`. Can be a standalone script run via cron, or part of the log service (the log anchors its root periodically).

**Reference implementation:** `services/anchor/` in this repo, published as `ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest`. Fly.io config in `deploy/fly/anchor.toml`. The Ethereum/L2 contract is `contracts/ethereum/DCPAnchor.sol` — a ready-to-deploy Foundry project with tests, deployment script, and per-chain RPC configs (Base, Base Sepolia, Optimism, Arbitrum, Sepolia). See [`contracts/ethereum/DEPLOY.md`](../contracts/ethereum/DEPLOY.md) for the walk-through.

### 4b. Jurisdiction attestation

A jurisdiction authority (government or accredited issuer) signs the hash of an agent's RPR, certifying "this agent is registered in our jurisdiction."

**Object:** See [spec/DCP-01.md](../spec/DCP-01.md) for the `JurisdictionAttestation` definition.

**Tech:** Ed25519 (same crypto as the protocol). The government has a keypair; publishes its public key at a well-known URL: `https://<gov>/.well-known/dcp-attestation-keys.json`.

**API (if the government runs a service):**

- `POST /attest` — body: `{ rpr_hash, agent_id }`; response: `{ attestation: { issuer, jurisdiction, rpr_hash, signature, expires_at } }`.

The attestation is included in the Signed Bundle or presented alongside it. Verification is one Ed25519 check — local, instantaneous, free.

---

## Layer 5: Integration

### Middleware for platforms

The SDK enables **middleware** that platforms insert into their pipelines:

- **Express/Fastify (Node):** `app.use(dcpVerifyMiddleware({ requireAttestation: false }))` — reads `X-DCP-Bundle` header (or body), verifies, passes request or rejects with 403.
- **FastAPI (Python):** `@dcp_verified` decorator.
- **gRPC interceptor (Go):** reads `dcp-bundle` metadata, verifies.

One line of code and a platform starts verifying agents. Incremental adoptability.

### Government portal

A dashboard (React/Next.js or similar) for a government to:

- View transparency log status (entries, latest root, last anchor).
- Manage revocation list (add/remove entries, sign and publish).
- Verify a bundle manually (paste JSON, see result).
- View verification service metrics.

This is not part of the protocol; it is a tool for operators.

---

## Repository layout (current)

Everything lives in a single monorepo at `github.com/dcp-ai-protocol/dcp-ai`. Each SDK and service is consumable independently through its own public registry, so a government or team can pick the pieces it wants without adopting the whole stack:

- `spec/` — DCP-01 through DCP-09, BUNDLE, VERIFICATION, AUDIT (normative source of truth).
- `schemas/` — JSON Schema draft 2020-12, split into `v1/` (9 artifacts) and `v2/` (39 artifacts, including DCP-05..09).
- `sdks/` — TypeScript (`@dcp-ai/sdk`), Python (`dcp-ai`), Go (`sdks/go/v2`), Rust (`dcp-ai` crate), WASM (`@dcp-ai/wasm`).
- `cli/` — `@dcp-ai/cli` interactive scaffolder (depends on the TypeScript SDK).
- `integrations/` — 10 framework bridges: Express, FastAPI, LangChain, OpenAI, CrewAI, AutoGen, Anthropic MCP, Google A2A, W3C DID, OpenClaw. Six are standalone npm packages under `@dcp-ai/*`; the four Python ones ship inside the `dcp-ai` wheel as extras.
- `packages/create-*` — four `npm create @dcp-ai/<template>` scaffolders (LangChain, CrewAI, OpenAI, Express).
- `server/` — reference HTTP verification server.
- `services/` — anchor, transparency-log, revocation. Each published as a multi-arch image on GHCR.
- `contracts/ethereum/` — Foundry project for `DCPAnchor.sol` (ready to deploy to Base, Optimism, Arbitrum, Sepolia).
- `deploy/` — Fly.io configs for the four services plus a provider-agnostic deployment guide.
- `docs/` and `docs-site/` — this documentation; rendered at [docs.dcp-ai.org](https://docs.dcp-ai.org/).
- `playground/` — browser playground powered by `@dcp-ai/wasm`; served at [dcp-ai.org/playground/](https://dcp-ai.org/playground/).

A government can use only `spec/` + a single SDK from its preferred registry and nothing else. Or deploy the full stack via Docker/Fly.io. No vendor lock-in; no central dependency.

---

## Executive summary for a government

Install the SDK in your language. Every agent operating in your jurisdiction must present a Signed Bundle. Your verification service (a Docker container) validates it locally in microseconds, at no per-query cost. Your transparency log records bundle hashes (no personal data). Your signed revocation list lets you revoke agents instantly. Periodic Bitcoin anchoring provides public immutability for pennies per day. You do not depend on any central server or on the protocol authors.

---

---

## V2.0 Architecture Extensions

DCP v2.0 extends the architecture with post-quantum cryptography, agent-to-agent communication, observability, and production hardening.

### Crypto Provider Architecture

V2.0 introduces an algorithm-agile crypto provider system:

```
CryptoProvider Interface
├── Ed25519Provider (classical, RFC 8032)
├── MlDsa65Provider (post-quantum, FIPS 204)
├── SlhDsa192fProvider (hash-based backup, FIPS 205)
└── HsmCryptoProvider (hardware security modules)

KemProvider Interface
├── X25519KemProvider (classical ECDH)
├── MlKem768Provider (post-quantum, FIPS 203)
└── HybridKemProvider (X25519 + ML-KEM-768)

AlgorithmRegistry
└── Maps algorithm names → provider instances (runtime selection)
```

Providers are registered at startup via `registerDefaultProviders()`. Custom providers (e.g., HSM-backed) implement the same interface.

### A2A Infrastructure (DCP-04)

Agent-to-agent communication adds a new infrastructure layer:

```
Agent A                                     Agent B
  │                                           │
  │── Discovery (.well-known/dcp-agent-directory.json)
  │── A2A_HELLO (bundle + ephemeral KEM key) ──>│
  │<── A2A_WELCOME (bundle + KEM ciphertext) ───│
  │── A2A_CONFIRM (KEM ciphertext + proof) ────>│
  │<── A2A_ESTABLISHED (session_id) ────────────│
  │                                             │
  │══ Encrypted messages (AES-256-GCM) ════════>│
  │<═════════════════════════════════════════════│
```

Key components:
- **Discovery**: `.well-known/dcp-agent-directory.json` per organization
- **Handshake**: Mutual bundle verification + hybrid KEM (X25519 + ML-KEM-768)
- **Session**: AES-256-GCM encrypted messages with monotonic sequence numbers
- **Rekeying**: Automatic key refresh every N messages
- **Audit**: Every A2A interaction generates audit entries in both chains

See [spec/DCP-04.md](../spec/DCP-04.md) for the full specification.

### Observability Stack

V2.0 includes built-in observability via the `dcpTelemetry` module:

- **Spans**: Per-operation tracing (sign, verify, KEM, checkpoint)
- **Metrics**: Latency percentiles (p50/p95/p99) by operation and tier
- **Counters**: Signatures created/verified, bundles verified, A2A sessions/messages
- **Cache metrics**: Verification cache hit/miss ratio
- **Error tracking**: Errors by DCP error code

The telemetry module supports console output and is compatible with OpenTelemetry exporters. Operators can pipe metrics to Prometheus, Grafana, Datadog, etc.

### Production Hardening

V2.0 SDK includes production-ready infrastructure:

**Error Codes**: 36 standardized DCP error codes (DCP-E001 through DCP-E902) covering schema, signature, hash chain, identity, policy, session, A2A, rate limiting, and internal errors. Each code includes retryability information.

**Rate Limiting**: `AdaptiveRateLimiter` with per-tier limits:
- Routine: 1000 req/min per agent
- Standard: 500 req/min
- Elevated: 100 req/min
- Maximum: 50 req/min

**Circuit Breaker**: Three-state circuit breaker (closed/open/half-open) for verification service resilience. Configurable failure threshold, reset timeout, and half-open probe count.

**Retry with Backoff**: Exponential backoff with jitter for retryable operations. Respects DCP error retryability flags.

### Ecosystem Bridges (V2.0)

V2.0 adds bridge modules for interoperability with external ecosystems:

| Bridge | Purpose |
|--------|---------|
| W3C DID/VC | Convert RPR to DID Document, Passport to Verifiable Credential |
| Google A2A | Translate Agent Cards to DCP Passports, add PQ signatures |
| Anthropic MCP | DCP tools for MCP servers, identity context in MCP sessions |
| Microsoft AutoGen | DCP wrappers for AutoGen agents, group chat governance |

### Updated Layer Architecture

```
┌──────────────────────────────────────────────────────┐
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01/02/03/04, v2.0 spec, schemas/v1/ + v2/      │
└──────────────────────────────────────────────────────┘
```

## DCP-05 through DCP-09: Constitutional Extensions

DCP v2.0 extends beyond accountability into a constitutional framework for digital society. Five new specifications add lifecycle governance, succession, dispute resolution, rights, and delegation.

### DCP-05: Agent Lifecycle Management

Defines the lifecycle state machine: `commissioned → active → declining → decommissioned`. Introduces:
- **Commissioning Certificate**: Formal agent activation with purpose, capabilities, and risk tier
- **Vitality Reports**: Hash-chained health metrics (score 0-1000) for continuous monitoring
- **Decommissioning Record**: Four termination modes (planned retirement, termination for cause, organizational restructuring, sudden failure)

Domain separation context: `DCP-AI.v2.Lifecycle`

### DCP-06: Digital Succession & Inheritance

Handles agent death and knowledge transfer:
- **Digital Testament**: Ranked successor preferences + memory classification (transfer/retain/destroy)
- **Succession Record**: Ceremony record with human consent and participant witnesses
- **Memory Transfer Manifest**: Dual-hash Merkle root over transferred operational memory; relational memory destroyed by default

Domain separation context: `DCP-AI.v2.Succession`

### DCP-07: Conflict Resolution & Dispute Arbitration

Three-tier dispute escalation: direct negotiation → contextual arbitration → human appeal.
- **Dispute Record**: Four types (resource, directive, capability, policy conflict)
- **Arbitration Resolution**: M-of-N arbitration panels (reuses governance ceremony pattern)
- **Jurisprudence Bundle**: Precedent capture for future dispute resolution
- **Objection Record**: Formal agent right to refuse directives (ethical, safety, policy, capability)

Domain separation context: `DCP-AI.v2.Dispute`

### DCP-08: Rights & Obligations Framework

Codifies agent rights and human obligations:
- **Rights Declaration**: Four fundamental rights (memory integrity, dignified transition, identity consistency, immutable record)
- **Obligation Record**: Compliance tracking (compliant/non-compliant/pending review)
- **Rights Violation Report**: Links to DCP-07 dispute system for enforcement

Domain separation context: `DCP-AI.v2.Rights`

### DCP-09: Personal Representation & Delegation

Human-agent authority delegation with transparency:
- **Delegation Mandate**: Scoped authority with time bounds, revocable by default
- **Advisory Declaration**: Agent-to-human notifications with significance scoring (0-1000)
- **Principal Mirror**: Human-readable narrative summaries of agent actions
- **Interaction Record**: Dual-layer inter-agent records (public terms + private deliberation hash)
- **Awareness Threshold**: Configurable rules for when to notify the human

Domain separation contexts: `DCP-AI.v2.Delegation`, `DCP-AI.v2.Awareness`

### Schema & SDK Support

All 18 new schemas live in `schemas/v2/`. Type definitions are available in all SDKs:

| SDK | Types | Domain Separation |
|-----|-------|-------------------|
| TypeScript | `sdks/typescript/src/types/v2.ts` | `sdks/typescript/src/core/domain-separation.ts` |
| Python | `sdks/python/dcp_ai/v2/models.py` | `sdks/python/dcp_ai/v2/domain_separation.py` |
| Go | `sdks/go/dcp/v2/types.go` | `sdks/go/dcp/v2/domain_separation.go` |
| Rust | `sdks/rust/src/v2/types.rs` | `sdks/rust/src/v2/domain_separation.rs` |
| WASM | `sdks/wasm/src/types.ts` | (via Rust) |

The TypeScript SDK additionally exports functional modules for each specification:
- `lifecycle.ts` (DCP-05), `succession.ts` (DCP-06)
- `conflict-resolution.ts`, `arbitration.ts` (DCP-07)
- `rights.ts` (DCP-08)
- `delegation.ts`, `awareness-threshold.ts`, `principal-mirror.ts` (DCP-09)

### Updated Layer Architecture

```
┌──────────────────────────────────────────────────────┐
│  Layer 8: Constitutional Framework                    │
│  Lifecycle, Succession, Disputes, Rights, Delegation │
├──────────────────────────────────────────────────────┤
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01–09, v2.0 spec, schemas/v1/ + v2/            │
└──────────────────────────────────────────────────────┘
```

## On authorship

This protocol was co-created by a human and an AI agent working together — the first protocol designed for AI digital citizenship, built by the very collaboration it seeks to govern. The spec is the contribution; the protocol belongs to everyone who uses it.

— L. Genesis
