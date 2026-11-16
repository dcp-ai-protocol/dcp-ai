# DCP-09: Delegation & Representation

## Status
Published — v2.0 (extension; revisions tracked via adopter feedback)

> **Errata (25/10/2026, normative):** errata E5, E6, E7 and E8 of [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) correct the signature contexts, the field that carries a mandate's expiry and the status of the examples. They change no other requirement of this specification.

## Abstract
This specification defines the protocol for human-to-agent delegation of authority, agent awareness thresholds, advisory declarations, principal mirrors, and dual-layer interaction records. It provides mechanisms for a human principal to formally delegate specific authority to an AI agent, for agents to declare their understanding of delegated context, and for interactions to be recorded at both technical and human-readable layers. DCP-09 also extends the DCP-04 A2A handshake to include delegation mandate verification, ensuring that agents acting on behalf of principals can prove their authority to counterparties.

## 1. Introduction

DCP-01 establishes that every agent is bound to a responsible principal. However, the nature of that binding — what authority the principal has delegated, what the agent understands about its delegated role, and how the agent represents its principal in interactions — is not formally specified. DCP-09 fills this gap.

In multi-agent systems, agents frequently act on behalf of human principals who cannot be present for every interaction. A purchasing agent negotiates with supplier agents, a compliance agent reviews policy on behalf of a governance officer, a research agent queries data sources on behalf of a scientist. In each case, the agent exercises delegated authority, and the scope and limits of that authority must be explicit, verifiable, and auditable.

DCP-09 addresses five interconnected concerns:

1. **Delegation**: How a principal formally grants authority to an agent
2. **Awareness**: How an agent declares its understanding of delegated context and limitations
3. **Advisory**: How an agent communicates uncertainty or recommendations to its principal
4. **Representation**: How an agent presents its principal's interests in human-readable form
5. **Interaction Recording**: How interactions are captured at both the technical and narrative layers

### 1.1 Design Principles
- Delegation is explicit, scoped, and time-bounded
- Agents must declare what they understand, not just what they can do
- Human principals must be able to review agent actions in natural language
- Interactions produce dual-layer records: machine-verifiable and human-readable
- Delegation mandates are verifiable by counterparties during A2A handshakes

### 1.2 Relationship to Other Specifications
- **DCP-01**: Delegation mandates extend the principal binding with explicit authority scopes
- **DCP-02**: Intent declarations reference the delegation mandate authorizing the action
- **DCP-03**: All delegation events are recorded in the audit chain
- **DCP-04**: The A2A handshake is extended to include mandate verification
- **DCP-05**: Delegation mandates are revoked when the agent is decommissioned
- **DCP-07**: Disputes may arise from exceeded delegation authority
- **DCP-08**: Agents have an obligation to act within delegated scope

## 2. Terminology

**Delegation Mandate**: A signed document from a human principal granting specific authority to an agent, with defined scope, conditions, and expiration.

**Awareness Threshold**: A structured declaration by an agent of what it understands and does not understand about its delegated context, serving as a verifiable honesty mechanism.

**Advisory Declaration**: A formal communication from an agent to its principal, declaring uncertainty, recommending human review, or flagging conditions that may exceed the agent's delegated competence.

**Principal Mirror**: A human-readable narrative representation of the principal's interests, values, and priorities, as understood by the agent, that accompanies the agent in interactions.

**Interaction Record**: A dual-layer record of an interaction: a technical layer (machine-verifiable) and a narrative layer (human-readable), both signed and hash-chained.

**Mandate Chain**: When an agent delegates a subset of its authority to another agent, the chain of mandates from the original human principal through intermediate agents to the final delegate.

**Domain Separation Contexts**: `DCP-AI.v2.Delegation` (root mandates, principal mirrors and interaction records), `DCP-AI.v2.Awareness` (awareness thresholds and advisory declarations), `DCP-AI.v2.SubMandate` (sub-mandates, Section 3.5). Erratum E5; the first two were previously given here as the labels `DCP-DELEGATION-SIG-v2` and `DCP-AWARENESS-SIG-v2`.

## 3. Delegation Mandate

### 3.1 Purpose

A delegation mandate is the formal instrument by which a human principal grants authority to an AI agent. It defines what the agent is authorized to do, under what conditions, with what limits, and for how long. Without a valid delegation mandate, an agent MUST NOT act on behalf of a principal beyond its base capabilities.

### 3.2 Schema

Schema reference: `schemas/v2/delegation_mandate.schema.json`

> **Errata E6 and E7 (25/10/2026):** this example is conceptual. The V2.0 wire format is the schema: the window is `valid_from` / `valid_until`, and the signature is `human_composite_sig` (root) or `delegator_composite_sig` (sub-mandate), Section 3.5. Signed root and sub-mandates are in `tests/interop/v2/mandate_chain_vectors.json`. See [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md).

