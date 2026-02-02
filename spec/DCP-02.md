# DCP-02 — Intent Declaration & Policy Gating

No silent actions. An agent declares what it intends to do before doing it; a policy layer decides whether to approve, escalate, or block. DCP-02 defines the declared intent and the policy decision.

## Normative artifacts

| Artifact | Description | Schema |
|----------|-------------|--------|
| **Intent** | Declaration of intent: agent, human, action, channel, data classes, estimated impact. | `schemas/v1/intent.schema.json` |
| **PolicyDecision** | Decision on an intent: approve / escalate / block, risk score, reasons. Optional: require human confirmation. | `schemas/v1/policy_decision.schema.json` |
| **HumanConfirmation** | (Optional) Explicit human confirmation on an intent: approve or deny. | `schemas/v1/human_confirmation.schema.json` |

**$id** for schemas: `https://dcp-ai.org/schemas/v1/<name>.schema.json`

## Validation

Validate an object against its schema:

```bash
dcp validate schemas/v1/intent.schema.json <intent.json>
dcp validate schemas/v1/policy_decision.schema.json <policy_decision.json>
dcp validate schemas/v1/human_confirmation.schema.json <human_confirmation.json>
```

A Citizenship Bundle includes Intent and PolicyDecision; validate it with:

```bash
dcp validate-bundle <citizenship_bundle.json>
```

## Examples

- [tests/conformance/examples/intent.json](../tests/conformance/examples/intent.json)
- [tests/conformance/examples/policy_decision.json](../tests/conformance/examples/policy_decision.json)

The source of truth for fields and enums is the JSON Schema; this document is the normative specification that references them.
