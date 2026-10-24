# @dcp-ai/express — Express Middleware

DCP verification middleware for Express.js. Automatically verifies Signed Bundles on each request and injects the verified agent data.

## Supported DCP Specifications

DCP-01 through DCP-09.

## Installation

```bash
npm install @dcp-ai/express @dcp-ai/sdk
```

**Peer dependency:** Express 4.18+ or 5.x

Until `@dcp-ai/sdk` 2.2.0 is on npm, this package depends on the workspace SDK (`"@dcp-ai/sdk": "file:../../sdks/typescript"`): build it first (`cd sdks/typescript && npm install && npm run build`). Publishing the package needs the dependency raised to `^2.2.0`; the publish workflow refuses a package that depends on a local path.

## Quickstart

```typescript
import express from "express";
import { dcpVerify } from "@dcp-ai/express";

const app = express();
// The bundle travels in the JSON body: give the parser a budget sized for your bundles.
app.use(express.json({ limit: "64kb" }));

// Verify DCP on all routes
app.use(dcpVerify());

app.post("/api/action", (req, res) => {
  // The verified agent is available at req.dcpAgent
  const agent = req.dcpAgent;
  console.log(`Agent ${agent.agentId} (human: ${agent.humanId})`);
  console.log(`Capabilities: ${agent.capabilities}`);
  console.log(`Risk tier: ${agent.riskTier}`);

  res.json({ ok: true, agent_id: agent.agentId });
});

app.listen(3000);
```

### Sending a bundle from the client

Send the bundle in `signed_bundle` of the JSON body. It is the recommended way for hybrid V2
bundles, and the middleware also reads the `X-DCP-Bundle` header (first) for bundles that fit in
one:

```bash
# Via body (recommended)
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}, "action": "test"}'

# Via header: only for bundles that fit the header limits of the server and every proxy
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -H "X-DCP-Bundle: $(cat signed_bundle.json)" \
  -d '{"action": "test"}'
```

A hybrid bundle (Ed25519 + ML-DSA-65) is about 33 KB: the base bundle of the admission vectors is
32,996 bytes. Node's default limit for all request headers is 16 KiB, so in `X-DCP-Bundle` it gets
`431` before Express runs; do not raise the limit to make it fit. In the body, the parser's
`limit` is your budget: a larger body gets `413` before the middleware. The budget is your choice
for your deployment, not a limit of the protocol: measure your largest bundle (it grows with the
audit trail and PQ checkpoints), leave margin, and keep proxies in front at least as permissive.
`examples/strict-v1-body.mjs` checks all of this over real HTTP (see `examples/README.md`).

## API Reference

### `dcpVerify(options?)`

Factory function that returns an Express middleware.

```typescript
import { dcpVerify } from "@dcp-ai/express";

app.use(dcpVerify({
  requireBundle: true,
  checkRevocation: false,
  cacheTtlSeconds: 300,
  headerName: "x-dcp-bundle",
  onFailure: (req, res, errors) => {
    res.status(403).json({ error: "DCP verification failed", details: errors });
  },
}));
```

### Options (`DCPVerifyOptions`)

