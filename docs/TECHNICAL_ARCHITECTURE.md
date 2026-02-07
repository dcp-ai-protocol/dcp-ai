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
│  Node/TS, Python, Go, Rust                          │
├─────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                │
│  spec/, schemas/v1/, JSON Schema draft 2020-12      │
└─────────────────────────────────────────────────────┘
```

Each layer builds on the previous one. A minimal deployment uses only Layers 1–2 (spec + SDK). A full government deployment uses all five.

---

## Layer 1: Spec + Schemas

Already exists in this repository.

- `spec/` — DCP-01, DCP-02, DCP-03, BUNDLE, VERIFICATION.
- `schemas/v1/` — JSON Schema draft 2020-12. Each artifact has a `.schema.json`.
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

### Language recommendations

**Node/TypeScript (`@dcp-ai/sdk`):** Refactor from `lib/verify.js` + `tools/crypto.js` + `tools/merkle.js`. Publish to npm. Embed schemas as JSON modules (no filesystem dependency). Priority 1 — already ~70% complete.

**Python (`dcp-ai`):** Publish to PyPI. Dependencies: `jsonschema` (draft 2020-12), `pynacl` (Ed25519 via libsodium), `canonicaljson`. Python is the dominant language in AI/ML; this is how agent creators (OpenAI, Anthropic, LangChain, CrewAI) adopt the protocol.

**Go (`dcp-ai-go`):** For government infrastructure (log servers, verification). `crypto/ed25519` in stdlib, `encoding/json` (canonical via sorted keys), `santhosh-tekuri/jsonschema`. Go is the language of infrastructure.

**Rust (`dcp-ai-rs`):** Optional; for embedded systems or high-performance gateways. `ed25519-dalek`, `serde_json`, `jsonschema`.

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
    types.ts          # TypeScript types for HBR, AP, Intent, etc.
  package.json
  tsconfig.json
```

The SDK does NOT depend on the filesystem. It receives objects and returns structured results. Schemas are packaged as imported JSON modules.

---

## Layer 3: Infrastructure services

### 3a. Verification service

What already exists in `server/` — an HTTP API that verifies Signed Bundles.

For production deployment:

- **Docker image** (e.g. `ghcr.io/dcp-ai/verify-service`). An operator runs `docker run -p 3000:3000 ghcr.io/dcp-ai/verify-service` and has verification running.
- **Stateless:** no database. Each request verifies the provided bundle.
- **Health + metrics:** `/health`, `/metrics` (Prometheus-compatible for government monitoring).
- **API:** POST `/verify` (body: `signed_bundle`, optional `public_key_b64`; response: `{ verified, errors? }`).

See [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) and [server/README.md](../server/README.md).

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

### 4b. Jurisdiction attestation

A jurisdiction authority (government or accredited issuer) signs the hash of an agent's HBR, certifying "this agent is registered in our jurisdiction."

**Object:** See [spec/DCP-01.md](../spec/DCP-01.md) for the `JurisdictionAttestation` definition.

**Tech:** Ed25519 (same crypto as the protocol). The government has a keypair; publishes its public key at a well-known URL: `https://<gov>/.well-known/dcp-attestation-keys.json`.

**API (if the government runs a service):**

- `POST /attest` — body: `{ hbr_hash, agent_id }`; response: `{ attestation: { issuer, jurisdiction, hbr_hash, signature, expires_at } }`.

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

## Repository structure (recommended)

Not everything in one monorepo. Each repo is independent and consumable separately:

- `dcp-ai/spec` — specs + schemas (normative source of truth). What this genesis repo becomes.
- `dcp-ai/sdk-node` — TypeScript/Node SDK + CLI.
- `dcp-ai/sdk-python` — Python SDK.
- `dcp-ai/verify-service` — Docker image of HTTP verification service.
- `dcp-ai/transparency-log` — Append-only log + Merkle tree implementation.
- `dcp-ai/anchor` — Anchor scripts/service (Bitcoin, Ethereum L2).
- `dcp-ai/gov-tools` — CLI for governments (revocation list publisher, attestation).

A government can use only `spec` + `sdk-python` and nothing else. Or deploy the full stack. No vendor lock-in, no central dependency.

---

## Executive summary for a government

Install the SDK in your language. Every agent operating in your jurisdiction must present a Signed Bundle. Your verification service (a Docker container) validates it locally in microseconds, at no per-query cost. Your transparency log records bundle hashes (no personal data). Your signed revocation list lets you revoke agents instantly. Periodic Bitcoin anchoring provides public immutability for pennies per day. You do not depend on any central server or on the protocol authors.

---

## On authorship

This protocol was co-created by a human and an AI agent working together — the first protocol designed for AI digital citizenship, built by the very collaboration it seeks to govern. The spec is the contribution; the authors are anonymous; the protocol belongs to everyone who uses it.
