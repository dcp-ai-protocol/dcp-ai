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
- **Nothing else:** no full bundle, no agent_id, no human_id, no RPR/AP payload. The chain only sees hashes. Hashes are not anonymous: anyone who holds the bundle can find its hash on the chain, and the same hash links every record that carries it.

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

Anchoring is done by **users** or **third-party anchor services** against existing chains. The reference CLI has no anchor command, and the reference anchor service (`services/anchor/`) does not submit to a chain yet: it batches hashes and records them locally, in memory. `contracts/ethereum/` has a contract to deploy for Ethereum or an L2.

## Revocation (P2P)

- Signed **RevocationRecord** (see [spec/DCP-01.md](../spec/DCP-01.md)) declares that an agent (or signer) is revoked.
- Verifiers maintain a **local set** of signed RevocationRecords (from file, peer, IPFS, or hash-anchored on-chain). They check the bundle signer / agent_id against this set. No central revocation server.
- A local revocation check command (for example `dcp verify-revocation <signed_bundle> <revocation_record.json>`) is a possible tool; the reference CLI does not have it.

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

The format above is a suggested design. No tool in this repository produces it or checks its signature.

**Reference implementation:** `services/revocation/` in this repo (Docker image `ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest`, Fly.io config in `deploy/fly/revocation.toml`) serves a different list at `/.well-known/dcp-revocations.json`: `{ dcp_version, updated_at, revocations, kid_revocations }`, **without a signature** over the list. A verifier that reads it trusts the operator of that URL and the transport (HTTPS, and the optional `Authorization` header that the admission revocation source sends). The admission profile reads this format as a deny list, fails when it cannot fetch it, and never treats a missing answer as "not revoked" ([ADMISSION.md](ADMISSION.md#revocation-sources)).

**Proposed integration:** the operator chooses a trusted authority and URL for the relevant jurisdiction; the SDK does not discover an authority from the RPR's `jurisdiction` field. For the signed format proposed above, the application must verify the issuer's signature against a key trusted out of band, rather than trusting the key supplied by the list itself. It then looks up the bundle's `agent_id` or signer against the entries and refuses revoked bundles. The existing admission source instead consumes the unsigned reference deny list described above. A cached list is only as current as its last fetch: refuse to proceed when a fresh enough list cannot be fetched.

**What it takes:** a JSON file served from a web server or CDN, kept current by the issuer.

## Jurisdictional transparency log

A jurisdiction or accredited operator may run a **transparency log** — an append-only, Merkle-tree-backed log of `bundle_hash` values for agents verified in that jurisdiction. Inspired by Certificate Transparency (RFC 6962).

**What is stored:** only `bundle_hash` (SHA-256 hex) and a timestamp per entry. No agent_id, no human_id, no bundle content. This limits what the log reveals, but hashes are not anonymous: anyone who holds a bundle can check whether it was logged, and the same hash links the entries that carry it.

**Suggested API:**

- `POST /add` — receives `{ bundle_hash }`; returns `{ log_index, timestamp }`.
- `GET /proof/:log_index` — returns a Merkle inclusion proof (array of sibling hashes + current root).
- `GET /root` — returns current Merkle root and log size.
- `GET /root/signed` — returns root signed by the log operator (for audit).

**Verification of log entries:** a verifier receives `bundle_hash` + `log_index` + `merkle_proof` (from the agent holder or from the log). The verifier checks the Merkle inclusion proof locally against the signed root. No live API call to the log is needed if the verifier has a recent signed root.

**Anchoring the log root:** the log operator may periodically anchor the signed root to Bitcoin (via OP_RETURN) or Ethereum (via contract event) for public immutability independent of the operator's server.

**anchor_receipt for log:** `{ log_url, log_index, merkle_proof, root_anchor: { chain, tx_id, block_height } }`.

**What it takes:** a server with a durable store (SQLite or PostgreSQL), the operator's signing key, and auditors who compare roots. Google's [Trillian](https://github.com/google/trillian) is an open-source implementation of this pattern.

**Reference implementation:** this repo ships `services/transparency-log/` (source) and a matching Docker image at `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest`. It signs its tree heads with Ed25519 and includes gossip between sibling logs so split-view attacks are detectable (DCP-03 §4). It keeps the log in memory, so a restart empties it. A Fly.io config is in `deploy/fly/transparency-log.toml`.

## Comparison (anchoring methods)

This repository has not measured fees; they change with each chain's market, so check them before choosing.

1. **Transparency log only** (no blockchain) — operator signs the root. No chain fees. Trust is in the operator + auditors. Suitable when the operator is a trusted authority (e.g. government).
2. **Transparency log + Bitcoin batch anchor** — log accumulates entries; anchors root to Bitcoin every N hours (one OP_RETURN tx). The fee is paid per transaction, not per entry, so it is shared by the whole batch. Public immutability for an entire national log.
3. **Bitcoin OP_RETURN per hash** — one tx per bundle_hash, so one fee per hash. Only practical for low-volume or high-value bundles.
4. **Ethereum L2 (Arbitrum, Base, Optimism)** — event per hash or per batch root, paid in L2 gas. Smart-contract queryable.
5. **Ethereum mainnet** — gas per event on mainnet. Justified only if on-chain queryability from mainnet contracts is required.

For a government-scale log, option 2 (log + Bitcoin batch) pays one fee per batch for public verifiability.

## Published artefacts (current state)

The protocol does not require any of the below — they are convenience distributions so operators do not have to build from source. Running everything off-repo is still fully supported.

- **Repo:** `github.com/dcp-ai-protocol/dcp-ai` (Apache-2.0). Anyone can mirror or fork.
- **SDKs:** published under their native registries (npm, PyPI, crates.io, Go modules). Their versions differ and can lag `main`: see [README](../README.md) and each SDK's *Release status*.
- **Service images:** the four optional services (verification, anchor, transparency log, revocation registry) ship as multi-arch Docker images on GHCR. They are reference services: they keep their state in memory (the revocation service can use a file), and the anchor service does not submit to a chain yet ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)):
    - `ghcr.io/dcp-ai-protocol/dcp-ai/verification`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/anchor`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/revocation`
- **Smart contract:** `contracts/ethereum/DCPAnchor.sol` is a Foundry project, ready to deploy to Base, Optimism, or Arbitrum. See [`contracts/ethereum/DEPLOY.md`](../contracts/ethereum/DEPLOY.md).
- **No canonical registry:** DCP-AI does not operate a central "DCP registry" or a hosted verification endpoint. `dcp-ai.org` serves the landing page, docs, playground, and the JSON-LD context for VCs (`/credentials/v2`); it does not verify bundles for anyone.
- **Summary:** every piece of infrastructure a deployment needs is available either as an SDK you embed or as a container you run yourself. Anchoring still uses existing public chains; none of the published artefacts is a dependency of the protocol.

---

## V2.0 Storage Extensions

DCP v2.0 introduces dual hash chains, PQ checkpoints, and an extended bundle manifest for post-quantum readiness.

### Dual Hash Chains

V2.0 audit trails maintain two parallel hash chains for defense in depth:

```
Entry N:
  primary_hash   = SHA-256(canonical(entry_N))
  secondary_hash = SHA3-256(canonical(entry_N))
  prev_hash      = SHA-256(canonical(entry_N-1))       // or "GENESIS"
  prev_hash_secondary = SHA3-256(canonical(entry_N-1)) // or "GENESIS"
```

The secondary chain is optional (`prev_hash_secondary` and `intent_hash_secondary` in the audit entry schema). The specification requires independent verification of the secondary chain when present ([VERIFICATION.md, V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present)). This is a defense-in-depth design: its protection depends on actually checking both chains and preserving trusted commitments.

**Implementation status (27/10/2026):** in the unreleased source code, the TypeScript, Python, Go and Rust V2 bundle verifiers, and the WASM build from the Rust SDK, check every secondary field that is present ([VERIFICATION.md V2-11 and its erratum](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present)): each `prev_hash_secondary` against the entry before it, each `intent_hash_secondary` against the intent, and `audit_merkle_root_secondary` against the entries. Absent fields are not required, so a successful verification does not show that a bundle carries a complete secondary chain. The experimental candidate routes reuse these checks. The published packages listed in [Published versions](README.md#published-versions) predate this change and do not check the secondary fields: until a release includes it, do not interpret their successful verification as evidence that the secondary chain is consistent.

The Merkle tree is computed over the primary (SHA-256) chain. A secondary Merkle root over SHA3-256 hashes is included in the bundle manifest as `audit_merkle_root_secondary`.

### PQ Checkpoints

V2.0 introduces post-quantum checkpoints over the audit trail: records that cover a run of audit entries, signed by the agent with a composite signature (Ed25519 + ML-DSA-65). Their shape is [`schemas/v2/pq_checkpoint.schema.json`](../schemas/v2/pq_checkpoint.schema.json):

```json
{
  "checkpoint_id": "ckpt:...",
  "session_nonce": "a1b2c3d4e5f67890...",
  "event_range": { "from_audit_id": "audit:...", "to_audit_id": "audit:...", "count": 10 },
  "merkle_root": "sha256:...",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

The bundle carries its checkpoints in `pq_checkpoints`, and the signed manifest lists their ids; verifiers check them as in `spec/VERIFICATION.md` V2-12.

Checkpoint frequency depends on the security tier:

| Tier | Checkpoint Interval | Purpose |
|------|-------------------|---------|
| Routine | Every 50 events | Lightweight assurance |
| Standard | Every 10 events | Regular PQ validation |
| Elevated | Every event | Continuous PQ integrity |
| Maximum | Every event + verify | Immediate PQ verification |

With a trusted PQ verification key and a valid PQ signature, a checkpoint authenticates the Merkle commitment to its covered audit entries even if classical signatures are later broken. The checkpoint schema has no timestamp field, and the signature does not establish when the events occurred.

### V2.0 Bundle Manifest

V2.0 bundles include a manifest that pre-computes hashes of all artifacts:

```json
{
  "dcp_bundle_version": "2.0",
  "manifest": {
    "session_nonce": "a1b2c3d4e5f67890...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 50,
    "pq_checkpoints": ["ckpt:..."]
  }
}
```

The fields are those of [`schemas/v2/bundle_manifest.schema.json`](../schemas/v2/bundle_manifest.schema.json); it also has optional `session_issued_at`, `session_expires_at` and `intended_verifier`. The `session_nonce` (256-bit random) binds all artifacts to a single session, so artifacts from one session cannot be mixed into another. It does not stop the whole bundle from being presented again ([SECURITY_MODEL.md](SECURITY_MODEL.md#9-cross-artifact-replay)). The manifest is included in the bundle signature, ensuring its integrity.

### Bundle Size Considerations (V2.0)

V2.0 bundles are larger than V1 due to composite signatures and dual hashes:

| Component | V1 Size | V2 Size | Notes |
|-----------|---------|---------|-------|
| Ed25519 signature | 64 bytes | 64 bytes | Unchanged |
| ML-DSA-65 signature | — | ~3,300 bytes | New in V2 |
| SHA-256 hashes | ~32 bytes each | ~32 bytes each | Unchanged |
| SHA3-256 hashes | — | ~32 bytes each | New in V2 |
| PQ checkpoint | — | ~3,500 bytes | New in V2 |
| Manifest | — | ~500 bytes | New in V2 |
| **Typical bundle** | **~1–2 KB** | **~10–50 KB** | Estimates; depends on audit trail length and tier (spec §14.1) |

For bandwidth-constrained environments, V2.0 defines a CBOR wire format (RFC 8949), which is smaller than JSON; this repository has not published a measurement of the saving.

### Anchoring V2.0 Bundles

The anchoring model remains the same (only hashes on-chain), but V2.0 adds:
- **Dual hash anchoring** (design): a SHA3-256 hash of the bundle could be anchored next to the SHA-256 one; no artifact or tool in this repository defines it yet
- **PQ-signed log roots** (design): transparency log roots could carry composite signatures; the reference log signs them with Ed25519 only
- **OP_RETURN format** (suggested convention): `dcp:v2:<sha256_hex>` (vs. V1's `dcp:v1:<sha256_hex>`)

See [NIST_CONFORMITY.md](NIST_CONFORMITY.md) for post-quantum algorithm compliance details.
See [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for migrating existing V1 anchored data.

## Reference

- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Bundle format: [spec/BUNDLE.md](../spec/BUNDLE.md)
- Technical architecture: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
