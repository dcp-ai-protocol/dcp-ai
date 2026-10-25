<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="a2a-profile-agent-to-agent-communication"></a>

# A2A 配置文件（代理之间的通信）

> 本文是[英文规范](README.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**状态：** 已发布 — v2.0  
**范围：** 代理发现、会话建立、传输绑定和消息交换  

---

<a id="purpose"></a>

## 目的

DCP 核心定义了单个代理如何向验证器证明其身份和问责。A2A 配置文件将其扩展到代理之间的直接交互：两个通过 DCP 认证的代理如何相互发现、建立相互认证的会话，并在与审计轨迹完全集成的情况下交换消息。

这明确不属于核心，因为：

- 许多 DCP 部署只涉及代理与验证器之间的交互（被动验证）
- A2A 需要特定于传输的绑定（WebSocket、gRPC、HTTP/2），核心不应强制规定
- 发现机制取决于部署背景（well-known URL、注册表、直接交换）
- 会话管理引入了状态，而状态不属于无状态的核心验证模型

<a id="what-lives-here-not-in-core"></a>

## 这里包含什么（不在核心中）

<a id="agent-discovery"></a>

### 代理发现

通过 `.well-known/dcp-agent-directory.json` 发布和解析代理目录，包括代理元数据、能力、端点和支持的算法。

见 [DCP-04](../../DCP-04.md) 第 2 节。

<a id="handshake-protocol"></a>

### 握手协议

四消息握手（A2A_HELLO、A2A_WELCOME、A2A_CONFIRM、A2A_ESTABLISHED），使用混合 KEM（X25519 + ML-KEM-768）建立相互认证、受后量子保护的会话。

见 [DCP-04](../../DCP-04.md) 第 3 节。

<a id="session-management"></a>

### 会话管理

会话状态（密钥、计数器、密钥更新）、加密消息格式（AES-256-GCM）、密钥更新协议、会话终止和会话恢复。

见 [DCP-04](../../DCP-04.md) 第 4 节。

<a id="transport-bindings"></a>

### 传输绑定

WebSocket、gRPC 和 HTTP/2 SSE 传输选项，会话消息使用 CBOR 编码。

见 [DCP-04](../../DCP-04.md) 第 7 节。

<a id="trust-model"></a>

### 信任模型

通过相互验证 bundle 建立的每会话信任、组织信任，以及可配置深度上限的可选传递信任。

见 [DCP-04](../../DCP-04.md) 第 5 节。

<a id="a2a-audit-events"></a>

### A2A 审计事件

A2A 交互特有的审计条目类型：`a2a_hello_sent`、`a2a_session_established`、`a2a_message_sent`、`a2a_rekey`、`a2a_session_closed` 等。

见 [DCP-04](../../DCP-04.md) 第 6 节。

<a id="what-stays-in-core"></a>

## 什么留在核心中

- 代理在 A2A 握手期间出示的 Signed Bundle — 其结构和验证属于核心
- A2A 事件产生的以哈希链连接的审计条目 — 其格式属于核心，但 A2A 特有的事件类型属于配置文件范围
- 标识每个代理的 Agent Passport — 其结构属于核心

<a id="normative-references"></a>

## 规范性参考

- [DCP-04](../../DCP-04.md) — 代理之间的通信（完整的规范性规范）
- [DCP-AI v2.0](../../DCP-AI-v2.0.md) — 会话绑定（第 8 节）、密钥推导

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- “已发布”指的是规范。在 `main` 上，每个 SDK 都会构建 `A2A_HELLO` 和 `A2A_WELCOME`，但没有一个
  实现 `A2A_CONFIRM` / `A2A_ESTABLISHED` 或 [DCP-04](../../DCP-04.md) §3.4 的会话密钥推导；只有
  TypeScript SDK 具备消息所宣告的混合 X25519 + ML-KEM-768 KEM，Rust SDK 没有会话
  层（[tools/interop-matrix](../../../tools/interop-matrix/README.md#roadmap)）。
- SDK 辅助函数构建消息、目录和会话对象，密钥由调用方提供。它们不会自行运行
  握手、KEM 交换、bundle 验证、准入、网络通信或审计记录：这些
  都由调用方负责，参考服务器也没有实现任何传输绑定。
