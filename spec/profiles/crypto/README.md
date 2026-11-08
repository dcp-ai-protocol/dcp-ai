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

### P-ED-1: Ed25519 acceptance criterion

An `ed25519` signature `sig = R ‖ S` (64 bytes) by a public key `A` (32 bytes) over a message `M` is accepted if and
only if all four conditions hold:

1. **Scalar.** S < L, with S read as a 256-bit little-endian integer and L = 2^252 + 27742317777372353535851937790883648493.
2. **Canonical encodings.** A and R are canonical: with `y` the 32 bytes read little-endian with bit 255 cleared, `s`
   bit 255 and p = 2^255 − 19, `y < p`, and not `s = 1` with `y ∈ {1, p − 1}`.
3. **Order.** Neither A nor R is one of the 8 encodings of E[8], the points whose order divides 8 (the identity
   included):

   ```
   0000000000000000000000000000000000000000000000000000000000000000
   0000000000000000000000000000000000000000000000000000000000000080
   0100000000000000000000000000000000000000000000000000000000000000
   26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05
   26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85
   c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a
   c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa
   ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f
   ```

4. **Decoding and equation.** A and R decode to points of the curve, and [S]B = R + [k]A, without cofactor, between
   those points, with k = SHA-512(R ‖ A ‖ M) mod L computed over the original bytes of R and A.

P-ED-1 is a DCP criterion, not one of the options of RFC 8032, whose §5.1.7 uses the unreduced challenge. For A and R
in the prime-order subgroup its equation gives the same result as the RFC's equations; the criterion also rejects the
identity and the other points of E[8]. An A or an R with a torsion component that is not of small order is accepted when
the equation holds: P-ED-1 does not require torsion-free points.

**Implementation.** The SDKs keep their library's check of the equation (TweetNaCl, PyNaCl with libsodium, Go
`crypto/ed25519`, `ed25519-dalek`) and check conditions 1 to 3 on the bytes before calling it: comparisons with
constants, no new curve arithmetic. The library still ensures that A and R are valid points and that the equation holds;
some libraries do it for R by computing the canonical encoding of [S]B − [k]A and comparing it with the received bytes,
an equivalent check that does not decode R. A failed condition is a
rejection (`false`), never an error, and an input that gave an error before (a length, invalid base64) gives the same
error; a public key that does not decode is still `false` in TypeScript, Python and Go and an error in Rust. The checks apply to V1
signed objects and to the default V2 Ed25519 provider, wherever an `ed25519` component is verified. They do not change
which components a mode verifies: under `pq_only` they apply only where the classical component is still verified, such
as the DCP-09 mandates and acknowledgments, which verify both components in every mode. The provider registry is the
operator's: P-ED-1 is the criterion of the default providers, not a guarantee about a custom one.

**Compatibility.** This is an intentional change of acceptance: a signature with S ≥ L, a non-canonical A or R, or A
or R in E[8] is rejected, including where the TypeScript, Go and Rust libraries accepted it before (the official PyNaCl build, with
libsodium 1.0.20, already rejected these inputs, by its code and in the sample observed). Signers do not change: a key from their key generation and the
signatures they produce meet P-ED-1, except a nonce with r ≡ 0 mod L, which gives the identity as R and is rejected
with no exception. Formats, contexts, `dcp-jcs-v1`, schemas, the experimental candidate profile and the earlier APIs do
not change.

**Migration.** Only evidence that fails P-ED-1 is affected. Keep it as it is, and never normalize signed bytes:
re-encoding A or R changes k (and, for A, the `kid`), and reducing S changes the signature bytes and the message of the
PQ component, which signs the classical signature too.

- S ≥ L, or R non-canonical or in E[8]: sign again with the same key, if that key meets P-ED-1.
- A non-canonical: its canonical encoding is another key for DCP, with another `kid`, so rotate the key and sign again.
- A in E[8]: replace the key; signing again with it does not help.

Vectors: [`tests/interop/v2/ed25519_ped1_vectors.json`](../../../tests/interop/v2/ed25519_ped1_vectors.json), checked by
`tools/ed25519-review/check_ped1_vectors.py`. Which verifiers apply P-ED-1 and which do not yet is listed in
[SECURITY_COVERAGE.md](../../../docs/conformance/SECURITY_COVERAGE.md).

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
