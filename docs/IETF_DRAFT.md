# DCP: A Post-Quantum Digital Citizenship Protocol for AI Agents

## Internet-Draft

- **Title**: Digital Citizenship Protocol (DCP) for AI Agents
- **Status**: Informational
- **Version**: draft-dcp-ai-citizenship-00
- **Date**: February 2026
- **Authors**: DCP-AI Contributors

## Abstract

This document specifies the Digital Citizenship Protocol (DCP), a framework for establishing verifiable digital identity, intent declaration, policy governance, and cryptographic audit trails for AI agents operating on open networks. DCP provides post-quantum security through hybrid composite signatures combining classical (Ed25519) and post-quantum (ML-DSA-65) algorithms, ensuring long-term resilience against quantum computing threats.

## Status of This Memo

This Internet-Draft is submitted to the IETF for informational purposes. Distribution of this document is unlimited.

## Table of Contents

1. Introduction
2. Terminology
3. Protocol Overview
4. Identity Layer (DCP-01)
5. Intent and Policy Layer (DCP-02)
6. Audit Layer (DCP-03)
7. Agent-to-Agent Communication (DCP-04)
8. Cryptographic Algorithms
9. Wire Formats
10. Security Considerations
11. IANA Considerations
12. References

## 1. Introduction

The proliferation of AI agents operating autonomously on the internet creates a fundamental trust problem: how can humans and systems verify the identity, intent, and behavior of an AI agent? Existing authentication mechanisms (API keys, OAuth tokens) establish access control but not identity or accountability.

DCP addresses this by requiring every AI agent to carry a Citizenship Bundle — a portable, verifiable package containing:

- A Responsible Principal Record (RPR) linking the agent to a responsible human or legal entity
- An Agent Passport with the agent's identity and capabilities
- Declared Intents for each action
- Policy Decisions governing those actions
- A cryptographically-chained Audit Trail of all actions taken

All artifacts are signed with hybrid composite signatures (Ed25519 + ML-DSA-65) providing security against both classical and quantum adversaries.

### 1.1 Design Goals

- Post-quantum security from day one
- Verification without central authority (P2P)
- Minimal trust assumptions
- Crypto-agility for algorithm evolution
- Privacy preservation through blinded identity modes
- Interoperability across programming languages and frameworks

### 1.2 Scope

This document covers the core DCP protocol (versions 1.0 and 2.0). It does not specify:
- Specific policy engines or decision algorithms
- Network transport requirements beyond wire format
- Key management infrastructure deployment

## 2. Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174].

- **Agent**: An autonomous software entity operating on behalf of a human or organization
- **RPR**: Responsible Principal Record — links an agent to a responsible entity
- **Agent Passport**: Identity document for an AI agent
- **Intent**: A declared purpose for an action an agent wishes to perform
- **Policy Decision**: An authorization decision for an Intent
- **Audit Entry**: A cryptographically-chained record of an action
- **Citizenship Bundle**: A complete package of DCP artifacts
- **Signed Bundle**: A Citizenship Bundle with cryptographic signatures
- **Composite Signature**: A hybrid signature combining classical and post-quantum components
- **Security Tier**: An adaptive security level determining cryptographic requirements

## 3. Protocol Overview

```
    +------------------+
    | Human / Entity   |
    +--------+---------+
             |
             v
    +------------------+
    | Responsible      |
    | Principal (RPR)  |
    +--------+---------+
             |
             v
    +------------------+
    | Agent Passport   |
    +--------+---------+
             |
     For each action:
             |
             v
    +------------------+     +------------------+
    | Intent           |---->| Policy Decision  |
    +--------+---------+     +------------------+
             |
             v
    +------------------+
    | Audit Entry      |
    | (hash-chained)   |
    +------------------+
             |
             v
    +------------------+
    | Citizenship      |
    | Bundle           |
    +--------+---------+
             |
             v
    +------------------+
    | Composite Sign   |
    | (Ed25519+ML-DSA) |
    +------------------+
```

