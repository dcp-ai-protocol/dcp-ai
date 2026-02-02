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

## 7. Implementation in this repo

- **Schemas:** [schemas/v1/](../schemas/v1/) — JSON Schema draft 2020-12. Each artifact has its `.schema.json`.
- **CLI:** `dcp` — validate, validate-bundle, conformance, keygen, sign-bundle, verify-bundle, bundle-hash, merkle-root. See `dcp help`.
- **Conformance:** `npm run conformance` validates L3-OBJECTS + L3-BUNDLE + L3-SIGNED (individual objects, bundle, signed bundle, cryptographic verification).
- **Fixtures:** [tests/conformance/examples/](../tests/conformance/examples/) — valid examples per schema.

## 8. Why this Genesis Repo matters

- Makes DCP claims testable (schemas + conformance)
- Makes citizenship portable (bundle)
- Makes accountability verifiable (signature)
- Keeps implementation dependency-light (Node, Ajv, NaCl)

## 9. Launch Message (Genesis)

"The internet was built for humans. It is now being used by machines."
"Machines require citizenship."
