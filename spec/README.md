# Specs — DCP-AI normative

Normative specifications for the Digital Citizenship Protocol for AI Agents. The source of truth for formats is JSON Schema in `schemas/v1/`; these documents define scope, artifacts, and how to validate.

| Spec | Scope | Artifacts |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | Identity & Principal Binding | Responsible Principal Record, Agent Passport, Revocation Record |
| [DCP-02](DCP-02.md) | Intent Declaration & Policy Gating | Intent, PolicyDecision, HumanConfirmation (optional) |
| [DCP-03](DCP-03.md) | Audit Chain & Transparency | AuditEntry, prev_hash chaining, optional Merkle |
| [BUNDLE](BUNDLE.md) | Citizenship Bundle & Signed Bundle | Citizenship Bundle (L3), Signed Bundle (Ed25519 signature, bundle_hash, merkle_root) |
| [VERIFICATION](VERIFICATION.md) | Verification checklist | Normative steps to verify a Signed Bundle (schema, signature, expiry, revocation, intent_hash, audit chain, merkle; all local) |

**Validation:** `dcp validate <schema> <json>`, `dcp validate-bundle <bundle.json>`, `dcp verify-bundle <signed.json> <public_key.txt>`, `dcp intent-hash <intent.json>`.  
**Conformance:** `npm run conformance` validates L3-OBJECTS + L3-BUNDLE + L3-SIGNED + intent_hash and prev_hash chain.

---

## Extended Specifications

| Document | Scope |
|----------|-------|
| [DCP-04](DCP-04.md) | Agent-to-Agent Communication |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | Post-Quantum Normative Specification |
| [Security Audit](AUDIT-v2.0-FINAL.md) | v2.0 Final Security Audit (13 gaps closed) |

---

## Core and Profiles

The specification is being organized into a **Core** (minimum interoperable protocol) and **Profiles** (extensions for specific deployment needs):

| Directory | Scope |
|-----------|-------|
| [core/](core/) | DCP Core — artifacts, verification model, bundle structure |
| [profiles/](profiles/) | Profiles — crypto, A2A, governance extensions |
| [profiles/crypto/](profiles/crypto/) | Algorithm selection, composite signatures, crypto-agility |
| [profiles/a2a/](profiles/a2a/) | Agent discovery, handshake, session management |
| [profiles/governance/](profiles/governance/) | Risk tiers, jurisdiction, revocation, key recovery |

The existing specs (DCP-01 through DCP-04, BUNDLE, VERIFICATION, DCP-AI v2.0) remain authoritative. The core and profile documents provide editorial context and clarify the separation of concerns. See the [ROADMAP](../ROADMAP.md) for the planned evolution.
