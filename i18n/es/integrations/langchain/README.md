<sub>[English](../../../../integrations/langchain/README.md) · [中文](../../../zh-CN/integrations/langchain/README.md) · **Español** · [日本語](../../../ja/integrations/langchain/README.md) · [Português](../../../pt-BR/integrations/langchain/README.md)</sub>

<a id="dcp_ailangchain--langchain-integration"></a>
<a id="dcp_ailangchain-langchain-integration"></a>

# dcp_ai.langchain — integración con LangChain

> Traducción informativa de [la versión en inglés](../../../../integrations/langchain/README.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Integración de DCP con LangChain. Envuelve un agente de LangChain para que cada llamada que se completa deje una entrada en un registro de auditoría encadenado por hash con la forma de V2, y proporciona una herramienta de verificación de bundles y un manejador de callbacks.

El envoltorio guarda **registros sin firmar**: las intenciones, las decisiones de política y las entradas de auditoría no se firman, y la `secret_key` que acepta no se usa. Para bundles firmados y verificables de un agente de LangChain, usa el SDK principal como en [docs/QUICKSTART_LANGCHAIN.md](../../../../docs/QUICKSTART_LANGCHAIN.md).

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, de forma parcial: registros sin firmar con las formas de esas especificaciones y verificación de
bundles mediante `DCPTool`. No las implementa por completo.

<a id="installation"></a>

## Instalación

**Publicado en PyPI (26/10/2026).** `dcp-ai` 2.10.0 incluye la implementación descrita aquí. Actualiza desde 2.9.0 y renueva tu entorno o archivo de bloqueo. Véanse las [notas de Python](../../../../docs/PYTHON_RELEASE.md).

La versión 2.9.0 envía todos los bundles a V1. La 2.10.0 verifica V2 con el verificador normativo y aplica la política configurada a V1 y V2; se mantienen las limitaciones sobre registros sin firmar y callbacks descritas abajo.

```bash
pip install "dcp-ai[langchain]>=2.10.1,<3"
```

Para desarrollar desde el código fuente:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[langchain]"
```

<a id="quickstart"></a>

## Inicio rápido

```python
import asyncio

from dcp_ai.langchain import DCPAgentWrapper

# The wrapper reads agent_id from the passport and human_id from the RPR;
# it does not check or sign them.
passport = {"agent_id": "agent:research-assistant-001", "capabilities": ["browse", "api_call"]}
rpr = {"human_id": "rpr:human-001"}


async def main() -> None:
    wrapped = DCPAgentWrapper(
        agent=my_langchain_agent,  # Fragment: your LangChain agent (ainvoke or invoke)
        passport=passport,
        rpr=rpr,
    )

    # invoke is a coroutine: await it
    result = await wrapped.invoke({"input": "Search for information about AI"})

    for entry in wrapped.get_audit_trail():
        print(f"[{entry['timestamp']}] {entry['intent_id']}: {entry['policy_decision']} -> {entry['outcome']}")


asyncio.run(main())
```

<a id="api-reference"></a>

## Referencia de la API

### `DCPAgentWrapper`

```python
DCPAgentWrapper(
    agent: Any,                         # LangChain agent: ainvoke is used when present, else invoke
    passport: dict[str, Any],           # agent_id is read
    rpr: dict[str, Any],                # human_id is read
    secret_key: str = "",               # Accepted but not used: nothing is signed
    session_nonce: str = "",            # A fresh one when empty
    auto_intent: bool = True,           # Stored, not used: invoke always creates an intent
    policy_engine: Any = None,          # Object with evaluate(intent) -> PolicyDecisionV2
    pq_checkpoint_interval: int = 10,   # Stored, not used: no PQ checkpoints are made
)
```

<a id="methods"></a>

#### Métodos

| Método | Descripción |
|--------|-------------|
| `await invoke(inputs, **kwargs)` | Crea una intención y una decisión de política (locales, no se conservan como listas), ejecuta el agente y, si devuelve un resultado, registra una entrada de auditoría (véase abajo). Devuelve un dict de error, sin entrada de auditoría, cuando el agente está dado de baja o la decisión es `block`; una excepción del agente se propaga y no deja entrada de auditoría. |
| `get_audit_trail()` | Las entradas de auditoría, encadenadas por hash: la propia lista en memoria, no una copia, así que modificarla modifica el registro. |
| `get_session_nonce()` | El nonce de sesión. |
| `commission(purpose, capabilities, risk_tier)` | Pone en servicio al agente (DCP-05 §3.1). |
| `report_vitality(metrics_dict)` | Informa de métricas de vitalidad y calcula la puntuación (DCP-05 §4.1). |
| `decommission(termination_mode, reason)` | Da de baja al agente (DCP-05 §5.1). |
| `declare_rights(rights, jurisdiction)` | Declara derechos (DCP-08 §3.1). |

<a id="what-invoke-does-on-main-25102026"></a>

#### Qué hace `invoke` (en `main`, 25/10/2026)

1. Crea una intención: siempre `action_type: "api_call"`, canal `api`, `estimated_impact: "low"`, `data_classes: ["none"]`.
2. Obtiene una decisión de política. Sin `policy_engine`, la decisión es siempre `approve`. Con uno, su `evaluate(intent)` debe devolver un `PolicyDecisionV2` (de `dcp_ai.v2.models`); un dict simple lanza `AttributeError`.
3. Ejecuta el agente salvo que la decisión sea `block`; una llamada bloqueada devuelve un dict de error y **no deja entrada de auditoría**. Una decisión `escalate` **no** detiene al agente: se ejecuta, y su entrada de auditoría registra `policy_decision: "blocked"` con `outcome: "completed"`. Usa `block` para todo lo que no deba ejecutarse hasta que lo apruebe una persona.
4. Si el agente devuelve un resultado, registra una entrada de auditoría y la encadena: `intent_hash`, y `prev_hash` desde `GENESIS` hasta el hash de la entrada anterior.

`evidence.result_ref` guarda los primeros 100 caracteres del resultado del agente como texto, no como hash, así que puede contener datos personales de la salida. Trata el registro de auditoría como datos que necesitan la misma protección que la salida, o no lo conserves.

### `DCPTool`

Herramienta al estilo de LangChain para verificar bundles de DCP desde dentro de un agente. Es una clase simple (`name`, `description`, `run`, `arun`), no un `BaseTool` de LangChain; envuélvela para tu versión de LangChain, por ejemplo:

```python
from langchain_core.tools import StructuredTool
from dcp_ai.langchain import DCPTool

dcp = DCPTool()
verify_tool = StructuredTool.from_function(
    func=dcp.run, coroutine=dcp.arun, name=dcp.name, description=dcp.description,
)
```

<a id="attributes"></a>

#### Atributos

| Atributo | Valor |
|-----------|-------|
| `name` | `"dcp_verify_bundle"` |
| `description` | `"Verify a DCP signed bundle..."` |

<a id="methods-1"></a>
<a id="methods_1"></a>

#### Métodos

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `run(signed_bundle_json)` | `(str \| dict) -> str` | Verificación síncrona, con o sin un bucle de eventos en ejecución |
| `arun(signed_bundle_json)` | `(str \| dict) -> str` | Verificación asíncrona |

Un bundle V2 se verifica con `verify_signed_bundle_v2` de `dcp_ai.v2` (firmas compuestas, vinculación de sesión,
manifiesto, coherencia entre artefactos, la cadena de auditoría SHA-256 —y, desde 2.10.1 pero no en 2.10.0, los campos secundarios SHA3-256 de V2-11 presentes— y validez de las claves) bajo `DCPTool(verifier_policy=...)`: un dict de campos de `VerifierPolicy` fijados
sobre `DEFAULT_VERIFIER_POLICY` (un `default_mode` sin `risk_overrides` se aplica a todos los niveles de riesgo), o una
`VerifierPolicy` completa; el valor predeterminado es `DEFAULT_VERIFIER_POLICY`. Un bundle V1, que solo tiene una firma
Ed25519, sin intended_verifier ni ventana de sesión, se acepta solo cuando la política tiene `allow_v1_bundles`, acepta
ed25519 (`accepted_classical_algs`, sin entrada en `advisory_rejected_algs`), no exige vinculación de audiencia,
caducidad de sesión ni duración máxima de sesión, y aceptaría un bundle solo clásico para su nivel de riesgo y su nivel
de seguridad (`spec/VERIFICATION.md` V2-10); sus artefactos deben ser objetos, y el `agent_id` de su pasaporte y el
`human_id` de su RPR, cadenas. El resultado es `Bundle VERIFIED (v<version>) for agent <agent_id>` o
`Bundle INVALID: <errors>`, con los errores del verificador. El texto está acotado (como mucho 20 errores de 500
caracteres, un `agent_id` de 200) y las partes que vienen del bundle tienen escapados sus caracteres de control y de
formato (`\u000a` para un salto de línea), porque llegan al contexto del modelo.

`DCPTool` es una verificación criptográfica bajo la política que fija tu código al construir la herramienta
(`DCPTool(verifier_policy=...)`), nunca tomada del bundle ni del modelo. No es admisión de un principal
anclado y no autoriza ninguna acción (véase [docs/ADMISSION.md](../../../../docs/ADMISSION.md)).

### `DCPCallback`

Registra los eventos de cadena de LangChain como entradas de auditoría con la forma de V2 (sin firmar, encadenadas por hash). Es una clase simple, no un `BaseCallbackHandler` de LangChain: LangChain 1.x la rechaza como callback (`AttributeError`, comprobado con `langchain-core` 1.7), y necesita `run_id` como cadena mientras que LangChain pasa un `UUID`. Llámala desde un manejador propio:

```python
from langchain_core.callbacks import BaseCallbackHandler
from dcp_ai.langchain import DCPCallback

dcp_log = DCPCallback(agent_id="agent:research-assistant-001", human_id="rpr:human-001")


class DCPHandler(BaseCallbackHandler):
    """Hands LangChain's chain events to DCPCallback."""

    # LangChain passes run_id as a UUID; DCPCallback records it as the entry's intent_id, a string
    def on_chain_start(self, serialized, inputs, *, run_id, **kwargs):
        dcp_log.on_chain_start(serialized or {}, inputs, run_id=str(run_id))

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        dcp_log.on_chain_end(outputs, run_id=str(run_id))


# Fragment: chain is your LangChain chain or agent
chain.invoke({"input": "..."}, config={"callbacks": [DCPHandler()]})
entries = dcp_log.get_entries()
```

`on_chain_end` guarda los primeros 200 caracteres de las salidas como `evidence.result_ref`, que pueden contener datos personales.

<a id="methods-2"></a>
<a id="methods_2"></a>

#### Métodos

| Método | Descripción |
|--------|-------------|
| `on_chain_start(serialized, inputs, **kwargs)` | Registra el inicio de la cadena |
| `on_chain_end(outputs, **kwargs)` | Registra el fin de la cadena |
| `on_lifecycle_event(event_type, details)` | Registra eventos de ciclo de vida (DCP-05) |
| `get_entries()` | Devuelve la lista de entradas de auditoría |

<a id="advanced-example--agent-with-a-custom-policy-engine"></a>
<a id="advanced-example-agent-with-a-custom-policy-engine"></a>

## Ejemplo avanzado — agente con un motor de políticas propio

Las intenciones del envoltorio son siempre `api_call` de bajo impacto, así que un motor de políticas decide sobre otra cosa. Aquí, un interruptor de parada que controla una persona:

```python
from datetime import datetime, timezone

from dcp_ai.langchain import DCPAgentWrapper
from dcp_ai.v2.models import PolicyDecisionV2


class StopSwitch:
    """Approves until a human stops the agent; then blocks every call."""

    def __init__(self) -> None:
        self.stopped = False

    def evaluate(self, intent):
        return PolicyDecisionV2(
            dcp_version="2.0",
            intent_id=intent.intent_id,
            session_nonce=intent.session_nonce,
            decision="block" if self.stopped else "approve",
            risk_score=1000 if self.stopped else 100,
            reasons=["stopped by a human" if self.stopped else "default-allow"],
            timestamp=datetime.now(timezone.utc).isoformat(),
        )


switch = StopSwitch()
wrapped = DCPAgentWrapper(
    agent=my_agent,  # Fragment: your LangChain agent
    passport=passport,
    rpr=rpr,
    policy_engine=switch,
)
# switch.stopped = True  ->  the next await wrapped.invoke(...) returns an error dict and does not run the agent
```

<a id="development"></a>

## Desarrollo

Desde un checkout:

```bash
cd sdks/python
pip install -e ".[langchain,dev]"
pytest -v
```

<a id="dependencies"></a>

### Dependencias

- `dcp-ai` — SDK de DCP (crypto, merkle, verify, models)
- `langchain` + `langchain-core` — framework de agentes

<a id="license"></a>

## Licencia

Apache-2.0