An unknown option, an unknown `verifierPolicy` field or a value of the wrong type (for example `allow_v1_bundles: "false"`) throws when the middleware is created: a misspelt option must not switch a check off.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requireBundle` | `boolean` | `true` | Require a bundle on every request. If `false`, requests without a bundle pass through without verification. |
| `checkRevocation` | `boolean` | `false` | On every request, cached verdict or not, ask the revocation service whether the agent (`GET /check/<agent_id>`) or, for V2, any key the bundle can be signed with (`GET /v2/check/kid/<kid>` for each passport key, each RPR binding key and the bundle signature's classical and PQ kids) is revoked. A JSON answer with a truthy `revoked` rejects the request. |
| `revocationFailClosed` | `boolean` | `false` | With `checkRevocation`: what happens when a lookup gives no answer, that is when `fetch` throws (service unreachable), the response is not 2xx, the body is not JSON, or its `revoked` is missing or neither truthy nor `false`. `false` (the default) lets the request through (fail open); `true` rejects it with `403`. |
| `revocationServiceUrl` | `string` | `"http://localhost:3003"` | Base URL of the revocation service. |
| `cacheTtlSeconds` | `number` | `0` | Seconds to cache verification results. `0` disables caching. |
| `cacheMaxEntries` | `number` | `1000` | Most verified bundles kept in the cache; the least recently used is evicted first. |
| `headerName` | `string` | `"x-dcp-bundle"` | Name of the HTTP header the bundle may be sent in, read before `req.body.signed_bundle`. Only for bundles within the header limits of the server and every proxy (Node's default is 16 KiB for all headers): send hybrid bundles in the body. |
| `onFailure` | `function` | `undefined` | Custom handler for verification errors. Receives `(req, res, errors)`, and for a refused admission the admission result as a fourth argument. |
| `verifierPolicy` | `object` | `undefined` | Verifier policy fields (`VerifierPolicy` of `@dcp-ai/sdk`), merged over the SDK's `DEFAULT_VERIFIER_POLICY`. A `default_mode` given without `risk_overrides` applies to every risk tier; `risk_overrides` entries set their tiers over the others. |
| `requireHybrid` | `boolean` | `false` | Every mode below `hybrid_required` becomes `hybrid_required`, and V1 bundles are refused. |
| `requireActiveLifecycle` | `boolean` | `false` | Reject decommissioned agents (DCP-05 §5.1). V2 only. |
| `trustedPrincipals` | `object` or `function` | `undefined` | The principals you trust and their keys: a trust set (`schemas/v2/principal_trust_set.schema.json`), or `({ tenant }) => trust set` called on every request. With it, only admitted V2 bundles reach the route (see below). A function that throws, or returns `undefined`, `null` or an invalid trust set, refuses the request with `503`. |
| `profile` | `object` | `undefined` | The strict-v1 profile (`schemas/v2/admission_profile.schema.json`). Needs `trustedPrincipals` and `revocationSource`. |
| `revocationSource` | `function` | `undefined` | `(subjects, { tenant }) => snapshot`, the profile's revocation source, e.g. `denyListRevocationSource({ url, headers })`. |
| `revocationTimeoutMs` | `number` | `5000` | How long the revocation source may take before the request is refused. Under `supervise.revocation`, the supervised deadline: an integer from 1 to 2147483647. |
| `sourceSupervisor` | `object` | `undefined` | A supervisor from `createSourceSupervisor`, given together with `supervise` (see [Supervising the trust source](#supervising-the-trust-source)). |
| `supervise` | `object` | `undefined` | `{ trustTimeoutMs?, revocation? }`, at least one: `trustTimeoutMs`, an integer from 1 to 2147483647, the deadline of a `trustedPrincipals` function under `sourceSupervisor`; `revocation: true` runs the profile's `revocationSource` under it, with `revocationTimeoutMs` (see [Supervising the revocation source](#supervising-the-revocation-source)). |
| `tenant` | `function` | one tenant | `(req) => string`, from your own authenticated context, never a header the client sets. Selects the trust set and separates cached verdicts. |
| `clock` | `function` | `Date.now` | For tests. |

### `req.dcpAgent`

After successful verification, `req.dcpAgent` contains:

```typescript
interface DCPAgent {
  agentId: string;      // Agent ID
  humanId: string;      // ID of the responsible human
  publicKey: string;    // Ed25519 public key
  capabilities: string[];  // Declared capabilities
  riskTier: string;     // Risk level (low/medium/high)
  status: string;       // Status (active/suspended/revoked)
  dcpVersion: "1.0" | "2.0";
  kids?: string[];          // V2: key identifiers of the passport keys
  sessionNonce?: string;    // V2: session nonce of the bundle
  lifecycleState?: string;  // DCP-05 lifecycle state
  mandateId?: string;       // DCP-09 delegation mandate ID
  warnings?: string[];      // V2: warnings of the SDK verifier (e.g. classical-only signature)
  verificationMode?: string; // V2: the mode the bundle was verified in
  securityTier?: string;     // V2: security tier of its intent and policy decision (spec §14.2)
  admission?: {              // with trustedPrincipals
    admitted: true;
    principalTrust: "trusted";
    profile: "strict-v1" | null;
    profileCompliance: "compliant" | "not_evaluated";
    recordedDecision: string | null; // approve, escalate, block: evidence, not a permission
    trustSetVersion: string | null;
    actionAuthorized: false;         // always: admission does not authorize an action
  };
}
```

### Behavior

1. Extracts the signed bundle from the `X-DCP-Bundle` header (JSON) or from `req.body.signed_bundle`
2. Verifies it:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `verifySignedBundleV2()` from `@dcp-ai/sdk`, with an Ed25519 / ML-DSA-65 / SLH-DSA-192f registry and the policy above. It checks the artifact payload hashes and the manifest; session binding, expiry and the signed session start (`session_issued_at`); the bundle signature over the manifest, made by the principal with the RPR `binding_keys`, and the unsigned `signature` block that must agree with it; each artifact's own signature; the verification mode, the stricter of the policy mode for the passport's `risk_tier` and the mode of the security tier of the intent and policy decision (spec §14.2); PQ checkpoints; cross-artifact consistency (passport status, RPR expiry, one agent, principal and intent across the artifacts and audit entries); the audit hash chain; and key validity, kid derivation and canonical base64 keys (`spec/VERIFICATION.md` V2-1 to V2-14). A malformed bundle is rejected with `403`, never accepted on its structure alone.
   - **V1** (`bundle.responsible_principal_record.dcp_version: "1.0"`): `verifySignedBundle()`, only where VERIFICATION.md V2-10 would accept a classical-only bundle, since a V1 bundle has no post-quantum signature: `allow_v1_bundles` is `true`, `requireHybrid` is off, and the stricter of the policy mode for the V1 passport's `risk_tier` (`default_mode` when it has none) and the mode of the security tier of the V1 intent and policy decision (V1 `risk_score` is 0 to 1, scaled by 1000; a missing one counts as `elevated`) is `classical_only` or `hybrid_preferred`. Under the default policy a routine or standard V1 intent passes, while a payment, sensitive data, a high estimated impact or a risk score of 0.5 or more is refused.
   - A bundle whose version cannot be detected is rejected with `403`.
3. If valid: injects `req.dcpAgent` and calls `next()`
4. If it fails: responds with `403`, the verifier's `errors` and `warnings` (or uses `onFailure` if configured)
5. If an internal error occurs: responds with `500`

### What "verified" means

A verified bundle is internally consistent and signed by the keys it lists itself: the RPR `binding_keys` for the bundle signature, the passport keys for the agent's artifacts. It does not prove who the principal is: anyone can create keys and an RPR naming any `human_id`. For that, set `trustedPrincipals` (next section).

A verified bundle can be replayed by anyone who holds it until its session expires. Against replay, set `verifierPolicy.require_audience_binding: true` with your `verifier_id` (the bundle's `manifest.intended_verifier` must name this verifier), and `require_session_expiry` / `max_session_duration_seconds` to bound the session, or use the strict-v1 profile. None of these makes a bundle single-use: keep your own record of consumed nonces if you need that.

### Trusted principals and strict-v1

With `trustedPrincipals`, a request reaches the route only when its bundle is **admitted** (`docs/ADMISSION.md`, `spec/profiles/admission`): a V2 bundle whose principal signatures (the RPR and the bundle manifest, classical and post-quantum) were made with keys your trust set lists for that `human_id`, active and in their validity window. With `profile`, the strict-v1 requirements apply as well: hybrid signatures for every risk tier, a signed `intended_verifier` equal to your `verifier_id`, a signed session of at most 300 s, and a fresh revocation snapshot.

```typescript
import { dcpVerify, denyListRevocationSource } from "@dcp-ai/express";

