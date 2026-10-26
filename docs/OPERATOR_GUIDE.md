# Operator Guide — Running a Verification Service

**Go release (26/10/2026).** Go SDK `v2.11.0` is available from the module tag `sdks/go/v2.11.0`, including verifier fixes, admission and experimental opt-in APIs. Rust publication remains separate. See [Go v2.11.0](GO_RELEASE.md).

This guide is for **third parties** who want to run an "agent verified" service: an HTTP API that verifies DCP Signed Bundles (and optionally anchors hashes to a blockchain). The protocol does **not** require any central server; verification can always be done locally with `dcp verify-bundle`. This service is **optional** and is run at the operator's choice.

## What is an "agent verified" service?

An **agent verification service** is an HTTP API that:

1. **Verifies** a Signed Bundle: runs the same normative checklist as [spec/VERIFICATION.md](../spec/VERIFICATION.md) (schema validation, signature, intent_hash, audit chain, optional merkle_root).
2. Optionally **checks** an `anchor_receipt` against a public blockchain or transparency log (using public data only).
3. Optionally **anchors** a `bundle_hash` to an existing chain and returns an `anchor_receipt` to the client.

The service is **stateless**: each request receives a bundle (and optionally a public key), verifies it, and returns a result. No central registry of agents; the protocol does not define a canonical URL (e.g. no mandatory "dcp.ai" endpoint).

`verified: true` means the bundle is intact and signed by the keys it names. It does not say who the principal is, or whether you should act on the bundle: accepting bundles only from principals you trust is admission, a separate step (`POST /v2/admit` in the reference server, see [ADMISSION.md](ADMISSION.md), unreleased).

## Who runs it?

**Third parties.** Anyone can deploy this service using this repo (schemas + spec + CLI or programmatic API). The protocol author does not operate a central verification server.

## Requirements

- A checkout of this repository: schemas in `schemas/v1/` and `schemas/v2/`, spec in `spec/`, and the reference CLI and
  verification library of the root package, which is not published to npm.
- Ability to run verification: either the CLI (`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`) or the programmatic API from the repo: `verifySignedBundle` (async) and `validateBundle` in `lib/verify.js`. V2 bundles are schema-validated there and then verified by `@dcp-ai/sdk`.
- Optional, for anchoring: RPC or block explorer access to an existing chain (Bitcoin, Ethereum, or a transparency log). See [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md).

## Suggested API contract

So that clients and operators can interoperate, this section suggests a minimal contract. Implementations may extend it.

### POST /verify

Verifies a Signed Bundle against the normative checklist (schema, signature, intent_hash, audit chain, optional merkle).

- **Request (JSON):**
  - `signed_bundle` (object): the Signed Bundle to verify.
  - `public_key_b64` (string, optional): for V1, the signer's public key when the bundle does not include it; otherwise the bundle's `signature.signer.public_key_b64` is used. For V2, it pins the classical signer (refused in `pq_only` mode).

- **Response (JSON):**
  - `verified` (boolean): `true` if all checks pass.
  - `errors` (array of strings, optional): if `verified` is `false`, human-readable error messages.

Example:

```json
// Request
{ "signed_bundle": { "bundle": { ... }, "signature": { ... } } }

// Response (success)
{ "verified": true }

// Response (failure)
{ "verified": false, "errors": ["SIGNATURE INVALID", "Hint: Check that the public key ..."] }
```

The reference server (`server/`) implements this as `POST /verify`. Its response always carries `dcp_version` and `errors`; for V2 it adds `warnings`, `verifier_policy_hash` and `resolved_tier`. Request bodies are JSON.

### POST /anchor (optional)

Anchors a `bundle_hash` to a chain and returns an `anchor_receipt`. The operator configures chain and credentials (e.g. wallet, RPC URL). See [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) for receipt format.

- **Request (JSON):**
  - `bundle_hash` (string): e.g. `sha256:<hex>`.
  - `chain` (string): e.g. `"bitcoin"`, `"ethereum"`.

- **Response (JSON):**
  - `anchor_receipt` (object): e.g. `{ "chain": "bitcoin", "tx_id": "...", "block_height": N }` or Ethereum-style fields.

Implementation of `/anchor` depends on the operator's chain and tooling (Bitcoin OP_RETURN, Ethereum contract event, etc.). The reference anchor service (`services/anchor`) does not implement it yet: it records hashes locally, in memory, with `tx_hash: null` and `onchain: false`, and returns no `anchor_receipt`. The reference verification server answers `POST /anchor` with 501.

