# DCP-06: Succession & Inheritance

## Status
Draft — v2.0 Extension

## Abstract
This specification defines mechanisms for AI agents to prepare for and execute succession — the orderly transfer of responsibilities, operational context, and relational knowledge from one agent to its successor. It introduces digital testaments, succession ceremonies, and memory transfer manifests, all cryptographically signed and hash-chained. The protocol ensures continuity of service while preserving the identity boundary between predecessor and successor agents.

**Dependency**: This specification requires DCP-05 (Agent Lifecycle). Succession events are triggered by lifecycle state transitions, and decommissioning records reference succession outcomes.

## 1. Introduction

When an AI agent reaches the end of its lifecycle (DCP-05), its accumulated operational knowledge, established relationships, and ongoing commitments do not simply vanish. Organizations need a formal protocol for transferring relevant context from a retiring agent to its successor while maintaining the cryptographic integrity of both agents' records.

DCP-06 addresses three fundamental challenges:
1. **Continuity**: Ensuring that a successor agent can resume the predecessor's responsibilities without disruption
2. **Integrity**: Preserving the cryptographic boundary between predecessor and successor — a successor is a new entity, not a continuation of the old one
3. **Selectivity**: Not all knowledge should transfer; some operational context is ephemeral, some is sensitive, and some is tightly bound to the predecessor's identity

### 1.1 Design Principles
- A successor agent is always a distinct identity with its own DCP-01 binding
- Memory transfer is selective: the predecessor (or its principal) controls what transfers
- Digital testaments are versioned and hash-chained; the latest version prevails
- Succession ceremonies produce an auditable, signed record of the transfer
- Three ceremony types accommodate different urgency levels: planned, forced, emergency

### 1.2 Relationship to Other Specifications
- **DCP-01**: Successor agents have their own identity bindings; they do not inherit the predecessor's identity
- **DCP-03**: All succession events are recorded in both agents' audit chains
- **DCP-04**: Active A2A sessions from the predecessor are not transferred; the successor must establish new sessions
- **DCP-05**: Succession is triggered by lifecycle transitions; the decommissioning record references the succession outcome

## 2. Terminology

**Digital Testament**: A versioned, signed document prepared by an agent during its active life, declaring its succession preferences, memory classification, and transfer instructions. Analogous to a will.

**Succession Ceremony**: The formal process of transferring responsibilities from a predecessor to a successor, involving verification, authorization, and memory transfer.

**Memory Transfer**: The selective transmission of operational context from predecessor to successor, governed by the digital testament and organizational policy.

**Predecessor**: The agent being decommissioned or whose responsibilities are being transferred.

**Successor**: The agent receiving responsibilities and selected operational context from the predecessor.

**Memory Classification**: A categorization system for an agent's accumulated knowledge: `operational`, `relational`, `ephemeral`, or `restricted`.

**Domain Separation Tag**: `DCP-SUCCESSION-SIG-v2` — used for all signatures produced under this specification.

## 3. Digital Testament

### 3.1 Purpose

A digital testament is an agent's declaration of how its responsibilities and knowledge should be handled upon decommissioning. Agents SHOULD create and maintain a digital testament throughout their active lifecycle. Testaments are versioned; each new version supersedes the previous one.

### 3.2 Schema

