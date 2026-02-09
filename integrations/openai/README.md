# dcp_ai.openai — OpenAI Integration

Wrapper de DCP para el cliente de OpenAI. Agrega gobernanza DCP automatica a llamadas de chat, function calling con herramientas DCP y audit trail con hash-chaining.

## Instalacion

```bash
pip install "dcp-ai[openai]"
```

## Quickstart

```python
from openai import OpenAI
from dcp_ai import generate_keypair
from dcp_ai.openai import DCPOpenAIClient

# Setup
keys = generate_keypair()
client = OpenAI(api_key="sk-...")

passport = {
    "dcp_version": "1.0",
    "agent_id": "openai-agent-001",
    "human_id": "human-001",
    "agent_name": "GPTAssistant",
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

# Envolver el cliente OpenAI
dcp_client = DCPOpenAIClient(
    openai_client=client,
    passport=passport,
    hbr=hbr,
    secret_key=keys["secret_key_b64"],
)

# Usar como el cliente normal
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Resume las noticias de hoy"}],
)
print(response.choices[0].message.content)

# Consultar audit trail
trail = dcp_client.get_audit_trail()
for entry in trail:
    print(f"[{entry['timestamp']}] {entry['action_type']}")
```

## API Reference

### `DCPOpenAIClient`

Wrapper del cliente OpenAI con gobernanza DCP automatica.

```python
DCPOpenAIClient(
    openai_client: Any,           # Instancia de OpenAI()
    passport: dict[str, Any],    # Agent Passport DCP
    hbr: dict[str, Any],         # Human Binding Record
    secret_key: str = "",        # Clave secreta Ed25519 (base64)
    auto_intent: bool = True,    # Auto-inyectar herramientas DCP
)
```

#### Metodos

| Metodo | Descripcion |
|--------|-------------|
| `chat_completions_create(**kwargs)` | Crea chat completion con gobernanza DCP. Genera Intent y AuditEntry por cada llamada. |
| `get_audit_trail()` | Retorna la lista completa de audit entries con hash-chaining. |

#### Flujo de `chat_completions_create`

1. Crea un `Intent` declarando la accion `api_call`
2. Evalua una `PolicyDecision`
3. Ejecuta `client.chat.completions.create()`
4. Registra un `AuditEntry` con el resultado
5. Encadena hashes automaticamente

### `DCP_TOOLS`

Lista de definiciones de herramientas OpenAI function calling para DCP:

```python
from dcp_ai.openai import DCP_TOOLS

# Inyectar en una llamada de chat
response = client.chat.completions.create(
    model="gpt-4",
    messages=[...],
    tools=DCP_TOOLS,
)
```

#### Herramientas disponibles

| Herramienta | Parametros | Descripcion |
|-------------|------------|-------------|
| `dcp_verify_bundle` | `signed_bundle_json: string` | Verifica un Signed Bundle DCP |
| `dcp_declare_intent` | `action_type: enum`, `target_channel: enum`, `data_classes?: string[]`, `estimated_impact?: enum` | Declara intent antes de una accion (DCP-02) |

**`action_type`**: `browse`, `api_call`, `send_email`, `create_calendar_event`, `initiate_payment`, `update_crm`, `write_file`, `execute_code`

**`target_channel`**: `web`, `api`, `email`, `calendar`, `payments`, `crm`, `filesystem`, `runtime`

**`estimated_impact`**: `low`, `medium`, `high`

### `handle_dcp_tool_call(tool_name, arguments)`

Procesa tool calls DCP retornadas por OpenAI.

```python
from dcp_ai.openai import handle_dcp_tool_call

# Despues de recibir un tool_call del modelo
for tool_call in response.choices[0].message.tool_calls:
    if tool_call.function.name.startswith("dcp_"):
        result = handle_dcp_tool_call(
            tool_call.function.name,
            json.loads(tool_call.function.arguments),
        )
        print(result)  # JSON con el resultado
```

## Ejemplo avanzado — Function calling con DCP

```python
from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient, DCP_TOOLS, handle_dcp_tool_call
import json

client = OpenAI()
dcp_client = DCPOpenAIClient(
    openai_client=client,
    passport=passport,
    hbr=hbr,
    secret_key=keys["secret_key_b64"],
)

# Primera llamada: el modelo puede usar herramientas DCP
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "Declara tu intent para hacer una llamada API"},
    ],
)

# Procesar tool calls
message = response.choices[0].message
if message.tool_calls:
    for tc in message.tool_calls:
        result = handle_dcp_tool_call(
            tc.function.name,
            json.loads(tc.function.arguments),
        )
        print(f"Tool: {tc.function.name} -> {result}")
```

## Desarrollo

```bash
pip install "dcp-ai[openai,dev]"
pytest -v
```

### Dependencias

- `dcp-ai` — SDK DCP (crypto, merkle, verify, models)
- `openai` — Cliente oficial de OpenAI

## Licencia

Apache-2.0
