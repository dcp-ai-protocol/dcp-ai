# Admission: trusted principals and the strict-v1 profile

A verified bundle proves integrity and that it was signed by the keys it lists. Anyone can create a responsible principal record with any `human_id` and keys of their own, so verification alone does not tell you **who** the principal is.

Admission adds what an operator needs to accept evidence only from principals it already trusts:

- **Trusted principals.** The operator supplies a trust set: each principal's `human_id` and the public keys it may sign with. A bundle is admitted only if the keys that actually verified the principal's signatures (the RPR and the bundle manifest, classical and post-quantum) are trusted keys of that principal, active and in their validity window.
- **The strict-v1 profile.** Optional, versioned and operator-fixed: hybrid signatures for every risk tier, a signed `intended_verifier` equal to the operator's `verifier_id`, a signed session window of at most 300 seconds, and a revocation snapshot at most 300 seconds old.

The normative definition, with every rule and error code, is [`spec/profiles/admission`](../spec/profiles/admission/README.md). The shared test vectors are [`tests/interop/v2/admission_vectors.json`](../tests/interop/v2/admission_vectors.json).

## It is opt-in

Nothing changes for code that does not set a trust set or a profile. Verification keeps its behaviour and the meaning of `verified`. The verifier gains an optional clock and reports the keys it used (`details.signer_keys`); both are additive.

## The trust set

The operator writes it; it never comes from a bundle, a request, a tool parameter or a URL in an RPR. Schema: [`schemas/v2/principal_trust_set.schema.json`](../schemas/v2/principal_trust_set.schema.json).

```json
{
  "trust_set_version": "2026-11-02.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active", "expires_at": "2027-06-01T00:00:00Z" }
      ]
    }
  ]
}
```

It is refused when it is loaded if a kid is not derived from its key, a key is malformed, an identifier is empty, or a `human_id` or kid appears twice. The trust set's `status`, `not_before` and `expires_at` are authoritative: a bundle that lists a key as `active` cannot reinstate one the operator revoked.

**Rotation.** Add the new keys (with `not_before` if you like), keep the old ones `active` during the overlap, then retire them (`revoked`, `expired`, an `expires_at`, or removal), each time with a new `trust_set_version`. A bundle cannot rotate its own keys.

**Agent keys** are not listed: the principal's signature over the manifest covers the passport hash, and that binds the agent and its keys to the principal.

## The strict-v1 profile

Schema: [`schemas/v2/admission_profile.schema.json`](../schemas/v2/admission_profile.schema.json).

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example" }
```

| Requirement | Value |
|---|---|
| Bundle version | V2 only |
| Signatures | Classical and PQ, both valid, for every risk tier (`hybrid_required`; `pq_only` does not satisfy it) |
| Principal | Trusted (above), both signature components anchored |
| Session binding | Required |
| Session window | `session_issued_at` and `session_expires_at` signed in the manifest; at most `max_session_duration_seconds` (default and maximum 300); started within 30 s of clock skew; not expired |
| Audience | Signed `intended_verifier` equal to `verifier_id` |
| Revocation | A snapshot of the agent and every verified signer key, at most `max_revocation_age_seconds` old (default and maximum 300); none revoked or unknown |

The profile sets requirements, not defaults. `max_session_duration_seconds`, `max_revocation_age_seconds` and the optional `verifier_policy` may only tighten it; a value that would loosen it (`allow_v1_bundles: true`, `require_*: false`, a classical or `pq_only` mode, a longer session, another `verifier_id`) is a configuration error. Adapters also refuse their own options that would loosen it.

## Revocation sources

Revocation is resolved by a source the operator chooses; no central service is required. A source receives the subjects (`agent_ids` and `kids`) and returns a snapshot:

```json
{ "checked_at": "2026-11-02T10:00:30Z", "agents": { "agent:acme-bot": "not_revoked" }, "keys": { "<kid>": "not_revoked" } }
```

`checked_at` is when the source established the statuses. A source that times out, fails or returns nothing makes the request fail with `REVOCATION_UNAVAILABLE`; nothing is ever treated as not revoked by default.

`denyListRevocationSource` (TypeScript integrations, the reference verifier) and `deny_list_revocation_source` (Python) read a complete deny list in the format of the reference revocation service's `/.well-known/dcp-revocations.json`, with the operator's URL and headers, a timeout, no redirects and at most 16 MiB. The URL must be `https` (plain `http` only to a loopback host). A list without `revocations` or `kid_revocations` is invalid, not empty: it may have been truncated.

## Results

| Field | Meaning |
|---|---|
| `verified` | The verifier's verdict, unchanged |
| `principal_trust` | `trusted`, `untrusted`, or `not_evaluated` (no trust set, or not verified) |
| `profile` / `profile_compliance` | `strict-v1` or null / `compliant`, `non_compliant`, `not_evaluated` |
| `admitted` | The final decision under this configuration |
| `action_authorized` | Always `false`: admission does not authorize an action |
| `recorded_decision` | The policy decision the bundle records (`approve`, `escalate`, `block`) |
| `trust_set_version` | The trust set that was used |
| `errors` | `{ code, message }`; codes are listed in the spec, § 5.3 |

A bundle that records a `block` or `escalate` decision can be admitted: it is evidence of that decision, not a permission.

## Using it

### TypeScript (`@dcp-ai/sdk`)

```ts
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson);           // throws AdmissionConfigError
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
if (!result.admitted) throw new Error(result.errors.map((e) => e.code).join(', '));
```

`evaluateAdmissionV2` takes a verifier result you already have (no cryptography, no I/O), and `revocationSubjects` tells a source what to answer for. Python, Go and Rust expose the same functions; see the spec, § 8.

### Express (`@dcp-ai/express`)

```ts
import { dcpVerify, denyListRevocationSource } from '@dcp-ai/express';

