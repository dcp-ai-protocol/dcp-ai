<sub>[English](../../../../integrations/langchain/README.md) · **中文** · [Español](../../../es/integrations/langchain/README.md) · [日本語](../../../ja/integrations/langchain/README.md) · [Português](../../../pt-BR/integrations/langchain/README.md)</sub>

<a id="dcp_ailangchain--langchain-integration"></a>
<a id="dcp_ailangchain-langchain-integration"></a>

# dcp_ai.langchain — LangChain 集成

> 本文是[英文版](../../../../integrations/langchain/README.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

DCP 与 LangChain 的集成。它包装 LangChain 代理，使每次完成的调用都在 V2 形式、以哈希链连接的审计轨迹中留下一个条目，并提供 bundle 验证工具和回调处理器。

包装器保存**未签名的记录**：意图、策略决定和审计条目都不签名，它接受的 `secret_key` 也不会被使用。要为 LangChain 代理生成已签名、可验证的 bundle，请像 [docs/QUICKSTART_LANGCHAIN.md](../../../../docs/QUICKSTART_LANGCHAIN.md) 那样使用核心 SDK。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，部分支持：采用这些规范形式的未签名记录，以及通过 `DCPTool` 进行的 bundle 验证。它并未完整实现这些
规范。

<a id="installation"></a>

## 安装

**已发布到 PyPI（26/10/2026）。** `dcp-ai` 2.10.0 包含本文描述的实现。请从 2.9.0 升级并更新环境或锁定文件。见 [Python 发布说明](../../../../docs/PYTHON_RELEASE.md)。

2.9.0 将所有 bundle 发送到 V1。2.10.0 使用规范性验证器验证 V2，并对 V1 和 V2 强制执行所配置的策略；下文的未签名记录和回调限制保持不变。

```bash
pip install "dcp-ai[langchain]>=2.10.1,<3"
```

源码开发：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[langchain]"
```

<a id="quickstart"></a>

## 快速开始

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

<a id="api-reference"></a>

## API 参考

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

<a id="methods"></a>

#### 方法

| 方法 | 说明 |
|--------|-------------|
| `await invoke(inputs, **kwargs)` | 创建一个意图和一个策略决定（都是本地的，不作为列表保存），运行代理，并在其返回时记录一个审计条目（见下文）。当代理已停用或决定为 `block` 时，返回错误 dict，不留下审计条目；代理抛出的异常会传播，也不留下审计条目。 |
| `get_audit_trail()` | 以哈希链连接的审计条目：返回的是内存中的列表本身而非副本，因此修改它就会修改轨迹。 |
| `get_session_nonce()` | 会话 nonce。 |
| `commission(purpose, capabilities, risk_tier)` | 启用代理（DCP-05 §3.1）。 |
| `report_vitality(metrics_dict)` | 报告活力指标并计算评分（DCP-05 §4.1）。 |
| `decommission(termination_mode, reason)` | 停用代理（DCP-05 §5.1）。 |
| `declare_rights(rights, jurisdiction)` | 声明权利（DCP-08 §3.1）。 |

<a id="what-invoke-does-on-main-25102026"></a>

#### `invoke` 做什么（在 `main` 上，2026 年 10 月 25 日）

1. 创建一个意图：始终是 `action_type: "api_call"`、通道 `api`、`estimated_impact: "low"`、`data_classes: ["none"]`。
2. 获取策略决定。没有 `policy_engine` 时，决定始终为 `approve`。有的话，其 `evaluate(intent)` 必须返回 `PolicyDecisionV2`（来自 `dcp_ai.v2.models`）；普通 dict 会抛出 `AttributeError`。
3. 除非决定为 `block`，否则运行代理；被阻止的调用返回错误 dict，并且**不留下审计条目**。`escalate` 决定**不会**停止代理：代理照常运行，其审计条目记录 `policy_decision: "blocked"` 和 `outcome: "completed"`。对于在人工批准前不得运行的操作，请使用 `block`。
4. 如果代理返回，记录审计条目并将其链接：`intent_hash`，以及从 `GENESIS` 到前一条目哈希的 `prev_hash`。

`evidence.result_ref` 以文本而非哈希的形式保存代理结果的前 100 个字符，因此可能包含输出中的个人数据。请将审计轨迹视为需要与输出同等保护的数据，或者不要保留它。

### `DCPTool`

用于在代理内部验证 DCP bundle 的 LangChain 风格工具。它是一个普通类（`name`、`description`、`run`、`arun`），不是 LangChain 的 `BaseTool`；请针对你的 LangChain 版本包装它，例如：

```python
from langchain_core.tools import StructuredTool
from dcp_ai.langchain import DCPTool

dcp = DCPTool()
verify_tool = StructuredTool.from_function(
    func=dcp.run, coroutine=dcp.arun, name=dcp.name, description=dcp.description,
)
```

<a id="attributes"></a>

#### 属性

| 属性 | 值 |
|-----------|-------|
| `name` | `"dcp_verify_bundle"` |
| `description` | `"Verify a DCP signed bundle..."` |

<a id="methods-1"></a>
<a id="methods_1"></a>

#### 方法

| 方法 | 签名 | 说明 |
|--------|-----------|-------------|
| `run(signed_bundle_json)` | `(str \| dict) -> str` | 同步验证，无论是否有正在运行的事件循环 |
| `arun(signed_bundle_json)` | `(str \| dict) -> str` | 异步验证 |

V2 bundle 在 `DCPTool(verifier_policy=...)` 下用 `dcp_ai.v2` 的 `verify_signed_bundle_v2` 验证（复合签名、会话绑定、清单、
工件间一致性、SHA-256 审计链（以及自 2.10.1 起、而非 2.10.0 中，存在的 V2-11 二级 SHA3-256 字段）以及密钥有效性）。策略可以是在
`DEFAULT_VERIFIER_POLICY` 之上设置 `VerifierPolicy` 字段的 dict（不带 `risk_overrides` 的 `default_mode` 适用于所有风险
等级），也可以是完整的 `VerifierPolicy`；默认为 `DEFAULT_VERIFIER_POLICY`。V1 bundle 只有 Ed25519 签名，没有
intended_verifier，也没有会话时间窗口，只有当策略具有 `allow_v1_bundles`、接受 ed25519（在 `accepted_classical_algs` 中，
`advisory_rejected_algs` 中没有该项）、不要求受众绑定、会话到期或会话最长时长，并且对其风险等级和安全等级会接受纯经典
bundle 时（`spec/VERIFICATION.md` V2-10）才会被接受；其工件必须是对象，护照的 `agent_id` 和 RPR 的 `human_id` 必须是字符串。
结果为 `Bundle VERIFIED (v<version>) for agent <agent_id>` 或 `Bundle INVALID: <errors>`，并附有验证器的错误。文本受到限制
（最多 20 条错误，每条 500 个字符，`agent_id` 最多 200 个字符），来自 bundle 的部分会转义其控制字符和格式字符（换行为
`\u000a`），因为它们会进入模型的上下文。

`DCPTool` 是在你的代码构建该工具时设定的策略（`DCPTool(verifier_policy=...)`）下进行的密码学验证，
策略绝不取自 bundle 或模型。它不是对已锚定委托人的准入，也不授权任何操作
（见 [docs/ADMISSION.md](../../../../docs/ADMISSION.md)）。

### `DCPCallback`

将 LangChain 的链事件记录为 V2 形式的审计条目（未签名，以哈希链连接）。它是普通类，不是 LangChain 的 `BaseCallbackHandler`：LangChain 1.x 拒绝把它作为回调（`AttributeError`，已用 `langchain-core` 1.7 验证），而且它需要字符串形式的 `run_id`，而 LangChain 传入的是 `UUID`。请从你自己的处理器中调用它：

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

`on_chain_end` 将输出的前 200 个字符保存为 `evidence.result_ref`，其中可能包含个人数据。

<a id="methods-2"></a>
<a id="methods_2"></a>

#### 方法

| 方法 | 说明 |
|--------|-------------|
| `on_chain_start(serialized, inputs, **kwargs)` | 记录链开始 |
| `on_chain_end(outputs, **kwargs)` | 记录链结束 |
| `on_lifecycle_event(event_type, details)` | 记录生命周期事件（DCP-05） |
| `get_entries()` | 返回审计条目列表 |

<a id="advanced-example--agent-with-a-custom-policy-engine"></a>
<a id="advanced-example-agent-with-a-custom-policy-engine"></a>

## 高级示例 — 使用自定义策略引擎的代理

包装器的意图始终是低影响的 `api_call`，因此策略引擎要依据其他内容做决定。这里是一个由人控制的停止开关：

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

<a id="development"></a>

## 开发

从检出的代码：

```bash
cd sdks/python
pip install -e ".[langchain,dev]"
pytest -v
```

<a id="dependencies"></a>

### 依赖项

- `dcp-ai` — DCP SDK（crypto、merkle、verify、models）
- `langchain` + `langchain-core` — 代理框架

<a id="license"></a>

## 许可证

Apache-2.0
