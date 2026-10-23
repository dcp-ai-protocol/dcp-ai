# dcp_ai.openai — OpenAI Integration

DCP wrapper for the OpenAI client. Adds automatic DCP governance to chat calls, function calling with DCP tools, and audit trail with hash-chaining.

## Supported DCP Specifications

DCP-01 through DCP-09.

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
rpr = {
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
    rpr=rpr,
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
    rpr: dict[str, Any],         # Responsible Principal Record
    secret_key: str = "",        # Ed25519 secret key (base64)
    auto_intent: bool = True,    # Auto-inject DCP tools
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `chat_completions_create(**kwargs)` | Creates a chat completion with DCP governance. Generates an Intent and AuditEntry for each call. |
| `commission(purpose, capabilities?)` | Commission the agent (DCP-05 §3.1). |
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
| `dcp_commission_agent` | `purpose: string`, `capabilities?: string[]`, `risk_tier?: enum` | Commission agent (DCP-05 §3.1) |
| `dcp_report_vitality` | `task_completion_rate`, `error_rate`, `satisfaction`, `policy_alignment` | Report vitality metrics (DCP-05 §4.1) |
| `dcp_declare_rights` | `rights: string[]`, `jurisdiction: string` | Declare agent rights (DCP-08 §3.1) |
| `dcp_create_mandate` | `human_id: string`, `authority_scope: string[]` | Create delegation mandate (DCP-09 §3.1) |

**`action_type`**: `browse`, `api_call`, `send_email`, `create_calendar_event`, `initiate_payment`, `update_crm`, `write_file`, `execute_code`

**`target_channel`**: `web`, `api`, `email`, `calendar`, `payments`, `crm`, `filesystem`, `runtime`

**`estimated_impact`**: `low`, `medium`, `high`

### `handle_dcp_tool_call(tool_name, arguments, session_nonce="", verifier_policy=None)`

Processes DCP tool calls returned by OpenAI.

`dcp_verify_bundle` verifies a V2 bundle with `verify_signed_bundle_v2` from `dcp_ai.v2` under
`verifier_policy`: a dict of `VerifierPolicy` fields set over `DEFAULT_VERIFIER_POLICY` (a
`default_mode` without `risk_overrides` applies to every risk tier), or a full `VerifierPolicy`;
the default is `DEFAULT_VERIFIER_POLICY`. A V1 bundle, which has an Ed25519 signature only, no
intended_verifier and no session window, is accepted only when the policy has `allow_v1_bundles`,
accepts ed25519 (`accepted_classical_algs`, no `advisory_rejected_algs` entry), requires no
audience binding, session expiry or maximum session duration, and would accept a classical-only
bundle for its risk tier and security tier (`spec/VERIFICATION.md` V2-10); its artifacts must be
objects. The result is JSON with
`verified`, `dcp_version`, the verifier's `errors` and `warnings` (at most 20 each, of 500
characters) and, for V2, its `details` (each value bounded the same way), with the control and
format characters of bundle-supplied text escaped. It works with or without a running event loop,
and leaves the thread's current event loop as it was; async code can await
`averify_bundle_tool_call(arguments, verifier_policy)` instead.

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
    rpr=rpr,
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
