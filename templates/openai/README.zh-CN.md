<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--openai-function-calling-template"></a>
<a id="dcp-ai-openai-function-calling-template"></a>

# DCP-AI + OpenAI 函数调用模板

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

围绕 OpenAI 函数调用演练 DCP 流程。

> **只是演练，不做签名。** `index.js` 中的密钥和签名都是占位符（`«generated»`、`«sig»`）：模板展示 DCP v2.0 流程的形态，但它不生成密钥，不签名任何内容，其 bundle 也无法通过验证。它不从 `.dcp/` 读取任何内容。如需真实的密钥和签名，请参照 [docs/QUICKSTART_OPENAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_OPENAI.md)。

<a id="quick-start"></a>

## 快速开始

1. 安装依赖项：
   ```bash
   npm install
   ```

2. 运行它。有 `OPENAI_API_KEY` 时，模板会调用 OpenAI API（由 OpenAI 计费）。如果第一次调用因任何原因（没有密钥、网络、配额、模型）失败，它会改用模拟的函数调用；它打印的缺少密钥的提示并不能诊断原因。请在环境中设置该密钥，而不是写在命令里：
   ```bash
   node index.js
   ```

<a id="what-this-template-does"></a>

## 此模板做什么

- 将支持 DCP 的工具注册为 OpenAI 函数
- 每次函数调用都会在执行前创建一个 DCP Intent；策略步骤是始终返回 `approve`
  （风险 120）的桩，因此不会执行到 "blocked by policy" 分支
- 这些工具（`lookupWeather`、`sendEmail`、`searchWeb`）始终返回模拟数据，即使真实调用了模型也是如此：
  它们的结果和审计条目并不能表明发生了任何外部操作
- 每个响应都会得到一个审计条目，并以哈希链连接到前一个
- 对话结束后会打印一个带占位符签名的 Citizenship Bundle

<a id="files"></a>

## 文件

- `index.js` — 带 DCP 流程的 OpenAI 函数调用
- `package.json` — 依赖项
