# DCP Reference Gateway

HTTP verification service implementing V1, V2, and Phase 3 (PQ-First) of the Digital Citizenship Protocol. **In-memory storage** — no external database required. Designed to be run by any third party; the protocol does not require a central server.

## Quick Start

```bash
npm install
node server/index.js
# or: npm run server
```

Default port: `3000`. Override with `PORT=4000 node server/index.js`.

## Endpoints

### Core

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` , `/health` | Health check — `{ ok, service, version, capabilities }` |
| GET | `/.well-known/dcp-capabilities.json` | Protocol capability discovery (algorithms, features, wire formats) |
| POST | `/verify` | Verify a signed bundle (auto-detects V1 or V2; V2 is checked against `VERIFIER_POLICY`) |
| POST | `/anchor` | Stub — returns 501 (implement per operator) |

### V2: Identity & Intent

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/passport/register` | Register agent passport with composite keys |
| POST | `/v2/intent/declare` | Declare intent, receive policy decision |
| POST | `/v2/audit/append` | Append audit event to agent's chain |
| POST | `/v2/audit/compact` | Compact audit chain with Merkle summary |
| POST | `/v2/bundle/verify` | Full V2 bundle verification: schema, manifest, composite Ed25519 + ML-DSA-65 signature, session binding and audit chain (via `lib/verify.js` and `@dcp-ai/sdk`), against `VERIFIER_POLICY`. V1 bundles get 400 |

### V2: Key Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/keys/:kid` | Lookup key by deterministic key ID |
| POST | `/v2/keys/rotate` | Key rotation with proof of possession |
| POST | `/v2/emergency-revoke` | Emergency revocation (panic button) |

### V2: Multi-Party & Governance

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/multi-party/authorize` | M-of-N multi-party authorization |
| POST | `/v2/governance/register` | Register governance key set |
| GET | `/.well-known/governance-keys.json` | Published governance keys |

### Phase 3: Policy & Advisories

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/policy` | Current verifier policy (mode, algorithms, constraints) |
| POST | `/v2/policy/mode` | Switch verifier mode (hybrid_required, pq_preferred, etc.) |
| GET | `/.well-known/algorithm-advisories.json` | Published algorithm advisories |
| POST | `/v2/advisory/publish` | Publish an algorithm advisory |
| GET | `/v2/advisory/check` | Check if specific algorithms are affected |
| POST | `/v2/advisory/auto-apply` | Auto-apply advisories to verifier policy |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |

The verifier policy (`hybrid_required` for every risk tier, session binding required, 365-day key age) is set in code (`VERIFIER_POLICY` in `server/index.js`) and can be inspected at `GET /v2/policy`. The `VERIFIER_MODE`, `REQUIRE_SESSION_BINDING`, `MAX_KEY_AGE_DAYS` and `ALLOW_V1_BUNDLES` variables that appear in the Docker and Fly configs are not read yet.

## Usage Examples

### Health Check

```bash
curl -s http://localhost:3000/health | jq .
```

### V1 Bundle Verification

```bash
curl -s -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": { ... },
      "signature": { "alg": "ed25519", "sig_b64": "...", "signer": { "public_key_b64": "..." } }
    }
  }'
```

### V2 Passport Registration

```bash
curl -s -X POST http://localhost:3000/v2/passport/register \
  -H "Content-Type: application/json" \
  -d '{
    "passport": {
      "schema_id": "DCP-01",
      "schema_version": "2.0",
      "agent_id": "agent-001",
      "keys": [
        { "kid": "abc123", "algorithm": "Ed25519", "public_key_b64": "..." },
        { "kid": "def456", "algorithm": "ML-DSA-65", "public_key_b64": "..." }
      ],
      "session_nonce": "random-hex"
    }
  }'
```

### V2 Intent Declaration

```bash
curl -s -X POST http://localhost:3000/v2/intent/declare \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "intent": {
      "schema_id": "DCP-02",
      "schema_version": "2.0",
      "action": "data_query",
      "target_resource": "user_profiles",
      "data_classes": ["PII"],
      "security_level": "elevated"
    }
  }'
```

### V2 Bundle Verification

```bash
curl -s -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": {
        "dcp_bundle_version": "2.0",
        "manifest": { "session_nonce": "...", "rpr_hash": "sha256:...", ... },
        "responsible_principal_record": { "payload": { ... }, "payload_hash": "sha256:...", "composite_sig": { ... } },
        "agent_passport": { ... },
        "intent": { ... },
        "policy_decision": { ... },
        "audit_entries": [ ... ]
      },
      "signature": {
        "hash_alg": "sha256",
        "created_at": "...",
        "signer": { "type": "human", "id": "...", "kids": ["..."] },
        "manifest_hash": "sha256:...",
        "composite_sig": {
          "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
          "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
          "binding": "pq_over_classical"
        }
      }
    },
    "public_key_b64": "..."
  }'
```

The format is `schemas/v2/signed_bundle.schema.json`; build it with `BundleBuilderV2` + `signBundleV2` from `@dcp-ai/sdk` or `dcp sign-bundle --composite`. `public_key_b64` is optional and pins the classical signer. The pre-normative envelope (top-level `dcp_version` / `bundle_manifest`) is rejected.

### Emergency Revocation

```bash
curl -s -X POST http://localhost:3000/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "reason": "key_compromise",
    "revoke_all_keys": true,
    "timestamp": "2026-03-01T00:00:00Z"
  }'
```

### Capability Discovery

```bash
curl -s http://localhost:3000/.well-known/dcp-capabilities.json | jq .
```

## Architecture

```
                    ┌──────────────────────────┐
                    │    DCP Reference Gateway  │
                    ├──────────────────────────┤
                    │  V1 Verification          │
                    │  V2 Composite Verification│
                    │  Key Registry (in-memory) │
                    │  Audit Chains (in-memory) │
                    │  Policy Engine (Phase 3)  │
                    │  Advisory System           │
                    │  Governance Keys           │
                    └──────────────────────────┘
```

## Limitations

- **In-memory storage**: all state (passports, keys, audit chains, advisories) is lost on restart. Production deployments should add persistent storage.
- **Signatures outside bundle verification**: bundle verification checks real Ed25519 and ML-DSA-65 / SLH-DSA signatures. `/v2/passport/register`, `/v2/keys/rotate`, `/v2/multi-party/authorize`, `/v2/advisory/publish` and `/v2/governance/register` do not verify signatures yet.
- **No authentication**: admin endpoints (`/v2/policy/mode`, `/v2/governance/register`, `/v2/advisory/*`) are open, so anyone who can reach the gateway can change its policy. Do not expose it publicly as-is.
- **Anchoring**: `POST /anchor` returns 501. Implement using your blockchain (Ethereum, Bitcoin) or transparency log.

## Deployment

- Run behind a reverse proxy (nginx, Caddy) with TLS in production.
- Use a process manager (systemd, PM2) for automatic restarts.
- See [Docker setup](../docker/README.md) for containerized deployment.

## Reference

- [spec/VERIFICATION.md](../spec/VERIFICATION.md) — Normative verification checklist
- [spec/DCP-AI-v2.0.md](../spec/DCP-AI-v2.0.md) — V2 protocol specification
- [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) — Operator guide
