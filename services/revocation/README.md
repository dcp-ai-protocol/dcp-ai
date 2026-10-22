# Revocation Service

HTTP service for publishing and querying DCP agent revocations. Supports both V1 (agent-level) and V2 (kid-level, emergency revocation, short-lived cert tracking). Exposes a `.well-known` endpoint for standardized queries.

Every write is authenticated. An agent first registers with its self-signed V2 passport
(`POST /v2/register`): the composite signature proves possession of the signer keys, so the
service records those kids as the agent's, with their expiry and the passport's emergency
revocation token. Revocations must then be signed by those registered keys. State is in memory
(see [Persistence](../README.md#persistence)).

## Quickstart

```bash
# Start the service
node index.js

# Or with Docker
docker compose up revocation
```

The service listens on `http://localhost:3003` by default.

## V1 Endpoints

### `GET /health`

Service health check.

```bash
curl http://localhost:3003/health
```

```json
{
  "ok": true,
  "service": "dcp-revocation",
  "supported_versions": ["1.0", "2.0"],
  "registered_agents": 2,
  "total_revocations": 3,
  "total_kid_revocations": 1
}
```

### `POST /revoke`

Publish an agent-level revocation (V1). `signature` is an Ed25519 signature (base64) over the
V1 canonical JSON of `{ dcp_version, agent_id, human_id, timestamp, reason }` as sent
(`signObject` in `tools/crypto.js`), made with one of the agent's registered `ed25519` keys. The
agent must have registered with `POST /v2/register` first.

```bash
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "dcp_version": "1.0",
    "agent_id": "agent:research-bot-001",
    "human_id": "human:alice-001",
    "timestamp": "2026-03-01T00:00:00Z",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_id` | `string` | Yes | ID of the agent to revoke |
| `human_id` | `string` | No | ID of the responsible human |
| `reason` | `string` | Yes | Reason for revocation |
| `signature` | `string` | Yes | Ed25519 signature over the other fields |
| `dcp_version` | `string` | No | DCP version (default: `"1.0"`) |
| `timestamp` | `string` | No | ISO 8601 (default: now) |

Fields left out of the request are left out of the signed object; defaults are filled in afterwards.

**Response (201):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Error responses:** 400 (missing fields), 403 (signature does not verify against the agent's
registered `ed25519` keys), 409 (agent already revoked: revocations are final, so an emergency
revocation cannot be overwritten).

### `GET /check/:agent_id`

Check if an agent is revoked.

```bash
curl http://localhost:3003/check/agent-001
```

**Revoked agent:**

```json
{
  "revoked": true,
  "record": {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "timestamp": "2026-03-01T00:00:00.000Z",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }
}
```

**Non-revoked agent:**

```json
{
  "revoked": false,
  "agent_id": "agent-001"
}
```

### `GET /list`

List all agent-level revocations.

```bash
curl http://localhost:3003/list
```

```json
{
  "revocations": [...],
  "total": 3
}
```

---

## V2 Endpoints

### `POST /v2/register`

Register an agent's keys and emergency revocation token. The body is the agent's self-signed
passport, the `SignedPayload` of an `AgentPassportV2` signed under `DCP-AI.v2.AgentPassport` by
the keys it lists (the `agent_passport` of an SDK-built bundle). The composite signature must be
`pq_over_classical`.

```bash
curl -X POST http://localhost:3003/v2/register \
  -H "Content-Type: application/json" \
  -d '{ "signed_passport": { "payload": { "dcp_version": "2.0", "agent_id": "...", "keys": [...], "emergency_revocation_token": "sha256:...", ... }, "payload_hash": "sha256:...", "composite_sig": { ... } } }'
```

- Only the two signer keys (classical + PQ) are registered: listing someone else's public key
  registers nothing. Their `expires_at` drives the `expired` answer of `GET /v2/check/kid/:kid`.
- The first registration of an `agent_id` is trust on first use. Registering it again (for
  example to replace the token) must be signed by its current, non-revoked keys.

**Response (201):**

```json
{ "ok": true, "agent_id": "agent-001", "registered_kids": ["a1b2...", "c3d4..."] }
```

**Error responses:** 400 (not a V2 signed passport), 403 (signature invalid, or agent
emergency-revoked), 409 (agent registered with other keys, or a kid owned by another agent).

### `POST /v2/revoke`

Kid-level revocation with composite signature. `composite_sig` signs the record without it
(`dcp_version`, `agent_id`, `human_id`, `revoked_kid`, `timestamp`, `reason`, as sent) under
`DCP-AI.v2.Revocation`, with the agent's registered keys; `revoked_kid` must be one of them.

```bash
curl -X POST http://localhost:3003/v2/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "dcp_version": "2.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "revoked_kid": "a1b2c3d4e5f6...",
    "reason": "Key compromised",
    "composite_sig": {
      "classical": { "alg": "ed25519", "kid": "abc123", "sig_b64": "..." },
      "pq": { "alg": "ml-dsa-65", "kid": "def456", "sig_b64": "..." },
      "binding": "pq_over_classical"
    }
  }'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dcp_version` | `string` | Yes | Must be `"2.0"` |
| `agent_id` | `string` | Yes | ID of the agent |
| `human_id` | `string` | No | ID of the responsible human |
| `revoked_kid` | `string` | Yes | Key identifier to revoke |
| `reason` | `string` | Yes | Reason for revocation |
| `composite_sig` | `object` | Yes | Composite signature (classical + optional PQ) |

**Response (201):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_kid": "a1b2c3d4e5f6...",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Error responses:** 400 (missing fields or `dcp_version`), 403 (`revoked_kid` is not a
registered key of `agent_id`, or `composite_sig` does not verify against the agent's keys).

### `POST /v2/emergency-revoke`

Emergency revocation (panic button). Revokes ALL keys for an agent using the pre-image of the
`emergency_revocation_token` registered with its passport. Rate-limited to 5 attempts per minute
per client IP (socket address, or the last `X-Forwarded-For` hop with `TRUST_PROXY=true`).

```bash
curl -X POST http://localhost:3003/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "revocation_secret": "a1b2c3d4e5f6..."
  }'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_id` | `string` | Yes | ID of the agent to revoke |
| `human_id` | `string` | No | ID of the responsible human |
| `revocation_secret` | `string` | Yes | Pre-image of the registered token (64 hex chars) |
| `reason` | `string` | No | Reason (default: `"key_compromise_emergency"`) |
| `timestamp` | `string` | No | ISO 8601 (default: now) |

**Response (200):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z",
  "keys_revoked": 3
}
```

**Error responses:** 400 (bad format), 403 (invalid secret), 404 (no token registered), 409 (token already consumed), 429 (rate limit).

`POST /v2/register-emergency-token` and `POST /v2/register-key-expiry` were removed: they
accepted unsigned requests, so anyone could replace a token or mark any key expired. The token
and the key expiry now come from the signed passport (`POST /v2/register`).

### `GET /v2/check/kid/:kid[?agent_id=<id>]`

Check if a specific key identifier is revoked (explicit revocation, emergency revocation of its
owner, or expiry). The owner of a registered kid is known, so `?agent_id=` is only needed for
kids the agent listed in its passport but did not sign with (they are not registered).

```bash
curl "http://localhost:3003/v2/check/kid/a1b2c3d4e5f6"
```

**Revoked key:**

```json
{
  "revoked": true,
  "kid": "a1b2c3d4e5f6",
  "agent_id": "agent-001",
  "reason": "Key compromised",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Active key:**

```json
{ "revoked": false, "kid": "a1b2c3d4e5f6" }
```

### `GET /v2/list`

List all revocations including agent-level and kid-level.

```bash
curl http://localhost:3003/v2/list
```

```json
{
  "dcp_version": "2.0",
  "agent_revocations": [...],
  "kid_revocations": [...],
  "total_agents": 2,
  "total_kids": 5
}
```

---

## Shared Endpoints

### `GET /.well-known/dcp-revocations.json`

Standardized endpoint for querying all revocations (V1 + V2). Follows [RFC 8615](https://tools.ietf.org/html/rfc8615).

```bash
curl http://localhost:3003/.well-known/dcp-revocations.json
```

```json
{
  "dcp_version": "2.0",
  "updated_at": "2026-03-01T00:00:00.000Z",
  "revocations": [
    {
      "dcp_version": "2.0",
      "agent_id": "agent-001",
      "human_id": "human-001",
      "timestamp": "2026-03-01T00:00:00.000Z",
      "reason": "Compromised credentials",
      "signature": "composite:a1b2c3d4"
    }
  ],
  "kid_revocations": [
    {
      "dcp_version": "2.0",
      "agent_id": "agent-001",
      "revoked_kid": "a1b2c3d4e5f6...",
      "timestamp": "2026-03-01T00:00:00.000Z",
      "reason": "Key compromised"
    }
  ]
}
```

This endpoint can be:

- Queried by any verifier
- Cached by CDNs
- Served as a static file in production

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3003` | HTTP port |
| `TRUST_PROXY` | — | `true` only behind a proxy that appends the client IP to `X-Forwarded-For` |

## Integration

### Querying from middleware

The Express and FastAPI middlewares can use `checkRevocation: true` to automatically verify against this service before accepting a bundle.

### V2 flow

1. Register the agent's signed passport during setup (`POST /v2/register`): keys, their expiry and the emergency token
2. Revoke individual keys as needed, signed by the agent's keys (`POST /v2/revoke`)
3. Use panic button in emergencies (`POST /v2/emergency-revoke`)
4. Check key status before accepting bundles (`GET /v2/check/kid/:kid`)

## Development

```bash
PORT=3003 node index.js

curl http://localhost:3003/health
curl http://localhost:3003/check/test-001
curl http://localhost:3003/v2/list
curl http://localhost:3003/.well-known/dcp-revocations.json

# Writes need signatures; index.test.js builds signed passports and revocations
node --test services/revocation/index.test.js   # from the repo root
```

## License

Apache-2.0
