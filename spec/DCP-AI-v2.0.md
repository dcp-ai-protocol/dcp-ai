# DCP-AI v2.0 Normative Specification

**Status:** Final  
**Version:** 2.0.0  
**Date:** 2026-02-26  
**Authors:** DCP-AI Protocol Governance  

---

## 1. Introduction

The Digital Citizenship Protocol for AI (DCP-AI) v2.0 defines a post-quantum-resistant framework for agent identity, intent declaration, policy gating, and audit trails. It supersedes v1.0 by introducing composite-bound hybrid signatures, domain separation, session binding, and verifier-authoritative policy enforcement.

### 1.1 Design Goals

1. **Post-quantum security**: All identity and audit artifacts are protected against quantum adversaries via hybrid composite signatures.
2. **Non-repudiation**: Agents and humans cannot deny actions recorded in signed audit chains.
3. **Tamper evidence**: Hash chains, Merkle roots, and blockchain anchoring provide multi-layered tamper detection.
4. **Crypto-agility**: Algorithm registry and provider abstraction enable algorithm migration without protocol changes.
5. **Privacy**: Blinded RPR mode protects PII while maintaining verifiability.
6. **Interoperability**: Cross-SDK verification, CBOR wire format, and gRPC support.

### 1.2 Notation

- `||` denotes byte concatenation
- `UTF8(s)` denotes UTF-8 encoding of string `s`
- `canonical(obj)` denotes RFC 8785 JCS canonicalization
- `SHA-256(m)` denotes the SHA-256 hash of message `m`
- `hex(b)[0:n]` denotes the first `n` hex characters of byte sequence `b`

---

## 2. Algorithm Registry

### 2.1 Signature Algorithms

| Identifier | Standard | PubKey Size | Sig Size | Security Level | Status |
|---|---|---|---|---|---|
| `ed25519` | RFC 8032 | 32 B | 64 B | 128-bit classical | ACTIVE |
| `ml-dsa-65` | FIPS 204 | 1952 B | 3309 B | NIST Level 3 PQ | ACTIVE (primary PQ) |
| `ml-dsa-87` | FIPS 204 | 2592 B | 4627 B | NIST Level 5 PQ | ACTIVE (high-assurance) |
| `slh-dsa-192f` | FIPS 205 | 48 B | 35664 B | NIST Level 3 PQ | ACTIVE (backup PQ) |
| `slh-dsa-256f` | FIPS 205 | 64 B | 49856 B | NIST Level 5 PQ | RESERVED |

### 2.2 KEM Algorithms

| Identifier | Standard | PubKey Size | Ciphertext Size | Security Level |
|---|---|---|---|---|
| `x25519` | RFC 7748 | 32 B | 32 B | 128-bit classical |
| `ml-kem-768` | FIPS 203 | 1184 B | 1088 B | NIST Level 3 PQ |
| `x25519-ml-kem-768` | Hybrid | 1216 B | 1120 B | Hybrid Level 3 |

### 2.3 Hash Algorithms

| Identifier | Output | Usage |
|---|---|---|
| `sha256` | 32 B | DEFAULT for Level 3 deployments |
| `sha3-256` | 32 B | Secondary hash for dual-hash mode |
| `sha384` | 48 B | RECOMMENDED for Level 5 deployments |

### 2.4 Numeric Types

All numeric fields in DCP-AI v2.0 MUST be integers. Floating-point values are prohibited to eliminate canonicalization ambiguity.

---

## 3. Key Objects

### 3.1 Key Entry

```json
{
  "kid": "<32 hex chars>",
  "alg": "<algorithm identifier>",
  "public_key_b64": "<base64-encoded public key>",
  "created_at": "<ISO 8601>",
  "expires_at": "<ISO 8601 | null>",
  "status": "active | revoked | expired"
}
```

