# dcp_ai.fastapi — FastAPI Middleware

DCP verification middleware for FastAPI. Automatically verifies Signed Bundles and provides dependency injection for protected routes.

## Supported DCP Specifications

DCP-01 through DCP-09.

## Installation

```bash
pip install "dcp-ai[fastapi]"
```

## Quickstart

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Add verification middleware
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route (no bundle required)
@app.get("/health")
async def health():
    return {"ok": True}

# Protected route (requires a verified bundle)
@app.post("/api/action")
async def agent_action(agent: DCPAgentContext = Depends(require_dcp)):
    return {
        "agent_id": agent.agent_id,
        "human_id": agent.human_id,
        "capabilities": agent.capabilities,
        "risk_tier": agent.risk_tier,
    }
```

### Sending a bundle

```bash
# Via header
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -H "x-dcp-bundle: $(cat signed_bundle.json)" \
  -d '{}'

# Via JSON body
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}}'
```

## API Reference

### `DCPVerifyMiddleware`

Starlette/FastAPI middleware that intercepts requests and verifies DCP bundles.

```python
app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=False,       # If True, rejects requests without a bundle
    header_name="x-dcp-bundle", # Header where the bundle is sent
    verifier_policy={"default_mode": "hybrid_required"},  # Optional, over DEFAULT_VERIFIER_POLICY
)
```

#### Constructor Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `app` | `Any` | (required) | ASGI application |
| `require_bundle` | `bool` | `False` | Rejects requests without a bundle with 403 |
| `header_name` | `str` | `"x-dcp-bundle"` | HTTP header name |
| `verifier_policy` | `dict \| VerifierPolicy \| None` | `None` | Verifier policy. A dict sets `VerifierPolicy` fields over `DEFAULT_VERIFIER_POLICY`: a `default_mode` without `risk_overrides` applies to every risk tier, a `risk_overrides` dict sets its tiers over the others, and `risk_overrides=None` keeps the default tiers. A `VerifierPolicy` is validated again, and a risk tier its `risk_overrides` leaves out (every tier when it is `None`) gets its `default_mode`, as the V2 verifier resolves it. Unknown fields, risk tiers or modes raise when the middleware is built. |
| `dcp_version` | `str` | `"2.0"` | Stored but not enforced. Whether V1 bundles are accepted is up to `verifier_policy` (see below); `require_dcp_v2` restricts a route to V2. |
| `trusted_principals` | `dict \| callable \| None` | `None` | Keyword only. The principals you trust and their keys: a trust set (`schemas/v2/principal_trust_set.schema.json`, validated when the middleware is built), or `(tenant) -> trust set` (sync or async) called on every request. With it, only admitted V2 bundles reach the route, and `require_bundle=True` is required (see [Trusted principals and strict-v1](#trusted-principals-and-strict-v1)). |
| `profile` | `dict \| None` | `None` | Keyword only. The strict-v1 profile (`schemas/v2/admission_profile.schema.json`), loaded when the middleware is built. Needs `trusted_principals` and `revocation_source`; sets the verifier policy itself. |
| `revocation_source` | `callable \| None` | `None` | Keyword only, with `profile`. `(subjects, tenant) -> revocation snapshot \| None`, sync (run in a worker thread) or async, called on every admission of a verified bundle. `deny_list_revocation_source(url)` builds one. |
| `revocation_timeout` | `float` | `5.0` | Keyword only. Seconds the revocation source has to answer. Under `{"revocation": True}`, the supervised deadline: more than 0 and up to 2147483.647. |
| `tenant` | `callable \| None` | `None` | Keyword only. `(request) -> str`, sync or async, your own code (for instance the tenant of the caller your authentication set on `request.state`). Passed to the trust and revocation callables. Default: always `""`. |
| `clock` | `callable \| None` | `None` | Keyword only, for tests: the time in milliseconds since the epoch. Default: the system clock. |
| `source_supervisor` | `SourceSupervisor \| None` | `None` | Keyword only, with `supervise`. See [Supervising the trust source](#supervising-the-trust-source). |
| `supervise` | `dict \| None` | `None` | Keyword only: `{"trust_timeout": seconds}`, more than 0 and up to 2147483.647, for an async `trusted_principals`; `{"revocation": True}` for an async `revocation_source`, under `revocation_timeout`; or both. See [Supervising the revocation source](#supervising-the-revocation-source). |
| `max_body_bytes` | `int \| None` | `None` | Keyword only. A positive integer (not a `bool`, `float`, string, `0` or negative): the request body bytes the middleware accepts. Needs Starlette 0.28.0 or later. Default: no budget, as before. See [Body budget](#body-budget). |

#### Behavior

0. With `max_body_bytes`, the body is read first, within the budget (see [Body budget](#body-budget)).
1. Extracts the signed bundle from the header or JSON body (`signed_bundle`). A header that is not JSON, holds an integer over Python's 4300-digit limit or is nested too deeply counts as no bundle (`403` with `require_bundle=True`), never a `500`.
2. Verifies it with the Python SDK:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `await verify_signed_bundle_v2(signed_bundle, registry, policy)` from `dcp_ai.v2`, with an Ed25519 / ML-DSA-65 / SLH-DSA-192f registry and the policy above. It checks the payload hashes and the manifest, session binding and expiry, the bundle's and every artifact's composite signature, the verification mode (the stricter of the policy's mode for the passport's risk tier and the intent's security tier), the audit hash chain and key validity. `composite_sig_valid` is the verifier's result for the bundle signature.
   - **V1** (`bundle.responsible_principal_record.dcp_version: "1.0"`): `verify_signed_bundle()`, only where VERIFICATION.md V2-10 would accept a classical-only bundle, since a V1 bundle has no post-quantum signature: `allow_v1_bundles` is true, the policy accepts ed25519 (in `accepted_classical_algs`, not in `advisory_rejected_algs`) and requires no audience binding, session expiry or maximum session duration (a V1 bundle has no `intended_verifier` and no session window), the bundle's `responsible_principal_record`, `agent_passport`, `intent` and `policy_decision` are objects and its `audit_entries` a list of objects, the passport's `agent_id` and the RPR's `human_id` are strings (and the passport's `public_key` and `status`, when present, strings, its `capabilities` a list of strings), since they go into the agent context, and the stricter of the policy mode for the V1 passport's `risk_tier` (`default_mode` when it has none) and the mode of the security tier of the V1 intent and policy decision (V1 `risk_score` is 0 to 1, scaled by 1000; a missing one counts as `elevated`) is `classical_only` or `hybrid_preferred`. Under `DEFAULT_VERIFIER_POLICY` a routine or standard V1 intent passes; a payment, sensitive data, a high estimated impact or a risk score of 0.5 or more is refused.
   - A bundle whose version cannot be detected is rejected.
3. If valid: stores `DCPAgentContext` in `request.state.dcp_agent`, with the verifier's `warnings`
4. If it fails: responds with `403`, the verifier's `errors` (and, for V2, `warnings`): at most 20 of each, of at most 500 characters, with the control and format characters of bundle-supplied text escaped. The context's `warnings` are bounded the same way.
5. If no bundle and `require_bundle=False`: continues without verification

#### Body budget

`max_body_bytes` is opt-in; without it the middleware reads the body as before, with no limit of its own. With it, the middleware reads the whole request body before anything else (the bundle header, JSON parsing, the tenant and trust set, verification, revocation, the route), also when the bundle comes in the header and with `require_bundle=False`:

- A `Content-Length` over the budget gets `413` `{"verified": false, "errors": ["Request body exceeds max_body_bytes"]}` before any body byte is received.
- The bytes actually received are counted too, so a request with no `Content-Length`, a chunked body or a `Content-Length` that is too small gets the same `413` on the first ASGI message that takes them over the budget (that message has already been delivered), and nothing after it is received.
- A `Content-Length` that is not a single run of ASCII digits (a sign, a decimal point, spaces, a list) or that appears twice gets `400` `["Invalid Content-Length"]`, and a client that disconnects while sending the body gets `400` `["Request body could not be read"]`. Neither reaches the route.
- A body within the budget, empty or malformed bodies included, is handled exactly as without the option, and the route reads it as usual (`request.body()`, `request.json()`, `request.stream()`): Starlette's `BaseHTTPMiddleware` passes on a body read in the middleware from Starlette 0.28.0.
- The option therefore needs Starlette 0.28.0 or later: with an older Starlette, or one whose version cannot be read, `max_body_bytes` raises `AdmissionConfigError` (`CONFIG_INVALID_VALUE`) when the middleware is built. Upgrade FastAPI/Starlette or leave it unset. Without the option nothing is checked, and the package's own minimum versions are unchanged.

It is a limit on the body bytes received, set by your deployment, not part of the DCP protocol: it does not bound decompression (it counts the bytes the ASGI server delivers), JSON depth, time or a disconnect after the read. Set it with your server's own limits.

#### Supervising the trust source

Without these options an async or sync `trusted_principals` runs as before, with no deadline. With them, an **async** one gets a deadline and a slot of a capacity:

```python
from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor

