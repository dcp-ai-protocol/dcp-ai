# Agent Creation and Certification — P2P, no central service

A system that creates agents can produce **DCP-certified** agents by default: human bound, passport issued, signed bundle. **No registration with any central service.** Verification is local. Optional: anchor bundle_hash to a public log/chain (using existing blockchain or third-party service).

## Certification flow (P2P, no registry)

```
Human → Onboard (identity / pseudonymous, jurisdiction)
     → System: keygen human, build RPR, sign RPR

Human → Create agent (capabilities, risk_tier)
     → System: keygen agent, build AP, build bundle, sign bundle
     → Optional: publish bundle_hash only to existing chain/log (user or third party)
     → System: issue signed bundle + keys (+ optional anchor_receipt)

Agent → On each action: build Intent, PolicyDecision, AuditEntry (intent_hash, prev_hash chain)
      → append to audit trail; present signed bundle to verifier
      → Optional: anchor new bundle_hash for audit trail (user or third party)
```

- **Verification is local; no central server required.** Optional anchoring is done by users or third-party anchor services against existing chains/logs.

## Definition of "DCP-certified"

- **Certified (local):** Valid Citizenship Bundle (schema-valid), Signed Bundle (signature valid), RPR and AP with valid signatures (if present), AP.status = active, RPR not expired. Verifier can verify offline. **No server.**
- **Certified + anchored (optional):** Above + bundle_hash (or merkle_root) anchored in a public log or chain; verifier can optionally check that the hash was anchored at a given time. Still no central API that knows agent_id/human_id. Anchoring uses **existing** blockchain or **third-party** log.

## Integration points (no registry)

### On human onboarding

- Generate or accept human keypair (e.g. `dcp keygen keys/human`).
- Build RPR (human_id can be pseudonymous: hash, UUID, or DID).
- Sign RPR with human secret key (e.g. `signObject(hbr, humanSecretKeyB64)`).
- Store locally; do not POST to any central server.

### On agent creation

- Generate agent keypair (e.g. `dcp keygen keys/agent` or second keypair).
- Build AP: principal_binding_reference = RPR.human_id, public_key = agent public key (base64 Ed25519). Sign AP with agent secret key.
- Build minimal bundle: RPR + AP + intent + policy_decision + audit_entries (at least one; use real intent_hash and prev_hash chain per [spec/DCP-03.md](../spec/DCP-03.md)).
- Sign bundle with **human** secret key (e.g. `dcp sign-bundle bundle.json keys/human/secret_key.txt out.signed.json`).
- Optionally anchor bundle_hash to a public log/chain (Bitcoin OP_RETURN, Ethereum event, or third-party transparency log). Store anchor_receipt alongside bundle if used.
- Return to user: signed bundle, agent secret key; optionally anchor_receipt.

### At runtime (agent execution)

- Before each action: build Intent → PolicyDecision → AuditEntry (real intent_hash = SHA-256(canonical(intent)), prev_hash chain: GENESIS then SHA-256(canonical(previous entry))).
- Append to audit trail; optionally re-sign bundle or produce new signed bundle for the updated audit trail.
- Present signed bundle to verifier (e.g. in API request header or body). Verifier runs local verification (see [spec/VERIFICATION.md](../spec/VERIFICATION.md)); optionally checks revocation set (P2P or hash-anchored list) and optional anchor.

## Reference implementation

- **Script:** [scripts/generate-production-examples.js](../scripts/generate-production-examples.js) — generates real RPR, AP, intent, policy, two audit entries (with real intent_hash and prev_hash chain), and signed bundle. Run from repo root: `npm run examples:generate`. Uses `keys/secret_key.txt` (human) and `keys/agent_secret_key.txt` / `keys/agent_public_key.txt` (agent). No server; no registration.
- **CLI:** `dcp keygen`, `dcp sign-bundle`, `dcp verify-bundle`, `dcp intent-hash`, `dcp bundle-hash`, `dcp merkle-root`. Optional anchor step is not in the genesis CLI; users or third-party tools publish hashes to existing chains.

## Checklist for agent-creation systems

