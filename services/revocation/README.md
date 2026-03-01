# Revocation Service

HTTP service for publishing and querying DCP agent revocations. Supports both V1 (agent-level) and V2 (kid-level, emergency revocation, short-lived cert tracking). Exposes a `.well-known` endpoint for standardized queries.

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
  "total_revocations": 3,
  "total_kid_revocations": 1
}
```

### `POST /revoke`

Publish an agent-level revocation (V1).

```bash
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "human_id": "human-001",
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
| `signature` | `string` | Yes | Revocation signature |
| `dcp_version` | `string` | No | DCP version (default: `"1.0"`) |
| `timestamp` | `string` | No | ISO 8601 (default: now) |

**Response (201):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

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

### `POST /v2/revoke`

Kid-level revocation with composite signature.

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

### `POST /v2/emergency-revoke`

Emergency revocation (panic button). Revokes ALL keys for an agent using a pre-registered revocation secret. Rate-limited to 5 attempts per minute per IP.

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

### `POST /v2/register-emergency-token`

Register an emergency revocation token for an agent. Called during identity setup.

```bash
curl -X POST http://localhost:3003/v2/register-emergency-token \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "emergency_revocation_token": "sha256:abc123..."
  }'
```

**Response (201):**

```json
{ "ok": true, "agent_id": "agent-001" }
```

### `POST /v2/register-key-expiry`

Register key expiry for short-lived cert tracking.

```bash
curl -X POST http://localhost:3003/v2/register-key-expiry \
  -H "Content-Type: application/json" \
  -d '{
    "kid": "a1b2c3d4...",
    "expires_at": "2026-04-01T00:00:00Z"
  }'
```

**Response (201):**

```json
{ "ok": true, "kid": "a1b2c3d4...", "expires_at": "2026-04-01T00:00:00Z" }
```

### `GET /v2/check/kid/:kid`

Check if a specific key identifier is revoked (explicit revocation, emergency revocation, or expiry).

```bash
curl http://localhost:3003/v2/check/kid/a1b2c3d4e5f6
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

## Integration

### Querying from middleware

The Express and FastAPI middlewares can use `checkRevocation: true` to automatically verify against this service before accepting a bundle.

### V2 flow

1. Register emergency token during agent setup (`POST /v2/register-emergency-token`)
2. Register key expiry for short-lived certs (`POST /v2/register-key-expiry`)
3. Revoke individual keys as needed (`POST /v2/revoke`)
4. Use panic button in emergencies (`POST /v2/emergency-revoke`)
5. Check key status before accepting bundles (`GET /v2/check/kid/:kid`)

## Development

```bash
PORT=3003 node index.js

# Test V1
curl http://localhost:3003/health
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"test-001","reason":"test","signature":"sig"}'
curl http://localhost:3003/check/test-001

# Test V2
curl -X POST http://localhost:3003/v2/register-emergency-token \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"test-002","emergency_revocation_token":"sha256:abc123"}'
curl http://localhost:3003/v2/list
curl http://localhost:3003/.well-known/dcp-revocations.json
```

## License

Apache-2.0