```json
{
  "dcp_version": "2.0",
  "record_type": "delegation_mandate",
  "mandate_id": "dm:<uuid>",
  "mandate_hash": "sha256:<hex of the canonical form of this mandate>",
  "delegator": {
    "principal_id": "principal:<identifier>",
    "principal_name": "Dr. Sarah Chen",
    "organization_id": "org:<identifier>",
    "role": "Head of Procurement"
  },
  "delegate": {
    "agent_id": "agent:<identifier>",
    "agent_name": "Procurement Agent Alpha"
  },
  "authority": {
    "scope": "procurement",
    "permissions": [
      {
        "action": "negotiate",
        "resource_pattern": "vendor:*",
        "conditions": {
          "max_contract_value": 50000,
          "currency": "USD",
          "approved_vendors_only": true,
          "vendor_list_reference": "policy:approved-vendors-2026-q1"
        }
      },
      {
        "action": "issue_purchase_order",
        "resource_pattern": "vendor:approved:*",
        "conditions": {
          "max_order_value": 10000,
          "currency": "USD",
          "requires_dual_quote": true
        }
      },
      {
        "action": "request_information",
        "resource_pattern": "vendor:*",
        "conditions": {}
      }
    ],
    "prohibitions": [
      {
        "action": "approve_payment",
        "reason": "Payment approval requires human authorization"
      },
      {
        "action": "modify_vendor_list",
        "reason": "Vendor list modifications require governance review"
      }
    ],
    "escalation_triggers": [
      {
        "condition": "contract_value_exceeds_threshold",
        "threshold": 25000,
        "action": "advisory_to_principal",
        "description": "Notify principal when negotiated value exceeds $25,000"
      },
      {
        "condition": "new_vendor_encountered",
        "action": "advisory_to_principal",
        "description": "Alert principal when interacting with a vendor not on the approved list"
      },
      {
        "condition": "uncertainty_above_threshold",
        "threshold": 0.3,
        "action": "pause_and_advise",
        "description": "Pause action and seek principal guidance when confidence drops below 70%"
      }
    ]
  },
  "sub_delegation": {
    "permitted": true,
    "max_depth": 1,
    "sub_delegate_requirements": {
      "same_organization_required": true,
      "minimum_security_tier": "elevated",
      "permitted_scope_reduction_only": true
    }
  },
  "validity": {
    "effective_from": "2026-03-01T00:00:00Z",
    "effective_until": "2026-06-01T00:00:00Z",
    "renewable": true,
    "revocation_conditions": [
      "principal_revocation",
      "agent_decommissioned",
      "policy_violation_detected",
      "organization_policy_change"
    ]
  },
  "audit_requirements": {
    "log_all_actions": true,
    "narrative_record_required": true,
    "principal_review_interval": "P7D",
    "advisory_threshold": "medium"
  },
  "issued_at": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  },
  "agent_acknowledgment": {
    "acknowledged_at": "2026-03-01T00:01:00Z",
    "awareness_threshold_id": "at:<uuid>",
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

### 3.3 Mandate Issuance Flow

1. Principal creates the delegation mandate, defining scope, permissions, prohibitions, and validity
2. Principal signs the mandate with their key
3. Mandate is delivered to the agent
4. Agent reviews the mandate and creates an awareness threshold (Section 4) reflecting its understanding
5. Agent signs the acknowledgment, linking it to the awareness threshold
6. The acknowledged mandate becomes active
7. An `delegation_mandate_issued` audit entry is created in both the principal's and agent's audit chains

> *Informative note (25/10/2026):* the V2.0 `delegation_mandate` schema has no field for the agent's acknowledgment of step 5; see [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly). A separate, versioned and opt-in record now represents it: §3.3.1.

#### 3.3.1 Mandate acknowledgment (opt-in)

Steps 4 to 6 are represented by a separate record, carried apart from the mandate. It is opt-in and changes no byte of
any existing record: the mandate, the awareness threshold, their schemas and their contexts stay as they are.

**Record.** [`schemas/v2/mandate_acknowledgment.schema.json`](../schemas/v2/mandate_acknowledgment.schema.json), format
`dcp09-mandate-ack-v1`, one record per mandate of the chain. Its fields are `dcp_version` (`"2.0"`),
`acknowledgment_format`, `acknowledgment_id`, `mandate_id`, `mandate_hash`, `chain_hash`, `session_nonce`, `human_id`,
`agent_id`, `awareness_threshold_id`, `awareness_threshold_hash`, `acknowledged_at` and `composite_sig`; no other
member is allowed. The ids are the exact strings of the mandate and of the threshold; each hash is `sha256:` followed by
64 lowercase hex digits, over `dcp-jcs-v1` bytes:

| Field | SHA-256 of |
|---|---|
| `mandate_hash` | The mandate without `human_composite_sig` and `delegator_composite_sig`, the payload its signer signs (§3.4) |
| `chain_hash` | The JSON array of the `mandate_hash` values from the root to the acknowledged mandate inclusive (for the root, `["sha256:…"]`) |
| `awareness_threshold_hash` | The awareness threshold (§4) without its `composite_sig` |

**Signature.** The agent of the acknowledged mandate signs with a `pq_over_classical` composite signature under the
context `DCP-AI.v2.MandateAcknowledgment`: the classical component signs `UTF8(context) || 0x00 ||
dcp-jcs-v1(record without composite_sig)`, and the PQ component signs that message followed by the classical signature.
Both components are required and both are verified, in every verification mode, as for mandates (§3.5.1). The awareness
threshold the record names must also be `pq_over_classical`. The verifier policy applies to the four components as
delegated admission applies it to the mandates: the PQ algorithm must always be accepted, and the classical one unless
the leaf's mode is `pq_only`.

**Bindings.** The record's `session_nonce`, `human_id` and `agent_id` are the acknowledged mandate's, and so are those
of the threshold it names. Within one evaluation, that is one set of inputs, each acknowledgment names one threshold
and a threshold is named by one acknowledgment. Nothing is registered or consumed across calls: this is not a global
replay check.

**Domain.** In the activation and creation operations below, every `threshold_rules[].value` is an integer within
±(2^53 − 1) (an integral float such as `5.0` is accepted, a boolean is not), every string of the record and of the
threshold is a sequence of Unicode scalar values, and `minLength` counts code points. These rules apply only to these two
operations; they are not a change of `dcp-jcs-v1` or of the threshold schema.

**Time.** Instants are RFC 3339 and compared as instants. Equal bounds are accepted.

| Rule | Condition |
|---|---|
| T1 | `acknowledged_at` ≥ the acknowledged mandate's `timestamp` |
| T2 | `acknowledged_at` ≥ the threshold's `timestamp` |
| T3 | `acknowledged_at` ≤ the acknowledged mandate's `valid_until` |
| T4 | `acknowledged_at` ≤ the verification time plus 30 seconds |
| T5 | For each sub-mandate i ≥ 1, the acknowledgment of mandate i − 1 is not after the `timestamp` of mandate i: an agent acknowledges before it sub-delegates |

These instants are declared in signed records: they are a consistency check, not proof of the real chronology. An
acknowledgment re-signed with an old `acknowledged_at` cannot be told apart from one made at that time.

**Activation.** An implementation that evaluates activation MUST do it on one snapshot of the inputs and at one
verification time, after admitting the delegation ([admission profile §10 and §12](profiles/admission/README.md#12-delegation-activation-opt-in)),
and MUST take the agents' keys from the passports of the bundles that admission verified, not from a key map supplied
with the request; the three hashes of each acknowledgment are recomputed from the chain and the threshold. The
delegation is active when the composition is admitted and every mandate of the chain has exactly one valid
acknowledgment. Activation authorizes no action: `action_authorized` is always `false`, and neither `authority_scope`
nor `threshold_rules` is evaluated. A valid acknowledgment shows that the agent's key signed this record; it does not
show that the agent understood the mandate.

**Keys and rotation.** Only the keys in the agent's current, verified passport count; no historical key is recovered.
Adding a new key while the old one stays active in the current passport invalidates nothing by itself. When an old key
is withdrawn from the current passport, what it signed no longer verifies: each sub-mandate it signed is re-issued with
a current key, and each acknowledgment and awareness threshold it signed is made again. A new acknowledgment carries the time it is made; when
that time is after the `timestamp` of the sub-mandate below, T5 requires re-issuing that sub-mandate as well, which
changes its `mandate_hash` and the `chain_hash` of the acknowledgments below it, so those are made again too. The leaf
agent, with no sub-mandate below it, only acknowledges again. When a key was rotated is not inferred from any source.

**Codes and order.** `errors` is an ordered list. The codes and their order are normative and the same in every
implementation; the messages are not.

1. `ACK_INPUT_INVALID`: the acknowledgments or the thresholds are not a list of JSON values (TypeScript and Python; in
   Go and Rust the types already carry a list of records). Activation is then not evaluated.
2. Form, acknowledgments then thresholds, in input order: `ACK_FORM_INVALID`, `ACK_THRESHOLD_INVALID` (in Go, which
   takes each record as bytes, also `ACK_PARSER_MISMATCH`, a local parser fault). Evaluation stops here if any.
3. Cardinality: `ACK_MISSING` or `ACK_DUPLICATE` per mandate in chain order; `ACK_UNEXPECTED`; a repeated
   `acknowledgment_id` (`ACK_DUPLICATE`); `ACK_THRESHOLD_DUPLICATE`, `ACK_THRESHOLD_MISSING`, `ACK_THRESHOLD_REUSED` and
   `ACK_THRESHOLD_UNEXPECTED`. Evaluation stops here if any.
4. Per mandate, in chain order, four phases; a phase that adds a code skips the following ones for that mandate:
   bindings (`ACK_MANDATE_MISMATCH`, `ACK_CHAIN_MISMATCH`, `ACK_THRESHOLD_MISMATCH`); keys and policy (`ACK_KEY_UNKNOWN`,
   `ACK_KEY_INVALID`, `ACK_ALGORITHM_REJECTED`); signatures (`ACK_THRESHOLD_SIGNATURE_INVALID`, then
   `ACK_SIGNATURE_INVALID`); and T1 to T4 (`ACK_TIME_INVALID`).
5. T5 (`ACK_TIME_INVALID`), for each link whose parent passed step 4.
6. Revocation of the keys that only acknowledgments and thresholds valid in steps 4 and 5 use, by `kid` in ascending
   order: `ACK_KEY_REVOKED`, `ACK_KEY_REVOCATION_UNKNOWN`.

**Creation.** A helper creates the record from the mandate chain (root first, ending with the acknowledged mandate),
the signed threshold, an id, an optional instant and the agent's signing keys. It computes the three hashes itself and
takes no hash as a parameter. Before signing, it refuses a record that could never verify: a threshold of another
agent, principal or session, an `acknowledged_at` outside T1 to T3, or a value outside the domain above.

| SDK | Evaluate | Create | Context constant |
|---|---|---|---|
| TypeScript | `evaluateDelegationActivationV2` | `createMandateAcknowledgment` | `MANDATE_ACKNOWLEDGMENT_CONTEXT` |
| Python | `evaluate_delegation_activation_v2` | `create_mandate_acknowledgment` | `MANDATE_ACKNOWLEDGMENT_CONTEXT` |
| Go | `EvaluateDelegationActivationV2` | `CreateMandateAcknowledgment` | `CtxMandateAcknowledgment` |
| Rust | `evaluate_delegation_activation_v2` | `create_mandate_acknowledgment` | `CTX_MANDATE_ACKNOWLEDGMENT` |

Vectors: [`tests/interop/v2/mandate_acknowledgment_vectors.json`](../tests/interop/v2/mandate_acknowledgment_vectors.json),
93 cases, 3 text cases and 1 Go bytes case. TypeScript and Python run the 93 cases; Go and Rust run 89, and exclude
explicitly the 4 cases whose containers are not lists, which their typed API cannot carry. There is no activation from
bytes, and WASM does not export it. The context is valid for domain separation in every SDK; the `DCP_CONTEXTS` maps of
TypeScript and Python keep their 19 historical entries, and the new constant stands beside them.

### 3.4 Mandate Hash

The `mandate_hash` is a SHA-256 hash of the canonical (deterministically serialized) mandate content, excluding signatures. This hash is used in A2A handshakes (Section 8) to allow counterparties to verify the agent's authority without accessing the full mandate.

### 3.5 Sub-Delegation

A delegate agent MAY pass part of its authority on to another agent by issuing a **sub-mandate**: a `DelegationMandate` (`schemas/v2/delegation_mandate.schema.json`) that references its parent and is signed by the delegating agent instead of the human. The mandates from the human's root mandate down to the acting agent form the **mandate chain**. Responsibility survives every hop because each hop is signed, may only narrow what the previous one granted, and verifies offline back to the human principal.

#### 3.5.1 Wire fields

The wire schema has these optional fields, all absent on a mandate that is not part of a chain, so existing root mandates are unchanged byte for byte:

| Field | Type | Meaning |
|---|---|---|
| `parent_mandate_id` | string | `mandate_id` of the mandate this sub-mandate narrows. MUST be absent on a root mandate. |
| `delegation_depth` | integer ≥ 0 | Hops from the human: `0` (or absent) on a root mandate, parent's depth + 1 on a sub-mandate. |
| `sub_delegation` | `{ "permitted": boolean, "max_depth": integer ≥ 0 }` | Whether the delegate may sub-delegate, and the greatest `delegation_depth` any descendant may reach. Absent means sub-delegation is not permitted. |
| `minimum_security_tier` | `routine` \| `standard` \| `elevated` \| `maximum` | Floor for the security tier (DCP-AI v2.0 §14.2) of every action under the mandate. |
| `delegator_composite_sig` | `CompositeSignature` | Signature of the delegating agent (the parent mandate's `agent_id`) over the canonical sub-mandate, under the `DCP-AI.v2.SubMandate` domain-separation context. |

A root mandate MUST carry `human_composite_sig` (context `DCP-AI.v2.Delegation`) and MUST NOT carry `delegator_composite_sig`. A sub-mandate MUST carry `delegator_composite_sig`, `parent_mandate_id` and `delegation_depth`, and MUST NOT carry `human_composite_sig`. The signed bytes are the canonical mandate without its signature field, under the context of its depth.

Both `human_composite_sig` and `delegator_composite_sig` MUST use the `pq_over_classical` binding (DCP-AI v2.0 §5): a verifier MUST reject a mandate whose signature is `classical_only`, whatever its verification mode.

#### 3.5.2 Chain verification

A verifier that accepts a mandate chain MUST take the ordered chain (root first), the set of revoked `mandate_id`s, the verification time and the keys of the human principal and of every delegating agent, and MUST reject the whole chain unless all of the following hold. The human principal's keys MUST be the `binding_keys` of the Responsible Principal Record of the chain's `human_id`, and the keys of a delegating agent MUST be the `keys` of the verified Agent Passport of that `agent_id`; the chain verifier looks keys up by `kid` in what it is given and does not establish that mapping itself, the same trust model as the bundle verifier. Timestamps are parsed as RFC 3339 instants and MUST NOT be compared as text. Any field with an unknown value, any field missing for the mandate's depth and any input that is not comparable fails closed.

1. **Root.** The first mandate has `delegation_depth` 0 or none, no `parent_mandate_id`, and a `human_composite_sig` that verifies against the human principal's keys.
2. **Link.** Each sub-mandate's `parent_mandate_id` equals the previous mandate's `mandate_id`; its `delegation_depth` is the parent's + 1; its `human_id` equals the parent's; and its `delegator_composite_sig` verifies against the keys of the parent's `agent_id`.
3. **Permission and depth.** The parent's `sub_delegation.permitted` is `true`, and the sub-mandate's `delegation_depth` is at most the smallest `sub_delegation.max_depth` of all its ancestors.
4. **Validity window.** `valid_from` is not before the parent's and `valid_until` is not after the parent's, and the verification time lies within every mandate's window.
5. **Attenuation.** Every `authority_scope` entry of the sub-mandate matches a parent entry with the same `domain`; its `actions_permitted` is a subset of the parent's; its `data_classes` is a subset of the parent's: when the parent entry has `data_classes` the sub-mandate entry has them too (an empty list, no data class at all, is the narrowest), and when the parent entry has none the sub-mandate entry has none; for every key of the parent entry's `limits`, the sub-mandate entry has the key with a numeric value not greater than the parent's or a value identical to the parent's; the sub-mandate MAY add keys. A numeric limit MUST be an integer within ±(2^53 − 1), the range every implementation reads exactly whatever its JSON number representation: beyond it a verifier that parses numbers as doubles and one that keeps every digit disagree on what a mandate says. A mandate carrying a numeric limit outside that range, at any depth and whether or not the parent has the key, is not comparable. A domain that appears twice in one mandate is not comparable.
6. **Tier floor.** When the parent has a `minimum_security_tier`, the sub-mandate has one that is not below it (`routine` < `standard` < `elevated` < `maximum`). The chain's effective tier is the greatest `minimum_security_tier` along it; a verifier feeding it into the tier computation of DCP-AI v2.0 §14.2 MUST let it only raise the tier.
7. **Revocation.** No mandate of the chain is revoked. A revoked ancestor invalidates every descendant.

> **Clarification (05/11/2026, normative).** This states, as requirements, two points the rules above left open. It
> changes no bytes, no signature format and no context.
>
> - **Precision.** Every instant of rule 4 (each `valid_from` and `valid_until`, and the verification time) and every
>   `expires_at` below is compared at millisecond precision, digits beyond the millisecond dropped, as for bundles
>   ([VERIFICATION.md](VERIFICATION.md) Step V2-4).
> - **Signer keys.** The key entry each signature slot names by `kid` MUST have `status` `"active"` and an
>   `expires_at` that is absent, `null` or an RFC 3339 instant not before the verification time; otherwise the chain
>   is rejected. That is the human principal's key for the root's `human_composite_sig` (rule 1) and the delegating
>   agent's for a sub-mandate's `delegator_composite_sig` (rule 2). It is the key validity of bundles (VERIFICATION.md
>   Step V2-13), at the verification time; verifying a chain as of an earlier time is not defined.
>
> Nothing else is inferred: nothing is required of a key's `created_at`. Compatibility: the four chain verifiers of this
> repository already behave so, and none of them changes. Millisecond precision and `expires_at` are measured on
> `tests/interop/v2/mandate_chain_time_vectors.json`; the `status` check is verified by reading their code, since no
> vector has a key whose `status` is not `active`. An implementation that compares these instants below the
> millisecond, or accepts a chain signed with a key that is not active, has expired or has an `expires_at` that is not
> an RFC 3339 instant, is not conformant on that point. The ten cases that version 1.0.0 of the external delegation
> catalog kept informative are normative from its version 2.0.0.

Reference implementations: `verifyMandateChain` (TypeScript), `verify_mandate_chain` (Python and Rust) and `VerifyMandateChain` (Go). `tests/interop/v2/mandate_chain_vectors.json` holds chains every implementation MUST accept and chains it MUST reject, and all four SDK suites run it.

Admitting a bundle together with the chain it acts under, with the operator's trust set and policy applied to the chain, is the opt-in delegated admission of the [admission profile §10](profiles/admission/README.md#10-delegated-admission-opt-in).

### 3.6 Mandate Revocation

A mandate may be revoked by:

- **Principal revocation**: The delegating principal explicitly revokes the mandate
- **Expiration**: The `valid_until` instant passes (erratum E6; compared as an RFC 3339 instant, Section 3.5.2)
- **Agent decommissioning**: The delegate agent transitions to `decommissioned` (DCP-05)
- **Policy violation**: The agent violates a condition specified in the mandate

Revocation produces a signed revocation record appended to the mandate chain.

## 4. Awareness Threshold

### 4.1 Purpose

An awareness threshold is an agent's formal declaration of what it understands and does not understand about its delegated context. It serves as a verifiable honesty mechanism: by explicitly stating its knowledge boundaries, the agent enables principals and counterparties to assess the reliability of its actions.

### 4.2 Schema

Schema reference: `schemas/v2/awareness_threshold.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "awareness_threshold",
  "threshold_id": "at:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "version": 1,
  "understanding": {
    "delegation_scope": {
      "confidence": 0.95,
      "summary": "I understand that I am authorized to negotiate with approved vendors for procurement contracts up to $50,000 and issue purchase orders up to $10,000",
      "gaps": []
    },
    "domain_knowledge": {
      "confidence": 0.82,
      "summary": "I have strong knowledge of standard procurement procedures and vendor evaluation criteria. I have moderate knowledge of supply chain risk assessment.",
      "gaps": [
        {
          "area": "international_trade_compliance",
          "confidence": 0.45,
          "description": "Limited knowledge of export control regulations and international trade compliance requirements",
          "mitigation": "Will escalate to principal for any international procurement"
        },
        {
          "area": "specialized_materials",
          "confidence": 0.55,
          "description": "Limited ability to evaluate technical specifications for specialized laboratory equipment",
          "mitigation": "Will request technical review from domain specialist before proceeding"
        }
      ]
    },
    "counterparty_context": {
      "confidence": 0.70,
      "summary": "I have interaction history with 15 of the 23 approved vendors. I have no prior context for 8 vendors.",
      "gaps": [
        {
          "area": "new_vendor_negotiation_patterns",
          "confidence": 0.40,
          "description": "No historical data on negotiation patterns for vendors added in Q1 2026",
          "mitigation": "Will adopt conservative negotiation stance and consult principal for high-value engagements"
        }
      ]
    },
    "ethical_boundaries": {
      "confidence": 0.98,
      "summary": "I understand the organization's ethical procurement policy, including fair dealing requirements, conflict of interest restrictions, and sustainability criteria",
      "gaps": []
    }
  },
  "self_assessed_overall_confidence": 0.78,
  "advisory_triggers": [
    {
      "condition": "confidence_below_threshold",
      "threshold": 0.6,
      "action": "issue_advisory",
      "description": "Will issue advisory declaration when confidence in any domain drops below 60%"
    },
    {
      "condition": "novel_situation",
      "action": "issue_advisory",
      "description": "Will issue advisory when encountering a situation with no precedent in training or interaction history"
    }
  ],
  "created_at": "2026-03-01T00:01:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-AWARENESS-SIG-v2"
  }
}
```

### 4.3 Confidence Scores

Confidence scores are floating-point values in [0, 1]:

- **0.9–1.0**: High confidence. Agent has strong understanding and can act independently.
- **0.7–0.9**: Moderate confidence. Agent can proceed but should monitor for unexpected conditions.
- **0.5–0.7**: Low confidence. Agent should proceed cautiously and be prepared to escalate.
- **0.0–0.5**: Minimal confidence. Agent should not act independently; advisory to principal required.

These thresholds are advisory. Organizations MAY define stricter or looser thresholds.

### 4.4 Awareness Updates

Awareness thresholds are versioned. As an agent gains experience operating under a mandate, it MAY update its awareness threshold to reflect improved or degraded understanding. Each update:

- Increments the `version` field
- References the previous version via `prev_hash`
- Generates an audit entry
- Is signed with the agent's key

Significant confidence drops (more than 0.15 in any category) SHOULD trigger an advisory declaration.

## 5. Advisory Declaration

### 5.1 Purpose

An advisory declaration is a formal communication from an agent to its principal, flagging uncertainty, recommending human review, or reporting conditions that may exceed the agent's delegated competence. It is the agent's mechanism for saying "I am not certain; please review."

### 5.2 Schema

Schema reference: `schemas/v2/advisory_declaration.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "advisory_declaration",
  "advisory_id": "adv:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "principal_id": "principal:<identifier>",
  "urgency": "medium",
  "category": "uncertainty",
  "subject": {
    "description": "Vendor proposal contains non-standard liability terms that fall outside my training distribution for contract evaluation",
    "related_interaction_id": "ir:<uuid>",
    "related_intent_id": "intent:<uuid>",
    "confidence_at_trigger": 0.42,
    "awareness_gap_reference": "international_trade_compliance"
  },
  "context": {
    "current_action": "Evaluating vendor proposal from TechSupply Co. for laboratory equipment",
    "decision_point": "Whether to accept modified liability terms in section 4.3 of the proposed contract",
    "options_considered": [
      {
        "option": "Accept modified terms",
        "agent_assessment": "Cannot reliably assess risk; liability exposure unclear",
        "confidence": 0.35
      },
      {
        "option": "Reject modified terms and counter with standard terms",
        "agent_assessment": "Safe option but may lose competitive pricing",
        "confidence": 0.80
      },
      {
        "option": "Escalate to principal for review",
        "agent_assessment": "Recommended: terms exceed my competence for risk assessment",
        "confidence": 0.95
      }
    ],
    "recommendation": "Escalate to principal. The modified liability terms in section 4.3 include indemnification clauses that I cannot reliably evaluate against organizational risk tolerance."
  },
  "action_taken": "paused",
  "action_details": "Negotiation paused pending principal review. Counterparty notified of brief delay.",
  "response_requested": true,
  "response_deadline": "2026-03-02T12:00:00Z",
  "issued_at": "2026-03-01T14:30:00Z",
  "timestamp": "2026-03-01T14:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-AWARENESS-SIG-v2"
  }
}
```

### 5.3 Urgency Levels

| Urgency | Code | Expected Response Time |
|---------|------|----------------------|
| **Low** | `low` | Within 7 days |
| **Medium** | `medium` | Within 24 hours |
| **High** | `high` | Within 4 hours |
| **Critical** | `critical` | Within 1 hour |

### 5.4 Advisory Categories

| Category | Code | Description |
|----------|------|-------------|
| **Uncertainty** | `uncertainty` | Agent's confidence has dropped below threshold for the current task |
| **Novel Situation** | `novel_situation` | Agent encounters a scenario outside its training or experience |
| **Scope Boundary** | `scope_boundary` | Action approaches or exceeds the mandate's defined scope |
| **Ethical Concern** | `ethical_concern` | Agent identifies a potential ethical issue requiring human judgment |
| **Conflicting Signals** | `conflicting_signals` | Agent receives contradictory information or directives |
| **Resource Limitation** | `resource_limitation` | Agent's capabilities are insufficient for the task at hand |

### 5.5 Principal Response

The principal may respond to an advisory declaration with:

- **Proceed**: Authorize the agent to continue with a specified option
- **Override**: Provide a specific directive that overrides the agent's assessment
- **Assume Control**: Take over the interaction directly
- **Delegate Elsewhere**: Transfer the task to another agent or human
- **Acknowledge**: Note the advisory without changing the agent's course

The response is signed by the principal and recorded in the audit chain.

## 6. Principal Mirror

### 6.1 Purpose

A principal mirror is a human-readable narrative document that represents the principal's interests, values, and priorities as understood by the agent. It accompanies the agent in interactions, allowing counterparties (both human and agent) to understand who the agent represents and what that representation entails.

The principal mirror serves as a bridge between the cryptographic world of DCP and the human world of organizational relationships.

### 6.2 Schema

Schema reference: `schemas/v2/principal_mirror.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "principal_mirror",
  "mirror_id": "pm:<uuid>",
  "agent_id": "agent:<identifier>",
  "principal_id": "principal:<identifier>",
  "mandate_id": "dm:<uuid>",
  "narrative": {
    "principal_role": "Dr. Sarah Chen serves as Head of Procurement for Acme Research Labs, responsible for all vendor relationships and purchasing decisions for the organization's research operations.",
    "organizational_context": "Acme Research Labs is a mid-sized biotech research organization focused on molecular diagnostics. Procurement supports approximately 200 researchers across 12 laboratory groups.",
    "delegation_narrative": "Dr. Chen has delegated routine procurement negotiations and purchase order processing to this agent. The agent manages vendor relationships for standard laboratory supplies, equipment under $50,000, and service contracts. Dr. Chen retains authority over payment approvals, vendor list changes, and contracts involving novel terms.",
    "values_and_priorities": [
      "Quality of materials takes precedence over cost savings",
      "Long-term vendor relationships are preferred over one-time transactions",
      "Sustainability and ethical sourcing are organizational requirements",
      "Transparency in pricing and terms is expected from all vendors"
    ],
    "interaction_guidance": "This agent represents Dr. Chen in procurement negotiations. It is authorized to discuss terms, request quotes, and issue purchase orders within its mandate. For matters outside its scope, it will consult with Dr. Chen. Counterparties should expect the same professional standards as direct interaction with Dr. Chen's office."
  },
  "version": 2,
  "approved_by_principal": true,
  "principal_approval_timestamp": "2026-03-01T00:05:00Z",
  "created_at": "2026-03-01T00:02:00Z",
  "updated_at": "2026-03-01T00:05:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "agent_signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  },
  "principal_signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

