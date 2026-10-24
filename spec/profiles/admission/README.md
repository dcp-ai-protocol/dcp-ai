# Admission Profile: principal trust and `strict-v1`

**Status:** Draft, v1
**Scope:** Whether a verifier admits a V2 signed bundle as evidence from a principal it already trusts, under an operator-fixed profile

---

## 1. Purpose and layering

[VERIFICATION.md](../../VERIFICATION.md) (V2-1 to V2-14) decides whether a bundle is **verified**: its artifacts are intact, consistent, and signed by the keys the bundle itself lists. Anyone can create a responsible principal record (RPR) with any `human_id` and keys of their own, so a verified bundle proves integrity and signature, not who the principal is.

Admission adds two optional layers on top of verification, without changing it:

1. **Principal trust** (§3): the keys that signed for the principal belong to a principal the operator already trusts, according to a trust set the operator supplies.
2. **The `strict-v1` profile** (§4): fixed, operator-chosen requirements (hybrid signatures, audience, a short signed session window, fresh revocation status) that a request cannot weaken.

A verifier that enables neither behaves exactly as before. Admission never re-implements a verification step: it reads what the verifier reports (§2.3).

Admission decides whether **evidence** is admitted. It does not authorize an action: this version never binds an external authorization to a tool, its arguments or its execution (§7).

## 2. Inputs

### 2.1 Clock

Every time comparison in verification and admission uses one instant `now`, in milliseconds since the Unix epoch. Implementations take it as a parameter, defaulting to the system clock. Timestamps are RFC 3339 with a `Z` or `±hh:mm` offset, compared at millisecond precision, as in V2-4. The clock skew allowance is 30 seconds (`SKEW`), the same as V2-4 and DCP-04.

### 2.2 Trust set

Supplied only by the operator: local configuration or a source the operator chose. It MUST NOT be derived from the bundle (its keys, `legal_name`, `jurisdiction` or any other self-declared field), from a request or tool parameter, or from a URL the RPR names. Schema: [`principal_trust_set.schema.json`](../../../schemas/v2/principal_trust_set.schema.json).

```json
{
  "trust_set_version": "2026-11-01.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active",
          "not_before": null, "expires_at": "2027-06-01T00:00:00Z" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active" }
      ]
    }
  ]
}
```

A trust set is validated when it is loaded. It is rejected, with the configuration error code in brackets, when:

| Condition | Code |
|---|---|
| A field outside the schema at any level | `CONFIG_UNKNOWN_FIELD` |
| `trust_set_version` missing or not a non-empty string; `principals` not an array; a principal's `keys` not a non-empty array; `status` not `active`, `revoked` or `expired`; `not_before` or `expires_at` neither null nor RFC 3339 | `CONFIG_INVALID_VALUE` |
| `human_id` missing, not a string, or empty | `CONFIG_TRUST_EMPTY_ID` |
| `alg` not `ed25519`, `ml-dsa-65` or `slh-dsa-192f`; `public_key_b64` not canonical base64 (V2-5) or not 32, 1952 or 48 bytes for that algorithm | `CONFIG_TRUST_MALFORMED_KEY` |
| `kid` not the kid derived from `alg` and the key bytes (V2-13) | `CONFIG_TRUST_KID_NOT_DERIVED` |
| A `human_id` listed twice, or a `kid` listed twice in the whole set (under one principal or two) | `CONFIG_TRUST_DUPLICATE` |

Any duplicate is rejected, identical or not: an operator merging sources resolves them before loading. A trust set with no principals is valid and trusts no one.

The authoritative status of a key is the trust set's. A bundle that lists a key as `active` cannot reinstate one the trust set marks `revoked` or `expired`, or whose `expires_at` has passed.

**Rotation** is an explicit update of the trust set (a new `trust_set_version`): the operator adds the new key, keeps the old one `active` for an overlap if needed, then retires it (`revoked`, `expired`, an `expires_at`, or removal). A bundle cannot authorize its own rotation, because its keys are never a source of trust.

