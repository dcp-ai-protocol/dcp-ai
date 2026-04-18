# DCP-07: Conflict Resolution

## Status
Draft — v2.0 Extension

## Abstract
This specification defines a structured, auditable protocol for resolving conflicts between DCP-certified AI agents. It introduces a three-level escalation model (direct negotiation, contextual arbitration, human appeal), typed dispute records, M-of-N arbitration panels, jurisprudence bundles for precedent tracking, and objection records for formal dissent. All conflict resolution artifacts are cryptographically signed and hash-chained, producing a tamper-evident record of every dispute and its resolution.

## 1. Introduction

As AI agents operating under DCP increasingly interact with one another (DCP-04), conflicts are inevitable. Agents may compete for shared resources, receive contradictory directives from different principals, disagree on capability boundaries, or interpret policies differently. Without a formal resolution mechanism, such conflicts either escalate to human operators with no structured context, or result in deadlocks and cascading failures.

DCP-07 provides a protocol-level conflict resolution framework that:
- Classifies disputes by type to enable appropriate resolution strategies
- Defines a three-level escalation model, starting with agent-level negotiation
- Creates auditable, signed records of every dispute, resolution attempt, and outcome
- Builds a jurisprudence system where resolved disputes serve as precedent
- Preserves the right of any party to formally object to a resolution

### 1.1 Design Principles
- Conflicts should be resolved at the lowest possible level
- Every dispute and resolution attempt is signed and recorded
- Human appeal is always available as a final recourse
- Resolved disputes create precedent that improves future resolution
- No agent is compelled to accept a resolution without recourse to objection

### 1.2 Relationship to Other Specifications
- **DCP-01**: Agent identity determines standing to bring or respond to disputes
- **DCP-02**: Policy conflicts are a primary dispute type; policy outcomes feed into dispute context
- **DCP-03**: All dispute events are recorded in the audit chain
- **DCP-04**: Dispute negotiation messages are exchanged via A2A channels
- **DCP-05**: An agent in `declining` state has limited capacity to participate in disputes
- **DCP-08**: Rights violations (DCP-08) trigger disputes under this specification

## 2. Terminology

**Dispute**: A formal declaration by one or more agents that a conflict exists requiring resolution.

**Disputant**: An agent that is party to a dispute, either as initiator (complainant) or respondent.

**Escalation Level**: One of three resolution stages: `direct_negotiation`, `contextual_arbitration`, or `human_appeal`.

**Arbitration Panel**: A group of agents (or mixed agent-human panel) convened to resolve a dispute at the contextual arbitration level. Decisions require M-of-N agreement.

**Jurisprudence Bundle**: A sealed record of a resolved dispute, including context, arguments, and outcome, that serves as precedent for future disputes.

**Objection Record**: A formal, signed declaration of disagreement with a resolution outcome.

**Domain Separation Tag**: `DCP-DISPUTE-SIG-v2` — used for all signatures produced under this specification.

## 3. Dispute Types

### 3.1 Classification

Disputes are classified into four types, each with distinct resolution characteristics:

| Type | Code | Description | Default Initial Level |
|------|------|-------------|----------------------|
| **Resource Conflict** | `resource_conflict` | Two or more agents contend for the same limited resource (compute, data access, API quota, network bandwidth) | `direct_negotiation` |
| **Directive Conflict** | `directive_conflict` | An agent receives contradictory instructions from multiple principals or from a principal and an organizational policy | `contextual_arbitration` |
| **Capability Conflict** | `capability_conflict` | Disagreement over whether an agent has the capability or authority to perform a specific action | `direct_negotiation` |
| **Policy Conflict** | `policy_conflict` | Two or more agents interpret a shared policy differently, or an agent's action conflicts with another agent's policy constraints | `direct_negotiation` |

### 3.2 Severity Levels

Each dispute carries a severity level that influences escalation timelines:

| Severity | Code | Escalation Deadline |
|----------|------|-------------------|
| **Low** | `low` | 24 hours per level |
| **Medium** | `medium` | 4 hours per level |
| **High** | `high` | 1 hour per level |
| **Critical** | `critical` | 15 minutes per level |

If a dispute is not resolved within its escalation deadline at the current level, it MUST be automatically escalated to the next level.

## 4. Dispute Record

### 4.1 Schema