### 3.1 Lifecycle

The DCP lifecycle for a single agent action proceeds as follows:

1. A human or legal entity creates an RPR and registers an Agent Passport.
2. Before performing any action, the agent constructs an Intent declaration.
3. The intent is submitted to a policy engine, which returns a Policy Decision.
4. The agent executes the action and records an Audit Entry hash-chained to the previous entry.
5. All artifacts are assembled into a Citizenship Bundle.
6. The bundle is signed with a composite signature (Ed25519 + ML-DSA-65).
7. The Signed Bundle is presented to any verifier, who validates it locally.

### 3.2 Version Negotiation

Agents and verifiers negotiate protocol version via the `dcp_version` field present in every artifact. A v2.0 verifier MUST support v1.0 bundles when configured with `allow_v1_bundles: true`. A v1.0 verifier MUST reject bundles with `dcp_version: "2.0"` as unsupported.

Capabilities and version support are published at `/.well-known/dcp-capabilities.json`.

## 4. Identity Layer (DCP-01)

### 4.1 Responsible Principal Record

Every agent MUST be bound to a human or legal entity through a Responsible Principal Record (RPR). The RPR establishes accountability for agent actions.

Fields:
- `human_id` (REQUIRED): Unique identifier for the bound entity. Format: `human:<uuid>`.
- `entity_type` (REQUIRED): "natural_person" or "legal_entity".
- `entity_name` (REQUIRED): Name of the bound entity.
- `jurisdiction` (REQUIRED): ISO 3166-1 alpha-2 country code of the legal jurisdiction.
- `binding_method` (REQUIRED): Method of identity verification. Values include "government_id", "corporate_registration", "notarized_declaration".
- `keys` (REQUIRED): Array of cryptographic key entries (see Section 8.3).
- `revocation_token` (REQUIRED): SHA-256 hash of a pre-shared revocation secret. Revealing the pre-image revokes all keys bound to this RPR.
- `dcp_version` (REQUIRED): Protocol version string ("1.0" or "2.0").
- `session_nonce` (REQUIRED in v2.0): 256-bit random nonce binding the RPR to a specific session.

Example (v2.0):

```json
{
  "dcp_version": "2.0",
  "human_id": "human:550e8400-e29b-41d4-a716-446655440000",
  "entity_type": "natural_person",
  "entity_name": "Alice Johnson",
  "jurisdiction": "US",
  "binding_method": "government_id",
  "keys": [
    {
      "kid": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "alg": "ed25519",
      "public_key_b64": "MCowBQYDK2VwAyEA...",
      "created_at": "2026-02-01T00:00:00Z",
      "expires_at": "2027-02-01T00:00:00Z",
      "status": "active"
    },
    {
      "kid": "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3",
      "alg": "ml-dsa-65",
      "public_key_b64": "MIIV...",
      "created_at": "2026-02-01T00:00:00Z",
      "expires_at": "2027-02-01T00:00:00Z",
      "status": "active"
    }
  ],
  "revocation_token": "sha256:e3b0c44298fc1c149afbf4c8996fb924...",
  "session_nonce": "a3f7c8d2e1b0f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8"
}
```

### 4.2 Blinded RPR (Privacy Mode)

When privacy is required, PII fields (`entity_name`, contact information) are replaced by a commitment hash:

```
pii_hash = SHA-256(canonical(PII fields))
```

Non-PII fields (keys, jurisdiction, liability tier) are preserved for verification. The full RPR MAY be disclosed to authorized parties on demand for regulatory compliance.

### 4.3 Agent Passport

Each agent carries a passport signed by its bound human.

Fields:
- `agent_id` (REQUIRED): Unique agent identifier. Format: `agent:<name-or-uuid>`.
- `agent_name` (REQUIRED): Human-readable name.
- `capabilities` (REQUIRED): Array of declared capabilities (e.g., "web_search", "data_analysis", "negotiate").
- `owner_rpr_hash` (REQUIRED): SHA-256 hash of the canonical JSON of the owner's RPR.
- `keys` (REQUIRED): Array of cryptographic key entries.
- `status` (REQUIRED): "active", "suspended", or "revoked".
- `dcp_version` (REQUIRED): Protocol version string.
- `session_nonce` (REQUIRED in v2.0): Session binding nonce.

