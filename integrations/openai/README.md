# dcp_ai.openai — OpenAI Integration

DCP wrapper for the OpenAI Python client. Creates an intent for each chat call and records an audit entry when the call returns, offers DCP tools for function calling, and keeps the audit trail hash-chained.

The wrapper keeps **unsigned records** and evaluates **no policy**: every call runs, and its audit entry records `policy_decision: "approved"`. The `secret_key` it accepts is not used. For signed bundles and a policy gate around function calls, follow [docs/QUICKSTART_OPENAI.md](../../docs/QUICKSTART_OPENAI.md).

## Supported DCP Specifications

DCP-01 through DCP-09, partially: unsigned records and drafts in the shapes of these specifications, and bundle
verification through `dcp_verify_bundle`. It does not implement them in full.

## Installation

> **Release status (25/10/2026).** PyPI has `dcp-ai` 2.9.0. In it, the `dcp_verify_bundle` tool of `handle_dcp_tool_call` sends every bundle to the V1 verifier: every V2 bundle is rejected, and a V1 bundle is accepted under no verifier policy. The `verifier_policy` argument, `averify_bundle_tool_call` and the V2 verification described below are in the source on `main` (see the `[Unreleased]` section of [CHANGELOG.md](../../CHANGELOG.md)).

From a checkout (this page's version):

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install "/path/to/dcp-ai/sdks/python[openai]"
```

The published version (2.9.0), with the limits above:

```bash
pip install "dcp-ai[openai]"
```

The examples call the OpenAI API: they need `OPENAI_API_KEY` in the environment and are billed by OpenAI.

## Quickstart

```python
from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient

client = OpenAI()  # reads OPENAI_API_KEY from the environment

# The wrapper reads agent_id from the passport and human_id from the RPR;
# it does not check or sign them.
passport = {"agent_id": "agent:gpt-assistant-001", "capabilities": ["browse", "api_call"], "risk_tier": "medium"}
rpr = {"human_id": "rpr:human-001"}

dcp_client = DCPOpenAIClient(openai_client=client, passport=passport, rpr=rpr)

# Without tools of your own, the DCP tools are added (auto_intent=True), so the
# model may answer with tool calls instead of text.
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Summarize today's news"}],
)
message = response.choices[0].message
print(message.content or message.tool_calls)

for entry in dcp_client.get_audit_trail():
    print(f"[{entry['timestamp']}] {entry['intent_id']} -> {entry['outcome']}")
