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

- **Runtime:** Node.js (or any environment that can run the verification logic).
- **No database required:** the service is stateless; each request verifies the provided bundle.
- **Environment variables (suggested):**
  - `PORT`: HTTP port (e.g. `3000`).
  - Optional, for anchoring: `ANCHOR_CHAIN_RPC`, `ANCHOR_WALLET_KEY`, etc., depending on the chain.

**Steps:**

1. Clone or depend on this repo (or `npm install dcp-ai` if published).
2. Use the programmatic API: `import { verifySignedBundle, validateBundle } from 'dcp-ai'` (when installed via npm), or from `../lib/verify.js` when running from this repo; or shell out to `dcp verify-bundle` for each request.
3. Expose POST `/verify` (and optionally POST `/anchor`).
4. Deploy behind your preferred reverse proxy and TLS.

Optional: use the reference server in `server/` (see [server/README.md](../server/README.md)) as a starting point, or build your own with Express/Fastify/etc.

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
    "emergency_revocation": true
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

## Reference

- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Storage and anchoring: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Bundle format: [spec/BUNDLE.md](../spec/BUNDLE.md)
