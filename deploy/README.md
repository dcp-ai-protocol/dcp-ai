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

Every image is published with `:latest`, the full semver (`:2.0.3`),
major.minor (`:2.0`), major (`:2`), and a `:sha-xxxxxxx` tag. Both
`linux/amd64` and `linux/arm64` are provided.

Quick smoke test on your laptop:

```bash
docker run --rm -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
curl http://localhost:3000/health
```

---

## Option 1 — Docker Compose (self-host, simplest)

The repo ships a ready-to-run compose file that wires all four services
together, including two gossiping transparency logs:

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

## Option 2 — Fly.io (managed, free tier)

Free tier of Fly.io covers up to 3 shared-cpu VMs with 256 MB RAM — enough to run the four services for evaluation.

```bash
# one-time setup
brew install flyctl
fly auth login
cd deploy/fly
```

Deploy each service (the `.toml` files in this directory are pre-configured to pull from GHCR — no source build needed):

```bash
fly launch --config verification.toml    --no-deploy
fly deploy --config verification.toml

fly launch --config anchor.toml          --no-deploy
# anchor needs a signer and a contract:
fly secrets set --app dcp-ai-anchor \
  ANCHOR_RPC_URL="https://mainnet.base.org" \
  ANCHOR_PRIVATE_KEY="0x..." \
  ANCHOR_CONTRACT="0x..."
fly deploy --config anchor.toml

fly launch --config transparency-log.toml --no-deploy
fly secrets set --app dcp-ai-transparency-log \
  OPERATOR_KEY="$(openssl rand -hex 32)" \
  GOSSIP_PEERS="https://<your-second-log>.fly.dev"
fly deploy --config transparency-log.toml

fly launch --config revocation.toml      --no-deploy
fly deploy --config revocation.toml
```

Each service gets a public HTTPS URL like `https://dcp-ai-verification.fly.dev`.

For production you want **two** transparency-log instances in different regions, each pointing at the other via `GOSSIP_PEERS`. That is what detects split-view attacks (DCP-03 §4).

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

Repeat for each service. Cloud Run scales to zero when idle, so cost for low traffic is near $0.

---

## Option 4 — Railway (one-click, credit-card required for deploy)

Create a new project from Docker image. For each service paste the GHCR image URL and set the env vars from the corresponding `deploy/fly/*.toml`.

---

## Operating notes

- **Anchor**: only enable after you have deployed `contracts/ethereum/DCPAnchor.sol` to an EVM chain and set `ANCHOR_CONTRACT`. See [Smart-contract deployment](#smart-contract-deployment) in the operator guide.
- **Transparency log**: persistence is in-process by default (good for evaluation, loses data on restart). For production back it with a volume or a real DB.
- **Revocation**: the registry is authoritative only if every verifier in your policy points at *this* URL. Publish the URL in your `.well-known/dcp-capabilities.json`.
- **Verification**: stateless, horizontally scalable, put behind a CDN/load-balancer for production.

---

## CI/CD

The repo's [`publish-docker.yml`](../.github/workflows/publish-docker.yml) workflow rebuilds and pushes these images on every release and on every push to `main` that touches the service code. You do not have to build images locally unless you want a custom patch.
