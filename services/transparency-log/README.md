# Transparency Log Service

HTTP transparency log service inspired by Certificate Transparency (CT). Stores bundle hashes in an append-only Merkle tree with verifiable inclusion proofs.

## Quickstart

```bash
# Start the service
node index.js

# Or with Docker
docker compose up transparency-log
```

The service listens on `http://localhost:3002` by default.

## Endpoints

### `GET /health`

Service health check.

```bash
curl http://localhost:3002/health
```

```json
{
  "ok": true,
  "service": "dcp-transparency-log",
  "size": 42
}
```

### `POST /add`

Add a bundle hash to the log.

```bash
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:abc123..."}'
```

```json
{
  "index": 42,
  "leaf_hash": "a1b2c3...",
  "root": "d4e5f6...",
  "size": 43
}
```

### `GET /root`

Get the current Merkle root of the log.

```bash
curl http://localhost:3002/root
```

```json
{
  "root": "d4e5f6...",
  "size": 43
}
```

### `GET /root/signed`

Get the signed Merkle root (placeholder for operator signature).

```bash
curl http://localhost:3002/root/signed
```

```json
{
  "root": "d4e5f6...",
  "size": 43,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "signature": "placeholder"
}
```

### `GET /proof/:index`

Get the Merkle inclusion proof for an entry by index.

```bash
curl http://localhost:3002/proof/5
```

```json
{
  "index": 5,
  "leaf_hash": "a1b2c3...",
  "entry": {
    "hash": "sha256:abc123...",
    "leaf_hash": "a1b2c3...",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "index": 5
  },
  "root": "d4e5f6...",
  "proof": [
    { "hash": "x1y2z3...", "direction": "left" },
    { "hash": "m4n5o6...", "direction": "right" }
  ]
}
```

The proof allows verifying that an entry is included in the Merkle tree without downloading the entire log.

### `GET /entries`

List all log entries.

```bash
curl http://localhost:3002/entries
```

```json
{
  "entries": [
    { "hash": "sha256:...", "leaf_hash": "...", "timestamp": "...", "index": 0 },
    { "hash": "sha256:...", "leaf_hash": "...", "timestamp": "...", "index": 1 }
  ],
  "size": 2
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP port |

## CT-style Format

The log follows a format inspired by Certificate Transparency (RFC 6962):

1. **Append-only:** Entries are never deleted or modified
2. **Merkle tree:** Each entry generates a `leaf_hash` (SHA-256) that is incorporated into the tree
3. **Inclusion proofs:** Anyone can verify that an entry exists in the log using the proof
4. **Signed root:** The root can be signed by the operator (current placeholder)

### Verifying an Inclusion Proof

To verify that an entry is in the log:

1. Get the proof with `GET /proof/:index`
2. Compute `leaf_hash = SHA-256(entry.hash)`
3. Recombine the proof nodes:
   - If `direction == "left"`: `hash = SHA-256(proof_hash + current)`
   - If `direction == "right"`: `hash = SHA-256(current + proof_hash)`
4. The final result must match the current `root`

## Development

```bash
# Start in development mode
PORT=3002 node index.js

# Test
curl http://localhost:3002/health
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:test123"}'
curl http://localhost:3002/root
curl http://localhost:3002/proof/0
```

## License

Apache-2.0