## Deployment

The reference verification server, anchor service, transparency log, and revocation registry are all **published as Docker images** on GitHub Container Registry. In most cases you don't need to clone the repo at all — `docker run` is enough.

### Option 1 — pull the reference image (fastest)

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
curl http://localhost:3000/health
```

Multi-arch (`linux/amd64` + `linux/arm64`). Tags: `:latest`, the release semver tags (`:<major>.<minor>.<patch>`, `:<major>.<minor>`, `:<major>`) and `:sha-<short>`. The full stack (verification + anchor + two transparency logs + revocation, five containers) can be brought up with one `docker compose up -d` run in `docker/`, or with `docker compose -f docker/docker-compose.yml up -d` from the repo root.

### Option 2 — managed PaaS

Pre-wired configs for Fly.io are in [`deploy/fly/`](../deploy/fly/); the [deployment guide](../deploy/README.md) also covers Google Cloud Run and Railway patterns.

### Option 3 — embed the verifier in your own service

If you want verification inside your existing application (no separate HTTP service), install the SDK for your language and call its verifier directly (`verifySignedBundleV2` in TypeScript, `verify_signed_bundle_v2` in Python and Rust, `v2.VerifySignedBundleV2` in Go). These commands install the published versions:

```bash
npm install @dcp-ai/sdk        # TypeScript / Node.js
pip install dcp-ai             # Python
cargo add dcp-ai               # Rust
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
```

See each SDK's README for the exact import path and API surface, and its *Release status* for what the published version lacks. On `main`, the TypeScript, Python, Go and Rust SDKs verify V1 and V2 bundles natively, and `@dcp-ai/wasm` exposes the Rust V2 verifier. Their V2 verifiers follow the checklist in [VERIFICATION.md](../spec/VERIFICATION.md), including each artifact's signature (Step V2-8) and the PQ checkpoints (Step V2-12), with one gap: they check the primary audit chain and Merkle root but do not recompute the optional secondary chain or `audit_merkle_root_secondary` (Step V2-11; see [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)).

### Stateless by design

- **No database required** for verification: each request is self-contained.
- **Persistence** is needed for everything else: the gateway's passport and key registries, the anchor queue, the transparency log and the revocation registry.

### Reference services keep state in memory only

The reference gateway (`server/`) and services (`services/`) have no persistent store, except that the revocation service can keep its state in a file (`REVOCATION_STATE_PATH`: off by default in the service, on in the compose file in `docker/`, which puts it on a volume). **A restart, a deploy or a crash wipes their state**, including a crash from running out of memory. That state is:

- registered passports, keys and emergency tokens;
- revocations;
- the transparency log;
- pending anchors and local anchor records.

The one exception is the revocation service with `REVOCATION_STATE_PATH` on persistent storage (a volume): its registrations and revocations survive a restart.

After a wipe, what was recorded is gone, but the gates stay:

- **Registration.** Registering an `agent_id` still needs the operator token, also for an `agent_id` that was registered before the wipe, since every one is new again.
- **Revocation lookups.** The revocation service no longer knows the revocations it recorded:
  - `GET /check/<agent_id>` answers `revoked: false` for an agent revoked before the wipe;
  - `/.well-known/dcp-revocations.json` no longer lists it, so a deny-list revocation source reads it as not revoked;
  - `GET /v2/check/kid/<kid>` answers 404 (status unknown) for its keys.
- **The gateway** forgets its passports, keys (revoked and retired ones included) and emergency tokens.
- **No trust is gained.** A wipe alone does not make a principal trusted or a bundle admitted: admission still needs the operator's trust set and, under strict-v1, a revocation snapshot.

Add persistent storage before relying on these services in production.

To keep memory bounded, the identity, key and revocation registries refuse work instead of evicting state:

| Service | Limit | Setting |
|---------|-------|---------|
| Gateway | Registering a new `agent_id` needs the operator token (401) | `OPERATOR_TOKEN` |
| Gateway | 20 passport registrations per client per hour (429) | `REGISTRATIONS_PER_HOUR` |
| Gateway | 10,000 registered keys; new agents then get 507 (a rotation drops a retired key first, so it still fits) | `MAX_REGISTERED_KEYS` |
| Gateway | 4 rotated-out keys kept per agent; older ones stay revoked as tombstones | — |
| Gateway | 64 keys per agent over its lifetime; further rotations get 409 (raise it for agents that rotate often) | `MAX_KEYS_PER_AGENT` |
| Gateway | 100 POST requests per client per minute, 5 emergency revocations per minute | — |
| Revocation | Registering a new `agent_id` needs the operator token (401) | `OPERATOR_TOKEN` |
| Revocation | 20 registrations per client per hour (429) | `REGISTRATIONS_PER_HOUR` |
| Revocation | 10,000 registered agents; new ones then get 507 | `MAX_AGENTS` |
| Revocation | Text fields of at most 256 characters; 5 emergency revocations per client per minute | — |
| Transparency log | Gossip exchanges need a tree head signed by a pinned peer (`GOSSIP_PEERS=<url>#<key>`); 16 KB bodies; the last 100 distinct alerts; polls read 16 KB at most, time out after one interval and never overlap | `GOSSIP_PEERS` |
| Endpoints that read a body | 1 MB request bodies (413); `POST /v2/disputes/:id/escalate` and `POST /v2/delegation/mandate/:id/revoke` do not read theirs | — |

