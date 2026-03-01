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
| [Anchor](anchor/README.md) | 3001 | Partial | Bundle hash anchoring to L2 blockchains. On-chain integration is a placeholder; Merkle batching works in-memory. |
| [Transparency Log](transparency-log/README.md) | 3002 | Functional | CT-style append-only log with Merkle inclusion proofs. Signed root is a placeholder. In-memory storage. |
| [Revocation](revocation/README.md) | 3003 | Functional | V1 agent-level and V2 kid-level revocation with emergency panic button. In-memory storage. |

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

1. **Agent registers** via Gateway (`POST /v2/passport/register`)
2. **Intent declared** and policy evaluated (`POST /v2/intent/declare`)
3. **Bundle signed** and verified (`POST /v2/bundle/verify`)
4. **Hash anchored** to blockchain via Anchor service (`POST /anchor`)
5. **Hash logged** in transparency log (`POST /add`)
6. **Revocation checked** before accepting bundles (`GET /v2/check/kid/:kid`)

## Current Limitations

All services use **in-memory storage** — data is lost on restart. For production:

- **Anchor**: Integrate with ethers.js and a real L2 RPC endpoint. The `DCPAnchor.sol` contract is in `contracts/ethereum/`.
- **Transparency Log**: Add persistent storage (LevelDB, PostgreSQL). Implement operator key signing for the signed root.
- **Revocation**: Add persistent storage. Consider CRL (Certificate Revocation List) or OCSP-style distribution for high-availability deployments.

## Environment Variables

See individual service READMEs for configuration details:
- [Anchor](anchor/README.md#configuration)
- [Transparency Log](transparency-log/README.md#configuration)
- [Revocation](revocation/README.md#configuration)
