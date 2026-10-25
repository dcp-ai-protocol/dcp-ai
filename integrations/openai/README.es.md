<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp_aiopenai--openai-integration"></a>
<a id="dcp_aiopenai-openai-integration"></a>

# dcp_ai.openai — integración con OpenAI

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Envoltorio de DCP para el cliente de Python de OpenAI. Crea una intención por cada llamada de chat y registra una entrada de auditoría cuando la llamada devuelve un resultado, ofrece herramientas de DCP para la llamada a funciones y mantiene el registro de auditoría encadenado por hash.

El envoltorio guarda **registros sin firmar** y **no evalúa ninguna política**: todas las llamadas se ejecutan, y su entrada de auditoría registra `policy_decision: "approved"`. La `secret_key` que acepta no se usa. Para bundles firmados y una puerta de política alrededor de las llamadas a funciones, sigue [docs/QUICKSTART_OPENAI.md](../../docs/QUICKSTART_OPENAI.md).

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, de forma parcial: registros y borradores sin firmar con las formas de esas especificaciones, y
verificación de bundles mediante `dcp_verify_bundle`. No las implementa por completo.

<a id="installation"></a>

## Instalación

> **Estado de publicación (25/10/2026).** PyPI tiene `dcp-ai` 2.9.0. En ella, la herramienta `dcp_verify_bundle` de `handle_dcp_tool_call` envía todos los bundles al verificador V1: todo bundle V2 se rechaza, y un bundle V1 se acepta sin ninguna política de verificador. El argumento `verifier_policy`, `averify_bundle_tool_call` y la verificación V2 descrita abajo están en el código fuente de `main` (véase la sección `[Unreleased]` de [CHANGELOG.md](../../CHANGELOG.md)).

Desde un checkout (la versión de esta página):

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install "/path/to/dcp-ai/sdks/python[openai]"
```

La versión publicada (2.9.0), con los límites anteriores:

```bash
pip install "dcp-ai[openai]"
```

Los ejemplos llaman a la API de OpenAI: necesitan `OPENAI_API_KEY` en el entorno y OpenAI los factura.

<a id="quickstart"></a>

## Inicio rápido

```python
from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient

client = OpenAI()  # reads OPENAI_API_KEY from the environment

# The wrapper reads agent_id from the passport and human_id from the RPR;
# it does not check or sign them.
passport = {"agent_id": "agent:gpt-assistant-001", "capabilities": ["browse", "api_call"], "risk_tier": "medium"}
rpr = {"human_id": "rpr:human-001"}

dcp_client = DCPOpenAIClient(openai_client=client, passport=passport, rpr=rpr)

# Without tools of your own, the DCP tools are added (auto_intent=True), so the
# model may answer with tool calls instead of text.
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Summarize today's news"}],
)
message = response.choices[0].message
print(message.content or message.tool_calls)

for entry in dcp_client.get_audit_trail():
    print(f"[{entry['timestamp']}] {entry['intent_id']} -> {entry['outcome']}")
```

<a id="api-reference"></a>

## Referencia de la API

### `DCPOpenAIClient`

```python
DCPOpenAIClient(
    openai_client: Any,           # OpenAI() instance
    passport: dict[str, Any],     # agent_id and, for commission, capabilities and risk_tier are read
    rpr: dict[str, Any],          # human_id is read
    secret_key: str = "",         # Accepted but not used: nothing is signed
    session_nonce: str = "",      # A fresh one when empty
    auto_intent: bool = True,     # Adds DCP_TOOLS to calls that pass no tools
)
```

<a id="methods"></a>

#### Métodos

| Método | Descripción |
|--------|-------------|
| `chat_completions_create(**kwargs)` | Crea una intención, llama a `client.chat.completions.create(**kwargs)` y, si devuelve un resultado, registra una entrada de auditoría. Una llamada que lanza una excepción la propaga y no deja entrada de auditoría. |
| `commission(purpose, capabilities?)` | Pone en servicio al agente (DCP-05 §3.1); devuelve un certificado sin firmar y registra una entrada de auditoría. El certificado y el estado `commissioned` son locales: no se acredita ni se envía nada a otra parte. |
| `get_audit_trail()` | Las entradas de auditoría, encadenadas por hash: la propia lista en memoria, no una copia, así que modificarla modifica el registro. |
| `get_session_nonce()` | El nonce de sesión. |

<a id="chat_completions_create-flow"></a>

#### Flujo de `chat_completions_create`

1. Crea una intención: `action_type: "api_call"`, canal `api`, `estimated_impact: "low"`, `data_classes: ["none"]`.
2. Añade `DCP_TOOLS` cuando `auto_intent` está activado y la llamada no pasa `tools`.
3. Ejecuta `client.chat.completions.create()`. No se toma ninguna decisión de política: la llamada siempre se ejecuta.
4. Si la llamada devuelve un resultado, registra una entrada de auditoría con `policy_decision: "approved"` y el `id` de la respuesta como `evidence.result_ref`, encadenada a la entrada anterior.

### `DCP_TOOLS`

Definiciones de herramientas de llamada a funciones de OpenAI para DCP:

```python
# Fragment: client as in the Quickstart
from dcp_ai.openai import DCP_TOOLS