### 3.2 Deterministic kid Derivation

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
```

Properties: unique, deterministic, collision-resistant (128-bit from SHA-256 truncation).

---

## 4. Domain Separation

Every signature MUST include a domain separation tag:

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

### 4.1 Context Tags

| Context Tag | Usage |
|---|---|
| `DCP-AI.v2.AgentPassport` | Agent passport self-signature |
| `DCP-AI.v2.ResponsiblePrincipal` | Human binding record signature |
| `DCP-AI.v2.Intent` | Intent declaration signature |
| `DCP-AI.v2.PolicyDecision` | Policy engine signature |
| `DCP-AI.v2.AuditEvent` | Per-event audit signature |
| `DCP-AI.v2.Bundle` | Bundle-level signature |
| `DCP-AI.v2.Revocation` | Revocation record signature |
| `DCP-AI.v2.KeyRotation` | Key rotation proof |
| `DCP-AI.v2.ProofOfPossession` | PoP challenge-response |
| `DCP-AI.v2.JurisdictionAttestation` | Jurisdiction attestation |
| `DCP-AI.v2.HumanConfirmation` | Human confirmation |
| `DCP-AI.v2.AlgorithmAdvisory` | Algorithm deprecation advisory |
| `DCP-AI.v2.Governance` | Governance operations |

---

## 5. Composite Signatures

### 5.1 Binding Protocol

```
Step 1: classical_sig = Classical.sign(context || 0x00 || payload)
Step 2: pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)
```

The PQ signature covers the classical signature. Stripping either component causes both to fail verification.

### 5.2 Wire Format

```json
{
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

### 5.3 Binding Modes

- `pq_over_classical`: MANDATORY for v2.0. PQ signature covers classical signature.
- `classical_only`: Permitted during transition. PQ field is `null`.

---

## 6. SignedPayload Envelope

Artifacts never contain signature data. Signatures are in a sibling field:

```json
{
  "payload": { /* pure artifact */ },
  "payload_hash": "sha256:...",
  "composite_sig": { /* ... */ }
}
```

Signed bytes: `context_tag || 0x00 || canonical(payload)`

---

## 7. Verification Modes

### 7.1 Modes

| Mode | Classical Required | PQ Required | V1 Bundles |
|---|---|---|---|
| `classical_only` | Yes | No | Yes |
| `pq_only` | No | Yes | No |
| `hybrid_required` | Yes | Yes | Configurable |
| `hybrid_preferred` | Yes | No (warn) | Configurable |

### 7.2 Verifier-Authoritative Policy

Signature policy is set by the verifier's configuration, NOT by the agent. The verifier loads policy from its own config:

```json
{
  "verifier_policy": {
    "default_mode": "hybrid_required",
    "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_preferred" },
    "min_classical": 1,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "require_session_binding": true,
    "require_composite_binding": true,
    "allow_classical_fallback_disable": false,
    "warn_classical_only_deprecated": false,
    "advisory_rejected_algs": []
  }
}
```

### 7.3 PQ-Only Mode (Phase 3)

When `default_mode` is `pq_only`:
- Classical signatures are accepted but not required
- `min_classical` is 0, `min_pq` is 1
- Composite binding is not required
- V1 bundles are rejected
- Classical-only bundles emit deprecation warnings

---

## 8. Session Binding

A 256-bit random `session_nonce` (64 hex chars) ties all artifacts in a session:

```
session_nonce = hex(random(32))
```

Every V2 artifact includes `session_nonce`. The verifier MUST check that all artifacts in a bundle share the same nonce.

---

## 9. Bundle Manifest

The bundle manifest cryptographically binds all artifact hashes:

```json
{
  "manifest": {
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 5,
    "pq_checkpoints": ["ckpt-uuid-1"]
  }
}
```

The bundle-level composite signature signs `canonical(manifest)`.

---

## 10. Audit Trail

### 10.1 Per-Event Signing

Each audit event is signed with Ed25519 (microsecond latency). Events form a hash chain via `prev_hash`.

### 10.2 PQ Checkpoints (Lazy Model)

Every N events (configurable, default 10), a PQ checkpoint is produced: a composite signature over the Merkle root of the last N events.

### 10.3 Dual-Hash Chains

SHA-256 and SHA3-256 chains run in parallel from v2.0 launch. If one hash family is broken, the other provides continuity.

### 10.4 Audit Compaction

After N events (default 1000), a compaction checkpoint is produced. Compacted events MAY be archived while the checkpoint remains in the active chain.

---

## 11. Key Management

### 11.1 Key Rotation

1. Generate new keypair
2. New key signs PoP challenge (old_kid + new_kid + timestamp) under `DCP-AI.v2.KeyRotation` context
3. Old key counter-signs to authorize rotation
4. Grace window: 30 days where both keys are accepted

### 11.2 Key Recovery (M-of-N Social Recovery)

Master secret is split via Shamir's Secret Sharing. Shares encrypted with hybrid KEM to recovery contacts.

### 11.3 Emergency Revocation

Pre-registered `revocation_token = SHA-256(revocation_secret)`. Revealing the pre-image revokes all agent keys without cryptographic signature.

### 11.4 HSM/TPM Support

Private keys SHOULD be stored in hardware security modules. The `CryptoProvider` interface supports `HsmCryptoProvider` that delegates all operations to the HSM via PKCS#11.

---

## 12. Privacy

### 12.1 Blinded RPR

PII fields (`legal_name`, `contact`) are replaced by `pii_hash = SHA-256(canonical(PII fields))`. Non-PII fields (keys, jurisdiction, liability) are preserved for verification.

---

## 13. Governance

### 13.1 Governance Key Set

M-of-N multi-party keys used to sign algorithm advisories and protocol decisions. Published at `/.well-known/governance-keys.json`.

### 13.2 Algorithm Advisory System

Signed advisories with actions: `warn`, `deprecate`, `revoke`. Automated verifier response removes affected algorithms and adds replacements.

### 13.3 Advisory Auto-Response

Verifiers automatically:
- Remove deprecated/revoked algorithms from accepted lists
- Add replacement algorithms
- Switch to pq_only if all classical algorithms are removed
- Maintain audit trail of policy changes

---

## 14. Adaptive Security Tiers

The adaptive security tier system automatically selects cryptographic protection levels based on intent risk score, data classification, and action type. Tiers drive verification mode selection, PQ checkpoint intervals, and bundle presentation modes.

### 14.1 Tier Definitions

| Tier | Name | Verification Mode | PQ Checkpoint Interval | Bundle Size | Crypto Latency |
|---|---|---|---|---|---|
| 0 | `routine` | `classical_only` | Every 50 events | ~1-2 KB | ~2 ms |
| 1 | `standard` | `hybrid_preferred` | Every 10 events | ~2-5 KB | ~2 ms + 5 ms checkpoint |
| 2 | `elevated` | `hybrid_required` | Every event | ~10-15 KB | ~11 ms |
| 3 | `maximum` | `hybrid_required` | Every event + immediate verify | ~15-25 KB | ~15 ms |

### 14.2 Tier Selection Algorithm

```
function computeSecurityTier(intent):
  score = intent.risk_score ?? 0
  has_high_value = intent.data_classes ∩ {credentials, children_data} ≠ ∅
  has_sensitive = intent.data_classes ∩ {pii, financial_data, health_data, credentials, children_data} ≠ ∅
  is_payment = intent.action_type == "initiate_payment"

  if score >= 800 OR has_high_value:    return "maximum"
  if score >= 500 OR has_sensitive OR is_payment: return "elevated"
  if score >= 200:                      return "standard"
  return "routine"
```

### 14.3 Tier Upgrade (Never Downgrade)

The verifier MAY upgrade the computed tier but MUST NOT downgrade it. The `resolved_tier` field in `PolicyDecisionV2` records the final tier after policy evaluation.

### 14.4 Intent and Policy Decision Fields

`IntentV2` includes an optional `security_tier` field (auto-computed or explicitly set). `PolicyDecisionV2` includes an optional `resolved_tier` field reflecting the final tier after verifier policy application.

### 14.5 Verification Cache

Verified bundle results MAY be cached with TTL governed by the resolved tier:

| Tier | Cache TTL |
|---|---|
| `routine` | 5 minutes |
| `standard` | 2 minutes |
| `elevated` | 30 seconds |
| `maximum` | 10 seconds |

Cache entries MUST be invalidated when any signer kid is revoked.

### 14.6 Bundle Presentation Modes

Tiers influence suggested presentation mode for bandwidth optimization:

- **Tier 0-1 (established session)**: `compact` or `reference` — PQ signature omitted, checkpoint ref included
- **Tier 2-3**: `full` — complete bundle with all signatures
- **First contact (any tier)**: `full`

---

## 15. Canonicalization

RFC 8785 (JCS) with restrictions:
1. Keys sorted lexicographically by Unicode code point
2. Compact form (no whitespace)
3. Integers only (no floats)
4. No field exclusion (SignedPayload envelope)
5. Signed bytes: `UTF8(context_tag) || 0x00 || canonical(payload)`

---

## 16. Wire Formats

### 16.1 JSON (Default)

`Content-Type: application/json`

### 16.2 CBOR (Optional)

`Content-Type: application/cbor` — RFC 8949 deterministic encoding. 30-40% smaller than JSON.

---

## 17. Backward Compatibility

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

V2 verifiers MUST support V1 indefinitely. Migration is gradual.

---

## 18. Verification Pipeline

1. Wire format decode (JSON or CBOR)
2. Schema validation (route V1/V2)
3. Session nonce consistency
4. Manifest integrity (recompute artifact hashes)
5. Security tier resolution (§14)
6. Advisory-driven algorithm rejection
7. Composite signature verification (parallel)
8. Tier-aware verifier policy enforcement
9. Audit hash chain validation
10. PQ checkpoint chain validation
11. Key validity checks (expiry, revocation, kid derivation)
12. Verification cache lookup/store (§14.5)

---

## 19. Threat Model

| Threat | Mitigation |
|---|---|
| Quantum adversary (Shor's) | ML-DSA-65 in composite signature |
| Harvest-now-decrypt-later | Composite hybrid sigs (PQ valid even if classical breaks) |
| Stripping attack | Composite binding (PQ signs over classical sig) |
| Cross-artifact replay | Domain separation context tags |
| Session splicing | session_nonce + bundle manifest |
| Policy downgrade | Verifier-authoritative policy + tier never-downgrade rule |
| Key confusion/squatting | Deterministic kid + proof-of-possession |
| Algorithm break (PQ) | Crypto-agility + SLH-DSA-192f backup + advisory system |
| Canonicalization exploit | Integer-only schemas, float prohibition |
| Key theft | HSM/TPM, short-lived certs, key rotation with PoP |
| DB tampering | Hash chains + Merkle roots + blockchain anchoring |
| PII exposure | Blinded RPR mode |
| Key loss | M-of-N social recovery (Shamir SSS) |
| Tier evasion | Verifier-authoritative tier upgrade, agent cannot downgrade |

---

## 20. Conformance Requirements

### 20.1 MUST

- Composite-bound hybrid signatures on all V2 artifacts
- Domain separation on every signature
- Session nonce on every artifact within a bundle
- Integer-only numeric fields
- Deterministic kid derivation
- NIST KAT validation for all PQ providers
- Security tier never-downgrade rule (§14.3)

### 20.2 SHOULD

- HSM/TPM for private key storage in production
- Dual-hash chains (SHA-256 + SHA3-256)
- CBOR wire format for high-throughput deployments
- Short-lived certificates (24h TTL) instead of revocation lists
- Advisory polling (daily)
- Adaptive security tier computation for all intents (§14.2)

### 20.3 MAY

- CBOR + gzip compression
- Parallel signature verification
- PQ-first fast-fail verification strategy
- Audit trail compaction
- Verification result caching with tier-based TTL (§14.5)

---

## 21. References

- FIPS 203: ML-KEM (Module-Lattice-Based Key-Encapsulation Mechanism)
- FIPS 204: ML-DSA (Module-Lattice-Based Digital Signature Algorithm)
- FIPS 205: SLH-DSA (Stateless Hash-Based Digital Signature Algorithm)
- RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA)
- RFC 8785: JSON Canonicalization Scheme (JCS)
- RFC 8949: Concise Binary Object Representation (CBOR)

---

*End of DCP-AI v2.0 Normative Specification*
