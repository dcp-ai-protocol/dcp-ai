# dcp_ai.openai — OpenAI Integration

DCP wrapper for the OpenAI client. Adds automatic DCP governance to chat calls, function calling with DCP tools, and audit trail with hash-chaining.

## Installation

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

# Wrap the OpenAI client
dcp_client = DCPOpenAIClient(
    openai_client=client,
    passport=passport,
    hbr=hbr,
    secret_key=keys["secret_key_b64"],
)

# Use like the normal client
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Summarize today's news"}],
)
print(response.choices[0].message.content)

# Query audit trail
trail = dcp_client.get_audit_trail()
for entry in trail:
    print(f"[{entry['timestamp']}] {entry['action_type']}")
```

## API Reference

### `DCPOpenAIClient`

Wrapper for the OpenAI client with automatic DCP governance.

```python
DCPOpenAIClient(
    openai_client: Any,           # OpenAI() instance
    passport: dict[str, Any],    # DCP Agent Passport
    hbr: dict[str, Any],         # Human Binding Record
    secret_key: str = "",        # Ed25519 secret key (base64)
    auto_intent: bool = True,    # Auto-inject DCP tools
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `chat_completions_create(**kwargs)` | Creates a chat completion with DCP governance. Generates an Intent and AuditEntry for each call. |
| `get_audit_trail()` | Returns the full list of audit entries with hash-chaining. |

#### `chat_completions_create` Flow

1. Creates an `Intent` declaring the `api_call` action
2. Evaluates a `PolicyDecision`
3. Executes `client.chat.completions.create()`
4. Records an `AuditEntry` with the result
5. Automatically chains hashes

### `DCP_TOOLS`

List of OpenAI function calling tool definitions for DCP:

```python
from dcp_ai.openai import DCP_TOOLS

# Inject into a chat call
response = client.chat.completions.create(
    model="gpt-4",
    messages=[...],
    tools=DCP_TOOLS,
)
```

#### Available Tools

| Tool | Parameters | Description |
|------|------------|-------------|
| `dcp_verify_bundle` | `signed_bundle_json: string` | Verifies a DCP Signed Bundle |
| `dcp_declare_intent` | `action_type: enum`, `target_channel: enum`, `data_classes?: string[]`, `estimated_impact?: enum` | Declares intent before an action (DCP-02) |

**`action_type`**: `browse`, `api_call`, `send_email`, `create_calendar_event`, `initiate_payment`, `update_crm`, `write_file`, `execute_code`

**`target_channel`**: `web`, `api`, `email`, `calendar`, `payments`, `crm`, `filesystem`, `runtime`

**`estimated_impact`**: `low`, `medium`, `high`

### `handle_dcp_tool_call(tool_name, arguments)`

Processes DCP tool calls returned by OpenAI.

```python
from dcp_ai.openai import handle_dcp_tool_call

# After receiving a tool_call from the model
for tool_call in response.choices[0].message.tool_calls:
    if tool_call.function.name.startswith("dcp_"):
        result = handle_dcp_tool_call(
            tool_call.function.name,
            json.loads(tool_call.function.arguments),
        )
        print(result)  # JSON with the result
```

## Advanced Example — Function Calling with DCP

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

# First call: the model can use DCP tools
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "Declare your intent to make an API call"},
    ],
)

# Process tool calls
message = response.choices[0].message
if message.tool_calls:
    for tc in message.tool_calls:
        result = handle_dcp_tool_call(
            tc.function.name,
            json.loads(tc.function.arguments),
        )
        print(f"Tool: {tc.function.name} -> {result}")
```

## Development

```bash
pip install "dcp-ai[openai,dev]"
pytest -v
```

### Dependencies

- `dcp-ai` — DCP SDK (crypto, merkle, verify, models)
- `openai` — Official OpenAI client

## License

Apache-2.0
