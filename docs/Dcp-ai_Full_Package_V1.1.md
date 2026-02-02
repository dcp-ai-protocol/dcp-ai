# Digital Citizenship Protocol for AI Agents (DCP-AI)

**Full Package v1.1 — Genesis Draft**

This document is the narrative companion to the **genesis repo**.
Executable protocol artifacts live in:
- `schemas/v1/*.schema.json` (machine-checkable specs)
- `tools/*` (validation, merkle, signing)
- `bin/dcp.js` (CLI)
- `tests/conformance/*` (fixtures + conformance)

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

## 5. Normative Specs Implemented in this Repo
### DCP-01 — Identity & Human Binding
- Human Binding Record (HBR)
- Agent Passport (AP)
- Revocation Record

### DCP-02 — Intent Declaration & Policy Gating
- Intent object
- PolicyDecision object
- HumanConfirmation (optional)

### DCP-03 — Audit Chain & Transparency
- AuditEntry
- Hash chaining (GENESIS → ...)
- Audit root (Merkle optional)

## 6. Bundle Format (L3 Bundle)
A **Citizenship Bundle** is a minimal portable packet used for verification at the edge:
- Human Binding Record
- Agent Passport
- Intent
- Policy Decision
- Audit Entries[]

A **Signed Bundle** wraps a bundle with an Ed25519 signature + deterministic hashes:
- `bundle_hash = sha256(canonicalize(bundle))`
- `merkle_root = sha256(merkle(audit_entries))` (optional)

## 7. Why this Genesis Repo matters
- Makes DCP claims testable (schemas + conformance)
- Makes citizenship portable (bundle)
- Makes accountability verifiable (signature)
- Keeps implementation dependency-light (Node, Ajv, NaCl)

## 8. Launch Message (Genesis)
"The internet was built for humans. It is now being used by machines."
"Machines require citizenship."