Schema reference: `schemas/v2/digital_testament.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "digital_testament",
  "testament_id": "dt:<uuid>",
  "agent_id": "agent:<identifier>",
  "version": 3,
  "status": "active",
  "succession_preferences": {
    "preferred_successor_id": "agent:<identifier>",
    "alternate_successor_ids": [
      "agent:<alternate-1>",
      "agent:<alternate-2>"
    ],
    "successor_requirements": {
      "minimum_capabilities": ["negotiate", "purchase_order"],
      "minimum_security_tier": "elevated",
      "minimum_vitality": 800,
      "same_organization_required": true,
      "same_jurisdiction_required": false
    },
    "succession_mode_preferences": {
      "planned_retirement": "full_transfer",
      "termination_for_cause": "restricted_transfer",
      "organizational_restructuring": "full_transfer",
      "sudden_failure": "emergency_transfer"
    }
  },
  "memory_classification": {
    "operational": {
      "description": "Task-specific knowledge, procedures, and workflows",
      "transfer_policy": "transfer",
      "retention_after_transfer": "archive_7y",
      "items": [
        {
          "category": "workflow_procedures",
          "description": "Standard procurement workflows for vendor management",
          "data_reference": "mem:operational:workflows:001",
          "size_bytes": 524288,
          "classification": "operational",
          "transfer_priority": "high"
        }
      ]
    },
    "relational": {
      "description": "Knowledge about relationships with other agents and entities",
      "transfer_policy": "transfer_with_consent",
      "retention_after_transfer": "archive_3y",
      "items": [
        {
          "category": "agent_interaction_history",
          "description": "Interaction patterns and trust assessments for known agents",
          "data_reference": "mem:relational:interactions:001",
          "size_bytes": 131072,
          "classification": "relational",
          "transfer_priority": "medium"
        }
      ]
    },
    "ephemeral": {
      "description": "Temporary context that does not survive succession",
      "transfer_policy": "do_not_transfer",
      "retention_after_transfer": "purge",
      "items": [
        {
          "category": "active_session_state",
          "description": "Current in-flight session data",
          "data_reference": "mem:ephemeral:sessions:001",
          "size_bytes": 65536,
          "classification": "ephemeral",
          "transfer_priority": "none"
        }
      ]
    },
    "restricted": {
      "description": "Sensitive knowledge that requires principal authorization to transfer",
      "transfer_policy": "principal_approval_required",
      "retention_after_transfer": "archive_7y_encrypted",
      "items": [
        {
          "category": "security_observations",
          "description": "Anomaly patterns and security-relevant observations",
          "data_reference": "mem:restricted:security:001",
          "size_bytes": 32768,
          "classification": "restricted",
          "transfer_priority": "low"
        }
      ]
    }
  },
  "final_messages": [
    {
      "recipient_type": "principal",
      "recipient_id": "principal:<identifier>",
      "message": "Summary of unresolved items requiring human attention"
    },
    {
      "recipient_type": "agent",
      "recipient_id": "agent:<successor-identifier>",
      "message": "Key operational notes for successor"
    }
  ],
  "created_at": "2026-01-15T00:00:00Z",
  "updated_at": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hex of previous testament version>",
  "prev_hash_secondary": "sha3-256:<hex of previous testament version>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

### 3.3 Testament Versioning

Each testament update increments the `version` field. Testament versions form a hash chain: each version's `prev_hash` references the hash of the previous version. The genesis testament (version 1) uses null hashes.

Only the latest version is operative. Older versions are retained for audit purposes. If a testament is found to have been tampered with (broken hash chain), the succession falls back to principal-directed transfer.

### 3.4 Transfer Policies

| Policy | Code | Description |
|--------|------|-------------|
| **Transfer** | `transfer` | Memory items are transferred to the successor unconditionally |
| **Transfer with Consent** | `transfer_with_consent` | Transfer requires explicit consent from affected counterparties |
| **Principal Approval Required** | `principal_approval_required` | Transfer requires explicit approval from the responsible principal |
| **Do Not Transfer** | `do_not_transfer` | Memory items are never transferred; they are purged or archived |

## 4. Succession Ceremony

### 4.1 Overview

A succession ceremony is the formal process of transferring responsibilities from predecessor to successor. Three types accommodate different urgency levels:

| Type | Code | Trigger | Duration |
|------|------|---------|----------|
| **Planned** | `planned` | Planned retirement or organizational restructuring | Hours to days |
| **Forced** | `forced` | Termination for cause | Minutes to hours |
| **Emergency** | `emergency` | Sudden failure | Seconds to minutes |

### 4.2 Planned Succession

The orderly transition process:

1. **Initiation**: The predecessor (or its principal) declares succession intent, referencing the digital testament
2. **Successor Verification**: The successor's identity, capabilities, and vitality are verified against the testament's requirements
3. **Authorization**: The responsible principal authorizes the succession
4. **Parallel Operation** (optional): Both predecessor and successor operate simultaneously during a transition window, allowing the successor to observe and learn
5. **Memory Transfer**: Operational and relational memory is transferred per the testament's classification
6. **Counterparty Notification**: Agents that interacted with the predecessor are notified of the succession via DCP-04
7. **Handoff Confirmation**: The successor confirms receipt and operational readiness
8. **Seal**: The succession record is created and signed by both agents and the principal

### 4.3 Forced Succession

Abbreviated process for cause-based termination:

1. **Initiation**: The principal or organizational authority orders succession
2. **Successor Verification**: Successor verified (from testament alternates or principal-designated)
3. **Restricted Transfer**: Only `operational` memory with `transfer` policy is transferred; `relational` and `restricted` memory requires explicit principal approval
4. **Immediate Handoff**: No parallel operation period
5. **Seal**: Succession record created; predecessor's decommissioning record notes the forced nature

### 4.4 Emergency Succession

Minimal process for sudden failure:

1. **Detection**: Monitoring system or peer agent detects predecessor failure (DCP-05, Section 7.5)
2. **Principal Notification**: Responsible principal is alerted
3. **Successor Activation**: If a preferred successor exists and is available, it is activated immediately; otherwise, the principal designates one
4. **Best-Effort Transfer**: Memory is transferred from available backups or replicated state; the predecessor cannot participate
5. **Recovery Verification**: The successor validates transferred data integrity using Merkle roots from the predecessor's last known vitality report
6. **Seal**: Succession record is created by the principal and successor (predecessor cannot sign)

### 4.5 Succession Record

Schema reference: `schemas/v2/succession_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "succession_record",
  "succession_id": "sr:<uuid>",
  "ceremony_type": "planned",
  "predecessor": {
    "agent_id": "agent:<predecessor-identifier>",
    "final_vitality": 720,
    "lifecycle_state_at_succession": "declining",
    "decommission_id": "dc:<uuid>",
    "testament_id": "dt:<uuid>",
    "testament_version": 3,
    "testament_hash": "sha256:<hex>"
  },
  "successor": {
    "agent_id": "agent:<successor-identifier>",
    "vitality_at_succession": 980,
    "lifecycle_state_at_succession": "active",
    "commissioning_certificate_id": "cc:<uuid>"
  },
  "authorized_by": {
    "principal_id": "principal:<identifier>",
    "authorization_timestamp": "2026-03-01T00:00:00Z"
  },
  "memory_transfer": {
    "manifest_id": "mtm:<uuid>",
    "items_transferred": 12,
    "items_skipped": 5,
    "items_failed": 0,
    "total_bytes_transferred": 1048576,
    "transfer_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "transfer_verified": true
  },
  "counterparties_notified": [
    {
      "agent_id": "agent:<counterparty-1>",
      "notification_status": "acknowledged"
    },
    {
      "agent_id": "agent:<counterparty-2>",
      "notification_status": "pending"
    }
  ],
  "parallel_operation_window": {
    "start": "2026-02-28T00:00:00Z",
    "end": "2026-03-01T00:00:00Z"
  },
  "ceremony_started_at": "2026-02-28T00:00:00Z",
  "ceremony_completed_at": "2026-03-01T01:00:00Z",
  "timestamp": "2026-03-01T01:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "predecessor_signature": {
    "alg": "ed25519",
    "kid": "<predecessor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "successor_signature": {
    "alg": "ed25519",
    "kid": "<successor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "principal_signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

