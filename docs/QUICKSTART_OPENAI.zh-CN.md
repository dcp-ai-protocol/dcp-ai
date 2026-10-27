<sub>[English](QUICKSTART_OPENAI.md) · **中文** · [Español](QUICKSTART_OPENAI.es.md) · [日本語](QUICKSTART_OPENAI.ja.md) · [Português](QUICKSTART_OPENAI.pt-BR.md)</sub>

<a id="dcp-ai--openai-quick-start"></a>
<a id="dcp-ai-openai-quick-start"></a>

# DCP-AI + OpenAI 快速开始

> 本文是[英文版](QUICKSTART_OPENAI.md)的参考译文，更新于 27/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

为 OpenAI 函数调用智能体加入密码学身份、策略管控和审计轨迹。

---

<a id="installation"></a>

## 安装

本指南使用 **OpenAI Node SDK**。如果你使用 Python，请跳到末尾的 Python 一节。

从注册表安装时，V1 和 V2 示例均使用 `@dcp-ai/sdk` 2.2.0；源码检出是可选方式（见[安装说明](../sdks/typescript/README.md#installation)）。示例使用 OpenAI Node SDK 的 Chat Completions API（`openai` v4 或更高；近期版本增加了自定义工具调用，本循环会拒绝此类调用）。运行示例会调用 OpenAI API，并需要 `OPENAI_API_KEY`。

```bash
npm install @dcp-ai/sdk@^2.2.0 openai
```

<a id="zero-config-scaffold-alternative"></a>

### 零配置脚手架（替代方案）

```bash
npm create @dcp-ai/openai my-app
cd my-app
npm install
```

生成一个可运行的 `index.js`，用一个 OpenAI 函数调用智能体走完 DCP 流程（身份、
意图、策略决定、审计条目），但密钥和签名都是占位符（`«generated»`、`«sig»`）：它
不生成密钥、不签署任何内容，其 bundle 也不是可验证的证据（参见
[templates/openai](../templates/openai/README.md)）。下面的示例使用真实的密钥和签名。

---

<a id="how-dcp-integrates-with-openai"></a>

## DCP 如何与 OpenAI 集成

DCP 将 OpenAI 函数调用包裹在策略管控中，并把每次调用封装为已签名的证据：调用先被声明为
一个意图，由你的策略决定，只有获批的调用才会运行，最后以一条审计条目结束。

```
OpenAI Chat Completion
  └─ tool call
       ├─ DCP: intent → your policy gate (approve / escalate / block)
       ├─ execute the function (approved calls only)
       ├─ DCP: audit entry → bundle signed by the operator
       └─ return the result to the model
```

---

<a id="complete-working-example"></a>

## 完整的可运行示例

```typescript
import OpenAI from 'openai';
import { BundleBuilder, generateKeypair, signBundle, signObject, verifyObject, verifySignedBundle } from '@dcp-ai/sdk';
import type { AgentPassport, Intent, PolicyDecision, ResponsiblePrincipalRecord, SignedBundle } from '@dcp-ai/sdk';

const openai = new OpenAI(); // reads OPENAI_API_KEY
const now = () => new Date().toISOString();

// 1. DCP identity: the operator signs the RPR, the agent its passport, each over the object without `signature`
const operatorKeys = generateKeypair();
const agentKeys = generateKeypair();
const humanId = 'human:operator-001';
const agentId = 'agent:openai-001';

const rprBody: Omit<ResponsiblePrincipalRecord, 'signature'> = {
  dcp_version: '1.0', human_id: humanId, legal_name: 'AI Operator', entity_type: 'natural_person',
  jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true, issued_at: now(),
  expires_at: null, contact: null,
};
const rpr: ResponsiblePrincipalRecord = { ...rprBody, signature: signObject(rprBody, operatorKeys.secretKeyB64) };
const passportBody: Omit<AgentPassport, 'signature'> = {
  dcp_version: '1.0', agent_id: agentId, public_key: agentKeys.publicKeyB64, principal_binding_reference: humanId,
  capabilities: ['api_call', 'browse'], risk_tier: 'low', created_at: now(), status: 'active',
};
const passport: AgentPassport = { ...passportBody, signature: signObject(passportBody, agentKeys.secretKeyB64) };

// 2. OpenAI tools
const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string', description: 'City name' } },
        required: ['location'],
      },
    },
  },
];

// 3. The policy gate: your rules decide before the function runs
function evaluatePolicy(intent: Intent): PolicyDecision {
  const lowRisk = intent.estimated_impact === 'low' && intent.data_classes.every((d) => d === 'none');
  return {
    dcp_version: '1.0', intent_id: intent.intent_id, decision: lowRisk ? 'approve' : 'escalate',
    risk_score: lowRisk ? 0.05 : 0.6, reasons: [lowRisk ? 'low-risk function call' : 'needs human approval'],
    required_confirmation: lowRisk ? null : { type: 'human_approve' },
  };
}

// 4. A DCP-gated function executor: each call is sealed into its own signed bundle;
//    the arguments stay out of the record
const bundles: SignedBundle[] = [];
type FunctionToolCall = Extract<OpenAI.ChatCompletionMessageToolCall, { type: 'function' }>;
async function executeFunctionCall(call: FunctionToolCall): Promise<string> {
  const intent: Intent = {
    dcp_version: '1.0', intent_id: `intent:${crypto.randomUUID()}`, agent_id: agentId, human_id: humanId,
    timestamp: now(), action_type: 'api_call', target: { channel: 'api', domain: call.function.name },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  };
  const policy = evaluatePolicy(intent);
  // Your own policy may also return 'block': the audit entry records each decision as it is
  const [auditDecision, outcome] = ({
    approve: ['approved', `${call.function.name}_completed`],
    escalate: ['escalated', 'awaiting_human_approval'],
    block: ['blocked', 'action_blocked'],
  } as const)[policy.decision];

  let result: string;
  if (policy.decision !== 'approve') {
    result = JSON.stringify({ error: `Not run (DCP policy: ${policy.decision}): ${policy.reasons.join(', ')}` });
  } else if (call.function.name === 'get_weather') {
    const args = JSON.parse(call.function.arguments) as { location: string };
    result = JSON.stringify({ temp: 72, condition: 'sunny', location: args.location });
  } else {
    result = JSON.stringify({ error: 'Unknown function' });
  }

  const bundle = new BundleBuilder()
    .responsiblePrincipalRecord(rpr)
    .agentPassport(passport)
    .intent(intent)
    .policyDecision(policy)
    .createAuditEntry({
      dcp_version: '1.0', audit_id: `audit:${crypto.randomUUID()}`, timestamp: now(), agent_id: agentId,
      human_id: humanId, intent_id: intent.intent_id, policy_decision: auditDecision,
      outcome, evidence: { tool: call.function.name, result_ref: null },
    })
    .build();
  bundles.push(signBundle(bundle, { secretKeyB64: operatorKeys.secretKeyB64, signerType: 'human', signerId: humanId }));
  return result;
}

// 5. The conversation loop
async function runAgent(userMessage: string) {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a helpful assistant with DCP-verified identity.' },
    { role: 'user', content: userMessage },
  ];
  for (;;) {
    const response = await openai.chat.completions.create({ model: 'gpt-4', messages, tools });
    const choice = response.choices[0];
    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      messages.push(choice.message);
      for (const call of choice.message.tool_calls) {
        // Only function tools are defined here; current SDK versions also have custom tool calls
        const content = call.type === 'function' ? await executeFunctionCall(call) : JSON.stringify({ error: 'Unsupported tool type' });
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
      continue;
    }
    console.log('Assistant:', choice.message.content);
    break;
  }
}

await runAgent("What's the weather in San Francisco?");

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

| OpenAI 概念 | DCP 对应 |
|----------------|-------------|
| 系统提示中的身份 | Agent Passport + RPR |
| 函数定义 | 能力声明 |
| 函数调用 | 意图声明 → 策略管控 |
| 函数结果 | 审计条目（以哈希链接） |
| 对话会话 | Citizenship Bundle |

---

<a id="structured-outputs-with-dcp"></a>

## 使用 DCP 的结构化输出

意图声明一次调用涉及的数据和影响；对它们采取行动的是你的策略管控：

```typescript
// Fragment: the intent of a structured-output call that handles contact data
const intent: Intent = {
  dcp_version: '1.0', intent_id: `intent:${crypto.randomUUID()}`, agent_id: agentId, human_id: humanId,
  timestamp: now(), action_type: 'api_call', target: { channel: 'api', domain: 'structured-output' },
  data_classes: ['contact_info'], // DCP records data sensitivity
  estimated_impact: 'medium',
  requires_consent: true,         // declares that the principal's consent is needed
};
```

`requires_consent: true` 只是记录这一要求；DCP 不会自行询问人类。在上面的示例中，
`evaluatePolicy` 会把这样的意图升级（不是低影响，数据也不是 `none`），因此函数不会运行，
封装的 bundle 会记录 `escalated` 和 `awaiting_human_approval`，直到你的应用获得人类的批准。

---

<a id="v20-upgrade"></a>

## 升级到 V2.0

DCP v2.0 增加后量子复合签名、自适应安全等级和会话绑定。本节适用于已发布的 `@dcp-ai/sdk` 2.2.0（见安装说明）。

<a id="v2-identity"></a>

### V2 身份

完全按照 TypeScript SDK 的
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) 构建注册表、委托人和智能体的混合密钥、会话 nonce、已签名的 RPR 和护照，
以及 `signed()` 和 `sha256Of()` 辅助函数。

<a id="v2-sealing-of-a-function-call-with-security-tiers"></a>

### 函数调用的 V2 封装，带安全等级

一个接续 Quick Start (V2) 的片段。`sealCallV2` 不会运行函数：它把一次
调用的记录（使用合成值）封装进一个 V2 bundle，其中的意图和策略决定由智能体签署，并由
委托人封装。请用你的策略所做的决定来调用它；当决定为 `approve` 时，它所记录的结果
（`<function>_completed`）只有在你的代码确实运行了该函数并看到它完成时才是真实的。

```typescript
// Fragment: registry, principal, agent, nonce, rpr, passport, signed() and sha256Of() as in the Quick Start (V2)
import { BundleBuilderV2, computeSecurityTier, signBundleV2, verifySignedBundleV2, DCP_CONTEXTS } from '@dcp-ai/sdk';
import type { IntentV2, PolicyDecisionV2, AuditEventV2 } from '@dcp-ai/sdk';

async function sealCallV2(functionName: string, decision: PolicyDecisionV2['decision']) {
  const now = new Date().toISOString();
  const intent: IntentV2 = {
    dcp_version: '2.0', intent_id: `intent:${crypto.randomUUID()}`, session_nonce: nonce, agent_id: passport.agent_id,
    human_id: rpr.human_id, timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: functionName },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  };
  // risk_score is an integer from 0 to 1000 and comes from your policy decision
  const policy: PolicyDecisionV2 = {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision,
    risk_score: { approve: 50, escalate: 600, block: 900 }[decision],
    reasons: [{ approve: 'low-risk function call', escalate: 'needs human approval', block: 'not allowed' }[decision]],
    required_confirmation: decision === 'escalate' ? { type: 'human_approve' } : null,
    applied_policy_hash: sha256Of({ policy: 'default' }), timestamp: now,
  };
  const [auditDecision, outcome] = ({
    approve: ['approved', `${functionName}_completed`],
    escalate: ['escalated', 'awaiting_human_approval'],
    block: ['blocked', 'action_blocked'],
  } as const)[decision];
  const tier = computeSecurityTier(intent, policy); // 'routine' at 50, 'elevated' at 600, 'maximum' at 900
  const audit: AuditEventV2 = {
    dcp_version: '2.0', audit_id: `audit:${crypto.randomUUID()}`, session_nonce: nonce, prev_hash: 'GENESIS',
    hash_alg: 'sha256', timestamp: now, agent_id: passport.agent_id, human_id: rpr.human_id,
    intent_id: intent.intent_id, intent_hash: sha256Of(intent), policy_decision: auditDecision,
    outcome,
    evidence: { tool: functionName, result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
  };
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal))
    .agentPassport(await signed(passport, DCP_CONTEXTS.AgentPassport, agent))
    .intent(await signed(intent, DCP_CONTEXTS.Intent, agent))
    .policyDecision(await signed(policy, DCP_CONTEXTS.PolicyDecision, agent))
    .addAuditEntry(audit)
    .build();
  const signedBundle = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: principal });
  const result = await verifySignedBundleV2(signedBundle, registry);
  return { tier, verified: result.verified, mode: result.details?.verification_mode };
}

