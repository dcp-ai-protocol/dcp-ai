# DCP-03 — Audit Chain & Transparency

Every decision and every outcome is recorded. The audit chain links entries with a previous hash (GENESIS for the first); optionally a Merkle root can be computed over the entries. Thus traceability is verifiable.

## Normative artifacts

| Artifact | Description | Schema |
|----------|-------------|--------|
| **AuditEntry** | An audit entry: prev_hash, timestamp, agent_id, human_id, intent_id, intent_hash, policy_decision (approved/escalated/blocked), outcome, evidence. | `schemas/v1/audit_entry.schema.json` |

**$id:** `https://dcp-ai.org/schemas/v1/audit_entry.schema.json`

**Chaining:** `prev_hash` links to the previous entry; the first entry uses a GENESIS value (e.g. the literal string `"GENESIS"` or an agreed hash). The source of truth for the format of `prev_hash` is in the schema.

**Merkle (optional):** Given an array of `audit_entries`, a Merkle root can be computed. The Signed Bundle may include `signature.merkle_root` as `sha256:<hex>` or `null`.

## Validation

Validate an audit entry:

```bash
dcp validate schemas/v1/audit_entry.schema.json <audit_entry.json>
```

Validate a full bundle (includes all audit_entries):

```bash
dcp validate-bundle <citizenship_bundle.json>
```

Get the Merkle root of a bundle's audit_entries:

```bash
dcp merkle-root <citizenship_bundle.json>
```

## Examples

- [tests/conformance/examples/audit_entry.json](../tests/conformance/examples/audit_entry.json)
- The bundle [tests/conformance/examples/citizenship_bundle.json](../tests/conformance/examples/citizenship_bundle.json) includes `audit_entries`.

The source of truth for fields and enums is the JSON Schema; this document is the normative specification that references them.