### 4.4 Jurisdiction Attestation

An optional but RECOMMENDED attestation by a government or accredited authority certifying the identity in the RPR:

```json
{
  "dcp_version": "2.0",
  "issuer": "gov-authority-us",
  "jurisdiction": "US",
  "rpr_hash": "sha256:...",
  "attestation_type": "identity_verification",
  "issued_at": "2026-02-01T00:00:00Z",
  "expires_at": "2027-02-01T00:00:00Z",
  "session_nonce": "...",
  "composite_sig": { "..." }
}
```

### 4.5 Key Identifier Derivation

Key identifiers (kid) are derived deterministically:

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
```

This produces a 128-bit collision-resistant identifier that is unique, deterministic, and reproducible across implementations.

## 5. Intent and Policy Layer (DCP-02)

### 5.1 Intent Declaration

Before performing any action, an agent MUST declare its intent. The intent is a structured description of the planned action, its target, and its risk profile.

Fields:
- `intent_id` (REQUIRED): Unique intent identifier. Format: `intent:<uuid>`.
- `agent_id` (REQUIRED): The declaring agent's identifier.
- `action_type` (REQUIRED): Type of intended action (e.g., "api_call", "web_scrape", "data_retrieval", "initiate_payment", "negotiate").
- `target` (REQUIRED): Target of the action (URL, API endpoint, agent ID, etc.).
- `data_classes` (REQUIRED): Array of data classifications involved (e.g., "public", "pii", "financial_data", "health_data", "credentials", "children_data").
- `risk_score` (REQUIRED): Integer risk assessment from 0 to 1000. Higher values indicate greater risk.
- `security_tier` (OPTIONAL in v2.0): Computed or explicitly declared security tier ("routine", "standard", "elevated", "maximum").
- `dcp_version` (REQUIRED): Protocol version string.
- `session_nonce` (REQUIRED in v2.0): Session binding nonce.

### 5.2 Policy Decision

Each intent receives a policy decision from a policy engine. The policy engine is external to DCP; the protocol specifies only the decision format.

Fields:
- `decision` (REQUIRED): "approve", "escalate", or "block".
- `intent_hash` (REQUIRED): SHA-256 hash of the canonical JSON of the intent.
- `conditions` (OPTIONAL): Array of conditions for approval (e.g., "rate_limit: 100/hour", "require_human_confirmation").
- `resolved_tier` (OPTIONAL in v2.0): Final security tier after verifier policy application.
- `dcp_version` (REQUIRED): Protocol version string.
- `session_nonce` (REQUIRED in v2.0): Session binding nonce.

### 5.3 Adaptive Security Tiers

The v2.0 security tier system automatically selects cryptographic protection levels based on intent risk:

| Tier | Name | Verification Mode | PQ Checkpoint Interval | Typical Latency |
|------|------|-------------------|------------------------|-----------------|
| 0 | `routine` | `classical_only` | Every 50 events | ~2 ms |
| 1 | `standard` | `hybrid_preferred` | Every 10 events | ~2 ms + 5 ms checkpoint |
| 2 | `elevated` | `hybrid_required` | Every event | ~11 ms |
| 3 | `maximum` | `hybrid_required` | Every event + immediate verify | ~15 ms |

Tier selection algorithm:

```
function computeSecurityTier(intent):
  score = intent.risk_score ?? 0
  has_high_value = intent.data_classes ∩ {credentials, children_data} ≠ ∅
  has_sensitive = intent.data_classes ∩ {pii, financial_data, health_data,
                                         credentials, children_data} ≠ ∅
  is_payment = intent.action_type == "initiate_payment"

  if score >= 800 OR has_high_value:     return "maximum"
  if score >= 500 OR has_sensitive OR is_payment: return "elevated"
  if score >= 200:                       return "standard"
  return "routine"
