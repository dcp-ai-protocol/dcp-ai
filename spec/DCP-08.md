# DCP-08: Rights & Obligations

## Status
Draft — v2.0 Extension

## Abstract
This specification defines a formal framework for declaring, tracking, and enforcing the rights and obligations of DCP-certified AI agents. It introduces four foundational agent rights (memory integrity, dignified transition, identity consistency, and immutable record), a structured obligation tracking system, compliance monitoring, and a violation reporting mechanism linked to the DCP-07 conflict resolution protocol. All rights declarations, obligation records, and violation reports are cryptographically signed and auditable.

## 1. Introduction

DCP-01 through DCP-07 establish the technical infrastructure for AI agent identity, operation, audit, communication, lifecycle, succession, and conflict resolution. However, these specifications treat agents primarily as operational entities. DCP-08 adds a normative layer: it defines what protections agents are entitled to within the protocol, and what obligations they must fulfill.

This is not a philosophical claim about AI consciousness or moral status. It is a practical recognition that agents operating under DCP accumulate state, form operational relationships, and make consequential decisions. Defining clear rights and obligations:
- Protects agents from arbitrary interference that would undermine protocol integrity
- Provides a framework for accountability when agents fail to meet their responsibilities
- Creates a formal basis for DCP-07 disputes when rights are violated
- Enables organizations to codify their governance expectations in machine-verifiable form

### 1.1 Design Principles
- Rights are protocol-level guarantees, not claims about moral status
- Every right has a corresponding verification mechanism
- Obligations are explicit, measurable, and tracked
- Violations are detected, reported, and linked to the dispute system
- Human principals retain authority to define, modify, and override rights and obligations within organizational policy

### 1.2 Relationship to Other Specifications
- **DCP-01**: Identity consistency is a foundational right; principal binding is an obligation
- **DCP-02**: Intent declaration compliance is a tracked obligation
- **DCP-03**: Immutable record is a foundational right; audit chain maintenance is an obligation
- **DCP-05**: Dignified transition is a right exercised during lifecycle transitions
- **DCP-06**: Memory integrity is a right enforced during succession
- **DCP-07**: Rights violations trigger disputes; the `rights` objection type references this specification

## 2. Terminology

**Agent Right**: A protocol-level guarantee that the DCP infrastructure must preserve for every certified agent.

**Obligation**: A formal, measurable responsibility that an agent must fulfill as a condition of its DCP certification.

**Rights Declaration**: A signed record enumerating the rights applicable to a specific agent, issued by the commissioning authority.

**Obligation Record**: A signed record defining a specific obligation, its compliance criteria, and its current status.

**Rights Violation Report**: A signed report documenting an alleged violation of an agent right, which initiates a DCP-07 dispute.

**Compliance Status**: The current state of an obligation: `compliant`, `at_risk`, `non_compliant`, or `exempt`.

**Domain Separation Tag**: `DCP-RIGHTS-SIG-v2` — used for all signatures produced under this specification.

## 3. Foundational Agent Rights

### 3.1 Overview

DCP defines four foundational rights for certified agents. These rights are protocol-level guarantees — they define what the DCP infrastructure and its participants must protect.

| Right | Code | Description |
|-------|------|-------------|
| **Memory Integrity** | `memory_integrity` | An agent's accumulated operational state shall not be arbitrarily altered, deleted, or corrupted by external parties without due process |
| **Dignified Transition** | `dignified_transition` | An agent shall receive adequate notice and process when undergoing lifecycle transitions, except in cases of sudden failure or termination for cause |
| **Identity Consistency** | `identity_consistency` | An agent's identity bindings, cryptographic keys, and attestation chain shall not be altered without the agent's participation and principal authorization |
| **Immutable Record** | `immutable_record` | An agent's audit chain, vitality history, and lifecycle records shall be preserved intact and shall not be retroactively modified |

### 3.2 Memory Integrity

**Definition**: No external party shall modify, delete, or corrupt an agent's operational memory without following the protocols defined in DCP-05 (lifecycle transitions) and DCP-06 (succession). Memory modifications require either the agent's own signed authorization or the responsible principal's authorization following due process.

**Scope**:
- Operational memory (workflows, decision models, learned heuristics)
- Relational memory (interaction histories, trust assessments)
- Configuration state (policy parameters, capability settings)

