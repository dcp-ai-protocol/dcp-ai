# Verification checklist — Signed Bundle

All steps are **local**; no API or server call is required. A verifier needs only the Signed Bundle (and optionally a set of signed RevocationRecords from peer, file, or anchored list).

## Normative checklist

When verifying a Signed Bundle, perform the following in order:

1. **Schema-validate** the Signed Bundle and the inner Citizenship Bundle against `schemas/v1/signed_bundle.schema.json` and `schemas/v1/citizenship_bundle.schema.json` (or use `dcp validate-bundle` on the inner bundle and schema-validate the signed wrapper).

2. **Verify signature:**  
   - Recompute `bundle_hash` = SHA-256(canonical(bundle)); compare with `signature.bundle_hash` (must match, e.g. `sha256:<hex>`).  
   - Verify `signature.sig_b64` with `signature.signer.public_key_b64` over the canonical bundle (Ed25519 detached).  
   - Use `dcp verify-bundle <signed.json> <public_key.txt>` to perform this step.

3. **Verify RPR:** Not expired — `responsible_principal_record.expires_at` is `null` or a future ISO 8601 date-time. Optional: verify RPR signature if the record is stored signed.

4. **Verify AP:** `agent_passport.status` = `"active"`. Optional: check signer/agent_id against a **local set of signed RevocationRecords** (from peer, file, or anchored list)—no central API.

5. **Verify intent_hash:** For each AuditEntry in `bundle.audit_entries`, `intent_hash` MUST equal SHA-256(canonical(intent)) (hex), where the intent is the one in the bundle identified by that entry’s `intent_id` (typically the bundle’s single `intent`). Use `dcp intent-hash <intent.json>` or the reference `intentHash()` helper.

6. **Verify audit chain:**  
   - First entry: `prev_hash` = `"GENESIS"`.  
   - For each subsequent entry at index n (n ≥ 1): `prev_hash` MUST equal SHA-256(canonical(entry_{n-1})) (hex).

7. **Optional — merkle_root:** If `signature.merkle_root` is present (non-null), verify it equals the Merkle root of `bundle.audit_entries` (e.g. `dcp merkle-root` on the inner bundle).

8. **Optional — anchor_receipt:** If an anchor_receipt is provided alongside the bundle (e.g. chain, tx_id, block ref), verify that `bundle_hash` appears at the given chain/log index using **public data only** (e.g. fetch tx from public block explorer or node). No central server is involved; verification uses public data only.

9. **Optional — jurisdictional revocation list:** If the verifier has access to a signed revocation list for the agent's jurisdiction (based on `responsible_principal_record.jurisdiction`), fetch or use the cached list, verify the issuer's Ed25519 signature, and check the bundle's `agent_passport.agent_id` (or signer) against the list entries. If found, the agent is revoked — verification fails. See [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) for list format and well-known URL convention.

10. **Optional — jurisdiction attestation:** If the bundle includes (or is accompanied by) a `JurisdictionAttestation` object, verify the attestation signature over `rpr_hash` with the attestor's public key. The attestor's public key may be obtained from a well-known URL published by the jurisdiction (e.g. `https://<authority>/.well-known/dcp-attestation-keys.json`). See [DCP-01.md](DCP-01.md) for the attestation object format.

11. **Optional — transparency log proof:** If the holder provides a log inclusion proof (`log_url`, `log_index`, `merkle_proof`), verify the Merkle inclusion of `bundle_hash` in the log's signed root. If the log root is anchored on-chain, optionally verify the anchor. See [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) for log API and proof format.

---

## V2 Verification Checklist

When verifying a V2 Signed Bundle (`dcp_bundle_version: "2.0"`), perform the following steps. These extend the V1 checklist with composite signature verification, session binding, and manifest integrity.

### Step V2-1: Detect version

Inspect `bundle.dcp_bundle_version`. If `"2.0"`, use this V2 checklist. If absent or `"1.0"`, use the V1 checklist above.

### Step V2-2: Schema-validate

Validate the Signed Bundle against `schemas/v2/signed_bundle_v2.schema.json` and the inner Citizenship Bundle against `schemas/v2/citizenship_bundle_v2.schema.json`.

### Step V2-3: Validate manifest

The bundle MUST contain a `manifest` object with the following required fields:
- `session_nonce` — 64-character hex string
- `rpr_hash`, `passport_hash`, `intent_hash`, `policy_hash` — SHA-256 hashes of the respective artifacts
- `audit_merkle_root` — Merkle root of audit entries
- `audit_count` — integer count of audit entries

Recompute each artifact hash from the canonical representation of the corresponding `payload` and verify it matches the manifest value.