app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet,
  profile: { profile: "strict-v1", verifier_id: "api.acme.example" },
  revocationSource: denyListRevocationSource({ url: "https://revocation.acme.example/.well-known/dcp-revocations.json" }),
  tenant: (req) => req.auth.tenant,
  cacheTtlSeconds: 60,
}));
```

A refused request gets `403` with `{ verified, admitted: false, principal_trust, profile, profile_compliance, codes, errors }` and never reaches the route. `denyListRevocationSource` needs an `https` URL (plain `http` only to a loopback host), follows no redirect and reads at most 16 MiB. A revocation source that fails, times out or returns nothing refuses the request (`REVOCATION_UNAVAILABLE`). With trusted principals, `requireBundle: false` throws `AdmissionConfigError` when the middleware is created: a request without a bundle would otherwise reach the route. Under the profile, `verifierPolicy`, `requireHybrid: false` and the `checkRevocation` options throw too. With trusted principals, V1 bundles are refused: they carry no principal signature to anchor. Runnable: `examples/strict-v1.mjs`, and over real HTTP with the bundle in the body and a body budget, `examples/strict-v1-body.mjs`.

The tests run every case of `tests/interop/v2/bundle_vectors.json`, each under its `verifier_policy_overrides`.

### Supervising the trust source

Without these options a `trustedPrincipals` function has no deadline, as before. With them, it gets one, and a share of a capacity:

```typescript
import { createSourceSupervisor, dcpVerify } from "@dcp-ai/express";

