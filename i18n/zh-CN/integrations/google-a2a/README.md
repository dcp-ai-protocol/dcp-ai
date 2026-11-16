<sub>[English](../../../../integrations/google-a2a/README.md) · **中文** · [Español](../../../es/integrations/google-a2a/README.md) · [日本語](../../../ja/integrations/google-a2a/README.md) · [Português](../../../pt-BR/integrations/google-a2a/README.md)</sub>

<a id="dcp-ai--a2a-agent-to-agent-protocol-bridge"></a>
<a id="dcp-ai-a2a-agent-to-agent-protocol-bridge"></a>

# DCP-AI ↔ A2A（Agent-to-Agent）协议桥接

> 本文是[英文版](../../../../integrations/google-a2a/README.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

把已签名的 DCP Agent Passport 放进 A2A 的 Agent Card 中携带，使 A2A 使用方能够在委派任务之前离线验证护照的哈希和自签名。
护照指明了一个责任委托人；该桥接不验证该委托人的 RPR，也不建立准入。它还把 A2A 任务映射为 DCP 意图和审计条目。

<a id="installation"></a>

## 安装

**已发布到 npm（2026 年 10 月 26 日）。** `@dcp-ai/google-a2a` 2.1.0 的标签为 `latest`，依赖 `@dcp-ai/sdk` `^2.2.0`。以下描述的功能已可从 npm 获取。

`verifyAgentCardPassport` 使用复合签名辅助函数，而非完整的 `verifySignedBundleV2` 验证器；它不建立委托人信任或准入。

```bash
npm install @dcp-ai/google-a2a@^2.1.0
```

所有软件包版本见 [npm 发布清单](../../../../docs/NPM_RELEASES.md)。

如需使用检出源码进行开发，请构建并安装本地软件包：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/google-a2a
npm ci && npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/google-a2a
```

<a id="the-passport-inside-the-agent-card"></a>

## Agent Card 中的护照

A2A 允许 Agent Card 在 `capabilities.extensions`（`AgentExtension`：`uri`、`description`、`required`、`params`）中声明
扩展。DCP 护照扩展的 URI 为 `https://dcp-ai.org/a2a/extensions/passport/v2`，它在 `params.passport` 中携带智能体的
`SignedPayload<AgentPassportV2>`（DCP-01）：即智能体用其所列的 Ed25519 + ML-DSA-65 密钥签名的护照，带有指向
Responsible Principal Record 的 `principal_binding_reference`。线上格式没有任何新内容。

```typescript
// Fragment: signedPassport is your agent's SignedPayload<AgentPassportV2>
import { passportToAgentCard, verifyAgentCardPassport, agentCardToPassport } from '@dcp-ai/google-a2a';

// Publisher: the signed passport (as produced by the DCP SDK or @dcp-ai/openclaw) goes into the card.
const card = passportToAgentCard(signedPassport, 'https://my-agent.example.com/a2a');

// Consumer: check passport consistency; trust and endpoint possession require the steps below.
const check = await verifyAgentCardPassport(card);
if (!check.verified) throw new Error(check.errors.join('; '));
check.passport.agent_id; // the verified DCP agent
```

<a id="what-verification-proves-and-what-it-does-not"></a>

### 验证能证明什么、不能证明什么

`verifyAgentCardPassport` 检查：扩展存在、`payload_hash` 匹配、复合签名是 `pq_over_classical`（Ed25519 加 ML-DSA-65 或
SLH-DSA-192f，每个位置都固定为其算法），并且能在 AgentPassport 上下文中用护照自身所列的密钥（有效、未过期、每个 `kid`
都是其公钥的哈希）验证通过；时间戳符合 RFC 3339 的模式并能被 `Date.parse` 解析（这不是完整的日历检查：一些不可能的日期，例如 2 月 30 日，会被规范化并通过）；护照为 `active`；以及 `metadata.dcp_agent_id` 和给出时的
`expectedAgentId` 指向同一个智能体。未通过这些所列检查之一的卡片会被拒绝；这并不是对护照的完整 JSON Schema 校验，因此
这些检查之外的字段不会被校验。

护照是公开的，任何人都可以把它复制到自己的卡片中。因此，单凭 `verified` 结果只能证明护照是**自洽的**：由其所列的密钥
签名。它不能证明提供该卡片的一方持有这些密钥，也不能证明 `url`、`name`、`provider` 或 `skills` 属于护照中的智能体。要让它
成为身份检查：

- 传入 `trustedKeys`：你已经信任的该智能体的密钥（来自注册表、之前固定的护照，或者在委托人为智能体签名时，来自你在
  bundle 之外锚定其委托人的 RPR 的 `binding_keys`；RPR 上的有效签名本身并不能让它变得可信）以及
  `expectedAgentId`。两个签名密钥都必须在其中，且受信任的条目本身也必须为 `active` 且未过期（你对密钥的记录优先于护照中的
  副本）；此时结果会显示 `anchored: true`。`anchored` 只表示传入了 `trustedKeys`，即使验证失败也是如此：要进行锚定检查，请要求 `verified && anchored`。
- 只把 `result.passport` 当作智能体的身份，绝不要使用卡片中未签名的字段。
- 在委派任务之前，要求端点提供持有证明：SDK 的 `generateRegistrationPoP` / `verifyRegistrationPoP`，或 DCP-04 的 A2A
  会话。
  `verifyRegistrationPoP` 只检查对其所收到挑战的签名：你自己的协议必须由验证方签发新的、不可预测的 nonce，强制其过期和
  一次性使用，并把它绑定到 kid、智能体和端点。不要信任端点主动发送或重复使用的 PoP。A2A 1.0 的 `AgentCard.signatures`
  （对卡片的 JWS）是该协议自己绑定卡片其余部分的方式；该桥接没有实现它。

`attachPassportToAgentCard(card, signedPassport)` 把扩展添加到你已有的卡片中（替换之前的 DCP 护照），
`agentCardPassport(card)` 读取它，而当卡片带有护照时，`agentCardToPassport(card)` 返回所携带的护照而不是骨架。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，属于部分对应（即下面的函数）；并非这些规范的完整实现。

<a id="overview"></a>

## 概述

Google A2A 协议为智能体的发现和通信定义了一项标准。该桥接把 DCP 的身份和审计概念映射到 A2A 的原语上：

- **Agent Passport ↔ Agent Card** — 在可被发现的 A2A Agent Card 中携带 DCP 护照，并受上述信任和持有证明限制的约束。
- **A2A 任务 → DCP 意图** — 把收到的 A2A 任务请求转换为 DCP 意图，用于策略评估和审计记录。
- **审计包装** — 为 A2A 任务执行附加 DCP 审计条目，以便追溯。

<a id="functions"></a>

## 函数

| 函数 | 方向 | 说明 |
|---|---|---|
| `passportToAgentCard(passport, endpoint)` | DCP → A2A | 把 Agent Passport（已签名或未签名）转换为 A2A Agent Card；已签名的护照放在 DCP 扩展中携带 |
| `attachPassportToAgentCard(card, signedPassport)` | DCP → A2A | 把已签名的护照放入现有卡片的 `capabilities.extensions` |
| `agentCardPassport(card)` | A2A → DCP | 卡片所携带的已签名护照（如有） |
| `verifyAgentCardPassport(card, options?)` | A2A → DCP | 离线验证所携带的护照 |
| `agentCardToPassport(card)` | A2A → DCP | 所携带的护照；对于没有护照的卡片则返回骨架 |
| `wrapA2ATaskWithAudit(task, agentId, intentId)` | A2A + DCP | 用 DCP 审计条目包装任务 |
| `a2aTaskToIntent(task, agentId)` | A2A → DCP | 把任务请求转换为 DCP 意图 |
| `addMandateToA2AHandshake(handshake, mandate)` | DCP → A2A | 把 DCP-09 委托授权书注入 A2A 握手 |
| `createLifecycleNotification(agentId, event, details)` | DCP → A2A | 为生命周期事件（DCP-05）创建 A2A 通知 |

<a id="agent-card-metadata"></a>

## Agent Card 元数据

DCP 元数据嵌入在 Agent Card 的 `metadata` 字段中：

```json
{
  "dcp_agent_id": "agent:uuid",
  "dcp_version": "2.0",
  "dcp_security_tier": "standard",
  "dcp_owner_rpr_hash": "sha256:...",
  "dcp_lifecycle_state": "active",
  "dcp_mandate_id": null
}
```

这些字段是未签名的卡片数据：`dcp_security_tier` 始终为 `"standard"`（不经计算），`dcp_owner_rpr_hash` 保存护照的 `owner_rpr_hash`，对于 V2 护照则保存其 `principal_binding_reference`（RPR 的 `human_id`，而不是哈希）。它们有助于发现；身份只来自已验证的护照（`result.passport`）。

<a id="usage"></a>

## 用法

```javascript
// Fragment: myPassport and incomingTask come from your application
import { passportToAgentCard, a2aTaskToIntent } from '@dcp-ai/google-a2a';

// Publish a DCP agent as an A2A Agent Card
const card = passportToAgentCard(myPassport, 'https://my-agent.example.com/a2a');

// Convert an incoming A2A task to a DCP Intent
const intent = a2aTaskToIntent(incomingTask, 'agent:my-agent-id');
```

<a id="notes"></a>

## 说明

- Agent Card 的 `authentication.schemes` 被设为 `['dcp-bundle']`，表示该智能体使用基于 DCP bundle 的身份验证。
- 护照的 skills 由 DCP 能力派生，并把下划线替换为空格，以得到人类可读的名称。
- 对不带 DCP 扩展的卡片进行骨架转换（A2A → DCP）会产生部分记录，使用之前需要生成密钥并签名。
- 该桥接写入的卡片字段（`authentication`、`metadata`、…）早于 A2A 1.0，后者的卡片使用 `supportedInterfaces` 和 `securitySchemes`；`capabilities.extensions` 在两者中都有效。让卡片的其余部分与 A2A 1.0 对齐是另一项变更。
