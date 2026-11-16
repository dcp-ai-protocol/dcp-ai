<sub>[English](../../../../integrations/anthropic-mcp/README.md) · **中文** · [Español](../../../es/integrations/anthropic-mcp/README.md) · [日本語](../../../ja/integrations/anthropic-mcp/README.md) · [Português](../../../pt-BR/integrations/anthropic-mcp/README.md)</sub>

<a id="dcp-ai--model-context-protocol-mcp-bridge"></a>
<a id="dcp-ai-model-context-protocol-mcp-bridge"></a>

# DCP-AI ↔ Model Context Protocol（MCP）桥接

> 本文是[英文版](../../../../integrations/anthropic-mcp/README.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

为 MCP 工具调用提供已签名的 DCP 回执，并为 MCP 服务器提供 DCP 工具和资源。

<a id="installation"></a>

## 安装

**已发布到 npm（2026 年 10 月 26 日）。** `@dcp-ai/anthropic-mcp` 2.1.0 的标签为 `latest`，依赖 `@dcp-ai/sdk` `^2.2.0`。以下描述的功能已可从 npm 获取。

包含签名收据（`withDcpReceipt`、`createReceiptIdentity`、`verifyDcpReceipt`）。示例还需要 `@modelcontextprotocol/sdk` 和 `zod`，请另行安装。

```bash
npm install @dcp-ai/anthropic-mcp@^2.1.0
```

所有软件包版本见 [npm 发布清单](../../../../docs/NPM_RELEASES.md)。

如需使用检出源码进行开发，请构建并安装本地软件包：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/anthropic-mcp
npm ci && npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/anthropic-mcp
```

<a id="signed-receipts-per-tool-call"></a>

## 每次工具调用的已签名回执

`withDcpReceipt` 包装任意 MCP 工具处理器，使每次调用都附带一张回执返回：这是用服务器的密钥做出的
已签名声明，说明调用了哪个工具、在哪个意图和
策略决定之下，以及输入和输出内容的哈希。它表明这些密钥的持有者
做出了这一声明；它本身并不能证明谁持有这些密钥（见[验证能证明什么](#what-verification-proves-and-what-it-does-not)），
也不能证明工具确实做了其结果所说的事。回执是普通的 **DCP v2.0 已签名 bundle**：代理的 Responsible Principal Record（DCP-01）和 Agent
Passport、在工具运行*之前*以 Ed25519 + ML-DSA-65 复合签名的 Intent（DCP-02）、
Policy Decision，以及一个带有参数和结果 SHA-256 的审计条目（DCP-03）。
线路上没有任何新东西：任何 DCP 验证器都可以离线检查它。

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withDcpReceipt, createReceiptIdentity, verifyDcpReceipt } from '@dcp-ai/anthropic-mcp';

// One identity per session: new keys and session nonce, signed RPR and passport.
// Production deployments pass their own signed RPR and passport instead.
const identity = await createReceiptIdentity({ legalName: 'Example Operator', jurisdiction: 'CL' });

const server = new McpServer({ name: 'weather', version: '1.0.0' });
server.registerTool(
  'get_weather',
  { description: 'Weather for a city', inputSchema: { city: z.string() } },
  withDcpReceipt('get_weather', async ({ city }) => ({ content: [{ type: 'text', text: `Sunny in ${city}` }] }), { identity }),
);
```

现在每个结果都带有 `_meta.dcp_receipt`。调用方或之后的任何人都可以验证它，并检查
它是*这次*调用的回执：

```typescript
// Fragment: `client` is an MCP client connected to the server above
const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Santiago' } });
const { _meta, ...seen } = result;
const check = await verifyDcpReceipt(_meta.dcp_receipt, { tool: 'get_weather', arguments: { city: 'Santiago' }, result: seen });
check.verified; // false if the bundle, the tool name or the hash of { arguments, result } does not match
```

每次调用时会发生什么：

| 策略决定 | 工具是否运行 | 返回内容 | 审计条目 |
|---|---|---|---|
| `approve` | 是 | 处理器的结果 + `_meta.dcp_receipt` | `outcome: "completed"`，`result_ref` = 结果的哈希 |
| `escalate` | 否 | `{ content, isError: true, _meta }` | `outcome: "escalated"`，`policy_decision: "escalated"`，`result_ref: null` |
| `block` | 否 | `{ content, isError: true, _meta }` | `outcome: "blocked"`，`policy_decision: "blocked"`，`result_ref: null` |
| 处理器抛出异常 | 是 | `{ content, isError: true, _meta }` | `outcome: "failed"`，`result_ref` = 该错误结果的哈希 |

拒绝也是证据：被阻止调用的回执会显示代理声明的意图以及
阻止它的决定。

<a id="classification-and-policy"></a>

### 分类和策略

默认情况下，每次调用都是通道 `api` 上带 `data_classes: ["none"]` 的低影响 `api_call`，
默认策略会批准它（风险 200）。请告诉包装器某个工具真正做什么，并在
默认值不合适时自行决定：

```typescript
// Fragment: payInvoice is your tool handler, identity as above
withDcpReceipt('pay_invoice', payInvoice, {
  identity,
  classify: (tool, args) => ({
    action_type: 'initiate_payment',
    channel: 'payments',
    estimated_impact: 'high',
    data_classes: ['financial_data'],
  }),
  // Default policy: risk = impact (low 200 / medium 500 / high 900) + 150 per sensitive data class, capped at 1000;
  // approve < 500, escalate < 800, block >= 800. Replace it with your own:
  decide: (intent) => ({ decision: 'escalate', risk_score: 900, reasons: ['payments need a human'] }),
  appliedPolicyHash: 'sha256:…', // hash of the policy you applied (default: hash of the default rules)
});
```

上面的 `'sha256:…'` 是占位符：请传入你的策略真实的 `sha256:` 和 64 个十六进制字符，或者省略
`appliedPolicyHash`。

意图的 `security_tier`（以及决定的 `resolved_tier`）是 SDK 为该意图给出的等级
（DCP-AI v2.0 §14.2），绝不低于风险评分所对应的等级（200 为 standard，500 为 elevated，800 为
maximum），因此默认调用是 `standard`。`appliedPolicyHash` 必须是 `sha256:<64 hex>`，
`createReceiptIdentity` 只接受护照 schema 中的能力（`browse`、`api_call`、
`email`、`calendar`、`payments`、`crm`、`file_write`、`code_exec`）；两者都会被预先拒绝，
因为参考验证器会校验 schema。

<a id="evidence-hashes"></a>

### 证据哈希

`evidence.evidence_hash` 是对 `{ arguments, result }` 的 JSON 文本（在每一层都对键排序，`stableJson`）计算的 `sha256:`，
`evidence.result_ref` 则是在工具运行后只对结果计算的同类哈希。`arguments` 是收到时的参数，在处理器运行之前复制，
因此改写其输入的处理器无法改变回执所证明的内容。`result` 恰好是包装器返回的内容去掉 `_meta`（`resultSeen(result)`）：
回执通过 `_meta` 传递，处理器自己的 `_meta` 是传输元数据，而不是证据。返回裸值的处理器会被包装为
`{ content: [{ type: "text", text }] }`，被哈希的就是这个包装。参数会被
作为 JSON 快照保存，因此 `Date` 按其 ISO 字符串哈希，函数会被丢弃，
`AbortSignal`（如 MCP SDK 的 `extra` 中的那个）会变成 `{}`。当 MCP 的 `extra` 带有 `requestId` 时，它会被记录
为 `evidence.request_id`，`verifyDcpReceipt(receipt, { requestId })` 会检查它。

与规范化配置文件不同，`stableJson` 保留任何 JSON 数字，因此带小数的参数和结果
也能正常哈希。它用 JavaScript 的 `sort()` 对键排序；键为整数字符串的对象
（`{ "10": 1, "9": 2 }`）会按 V8 的方式排序，因此当需要用其他语言检查时，
请在 JavaScript 中重新计算哈希，或避免使用这类键。

<a id="what-verification-proves-and-what-it-does-not"></a>

### 验证能证明什么，不能证明什么

与所有 DCP bundle 一样，回执用它自己的护照和 RPR 列出的密钥来验证：仅有 `verified` 结果
只能证明回执自洽且未被篡改，并不能证明这些密钥属于谁。要
使其成为身份检查，请传入 `trustedKeys`（你已经为该代理及其
委托人信任的密钥，来自注册表或固定的护照和 RPR），以及 `expectedAgentId` 和
`expectedHumanId`：此时 SDK 在回执中验证的每个签名都必须由
这些密钥之一生成，该密钥的解析方式与 SDK 完全相同（在该工件的密钥列表中，取第一个带有签名 `kid` 的密钥），
并且在你的列表中有效且未过期；只有满足这一点时，结果才会显示 `anchored: true`。`anchored` 与 bundle 验证分开计算，因此在 `verified` 为 `false` 时它也可能是
`true`：只有两者都为 `true` 时才接受回执。信任护照注册表的验证器可以锚定代理生成的每一张回执，
而无需重新读取护照本身。

需要了解的限制：

- 回执通过其 `intent_id` 和 `audit_id` 绑定到一次调用，并在服务器提供时通过
  `request_id` 绑定到 MCP 请求。会话时间窗口和模式由 SDK 验证器在你传入的 `policy`（否则为
  `DEFAULT_VERIFIER_POLICY`）下检查；`verifyDcpReceipt` 不会自行添加
  任何时间窗口或去重，因此需要检测重放回执的验证器应自己保存
  已见 id 的集合。
- 每张回执都是独立的（一个审计条目，`prev_hash: "GENESIS"`）；把一个会话的
  回执批量放进一个 bundle 列在路线图中。
- `createReceiptIdentity` 用同一密钥对为 RPR 和护照签名（委托人和
  代理是同一个），这只适用于测试和首次运行。

<a id="dcp-tools-and-resources"></a>

## DCP 工具和资源

该桥接还将 DCP 操作作为 MCP 工具和资源公开，使兼容 MCP 的模型可以：

- **验证 DCP bundle** — 对已签名 bundle 或回执运行 SDK 的 V2 验证器（`verifySignedBundleV2`）。
- **创建 DCP 身份** — 配置新的 Responsible Principal Record 和 Agent Passport。
- **声明意图** — 提交意图以进行策略评估，并自动计算风险等级。
- **检查代理状态** — 占位符：`dcp_check_agent` 返回 `status: "check_pending"`，不获取也不验证任何内容。
- **生命周期管理（DCP-05）** — 启用代理、报告活力、停用代理。
- **继承（DCP-06）** — 创建带继任者偏好的数字遗嘱。
- **争议（DCP-07）** — 提交代理之间附有证据哈希的争议。
- **权利（DCP-08）** — 在某一司法管辖区内声明代理的权利。
- **委托（DCP-09）** — 创建从人到代理的委托授权。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，部分支持：已签名回执和 bundle 验证，以及采用其他规范形式的
草稿。它并未完整实现这些规范。

<a id="mcp-tools"></a>

## MCP 工具

| 工具 | 说明 |
|---|---|
| `dcp_verify_bundle` | 用 SDK 的 V2 验证器验证已签名的 DCP v2.0 bundle 或回执 |
| `dcp_create_identity` | 创建新的 DCP 数字身份（RPR + 护照） |
| `dcp_declare_intent` | 声明意图以进行策略评估 |
| `dcp_check_agent` | 占位符：返回 `check_pending`，不获取也不验证任何内容 |
| `dcp_commission_agent` | 启用代理（DCP-05） |
| `dcp_report_vitality` | 报告代理的活力指标（DCP-05） |
| `dcp_decommission_agent` | 停用代理（DCP-05） |
| `dcp_create_testament` | 创建数字遗嘱（DCP-06） |
| `dcp_file_dispute` | 提交代理之间的争议（DCP-07） |
| `dcp_declare_rights` | 声明代理的权利（DCP-08） |
| `dcp_create_mandate` | 创建委托授权（DCP-09） |

<a id="mcp-resources"></a>

## MCP 资源

| URI | 说明 |
|---|---|
| `dcp://protocol/version` | 当前 DCP 协议版本及其能力 |
| `dcp://protocol/algorithms` | 支持的加密算法 |
| `dcp://protocol/tiers` | 安全等级的定义和要求 |
| `dcp://protocol/lifecycle-states` | 代理生命周期状态的定义（DCP-05） |

<a id="usage"></a>

## 用法

<a id="registering-with-an-mcp-server"></a>

### 在 MCP 服务器中注册

`DCP_MCP_TOOLS` 是工具描述符（`name`、`description`、作为 JSON Schema 的 `inputSchema`），`DCP_MCP_RESOURCES` 是资源描述符（`uri`、`name`、`description`、`mimeType`）；该软件包不提供资源的内容。下面是使用 MCP TypeScript SDK 低层 `Server` 的草图，它原样接受 JSON Schema 工具描述符（此处未运行：需要 MCP SDK）：

```javascript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DCP_MCP_TOOLS, DCP_MCP_RESOURCES, handleDcpToolCall } from '@dcp-ai/anthropic-mcp';

const server = new Server({ name: 'dcp', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: DCP_MCP_TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await handleDcpToolCall(request.params.name, request.params.arguments ?? {});
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: DCP_MCP_RESOURCES }));
// Serving a resource's contents (resources/read) is up to your server.
```

<a id="tool-call-examples"></a>

### 工具调用示例

```javascript
import { handleDcpToolCall } from '@dcp-ai/anthropic-mcp';

// Fragment: myBundle is a signed bundle or receipt you hold
// Verify a bundle or a receipt
const result = await handleDcpToolCall('dcp_verify_bundle', {
  bundle_json: JSON.stringify(myBundle),
}); // { verified, errors, warnings, details, timestamp }

// Declare an intent
const intent = await handleDcpToolCall('dcp_declare_intent', {
  agent_id: 'agent:my-agent',
  action_type: 'api_call',
  description: 'Fetch weather data from external API',
  risk_score: 150,
});
```

<a id="notes"></a>

## 说明

- `dcp_verify_bundle` 在 `DEFAULT_VERIFIER_POLICY` 下运行 `@dcp-ai/sdk` 的 `verifySignedBundleV2`（哈希、清单、复合签名、会话绑定、SHA-256 审计链）。它不校验 JSON Schema（参考验证器 `lib/verify.js` 会校验），`@dcp-ai/sdk` 2.2.0 也不检查 V2-11 的二级 SHA3-256 字段（当你的锁定文件解析到 2.2.1 或更高版本时，会检查存在的字段），并且 `verified` 结果既不是准入也不是授权。
- 除 `dcp_verify_bundle` 和回执外，工具处理器返回的都是草稿：需要签名的标识符和字段，绝不包含密钥或签名（`next_step` 说明缺少什么）。
- `dcp_create_identity` 只返回标识符 — 密钥生成和签名是单独的步骤。
- 风险等级根据风险评分自动计算：routine（<200）、standard（200-499）、elevated（500-799）、maximum（800+）。
