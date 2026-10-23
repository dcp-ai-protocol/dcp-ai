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
- `canonical(obj)` denotes canonicalization under profile `dcp-jcs-v1` (§15), based on RFC 8785 JCS
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
| `DCP-AI.v2.Delegation` | Root delegation mandate (human signature) and interaction records (DCP-09) |
| `DCP-AI.v2.SubMandate` | Sub-mandate signed by the delegating agent (DCP-09 §3.5) |

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

In every mode, a PQ signature that is present (`pq_over_classical`) MUST verify. `hybrid_preferred` and `classical_only` only tolerate an absent one.

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

The security tier (§14.3) can only make the mode this policy selects stricter.

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
    "pq_checkpoints": ["ckpt-uuid-1"],
    "canonicalization_profile": "dcp-jcs-v1"
  }
}
```

`canonicalization_profile` is OPTIONAL (only `"dcp-jcs-v1"` defined today;
see § 15 and [`CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md)).
A verifier that encounters a bundle without the field MUST assume
`dcp-jcs-v1`. Future profiles will make the field REQUIRED.

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

A blinded RPR (`schemas/v2/blinded_rpr.schema.json`) replaces the PII fields of the full RPR (`legal_name`, `contact`) with a salted commitment, so bundles can be published to transparency logs and anchors without the PII. Non-PII fields (`human_id`, `session_nonce`, `entity_type`, `jurisdiction`, `liability_mode`, `override_rights`, `issued_at`, `expires_at`, `binding_keys`) are copied unchanged and checked against the full RPR on disclosure.

```
pii_salt = hex(random(32))
pii_hash = "sha256:" || hex(SHA-256(UTF8(canonical({ contact, legal_name, pii_salt }))))
```

A missing `contact` is hashed as `null`.

- **Salt.** `pii_salt` is a field of the full RPR: 32 bytes from a CSPRNG as lowercase hex, fresh for each RPR. It is covered by the full RPR's signature and MUST NOT be published; it never appears in the blinded RPR. Reusing a salt gives records with the same PII the same `pii_hash`, which links them. 32 bytes keep a guess-and-confirm search at 2^128 work even with Grover's algorithm.
- **Blinding fails closed.** Implementations MUST refuse to blind an RPR that has no valid `pii_salt`, and verifiers MUST reject a full RPR whose `pii_salt` is present but is not 64 lowercase hex characters. The salt is signed with the full RPR, so it has to be set when the RPR is created: an RPR that may be blinded later SHOULD carry a `pii_salt` from the start.
- **Disclosure.** The salt is disclosed only together with the full RPR, for example to a regulator, who recomputes `pii_hash` from the full RPR and compares the non-PII fields.
- **Erasure.** Deleting the full RPR, and with it the salt, makes the published commitment unopenable: nobody can confirm a guessed name and contact against it. This provides erasure (GDPR Art. 17) for records on immutable logs and anchors, which cannot be rewritten. Every copy of the full RPR, including disclosed ones, has to be deleted.
- **`human_id`.** The blinded RPR publishes `human_id`, so `human_id` MUST be opaque and MUST NOT contain or be derived from PII, such as an email address, a name, or a hash of either.
- **Legacy commitments.** A `pii_hash` computed from a full RPR without `pii_salt` (the formula above without the `pii_salt` member) is deprecated. Implementations MUST NOT blind new records that way. Verifiers MAY still check a legacy commitment against a disclosed full RPR and SHOULD flag it as deprecated: anyone who guesses the PII can confirm it, and on an immutable log that stays true forever.

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

The adaptive security tier system selects cryptographic protection levels from the policy decision's risk score and the intent's data classes, action type and estimated impact. Tiers drive verification mode selection, PQ checkpoint intervals, and bundle presentation modes.

### 14.1 Tier Definitions

