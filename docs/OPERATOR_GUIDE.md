# Operator Guide — Running a Verification Service

This guide is for **third parties** who want to run an "agent verified" service: an HTTP API that verifies DCP Signed Bundles (and optionally anchors hashes to a blockchain). The protocol does **not** require any central server; verification can always be done locally with `dcp verify-bundle`. This service is **optional** and is run at the operator's choice.

## What is an "agent verified" service?

An **agent verification service** is an HTTP API that:

1. **Verifies** a Signed Bundle: runs the same normative checklist as [spec/VERIFICATION.md](../spec/VERIFICATION.md) (schema validation, signature, intent_hash, audit chain, optional merkle_root).
2. Optionally **checks** an `anchor_receipt` against a public blockchain or transparency log (using public data only).
3. Optionally **anchors** a `bundle_hash` to an existing chain and returns an `anchor_receipt` to the client.

The service is **stateless**: each request receives a bundle (and optionally a public key), verifies it, and returns a result. No central registry of agents; the protocol does not define a canonical URL (e.g. no mandatory "dcp.ai" endpoint).

## Who runs it?

**Third parties.** Anyone can deploy this service using this repo (schemas + spec + CLI or programmatic API). The protocol author does not operate a central verification server.

## Requirements

- This repo (or the published npm package): schemas in `schemas/v1/`, spec in `spec/`.
- Ability to run verification: either the CLI (`dcp verify-bundle`) or the programmatic API (`verifySignedBundle`, `validateBundle`) from the repo.
- Optional, for anchoring: RPC or block explorer access to an existing chain (Bitcoin, Ethereum, or a transparency log). See [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md).

## Suggested API contract

So that clients and operators can interoperate, this section suggests a minimal contract. Implementations may extend it.

### POST /verify

Verifies a Signed Bundle against the normative checklist (schema, signature, intent_hash, audit chain, optional merkle).

- **Request (JSON):**
  - `signed_bundle` (object): the Signed Bundle to verify.
  - `public_key_b64` (string, optional): if the bundle does not include the signer's public key, provide it here. Otherwise the bundle's `signature.signer.public_key_b64` is used.

- **Response (JSON):**
  - `verified` (boolean): `true` if all checks pass.
  - `errors` (array of strings, optional): if `verified` is `false`, human-readable error messages.

Example:

```json
// Request
{ "signed_bundle": { "bundle": { ... }, "signature": { ... } } }

// Response (success)
{ "verified": true }

// Response (failure)
{ "verified": false, "errors": ["SIGNATURE INVALID", "Hint: Check that the public key ..."] }
```

### POST /anchor (optional)

Anchors a `bundle_hash` to a chain and returns an `anchor_receipt`. The operator configures chain and credentials (e.g. wallet, RPC URL). See [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) for receipt format.

- **Request (JSON):**
  - `bundle_hash` (string): e.g. `sha256:<hex>`.
  - `chain` (string): e.g. `"bitcoin"`, `"ethereum"`.

- **Response (JSON):**
  - `anchor_receipt` (object): e.g. `{ "chain": "bitcoin", "tx_id": "...", "block_height": N }` or Ethereum-style fields.

Implementation of `/anchor` depends on the operator's chain and tooling (Bitcoin OP_RETURN, Ethereum contract event, etc.).

## Deployment

The reference verification server, anchor service, transparency log, and revocation registry are all **published as Docker images** on GitHub Container Registry. In most cases you don't need to clone the repo at all — `docker run` is enough.

