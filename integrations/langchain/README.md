# dcp_ai.langchain — LangChain Integration

DCP integration with LangChain. Wraps a LangChain agent so that each call that completes leaves an entry in a hash-chained audit trail in the V2 shape, and provides a bundle verification tool and a callback handler.

The wrapper keeps **unsigned records**: intents, policy decisions and audit entries are not signed, and the `secret_key` it accepts is not used. For signed, verifiable bundles of a LangChain agent, use the core SDK as in [docs/QUICKSTART_LANGCHAIN.md](../../docs/QUICKSTART_LANGCHAIN.md).

## Supported DCP Specifications

DCP-01 through DCP-09, partially: unsigned records in the shapes of these specifications, and bundle verification
through `DCPTool`. It does not implement them in full.

## Installation

**Published on PyPI (26/10/2026).** `dcp-ai` 2.10.0 includes the implementation described here. Upgrade from 2.9.0 and refresh your environment or lockfile. See [Python release notes](../../docs/PYTHON_RELEASE.md).

Version 2.9.0 routes every bundle to V1. Version 2.10.0 verifies V2 with the normative verifier and enforces the configured policy for V1 and V2; the unsigned-record and callback limitations below remain.

```bash
pip install "dcp-ai[langchain]>=2.10.1,<3"
```

For source development:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[langchain]"
```

## Quickstart

```python
import asyncio

from dcp_ai.langchain import DCPAgentWrapper

# The wrapper reads agent_id from the passport and human_id from the RPR;
# it does not check or sign them.
passport = {"agent_id": "agent:research-assistant-001", "capabilities": ["browse", "api_call"]}
rpr = {"human_id": "rpr:human-001"}


async def main() -> None:
    wrapped = DCPAgentWrapper(
        agent=my_langchain_agent,  # Fragment: your LangChain agent (ainvoke or invoke)
        passport=passport,
        rpr=rpr,
    )

    # invoke is a coroutine: await it
    result = await wrapped.invoke({"input": "Search for information about AI"})

    for entry in wrapped.get_audit_trail():
        print(f"[{entry['timestamp']}] {entry['intent_id']}: {entry['policy_decision']} -> {entry['outcome']}")


