# DCP-AI NIST Post-Quantum Cryptography Conformity Statement

**Specification version:** 2.0
**Last updated:** April 2026
**Status:** Active — matches shipped SDKs at v2.0.x

This document describes how DCP-AI aligns with NIST post-quantum cryptographic standards and provides a conformity assessment for implementers. DCP-AI incorporates NIST FIPS 203, FIPS 204, and FIPS 205 algorithms as core components of its hybrid post-quantum security architecture.

---

## 1. Standards Coverage

| NIST Standard | Algorithm | DCP-AI Usage | Shipped | Notes |
|---------------|-----------|-------------|---------|-------|
| FIPS 203 | ML-KEM-768 | Hybrid KEM for A2A sessions, envelope encryption | TypeScript, Rust, Go, WASM | Python provider not yet shipped (tracked). |
| FIPS 204 | ML-DSA-65 | Post-quantum signatures in composite binding | All 5 SDKs | Primary PQ signature. |
| FIPS 204 | ML-DSA-87 | High-assurance post-quantum signatures | HSM interface only (no native provider) | Reserved for hardware-backed Maximum tier. |
| FIPS 205 | SLH-DSA-192f | Backup hash-based signature scheme | TypeScript, Python, Rust, Go | Active backup. |
| FIPS 205 | SLH-DSA-256f | Level 5 hash-based signatures | Not shipped | Reserved. |
| SP 800-208 | LMS / XMSS guidance | Informs stateless hash-based sig selection | Reference only | DCP-AI uses stateless SLH-DSA, not LMS/XMSS. |

---

## 2. Algorithm Parameter Mapping

### 2.1 ML-KEM (FIPS 203) — Key Encapsulation

DCP-AI uses ML-KEM-768 in a hybrid construction with X25519 for agent-to-agent (A2A) session establishment and optional envelope encryption.

| Parameter | FIPS 203 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | ML-KEM-768 | `ml-kem-768` | NIST Security Level 3 |
| Public Key Size | 1184 bytes | 1184 bytes | Conformant |
| Ciphertext Size | 1088 bytes | 1088 bytes | Conformant |
| Shared Secret Size | 32 bytes | 32 bytes | Conformant |
| Hybrid Construction | N/A | X25519 + ML-KEM-768 | Combined shared secret via HKDF-SHA256 |
| DCP-AI Identifier | N/A | `x25519-ml-kem-768` | Hybrid KEM identifier |
| Key Derivation | N/A | HKDF-SHA256 (RFC 5869) | `info = "DCP-AI.v2.A2A.SessionKey"` |

**Usage in DCP-AI:**

- **A2A Handshake (DCP-04):** Both parties exchange ephemeral hybrid KEM public keys. Each party encapsulates to the other's key. Session keys are derived by combining both shared secrets via HKDF-SHA256.
- **Key Recovery:** Shamir SSS shares are encrypted with hybrid KEM to recovery contacts.

**Hybrid KEM Construction:**

```
combined_pk = x25519_pk || ml_kem_768_pk       (1216 bytes)
combined_ct = x25519_ct || ml_kem_768_ct       (1120 bytes)
shared_secret = HKDF-SHA256(
  ikm  = x25519_shared_secret || ml_kem_768_shared_secret,
  salt = context_nonce,
  info = purpose_tag
)
```

### 2.2 ML-DSA (FIPS 204) — Digital Signatures

DCP-AI uses ML-DSA-65 as the primary post-quantum signature algorithm in composite binding with Ed25519. ML-DSA-87 is available for elevated security requirements.

#### ML-DSA-65 (Primary)

| Parameter | FIPS 204 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | ML-DSA-65 | `ml-dsa-65` | NIST Security Level 3 |
| Public Key Size | 1952 bytes | 1952 bytes | Conformant |
| Secret Key Size | 4032 bytes | 4032 bytes | Conformant |
| Signature Size | 3309 bytes | 3309 bytes | Conformant |
| Domain Separation | context string parameter | Context tag prefix | See Section 3 |
| Randomized Signing | Yes (default) | Yes | Hedged with system randomness |

