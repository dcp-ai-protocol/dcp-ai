# Anchoring Service

HTTP service meant to anchor Citizenship Bundle hashes to L2 blockchains (Base, Arbitrum, Optimism), individually or in batches under a Merkle root. Today it only records them locally (see the note below).

> **On-chain submission is not implemented yet.** Hashes and batch roots are recorded locally with
> `tx_hash: null` and `onchain: false`; the service never makes up a transaction hash.
> `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` and `ANCHOR_CONTRACT` are not used yet. State is in memory
> (see [Persistence](../README.md#persistence)).

## Quickstart

```bash
# Start the service
node index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up anchor
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

`total_anchored` counts local records, one per batch, not hashes. A healthy answer says nothing about
anything on chain.

### `POST /anchor`

Submit a bundle hash for anchoring: `sha256:` followed by 64 lowercase hex characters (the prefix
is optional). Anything else, or a body over 1 MB, is a 400.

```bash
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:abc123..."}'
```

**Individual mode** — Records the hash at once, locally: `anchored: true` means recorded by this
service, not on chain (`onchain: false`, `tx_hash: null`):

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
  "hint": "Will be anchored in next batch (interval: 60000ms)"
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

A record is found only by the hash it stores. In individual mode, and for a batch of one hash, that is
the submitted hash (with the `sha256:` prefix). For a batch of several hashes it is only their Merkle
root, so each of those hashes then answers `{"anchored": false, "pending": false}`; there is no
per-hash inclusion proof yet. While pending, a hash is matched as it was submitted (with or without
the prefix). Records are in memory and a restart loses them.

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

**Individual (`ANCHOR_MODE=individual`):** Each hash gets its own local record at once. Once on-chain submission is wired in, each would be a separate transaction.

**Batch (`ANCHOR_MODE=batch`):** Hashes are accumulated and recorded as one Merkle root every `BATCH_INTERVAL_MS` milliseconds, or at once with `POST /flush`. Once on-chain submission is wired in, each batch would be one transaction.

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
