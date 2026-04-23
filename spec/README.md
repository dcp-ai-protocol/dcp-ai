<sub>**English** · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# Specs — DCP-AI normative

Normative specifications for the Digital Citizenship Protocol for AI Agents. The source of truth for formats is JSON Schema in `schemas/v1/` and `schemas/v2/`; these documents define scope, artifacts, and how to validate.

## Foundation Specifications (DCP-01 – DCP-03)

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

## Communication & Cryptography (DCP-04, v2.0)

| Document | Scope |
|----------|-------|
| [DCP-04](DCP-04.md) | Agent-to-Agent Communication |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | Post-Quantum Normative Specification |
| [Security Audit](AUDIT-v2.0-FINAL.md) | v2.0 Final Security Audit (13 gaps closed) |

---

## Constitutional Framework (DCP-05 – DCP-09)

Specifications governing agent lifecycle, succession, dispute resolution, rights, and delegation — the constitutional layer of the protocol.

| Spec | Scope | Key Artifacts |
|------|-------|---------------|
| [DCP-05](DCP-05.md) | Agent Lifecycle Management | CommissioningCertificate, VitalityReport, DecommissioningRecord |
| [DCP-06](DCP-06.md) | Digital Succession & Inheritance | DigitalTestament, SuccessionRecord, MemoryTransferManifest |
| [DCP-07](DCP-07.md) | Conflict Resolution & Dispute Arbitration | DisputeRecord, ArbitrationResolution, JurisprudenceBundle, ObjectionRecord |
| [DCP-08](DCP-08.md) | Rights & Obligations Framework | RightsDeclaration, ObligationRecord, RightsViolationReport |
| [DCP-09](DCP-09.md) | Personal Representation & Delegation | DelegationMandate, AdvisoryDeclaration, PrincipalMirror, AwarenessThreshold |

**Schemas:** 18 JSON Schemas in `schemas/v2/` covering all DCP-05–09 artifacts.
**Server endpoints:** 31 REST endpoints in the verification server (see [OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md)).
**Domain separation:** 6 new contexts — `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`.

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

The existing specs (DCP-01 through DCP-09, BUNDLE, VERIFICATION, DCP-AI v2.0) remain authoritative. The core and profile documents provide editorial context and clarify the separation of concerns. See the [ROADMAP](../ROADMAP.md) for the planned evolution.