#### ML-DSA-87 (High-Assurance — Reserved)

ML-DSA-87 is reserved for Maximum-tier deployments backed by hardware security modules. The algorithm identifier and key/signature sizes below are part of the specification; a native software provider is not shipped in the v2.0.x SDKs. The HSM provider interface exposes `ml-dsa-87` as a supported algorithm so that PKCS#11 tokens that implement it can be used transparently.

| Parameter | FIPS 204 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | ML-DSA-87 | `ml-dsa-87` | NIST Security Level 5 |
| Public Key Size | 2592 bytes | 2592 bytes | Conformant |
| Secret Key Size | 4896 bytes | 4896 bytes | Conformant |
| Signature Size | 4627 bytes | 4627 bytes | Conformant |
| Status | — | HSM-only | No software provider in current SDK release. |

**Usage in DCP-AI:**

- **Composite Signatures:** ML-DSA-65 signs the concatenation of (context_tag || 0x00 || payload || classical_sig) in the `pq_over_classical` binding mode.
- **PQ Checkpoints:** ML-DSA-65 signs Merkle roots of audit event batches.
- **Bundle Signing:** Bundle-level composite signatures pair Ed25519 with ML-DSA-65.

### 2.3 SLH-DSA (FIPS 205) — Stateless Hash-Based Signatures

DCP-AI uses SLH-DSA-192f as a backup post-quantum signature scheme. SLH-DSA provides security based solely on hash function security assumptions, offering defense-in-depth if lattice-based assumptions (ML-DSA) are weakened.

#### SLH-DSA-192f (Backup)

| Parameter | FIPS 205 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | SLH-DSA-SHA2-192f | `slh-dsa-192f` | NIST Security Level 3, fast variant |
| Public Key Size | 48 bytes | 48 bytes | Conformant |
| Secret Key Size | 96 bytes | 96 bytes | Conformant |
| Signature Size | 35,664 bytes | 35,664 bytes | Conformant |
| Hash Function | SHA-256 | SHA-256 | Conformant |

#### SLH-DSA-256f (Reserved)

| Parameter | FIPS 205 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | SLH-DSA-SHA2-256f | `slh-dsa-256f` | NIST Security Level 5 |
| Public Key Size | 64 bytes | 64 bytes | Reserved for future use |
| Signature Size | 49,856 bytes | 49,856 bytes | Reserved for future use |

**Usage in DCP-AI:**

- **Algorithm Fallback:** If ML-DSA is subject to a governance deprecation advisory, verifiers can transition to SLH-DSA-192f as the PQ component in composite signatures.
- **High-Assurance Audits:** Organizations with conservative security postures may require SLH-DSA alongside ML-DSA.

### 2.4 SP 800-208 Alignment

NIST SP 800-208 provides recommendations for stateful hash-based signature schemes (LMS and XMSS). While DCP-AI uses the stateless SLH-DSA rather than stateful schemes, the following guidance from SP 800-208 is incorporated:

