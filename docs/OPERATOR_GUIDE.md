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

## Reference

- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Storage and anchoring: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Bundle format: [spec/BUNDLE.md](../spec/BUNDLE.md)
