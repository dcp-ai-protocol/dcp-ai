# IETF Positioning Strategy for DCP

**Status:** Editorial Draft  
**Date:** 2026-03-01  

---

## 1. Overview

This document articulates which parts of the Digital Citizenship Protocol (DCP) are suitable for IETF standardization, which parts should remain outside the standards track, and the rationale for the separation.

The core insight is that DCP has three distinct layers with different standardization profiles:

- **DCP Core** — suitable for standardization: defines artifacts, relationships, and verification
- **Profiles** — partially suitable: some profile aspects (wire formats, media types) benefit from standardization; others (algorithm choices, governance) are deployment-specific
- **Services** — not suitable for standardization: operational infrastructure varies by deployment

---

## 2. Why DCP Core Can Aspire to Standardization

DCP Core defines a minimal, portable accountability layer with properties that align well with IETF standards work:

### Protocol-level interoperability

Any two parties implementing DCP Core can exchange and verify bundles without prior coordination beyond agreeing on the protocol version. The core defines a common vocabulary of artifacts (principal binding, passport, intent, policy outcome, evidence, bundle) with well-defined semantics.

### Algorithm independence

The core does not mandate specific cryptographic algorithms. It requires signatures and hash chains but delegates algorithm selection to profiles. This mirrors the IETF pattern of separating protocol structure from algorithm suites (as in TLS, JOSE, COSE).

### Minimal trust assumptions

Verification is local and P2P. A verifier needs only the Signed Bundle and optionally a revocation list. No central authority, no online lookup, no shared state. This is architecturally compatible with Internet-scale deployment.

### Clear scope

The core answers four questions (who, what intent, what policy, what evidence) and defines how to verify the answers. It does not try to standardize policy engines, governance models, or operational infrastructure.

### Existing IETF alignment

The current IETF draft ([draft-dcp-ai-citizenship-00](../IETF_DRAFT.md)) already uses RFC 2119 / 8174 terminology, references NIST FIPS standards for cryptography, and defines wire formats with proper media types.

---

## 3. What Should Be in the Internet-Draft

The following DCP Core elements are candidates for an IETF Internet-Draft:

### Artifacts and their structure

- Responsible Principal Binding (RPR)
- Agent Passport
- Intent Declaration
- Policy Outcome (currently Policy Decision)
- Action Evidence (currently Audit Entry)
- Citizenship Bundle and Signed Bundle

### Verification pipeline

The normative steps a verifier must perform to validate a Signed Bundle: schema validation, signature check, hash integrity, principal validity, agent status, intent binding, audit chain integrity, Merkle root.

### Wire formats

- JSON (default, with RFC 8785 JCS canonicalization)
- CBOR (optional, RFC 8949 deterministic encoding)
- Media types: `application/dcp-bundle+json`, `application/dcp-bundle+cbor`

### Well-known URIs

- `/.well-known/dcp-capabilities.json`
- `/.well-known/dcp-revocations.json`
- `/.well-known/dcp-agent-directory.json`
- `/.well-known/governance-keys.json`

### Security considerations

Algorithm independence, stripping attack prevention, cross-protocol replay prevention, session binding, privacy (blinded mode).

---

## 4. What Should Stay Outside IETF (For Now)

### Specific cryptographic algorithms

The algorithm registry (Ed25519, ML-DSA-65, ML-KEM-768, etc.) is better suited to a companion document or a registry, not the core protocol draft. Algorithm choices evolve faster than protocol structure. The core should define the *slots* for algorithms, not fill them.

This mirrors the IETF pattern: TLS defines cipher suite negotiation, but cipher suites are registered separately.

### Composite signature binding protocol

The `pq_over_classical` binding is a specific construction for hybrid post-quantum signatures. While important, it is an algorithm-level mechanism that should live in the Crypto Profile or a companion draft, not in the core protocol specification.

### Agent-to-agent communication (DCP-04)

