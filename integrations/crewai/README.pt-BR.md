<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp_aicrewai--crewai-integration"></a>
<a id="dcp_aicrewai-crewai-integration"></a>

# dcp_ai.crewai — integração com o CrewAI

> Tradução informativa da [versão em inglês](README.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Integração do DCP com o CrewAI para a governança multiagente. Cada agente tem o seu próprio passaporte do DCP e a sua própria trilha de auditoria, com a possibilidade de combinar as trilhas de toda a equipe.

`DCPCrewAgent` e `DCPCrew` guardam registros do DCP ao lado de uma equipe: entradas de auditoria encadeadas por hash no formato V2, e registros de ciclo de vida e de sucessão. Não assinam nada e não executam o CrewAI por conta própria. Para bundles de cidadania assinados e verificáveis de uma equipe do CrewAI, use o SDK principal como em [docs/QUICKSTART_CREWAI.md](../../docs/QUICKSTART_CREWAI.md).

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, de forma parcial: registros não assinados nos formatos dessas especificações. Não as implementa
por completo.

<a id="installation"></a>

## Instalação

**Publicado no PyPI (26/10/2026).** O `dcp-ai` 2.10.0 inclui a implementação descrita aqui. Atualize da 2.9.0 e renove seu ambiente ou arquivo de lock. Veja as [notas de Python](../../docs/PYTHON_RELEASE.md).

A versão 2.10.0 compartilha o nonce da sessão da equipe com os agentes elegíveis, conforme descrito abaixo, corrigindo a 2.9.0. Esses auxiliares continuam produzindo registros não assinados e não executam CrewAI; use as APIs de assinatura do SDK para bundles verificáveis.

```bash
pip install "dcp-ai[crewai]>=2.10.0,<3"
```

Para desenvolvimento do código-fonte:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[crewai]"
```

<a id="quickstart"></a>

## Início rápido

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

## Referência da API

### `DCPCrewAgent`

O registro do DCP de um membro da equipe: o seu passaporte, o RPR do seu principal e a sua própria trilha de auditoria.

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

| Método | Assinatura | Descrição |
|--------|-----------|-------------|
| `log_action(action_type, outcome, evidence?, impact?, data_classes?)` | `(str, str, dict?, str?, list?) -> dict` | Registra uma ação como entrada de auditoria no formato V2, encadeada por hash (a intenção por trás dela é resumida por hash, não guardada). Lança uma exceção se o agente estiver desativado. |
| `get_audit_trail()` | `() -> list[dict]` | Devolve a trilha de auditoria do agente |
| `commission(purpose, capabilities, risk_tier)` | `(str, list?, str?) -> dict` | Coloca o agente em serviço (DCP-05 §3.1) |
| `report_vitality(metrics)` | `(dict) -> dict` | Informa métricas de vitalidade (DCP-05 §4.1) |
| `decommission(mode, reason)` | `(str, str) -> dict` | Desativa o agente (DCP-05 §5.1) |
| `create_testament(successor_preferences, memory_classification)` | `(list, str) -> dict` | Cria um testamento digital (DCP-06 §3.1) |

#### `log_action`

```python
entry = researcher.log_action(
    action_type="api_call",
    outcome="success",
    evidence={"url": "https://api.example.com", "status": 200},
)
# entry contains chained intent_hash and prev_hash
```

Cada entrada de auditoria inclui:

- `intent_hash`: SHA-256 da intenção associada
- `prev_hash`: `"GENESIS"` para a primeira entrada, SHA-256 da entrada anterior para as seguintes

### `DCPCrew`

Equipe multiagente com governança do DCP.

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

| Método | Assinatura | Descrição |
|--------|-----------|-------------|
| `kickoff(task)` | `(str) -> dict` | Registra uma entrada de auditoria por agente para a tarefa; não executa o CrewAI |
| `get_combined_audit_trail()` | `() -> list[dict]` | Trilha combinada de todos os agentes, ordenada por carimbo de data/hora |
| `get_agent_bundles()` | `() -> dict[str, list[dict]]` | Trilhas individuais por `agent_id` |
| `commission_all(purpose?)` | `(str?) -> list[dict]` | Coloca em serviço todos os agentes da equipe (DCP-05 §3.1) |
| `succession(from_agent, to_agent)` | `(DCPCrewAgent, DCPCrewAgent) -> dict` | Cria um registro de sucessão (DCP-06 §4.1) |
| `delegate(human_id, agent, authority_scope)` | `(str, DCPCrewAgent, list) -> dict` | Registro de delegação não assinado para um agente (DCP-09 §3.1); um mandato assinado vem de `create_delegation_mandate` em `dcp_ai.v2` |
| `get_lifecycle_summary()` | `() -> list[dict]` | Obtém o estado de ciclo de vida de cada agente |

### `get_combined_audit_trail()`

Combina e ordena cronologicamente as trilhas de auditoria de todos os agentes. É uma visão para leitura: cada entrada é
uma cópia com um campo `_agent_role` acrescentado, que não faz parte da entrada de auditoria V2, e a lista combinada não
é uma cadeia de hash (as entradas de cada agente só se encadeiam dentro da sua própria trilha). Não canonicalize, resuma
por hash nem assine essas cópias como entradas de auditoria.

```python
combined = crew.get_combined_audit_trail()
# [
#   {"agent_id": "agent:researcher-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "researcher", ...},
#   {"agent_id": "agent:writer-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "writer", ...},
#   ...
# ]
```

### `get_agent_bundles()`

Devolve as trilhas separadas por agente:

```python
bundles = crew.get_agent_bundles()
# {
#   "agent:researcher-001": [entry1, entry2, ...],
#   "agent:writer-001": [entry3, entry4, ...],
# }
```

<a id="per-agent-trails"></a>

## Trilhas por agente

Continuando o início rápido, cada agente mantém a sua própria trilha encadeada por hash:

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

## Desenvolvimento

A partir de um checkout:

```bash
cd sdks/python
pip install -e ".[crewai,dev]"
pytest -v
```

<a id="dependencies"></a>

### Dependências

- `dcp-ai` — SDK do DCP (merkle, models, bundle)
- `crewai` — framework multiagente (instalado pelo extra; o próprio `dcp_ai.crewai` não o importa)

<a id="license"></a>

## Licença

Apache-2.0
