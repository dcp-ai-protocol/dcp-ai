# Agent Creation and Certification — P2P, no central service

A system that creates agents can produce **DCP-certified** agents by default: human bound, passport issued, signed bundle. **No registration with any central service.** Verification is local. Optional: anchor bundle_hash to a public log/chain (using existing blockchain or third-party service).

## Certification flow (P2P, no registry)

```
Human → Onboard (identity / pseudonymous, jurisdiction)
     → System: keygen human, build HBR, sign HBR

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

- **Certified (local):** Valid Citizenship Bundle (schema-valid), Signed Bundle (signature valid), HBR and AP with valid signatures (if present), AP.status = active, HBR not expired. Verifier can verify offline. **No server.**
- **Certified + anchored (optional):** Above + bundle_hash (or merkle_root) anchored in a public log or chain; verifier can optionally check that the hash was anchored at a given time. Still no central API that knows agent_id/human_id. Anchoring uses **existing** blockchain or **third-party** log.

## Integration points (no registry)

### On human onboarding

- Generate or accept human keypair (e.g. `dcp keygen keys/human`).
- Build HBR (human_id can be pseudonymous: hash, UUID, or DID).
- Sign HBR with human secret key (e.g. `signObject(hbr, humanSecretKeyB64)`).
- Store locally; do not POST to any central server.

### On agent creation

- Generate agent keypair (e.g. `dcp keygen keys/agent` or second keypair).
- Build AP: human_binding_reference = HBR.human_id, public_key = agent public key (base64 Ed25519). Sign AP with agent secret key.
- Build minimal bundle: HBR + AP + intent + policy_decision + audit_entries (at least one; use real intent_hash and prev_hash chain per [spec/DCP-03.md](../spec/DCP-03.md)).
- Sign bundle with **human** secret key (e.g. `dcp sign-bundle bundle.json keys/human/secret_key.txt out.signed.json`).
- Optionally anchor bundle_hash to a public log/chain (Bitcoin OP_RETURN, Ethereum event, or third-party transparency log). Store anchor_receipt alongside bundle if used.
- Return to user: signed bundle, agent secret key; optionally anchor_receipt.

### At runtime (agent execution)

- Before each action: build Intent → PolicyDecision → AuditEntry (real intent_hash = SHA-256(canonical(intent)), prev_hash chain: GENESIS then SHA-256(canonical(previous entry))).
- Append to audit trail; optionally re-sign bundle or produce new signed bundle for the updated audit trail.
- Present signed bundle to verifier (e.g. in API request header or body). Verifier runs local verification (see [spec/VERIFICATION.md](../spec/VERIFICATION.md)); optionally checks revocation set (P2P or hash-anchored list) and optional anchor.

## Reference implementation

- **Script:** [scripts/generate-production-examples.js](../scripts/generate-production-examples.js) — generates real HBR, AP, intent, policy, two audit entries (with real intent_hash and prev_hash chain), and signed bundle. Run from repo root: `npm run examples:generate`. Uses `keys/secret_key.txt` (human) and `keys/agent_secret_key.txt` / `keys/agent_public_key.txt` (agent). No server; no registration.
- **CLI:** `dcp keygen`, `dcp sign-bundle`, `dcp verify-bundle`, `dcp intent-hash`, `dcp bundle-hash`, `dcp merkle-root`. Optional anchor step is not in the genesis CLI; users or third-party tools publish hashes to existing chains.

## Checklist for agent-creation systems

1. Keygen human + agent (or accept keys).
2. Build and sign HBR (human key).
3. Build and sign AP (agent key; public_key = agent public).
4. Build intent, policy_decision, audit_entries (real intent_hash, prev_hash chain).
5. Build Citizenship Bundle; sign with human key → Signed Bundle.
6. Optionally anchor bundle_hash (existing chain or third-party log); store anchor_receipt.
7. Issue signed bundle + agent secret key to the agent/runtime.
8. At runtime: build intent → policy → audit entry; append; present signed bundle to verifiers. Verifiers verify locally; no central server call.

## Reference

- Storage and anchoring: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Full Package: [Dcp-ai_Full_Package_V1.1.md](Dcp-ai_Full_Package_V1.1.md)