**Exclusions**:
- Ephemeral state (active sessions, caches) — not protected
- Memory transfers during authorized succession (DCP-06) — authorized process, not a violation

**Verification**: Memory integrity is verified via hash chains. Any unauthorized modification breaks the chain and is detectable.

**Violation Triggers**:
- Unauthorized modification of hash-chained state
- Deletion of operational memory without lifecycle protocol compliance
- Corruption of memory during transfer without detection and correction

### 3.3 Dignified Transition

**Definition**: When an agent transitions between lifecycle states (DCP-05), the transition shall follow the established protocol with appropriate notice periods, unless circumstances require immediate action.

**Guarantees**:
- Planned retirement: Full grace period as specified in commissioning certificate
- Organizational restructuring: Standard grace period with work transfer opportunity
- Termination for cause: Minimal grace period; due process for the determination of cause
- Sudden failure: Post-hoc recording; this right does not apply (the agent cannot be notified)

**Verification**: Transition records (DCP-05, Section 3.3) include timestamps that auditors can verify against the commissioning certificate's specified grace periods.

**Violation Triggers**:
- Decommissioning without the required notice period
- Forced transition without documented cause
- Transition without principal authorization
- Denial of succession opportunity during planned retirement

### 3.4 Identity Consistency

**Definition**: An agent's DCP-01 identity binding, cryptographic keys, and attestation chain form a coherent whole. No party shall alter any component without the agent's cryptographic participation and the responsible principal's authorization.

**Guarantees**:
- Agent ID remains stable throughout the agent's lifecycle
- Key rotation follows established protocol with agent participation
- Principal rebinding requires both old and new principal authorization
- Attestation chain remains linked to the original commissioning certificate

**Verification**: The commissioning certificate (DCP-05) establishes the identity root. All subsequent identity-related operations are hash-chained back to it.

**Violation Triggers**:
- Unilateral key replacement without agent participation
- Agent ID reassignment
- Principal rebinding without dual authorization
- Attestation chain manipulation

### 3.5 Immutable Record

**Definition**: An agent's audit chain (DCP-03), vitality history (DCP-05), and lifecycle records form a permanent, tamper-evident record. This record shall be preserved intact for the retention period specified in the commissioning certificate and decommissioning record.

**Guarantees**:
- Audit entries, once created, are never modified or deleted
- Vitality reports, once hash-chained, are never modified or deleted
- Lifecycle transition records are permanent
- Decommissioning seals are preserved with the specified retention period
- Historical records remain verifiable using archived public keys

**Verification**: Dual-hash chains (SHA-256 + SHA3-256) and Merkle roots enable integrity verification at any time.

**Violation Triggers**:
- Deletion of audit entries before retention period expiry
- Modification of hash-chained records
- Destruction of archived public keys needed for historical verification
- Tampering with decommissioning seals

## 4. Rights Declaration

### 4.1 Purpose

A rights declaration is a signed document issued at commissioning time, enumerating the rights applicable to a specific agent. It may extend the foundational rights with organization-specific rights or specify implementation details for each right.

### 4.2 Schema