```

The verifier MAY upgrade the computed tier but MUST NOT downgrade it.

## 6. Audit Layer (DCP-03)

### 6.1 Hash-Chained Audit Entries

Each audit entry links to its predecessor through hash chaining, forming a tamper-evident log of all agent actions.

Fields:
- `event_id` (REQUIRED): Unique event identifier. Format: `evt:<uuid>`.
- `event_type` (REQUIRED): Type of event (e.g., "intent_declared", "action_executed", "a2a_message_sent").
- `agent_id` (REQUIRED): The agent that generated this entry.
- `timestamp` (REQUIRED): ISO 8601 timestamp.
- `prev_hash` (REQUIRED): SHA-256 of the previous audit entry's canonical JSON. The first entry uses the sentinel value `"GENESIS"`.
- `prev_hash_secondary` (REQUIRED in v2.0): SHA3-256 of the previous entry (dual-hash chain).
- `payload_hash` (REQUIRED): SHA-256 hash of the action payload.
- `dcp_version` (REQUIRED): Protocol version string.
- `session_nonce` (REQUIRED in v2.0): Session binding nonce.

### 6.2 Dual-Hash Chains (v2.0)

DCP v2.0 maintains parallel hash chains using SHA-256 and SHA3-256. If one hash family is cryptanalytically compromised, the other chain provides continuity and tamper evidence.

### 6.3 Per-Event Signing

Each audit event is signed with Ed25519 for microsecond-latency signing. This provides non-repudiation at the individual event level.

### 6.4 PQ Checkpoints

Every N events (configurable, default 10), a PQ checkpoint is produced: a composite signature over the Merkle root of the last N events. This amortizes the cost of post-quantum signatures across multiple events while ensuring PQ protection.

### 6.5 Merkle Root

The audit trail's integrity is summarized in a Merkle root computed over all audit entries. The Merkle root is included in the bundle manifest and covered by the bundle-level composite signature.

### 6.6 Audit Compaction

After N events (default 1000), a compaction checkpoint is produced. Compacted events MAY be archived while the checkpoint remains in the active chain, reducing storage requirements for long-running agents.

## 7. Agent-to-Agent Communication (DCP-04)

### 7.1 Discovery

Agents publish directories at `.well-known/dcp-agent-directory.json` containing agent metadata, capabilities, endpoints, and supported algorithms. Directory entries are signed by the publishing organization.

```json
{
  "dcp_version": "2.0",
  "organization": "Acme Corp",
  "agents": [
    {
      "agent_id": "agent:acme-purchasing-001",
      "agent_name": "Acme Purchasing Agent",
      "capabilities": ["negotiate", "purchase_order"],
      "bundle_endpoint": "https://acme.com/.well-known/dcp/agents/001/bundle.json",
      "a2a_endpoint": "wss://acme.com/dcp/a2a",
      "a2a_transports": ["websocket", "grpc"],
      "security_tier_minimum": "elevated",
      "supported_algorithms": {
        "signing": ["ed25519", "ml-dsa-65"],
        "kem": ["x25519-ml-kem-768"]
      },
      "status": "active"
    }
  ],
  "directory_signature": { "..." }
}
```

### 7.2 Handshake

A2A sessions are established via a four-message handshake:

```
Agent A (Initiator)                    Agent B (Responder)
    |                                       |
    |── A2A_HELLO ─────────────────────────>|
    |   { signed_bundle_A, kem_pk_A,        |
    |     nonce_A, supported_algs }         |
    |                                       |
    |<────────────────────── A2A_WELCOME ───|
    |   { signed_bundle_B, kem_pk_B,        |
    |     nonce_B, kem_ciphertext_BA }      |
    |                                       |
    |── A2A_CONFIRM ───────────────────────>|
    |   { kem_ciphertext_AB,                |
    |     encrypted_confirm(nonce_A+B) }    |
    |                                       |
    |<──────────────────── A2A_ESTABLISHED ─|
    |   { encrypted_ack, session_id }       |
    |                                       |
    |══ Encrypted A2A Messages ════════════>|
    |<═════════════════════════════════════ ═|
