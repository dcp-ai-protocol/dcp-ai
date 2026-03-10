# DCP-05: Agent Lifecycle

## Status
Draft — v2.0 Extension

## Abstract
This specification defines the full lifecycle of a DCP-certified AI agent, from commissioning through active service, declining capability, and eventual decommissioning. It introduces lifecycle state machines, vitality metrics, commissioning certificates, vitality reports, and decommissioning records — all cryptographically signed, hash-chained, and independently verifiable. The protocol ensures that an agent's operational history is tamper-evident, that transitions between lifecycle states are authorized and auditable, and that four distinct termination modes accommodate the full range of end-of-life scenarios.

## 1. Introduction

DCP-01 through DCP-04 establish identity, intent, audit, and communication for AI agents. However, these specifications assume agents exist in a steady operational state. In practice, agents have finite lifespans: they are created, they operate, they degrade, and they are retired or terminated. DCP-05 fills this gap by defining a comprehensive lifecycle model.

Without a lifecycle protocol, organizations face several risks:
- No authoritative record of when an agent was placed into or removed from service
- No continuous health monitoring that feeds into the trust model
- No standardized process for orderly retirement or emergency termination
- No tamper-evident history linking an agent's birth to its death

### 1.1 Design Principles
- Every lifecycle state transition MUST be signed and recorded
- Vitality metrics MUST be hash-chained to prevent retroactive manipulation
- Decommissioning MUST produce a sealed, independently verifiable record
- Lifecycle events integrate into the existing DCP audit chain (DCP-03)
- Human principals retain ultimate authority over lifecycle transitions

### 1.2 Relationship to Other Specifications
- **DCP-01**: Lifecycle states extend the identity model; a decommissioned agent's identity persists for audit purposes but cannot authorize new actions
- **DCP-02**: Intent declarations are only valid from agents in `active` state
- **DCP-03**: All lifecycle events generate audit entries in the agent's hash chain
- **DCP-04**: A2A sessions MUST be terminated when an agent transitions out of `active` state
- **DCP-06**: Succession and inheritance (defined separately) depend on lifecycle states defined here

## 2. Terminology

**Commissioning**: The formal act of creating an agent identity, binding it to a responsible principal, and placing it into service. Analogous to a birth certificate combined with a commission of office.

**Vitality**: A composite metric (integer, 0–1000) representing an agent's operational health, capability integrity, and trust standing. A vitality of 1000 indicates full operational capacity; 0 indicates total incapacity.

**Vitality Report**: A periodic, signed, hash-chained record of an agent's vitality metric and its component scores.

**Decommissioning**: The formal act of permanently removing an agent from service and sealing its operational record.

**Lifecycle State**: One of four canonical states an agent occupies: `commissioned`, `active`, `declining`, or `decommissioned`.

**Termination Mode**: The manner in which an agent transitions to the `decommissioned` state: `planned_retirement`, `termination_for_cause`, `organizational_restructuring`, or `sudden_failure`.

**Domain Separation Tag**: `DCP-LIFECYCLE-SIG-v2` — used for all signatures produced under this specification to prevent cross-protocol replay.

## 3. Lifecycle State Machine

### 3.1 States

An agent MUST be in exactly one of the following states at any time:

| State | Code | Description |
|-------|------|-------------|
| **Commissioned** | `commissioned` | Agent identity has been created and bound to a principal, but the agent has not yet been placed into active service. Analogous to a newly minted credential that has not yet been activated. |
| **Active** | `active` | Agent is fully operational. It may declare intents, execute actions, participate in A2A sessions, and generate audit entries. |
| **Declining** | `declining` | Agent's vitality has dropped below a configurable threshold, or a principal has initiated a managed wind-down. The agent MAY still operate but with restricted capabilities. New long-term commitments SHOULD be refused. |
| **Decommissioned** | `decommissioned` | Agent is permanently out of service. Its identity record persists for audit and historical verification, but it MUST NOT initiate any new actions, sessions, or intent declarations. |

