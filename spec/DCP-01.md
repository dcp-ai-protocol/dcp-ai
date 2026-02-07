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

---

## Jurisdiction Attestation (optional)

A **Jurisdiction Attestation** is an optional object that certifies an agent's Human Binding Record as valid within a specific jurisdiction. It is produced by a jurisdiction authority (government, regulatory body, or accredited issuer) and may be included in the Signed Bundle or presented alongside it.

### Object format

```json
{
  "type": "jurisdiction_attestation",
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "hbr_hash": "sha256:<hex>",
  "agent_id": "agent-uuid-here",
  "attested_at": "2026-02-07T00:00:00Z",
  "expires_at": "2027-02-07T00:00:00Z",
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"jurisdiction_attestation"`. |
| `issuer` | string | Identifier of the issuing authority. |
| `jurisdiction` | string | ISO 3166-1 alpha-2 country code (e.g. `"US"`, `"EU"`, `"JP"`). |
| `hbr_hash` | string | `sha256:<hex>` — SHA-256 of the canonical JSON of the Human Binding Record being attested. |
| `agent_id` | string | The agent_id from the Agent Passport. |
| `attested_at` | string | ISO 8601 date-time when the attestation was issued. |
| `expires_at` | string or null | ISO 8601 date-time when the attestation expires; `null` for no expiry. |
| `signature` | object | Ed25519 signature over the canonical JSON of all fields except `signature` itself. `alg`, `public_key_b64`, `sig_b64`. |

### How it works

1. The agent creator (or the agent holder) computes `hbr_hash` = SHA-256(canonical(human_binding_record)).
2. The creator submits `hbr_hash` + `agent_id` to the jurisdiction's attestation service (or in-person / offline process).
3. The authority verifies the HBR (identity, jurisdiction, validity) and signs the attestation.
4. The attestation is returned to the agent holder and stored alongside or inside the Signed Bundle.

### Verification

A verifier checks the attestation by:

1. Computing `hbr_hash` from the bundle's `human_binding_record` and comparing it to the attestation's `hbr_hash`.
2. Verifying the Ed25519 signature with the issuer's public key (obtained from the jurisdiction's well-known URL or a trusted set of issuer keys).
3. Checking that `attested_at` is in the past and `expires_at` is `null` or in the future.

See [VERIFICATION.md](VERIFICATION.md) step 10.

### Issuer public keys

The protocol suggests (but does not mandate) that jurisdictions publish their attestation public keys at a well-known URL:

`https://<authority>/.well-known/dcp-attestation-keys.json`

Format:

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "keys": [
    { "key_id": "key-2026-01", "public_key_b64": "...", "valid_from": "2026-01-01T...", "valid_until": "2027-01-01T..." }
  ]
}
```

This is a convention; any method of distributing issuer keys is acceptable (peer, registry, well-known URL, etc.).

---

## Jurisdictional revocation list

A jurisdiction may publish a **signed revocation list** — a JSON file listing agents that have been revoked within that jurisdiction. See [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) for the format, publication convention, and how verifiers use it.

---

## Reference

- Verification checklist: [VERIFICATION.md](VERIFICATION.md)
- Storage and anchoring (revocation lists, transparency log): [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)
- Government deployment guide: [docs/GOVERNMENT_DEPLOYMENT.md](../docs/GOVERNMENT_DEPLOYMENT.md)
