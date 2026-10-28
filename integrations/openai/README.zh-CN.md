<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp_aiopenai--openai-integration"></a>
<a id="dcp_aiopenai-openai-integration"></a>

# dcp_ai.openai — OpenAI 集成

> 本文是[英文版](README.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

用于 OpenAI Python 客户端的 DCP 包装器。它为每次聊天调用创建一个意图，并在调用返回时记录一个审计条目，为函数调用提供 DCP 工具，并让审计轨迹保持哈希链连接。

包装器保存**未签名的记录**，并且**不评估任何策略**：每次调用都会运行，其审计条目记录 `policy_decision: "approved"`。它接受的 `secret_key` 不会被使用。要获得已签名的 bundle 以及围绕函数调用的策略关卡，请参照 [docs/QUICKSTART_OPENAI.md](../../docs/QUICKSTART_OPENAI.md)。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，部分支持：采用这些规范形式的未签名记录和草稿，以及通过 `dcp_verify_bundle` 进行的 bundle 验证。
它并未完整实现这些规范。

<a id="installation"></a>

## 安装

**已发布到 PyPI（26/10/2026）。** `dcp-ai` 2.10.0 包含本文描述的实现。请从 2.9.0 升级并更新环境或锁定文件。见 [Python 发布说明](../../docs/PYTHON_RELEASE.md)。

2.9.0 将所有 bundle 发送到 V1。2.10.0 验证 V2，并对两种版本强制执行验证策略，包括异步入口 `averify_bundle_tool_call`。工具描述和审计记录本身不是签名证据或授权。

```bash
pip install "dcp-ai[openai]>=2.10.1,<3"
```

源码开发：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[openai]"
```

<a id="quickstart"></a>

## 快速开始

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

<a id="api-reference"></a>

## API 参考

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

<a id="methods"></a>

#### 方法

| 方法 | 说明 |
|--------|-------------|
| `chat_completions_create(**kwargs)` | 创建一个意图，调用 `client.chat.completions.create(**kwargs)`，并在其返回时记录一个审计条目。抛出异常的调用会传播该异常，不留下审计条目。 |
| `commission(purpose, capabilities?)` | 启用代理（DCP-05 §3.1）；返回未签名的证书并记录一个审计条目。证书和 `commissioned` 状态都是本地的：不会证明任何内容，也不会发送到别处。 |
| `get_audit_trail()` | 以哈希链连接的审计条目：返回的是内存中的列表本身而非副本，因此修改它就会修改轨迹。 |
| `get_session_nonce()` | 会话 nonce。 |

<a id="chat_completions_create-flow"></a>

#### `chat_completions_create` 流程

1. 创建一个意图：`action_type: "api_call"`、通道 `api`、`estimated_impact: "low"`、`data_classes: ["none"]`。
2. 当 `auto_intent` 开启且调用未传入 `tools` 时，添加 `DCP_TOOLS`。
3. 执行 `client.chat.completions.create()`。不做任何策略决定：调用总会运行。
4. 如果调用返回，记录一个审计条目，带有 `policy_decision: "approved"`，并将响应的 `id` 作为 `evidence.result_ref`，链接到前一条目。

### `DCP_TOOLS`

用于 DCP 的 OpenAI 函数调用工具定义：

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

<a id="available-tools"></a>

#### 可用工具

| 工具 | 参数 | 说明 |
|------|------------|-------------|
| `dcp_verify_bundle` | `signed_bundle_json: string` | 验证 DCP Signed Bundle |
| `dcp_declare_intent` | `action_type: enum`, `target_channel: enum`, `data_classes?: string[]`, `estimated_impact?: enum` | 在操作之前声明意图（DCP-02） |
| `dcp_commission_agent` | `purpose: string`, `capabilities?: string[]`, `risk_tier?: enum` | 启用代理（DCP-05 §3.1） |
| `dcp_report_vitality` | `task_completion_rate`, `error_rate`, `human_satisfaction`, `policy_alignment` | 报告活力指标（DCP-05 §4.1） |
| `dcp_declare_rights` | `rights: string[]`, `jurisdiction: string` | 声明代理的权利（DCP-08 §3.1） |
| `dcp_create_mandate` | `human_id: string`, `authority_scope: string[]`, `valid_from?: string`, `valid_until?: string` | 创建委托授权（DCP-09 §3.1） |

**`action_type`**: `browse`, `api_call`, `send_email`, `create_calendar_event`, `initiate_payment`, `update_crm`, `write_file`, `execute_code`

**`target_channel`**: `web`, `api`, `email`, `calendar`, `payments`, `crm`, `filesystem`, `runtime`

**`estimated_impact`**: `low`, `medium`, `high`

### `handle_dcp_tool_call(tool_name, arguments, session_nonce="", verifier_policy=None)`

处理 OpenAI 返回的 DCP 工具调用，并返回 JSON 字符串。除 `dcp_verify_bundle` 外，这些工具返回未签名的草稿（例如 `dcp_declare_intent` 返回 `{"intent_declared": true, "intent": {...}}`，其中 `agent_id` 和 `human_id` 被设为 `"self"`）。这些草稿不是可直接签名的规范性工件：`"self"` 短于
schema 对 `agent_id` 和 `human_id` 要求的 6 个字符，证书、权利和授权的草稿也缺少其 schema 的字段。
请调整它们，按 schema 校验，并用核心 SDK 签名。

`dcp_verify_bundle` 在 `verifier_policy` 下用 `dcp_ai.v2` 的 `verify_signed_bundle_v2` 验证 V2 bundle。策略可以是在
`DEFAULT_VERIFIER_POLICY` 之上设置 `VerifierPolicy` 字段的 dict（不带 `risk_overrides` 的 `default_mode` 适用于所有风险
等级），也可以是完整的 `VerifierPolicy`；默认为 `DEFAULT_VERIFIER_POLICY`。V1 bundle 只有 Ed25519 签名，没有
intended_verifier，也没有会话时间窗口，只有当策略具有 `allow_v1_bundles`、接受 ed25519（在 `accepted_classical_algs` 中，
`advisory_rejected_algs` 中没有该项）、不要求受众绑定、会话到期或会话最长时长，并且对其风险等级和安全等级会接受纯经典
bundle 时（`spec/VERIFICATION.md` V2-10）才会被接受；其工件必须是对象，护照的 `agent_id` 和 RPR 的 `human_id` 必须是字符串。
结果是 JSON，包含 `verified`、`dcp_version`、验证器的 `errors` 和 `warnings`（各最多 20 条，每条 500 个字符），对 V2 还包含
其 `details`（每个值以同样方式限制），bundle 提供的文本中的控制字符和格式字符会被转义。无论是否有正在运行的事件循环它都能
工作，并保持线程当前的事件循环不变；异步代码可以改为 await `averify_bundle_tool_call(arguments, verifier_policy)`。

`dcp_verify_bundle` 是在你的代码所传入策略下的密码学验证：`verifier_policy` 是你调用时的
参数，绝不会从模型的 `arguments` 中读取。它不是对已锚定委托人的准入，也不授权
任何操作（见 [docs/ADMISSION.md](../../docs/ADMISSION.md)）。

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

<a id="advanced-example--function-calling-with-dcp"></a>
<a id="advanced-example-function-calling-with-dcp"></a>

## 高级示例 — 使用 DCP 的函数调用

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

<a id="development"></a>

## 开发

从检出的代码：

```bash
cd sdks/python
pip install -e ".[openai,dev]"
pytest -v
```

<a id="dependencies"></a>

### 依赖项

- `dcp-ai` — DCP SDK（crypto、merkle、verify、models）
- `openai` — 官方 OpenAI 客户端

<a id="license"></a>

## 许可证

Apache-2.0