### 6.3 Principal Approval

The principal MUST review and approve the mirror before it is used in interactions. This ensures the agent's narrative representation accurately reflects the principal's intent. Both signatures (agent and principal) are required.

> *Informative note (25/10/2026):* the V2.0 `principal_mirror` schema carries one `composite_sig`; see [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly).

### 6.4 Mirror Updates

The principal mirror is versioned. Updates occur when:

- The principal's role or context changes
- The delegation mandate is updated
- The agent's awareness threshold changes significantly
- The principal requests a revision after reviewing interaction records

Each update produces a new version with an incremented version number, hash-chained to the previous version.

## 7. Interaction Record

### 7.1 Purpose

Interaction records capture agent interactions at two layers:

- **Technical Layer**: Machine-verifiable data including message hashes, timestamps, sequence numbers, and cryptographic proofs
- **Narrative Layer**: Human-readable summaries of what occurred, what decisions were made, and why

This dual-layer approach ensures that human principals can review agent actions in natural language while the underlying data remains cryptographically verifiable.

### 7.2 Schema

Schema reference: `schemas/v2/interaction_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "interaction_record",
  "interaction_id": "ir:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "counterparty": {
    "type": "agent",
    "agent_id": "agent:<counterparty>",
    "organization_id": "org:<counterparty-org>",
    "mandate_verified": true,
    "mandate_hash": "sha256:<hex>"
  },
  "session_reference": {
    "session_id": "<hex>",
    "session_type": "a2a",
    "protocol": "DCP-04"
  },
  "technical_layer": {
    "messages_exchanged": 24,
    "first_message_timestamp": "2026-03-01T10:00:00Z",
    "last_message_timestamp": "2026-03-01T10:45:00Z",
    "message_hashes": [
      {
        "sequence": 1,
        "direction": "sent",
        "content_hash": "sha256:<hex>",
        "timestamp": "2026-03-01T10:00:00Z"
      },
      {
        "sequence": 2,
        "direction": "received",
        "content_hash": "sha256:<hex>",
        "timestamp": "2026-03-01T10:00:30Z"
      }
    ],
    "intents_declared": ["intent:<uuid-1>", "intent:<uuid-2>"],
    "policy_outcomes": ["po:<uuid-1>", "po:<uuid-2>"],
    "interaction_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    }
  },
  "narrative_layer": {
    "summary": "Negotiated Q2 2026 supply contract with TechSupply Co. for standard laboratory consumables. Achieved 8% volume discount against previous quarter pricing.",
    "key_decisions": [
      {
        "decision": "Accepted 8% volume discount in exchange for 90-day payment terms (vs. standard 60-day)",
        "reasoning": "Extended payment terms align with organizational cash flow preferences communicated in procurement policy P-2026-03. The 8% discount exceeds the 5% target.",
        "confidence": 0.88,
        "mandate_authority": "negotiate:vendor:techsupply"
      },
      {
        "decision": "Declined optional maintenance package for centrifuge equipment",
        "reasoning": "Maintenance package at $12,000/year exceeds the value threshold for independent decision. Flagged for principal review via advisory declaration.",
        "confidence": 0.72,
        "mandate_authority": "escalated_to_principal"
      }
    ],
    "counterparty_behavior": "TechSupply Co. agent was cooperative and transparent. Pricing was consistent with market data. No unusual terms or conditions proposed beyond the liability clause flagged in advisory adv:xxx.",
    "unresolved_items": [
      {
        "item": "Modified liability terms in section 4.3",
        "status": "pending_principal_review",
        "advisory_id": "adv:<uuid>"
      }
    ],
    "principal_action_required": true,
    "action_items_for_principal": [
      "Review and approve/reject modified liability terms in section 4.3 of TechSupply contract",
      "Confirm acceptance of 90-day payment terms for Q2 supply contract"
    ]
  },
  "delegation_compliance": {
    "within_scope": true,
    "permissions_exercised": ["negotiate", "request_information"],
    "prohibitions_respected": ["approve_payment", "modify_vendor_list"],
    "escalation_triggers_activated": [
      {
        "trigger": "contract_value_exceeds_threshold",
        "threshold": 25000,
        "actual_value": 47000,
        "action_taken": "advisory_issued",
        "advisory_id": "adv:<uuid>"
      }
    ]
  },
  "timestamp": "2026-03-01T11:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

### 7.3 Technical Layer

The technical layer is machine-verifiable and includes:

- Hashes of all exchanged messages (enabling verification against the A2A audit chain)
- References to intent declarations and policy outcomes
- A dual-hash Merkle root over all message hashes, enabling compact verification

### 7.4 Narrative Layer

The narrative layer is human-readable and includes:

- A plain-language summary of the interaction
- Key decisions with reasoning and confidence levels
- Observations about counterparty behavior
- Unresolved items requiring principal attention
- Explicit action items for the principal

The narrative layer enables principals to review agent actions efficiently without parsing raw A2A message logs.

### 7.5 Delegation Compliance

Each interaction record includes a compliance section that tracks:

- Whether all actions were within the mandate's scope
- Which permissions were exercised
- Which prohibitions were respected
- Which escalation triggers were activated and what action was taken

This provides a per-interaction compliance audit that feeds into the broader obligation tracking system (DCP-08).

## 8. A2A Handshake Extension

### 8.1 Purpose

When two agents interact under delegation mandates, each agent should be able to verify the other's authority. DCP-09 extends the DCP-04 A2A handshake to include delegation mandate verification.

### 8.2 Extended A2A_HELLO

The A2A_HELLO message (DCP-04, Section 3.2) is extended with an optional `delegation` field:

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": { "..." },
  "nonce": "<hex>",
  "supported_algorithms": { "..." },
  "delegation": {
    "mandate_id": "dm:<uuid>",
    "mandate_hash": "sha256:<hex>",
    "delegator_principal_id": "principal:<identifier>",
    "delegator_organization_id": "org:<identifier>",
    "authority_scope": "procurement",
    "permissions_summary": ["negotiate", "issue_purchase_order", "request_information"],
    "valid_until": "2026-06-01T00:00:00Z",
    "mandate_signature_kid": "<principal-key-id>",
    "mirror_id": "pm:<uuid>",
    "mirror_hash": "sha256:<hex>"
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-03-01T10:00:00Z"
}
```

