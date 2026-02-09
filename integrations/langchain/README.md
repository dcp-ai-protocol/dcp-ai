# dcp_ai.langchain — LangChain Integration

DCP integration with LangChain. Wraps LangChain agents with digital citizenship, generates audit trails with automatic hash-chaining, and provides verification tools.

## Installation

```bash
pip install "dcp-ai[langchain]"
```

## Quickstart

```python
from dcp_ai import generate_keypair
from dcp_ai.langchain import DCPAgentWrapper

# Keypair of the responsible human
keys = generate_keypair()

# DCP agent data
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

# Wrap an existing LangChain agent
wrapped = DCPAgentWrapper(
    agent=my_langchain_agent,       # Your LangChain agent
    passport=passport,
    hbr=hbr,
    secret_key=keys["secret_key_b64"],
    auto_intent=True,               # Automatically generate intents
)

# Execute with DCP governance
result = wrapped.invoke({"input": "Search for information about AI"})

# Query audit trail
trail = wrapped.get_audit_trail()
for entry in trail:
    print(f"[{entry['timestamp']}] {entry['action_type']} -> {entry['outcome']}")
```

## API Reference

### `DCPAgentWrapper`

Wraps a LangChain agent with full DCP citizenship.

```python
DCPAgentWrapper(
    agent: Any,                    # LangChain agent
    passport: dict[str, Any],     # DCP Agent Passport
    hbr: dict[str, Any],          # Human Binding Record
    secret_key: str,              # Ed25519 secret key (base64)
    auto_intent: bool = True,     # Auto-generate intents
    policy_engine: Any = None,    # Custom policy engine (optional)
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `invoke(inputs, **kwargs)` | Executes the agent with DCP governance. Generates Intent, PolicyDecision, and AuditEntry. |
| `get_audit_trail()` | Returns the list of audit entries with hash-chaining. |

#### Execution Flow

1. Creates an `Intent` declaring the action
2. Evaluates the `PolicyDecision` (allow/deny)
3. If `allow`: executes the LangChain agent
4. Creates an `AuditEntry` with the result
5. Chains hashes: `intent_hash` and `prev_hash` (GENESIS → hash(previous entry))

### `DCPTool`

LangChain tool for verifying DCP bundles from within an agent.

```python
from dcp_ai.langchain import DCPTool

tool = DCPTool()

# Use in a LangChain agent
agent = initialize_agent(
    tools=[tool, ...other_tools],
    llm=llm,
)
```

#### Attributes

| Attribute | Value |
|-----------|-------|
| `name` | `"dcp_verify_bundle"` |
| `description` | `"Verify a DCP signed bundle..."` |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `run(signed_bundle_json)` | `(str) -> str` | Synchronous verification |
| `arun(signed_bundle_json)` | `(str) -> str` | Asynchronous verification |

### `DCPCallback`

Callback handler for automatic audit entry logging.

```python
from dcp_ai.langchain import DCPCallback

callback = DCPCallback(
    agent_id="agent-001",
    human_id="human-001",
)

# Use as a callback in LangChain
agent.invoke(
    {"input": "..."},
    callbacks=[callback],
)

# Get generated audit entries
entries = callback.get_entries()
```

#### Methods

| Method | Description |
|--------|-------------|
| `on_chain_start(serialized, inputs, **kwargs)` | Records chain start |
| `on_chain_end(outputs, **kwargs)` | Records chain end |
| `get_entries()` | Returns list of audit entries |

## Advanced Example — Agent with Custom Policy Engine

```python
class MyPolicyEngine:
    def evaluate(self, intent):
        # Deny high-impact actions
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

## Development

```bash
pip install "dcp-ai[langchain,dev]"
pytest -v
```

### Dependencies

- `dcp-ai` — DCP SDK (crypto, merkle, verify, models)
- `langchain` + `langchain-core` — Agent framework

## License

Apache-2.0
