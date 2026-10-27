# DCP-AI NIST Post-Quantum Cryptography Conformity Statement

**Specification version:** 2.0
**Last updated:** 25/10/2026
**Status:** Active — describes the SDKs on `main` on 25/10/2026; published packages can lag (see each SDK's *Release status*)

This document describes how DCP-AI aligns with NIST post-quantum cryptographic standards and provides a conformity assessment for implementers. DCP-AI incorporates NIST FIPS 203, FIPS 204, and FIPS 205 algorithms as core components of its hybrid post-quantum security architecture.

> **Algorithms, not validated modules.** Using algorithms that FIPS 203, 204 and 205 specify is not FIPS 140-3 validation. Validation applies to a cryptographic module, tested and listed by NIST's [Cryptographic Module Validation Program](https://csrc.nist.gov/projects/cryptographic-module-validation-program/validated-modules). This repository has no evidence that the libraries in §8 are validated modules, and makes no FIPS 140 claim. It has no hardware security module (HSM) integration either: see §2.2.

---

## 1. Standards Coverage

| NIST Standard | Algorithm | DCP-AI Usage | Shipped | Notes |
|---------------|-----------|-------------|---------|-------|
| FIPS 203 | ML-KEM-768 | Hybrid KEM for A2A sessions, envelope encryption | Python, Go, Rust, WASM (public provider); TypeScript (internal, not exported) | No SDK exports the X25519 + ML-KEM-768 hybrid exchange; A2A sessions take a session key the caller derives (§8). |
| FIPS 204 | ML-DSA-65 | Post-quantum signatures in composite binding | All 5 SDKs | Primary PQ signature. |
| FIPS 204 | ML-DSA-87 | High-assurance post-quantum signatures | Not implemented | Identifier reserved in the key schema; no SDK has a provider. |
| FIPS 205 | SLH-DSA-192f | Backup hash-based signature scheme | TypeScript, Python, Rust, Go, WASM | Active backup (SLH-DSA-SHA2-192f). |
| FIPS 205 | SLH-DSA-256f | Level 5 hash-based signatures | Not shipped | Reserved. |
| SP 800-208 | LMS / XMSS | Not used | Not applicable | Context only: DCP-AI uses stateless SLH-DSA, not LMS/XMSS (§2.4). |

---

## 2. Algorithm Parameter Mapping

### 2.1 ML-KEM (FIPS 203) — Key Encapsulation

The DCP-AI specification uses ML-KEM-768 in a hybrid construction with X25519 for agent-to-agent (A2A) session establishment and optional envelope encryption. No SDK runs that exchange: the caller performs it and owns the session key (see the end of this section).

| Parameter | FIPS 203 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | ML-KEM-768 | `ml-kem-768` | NIST Security Level 3 |
| Public Key Size | 1184 bytes | 1184 bytes | Conformant |
| Ciphertext Size | 1088 bytes | 1088 bytes | Conformant |
| Shared Secret Size | 32 bytes | 32 bytes | Conformant |
| Hybrid Construction | N/A | X25519 + ML-KEM-768 | Combined shared secret via HKDF-SHA256 |
| DCP-AI Identifier | N/A | `x25519-ml-kem-768` | Hybrid KEM identifier |
| Key Derivation | N/A | HKDF-SHA256 (RFC 5869) | A2A session key: `info = "DCP-AI.v2.A2A.SessionKey"` ([DCP-04](../spec/DCP-04.md) §3.4) |

**Usage in DCP-AI:**

- **A2A Handshake (DCP-04, specified construction):** Both parties exchange ephemeral hybrid KEM public keys. Each party encapsulates to the other's key. Session keys are derived by combining both shared secrets via HKDF-SHA256. The caller carries out these steps; the SDK session functions take the resulting key.
- **Key Recovery (spec §11.2):** the specification encrypts the Shamir SSS shares to recovery contacts with the hybrid KEM. The SDK's `setupKeyRecovery` and `dcp recovery-setup` produce the shares but do not encrypt them; `dcp recovery-setup` writes each share to its own file with mode `0600`.

**Hybrid KEM construction in the specification** (sizes from the algorithm table of [DCP-AI v2.0](../spec/DCP-AI-v2.0.md); session key from DCP-04 §3.4):

```
combined_pk = x25519_pk || ml_kem_768_pk       (1216 bytes)
combined_ct = x25519_ct || ml_kem_768_ct       (1120 bytes)
session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

**The TypeScript source has an internal hybrid KEM with a different encoding.** `HybridKemProvider` (with `X25519KemProvider` and `MlKem768Provider`) is in `sdks/typescript/src` but is not exported from `@dcp-ai/sdk`, so it is not part of the package's API. It is not the binary concatenation above:

- its combined public key, secret key and ciphertext are each the base64 of a JSON object `{ "classical": …, "pq": … }`, whose X25519 component is DER-encoded (SPKI, 44 bytes, in the public key and the ciphertext; PKCS#8 in the secret key), not the raw 32 bytes, and whose ML-KEM-768 components are 1184 bytes (public key) and 1088 bytes (ciphertext);
- its shared secret is `HKDF-SHA256(ikm = x25519_ss || ml_kem_768_ss, salt = "DCP-AI.v2.HybridKEM", info = "x25519-ml-kem-768")`.

No SDK runs the DCP-04 exchange for you: the A2A session key of §3.4 is derived by the caller and passed to the SDK's session functions.

### 2.2 ML-DSA (FIPS 204) — Digital Signatures

DCP-AI uses ML-DSA-65 as the primary post-quantum signature algorithm in composite binding with Ed25519. ML-DSA-87 is reserved, not implemented.

#### ML-DSA-65 (Primary)

| Parameter | FIPS 204 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | ML-DSA-65 | `ml-dsa-65` | NIST Security Level 3 |
| Public Key Size | 1952 bytes | 1952 bytes | Conformant |
| Secret Key Size | 4032 bytes | 4032 bytes | Conformant |
| Signature Size | 3309 bytes | 3309 bytes | Conformant |
| Domain Separation | context string parameter | Context tag prefix | See Section 3 |
| Randomized Signing | Hedged (default) or deterministic | Per provider | Hedged in the TypeScript (`@noble/post-quantum` default) and Rust (`fips204` `try_sign`) providers; deterministic in the Go provider (CIRCL `SignTo` with `randomized = false`); Python follows `pqcrypto`'s default, not checked here. Both variants are valid FIPS 204 signatures and verify the same way |

#### ML-DSA-87 (High-Assurance — Reserved)

ML-DSA-87 is reserved for future high-assurance use. `ml-dsa-87` is an accepted value of `alg` in the key schema, and the sizes below are those of FIPS 204, but no SDK can generate, sign or verify with it, and the reference CLI refuses to generate its keys.

The TypeScript SDK source contains `HsmCryptoProvider` (`sdks/typescript/src/providers/hsm-provider.ts`), which lists `ml-dsa-87`. It is a **simulated pattern**, not an HSM integration: it is not exported or registered, has no PKCS#11 binding, makes random "public keys", produces a hash where a signature should be, and its `verify` accepts any signature of the right length. It must not be used to sign or to verify real evidence.

| Parameter | FIPS 204 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | ML-DSA-87 | `ml-dsa-87` | NIST Security Level 5 |
| Public Key Size | 2592 bytes | 2592 bytes | Conformant |
| Secret Key Size | 4896 bytes | 4896 bytes | Conformant |
| Signature Size | 4627 bytes | 4627 bytes | Conformant |
| Status | — | Reserved | Not implemented in any SDK. |

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
| Hash Functions | SHA2 parameter set (SHA-256 and SHA-512) | SHA2 parameter set | Conformant |

#### SLH-DSA-256f (Reserved)

| Parameter | FIPS 205 Value | DCP-AI Value | Notes |
|-----------|---------------|-------------|-------|
| Parameter Set | SLH-DSA-SHA2-256f | `slh-dsa-256f` | NIST Security Level 5 |
| Public Key Size | 64 bytes | 64 bytes | Reserved for future use |
| Signature Size | 49,856 bytes | 49,856 bytes | Reserved for future use |

**Usage in DCP-AI:**

- **Algorithm Fallback:** If ML-DSA is subject to a governance deprecation advisory, verifiers can transition to SLH-DSA-192f as the PQ component in composite signatures.
- **High-Assurance Audits:** Organizations with conservative security postures may require SLH-DSA alongside ML-DSA.

### 2.4 SP 800-208 (context only)

NIST SP 800-208 covers the stateful hash-based signature schemes LMS and XMSS. Its main requirements are operational: never reuse a one-time signing key, and keep the signing state (the index of the next unused key) persistent and consistent. DCP-AI does not implement LMS or XMSS, so SP 800-208 does not apply to it, and this document makes no conformance claim against it. DCP-AI uses the stateless SLH-DSA (FIPS 205) instead, which has no signing state to keep. That choice avoids the state-synchronization risk of distributed agent deployments; it is not SP 800-208 conformance, and neither is the deterministic `kid`, which only names a public key.

---

## 3. Domain Separation and Context Binding

FIPS 204 (ML-DSA) supports an optional context string for domain separation. DCP-AI does not use it: it puts the domain separation in the message itself, as follows:

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

The classical (Ed25519) signature signs these bytes as they are. In the `pq_over_classical` binding, the PQ signature signs them followed by the classical signature bytes (§2.2), so the two signatures do not cover the same message. The DCP context tag is a prefix inside the message, not the FIPS 204 context string: the SDK providers call ML-DSA with an empty `ctx`. The 0x00 separator byte prevents ambiguity between context tags and payload data.

| DCP Context Tag | Maps To |
|-----------------|---------|
| `DCP-AI.v2.AgentPassport` | Agent identity signing |
| `DCP-AI.v2.ResponsiblePrincipal` | Responsible Principal Record signing |
| `DCP-AI.v2.Intent` | Intent declaration signing |
| `DCP-AI.v2.PolicyDecision` | Policy decision signing |
| `DCP-AI.v2.AuditEvent` | PQ checkpoint and audit compaction signing (V2 audit entries are not signed one by one) |
| `DCP-AI.v2.Bundle` | Bundle-level signing |
| `DCP-AI.v2.Revocation` | Revocation record signing |
| `DCP-AI.v2.KeyRotation` | Key rotation proof |
| `DCP-AI.v2.Governance` | Governance operations |

This is a selection. `DCP_CONTEXTS` in the TypeScript SDK lists 19 context tags, including those of DCP-05 to DCP-09;
`DCP-AI.v2.Governance` is not one of them: the TypeScript governance module defines it as its own constant.

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
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

See [`tests/nist-kat/README.md`](../tests/nist-kat/README.md) for what each file checks.

The tables in §4.3 to §4.5 and the checklists in §5 state the coverage an implementation should reach; they are not a
certification. No single file covers the whole matrix: `tests/nist-kat/` holds the vectors listed above, the other rows
depend on each SDK's own tests, which may not cover all of them, and the directory has no vector for the hybrid
construction.

### 4.2 Ed25519 (RFC 8032)

Ed25519 is deterministic. Test vectors are taken directly from RFC 8032 Section 7.1. All DCP-AI SDKs MUST produce identical signatures for a given (secret_key, message) pair.

### 4.3 ML-DSA-65 (FIPS 204)

ML-DSA-65 supports randomized and deterministic signing; the current SDK providers use different modes, as described in Section 2.2. Direct KAT comparison requires control of the signing randomness, which varies across cryptographic libraries. DCP-AI exercises the following properties; these checks do not amount to a full NIST algorithm or module validation:

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
| Implicit rejection | Decapsulating with a different key returns a different shared secret, not an error (FIPS 203 implicit rejection); a modified ciphertext likewise | MUST pass |
| Input checks | Malformed inputs are rejected with an error: wrong lengths, an encapsulation key with coefficients ≥ q, a decapsulation key with a wrong `H(ek)` | MUST pass |
| Hybrid construction | Combined HKDF output matches reference | MUST pass |

### 4.6 Running KAT Tests

```bash
# From the repository root; each line runs in a subshell, so the working directory does not change.
# They use the tools and dependencies already installed for each SDK; nothing here installs them.

# TypeScript SDK (vitest, from the SDK's own node_modules)
(cd sdks/typescript && ./node_modules/.bin/vitest run src/__tests__/nist-kat.test.ts)

# Python SDK (pytest)
(cd sdks/python && python3 -m pytest tests/test_nist_kat.py -v)

# Go SDK (conformance + interop + PQ providers in one run)
(cd sdks/go && go test ./...)

# Rust SDK (dedicated integration test)
(cd sdks/rust && cargo test --test nist_kat)
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
- [ ] KAT tests pass for size, round-trip, implicit rejection (a different key or a modified ciphertext gives a different shared secret) and input checks

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

For a future implementation: no DCP-AI SDK implements ML-DSA-87 today (§2.2).

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
- [ ] Private keys are kept in storage that fits the deployment's risk (this repository provides no HSM/TPM integration)
- [ ] Algorithm advisory system is implemented for crypto-agility
- [ ] Integer-only numeric fields (no floating-point) in all signed payloads
- [ ] `dcp-jcs-v1` canonicalization (based on RFC 8785 JCS), the default and only normative profile, for all JSON signing; the experimental `dcp-jcs-v2` candidate only with an explicit opt-in

---

## 6. Migration Path: Classical to Post-Quantum

DCP-AI defines a three-phase migration path from classical-only to post-quantum security.

The phases are the recommended plan written in April 2026, not a description of what verifiers do today. Today,
`verifySignedBundleV2` accepts only V2 bundles; whether a V1 bundle is accepted is decided by a version router or a
middleware according to its policy (`allow_v1_bundles`), which can reject it but emits no deprecation warning by
itself ([MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#32-coexistence-strategy)). Under `hybrid_preferred`, a missing PQ signature is tolerated only where the effective mode (the
stricter of the policy mode and the risk tier's mode) allows it, and a PQ signature that is present but invalid is
always rejected.

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

### Phase 3: PQ-Only (future as a default)

The `pq_only` verification mode is implemented in the verifiers today; what is future is making it the default.

| Aspect | State |
|--------|-------|
| Default Verification Mode | `pq_only` |
| Classical Signatures | Still part of the composite signature; under `pq_only` their verification need not be an acceptance requirement |
| PQ Signatures | Required |
| V1 Bundles | Rejected |
| Composite Binding | Still `pq_over_classical`: the PQ signature is verified over the domain-separated message and the classical signature bytes, so a signature without a classical part is not a supported format |

Actions for implementers:
1. Classical verification may stop being an acceptance requirement; the classical signature stays in the composite format.
2. V1 bundles are rejected by default.
3. Governance advisory system may deprecate classical algorithms.
4. SLH-DSA-192f provides backup if ML-DSA is weakened.

### Migration Timeline (Recommended)

This timeline was written in April 2026 and is kept as written. On 25/10/2026 the default verifier policy of every SDK used `hybrid_preferred` (with `classical_only` for low-risk passports), and the reference server started in `hybrid_required`; no governance advisory had triggered phase 3.

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
| Use FIPS 203/204/205 approved algorithms | ML-KEM-768, ML-DSA-65, SLH-DSA-192f (ML-DSA-87 reserved, not implemented) |
| Maintain crypto-agility | Algorithm registry + advisory system + provider abstraction |
| Plan for algorithm deprecation | Governance-signed advisories with auto-response |
| Protect long-lived data | Hash-chained audit trails; dual-hash chains are produced, and the V2 verifiers in the unreleased source code check the secondary fields that are present (not yet the published packages) ([STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)) |
| Use hybrid constructions during transition | `pq_over_classical` composite binding |
| Hardware security modules for key storage | Not implemented: no HSM/TPM integration; the `HsmCryptoProvider` in the source is a simulation (§2.2) |
| Test interoperability | Cross-SDK KAT validation, conformance test suite |

---

## 8. Cryptographic Library Requirements

Implementations MUST use cryptographic libraries that provide NIST-compliant algorithm implementations.

### Libraries used by each shipped SDK

| SDK | Library | Algorithms |
|-----|---------|-----------|
| TypeScript (`@dcp-ai/sdk`) | `@noble/post-quantum` | ML-DSA-65, SLH-DSA-192f; ML-KEM-768 (internal, not exported) |
| TypeScript (`@dcp-ai/sdk`) | `tweetnacl` | Ed25519 |
| TypeScript (`@dcp-ai/sdk`) | Node.js `crypto` | SHA-256, SHA3-256, HMAC-SHA256 (HKDF); X25519 (internal, not exported) |
| Python (`dcp-ai`) | `pqcrypto` ≥ 1.0 (Backbone Rust crates, not independently audited) | ML-DSA-65, ML-KEM-768, SLH-DSA-192f |
| Python (`dcp-ai`) | `pynacl` (libsodium) | Ed25519 |
| Go (`sdks/go/v2`) | `github.com/cloudflare/circl` | ML-DSA-65, ML-KEM-768, SLH-DSA-192f |
| Go (`sdks/go/v2`) | `crypto/ed25519` (stdlib) | Ed25519 |
| Rust (`dcp-ai` crate) | `fips203`, `fips204`, `fips205` (integritychain) | ML-KEM-768, ML-DSA-65, SLH-DSA-192f |
| Rust (`dcp-ai` crate) | `ed25519-dalek` | Ed25519 |
| WASM (`@dcp-ai/wasm`) | Compiled from the Rust crate above | Same set as Rust |

The Python, Go and Rust SDKs expose ML-KEM-768 as a KEM primitive (`MlKem768Provider`), and `@dcp-ai/wasm` exposes it as `wasm_ml_kem_768_*` functions. The TypeScript SDK has ML-KEM-768, X25519 and hybrid providers in its source but does not export them. No SDK runs the X25519 + ML-KEM-768 hybrid exchange of DCP-04: both parties derive the session key themselves and pass it to the session functions (`create_session` in Python, `CreateSession` in Go). The Rust A2A module covers discovery, handshake messages and session IDs only.

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
