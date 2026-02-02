# Bundle — Citizenship Bundle & Signed Bundle

An agent does not operate in a vacuum: it operates with an identity, a declared intent, a policy decision, and an auditable record. The **Citizenship Bundle** is the portable packet that brings all of that together. The **Signed Bundle** makes it cryptographically verifiable.

## Citizenship Bundle (L3 Bundle)

A Citizenship Bundle is a JSON object containing exactly:

- `human_binding_record` — DCP-01 (HBR)
- `agent_passport` — DCP-01 (AP)
- `intent` — DCP-02
- `policy_decision` — DCP-02
- `audit_entries` — DCP-03 (array, at least one element)

**Normative schema:** `schemas/v1/citizenship_bundle.schema.json`  
**$id:** `https://dcp-ai.org/schemas/v1/citizenship_bundle.schema.json`

**Validation:**

```bash
dcp validate-bundle <bundle.json>
```

Or validate the object against the bundle schema directly:

```bash
dcp validate schemas/v1/citizenship_bundle.schema.json <bundle.json>
```

**Example:** [tests/conformance/examples/citizenship_bundle.json](../tests/conformance/examples/citizenship_bundle.json)

---

## Signed Bundle

A Signed Bundle wraps a Citizenship Bundle with an Ed25519 signature and deterministic hashes:

- `bundle` — the full Citizenship Bundle object
- `signature` — object with:
  - `alg`: `"ed25519"`
  - `created_at`: ISO 8601 date-time
  - `signer`: `{ type: "human"|"organization", id, public_key_b64 }`
  - `bundle_hash`: `sha256:<hex>` — SHA-256 of the canonicalized JSON of the bundle
  - `merkle_root`: `sha256:<hex>` or `null` — Merkle root of `audit_entries` (optional)
  - `sig_b64`: signature in Base64

**Normative schema:** `schemas/v1/signed_bundle.schema.json`  
**$id:** `https://dcp-ai.org/schemas/v1/signed_bundle.schema.json`

**Validation (schema + signature):**

```bash
dcp verify-bundle <bundle.signed.json> <public_key.txt>
```

**Auxiliary commands:**

```bash
dcp bundle-hash <bundle.json>        # Prints bundle_hash (sha256:...)
dcp merkle-root <bundle.json>       # Prints merkle_root of audit_entries or null
dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]
dcp keygen [out_dir]
```

**Example:** [tests/conformance/examples/citizenship_bundle.signed.json](../tests/conformance/examples/citizenship_bundle.signed.json)