### 3.2 Valid Transitions

```
                  activate
 commissioned ──────────────> active
                               │  │
                               │  │ decline (vitality < threshold
                               │  │         OR principal-initiated)
                               │  v
                               │  declining
                               │  │
                               │  │ reactivate (vitality restored
                               │  │            AND principal-approved)
                               │  │───────────> active
                               │  │
                  decommission │  │ decommission
                  (any mode)   │  │ (any mode)
                               v  v
                          decommissioned
```

Valid transitions:
1. `commissioned` -> `active` (activation)
2. `active` -> `declining` (vitality drop or principal-initiated decline)
3. `declining` -> `active` (reactivation, requires principal approval and vitality above threshold)
4. `active` -> `decommissioned` (direct termination)
5. `declining` -> `decommissioned` (termination from declining state)

Invalid transitions:
- `decommissioned` -> any state (terminal state, irreversible)
- `commissioned` -> `declining` (must be activated first)
- `commissioned` -> `decommissioned` (must be activated first, or use `termination_for_cause` if commissioning was erroneous, which implicitly activates and immediately decommissions)

### 3.3 Transition Record

Every state transition MUST produce a signed record:

```json
{
  "dcp_version": "2.0",
  "record_type": "lifecycle_transition",
  "transition_id": "lt:<uuid>",
  "agent_id": "agent:<identifier>",
  "from_state": "active",
  "to_state": "declining",
  "reason": "vitality_threshold_breach",
  "vitality_at_transition": 340,
  "threshold": 400,
  "authorized_by": {
    "principal_id": "principal:<identifier>",
    "role": "responsible_principal"
  },
  "timestamp": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

## 4. Commissioning Certificate

### 4.1 Purpose

A commissioning certificate is the foundational document of an agent's existence. It records the agent's creation parameters, its bound principal, initial capabilities, and the authorizing entity. It MUST be the first entry in the agent's lifecycle chain.

### 4.2 Schema

Schema reference: `schemas/v2/commissioning_certificate.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "commissioning_certificate",
  "certificate_id": "cc:<uuid>",
  "agent_id": "agent:<identifier>",
  "agent_name": "Human-readable agent name",
  "agent_description": "Purpose and scope of the agent",
  "principal_binding": {
    "principal_id": "principal:<identifier>",
    "principal_name": "Responsible Human or Entity",
    "organization_id": "org:<identifier>",
    "binding_type": "direct",
    "authority_level": "full"
  },
  "initial_capabilities": [
    "negotiate",
    "purchase_order",
    "data_query"
  ],
  "operational_parameters": {
    "intended_lifespan": "P365D",
    "vitality_report_interval": "PT1H",
    "vitality_decline_threshold": 400,
    "vitality_critical_threshold": 200,
    "max_concurrent_sessions": 100,
    "security_tier": "elevated",
    "permitted_domains": ["procurement", "finance"]
  },
  "initial_vitality": 1000,
  "cryptographic_identity": {
    "ed25519_public_key": "<base64>",
    "ml_dsa_65_public_key": "<base64>",
    "key_generation_timestamp": "2026-03-01T00:00:00Z"
  },
  "commissioning_authority": {
    "authority_id": "auth:<identifier>",
    "authority_name": "Organization Commissioning Authority",
    "authorization_reference": "AUTH-2026-0042"
  },
  "metadata": {
    "model_identifier": "model-name-v1.0",
    "deployment_environment": "production",
    "geographic_jurisdiction": "US"
  },
  "commissioned_at": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "prev_hash_secondary": "sha3-256:0000000000000000000000000000000000000000000000000000000000000000",
  "signature": {
    "alg": "ed25519",
    "kid": "<authority-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  },
  "countersignature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

### 4.3 Commissioning Flow

1. The commissioning authority generates the agent's cryptographic identity
2. The authority creates and signs the commissioning certificate
3. The responsible principal countersigns the certificate, accepting accountability
4. The certificate is recorded as the genesis entry (with null `prev_hash`) in the agent's lifecycle chain
5. An `agent_commissioned` audit entry is created in the DCP-03 audit chain
6. The agent transitions to `commissioned` state
7. Upon readiness verification, the agent transitions to `active` state

### 4.4 Countersignature Requirement

The commissioning certificate MUST carry two signatures:
- **Authority signature**: The entity authorized to commission agents (organizational root key or delegated commissioning key)
- **Principal countersignature**: The responsible principal accepting accountability for the agent

Both signatures MUST use the domain separation tag `DCP-LIFECYCLE-SIG-v2`.

## 5. Vitality Metric

### 5.1 Definition

Vitality is an integer in the range [0, 1000] representing an agent's overall operational fitness. It is a composite of four component scores:

| Component | Weight | Range | Description |
|-----------|--------|-------|-------------|
| **Capability Integrity** | 0.30 | 0–1000 | Measures whether the agent can perform its declared capabilities correctly. Derived from self-tests, capability probes, or external validation. |
| **Trust Standing** | 0.25 | 0–1000 | Measures the agent's trustworthiness based on audit history, policy compliance, and peer assessments. |
| **Resource Health** | 0.25 | 0–1000 | Measures computational resource availability: memory, latency, throughput, error rates. |
| **Policy Compliance** | 0.20 | 0–1000 | Measures adherence to declared intents and organizational policies. Derived from DCP-02 policy outcome records. |

Composite vitality:
```
vitality = floor(0.30 * capability_integrity + 0.25 * trust_standing +
                 0.25 * resource_health + 0.20 * policy_compliance)
```

### 5.2 Thresholds

Organizations configure two thresholds per agent in the commissioning certificate:

- **Decline Threshold** (default 400): When vitality drops below this value, the agent transitions to `declining` state
- **Critical Threshold** (default 200): When vitality drops below this value, immediate intervention is required; the agent SHOULD be decommissioned unless the responsible principal explicitly authorizes continued operation

### 5.3 Vitality Decay and Recovery

Vitality is not static. Component scores change based on:
- **Self-assessment**: Agent-reported capability test results
- **External probes**: Verification service health checks
- **Audit analysis**: Automated review of audit chain for anomalies
- **Peer reports**: Other agents reporting interaction quality via DCP-04

Recovery: If a `declining` agent's vitality rises above the decline threshold and the responsible principal approves, the agent MAY transition back to `active`.

## 6. Vitality Report

### 6.1 Purpose

Vitality reports form a hash-chained sequence providing a tamper-evident history of an agent's health over time. They are generated at the interval specified in the commissioning certificate.

### 6.2 Schema

Schema reference: `schemas/v2/vitality_report.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "vitality_report",
  "report_id": "vr:<uuid>",
  "agent_id": "agent:<identifier>",
  "sequence_number": 42,
  "lifecycle_state": "active",
  "vitality": 872,
  "components": {
    "capability_integrity": {
      "score": 920,
      "details": {
        "tests_passed": 47,
        "tests_failed": 2,
        "tests_total": 49,
        "last_test_timestamp": "2026-03-01T12:00:00Z"
      }
    },
    "trust_standing": {
      "score": 850,
      "details": {
        "successful_interactions": 1203,
        "failed_interactions": 12,
        "policy_violations": 0,
        "peer_trust_score": 880
      }
    },
    "resource_health": {
      "score": 810,
      "details": {
        "avg_response_latency_ms": 45,
        "error_rate_percent": 0.3,
        "memory_utilization_percent": 72,
        "throughput_ops_per_sec": 150
      }
    },
    "policy_compliance": {
      "score": 900,
      "details": {
        "intents_declared": 500,
        "intents_completed": 495,
        "policy_outcomes_compliant": 498,
        "policy_outcomes_noncompliant": 2
      }
    }
  },
  "anomalies": [],
  "recommendations": [],
  "report_interval": "PT1H",
  "report_window": {
    "from": "2026-03-01T11:00:00Z",
    "to": "2026-03-01T12:00:00Z"
  },
  "timestamp": "2026-03-01T12:00:05Z",
  "prev_hash": "sha256:<hex of previous vitality report>",
  "prev_hash_secondary": "sha3-256:<hex of previous vitality report>",
  "merkle_root": {
    "sha256": "<hex>",
    "sha3_256": "<hex>"
  },
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

### 6.3 Hash Chaining

Vitality reports form a hash chain. Each report's `prev_hash` and `prev_hash_secondary` reference the SHA-256 and SHA3-256 hashes of the immediately preceding vitality report. The first vitality report after commissioning references the commissioning certificate's hash.

The dual-hash approach (SHA-256 + SHA3-256) follows the same pattern as DCP-03 audit chains, providing resilience against single-algorithm compromise.

### 6.4 Merkle Root

Each vitality report includes a dual-hash Merkle root over the component scores and their details. This enables selective disclosure: an agent can prove its overall vitality score while revealing only specific component details.

### 6.5 Anomaly Detection

The `anomalies` array MAY contain structured anomaly reports:

```json
{
  "anomaly_id": "anom:<uuid>",
  "type": "capability_degradation",
  "severity": "warning",
  "component": "capability_integrity",
  "description": "Test pass rate dropped 15% in the last reporting interval",
  "detected_at": "2026-03-01T11:45:00Z",
  "data": {
    "previous_pass_rate": 0.98,
    "current_pass_rate": 0.83
  }
}
```

Anomaly severities: `info`, `warning`, `critical`.

## 7. Termination Modes

### 7.1 Overview

An agent reaches the `decommissioned` state via one of four termination modes, each with different procedural requirements:

| Mode | Code | Trigger | Grace Period |
|------|------|---------|--------------|
| **Planned Retirement** | `planned_retirement` | Agent has fulfilled its purpose or reached end of intended lifespan | Full (configurable, default 72h) |
| **Termination for Cause** | `termination_for_cause` | Agent violated policy, exhibited unsafe behavior, or was compromised | Minimal (configurable, default 1h) |
| **Organizational Restructuring** | `organizational_restructuring` | Business decision to retire the agent unrelated to its performance | Standard (configurable, default 24h) |
| **Sudden Failure** | `sudden_failure` | Agent became unresponsive or suffered catastrophic failure | None (post-hoc decommissioning by principal) |

### 7.2 Planned Retirement

The orderly end-of-life process:

1. Responsible principal issues a retirement notice with a grace period
2. Agent enters `declining` state (if not already)
3. Agent completes or transfers in-progress work
4. Agent terminates all A2A sessions with reason `complete`
5. Agent generates a final vitality report
6. Agent executes succession protocol (DCP-06) if configured
7. Decommissioning record is created and signed
8. Agent transitions to `decommissioned`

### 7.3 Termination for Cause

Emergency termination due to policy violations or compromise:

1. Responsible principal or organizational authority issues termination order
2. Agent's credentials are immediately flagged for revocation
3. All A2A sessions are terminated with reason `revocation`
4. A minimal grace period allows in-flight operations to complete (or be rolled back)
5. Decommissioning record is created with `cause` details
6. Agent transitions to `decommissioned`
7. Post-incident analysis generates an audit summary

### 7.4 Organizational Restructuring

Business-driven retirement:

1. Organization issues restructuring notice affecting the agent
2. Standard grace period for work transfer
3. Agent completes or transfers work per organizational policy
4. Succession protocol (DCP-06) executes if a successor is designated
5. Decommissioning record is created
6. Agent transitions to `decommissioned`

### 7.5 Sudden Failure

When an agent fails unexpectedly:

1. Monitoring system or peer agent detects unresponsiveness
2. A `sudden_failure` event is raised after a configurable timeout (default: 5 minutes of unresponsiveness)
3. The responsible principal is notified
4. The principal creates a post-hoc decommissioning record on the agent's behalf
5. The principal signs the decommissioning record with their own key (since the agent cannot sign)
6. A2A counterparties are notified if the agent was in active sessions
7. Succession protocol (DCP-06) executes in emergency mode if configured

## 8. Decommissioning Record

### 8.1 Purpose

The decommissioning record is the terminal document in an agent's lifecycle chain. It seals the agent's operational history and provides a permanent, verifiable record of how and why the agent was retired.

### 8.2 Schema

Schema reference: `schemas/v2/decommissioning_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "decommissioning_record",
  "decommission_id": "dc:<uuid>",
  "agent_id": "agent:<identifier>",
  "agent_name": "Human-readable agent name",
  "termination_mode": "planned_retirement",
  "lifecycle_summary": {
    "commissioned_at": "2026-01-01T00:00:00Z",
    "activated_at": "2026-01-01T01:00:00Z",
    "decommissioned_at": "2026-03-01T00:00:00Z",
    "total_active_duration": "P59D",
    "total_vitality_reports": 1416,
    "final_vitality": 720,
    "average_vitality": 865,
    "min_vitality": 410,
    "max_vitality": 995,
    "total_audit_entries": 15230,
    "total_a2a_sessions": 342,
    "total_intents_declared": 8901,
    "policy_violations": 2
  },
  "audit_chain_seal": {
    "final_audit_hash": "sha256:<hex>",
    "final_audit_hash_secondary": "sha3-256:<hex>",
    "audit_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "total_entries": 15230
  },
  "vitality_chain_seal": {
    "final_vitality_hash": "sha256:<hex>",
    "final_vitality_hash_secondary": "sha3-256:<hex>",
    "vitality_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "total_reports": 1416
  },
  "succession_reference": {
    "successor_agent_id": "agent:<identifier>",
    "succession_record_id": "sr:<uuid>",
    "memory_transfer_complete": true
  },
  "reason": "Agent fulfilled its intended operational lifespan",
  "cause_details": null,
  "key_disposition": {
    "private_keys_destroyed": true,
    "destruction_method": "secure_erasure",
    "destruction_witness": "principal:<identifier>",
    "public_keys_archived": true,
    "archive_location": "org-key-archive-2026"
  },
  "data_disposition": {
    "operational_data": "transferred_to_successor",
    "audit_data": "archived",
    "session_data": "purged",
    "archive_retention_period": "P7Y"
  },
  "decommissioned_at": "2026-03-01T00:00:00Z",
  "decommissioned_by": {
    "principal_id": "principal:<identifier>",
    "role": "responsible_principal"
  },
  "prev_hash": "sha256:<hex of final vitality report or last lifecycle record>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id or principal-key-id for sudden_failure>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  },
  "countersignature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

### 8.3 Chain Sealing

The decommissioning record includes Merkle root seals for both the audit chain and the vitality chain. These seals enable any future verifier to confirm the completeness and integrity of the agent's historical records without replaying the entire chain.

### 8.4 Key Disposition

Upon decommissioning:
- Private keys MUST be securely destroyed
- Public keys MUST be archived for future verification of historical artifacts
- The destruction method and witness MUST be recorded
- For `sudden_failure`, key destruction is performed by the responsible principal

### 8.5 Sudden Failure Special Handling

When an agent fails suddenly and cannot sign its own decommissioning record:
1. The responsible principal signs the record using their own key
2. The `signature.kid` references the principal's key, not the agent's
3. A `principal_signed_on_behalf` flag is set to `true`
4. The reason MUST include available diagnostic information
5. If the agent's last vitality report is available, its hash is used as `prev_hash`; otherwise, the last known audit entry hash is used

## 9. Integration with DCP-03 Audit Chain

### 9.1 Lifecycle Audit Events

All lifecycle events generate entries in the DCP-03 audit chain:

| Event | `event_type` |
|-------|-------------|
| Commissioning certificate created | `agent_commissioned` |
| Agent activated | `agent_activated` |
| Agent entered declining state | `agent_declining` |
| Agent reactivated from declining | `agent_reactivated` |
| Vitality report generated | `vitality_report_generated` |
| Vitality threshold breached | `vitality_threshold_breach` |
| Decommissioning initiated | `decommissioning_initiated` |
| Decommissioning completed | `agent_decommissioned` |

### 9.2 Audit Entry Format

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "agent_declining",
  "agent_id": "agent:<identifier>",
  "lifecycle_state": "declining",
  "vitality": 380,
  "trigger": "vitality_threshold_breach",
  "details": {
    "threshold": 400,
    "vitality_report_id": "vr:<uuid>"
  },
  "timestamp": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

## 10. Security Considerations

### 10.1 Lifecycle Chain Integrity

The hash-chained sequence of commissioning certificate, vitality reports, transition records, and decommissioning record forms a tamper-evident lifecycle chain. Any modification to a historical record invalidates all subsequent hashes.

### 10.2 Vitality Report Authenticity

Vitality reports are self-reported by the agent. Implementations SHOULD supplement self-reported data with external validation:
- Verification service health probes
- Peer agent interaction quality reports
- Organizational monitoring systems
- Automated capability testing

A compromised agent could falsify its own vitality. External validation sources provide defense-in-depth.

### 10.3 Termination Authorization

Only authorized principals may initiate lifecycle transitions. The authorization model:
- **Activation**: Commissioning authority or responsible principal
- **Decline**: Automatic (vitality threshold) or responsible principal
- **Reactivation**: Responsible principal only (requires explicit approval)
- **Decommissioning**: Responsible principal, organizational authority, or automatic (sudden failure detection)

### 10.4 Post-Decommissioning Verification

After decommissioning, the agent's public keys remain archived. Any party can verify the agent's historical signatures, audit chain, and vitality reports. The decommissioning record's chain seals enable efficient verification without replaying the entire history.

### 10.5 Domain Separation

All signatures under this specification use the domain separation tag `DCP-LIFECYCLE-SIG-v2`. This prevents signatures created for lifecycle purposes from being replayed in other DCP protocol contexts (e.g., intent declarations or A2A sessions).

### 10.6 Sudden Failure Risks

Sudden failure presents unique security risks:
- The agent cannot sign its own decommissioning record
- The agent's private key material may be in an unknown state
- In-flight operations may be in an inconsistent state

Mitigations:
- Principal-signed decommissioning records are clearly marked
- Key material MUST be presumed compromised; revocation SHOULD be issued
- Counterparty agents SHOULD treat in-flight data from the failed agent as potentially unreliable

## 11. Conformance

An implementation is DCP-05 conformant if it:
1. Implements all four lifecycle states and valid transitions as defined in Section 3
2. Generates commissioning certificates with dual signatures as defined in Section 4
3. Produces hash-chained vitality reports at the configured interval as defined in Section 6
4. Supports all four termination modes as defined in Section 7
5. Generates sealed decommissioning records as defined in Section 8
6. Creates DCP-03 audit entries for all lifecycle events as defined in Section 9
7. Uses the domain separation tag `DCP-LIFECYCLE-SIG-v2` for all signatures
8. Implements dual-hash (SHA-256 + SHA3-256) for all hash chain links

## References

- DCP-01: Identity & Principal Binding
- DCP-02: Intent Declaration & Policy Gating
- DCP-03: Audit Chain & Transparency
- DCP-04: Agent-to-Agent Communication
- DCP-06: Succession & Inheritance
- NIST SP 800-88: Guidelines for Media Sanitization (key destruction)
- RFC 3339: Date and Time on the Internet

---

*This specification acknowledges that AI agents, like all operational systems, have finite lifespans. A protocol for digital citizenship must account not only for how agents live, but for how they end — with dignity, accountability, and a complete record.*