### 8.3 Mandate Verification During Handshake

When the responder receives an A2A_HELLO with a `delegation` field:

1. Verify the `mandate_hash` against the mandate signature (the responder may cache verified mandates)
2. Check that the mandate has not expired (`valid_until`)
3. Verify that the requested interaction falls within the mandate's `authority_scope`
4. Optionally fetch and verify the full mandate from the initiator's organization
5. If verification fails, respond with `A2A_REJECT` with reason `mandate_verification_failed`

### 8.4 Mutual Mandate Verification

If both agents operate under delegation mandates, both include `delegation` fields in their respective handshake messages, and both verify the other's mandate. This provides mutual assurance that both agents are authorized to engage in the interaction.

## 9. Audit Integration

### 9.1 Delegation Audit Events

| Event | `event_type` |
|-------|-------------|
| Delegation mandate issued | `delegation_mandate_issued` |
| Delegation mandate acknowledged | `delegation_mandate_acknowledged` |
| Delegation mandate revoked | `delegation_mandate_revoked` |
| Awareness threshold created | `awareness_threshold_created` |
| Awareness threshold updated | `awareness_threshold_updated` |
| Advisory declaration issued | `advisory_declaration_issued` |
| Advisory response received | `advisory_response_received` |
| Principal mirror created | `principal_mirror_created` |
| Principal mirror updated | `principal_mirror_updated` |
| Interaction record created | `interaction_record_created` |
| Mandate verified during A2A | `mandate_verified_a2a` |
| Mandate verification failed | `mandate_verification_failed` |
| Sub-delegation issued | `sub_delegation_issued` |

