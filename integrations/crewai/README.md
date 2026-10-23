# dcp_ai.crewai — CrewAI Integration

DCP integration with CrewAI for multi-agent governance. Each agent has its own DCP passport and audit trail, with support for combining trails across the entire crew.

`DCPCrewAgent` and `DCPCrew` keep DCP records next to a crew: hash-chained V2 audit entries, lifecycle and succession records. They do not sign anything and do not run CrewAI themselves. For signed, verifiable citizenship bundles of a CrewAI crew, use the core SDK as in [docs/QUICKSTART_CREWAI.md](../../docs/QUICKSTART_CREWAI.md).

## Supported DCP Specifications

DCP-01 through DCP-09.

## Installation

```bash
pip install "dcp-ai[crewai]"
```

## Quickstart

```python
from dcp_ai.crewai import DCPCrewAgent, DCPCrew

# The V2 payloads of the principal's RPR and of each agent's passport
# (DCPCrewAgent reads human_id, agent_id and capabilities)
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

## API Reference

### `DCPCrewAgent`

A crew member's DCP record: its passport, its principal's RPR and its own audit trail.

```python
DCPCrewAgent(
    role: str,                     # Agent role in the crew
    passport: dict[str, Any],     # DCP Agent Passport
    rpr: dict[str, Any],          # Responsible Principal Record
    secret_key: str = "",         # Kept on the agent; DCPCrewAgent does not sign with it
    session_nonce: str = "",      # Session nonce; a fresh one when empty
    goal: str = "",               # Agent goal
    backstory: str = "",          # Agent context/backstory
)
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `log_action(action_type, outcome, evidence?, impact?, data_classes?)` | `(str, str, dict?, str?, list?) -> dict` | Records an action as a V2 audit entry with hash-chaining (the intent behind it is hashed, not kept). Raises if decommissioned. |
| `get_audit_trail()` | `() -> list[dict]` | Returns the agent's audit trail |
| `commission(purpose, capabilities, risk_tier)` | `(str, list?, str?) -> dict` | Commission the agent (DCP-05 §3.1) |
| `report_vitality(metrics)` | `(dict) -> dict` | Report vitality metrics (DCP-05 §4.1) |
| `decommission(mode, reason)` | `(str, str) -> dict` | Decommission the agent (DCP-05 §5.1) |
| `create_testament(successor_preferences, memory_classification)` | `(list, str) -> dict` | Create digital testament (DCP-06 §3.1) |

#### `log_action`

```python
entry = researcher.log_action(
    action_type="api_call",
    outcome="success",
    evidence={"url": "https://api.example.com", "status": 200},
)
# entry contains chained intent_hash and prev_hash
```

Each audit entry includes:
- `intent_hash`: SHA-256 of the associated intent
- `prev_hash`: `"GENESIS"` for the first entry, SHA-256 of the previous entry for subsequent ones

### `DCPCrew`

Multi-agent crew with DCP governance.

```python
DCPCrew(
    agents: list[DCPCrewAgent],   # List of DCP agents
    session_nonce: str = "",      # Crew session nonce; a fresh one when empty
    verbose: bool = False,        # Verbose logging
)
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `kickoff(task)` | `(str) -> dict` | Records one audit entry per agent for the task; it does not run CrewAI |
| `get_combined_audit_trail()` | `() -> list[dict]` | Combined trail from all agents, ordered by timestamp |
| `get_agent_bundles()` | `() -> dict[str, list[dict]]` | Individual trails by `agent_id` |
| `commission_all(purpose?)` | `(str?) -> list[dict]` | Commission all agents in the crew (DCP-05 §3.1) |
| `succession(from_agent, to_agent)` | `(DCPCrewAgent, DCPCrewAgent) -> dict` | Create succession record (DCP-06 §4.1) |
| `delegate(human_id, agent, authority_scope)` | `(str, DCPCrewAgent, list) -> dict` | Unsigned delegation record for an agent (DCP-09 §3.1); a signed mandate comes from `create_delegation_mandate` in `dcp_ai.v2` |
| `get_lifecycle_summary()` | `() -> list[dict]` | Get lifecycle state of each agent |

### `get_combined_audit_trail()`

Combines and chronologically orders the audit trails of all agents:

```python
combined = crew.get_combined_audit_trail()
# [
#   {"agent_id": "agent:researcher-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "researcher", ...},
#   {"agent_id": "agent:writer-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "writer", ...},
#   ...
# ]
```

### `get_agent_bundles()`

Returns trails separated by agent:

```python
bundles = crew.get_agent_bundles()
# {
#   "agent:researcher-001": [entry1, entry2, ...],
#   "agent:writer-001": [entry3, entry4, ...],
# }
```

## Per-Agent Trails

Continuing the quickstart, each agent keeps its own hash-chained trail:

```python
crew = DCPCrew(agents=[researcher, writer])
crew.kickoff(task="Analyze the AI market")

# Unsigned records: seal signed bundles with the core SDK (docs/QUICKSTART_CREWAI.md)
for agent_id, trail in crew.get_agent_bundles().items():
    print(f"\n--- {agent_id} ({len(trail)} entries) ---")
    for entry in trail:
        print(f"  {entry['intent_id']}: {entry['outcome']}")
```

## Development

```bash
pip install "dcp-ai[crewai,dev]"
pytest -v
```

### Dependencies

- `dcp-ai` — DCP SDK (merkle, models, bundle)
- `crewai` — Multi-agent framework

## License

Apache-2.0
