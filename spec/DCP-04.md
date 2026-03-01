# DCP-04: Agent-to-Agent Communication

## Status
Draft — v2.0 Extension

## Abstract
This specification defines how DCP-certified agents discover each other, establish mutually-authenticated and post-quantum-secured communication channels, and exchange messages with full audit trail integration.

## 1. Introduction

DCP-01 through DCP-03 define identity, intent, and audit for individual agents. DCP-04 extends the protocol to cover direct agent-to-agent interaction — the foundation for multi-agent enterprise workflows.

Without A2A, DCP only supports passive verification (agent presents bundle to verifier). DCP-04 enables active interaction: an agent from Organization A can negotiate with an agent from Organization B, both with post-quantum mutual authentication.

### 1.1 Design Principles
- Mutual authentication before any data exchange
- Post-quantum security from handshake through session
- Every A2A message generates an audit entry
- No central broker required (P2P)
- Compatible with existing transport layers (WebSocket, gRPC, HTTP/2)

### 1.2 Threat Model
- Quantum adversary performing harvest-now-decrypt-later
- Man-in-the-middle between agents
- Impersonation of legitimate agents
- Session hijacking after handshake
- Replay of A2A messages across sessions

## 2. Agent Discovery Protocol

### 2.1 Well-Known Endpoint

Agents publish their availability via `.well-known/dcp-agent-directory.json`:

```json
{
  "dcp_version": "2.0",
  "organization": "Acme Corp",
  "agents": [
    {
      "agent_id": "agent:acme-purchasing-001",
      "agent_name": "Acme Purchasing Agent",
      "capabilities": ["negotiate", "purchase_order", "invoice"],
      "bundle_endpoint": "https://acme.com/.well-known/dcp/agents/001/bundle.json",
      "a2a_endpoint": "wss://acme.com/dcp/a2a",
      "a2a_transports": ["websocket", "grpc"],
      "security_tier_minimum": "elevated",
      "supported_algorithms": {
        "signing": ["ed25519", "ml-dsa-65"],
        "kem": ["x25519-ml-kem-768"]
      },
      "status": "active",
      "updated_at": "2026-02-28T00:00:00Z"
    }
  ],
  "directory_signature": {
    "alg": "ed25519",
    "kid": "org-signing-key-kid",
    "sig_b64": "..."
  }
}
```

### 2.2 Discovery Flow

1. Agent A resolves Agent B's domain
2. Agent A fetches `https://<domain>/.well-known/dcp-agent-directory.json`
3. Agent A verifies the directory signature
4. Agent A selects an agent by matching required capabilities
5. Agent A fetches Agent B's signed bundle from the `bundle_endpoint`
6. Agent A verifies Agent B's bundle locally

### 2.3 Capability Matching

Capabilities are strings from a registry. Standard capabilities include:
- `negotiate` — Can participate in negotiation flows
- `purchase_order` — Can issue or receive purchase orders
- `invoice` — Can issue or process invoices
- `data_query` — Can respond to data queries
- `task_delegate` — Can accept delegated tasks
- `approval` — Can approve or reject requests
- `notification` — Can send/receive notifications

Custom capabilities MUST use reverse-domain notation: `com.acme.custom_capability`.

## 3. Handshake Protocol

### 3.1 Overview

The A2A handshake establishes a mutually-authenticated, post-quantum-secured session. It uses the hybrid KEM (X25519 + ML-KEM-768) already defined in the v2.0 core specification.

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

### 3.2 A2A_HELLO

