# Government Deployment Guide

How a government or regulatory authority can adopt the Digital Citizenship Protocol to govern AI agents operating within its jurisdiction — without running a central registry, without storing personal data on-chain, and without depending on the protocol authors.

---

## What a government gets

1. **Verification of every AI agent** operating in the jurisdiction: identity bound to a human or legal entity, declared intent, policy decision, and auditable trail — all in a single portable bundle.
2. **Revocation power:** instant revocation of any agent via a signed revocation list published by the authority.
3. **Transparency:** an append-only log of bundle hashes (no personal data) providing a tamper-evident record of all agents that have been verified.
4. **Optional attestation:** the authority can sign ("attest") an agent's Human Binding Record, certifying it as valid in the jurisdiction.
5. **Optional anchoring:** periodic publication of the log root to a public blockchain (Bitcoin) for immutability that does not depend on the authority's server.

All of this runs locally or on the government's own infrastructure. No external API is required. No data leaves the jurisdiction unless the government chooses to anchor to a public chain (and even then, only opaque hashes are published).

---

## Architecture overview

```
┌──────────────────────────────────────────────┐
│                Government                    │
│                                              │
│  ┌────────────┐  ┌──────────────────────┐    │
│  │ Revocation │  │  Transparency log    │    │
│  │   list     │  │  (append-only,       │    │
│  │  (signed   │  │   Merkle tree,       │    │
│  │   JSON)    │  │   hashes only)       │    │
│  └─────┬──────┘  └──────────┬───────────┘    │
│        │                    │                │
│        ▼                    ▼                │
│  well-known URL      optional anchor         │
│  /.well-known/       to Bitcoin/chain        │
│  dcp-revocations     (root hash only)        │
│                                              │
│  ┌──────────────────────────────────┐        │
│  │  Verification service (Docker)   │        │
│  │  POST /verify                    │        │
│  │  stateless, local, no DB         │        │
│  └──────────────────────────────────┘        │
│                                              │
│  ┌──────────────────────────────────┐        │
│  │  Attestation service (optional)  │        │
│  │  POST /attest                    │        │
│  │  signs HBR hash with gov key     │        │
│  └──────────────────────────────────┘        │
└──────────────────────────────────────────────┘
```

---

## Step-by-step deployment

### 1. Verification service

The fastest path to adoption. A single Docker container that verifies Signed Bundles.

**What it does:** receives a Signed Bundle (JSON), runs the full verification checklist ([spec/VERIFICATION.md](../spec/VERIFICATION.md)), returns `{ verified: true }` or `{ verified: false, errors: [...] }`.

**Deploy:**

```bash
# From this repo (reference implementation)
npm install
node server/index.js
# Or via Docker (when image is published)
docker run -p 3000:3000 ghcr.io/dcp-ai/verify-service
```

**Integrate:** any system that creates or receives AI agents sends the agent's Signed Bundle to this service before allowing the agent to operate. One HTTP call.

**Cost:** one server (or serverless function). No database. No per-query cost beyond compute (~1ms per verification).

### 2. Revocation list

A signed JSON file that the government publishes, listing revoked agents.

**Format:**

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    {
      "agent_id": "agent-abc-123",
      "revoked_at": "2026-01-15T12:00:00Z",
      "reason_hash": "sha256:abcdef..."
    }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**Publish:** host the file at a well-known URL, e.g. `https://ai.gov.us/.well-known/dcp-revocations.json`. Update it whenever an agent is revoked.

**How verifiers use it:** the verification service (or any verifier) fetches the list (with cache/TTL), checks the signature, and looks up the bundle's `agent_id` or signer against the list. If found, verification fails.

**Cost:** a static file on any web server or CDN. Effectively zero.

### 3. Transparency log (recommended)

An append-only log of `bundle_hash` values for every agent verified in the jurisdiction. Provides a tamper-evident record without storing personal data.

**What is stored:** only `bundle_hash` (SHA-256 hex) and a timestamp. No agent_id, no human_id, no bundle content.

**How it works:**

1. When an agent is verified (or registered), the verification service sends `bundle_hash` to the log.
2. The log appends it, returns `{ log_index, timestamp }`.
3. The log builds a Merkle tree over all entries. Anyone can request an inclusion proof for any log_index.
4. The log operator signs the current root periodically (e.g. every hour).

**Verification of log entries:**

- A verifier (or auditor) receives `bundle_hash` + `log_index` + `merkle_proof` from the agent holder.
- The verifier checks the Merkle inclusion proof locally against the signed root. No API call to the log needed (if the verifier has a recent signed root).