1. Keygen human + agent (or accept keys).
2. Build and sign RPR (human key).
3. Build and sign AP (agent key; public_key = agent public).
4. Build intent, policy_decision, audit_entries (real intent_hash, prev_hash chain).
5. Build Citizenship Bundle; sign with human key → Signed Bundle.
6. Optionally anchor bundle_hash (existing chain or third-party log); store anchor_receipt.
7. Issue signed bundle + agent secret key to the agent/runtime.
8. At runtime: build intent → policy → audit entry; append; present signed bundle to verifiers. Verifiers verify locally; no central server call.

---

## V2.0 Agent Creation

DCP v2.0 introduces post-quantum hybrid cryptography, adaptive security tiers, and the CLI wizard for streamlined agent creation.

### CLI Wizard (Recommended)

The fastest way to create a DCP-certified agent:

```bash
npx @dcp-ai/cli init
```

The wizard generates:
- `.dcp/config.json` — Agent configuration
- `.dcp/keys/` — Ed25519 + ML-DSA-65 hybrid keypairs
- `.dcp/identity.json` — Responsible Principal Record (V2)
- `.dcp/passport.json` — Agent Passport (V2)

### V2 Certification Flow

```
Human → Onboard (identity, jurisdiction)
     → System: generate hybrid keypair (Ed25519 + ML-DSA-65)
     → System: build RPR with keys[] (KeyEntry array), sign with composite signature
     → System: compute revocation_token, configure recovery (Shamir SSS)

Human → Create agent (capabilities, security_tier)
     → System: generate agent hybrid keypair
     → System: build AgentPassport with keys[] and owner_rpr_hash
     → System: compute security tier (routine/standard/elevated/maximum)
     → System: build bundle with session_nonce and manifest
     → System: composite-sign bundle (Ed25519 + ML-DSA-65, pq_over_classical binding)
     → Optional: anchor bundle_hash

Agent → On each action:
      → Build IntentV2 (with risk_score, data_classes, security_tier)
      → Evaluate PolicyDecisionV2 (with resolved_tier)
      → Build AuditEventV2 (dual hash chain: SHA-256 + SHA3-256)
      → Generate PQ checkpoint every N events (tier-dependent)
      → Present signed bundle to verifier
```

### V2 Key Structure

V2 agents use hybrid keypairs with deterministic key identifiers:

```json
{
  "keys": [
    {
      "kid": "a1b2c3d4e5f6...",
      "alg": "ed25519",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    },
    {
      "kid": "f6e5d4c3b2a1...",
      "alg": "ml-dsa-65",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    }
  ]
}
```

Key ID derivation: `kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`

### V2 Security Tier Selection

The security tier is computed automatically from the intent's risk profile:

| Condition | Tier |
|-----------|------|
| risk_score >= 800 OR data_classes includes credentials/children_data | Maximum |
| risk_score >= 500 OR data_classes includes pii/financial/health OR payment action | Elevated |
| risk_score >= 200 | Standard |
| Default | Routine |

The tier determines: verification mode, PQ checkpoint frequency, and bundle presentation format.

### V2 Checklist for Agent-Creation Systems

1. Generate hybrid keypair: Ed25519 + ML-DSA-65 (or use `npx @dcp-ai/cli init`)
2. Build RPR with `keys[]` array (KeyEntry format), sign with composite signature
3. Compute `revocation_token = SHA-256(random_secret)`, configure Shamir SSS recovery
4. Build AgentPassport with `keys[]`, `owner_rpr_hash`, capabilities
5. Build IntentV2 with `risk_score`, `data_classes`, compute `security_tier`
6. Build PolicyDecisionV2 with `resolved_tier`
7. Build AuditEventV2 entries with dual hash chain (SHA-256 + SHA3-256)
8. Generate PQ checkpoints per tier interval
9. Build CitizenshipBundleV2 with `session_nonce` and manifest (all artifact hashes)
10. Composite-sign bundle: Ed25519 + ML-DSA-65 with `pq_over_classical` binding
11. Optionally anchor bundle_hash

See [QUICKSTART.md](QUICKSTART.md) for code examples and [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for upgrading from V1.

## Reference

- Storage and anchoring: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