// One object per process, shared by every middleware (and by @dcp-ai/openclaw) that should share one capacity.
const supervisor = createSourceSupervisor({ maxInFlight: 64, maxInFlightPerTenant: 8 });

app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  tenant: (req) => req.auth.tenant,
}));
```

- **Deadline.** The function gets `{ tenant, signal }`. A trust set that arrives after `trustTimeoutMs` is not used, also when the event loop was too busy to run the timer: the deadline is measured on a monotonic clock when the result arrives. The request then gets the same `503` as a source that fails (`TRUST_SOURCE_FAILED`), and `signal` is aborted.
- **Capacity.** `maxInFlight` counts the calls the middleware started that have not settled yet, across every tenant; `maxInFlightPerTenant` caps one tenant, and without it one tenant can take the whole capacity. A call that finds no free slot gets the same `503` at once; there is no queue. **A slot is freed only when the function really settles**, not when the request times out: a source that never settles keeps its slot, and once every slot is taken the middleware refuses every request until you restart the process or create another supervisor.
- **Scope.** The capacity is per supervisor object. Two supervisors are two capacities, so the bound of a process is the sum of the supervisors it creates. A supervisor created by `@dcp-ai/openclaw`, from its ESM or CJS build, works here too, and the reverse.
- **`supervisor.close({ drainMs })`** refuses new calls, answers pending ones with `503`, aborts every `signal`, and waits at most `drainMs` (default 0) for calls in flight. It resolves with how many are still in flight; their slots stay taken.
- **`supervisor.stats()`** returns counters: `open`, `inFlight`, `tenants`, `timeouts`, `saturated`, `closed`, `lateResults`, `lateErrors`, `droppedEvents`. `onSourceEvent` in `createSourceSupervisor` gets `{ source, reason, inFlight }`, never a tenant. It must be fast, because it runs on the same event loop: one call at a time, and events that arrive while one is queued or its promise is pending are dropped and counted. A returned promise or thenable is assimilated as `Promise.resolve` does: a thenable resolved with a pending promise keeps it busy, and a resolver called again later frees nothing. Its errors and rejections are ignored. Counters stop at `Number.MAX_SAFE_INTEGER`.
- **What it does not do.** It does not stop a source's work: a function that ignores `signal` runs to its end. It does not bound work a function starts on its own and does not return. It does not help a function that blocks the event loop, which delays every deadline. The verification of a bundle still runs before the trust source. Without `supervise.revocation`, revocation keeps `revocationTimeoutMs` as before.

#### Supervising the revocation source

With the strict-v1 profile, `supervise: { revocation: true }` runs the `revocationSource` under the same kind of supervisor, with `revocationTimeoutMs` as its deadline (then an integer from 1 to 2147483647):

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet, // a static trust set, or a function supervised with trustTimeoutMs
  profile: { profile: "strict-v1", verifier_id: "verifier:acme-api" },
  revocationSource: denyListRevocationSource({ url: "https://revocations.example.com/.well-known/dcp-revocations.json" }),
  revocationTimeoutMs: 2000,
  sourceSupervisor: supervisor,
  supervise: { revocation: true }, // or { trustTimeoutMs: 2000, revocation: true }
}));
```