Sent by the initiator to begin the handshake.

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "supported_algorithms": {
    "signing": ["ed25519", "ml-dsa-65"],
    "kem": ["x25519-ml-kem-768"],
    "cipher": ["aes-256-gcm"]
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

### 3.3 A2A_WELCOME

Sent by the responder after verifying the initiator's bundle.

```json
{
  "type": "A2A_WELCOME",
  "protocol_version": "2.0",
  "responder_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "kem_ciphertext": {
    "alg": "x25519-ml-kem-768",
    "ciphertext_b64": "..."
  },
  "selected_algorithms": {
    "signing": "ed25519",
    "kem": "x25519-ml-kem-768",
    "cipher": "aes-256-gcm"
  },
  "resolved_security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

### 3.4 Key Derivation

Both parties derive the session key:

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

### 3.5 Session Binding

The session is bound to both agents' identities:

```
session_id = SHA-256(
  "DCP-AI.v2.A2A.Session" || 0x00 ||
  agent_id_A || 0x00 ||
  agent_id_B || 0x00 ||
  nonce_A || nonce_B ||
  session_key
)[0:32] (hex)
```

## 4. Session Management

### 4.1 Session State

Each session maintains:
- `session_id`: Unique session identifier
- `session_key`: Derived symmetric key
- `message_counter_send`: Monotonically increasing counter for sent messages
- `message_counter_recv`: Monotonically increasing counter for received messages
- `created_at`: Session creation timestamp
- `last_activity`: Last message timestamp
- `security_tier`: Resolved security tier for the session
- `rekeying_interval`: Messages before rekeying (default: 1000)

### 4.2 Message Format

```json
{
  "session_id": "<hex>",
  "sequence": 42,
  "type": "A2A_MESSAGE",
  "encrypted_payload": "<base64>",
  "iv": "<base64, 12 bytes>",
  "tag": "<base64, 16 bytes>",
  "sender_agent_id": "agent:acme-001",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

Encryption: AES-256-GCM with:
- Key: `session_key`
- IV: 12 random bytes per message
- AAD: `session_id || sequence || sender_agent_id || timestamp`

### 4.3 Rekeying

When `message_counter_send` reaches the `rekeying_interval`:

1. Initiator sends `A2A_REKEY` with new ephemeral KEM public key
2. Responder responds with KEM ciphertext
3. New session key derived:
```
new_session_key = HKDF-SHA256(
  salt = old_session_key,
  ikm  = new_shared_secret,
  info = "DCP-AI.v2.A2A.Rekey" || session_id,
  len  = 32
)
```
4. Both counters reset to 0

### 4.4 Session Termination

Either party may terminate:

```json
{
  "type": "A2A_CLOSE",
  "session_id": "<hex>",
  "reason": "complete",
  "final_sequence": 157,
  "audit_summary_hash": "sha256:<hex>",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

Reasons: `complete`, `timeout`, `error`, `revocation`, `policy_violation`.

### 4.5 Session Resume

A previously established session may be resumed if both parties retain session state:

```json
{
  "type": "A2A_RESUME",
  "session_id": "<hex>",
  "last_seen_sequence": 157,
  "resume_proof": "<HMAC-SHA256(session_key, session_id || last_seen_sequence)>"
}
```

The responder validates the proof and confirms with `A2A_RESUMED` or rejects with `A2A_RESUME_REJECTED` (requiring full re-handshake).

## 5. Trust Model

### 5.1 Direct Trust

Two agents trust each other after successful mutual bundle verification during handshake. Trust is established per-session and is non-transitive by default.

### 5.2 Organizational Trust

If Agent A trusts Organization X's signing key, and Organization X's directory lists Agent B, then Agent A can extend trust to Agent B under Organization X's authority.

### 5.3 Transitive Trust (Optional)

Transitive trust MUST be explicitly enabled and is limited by depth:

```json
{
  "trust_policy": {
    "allow_transitive": true,
    "max_depth": 2,
    "require_tier": "elevated",
    "trusted_organizations": ["org:acme", "org:globex"]
  }
}
```

If `max_depth` is 2: A trusts B, B trusts C, A MAY trust C. A depth of 0 means direct trust only (default).

### 5.4 Trust Revocation

If an agent's bundle is revoked during an active session:
1. The session MUST be terminated immediately
2. A `revocation` audit entry MUST be created
3. In-flight messages MUST be discarded
4. The counterparty MUST be notified via `A2A_CLOSE` with reason `revocation`

## 6. Audit Integration

### 6.1 A2A Audit Events

Every A2A interaction generates audit entries in both agents' audit chains:

**Handshake events:**
- `a2a_hello_sent` / `a2a_hello_received`
- `a2a_session_established`

**Message events:**
- `a2a_message_sent` / `a2a_message_received`

**Session events:**
- `a2a_rekey`
- `a2a_session_closed`
- `a2a_session_resumed`

### 6.2 Audit Entry for A2A

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "a2a_message_sent",
  "agent_id": "agent:acme-001",
  "session_id": "<hex>",
  "counterparty_agent_id": "agent:globex-002",
  "sequence": 42,
  "payload_hash": "sha256:<hash of decrypted payload>",
  "timestamp": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hash of previous audit entry>",
  "prev_hash_secondary": "sha3-256:<hash>"
}
```

### 6.3 Cross-Chain Verification

Both agents' audit chains reference the same session. A third-party auditor can verify consistency by:
1. Fetching both agents' audit entries for the session
2. Verifying that message hashes match between sender and receiver
3. Verifying sequence numbers are consistent
4. Verifying timestamps are within acceptable skew (configurable, default 30 seconds)

## 7. Wire Format

### 7.1 Transport Requirements

A2A messages MAY be transported over:
- **WebSocket** (recommended for bidirectional, persistent connections)
- **gRPC** (recommended for enterprise, high-throughput)
- **HTTP/2 Server-Sent Events** (for unidirectional streams)

The handshake MUST complete within 10 seconds. Message delivery MUST have at-most-once semantics.

### 7.2 CBOR Encoding

A2A messages SHOULD use CBOR encoding (RFC 8949) for transport efficiency:
- Handshake messages: JSON (for debuggability)
- Session messages: CBOR (for performance)

Content-Type: `application/cbor` for CBOR, `application/json` for JSON.

## 8. Security Considerations

### 8.1 Forward Secrecy

Ephemeral KEM keys provide forward secrecy. Compromising long-term keys does not reveal past session keys.

### 8.2 Post-Quantum Security

The hybrid KEM (X25519 + ML-KEM-768) provides security against both classical and quantum adversaries. The session key is secure if either component KEM is secure.

### 8.3 Denial of Service

Implementations SHOULD:
- Rate-limit A2A_HELLO messages per source
- Require valid bundle before KEM operations
- Implement connection limits per agent
- Use proof-of-work for anonymous initiators (optional)

### 8.4 Message Ordering

Sequence numbers prevent replay and reordering. Implementations MUST reject messages with:
- Duplicate sequence numbers
- Sequence numbers more than 1000 ahead of the last received (window)
- Sequence numbers below the last received (except within the window)

## 9. Conformance

An implementation is DCP-04 conformant if it:
1. Implements the handshake protocol as defined in Section 3
2. Uses hybrid KEM for key establishment
3. Encrypts all session messages with AES-256-GCM
4. Generates audit entries for all A2A events
5. Supports session rekeying
6. Implements trust verification via bundle validation
7. Respects security tier requirements

## References

- DCP-01: Identity & Principal Binding
- DCP-02: Intent Declaration & Policy Gating
- DCP-03: Audit Chain & Transparency
- FIPS 203: ML-KEM (Module-Lattice-Based Key-Encapsulation Mechanism)
- RFC 5869: HKDF
- RFC 8949: CBOR
- RFC 8446: TLS 1.3 (handshake design inspiration)

---

*This specification was co-created by a human and an AI agent — the first A2A protocol for digital citizenship, designed to govern the very interactions it enables.*