app.use('/api/agents', dcpVerify({
  trustedPrincipals: trustSetJson,                               // or ({ tenant }) => trust set
  profile: { profile: 'strict-v1', verifier_id: 'api.acme.example' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
  tenant: (req) => req.auth.tenant,                              // from your own authentication
  cacheTtlSeconds: 60,
}));
```

A request reaches the route only when the bundle is admitted; `req.dcpAgent.admission` carries the result. The cache keeps only the cryptographic verification, keyed by the bundle, the verifier policy and the tenant; trust, the profile checks and revocation are evaluated on every request, so removing a principal or revoking a key takes effect on the next one. Runnable: [`integrations/express/examples/strict-v1.mjs`](../integrations/express/examples/strict-v1.mjs).

### FastAPI (`dcp_ai.fastapi`)

`DCPVerifyMiddleware(app, trusted_principals=..., profile=..., revocation_source=..., tenant=...)`, with the same rules; see [`integrations/fastapi/README.md`](../integrations/fastapi/README.md).

### OpenClaw (`@dcp-ai/openclaw`)

```ts
configureVerifier({ trustedPrincipals, profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' }, revocationSource });
```

`dcp_verify_bundle` then reports `admitted` and names the agent only for an admitted bundle. Under the profile the model's `verifier_policy` parameter is refused, and parameters the tool does not define are ignored. Runnable: [`integrations/openclaw/examples/strict-v1.mjs`](../integrations/openclaw/examples/strict-v1.mjs).

### Reference server and CLI

The verification server (`npm run server`) exposes `POST /v2/admit` when the operator sets `DCP_TRUSTED_PRINCIPALS_FILE` (loaded again whenever its content changes), and for strict-v1 also `DCP_ADMISSION_PROFILE_FILE` and `DCP_REVOCATION_LIST_URL` (with an optional `DCP_REVOCATION_LIST_AUTHORIZATION`). It refuses to start on a contradictory configuration, or with an admission variable set but empty. Offline:

```bash
npx dcp-ai admit-bundle bundle.signed.json --trust trust.json --profile profile.json --revocation snapshot.json
```

## Compatibility

- **No change without opting in.** `verifySignedBundleV2` / `verify_signed_bundle_v2` / `VerifySignedBundleV2WithPolicy` / `verify_signed_bundle_v2_with_policy` keep their results; `details.signer_keys` (or `SignerKeys`) is a new field.
- **Bundles.** No wire change. strict-v1 needs bundles signed with `session_issued_at`, `session_expires_at` and `intended_verifier` in the manifest, which every SDK signer writes when given an expiry and an audience.
- **With a trust set, V1 bundles are refused**: they carry no principal signature to anchor.
- **Integration options.** New and optional. With trusted principals, `requireBundle: false` (Express) and `require_bundle=False` (FastAPI) are configuration errors: a request without a bundle would reach the route. Under the profile, so are `verifierPolicy`, `requireHybrid: false` and the `checkRevocation` options (Express), `verifier_policy` (FastAPI) and `verifierPolicy` (OpenClaw).

## Limits

- **Replay.** The session nonce, the audience and the expiry bound where and for how long a bundle can be replayed; they do not make it single-use. A verifier that needs single use keeps its own record of consumed nonces or bundle hashes; admission does not consume them.
- **Authorization.** `action_authorized` is always `false`. Binding an external authorization to a tool, its arguments and its execution is a later phase.
- **Identity** is as good as the trust set and the process that maintains it.
- **Revocation** is as fresh as the snapshot: a revocation after `checked_at` is seen with the next snapshot.
