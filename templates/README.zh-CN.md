<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="templates"></a>

# 模板

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

入门模板，逐步展示 DCP 在常见 AI 框架和 Web 服务器中的位置：身份、意图声明、策略管控、审计记录和 bundle 封装。

> **只是演练，不做签名。** 模板使用占位符密钥和签名（`«generated»`、`«sig»`）：它们不生成密钥，不签名任何内容，其 bundle 也无法通过验证。Express 模板的中间件只检查 bundle 的结构，不检查签名。如需真实的密钥、签名和验证，请参照 [docs/](../docs/README.md) 中的快速开始指南。同样的模板也以 `npm create @dcp-ai/<name>`（`packages/create-*`）的形式发布。

<a id="available-templates"></a>

## 可用模板

| 模板 | 语言 | 说明 |
|----------|----------|-------------|
| [express/](express/) | Node.js | 带结构性 DCP 检查（不验证签名）和发现端点的 Express 服务器 |
| [openai/](openai/) | Node.js | 用 DCP 意图/策略/审计包装的 OpenAI 函数调用 |
| [langchain/](langchain/) | Node.js | 包装在 DCP 流程中的 LangChain.js 0.3 调用 |
| [crewai/](crewai/) | Python | 带 DCP 护照和审计轨迹的多代理团队模拟 |

<a id="quick-start"></a>

## 快速开始

每个模板都可以从仓库根目录单独运行（每条命令在子 shell 中运行，因此下一条命令
仍从根目录开始）。Express 服务器会停留在前台：运行下一个之前请用 Ctrl+C 停止它。

```bash
# Express
(cd templates/express && npm install && npm start)

# OpenAI (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/openai && npm install && npm start)

# LangChain (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/langchain && npm install && npm start)

# CrewAI (standalone Python)
(cd templates/crewai && python main.py)
```

<a id="dcp-lifecycle"></a>

## DCP 生命周期

这些模板合起来展示这一概念性的 DCP v2.0 流程；每个模板只涵盖其中一部分（例如 Express
模板不创建身份、不封装 bundle，也不执行任何操作）：

1. **启动会话** — 生成 256 位会话 nonce；双密钥对（Ed25519 + ML-DSA-65）是占位符
2. **创建 RPR** — 将 AI 代理绑定到负责的人类委托人
3. **签发护照** — 声明代理的能力和风险等级
4. **声明意图** — 在每个操作之前，声明代理想做什么
5. **按策略管控** — 评估风险评分并获得 approve/escalate/block 决定。在这些模板中，这一步是
   始终返回 `approve` 的桩；Express 模板没有策略步骤，只检查 bundle
   自行声明的能力
6. **执行操作** — 只有在策略批准时才继续
7. **记录审计** — 将操作记录在以哈希链连接的审计轨迹中
8. **封装 bundle** — 将所有工件组装成 Citizenship Bundle，附带占位符复合签名

<a id="see-also"></a>

## 另请参阅

- [快速开始指南](../docs/QUICKSTART.md)
- [API 参考](../docs/API_REFERENCE.md)
- [迁移指南（V1 到 V2）](../docs/MIGRATION_V1_V2.md)
