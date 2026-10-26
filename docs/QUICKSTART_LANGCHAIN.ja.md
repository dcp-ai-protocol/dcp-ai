<sub>[English](QUICKSTART_LANGCHAIN.md) · [中文](QUICKSTART_LANGCHAIN.zh-CN.md) · [Español](QUICKSTART_LANGCHAIN.es.md) · **日本語** · [Português](QUICKSTART_LANGCHAIN.pt-BR.md)</sub>

<a id="dcp-ai--langchain-quick-start"></a>
<a id="dcp-ai-langchain-quick-start"></a>

# DCP-AI + LangChain クイックスタート

> [英語版](QUICKSTART_LANGCHAIN.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

Digital Citizenship Protocol を LangChain のエージェントに統合し、暗号学的なアイデンティティ、ポリシーによる制御、監査証跡を追加します。

---

<a id="installation"></a>

## インストール

このガイドは **LangChain.js v1**（TypeScript/Node、Node.js 22 以降）を使います。**Python 版の LangChain** を使う場合は、
末尾の Python のセクションに進んでください。

レジストリからのインストールには `@dcp-ai/sdk` 2.2.0 を使います。以下の DCP の例はその公開済み SDK で動作し、ソースのチェックアウトは開発時の選択肢です。TypeScript SDK の[リリース状況](../sdks/typescript/README.md#installation)を参照してください。

```bash
npm install @dcp-ai/sdk@^2.2.0 langchain @langchain/core @langchain/openai zod
```

<a id="zero-config-scaffold-alternative"></a>

### 設定不要の雛形（代替手段）

```bash
npm create @dcp-ai/langchain my-app
cd my-app
npm install
```

LangChain.js の呼び出しで DCP の流れをたどる、実行可能な `index.js` を生成します。鍵と署名は
プレースホルダー（`«generated»`、`«sig»`）で、鍵を生成せず、何にも署名せず、そのバンドルは検証可能な証拠に
なりません（[templates/langchain](../templates/langchain/README.md) を参照）。以下の例では実際の鍵と
署名を使います。雛形は LangChain.js **0.3**
（`langchain` と `@langchain/openai` の `^0.3.0`）に固定され、`ChatOpenAI` を直接使います。その系列のエージェント API
（`AgentExecutor`、`createOpenAIFunctionsAgent`）は LangChain.js v1 で `@langchain/classic` に移りました。このガイドは v1 の API に従います。

---

<a id="how-dcp-integrates-with-langchain"></a>

## DCP と LangChain の統合のしかた

DCP は、LangChain のツールの呼び出しをそれぞれポリシーによる制御で包み、署名済みの証拠として封印します。

1. **実行前：** 意図を宣言し、自分のルールからポリシー判断を得ます。
2. **実行：** ポリシーが承認したものだけが実行されます。
3. **実行後：** 監査エントリを記録し（`intent_hash` と `prev_hash` のチェーンは自動で計算されます）、
   呼び出しを署名済みの Citizenship Bundle に封印します。

```
LangChain Agent
  └─ Tool call
       ├─ DCP: intent → your policy gate (approve / escalate / block)
       ├─ Tool execution (approved calls only)
       └─ DCP: audit entry → bundle signed by the operator
```

---

<a id="complete-working-example"></a>

## 動作する完全な例

DCP の部分は、TypeScript SDK で書かれたとおりに動きます。LangChain の部分は LangChain.js v1 のエージェント API
（`langchain` の `createAgent` と `tool`）に従い、OpenAI API を呼び出すため、`OPENAI_API_KEY` が必要です。

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

## DCP の統合ポイント

| LangChain の概念 | DCP での対応 |
|-------------------|-------------|
| エージェントのアイデンティティ | Agent Passport（RPR を通じて人間に結び付けられる） |
| ツールの呼び出し | 意図の宣言 → ポリシーによる制御 |
| ツールの結果 | 監査エントリ（ハッシュで連鎖） |
| エージェントのセッション | Citizenship Bundle（最後に封印） |
| 思考の連鎖 | 証拠への参照を含む監査証跡 |

---

<a id="v2-post-quantum-upgrade"></a>

## V2 のポスト量子へのアップグレード

ポスト量子のセキュリティには、V2 の複合署名 API を使います（断片です。完全な V2 バンドルの構築と署名は、TypeScript SDK の
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) で行います）。

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

## Python 版の LangChain

LangChain のスタックが Node ではなく Python の場合は、代わりに Python SDK の組み込みのブリッジを使います。

```bash
pip install 'dcp-ai[langchain]'
```

```python
# Fragment, inside an async function: `agent` is your LangChain agent or runnable; `passport` and `rpr` are
# V2 payload dicts (the agent's passport and the principal's RPR).
from dcp_ai.langchain import DCPAgentWrapper

wrapped = DCPAgentWrapper(agent=agent, passport=passport, rpr=rpr)
result = await wrapped.invoke({"input": "search for X and summarise"})
events = wrapped.get_audit_trail()  # V2 audit events, hash-chained; seal them into a bundle to sign them
```

`DCPAgentWrapper` は呼び出しごとに意図とポリシー判断を宣言し、`block` を拒否し、
監査イベントを記録します。`DCPTool` はエージェントがほかのエージェントのバンドルを検証できるようにし、`DCPCallback` は
LangChain のコールバックから監査イベントを記録します。レコードは署名されず、既定のポリシーはすべての呼び出しを承認し、`escalate` でも
エージェントは実行されます。LangChain 1.x では `DCPCallback` に自前のハンドラーが必要で、PyPI の 2.9.0 では `DCPTool` がすべての
バンドルを V1 の検証器に送ります。これらの制限と全体の API については [integrations/langchain/README.md](../integrations/langchain/README.md) を参照してください。
Python のブリッジは、上の手書きの TypeScript の例とは別物です。

---

<a id="next-steps"></a>

## 次のステップ

- **[メインのクイックスタート](./QUICKSTART.md)** — SDK の基本的な使い方
- **[CrewAI との統合](./QUICKSTART_CREWAI.md)** — マルチエージェントのクルー（Python）
- **[Express ミドルウェア](./QUICKSTART_EXPRESS.md)** — API でバンドルを検証する
- **[API リファレンス](./API_REFERENCE.md)** — SDK の完全なドキュメント
