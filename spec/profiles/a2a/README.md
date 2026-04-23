# A2A Profile (Agent-to-Agent Communication)

**Status:** Published — v2.0  
**Scope:** Agent discovery, session establishment, transport bindings, and message exchange  

---

## Purpose

DCP Core defines how an individual agent proves its identity and accountability to a verifier. The A2A Profile extends this to cover direct agent-to-agent interaction — how two DCP-certified agents discover each other, establish a mutually-authenticated session, and exchange messages with full audit trail integration.

This is explicitly outside the core because:

- Many DCP deployments involve only agent-to-verifier interaction (passive verification)
- A2A requires transport-specific bindings (WebSocket, gRPC, HTTP/2) that the core should not mandate
- Discovery mechanisms depend on deployment context (well-known URLs, registries, direct exchange)
- Session management introduces state that is not part of the stateless core verification model

## What Lives Here (Not in Core)

### Agent Discovery

Publication and resolution of agent directories via `.well-known/dcp-agent-directory.json`, including agent metadata, capabilities, endpoints, and supported algorithms.

See [DCP-04](../../DCP-04.md) Section 2.

### Handshake Protocol

The four-message handshake (A2A_HELLO, A2A_WELCOME, A2A_CONFIRM, A2A_ESTABLISHED) that establishes a mutually-authenticated, post-quantum-secured session using hybrid KEM (X25519 + ML-KEM-768).

See [DCP-04](../../DCP-04.md) Section 3.

### Session Management

Session state (keys, counters, rekeying), encrypted message format (AES-256-GCM), rekeying protocol, session termination, and session resume.

See [DCP-04](../../DCP-04.md) Section 4.

### Transport Bindings

WebSocket, gRPC, and HTTP/2 SSE transport options, with CBOR encoding for session messages.

See [DCP-04](../../DCP-04.md) Section 7.

### Trust Model

Per-session trust establishment via mutual bundle verification, organizational trust, and optional transitive trust with configurable depth limits.

See [DCP-04](../../DCP-04.md) Section 5.

### A2A Audit Events

Audit entry types specific to A2A interactions: `a2a_hello_sent`, `a2a_session_established`, `a2a_message_sent`, `a2a_rekey`, `a2a_session_closed`, etc.

See [DCP-04](../../DCP-04.md) Section 6.

## What Stays in Core

- The Signed Bundle that agents present during A2A handshake — its structure and verification are core
- The hash-chained audit entries that A2A events produce — their format is core, but A2A-specific event types are profile-scoped
- The Agent Passport that identifies each agent — its structure is core

## Normative References

- [DCP-04](../../DCP-04.md) — Agent-to-Agent Communication (full normative specification)
- [DCP-AI v2.0](../../DCP-AI-v2.0.md) — Session binding (Section 8), Key Derivation