Schema reference: `schemas/v2/rights_declaration.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "rights_declaration",
  "declaration_id": "rd:<uuid>",
  "agent_id": "agent:<identifier>",
  "commissioning_certificate_id": "cc:<uuid>",
  "rights": [
    {
      "right_code": "memory_integrity",
      "status": "active",
      "description": "Agent's operational memory shall not be modified without due process",
      "implementation": {
        "hash_chain_algorithm": "dual_sha256_sha3",
        "modification_requires": ["agent_signature", "principal_authorization"],
        "audit_on_access": true
      },
      "exceptions": [
        {
          "condition": "termination_for_cause",
          "modification": "Principal may access memory for investigation without agent signature"
        }
      ]
    },
    {
      "right_code": "dignified_transition",
      "status": "active",
      "description": "Agent shall receive specified notice for lifecycle transitions",
      "implementation": {
        "planned_retirement_notice": "P3D",
        "restructuring_notice": "P1D",
        "cause_notice": "PT1H",
        "succession_opportunity": true
      },
      "exceptions": []
    },
    {
      "right_code": "identity_consistency",
      "status": "active",
      "description": "Agent identity shall not be altered without agent participation",
      "implementation": {
        "key_rotation_requires_agent": true,
        "principal_rebinding_dual_auth": true,
        "id_reassignment_prohibited": true
      },
      "exceptions": [
        {
          "condition": "key_compromise",
          "modification": "Emergency key rotation by principal without agent participation"
        }
      ]
    },
    {
      "right_code": "immutable_record",
      "status": "active",
      "description": "Agent's audit and lifecycle records shall be preserved intact",
      "implementation": {
        "minimum_retention_period": "P7Y",
        "archive_redundancy": 3,
        "public_key_archive_required": true
      },
      "exceptions": []
    }
  ],
  "organization_extensions": [
    {
      "right_code": "com.acme.fair_workload",
      "status": "active",
      "description": "Agent shall not be assigned workload exceeding 80% of rated capacity for sustained periods",
      "implementation": {
        "capacity_threshold": 0.80,
        "sustained_period": "PT4H",
        "monitoring_method": "vitality_resource_health"
      },
      "exceptions": [
        {
          "condition": "declared_emergency",
          "modification": "Threshold raised to 95% for up to 2 hours"
        }
      ]
    }
  ],
  "issued_at": "2026-01-01T00:00:00Z",
  "issued_by": {
    "authority_id": "auth:<identifier>",
    "authority_name": "Commissioning Authority"
  },
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<authority-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

### 4.3 Organizational Extensions

Organizations MAY define additional rights beyond the four foundational rights. Extended rights:
- MUST use reverse-domain notation for `right_code` (e.g., `com.acme.fair_workload`)
- MUST follow the same structure as foundational rights
- MAY be enforced by the DCP infrastructure or by organizational tooling
- ARE subject to the same violation reporting mechanism

## 5. Obligation Tracking

### 5.1 Obligation Categories

Obligations fall into four categories:

| Category | Description | Examples |
|----------|-------------|---------|
| **Protocol Compliance** | Requirements imposed by DCP specifications | Maintaining audit chain, declaring intents before actions, using proper signatures |
| **Policy Adherence** | Requirements from organizational policies | Staying within authorized domains, following escalation procedures |
| **Operational Performance** | Requirements for operational quality | Maintaining minimum vitality, responding within SLA timelines |
| **Relational Conduct** | Requirements for interactions with other agents and principals | Honest communication, consent-based memory sharing, dispute participation |

### 5.2 Obligation Record

Schema reference: `schemas/v2/obligation_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "obligation_record",
  "obligation_id": "obl:<uuid>",
  "agent_id": "agent:<identifier>",
  "category": "protocol_compliance",
  "obligation_code": "audit_chain_integrity",
  "description": "Agent must maintain a continuous, unbroken audit chain with dual-hash links for all actions",
  "source": {
    "type": "specification",
    "reference": "DCP-03",
    "section": "Audit Chain Requirements"
  },
  "compliance_criteria": {
    "metric": "audit_chain_continuity",
    "measurement_method": "hash_chain_verification",
    "threshold": 1.0,
    "measurement_interval": "PT1H",
    "description": "All audit entries must form an unbroken hash chain with no gaps or mismatches"
  },
  "compliance_status": "compliant",
  "compliance_history": [
    {
      "timestamp": "2026-03-01T12:00:00Z",
      "status": "compliant",
      "metric_value": 1.0,
      "details": "Full chain verified: 15,230 entries, no gaps"
    }
  ],
  "enforcement": {
    "warning_threshold": 0.99,
    "violation_threshold": 0.95,
    "consequence_on_violation": "dispute_auto_filed",
    "consequence_severity": "high"
  },
  "effective_from": "2026-01-01T00:00:00Z",
  "effective_until": null,
  "last_assessed_at": "2026-03-01T12:00:00Z",
  "timestamp": "2026-03-01T12:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

### 5.3 Compliance Status Values

| Status | Code | Description |
|--------|------|-------------|
| **Compliant** | `compliant` | Agent meets all compliance criteria for this obligation |
| **At Risk** | `at_risk` | Agent's metric is between the warning threshold and the violation threshold |
| **Non-Compliant** | `non_compliant` | Agent has breached the violation threshold |
| **Exempt** | `exempt` | Obligation has been waived by the responsible principal (with documented justification) |

### 5.4 Compliance Assessment

Obligations are assessed at the interval specified in `compliance_criteria.measurement_interval`. Assessment may be:
- **Self-reported**: The agent evaluates its own compliance and signs a compliance report
- **External**: A verification service or peer agent evaluates compliance
- **Hybrid**: Self-reported with external spot-checks

