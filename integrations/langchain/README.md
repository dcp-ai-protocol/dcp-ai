# dcp_ai.langchain — LangChain Integration

DCP integration with LangChain. Wraps LangChain agents with digital citizenship, generates audit trails with automatic hash-chaining, and provides verification tools.

## Supported DCP Specifications

DCP-01 through DCP-09.

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
rpr = {
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
    rpr=rpr,
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
    rpr: dict[str, Any],          # Responsible Principal Record
    secret_key: str,              # Ed25519 secret key (base64)
    auto_intent: bool = True,     # Auto-generate intents
    policy_engine: Any = None,    # Custom policy engine (optional)
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `invoke(inputs, **kwargs)` | Executes the agent with DCP governance. Generates Intent, PolicyDecision, and AuditEntry. Blocks if decommissioned. |
| `get_audit_trail()` | Returns the list of audit entries with hash-chaining. |
| `commission(purpose, capabilities, risk_tier)` | Commission the agent (DCP-05 §3.1). |
| `report_vitality(metrics_dict)` | Report vitality metrics and compute score (DCP-05 §4.1). |
| `decommission(termination_mode, reason)` | Decommission the agent (DCP-05 §5.1). |
| `declare_rights(rights, jurisdiction)` | Declare rights (DCP-08 §3.1). |

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
| `run(signed_bundle_json)` | `(str \| dict) -> str` | Synchronous verification, with or without a running event loop |
| `arun(signed_bundle_json)` | `(str \| dict) -> str` | Asynchronous verification |

A V2 bundle is verified with `verify_signed_bundle_v2` from `dcp_ai.v2` (composite signatures,
session binding, manifest, cross-artifact consistency, audit chain, key validity) under
`DCPTool(verifier_policy=...)`: a dict of `VerifierPolicy` fields set over
`DEFAULT_VERIFIER_POLICY` (a `default_mode` without `risk_overrides` applies to every risk tier),
or a full `VerifierPolicy`; the default is `DEFAULT_VERIFIER_POLICY`. A V1 bundle, which has an Ed25519 signature only, no
intended_verifier and no session window, is accepted only when the policy has `allow_v1_bundles`,
accepts ed25519 (`accepted_classical_algs`, no `advisory_rejected_algs` entry), requires no
audience binding, session expiry or maximum session duration, and would accept a classical-only
bundle for its risk tier and security tier (`spec/VERIFICATION.md` V2-10); its artifacts must be
objects. The
result is `Bundle VERIFIED (v<version>) for agent <agent_id>` or `Bundle INVALID: <errors>`, with
the verifier's errors. The text is bounded (at most 20 errors of 500 characters, an `agent_id` of
200) and the parts that come from the bundle have their control and format characters escaped
(`\u000a` for a newline), since they reach the model's context.

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
| `on_lifecycle_event(event_type, details)` | Records lifecycle events (DCP-05) |
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
    rpr=rpr,
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
