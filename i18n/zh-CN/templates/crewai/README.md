<sub>[English](../../../../templates/crewai/README.md) · **中文** · [Español](../../../es/templates/crewai/README.md) · [日本語](../../../ja/templates/crewai/README.md) · [Português](../../../pt-BR/templates/crewai/README.md)</sub>

<a id="dcp-ai--crewai-template"></a>
<a id="dcp-ai-crewai-template"></a>

# DCP-AI + CrewAI 模板

> 本文是[英文版](../../../../templates/crewai/README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

演示多代理团队的 DCP v2.0 协议流程。此模板模拟 CrewAI 风格的多代理工作流，其中每个代理都获得一本 DCP 护照，所有操作都会被审计。

> **注意：** 此模板展示 DCP 的数据结构和生命周期，运行时不依赖 CrewAI 或 dcp-ai 库。它是一个独立的 Python 模拟，旨在作为把 DCP 集成到你自己的 CrewAI 项目中的参考。如需真实的密钥和签名，请参照 [docs/QUICKSTART_CREWAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_CREWAI.md)。

<a id="quick-start"></a>

## 快速开始

1. 安装依赖项（可选 — 模板不需要它们也能运行）：
   ```bash
   pip install -r requirements.txt
   ```

2. 运行模拟：
   ```bash
   python main.py
   ```

<a id="what-this-template-does"></a>

## 此模板做什么

- 模拟一个多代理团队，其中每个代理都有 DCP v2.0 护照
- 每个代理操作都会生成 Intent → PolicyDecision → AuditEntry。策略步骤是一个桩：`evaluate_policy`
  始终返回 `approve`（风险 75）
- 团队执行会生成带**占位符**密钥和签名（`«generated»`、`«sig»`）的 Citizenship Bundle：没有任何内容被签名，该 bundle 也无法通过验证
- 展示 DCP v2.0 的数据流：会话 nonce、密钥条目、清单、复合签名字段

<a id="files"></a>

## 文件

- `main.py` — 多代理 DCP 流程模拟（独立的 Python）
- `requirements.txt` — Python 依赖项（用于与真实 CrewAI 和 DCP SDK 集成）

<a id="integrating-with-real-crewai"></a>

## 与真实 CrewAI 集成

要将 DCP 与真实的 CrewAI 团队集成，请用 `main.py` 中展示的 DCP 生命周期包装每个代理的任务执行：

```python
# Fragment: agent and task are your CrewAI objects; DCPCrewMember comes from main.py
from crewai import Agent, Task, Crew

# Use the DCP helpers from main.py to wrap agent actions
member = DCPCrewMember(name="researcher", role="analyst")

# Before each task: declare intent + get policy
intent = member.declare_intent("api_call", "api", "api.openai.com")
policy = member.evaluate_policy(intent)
if policy["decision"] != "approve":
    raise RuntimeError(f"DCP policy decision: {policy['decision']}")  # do not run the task

# Execute the CrewAI task
crew = Crew(agents=[agent], tasks=[task])
result = crew.kickoff()

# After each task: log audit entry
member.log_action(intent, policy, str(result), "crewai.task")
```