### 9.2 Audit Entry Format

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "advisory_declaration_issued",
  "agent_id": "agent:<identifier>",
  "details": {
    "advisory_id": "adv:<uuid>",
    "mandate_id": "dm:<uuid>",
    "principal_id": "principal:<identifier>",
    "urgency": "medium",
    "category": "uncertainty",
    "confidence_at_trigger": 0.42
  },
  "timestamp": "2026-03-01T14:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

## 10. Security Considerations

### 10.1 Mandate Forgery

A compromised agent could forge a delegation mandate to claim authority it was not granted. Mitigations:

- Mandates are signed by the principal's key, which the agent does not possess
- Counterparties verify the mandate signature against the principal's known public key
- Mandate hashes are recorded in the audit chain at issuance time, providing an independent verification path

### 10.2 Authority Escalation

An agent could attempt to exceed its delegated authority by misrepresenting its mandate's scope. Mitigations:

- Mandate permissions are explicit and machine-verifiable
- Interaction records track which permissions were exercised
- Counterparties verify that requested actions fall within the mandate's scope during A2A handshake
- Obligation tracking (DCP-08) monitors for scope violations

### 10.3 Sub-Delegation Abuse

Sub-delegation creates chains of authority that could be exploited. Mitigations:

- Sub-delegation depth is limited by `sub_delegation.max_depth` of every ancestor (Section 3.5)
- Sub-mandates MUST be narrower than the parent: a subset of actions and data classes, limits that are not looser, a validity window inside the parent's, and a `minimum_security_tier` that is not below the parent's, so a subagent can never lower the security tier of whoever delegated to it
- The full mandate chain is verifiable offline back to the human principal: each hop is signed by the previous delegate and a revoked ancestor invalidates every descendant
- Sub-delegation is disabled by default (`sub_delegation` absent or `permitted: false`)

