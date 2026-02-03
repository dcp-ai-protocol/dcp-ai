# Verification checklist — Signed Bundle

All steps are **local**; no API or server call is required. A verifier needs only the Signed Bundle (and optionally a set of signed RevocationRecords from peer, file, or anchored list).

## Normative checklist

When verifying a Signed Bundle, perform the following in order:

1. **Schema-validate** the Signed Bundle and the inner Citizenship Bundle against `schemas/v1/signed_bundle.schema.json` and `schemas/v1/citizenship_bundle.schema.json` (or use `dcp validate-bundle` on the inner bundle and schema-validate the signed wrapper).

2. **Verify signature:**  
   - Recompute `bundle_hash` = SHA-256(canonical(bundle)); compare with `signature.bundle_hash` (must match, e.g. `sha256:<hex>`).  
   - Verify `signature.sig_b64` with `signature.signer.public_key_b64` over the canonical bundle (Ed25519 detached).  
   - Use `dcp verify-bundle <signed.json> <public_key.txt>` to perform this step.

3. **Verify HBR:** Not expired — `human_binding_record.expires_at` is `null` or a future ISO 8601 date-time. Optional: verify HBR signature if the record is stored signed.

4. **Verify AP:** `agent_passport.status` = `"active"`. Optional: check signer/agent_id against a **local set of signed RevocationRecords** (from peer, file, or anchored list)—no central API.

5. **Verify intent_hash:** For each AuditEntry in `bundle.audit_entries`, `intent_hash` MUST equal SHA-256(canonical(intent)) (hex), where the intent is the one in the bundle identified by that entry’s `intent_id` (typically the bundle’s single `intent`). Use `dcp intent-hash <intent.json>` or the reference `intentHash()` helper.

6. **Verify audit chain:**  
   - First entry: `prev_hash` = `"GENESIS"`.  
   - For each subsequent entry at index n (n ≥ 1): `prev_hash` MUST equal SHA-256(canonical(entry_{n-1})) (hex).

7. **Optional — merkle_root:** If `signature.merkle_root` is present (non-null), verify it equals the Merkle root of `bundle.audit_entries` (e.g. `dcp merkle-root` on the inner bundle).

8. **Optional — anchor_receipt:** If an anchor_receipt is provided alongside the bundle (e.g. chain, tx_id, block ref), verify that `bundle_hash` appears at the given chain/log index using **public data only** (e.g. fetch tx from public block explorer or node). No central server is involved; verification uses public data only.

## Reference

- Bundle format: [BUNDLE.md](BUNDLE.md)
- Audit chain and intent_hash: [DCP-03.md](DCP-03.md)
- Full Package: [docs/Dcp-ai_Full_Package_V1.1.md](../docs/Dcp-ai_Full_Package_V1.1.md)