Two parts of the gateway behave differently:

- **DCP-05–09 record stores evict.** These are the stores for lifecycle, vitality, testaments, succession, disputes, jurisprudence, objections, rights, obligations, violations, mandates, advisory declarations, mirrors, interactions and awareness thresholds. Each keeps at most 10,000 entries, and 10,000 per agent in its per-agent lists, and evicts the oldest (FIFO): an evicted record is gone, without an error.
- **Audit chains have no limit of their own** (`POST /v2/audit/append`). Only the request limits apply to them.

The limits count per client IP. Behind a proxy that appends the client IP to `X-Forwarded-For`, set `TRUST_PROXY=true`; otherwise every client shares the proxy's address.

### Environment variables (verification service)

- `PORT` — HTTP port (default `3000`)
- `OPERATOR_TOKEN` — bearer token for the admin endpoints (policy, advisories, governance) and for registering new `agent_id`s; unset keeps them locked
- `VERIFIER_MODE` — `classical_only` | `hybrid_preferred` | `hybrid_required` | `pq_only`
- `ALLOW_V1_BUNDLES` — `false` rejects V1 bundles
- `TRUST_PROXY`, `REGISTRATIONS_PER_HOUR`, `MAX_REGISTERED_KEYS`, `MAX_KEYS_PER_AGENT` — see above
- `DCP_TRUSTED_PRINCIPALS_FILE`, `DCP_ADMISSION_PROFILE_FILE`, `DCP_REVOCATION_LIST_URL`, `DCP_REVOCATION_LIST_AUTHORIZATION`, `DCP_REVOCATION_TIMEOUT_MS` — admission for `POST /v2/admit`, see [ADMISSION.md](ADMISSION.md)
- `REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING`, `MAX_KEY_AGE_DAYS` and `PQ_CHECKPOINT_INTERVAL` appear in the deploy configs but are not read yet

For `anchor`, `transparency-log`, and `revocation` env variables see their respective README files under [`services/`](../services/) or the per-service `fly.toml` in [`deploy/fly/`](../deploy/fly/).

## Blockchain and verification

- **Verification only:** The service can limit itself to POST `/verify`, applying the [VERIFICATION.md](../spec/VERIFICATION.md) checklist (schema, signature, intent_hash, audit chain, merkle; the SDK verifiers do not yet recompute the optional secondary chain). No blockchain needed.
- **Verify anchor_receipt:** If the client sends an `anchor_receipt` with the bundle, the service can optionally check that `bundle_hash` appears at the given chain/log index using **public data only** (e.g. fetch tx from block explorer). No central server of the protocol is involved.
- **Anchor (write):** The operator runs a node or uses RPC and writes hashes to an existing chain; the service returns `anchor_receipt` to the client. This is optional and operator-specific, and the reference anchor service does not do it yet (see [`services/anchor/README.md`](../services/anchor/README.md)).

---

## V2.0 Verification Service

DCP v2.0 introduces post-quantum hybrid cryptography, adaptive security tiers, and composite signatures. Operators running verification services must update their configuration to support V2.

### Verifier Policy Configuration

The verifiers take a `VerifierPolicy` ([`schemas/v2/verifier_policy.schema.json`](../schemas/v2/verifier_policy.schema.json)). The reference server starts with this one:

```json
{
  "default_mode": "hybrid_required",
  "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_required" },
  "min_classical": 1,
  "min_pq": 1,
  "accepted_classical_algs": ["ed25519"],
  "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
  "accepted_hash_algs": ["sha256", "sha384"],
  "require_session_binding": true,
  "require_composite_binding": true,
  "max_key_age_days": 365,
  "allow_v1_bundles": true,
  "allow_classical_fallback_disable": false,
  "warn_classical_only_deprecated": false,
  "advisory_rejected_algs": []
}
```

`risk_overrides` is keyed by the passport's `risk_tier`. The server has no policy file: `VERIFIER_MODE` and `ALLOW_V1_BUNDLES` set it at startup, `POST /v2/policy/mode` with `{ "mode": "<mode>" }` (operator token) switches the mode at runtime, accepted advisories add to `advisory_rejected_algs`, and `GET /v2/policy` returns the current policy and its hash. A switch of mode sets `default_mode` and every `risk_overrides` entry to that mode. To embed a verifier with your own policy, pass a full policy to the SDK: a partial one is accepted, but the fields you leave out are not filled with defaults (see [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md), Step 8).

Verification modes:
- `classical_only` — Only Ed25519 signatures required (V1 compatibility)
- `hybrid_preferred` — Ed25519 required, ML-DSA-65 checked if present
- `hybrid_required` — Both Ed25519 and ML-DSA-65 composite signature required
- `pq_only` — Only the post-quantum signature is required and checked; a bundle signed `classical_only` is rejected, and a pinned classical key (`public_key_b64`) is refused. In the reference server this mode also turns V1 bundles off.

In every mode, a PQ signature (ML-DSA-65 or SLH-DSA-192f) that is present must verify; an invalid one is rejected.

### POST /verify (V2)

V2 bundles include `composite_sig` with both classical and post-quantum components:

```json
{
  "signed_bundle": {
    "bundle": {
      "dcp_bundle_version": "2.0",
      "manifest": {
        "session_nonce": "a1b2c3...",
        "rpr_hash": "sha256:...",
        "passport_hash": "sha256:...",
        "intent_hash": "sha256:...",
        "policy_hash": "sha256:...",
        "audit_merkle_root": "sha256:...",
        "audit_merkle_root_secondary": "sha3-256:...",
        "audit_count": 1
      },
      "responsible_principal_record": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "agent_passport": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "intent": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "policy_decision": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "audit_entries": [ {...} ]
    },
    "signature": {
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }
}
```

The reference server's V2 response includes the resolved security tier. `POST /v2/bundle/verify` (V2 only; it also accepts the signed bundle as the whole body) answers:

```json
{
  "verified": true,
  "dcp_version": "2.0",
  "errors": [],
  "warnings": [],
  "verifier_policy_hash": "sha256:...",
  "resolved_tier": "elevated",
  "verification_mode": "hybrid_required",
  "session_binding_valid": true,
  "manifest_valid": true
}
```

`POST /verify` gives the same fields up to `resolved_tier`. `session_binding_valid` and `manifest_valid` are read from the error messages, so use `verified` and `errors` to decide.

### Security Tiers in Verification

Each security tier maps to a verification mode and a PQ checkpoint interval (spec §14.1):

| Tier | Verification Mode | PQ Checkpoint |
|------|------------------|---------------|
| Routine | `classical_only` | Every 50 events |
| Standard | `hybrid_preferred` | Every 10 events |
| Elevated | `hybrid_required` | Every event |
| Maximum | `hybrid_required` | Every event |

