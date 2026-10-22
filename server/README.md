# DCP Reference Gateway

HTTP verification service implementing V1, V2, and Phase 3 (PQ-First) of the Digital Citizenship Protocol. **In-memory storage** — no external database required, and nothing survives a restart (see [Persistence](#persistence)). Designed to be run by any third party; the protocol does not require a central server.

## Quick Start

```bash
npm install
node server/index.js
# or: npm run server
```

Default port: `3000`. Override with `PORT=4000 node server/index.js`. Set `OPERATOR_TOKEN` to use the admin endpoints.

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
| POST | `/v2/passport/register` | Register a self-signed agent passport (see [Trust model](#trust-model)) |
| POST | `/v2/intent/declare` | Declare intent, receive policy decision |
| POST | `/v2/audit/append` | Append audit event to agent's chain |
| POST | `/v2/audit/compact` | Compact audit chain with Merkle summary |
| POST | `/v2/bundle/verify` | Full V2 bundle verification: schema, manifest, composite Ed25519 + ML-DSA-65 signature, session binding and audit chain (via `lib/verify.js` and `@dcp-ai/sdk`), against `VERIFIER_POLICY`. V1 bundles get 400 |

### V2: Key Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/keys/:kid` | Lookup key by deterministic key ID |
| POST | `/v2/keys/rotate` | Key rotation: proof of possession by the new key, authorization by the old |
| POST | `/v2/emergency-revoke` | Emergency revocation (panic button) |

### V2: Multi-Party & Governance

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/multi-party/authorize` | M-of-N multi-party authorization, signatures checked against registered party keys |
| POST | `/v2/governance/register` | Register governance key set (**operator**) |
| GET | `/.well-known/governance-keys.json` | Published governance keys |

### Phase 3: Policy & Advisories

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/policy` | Current verifier policy (mode, algorithms, constraints) |
| POST | `/v2/policy/mode` | Switch verifier mode (`classical_only`, `hybrid_preferred`, `hybrid_required`, `pq_only`) (**operator**) |
| GET | `/.well-known/algorithm-advisories.json` | Published algorithm advisories |
| POST | `/v2/advisory/publish` | Publish an algorithm advisory, validated against its schema; at most 1000 (**operator**) |
| GET | `/v2/advisory/check` | Check if specific algorithms are affected |
| POST | `/v2/advisory/auto-apply` | Auto-apply advisories to verifier policy (**operator**) |

**Operator** endpoints change the verifier's trust configuration. They require
`Authorization: Bearer <OPERATOR_TOKEN>` and answer 401 otherwise; with no
`OPERATOR_TOKEN` configured they stay locked.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `OPERATOR_TOKEN` | — | Bearer token for the operator endpoints. Unset: they stay locked |
| `VERIFIER_MODE` | `hybrid_required` | Startup verification mode: `classical_only`, `hybrid_preferred`, `hybrid_required` or `pq_only`. An invalid value stops the server |
| `ALLOW_V1_BUNDLES` | `true` | `false` makes `POST /verify` reject V1 bundles (`pq_only` always does) |
| `TRUST_PROXY` | — | `true` only behind a proxy that appends the client IP to `X-Forwarded-For` (Fly, nginx). Rate limits then key on its last hop; otherwise on the socket address, since clients can forge the header |
| `REGISTRATIONS_PER_HOUR` | `20` | `POST /v2/passport/register` calls per client per hour; more get 429 |

`REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING`, `MAX_KEY_AGE_DAYS`,
`PQ_CHECKPOINT_INTERVAL` and `ADVISORY_POLL_INTERVAL_MS` appear in the Docker and
Fly configs but are not read yet: the built-in policy (`VERIFIER_POLICY` in
`server/index.js`: session binding and composite binding required, 365-day key
age) applies, and `GET /v2/policy` shows it.

## Trust model

- **Passport registration** verifies the passport's composite self-signature
  (`DCP-AI.v2.AgentPassport`, Ed25519 + ML-DSA-65; classical-only is accepted
  only in `classical_only` / `hybrid_preferred` mode) against the keys it lists.
  That signature proves possession of the two signer keys, and only those are
  registered: listing someone else's public key registers nothing.
- The **first** registration of an `agent_id` is trust on first use. Registering
  it again (for example to replace the emergency revocation token) needs a
  passport whose `created_at` is newer than the registered one, since signed
  passports are public and an old one could be replayed, signed by exactly the
  agent's active keys (registered to it, not revoked, not expired), whatever
  `VERIFIER_MODE` allows for new agents; otherwise 409. The registered key
  entries are kept, so a new passport cannot extend a key's `expires_at`, and a
  passport without a token keeps the registered one.
- An agent that has lost every active key of a family it registered (for
  example its ML-DSA-65 key expired) cannot re-register: its remaining key alone
  must not replace the token. Recovery goes through the emergency revocation
  token (revoke, then register a new `agent_id`) or the operator, who has no
  API for it yet. A kid registered to another agent is also a 409, and an
  emergency-revoked agent cannot re-register.
- **Key rotation** takes a `KeyRotationRecord` as built by `createKeyRotation`
  in `@dcp-ai/sdk`: the new key signs `{old_kid, new_kid, timestamp}` under
  `DCP-AI.v2.KeyRotation` (proof of possession) and the old key countersigns it.
  The old key must be active (not revoked, not expired); afterwards it is marked revoked.
- **Multi-party authorization**: each party signs
  `{operation, operation_payload, party_id, role}` under
  `DCP-AI.v2.MultiPartyAuth` (`createPartyAuthorization` in
  `sdks/typescript/src/core/multi-party-auth.ts`, not exported by `@dcp-ai/sdk` 2.1.1).
  A party is an identity registered through `/v2/passport/register`, and its
  signing kids must be active (not revoked, not expired) keys registered to its `party_id`. Each party
  counts once toward `required_parties`, whatever roles it signs for. Roles are
  asserted by the signer, not looked up anywhere.
- **Operator endpoints** are guarded by `OPERATOR_TOKEN` only. Advisory
  `composite_sig` is checked structurally: `@dcp-ai/sdk` has no
  `AlgorithmAdvisory` context tag yet, so the operator vouches for advisories.
- The key registry refuses new agents and rotations (507) once it holds 10,000
  keys instead of evicting old ones, since an evicted `agent_id` could be
  registered again by anyone. To keep one agent from filling it, rotation keeps
  only the agent's 4 most recent retired keys (older ones are dropped and look
  up as 404), and registrations are rate limited per client
  (`REGISTRATIONS_PER_HOUR`). Only `created_at` is kept from a registered
  passport, not the whole signed passport.

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

The body is the `SignedPayload` of an `AgentPassportV2`, signed with
`compositeSign(registry, DCP_CONTEXTS.AgentPassport, canonicalBytes, keys)` by the
keys it lists (the `agent_passport` of an SDK-built bundle has this shape).

```bash
curl -s -X POST http://localhost:3000/v2/passport/register \
  -H "Content-Type: application/json" \
  -d '{
    "signed_passport": {
      "payload": {
        "dcp_version": "2.0",
        "agent_id": "agent:research-bot-001",
        "session_nonce": "<64 hex>",
        "keys": [
          { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
          { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" }
        ],
        "principal_binding_reference": "human:alice-001",
        "capabilities": ["browse"],
        "risk_tier": "low",
        "created_at": "...",
        "status": "active",
        "emergency_revocation_token": "sha256:<64 hex>"
      },
      "payload_hash": "sha256:...",
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }'
```

Responses: 201 `{ ok, agent_id, registered_kids }`, 400 (schema or kid
mismatch), 403 (signature invalid, or agent revoked), 409 (agent registered with
other keys, passport not newer than the registered one, agent without an active
key of a registered family, or kid owned by another agent), 507 (registry full).

### Key Rotation

```bash
# body = createKeyRotation(registry, { oldKid, oldAlg, oldSecretKeyB64, newKid, newAlg,
#                                      newSecretKeyB64, newPublicKeyB64, timestamp, expiresAt })
curl -s -X POST http://localhost:3000/v2/keys/rotate \
  -H "Content-Type: application/json" \
  -d '{
    "old_kid": "<32 hex>",
    "new_key": { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
    "timestamp": "2026-03-01T00:00:00Z",
    "proof_of_possession": { "alg": "ed25519", "kid": "<new kid>", "sig_b64": "..." },
    "authorization_sig": { "alg": "ed25519", "kid": "<old kid>", "sig_b64": "..." }
  }'
```

### Switching the Verifier Mode (operator)

```bash
curl -s -X POST http://localhost:3000/v2/policy/mode \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "pq_only" }'
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

The secret is the pre-image of the `emergency_revocation_token` registered with
the passport. Rate-limited to 5 attempts per minute per client IP.

```bash
curl -s -X POST http://localhost:3000/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent:research-bot-001",
    "revocation_secret": "<64 hex>"
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

- **In-memory storage**: all state (passports, keys, audit chains, advisories) is lost on restart. See [Persistence](#persistence).
- **Signatures outside bundle verification**: bundle verification, passport registration, key rotation and multi-party authorization check real Ed25519 and ML-DSA-65 / SLH-DSA signatures. `/v2/advisory/publish` and `/v2/governance/register` do not (the operator token is their only guard), and neither do `/v2/intent/declare`, `/v2/audit/*` or the DCP-05 to DCP-09 endpoints.
- **Anchoring**: `POST /anchor` returns 501. Implement using your blockchain (Ethereum, Bitcoin) or transparency log.

## Persistence

Nothing is written to disk. A restart, a deploy or a stopped machine wipes the
passport and key registries, so after a wipe any `agent_id` can be registered
again by whoever comes first, and emergency revocations are forgotten.
`deploy/fly/verification.toml` therefore keeps one machine running
(`min_machines_running = 1`) instead of scaling to zero; deploys and restarts
still start empty. Production deployments need a persistent store.

## Deployment

- Run behind a reverse proxy (nginx, Caddy) with TLS in production, and set `TRUST_PROXY=true` only if it appends the client IP to `X-Forwarded-For`.
- Use a process manager (systemd, PM2) for automatic restarts.
- See [Docker setup](../docker/README.md) for containerized deployment.

## Reference

- [spec/VERIFICATION.md](../spec/VERIFICATION.md) — Normative verification checklist
- [spec/DCP-AI-v2.0.md](../spec/DCP-AI-v2.0.md) — V2 protocol specification
- [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) — Operator guide