Agent keys are not registered in the trust set. The agent is tied to the principal by the principal's signature over the manifest, which covers `passport_hash` (V2-6, V2-7).

### 2.3 Signer keys reported by the verifier

For every composite signature it checks (the bundle signature over the manifest, the four artifacts, each PQ checkpoint), the verifier reports, per component, the key entry it resolved and whether that component verified:

```json
{ "signature": "bundle", "component": "classical", "kid": "…", "alg": "ed25519",
  "public_key_b64": "…", "verified": true }
```

`signature` is `bundle`, `responsible_principal_record`, `agent_passport`, `intent`, `policy_decision` or `pq_checkpoints[<checkpoint_id>]`; `component` is `classical` or `pq`. A component whose key the verifier did not resolve (a classical key absent under `pq_only`) is not reported. These are the keys that actually verified the signatures, resolved exactly as the verifier resolved them; admission never resolves keys a second way.

The **principal signatures** are `bundle` and `responsible_principal_record`.

### 2.4 Revocation snapshot

Required by `strict-v1`. The operator's adapter obtains it from a local or remote source the operator configured (no central service is required) for the **revocation subjects** of the bundle: the passport `agent_id`, and the kid of every verified signer key (§2.3), all signatures included. Schema: [`revocation_snapshot.schema.json`](../../../schemas/v2/revocation_snapshot.schema.json).

```json
{ "checked_at": "2026-11-01T00:00:20Z",
  "agents": { "agent:acme-bot": "not_revoked" },
  "keys": { "<kid>": "not_revoked", "<kid>": "not_revoked" } }
```

`checked_at` is when the source established these statuses, not when the adapter read them. Each status is `revoked`, `not_revoked` or `unknown`. A source that cannot answer (timeout, error, unreachable) produces no snapshot; an adapter MUST NOT turn a failure into `not_revoked`.

## 3. Principal trust

Evaluated only when a trust set is supplied and the bundle verified (V2-1 to V2-14); otherwise the result is `not_evaluated`. With `human_id` the RPR payload's `human_id`:

- **T1.** `human_id` is not a principal of the trust set: `TRUST_PRINCIPAL_UNKNOWN`. Stop.
- **T2.** For each verified component of each principal signature (§2.3), the trust set entry of that principal with the same `kid`:
  - none, or a different `alg` or different key bytes: `TRUST_KEY_NOT_ANCHORED`;
  - `status` `revoked`: `TRUST_KEY_REVOKED`;
  - `status` `expired`, or `expires_at` before `now`: `TRUST_KEY_EXPIRED`;
  - `not_before` after `now`: `TRUST_KEY_NOT_YET_VALID`.

The principal is `trusted` when T1 and T2 add no code, `untrusted` otherwise. Every verified component counts: trusting only a principal's Ed25519 key does not make its PQ key, or any other key in the RPR, trusted.

## 4. The `strict-v1` profile

### 4.1 Configuration

Schema: [`admission_profile.schema.json`](../../../schemas/v2/admission_profile.schema.json).

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example",
  "max_session_duration_seconds": 300, "max_revocation_age_seconds": 300,
  "verifier_policy": { "advisory_rejected_algs": ["slh-dsa-192f"] } }