| Tier | Name | Verification Mode | PQ Checkpoint Interval | Bundle Size | Crypto Latency |
|---|---|---|---|---|---|
| 0 | `routine` | `classical_only` | Every 50 events | ~1-2 KB | ~2 ms |
| 1 | `standard` | `hybrid_preferred` | Every 10 events | ~2-5 KB | ~2 ms + 5 ms checkpoint |
| 2 | `elevated` | `hybrid_required` | Every event | ~10-15 KB | ~11 ms |
| 3 | `maximum` | `hybrid_required` | Every event + immediate verify | ~15-25 KB | ~15 ms |

### 14.2 Tier Selection Algorithm

The tier is computed only from signed fields the schemas define: the intent's
`action_type`, `data_classes`, `estimated_impact` and optional
`security_tier`, and the `risk_score` (integer 0..1000) of the bundle's
`PolicyDecisionV2`. The intent schema has no `risk_score`; an implementation
MUST NOT read one from the intent.

```
function computeSecurityTier(intent, policy_decision):
  if policy_decision is absent or null:
    score = 0
  else if policy_decision.risk_score is an integer from 0 to 1000:
    score = policy_decision.risk_score
  else:
    score = unknown
  dc = intent.data_classes
  unknown = score is unknown
         OR intent.action_type ∉ ACTION_TYPES
         OR intent.estimated_impact ∉ {low, medium, high}
         OR dc is not an array
         OR some element of dc ∉ DATA_CLASSES

  if score >= 800 OR dc ∩ {credentials, children_data} ≠ ∅:
    tier = "maximum"
  else if score >= 500 OR dc ∩ {pii, financial_data, health_data} ≠ ∅
       OR intent.action_type == "initiate_payment"
       OR intent.estimated_impact == "high" OR unknown:
    tier = "elevated"
  else if score >= 200 OR intent.estimated_impact == "medium":
    tier = "standard"
  else:
    tier = "routine"

  explicit = intent.security_tier
  if explicit is present and not null:
    tier = max(tier, explicit if it is a tier name else "elevated")
  if a verified mandate chain (DCP-09 §3.5) applies and has an effective tier:
    tier = max(tier, that tier if it is a tier name else "elevated")
  return tier
```

The effective tier of a verified delegation chain, the greatest
`minimum_security_tier` along it, is an optional input to this computation
that can only raise the result, never lower it. No bundle field carries the
chain yet, so the floor applies where the verifier is handed a verified chain
alongside the bundle; the bundle verifiers of §18 do not read one.

`ACTION_TYPES` and `DATA_CLASSES` are the `action_type` and `data_classes`
enums of `schemas/v2/intent.schema.json`. A missing, mistyped or unknown
value fails closed to at least `elevated`, so a value the verifier does not
know never lowers the scrutiny a bundle gets, with or without schema
validation. With no policy decision the score is 0. In a policy decision, a
`risk_score` that is missing or is not an integer from 0 to 1000 (a string, a
fraction, a negative number, a number above 1000) is unknown in the same way,
and the score comparisons above treat it as 0. A number with no fractional
part, such as `200.0`, counts as that integer.

The `security_tier` category of `tests/interop/v2/interop_vectors.json` lists
the expected tier, verification mode and checkpoint interval for each case.
All four SDKs run it.

### 14.3 Tier Enforcement (Never Downgrade)

A V2 verifier MUST compute the tier of every bundle and verify the bundle
with the stricter of two modes:

1. the policy mode: the verifier's `default_mode`, or its `risk_overrides`
   entry for the passport's `risk_tier` (§7.2);
2. the tier's mode (§14.1).

Strictness is `classical_only` < `hybrid_preferred` < `hybrid_required`. The
tier can only add a PQ requirement, so a `pq_only` policy stays `pq_only`.
The agent being verified signs the passport and the intent, so its
`risk_tier` and `security_tier` can raise the mode but cannot take it below
the tier's mode. Verifiers report the resolved tier with their result.

