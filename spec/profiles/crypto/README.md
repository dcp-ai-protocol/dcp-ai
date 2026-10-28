# Crypto Profile

**Status:** Published — v2.0  
**Scope:** Cryptographic algorithm selection, composite signatures, crypto-agility, and verifier policy  

---

## Purpose

DCP Core requires cryptographic signatures and hash functions but deliberately does not mandate specific algorithms. The Crypto Profile defines the concrete cryptographic choices used in DCP v2.0 and the mechanisms for evolving those choices over time.

This separation ensures that:

- The core protocol survives algorithm transitions (e.g., post-quantum migration) without structural changes
- Verifiers can enforce their own algorithm policies based on risk context
- Implementations can start with classical algorithms and adopt post-quantum when ready
- Algorithm deprecation does not break the core specification

## What Lives Here (Not in Core)

### Algorithm Registry

The set of approved signature algorithms (Ed25519, ML-DSA-65, ML-DSA-87, SLH-DSA-192f), key encapsulation mechanisms (X25519, ML-KEM-768, hybrid X25519+ML-KEM-768), and hash algorithms (SHA-256, SHA3-256, SHA-384).

> *Informative note (25/10/2026), not part of the profile:* no DCP-AI SDK implements ML-DSA-87 yet, and none exports the hybrid X25519+ML-KEM-768 exchange ([docs/NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md)).

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 2 for the full registry.

### Composite Signature Binding

The `pq_over_classical` binding protocol that ensures neither the classical nor the post-quantum signature component can be stripped:

1. Classical signature signs `context || 0x00 || payload`
2. PQ signature signs `context || 0x00 || payload || classical_sig`

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 5 for the binding protocol and wire format.

### Domain Separation

Context tags that prevent cross-artifact replay attacks. Each artifact type has a unique context tag (e.g., `DCP-AI.v2.AgentPassport`, `DCP-AI.v2.Intent`).

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 4 for the full tag list.

### Verification Modes

Verifier-authoritative policy that determines which signature components are required:

- `classical_only` — only classical signatures required
- `hybrid_preferred` — classical required, PQ recommended
- `hybrid_required` — both classical and PQ required
- `pq_only` — only PQ signatures required (Phase 3)

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 7 for verification modes and verifier policy format.

### Crypto-Agility

The Algorithm Advisory System that allows governance authorities to deprecate or revoke algorithms via signed advisories, with automated verifier response.

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 13.2 and the [AUDIT report](../../AUDIT-v2.0-FINAL.md) Gap #4.

### Dual-Hash Chains

Parallel SHA-256 and SHA3-256 hash chains for audit entries, providing continuity if one hash family is compromised.

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 10.3.

## What Stays in Core

- The requirement that artifacts are signed (but not which algorithm)
- The requirement that audit entries are hash-chained (but not which hash function)
- The bundle structure and verification model
- The `bundle_hash` and `merkle_root` concepts

## Normative References

- [DCP-AI v2.0](../../DCP-AI-v2.0.md) — Sections 2 (Algorithm Registry), 4 (Domain Separation), 5 (Composite Signatures), 7 (Verification Modes), 10.3 (Dual-Hash), 13.2 (Advisory System)
- [NIST Conformity](../../../docs/NIST_CONFORMITY.md) — NIST post-quantum cryptography conformance
- [Security Model](../../../docs/SECURITY_MODEL.md) — Threat model and protection layers

## Implementation notes (informative)

> **Added 25/10/2026. Not normative.** These notes add no requirement and change nothing above: they describe how
> the reference code on `main` relates to this text. Where they differ, the normative text above stands.

- The composite binding makes stripping detectable only where the verifier requires it. The mode that counts is
  the effective one the verifier resolves, which can be stricter than the requested `default_mode` once the risk
  tier, the security tier and the policy are applied. In the SDK verifiers, removing the PQ signature and
  relabelling the binding as `classical_only` is accepted when the effective mode is `classical_only` or
  `hybrid_preferred` (with a warning in `hybrid_preferred`), and refused when it is `hybrid_required` or `pq_only`.
  Only an explicitly absent PQ signature can be tolerated: a PQ signature that is present under
  `pq_over_classical` and invalid is refused in every mode, and every other check still applies.
- `pq_only` in the SDK verifiers still expects the `pq_over_classical` binding with the classical signature bytes
  present, since the PQ signature covers them; it does not accept a bundle that carries a PQ signature alone.
- The advisory system is not automatic: a verifier applies an advisory when its operator loads it and calls the
  advisory helpers or sets the policy accordingly.
- The SDK verifiers check the SHA-256 audit chain and Merkle root; from `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 and Rust `dcp-ai` 2.11.1 they also check the secondary SHA3-256 fields that are present (V2-11 of [VERIFICATION.md](../../VERIFICATION.md) and its erratum), which earlier versions do not.
