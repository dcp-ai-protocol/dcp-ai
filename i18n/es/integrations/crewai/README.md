<sub>[English](../../../../integrations/crewai/README.md) · [中文](../../../zh-CN/integrations/crewai/README.md) · **Español** · [日本語](../../../ja/integrations/crewai/README.md) · [Português](../../../pt-BR/integrations/crewai/README.md)</sub>

<a id="dcp_aicrewai--crewai-integration"></a>
<a id="dcp_aicrewai-crewai-integration"></a>

# dcp_ai.crewai — integración con CrewAI

> Traducción informativa de [la versión en inglés](../../../../integrations/crewai/README.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Integración de DCP con CrewAI para la gobernanza multiagente. Cada agente tiene su propio pasaporte de DCP y su propio registro de auditoría, con la posibilidad de combinar los registros de toda la tripulación.

`DCPCrewAgent` y `DCPCrew` guardan registros de DCP junto a una tripulación: entradas de auditoría encadenadas por hash con la forma de V2, y registros de ciclo de vida y de sucesión. No firman nada y no ejecutan CrewAI por sí mismos. Para bundles de ciudadanía firmados y verificables de una tripulación de CrewAI, usa el SDK principal como en [docs/QUICKSTART_CREWAI.md](../../../../docs/QUICKSTART_CREWAI.md).

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, de forma parcial: registros sin firmar con las formas de esas especificaciones. No las implementa
por completo.

<a id="installation"></a>

## Instalación

**Publicado en PyPI (26/10/2026).** `dcp-ai` 2.10.0 incluye la implementación descrita aquí. Actualiza desde 2.9.0 y renueva tu entorno o archivo de bloqueo. Véanse las [notas de Python](../../../../docs/PYTHON_RELEASE.md).

La versión 2.10.0 comparte el nonce de sesión del equipo con los agentes elegibles, como se describe abajo, corrigiendo la 2.9.0. Estos auxiliares siguen generando registros sin firmar y no ejecutan CrewAI; usa las API de firma del SDK para bundles verificables.

```bash
pip install "dcp-ai[crewai]>=2.10.1,<3"
```

Para desarrollar desde el código fuente:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[crewai]"
```

<a id="quickstart"></a>

## Inicio rápido

```python
from dcp_ai.crewai import DCPCrewAgent, DCPCrew

# Fields of the principal's RPR and of each agent's passport, in their V2 form.
# DCPCrewAgent reads human_id, agent_id and capabilities; it does not need full,
# signed payloads (those also carry session_nonce and keys).
rpr = {
    "dcp_version": "2.0",
    "human_id": "rpr:human-001",
    "legal_name": "Example Operator",
    "entity_type": "natural_person",
    "jurisdiction": "ES",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "issued_at": "2026-01-01T00:00:00Z",
    "expires_at": None,
}


def passport(agent_id: str, capabilities: list[str], risk_tier: str) -> dict:
    return {
        "dcp_version": "2.0",
        "agent_id": agent_id,
        "principal_binding_reference": rpr["human_id"],
        "capabilities": capabilities,
        "risk_tier": risk_tier,
        "status": "active",
        "created_at": "2026-01-01T00:00:00Z",
    }


researcher = DCPCrewAgent(
    role="researcher",
    passport=passport("agent:researcher-001", ["browse", "api_call"], "low"),
    rpr=rpr,
    goal="Research and gather information",
    backstory="Expert in information retrieval",
)

writer = DCPCrewAgent(
    role="writer",
    passport=passport("agent:writer-001", ["file_write"], "medium"),
    rpr=rpr,
    goal="Produce high-quality content",
    backstory="Professional writer with AI experience",
)

# Create crew with DCP governance
crew = DCPCrew(agents=[researcher, writer], verbose=True)

# Record each agent's participation in the task
result = crew.kickoff(task="Research AI trends and write a summary")
print(result)

# Combined audit trail (ordered by timestamp)
trail = crew.get_combined_audit_trail()
for entry in trail:
    print(f"[{entry['agent_id']}] {entry['intent_id']} -> {entry['outcome']}")
```

<a id="api-reference"></a>

## Referencia de la API

### `DCPCrewAgent`

El registro de DCP de un miembro de la tripulación: su pasaporte, el RPR de su principal y su propio registro de auditoría.

```python
DCPCrewAgent(
    role: str,                     # Agent role in the crew
    passport: dict[str, Any],     # DCP Agent Passport
    rpr: dict[str, Any],          # Responsible Principal Record
    secret_key: str = "",         # Kept on the agent; DCPCrewAgent does not sign with it
    session_nonce: str = "",      # Session nonce; a fresh one when empty, which a DCPCrew replaces with its own
    goal: str = "",               # Agent goal
    backstory: str = "",          # Agent context/backstory
)
```

<a id="methods"></a>

#### Métodos

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `log_action(action_type, outcome, evidence?, impact?, data_classes?)` | `(str, str, dict?, str?, list?) -> dict` | Registra una acción como entrada de auditoría con la forma de V2, encadenada por hash (la intención que hay detrás se resume con un hash, no se guarda). Lanza una excepción si el agente está dado de baja. |
| `get_audit_trail()` | `() -> list[dict]` | Devuelve el registro de auditoría del agente |
| `commission(purpose, capabilities, risk_tier)` | `(str, list?, str?) -> dict` | Pone en servicio al agente (DCP-05 §3.1) |
| `report_vitality(metrics)` | `(dict) -> dict` | Informa de métricas de vitalidad (DCP-05 §4.1) |
| `decommission(mode, reason)` | `(str, str) -> dict` | Da de baja al agente (DCP-05 §5.1) |
| `create_testament(successor_preferences, memory_classification)` | `(list, str) -> dict` | Crea un testamento digital (DCP-06 §3.1) |

#### `log_action`

```python
entry = researcher.log_action(
    action_type="api_call",
    outcome="success",
    evidence={"url": "https://api.example.com", "status": 200},
)
# entry contains chained intent_hash and prev_hash
```

Cada entrada de auditoría incluye:

- `intent_hash`: SHA-256 de la intención asociada
- `prev_hash`: `"GENESIS"` para la primera entrada, SHA-256 de la entrada anterior para las siguientes

### `DCPCrew`

Tripulación multiagente con gobernanza de DCP.

```python
DCPCrew(
    agents: list[DCPCrewAgent],   # List of DCP agents
    session_nonce: str = "",      # Crew nonce, a fresh one when empty; given to every agent that has not logged and was not given its own
    verbose: bool = False,        # Verbose logging
)
```

<a id="methods-1"></a>
<a id="methods_1"></a>

#### Métodos

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `kickoff(task)` | `(str) -> dict` | Registra una entrada de auditoría por agente para la tarea; no ejecuta CrewAI |
| `get_combined_audit_trail()` | `() -> list[dict]` | Registro combinado de todos los agentes, ordenado por marca de tiempo |
| `get_agent_bundles()` | `() -> dict[str, list[dict]]` | Registros individuales por `agent_id` |
| `commission_all(purpose?)` | `(str?) -> list[dict]` | Pone en servicio a todos los agentes de la tripulación (DCP-05 §3.1) |
| `succession(from_agent, to_agent)` | `(DCPCrewAgent, DCPCrewAgent) -> dict` | Crea un registro de sucesión (DCP-06 §4.1) |
| `delegate(human_id, agent, authority_scope)` | `(str, DCPCrewAgent, list) -> dict` | Registro de delegación sin firmar para un agente (DCP-09 §3.1); un mandato firmado se obtiene con `create_delegation_mandate` de `dcp_ai.v2` |
| `get_lifecycle_summary()` | `() -> list[dict]` | Obtiene el estado de ciclo de vida de cada agente |

### `get_combined_audit_trail()`

Combina y ordena cronológicamente los registros de auditoría de todos los agentes. Es una vista para leer: cada entrada es
una copia con un campo `_agent_role` añadido, que no forma parte de la entrada de auditoría V2, y la lista combinada no es
una cadena de hash (las entradas de cada agente solo se encadenan dentro de su propio registro). No canonicalices, resumas
con hash ni firmes estas copias como entradas de auditoría.

```python
combined = crew.get_combined_audit_trail()
# [
#   {"agent_id": "agent:researcher-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "researcher", ...},
#   {"agent_id": "agent:writer-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "writer", ...},
#   ...
# ]
```

### `get_agent_bundles()`

Devuelve los registros separados por agente:

```python
bundles = crew.get_agent_bundles()
# {
#   "agent:researcher-001": [entry1, entry2, ...],
#   "agent:writer-001": [entry3, entry4, ...],
# }
```

<a id="per-agent-trails"></a>

## Registros por agente

Continuando el inicio rápido, cada agente mantiene su propio registro encadenado por hash:

```python
crew = DCPCrew(agents=[researcher, writer])
crew.kickoff(task="Analyze the AI market")

# Unsigned records: seal signed bundles with the core SDK (docs/QUICKSTART_CREWAI.md)
for agent_id, trail in crew.get_agent_bundles().items():
    print(f"\n--- {agent_id} ({len(trail)} entries) ---")
    for entry in trail:
        print(f"  {entry['intent_id']}: {entry['outcome']}")
```

<a id="development"></a>

## Desarrollo

Desde un checkout:

```bash
cd sdks/python
pip install -e ".[crewai,dev]"
pytest -v
```

<a id="dependencies"></a>

### Dependencias

- `dcp-ai` — SDK de DCP (merkle, models, bundle)
- `crewai` — framework multiagente (lo instala el extra; `dcp_ai.crewai` en sí no lo importa)

<a id="license"></a>

## Licencia

Apache-2.0
