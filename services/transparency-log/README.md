# Transparency Log Service

HTTP transparency log service inspired by Certificate Transparency (CT). Stores bundle hashes in an append-only RFC 6962 Merkle tree with verifiable inclusion proofs and Ed25519-signed tree heads. State is in memory: a restart starts a new, empty tree (see [Persistence](../README.md#persistence)).

## Quickstart

```bash
# Start the service, from the root of a checkout after `npm install` there
node services/transparency-log/index.js

# Or with Docker, from the repo root: the Compose stack runs two logs that gossip with each other
docker compose -f docker/docker-compose.yml up transparency-log-a transparency-log-b
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
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
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

`OPERATOR_KEY` is the key's 32-byte seed, so the signing key survives restarts; the tree does not, since it stays in
memory. Without it the log signs with a new ephemeral key after each restart: earlier STHs still verify under the old
key, if you archived or pinned it, but not under the new one.

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
| POST | `/gossip/peers` | Add a peer `{ peer_id, endpoint, public_key }` (http/https endpoint, base64 Ed25519 key). Requires `Authorization: Bearer <OPERATOR_TOKEN>`: the log fetches peers itself, so an open list would allow SSRF |
| POST | `/gossip/exchange` | Exchange STHs with a pinned peer `{ sth }`; returns ours and any split-view alert |
| GET | `/gossip/alerts` | Split-view alerts (the last 100) |

A peer's tree heads only count when they verify under its **pinned** public key: give it as
`<endpoint>#<base64 Ed25519 public key>` in `GOSSIP_PEERS`, or `public_key` in
`POST /gossip/peers`. Polled tree heads from a peer without a pinned key, malformed ones or ones
with a bad signature are ignored. A poll reads at most 16 KB, gives up after one interval
(10 s at most), and never starts while the previous one is still running. `/gossip/exchange` is open, so it only accepts a well-formed
STH (64-hex or null `root`, integer `size`) signed by a pinned peer, in a body of at most 16 KB
(otherwise 400 or 403). Anyone may hand it a pinned peer's head they were shown.

**What gossip detects.** Each log witnesses the heads of the logs it pins. A log is identified by the
pinned key its heads verify under and by their exact `log_id` (the decoded JSON string); a peer id or
an endpoint is only a route to it. A **split view** is one such log signing two different roots for
the same tree size, seen by polling, through the exchange, or through two aliases of the same log.
Heads of different logs are never compared, whatever their sizes or `log_id`: two independent logs
that pin each other do not alert. Heads of different sizes prove nothing here: the logs do not
replicate each other and there are no consistency proofs. The local tree is only compared with heads
of this log's own key and `LOG_ID` (if its operator pins its own key), at its current size.

**Alerts.** An alert names the log (`peer_log_id`, `peer_public_key`), `tree_size`, the root observed
first (`observed_root`) and the conflicting one (`peer_root`), the alias it came through (`peer_id`)
and the route (`source`: `poll` or `exchange`). `evidence` holds both heads as observed (the four
signed fields and `signature`, without any `public_key` or other member). An auditor who has
confirmed `peer_public_key` against a key it trusts out of band, and not on the alert's word, can
check that this key signed both. `observed_root` is the root of the local tree only when the
conflicting head was compared with the current local tree; otherwise it is the root observed earlier.
`local_root` is kept for existing clients as a deprecated name of `observed_root`, with that meaning.
Alerts are deduplicated by log, tree size and the pair of roots against the 100 alerts kept, so
replaying a signed tree head, through any alias or route, adds nothing while its alert is among
them; once it has been pushed out, the same split view can be reported again.

**Limits.** For each log a log witnesses, it keeps the first head of each size for the 256 largest
sizes seen. Older, smaller heads replayed later do not push recent ones out. It tracks at most 8
`log_id`s per pinned key; heads of any further `log_id` of that key are verified but neither recorded
nor compared with what was retained, silently (the log's own heads are still compared with its
current tree). These limits are fixed: at most 256 × 8 heads per pinned key, so the total grows with
the number of keys the operator pins.

- **Rotation and removal.** Re-pinning an alias with a new key, or removing it, drops what was
  observed under a key no alias pins any more. A key still pinned by another alias, or by the same
  alias with a new endpoint or another base64 spelling of the same key, keeps its history.
- **Polls in flight.** A poll whose alias is removed or reconfigured while it waits is discarded when
  it answers.
- **Restarts.** History and alerts live in memory and are lost on a restart, so what was observed
  before it can no longer be compared. A log that restarts with the same `OPERATOR_KEY` and `LOG_ID`
  starts an empty tree under the same identity. A peer reports a split view only if it still holds a
  head of the previous tree at a size the new tree also signs with a different root; a new tree with
  the same entries in the same order has the same roots and raises nothing. A new `LOG_ID` (unset, it
  is random) is a new log: it does not continue the previous one, whose history its peers no longer
  link to it.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP port |
| `LOG_ID` | random | Identifier of this log instance |
| `OPERATOR_KEY` | — | Ed25519 seed of the STH signing key: 64 hex chars (`openssl rand -hex 32`). Any other value stops the service; unset means an ephemeral key |
| `OPERATOR_TOKEN` | — | Bearer token for `POST /gossip/peers`. Unset: locked |
| `GOSSIP_PEERS` | — | Comma-separated peers, each `<endpoint>#<base64 Ed25519 public key>` (the peer's `/health` `public_key`, fixed by its `OPERATOR_KEY`), polled every `GOSSIP_INTERVAL_MS` |
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
4. The final result must equal the `root` of a signed tree head that verifies under the log's pinned public key and
   covers the tree the proof was built from (the same size). The `root` in the proof response alone is self-declared,
   and a newer root stops matching once entries are added

## Development

```bash
# Start in development mode, from the root of a checkout
PORT=3002 node services/transparency-log/index.js

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
