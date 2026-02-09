# Anchoring Service

HTTP service for anchoring Citizenship Bundle hashes to L2 blockchains (Base, Arbitrum, Optimism). Supports individual anchoring or batch anchoring with a Merkle root.

## Quickstart

```bash
# Start the service
node index.js

# Or with Docker
docker compose up anchor
```

The service listens on `http://localhost:3001` by default.

## Endpoints

### `GET /health`

Service health check.

```bash
curl http://localhost:3001/health
```

```json
{
  "ok": true,
  "service": "dcp-anchor",
  "mode": "batch",
  "pending": 0,
  "total_anchored": 5
}
```

### `POST /anchor`

Submit a bundle hash for anchoring.

```bash
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:abc123..."}'
```

**Individual mode** — Anchors immediately:

```json
{
  "anchored": true,
  "hash": "sha256:abc123...",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": "0x...",
  "chain": "base"
}
```

**Batch mode** — Accepts and enqueues (HTTP 202):

```json
{
  "accepted": true,
  "bundle_hash": "sha256:abc123...",
  "position": 3,
  "hint": "Batch will flush in ~60s or POST /flush"
}
```

### `GET /status/:hash`

Query the status of an anchored hash.

```bash
curl http://localhost:3001/status/sha256:abc123...
```

```json
{
  "anchored": true,
  "hash": "sha256:abc123...",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": "0x...",
  "chain": "base"
}
```

If not anchored but pending:

```json
{
  "anchored": false,
  "pending": true
}
```

### `GET /anchored`

List all anchored records.

```bash
curl http://localhost:3001/anchored
```

```json
{
  "records": [
    { "hash": "sha256:...", "count": 1, "timestamp": "...", "tx_hash": "0x...", "chain": "base" }
  ]
}
```

### `POST /flush`

Force a flush of the pending batch (batch mode only).

```bash
curl -X POST http://localhost:3001/flush
```

```json
{ "flushed": true }
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `ANCHOR_MODE` | `"batch"` | Anchoring mode: `"individual"` or `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | Automatic flush interval in ms (batch mode) |
| `ANCHOR_RPC_URL` | — | JSON-RPC URL of the L2 node |
| `ANCHOR_PRIVATE_KEY` | — | Wallet private key for signing transactions |
| `ANCHOR_CONTRACT` | — | Address of the deployed DCPAnchor contract |
| `ANCHOR_CHAIN` | `"base"` | Chain identifier |

### Operating Modes

**Individual (`ANCHOR_MODE=individual`):** Each hash is anchored immediately in an independent on-chain transaction.

**Batch (`ANCHOR_MODE=batch`):** Hashes are accumulated and periodically anchored as a Merkle root, reducing gas costs. The flush occurs every `BATCH_INTERVAL_MS` milliseconds or manually via `POST /flush`.

## Integration with DCPAnchor.sol

The service interacts with the `DCPAnchor.sol` smart contract:

- **Individual mode:** Calls `anchorBundle(bytes32 bundleHash)`
- **Batch mode:** Computes the Merkle root of pending hashes and calls `anchorBatch(bytes32 merkleRoot, uint256 count)`

See [contracts/ethereum/README.md](../../contracts/ethereum/README.md) for contract details.

## Development

```bash
# Start in development mode
PORT=3001 ANCHOR_MODE=batch node index.js

# Test with curl
curl http://localhost:3001/health
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:test123"}'
```

## License

Apache-2.0
