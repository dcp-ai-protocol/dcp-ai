# DCP-01 — Identity & Human Binding

Humans precede agents. No agent exists without an explicit binding to a person or legal entity that assumes responsibility. DCP-01 defines the artifacts that bind agent identity to human identity.

## Normative artifacts

| Artifact | Description | Schema |
|----------|-------------|--------|
| **Human Binding Record (HBR)** | Record declaring who the human/organization is, jurisdiction, liability mode, and validity. | `schemas/v1/human_binding_record.schema.json` |
| **Agent Passport (AP)** | Agent passport: identity, public key, reference to HBR, status (active/revoked/suspended). | `schemas/v1/agent_passport.schema.json` |
| **Revocation Record** | Record of revocation of an agent: who revokes, when, reason. | `schemas/v1/revocation_record.schema.json` |

**$id** for schemas: `https://dcp-ai.org/schemas/v1/<name>.schema.json`

## Validation

Validate an object against its schema:

```bash
dcp validate schemas/v1/human_binding_record.schema.json <hbr.json>
dcp validate schemas/v1/agent_passport.schema.json <ap.json>
dcp validate schemas/v1/revocation_record.schema.json <revocation.json>
```

A Citizenship Bundle (which includes HBR and AP) is validated with:

```bash
dcp validate-bundle <citizenship_bundle.json>
```

## Examples

- [tests/conformance/examples/human_binding_record.json](../tests/conformance/examples/human_binding_record.json)
- [tests/conformance/examples/agent_passport.json](../tests/conformance/examples/agent_passport.json)

The source of truth for fields and enums is the JSON Schema; this document is the normative specification that references them.
