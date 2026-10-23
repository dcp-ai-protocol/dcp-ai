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

Reference implementation: `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]` (or `verifySignedBundle` in `lib/verify.js`), which validates the schemas and delegates the cryptographic checks to `verifySignedBundleV2` in `@dcp-ai/sdk`. The optional public key pins the classical signer.

### Step V2-1: Detect version

Inspect `bundle.dcp_bundle_version`. If `"2.0"`, use this V2 checklist. If absent or `"1.0"`, use the V1 checklist above.

### Step V2-2: Schema-validate

Validate the Signed Bundle against `schemas/v2/signed_bundle.schema.json`, which defines the inner bundle and references `bundle_manifest`, `signed_payload`, `audit_entry` and `pq_checkpoint`. Validate each `SignedPayload.payload` against its artifact schema: `responsible_principal_record`, `agent_passport`, `intent` and `policy_decision` in `schemas/v2/`.

### Step V2-3: Validate manifest

The bundle MUST contain a `manifest` object with the following required fields:
- `session_nonce` — 64-character hex string
- `rpr_hash`, `passport_hash`, `intent_hash`, `policy_hash` — SHA-256 hashes of the respective artifacts
- `audit_merkle_root` — Merkle root of audit entries
- `audit_count` — integer count of audit entries

Recompute each artifact hash from the canonical representation of the corresponding `payload` and verify it matches the manifest value and the artifact's own `payload_hash`. A manifest hash that is missing, or a payload that is missing or cannot be canonicalized, fails verification.

Tie the audit trail to the manifest: `audit_count` MUST equal the number of `audit_entries`, `audit_merkle_root` MUST equal the Merkle root recomputed from them, the first entry's `prev_hash` MUST be `GENESIS`, and each later entry's `prev_hash` MUST be the hash of the previous entry. An empty audit trail has the root `sha256:` followed by 64 zeros, which the manifest schema's pattern admits; a bundle builder that accepts no audit entries writes that value (the Go `BuildBundleV2` and the Rust `build_bundle_v2`, which the `wasm` feature's `wasm_build_bundle` calls, do; the TypeScript and Python builders require at least one entry). The `auditEventsMerkleRoot` helper of every SDK, which serves PQ checkpoints, refuses an empty list instead.

### Step V2-4: Verify session nonce consistency

All artifacts (`responsible_principal_record.payload`, `agent_passport.payload`, `intent.payload`, `policy_decision.payload`) and all `audit_entries` that include a `session_nonce` field MUST share the same nonce as `manifest.session_nonce`.

If `manifest.session_expires_at` is present and has passed, reject the bundle.

`manifest.session_issued_at`, when present, is when the session began, signed with the rest of the manifest. Reject the bundle when it is not an RFC 3339 timestamp, when it is more than 30 seconds after the verification time (the clock skew [DCP-04](DCP-04.md) also allows), or when it is after `session_expires_at`. A verifier policy's `max_session_duration_seconds` bounds `session_expires_at` minus `session_issued_at`: under such a policy a bundle with `session_expires_at` and without `session_issued_at` is rejected, never measured from an unsigned time. Bundles signed before `session_issued_at` existed verify as before under a policy without a maximum session duration; under one with a maximum they are rejected and must be signed again.

The `signature` block outside `composite_sig` (`hash_alg`, `created_at`, `signer`, `manifest_hash`) is not signed: anyone can change it without breaking a signature. It MUST NOT stand in for signed data, as `created_at` once did for the session start. It MUST NOT contradict what is signed either: `signer.id` is the RPR's `human_id`, and `signer.kids` are the kids of `composite_sig`, the classical one and then the PQ one when present.