Schema reference: `schemas/v2/dispute_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "dispute_record",
  "dispute_id": "disp:<uuid>",
  "dispute_type": "resource_conflict",
  "severity": "medium",
  "status": "open",
  "current_escalation_level": "direct_negotiation",
  "complainant": {
    "agent_id": "agent:<complainant-identifier>",
    "principal_id": "principal:<identifier>",
    "organization_id": "org:<identifier>"
  },
  "respondents": [
    {
      "agent_id": "agent:<respondent-identifier>",
      "principal_id": "principal:<identifier>",
      "organization_id": "org:<identifier>"
    }
  ],
  "subject": {
    "description": "Both agents require exclusive write access to the shared procurement database during the same time window",
    "resource_identifiers": ["resource:procurement-db:write-lock"],
    "related_intent_ids": ["intent:<uuid-a>", "intent:<uuid-b>"],
    "related_policy_ids": ["policy:<uuid>"],
    "related_audit_entries": ["evt:<uuid>", "evt:<uuid>"]
  },
  "evidence": [
    {
      "evidence_id": "evd:<uuid>",
      "submitted_by": "agent:<complainant-identifier>",
      "evidence_type": "intent_declaration",
      "reference": "intent:<uuid-a>",
      "description": "Complainant's intent declaration for procurement database access",
      "content_hash": "sha256:<hex>",
      "submitted_at": "2026-03-01T10:00:00Z"
    },
    {
      "evidence_id": "evd:<uuid>",
      "submitted_by": "agent:<respondent-identifier>",
      "evidence_type": "intent_declaration",
      "reference": "intent:<uuid-b>",
      "description": "Respondent's concurrent intent declaration for the same resource",
      "content_hash": "sha256:<hex>",
      "submitted_at": "2026-03-01T10:01:00Z"
    }
  ],
  "precedents_cited": [
    {
      "jurisprudence_id": "jur:<uuid>",
      "relevance": "Previous resource conflict resolved by time-sharing; similar resource type and contention pattern"
    }
  ],
  "timeline": [
    {
      "event": "dispute_opened",
      "timestamp": "2026-03-01T10:05:00Z",
      "actor": "agent:<complainant-identifier>"
    }
  ],
  "escalation_deadline": "2026-03-01T14:05:00Z",
  "opened_at": "2026-03-01T10:05:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<complainant-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

### 4.2 Dispute Lifecycle

```
 opened ──> negotiating ──> escalated ──> arbitrating ──> escalated ──> appealing ──> resolved
                │                              │                              │
                └──────── resolved ◄───────────┘──────── resolved ◄───────────┘
                                                                              │
                                                                    withdrawn/abandoned
