<sub>[English](../../../docs/QUICKSTART_AGNO.md) · **中文** · [Español](../../es/docs/QUICKSTART_AGNO.md) · [日本語](../../ja/docs/QUICKSTART_AGNO.md) · [Português](../../pt-BR/docs/QUICKSTART_AGNO.md)</sub>

<a id="quickstart-agno--dcp-ai"></a>
<a id="quickstart-agno-dcp-ai"></a>

# 快速开始：Agno + DCP-AI

> 本文是[英文版](../../../docs/QUICKSTART_AGNO.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

[Agno](https://www.agno.com/) 是一个用于构建 AI 智能体的 Python 框架和运行时。[`agno-dcp`](https://github.com/dcp-ai-protocol/agno-dcp) 集成用参照 DCP-01 至 DCP-04 设计的治理机制包裹 Agno 的 `Agent`、`Team`、`Workflow` 和 MCP 原语：已签名的智能体身份记录、已签名的策略决定、带已签名根检查点的哈希链接审计链，以及已签名的 MCP 消息。

> **▸ 查看运行效果：** [agno-dcp-demo.fly.dev](https://agno-dcp-demo.fly.dev) — 一个银行催收工作流，提供一键场景、通过 Server-Sent Events 实时展示的审计日志，以及已签名 Compliance Bundle 的导出。源码：[`dcp-ai-protocol/agno-dcp-demo`](https://github.com/dcp-ai-protocol/agno-dcp-demo)。

与其他 Python 集成（`dcp-ai[fastapi]`、`dcp-ai[langchain]` 等）不同，`agno-dcp` 以**单独的软件包**发布，因为它把 Agno 作为对等依赖。它需要 `dcp-ai>=2.8.1`，并使用该 SDK 的 Ed25519 `sign_object`（规范化 `dcp-jcs-v1`）签名，因此它生成的每个签名都可以用任何 DCP-AI SDK 中的 `verify_object` 检查。

> **`agno-dcp` 0.1.0 产出的内容（2026 年 10 月 25 日对照其源码核实）。**
>
> * 它的记录（`CitizenshipBundle` 身份记录、审计条目和根、合规 ZIP）是 `agno-dcp` 自有的格式。它们**不是** DCP V1 或 V2 的已签名 bundle，因此 `dcp verify-bundle` 和 `verifySignedBundleV2` 都不接受它们。要产出规范性的 bundle，请使用 SDK 的快速开始（[QUICKSTART.md](../../../docs/QUICKSTART.md)）。
> * 它的签名（身份记录、意图、策略决定、MCP 消息、封装的根、合规清单）无论 `dcp_security_tier` 取何值都只使用 Ed25519。`tier-3` 和 `tier-4` 会被记录，但尽管其 README 描述的是 Ed25519 + ML-DSA-65 混合签名，0.1.0 的代码并不生成任何 ML-DSA-65 签名。审计条目并非逐条签名：它们通过哈希链接，只有封装的根才带签名。

完整的源码、端到端的设计说明和 API 参考位于专门的仓库：<https://github.com/dcp-ai-protocol/agno-dcp>。本页是一个 60 秒的入门。

---

<a id="install"></a>

## 安装

> **软件包状态（2026 年 10 月 25 日）。** PyPI 上 `agno-dcp` 只有一个版本，即 0.1.0。它是**抢先体验**版本：其 README 表示尚不建议用于处理受监管数据的生产部署。本页的示例已对照 0.1.0 的源码进行了静态检查（导出名称、关键字参数、CLI 选项）。它们没有在这里运行，因为运行需要 Agno 和一个模型提供商。

```bash
pip install agno-dcp
```

在生产中使用基于 Postgres 的存储：

```bash
pip install "agno-dcp[postgres]"
```

需要 Python 3.11+。Agno 本身是对等依赖；请单独安装你偏好的 Agno 版本。

---

<a id="wrap-an-agno-agent"></a>

## 包裹一个 Agno 智能体

这是一个片段：`crm_lookup` 和 `payment_plan_offer` 是你自己的 Agno 工具函数，`model` 会原样传给 Agno，所以请提供你的 Agno 版本所接受的模型。

```python
import asyncio

from agno_dcp import (
    DCPAgent,
    PolicyEngine,
    MerkleAuditChain,
    SQLiteStorage,
)


async def main() -> None:
    # 1. Storage and audit chain (DCP-03)
    storage = SQLiteStorage("./agent.db")
    audit = MerkleAuditChain(storage=storage)

    # 2. Policy engine from a YAML file (DCP-02)
    policy = PolicyEngine.from_yaml("policies.yaml")

    # 3. Wrap an Agno Agent
    agent = DCPAgent(
        # Native Agno arguments (forwarded as-is)
        name="Collections Agent",
        model="claude:sonnet-4",
        tools=[crm_lookup, payment_plan_offer],
        instructions="You help customers reschedule overdue invoices.",
        # DCP-AI governance arguments
        dcp_human_principal="ops@example.com",
        dcp_security_tier="tier-3",
        dcp_audit_chain=audit,
        dcp_policy_engine=policy,
        dcp_strict_mode=True,
    )
    await agent.dcp_initialize()

    # 4. Run a tool through the full DCP-AI pipeline:
    #    intent + policy gate + tool execution + audit
    result = await agent.run_tool(
        crm_lookup,
        {"customer_id": 12345},
    )

    # 5. Periodically seal a signed root checkpoint
    root = await audit.seal_root()
    print(f"Sealed Merkle root: {root.root_hash}, entries: {root.entry_count}")


asyncio.run(main())
```

对应的 `policies.yaml`：

```yaml
version: "1.0"
default: deny
rules:
  - name: "Allow CRM lookups"
    when:
      action_type: tool_call
      tool_name: crm_lookup
    then: allow

  - name: "Limit payment discounts"
    when:
      action_type: tool_call
      tool_name: payment_plan_offer
      payload.discount_pct:
        gt: 20
    then: deny
    reason: "Discounts above 20% require human approval"
```

匹配器支持点分路径（`payload.discount_pct`）以及运算符 `eq`、`ne`、`gt`、`gte`、`lt`、`lte`、`in`、`nin`。第一条匹配的规则生效；如果都不匹配，则适用 `default` 判定。

---

<a id="what-run_tool-does-under-the-hood"></a>

## `run_tool` 在内部做了什么

```
DCPAgent.run_tool(tool, args)
  ├── 1. Build and sign IntentDeclaration with the agent's keypair
  ├── 2. PolicyGate.evaluate
  │      ├── verify intent signature
  │      ├── PolicyEngine.evaluate -> signed PolicyDecision
  │      ├── persist intent + decision
  │      └── append INTENT_DECLARED + POLICY_DECISION audit events
  ├── 3. If deny + strict_mode -> raise PolicyDenied
  ├── 4. Execute tool (sync or async)
  ├── 5. Append TOOL_EXECUTED (or ERROR) audit event
  └── 6. Return tool result
```

严格模式与观察模式：

* `dcp_strict_mode=True`：拒绝判定会抛出 `PolicyDenied`，工具不会运行。
* `dcp_strict_mode=False`（默认）：拒绝会被记录和审计，但工具仍会运行。在接入阶段，如果你想在制定好策略之前就先有审计轨迹，这会很有用。

---

<a id="teams-and-workflows"></a>

## 团队和工作流

一个接续上面 `async` 函数内部的片段（`collections_agent`、`risk_agent` 和 `evaluate_credit_fn` 由你提供）：

```python
from agno_dcp import DCPTeam, DCPWorkflow

team = DCPTeam(
    dcp_team_name="Collections + Risk",
    dcp_human_principal="ops@example.com",
    members=[collections_agent, risk_agent],
    dcp_audit_chain=audit,  # shared chain across the team
)
await team.dcp_initialize()

workflow = DCPWorkflow(
    dcp_workflow_id="escalation",
    dcp_human_principal="ops@example.com",
    dcp_audit_chain=audit,
    dcp_strict_mode=True,
)
await workflow.dcp_initialize()
result = await workflow.run_step("evaluate_credit", evaluate_credit_fn, {"amount": 5000})
```

`DCPTeam` 让其 `DCPAgent` 成员写入团队的审计链。`DCPWorkflow` 使用你作为 `dcp_audit_chain` 传入的链；不传时会启动它自己的内存链。把同一条链传给两者，审计人员就能看到智能体操作和团队协作的单一顺序。

---

<a id="verify-an-audit-chain-offline"></a>

## 离线验证审计链

```bash
agno-dcp verify --sqlite ./agent.db
agno-dcp verify --postgres-url $DATABASE_URL --agent-id agent:abc123 --range 0:1000
```

CLI 会重新计算每个 `entry_hash`，检查 `prev_hash` 链接，并用**最新**封装根中存储的公钥检查该根的签名。当哈希链断裂或该签名无效时，它以非零状态退出。

在 0.1.0 中，退出码 0 并不代表对根做了完整检查：

* 只检查最新的根；
* 无法解析的根记录会列在 `notes` 中并被跳过，而退出码会忽略 `notes`，所以请阅读它们（或使用 `--json`）；
* 根不会与条目进行比对，其密钥也不会与你信任的密钥进行比对。因此，能够写入数据库的人可以改写条目、重新计算哈希，并用新密钥封装一个新的根，而检查仍然会通过。请把审计签名者的公钥和封装的根保存在数据库之外，并自行比对。

---

<a id="compliance-bundle-export"></a>

## 合规 bundle 导出

要移交给审计人员，请发送一个已签名的 ZIP：

```python
from pathlib import Path
from agno_dcp import ComplianceBundleExporter

exporter = ComplianceBundleExporter(audit, storage)
zip_path = await exporter.export(
    framework="eu_ai_act",   # or "nist_ai_rmf"
    output_dir=Path("./bundles"),
)
```

该归档包含按索引顺序排列的审计日志、所有封装的 Merkle 根、相关的 Citizenship Bundle，以及与框架的映射（欧盟《人工智能法》第 12、13、14、15、50 条，或 NIST AI RMF 的 Govern/Map/Measure/Manage 子类别）。其 `manifest.json` 带有归档内容的哈希，并用审计链的密钥签名，因此审计人员可以发现导出与审查之间所做的更改。

---

<a id="production-deployment"></a>

## 生产部署

把 `SQLiteStorage` 换成 `PostgresStorage`，应用代码保持不变：

```python
import os

from agno_dcp import PostgresStorage  # requires the [postgres] extra

# For example postgresql+psycopg://host/db, with credentials kept out of the code.
storage = PostgresStorage(os.environ["DATABASE_URL"])
await storage.initialize()
audit = MerkleAuditChain(storage=storage)
```

`PostgresStorage` 在首次使用时加载，因此不在 `agno_dcp.__all__` 中列出，但安装该 extra 后，`from agno_dcp import PostgresStorage` 即可使用。附带的幂等模式（`agno_dcp/storage/schema.sql`）复用存放 Agno 自身表的同一数据库；每张表的 `dcp_*` 前缀可避免冲突。

---

<a id="status"></a>

## 状态

`agno-dcp v0.1.0`（2026 年 4 月）是一个**抢先体验**版本，适用于评估、演示和内部试点。它的公共契约是 `agno_dcp/__init__.py` 中的列表。上游 README 把 DCP-05 至 DCP-09（生命周期、继承、争议、权利、委托）以及基于硬件的密钥托管（AWS KMS、GCP Cloud KMS）列为未来的工作。

该软件包在注册表上的状态：

* PyPI：<https://pypi.org/project/agno-dcp/>
* 源码：<https://github.com/dcp-ai-protocol/agno-dcp>
* CI 状态：可在该仓库的 GitHub Actions 选项卡中查看。

---

<a id="further-reading"></a>

## 延伸阅读

* [agno-dcp README](https://github.com/dcp-ai-protocol/agno-dcp#readme)：完整的快速开始和对比表。
* [agno-dcp `docs/why.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/why.md)：它的价值主张（何时采用、何时不采用）。
* [agno-dcp `docs/architecture.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/architecture.md)：分层示意图和钩子语义。
* [agno-dcp `docs/compliance_mapping.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/compliance_mapping.md)：欧盟《人工智能法》和 NIST AI RMF 的映射。
* [DCP-AI v2.0 规范](../../../spec/DCP-AI-v2.0.md)：协议层面的规范性参考。