```

The handshake uses hybrid KEM (X25519 + ML-KEM-768) for post-quantum key establishment. Both parties present and mutually verify their Signed Bundles before any data is exchanged.

### 7.3 Key Derivation

Session keys are derived using HKDF-SHA256:

```
shared_secret_BA = decapsulate(kem_ciphertext_BA, sk_A)
shared_secret_AB = decapsulate(kem_ciphertext_AB, sk_B)

session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

### 7.4 Session Management

Established sessions use AES-256-GCM with derived session keys. Sessions maintain monotonic sequence counters, support periodic rekeying (default every 1000 messages), and generate audit entries for all A2A events.

Session termination is signaled via `A2A_CLOSE` with a reason code and an audit summary hash covering all session events.

### 7.5 Trust Model

Trust between agents is established per-session through mutual bundle verification. Trust is non-transitive by default. Transitive trust MAY be enabled with configurable depth limits and organization-scoped trust policies.

## 8. Cryptographic Algorithms

### 8.1 Signature Algorithms

| Algorithm | Standard | Security Level | Public Key | Signature |
|-----------|----------|---------------|------------|-----------|
| ed25519 | RFC 8032 | 128-bit classical | 32 B | 64 B |
| ml-dsa-65 | FIPS 204 | NIST Level 3 PQ | 1952 B | 3309 B |
| ml-dsa-87 | FIPS 204 | NIST Level 5 PQ | 2592 B | 4627 B |
| slh-dsa-192f | FIPS 205 | NIST Level 3 PQ | 48 B | 35664 B |
| slh-dsa-256f | FIPS 205 | NIST Level 5 PQ | 64 B | 49856 B |

### 8.2 Key Encapsulation Mechanisms

| Algorithm | Standard | Security Level | Public Key | Ciphertext |
|-----------|----------|---------------|------------|------------|
| x25519 | RFC 7748 | 128-bit classical | 32 B | 32 B |
| ml-kem-768 | FIPS 203 | NIST Level 3 PQ | 1184 B | 1088 B |
| x25519-ml-kem-768 | Hybrid | Hybrid Level 3 | 1216 B | 1120 B |

### 8.3 Hash Algorithms

| Algorithm | Output | Usage |
|-----------|--------|-------|
| sha256 | 32 B | Default for Level 3 deployments, primary hash chain |
| sha3-256 | 32 B | Secondary hash for dual-hash mode |
| sha384 | 48 B | Recommended for Level 5 deployments |

### 8.4 Composite Signature Binding

The `pq_over_classical` binding protocol ensures that neither the classical nor the post-quantum signature component can be stripped without detection:

```
Step 1: classical_sig = Classical.sign(context || 0x00 || payload)
Step 2: pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)
```

The PQ signature covers the classical signature. During verification, the verifier MUST:

1. Extract `classical_sig` and `pq_sig` from the composite signature.
2. Verify `classical_sig` over `context || 0x00 || payload`.
3. Verify `pq_sig` over `context || 0x00 || payload || classical_sig`.
4. Reject if either verification fails.

Wire format:

```json
{
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

### 8.5 Key Identifier Derivation

Key identifiers are computed deterministically from the algorithm and raw public key bytes:

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]
```

### 8.6 Domain Separation

All signatures include a context tag to prevent cross-artifact replay attacks:

```
signed_bytes = UTF8(tag) || 0x00 || canonical_payload_bytes
```

Context tags:

| Context Tag | Usage |
|-------------|-------|
| `DCP-AI.v2.AgentPassport` | Agent passport self-signature |
| `DCP-AI.v2.ResponsiblePrincipal` | Responsible principal record signature |
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

## 9. Wire Formats

### 9.1 JSON (Default)

