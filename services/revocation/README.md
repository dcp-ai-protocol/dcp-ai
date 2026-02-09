# Revocation Service

HTTP service for publishing and querying DCP agent revocations. Allows revoking an agent's passport and exposes a `.well-known` endpoint for standardized queries.

## Quickstart

```bash
# Start the service
node index.js

# Or with Docker
docker compose up revocation
```

The service listens on `http://localhost:3003` by default.

## Endpoints

### `GET /health`

Service health check.

```bash
curl http://localhost:3003/health
```

```json
{
  "ok": true,
  "service": "dcp-revocation",
  "total_revocations": 3
}
```

### `POST /revoke`

Publish an agent revocation.

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
  "revoked_at": "2025-01-01T00:00:00.000Z"
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
  "agent_id": "agent-001",
  "record": {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "timestamp": "2025-01-01T00:00:00.000Z",
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

### `GET /.well-known/dcp-revocations.json`

Standardized endpoint for querying all revocations. Can be served as a static file or consumed by other services.

```bash
curl http://localhost:3003/.well-known/dcp-revocations.json
```

```json
{
  "dcp_version": "1.0",
  "updated_at": "2025-01-01T00:00:00.000Z",
  "revocations": [
    {
      "dcp_version": "1.0",
      "agent_id": "agent-001",
      "human_id": "human-001",
      "timestamp": "2025-01-01T00:00:00.000Z",
      "reason": "Compromised credentials",
      "signature": "base64-signature..."
    }
  ]
}
```

### `GET /list`

List all revocations.

```bash
curl http://localhost:3003/list
```

```json
{
  "revocations": [...],
  "total": 3
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3003` | HTTP port |

## Revocation Format

A DCP `RevocationRecord` contains:

```json
{
  "dcp_version": "1.0",
  "agent_id": "agent-001",
  "human_id": "human-001",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "reason": "Reason for revocation",
  "signature": "base64-ed25519-signature"
}
```

The revocation must be signed by the responsible human (Ed25519 private key). The `signature` field allows verifying the authenticity of the revocation.

## Integration

### Querying from middleware

The Express and FastAPI middlewares can use `checkRevocation: true` to automatically verify against this service before accepting a bundle.

### `.well-known` Endpoint

The `/.well-known/dcp-revocations.json` endpoint follows the [RFC 8615](https://tools.ietf.org/html/rfc8615) convention and can be:

- Queried by any verifier
- Cached by CDNs
- Served as a static file in production

## Development

```bash
# Start in development mode
PORT=3003 node index.js

# Test
curl http://localhost:3003/health
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"test-001","reason":"test","signature":"sig"}'
curl http://localhost:3003/check/test-001
```

## License

Apache-2.0