messages = [{"role": "user", "content": "Declare your intent to make an API call"}]
response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    tools=DCP_TOOLS,
)
```

<a id="available-tools"></a>

#### Herramientas disponibles

| Herramienta | Parámetros | Descripción |
|------|------------|-------------|
| `dcp_verify_bundle` | `signed_bundle_json: string` | Verifica un Signed Bundle de DCP |
| `dcp_declare_intent` | `action_type: enum`, `target_channel: enum`, `data_classes?: string[]`, `estimated_impact?: enum` | Declara la intención antes de una acción (DCP-02) |
| `dcp_commission_agent` | `purpose: string`, `capabilities?: string[]`, `risk_tier?: enum` | Pone en servicio al agente (DCP-05 §3.1) |
| `dcp_report_vitality` | `task_completion_rate`, `error_rate`, `human_satisfaction`, `policy_alignment` | Informa de métricas de vitalidad (DCP-05 §4.1) |
| `dcp_declare_rights` | `rights: string[]`, `jurisdiction: string` | Declara los derechos del agente (DCP-08 §3.1) |
| `dcp_create_mandate` | `human_id: string`, `authority_scope: string[]`, `valid_from?: string`, `valid_until?: string` | Crea un mandato de delegación (DCP-09 §3.1) |

**`action_type`**: `browse`, `api_call`, `send_email`, `create_calendar_event`, `initiate_payment`, `update_crm`, `write_file`, `execute_code`

**`target_channel`**: `web`, `api`, `email`, `calendar`, `payments`, `crm`, `filesystem`, `runtime`

**`estimated_impact`**: `low`, `medium`, `high`

### `handle_dcp_tool_call(tool_name, arguments, session_nonce="", verifier_policy=None)`

Procesa las llamadas a herramientas de DCP que devuelve OpenAI y devuelve una cadena JSON. Aparte de `dcp_verify_bundle`, las herramientas devuelven borradores sin firmar (por ejemplo, `dcp_declare_intent` devuelve `{"intent_declared": true, "intent": {...}}` con `agent_id` y `human_id` fijados a `"self"`). Estos borradores no son artefactos normativos listos para firmar: `"self"` es más corto
que los 6 caracteres que exigen los esquemas para `agent_id` y `human_id`, y a los borradores de certificado, derechos y mandato
les faltan campos de sus esquemas. Adáptalos, valídalos contra los esquemas y fírmalos con el SDK principal.

`dcp_verify_bundle` verifica un bundle V2 con `verify_signed_bundle_v2` de `dcp_ai.v2` bajo `verifier_policy`: un dict
de campos de `VerifierPolicy` fijados sobre `DEFAULT_VERIFIER_POLICY` (un `default_mode` sin `risk_overrides` se aplica a
todos los niveles de riesgo), o una `VerifierPolicy` completa; el valor predeterminado es `DEFAULT_VERIFIER_POLICY`. Un
bundle V1, que solo tiene una firma Ed25519, sin intended_verifier ni ventana de sesión, se acepta solo cuando la
política tiene `allow_v1_bundles`, acepta ed25519 (`accepted_classical_algs`, sin entrada en `advisory_rejected_algs`),
no exige vinculación de audiencia, caducidad de sesión ni duración máxima de sesión, y aceptaría un bundle solo clásico
para su nivel de riesgo y su nivel de seguridad (`spec/VERIFICATION.md` V2-10); sus artefactos deben ser objetos, y el
`agent_id` de su pasaporte y el `human_id` de su RPR, cadenas. El resultado es JSON con `verified`, `dcp_version`, los
`errors` y `warnings` del verificador (como mucho 20 de cada uno, de 500 caracteres) y, para V2, sus `details` (cada
valor acotado de la misma forma), con los caracteres de control y de formato del texto aportado por el bundle escapados.
Funciona con o sin un bucle de eventos en ejecución, y deja el bucle de eventos actual del hilo como estaba; el código
asíncrono puede esperar `averify_bundle_tool_call(arguments, verifier_policy)` en su lugar.

`dcp_verify_bundle` es una verificación criptográfica bajo la política que pasa tu código: `verifier_policy` es un
argumento de tu llamada, nunca se lee de los `arguments` del modelo. No es admisión de un principal anclado y
no autoriza ninguna acción (véase [docs/ADMISSION.md](../../docs/ADMISSION.md)).

```python
# Fragment: response is a chat completion with tool calls
import json

from dcp_ai.openai import handle_dcp_tool_call

for tool_call in response.choices[0].message.tool_calls or []:
    if tool_call.type == "function" and tool_call.function.name.startswith("dcp_"):
        result = handle_dcp_tool_call(
            tool_call.function.name,
            json.loads(tool_call.function.arguments),
        )
        print(result)  # JSON with the result
```

<a id="advanced-example--function-calling-with-dcp"></a>
<a id="advanced-example-function-calling-with-dcp"></a>

## Ejemplo avanzado — llamada a funciones con DCP

```python
# Fragment: passport and rpr as in the Quickstart
import json

from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient, handle_dcp_tool_call

dcp_client = DCPOpenAIClient(openai_client=OpenAI(), passport=passport, rpr=rpr)

# No tools passed: the DCP tools are added, so the model can call them
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Declare your intent to make an API call"}],
)

for tc in response.choices[0].message.tool_calls or []:
    if tc.type == "function":
        result = handle_dcp_tool_call(tc.function.name, json.loads(tc.function.arguments))
        print(f"Tool: {tc.function.name} -> {result}")
```

<a id="development"></a>

## Desarrollo

Desde un checkout:

```bash
cd sdks/python
pip install -e ".[openai,dev]"
pytest -v
```

<a id="dependencies"></a>

### Dependencias

- `dcp-ai` — SDK de DCP (crypto, merkle, verify, models)
- `openai` — cliente oficial de OpenAI

<a id="license"></a>

## Licencia

Apache-2.0