console.log(await sealCallV2('get_weather', 'approve')); // { tier: 'routine', verified: true, mode: ... }
```

更高的等级对验证器的要求更多：在 `elevated` 和 `maximum` 下，验证模式为 `hybrid_required`，因此
bundle 必须带有两种签名（规范 §14.3）。

<a id="v2-dcp-integration-points-for-openai"></a>

### 面向 OpenAI 的 DCP V2 集成点

| OpenAI 概念 | DCP V1 对应 | DCP V2 新增 |
|----------------|---------------|-----------------|
| 系统提示中的身份 | 护照 + RPR | + 混合密钥（`binding_keys`、`keys`）和会话 nonce |
| 函数定义 | 能力 | 不变 |
| 函数调用 | 意图 → 策略 | + 整数 `risk_score`（0–1000）、安全等级、已签名的构件 |
| 函数结果 | 审计条目 | + `sha256:` 哈希、可选的双哈希链和 PQ 检查点 |
| 对话会话 | Bundle | + 清单、委托人的复合签名 |

升级现有的 V1 OpenAI 集成，参见 [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md)。

---

<a id="python-equivalent"></a>

## Python 中的等效做法

如果你的智能体是用 OpenAI Python SDK 编写的，请使用 Python 桥接（已发布的版本；从
检出副本安装时为 `pip install -e "/path/to/dcp-ai/sdks/python[openai]"`）：

```bash
pip install "dcp-ai[openai]>=2.10.0,<3"
```

```python
# Fragment: passport and rpr are V2 payload dicts (the agent's passport and the principal's RPR)
from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient, DCP_TOOLS