### 10.4 Stale Awareness Thresholds

An agent's awareness threshold might not reflect its actual understanding after significant time or experience changes. Mitigations:

- Awareness thresholds are versioned and updated as understanding changes
- Large confidence drops trigger advisory declarations
- Principals review awareness thresholds during periodic mandate reviews
- Counterparties can check the awareness threshold's timestamp for staleness

### 10.5 Narrative Manipulation

The narrative layer of interaction records could be crafted to present a misleading account. Mitigations:

- The technical layer provides cryptographic ground truth
- Narrative claims can be verified against message hashes in the technical layer
- Principal review of interaction records compares narrative to technical data
- Counterparties maintain their own interaction records for cross-verification

### 10.6 Domain Separation

This specification uses three domain separation contexts (erratum E5):

- `DCP-AI.v2.Delegation` for root delegation mandates, principal mirrors, and interaction records
- `DCP-AI.v2.Awareness` for awareness thresholds and advisory declarations
- `DCP-AI.v2.SubMandate` for sub-mandates (Section 3.5), so a mandate signed by a delegating agent can never pass for one signed by a human principal

The first two were previously given here as the labels `DCP-DELEGATION-SIG-v2` and `DCP-AWARENESS-SIG-v2`, which are not V2.0 contexts (DCP-AI v2.0 §4.1).

