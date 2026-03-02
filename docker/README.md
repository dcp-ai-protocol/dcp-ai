# Docker — DCP Infrastructure

Docker Compose configuration for deploying all DCP services as containers. Includes verification, anchoring, transparency log, and revocation.

## Quickstart

```bash
cd docker
docker compose up
```

This starts 4 services:

| Service | Port | Description |
|---------|------|-------------|
| **verification** | `3000` | Bundle verification server |
| **anchor** | `3001` | Blockchain L2 anchoring service |
| **transparency-log** | `3002` | Transparency log with Merkle proofs |
| **revocation** | `3003` | Agent revocation service |

### Verify everything is running

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
```

## Services

### verification (`:3000`)

Signed Bundle verification server for DCP (V1 + V2 + Phase 3).

```bash
# V1 verification
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {...}, "signature": {...}}, "public_key_b64": "..."}'

# V2 composite verification
curl -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"dcp_version":"2.0","bundle":{...},"signature":{...}}}'

# Capability discovery
curl http://localhost:3000/.well-known/dcp-capabilities.json
```

### anchor (`:3001`)

Bundle hash anchoring service for blockchain. See [services/anchor/README.md](../services/anchor/README.md).

### transparency-log (`:3002`)

Append-only transparency log with inclusion proofs. See [services/transparency-log/README.md](../services/transparency-log/README.md).

### revocation (`:3003`)

Revocation publishing and querying service. See [services/revocation/README.md](../services/revocation/README.md).

## Configuration

### Environment Variables

Each service is configured via environment variables in `docker-compose.yml`:

#### verification

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `VERIFIER_MODE` | `hybrid_required` | V2 verification mode |
| `REQUIRE_SESSION_BINDING` | `true` | Enforce session nonce in V2 |
| `REQUIRE_COMPOSITE_BINDING` | `true` | Require composite signatures |
| `MAX_KEY_AGE_DAYS` | `365` | Max key age before rotation |
| `ALLOW_V1_BUNDLES` | `true` | Accept V1 format bundles |

#### anchor

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `ANCHOR_MODE` | `batch` | `"individual"` or `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | Flush interval (ms) |
| `ANCHOR_RPC_URL` | — | JSON-RPC URL of the L2 node |
| `ANCHOR_PRIVATE_KEY` | — | Wallet private key |
| `ANCHOR_CONTRACT` | — | DCPAnchor contract address |

#### transparency-log

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP port |
| `LOG_ID` | auto-generated | Unique identifier for this log instance |
| `OPERATOR_KEY` | auto-generated | Hex-encoded operator secret for signing STHs |
| `GOSSIP_PEERS` | — | Comma-separated peer endpoints (e.g. `http://log-b:3002`) |
| `GOSSIP_INTERVAL_MS` | `30000` | Gossip polling interval in milliseconds |

#### revocation

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3003` | HTTP port |

### Configure blockchain anchoring

Uncomment and configure in `docker-compose.yml`:

```yaml
anchor:
  environment:
    - ANCHOR_RPC_URL=https://mainnet.base.org
    - ANCHOR_PRIVATE_KEY=0x...
    - ANCHOR_CONTRACT=0x...
```

## Dockerfile

The `Dockerfile` uses a multi-stage build with independent targets:

```
Base: node:20-alpine
├── verification  → node server/index.js        (port 3000)
├── anchor        → node services/anchor/index.js      (port 3001)
├── transparency-log → node services/transparency-log/index.js (port 3002)
└── revocation    → node services/revocation/index.js  (port 3003)
```

### Individual build

```bash
# Build a specific service
docker build -f docker/Dockerfile --target anchor -t dcp-anchor ..

# Run
docker run -p 3001:3001 -e ANCHOR_MODE=batch dcp-anchor
```

### Build all

```bash
docker compose build
```

## Health Checks

All services have health checks configured:

- **Interval:** 30 seconds
- **Timeout:** 5 seconds
- **Retries:** 3
- **Command:** `wget -qO- http://localhost:PORT/health`
- **Restart policy:** `unless-stopped`

## Full Example — Verify a Bundle

```bash
# 1. Start services
cd docker
docker compose up -d

# 2. Verify a signed bundle (note: body must wrap in signed_bundle key)
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d "{\"signed_bundle\": $(cat tests/conformance/examples/citizenship_bundle.signed.json)}"

# 3. Compute the bundle hash locally and anchor it
HASH="sha256:$(cat tests/conformance/examples/citizenship_bundle.signed.json \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(require("crypto").createHash("sha256").update(d).digest("hex")))')"
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 4. Add to transparency log (service on port 3002, route is /add)
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 5. Stop
docker compose down
```

## License

Apache-2.0