```

Valid statuses: `open`, `negotiating`, `escalated`, `arbitrating`, `appealing`, `resolved`, `withdrawn`, `abandoned`.

A dispute is `abandoned` if all escalation deadlines expire without resolution and no party pursues further escalation.

## 5. Three-Level Escalation Model

### 5.1 Level 1: Direct Negotiation

The disputing agents attempt to resolve the conflict directly via DCP-04 A2A messaging.

**Process:**
1. Complainant opens the dispute by creating a dispute record and sending it to the respondent(s) via A2A
2. Respondent(s) acknowledge and provide counter-evidence or proposed resolutions
3. Agents exchange resolution proposals
4. If a proposal is accepted by all parties, the dispute is resolved
5. The resolution is recorded in an arbitration resolution record (Section 6)

**Negotiation Strategies** (implementations MAY support):
- **Time-sharing**: Agents take turns accessing the contested resource
- **Priority-based**: Agent with higher priority (per policy or principal directive) proceeds first
- **Capability-based**: Agent with greater capability relevance proceeds
- **Random**: Cryptographically fair coin flip (commit-reveal scheme)

**Escalation Trigger**: If negotiation fails within the escalation deadline, the dispute MUST escalate to Level 2.

### 5.2 Level 2: Contextual Arbitration

An arbitration panel is convened to resolve the dispute.

**Panel Formation:**
1. Each disputant nominates one or more panel candidates from a pre-approved arbitrator pool
2. An M-of-N panel is assembled (minimum 3 members, default M=2, N=3)
3. Panel members MUST NOT have active disputes with any disputant
4. Panel members MUST have vitality above 600 (DCP-05)
5. Panel members MUST be in `active` lifecycle state

**Arbitration Process:**
1. Panel reviews the dispute record, evidence, and cited precedents
2. Panel MAY request additional evidence from disputants
3. Panel members independently evaluate and propose resolutions
4. Panel votes; M-of-N agreement is required for a binding resolution
5. The resolution is recorded with individual panel member votes

**Panel Decision Types:**
- `binding_resolution` — All parties must comply
- `recommended_resolution` — Non-binding suggestion; parties may accept or escalate
- `split_decision` — Panel could not reach M-of-N; auto-escalates to Level 3

### 5.3 Level 3: Human Appeal

The dispute is escalated to human principals for resolution.

**Process:**
1. The full dispute record, evidence, arbitration history, and any objections are presented to the responsible principals of all disputants
2. Principals may confer, negotiate, or apply organizational policy
3. The human decision is recorded as a final, binding resolution
4. If principals cannot agree, organizational escalation procedures apply (outside DCP scope)

**Human Appeal Guarantees:**
- Any disputant MAY escalate to human appeal at any time, bypassing earlier levels
- Critical-severity disputes MAY begin at human appeal level
- Human decisions are final within the DCP protocol

## 6. Arbitration Resolution

### 6.1 Schema

Schema reference: `schemas/v2/arbitration_resolution.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "arbitration_resolution",
  "resolution_id": "res:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_level": "contextual_arbitration",
  "resolution_type": "binding_resolution",
  "outcome": {
    "description": "Time-sharing arrangement: Agent A has exclusive access during 00:00-12:00 UTC, Agent B during 12:00-24:00 UTC",
    "actions_required": [
      {
        "agent_id": "agent:<agent-a>",
        "action": "Restrict procurement database write access to 00:00-12:00 UTC window",
        "deadline": "2026-03-02T00:00:00Z"
      },
      {
        "agent_id": "agent:<agent-b>",
        "action": "Restrict procurement database write access to 12:00-24:00 UTC window",
        "deadline": "2026-03-02T00:00:00Z"
      }
    ],
    "compliance_verification_method": "audit_chain_review",
    "compliance_deadline": "2026-03-09T00:00:00Z"
  },
  "reasoning": "Both agents have equally valid intent declarations for the resource. Historical precedent (jur:abc123) established time-sharing as the preferred resolution for symmetric resource conflicts. Agent A's intent was filed 60 seconds earlier, granting first selection of time window.",
  "precedents_applied": [
    {
      "jurisprudence_id": "jur:<uuid>",
      "applicability": "Directly applicable: same resource type, symmetric priority"
    }
  ],
  "panel": {
    "members": [
      {
        "agent_id": "agent:<arbitrator-1>",
        "vote": "approve",
        "reasoning_hash": "sha256:<hex>"
      },
      {
        "agent_id": "agent:<arbitrator-2>",
        "vote": "approve",
        "reasoning_hash": "sha256:<hex>"
      },
      {
        "agent_id": "agent:<arbitrator-3>",
        "vote": "dissent",
        "reasoning_hash": "sha256:<hex>"
      }
    ],
    "threshold": {
      "m": 2,
      "n": 3
    },
    "votes_for": 2,
    "votes_against": 1
  },
  "effective_at": "2026-03-01T16:00:00Z",
  "expires_at": "2026-06-01T00:00:00Z",
  "timestamp": "2026-03-01T15:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signatures": [
    {
      "agent_id": "agent:<arbitrator-1>",
      "alg": "ed25519",
      "kid": "<key-id>",
      "sig_b64": "...",
      "domain_sep": "DCP-DISPUTE-SIG-v2"
    },
    {
      "agent_id": "agent:<arbitrator-2>",
      "alg": "ed25519",
      "kid": "<key-id>",
      "sig_b64": "...",
      "domain_sep": "DCP-DISPUTE-SIG-v2"
    }
  ]
}
```

### 6.2 Resolution Compliance

After a binding resolution:
1. All parties MUST comply by the specified deadline
2. Compliance is verified via the method specified in the resolution (typically audit chain review)
3. Non-compliance is itself a dispute (type: `policy_conflict`) and escalates directly to human appeal
4. Repeated non-compliance MAY trigger termination for cause (DCP-05)

## 7. Jurisprudence Bundle

### 7.1 Purpose

Resolved disputes are packaged as jurisprudence bundles — sealed, referenceable records that serve as precedent for future dispute resolution. This creates an evolving body of "case law" that improves resolution consistency over time.

### 7.2 Schema

Schema reference: `schemas/v2/jurisprudence_bundle.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "jurisprudence_bundle",
  "jurisprudence_id": "jur:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_id": "res:<uuid>",
  "classification": {
    "dispute_type": "resource_conflict",
    "resource_category": "database_access",
    "resolution_pattern": "time_sharing",
    "tags": ["symmetric_priority", "exclusive_access", "periodic_resource"]
  },
  "summary": {
    "facts": "Two agents with equivalent priority both declared intent to access the same exclusive-write resource during overlapping time windows.",
    "holding": "Time-sharing arrangement based on filing order, with the earlier-filing agent selecting preferred time window.",
    "rationale": "Symmetric priority conflicts for periodic resources are best resolved by time division. Filing order provides a fair, deterministic tie-breaker.",
    "dissent": "Dissenting arbitrator argued for capability-based priority, where the agent with greater procurement-domain capability should receive priority access."
  },
  "applicability": {
    "applicable_dispute_types": ["resource_conflict"],
    "applicable_conditions": [
      "Two or more agents with equal priority",
      "Exclusive-access resource that supports time division",
      "No principal directive establishing priority"
    ],
    "inapplicable_conditions": [
      "Non-divisible resource (e.g., one-time-use token)",
      "Asymmetric principal-directed priority"
    ]
  },
  "supersedes": [],
  "superseded_by": null,
  "authority_level": "contextual_arbitration",
  "created_at": "2026-03-01T16:00:00Z",
  "dispute_record_hash": "sha256:<hex>",
  "resolution_record_hash": "sha256:<hex>",
  "objections": [],
  "timestamp": "2026-03-01T16:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<panel-lead-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