```

| Field | Rule |
|---|---|
| `profile` | Required, `"strict-v1"` |
| `verifier_id` | Required, a non-empty string; the bundle's signed `intended_verifier` must equal it |
| `max_session_duration_seconds` | Integer from 1 to 300, default 300 |
| `max_revocation_age_seconds` | Integer from 1 to 300, default 300 |
| `verifier_policy` | Optional VerifierPolicy fields; each may only keep or tighten the profile's policy (§4.2) |

The profile sets requirements, not defaults. Its verifier policy is:

| Field | Value | What `verifier_policy` may set |
|---|---|---|
| `default_mode`, every `risk_overrides` tier | `hybrid_required` | Only `hybrid_required`. `pq_only` drops the classical signature, so it does not satisfy the profile |
| `require_session_binding`, `require_composite_binding`, `require_session_expiry`, `require_audience_binding` | `true` | Only `true` |
| `allow_v1_bundles`, `allow_classical_fallback_disable` | `false` | Only `false` |
| `verifier_id` | the profile's | Only the same value |
| `max_session_duration_seconds` | the profile's | From 1 to the profile's value; the smaller applies |
| `min_classical`, `min_pq` | `1` | At least 1 |
| `accepted_classical_algs` | `["ed25519"]` | A non-empty subset |
| `accepted_pq_algs` | `["ml-dsa-65", "slh-dsa-192f"]` | A non-empty subset |
| `accepted_hash_algs` | `["sha256", "sha384"]` | A non-empty subset |
| `advisory_rejected_algs` | `[]` | Any list of strings |
| `max_key_age_days` | `365` | Any integer from 0 (warnings only, as in V2-13) |
| `warn_classical_only_deprecated` | `false` | Any boolean |

Configuration errors, raised when the profile is loaded:

| Condition | Code |
|---|---|
| A field outside the schema, at the top level or in `verifier_policy` | `CONFIG_UNKNOWN_FIELD` |
| A value of the wrong type; `profile` not `"strict-v1"` | `CONFIG_INVALID_VALUE` |
| `verifier_id` missing or empty; a maximum below 1 or above 300; a `verifier_policy` value that weakens the table above | `CONFIG_PROFILE_CONTRADICTION` |

An adapter that enables the profile also rejects, with `CONFIG_PROFILE_CONTRADICTION`, a missing trust set or revocation source, and any of its own options that would weaken the profile (accepting requests without a bundle, its own verifier policy, a fail-open revocation check).

### 4.2 Profile checks

With `max` the effective maximum session duration and `m` the manifest of the bundle:

- **P1.** `bundle.dcp_bundle_version` is not `"2.0"`: `PROFILE_V2_REQUIRED`. Stop: nothing else is evaluated.
- **P2.** `m.intended_verifier` absent, null, not a string or empty: `PROFILE_AUDIENCE_MISSING`; any other value different from `verifier_id`: `PROFILE_AUDIENCE_MISMATCH`.
- **P3.** `m.session_issued_at` absent or null: `PROFILE_SESSION_START_MISSING`. `m.session_expires_at` absent or null: `PROFILE_SESSION_EXPIRY_MISSING`. Either present but not RFC 3339, or the start after the expiry: `PROFILE_SESSION_TIME_INVALID`. Otherwise:
  - the start after `now + SKEW`: `PROFILE_SESSION_NOT_STARTED`;
  - the expiry before `now`: `PROFILE_SESSION_EXPIRED`;
  - the expiry minus the start greater than `max` seconds: `PROFILE_SESSION_TOO_LONG`.
- **P4.** The `composite_sig` of the bundle signature or of the RPR is not `pq_over_classical` with a `pq` component: `PROFILE_HYBRID_REQUIRED`. After verification, also when either principal signature lacks a verified classical or PQ component, or the verification mode is not `hybrid_required`.

P2 and P3 repeat, with codes, what the profile's policy makes V2-4 enforce, so a rejected bundle says which requirement failed. They read the manifest before it is authenticated; only a verified bundle is admitted.

### 4.3 Revocation checks

Evaluated when the bundle verified, with the subjects of §2.4:

- **R1.** No snapshot: `REVOCATION_UNAVAILABLE`. Stop.
- **R2.** A snapshot outside the schema (a missing or extra field, `checked_at` not RFC 3339, a status other than the three), or `checked_at` after `now + SKEW`: `REVOCATION_INVALID`. Stop.
- **R3.** `now - checked_at` greater than `max_revocation_age_seconds`: `REVOCATION_STALE`.
- **R4.** A subject `revoked`: `REVOCATION_REVOKED`.
- **R5.** A subject absent from the snapshot or `unknown`: `REVOCATION_UNKNOWN`.

A stale snapshot that marks a subject revoked reports both codes. None of these outcomes counts as `not_revoked`.

## 5. Admission

### 5.1 Procedure

Given the signed bundle, an optional profile, an optional trust set (required by the profile), a revocation snapshot (evaluated only under the profile) and `now`:

1. Under the profile, P1; then P2, P3 and the structural part of P4.
2. Verify the bundle (V2-1 to V2-14) at `now`, under the profile's policy, or the caller's policy without a profile. Not verified: `VERIFICATION_FAILED`.
3. If verified: principal trust (§3) when a trust set is supplied; under the profile, the verified part of P4 and the revocation checks (§4.3).

### 5.2 Result

| Field | Value |
|---|---|
| `verified` | The verifier's verdict, with its meaning unchanged |
| `verification` | The verifier's full result (errors, warnings, details, signer keys) |
| `principal_trust` | `trusted`, `untrusted`, or `not_evaluated` (no trust set, or not verified) |
| `profile` | `"strict-v1"` or null |
| `profile_compliance` | `compliant`, `non_compliant`, or `not_evaluated` (no profile) |
| `admitted` | `verified`, and `principal_trust` is `trusted` when a trust set is supplied, and `profile_compliance` is `compliant` under the profile |
| `action_authorized` | Always `false` in this version (§7) |
| `recorded_decision` | The policy decision's `decision` (`approve`, `escalate`, `block`) of a verified bundle, else null |
| `trust_set_version` | The trust set's version, or null |
| `errors` | `{ code, message }` for every code added, in the order of §5.1 |

`profile_compliance` is `compliant` when the bundle verified and no `PROFILE_*` or `REVOCATION_*` code was added. A bundle that records a `block` or `escalate` decision can be admitted as evidence of that decision; `action_authorized` stays `false`.

A self-consistent bundle from an unknown principal stays verified, and is not admitted when a trust set is supplied.

### 5.3 Codes

| Code | Step |
|---|---|
| `VERIFICATION_FAILED` | §5.1 step 2 |
| `TRUST_PRINCIPAL_UNKNOWN`, `TRUST_KEY_NOT_ANCHORED`, `TRUST_KEY_REVOKED`, `TRUST_KEY_EXPIRED`, `TRUST_KEY_NOT_YET_VALID` | §3 |
| `PROFILE_V2_REQUIRED`, `PROFILE_AUDIENCE_MISSING`, `PROFILE_AUDIENCE_MISMATCH`, `PROFILE_SESSION_START_MISSING`, `PROFILE_SESSION_EXPIRY_MISSING`, `PROFILE_SESSION_TIME_INVALID`, `PROFILE_SESSION_NOT_STARTED`, `PROFILE_SESSION_EXPIRED`, `PROFILE_SESSION_TOO_LONG`, `PROFILE_HYBRID_REQUIRED` | §4.2 |
| `REVOCATION_UNAVAILABLE`, `REVOCATION_INVALID`, `REVOCATION_STALE`, `REVOCATION_REVOKED`, `REVOCATION_UNKNOWN` | §4.3 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_PROFILE_CONTRADICTION`, `CONFIG_TRUST_EMPTY_ID`, `CONFIG_TRUST_MALFORMED_KEY`, `CONFIG_TRUST_KID_NOT_DERIVED`, `CONFIG_TRUST_DUPLICATE` | Raised when a trust set or profile is loaded |