| SP 800-208 Recommendation | DCP-AI Approach |
|---------------------------|-----------------|
| Use NIST-approved hash-based signatures | SLH-DSA-192f (FIPS 205) — stateless, no state management risk |
| Protect against key reuse | Deterministic kid derivation prevents key confusion |
| Key lifecycle management | Key rotation with PoP, expiry dates, revocation lists |
| Hardware security modules | HSM/TPM provider interface (PKCS#11) |

DCP-AI chose stateless SLH-DSA over stateful LMS/XMSS to avoid the operational risk of state synchronization failures in distributed agent deployments.

---

## 3. Domain Separation and Context Binding

FIPS 204 (ML-DSA) supports an optional context string for domain separation. DCP-AI implements domain separation as follows:

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

This is applied before passing the message to both the classical (Ed25519) and post-quantum (ML-DSA) signing functions. The 0x00 separator byte prevents ambiguity between context tags and payload data.

| DCP Context Tag | Maps To |
|-----------------|---------|
| `DCP-AI.v2.AgentPassport` | Agent identity signing |
| `DCP-AI.v2.ResponsiblePrincipal` | Responsible Principal Record signing |
| `DCP-AI.v2.Intent` | Intent declaration signing |
| `DCP-AI.v2.PolicyDecision` | Policy decision signing |
| `DCP-AI.v2.AuditEvent` | Per-event audit signing |
| `DCP-AI.v2.Bundle` | Bundle-level signing |
| `DCP-AI.v2.Revocation` | Revocation record signing |
| `DCP-AI.v2.KeyRotation` | Key rotation proof |
| `DCP-AI.v2.Governance` | Governance operations |

---

## 4. Test Vector References

### 4.1 NIST KAT Directory

DCP-AI maintains Known Answer Test vectors in `tests/nist-kat/`:

```
tests/nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 Section 7.1 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
```

### 4.2 Ed25519 (RFC 8032)

Ed25519 is deterministic. Test vectors are taken directly from RFC 8032 Section 7.1. All DCP-AI SDKs MUST produce identical signatures for a given (secret_key, message) pair.

### 4.3 ML-DSA-65 (FIPS 204)

ML-DSA-65 uses randomized signing. Direct KAT comparison requires seed control which varies across cryptographic libraries. DCP-AI validates ML-DSA-65 conformance through:

| Test | Description | Gate |
|------|-------------|------|
| Size conformance | Public key = 1952 B, Signature = 3309 B | MUST pass |
| Round-trip | `verify(pk, sign(sk, msg), msg) == true` | MUST pass |
| Wrong-key rejection | `verify(pk_other, sign(sk, msg), msg) == false` | MUST pass |
| Cross-SDK verification | Signature from SDK A verifies in SDK B | MUST pass |
| Deterministic kid | `kid(alg, pk)` is identical across all SDKs | MUST pass |
| Domain separation | Signature with context tag A does not verify under tag B | MUST pass |
| Composite binding | Stripping classical sig invalidates PQ sig | MUST pass |

### 4.4 SLH-DSA-192f (FIPS 205)

| Test | Description | Gate |
|------|-------------|------|
| Size conformance | Public key = 48 B, Signature = 35,664 B | MUST pass |
| Round-trip | Sign then verify succeeds | MUST pass |
| Wrong-key rejection | Verify with different key fails | MUST pass |
| Cross-SDK verification | Interoperability across SDKs | MUST pass |

### 4.5 ML-KEM-768 (FIPS 203)

| Test | Description | Gate |
|------|-------------|------|
| Size conformance | Public key = 1184 B, Ciphertext = 1088 B, SS = 32 B | MUST pass |
| Round-trip | `decapsulate(encapsulate(pk)) == shared_secret` | MUST pass |
| Wrong-key rejection | Decapsulate with different key fails | MUST pass |
| Hybrid construction | Combined HKDF output matches reference | MUST pass |

### 4.6 Running KAT Tests

```bash
# TypeScript SDK (vitest)
cd sdks/typescript && npx vitest run src/__tests__/nist-kat.test.ts

# Python SDK (pytest)
cd sdks/python && pytest tests/test_nist_kat.py -v

# Go SDK (conformance + interop + PQ providers in one run)
cd sdks/go && go test ./...

# Rust SDK (dedicated integration test)
cd sdks/rust && cargo test --test nist_kat
```

---

## 5. Conformity Checklist for Implementers

Use this checklist to verify that your DCP-AI implementation conforms to NIST PQ standards.

### 5.1 ML-KEM-768 (FIPS 203) Checklist

- [ ] Public key size is exactly 1184 bytes
- [ ] Ciphertext size is exactly 1088 bytes
- [ ] Shared secret size is exactly 32 bytes
- [ ] Encapsulation uses FIPS 203 compliant implementation
- [ ] Decapsulation uses FIPS 203 compliant implementation
- [ ] Hybrid construction combines X25519 and ML-KEM-768 shared secrets via HKDF-SHA256
- [ ] HKDF info parameter includes DCP-AI context tag
- [ ] Ephemeral keys are generated per session (forward secrecy)
- [ ] KAT tests pass for size, round-trip, and wrong-key rejection

### 5.2 ML-DSA-65 (FIPS 204) Checklist

- [ ] Public key size is exactly 1952 bytes
- [ ] Signature size is exactly 3309 bytes
- [ ] Signing uses FIPS 204 compliant implementation
- [ ] Verification uses FIPS 204 compliant implementation
- [ ] Domain separation context tags are prepended before signing
- [ ] Composite binding: PQ signature covers `context || 0x00 || payload || classical_sig`
- [ ] kid derivation: `hex(SHA-256(UTF8("ml-dsa-65") || 0x00 || raw_pk))[0:32]`
- [ ] KAT tests pass for size, round-trip, wrong-key, cross-SDK, and domain separation

### 5.3 ML-DSA-87 (FIPS 204) Checklist

- [ ] Public key size is exactly 2592 bytes
- [ ] Signature size is exactly 4627 bytes
- [ ] Same domain separation and composite binding as ML-DSA-65
- [ ] kid derivation uses `"ml-dsa-87"` as algorithm identifier
- [ ] KAT tests pass

### 5.4 SLH-DSA-192f (FIPS 205) Checklist

- [ ] Public key size is exactly 48 bytes
- [ ] Signature size is exactly 35,664 bytes
- [ ] Signing uses FIPS 205 compliant implementation
- [ ] Verification uses FIPS 205 compliant implementation
- [ ] Same domain separation pattern as ML-DSA
- [ ] kid derivation uses `"slh-dsa-192f"` as algorithm identifier
- [ ] KAT tests pass

### 5.5 General Cryptographic Checklist

- [ ] All PQ operations use constant-time implementations where possible
- [ ] Private keys are zeroized after use (secure memory disposal)
- [ ] HSM/TPM provider interface is available for production deployments
- [ ] Algorithm advisory system is implemented for crypto-agility
- [ ] Integer-only numeric fields (no floating-point) in all signed payloads
- [ ] RFC 8785 (JCS) canonicalization for all JSON signing

---

## 6. Migration Path: Classical to Post-Quantum

DCP-AI defines a three-phase migration path from classical-only to post-quantum security.

### Phase 1: Hybrid Introduction

| Aspect | State |
|--------|-------|
| Default Verification Mode | `hybrid_preferred` |
| Classical Signatures | Required |
| PQ Signatures | Recommended, not required |
| V1 Bundles | Accepted |
| Composite Binding | Available, not mandatory |

Actions for implementers:
1. Integrate ML-DSA-65 provider alongside Ed25519.
2. Generate hybrid key pairs (Ed25519 + ML-DSA-65).
3. Produce composite signatures where possible.
4. V1 bundles continue to verify normally.

### Phase 2: Hybrid Required

| Aspect | State |
|--------|-------|
| Default Verification Mode | `hybrid_required` |
| Classical Signatures | Required |
| PQ Signatures | Required |
| V1 Bundles | Accepted with warnings |
| Composite Binding | Mandatory for V2 |

Actions for implementers:
1. All V2 bundles MUST include composite signatures.
2. Verifier policy enforces `min_pq >= 1`.
3. Dual-hash chains (SHA-256 + SHA3-256) SHOULD be enabled.
4. V1 bundles emit deprecation warnings.

### Phase 3: PQ-Only (Future)

| Aspect | State |
|--------|-------|
| Default Verification Mode | `pq_only` |
| Classical Signatures | Optional (accepted, not required) |
| PQ Signatures | Required |
| V1 Bundles | Rejected |
| Composite Binding | Not required (PQ sufficient) |

Actions for implementers:
1. Classical signatures become optional.
2. V1 bundles are rejected by default.
3. Governance advisory system may deprecate classical algorithms.
4. SLH-DSA-192f provides backup if ML-DSA is weakened.

### Migration Timeline (Recommended)

```
2026 Q1-Q2    Phase 1: Hybrid Introduction  [CURRENT]
              - SDKs v2.0.x ship composite signatures
              - Verifiers accept both V1 and V2 bundles
              - Early-adopter integrations surface real-world load

2026 Q3-Q4    Phase 2: Hybrid Required
              - Verifier policies default to hybrid_required
              - V1 bundles emit deprecation warnings
              - Wider production deployments

2027+         Phase 3: PQ-Only (conditional)
              - Triggered by a governance advisory if classical
                algorithms are weakened
              - V1 bundle rejection
              - Full post-quantum operation
```

---

## 7. NIST PQ Standards Transition Guidance Alignment

DCP-AI aligns with NIST's published transition guidance for post-quantum cryptography:

| NIST Guidance | DCP-AI Implementation |
|--------------|----------------------|
| Begin hybrid deployments early | Hybrid composite signatures from v2.0 launch |
| Use FIPS 203/204/205 approved algorithms | ML-KEM-768, ML-DSA-65/87, SLH-DSA-192f |
| Maintain crypto-agility | Algorithm registry + advisory system + provider abstraction |
| Plan for algorithm deprecation | Governance-signed advisories with auto-response |
| Protect long-lived data | Hash-chained audit trails with dual-hash chains |
| Use hybrid constructions during transition | `pq_over_classical` composite binding |
| Hardware security modules for key storage | HSM/TPM provider interface (PKCS#11) |
| Test interoperability | Cross-SDK KAT validation, conformance test suite |

---

## 8. Cryptographic Library Requirements

Implementations MUST use cryptographic libraries that provide NIST-compliant algorithm implementations.

### Libraries used by each shipped SDK

| SDK | Library | Algorithms |
|-----|---------|-----------|
| TypeScript (`@dcp-ai/sdk`) | `@noble/post-quantum` | ML-DSA-65, ML-KEM-768, SLH-DSA-192f |
| TypeScript (`@dcp-ai/sdk`) | `@noble/curves` | Ed25519, X25519 |
| TypeScript (`@dcp-ai/sdk`) | `@noble/hashes` | SHA-256, SHA3-256, HKDF |
| Python (`dcp-ai`) | `pqcrypto` (PQClean) | ML-DSA-65, SLH-DSA-192f |
| Python (`dcp-ai`) | `pynacl` (libsodium) | Ed25519 |
| Go (`sdks/go/v2`) | `github.com/cloudflare/circl` | ML-DSA-65, ML-KEM-768, SLH-DSA-192f |
| Go (`sdks/go/v2`) | `crypto/ed25519` (stdlib) | Ed25519 |
| Rust (`dcp-ai` crate) | `fips203`, `fips204`, `fips205` (RustCrypto) | ML-KEM-768, ML-DSA-65, SLH-DSA-192f |
| Rust (`dcp-ai` crate) | `ed25519-dalek` | Ed25519 |
| WASM (`@dcp-ai/wasm`) | Compiled from the Rust crate above | Same set as Rust |

ML-KEM-768 is not yet exposed through the Python SDK's public provider surface; A2A sessions that require it currently use the TypeScript or Rust SDK. This is a scoping gap, not a design limitation — the same `pqcrypto` dependency can back it when the Python provider is added.

### Library Audit Requirements

For production deployments, cryptographic libraries SHOULD:
- Have undergone independent security audit
- Implement constant-time operations for secret-dependent branches
- Provide secure memory zeroization APIs
- Pass NIST KAT vectors for all PQ algorithms

---

## 9. References

- **FIPS 203** — NIST, "Module-Lattice-Based Key-Encapsulation Mechanism Standard", August 2024.
- **FIPS 204** — NIST, "Module-Lattice-Based Digital Signature Standard", August 2024.
- **FIPS 205** — NIST, "Stateless Hash-Based Digital Signature Standard", August 2024.
- **SP 800-208** — NIST, "Recommendation for Stateful Hash-Based Signature Schemes", October 2020.
- **RFC 5869** — Krawczyk, H. and P. Eronen, "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)", May 2010.
- **RFC 8032** — Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", January 2017.
- **RFC 8785** — Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", June 2020.
- **DCP-AI v2.0 Normative Specification** — `spec/DCP-AI-v2.0.md`
- **DCP-AI Security Model** — `docs/SECURITY_MODEL.md`
- **DCP-AI NIST KAT README** — `tests/nist-kat/README.md`
