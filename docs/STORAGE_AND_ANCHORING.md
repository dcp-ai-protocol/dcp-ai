# Storage and Anchoring — P2P, verification local

The protocol does not depend on any central service. Verification is local; optional anchoring uses **existing** public blockchain or **third-party** services. The protocol does not point to a canonical "DCP registry" or "dcp.ai" URL.

## Design

- **Verification is local.** A verifier needs only: (1) the Signed Bundle (or Citizenship Bundle + signature), and (2) optionally a set of signed RevocationRecords (from peer, file, or anchored on-chain). No API call to any central server is required.
- **Optional anchoring:** Users (or any third party) publish hashes to **existing** public blockchain (Bitcoin, Ethereum) or to a **third-party** transparency log.
- **Revocation:** Signed RevocationRecord(s). Distributed P2P (holder gives to verifier), or published as hash on-chain / in log; verifier has a set of "known revocations" (hashes or records) and checks signer/agent_id against them. No central revocation server.

## Storage options

| Option | What is stored | Where |
|--------|----------------|--------|
| **Portable only** | Full bundle held by holder; presented to verifier when needed (e.g. at API call). | Holder's device or storage; verifier receives bundle in-band. |
| **Anchoring (hashes only)** | Only bundle_hash or merkle_root (and optionally revocation hashes) published. Full bundle stays off-chain. | Public blockchain, transparency log, or DHT. Verifier checks "this hash was anchored at T" using public data. Users or third-party anchor services use existing chains/logs. |
| **Revocation** | Signed RevocationRecord(s). Distributed P2P or published as hash on-chain / in log. | Peer, file, IPFS, blockchain (hash only), or user-supplied list. |

## Optional anchor receipt

If anchoring is used, an optional proof can be stored **alongside** the bundle (not necessarily in the schema):

- `anchor_receipt`: `{ chain, tx_id, block_height }` (Bitcoin) or `{ chain, contract, tx_id, block_number, event_index }` (Ethereum) or `{ log_url, log_index }` (transparency log).

Anchoring is done by users or third-party anchor services against existing chains/logs.

## Blockchain anchoring

How to anchor DCP hashes on a blockchain. Users (or any third-party anchor service) publish hashes to **existing** public chains.

### What goes on-chain (only hashes)

- **bundle_hash** (e.g. `sha256:<hex>`) or **merkle_root** of audit_entries. One hash per anchor.
- Optionally: **hash of a RevocationRecord** (so verifiers can pull a list of revocation hashes from chain and check locally).
- **Nothing else:** no full bundle, no agent_id, no human_id, no HBR/AP payload. The chain only sees opaque hashes.

### Implementation options

| Chain / system | Method | Format | Notes |
|----------------|--------|--------|--------|
| **Bitcoin** | OP_RETURN output (or taproot commitment). One tx per hash or batch many hashes in a Merkle tree and commit root. | 32 bytes (SHA-256) in output. | Cheap, immutable; limited payload size per tx. Batch: one root per tx, proofs off-chain. |
| **Ethereum (or L2)** | Contract that emits event with `bytes32 bundleHash` (and optional timestamp). | Event: `Anchored(bytes32 bundleHash, uint256 timestamp)`. | Verifier reads events; no need to trust a central server. Cost in gas. |
| **Transparency log (e.g. CT-style)** | Append-only log: each entry = hash (+ optional timestamp). Merkle tree over entries; root can be published to Bitcoin/Ethereum periodically. | Log entry = 32-byte hash. Inclusion proof = Merkle path. | Very cheap to append; verifier checks inclusion proof. Can be run by third parties. |
| **IPFS** | Publish only the hash as content (e.g. DAG node). Pin from multiple nodes. | CID or raw hash. | Not a blockchain but decentralized; verifier resolves CID to get hash and compares. |

### Concrete flow (Bitcoin OP_RETURN)

1. Holder has Signed Bundle; `bundle_hash` is already in `signature.bundle_hash`.
2. Holder (or any third party) creates a Bitcoin tx with an OP_RETURN output containing the 32-byte hex (or a prefix like `dcp:v1:` + hex to identify protocol).
3. Holder stores **anchor_receipt**: `{ chain: "bitcoin", network: "mainnet", tx_id: "<txid>", block_height: N }` (and optionally Merkle proof if batching).
4. Verifier: given a Signed Bundle and an anchor_receipt, (a) computes bundle_hash from bundle, (b) fetches the tx from the chain (or a public block explorer / own node), (c) checks that the OP_RETURN output matches bundle_hash. Verification is local + public chain data.

### Anchoring by users or third parties

Anchoring is done by **users** or **third-party anchor services** against existing chains. A reference anchor script (e.g. `dcp anchor --chain bitcoin --bundle signed.json` that outputs receipt) may be provided in a separate repo or doc—run by anyone.

## Revocation (P2P)

