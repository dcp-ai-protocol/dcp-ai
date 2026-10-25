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
    │  Local records     │  │ Merkle tree +  │  │  V2: kid-level  │
    │  (L2 planned)      │  │ inclusion      │  │  + emergency    │
    │                    │  │ proofs         │  │  + short-lived  │
    └────────────────────┘  └────────────────┘  └─────────────────┘
```

## Services

| Service | Port | Status | Description |
|---------|------|--------|-------------|
| [Anchor](anchor/README.md) | 3001 | Partial | Local bundle hash records with planned L2 blockchain anchoring. Merkle batching works in-memory; on-chain submission is not implemented, so records carry `tx_hash: null`. |
| [Transparency Log](transparency-log/README.md) | 3002 | Functional | CT-style append-only log: RFC 6962 Merkle tree, inclusion proofs, Ed25519-signed tree heads. In-memory storage. |
| [Revocation](revocation/README.md) | 3003 | Functional | Agents register keys with their signed passport; V1 agent-level and V2 kid-level revocations must be signed by those keys; emergency panic button. In-memory storage by default, with optional file persistence. |

## Quick Start

```bash
# Run all services with Docker Compose
(cd docker && docker compose up)

# Or run individually from the root of a checkout, after building the workspace SDK
# and installing the root package (the revocation service imports @dcp-ai/sdk):
#   (cd sdks/typescript && npm install && npm run build) && npm install
node services/anchor/index.js
node services/transparency-log/index.js
node services/revocation/index.js
```

## Data Flow

1. **Agent registers** via Gateway (`POST /v2/passport/register`), and the operator registers it with the Revocation service (`POST /v2/register`, operator token), both with its self-signed passport
2. **Intent declared** and policy evaluated (`POST /v2/intent/declare`)
3. **Bundle signed** and verified (`POST /v2/bundle/verify`)
4. **Hash submitted** to the Anchor service (`POST /anchor`) for local recording or batching; on-chain submission is not implemented
5. **Hash logged** in transparency log (`POST /add`)
6. **Revocation checked** before accepting bundles: `GET /v2/check/kid/:kid` covers kid-level, emergency and expiry revocations of every kid registered with `POST /v2/register`, and answers 404 (`registered: false`, status unknown) for any other kid; `GET /check/:agent_id` covers agent-level ones.

## Authentication

- **Revocation** writes are signed: registration by the passport's own keys, revocations by the keys registered to the agent. Reads are not: the lists it serves (`/list`, `/v2/list`, `/.well-known/dcp-revocations.json`) carry no signature, so a verifier trusts the service's URL and transport for them. Registering a new `agent_id` also needs the operator token, so nobody can claim someone else's first. Emergency revocation needs the pre-image of the registered token.
- **New `agent_id`s** are registered by the operator, on the gateway (`POST /v2/passport/register`) and on the revocation service (`POST /v2/register`); re-registering is self-service, signed by the agent's keys.
- **Anchor** `POST /flush` and **Transparency Log** `POST /gossip/peers` require `Authorization: Bearer <OPERATOR_TOKEN>`; without `OPERATOR_TOKEN` they stay locked. The log fetches its peers itself, so an open peer list would let anyone point it at internal URLs.
- Request bodies are capped at 1 MB. Rate limits (registrations and emergency revocations, the gateway's POSTs) key on the socket address; set `TRUST_PROXY=true` only behind a proxy that appends the client IP to `X-Forwarded-For`.
- Registries refuse new entries when full (507) instead of evicting them: the revocation service caps agents (`MAX_AGENTS`), the gateway caps keys (`MAX_REGISTERED_KEYS`, `MAX_KEYS_PER_AGENT` over an agent's lifetime) and keeps 4 retired keys per agent. Keys and signatures must be canonical base64 of their algorithm's exact size. The transparency log only trusts tree heads signed by pinned peers (`GOSSIP_PEERS=<url>#<key>`).

## Persistence

By default, services keep their state **in memory**. Unless persistence is configured, **that state does not survive a restart**, a deploy, a crash or a stopped machine:

- **Revocation**: forgetting revocations un-revokes agents. Set `REVOCATION_STATE_PATH` to keep registrations and revocations in a file across restarts (the Compose stack does, on a volume); without it, `deploy/fly/revocation.toml` only keeps one machine running so idling does not wipe it, and deploys still do.
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