There is no size budget per tier. A bundle's size depends on its algorithms, its audit entries and PQ checkpoints
and its JSON encoding: measure your largest bundles. For example, the synthetic hybrid bundle
`signed_bundles.base` in `tests/interop/v2/admission_vectors.json` is 32,996 bytes as compact JSON; that is an
observation, not a limit. Send bundles in a JSON request body with an explicit size budget, not in a header (see
[QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md#sending-dcp-bundles-from-a-client)).

The verifier can **upgrade** a tier (e.g., force `elevated` for financial operations) but MUST NOT **downgrade** it. On `main`, the SDK verifiers (TypeScript, Go, Rust, WASM and Python) check the bundle signature and every artifact signature against the stricter of the policy mode (the `risk_overrides` entry for the passport's `risk_tier`, or `default_mode`) and the tier's mode (spec §14.3), so a passport that declares `risk_tier: "low"` still needs a hybrid signature for a payment intent. They also check the PQ checkpoints the bundle carries (`spec/VERIFICATION.md` V2-12). Published versions may lag: see each SDK's *Release status*.

The reference server verifies V2 bundles through `lib/verify.js`, which hands them to the TypeScript SDK of the same checkout with the server's policy; the Docker images build that SDK from the source (see [`docker/Dockerfile`](../docker/Dockerfile)). Its `verification_mode` field is the tier's mode, not the effective mode.

### Capabilities Endpoint (V2)

V2 services expose `GET /.well-known/dcp-capabilities.json`. The reference server answers:

```json
{
  "supported_versions": ["1.0", "2.0"],
  "supported_algs": {
    "signing": ["ed25519", "ml-dsa-65", "slh-dsa-192f"],
    "kem": ["x25519", "ml-kem-768", "x25519-ml-kem-768"],
    "hash": ["sha256", "sha3-256", "sha384"]
  },
  "supported_wire_formats": ["application/json", "application/cbor"],
  "features": {
    "composite_signatures": true,
    "session_binding": true,
    "blinded_rpr": true,
    "dual_hash_chains": true,
    "pq_checkpoints": true,
    "emergency_revocation": true,
    "multi_party_auth": true,
    "pq_only_mode": true,
    "advisory_auto_response": true,
    "governance_keys": true,
    "hsm_provider": true,
    "agent_lifecycle": true,
    "succession": true,
    "dispute_resolution": true,
    "rights_obligations": true,
    "delegation": true
  },
  "verifier_policy_hash": "sha256:...",
  "min_accepted_version": "1.0"
}
```

This is what the server advertises, not a list of checked guarantees. Its endpoints read JSON bodies only, although `application/cbor` is listed. `hsm_provider: true` is advertised, but the repository's HSM provider is a simulation with no hardware backend ([SECURITY_MODEL.md](SECURITY_MODEL.md)).

### Observability

V2 services should expose metrics for monitoring:

- **Latency**: p50/p95/p99 verification latency by security tier
- **Throughput**: Bundles verified per second
- **Cache**: Verification cache hit/miss ratio
- **PQ Checkpoints**: Number of PQ checkpoints verified
- **Errors**: Error counts by DCP error code (DCP-E001 through DCP-E902)
- **Tiers**: Distribution of verification requests by security tier

Recommended: Use the SDK's built-in `dcpTelemetry` module with OpenTelemetry-compatible exporters ([OBSERVABILITY.md](OBSERVABILITY.md)). The reference server does not emit these metrics itself.

### Migration for Existing V1 Operators

Existing V1 operators can upgrade incrementally:

1. Update to DCP v2.0 SDK
2. Set `default_mode: 'classical_only'` (`VERIFIER_MODE=classical_only` in the reference server); the security tier still raises the mode to `hybrid_required` for elevated and maximum actions
3. Gradually enable `hybrid_preferred` for new agents
4. Move to `hybrid_required` when PQ adoption is sufficient

See [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for detailed migration steps.

## DCP-05–09 Service Endpoints

DCP v2.0 extends the verification server with 31 endpoints for lifecycle management, digital succession, dispute resolution, rights framework, and personal representation.

> **Unauthenticated and unverified.** These endpoints check each record against its schema and the format of its IDs. They do not verify any `composite_sig`, and they need no operator token. Anyone who can reach the server can, for example, decommission or re-commission an agent, revoke a revocable mandate, or mark a dispute resolved. Setting `OPERATOR_TOKEN` does not protect them: it guards only the admin routes and new `agent_id` registrations. Do not expose them to untrusted clients: put them behind your own authorization, or do not expose them at all, and treat what they store as unverified records.

Each POST takes the record under the key named in the table (for example `{ "commissioning_certificate": { ... } }`). `:agent_id` and `:id` are URL-encoded.

### DCP-05: Agent Lifecycle Management

| Method | Endpoint | Body key | Description |
|--------|----------|----------|-------------|
| POST | `/v2/lifecycle/commission` | `commissioning_certificate` | Puts the agent in state `commissioned`; for an agent already known, this resets its state and history |
| POST | `/v2/lifecycle/vitality` | `vitality_report` | Stores a vitality report; a different `state` in the report is a lifecycle transition |
| POST | `/v2/lifecycle/decommission` | `decommissioning_record` | Moves the agent to `decommissioned`, and marks a registered passport `decommissioned` |
| GET | `/v2/lifecycle/:agent_id` | — | Current state, history and number of vitality reports |

Lifecycle transitions the server accepts: `commissioned → active`, `active → declining`, `active → decommissioned`, `declining → decommissioned`. The SDK's state machine also allows `commissioned → decommissioned` and `declining → active`.

### DCP-06: Digital Succession & Inheritance

| Method | Endpoint | Body key | Description |
|--------|----------|----------|-------------|
| POST | `/v2/succession/testament` | `digital_testament` | Stores the agent's testament (one per agent) |
| GET | `/v2/succession/testament/:agent_id` | — | The agent's testament |
| POST | `/v2/succession/execute` | `succession_record` | Records a succession; the predecessor must be `declining` or `decommissioned` when the server knows its state |
| POST | `/v2/succession/memory-transfer` | `memory_transfer_manifest` | Validates the manifest and answers with counts; it is not stored |
| GET | `/v2/succession/:agent_id` | — | Successions recorded for a predecessor |

### DCP-07: Conflict Resolution & Dispute Arbitration

| Method | Endpoint | Body key | Description |
|--------|----------|----------|-------------|
| POST | `/v2/disputes/create` | `dispute_record` | Stores a dispute |
| POST | `/v2/disputes/:id/escalate` | — | Moves the dispute to the next escalation level |
| POST | `/v2/disputes/:id/resolve` | `arbitration_resolution` (optional) | Marks the dispute resolved; the resolution, when given, is stored as is |
| GET | `/v2/disputes/:id` | — | The dispute |
| POST | `/v2/objections/create` | `objection_record` | Stores an objection |
| POST | `/v2/jurisprudence` | `jurisprudence_bundle` | Stores a jurisprudence bundle |
| GET | `/v2/jurisprudence` | — | All stored jurisprudence bundles |

### DCP-08: Rights & Obligations Framework

| Method | Endpoint | Body key | Description |
|--------|----------|----------|-------------|
| POST | `/v2/rights/declare` | `rights_declaration` | Stores the agent's rights declaration (one per agent) |
| GET | `/v2/rights/:agent_id` | — | The agent's rights declaration |
| POST | `/v2/obligations/record` | `obligation_record` | Adds an obligation record |
| GET | `/v2/obligations/:agent_id` | — | The agent's obligation records |
| POST | `/v2/rights/violation` | `violation_report` | Stores a rights violation report |

### DCP-09: Personal Representation & Delegation

| Method | Endpoint | Body key | Description |
|--------|----------|----------|-------------|
| POST | `/v2/delegation/mandate` | `delegation_mandate` | Stores a mandate |
| GET | `/v2/delegation/mandate/:id` | — | The mandate, with `revoked` |
| POST | `/v2/delegation/mandate/:id/revoke` | — | Revokes a mandate whose `revocable` is true |
| POST | `/v2/agent-advisory/declare` | `advisory_declaration` | Stores an advisory declaration |
| GET | `/v2/agent-advisory/:id` | — | The advisory declaration |
| POST | `/v2/mirror/generate` | `principal_mirror` | Adds a principal mirror |
| GET | `/v2/mirror/:agent_id` | — | The agent's principal mirrors |
| POST | `/v2/interactions/record` | `interaction_record` | Stores an interaction record |
| POST | `/v2/awareness/threshold` | `awareness_threshold` | Stores the agent's awareness threshold (one per agent) |
| GET | `/v2/awareness/threshold/:agent_id` | — | The agent's awareness threshold |

A record stored by ID, or one per agent, is replaced by a later POST for the same ID or agent. Objections, violation reports and interaction records have no GET endpoint.

### Production Hardening

The DCP-05–09 endpoints have:

- **JSON Schema validation** — Every POST that submits a record is validated against its schema before storage. `escalate` and `revoke` take no record; `resolve` takes an optional `arbitration_resolution`, which it stores without validating it
- **Rate limiting** — 100 requests/minute/IP on all POST endpoints
- **Body size limits** — 1 MB maximum request body (returns 413) where the body is read; `escalate` and `revoke` do not read it
- **Input ID validation** — The IDs the server keys on must match `^[\w:.\-]{1,256}$`; other characters are rejected
- **Bounded storage** — each in-memory store keeps at most 10,000 entries and evicts the oldest (FIFO): an evicted record is gone. The identity registries refuse instead (507); see [Reference services keep state in memory only](#reference-services-keep-state-in-memory-only)
- **Security headers** — X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, Cache-Control

They do **not** include signature verification of the records or any authentication (see the note at the top of this section).

## Reference

- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Storage and anchoring: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Bundle format: [spec/BUNDLE.md](../spec/BUNDLE.md)
