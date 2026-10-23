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

#### Behavior

1. Extracts the signed bundle from the header or JSON body (`signed_bundle`). A header that is not JSON, holds an integer over Python's 4300-digit limit or is nested too deeply counts as no bundle (`403` with `require_bundle=True`), never a `500`.
2. Verifies it with the Python SDK:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `await verify_signed_bundle_v2(signed_bundle, registry, policy)` from `dcp_ai.v2`, with an Ed25519 / ML-DSA-65 / SLH-DSA-192f registry and the policy above. It checks the payload hashes and the manifest, session binding and expiry, the bundle's and every artifact's composite signature, the verification mode (the stricter of the policy's mode for the passport's risk tier and the intent's security tier), the audit hash chain and key validity. `composite_sig_valid` is the verifier's result for the bundle signature.
   - **V1** (`bundle.responsible_principal_record.dcp_version: "1.0"`): `verify_signed_bundle()`, only where VERIFICATION.md V2-10 would accept a classical-only bundle, since a V1 bundle has no post-quantum signature: `allow_v1_bundles` is true, the policy accepts ed25519 (in `accepted_classical_algs`, not in `advisory_rejected_algs`) and requires no audience binding, session expiry or maximum session duration (a V1 bundle has no `intended_verifier` and no session window), the bundle's `responsible_principal_record`, `agent_passport`, `intent` and `policy_decision` are objects and its `audit_entries` a list of objects, the passport's `agent_id` and the RPR's `human_id` are strings (and the passport's `public_key` and `status`, when present, strings, its `capabilities` a list of strings), since they go into the agent context, and the stricter of the policy mode for the V1 passport's `risk_tier` (`default_mode` when it has none) and the mode of the security tier of the V1 intent and policy decision (V1 `risk_score` is 0 to 1, scaled by 1000; a missing one counts as `elevated`) is `classical_only` or `hybrid_preferred`. Under `DEFAULT_VERIFIER_POLICY` a routine or standard V1 intent passes; a payment, sensitive data, a high estimated impact or a risk score of 0.5 or more is refused.
   - A bundle whose version cannot be detected is rejected.
3. If valid: stores `DCPAgentContext` in `request.state.dcp_agent`, with the verifier's `warnings`
4. If it fails: responds with `403`, the verifier's `errors` (and, for V2, `warnings`): at most 20 of each, of at most 500 characters, with the control and format characters of bundle-supplied text escaped. The context's `warnings` are bounded the same way.
5. If no bundle and `require_bundle=False`: continues without verification

#### What "verified" means

A verified bundle is internally consistent and signed by the keys it lists itself (the passport keys and the RPR binding keys). It does not prove who the principal is: anyone can create keys and an RPR naming any `human_id`. That needs the verifier to pin the principal's trusted keys, and this middleware has no such option yet. A verified bundle can also be replayed until its session expires; `verifier_policy={"require_audience_binding": True, "verifier_id": "my-service"}` (the bundle's `manifest.intended_verifier` must name this verifier), `require_session_expiry` and `max_session_duration_seconds` limit that.

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