### Step V2-4: Verify session nonce consistency

All artifacts (`responsible_principal_record.payload`, `agent_passport.payload`, `intent.payload`, `policy_decision.payload`) and all `audit_entries` that include a `session_nonce` field MUST share the same nonce as `manifest.session_nonce`.

### Step V2-5: Verify composite signature structure

The bundle-level `signature` MUST contain a `composite_sig` object with:
- `classical` — object with `alg`, `kid`, `sig_b64`
- `binding` — one of `pq_over_classical`, `classical_only`, `independent`
- `pq` — (required if binding is `pq_over_classical`) object with `alg`, `kid`, `sig_b64`

### Step V2-6: Verify classical signature

Reconstruct the signed message: `context_tag || 0x00 || canonical(manifest)` where `context_tag` is `"DCP-AI.v2.Bundle"`. Verify `composite_sig.classical.sig_b64` against the public key identified by `composite_sig.classical.kid` using the algorithm specified in `composite_sig.classical.alg` (typically Ed25519).

### Step V2-7: Verify PQ signature (if present)

If `composite_sig.binding` is `pq_over_classical`:
1. Reconstruct the PQ signed message: `context_tag || 0x00 || canonical(manifest) || classical_sig_bytes`
2. Verify `composite_sig.pq.sig_b64` against the public key identified by `composite_sig.pq.kid` using the PQ algorithm (e.g., ML-DSA-65).

If binding is `classical_only`, the PQ signature is absent. This MAY be acceptable depending on verifier policy (e.g., `hybrid_preferred` allows it; `hybrid_required` rejects it).

### Step V2-8: Verify per-artifact composite signatures

Each artifact (`responsible_principal_record`, `agent_passport`, `intent`, `policy_decision`) is wrapped in a `SignedPayload` envelope with its own `composite_sig`. Verify each artifact's composite signature using the same process as Steps V2-6 and V2-7, with the appropriate context tag for each artifact type.

### Step V2-9: Enforce verifier policy

Based on the verifier's policy configuration:
- If `default_mode` is `hybrid_required`, reject bundles with `classical_only` binding.
- If `default_mode` is `pq_only`, reject bundles without a PQ signature.
- Check `accepted_classical_algs` and `accepted_pq_algs` — reject if bundle uses an algorithm not in these lists.
- Check `advisory_rejected_algs` — reject if bundle uses an algorithm blocked by an active advisory.

### Step V2-10: Compute security tier (optional)

If the intent payload includes `action_type`, `estimated_impact`, and `data_classes`, compute the risk score and security tier. Verify the bundle's signature mode meets the tier's requirements (e.g., `elevated` and `maximum` tiers require `hybrid_required`).

### Step V2-11: Verify dual-hash audit chain (if present)

If audit entries include `prev_hash_secondary`, verify the secondary hash chain:
- First entry: `prev_hash_secondary` = `"GENESIS"`
- Subsequent entries: `prev_hash_secondary` = SHA3-256(canonical(previous_entry))

### Step V2-12: Verify PQ checkpoints (if present)

If the manifest references `pq_checkpoints`, verify each checkpoint:
1. The checkpoint's `merkle_root` matches the Merkle root of the events in its `event_range`.
2. The checkpoint's `composite_sig` is valid (both classical and PQ components).
3. The checkpoint's `session_nonce` matches the bundle's session nonce.

### Step V2-13: Key validity checks

For each key identifier (`kid`) referenced in composite signatures:
- Verify the kid was derived deterministically: `kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`
- Optionally check key status against a revocation service or local revocation list.
- Check `expires_at` if present — reject expired keys.

---

## Protocol integrity

Before verifying bundles, a verifier SHOULD verify that its own schemas match the canonical protocol:

```bash
dcp integrity
```

This checks the SHA-256 hash of each local schema against the canonical fingerprints in [`protocol_fingerprints.json`](../protocol_fingerprints.json) (located at the repository root). If any schema has been modified (e.g. in a protocol fork), the check fails. See [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md) for the full security model.

## Reference

- Bundle format: [BUNDLE.md](BUNDLE.md)
- Audit chain and intent_hash: [DCP-03.md](DCP-03.md)
- Security model: [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md)
- Storage, anchoring, revocation lists, transparency logs: [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)
- Government deployment: [docs/GOVERNMENT_DEPLOYMENT.md](../docs/GOVERNMENT_DEPLOYMENT.md)
- Full Package: [docs/Dcp-ai_Full_Package_V1.1.md](../docs/Dcp-ai_Full_Package_V1.1.md)
