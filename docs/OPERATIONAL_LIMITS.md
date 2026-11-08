# Operational limits

What bounds the inputs, the trust and revocation sources, concurrency, client disconnection and the verdict cache of the TypeScript, Python, Go and Rust SDKs and of the Express and FastAPI adapters, and what you, as the operator, have to set. It describes the source in this repository; a published package has what its own version includes (see [Published versions](README.md#published-versions)).

Nothing on this page changes the wire format, `dcp-jcs-v1`, a profile or a signature. Four layers set limits, and they are kept apart:

- **The protocol** fixes per-field lengths and the strict-v1 freshness windows.
- **The SDKs** verify, admit and compose. Those APIs take no deadline or cancellation signal; the Python deny-list helper has a download timeout of its own, separate from the cryptography.
- **The adapters** add optional budgets, deadlines, capacity and cancellation, all opt-in.
- **You** choose their values, the tenant, the rate limit and the infrastructure in front of them.

The [sample configuration](#a-sample-configuration) at the end is one starting point, not a default and not a rule.

## Who sets what

| Limit | Where it comes from |
|---|---|
| strict-v1 session length and revocation snapshot age: at most 300 s | The [admission profile](ADMISSION.md#the-strict-v1-profile) (normative) |
| `sig_b64` at most 66 476 characters, a public key at most 3456, `intended_verifier` at most 256 | The V2 schemas (normative, per field) |
| Number of audit entries, PQ checkpoints, keys, trusted principals, deny-list entries, mandates in a chain, delegator bundles | No schema or SDK limit: bounded only by what you let in. The verification cost grows with them |
| Nesting depth | No common budget. Each runtime's parser and stack refuse at their own level; the opt-in `admitSignedBundleV2FromBytes` refuses more than 64 levels |
| Request body | Express: the `limit` of your body parser. FastAPI: `max_body_bytes`, opt-in, unset by default. Reference server: 1 MiB |
| Bundle in a header | The header limits of your server and every proxy (Node's default is 16 KiB); `max_body_bytes` does not cover headers |
| Deny-list download | The deny-list helpers: at most 16 MiB, no redirects, a timeout you set |
| Source deadlines and capacity | The source supervisor, opt-in, with no default capacity |
| Express verdict cache | Off by default (`cacheTtlSeconds` 0); at most `cacheMaxEntries` (1000 by default) when on |
| Tenant | Your own authentication, never a header the client chooses |
| Request rate | You (the Express example uses `express-rate-limit`) |

## Inputs

- **Send the bundle in the body**, with a body budget that is checked before parsing. A typical V2 bundle with hybrid signatures is larger than Node's default header limit.
- **The body budget is an input budget you set.** Each signature, audit entry and PQ checkpoint adds work, and the schemas do not limit how many there are. Together with the cardinalities you accept, your verifier policy, and the CPU and concurrency you allow outside the adapter, it bounds how much work one request can bring. It is not a CPU deadline, and it does not bound APIs that your code calls with objects built outside HTTP. Size it for the bundles you expect, not for the largest one possible.
- **Depth.** In the current code and in the maintainers' local samples, a body nested deeper than the runtime handles was refused, not admitted, at a different place in each adapter: Express reported a verification failure (`Malformed signed bundle: Maximum call stack size exceeded`); FastAPI answered 403 `Missing DCP signed bundle`, because it could not read the body as JSON. Depth limits differ between runtimes and are not part of the protocol.

## Trust and revocation sources

There are four distinct actions when a source is slow or never answers. An adapter can do the first three; only the source itself can do the fourth.

1. **Stop waiting.** The request is answered with a failure.
2. **Refuse the late result.** A value that arrives after the deadline is never used.
3. **Ask for cancellation.** An `AbortSignal` is aborted (Express) or the task is cancelled (FastAPI).
4. **Stop the work.** Only a source that cooperates does this.

**With a source supervisor** (`sourceSupervisor` and `supervise`, or `source_supervisor` and `supervise`):

- A trust source that does not answer in time gets 503, and a revocation source 403 `REVOCATION_UNAVAILABLE`.
- The late result is never used.
- The deadline is measured on a monotonic clock, but it only fires when the event loop is free: a busy CPU or a source that blocks the loop delays the answer.
- The supervisor counts the invocation it owns until that invocation really settles. A source that ignores cancellation keeps its slot after the answer, until it ends.
- Work that a source starts on its own (threads, processes, tasks it does not return) is not counted or bounded by the adapter.

**Without a supervisor:**

| Source | Express | FastAPI |
|---|---|---|
| Trust | No deadline: the request waits for the source | No deadline. A synchronous source runs on the event loop and blocks it |
| Revocation | `revocationTimeoutMs`: the answer is sent, the source keeps running and is not counted | `revocation_timeout` uses `asyncio.wait_for`, which waits for the source to finish cancelling. A source that suppresses the cancellation delays the answer, and its late snapshot is used. A synchronous source keeps running in its thread |

Use a supervisor in production. Express's older `checkRevocation` option has no deadline and no size limit, is refused by strict-v1, and is outside this guidance.

**Deny lists:**

- **TypeScript.** The Express helper `denyListRevocationSource` aborts its download at its timeout or on the supervisor's signal, including while the body is being read.
- **Python.** The helper `deny_list_revocation_source` checks its timeout between reads, so it does not bound DNS resolution or a status line and headers sent slowly. Give it a `DenyListWorkers` budget: that bounds the download threads, which are a separate reservation from the supervisor's slot. `DenyListWorkers` counts a download until its fetch returns; its thread may still be finishing for a moment after that.
- **Go and Rust** have no deny-list source: you build the revocation snapshot and pass it to admission.

Each invocation of a deny-list helper downloads the list again (a request refused before the revocation stage does not). A large list downloaded by many requests at once uses buffers and objects for each of them: keep lists small. If you serve snapshots from a cache of your own, keep it per tenant and within the profile's freshness window: the admission rules do not change.

## Concurrency and tenants

- **Capacity belongs to the supervisor object, not the process.** Share one supervisor to share one capacity. The trust and revocation sources of a request take slots from the same supervisor.
- **Which stage refuses first depends on what is supervised.** With a `trustedPrincipals` function under supervision (as in the sample configuration, which supervises both sources), a request needs a trust slot first: while the slots are taken, by trust or by revocation calls, a new request is refused at the trust stage with 503, before any source is called. With a static trust set and only the revocation source supervised, there is no trust slot to take, and a request without a free slot is refused at the revocation stage with 403 `REVOCATION_UNAVAILABLE`.
- **Without `maxInFlightPerTenant` / `max_in_flight_per_tenant`, there is no isolation between tenants:** one tenant can take every slot.
- **The tenant must come from your authentication.** Never take it from a header the client sets.
- **Verification uses the CPU.** In TypeScript and Python it runs on the event loop; in Go and Rust, in the caller's thread. Under concurrency, requests queue for it. Capacity limits sources, not CPU or HTTP concurrency: bound those with your rate limiting, workers and infrastructure.

## Client disconnection

With `cancelOnDisconnect` (Express) or `cancel_on_disconnect` (FastAPI, which also needs `max_body_bytes`):

- **What counts as leaving.** The client really leaves when the response closes before it is sent, or the upload is cut short. Express does not take a request's own `close` after its body as leaving.
- **What happens.** Only that request's supervised source invocation is cancelled. Nothing more is done for the request: no handler, no cache write, no `onFailure` and no response.
- **What it does not do.** A verification already running is not interrupted. A source that ignores the cancellation keeps its slot until it ends.

## No cancellation in the SDKs

No verification, admission or composition API of the SDKs (delegated admission and activation included) takes a deadline, an `AbortSignal` or a `context.Context`. The Python deny-list helper's download timeout is separate, and does not apply to the cryptography:

- TypeScript and Python verify on the event loop.
- Go and Rust are synchronous.
- WASM is synchronous.

Once started, a verification runs to its end. Bound its cost with the input budget, and its concurrency outside the SDK.

## The verdict cache (Express)

- **Off by default.** Keep it off unless your own measurements justify it.
- **What it holds, on the admission path** (`trustedPrincipals`, with or without strict-v1): only the cryptographic verification result, under a hash key; not the bundle, a snapshot or any authorization. Principal trust is evaluated on every request, cached or not, and so are the profile checks and revocation when they are configured. A trust set without a profile does not gain the strict-v1 revocation checks.
- **On the verification-only path** (no `trustedPrincipals`) it also holds the extracted agent and its key ids. Trust and profile checks need the admission path, which is then no longer verification-only; `checkRevocation`, if set, is evaluated on every request.
- **The key.** It covers the canonical bundle, the verifier policy and the tenant.
- **Expiry and eviction.** An entry expires with its TTL, the bundle's session or its keys. When the cache is full, the least recently used entry is evicted.
- **Memory.** The memory of the process is not the cache alone, and the size of the bundle does not translate into the size of an entry.
- **Other adapters and the SDK.** FastAPI has no cache. The TypeScript SDK's `VerificationCache` is a separate utility that the adapters do not use.

## Delegation in the adapters

- **Where delegated admission is.** The TypeScript, Python, Go and Rust SDKs offer delegated admission (`admitDelegatedBundleV2` and its counterparts), activation (`evaluateDelegationActivationV2`) and admission from bytes (`admitSignedBundleV2FromBytes`).
- **Where it is not.** WASM does not expose them, and neither adapter calls them.
- **`mandateId` and `require_dcp_mandated`.** Express's `req.dcpAgent.mandateId` is copied from the bundle's manifest and verifies no mandate chain. FastAPI's `require_dcp_mandated` only checks a `mandate_id` that the middleware never fills for V2 bundles, and verifies no chain either.
- **What your application does.** It calls the SDK API itself, bounds the evidence it accepts (chain length, number of delegator bundles, bytes) and decides authorization and replay.

## Other surfaces

| Surface | Limits |
|---|---|
| OpenClaw (`@dcp-ai/openclaw`) | Same deadline, capacity and deny-list helper as Express. Its input is the object the host already parsed, with no budget of its own, and it has no `cancelOnDisconnect` |
| Reference server (`/v2/admit`) | Bodies of at most 1 MiB. A 30 s socket inactivity timeout that answers 408 without cancelling work. Revocation within 5000 ms by default, aborting the download. The trust file is read on every admission. State in memory, one instance. For reproduction, not production |
| CLI (`dcp-ai`) | One invocation per process, with no deadline and no budget of its own: the caller has to impose them |

## A sample configuration

One starting point for a pilot, used to exercise the adapters. **It is not a default, a recommendation for every deployment, or part of the protocol.** Size each value for your bundles, sources and hardware.

| Setting | Sample value |
|---|---|
| Body budget | 64 KiB (Express parser `limit`; FastAPI `max_body_bytes=65536`) |
| Transport | Body, not header |
| Supervisor | 32 invocations at once, 8 per tenant |
| Trust deadline | Express: `supervise.trustTimeoutMs: 2000` (milliseconds). FastAPI: `supervise={"trust_timeout": 2.0}` (seconds) |
| Revocation deadline, supervised | Express: `revocationTimeoutMs: 2000` with `supervise.revocation: true`. FastAPI: `revocation_timeout=2.0` with `supervise={"revocation": True}` |
| Deny-list download | Express helper: `timeoutMs: 1500`. Python helper: `timeout=1.5`. Inside the revocation deadline: it asks the download to end sooner, it does not guarantee that its work ends |
| Python downloads at once | `DenyListWorkers(max_workers=8, max_workers_per_tenant=2)`: it counts active downloads, not the exact number of threads |
| Client disconnection | On |
| Express verdict cache | Off |
| Delegated evidence (your application) | At most 4 mandates in a chain, each bundle within the body budget |

**What this page does not claim:**

- Capacity, latency or memory figures for your deployment.
- The absence of leaks.
- Acceptance of evidence beyond what each API documents.

Measure in your own environment.
