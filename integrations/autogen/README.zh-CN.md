<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--microsoft-autogen-bridge"></a>
<a id="dcp-ai-microsoft-autogen-bridge"></a>

# DCP-AI ↔ Microsoft AutoGen 桥接

> 本文是[英文版](README.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

为 Microsoft AutoGen 对话构建具有 DCP 形态的记录：带 DCP 身份的智能体配置、消息的审计条目、函数调用的意图以及委托授权书。

这些记录是普通对象：**未签名，也没有内容哈希或哈希链**。该桥接不做任何密码学处理，也不导入 AutoGen。它们是需要按 DCP schema 调整的草稿：例如，意图的 `action_type: "function_call"` 不在 schema 的枚举中，并且缺少 `session_nonce`、`human_id`、`estimated_impact` 和 `requires_consent`。用 DCP SDK（例如 TypeScript SDK 的 `BundleBuilderV2` 和 `signBundleV2`）对它们签名并建立链，本身并不能让它们成为规范性的 bundle：请先按 schema 调整它们。

<a id="installation"></a>

## 安装

```bash
npm install @dcp-ai/autogen
```

npm 上的 2.0.1（2026 年 10 月 26 日）与 `main` 上源码中的 `index.js` 相同。它没有依赖。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，属于部分对应：这些记录遵循这些规范中的形态，但该桥接并没有完整实现它们。

<a id="overview"></a>

## 概述

该桥接把 DCP-AI 与 Microsoft 用于多智能体编排的 AutoGen 框架集成。它提供：

- **支持 DCP 的智能体配置** — 用 DCP 身份、能力和安全等级扩展 AutoGen 的智能体定义。
- **消息审计** — 为你传入的消息构建一条具有 DCP 形态的审计条目。
- **GroupChat 会话** — 以共享的 DCP 会话 nonce 复制群聊中的智能体，用于关联的审计轨迹。
- **函数调用意图** — 把 AutoGen 的函数调用转换为意图草稿；执行前的策略评估和把关由你负责。

<a id="functions"></a>

## 函数

| 函数 | 说明 |
|---|---|
| `createDcpAutoGenAgent(config)` | 创建支持 DCP 的 AutoGen 智能体配置 |
| `auditAutoGenMessage(message, sender, recipient)` | 为消息生成 DCP 审计条目 |
| `createDcpGroupChat(agents, config)` | 创建带共享会话 nonce 的 DCP GroupChat |
| `autoGenFunctionToIntent(functionCall, agentConfig)` | 把函数调用转换为 DCP 意图 |
| `delegateGroupChatRole(groupChat, agentConfig, authorityScope)` | 向 GroupChat 中的智能体委托权限范围（DCP-09） |

<a id="usage"></a>

## 用法

```javascript
import {
  createDcpAutoGenAgent,
  auditAutoGenMessage,
  createDcpGroupChat,
  autoGenFunctionToIntent,
} from '@dcp-ai/autogen';

// Create DCP-aware agents
const coder = createDcpAutoGenAgent({
  name: 'Coder',
  system_message: 'You write code.',
  capabilities: ['code_generation', 'code_review'],
  security_tier: 'standard',
});

const reviewer = createDcpAutoGenAgent({
  name: 'Reviewer',
  system_message: 'You review code.',
  capabilities: ['code_review'],
  security_tier: 'elevated',
});

// Set up a group chat with shared session nonce
const chat = createDcpGroupChat([coder, reviewer], {
  security_tier: 'elevated',
  max_rounds: 20,
});

// Audit a message exchange
const auditEntry = auditAutoGenMessage(
  { role: 'assistant', content: 'Here is the code...' },
  coder,
  reviewer,
);

// Create an intent before executing a function
const intent = autoGenFunctionToIntent(
  { name: 'execute_code', arguments: { code: 'print("hello")' } },
  coder,
);
```

在这个示例中，`auditAutoGenMessage` 接收的是原始的 `coder` 和 `reviewer`，它们并不带群聊的会话 nonce：`createDcpGroupChat`
会在 `chat.agents` 中返回带 nonce 的智能体副本。该函数只返回一条条目；它不会加入 nonce，也不会把条目保存到任何地方。

<a id="security-tier-resolution"></a>

## 安全等级的确定

当两个安全等级不同的智能体通信时，审计条目使用两者中**较高**的等级。未知的等级按 `standard` 处理。

<a id="notes"></a>

## 说明

- 审计条目中的 `content_hash` 字段默认为 `null`；请与 DCP 的密码层集成，以计算消息内容的 SHA-256 哈希。
- 会话 nonce 是 GroupChat 中所有智能体共享的 256 位随机十六进制字符串。
- 这些配置是由你自己的 AutoGen（或 Semantic Kernel）代码读取的普通对象；该桥接不依赖二者中的任何一个。