Messages are bounded and never contain private keys, tokens or the operator's configuration beyond the identifiers being compared.

## 6. Adapters and caching

The core functions are deterministic and make no network call. Adapters (middleware, tools, servers) resolve the operator's configuration, call the trust and revocation sources, and enforce the decision:

- **A1.** A request reaches the protected handler only when `admitted` is true. An adapter never proceeds on `verified` alone once trust or a profile is configured.
- **A2.** The profile, the trust set or its source, the revocation source, its URL and credentials, and the tenant come from the operator's code and configuration. No request field, header or tool parameter selects or changes them.
- **A3.** A cache MAY keep the verifier's result (step 2 of §5.1), keyed by the SHA-256 of the canonical signed bundle, the SHA-256 of the canonical effective verifier policy and the operator-derived tenant, and kept no later than the earliest of its TTL, `session_expires_at`, the RPR `expires_at` and every key's `expires_at`. Principal trust, the profile checks and revocation are evaluated on every admission, at the current `now`, with the current trust set and a fresh revocation snapshot. A cached acceptance therefore never survives a trust set change, a revocation, a different policy or a different tenant.

## 7. Guarantees and limits

Under `strict-v1`, an admitted bundle:

- verified under V2-1 to V2-14 with both signature components valid for every signature;
- was signed for the principal (RPR and manifest, both components) with keys the operator's trust set lists for that `human_id`, active and in their validity window at `now`;
- names this verifier in its signed `intended_verifier`;
- has a signed session window of at most `max_session_duration_seconds`, started (within `SKEW`) and not expired at `now`;
- has an agent and verified signer keys that a revocation snapshot at most `max_revocation_age_seconds` old reports as not revoked.