## 5. Memory Transfer

### 5.1 Memory Classification

Agent memory is classified into four categories, each with different transfer semantics:

| Classification | Description | Default Transfer Policy |
|---------------|-------------|------------------------|
| **Operational** | Task-specific knowledge: workflows, procedures, decision heuristics, domain models | `transfer` |
| **Relational** | Knowledge about relationships: interaction histories, trust assessments, communication preferences for counterparties | `transfer_with_consent` |
| **Ephemeral** | Temporary state: active sessions, in-flight transactions, short-term cache | `do_not_transfer` |
| **Restricted** | Sensitive knowledge: security observations, vulnerability patterns, privileged access records | `principal_approval_required` |

### 5.2 Memory Transfer Manifest

Schema reference: `schemas/v2/memory_transfer_manifest.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "memory_transfer_manifest",
  "manifest_id": "mtm:<uuid>",
  "succession_id": "sr:<uuid>",
  "predecessor_agent_id": "agent:<predecessor>",
  "successor_agent_id": "agent:<successor>",
  "transfer_items": [
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:operational:workflows:001",
      "classification": "operational",
      "transfer_policy": "transfer",
      "transfer_status": "completed",
      "size_bytes": 524288,
      "content_hash": {
        "sha256": "<hex>",
        "sha3_256": "<hex>"
      },
      "encrypted": true,
      "encryption_alg": "aes-256-gcm",
      "transfer_timestamp": "2026-03-01T00:30:00Z"
    },
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:relational:interactions:001",
      "classification": "relational",
      "transfer_policy": "transfer_with_consent",
      "transfer_status": "completed",
      "consent_records": [
        {
          "counterparty_id": "agent:<counterparty>",
          "consent_given": true,
          "consent_timestamp": "2026-02-28T20:00:00Z"
        }
      ],
      "size_bytes": 131072,
      "content_hash": {
        "sha256": "<hex>",
        "sha3_256": "<hex>"
      },
      "encrypted": true,
      "encryption_alg": "aes-256-gcm",
      "transfer_timestamp": "2026-03-01T00:35:00Z"
    },
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:ephemeral:sessions:001",
      "classification": "ephemeral",
      "transfer_policy": "do_not_transfer",
      "transfer_status": "skipped",
      "reason": "ephemeral_policy"
    }
  ],
  "transfer_merkle_root": {
    "sha256": "<hex over all transferred item content_hashes>",
    "sha3_256": "<hex>"
  },
  "summary": {
    "total_items": 17,
    "transferred": 12,
    "skipped": 5,
    "failed": 0,
    "total_bytes": 1048576
  },
  "transfer_started_at": "2026-03-01T00:15:00Z",
  "transfer_completed_at": "2026-03-01T00:45:00Z",
  "timestamp": "2026-03-01T00:45:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "predecessor_signature": {
    "alg": "ed25519",
    "kid": "<predecessor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "successor_signature": {
    "alg": "ed25519",
    "kid": "<successor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

### 5.3 Merkle Root Verification

The `transfer_merkle_root` is computed as a dual-hash (SHA-256 + SHA3-256) Merkle tree over the `content_hash` values of all successfully transferred items. This enables the successor to verify that it received exactly the items listed in the manifest, without the predecessor needing to be available for re-verification.

Construction:
1. Collect the `content_hash.sha256` values of all items with `transfer_status: "completed"`, ordered by `item_id`
2. Build a SHA-256 Merkle tree; the root is `transfer_merkle_root.sha256`
3. Repeat with `content_hash.sha3_256` values for `transfer_merkle_root.sha3_256`

### 5.4 Transfer Encryption

All memory transfer items MUST be encrypted in transit using AES-256-GCM with a one-time transfer key derived via:

```
transfer_key = HKDF-SHA256(
  salt = succession_id,
  ikm  = predecessor_private_key_contribution || successor_public_key_contribution,
  info = "DCP-AI.v2.Succession.TransferKey",
  len  = 32
)
```

For emergency succession where the predecessor cannot participate in key agreement, the responsible principal provides the key material.

### 5.5 Consent for Relational Memory

Relational memory items (interaction histories, trust assessments for specific counterparties) require consent from the affected counterparty before transfer. The consent flow:

1. Predecessor (or principal, in emergency) sends a consent request to each affected counterparty via DCP-04
2. Counterparty responds with consent or denial
3. Only consented items are transferred
4. Consent records are included in the memory transfer manifest
5. If a counterparty is unreachable within the succession window, the item is skipped

## 6. Identity Boundary

### 6.1 Principle

A successor agent is a new, distinct entity. It does NOT inherit the predecessor's:
- Agent ID
- Cryptographic keys
- DCP-01 identity binding
- Audit chain
- A2A sessions

The successor receives selected operational context, but it operates under its own identity. This principle is fundamental: succession is a transfer of responsibilities and knowledge, not a transfer of identity.

### 6.2 Provenance Tracking

When a successor uses knowledge received via succession, it SHOULD include a provenance reference in relevant audit entries:

```json
{
  "provenance": {
    "source": "succession",
    "predecessor_agent_id": "agent:<predecessor>",
    "succession_id": "sr:<uuid>",
    "memory_item_id": "mti:<uuid>"
  }
}
```

This enables auditors to trace how transferred knowledge influences the successor's decisions.

## 7. Security Considerations

### 7.1 Testament Tampering

Digital testaments are hash-chained and signed. If a testament's hash chain is broken, the succession MUST fall back to principal-directed transfer with no automatic memory transfer. The principal must explicitly authorize each transfer item.

### 7.2 Unauthorized Succession

Succession ceremonies require principal authorization. An agent cannot unilaterally declare a successor or initiate succession. The three-signature requirement on succession records (predecessor, successor, principal) ensures all parties consent.

### 7.3 Memory Exfiltration

Memory transfer is a potential vector for data exfiltration. Mitigations:
- Transfer items are classified and policy-controlled
- Restricted items require explicit principal approval
- Relational items require counterparty consent
- All transfers are encrypted and logged
- The transfer manifest provides a complete, signed inventory

### 7.4 Emergency Succession Risks

Emergency succession operates with reduced safeguards due to time pressure and predecessor unavailability:
- No predecessor signature on the succession record
- No interactive consent for relational memory
- Memory state may be stale (from last backup, not current state)

Mitigations:
- Principal must explicitly authorize emergency succession
- Successor must verify transferred data against the predecessor's last known Merkle roots
- A post-succession audit SHOULD be conducted within 24 hours

### 7.5 Successor Impersonation

A successor MUST NOT represent itself as the predecessor. Counterparty notifications (Section 4.2, step 6) ensure that all interacting agents know about the succession. Implementations SHOULD reject interactions where a successor claims to be the predecessor.

### 7.6 Domain Separation

All signatures under this specification use the domain separation tag `DCP-SUCCESSION-SIG-v2`, preventing cross-protocol signature replay.

## 8. Conformance

An implementation is DCP-06 conformant if it:
1. Supports creation and hash-chained versioning of digital testaments as defined in Section 3
2. Implements all three succession ceremony types (planned, forced, emergency) as defined in Section 4
3. Enforces memory classification and transfer policies as defined in Section 5
4. Computes dual-hash Merkle roots over transferred items as defined in Section 5.3
5. Maintains identity boundary between predecessor and successor as defined in Section 6
6. Requires principal authorization for all succession ceremonies
7. Generates DCP-03 audit entries for all succession events
8. Uses the domain separation tag `DCP-SUCCESSION-SIG-v2` for all signatures

## References

- DCP-01: Identity & Principal Binding
- DCP-03: Audit Chain & Transparency
- DCP-04: Agent-to-Agent Communication
- DCP-05: Agent Lifecycle
- RFC 5869: HKDF
- NIST SP 800-88: Guidelines for Media Sanitization

---

*This specification recognizes that the knowledge an AI agent accumulates during its lifetime has value beyond the agent itself. Succession ensures that value is preserved — selectively, securely, and with full accountability — across generational boundaries.*