client = DCPOpenAIClient(openai_client=OpenAI(), passport=passport, rpr=rpr)
response = client.chat_completions_create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    tools=DCP_TOOLS,   # DCP operations the model may request (see below)
)
events = client.get_audit_trail()  # V2 audit events, hash-chained; seal them into a bundle to sign them
```

`DCPOpenAIClient` 为每次调用声明一个意图，并记录一条 V2 审计事件。`DCP_TOOLS` 是模型可以请求的 DCP 操作的
函数定义：`dcp_verify_bundle`、`dcp_declare_intent`、
`dcp_commission_agent`、`dcp_report_vitality`、`dcp_declare_rights` 和 `dcp_create_mandate`；由你的代码
执行它们。Python 桥接并不是上面那个手写的 TypeScript 示例：它保留未签名的记录，不评估策略，并为调用记录 `policy_decision: "approved"`，但并未作出授权决定。其适用范围和已发布验证器的限制见 [Python 集成 README](../integrations/openai/README.md)。

---

<a id="next-steps"></a>

## 后续步骤

- **[主快速开始](./QUICKSTART.md)** — SDK 的基本用法
- **[LangChain 集成](./QUICKSTART_LANGCHAIN.md)** — LangChain.js 和 Python 版 LangChain
- **[Express 中间件](./QUICKSTART_EXPRESS.md)** — 在你的 API 中验证 bundle
- **[API 参考](./API_REFERENCE.md)** — 完整的 SDK 文档
