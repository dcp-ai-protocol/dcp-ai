# Digital Citizenship Protocol for AI Agents (DCP-AI)

**Full Package v1.1 — Genesis Draft**

No AI agent may operate on open networks without a declared, verifiable, and auditable digital citizenship bound to a human or legal entity. This document is the narrative companion to the protocol; the normative specs live in [spec/](../spec/).

---

## 1. Core Thesis

**No AI agent may operate on open networks without a declared, verifiable, and auditable digital citizenship bound to a human or legal entity.**

Digital citizenship binds:
**Agent ↔ Human Owner ↔ Jurisdiction ↔ Ethics ↔ Culture**

## 2. Design Goals

- Enforceable human accountability
- Jurisdiction-aware behavior
- Cultural contextualization
- Universal ethical baseline
- Deterministic policy gating
- Auditable execution
- Incremental adoptability

## 3. Manifiesto Técnico (Protocol Principles)

1. Humans precede agents.
2. Law precedes optimization.
3. Ethics precede capability.
4. No silent actions.
5. Culture shapes interaction.

## 4. Compliance Levels

- L0: Identity only
- L1: Identity + Human Binding
- L2: + Jurisdiction & Culture (future extension)
- L3: + Ethical Baseline + Policy Gating + Audit Chain (core)
- L4: Full DCP-AI (future: federation / VC / attestations)

## 5. Normative Specs (this repo)

Normative specifications are in [spec/](../spec/). Index:

| Spec | Scope | Artifacts |
|------|-------|-----------|
| [DCP-01](../spec/DCP-01.md) | Identity & Human Binding | HBR, Agent Passport, Revocation Record |
| [DCP-02](../spec/DCP-02.md) | Intent Declaration & Policy Gating | Intent, PolicyDecision, HumanConfirmation (optional) |
| [DCP-03](../spec/DCP-03.md) | Audit Chain & Transparency | AuditEntry, chaining, Merkle (optional) |
| [BUNDLE](../spec/BUNDLE.md) | Citizenship Bundle & Signed Bundle | L3 Bundle format, Signed Bundle (Ed25519, bundle_hash, merkle_root) |

## 6. Bundle Format (L3)

A **Citizenship Bundle** brings together HBR, Agent Passport, Intent, Policy Decision, and Audit Entries in a portable packet. A **Signed Bundle** wraps it with an Ed25519 signature and deterministic hashes. Normative definition, schemas, and commands: [spec/BUNDLE.md](../spec/BUNDLE.md).

- **Storage and anchoring:** [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) — P2P; optional anchoring via existing blockchain or third-party log; revocation as signed records (P2P or anchored).
- **Agent creation and certification:** [AGENT_CREATION_AND_CERTIFICATION.md](AGENT_CREATION_AND_CERTIFICATION.md) — P2P certification flow, definition of DCP-certified (local + optional anchor), integration with agent-creation systems.
- **Operator guide — running a verification service:** [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) — how to deploy an optional "agent verified" HTTP API (verify bundles, optional anchor); for third parties.
- **Government deployment:** [GOVERNMENT_DEPLOYMENT.md](GOVERNMENT_DEPLOYMENT.md) — verification service, revocation lists, transparency log, jurisdiction attestation, blockchain anchoring. Cost analysis for national-scale deployment.
- **Technical architecture (global scale):** [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — SDK multi-language (Node/TS, Python, Go, Rust), transparency log, anchor service, middleware, repository structure for worldwide adoption.

## 7. Implementation in this repo

- **Schemas:** [schemas/v1/](../schemas/v1/) — JSON Schema draft 2020-12. Each artifact has its `.schema.json`.
- **CLI:** `dcp` — validate, validate-bundle, conformance, keygen, sign-bundle, verify-bundle, bundle-hash, merkle-root, intent-hash. See `dcp help`.
- **Verification checklist:** [spec/VERIFICATION.md](../spec/VERIFICATION.md) — normative steps to verify a Signed Bundle (schema, signature, expiry, revocation, intent_hash, audit chain, merkle; all local, no server).
- **Conformance:** `npm run conformance` validates L3-OBJECTS + L3-BUNDLE + L3-SIGNED (individual objects, bundle, signed bundle, cryptographic verification).
- **Fixtures:** [tests/conformance/examples/](../tests/conformance/examples/) — valid examples per schema. Regenerate with `npm run examples:generate`.

## 8. Why this Genesis Repo matters

- Makes DCP claims testable (schemas + conformance)
- Makes citizenship portable (bundle)
- Makes accountability verifiable (signature)
- Keeps implementation dependency-light (Node, Ajv, NaCl)

## 9. Launch Message (Genesis)

"The internet was built for humans. It is now being used by machines."
"Machines require citizenship."

## 10. On Authorship

This protocol was co-created by a human and an AI agent working together. It is the first protocol for AI digital citizenship built by the very collaboration it seeks to govern. The spec is the contribution; the authors are anonymous; the protocol belongs to everyone who uses it.
