# Specs — DCP-AI normative

Normative specifications for the Digital Citizenship Protocol for AI Agents. The source of truth for formats is JSON Schema in `schemas/v1/`; these documents define scope, artifacts, and how to validate.

| Spec | Scope | Artifacts |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | Identity & Human Binding | Human Binding Record, Agent Passport, Revocation Record |
| [DCP-02](DCP-02.md) | Intent Declaration & Policy Gating | Intent, PolicyDecision, HumanConfirmation (optional) |
| [DCP-03](DCP-03.md) | Audit Chain & Transparency | AuditEntry, prev_hash chaining, optional Merkle |
| [BUNDLE](BUNDLE.md) | Citizenship Bundle & Signed Bundle | Citizenship Bundle (L3), Signed Bundle (Ed25519 signature, bundle_hash, merkle_root) |
| [VERIFICATION](VERIFICATION.md) | Verification checklist | Normative steps to verify a Signed Bundle (schema, signature, expiry, revocation, intent_hash, audit chain, merkle; all local) |

**Validation:** `dcp validate <schema> <json>`, `dcp validate-bundle <bundle.json>`, `dcp verify-bundle <signed.json> <public_key.txt>`, `dcp intent-hash <intent.json>`.  
**Conformance:** `npm run conformance` validates L3-OBJECTS + L3-BUNDLE + L3-SIGNED + intent_hash and prev_hash chain.