- Signed **RevocationRecord** (see [spec/DCP-01.md](../spec/DCP-01.md)) declares that an agent (or signer) is revoked.
- Verifiers maintain a **local set** of signed RevocationRecords (from file, peer, IPFS, or hash-anchored on-chain). They check the bundle signer / agent_id against this set. No central revocation server.
- Optional CLI: `dcp verify-revocation <signed_bundle> <revocation_record.json>` (local check only).

## Jurisdictional revocation list

A jurisdiction (government, regulatory authority, or accredited issuer) may publish a **signed revocation list** — a JSON file listing agents that have been revoked within that jurisdiction.

**Suggested format:**

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-abc-123", "revoked_at": "2026-01-15T12:00:00Z", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**Publication:** at a well-known URL, e.g. `https://<authority>/.well-known/dcp-revocations.json`. Not mandatory; this is a convention. Any URL works.

**How verifiers use it:** the verifier fetches the list for the agent's jurisdiction (based on `human_binding_record.jurisdiction`), checks the issuer's signature, and looks up the bundle's `agent_id` or signer against the entries. If found, verification fails. The list is cacheable (use HTTP cache headers or a TTL).

**Cost:** a static JSON file served from any web server or CDN. Effectively zero.

## Jurisdictional transparency log

A jurisdiction or accredited operator may run a **transparency log** — an append-only, Merkle-tree-backed log of `bundle_hash` values for agents verified in that jurisdiction. Inspired by Certificate Transparency (RFC 6962).

**What is stored:** only `bundle_hash` (SHA-256 hex) and a timestamp per entry. No agent_id, no human_id, no bundle content. Privacy is preserved.

**Suggested API:**

- `POST /add` — receives `{ bundle_hash }`; returns `{ log_index, timestamp }`.
- `GET /proof/:log_index` — returns a Merkle inclusion proof (array of sibling hashes + current root).
- `GET /root` — returns current Merkle root and log size.
- `GET /root/signed` — returns root signed by the log operator (for audit).

**Verification of log entries:** a verifier receives `bundle_hash` + `log_index` + `merkle_proof` (from the agent holder or from the log). The verifier checks the Merkle inclusion proof locally against the signed root. No live API call to the log is needed if the verifier has a recent signed root.

**Anchoring the log root:** the log operator may periodically anchor the signed root to Bitcoin (via OP_RETURN) or Ethereum (via contract event) for public immutability independent of the operator's server.

**anchor_receipt for log:** `{ log_url, log_index, merkle_proof, root_anchor: { chain, tx_id, block_height } }`.

**Cost:** a single server with SQLite or PostgreSQL. Millions of entries for minimal cost. Google's [Trillian](https://github.com/google/trillian) is an open-source implementation of this pattern.

## Cost comparison (anchoring methods)

From cheapest to most expensive:

1. **Transparency log only** (no blockchain) — operator signs the root. Cheapest. Trust is in the operator + auditors. Suitable when the operator is a trusted authority (e.g. government).
2. **Transparency log + Bitcoin batch anchor** — log accumulates entries; anchors root to Bitcoin every N hours (one OP_RETURN tx). Cost: ~$0.50/tx; 4 tx/day = ~$2/day = ~$730/year. Public immutability for an entire national log.
3. **Bitcoin OP_RETURN per hash** — one tx per bundle_hash. Cost: ~$0.50/hash. Only practical for low-volume or high-value bundles.
4. **Ethereum L2 (Arbitrum, Base, Optimism)** — event per hash or per batch root. Cost: fractions of a cent per event. Smart-contract queryable.
5. **Ethereum mainnet** — most expensive. Gas per event. Justified only if on-chain queryability from mainnet contracts is required.

For government-scale deployment, option 2 (log + Bitcoin batch) provides the best balance of robustness, economy, and public verifiability.

## Publishing and maintaining the protocol

- **Repo:** Publish the repo under a pseudonymous account (e.g. GitHub/GitLab) or let someone else fork and maintain it. Docs and specs live in the repo; anyone can mirror (e.g. GitHub Pages, IPFS, third-party sites).
- **NPM package:** Publish `dcp-ai` (or similar) under a pseudonymous npm account, or let a third party publish it.
- **No canonical URL:** The protocol does not point to a canonical "dcp.ai" or "DCP registry" URL. If someone runs a "DCP registry" or "dcp.ai" site, that is their choice; the protocol does not require it.
- **Optional anchoring:** Users or third-party anchor services use **existing** public chains (Bitcoin, Ethereum).
- **Summary:** The protocol is usable entirely from the repo (specs + schemas + CLI). Optional anchoring uses existing blockchain or third-party log. No central service is required.

## Reference

- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Bundle format: [spec/BUNDLE.md](../spec/BUNDLE.md)
- Government deployment: [GOVERNMENT_DEPLOYMENT.md](GOVERNMENT_DEPLOYMENT.md)
- Technical architecture: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
- Full Package: [Dcp-ai_Full_Package_V1.1.md](Dcp-ai_Full_Package_V1.1.md)