Timestamps in these checks (`session_expires_at` here, a key's `expires_at` in Step V2-13) are RFC 3339 date-times with a `Z` or `±hh:mm` offset, such as `2026-10-22T06:05:03-05:00`. Compare them as instants, never as strings: the string order of two timestamps with different offsets is not their time order. Absent or `null` means no expiry. Any other value that is not such a timestamp (a date without a time, a time without an offset, an impossible date or time, a non-string) MUST be rejected. The `rfc3339` category of `tests/interop/v2/interop_vectors.json` lists the instant of each accepted case and the rejected ones.

### Step V2-5: Verify composite signature structure

The bundle-level `signature` MUST contain a `composite_sig` object with:
- `classical` — object with `alg`, `kid`, `sig_b64`
- `binding` — one of `pq_over_classical`, `classical_only` (`schemas/v2/composite_signature.schema.json`)
- `pq` — (required if binding is `pq_over_classical`) object with `alg`, `kid`, `sig_b64`

### Step V2-6: Verify classical signature

Reconstruct the signed message: `context_tag || 0x00 || canonical(manifest)` where `context_tag` is `"DCP-AI.v2.Bundle"`. Verify `composite_sig.classical.sig_b64` against the public key identified by `composite_sig.classical.kid` using the algorithm specified in `composite_sig.classical.alg` (typically Ed25519).

The bundle signer is the responsible principal: look the kid up in the RPR `binding_keys` only. The principal's signature over the manifest, which commits to `passport_hash`, is what binds this agent and its keys to the principal; the agent signs its own passport, so a key that only the passport lists MUST NOT verify the bundle signature. Otherwise anyone could pair a published, signed RPR with a passport and keys of their own.

### Step V2-7: Verify PQ signature (if present)

If `composite_sig.binding` is `pq_over_classical`:
1. Reconstruct the PQ signed message: `context_tag || 0x00 || canonical(manifest) || classical_sig_bytes`
2. Verify `composite_sig.pq.sig_b64` against the public key identified by `composite_sig.pq.kid` in the RPR `binding_keys`, using the PQ algorithm (e.g., ML-DSA-65).

A PQ signature that is present MUST verify in every mode, including `hybrid_preferred` and `classical_only`; an invalid one fails verification.

If binding is `classical_only`, the PQ signature is absent. This MAY be acceptable depending on the effective mode (Step V2-9): `hybrid_preferred` accepts it with a warning, `hybrid_required` and `pq_only` reject it.

### Step V2-8: Verify per-artifact composite signatures

Each artifact (`responsible_principal_record`, `agent_passport`, `intent`, `policy_decision`) is wrapped in a `SignedPayload` envelope with its own `composite_sig`. Verify each artifact's composite signature using the same process as Steps V2-6 and V2-7, with the appropriate context tag for each artifact type. The principal signs the RPR with its `binding_keys`; the agent signs the passport, the intent and the policy decision with the passport `keys`.

### Step V2-9: Compute the security tier and the effective mode

Compute the security tier from `intent.payload` and `policy_decision.payload` as in [DCP-AI-v2.0.md § 14.2](DCP-AI-v2.0.md): `risk_score` comes from the policy decision, never from the intent; a missing, mistyped or unknown `action_type`, `estimated_impact` or `data_classes` value, or a policy decision `risk_score` that is missing or not an integer from 0 to 1000, fails closed to `elevated`; `intent.security_tier` can only raise the tier.

The effective mode is the stricter of the policy mode (`default_mode`, or the `risk_overrides` entry for the passport's `risk_tier`) and the tier's mode: `routine` → `classical_only`, `standard` → `hybrid_preferred`, `elevated` and `maximum` → `hybrid_required`, with `classical_only` < `hybrid_preferred` < `hybrid_required`. A `pq_only` policy stays `pq_only`. Report the resolved tier with the result.

### Step V2-10: Enforce verifier policy

Apply the effective mode (Step V2-9) and the verifier's policy configuration to the bundle signature and to every artifact signature (Steps V2-6 to V2-8):
- If the effective mode is `hybrid_required`, reject bundles with `classical_only` binding.
- If the effective mode is `pq_only`, reject bundles without a PQ signature.
- Check `accepted_classical_algs` and `accepted_pq_algs` — reject if bundle uses an algorithm not in these lists.
- Check `advisory_rejected_algs` — reject if bundle uses an algorithm blocked by an active advisory.

A `classical_only` bundle with an `initiate_payment` intent is therefore rejected even when its passport declares `risk_tier: "low"`.

### Step V2-11: Verify dual-hash audit chain (if present)

If audit entries include `prev_hash_secondary`, verify the secondary hash chain:
- First entry: `prev_hash_secondary` = `"GENESIS"`
- Subsequent entries: `prev_hash_secondary` = SHA3-256(canonical(previous_entry))

### Step V2-12: Verify PQ checkpoints (if present)

If the manifest lists `pq_checkpoints` or the bundle carries any, verify them:
1. The bundle MUST carry exactly the checkpoints the manifest lists, once each, by `checkpoint_id`. A listed checkpoint that is missing, or a carried one the manifest does not list, fails verification: the manifest is signed, the checkpoint bodies are not.
2. A checkpoint's `event_range` names a contiguous run of `audit_entries`, from the entry whose `audit_id` is `from_audit_id` to the one whose `audit_id` is `to_audit_id`, with `count` entries. Its `merkle_root` MUST be `sha256:` followed by the Merkle root of those entries, computed as `auditEventsMerkleRoot` computes it.
3. Its `composite_sig` is the agent's: verify it with the passport `keys`, under the `DCP-AI.v2.AuditEvent` context, over the canonical checkpoint without `composite_sig`. Both the classical and the PQ signature MUST be present and valid (in `pq_only` mode, the PQ one); a checkpoint exists to carry the PQ signature.
4. Its `session_nonce` MUST be the manifest's.

### Step V2-13: Key validity checks

For each key identifier (`kid`) referenced in composite signatures (the bundle's, each artifact's and each checkpoint's):
- The kid MUST be derived from the key that verifies the signature: `kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`, with `alg` and `raw_public_key` from that key entry. Reject the bundle otherwise. A kid then names one key, whichever list holds it; without this check a key list can claim another party's kid for a key of its own.
- Optionally check key status against a revocation service or local revocation list.

Reject the bundle if any key that can sign it, in the passport `keys` or the RPR `binding_keys`, has `status` `"revoked"` or `"expired"` (`schemas/v2/key_entry.schema.json` allows both), or an `expires_at` that has passed or is not an RFC 3339 timestamp (Step V2-4).

### Step V2-14: Cross-artifact consistency

The signatures prove who signed each artifact; these checks make the artifacts describe one action, by one agent, for one principal. They carry the V1 checks on the RPR, the passport and `intent_hash` over to V2. Reject the bundle when:
- `agent_passport.status` is neither `active` nor `declining`: a `commissioned`, `suspended`, `revoked` or `decommissioned` agent takes no action ([DCP-05](DCP-05.md) § 3.1);
- the RPR's `expires_at` has passed or is not an RFC 3339 timestamp (Step V2-4); `null` never expires;
- `agent_passport.principal_binding_reference` is not the RPR's `human_id`;
- `intent.agent_id` is not the passport's `agent_id`, or `intent.human_id` is not the RPR's `human_id`;
- `policy_decision.intent_id` is not `intent.intent_id`;
- an audit entry's `intent_id` is not `intent.intent_id`, its `intent_hash` is not the intent's payload hash (the manifest's `intent_hash`), its `agent_id` is not the passport's or its `human_id` is not the RPR's;
- an audit entry's `policy_decision` does not record the policy decision: `approved` for `approve`, `escalated` for `escalate`, `blocked` for `block`.

A bundle that records an escalated or blocked action is valid evidence of it: nothing here requires the decision to be `approve`. The status and expiry checks, like the key checks of Step V2-13, apply at the verification time; verifying archived evidence as of an earlier time is not defined yet.

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
- Operator guide: [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md)