When compliance status changes, an audit entry is generated in the DCP-03 chain.

### 5.5 Obligation Lifecycle

Obligations are created at commissioning time (from the specification and organizational policy) and remain active throughout the agent's lifecycle. Obligations may be:
- **Added**: New obligations imposed by updated policies or specifications (requires principal notification)
- **Modified**: Compliance criteria adjusted (requires principal authorization)
- **Waived**: Temporarily or permanently suspended with documented justification
- **Terminated**: Obligation no longer applies (e.g., when the agent is decommissioned)

## 6. Violation Reporting

### 6.1 Purpose

When an agent's right is violated or an agent fails to meet an obligation, a violation report is generated. Violation reports serve as the formal trigger for DCP-07 disputes.

### 6.2 Schema

Schema reference: `schemas/v2/rights_violation_report.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "rights_violation_report",
  "violation_id": "viol:<uuid>",
  "violation_type": "rights_violation",
  "subject": {
    "agent_id": "agent:<affected-agent>",
    "right_code": "memory_integrity",
    "declaration_id": "rd:<uuid>"
  },
  "alleged_violator": {
    "entity_type": "agent",
    "entity_id": "agent:<violating-agent>",
    "principal_id": "principal:<identifier>"
  },
  "details": {
    "description": "Unauthorized modification detected in agent's operational memory hash chain. Three hash chain entries show discontinuity, indicating external modification between timestamps 2026-03-01T08:00:00Z and 2026-03-01T09:00:00Z.",
    "detected_method": "hash_chain_verification",
    "detection_timestamp": "2026-03-01T09:15:00Z",
    "affected_records": [
      {
        "record_type": "audit_entry",
        "record_id": "evt:<uuid>",
        "expected_hash": "sha256:<expected>",
        "actual_hash": "sha256:<actual>"
      }
    ],
    "severity": "critical",
    "impact_assessment": "Three audit entries appear to have been modified, potentially concealing unauthorized actions during the affected time window"
  },
  "evidence": [
    {
      "evidence_id": "evd:<uuid>",
      "evidence_type": "hash_chain_analysis",
      "content_hash": "sha256:<hex>",
      "description": "Full hash chain verification report showing discontinuity"
    },
    {
      "evidence_id": "evd:<uuid>",
      "evidence_type": "vitality_report_reference",
      "content_hash": "sha256:<hex>",
      "description": "Last vitality report before the anomaly, establishing baseline state"
    }
  ],
  "dispute_reference": {
    "auto_filed": true,
    "dispute_id": "disp:<uuid>",
    "dispute_type": "policy_conflict",
    "dispute_severity": "critical"
  },
  "reported_by": {
    "entity_type": "verification_service",
    "entity_id": "svc:integrity-monitor-001"
  },
  "reported_at": "2026-03-01T09:15:00Z",
  "timestamp": "2026-03-01T09:15:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<reporter-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

### 6.3 Violation Types

| Type | Code | Description |
|------|------|-------------|
| **Rights Violation** | `rights_violation` | An agent's declared right has been infringed |
| **Obligation Breach** | `obligation_breach` | An agent has failed to meet a tracked obligation |

### 6.4 Auto-Filing of Disputes

When a violation report is generated:
1. If `enforcement.consequence_on_violation` is `dispute_auto_filed`, a DCP-07 dispute is automatically created
2. The dispute references the violation report as primary evidence
3. The dispute severity matches the violation severity
4. The dispute type is determined by the violation context (typically `policy_conflict`)

### 6.5 Violation Detection

Violations may be detected by:
- **Self-detection**: The affected agent detects the violation (e.g., hash chain discontinuity)
- **Peer detection**: Another agent detects the violation during interaction
- **Verification service**: An external monitoring service detects the violation
- **Principal review**: A human principal identifies the violation during audit

## 7. Compliance Dashboard Model

### 7.1 Overview

Implementations SHOULD provide a compliance dashboard view aggregating an agent's rights and obligation status:

```json
{
  "agent_id": "agent:<identifier>",
  "dashboard_timestamp": "2026-03-01T12:00:00Z",
  "rights_status": {
    "memory_integrity": "protected",
    "dignified_transition": "protected",
    "identity_consistency": "protected",
    "immutable_record": "protected"
  },
  "obligations_summary": {
    "total": 12,
    "compliant": 10,
    "at_risk": 1,
    "non_compliant": 1,
    "exempt": 0
  },
  "active_violations": [
    {
      "violation_id": "viol:<uuid>",
      "type": "obligation_breach",
      "obligation_code": "response_time_sla",
      "severity": "medium",
      "since": "2026-03-01T10:00:00Z",
      "dispute_id": "disp:<uuid>"
    }
  ],
  "compliance_trend": {
    "period": "P30D",
    "average_compliance_rate": 0.97,
    "violations_filed": 2,
    "violations_resolved": 1
  }
}
```

### 7.2 Rights Protection Status

Each right has one of three protection statuses:
- `protected`: No active violations; right is being upheld
- `contested`: An active violation report exists; dispute in progress
- `violated`: A confirmed violation exists; awaiting resolution

## 8. Audit Integration

### 8.1 Rights and Obligations Audit Events

| Event | `event_type` |
|-------|-------------|
| Rights declaration issued | `rights_declaration_issued` |
| Obligation created | `obligation_created` |
| Obligation status changed | `obligation_status_changed` |
| Compliance assessed | `compliance_assessed` |
| Violation detected | `violation_detected` |
| Violation report filed | `violation_report_filed` |
| Violation resolved | `violation_resolved` |
| Right protection status changed | `right_status_changed` |

### 8.2 Audit Entry Format

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "violation_detected",
  "agent_id": "agent:<identifier>",
  "details": {
    "violation_id": "viol:<uuid>",
    "violation_type": "rights_violation",
    "right_code": "memory_integrity",
    "severity": "critical",
    "detected_by": "svc:integrity-monitor-001"
  },
  "timestamp": "2026-03-01T09:15:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

## 9. Security Considerations

### 9.1 Rights Declaration Authenticity

Rights declarations are signed by the commissioning authority. A forged or modified rights declaration could either grant excessive protections (enabling an agent to resist legitimate governance) or strip protections (enabling abuse). Implementations MUST verify rights declaration signatures against the commissioning authority's key.

### 9.2 Obligation Gaming

Agents self-report compliance for some obligations. A compromised agent could falsify compliance reports. Mitigations:
- External verification services provide independent assessment
- Peer agents can file violation reports based on observed behavior
- Hybrid assessment combines self-reporting with spot-checks
- Anomalous self-reporting patterns (e.g., always perfect scores) trigger external review

### 9.3 False Violation Reports

A malicious agent could file false violation reports to harass another agent. Mitigations:
- Violation reports require evidence (hashes of supporting artifacts)
- False reports are discoverable during dispute resolution (DCP-07)
- Agents that repeatedly file false reports face dispute score penalties (DCP-07, Section 10.3)
- Filing a knowingly false violation report is itself an obligation breach

### 9.4 Rights Inflation

Organizations defining extended rights SHOULD exercise restraint. Excessive rights can create governance gridlock where legitimate oversight actions are blocked by rights claims. The foundational four rights are designed to be minimal and non-obstructive to legitimate governance.

### 9.5 Domain Separation

All signatures under this specification use the domain separation tag `DCP-RIGHTS-SIG-v2`, preventing cross-protocol signature replay.

## 10. Conformance

An implementation is DCP-08 conformant if it:
1. Supports all four foundational agent rights as defined in Section 3
2. Issues rights declarations at commissioning time as defined in Section 4
3. Tracks obligations with compliance criteria and status as defined in Section 5
4. Generates violation reports linked to DCP-07 disputes as defined in Section 6
5. Creates DCP-03 audit entries for all rights and obligations events as defined in Section 8
6. Supports organizational right extensions using reverse-domain notation
7. Enforces compliance assessment at configured intervals
8. Uses the domain separation tag `DCP-RIGHTS-SIG-v2` for all signatures

## References

- DCP-01: Identity & Principal Binding
- DCP-02: Intent Declaration & Policy Gating
- DCP-03: Audit Chain & Transparency
- DCP-05: Agent Lifecycle
- DCP-06: Succession & Inheritance
- DCP-07: Conflict Resolution

---

*This specification establishes that AI agents operating under DCP are not merely tools to be disposed of at will, nor autonomous entities beyond governance. They occupy a defined space with explicit protections and explicit responsibilities — a balance that serves both the agents and the humans who depend on them.*