The verifier MAY upgrade the computed tier but MUST NOT downgrade it. The `resolved_tier` field in `PolicyDecisionV2` records the tier the policy engine resolved. It is informational: the computation in §14.2 does not read it.

### 14.4 Intent and Policy Decision Fields

`IntentV2` includes an optional `security_tier` field (auto-computed or explicitly set). `PolicyDecisionV2` includes an optional `resolved_tier` field, the tier the policy engine resolved, for information; §14.2 does not read it.

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

DCP-AI v2.0 uses canonicalization profile **`dcp-jcs-v1`**, based on
RFC 8785 (JCS). The profile pins the cases JCS leaves
implementation-defined (undefined handling, floats with integer value,
scientific notation, null preservation, empty containers) so the four
SDKs produce byte-identical output. It is not a strict subset of JCS:
keys are ordered by Unicode code point (item 1), while RFC 8785 orders
them by UTF-16 code units. The two orders differ only for keys that mix
supplementary-plane characters with characters in U+E000..U+FFFF.

Summary:
1. Keys sorted lexicographically by Unicode code point
2. Compact form (no whitespace)
3. Integer-only numbers, decided post-parse (`1.0`, `1e2`, `1.00` accepted; `0.1`, `NaN`, `Infinity` rejected)
4. `null` preserved with its key; arrays preserve `null` positionally
5. `undefined` (TypeScript-only): omit in objects, serialize as `null` in arrays
6. No field exclusion (SignedPayload envelope)
7. Signed bytes: `UTF8(context_tag) || 0x00 || canonical(payload)`

The full normative profile, including the edge-case acceptance table
and the test fixtures all four SDKs must pass, lives in
[`spec/CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md).
Bundles produced under this profile declare it via the optional
`canonicalization_profile: "dcp-jcs-v1"` field on the bundle manifest.

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
4. Manifest integrity (recompute artifact hashes), and the session window from the signed `session_issued_at` and `session_expires_at`
5. Cross-artifact consistency: passport status, RPR expiry, one principal, agent and intent across the artifacts and the audit trail (VERIFICATION.md V2-14)
6. Security tier computation from the signed intent and policy decision (§14.2)
7. Advisory-driven algorithm rejection
8. Composite signature verification (parallel): the bundle signature with the RPR `binding_keys`, the agent's artifacts with the passport `keys`, every kid derived from its key
9. Verifier policy enforcement with the effective mode, the stricter of the policy mode and the tier's mode (§14.3), on the bundle signature and every artifact signature
10. Audit hash chain validation
11. PQ checkpoint validation: exactly the listed checkpoints, each over its audit entries and signed by the agent
12. Key validity checks (expiry, revocation, kid derivation)
13. Verification cache lookup/store (§14.5)

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
| Agent claiming a principal (reusing a published, signed RPR) | Bundle signature only by the RPR `binding_keys`; it commits to the passport hash. An RPR minted under someone else's `human_id` is stopped only by a verifier that pins or attests the principal's keys |
| Inconsistent but validly signed artifacts | Cross-artifact consistency checks (VERIFICATION.md V2-14) |
| Unsigned metadata steering a check | Session start signed in the manifest; the signer block may not contradict the signature |

---

## 20. Conformance Requirements

### 20.1 MUST

- Composite-bound hybrid signatures on all V2 artifacts
- Domain separation on every signature
- Session nonce on every artifact within a bundle
- Integer-only numeric fields
- Deterministic kid derivation
- NIST KAT validation for all PQ providers
- Security tier computation (§14.2) and enforcement with the never-downgrade rule (§14.3) for every V2 bundle

### 20.2 SHOULD

- HSM/TPM for private key storage in production
- Dual-hash chains (SHA-256 + SHA3-256)
- CBOR wire format for high-throughput deployments
- Short-lived certificates (24h TTL) instead of revocation lists
- Advisory polling (daily)

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
