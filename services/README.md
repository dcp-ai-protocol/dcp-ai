# DCP Infrastructure Services

Optional HTTP microservices that complement the DCP Reference Gateway. Each service runs independently and can be deployed individually or together via Docker Compose.

## Architecture

```
                        ┌─────────────────────┐
                        │  DCP Reference       │
                        │  Gateway (:3000)     │
                        │  Verification +      │
                        │  Key Registry +      │
                        │  Policy Engine       │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼──────────┐  ┌─────▼──────────┐  ┌──────▼──────────┐
    │  Anchor Service    │  │ Transparency   │  │  Revocation     │
    │  (:3001)           │  │ Log (:3002)    │  │  Service (:3003)│
    │                    │  │                │  │                  │
    │  Bundle hash →     │  │ Append-only    │  │  V1: agent-level│
    │  L2 blockchain     │  │ Merkle tree +  │  │  V2: kid-level  │
    │  (Base, Arb, OP)   │  │ inclusion      │  │  + emergency    │
    │                    │  │ proofs         │  │  + short-lived  │
    └────────────────────┘  └────────────────┘  └─────────────────┘
```

## Services

| Service | Port | Status | Description |
|---------|------|--------|-------------|
| [Anchor](anchor/README.md) | 3001 | Partial | Bundle hash anchoring to L2 blockchains. Merkle batching works in-memory; on-chain submission is not implemented, so records carry `tx_hash: null`. |
| [Transparency Log](transparency-log/README.md) | 3002 | Functional | CT-style append-only log: RFC 6962 Merkle tree, inclusion proofs, Ed25519-signed tree heads. In-memory storage. |
| [Revocation](revocation/README.md) | 3003 | Functional | Agents register keys with their signed passport; V1 agent-level and V2 kid-level revocations must be signed by those keys; emergency panic button. In-memory storage. |

## Quick Start

```bash
# Run all services with Docker Compose
cd docker
docker compose up

# Or run individually from repo root
node services/anchor/index.js
node services/transparency-log/index.js
node services/revocation/index.js
```

## Data Flow

1. **Agent registers** via Gateway (`POST /v2/passport/register`) and with the Revocation service (`POST /v2/register`), both with its self-signed passport
2. **Intent declared** and policy evaluated (`POST /v2/intent/declare`)
3. **Bundle signed** and verified (`POST /v2/bundle/verify`)
4. **Hash anchored** to blockchain via Anchor service (`POST /anchor`)
5. **Hash logged** in transparency log (`POST /add`)
6. **Revocation checked** before accepting bundles: `GET /v2/check/kid/:kid` covers kid-level, emergency and expiry revocations of every kid registered with `POST /v2/register` (pass `?agent_id=<owner>` only for a kid the agent did not register), and `GET /check/:agent_id` covers agent-level ones.

## Authentication

- **Revocation** writes are signed: registration by the passport's own keys, revocations by the keys registered to the agent. Emergency revocation needs the pre-image of the registered token.
- **Anchor** `POST /flush` and **Transparency Log** `POST /gossip/peers` require `Authorization: Bearer <OPERATOR_TOKEN>`; without `OPERATOR_TOKEN` they stay locked. The log fetches its peers itself, so an open peer list would let anyone point it at internal URLs.
- Request bodies are capped at 1 MB. Rate limits (revocation's emergency endpoint, the gateway) key on the socket address; set `TRUST_PROXY=true` only behind a proxy that appends the client IP to `X-Forwarded-For`.

## Persistence

All services keep their state **in memory**, and nothing survives a restart, a deploy or a stopped machine:

- **Revocation**: forgetting revocations un-revokes agents, and after a wipe the first registration of an `agent_id` is trust on first use again. `deploy/fly/revocation.toml` keeps one machine running (`min_machines_running = 1`) so idling does not wipe it; deploys still do.
- **Transparency Log**: a restart starts a new, empty tree, so earlier STHs and proofs no longer match it. Its Fly config already keeps one machine running.
- **Anchor**: pending hashes and records are lost; its Fly config still scales to zero, which is harmless while nothing is anchored on-chain.

For production, add persistent storage (SQLite, PostgreSQL), plus a Fly volume where needed. Other limitations:

- **Anchor**: integrate with ethers.js and a real L2 RPC endpoint. The `DCPAnchor.sol` contract is in `contracts/ethereum/`.
- **Revocation**: consider CRL (Certificate Revocation List) or OCSP-style distribution for high-availability deployments.

## Environment Variables

See individual service READMEs for configuration details:
- [Anchor](anchor/README.md#configuration)
- [Transparency Log](transparency-log/README.md#configuration)
- [Revocation](revocation/README.md#configuration)
