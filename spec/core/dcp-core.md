# DCP Core Specification

**Status:** Editorial Draft  
**Version:** 0.1.0  
**Date:** 2026-03-01  

---

## 1. Introduction

The Digital Citizenship Protocol (DCP) defines a portable accountability layer for AI agents operating on open networks. DCP Core is the minimum interoperable protocol surface: the set of artifacts, relationships, and verification rules that every conformant implementation must support.

A verifier receiving a DCP bundle can answer four questions without relying on any central authority:

1. **Who is responsible** for this agent?
2. **What did the agent declare** it intended to do?
3. **What policy outcome** was applied to that intent?
4. **What verifiable evidence** exists of the agent's actions?

DCP Core defines the structure and semantics of these answers. It does not prescribe specific cryptographic algorithms, transport mechanisms, governance policies, or operational infrastructure — those belong to profiles and services.

### 1.1 Relationship to Existing Specifications

This document is an editorial specification that organizes and unifies the material already published in:

- [DCP-01](../DCP-01.md) — Identity & Principal Binding
- [DCP-02](../DCP-02.md) — Intent Declaration & Policy Gating
- [DCP-03](../DCP-03.md) — Audit Chain & Transparency
- [BUNDLE](../BUNDLE.md) — Citizenship Bundle format
- [VERIFICATION](../VERIFICATION.md) — Verification checklist
- [DCP-AI v2.0](../DCP-AI-v2.0.md) — Full normative specification including post-quantum extensions

It does not replace those documents. It provides a unified core view and clarifies the boundary between core and profiles.

---

## 2. Problem Statement

AI agents are increasingly operating autonomously on open networks: calling APIs, exchanging data, making transactions, and collaborating with other agents. Existing authentication mechanisms (API keys, OAuth tokens, mTLS certificates) establish *access control* but not *accountability*.

There is no standardized way to answer:

- Who deployed this agent and accepts responsibility for its actions?
- What did the agent declare it would do before it acted?
- Was the action authorized by a policy?
- Is there a tamper-evident record of what actually happened?

DCP Core addresses this gap by defining a minimal, portable set of artifacts that any agent can carry and any verifier can evaluate.

---

## 3. Scope

### In Scope (Core)

- The six core artifacts and their required fields
- The relationships between artifacts (binding, hashing, chaining)
- The verification model (what a verifier must check)
- The bundle format (how artifacts are packaged for transport)
- The requirement for cryptographic signatures (without specifying algorithms)
- The requirement for hash-chaining of audit entries (without specifying hash functions)

### Out of Scope (Profiles and Services)

- Specific cryptographic algorithms → [Crypto Profile](../profiles/crypto/)
- Agent-to-agent discovery and communication → [A2A Profile](../profiles/a2a/)
- Risk tier assignment, jurisdiction, revocation, governance → [Governance Profile](../profiles/governance/)
- Verification servers, blockchain anchoring, transparency logs → Infrastructure Services
- Policy engine implementation
- Key management infrastructure deployment
- Network transport requirements beyond wire format

---

## 4. Core Artifacts

DCP Core defines six artifacts. A valid Citizenship Bundle contains all six (though Action Evidence may contain one or more entries).

### 4.1 Responsible Principal Binding

Every agent MUST be bound to a responsible principal — a human, organization, or legal entity that accepts accountability for the agent's actions.

The binding record contains:

- A unique identifier for the principal
- The type of entity (natural person, legal entity)
- The jurisdiction under which the principal operates
- Cryptographic key material for signature verification
- A revocation commitment (enabling emergency revocation without a signature)
- Protocol version and session binding

The binding establishes the chain of accountability: if an agent misbehaves, the responsible principal can be identified.

See [DCP-01](../DCP-01.md) for the normative definition and `schemas/v1/responsible_principal_record.schema.json` for the schema.

### 4.2 Agent Passport

Each agent carries a passport that establishes its identity and links it to its responsible principal. The passport contains:

- A unique agent identifier
- A human-readable name
- Declared capabilities
- A cryptographic hash of the responsible principal's binding record (`owner_rpr_hash`)
- The agent's own key material
- Status (active, suspended, revoked)
- Protocol version and session binding

The passport is signed by the responsible principal. A verifier can confirm that the agent is authorized by checking the principal's signature and the hash linkage.

See [DCP-01](../DCP-01.md) for the normative definition and `schemas/v1/agent_passport.schema.json` for the schema.

### 4.3 Intent Declaration

Before performing any action, an agent MUST declare its intent. The intent is a structured description of:

- What action the agent plans to take
- What the target of the action is
- What data classifications are involved
- An assessed risk score

The intent serves two purposes: it enables policy gating (Section 4.4) and it creates a pre-commitment record that can be compared against actual behavior in the audit trail.

See [DCP-02](../DCP-02.md) for the normative definition and `schemas/v1/intent.schema.json` for the schema.

### 4.4 Policy Outcome

Each intent receives a policy outcome from a policy engine. The policy engine is external to DCP — the protocol defines only the outcome format:

- **Decision:** approve, escalate, or block
- **Intent hash:** cryptographic binding to the evaluated intent
- **Conditions:** optional constraints on approval (rate limits, human confirmation, etc.)

DCP Core requires that a policy outcome exists for every intent in a bundle. It does not require any specific policy engine or decision algorithm.