supervisor = SourceSupervisor(max_in_flight=64, max_in_flight_per_tenant=8)  # one per event loop / worker

async def trust_set_for(tenant):
    return await load_trust_set(tenant)

app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=trust_set_for,
                   source_supervisor=supervisor, supervise={"trust_timeout": 2.0})
```

- **Deadline.** The source runs as a Task the supervisor owns. A trust set that arrives after `trust_timeout`, measured with `loop.time()` when it arrives and again when it is used, is not used. The request gets the same `503` as a failing source, and the Task is asked to cancel; nothing waits for it to cooperate.
- **Capacity.** At most `max_in_flight` source calls run at once, with no queue. `max_in_flight_per_tenant` caps one tenant; without it, one tenant can take the whole capacity. A call that finds no free slot gets the `503` at once, without calling the source. **A slot is freed only when the source's Task really finishes**, not when the request is answered: a source that ignores cancellation keeps its slot. Once every slot is taken this way, every request gets `503` until those sources finish or the process restarts.
- **Failures.** A source that cancels itself, a cancelled caller (whose source keeps its slot until it finishes) and an invalid trust set all fail closed. A static or synchronous `trusted_principals` with these options raises `AdmissionConfigError`: a synchronous one would run on the event loop, where no deadline holds.
- **Scope.** The capacity is per `SourceSupervisor` object, shared by the middlewares you give it to. It binds to the first event loop that uses it, so give each worker process or loop its own. Calls from another loop or thread fail closed, and a `close()` from another loop raises `RuntimeError` without changing anything.
- **`await supervisor.close(drain_timeout=0)`** refuses new calls, answers pending ones with `503`, asks every source Task to cancel and waits at most `drain_timeout` seconds. It returns `{"in_flight": n}`; those slots stay taken, and there is no reopening.
- **`supervisor.stats()`** returns counters, with no tenant: `open`, `in_flight`, `tenants`, `timeouts`, `saturated`, `closed`, `wrong_loop`, `late_results`, `late_errors`. They stop at 2**53 - 1.
- **What it does not do.** It does not stop work that ignores cancellation, bound work a source starts on its own, or isolate CPU. An `async def` that blocks the event loop delays every deadline. A server or `asyncio.run` shutting down may still wait for a source Task that ignores cancellation. Without `{"revocation": True}`, revocation keeps `revocation_timeout` as before. The trust source is still asked before the bundle is verified, as before.

#### Supervising the revocation source

With the strict-v1 profile, `supervise={"revocation": True}` runs an **async** `revocation_source` as a Task of the same kind of supervisor, with `revocation_timeout` as its deadline:

```python
app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=TRUST_SET,  # static, or async with trust_timeout
                   profile={"profile": "strict-v1", "verifier_id": "verifier:acme-api"},
                   revocation_source=deny_list_revocation_source("https://revocations.example.com/.well-known/dcp-revocations.json"),
                   revocation_timeout=2.0, source_supervisor=supervisor,
                   supervise={"revocation": True})  # or {"trust_timeout": 2.0, "revocation": True}
