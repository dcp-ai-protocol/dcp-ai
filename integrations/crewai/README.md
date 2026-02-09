# dcp_ai.crewai — CrewAI Integration

DCP integration with CrewAI for multi-agent governance. Each agent has its own DCP passport and audit trail, with support for combining trails across the entire crew.

## Installation

```bash
pip install "dcp-ai[crewai]"
```

## Quickstart

```python
from dcp_ai.crewai import DCPCrewAgent, DCPCrew

# Define agents with individual passports
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
    goal="Research and gather information",
    backstory="Expert in information retrieval",
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
    goal="Produce high-quality content",
    backstory="Professional writer with AI experience",
)

# Create crew with DCP governance
crew = DCPCrew(agents=[researcher, writer], verbose=True)

# Execute
result = crew.kickoff(task="Research AI trends and write a summary")
print(result)

# Combined audit trail (ordered by timestamp)
trail = crew.get_combined_audit_trail()
for entry in trail:
    print(f"[{entry['agent_id']}] {entry['action_type']} -> {entry['outcome']}")
```

## API Reference

### `DCPCrewAgent`

CrewAI-compatible agent that includes an individual DCP passport and audit trail.

```python
DCPCrewAgent(
    role: str,                     # Agent role in the crew
    passport: dict[str, Any],     # DCP Agent Passport
    hbr: dict[str, Any],          # Human Binding Record
    secret_key: str = "",         # Ed25519 secret key (base64)
    goal: str = "",               # Agent goal
    backstory: str = "",          # Agent context/backstory
)
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `log_action(action_type, outcome, evidence?)` | `(str, str, dict?) -> dict` | Records an action as a DCP AuditEntry with hash-chaining |
| `get_audit_trail()` | `() -> list[dict]` | Returns the agent's audit trail |

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
    verbose: bool = False,        # Verbose logging
)
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `kickoff(task)` | `(str) -> dict` | Executes the crew with the specified task |
| `get_combined_audit_trail()` | `() -> list[dict]` | Combined trail from all agents, ordered by timestamp |
| `get_agent_bundles()` | `() -> dict[str, list[dict]]` | Individual trails by `agent_id` |

### `get_combined_audit_trail()`

Combines and chronologically orders the audit trails of all agents:

```python
combined = crew.get_combined_audit_trail()
# [
#   {"agent_id": "researcher-001", "timestamp": "...", "action_type": "browse", ...},
#   {"agent_id": "writer-001", "timestamp": "...", "action_type": "write_file", ...},
#   ...
# ]
```

### `get_agent_bundles()`

Returns trails separated by agent:

```python
bundles = crew.get_agent_bundles()
# {
#   "researcher-001": [entry1, entry2, ...],
#   "writer-001": [entry3, entry4, ...],
# }
```

## Advanced Example — Crew with Individual Keys

```python
from dcp_ai import generate_keypair
from dcp_ai.crewai import DCPCrewAgent, DCPCrew

# Each agent with its own key
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
crew.kickoff(task="Analyze the AI market")

# Each agent has its own verifiable trail
for agent_id, trail in crew.get_agent_bundles().items():
    print(f"\n--- {agent_id} ({len(trail)} entries) ---")
    for entry in trail:
        print(f"  {entry['action_type']}: {entry['outcome']}")
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
