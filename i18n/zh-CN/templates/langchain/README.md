<sub>[English](../../../../templates/langchain/README.md) · **中文** · [Español](../../../es/templates/langchain/README.md) · [日本語](../../../ja/templates/langchain/README.md) · [Português](../../../pt-BR/templates/langchain/README.md)</sub>

<a id="dcp-ai--langchain-template"></a>
<a id="dcp-ai-langchain-template"></a>

# DCP-AI + LangChain 模板

> 本文是[英文版](../../../../templates/langchain/README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

围绕一次 LangChain 调用演练 DCP 流程。

> **只是演练，不做签名。** `index.js` 中的密钥和签名都是占位符（`«generated»`、`«sig»`）：模板展示 DCP v2.0 流程的形态，但它不生成密钥，不签名任何内容，其 bundle 也无法通过验证。它不从 `.dcp/` 读取任何内容。如需真实的密钥和签名，请参照 [docs/QUICKSTART_LANGCHAIN.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_LANGCHAIN.md)。

模板固定使用 LangChain.js 0.3（`langchain` 和 `@langchain/openai` `^0.3.0`）；指南展示的是当前的 LangChain.js v1 API。

<a id="quick-start"></a>

## 快速开始

1. 安装依赖项：
   ```bash
   npm install
   ```

2. 运行它。有 `OPENAI_API_KEY` 时，模板会调用 OpenAI API（由 OpenAI 计费）。如果调用因任何原因（没有密钥、网络、配额、模型）失败，它会打印模拟的响应，并且仍记录 `outcome: "success"`，因此审计条目并不能表明调用成功。请在环境中设置该密钥：
   ```bash
   node index.js
   ```

<a id="what-this-template-does"></a>

## 此模板做什么

- 将一次 LangChain 调用包装在 DCP 流程中
- 每个操作都被声明为 Intent；策略步骤是始终返回 `approve`（风险 50）的桩，因此
  升级和阻止分支只用于展示流程，不会被执行到
- 每个响应都会得到一个审计条目
- 代理的 Citizenship Bundle 带有占位符签名

<a id="files"></a>

## 文件

- `index.js` — 带 DCP 流程的 LangChain 调用
- `package.json` — 依赖项
