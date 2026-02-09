# dcp_ai.fastapi — FastAPI Middleware

Middleware de verificacion DCP para FastAPI. Verifica Signed Bundles automaticamente y provee dependency injection para rutas protegidas.

## Instalacion

```bash
pip install "dcp-ai[fastapi]"
```

## Quickstart

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Agregar middleware de verificacion
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Ruta publica (no requiere bundle)
@app.get("/health")
async def health():
    return {"ok": True}

# Ruta protegida (requiere bundle verificado)
@app.post("/api/action")
async def agent_action(agent: DCPAgentContext = Depends(require_dcp)):
    return {
        "agent_id": agent.agent_id,
        "human_id": agent.human_id,
        "capabilities": agent.capabilities,
        "risk_tier": agent.risk_tier,
    }
```

### Enviar un bundle

```bash
# Via header
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -H "x-dcp-bundle: $(cat signed_bundle.json)" \
  -d '{}'

# Via body JSON
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}}'
```

## API Reference

### `DCPVerifyMiddleware`

Middleware Starlette/FastAPI que intercepta requests y verifica bundles DCP.

```python
app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=False,       # Si True, rechaza requests sin bundle
    header_name="x-dcp-bundle", # Header donde se envia el bundle
)
```

#### Parametros del constructor

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `app` | `Any` | (requerido) | Aplicacion ASGI |
| `require_bundle` | `bool` | `False` | Rechaza requests sin bundle con 403 |
| `header_name` | `str` | `"x-dcp-bundle"` | Nombre del header HTTP |

#### Comportamiento

1. Extrae el signed bundle del header o del body JSON (`signed_bundle`)
2. Verifica usando `verify_signed_bundle()` del SDK Python
3. Si es valido: almacena `DCPAgentContext` en `request.state.dcp_agent`
4. Si falla y `require_bundle=True`: responde `403`
5. Si no hay bundle y `require_bundle=False`: continua sin verificacion

### `require_dcp(request)`

FastAPI dependency que requiere un agente DCP verificado.

```python
from fastapi import Depends
from dcp_ai.fastapi import require_dcp, DCPAgentContext

@app.post("/protected")
async def protected_route(agent: DCPAgentContext = Depends(require_dcp)):
    return {"agent_id": agent.agent_id}
```

- **Retorna:** `DCPAgentContext`
- **Lanza:** `HTTPException(403)` si no hay agente verificado

### `DCPAgentContext`

Dataclass con los datos del agente verificado:

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

## Ejemplo avanzado — Middleware global + rutas selectivas

```python
from fastapi import FastAPI, Depends, HTTPException
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Middleware global (no bloquea, solo verifica si hay bundle)
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Ruta publica
@app.get("/health")
async def health():
    return {"ok": True}

# Ruta que REQUIERE agente verificado
@app.post("/agent/execute")
async def execute(agent: DCPAgentContext = Depends(require_dcp)):
    if "api_call" not in agent.capabilities:
        raise HTTPException(403, "Capability 'api_call' required")
    return {"executed_by": agent.agent_id, "risk": agent.risk_tier}

# Ruta que usa agente si esta disponible
@app.get("/info")
async def info(request):
    agent = getattr(request.state, "dcp_agent", None)
    if agent:
        return {"mode": "verified", "agent": agent.agent_id}
    return {"mode": "anonymous"}
```

## Desarrollo

```bash
pip install "dcp-ai[fastapi,dev]"
pytest -v
```

### Dependencias

- `dcp-ai` — SDK de verificacion DCP
- `fastapi` — Framework web
- `starlette` — ASGI toolkit (incluido con FastAPI)

## Licencia

Apache-2.0
