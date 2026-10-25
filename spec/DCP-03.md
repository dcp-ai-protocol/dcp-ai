# DCP-03 — Audit Chain & Transparency

Every decision and every outcome is recorded. The audit chain links entries with a previous hash (GENESIS for the first); optionally a Merkle root can be computed over the entries. Thus traceability is verifiable.

## Normative artifacts

| Artifact | Description | Schema |
|----------|-------------|--------|
| **AuditEntry** | An audit entry: prev_hash, timestamp, agent_id, human_id, intent_id, intent_hash, policy_decision (approved/escalated/blocked), outcome, evidence. | `schemas/v1/audit_entry.schema.json` |

**$id:** `https://dcp-ai.org/schemas/v1/audit_entry.schema.json`

**intent_hash:** For each AuditEntry, `intent_hash` MUST equal the SHA-256 hash of the canonical JSON form of the Intent that the entry refers to. Formally: `intent_hash = SHA-256(canonical(intent))` (hex string). The intent is identified by `intent_id`; the canonical form is the same as used for bundle hashing (e.g. `json-stable-stringify`). Use `dcp intent-hash <intent.json>` or the `intentHash()` helper from the reference implementation to compute it.

**Chaining (prev_hash):** The first audit entry MUST have `prev_hash = "GENESIS"` (the literal string). For entry at index n (n ≥ 1), `prev_hash` MUST equal the SHA-256 hash of the canonical JSON form of the previous entry: `prev_hash = SHA-256(canonical(entry_{n-1}))` (hex string). This links entries in an immutable chain.

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

## Implementation notes (informative)

> **Added 25/10/2026. Not normative.** These notes add no requirement and change nothing above: they describe how
> the reference code on `main` relates to this text. Where they differ, the normative text above stands.

- This document and its commands describe the **V1** audit entry (`schemas/v1/audit_entry.schema.json`), whose
  `intent_hash` and the `prev_hash` of every entry after the first are bare hex strings. In V2 (`schemas/v2/audit_entry.schema.json`, specified in
  [DCP-AI v2.0](DCP-AI-v2.0.md)) they are written `sha256:<hex>`; in both versions the first entry's `prev_hash` stays the literal
  `"GENESIS"`. V2 entries also carry `session_nonce`, `hash_alg` and
  `pq_checkpoint_ref`, and the entries are committed by the manifest's Merkle root rather than signed one by one.
- The canonical form used for these hashes is the profile `dcp-jcs-v1`
  ([CANONICALIZATION_PROFILE.md](CANONICALIZATION_PROFILE.md)); `json-stable-stringify` above is an example of a
  sorted-key serializer, not a separate profile.
- The chain makes an altered, removed or reordered entry detectable (tamper-evident); it does not make the entries
  impossible to change, and it says nothing about whether their content is true.
- `<audit_entry.json>` and the other names in angle brackets are placeholders for your own files.