It does **not** guarantee:

- **Single use.** A shared session nonce, the audience and the expiry bound where and how long a bundle can be replayed; they do not make it single-use. A verifier that needs single use keeps its own record of consumed nonces or bundle hashes; verification and admission do not consume them.
- **Authorization of an action.** `action_authorized` is always `false`. Admission says the evidence is authentic and comes from a trusted principal; whether a tool may run with given arguments is a later phase.
- **Identity beyond the trust set.** Trust is exactly as good as the operator's trust set and its source.
- **Revocation fresher than the snapshot.** A revocation made after `checked_at` is not seen until the next snapshot.

## 8. API correspondence

| Concept | TypeScript (`@dcp-ai/sdk`) | Python (`dcp_ai.v2`) | Go (`dcp/v2`) | Rust (`dcp_ai::v2`) |
|---|---|---|---|---|
| Verify at `now` | `verifySignedBundleV2(b, registry, policy, { now })` | `verify_signed_bundle_v2(b, registry, policy, now_ms=…)` | `VerifySignedBundleV2At(registry, json, policy, now)` | `verify_signed_bundle_v2_at(&b, &policy, now_ms)` |
| Signer keys (§2.3) | `details.signer_keys` | `details["signer_keys"]` | `SignerKeys` | `signer_keys` |
| Load a trust set | `createPrincipalTrustStore(json)` | `create_principal_trust_store(json)` | `NewPrincipalTrustStore(json)` | `PrincipalTrustStore::from_json(&json)` |
| Load a profile | `resolveStrictV1Profile(json)` | `resolve_strict_v1_profile(json)` | `ResolveStrictV1Profile(json)` | `resolve_strict_v1_profile(&json)` |
| Revocation subjects | `revocationSubjects(b, verification)` | `revocation_subjects(b, verification)` | `RevocationSubjects(b, verification)` | `revocation_subjects(&b, &verification)` |
| Evaluate (no crypto) | `evaluateAdmissionV2(input)` | `evaluate_admission_v2(…)` | `EvaluateAdmissionV2(…)` | `evaluate_admission_v2(…)` |
| Verify and evaluate | `admitSignedBundleV2(b, registry, options)` | `admit_signed_bundle_v2(b, registry, …)` | `AdmitSignedBundleV2(registry, json, options)` | `admit_signed_bundle_v2(&b, &options)` |
| Configuration error | `AdmissionConfigError` (`code`) | `AdmissionConfigError` (`code`) | `*AdmissionConfigError` (`Code`) | `AdmissionConfigError` (`code`) |

Result fields keep the names of §5.2 in every SDK's JSON form.

## 9. Test vectors

[`tests/interop/v2/admission_vectors.json`](../../../tests/interop/v2/admission_vectors.json) holds the shared cases: signed bundles, trust sets, profiles, revocation snapshots, `now`, and for each case the expected `verified`, `principal_trust`, `profile_compliance`, `admitted` and set of codes, with the rule it checks. Configuration cases give the configuration and the expected error code. Every SDK runs them; agreement between SDKs is not the criterion, the expected values are.