```

## API Reference

### `DCPOpenAIClient`

```python
DCPOpenAIClient(
    openai_client: Any,           # OpenAI() instance
    passport: dict[str, Any],     # agent_id and, for commission, capabilities and risk_tier are read
    rpr: dict[str, Any],          # human_id is read
    secret_key: str = "",         # Accepted but not used: nothing is signed
    session_nonce: str = "",      # A fresh one when empty
    auto_intent: bool = True,     # Adds DCP_TOOLS to calls that pass no tools
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `chat_completions_create(**kwargs)` | Creates an intent, calls `client.chat.completions.create(**kwargs)` and, if it returns, records an audit entry. A call that raises propagates its exception and leaves no audit entry. |
| `commission(purpose, capabilities?)` | Commission the agent (DCP-05 §3.1); returns an unsigned certificate and records an audit entry. The certificate and the `commissioned` state are local: nothing is attested or sent elsewhere. |
| `get_audit_trail()` | The audit entries, hash-chained: the in-memory list itself, not a copy, so changing it changes the trail. |
| `get_session_nonce()` | The session nonce. |

#### `chat_completions_create` Flow

1. Creates an intent: `action_type: "api_call"`, channel `api`, `estimated_impact: "low"`, `data_classes: ["none"]`.
2. Adds `DCP_TOOLS` when `auto_intent` is on and the call passes no `tools`.
3. Executes `client.chat.completions.create()`. No policy decision is made: the call always runs.
4. If the call returns, records an audit entry with `policy_decision: "approved"` and the response `id` as `evidence.result_ref`, chained to the previous entry.

### `DCP_TOOLS`

OpenAI function calling tool definitions for DCP:

```python
# Fragment: client as in the Quickstart
from dcp_ai.openai import DCP_TOOLS

messages = [{"role": "user", "content": "Declare your intent to make an API call"}]
response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    tools=DCP_TOOLS,
)
```

#### Available Tools

| Tool | Parameters | Description |
|------|------------|-------------|
| `dcp_verify_bundle` | `signed_bundle_json: string` | Verifies a DCP Signed Bundle |
| `dcp_declare_intent` | `action_type: enum`, `target_channel: enum`, `data_classes?: string[]`, `estimated_impact?: enum` | Declares intent before an action (DCP-02) |
| `dcp_commission_agent` | `purpose: string`, `capabilities?: string[]`, `risk_tier?: enum` | Commission agent (DCP-05 §3.1) |
| `dcp_report_vitality` | `task_completion_rate`, `error_rate`, `human_satisfaction`, `policy_alignment` | Report vitality metrics (DCP-05 §4.1) |
| `dcp_declare_rights` | `rights: string[]`, `jurisdiction: string` | Declare agent rights (DCP-08 §3.1) |
| `dcp_create_mandate` | `human_id: string`, `authority_scope: string[]`, `valid_from?: string`, `valid_until?: string` | Create delegation mandate (DCP-09 §3.1) |

**`action_type`**: `browse`, `api_call`, `send_email`, `create_calendar_event`, `initiate_payment`, `update_crm`, `write_file`, `execute_code`

**`target_channel`**: `web`, `api`, `email`, `calendar`, `payments`, `crm`, `filesystem`, `runtime`

**`estimated_impact`**: `low`, `medium`, `high`

### `handle_dcp_tool_call(tool_name, arguments, session_nonce="", verifier_policy=None)`

Processes DCP tool calls returned by OpenAI and returns a JSON string. Apart from `dcp_verify_bundle`, the tools return unsigned drafts (for example `dcp_declare_intent` returns `{"intent_declared": true, "intent": {...}}` with `agent_id` and `human_id` set to `"self"`). These drafts are not normative artifacts ready to sign: `"self"` is shorter
than the 6 characters the schemas require for `agent_id` and `human_id`, and the certificate, rights and mandate drafts
lack fields of their schemas. Adapt them, validate them against the schemas and sign them with the core SDK.

`dcp_verify_bundle` verifies a V2 bundle with `verify_signed_bundle_v2` from `dcp_ai.v2` under
`verifier_policy`: a dict of `VerifierPolicy` fields set over `DEFAULT_VERIFIER_POLICY` (a
`default_mode` without `risk_overrides` applies to every risk tier), or a full `VerifierPolicy`;
the default is `DEFAULT_VERIFIER_POLICY`. A V1 bundle, which has an Ed25519 signature only, no
intended_verifier and no session window, is accepted only when the policy has `allow_v1_bundles`,
accepts ed25519 (`accepted_classical_algs`, no `advisory_rejected_algs` entry), requires no
audience binding, session expiry or maximum session duration, and would accept a classical-only
bundle for its risk tier and security tier (`spec/VERIFICATION.md` V2-10); its artifacts must be
objects, its passport `agent_id` and RPR `human_id` strings. The result is JSON with
`verified`, `dcp_version`, the verifier's `errors` and `warnings` (at most 20 each, of 500
characters) and, for V2, its `details` (each value bounded the same way), with the control and
format characters of bundle-supplied text escaped. It works with or without a running event loop,
and leaves the thread's current event loop as it was; async code can await
`averify_bundle_tool_call(arguments, verifier_policy)` instead.

`dcp_verify_bundle` is cryptographic verification under the policy your code passes: `verifier_policy` is an
argument of your call, never read from the model's `arguments`. It is not admission of an anchored principal and
authorizes no action (see [docs/ADMISSION.md](../../docs/ADMISSION.md)).

```python
# Fragment: response is a chat completion with tool calls
import json

from dcp_ai.openai import handle_dcp_tool_call

for tool_call in response.choices[0].message.tool_calls or []:
    if tool_call.type == "function" and tool_call.function.name.startswith("dcp_"):
        result = handle_dcp_tool_call(
            tool_call.function.name,
            json.loads(tool_call.function.arguments),
        )
        print(result)  # JSON with the result
```

## Advanced Example — Function Calling with DCP

```python
# Fragment: passport and rpr as in the Quickstart
import json

from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient, handle_dcp_tool_call

dcp_client = DCPOpenAIClient(openai_client=OpenAI(), passport=passport, rpr=rpr)

# No tools passed: the DCP tools are added, so the model can call them
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Declare your intent to make an API call"}],
)

for tc in response.choices[0].message.tool_calls or []:
    if tc.type == "function":
        result = handle_dcp_tool_call(tc.function.name, json.loads(tc.function.arguments))
        print(f"Tool: {tc.function.name} -> {result}")
```

## Development

From a checkout:

```bash
cd sdks/python
pip install -e ".[openai,dev]"
pytest -v
```

### Dependencies

- `dcp-ai` — DCP SDK (crypto, merkle, verify, models)
- `openai` — Official OpenAI client

## License

Apache-2.0
