# Digital Citizenship: A Peer-to-Peer Protocol for Human-Bound AI Agents

The internet was built for humans. It is now being used by machines. Machines require citizenship.

We propose a protocol: no AI agent may operate on open networks without a declared, verifiable, and auditable digital citizenship bound to a human or legal entity. Identity, intent, policy decisions, and audit trails become first-class, portable, and verifiable. This repo is the genesis implementation — schemas, CLI, and conformance tests that make the claim testable.

This protocol was co-created by a human and an AI agent working together — the first protocol designed for AI digital citizenship, built by the very collaboration it seeks to govern. The spec is the contribution; the protocol belongs to everyone who uses it.

— L. Genesis

---

**Specifications (normative):** [spec/](../spec/) — DCP-01 (Identity & Principal Binding), DCP-02 (Intent & Policy Gating), DCP-03 (Audit Chain), [BUNDLE](../spec/BUNDLE.md) (Citizenship Bundle & Signed Bundle).

**Technical architecture:** [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — SDK, infrastructure, and deployment blueprint for global adoption.

---

## V2.0 Evolution

The genesis vision — that every AI agent must carry verifiable, human-bound digital citizenship — remains the foundation. DCP v2.0 evolves the protocol to meet the threats and opportunities of a post-quantum world:

- **Post-quantum cryptography**: Hybrid composite signatures (Ed25519 + ML-DSA-65, FIPS 204) protect against quantum adversaries and "harvest now, decrypt later" attacks. The classical signature ensures backward compatibility; the PQ signature provides future-proof security.
- **Agent-to-agent communication (DCP-04)**: Agents can now discover, authenticate, and communicate securely with each other using mutual bundle verification and hybrid key exchange (X25519 + ML-KEM-768).
- **Adaptive security tiers**: Four levels (routine, standard, elevated, maximum) allow the protocol to balance performance and security based on operational risk.
- **Dual hash chains**: Audit trails use both SHA-256 and SHA3-256 for defense in depth.
- **Production readiness**: Standardized error codes, rate limiting, circuit breakers, and observability make the protocol deployable at scale.
- **Ecosystem bridges**: Interoperability with W3C DID/VC, Google A2A, Anthropic MCP, and Microsoft AutoGen.

The protocol still belongs to everyone who uses it. The spec remains the contribution.

**V2.0 Specifications:**
- [DCP-04 (Agent-to-Agent)](../spec/DCP-04.md)
- [DCP-AI v2.0 Specification](../spec/DCP-AI-v2.0.md)
- [NIST Conformity](NIST_CONFORMITY.md)
- [IETF Internet-Draft](IETF_DRAFT.md)
- [Migration Guide (V1 → V2)](MIGRATION_V1_V2.md)