- **Opt-in.** `supervise` takes `trustTimeoutMs`, `revocation: true` or both. `revocation: true` needs a `revocationSource`, and works with a static trust set. Without it, revocation keeps `revocationTimeoutMs` as before.
- **The same responses.** The source gets `(subjects, { tenant, signal })`, and each answer gives the response it gives without supervision. A snapshot is evaluated as before. `null`, a failure, a timeout, a call with no free slot and a closed supervisor give `403` with `codes: ["REVOCATION_UNAVAILABLE"]`, never not revoked. An error whose `code` is `REVOCATION_INVALID` gives `REVOCATION_INVALID` only when it arrives before the deadline; after it, it is a timeout.
- **One capacity.** Trust and revocation calls take slots of the same supervisor, each held until its source really settles. A late snapshot is never used, for its request or any other, and the verdict cache never holds one.
- **`denyListRevocationSource`** aborts its fetch, and the read of its body, when the supervisor's `signal` aborts, as well as at its own `timeoutMs`.
- **Telemetry.** Its events carry `source: 'revocation'`.
- **Limits.** The same limits as for the trust source. The legacy `checkRevocation` / `revocationServiceUrl` path is not supervised.

### Cache

When `cacheTtlSeconds > 0`, each middleware keeps its own cache of verified bundles, keyed by the SHA-256 of the signed bundle's canonical form (`canonicalizeV2`), the fingerprint of the verifier policy and the tenant: a cached verdict is only reused for the same bundle, under the same policy, for the same tenant, and a bundle without a canonical form (a non-integer number such as `1e999`, or nesting too deep) is verified but not cached. An entry expires after `cacheTtlSeconds`, or earlier when the bundle's session (`manifest.session_expires_at`), the RPR, a passport key or an RPR binding key expires; a bundle with an expiry timestamp that is not RFC 3339 is not cached. The cache holds at most `cacheMaxEntries` bundles, evicting expired entries and then the least recently used. With `checkRevocation`, revocation is checked again on every cache hit. With `trustedPrincipals`, the cache holds only the cryptographic verification: principal trust, the profile checks and revocation are evaluated on every request, so a principal removed from the trust set or a key revoked is refused on the next request.

## Advanced Example — Selectively Protected Routes

```typescript
import express from "express";
import { dcpVerify } from "@dcp-ai/express";

const app = express();
app.use(express.json());

// Public routes (no verification)
app.get("/health", (req, res) => res.json({ ok: true }));

// Protected routes (require DCP)
const protected = express.Router();
protected.use(dcpVerify({ cacheTtlSeconds: 60 }));

protected.post("/agent/action", (req, res) => {
  res.json({ agent: req.dcpAgent.agentId });
});

protected.get("/agent/profile", (req, res) => {
  res.json(req.dcpAgent);
});

app.use("/api", protected);
app.listen(3000);
```

## Development

```bash
# Install dependencies
npm install

# Build (ESM + CJS)
npx tsup src/index.ts --format esm,cjs --dts

# Type check
npx tsc --noEmit
```

### Dependencies

- `@dcp-ai/sdk` — DCP verification SDK
- `express` (peer) — HTTP framework

## License

Apache-2.0
