# Reference verification service

Optional HTTP API for verifying DCP Signed Bundles. **Stateless**; no database. Run by third parties; the protocol does not require a central server.

## Endpoints

- **GET /**, **GET /health** — Health check; returns `{ ok: true, service: "dcp-verification" }`.
- **POST /verify** — Verifies a Signed Bundle (schema, signature, intent_hash, audit chain, merkle). Request body: `{ "signed_bundle": { ... }, "public_key_b64": "..." }` (optional if bundle includes `signature.signer.public_key_b64`). Response: `{ "verified": true }` or `{ "verified": false, "errors": ["..."] }`.
- **POST /anchor** — Stub (returns 501). Implement anchoring (e.g. Bitcoin OP_RETURN, Ethereum event) per operator; see [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) and [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md).

## Run from repo root

```bash
# From repo root
npm install
node server/index.js
```

- **PORT** (default `3000`): set `PORT=4000 node server/index.js` or `export PORT=4000`.

## Example

```bash
# Health
curl -s http://localhost:3000/health

# Verify (body: signed_bundle + optional public_key_b64)
curl -s -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": { "bundle": { ... }, "signature": { ... } }}'
# -> { "verified": true } or { "verified": false, "errors": [...] }
```

## Deployment

- Run behind a reverse proxy (e.g. nginx) and TLS in production.
- Optional: use a process manager (e.g. systemd, PM2).
- For **anchoring**, implement POST /anchor using your chain (Bitcoin, Ethereum, or transparency log) and configure env (e.g. `ANCHOR_CHAIN_RPC`, wallet). The reference server does not implement anchoring.

## Reference

- [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) — Operator guide (running a verification service)
- [spec/VERIFICATION.md](../spec/VERIFICATION.md) — Normative verification checklist