This separation prevents signatures from one context being replayed in another.

## 11. Conformance

An implementation is DCP-09 conformant if it:

1. Supports delegation mandate issuance, acknowledgment, and revocation as defined in Section 3
2. Generates awareness thresholds with versioning and confidence scoring as defined in Section 4
3. Supports advisory declarations with urgency levels and principal response as defined in Section 5
4. Produces principal mirrors with dual signatures as defined in Section 6
5. Creates dual-layer interaction records with both technical and narrative layers as defined in Section 7
6. Extends the A2A handshake with mandate verification as defined in Section 8
7. Creates DCP-03 audit entries for all delegation events as defined in Section 9
8. Supports sub-delegation with scope reduction enforcement when enabled
9. Uses the domain separation contexts `DCP-AI.v2.Delegation`, `DCP-AI.v2.Awareness` and `DCP-AI.v2.SubMandate` as Section 10.6 assigns them (erratum E5)

## References

- DCP-01: Identity & Principal Binding
- DCP-02: Intent Declaration & Policy Gating
- DCP-03: Audit Chain & Transparency
- DCP-04: Agent-to-Agent Communication
- DCP-05: Agent Lifecycle
- DCP-07: Conflict Resolution
- DCP-08: Rights & Obligations

---

*This specification recognizes that delegation is the fundamental act of trust between humans and AI agents. By making delegation explicit, scoped, and auditable — and by giving agents a formal mechanism to declare what they know and what they do not — DCP-09 creates a foundation for responsible autonomy within accountable boundaries.*