See [DCP-02](../DCP-02.md) for the normative definition and `schemas/v1/policy_decision.schema.json` for the schema.

### 4.5 Action Evidence

Every action produces one or more audit entries that form a hash-chained, tamper-evident log. Each entry contains:

- A unique event identifier
- The event type
- A reference to the agent and the intent
- A hash of the intent (binding the evidence to the declaration)
- A hash of the previous audit entry (`prev_hash`), forming an immutable chain
- A timestamp

The first entry in a chain uses the sentinel value `"GENESIS"` as its `prev_hash`. Subsequent entries chain to their predecessor via `SHA-256(canonical(previous_entry))`.

Optionally, a Merkle root can be computed over all entries, providing a single hash that summarizes the entire audit trail.

See [DCP-03](../DCP-03.md) for the normative definition and `schemas/v1/audit_entry.schema.json` for the schema.

### 4.6 Bundle Manifest

The Citizenship Bundle is the portable package that brings all artifacts together. A bundle contains exactly:

- One Responsible Principal Binding record
- One Agent Passport
- One Intent Declaration
- One Policy Outcome
- One or more Action Evidence entries (audit trail)

The Signed Bundle wraps the Citizenship Bundle with a cryptographic signature, a `bundle_hash` (hash of the canonical bundle), and optionally a `merkle_root` over the audit entries.

See [BUNDLE](../BUNDLE.md) for the normative definition and `schemas/v1/citizenship_bundle.schema.json` / `schemas/v1/signed_bundle.schema.json` for the schemas.

---

## 5. Verification Model

A verifier receiving a Signed Bundle performs the following checks. All checks are local — no server call is required.

1. **Schema validation** — the bundle and its inner artifacts conform to the expected schemas
2. **Signature verification** — the bundle signature is valid against the signer's public key
3. **Hash integrity** — the `bundle_hash` matches the recomputed hash of the canonical bundle
4. **Principal validity** — the responsible principal record is not expired
5. **Agent status** — the agent passport status is `active`
6. **Intent binding** — each audit entry's `intent_hash` matches the hash of the declared intent
7. **Audit chain integrity** — the `prev_hash` chain is valid from `GENESIS` through all entries
8. **Merkle root** (if present) — the declared Merkle root matches the recomputed root

Additional optional checks (defined in profiles, not core):

- Revocation list lookup (Governance Profile)
- Jurisdiction attestation verification (Governance Profile)
- Transparency log inclusion proof (Governance Profile)
- Blockchain anchor verification (Governance Profile)
- Composite signature / PQ verification (Crypto Profile)

See [VERIFICATION](../VERIFICATION.md) for the full normative checklist.

---

## 6. Security Notes

### 6.1 Algorithm Independence

DCP Core requires cryptographic signatures and hash functions but does not mandate specific algorithms. This separation allows:

- Implementations to start with classical algorithms and adopt post-quantum later
- Verifiers to enforce their own algorithm policies
- The protocol to survive algorithm transitions without breaking the core specification

The [Crypto Profile](../profiles/crypto/) defines the specific algorithms, composite signature binding, and crypto-agility mechanisms used in DCP v2.0.

### 6.2 Trust Model

DCP does not assume a central authority. Verification is local and P2P: a verifier needs only the Signed Bundle and (optionally) a set of revocation records. Trust in the responsible principal is established through the binding record and its signature chain, not through a centralized registry.

### 6.3 Privacy

The core supports a blinded mode where PII fields in the principal binding are replaced by a commitment hash (`pii_hash`). Non-PII fields (keys, jurisdiction, liability) are preserved for verification. The full record can be disclosed to authorized parties on demand.

### 6.4 Replay Protection

In DCP v2.0, a `session_nonce` field ties all artifacts in a bundle to a single session. Verifiers must check that all artifacts share the same nonce. This prevents session splicing attacks. Session binding is normatively required in v2.0 but was not present in v1.0.

---

## 7. Extensibility

DCP Core is designed to be extended through profiles. A profile:

- MUST NOT contradict core requirements
- MAY define additional artifacts, fields, or verification steps
- MAY specify algorithm choices, transport bindings, or governance policies
- Is versioned independently of the core

A conformant core implementation is valid without any profile. Profiles add capabilities, not requirements.

The currently defined profiles are:

| Profile | Scope | Document |
|---------|-------|----------|
| Crypto | Algorithms, composite signatures, crypto-agility | [spec/profiles/crypto/](../profiles/crypto/) |
| A2A | Agent discovery, handshake, session management | [spec/profiles/a2a/](../profiles/a2a/) |
| Governance | Risk tiers, jurisdiction, revocation, recovery | [spec/profiles/governance/](../profiles/governance/) |

---

## References

- [DCP-01](../DCP-01.md) — Identity & Principal Binding
- [DCP-02](../DCP-02.md) — Intent Declaration & Policy Gating
- [DCP-03](../DCP-03.md) — Audit Chain & Transparency
- [DCP-04](../DCP-04.md) — Agent-to-Agent Communication
- [BUNDLE](../BUNDLE.md) — Citizenship Bundle format
- [VERIFICATION](../VERIFICATION.md) — Verification checklist
- [DCP-AI v2.0](../DCP-AI-v2.0.md) — Post-Quantum Normative Specification
- [ROADMAP](../../ROADMAP.md) — Project evolution roadmap