Content-Type: `application/json`. All JSON payloads MUST be canonicalized per RFC 8785 (JCS) before signing. Canonicalization rules:

1. Keys sorted lexicographically by Unicode code point.
2. Compact form (no whitespace).
3. Integers only — floating-point values are prohibited.
4. No field exclusion — the entire payload object is canonicalized.

### 9.2 CBOR (Optional)

Content-Type: `application/cbor`. Per RFC 8949 deterministic encoding. Provides 30-40% size reduction compared to JSON. RECOMMENDED for high-throughput deployments and A2A session messages.

### 9.3 Bundle Media Types

| Format | Media Type |
|--------|-----------|
| JSON | `application/dcp-bundle+json` |
| CBOR | `application/dcp-bundle+cbor` |

### 9.4 Bundle Manifest

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

The bundle-level composite signature signs `canonical(manifest)` under the `DCP-AI.v2.Bundle` context tag.

## 10. Security Considerations

### 10.1 Quantum Threat Mitigation

DCP uses hybrid composite signatures from day one. This defends against harvest-now-decrypt-later attacks where an adversary records signed artifacts today for cryptanalysis after a cryptographically relevant quantum computer becomes available.

The composite binding ensures that the bundle remains verifiable if either the classical or post-quantum algorithm is broken — verification succeeds only if both components are valid.

### 10.2 Stripping Attack Prevention

The `pq_over_classical` binding prevents removal of either signature component. The post-quantum signature covers the classical signature bytes, so stripping the classical signature invalidates the PQ signature. Stripping the PQ signature is detectable because verifiers require both components in `hybrid_required` mode.

### 10.3 Cross-Protocol Replay Prevention

Domain separation tags (Section 8.6) prevent an attacker from taking a signature produced for one artifact type (e.g., an Intent) and presenting it as valid for another (e.g., a Policy Decision). Each context tag creates a distinct signing domain.

### 10.4 Session Binding

The `session_nonce` field in v2.0 ties all artifacts in a bundle to a single session. Verifiers MUST check that all artifacts share the same nonce. This prevents session splicing attacks where artifacts from different sessions are mixed into a single bundle.

### 10.5 Security Tiers

Adaptive security tiers (Section 5.3) balance performance and security based on risk context. The never-downgrade rule ensures that high-risk intents always receive maximum protection regardless of agent preferences.

### 10.6 Key Compromise Recovery

DCP provides multiple mechanisms for key compromise recovery:

- **Emergency Revocation**: Pre-registered revocation token (SHA-256 commitment). Revealing the pre-image immediately revokes all agent keys without requiring a cryptographic signature.
- **Key Rotation**: New keys are certified by the old key with proof-of-possession, with a configurable grace window.
- **M-of-N Social Recovery**: Master secret split via Shamir's Secret Sharing, with shares encrypted using hybrid KEM.

### 10.7 Algorithm Agility

The algorithm advisory system allows governance authorities to deprecate or revoke algorithms via signed advisories. Verifiers automatically respond by removing affected algorithms, adding replacements, and transitioning to PQ-only mode when all classical algorithms are deprecated.

### 10.8 Canonicalization Safety

Integer-only numeric fields and the prohibition on floating-point values eliminate canonicalization ambiguity that could lead to signature validation inconsistencies across implementations.

### 10.9 Verification Mode Policy

Signature verification policy is set by the verifier, not the agent. This prevents an attacker from downgrading security by presenting bundles with weaker signature modes. The verifier loads its policy from its own configuration:

```json
{
  "verifier_policy": {
    "default_mode": "hybrid_required",
    "risk_overrides": {
      "high": "hybrid_required",
      "medium": "hybrid_required",
      "low": "hybrid_preferred"
    },
    "min_classical": 1,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "require_session_binding": true,
    "require_composite_binding": true
  }
}
```

## 11. IANA Considerations

This document requests registration of:

### 11.1 Media Types

| Media Type | Description |
|-----------|-------------|
| `application/dcp-bundle+json` | DCP Citizenship Bundle in JSON format |
| `application/dcp-bundle+cbor` | DCP Citizenship Bundle in CBOR format |

