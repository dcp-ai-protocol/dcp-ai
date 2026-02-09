# dcp_ai.fastapi — FastAPI Middleware

DCP verification middleware for FastAPI. Automatically verifies Signed Bundles and provides dependency injection for protected routes.

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
)
```

#### Constructor Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `app` | `Any` | (required) | ASGI application |
| `require_bundle` | `bool` | `False` | Rejects requests without a bundle with 403 |
| `header_name` | `str` | `"x-dcp-bundle"` | HTTP header name |

#### Behavior

1. Extracts the signed bundle from the header or JSON body (`signed_bundle`)
2. Verifies using `verify_signed_bundle()` from the Python SDK
3. If valid: stores `DCPAgentContext` in `request.state.dcp_agent`
4. If it fails and `require_bundle=True`: responds with `403`
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
    agent_id: str = ""
    human_id: str = ""
    public_key: str = ""
    capabilities: list[str] = field(default_factory=list)
    risk_tier: str = "medium"
    status: str = "active"
    passport: dict[str, Any] = field(default_factory=dict)
    hbr: dict[str, Any] = field(default_factory=dict)
    intent: dict[str, Any] = field(default_factory=dict)
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
