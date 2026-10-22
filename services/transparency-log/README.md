# Transparency Log Service

HTTP transparency log service inspired by Certificate Transparency (CT). Stores bundle hashes in an append-only RFC 6962 Merkle tree with verifiable inclusion proofs and Ed25519-signed tree heads. State is in memory: a restart starts a new, empty tree (see [Persistence](../README.md#persistence)).

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
  "log_id": "log-alpha",
  "public_key": "base64 Ed25519 public key that signs STHs",
  "size": 42,
  "gossip_peers": 1,
  "alerts": 0
}
```

### `POST /add`

Add a bundle hash to the log: `sha256:` followed by 64 lowercase hex characters. Anything else,
or a body over 1 MB, is a 400.

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

Get the Signed Tree Head (STH): an Ed25519 signature (base64) over the canonical JSON (sorted
keys, `signObject` in `tools/crypto.js`) of `{ log_id, root, size, timestamp }`.

```bash
curl http://localhost:3002/root/signed
```

```json
{
  "log_id": "log-alpha",
  "root": "d4e5f6...",
  "size": 43,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "signature": "base64...",
  "public_key": "base64..."
}
```

Verify it against a public key you pinned out of band (printed at startup and in `/health`),
never only against the `public_key` the STH carries:

```js
import { verifyObject } from "./tools/crypto.js";
const { log_id, root, size, timestamp, signature } = sth;
verifyObject({ log_id, root, size, timestamp }, signature, pinnedPublicKey); // true
```

The key is derived from `OPERATOR_KEY`, so it survives restarts. Without `OPERATOR_KEY` the log
signs with an ephemeral key and earlier STHs stop verifying after a restart.

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

### Gossip

| Method | Path | Description |
|--------|------|-------------|
| GET | `/gossip/peers` | Known peers and the last 20 alerts |
| POST | `/gossip/peers` | Add a peer `{ peer_id, endpoint }` (http/https). Requires `Authorization: Bearer <OPERATOR_TOKEN>`: the log fetches peers itself, so an open list would allow SSRF |
| POST | `/gossip/exchange` | Exchange STHs with a peer `{ sth }`; returns ours and any split-view alert |
| GET | `/gossip/alerts` | Split-view alerts |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP port |
| `LOG_ID` | random | Identifier of this log instance |
| `OPERATOR_KEY` | — | Secret seed of the STH signing key (Ed25519 seed = SHA-256(`OPERATOR_KEY`)); use 32+ random bytes. Unset: ephemeral key |
| `OPERATOR_TOKEN` | — | Bearer token for `POST /gossip/peers`. Unset: locked |
| `GOSSIP_PEERS` | — | Comma-separated peer URLs, polled every `GOSSIP_INTERVAL_MS` |
| `GOSSIP_INTERVAL_MS` | `30000` | Gossip polling interval |

## CT-style Format

The log follows a format inspired by Certificate Transparency (RFC 6962):

1. **Append-only:** Entries are never deleted or modified
2. **Merkle tree:** RFC 6962 §2.1. `leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))` and interior
   nodes are `SHA-256(0x01 || left || right)`, so a leaf can never pass for a subtree. A tree of
   `n` leaves splits at the largest power of two below `n`; the last node is never duplicated.
3. **Inclusion proofs:** Anyone can verify that an entry exists in the log using the proof
4. **Signed root:** Ed25519-signed tree heads (`GET /root/signed`)

### Verifying an Inclusion Proof

To verify that an entry is in the log:

1. Get the proof with `GET /proof/:index`
2. Compute `leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))`
3. Recombine the proof nodes in order, as raw bytes (the hex strings decoded):
   - If `direction == "left"`: `hash = SHA-256(0x01 || proof_hash || current)`
   - If `direction == "right"`: `hash = SHA-256(0x01 || current || proof_hash)`
4. The final result must match the current `root`

## Development

```bash
# Start in development mode
PORT=3002 node index.js

# Test
curl http://localhost:3002/health
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
curl http://localhost:3002/root
curl http://localhost:3002/proof/0
```

## License

Apache-2.0