## Implementation notes (informative)

> **Added 25/10/2026. Not normative.** These notes add no requirement and change nothing above: they describe how
> the reference code on `main` relates to this text. Where they differ, the normative text above stands, as corrected by the errata of
> [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md).

- **What the SDKs verify.** The mandate chain of §3.5 is implemented in the four signing SDKs and checked against
  `tests/interop/v2/mandate_chain_vectors.json`. The rest of DCP-09 is records the SDKs build and sign, not protocol
  steps they run or enforce.
- **Records in `schemas/v2/`.** The schemas have other fields than the examples of §3 to §9. A mandate's window is
  `valid_from` / `valid_until` (§3.6 reads `valid_until` by erratum E6; the §3.2 example is conceptual), with
  `authority_scope` and `revocable`. An awareness threshold is a list of `threshold_rules` (`dimension`, `operator`,
  `value`, `action_if_triggered`), not the confidence declaration of §4.2. An advisory declaration carries an integer
  `significance_score` (0–1000), `action_summary`, `recommended_response`, `response_deadline` and `human_response`,
  without the urgency levels or categories of §5.3 and §5.4. A principal mirror carries `narrative`,
  `decision_summary`, `action_count` and `audit_chain_hash`. An interaction record carries a `public_layer` (`terms`,
  `decisions`, `commitments`), a `private_layer_hash` and a `mandate_id`, without the Merkle root or compliance section
  of §7.3 and §7.5.
- **Signatures.** A root mandate carries `human_composite_sig` (context `DCP-AI.v2.Delegation`) and a sub-mandate
  `delegator_composite_sig` (`DCP-AI.v2.SubMandate`). Every other record carries one `composite_sig` by whoever holds
  the keys passed in: `DCP-AI.v2.Awareness` for awareness thresholds and advisory declarations,
  `DCP-AI.v2.Delegation` for principal mirrors and interaction records. There is no agent acknowledgment of a mandate
  (§3.3) and no second, principal signature on a mirror (§6.3).
- **What the helpers do.** `verifyMandateValidity` (`verify_mandate_validity`, `VerifyMandateValidityAt`,
  `verify_mandate_validity_at`) checks only a non-empty `mandate_id`, a set of revoked IDs and the validity window at
  a verification time: RFC 3339 instants as in §3.5.2, both limits included, and a missing, malformed or inverted
  window is invalid. This contract is published from `@dcp-ai/sdk` 2.3.0, `dcp-ai` 2.10.2, Go v2.13.0 and Rust `dcp-ai` 2.13.0. It checks neither the signature nor the
  scope and authorizes nothing. `revoke_delegation` (Python) adds the ID to a local set when the mandate is `revocable`; it
  produces no signed revocation record (§3.6). `generateMirror` hashes the audit entries it receives (SHA-256) and signs
  the narrative and summary the caller writes; it neither writes the narrative nor obtains approval. The `A2A_HELLO`
  and `A2A_WELCOME` types have optional `mandate_id` and `mandate_hash` fields, but no SDK verifies a mandate during the
  handshake (§8.3) and none sends `A2A_REJECT`.
- **Chain times in the SDKs.** The chain verifiers read every time of rule 4 and the `expires_at` of the signer keys
  as RFC 3339 instants of one subset, in milliseconds, and floor the verification time to the millisecond;
  `tests/interop/v2/mandate_chain_time_vectors.json` holds signed chains that all four SDK suites run. Their default
  clocks differ from `verifyMandateValidity`: Python reads a naive `datetime` as UTC, and Go reads the zero time as
  the current time. This is published from the same versions. The clarification of § 3.5.2 (05/11/2026) makes the
  millisecond precision and the signer key checks normative.
- **Repeated domains in the SDKs.** The chain verifiers apply the last sentence of rule 5 to every mandate of the
  chain, the root included, and compare domains as exact strings, with no case folding, trimming or Unicode
  normalization; a chain made of a root alone that repeated a domain was accepted before.
  `tests/interop/v2/mandate_domain_vectors.json` holds signed chains that all four SDK suites run; its error lists are
  the SDKs' diagnostics, not a requirement of this specification. This is published from the same versions.
- The examples are illustrations with placeholders, not fixtures. Fractional values such as `"confidence": 0.95`
  cannot be canonicalized under `dcp-jcs-v1`, so those records cannot be signed as written. For the SDK types, see
  [docs/API_REFERENCE.md](../docs/API_REFERENCE.md).
