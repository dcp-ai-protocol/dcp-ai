# Agent Creation and Certification — P2P, no central service

A system that creates agents can produce **DCP-certified** agents by default: human bound, passport issued, signed bundle. **No registration with any central service.** Verification is local. Optional: anchor bundle_hash to a public log/chain (using existing blockchain or third-party service).

"DCP-certified" on this page means that a bundle passes the local checks defined below. It is not a certificate issued by an authority, it does not confirm who the principal really is, and it does not decide whether a verifier should accept the agent: that is admission, a separate step ([ADMISSION.md](ADMISSION.md)).

> **Tools on this page.** `dcp` is the reference CLI of a source checkout, `node /path/to/dcp-ai/bin/dcp.js`; it reads and writes only inside the current directory. The interactive wizard `@dcp-ai/cli init` is a demo that does not create a valid V2 identity: see [CLI wizard (demo only)](#cli-wizard-demo-only).

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

- **Certified (local):** Valid Citizenship Bundle (schema-valid), Signed Bundle (signature valid), RPR and AP with valid signatures, AP.status = active, RPR not expired. Verifier can verify offline. **No server.**
- **Certified + anchored (optional):** Above + bundle_hash (or merkle_root) anchored in a public log or chain; verifier can optionally check that the hash was anchored at a given time. Still no central API that knows agent_id/human_id. Anchoring uses **existing** blockchain or **third-party** log.

Which tool checks what:

- **V1:** `dcp verify-bundle` and `verifySignedBundle` check the schemas, the bundle signature, `bundle_hash`, `merkle_root` and the audit chain. The RPR and passport signatures, the passport `status` and the RPR `expires_at` are left to the caller; the quickstarts show the signature checks.
- **V2:** `verifySignedBundleV2` also checks the composite signature of each artifact, the passport status (it accepts `active` and `declining`) and the RPR expiry. See [spec/VERIFICATION.md](../spec/VERIFICATION.md).

## Integration points (no registry)

### On human onboarding

- Generate or accept human keypair (e.g. `dcp keygen keys/human`).
- Build RPR (human_id can be pseudonymous: hash, UUID, or DID).
- Sign RPR with human secret key, over the RPR without its `signature` field (e.g. `signObject(rprBody, humanSecretKeyB64)`).
- Store locally; do not POST to any central server.

### On agent creation

- Generate agent keypair (e.g. `dcp keygen keys/agent` or second keypair).
- Build AP: principal_binding_reference = RPR.human_id, public_key = agent public key (base64 Ed25519). Sign AP with agent secret key, over the AP without its `signature` field.
- Build minimal bundle: RPR + AP + intent + policy_decision + audit_entries (at least one; use real intent_hash and prev_hash chain per [spec/DCP-03.md](../spec/DCP-03.md)).
- Sign bundle with **human** secret key (e.g. `dcp sign-bundle bundle.json keys/human/secret_key.txt out.signed.json`).
- Optionally anchor bundle_hash to a public log/chain (Bitcoin OP_RETURN, Ethereum event, or third-party transparency log). Store anchor_receipt alongside bundle if used.
- Return to user: signed bundle, agent secret key; optionally anchor_receipt.

### At runtime (agent execution)

- Before each action: build Intent → PolicyDecision → AuditEntry (real intent_hash = SHA-256(canonical(intent)), prev_hash chain: GENESIS then SHA-256(canonical(previous entry))).
- Append to audit trail; optionally re-sign bundle or produce new signed bundle for the updated audit trail.
- Present signed bundle to verifier (e.g. in API request header or body). Verifier runs local verification (see [spec/VERIFICATION.md](../spec/VERIFICATION.md)); optionally checks revocation set (P2P or hash-anchored list) and optional anchor.

## Reference implementation

- **Script:** [scripts/generate-production-examples.js](../scripts/generate-production-examples.js) — generates real RPR, AP, intent, policy, two audit entries (with real intent_hash and prev_hash chain), and signed bundle, with no server and no registration. It regenerates the repository's own V1 examples (`npm run examples:generate`) and reads the human key from `keys/secret_key.txt`, which is not in the repository (only `keys/public_key.txt` is), so on a fresh checkout it stops there. Read it as a reference for the order of the steps. The agent key comes from `keys/agent_secret_key.txt` / `keys/agent_public_key.txt`, generated when missing.
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

DCP v2.0 introduces post-quantum hybrid cryptography and adaptive security tiers.

### Recommended path: the SDKs

Create V2 identities and bundles with an SDK, as in the tested quickstarts:

- TypeScript: [Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) of the TypeScript SDK, and [QUICKSTART.md](QUICKSTART.md)
- Python: [V2 Bundles](../sdks/python/README.md#v2-bundles) in the Python SDK README

These follow `main`: build the SDK from a checkout as each README's *Release status* explains.

To generate real hybrid keys from a checkout, `dcp keygen --hybrid <out_dir>` writes an Ed25519 and an ML-DSA-65 keypair (ML-DSA-65 from `@noble/post-quantum`) with their kids, and writes the secret key files with mode `0600`.

### CLI wizard (demo only)

`npx @dcp-ai/cli init` (the published `@dcp-ai/cli` was 2.1.0 on 26/10/2026, and its `init` files were identical to this repository's) asks a few questions and writes:

- `.dcp/config.json` — Agent configuration
- `.dcp/keys/` — an Ed25519 keypair, plus an "ML-DSA-65" keypair if you choose hybrid keys
- `.dcp/identity.json` — an RPR-like record
- `.dcp/passport.json` — a passport-like record

Use it to look around, not to create an agent identity:

- **The "ML-DSA-65" keys are simulated.** They are random bytes of the right length, not ML-DSA keys; the wizard says so when it runs. Do not sign with them or publish them as post-quantum keys.
- **`identity.json` and `passport.json` are not V2 artifacts.** They are unsigned and do not match the V2 schemas: the RPR has `entity_name` and `keys` where the schema requires `legal_name`, `binding_keys`, `liability_mode`, `override_rights`, `issued_at` and `expires_at`; the passport has `owner_rpr_hash` where the schema requires `principal_binding_reference` and `risk_tier`. A bundle built from them fails validation.
- **Their revocation tokens cannot be used.** The RPR's `revocation_token` is the hash of a secret that is not kept, and the passport's `emergency_revocation_token` is random, not the hash of any secret you hold.
- **The secret key files get default permissions** (`0644` with the usual umask `022`). Run `chmod 600 .dcp/keys/*_secret.key`, and keep `.dcp/keys/` out of version control.
- **`dcp-ai sign` is not a DCP bundle signature.** It signs `JSON.stringify` of the file, not its `dcp-jcs-v1` canonical form, and appends to a `signatures` array.

### V2 Certification Flow

```
Human → Onboard (identity, jurisdiction)
     → System: generate hybrid keypair (Ed25519 + ML-DSA-65)
     → System: build RPR with binding_keys[] (KeyEntry array), sign with composite signature
     → Optional: recovery configuration (Shamir SSS, spec §11.2)

Human → Create agent (capabilities, risk_tier)
     → System: generate agent hybrid keypair
     → System: build AgentPassport with keys[], principal_binding_reference (the RPR's human_id),
               capabilities and risk_tier; optional emergency_revocation_token (spec §11.3)
     → System: build bundle with session_nonce and manifest
     → System: composite-sign bundle (Ed25519 + ML-DSA-65, pq_over_classical binding)
     → Optional: anchor bundle_hash

Agent → On each action:
      → Build IntentV2 (with action_type, data_classes, estimated_impact; optional security_tier)
      → Evaluate PolicyDecisionV2 (with risk_score; optional resolved_tier)
      → Compute the security tier (routine/standard/elevated/maximum) of the action
      → Build AuditEventV2 (SHA-256 prev_hash chain; optional SHA3-256 secondary chain)
      → Generate PQ checkpoint every N events (tier-dependent)
      → Present signed bundle to verifier

Agent → Lifecycle management (DCP-05):
      → Initial state: commissioned → active (via lifecycle transition)
      → Submit periodic VitalityReport (health metrics, performance)
      → On decline: active → declining (time to prepare succession, DCP-06); declining → active on recovery
      → On end-of-life: → decommissioned (DecommissioningRecord with data_disposition)
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

The security tier is computed automatically from the policy decision's `risk_score` and the intent's `data_classes`, `action_type` and `estimated_impact` (spec §14.2):

| Condition | Tier |
|-----------|------|
| risk_score >= 800 OR data_classes includes credentials/children_data | Maximum |
| risk_score >= 500 OR data_classes includes pii/financial_data/health_data OR initiate_payment OR estimated_impact high OR an unknown or missing value | Elevated |
| risk_score >= 200 OR estimated_impact medium | Standard |
| Default | Routine |

An explicit `security_tier` on the intent can only raise the tier.

The tier determines: verification mode, PQ checkpoint frequency, and the suggested bundle presentation mode.

### V2 Checklist for Agent-Creation Systems

1. Generate hybrid keypair: Ed25519 + ML-DSA-65 (SDK providers, or `dcp keygen --hybrid` from a checkout; not `@dcp-ai/cli init`, whose ML-DSA keys are simulated)
2. Build RPR with `binding_keys[]` array (KeyEntry format), sign with composite signature
3. Optionally put an `emergency_revocation_token` on the passport (spec §11.3): `generateEmergencyRevocationToken()` returns the token and its secret, which you keep offline; optionally configure Shamir SSS recovery (`RecoveryConfig`, spec §11.2)
4. Build AgentPassport with `keys[]`, `principal_binding_reference`, `capabilities` and `risk_tier`
5. Build IntentV2 with `action_type`, `data_classes`, `estimated_impact`, compute `security_tier`
6. Build PolicyDecisionV2 with `risk_score` (integer 0–1000) and, optionally, `resolved_tier`
7. Build AuditEventV2 entries with the `prev_hash` chain (SHA-256; optional SHA3-256 secondary chain)
8. Generate PQ checkpoints per tier interval
9. Build CitizenshipBundleV2 with `session_nonce` and manifest (all artifact hashes)
10. Composite-sign bundle: Ed25519 + ML-DSA-65 with `pq_over_classical` binding
11. Optionally anchor bundle_hash
12. Initialize lifecycle state: create `CommissioningCertificate` with `commissioning_authority`, `purpose` and `initial_capabilities` (DCP-05)
13. Configure succession: optionally create `DigitalTestament` with `successor_preferences` and `memory_classification` (DCP-06)
14. Declare rights: create `RightsDeclaration` with applicable `RightEntry` items and `ObligationRecord` (DCP-08)
15. Set up delegation: if agent acts as delegate, create `DelegationMandate` with `authority_scope` (DCP-09)
16. Configure awareness thresholds: set `AwarenessThreshold` with `threshold_rules` for human-in-the-loop triggers (DCP-09)

See [QUICKSTART.md](QUICKSTART.md) for code examples and [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for upgrading from V1.

## Reference

- Storage and anchoring: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