**Tech:** Go or Node. Storage: SQLite or PostgreSQL. Google's [Trillian](https://github.com/google/trillian) is an open-source implementation of exactly this pattern (it powers Certificate Transparency).

**Cost:** a single server with a database. Millions of entries for minimal cost. The bulk of the work is appending 32-byte hashes.

### 4. Blockchain anchoring (optional)

Publish the log's Merkle root to a public blockchain periodically for immutability that does not depend on the government's server.

**Recommended approach:** Bitcoin OP_RETURN in batch.

1. Every N hours (e.g. every 6 hours), take the current log root.
2. Create a Bitcoin transaction with an OP_RETURN output: `dcp:v1:<root_hex>`.
3. Store the anchor receipt: `{ chain: "bitcoin", tx_id, block_height, log_size }`.

**Cost:** ~$0.50 USD per transaction. 4 transactions per day = ~$2/day = ~$730/year for a national-level, publicly immutable audit trail.

**Alternative:** Ethereum L2 (Arbitrum, Base) if smart-contract querying is desired. Cost: fractions of a cent per event.

**What goes on-chain:** only the 32-byte root hash. No agent data, no personal data, no bundle content.

### 5. Jurisdiction attestation (optional)

The government signs the hash of an agent's Human Binding Record (HBR), certifying "this agent is registered in our jurisdiction."

**Setup:**

1. Generate a government keypair: `dcp keygen gov-keys`.
2. Publish the public key at `https://ai.gov.us/.well-known/dcp-attestation-keys.json`.
3. When an agent is registered, sign the HBR hash: produce a `JurisdictionAttestation` object (see [spec/DCP-01.md](../spec/DCP-01.md)).
4. The attestation is included in the Signed Bundle or presented alongside it.

**Verification:** one Ed25519 signature check. Local, instantaneous, free. The verifier obtains the government's public key from the well-known URL (cached).

**Cost:** one cryptographic operation per attestation (microseconds). No ongoing cost.

---

## What the government does NOT need to do

- **Run a blockchain.** The protocol uses existing public chains (Bitcoin, Ethereum) for optional anchoring.
- **Store full bundles.** Only hashes are stored in the log and on-chain. Full bundles are held by agents/holders.
- **Operate a central registry of all agents.** The revocation list contains only revoked agents. The log contains only hashes.
- **Trust the protocol authors.** The protocol is open; the government runs its own infrastructure. Verification is local (SHA-256 + Ed25519).
- **Expose personal data.** HBR content (human identity, jurisdiction) is in the bundle, revealed only to the verifier when the agent presents it. The log and chain see only opaque hashes.

---

## Privacy model

| Data | Who sees it | Where stored |
|------|-------------|--------------|
| Full bundle (HBR, AP, intent, audit) | Only the verifier who receives it | Holder's device; presented at verification time |
| bundle_hash (SHA-256) | Log, optional blockchain | Government log, optional Bitcoin/Ethereum (opaque hash) |
| Revoked agent_id | Public (revocation list) | Government well-known URL |
| Attestation (signed HBR hash) | Verifier | In the bundle or alongside it |

No mass surveillance. No central database of all agents. The government sees only what it needs: hashes for transparency, revoked IDs for enforcement.

---

## Regulatory integration

The protocol is designed to be referenced by regulation without being owned by any government:

- A regulation can say: "AI agents operating in jurisdiction X must present a valid DCP Signed Bundle to any party upon request."
- A regulation can require: "Agents must have a JurisdictionAttestation signed by an accredited issuer."
- A regulation can mandate: "Agent creators must submit bundle_hash to the national transparency log."
- The protocol does not dictate policy; it provides the verifiable data structure. Policy is the government's domain.

---

## Cost summary

| Component | One-time | Ongoing |
|-----------|----------|---------|
| Verification service | 1 server or container | ~$10–50/month (cloud) or existing infra |
| Revocation list | Static file hosting | ~$0 (CDN or gov web server) |
| Transparency log | 1 server + DB | ~$20–100/month (depends on scale) |
| Bitcoin anchoring | — | ~$2/day (~$730/year) |
| Attestation service | 1 server | ~$10–50/month (or same as verification) |

Total for a national deployment: on the order of **$1,000–2,000/year** plus existing server costs. Compared to any centralized registry or blockchain-native solution, this is orders of magnitude cheaper.

---

## Reference

- Technical architecture: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Storage and anchoring: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Operator guide: [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)
- DCP-01 (Identity, attestation): [spec/DCP-01.md](../spec/DCP-01.md)