asyncio.run(main())
```

## API Reference

### `DCPAgentWrapper`

```python
DCPAgentWrapper(
    agent: Any,                         # LangChain agent: ainvoke is used when present, else invoke
    passport: dict[str, Any],           # agent_id is read
    rpr: dict[str, Any],                # human_id is read
    secret_key: str = "",               # Accepted but not used: nothing is signed
    session_nonce: str = "",            # A fresh one when empty
    auto_intent: bool = True,           # Stored, not used: invoke always creates an intent
    policy_engine: Any = None,          # Object with evaluate(intent) -> PolicyDecisionV2
    pq_checkpoint_interval: int = 10,   # Stored, not used: no PQ checkpoints are made
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `await invoke(inputs, **kwargs)` | Creates an intent and a policy decision (local, not kept as lists), runs the agent and, if it returns, records an audit entry (see below). Returns an error dict, with no audit entry, when the agent is decommissioned or the decision is `block`; an exception from the agent propagates and leaves no audit entry. |
| `get_audit_trail()` | The audit entries, hash-chained: the in-memory list itself, not a copy, so changing it changes the trail. |
| `get_session_nonce()` | The session nonce. |
| `commission(purpose, capabilities, risk_tier)` | Commission the agent (DCP-05 §3.1). |
| `report_vitality(metrics_dict)` | Report vitality metrics and compute score (DCP-05 §4.1). |
| `decommission(termination_mode, reason)` | Decommission the agent (DCP-05 §5.1). |
| `declare_rights(rights, jurisdiction)` | Declare rights (DCP-08 §3.1). |

#### What `invoke` does (on `main`, 25/10/2026)

1. Creates an intent: always `action_type: "api_call"`, channel `api`, `estimated_impact: "low"`, `data_classes: ["none"]`.
2. Gets a policy decision. Without `policy_engine`, the decision is always `approve`. With one, its `evaluate(intent)` must return a `PolicyDecisionV2` (from `dcp_ai.v2.models`); a plain dict raises `AttributeError`.
3. Runs the agent unless the decision is `block`; a blocked call returns an error dict and leaves **no audit entry**. An `escalate` decision does **not** stop the agent: it runs, and its audit entry records `policy_decision: "blocked"` with `outcome: "completed"`. Use `block` for anything that must not run until a human approves it.
4. If the agent returns, records an audit entry and chains it: `intent_hash`, and `prev_hash` from `GENESIS` to the hash of the previous entry.

`evidence.result_ref` holds the first 100 characters of the agent's result as text, not a hash, so it can contain personal data from the output. Treat the audit trail as data that needs the same protection as the output, or do not keep it.

### `DCPTool`

LangChain-style tool for verifying DCP bundles from within an agent. It is a plain class (`name`, `description`, `run`, `arun`), not a LangChain `BaseTool`; wrap it for your LangChain version, for example:

```python
from langchain_core.tools import StructuredTool
from dcp_ai.langchain import DCPTool

dcp = DCPTool()
verify_tool = StructuredTool.from_function(
    func=dcp.run, coroutine=dcp.arun, name=dcp.name, description=dcp.description,
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
session binding, manifest, cross-artifact consistency, the SHA-256 audit chain (and, from 2.10.1 but not in 2.10.0, the secondary SHA3-256 fields of V2-11 that are present), key validity) under
`DCPTool(verifier_policy=...)`: a dict of `VerifierPolicy` fields set over
`DEFAULT_VERIFIER_POLICY` (a `default_mode` without `risk_overrides` applies to every risk tier),
or a full `VerifierPolicy`; the default is `DEFAULT_VERIFIER_POLICY`. A V1 bundle, which has an Ed25519 signature only, no
intended_verifier and no session window, is accepted only when the policy has `allow_v1_bundles`,
accepts ed25519 (`accepted_classical_algs`, no `advisory_rejected_algs` entry), requires no
audience binding, session expiry or maximum session duration, and would accept a classical-only
bundle for its risk tier and security tier (`spec/VERIFICATION.md` V2-10); its artifacts must be
objects, its passport `agent_id` and RPR `human_id` strings. The
result is `Bundle VERIFIED (v<version>) for agent <agent_id>` or `Bundle INVALID: <errors>`, with
the verifier's errors. The text is bounded (at most 20 errors of 500 characters, an `agent_id` of
200) and the parts that come from the bundle have their control and format characters escaped
(`\u000a` for a newline), since they reach the model's context.

`DCPTool` is cryptographic verification under the policy your code sets when it builds the tool
(`DCPTool(verifier_policy=...)`), never taken from the bundle or the model. It is not admission of an anchored
principal and authorizes no action (see [docs/ADMISSION.md](../../docs/ADMISSION.md)).

### `DCPCallback`

Records LangChain chain events as audit entries in the V2 shape (unsigned, hash-chained). It is a plain class, not a LangChain `BaseCallbackHandler`: LangChain 1.x refuses it as a callback (`AttributeError`, checked with `langchain-core` 1.7), and it needs `run_id` as a string while LangChain passes a `UUID`. Call it from a handler of your own:

```python
from langchain_core.callbacks import BaseCallbackHandler
from dcp_ai.langchain import DCPCallback

dcp_log = DCPCallback(agent_id="agent:research-assistant-001", human_id="rpr:human-001")


class DCPHandler(BaseCallbackHandler):
    """Hands LangChain's chain events to DCPCallback."""

    # LangChain passes run_id as a UUID; DCPCallback records it as the entry's intent_id, a string
    def on_chain_start(self, serialized, inputs, *, run_id, **kwargs):
        dcp_log.on_chain_start(serialized or {}, inputs, run_id=str(run_id))

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        dcp_log.on_chain_end(outputs, run_id=str(run_id))


# Fragment: chain is your LangChain chain or agent
chain.invoke({"input": "..."}, config={"callbacks": [DCPHandler()]})
entries = dcp_log.get_entries()
```

`on_chain_end` keeps the first 200 characters of the outputs as `evidence.result_ref`, which can contain personal data.

#### Methods

| Method | Description |
|--------|-------------|
| `on_chain_start(serialized, inputs, **kwargs)` | Records chain start |
| `on_chain_end(outputs, **kwargs)` | Records chain end |
| `on_lifecycle_event(event_type, details)` | Records lifecycle events (DCP-05) |
| `get_entries()` | Returns list of audit entries |

## Advanced Example — Agent with a Custom Policy Engine

The wrapper's intents are always low-impact `api_call`s, so a policy engine decides on something else. Here, a stop switch a human controls:

```python
from datetime import datetime, timezone

from dcp_ai.langchain import DCPAgentWrapper
from dcp_ai.v2.models import PolicyDecisionV2


class StopSwitch:
    """Approves until a human stops the agent; then blocks every call."""

    def __init__(self) -> None:
        self.stopped = False

    def evaluate(self, intent):
        return PolicyDecisionV2(
            dcp_version="2.0",
            intent_id=intent.intent_id,
            session_nonce=intent.session_nonce,
            decision="block" if self.stopped else "approve",
            risk_score=1000 if self.stopped else 100,
            reasons=["stopped by a human" if self.stopped else "default-allow"],
            timestamp=datetime.now(timezone.utc).isoformat(),
        )


switch = StopSwitch()
wrapped = DCPAgentWrapper(
    agent=my_agent,  # Fragment: your LangChain agent
    passport=passport,
    rpr=rpr,
    policy_engine=switch,
)
# switch.stopped = True  ->  the next await wrapped.invoke(...) returns an error dict and does not run the agent
```

## Development

From a checkout:

```bash
cd sdks/python
pip install -e ".[langchain,dev]"
pytest -v
```

### Dependencies

- `dcp-ai` — DCP SDK (crypto, merkle, verify, models)
- `langchain` + `langchain-core` — Agent framework

## License

Apache-2.0
