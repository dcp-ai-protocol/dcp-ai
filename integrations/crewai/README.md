# dcp_ai.crewai — CrewAI Integration

Integracion de DCP con CrewAI para gobernanza multi-agente. Cada agente tiene su propio pasaporte DCP y audit trail, con soporte para combinar trails de toda la crew.

## Instalacion

```bash
pip install "dcp-ai[crewai]"
```

## Quickstart

```python
from dcp_ai.crewai import DCPCrewAgent, DCPCrew

# Definir agentes con pasaporte individual
researcher = DCPCrewAgent(
    role="researcher",
    passport={
        "dcp_version": "1.0",
        "agent_id": "researcher-001",
        "human_id": "human-001",
        "agent_name": "Researcher",
        "capabilities": ["browse", "api_call"],
        "risk_tier": "low",
        "status": "active",
        "created_at": "2025-01-01T00:00:00Z",
        "expires_at": None,
    },
    hbr={
        "dcp_version": "1.0",
        "human_id": "human-001",
        "entity_type": "natural_person",
        "jurisdiction": "ES",
        "liability_mode": "full",
        "created_at": "2025-01-01T00:00:00Z",
        "expires_at": None,
    },
    goal="Investigar y recopilar informacion",
    backstory="Experto en busqueda de informacion",
)

writer = DCPCrewAgent(
    role="writer",
    passport={
        "dcp_version": "1.0",
        "agent_id": "writer-001",
        "human_id": "human-001",
        "agent_name": "Writer",
        "capabilities": ["write_file"],
        "risk_tier": "medium",
        "status": "active",
        "created_at": "2025-01-01T00:00:00Z",
        "expires_at": None,
    },
    hbr={
        "dcp_version": "1.0",
        "human_id": "human-001",
        "entity_type": "natural_person",
        "jurisdiction": "ES",
        "liability_mode": "full",
        "created_at": "2025-01-01T00:00:00Z",
        "expires_at": None,
    },
    goal="Redactar contenido de calidad",
    backstory="Escritor profesional con experiencia en IA",
)

# Crear crew con gobernanza DCP
crew = DCPCrew(agents=[researcher, writer], verbose=True)

# Ejecutar
result = crew.kickoff(task="Investigar tendencias de IA y escribir un resumen")
print(result)

# Audit trail combinado (ordenado por timestamp)
trail = crew.get_combined_audit_trail()
for entry in trail:
    print(f"[{entry['agent_id']}] {entry['action_type']} -> {entry['outcome']}")
```

## API Reference

### `DCPCrewAgent`

Agente compatible con CrewAI que incluye pasaporte DCP individual y audit trail.

```python
DCPCrewAgent(
    role: str,                     # Rol del agente en la crew
    passport: dict[str, Any],     # Agent Passport DCP
    hbr: dict[str, Any],          # Human Binding Record
    secret_key: str = "",         # Clave secreta Ed25519 (base64)
    goal: str = "",               # Objetivo del agente
    backstory: str = "",          # Contexto/historia del agente
)
```

#### Metodos

| Metodo | Firma | Descripcion |
|--------|-------|-------------|
| `log_action(action_type, outcome, evidence?)` | `(str, str, dict?) -> dict` | Registra una accion como DCP AuditEntry con hash-chaining |
| `get_audit_trail()` | `() -> list[dict]` | Retorna el audit trail del agente |

#### `log_action`

```python
entry = researcher.log_action(
    action_type="api_call",
    outcome="success",
    evidence={"url": "https://api.example.com", "status": 200},
)
# entry contiene intent_hash y prev_hash encadenados
```

Cada audit entry incluye:
- `intent_hash`: SHA-256 del intent asociado
- `prev_hash`: `"GENESIS"` para la primera entrada, SHA-256 de la entrada anterior para las siguientes

### `DCPCrew`

Crew multi-agente con gobernanza DCP.

```python
DCPCrew(
    agents: list[DCPCrewAgent],   # Lista de agentes DCP
    verbose: bool = False,        # Logging detallado
)
```

#### Metodos

| Metodo | Firma | Descripcion |
|--------|-------|-------------|
| `kickoff(task)` | `(str) -> dict` | Ejecuta la crew con la tarea especificada |
| `get_combined_audit_trail()` | `() -> list[dict]` | Trail combinado de todos los agentes, ordenado por timestamp |
| `get_agent_bundles()` | `() -> dict[str, list[dict]]` | Trails individuales por `agent_id` |

### `get_combined_audit_trail()`

Combina y ordena cronologicamente los audit trails de todos los agentes:

```python
combined = crew.get_combined_audit_trail()
# [
#   {"agent_id": "researcher-001", "timestamp": "...", "action_type": "browse", ...},
#   {"agent_id": "writer-001", "timestamp": "...", "action_type": "write_file", ...},
#   ...
# ]
```

### `get_agent_bundles()`

Retorna los trails separados por agente:

```python
bundles = crew.get_agent_bundles()
# {
#   "researcher-001": [entry1, entry2, ...],
#   "writer-001": [entry3, entry4, ...],
# }
```

## Ejemplo avanzado — Crew con claves individuales

```python
from dcp_ai import generate_keypair
from dcp_ai.crewai import DCPCrewAgent, DCPCrew

# Cada agente con su propia clave
keys_r = generate_keypair()
keys_w = generate_keypair()

researcher = DCPCrewAgent(
    role="researcher",
    passport={...},
    hbr={...},
    secret_key=keys_r["secret_key_b64"],
)

writer = DCPCrewAgent(
    role="writer",
    passport={...},
    hbr={...},
    secret_key=keys_w["secret_key_b64"],
)

crew = DCPCrew(agents=[researcher, writer])
crew.kickoff(task="Analizar mercado de IA")

# Cada agente tiene su propio trail verificable
for agent_id, trail in crew.get_agent_bundles().items():
    print(f"\n--- {agent_id} ({len(trail)} entries) ---")
    for entry in trail:
        print(f"  {entry['action_type']}: {entry['outcome']}")
```

## Desarrollo

```bash
pip install "dcp-ai[crewai,dev]"
pytest -v
```

### Dependencias

- `dcp-ai` — SDK DCP (merkle, models, bundle)
- `crewai` — Framework multi-agente

## Licencia

Apache-2.0