```

- **Opt-in.** `supervise` takes `trust_timeout`, `"revocation": True` or both. `"revocation": True` needs an async `revocation_source` (an `async def`, an object with an async `__call__`, or either inside `functools.partial`), and works with a static trust set. A synchronous one raises `AdmissionConfigError`, because it would run in a worker thread the supervisor does not own. Without the option nothing changes: a synchronous source still runs in a worker thread, under `asyncio.wait_for`.
- **The same responses.** Each answer gives the response it gives without supervision. A snapshot is evaluated as before. `None`, an exception, a timeout, a source that cancels itself, no free slot, a closed supervisor and a supervisor bound to another loop give `403` with `codes: ["REVOCATION_UNAVAILABLE"]`, never not revoked. An exception whose `code` is `REVOCATION_INVALID` gives `REVOCATION_INVALID` only when it arrives before the deadline.
- **A changed case.** Without the option, `asyncio.wait_for` waits for a source that suppresses its cancellation, and uses the snapshot it then returns. With the option, the request gets `REVOCATION_UNAVAILABLE` at the deadline, and that late snapshot is never used.
- **One capacity.** Trust and revocation calls take slots of the same supervisor, each held until its Task really finishes.
- **A limit of `deny_list_revocation_source`.** It fetches in `asyncio.to_thread`. Cancelling its Task ends the Task, and frees its slot, but not the worker thread: that thread keeps its connection until its own `timeout` or the server closes it. The supervisor does not bound those threads, and does not cancel their I/O.

#### What "verified" means

A verified bundle is internally consistent and signed by the keys it lists itself (the passport keys and the RPR binding keys). It does not prove who the principal is: anyone can create keys and an RPR naming any `human_id`. For that, set `trusted_principals` (next section). A verified bundle can also be replayed until its session expires; `verifier_policy={"require_audience_binding": True, "verifier_id": "my-service"}` (the bundle's `manifest.intended_verifier` must name this verifier), `require_session_expiry` and `max_session_duration_seconds` limit that, as does the strict-v1 profile. None of these makes a bundle single-use: keep your own record of consumed nonces if you need that.

### Trusted principals and strict-v1

With `trusted_principals`, a request reaches the route only when its bundle is **admitted** (`docs/ADMISSION.md`, `spec/profiles/admission`): a V2 bundle whose principal signatures (the RPR and the bundle manifest, classical and post-quantum) were made with keys your trust set lists for that `human_id`, active and in their validity window. With `profile`, the strict-v1 requirements apply as well: hybrid signatures for every risk tier, a signed `intended_verifier` equal to your `verifier_id`, a signed session of at most 300 s, and a revocation snapshot at most 300 s old that reports the agent and every signer key as not revoked.

```python
import os