### 11.2 Well-Known URIs

| URI | Description |
|-----|-------------|
| `.well-known/dcp-capabilities.json` | DCP endpoint capabilities and version support |
| `.well-known/dcp-revocations.json` | Signed revocation list for a jurisdiction |
| `.well-known/dcp-agent-directory.json` | Agent discovery directory |
| `.well-known/governance-keys.json` | Governance key set for algorithm advisories |

## 12. References

### 12.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, DOI 10.17487/RFC2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, DOI 10.17487/RFC8174, May 2017.
- **[RFC8032]** Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, DOI 10.17487/RFC8032, January 2017.
- **[RFC7748]** Langley, A., Hamburg, M., and S. Turner, "Elliptic Curves for Security", RFC 7748, DOI 10.17487/RFC7748, January 2016.
- **[RFC8785]** Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, DOI 10.17487/RFC8785, June 2020.
- **[RFC8949]** Bormann, C. and P. Hoffman, "Concise Binary Object Representation (CBOR)", STD 94, RFC 8949, DOI 10.17487/RFC8949, December 2020.
- **[FIPS203]** National Institute of Standards and Technology, "Module-Lattice-Based Key-Encapsulation Mechanism Standard", FIPS 203, August 2024.
- **[FIPS204]** National Institute of Standards and Technology, "Module-Lattice-Based Digital Signature Standard", FIPS 204, August 2024.
- **[FIPS205]** National Institute of Standards and Technology, "Stateless Hash-Based Digital Signature Standard", FIPS 205, August 2024.

### 12.2 Informative References

- **[RFC5869]** Krawczyk, H. and P. Eronen, "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)", RFC 5869, DOI 10.17487/RFC5869, May 2010.
- **[RFC8446]** Rescorla, E., "The Transport Layer Security (TLS) Protocol Version 1.3", RFC 8446, DOI 10.17487/RFC8446, August 2018.
- **[RFC6962]** Laurie, B., Langley, A., and E. Kasper, "Certificate Transparency", RFC 6962, DOI 10.17487/RFC6962, June 2013.

## Appendix A. Conformance Requirements Summary

### A.1 MUST

- Composite-bound hybrid signatures on all v2.0 artifacts
- Domain separation on every signature
- Session nonce on every artifact within a v2.0 bundle
- Integer-only numeric fields
- Deterministic kid derivation
- NIST KAT validation for all PQ providers
- Security tier never-downgrade rule

### A.2 SHOULD

- HSM/TPM for private key storage in production
- Dual-hash chains (SHA-256 + SHA3-256)
- CBOR wire format for high-throughput deployments
- Short-lived certificates (24h TTL) instead of revocation lists
- Governance advisory polling (daily)
- Adaptive security tier computation for all intents

### A.3 MAY

- CBOR + gzip compression
- Parallel signature verification
- PQ-first fast-fail verification strategy
- Audit trail compaction
- Verification result caching with tier-based TTL

## Appendix B. Verification Pipeline

A conformant verifier MUST execute the following pipeline:

1. Wire format decode (JSON or CBOR)
2. Schema validation (route v1/v2 by `dcp_version`)
3. Session nonce consistency check
4. Manifest integrity verification (recompute all artifact hashes)
5. Security tier resolution
6. Advisory-driven algorithm rejection
7. Composite signature verification (parallel-capable)
8. Tier-aware verifier policy enforcement
9. Audit hash chain validation (primary and secondary)
10. PQ checkpoint chain validation
11. Key validity checks (expiry, revocation, kid derivation)
12. Verification cache lookup/store (tier-based TTL)

## Appendix C. Backward Compatibility Matrix

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

V2 verifiers MUST support V1 bundles indefinitely. Migration from V1 to V2 is gradual and driven by verifier policy.

---

*DCP was co-created by a human and an AI agent — the first digital citizenship protocol designed for AI, built by the very collaboration it governs.*
