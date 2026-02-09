# dcp_ai.langchain — LangChain Integration

Integracion de DCP con LangChain. Envuelve agentes LangChain con ciudadania digital, genera audit trails con hash-chaining automatico y provee herramientas de verificacion.

## Instalacion

```bash
pip install "dcp-ai[langchain]"
```

## Quickstart

```python
from dcp_ai import generate_keypair
from dcp_ai.langchain import DCPAgentWrapper

# Keypair del humano responsable
keys = generate_keypair()

# Datos DCP del agente
passport = {
    "dcp_version": "1.0",
    "agent_id": "langchain-agent-001",
    "human_id": "human-001",
    "agent_name": "ResearchAssistant",
    "capabilities": ["browse", "api_call"],
    "risk_tier": "medium",
    "status": "active",
    "created_at": "2025-01-01T00:00:00Z",
    "expires_at": None,
}
hbr = {
    "dcp_version": "1.0",
    "human_id": "human-001",
    "entity_type": "natural_person",
    "jurisdiction": "ES",
    "liability_mode": "full",
    "created_at": "2025-01-01T00:00:00Z",
    "expires_at": None,
}

# Envolver un agente LangChain existente
wrapped = DCPAgentWrapper(
    agent=my_langchain_agent,       # Tu agente LangChain
    passport=passport,
    hbr=hbr,
    secret_key=keys["secret_key_b64"],
    auto_intent=True,               # Genera intents automaticamente
)

# Ejecutar con gobernanza DCP
result = wrapped.invoke({"input": "Busca informacion sobre IA"})

# Consultar audit trail
trail = wrapped.get_audit_trail()
for entry in trail:
    print(f"[{entry['timestamp']}] {entry['action_type']} -> {entry['outcome']}")
```

## API Reference

### `DCPAgentWrapper`

Envuelve un agente LangChain con ciudadania DCP completa.

```python
DCPAgentWrapper(
    agent: Any,                    # Agente LangChain
    passport: dict[str, Any],     # Agent Passport DCP
    hbr: dict[str, Any],          # Human Binding Record
    secret_key: str,              # Clave secreta Ed25519 (base64)
    auto_intent: bool = True,     # Auto-generar intents
    policy_engine: Any = None,    # Motor de politicas custom (opcional)
)
```

#### Metodos

| Metodo | Descripcion |
|--------|-------------|
| `invoke(inputs, **kwargs)` | Ejecuta el agente con gobernanza DCP. Genera Intent, PolicyDecision y AuditEntry. |
| `get_audit_trail()` | Retorna la lista de audit entries con hash-chaining. |

#### Flujo de ejecucion

1. Crea un `Intent` declarando la accion
2. Evalua la `PolicyDecision` (allow/deny)
3. Si es `allow`: ejecuta el agente LangChain
4. Crea un `AuditEntry` con el resultado
5. Encadena hashes: `intent_hash` y `prev_hash` (GENESIS → hash(entry anterior))

### `DCPTool`

Herramienta LangChain para verificar bundles DCP desde dentro de un agente.

```python
from dcp_ai.langchain import DCPTool

tool = DCPTool()

# Usar en un agente LangChain
agent = initialize_agent(
    tools=[tool, ...other_tools],
    llm=llm,
)
```

#### Atributos

| Atributo | Valor |
|----------|-------|
| `name` | `"dcp_verify_bundle"` |
| `description` | `"Verify a DCP signed bundle..."` |

#### Metodos

| Metodo | Firma | Descripcion |
|--------|-------|-------------|
| `run(signed_bundle_json)` | `(str) -> str` | Verificacion sincrona |
| `arun(signed_bundle_json)` | `(str) -> str` | Verificacion asincrona |

### `DCPCallback`

Callback handler para logging automatico de audit entries.

```python
from dcp_ai.langchain import DCPCallback

callback = DCPCallback(
    agent_id="agent-001",
    human_id="human-001",
)

# Usar como callback en LangChain
agent.invoke(
    {"input": "..."},
    callbacks=[callback],
)

# Obtener audit entries generadas
entries = callback.get_entries()
```

#### Metodos

| Metodo | Descripcion |
|--------|-------------|
| `on_chain_start(serialized, inputs, **kwargs)` | Registra inicio de cadena |
| `on_chain_end(outputs, **kwargs)` | Registra fin de cadena |
| `get_entries()` | Retorna lista de audit entries |

## Ejemplo avanzado — Agente con policy engine custom

```python
class MyPolicyEngine:
    def evaluate(self, intent):
        # Rechazar acciones de alto impacto
        if intent.get("estimated_impact") == "high":
            return {"decision": "deny", "matched_rules": ["no-high-impact"]}
        return {"decision": "allow", "matched_rules": ["default-allow"]}

wrapped = DCPAgentWrapper(
    agent=my_agent,
    passport=passport,
    hbr=hbr,
    secret_key=keys["secret_key_b64"],
    policy_engine=MyPolicyEngine(),
)
```

## Desarrollo

```bash
pip install "dcp-ai[langchain,dev]"
pytest -v
```

### Dependencias

- `dcp-ai` — SDK DCP (crypto, merkle, verify, models)
- `langchain` + `langchain-core` — Framework de agentes

## Licencia

Apache-2.0
