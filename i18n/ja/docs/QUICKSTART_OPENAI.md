<sub>[English](../../../docs/QUICKSTART_OPENAI.md) · [中文](../../zh-CN/docs/QUICKSTART_OPENAI.md) · [Español](../../es/docs/QUICKSTART_OPENAI.md) · **日本語** · [Português](../../pt-BR/docs/QUICKSTART_OPENAI.md)</sub>

<a id="dcp-ai--openai-quick-start"></a>
<a id="dcp-ai-openai-quick-start"></a>

# DCP-AI + OpenAI クイックスタート

> [英語版](../../../docs/QUICKSTART_OPENAI.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

OpenAI の関数呼び出しエージェントに、暗号学的なアイデンティティ、ポリシーによる制御、監査証跡を追加します。

---

<a id="installation"></a>

## インストール

このガイドは **OpenAI の Node SDK** を使います。Python を使う場合は、末尾の Python のセクションに進んでください。

レジストリからのインストールでは V1 と V2 の両方の例に `@dcp-ai/sdk` 2.2.1 を使います。チェックアウトは任意です（[インストール](../../../sdks/typescript/README.md#installation)を参照）。例は OpenAI Node SDK の Chat Completions API を使います（`openai` v4 以降。最近のバージョンにはカスタムツール呼び出しが追加されていますが、このループでは拒否します）。実行時には OpenAI API を呼び出し、`OPENAI_API_KEY` が必要です。

```bash
npm install @dcp-ai/sdk@^2.2.1 openai
```

<a id="zero-config-scaffold-alternative"></a>

### 設定不要の雛形（代替手段）

```bash
npm create @dcp-ai/openai my-app
cd my-app
npm install
```

OpenAI の関数呼び出しエージェントで DCP の流れ（アイデンティティ、意図、ポリシー判断、監査エントリ）をたどる、実行可能な `index.js` を生成します。
鍵と署名はプレースホルダー（`«generated»`、`«sig»`）で、鍵を生成せず、何にも署名せず、そのバンドルは検証可能な証拠になりません（
[templates/openai](../../../templates/openai/README.md) を参照）。以下の例では実際の鍵と署名を使います。

---

<a id="how-dcp-integrates-with-openai"></a>

## DCP と OpenAI の統合のしかた

DCP は、OpenAI の関数呼び出しをポリシーによる制御で包み、各呼び出しを署名済みの証拠として封印します。呼び出しは意図として宣言され、
ポリシーが判断し、承認された呼び出しだけが実行され、監査エントリがそれを締めくくります。

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

## 動作する完全な例

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

## DCP の統合ポイント

| OpenAI の概念 | DCP での対応 |
|----------------|-------------|
| システムプロンプトのアイデンティティ | Agent Passport + RPR |
| 関数の定義 | 機能の宣言 |
| 関数の呼び出し | 意図の宣言 → ポリシーによる制御 |
| 関数の結果 | 監査エントリ（ハッシュで連鎖） |
| 会話のセッション | Citizenship Bundle |

---

<a id="structured-outputs-with-dcp"></a>

## DCP を使った構造化出力

意図は呼び出しのデータと影響を宣言し、それに基づいて動くのはポリシーによる制御です。

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

`requires_consent: true` は要件を記録するだけで、DCP が自ら人間に尋ねることはありません。上の例では、
`evaluatePolicy` はこのような意図（影響が低くなく、データが `none` でない）をエスカレーションするため、関数は実行されず、
封印されたバンドルには、アプリケーションが人間の承認を得るまで `escalated` と `awaiting_human_approval` が記録されます。

---

<a id="v20-upgrade"></a>

## V2.0 へのアップグレード

DCP v2.0 はポスト量子複合署名、適応型セキュリティティア、セッションバインディングを追加します。このセクションは公開済みの `@dcp-ai/sdk` 2.2.1 で動作します（インストールを参照）。

<a id="v2-identity"></a>

### V2 のアイデンティティ

レジストリ、プリンシパルとエージェントのハイブリッド鍵、セッションの nonce、署名済みの RPR とパスポート、
そして `signed()` と `sha256Of()` のヘルパーを、TypeScript SDK の
[Quick Start (V2)](../../../sdks/typescript/README.md#quick-start-v2) とまったく同じように構築します。

<a id="v2-sealing-of-a-function-call-with-security-tiers"></a>

### セキュリティティアを伴う、関数呼び出しの V2 での封印

Quick Start (V2) の続きとなる断片です。`sealCallV2` は関数を実行しません。1 回の呼び出しの記録を合成した値で
V2 バンドルに封印します。そのバンドルの意図とポリシー判断にはエージェントが署名し、プリンシパルが封印します。
ポリシーが下した判断を渡して呼び出してください。判断が `approve` のとき、記録される結果
（`<function>_completed`）が真実になるのは、コードが実際に関数を実行し、その完了を確認した場合だけです。

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

ティアが高いほど検証者への要求も増えます。`elevated` と `maximum` では検証モードが `hybrid_required` なので、
バンドルは両方の署名を持たなければなりません（仕様 §14.3）。

<a id="v2-dcp-integration-points-for-openai"></a>

### OpenAI のための DCP V2 の統合ポイント

| OpenAI の概念 | DCP V1 での対応 | DCP V2 での追加 |
|----------------|---------------|-----------------|
| システムプロンプトのアイデンティティ | パスポート + RPR | + ハイブリッド鍵（`binding_keys`、`keys`）とセッションの nonce |
| 関数の定義 | 機能 | 変更なし |
| 関数の呼び出し | 意図 → ポリシー | + 整数の `risk_score`（0〜1000）、セキュリティティア、署名済みのアーティファクト |
| 関数の結果 | 監査エントリ | + `sha256:` のハッシュ、オプションの二重ハッシュチェーンと PQ チェックポイント |
| 会話のセッション | バンドル | + マニフェスト、プリンシパルによる複合署名 |

既存の V1 の OpenAI 統合をアップグレードするには、[MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md) を参照してください。

---

<a id="python-equivalent"></a>

## Python での同等の方法

エージェントを OpenAI の Python SDK で書いている場合は、Python のブリッジを使います（公開済みのバージョン。チェックアウトからは
`pip install -e "/path/to/dcp-ai/sdks/python[openai]"`）。

```bash
pip install "dcp-ai[openai]>=2.10.1,<3"
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

`DCPOpenAIClient` は呼び出しごとに意図を宣言し、V2 の監査イベントを記録します。`DCP_TOOLS` は、モデルが要求できる DCP の操作の
関数定義です：`dcp_verify_bundle`、`dcp_declare_intent`、
`dcp_commission_agent`、`dcp_report_vitality`、`dcp_declare_rights`、`dcp_create_mandate`。それらを
実行するのはあなたのコードです。Python のブリッジは、上の手書きの TypeScript の例とは別物です。署名されていない記録を保持し、ポリシーを評価せず、認可を判断することなく呼び出しに対して `policy_decision: "approved"` を記録します。適用範囲と公開済み検証器の制限については、[Python 統合の README](../../../integrations/openai/README.md) を参照してください。

---

<a id="next-steps"></a>

## 次のステップ

- **[メインのクイックスタート](../../../docs/QUICKSTART.md)** — SDK の基本的な使い方
- **[LangChain との統合](../../../docs/QUICKSTART_LANGCHAIN.md)** — LangChain.js と Python 版の LangChain
- **[Express ミドルウェア](../../../docs/QUICKSTART_EXPRESS.md)** — API でバンドルを検証する
- **[API リファレンス](../../../docs/API_REFERENCE.md)** — SDK の完全なドキュメント
