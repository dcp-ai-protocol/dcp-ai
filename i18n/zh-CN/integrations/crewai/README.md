<sub>[English](../../../../integrations/crewai/README.md) · **中文** · [Español](../../../es/integrations/crewai/README.md) · [日本語](../../../ja/integrations/crewai/README.md) · [Português](../../../pt-BR/integrations/crewai/README.md)</sub>

<a id="dcp_aicrewai--crewai-integration"></a>
<a id="dcp_aicrewai-crewai-integration"></a>

# dcp_ai.crewai — CrewAI 集成

> 本文是[英文版](../../../../integrations/crewai/README.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

DCP 与 CrewAI 的集成，用于多代理治理。每个代理都有自己的 DCP 护照和审计轨迹，并支持合并整个团队的轨迹。

`DCPCrewAgent` 和 `DCPCrew` 在团队旁边保存 DCP 记录：V2 形式、以哈希链连接的审计条目，以及生命周期和继承记录。它们不签名任何内容，也不会自行运行 CrewAI。要为 CrewAI 团队生成已签名、可验证的公民身份 bundle，请像 [docs/QUICKSTART_CREWAI.md](../../../../docs/QUICKSTART_CREWAI.md) 那样使用核心 SDK。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，部分支持：采用这些规范形式的未签名记录。它并未完整实现这些规范。

<a id="installation"></a>

## 安装

**已发布到 PyPI（26/10/2026）。** `dcp-ai` 2.10.0 包含本文描述的实现。请从 2.9.0 升级并更新环境或锁定文件。见 [Python 发布说明](../../../../docs/PYTHON_RELEASE.md)。

2.10.0 按下文条件与符合条件的智能体共享团队会话 nonce，修复了 2.9.0 的行为。这些辅助功能仍生成未签名记录，也不运行 CrewAI；要获得可验证的 bundle，请使用 SDK 签名 API。

```bash
pip install "dcp-ai[crewai]>=2.10.1,<3"
```

源码开发：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[crewai]"
```

<a id="quickstart"></a>

## 快速开始

```python
from dcp_ai.crewai import DCPCrewAgent, DCPCrew

# Fields of the principal's RPR and of each agent's passport, in their V2 form.
# DCPCrewAgent reads human_id, agent_id and capabilities; it does not need full,
# signed payloads (those also carry session_nonce and keys).
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

<a id="api-reference"></a>

## API 参考

### `DCPCrewAgent`

团队成员的 DCP 记录：其护照、其委托人的 RPR 以及它自己的审计轨迹。

```python
DCPCrewAgent(
    role: str,                     # Agent role in the crew
    passport: dict[str, Any],     # DCP Agent Passport
    rpr: dict[str, Any],          # Responsible Principal Record
    secret_key: str = "",         # Kept on the agent; DCPCrewAgent does not sign with it
    session_nonce: str = "",      # Session nonce; a fresh one when empty, which a DCPCrew replaces with its own
    goal: str = "",               # Agent goal
    backstory: str = "",          # Agent context/backstory
)
```

<a id="methods"></a>

#### 方法

| 方法 | 签名 | 说明 |
|--------|-----------|-------------|
| `log_action(action_type, outcome, evidence?, impact?, data_classes?)` | `(str, str, dict?, str?, list?) -> dict` | 将一个操作记录为 V2 形式的审计条目，并以哈希链连接（其背后的意图被哈希，而不保存）。如果代理已停用则抛出异常。 |
| `get_audit_trail()` | `() -> list[dict]` | 返回代理的审计轨迹 |
| `commission(purpose, capabilities, risk_tier)` | `(str, list?, str?) -> dict` | 启用代理（DCP-05 §3.1） |
| `report_vitality(metrics)` | `(dict) -> dict` | 报告活力指标（DCP-05 §4.1） |
| `decommission(mode, reason)` | `(str, str) -> dict` | 停用代理（DCP-05 §5.1） |
| `create_testament(successor_preferences, memory_classification)` | `(list, str) -> dict` | 创建数字遗嘱（DCP-06 §3.1） |

#### `log_action`

```python
entry = researcher.log_action(
    action_type="api_call",
    outcome="success",
    evidence={"url": "https://api.example.com", "status": 200},
)
# entry contains chained intent_hash and prev_hash
```

每个审计条目包括：

- `intent_hash`：相关意图的 SHA-256
- `prev_hash`：第一个条目为 `"GENESIS"`，后续条目为前一条目的 SHA-256

### `DCPCrew`

具有 DCP 治理的多代理团队。

```python
DCPCrew(
    agents: list[DCPCrewAgent],   # List of DCP agents
    session_nonce: str = "",      # Crew nonce, a fresh one when empty; given to every agent that has not logged and was not given its own
    verbose: bool = False,        # Verbose logging
)
```

<a id="methods-1"></a>
<a id="methods_1"></a>

#### 方法

| 方法 | 签名 | 说明 |
|--------|-----------|-------------|
| `kickoff(task)` | `(str) -> dict` | 为该任务给每个代理记录一个审计条目；它不运行 CrewAI |
| `get_combined_audit_trail()` | `() -> list[dict]` | 所有代理的合并轨迹，按时间戳排序 |
| `get_agent_bundles()` | `() -> dict[str, list[dict]]` | 按 `agent_id` 划分的单独轨迹 |
| `commission_all(purpose?)` | `(str?) -> list[dict]` | 启用团队中的所有代理（DCP-05 §3.1） |
| `succession(from_agent, to_agent)` | `(DCPCrewAgent, DCPCrewAgent) -> dict` | 创建继承记录（DCP-06 §4.1） |
| `delegate(human_id, agent, authority_scope)` | `(str, DCPCrewAgent, list) -> dict` | 为代理创建未签名的委托记录（DCP-09 §3.1）；已签名的授权来自 `dcp_ai.v2` 的 `create_delegation_mandate` |
| `get_lifecycle_summary()` | `() -> list[dict]` | 获取每个代理的生命周期状态 |

### `get_combined_audit_trail()`

合并所有代理的审计轨迹并按时间顺序排列。它是用于阅读的视图：每个条目都是添加了 `_agent_role` 字段的副本，该字段不属于
V2 审计条目，合并后的列表也不是哈希链（每个代理的条目只在其自己的轨迹内相连）。不要把这些副本当作审计条目进行规范化、
哈希或签名。

```python
combined = crew.get_combined_audit_trail()
# [
#   {"agent_id": "agent:researcher-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "researcher", ...},
#   {"agent_id": "agent:writer-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "writer", ...},
#   ...
# ]
```

### `get_agent_bundles()`

返回按代理分开的轨迹：

```python
bundles = crew.get_agent_bundles()
# {
#   "agent:researcher-001": [entry1, entry2, ...],
#   "agent:writer-001": [entry3, entry4, ...],
# }
```

<a id="per-agent-trails"></a>

## 每个代理的轨迹

接着快速开始，每个代理都保有自己以哈希链连接的轨迹：

```python
crew = DCPCrew(agents=[researcher, writer])
crew.kickoff(task="Analyze the AI market")

# Unsigned records: seal signed bundles with the core SDK (docs/QUICKSTART_CREWAI.md)
for agent_id, trail in crew.get_agent_bundles().items():
    print(f"\n--- {agent_id} ({len(trail)} entries) ---")
    for entry in trail:
        print(f"  {entry['intent_id']}: {entry['outcome']}")
```

<a id="development"></a>

## 开发

从检出的代码：

```bash
cd sdks/python
pip install -e ".[crewai,dev]"
pytest -v
```

<a id="dependencies"></a>

### 依赖项

- `dcp-ai` — DCP SDK（merkle、models、bundle）
- `crewai` — 多代理框架（由 extra 安装；`dcp_ai.crewai` 本身不导入它）

<a id="license"></a>

## 许可证

Apache-2.0
