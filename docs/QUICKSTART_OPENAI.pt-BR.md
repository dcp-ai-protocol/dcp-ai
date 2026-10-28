<sub>[English](QUICKSTART_OPENAI.md) · [中文](QUICKSTART_OPENAI.zh-CN.md) · [Español](QUICKSTART_OPENAI.es.md) · [日本語](QUICKSTART_OPENAI.ja.md) · **Português**</sub>

<a id="dcp-ai--openai-quick-start"></a>
<a id="dcp-ai-openai-quick-start"></a>

# DCP-AI + OpenAI: início rápido

> Tradução informativa da [versão em inglês](QUICKSTART_OPENAI.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Adicione identidade criptográfica, controle por política e trilhas de auditoria a agentes da OpenAI com chamadas de função.

---

<a id="installation"></a>

## Instalação

Este guia usa o **SDK da OpenAI para Node**. Se você usa Python, vá para a seção de Python no final.

A instalação pelo registro usa `@dcp-ai/sdk` 2.2.1 para os exemplos V1 e V2; o checkout é opcional (veja [instalação](../sdks/typescript/README.md#installation)). Os exemplos usam a API Chat Completions do SDK Node da OpenAI (`openai` v4 ou posterior; versões recentes adicionam chamadas de ferramentas personalizadas, que o laço recusa). Executá-los chama a API da OpenAI e exige `OPENAI_API_KEY`.

```bash
npm install @dcp-ai/sdk@^2.2.1 openai
```

<a id="zero-config-scaffold-alternative"></a>

### Scaffold sem configuração (alternativa)

```bash
npm create @dcp-ai/openai my-app
cd my-app
npm install
```

Gera um `index.js` executável que percorre o fluxo DCP com um agente da OpenAI com chamadas de função (identidade,
intenções, decisões de política, entradas de auditoria) com chaves e assinaturas de preenchimento (`«generated»`, `«sig»`): ele não
gera chaves, não assina nada e seus bundles não são evidência verificável (veja
[templates/openai](../templates/openai/README.md)). Os exemplos abaixo usam chaves e assinaturas reais.

---

<a id="how-dcp-integrates-with-openai"></a>

## Como o DCP se integra à OpenAI

O DCP envolve as chamadas de função da OpenAI num controle por política e sela cada chamada como evidência assinada: a chamada é declarada como
uma intenção, sua política decide, só uma chamada aprovada roda e uma entrada de auditoria a encerra.

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

## Exemplo completo funcional

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

## Pontos de integração do DCP

| Conceito da OpenAI | Correspondência no DCP |
|----------------|-------------|
| Identidade no prompt de sistema | Agent Passport + RPR |
| Definição de função | Declaração de capacidades |
| Chamada de função | Declaração de intenção → controle por política |
| Resultado da função | Entrada de auditoria (encadeada por hash) |
| Sessão de conversa | Citizenship Bundle |

---

<a id="structured-outputs-with-dcp"></a>

## Saídas estruturadas com DCP

Uma intenção declara os dados e o impacto de uma chamada; o seu controle por política é o que age sobre eles:

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

`requires_consent: true` registra o requisito; o DCP não pergunta à pessoa por conta própria. No exemplo acima,
`evaluatePolicy` escala uma intenção assim (não é de baixo impacto nem de dados `none`), então a função não roda e o
bundle selado registra `escalated` e `awaiting_human_approval` até que a sua aplicação obtenha a aprovação da pessoa.

---

<a id="v20-upgrade"></a>

## Atualização para a V2.0

O DCP v2.0 acrescenta assinaturas compostas pós-quânticas, níveis de segurança adaptativos e vinculação de sessão. Esta seção funciona com `@dcp-ai/sdk` 2.2.1 publicado (veja Instalação).

<a id="v2-identity"></a>

### Identidade V2

Construa o registro, as chaves híbridas do principal e do agente, o nonce de sessão, o RPR e o passaporte assinados
e as funções auxiliares `signed()` e `sha256Of()` exatamente como no
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) do SDK TypeScript.

<a id="v2-sealing-of-a-function-call-with-security-tiers"></a>

### Selagem V2 de uma chamada de função, com níveis de segurança

Um fragmento que continua o Quick Start (V2). `sealCallV2` não executa a função: ela sela o registro de uma
chamada, com valores sintéticos, num bundle V2 cuja intenção e decisão de política o agente assina, selado pelo
principal. Chame-a com a decisão que a sua política tomou; quando a decisão é `approve`, o resultado que ela registra
(`<function>_completed`) só é verdadeiro se o seu código executou a função e a viu terminar.

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

Um nível mais alto exige mais do verificador: em `elevated` e `maximum` o modo de verificação é `hybrid_required`, então
o bundle precisa trazer as duas assinaturas (spec §14.3).

<a id="v2-dcp-integration-points-for-openai"></a>

### Pontos de integração do DCP V2 para a OpenAI

| Conceito da OpenAI | Correspondência no DCP V1 | Acréscimos do DCP V2 |
|----------------|---------------|-----------------|
| Identidade no prompt de sistema | Passaporte + RPR | + chaves híbridas (`binding_keys`, `keys`) e nonce de sessão |
| Definição de função | Capacidade | Sem alterações |
| Chamada de função | Intenção → política | + `risk_score` inteiro (0–1000), nível de segurança, artefatos assinados |
| Resultado da função | Entrada de auditoria | + hashes `sha256:`, cadeia de hash duplo opcional e checkpoints PQ |
| Sessão de conversa | Bundle | + manifesto, assinatura composta do principal |

Veja [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) para atualizar integrações V1 existentes com a OpenAI.

---

<a id="python-equivalent"></a>

## Equivalente em Python

Se o seu agente é escrito com o SDK da OpenAI para Python, use a ponte Python (a versão publicada; a partir de uma
cópia do repositório, `pip install -e "/path/to/dcp-ai/sdks/python[openai]"`):

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

`DCPOpenAIClient` declara uma intenção para cada chamada e registra um evento de auditoria V2. `DCP_TOOLS` são definições
de funções para operações DCP que o modelo pode solicitar: `dcp_verify_bundle`, `dcp_declare_intent`,
`dcp_commission_agent`, `dcp_report_vitality`, `dcp_declare_rights` e `dcp_create_mandate`; o seu código as
executa. A ponte Python não é o exemplo TypeScript escrito à mão acima: mantém registros sem assinatura, não avalia políticas e registra `policy_decision: "approved"` para as chamadas sem tomar uma decisão de autorização. Veja o [README da integração Python](../integrations/openai/README.md) para conhecer seu alcance e as limitações do verificador publicado.

---

<a id="next-steps"></a>

## Próximos passos

- **[Início rápido principal](./QUICKSTART.md)** — Uso básico do SDK
- **[Integração com LangChain](./QUICKSTART_LANGCHAIN.md)** — LangChain.js e LangChain para Python
- **[Middleware Express](./QUICKSTART_EXPRESS.md)** — Verifique bundles na sua API
- **[Referência da API](./API_REFERENCE.md)** — Documentação completa do SDK
