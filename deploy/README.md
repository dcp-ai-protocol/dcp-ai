# Deploying DCP-AI services

The four services shipped in this repo — **verification**, **anchor**,
**transparency-log**, **revocation** — are distributed as pre-built
Docker images on GitHub Container Registry (GHCR). You can run them on
any container host. Below are the most common flows.

## Images

| Service | Image | Default port |
|---|---|---|
| Verification | `ghcr.io/dcp-ai-protocol/dcp-ai/verification` | 3000 |
| Anchor | `ghcr.io/dcp-ai-protocol/dcp-ai/anchor` | 3001 |
| Transparency log | `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log` | 3002 |
| Revocation | `ghcr.io/dcp-ai-protocol/dcp-ai/revocation` | 3003 |

Tags (see [`publish-docker.yml`](../.github/workflows/publish-docker.yml)): a push to `main` that
triggers the workflow publishes `:latest`, `:main` and `:sha-xxxxxxx`; a published release adds its
semver tags (`:<major>.<minor>.<patch>`, `:<major>.<minor>`, `:<major>`) and can also move `:latest`,
which is mutable. Both `linux/amd64` and `linux/arm64` are built.

Quick smoke test on your laptop:

```bash
docker run --rm -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
# in a second terminal, while the container runs in the foreground
curl http://localhost:3000/health
```

`/health` only shows that the process answers HTTP. It says nothing about persistence, anchoring,
gossip or readiness for production.

---

## Option 1 — Docker Compose (self-host, simplest)

The repo ships a ready-to-run compose file that wires the four services together in five
containers, with two transparency logs. The logs only gossip once each has a fixed `OPERATOR_KEY`
and the other's public key pinned (see [`docker/README.md`](../docker/README.md)); without that,
each polls the other and ignores its tree heads:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai
cd dcp-ai/docker
docker compose up -d
```

Services expose:

- `http://localhost:3000` — verification
- `http://localhost:3001` — anchor
- `http://localhost:3002` — transparency-log (log-alpha)
- `http://localhost:3012` — transparency-log (log-beta, gossip peer)
- `http://localhost:3003` — revocation

To use the published GHCR images instead of building from source, edit
`docker/docker-compose.yml` and replace each `build:` block with an
`image:` line, e.g.:

```yaml
services:
  verification:
    image: ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
```

---

## Option 2 — Fly.io (managed)

```bash
# one-time setup
brew install flyctl
fly auth login
cd deploy/fly
```

Deploy each service (the `.toml` files in this directory are pre-configured to pull from GHCR — no source build needed):

```bash
fly launch --config verification.toml    --no-deploy
# admin endpoints and registering new agent_ids
fly secrets set --app dcp-ai-verification OPERATOR_TOKEN="$(openssl rand -hex 32)"
fly deploy --config verification.toml

fly launch --config anchor.toml          --no-deploy
# on-chain submission is not implemented: no RPC URL, wallet key or contract is read
fly secrets set --app dcp-ai-anchor OPERATOR_TOKEN="$(openssl rand -hex 32)"   # unlocks POST /flush
fly deploy --config anchor.toml

fly launch --config transparency-log.toml --no-deploy
fly secrets set --app dcp-ai-transparency-log \
  OPERATOR_KEY="$(openssl rand -hex 32)" \
  GOSSIP_PEERS="https://<your-second-log>.fly.dev#<its /health public_key>"
fly deploy --config transparency-log.toml

fly launch --config revocation.toml      --no-deploy
fly deploy --config revocation.toml
```

Each service gets a public HTTPS URL like `https://dcp-ai-verification.fly.dev`. On the verification app that also makes public its DCP-05 to DCP-09 endpoints, which need no token and do not verify signatures (see the operating notes).

A gossip peer without its `#<public key>` is polled but its tree heads are ignored.

State is in memory. The verification, revocation and transparency-log configs keep one machine
running so idling does not wipe their registries; a deploy or restart still starts them empty. The
anchor config lets its machine stop (`min_machines_running = 0`), which drops its pending hashes
and local records. Only the revocation service can keep its state across restarts: put
`REVOCATION_STATE_PATH` on a volume, as the comment in `revocation.toml` shows. The transparency
log has no persistence option.
Set `OPERATOR_TOKEN` on the revocation app too, since registering a new `agent_id` there needs it,
and on the anchor and transparency-log apps if you need `POST /flush` or `POST /gossip/peers`.

For production you want **two** transparency-log instances in different regions, each with its own `OPERATOR_KEY` and pointing at the other via `GOSSIP_PEERS` with the other's public key pinned. Gossip compares their signed tree heads and raises an alert when two heads of the same size have different roots (DCP-03 §4). That reveals a split view only if both logs are meant to hold the same entries in the same order: the logs do not replicate entries to each other, so two logs that legitimately received different entries also alert, and heads of different sizes are not compared (there is no consistency proof).

---

## Option 3 — Google Cloud Run (pay-per-request)

```bash
gcloud run deploy dcp-ai-verification \
  --image ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest \
  --port 3000 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="DCP_VERSION=2.0,VERIFIER_MODE=hybrid_required"
```

Repeat for each service. Cloud Run scales to zero when idle, and these services keep their state in
memory: an instance that scales to zero or restarts starts empty (see the operating notes).

---

## Option 4 — Railway (one-click, credit-card required for deploy)

Create a new project from Docker image. For each service paste the GHCR image URL and set the env vars from the corresponding `deploy/fly/*.toml`.

---

## Operating notes

- **Anchor**: on-chain submission is not implemented. Deploying `contracts/ethereum/src/DCPAnchor.sol` and setting `ANCHOR_CONTRACT` does not enable it: `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` and `ANCHOR_CONTRACT` are not read (setting `ANCHOR_RPC_URL` only logs a warning), so do not give the service a wallet key. It keeps local records in memory with `tx_hash: null` and `onchain: false`.
- **Transparency log**: in memory only, with no persistence option: a restart starts a new, empty tree, and a volume does not change that. A fixed `OPERATOR_KEY` keeps the same signing key across restarts.
- **Revocation**: the registry is authoritative only if every verifier in your policy points at *this* URL. Publish the URL in your `.well-known/dcp-capabilities.json`. Without `REVOCATION_STATE_PATH` on persistent storage, a restart forgets every registration and revocation.
- **Verification**: not stateless. It keeps passports, keys, audit chains and the DCP-05–09 records in memory, and separate instances do not share them, so instances behind a load balancer would answer differently. Run one instance.
- **Verification, DCP-05 to DCP-09 endpoints**: they need no token and do not verify signatures, and `OPERATOR_TOKEN` does not protect them, so anyone who reaches a public deployment (Fly, or Cloud Run with `--allow-unauthenticated`) can change lifecycle, dispute and mandate state. Put your own authorization in front of them, or do not route them ([docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

---

## CI/CD

The repo's [`publish-docker.yml`](../.github/workflows/publish-docker.yml) workflow rebuilds and pushes these images on every published release, on manual dispatch, and on every push to `main` that touches `server/`, `services/`, `lib/`, `tools/`, `schemas/`, `docker/Dockerfile` or the workflow itself. The images also build the workspace SDK (`sdks/typescript/`), but a push that changes only the SDK does not trigger a rebuild.

Before deploying, trace the digest of the image you will run to a successful run of the publishing workflow for the chosen commit. `:latest` is mutable and does not guarantee that revision. If no image exists for the chosen commit, build it from that checkout (`docker build -f docker/Dockerfile --target <service> .`, from the repo root).
