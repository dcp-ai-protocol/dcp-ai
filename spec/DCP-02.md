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
- [tests/conformance/examples/human_confirmation.json](../tests/conformance/examples/human_confirmation.json)

The source of truth for fields and enums is the JSON Schema; this document is the normative specification that references them.

## Implementation notes (informative)

> **Added 25/10/2026. Not normative.** These notes add no requirement and change nothing above: they describe how
> the reference code on `main` relates to this text. Where they differ, the normative text above stands.

- This document and its commands describe the **V1** artifacts (`schemas/v1/`). The V2 counterparts
  (`schemas/v2/intent.schema.json`, `policy_decision.schema.json`, `human_confirmation.schema.json`) add, among
  others, `session_nonce` and `requires_consent` to the intent, and `session_nonce`, `applied_policy_hash`,
  `required_confirmation` and `timestamp` to the policy decision; they are specified in
  [DCP-AI v2.0](DCP-AI-v2.0.md).
- `<intent.json>` and the other names in angle brackets are placeholders for your own files.
- A policy decision is a record of what a policy layer decided. Verifying a bundle checks that it is consistent and
  signed; it does not enforce the decision, and the reference verifiers do not refuse a bundle because its decision is
  `block`. Enforcing it before the action is the application's job.