from dcp_ai.fastapi import DCPVerifyMiddleware, deny_list_revocation_source

app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=True,
    trusted_principals=trust_set,  # or a callable: lambda tenant: trust_sets[tenant]
    profile={"profile": "strict-v1", "verifier_id": "api.acme.example"},
    revocation_source=deny_list_revocation_source(
        "https://revocation.acme.example/.well-known/dcp-revocations.json",
        headers={"Authorization": f"Bearer {os.environ['REVOCATION_TOKEN']}"},
    ),
    tenant=lambda request: request.state.tenant,  # set by your own authentication
)
```

- **Refused requests** get `403` with `{"verified", "admitted": false, "principal_trust", "profile", "profile_compliance", "codes", "errors"}` (`codes` sorted, `errors` as `"CODE: message"`, bounded and escaped) and never reach the route. V1 bundles are refused: they carry no principal signature to anchor. If the tenant callable or the trust set source fails, or returns something invalid, the request gets `503` and does not reach the route either.
- **Admitted requests** get `request.state.dcp_agent` as above, with `admitted=True`, `principal_trust`, `profile`, `profile_compliance`, `recorded_decision` (the bundle's `approve`, `escalate` or `block`) and `trust_set_version`. `action_authorized` is always `False`: admission says the evidence is authentic and comes from a trusted principal, not that an action may run.
- **Every request is evaluated again**: the trust callable and the revocation source are called on each admission, so a principal removed from the trust set, a key marked `revoked` there or a revocation listed by the source refuses the same bundle on the next request.
- **Revocation fails closed.** A source that raises, times out (`revocation_timeout`) or returns `None` gives `REVOCATION_UNAVAILABLE`; an exception whose `code` is `REVOCATION_INVALID`, or a snapshot outside `schemas/v2/revocation_snapshot.schema.json`, gives `REVOCATION_INVALID`. None of them is taken as not revoked.
- **`deny_list_revocation_source(url, *, headers=None, timeout=5.0)`** reads a complete deny list in the format of the reference revocation service's `/.well-known/dcp-revocations.json` (`updated_at`, `revocations[].agent_id`, `kid_revocations[].revoked_kid`) with the standard library: the snapshot's `checked_at` is `updated_at`, a listed agent or key is revoked and every other subject not revoked. A network error, a timeout or a non-2xx answer is `REVOCATION_UNAVAILABLE`, a body of another shape `REVOCATION_INVALID`. It follows no redirects (your headers go only to your URL), and HTTPS needs TLS 1.2 or later. Use `https` and keep credentials in environment variables or a vault.
- **Configuration comes only from your code.** The trust set, profile, policy, revocation source and tenant are never read from a request header, query or body: a request that names another tenant changes nothing.
- **Configuration errors** raise `AdmissionConfigError` (with a `code`) when the middleware is built: `trusted_principals` or `profile` without `require_bundle=True`, a profile without `trusted_principals` or `revocation_source`, or with `verifier_policy` (`CONFIG_PROFILE_CONTRADICTION`); an invalid trust set or profile (its own code); a wrongly typed argument, or `revocation_source` without `profile` (`CONFIG_INVALID_VALUE`). Starlette builds the middleware stack on the first request, not in `add_middleware`, so such an error first shows as a `500` on every request (the route is never reached). To fail at startup instead, load the trust set and profile yourself (`create_principal_trust_store`, `resolve_strict_v1_profile`) and pass the loaded objects.
- **A synchronous revocation source** runs in a worker thread; when it times out the request is refused at once, but the thread runs until the source returns. Prefer an async source, or one with its own timeout, such as `deny_list_revocation_source(url, timeout=...)`, which bounds the whole fetch, uses no proxy from the environment, follows no redirect and reads at most 16 MiB.

Runnable, offline, on the shared admission vectors: `python integrations/fastapi/examples/strict_v1.py`.

### `require_dcp(request)`

FastAPI dependency that requires a verified DCP agent.

```python
from fastapi import Depends
from dcp_ai.fastapi import require_dcp, DCPAgentContext