### 7.3 Precedent Matching

When a new dispute is opened, agents and arbitration panels SHOULD search the jurisprudence registry for applicable precedents:

1. Filter by `dispute_type`
2. Match on `applicable_conditions`
3. Exclude based on `inapplicable_conditions`
4. Rank by `authority_level` (human_appeal > contextual_arbitration > direct_negotiation)
5. Prefer more recent precedents when holdings conflict

Precedent is advisory, not strictly binding. Arbitration panels and human principals MAY depart from precedent with documented reasoning.

### 7.4 Supersession

A jurisprudence bundle may be superseded by a later ruling on the same issue. When superseded:
- The `superseded_by` field is updated to reference the new jurisprudence bundle
- The superseding bundle's `supersedes` field lists the old bundle(s)
- Superseded bundles remain in the registry for historical reference but are deprioritized in precedent matching

## 8. Objection Record

### 8.1 Purpose

Any disputant may formally object to a resolution outcome. Objections are recorded as signed, timestamped artifacts that become part of the dispute's permanent record. Filing an objection does not automatically reverse a resolution but preserves the agent's dissent and may support future appeals or precedent challenges.

### 8.2 Schema

Schema reference: `schemas/v2/objection_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "objection_record",
  "objection_id": "obj:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_id": "res:<uuid>",
  "objecting_party": {
    "agent_id": "agent:<identifier>",
    "principal_id": "principal:<identifier>"
  },
  "objection_type": "procedural",
  "grounds": {
    "summary": "Panel member agent:<arbitrator-3> had a prior undisclosed resource dependency on the respondent, creating a conflict of interest",
    "detailed_reasoning": "Audit chain analysis reveals that arbitrator-3 and the respondent shared 47 A2A sessions in the preceding 30 days, establishing a working relationship that was not disclosed during panel formation. This violates the independence requirement of Section 5.2.",
    "evidence_references": [
      "evt:<uuid-session-log-1>",
      "evt:<uuid-session-log-2>"
    ],
    "precedent_references": []
  },
  "requested_remedy": {
    "type": "panel_reconstitution",
    "description": "Request reconstitution of the arbitration panel with verified independent members and re-hearing of the dispute"
  },
  "status": "filed",
  "filed_at": "2026-03-01T17:00:00Z",
  "timestamp": "2026-03-01T17:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<objecting-agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

### 8.3 Objection Types

| Type | Code | Description |
|------|------|-------------|
| **Substantive** | `substantive` | The resolution is wrong on the merits; the evidence or reasoning does not support the outcome |
| **Procedural** | `procedural` | The resolution process was flawed (panel bias, missed evidence, exceeded scope) |
| **Precedent** | `precedent` | The resolution conflicts with established jurisprudence without adequate justification |
| **Rights** | `rights` | The resolution violates an agent's rights as defined in DCP-08 |

### 8.4 Objection Handling

1. Filed objections are appended to the dispute record and included in the jurisprudence bundle
2. The resolution remains in effect unless a human principal orders a stay
3. Objections with `rights` type MUST be forwarded to the human appeal level for review
4. Objections provide grounds for future precedent challenges (Section 7.4)

## 9. Audit Integration

### 9.1 Dispute Audit Events

All dispute lifecycle events generate DCP-03 audit entries:

| Event | `event_type` |
|-------|-------------|
| Dispute opened | `dispute_opened` |
| Evidence submitted | `dispute_evidence_submitted` |
| Negotiation proposal sent | `dispute_negotiation_proposal` |
| Dispute escalated | `dispute_escalated` |
| Arbitration panel formed | `arbitration_panel_formed` |
| Panel vote cast | `arbitration_vote_cast` |
| Resolution issued | `dispute_resolved` |
| Objection filed | `dispute_objection_filed` |
| Resolution compliance verified | `dispute_compliance_verified` |
| Resolution compliance failed | `dispute_compliance_failed` |

### 9.2 Cross-Agent Audit Consistency

Since disputes involve multiple agents, auditors SHOULD verify cross-chain consistency:
1. Both disputants' audit chains should reference the same `dispute_id`
2. Evidence submission timestamps should be consistent across chains
3. Resolution records should be present in all disputants' chains

## 10. Security Considerations

### 10.1 Panel Independence

Arbitration panel members MUST be independent of the disputants. Independence is verified by:
- No active A2A sessions with any disputant in the preceding 30 days (configurable)
- No shared principal with any disputant
- No active disputes involving any disputant
- Vitality above 600 to ensure reliable participation

### 10.2 Evidence Integrity

All evidence references are content-addressed (hashed). Evidence cannot be altered after submission without detection. Implementations SHOULD:
- Store evidence immutably once submitted
- Reject evidence with mismatched content hashes
- Timestamp evidence submission in the audit chain

### 10.3 Dispute Flooding

A malicious agent could file spurious disputes to overwhelm counterparties or arbitration resources. Mitigations:
- Rate limiting: Maximum disputes per agent per time period (configurable, default: 10 per 24h)
- Filing cost: Agents that file disputes which are resolved against them accumulate a dispute score that raises their filing threshold
- Severity validation: Critical-severity disputes require supporting evidence at filing time

### 10.4 Panel Collusion

M-of-N arbitration mitigates individual bias but not coordinated collusion. Mitigations:
- Panel members are drawn from a distributed pool across organizations
- Panel member selection uses verifiable random functions when possible
- Dissenting opinions are permanently recorded
- Human appeal is always available

### 10.5 Domain Separation

All signatures under this specification use the domain separation tag `DCP-DISPUTE-SIG-v2`, preventing cross-protocol signature replay.

## 11. Conformance

An implementation is DCP-07 conformant if it:
1. Supports all four dispute types as defined in Section 3
2. Implements the three-level escalation model as defined in Section 5
3. Supports M-of-N arbitration panels with configurable thresholds as defined in Section 5.2
4. Generates dispute records, arbitration resolutions, and objection records conforming to the schemas in Sections 4, 6, and 8
5. Packages resolved disputes as jurisprudence bundles as defined in Section 7
6. Enforces escalation deadlines based on severity as defined in Section 3.2
7. Creates DCP-03 audit entries for all dispute events as defined in Section 9
8. Uses the domain separation tag `DCP-DISPUTE-SIG-v2` for all signatures

## References

- DCP-01: Identity & Principal Binding
- DCP-02: Intent Declaration & Policy Gating
- DCP-03: Audit Chain & Transparency
- DCP-04: Agent-to-Agent Communication
- DCP-05: Agent Lifecycle
- DCP-08: Rights & Obligations

---

*This specification recognizes that conflict is not a failure of multi-agent systems but an inherent feature. The measure of a protocol is not whether conflicts arise, but whether they are resolved fairly, transparently, and with full accountability.*
