# Anchoring Service

HTTP service for anchoring Citizenship Bundle hashes to L2 blockchains (Base, Arbitrum, Optimism). Supports individual anchoring or batch anchoring with a Merkle root.

> **On-chain submission is not implemented yet.** Hashes and batch roots are recorded locally with
> `tx_hash: null` and `onchain: false`; the service never makes up a transaction hash.
> `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` and `ANCHOR_CONTRACT` are not used yet. State is in memory
> (see [Persistence](../README.md#persistence)).

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

Submit a bundle hash for anchoring: `sha256:` followed by 64 lowercase hex characters (the prefix
is optional). Anything else, or a body over 1 MB, is a 400.

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
  "tx_hash": null,
  "onchain": false,
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
  "tx_hash": null,
  "onchain": false,
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
    { "hash": "sha256:...", "count": 1, "timestamp": "...", "tx_hash": null, "onchain": false, "chain": "base" }
  ]
}
```

### `POST /flush`

Force a flush of the pending batch (batch mode only). Requires the operator token; without
`OPERATOR_TOKEN` configured the endpoint stays locked (401).

```bash
curl -X POST http://localhost:3001/flush -H "Authorization: Bearer $OPERATOR_TOKEN"
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
| `ANCHOR_RPC_URL` | — | JSON-RPC URL of the L2 node (not used yet; a warning is logged when set) |
| `ANCHOR_PRIVATE_KEY` | — | Wallet private key for signing transactions (not used yet) |
| `ANCHOR_CONTRACT` | — | Address of the deployed DCPAnchor contract (not used yet) |
| `ANCHOR_CHAIN` | `"base"` | Chain identifier |
| `OPERATOR_TOKEN` | — | Bearer token for `POST /flush`. Unset: locked |

### Operating Modes

**Individual (`ANCHOR_MODE=individual`):** Each hash is anchored immediately in an independent on-chain transaction.

**Batch (`ANCHOR_MODE=batch`):** Hashes are accumulated and periodically anchored as a Merkle root, reducing gas costs. The flush occurs every `BATCH_INTERVAL_MS` milliseconds or manually via `POST /flush`.

## Integration with DCPAnchor.sol

Once wired in, the service will interact with the `DCPAnchor.sol` smart contract:

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
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

## License

Apache-2.0