A2A defines a full handshake protocol, session management, transport bindings, and trust model. This is substantial enough for its own draft and depends on deployment context (WebSocket vs. gRPC, discovery mechanisms). It should not be bundled with the core accountability layer.

### Governance mechanisms

Risk tier assignment, jurisdiction attestation, revocation policies, key recovery, governance ceremonies — these are deployment-specific and should not constrain the core protocol. Different jurisdictions will have different governance requirements.

### Adaptive security tiers

The four-tier system is a policy mechanism, not a protocol structure. The core should define the `security_tier` field but not mandate specific tier definitions or the selection algorithm.

### Operational infrastructure

Verification servers, anchoring services, transparency logs, revocation registries — these are implementation choices, not protocol requirements.

---

## 5. Recommended IETF Strategy

### Phase 1: Informational RFC

Submit the core protocol as an Informational RFC to establish the concepts, artifacts, and verification model. This is the lowest-risk path and allows the community to evaluate the approach before committing to a standards-track document.

The current draft ([draft-dcp-ai-citizenship-00](../IETF_DRAFT.md)) is already structured as Informational.

### Phase 2: Companion documents

If the Informational RFC gains traction, produce companion documents for:

- Algorithm registry (like an IANA considerations document for DCP algorithm identifiers)
- Composite signature binding (possibly as a standalone draft)
- A2A protocol (as a separate Internet-Draft)
- Wire format details (CBOR encoding, media type registration)

### Phase 3: Standards Track (conditional)

If there is sufficient community adoption and working group interest, propose a standards-track version of the core protocol. This would require demonstrating interoperability between at least two independent implementations — which the existing multi-language SDKs (TypeScript, Python, Go, Rust, WASM) can provide.

---

## 6. Gap Analysis: Current Draft vs. Core/Profiles Separation

The existing IETF draft ([draft-dcp-ai-citizenship-00](../IETF_DRAFT.md)) contains both core and profile material. The following sections would need to be factored out or marked as profile-scoped in a revised draft:

| Current Draft Section | Core or Profile? | Action |
|----------------------|-------------------|--------|
| Sections 1–3 (Intro, Terminology, Overview) | Core | Keep |
| Section 4 (Identity Layer) | Core | Keep, use RPR terminology |
| Section 5 (Intent and Policy Layer) | Core | Keep |
| Section 5.3 (Adaptive Security Tiers) | Governance Profile | Move to companion or mark informative |
| Section 6 (Audit Layer) | Core | Keep |
| Section 6.2–6.4 (Dual-Hash, PQ Checkpoints, Compaction) | Crypto Profile | Move to companion or mark informative |
| Section 7 (A2A Communication) | A2A Profile | Move to separate draft |
| Section 8 (Cryptographic Algorithms) | Crypto Profile | Move to companion |
| Section 8.4–8.6 (Composite, kid, Domain Sep) | Crypto Profile | Move to companion |
| Section 9 (Wire Formats) | Core (JSON) + Profile (CBOR) | Split |
| Section 10 (Security Considerations) | Core + Profile | Split |
| Section 11 (IANA Considerations) | Core | Keep |
| Appendices A–C | Core + Profile | Split |

---

## 7. Next Steps

1. Stabilize the DCP Core specification ([spec/core/dcp-core.md](../../spec/core/dcp-core.md))
2. Review the existing IETF draft for alignment with the core/profiles separation
3. Prepare a revised draft that focuses on core artifacts and verification
4. Factor out profile material into companion documents
5. Engage with relevant IETF working groups (potentially RATS, OAUTH, or a new WG)

---

## References

- [DCP Core Specification](../../spec/core/dcp-core.md)
- [IETF Draft](../IETF_DRAFT.md) — Current Internet-Draft
- [Crypto Profile](../../spec/profiles/crypto/)
- [A2A Profile](../../spec/profiles/a2a/)
- [Governance Profile](../../spec/profiles/governance/)
- [ROADMAP](../../ROADMAP.md) — Project evolution roadmap