### Option 1 — pull the reference image (fastest)

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
curl http://localhost:3000/health
```

Multi-arch (`linux/amd64` + `linux/arm64`). Tags: `:latest`, `:2.0.3`, `:2.0`, `:2`, `:sha-<short>`. The full stack (verification + anchor + transparency log + revocation) can be brought up with one `docker compose up -d` using the compose file in `docker/`.

### Option 2 — managed PaaS

Pre-wired configs for Fly.io are in [`deploy/fly/`](../deploy/fly/); the [deployment guide](../deploy/README.md) also covers Google Cloud Run and Railway patterns.

### Option 3 — embed the verifier in your own service

If you want verification inside your existing application (no separate HTTP service), install the SDK for your language and call `verifySignedBundle` directly:

```bash
npm install @dcp-ai/sdk        # TypeScript / Node.js
pip install dcp-ai             # Python
cargo add dcp-ai               # Rust
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0
```

See each SDK's README for the exact import path and API surface. The SDKs cover 100% of the verification checklist in [VERIFICATION.md](../spec/VERIFICATION.md).

### Stateless by design

- **No database required** for verification: each request is self-contained.
- **Optional persistence** is only needed for: operator-run anchor service (to queue batches), transparency log (to accumulate the Merkle tree), revocation registry (to serve active revocations).

### Environment variables (verification service)

- `PORT` — HTTP port (default `3000`)
- `DCP_VERSION` — `2.0`
- `VERIFIER_MODE` — `classical_only` | `hybrid_preferred` | `hybrid_required`
- `REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING` — `true`/`false`
- `MAX_KEY_AGE_DAYS`, `ALLOW_V1_BUNDLES`, `PQ_CHECKPOINT_INTERVAL` — tuning knobs

For `anchor`, `transparency-log`, and `revocation` env variables see their respective README files under [`services/`](../services/) or the per-service `fly.toml` in [`deploy/fly/`](../deploy/fly/).

## Blockchain and verification

- **Verification only:** The service can limit itself to POST `/verify`, applying the full [VERIFICATION.md](../spec/VERIFICATION.md) checklist (schema, signature, intent_hash, audit chain, merkle). No blockchain needed.
- **Verify anchor_receipt:** If the client sends an `anchor_receipt` with the bundle, the service can optionally check that `bundle_hash` appears at the given chain/log index using **public data only** (e.g. fetch tx from block explorer). No central server of the protocol is involved.
- **Anchor (write):** The operator runs a node or uses RPC and writes hashes to an existing chain; the service returns `anchor_receipt` to the client. This is optional and operator-specific.

---

## V2.0 Verification Service

DCP v2.0 introduces post-quantum hybrid cryptography, adaptive security tiers, and composite signatures. Operators running verification services must update their configuration to support V2.

### Verifier Policy Configuration

The V2.0 verification server supports configurable policies via `VerifierPolicy`:

```json
{
  "default_mode": "hybrid_preferred",
  "risk_overrides": {
    "low": "classical_only",
    "medium": "hybrid_preferred",
    "high": "hybrid_required"
  },
  "min_accepted_version": "1.0",
  "accepted_algorithms": {
    "signing": ["ed25519", "ml-dsa-65", "ml-dsa-87"],
    "hash": ["sha256", "sha3-256"]
  }
}
```

Verification modes:
- `classical_only` — Only Ed25519 signatures required (V1 compatibility)
- `hybrid_preferred` — Ed25519 required, ML-DSA-65 checked if present
- `hybrid_required` — Both Ed25519 and ML-DSA-65 composite signature required
- `pq_only` — Only post-quantum signature required (future)

### POST /verify (V2)

V2 bundles include `composite_sig` with both classical and post-quantum components:

```json
{
  "signed_bundle": {
    "bundle": {
      "dcp_bundle_version": "2.0",
      "manifest": {
        "session_nonce": "a1b2c3...",
        "rpr_hash": "sha256:...",
        "passport_hash": "sha256:...",
        "intent_hash": "sha256:...",
        "policy_hash": "sha256:...",
        "audit_merkle_root": "sha256:...",
        "audit_merkle_root_secondary": "sha3-256:..."
      },
      "responsible_principal_record": { "payload": {...}, "composite_sig": {...} },
      "agent_passport": { "payload": {...}, "composite_sig": {...} },
      "intent": { "payload": {...}, "composite_sig": {...} },
      "policy_decision": { "payload": {...}, "composite_sig": {...} }
    },
    "signature": {
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }
}
```

V2 response includes the resolved security tier:

```json
{
  "verified": true,
  "version": "2.0",
  "resolved_tier": "elevated",
  "checks": {
    "schema": "pass",
    "classical_sig": "pass",
    "pq_sig": "pass",
    "manifest_integrity": "pass",
    "hash_chain": "pass",
    "session_nonce": "pass"
  }
}
```

### Security Tiers in Verification

The verification service respects and enforces security tiers:

| Tier | Verification Mode | PQ Checkpoint | Bundle Size |
|------|------------------|---------------|-------------|
| Routine | `classical_only` | Every 50 events | ~1-2 KB |
| Standard | `hybrid_preferred` | Every 10 events | ~2-5 KB |
| Elevated | `hybrid_required` | Every event | ~10-15 KB |
| Maximum | `hybrid_required` + verify checkpoint | Every event | ~15-25 KB |

The verifier can **upgrade** a tier (e.g., force `elevated` for financial operations) but MUST NOT **downgrade** it.

### Capabilities Endpoint (V2)

V2 services expose `GET /.well-known/dcp-capabilities.json`:

```json
{
  "supported_versions": ["1.0", "2.0"],
  "supported_algs": {
    "signing": ["ed25519", "ml-dsa-65", "ml-dsa-87", "slh-dsa-192f"],
    "kem": ["x25519-ml-kem-768"],
    "hash": ["sha256", "sha3-256"]
  },
  "supported_wire_formats": ["json", "cbor"],
  "features": {
    "composite_signatures": true,
    "pq_checkpoints": true,
    "dual_hash_chains": true,
    "a2a_protocol": true,
    "emergency_revocation": true,
    "lifecycle_management": true,
    "digital_succession": true,
    "dispute_resolution": true,
    "rights_framework": true,
    "personal_representation": true
  }
}
```

### Observability

V2 services should expose metrics for monitoring:

- **Latency**: p50/p95/p99 verification latency by security tier
- **Throughput**: Bundles verified per second
- **Cache**: Verification cache hit/miss ratio
- **PQ Checkpoints**: Number of PQ checkpoints verified
- **Errors**: Error counts by DCP error code (DCP-E001 through DCP-E902)
- **Tiers**: Distribution of verification requests by security tier

Recommended: Use the SDK's built-in `dcpTelemetry` module with OpenTelemetry-compatible exporters.

### Migration for Existing V1 Operators

Existing V1 operators can upgrade incrementally:

1. Update to DCP v2.0 SDK
2. Set `default_mode: 'classical_only'` (identical to V1 behavior)
3. Gradually enable `hybrid_preferred` for new agents
4. Move to `hybrid_required` when PQ adoption is sufficient

See [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for detailed migration steps.

## DCP-05–09 Service Endpoints

DCP v2.0 extends the verification server with 31 endpoints for lifecycle management, digital succession, dispute resolution, rights framework, and personal representation.

### DCP-05: Agent Lifecycle Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/lifecycle/commission` | Commission a new agent (creates commissioning certificate) |
| GET | `/v2/lifecycle/commission/:id` | Retrieve a commissioning certificate |
| POST | `/v2/lifecycle/vitality` | Submit a vitality report |
| GET | `/v2/lifecycle/vitality/:agent_id` | Get latest vitality report for an agent |
| POST | `/v2/lifecycle/decommission` | Record agent decommissioning |
| GET | `/v2/lifecycle/decommission/:id` | Retrieve a decommissioning record |
| POST | `/v2/lifecycle/transition` | Execute a lifecycle state transition (enforces state machine) |

Valid lifecycle transitions: `commissioned → active`, `active → declining`, `active → decommissioned`, `declining → decommissioned`.

### DCP-06: Digital Succession & Inheritance

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/succession/testament` | Register a digital testament |
| GET | `/v2/succession/testament/:id` | Retrieve a digital testament |
| POST | `/v2/succession/record` | Record a succession event |
| GET | `/v2/succession/record/:id` | Retrieve a succession record |
| POST | `/v2/succession/memory-transfer` | Submit a memory transfer manifest |
| GET | `/v2/succession/memory-transfer/:id` | Retrieve a memory transfer manifest |

### DCP-07: Conflict Resolution & Dispute Arbitration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/dispute/record` | File a dispute record |
| GET | `/v2/dispute/record/:id` | Retrieve a dispute record |
| POST | `/v2/dispute/arbitration` | Submit an arbitration resolution |
| GET | `/v2/dispute/arbitration/:id` | Retrieve an arbitration resolution |
| POST | `/v2/dispute/jurisprudence` | Register a jurisprudence bundle |
| GET | `/v2/dispute/jurisprudence/:id` | Retrieve a jurisprudence bundle |
| POST | `/v2/dispute/objection` | File an objection record |
| GET | `/v2/dispute/objection/:id` | Retrieve an objection record |

### DCP-08: Rights & Obligations Framework

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/rights/declaration` | Submit a rights declaration |
| GET | `/v2/rights/declaration/:id` | Retrieve a rights declaration |
| POST | `/v2/rights/obligation` | Record an obligation |
| GET | `/v2/rights/obligation/:id` | Retrieve an obligation record |
| POST | `/v2/rights/violation` | Report a rights violation |
| GET | `/v2/rights/violation/:id` | Retrieve a violation report |

### DCP-09: Personal Representation & Delegation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/delegation/mandate` | Create a delegation mandate |
| GET | `/v2/delegation/mandate/:id` | Retrieve a delegation mandate |
| POST | `/v2/delegation/advisory` | Submit an advisory declaration |
| GET | `/v2/delegation/advisory/:id` | Retrieve an advisory declaration |
| POST | `/v2/delegation/mirror` | Register a principal mirror |
| GET | `/v2/delegation/mirror/:id` | Retrieve a principal mirror |
| POST | `/v2/delegation/interaction` | Record an interaction |
| GET | `/v2/delegation/interaction/:id` | Retrieve an interaction record |
| POST | `/v2/awareness/threshold` | Configure an awareness threshold |
| GET | `/v2/awareness/threshold/:id` | Retrieve an awareness threshold |

### Production Hardening

All DCP-05–09 endpoints include:

- **JSON Schema validation** — Every POST request is validated against its corresponding schema before storage
- **Rate limiting** — 100 requests/minute/IP on all POST endpoints
- **Body size limits** — 1 MB maximum request body (returns 413)
- **Input ID validation** — All IDs must match `^[\w:.\-]{1,256}$` (blocks injection attacks)
- **Bounded storage** — In-memory stores capped at 10,000 entries with FIFO eviction
- **Security headers** — X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, Cache-Control

## Reference

- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Storage and anchoring: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Bundle format: [spec/BUNDLE.md](../spec/BUNDLE.md)
