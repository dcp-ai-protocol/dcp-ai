<sub>[English](../../../spec/DCP-04.md) · **中文** · [Español](../../es/spec/DCP-04.md) · [日本語](../../ja/spec/DCP-04.md) · [Português](../../pt-BR/spec/DCP-04.md)</sub>

<a id="dcp-04-agent-to-agent-communication"></a>

# DCP-04：代理间通信

> 本文是[英文规范](../../../spec/DCP-04.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

<a id="status"></a>

## 状态
已发布 — v2.0（扩展；修订根据采用者的反馈跟踪）

<a id="abstract"></a>

## 摘要
本规范定义经 DCP 认证的代理如何相互发现、建立双向认证且具备后量子保护的通信信道，并在与审计轨迹完全集成的前提下交换消息。

<a id="1-introduction"></a>

## 1. 引言

DCP-01 至 DCP-03 定义了单个代理的身份、意图和审计。DCP-04 将协议扩展到代理之间的直接交互，这是多代理企业工作流的基础。

没有 A2A 时，DCP 只支持被动验证（代理向验证方出示 bundle）。DCP-04 支持主动交互：组织 A 的代理可以与组织 B 的代理协商，双方都经过后量子双向认证。

<a id="11-design-principles"></a>

### 1.1 设计原则
- 在任何数据交换之前进行双向认证
- 从握手到整个会话都具备后量子安全性
- 每条 A2A 消息都生成一条审计条目
- 不需要中央中介（P2P）
- 与现有传输层（WebSocket、gRPC、HTTP/2）兼容

<a id="12-threat-model"></a>

### 1.2 威胁模型
- 采取“先收集、后解密”（harvest-now-decrypt-later）策略的量子攻击者
- 代理之间的中间人（man-in-the-middle）
- 冒充合法代理
- 握手后劫持会话
- 跨会话重放 A2A 消息

<a id="2-agent-discovery-protocol"></a>

## 2. 代理发现协议

<a id="21-well-known-endpoint"></a>

### 2.1 Well-Known 端点

代理通过 `.well-known/dcp-agent-directory.json` 发布其可用性：

```json
{
  "dcp_version": "2.0",
  "organization": "Acme Corp",
  "agents": [
    {
      "agent_id": "agent:acme-purchasing-001",
      "agent_name": "Acme Purchasing Agent",
      "capabilities": ["negotiate", "purchase_order", "invoice"],
      "bundle_endpoint": "https://acme.com/.well-known/dcp/agents/001/bundle.json",
      "a2a_endpoint": "wss://acme.com/dcp/a2a",
      "a2a_transports": ["websocket", "grpc"],
      "security_tier_minimum": "elevated",
      "supported_algorithms": {
        "signing": ["ed25519", "ml-dsa-65"],
        "kem": ["x25519-ml-kem-768"]
      },
      "status": "active",
      "updated_at": "2026-02-28T00:00:00Z"
    }
  ],
  "directory_signature": {
    "alg": "ed25519",
    "kid": "org-signing-key-kid",
    "sig_b64": "..."
  }
}
```

<a id="22-discovery-flow"></a>

### 2.2 发现流程

1. 代理 A 解析代理 B 的域名
2. 代理 A 获取 `https://<domain>/.well-known/dcp-agent-directory.json`
3. 代理 A 验证目录的签名
4. 代理 A 按所需能力选择一个代理
5. 代理 A 从 `bundle_endpoint` 获取代理 B 的已签名 bundle
6. 代理 A 在本地验证代理 B 的 bundle

<a id="23-capability-matching"></a>

### 2.3 能力匹配

能力是来自某个注册表的字符串。标准能力包括：

- `negotiate` — 可以参与协商流程
- `purchase_order` — 可以发出或接收采购订单
- `invoice` — 可以开具或处理发票
- `data_query` — 可以响应数据查询
- `task_delegate` — 可以接受委派的任务
- `approval` — 可以批准或拒绝请求
- `notification` — 可以发送和接收通知

自定义能力必须（MUST）使用反向域名表示法：`com.acme.custom_capability`。

<a id="3-handshake-protocol"></a>

## 3. 握手协议

<a id="31-overview"></a>

### 3.1 概述

A2A 握手建立一个双向认证且具备后量子保护的会话。它使用 v2.0 核心规范中已定义的混合 KEM（X25519 + ML-KEM-768）。

```
Agent A (Initiator)                    Agent B (Responder)
    |                                       |
    |── A2A_HELLO ─────────────────────────>|
    |   { signed_bundle_A, kem_pk_A,        |
    |     nonce_A, supported_algs }         |
    |                                       |
    |<────────────────────── A2A_WELCOME ───|
    |   { signed_bundle_B, kem_pk_B,        |
    |     nonce_B, kem_ciphertext_BA }      |
    |                                       |
    |── A2A_CONFIRM ───────────────────────>|
    |   { kem_ciphertext_AB,                |
    |     encrypted_confirm(nonce_A+B) }    |
    |                                       |
    |<──────────────────── A2A_ESTABLISHED ─|
    |   { encrypted_ack, session_id }       |
    |                                       |
    |══ Encrypted A2A Messages ════════════>|
    |<═════════════════════════════════════ ═|
```

### 3.2 A2A_HELLO

由发起方发送，用于开始握手。

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "supported_algorithms": {
    "signing": ["ed25519", "ml-dsa-65"],
    "kem": ["x25519-ml-kem-768"],
    "cipher": ["aes-256-gcm"]
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

### 3.3 A2A_WELCOME

由响应方在验证发起方的 bundle 后发送。

```json
{
  "type": "A2A_WELCOME",
  "protocol_version": "2.0",
  "responder_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "kem_ciphertext": {
    "alg": "x25519-ml-kem-768",
    "ciphertext_b64": "..."
  },
  "selected_algorithms": {
    "signing": "ed25519",
    "kem": "x25519-ml-kem-768",
    "cipher": "aes-256-gcm"
  },
  "resolved_security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

<a id="34-key-derivation"></a>

### 3.4 密钥派生

双方派生会话密钥：

```
shared_secret_BA = decapsulate(kem_ciphertext_BA, sk_A)
shared_secret_AB = decapsulate(kem_ciphertext_AB, sk_B)

session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

<a id="35-session-binding"></a>

### 3.5 会话绑定

会话与两个代理的身份绑定：

```
session_id = SHA-256(
  "DCP-AI.v2.A2A.Session" || 0x00 ||
  agent_id_A || 0x00 ||
  agent_id_B || 0x00 ||
  nonce_A || nonce_B ||
  session_key
)[0:32] (hex)
```

<a id="4-session-management"></a>

## 4. 会话管理

<a id="41-session-state"></a>

### 4.1 会话状态

每个会话维护：

- `session_id`：唯一的会话标识符
- `session_key`：派生出的对称密钥
- `message_counter_send`：已发送消息的单调递增计数器
- `message_counter_recv`：已接收消息的单调递增计数器
- `created_at`：会话创建时间戳
- `last_activity`：最后一条消息的时间戳
- `security_tier`：为该会话确定的安全层级
- `rekeying_interval`：更新密钥前的消息数（默认：1000）

<a id="42-message-format"></a>

### 4.2 消息格式

```json
{
  "session_id": "<hex>",
  "sequence": 42,
  "type": "A2A_MESSAGE",
  "encrypted_payload": "<base64>",
  "iv": "<base64, 12 bytes>",
  "tag": "<base64, 16 bytes>",
  "sender_agent_id": "agent:acme-001",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

加密：AES-256-GCM，使用：

- 密钥：`session_key`
- IV：每条消息 12 个随机字节
- AAD：`session_id || sequence || sender_agent_id || timestamp`

<a id="43-rekeying"></a>

### 4.3 密钥更新

当 `message_counter_send` 达到 `rekeying_interval` 时：

1. 发起方发送带有新的临时 KEM 公钥的 `A2A_REKEY`
2. 响应方以 KEM 密文回复
3. 派生新的会话密钥：
```
new_session_key = HKDF-SHA256(
  salt = old_session_key,
  ikm  = new_shared_secret,
  info = "DCP-AI.v2.A2A.Rekey" || session_id,
  len  = 32
)
```
4. 两个计数器都重置为 0

<a id="44-session-termination"></a>

### 4.4 会话终止

任何一方都可以终止会话：

```json
{
  "type": "A2A_CLOSE",
  "session_id": "<hex>",
  "reason": "complete",
  "final_sequence": 157,
  "audit_summary_hash": "sha256:<hex>",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

原因：`complete`、`timeout`、`error`、`revocation`、`policy_violation`。

<a id="45-session-resume"></a>

### 4.5 会话恢复

如果双方都保留了会话状态，之前建立的会话可以恢复：

```json
{
  "type": "A2A_RESUME",
  "session_id": "<hex>",
  "last_seen_sequence": 157,
  "resume_proof": "<HMAC-SHA256(session_key, session_id || last_seen_sequence)>"
}
```

响应方验证该证明，并以 `A2A_RESUMED` 确认，或以 `A2A_RESUME_REJECTED` 拒绝（此时需要重新进行完整握手）。

<a id="5-trust-model"></a>

## 5. 信任模型

<a id="51-direct-trust"></a>

### 5.1 直接信任

两个代理在握手期间成功相互验证 bundle 后彼此信任。信任按会话建立，默认不具有传递性。

<a id="52-organizational-trust"></a>

### 5.2 组织信任

如果代理 A 信任组织 X 的签名密钥，且组织 X 的目录列出了代理 B，则代理 A 可以在组织 X 的授权下将信任扩展到代理 B。

<a id="53-transitive-trust-optional"></a>

### 5.3 传递信任（可选）

传递信任必须（MUST）显式启用，并受深度限制：

```json
{
  "trust_policy": {
    "allow_transitive": true,
    "max_depth": 2,
    "require_tier": "elevated",
    "trusted_organizations": ["org:acme", "org:globex"]
  }
}
```

如果 `max_depth` 为 2：A 信任 B，B 信任 C，则 A 可以（MAY）信任 C。深度为 0 表示仅直接信任（默认）。

<a id="54-trust-revocation"></a>

### 5.4 信任撤销

如果在活动会话期间某个代理的 bundle 被撤销：

1. 必须（MUST）立即终止会话
2. 必须（MUST）创建一条 `revocation` 审计条目
3. 必须（MUST）丢弃传输中的消息
4. 必须（MUST）通过带有原因 `revocation` 的 `A2A_CLOSE` 通知对方

<a id="6-audit-integration"></a>

## 6. 审计集成

<a id="61-a2a-audit-events"></a>

### 6.1 A2A 审计事件

每次 A2A 交互都会在两个代理的审计链中生成审计条目：

**握手事件：**

- `a2a_hello_sent` / `a2a_hello_received`
- `a2a_session_established`

**消息事件：**

- `a2a_message_sent` / `a2a_message_received`

**会话事件：**

- `a2a_rekey`
- `a2a_session_closed`
- `a2a_session_resumed`

<a id="62-audit-entry-for-a2a"></a>

### 6.2 A2A 审计条目

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "a2a_message_sent",
  "agent_id": "agent:acme-001",
  "session_id": "<hex>",
  "counterparty_agent_id": "agent:globex-002",
  "sequence": 42,
  "payload_hash": "sha256:<hash of decrypted payload>",
  "timestamp": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hash of previous audit entry>",
  "prev_hash_secondary": "sha3-256:<hash>"
}
```

<a id="63-cross-chain-verification"></a>

### 6.3 跨链验证

两个代理的审计链引用同一个会话。第三方审计人员可以通过以下方式验证一致性：

1. 获取两个代理在该会话中的审计条目
2. 验证发送方与接收方之间的消息哈希一致
3. 验证序列号一致
4. 验证时间戳在可接受的偏差范围内（可配置，默认 30 秒）

<a id="7-wire-format"></a>

## 7. 传输格式

<a id="71-transport-requirements"></a>

### 7.1 传输要求

A2A 消息可以（MAY）通过以下方式传输：

- **WebSocket**（推荐用于双向、持久连接）
- **gRPC**（推荐用于企业级高吞吐量场景）
- **HTTP/2 Server-Sent Events**（用于单向流）

握手必须（MUST）在 10 秒内完成。消息投递必须（MUST）具有至多一次（at-most-once）语义。

<a id="72-cbor-encoding"></a>

### 7.2 CBOR 编码

为提高传输效率，A2A 消息应当（SHOULD）使用 CBOR 编码（RFC 8949）：

- 握手消息：JSON（便于调试）
- 会话消息：CBOR（为了性能）

Content-Type：CBOR 使用 `application/cbor`，JSON 使用 `application/json`。

<a id="8-security-considerations"></a>

## 8. 安全考虑

<a id="81-forward-secrecy"></a>

### 8.1 前向保密

临时 KEM 密钥提供前向保密（forward secrecy）。长期密钥泄露不会暴露过去的会话密钥。

<a id="82-post-quantum-security"></a>

### 8.2 后量子安全

混合 KEM（X25519 + ML-KEM-768）同时抵御经典攻击者和量子攻击者。只要任一组成 KEM 是安全的，会话密钥就是安全的。

<a id="83-denial-of-service"></a>

### 8.3 拒绝服务

实现应当（SHOULD）：

- 按来源限制 A2A_HELLO 消息的速率
- 在执行 KEM 操作前要求有效的 bundle
- 实施按代理的连接数限制
- 对匿名发起方使用工作量证明（可选）

<a id="84-message-ordering"></a>

### 8.4 消息顺序

序列号可以防止重放和重新排序。实现必须（MUST）拒绝以下消息：

- 序列号重复的消息
- 序列号比最后收到的序列号大，且差值超过 1000 的消息（窗口）
- 序列号低于最后收到的序列号的消息（窗口内的除外）

<a id="9-conformance"></a>

## 9. 一致性

满足以下条件的实现符合 DCP-04：

1. 实现第 3 节定义的握手协议
2. 使用混合 KEM 建立密钥
3. 使用 AES-256-GCM 加密所有会话消息
4. 为所有 A2A 事件生成审计条目
5. 支持会话密钥更新
6. 通过 bundle 验证实现信任验证
7. 遵守安全层级要求

<a id="references"></a>

## 参考资料

- DCP-01：身份与主体绑定
- DCP-02：意图声明与策略管控
- DCP-03：审计链与透明度
- FIPS 203：ML-KEM（基于模格的密钥封装机制）
- RFC 5869：HKDF
- RFC 8949：CBOR
- RFC 8446：TLS 1.3（握手设计的灵感来源）

---

*本规范由一个人和一个 AI 代理共同创作：这是首个面向数字公民身份的 A2A 协议，旨在治理它所促成的交互本身。*

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- **SDK 实现了什么。** 在 `main` 上，所有 SDK 都能构建 `A2A_HELLO` 和 `A2A_WELCOME`；没有任何 SDK 实现
  `A2A_CONFIRM` / `A2A_ESTABLISHED` 或 §3.4 的密钥派生，只有 TypeScript SDK 具备混合
  X25519 + ML-KEM-768 KEM，Rust SDK 没有会话层
  （[tools/interop-matrix](../../../tools/interop-matrix/README.md#roadmap)）。没有任何 SDK 或服务声称符合 §9 所定义的
  DCP-04 一致性。
- **辅助函数不做什么。** TypeScript 辅助函数构建消息、目录和会话对象，并用调用方提供的密钥加密和解密会话消息：
  `createSession` 以参数形式接收 `session_key`，不会派生它。它们不执行握手、KEM 交换、对方 bundle 的验证或准入、
  网络传输，也不生成 §6 的审计条目；这些都由调用方负责。
- **审计条目。** §6.2 的 A2A 审计条目没有 JSON Schema；其结构（`event_id`、`event_type`）不同于
  `schemas/v2/audit_entry.schema.json`（`audit_id`、`outcome`）。§2 至 §4 的 A2A 消息在 `schemas/v2/` 中同样没有
  schema。SDK 类型请参阅 [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md)。
- 示例是带有占位符（`...`、`<hex>`、`<uuid>`）的说明，而不是 fixtures。