@app.post("/protected")
async def protected_route(agent: DCPAgentContext = Depends(require_dcp)):
    return {"agent_id": agent.agent_id}
```

- **Returns:** `DCPAgentContext`
- **Raises:** `HTTPException(403)` if no verified agent is present

### `DCPAgentContext`

Dataclass with the verified agent data:

```python
@dataclass
class DCPAgentContext:
    dcp_version: str = "1.0"
    agent_id: str = ""
    human_id: str = ""
    session_nonce: str = ""                # V2: verified session nonce
    public_key: str = ""
    capabilities: list[str] = field(default_factory=list)
    risk_tier: str = "medium"
    status: str = "active"
    passport: dict[str, Any] = field(default_factory=dict)
    rpr: dict[str, Any] = field(default_factory=dict)
    intent: dict[str, Any] = field(default_factory=dict)
    policy_decision: dict[str, Any] = field(default_factory=dict)
    composite_sig_valid: bool = False      # V2: the bundle signature verified
    session_binding_valid: bool = False    # V2: session binding verified
    blinded_rpr: bool = False
    lifecycle_state: str = "active"        # DCP-05
    mandate_id: str = ""                   # DCP-09
    mandate_valid: bool = False            # DCP-09
    warnings: list[str] = field(default_factory=list)  # V2: verifier warnings
    # Admission: set only with trusted_principals (admitted stays False otherwise)
    admitted: bool = False
    principal_trust: str = "not_evaluated" # "trusted" when admitted with trusted_principals
    profile: str | None = None             # "strict-v1" under the profile
    profile_compliance: str = "not_evaluated"
    recorded_decision: str | None = None   # approve, escalate or block
    trust_set_version: str | None = None
    action_authorized: bool = False        # always False
```

### `require_dcp_commissioned(request)`

FastAPI dependency that rejects decommissioned agents (DCP-05 §5.1).

```python
@app.post("/active-only")
async def active_only(agent: DCPAgentContext = Depends(require_dcp_commissioned)):
    return {"agent_id": agent.agent_id}
```

### `require_dcp_mandated(request)`

FastAPI dependency that requires a valid delegation mandate (DCP-09 §3.1).

```python
@app.post("/delegated")
async def delegated(agent: DCPAgentContext = Depends(require_dcp_mandated)):
    return {"agent_id": agent.agent_id, "mandate_id": agent.mandate_id}
```

## Advanced Example — Global Middleware + Selective Routes

```python
from fastapi import FastAPI, Depends, HTTPException
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Global middleware (non-blocking, only verifies if a bundle is present)
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route
@app.get("/health")
async def health():
    return {"ok": True}

# Route that REQUIRES a verified agent
@app.post("/agent/execute")
async def execute(agent: DCPAgentContext = Depends(require_dcp)):
    if "api_call" not in agent.capabilities:
        raise HTTPException(403, "Capability 'api_call' required")
    return {"executed_by": agent.agent_id, "risk": agent.risk_tier}

# Route that uses the agent if available
@app.get("/info")
async def info(request):
    agent = getattr(request.state, "dcp_agent", None)
    if agent:
        return {"mode": "verified", "agent": agent.agent_id}
    return {"mode": "anonymous"}
```

## Development

```bash
pip install "dcp-ai[fastapi,dev]"
pytest -v
```

### Dependencies

- `dcp-ai` — DCP verification SDK
- `fastapi` — Web framework
- `starlette` — ASGI toolkit (included with FastAPI)

## License

Apache-2.0
