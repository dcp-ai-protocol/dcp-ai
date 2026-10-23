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
| `verifier_policy` | `dict \| VerifierPolicy \| None` | `None` | V2 verifier policy. A dict sets `VerifierPolicy` fields over `DEFAULT_VERIFIER_POLICY` (a `default_mode` without `risk_overrides` applies to every risk tier); a `VerifierPolicy` is used as is. Unknown fields or modes raise when the middleware is built. |

#### Behavior

1. Extracts the signed bundle from the header or JSON body (`signed_bundle`)
2. Verifies it with the Python SDK:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `await verify_signed_bundle_v2(signed_bundle, registry, policy)` from `dcp_ai.v2`, with an Ed25519 / ML-DSA-65 / SLH-DSA-192f registry and the policy above. It checks the payload hashes and the manifest, session binding and expiry, the bundle's and every artifact's composite signature, the verification mode (the stricter of the policy's mode for the passport's risk tier and the intent's security tier), the audit hash chain and key validity. `composite_sig_valid` is the verifier's result for the bundle signature.
   - **V1** (`bundle.responsible_principal_record.dcp_version: "1.0"`): `verify_signed_bundle()`, only if the policy accepts a bundle without a post-quantum signature. A V1 bundle is rejected when `allow_v1_bundles` is false or the policy's `default_mode` or any `risk_overrides` mode is `hybrid_required` or `pq_only`: a V1 passport's risk tier is self-declared. `DEFAULT_VERIFIER_POLICY` requires `hybrid_required` for the `high` tier, so V1 bundles are rejected unless `verifier_policy` sets `default_mode` to `classical_only` or `hybrid_preferred`.
   - A bundle whose version cannot be detected is rejected.
3. If valid: stores `DCPAgentContext` in `request.state.dcp_agent`, with the verifier's `warnings`
4. If it fails: responds with `403`, the verifier's `errors` (and, for V2, `warnings`)
5. If no bundle and `require_bundle=False`: continues without verification

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
