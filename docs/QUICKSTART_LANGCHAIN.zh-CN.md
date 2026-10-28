<sub>[English](QUICKSTART_LANGCHAIN.md) · **中文** · [Español](QUICKSTART_LANGCHAIN.es.md) · [日本語](QUICKSTART_LANGCHAIN.ja.md) · [Português](QUICKSTART_LANGCHAIN.pt-BR.md)</sub>

<a id="dcp-ai--langchain-quick-start"></a>
<a id="dcp-ai-langchain-quick-start"></a>

# DCP-AI + LangChain 快速开始

> 本文是[英文版](QUICKSTART_LANGCHAIN.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

将 Digital Citizenship Protocol 集成到你的 LangChain 智能体中，加入密码学身份、策略管控和审计轨迹。

---

<a id="installation"></a>

## 安装

本指南使用 **LangChain.js v1**（TypeScript/Node，Node.js 22 或更高版本）。如果你使用的是 **Python 版 LangChain**，
请跳到末尾的 Python 一节。

从注册表安装使用 `@dcp-ai/sdk` 2.2.1。以下 DCP 示例可使用该已发布 SDK 运行；检出源码是开发时的可选方式。见 TypeScript SDK 的[发布状态](../sdks/typescript/README.md#installation)。

```bash
npm install @dcp-ai/sdk@^2.2.1 langchain @langchain/core @langchain/openai zod
```

<a id="zero-config-scaffold-alternative"></a>

### 零配置脚手架（替代方案）

```bash
npm create @dcp-ai/langchain my-app
cd my-app
npm install
```

生成一个可运行的 `index.js`，用一次 LangChain.js 调用走完 DCP 流程，但密钥和签名
都是占位符（`«generated»`、`«sig»`）：它不生成密钥、不签署任何内容，其 bundle 也不是可验证的
证据（参见 [templates/langchain](../templates/langchain/README.md)）；下面的示例使用真实的密钥和
签名。该脚手架固定使用 LangChain.js **0.3**
（`langchain` 和 `@langchain/openai` 的 `^0.3.0`），并直接使用 `ChatOpenAI`；该版本线的智能体 API
（`AgentExecutor`、`createOpenAIFunctionsAgent`）在 LangChain.js v1 中已移至 `@langchain/classic`；本指南遵循 v1 的 API。

---

<a id="how-dcp-integrates-with-langchain"></a>

## DCP 如何与 LangChain 集成

DCP 将每次 LangChain 工具调用包裹在策略管控中，并将其封装为已签名的证据：

1. **执行前：** 声明一个意图，并根据你自己的规则得到策略决定。
2. **执行：** 只运行策略批准的内容。
3. **执行后：** 记录一条审计条目（`intent_hash` 和 `prev_hash` 链会自动计算），并
   将该调用封装进一个已签名的 Citizenship Bundle。

```
LangChain Agent
  └─ Tool call
       ├─ DCP: intent → your policy gate (approve / escalate / block)
       ├─ Tool execution (approved calls only)
       └─ DCP: audit entry → bundle signed by the operator
```

---

<a id="complete-working-example"></a>

## 完整的可运行示例

DCP 部分可按原样用 TypeScript SDK 运行。LangChain 部分遵循 LangChain.js v1 的智能体 API
（来自 `langchain` 的 `createAgent` 和 `tool`），并会调用 OpenAI API，因此需要 `OPENAI_API_KEY`。

```typescript
import { createAgent, tool } from 'langchain';
import * as z from 'zod';
import { BundleBuilder, generateKeypair, signBundle, signObject, verifyObject, verifySignedBundle } from '@dcp-ai/sdk';
import type { AgentPassport, Intent, PolicyDecision, ResponsiblePrincipalRecord, SignedBundle } from '@dcp-ai/sdk';

const now = () => new Date().toISOString();

// 1. DCP identity: the operator signs the RPR, the agent its passport, each over the object without `signature`
const operatorKeys = generateKeypair();
const agentKeys = generateKeypair();
const humanId = 'human:operator-001';
const agentId = `agent:${crypto.randomUUID().slice(0, 8)}`;

const rprBody: Omit<ResponsiblePrincipalRecord, 'signature'> = {
  dcp_version: '1.0', human_id: humanId, legal_name: 'Operator', entity_type: 'natural_person',
  jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true, issued_at: now(),
  expires_at: null, contact: null,
};
const rpr: ResponsiblePrincipalRecord = { ...rprBody, signature: signObject(rprBody, operatorKeys.secretKeyB64) };
const passportBody: Omit<AgentPassport, 'signature'> = {
  dcp_version: '1.0', agent_id: agentId, public_key: agentKeys.publicKeyB64, principal_binding_reference: humanId,
  capabilities: ['browse', 'api_call'], risk_tier: 'low', created_at: now(), status: 'active',
};
const passport: AgentPassport = { ...passportBody, signature: signObject(passportBody, agentKeys.secretKeyB64) };

// 2. The policy gate: your rules decide before the tool runs
function evaluatePolicy(intent: Intent): PolicyDecision {
  const lowRisk = intent.estimated_impact === 'low' && intent.data_classes.every((d) => d === 'none');
  return {
    dcp_version: '1.0', intent_id: intent.intent_id, decision: lowRisk ? 'approve' : 'escalate',
    risk_score: lowRisk ? 0.05 : 0.6, reasons: [lowRisk ? 'low-impact call on public data' : 'needs human approval'],
    required_confirmation: lowRisk ? null : { type: 'human_approve' },
  };
}

// 3. A DCP gate around any tool function: each call is sealed into its own signed bundle;
//    the tool input stays out of the record
const bundles: SignedBundle[] = [];
async function dcpGated(name: string, run: () => Promise<string>): Promise<string> {
  const intent: Intent = {
    dcp_version: '1.0', intent_id: `intent:${crypto.randomUUID()}`, agent_id: agentId, human_id: humanId,
    timestamp: now(), action_type: 'api_call', target: { channel: 'api', domain: name },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  };
  const policy = evaluatePolicy(intent);
  // Your own policy may also return 'block': the audit entry records each decision as it is
  const [auditDecision, outcome] = ({
    approve: ['approved', `${name}_completed`],
    escalate: ['escalated', 'awaiting_human_approval'],
    block: ['blocked', 'action_blocked'],
  } as const)[policy.decision];
  const result = policy.decision === 'approve'
    ? await run()
    : `Not run (DCP policy: ${policy.decision}): ${policy.reasons.join(', ')}`;

  const bundle = new BundleBuilder()
    .responsiblePrincipalRecord(rpr)
    .agentPassport(passport)
    .intent(intent)
    .policyDecision(policy)
    .createAuditEntry({
      dcp_version: '1.0', audit_id: `audit:${crypto.randomUUID()}`, timestamp: now(), agent_id: agentId,
      human_id: humanId, intent_id: intent.intent_id, policy_decision: auditDecision,
      outcome, evidence: { tool: name, result_ref: null },
    })
    .build();
  bundles.push(signBundle(bundle, { secretKeyB64: operatorKeys.secretKeyB64, signerType: 'human', signerId: humanId }));
  return result;
}

// 4. LangChain tools whose functions go through the gate (never evaluate model output as code)
const search = tool(
  async ({ query }) => dcpGated('search', async () => `Results for: ${query}`),
  { name: 'search', description: 'Search the web', schema: z.object({ query: z.string() }) },
);
const multiply = tool(
  async ({ a, b }) => dcpGated('multiply', async () => String(a * b)),
  { name: 'multiply', description: 'Multiply two integers', schema: z.object({ a: z.number().int(), b: z.number().int() }) },
);

// 5. The agent (needs OPENAI_API_KEY)
const agent = createAgent({
  model: 'openai:gpt-4o-mini',
  tools: [search, multiply],
  systemPrompt: 'You are a helpful assistant. Use the tools when they help.',
});
const result = await agent.invoke({ messages: [{ role: 'user', content: 'What is 42 * 17?' }] });
console.log(result.messages.at(-1)?.content); // the agent's final answer

// 6. Verify each sealed bundle against the operator's key, and the inner signatures,
//    which verifySignedBundle does not check
for (const signed of bundles) {
  console.log(signed.bundle.intent.intent_id, verifySignedBundle(signed, operatorKeys.publicKeyB64).verified);
}
console.log(verifyObject(rprBody, rpr.signature, operatorKeys.publicKeyB64));
console.log(verifyObject(passportBody, passport.signature, agentKeys.publicKeyB64));
```

---

<a id="dcp-integration-points"></a>

## DCP 集成点

| LangChain 概念 | DCP 对应 |
|-------------------|-------------|
| 智能体身份 | Agent Passport（通过 RPR 绑定到人类） |
| 工具调用 | 意图声明 → 策略管控 |
| 工具结果 | 审计条目（以哈希链接） |
| 智能体会话 | Citizenship Bundle（在结束时封装） |
| 思维链 | 带证据引用的审计轨迹 |

---

<a id="v2-post-quantum-upgrade"></a>

## V2 后量子升级

要获得后量子安全，请使用 V2 复合签名 API（这是一个片段；TypeScript SDK 的
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) 会构建并签署一个完整的 V2 bundle）：

```typescript
import {
  registerDefaultProviders,
  getDefaultRegistry,
  compositeSign,
  BundleBuilderV2,
} from '@dcp-ai/sdk';

registerDefaultProviders();
const registry = getDefaultRegistry();

// All signing operations now use Ed25519 + ML-DSA-65 hybrid
```

---

<a id="langchain-for-python"></a>

## Python 版 LangChain

如果你的 LangChain 技术栈是 Python 而不是 Node，请改用 Python SDK 内置的桥接：

```bash
pip install "dcp-ai[langchain]>=2.10.1,<3"
```

```python
# Fragment, inside an async function: `agent` is your LangChain agent or runnable; `passport` and `rpr` are
# V2 payload dicts (the agent's passport and the principal's RPR).
from dcp_ai.langchain import DCPAgentWrapper

wrapped = DCPAgentWrapper(agent=agent, passport=passport, rpr=rpr)
result = await wrapped.invoke({"input": "search for X and summarise"})
events = wrapped.get_audit_trail()  # V2 audit events, hash-chained; seal them into a bundle to sign them
```

`DCPAgentWrapper` 为每次调用声明一个意图和一个策略决定，拒绝 `block`，并记录一条
审计事件；`DCPTool` 让智能体可以验证其他智能体的 bundle，`DCPCallback` 则根据
LangChain 回调记录审计事件。这些记录没有签名，默认策略会批准所有调用，`escalate` 时仍会运行
智能体；在 LangChain 1.x 下 `DCPCallback` 需要你自己的处理器，PyPI 2.10.1 使用配置的策略验证 V1 和 V2（2.9.0 将所有 bundle 发送给 V1）。这些限制和完整接口参见 [integrations/langchain/README.md](../integrations/langchain/README.md)；
Python 桥接并不是上面那个手写的 TypeScript 示例。

---

<a id="next-steps"></a>

## 后续步骤

- **[主快速开始](./QUICKSTART.md)** — SDK 的基本用法
- **[CrewAI 集成](./QUICKSTART_CREWAI.md)** — 多智能体团队（Python）
- **[Express 中间件](./QUICKSTART_EXPRESS.md)** — 在你的 API 中验证 bundle
- **[API 参考](./API_REFERENCE.md)** — 完整的 SDK 文档
