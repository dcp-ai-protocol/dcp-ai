<sub>[English](../../../docs/QUICKSTART_LANGCHAIN.md) · [中文](../../zh-CN/docs/QUICKSTART_LANGCHAIN.md) · [Español](../../es/docs/QUICKSTART_LANGCHAIN.md) · [日本語](../../ja/docs/QUICKSTART_LANGCHAIN.md) · **Português**</sub>

<a id="dcp-ai--langchain-quick-start"></a>
<a id="dcp-ai-langchain-quick-start"></a>

# DCP-AI + LangChain: início rápido

> Tradução informativa da [versão em inglês](../../../docs/QUICKSTART_LANGCHAIN.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Integre o Digital Citizenship Protocol aos seus agentes LangChain para adicionar identidade criptográfica, controle por política e trilhas de auditoria.

---

<a id="installation"></a>

## Instalação

Este guia usa o **LangChain.js v1** (TypeScript/Node, Node.js 22 ou posterior). Se você usa o **LangChain para Python**,
vá para a seção de Python no final.

A instalação pelo registro usa `@dcp-ai/sdk` 2.2.1. Os exemplos DCP abaixo funcionam com esse SDK publicado; o checkout é opcional para desenvolvimento. Veja o [estado de publicação](../../../sdks/typescript/README.md#installation) do SDK TypeScript.

```bash
npm install @dcp-ai/sdk@^2.2.1 langchain @langchain/core @langchain/openai zod
```

<a id="zero-config-scaffold-alternative"></a>

### Scaffold sem configuração (alternativa)

```bash
npm create @dcp-ai/langchain my-app
cd my-app
npm install
```

Gera um `index.js` executável que percorre o fluxo DCP com uma chamada do LangChain.js, com chaves e assinaturas
de preenchimento (`«generated»`, `«sig»`): ele não gera chaves, não assina nada e seus bundles não são evidência
verificável (veja [templates/langchain](../../../templates/langchain/README.md)); os exemplos abaixo usam chaves e
assinaturas reais. O scaffold fixa o LangChain.js **0.3**
(`langchain` e `@langchain/openai` `^0.3.0`) e usa `ChatOpenAI` diretamente; as APIs de agentes dessa linha
(`AgentExecutor`, `createOpenAIFunctionsAgent`) foram para `@langchain/classic` no LangChain.js v1; este guia segue a API da v1.

---

<a id="how-dcp-integrates-with-langchain"></a>

## Como o DCP se integra ao LangChain

O DCP envolve cada invocação de ferramenta do LangChain num controle por política e a sela como evidência assinada:

1. **Antes da execução:** declare uma intenção e obtenha uma decisão de política das suas próprias regras.
2. **Execução:** só roda o que a política aprovou.
3. **Depois da execução:** registre uma entrada de auditoria (`intent_hash` e a cadeia `prev_hash` são calculados para você) e
   sele a chamada num Citizenship Bundle assinado.

```
LangChain Agent
  └─ Tool call
       ├─ DCP: intent → your policy gate (approve / escalate / block)
       ├─ Tool execution (approved calls only)
       └─ DCP: audit entry → bundle signed by the operator
```

---

<a id="complete-working-example"></a>

## Exemplo completo funcional

A parte DCP roda como está escrita com o SDK TypeScript. A parte do LangChain segue a API de agentes do LangChain.js v1
(`createAgent` e `tool` de `langchain`) e chama a API da OpenAI, então precisa de `OPENAI_API_KEY`.

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

## Pontos de integração do DCP

| Conceito do LangChain | Correspondência no DCP |
|-------------------|-------------|
| Identidade do agente | Agent Passport (vinculado à pessoa via RPR) |
| Invocação de ferramenta | Declaração de intenção → controle por política |
| Resultado da ferramenta | Entrada de auditoria (encadeada por hash) |
| Sessão do agente | Citizenship Bundle (selado no final) |
| Cadeia de raciocínio | Trilha de auditoria com referências a evidências |

---

<a id="v2-post-quantum-upgrade"></a>

## Atualização pós-quântica V2

Para segurança pós-quântica, use a API de assinatura composta V2 (um fragmento; o
[Quick Start (V2)](../../../sdks/typescript/README.md#quick-start-v2) do SDK TypeScript constrói e assina um bundle V2 completo):

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

## LangChain para Python

Se o seu stack de LangChain é Python em vez de Node, use a ponte integrada do SDK Python:

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

`DCPAgentWrapper` declara uma intenção e uma decisão de política para cada invocação, recusa um `block` e registra um
evento de auditoria; `DCPTool` permite que um agente verifique os bundles de outros agentes, e `DCPCallback` registra eventos de auditoria a partir de
callbacks do LangChain. Os registros não são assinados, a política padrão aprova todas as chamadas e um `escalate` ainda executa
o agente; `DCPCallback` precisa de um handler próprio com o LangChain 1.x, e o PyPI 2.10.1 verifica V1 e V2 com a política configurada (2.9.0 enviava todos os bundles para V1). Veja [integrations/langchain/README.md](../../../integrations/langchain/README.md) para esses
limites e a superfície completa; a ponte Python não é o exemplo TypeScript escrito à mão acima.

---

<a id="next-steps"></a>

## Próximos passos

- **[Início rápido principal](../../../docs/QUICKSTART.md)** — Uso básico do SDK
- **[Integração com CrewAI](../../../docs/QUICKSTART_CREWAI.md)** — Equipes multiagente (Python)
- **[Middleware Express](../../../docs/QUICKSTART_EXPRESS.md)** — Verifique bundles na sua API
- **[Referência da API](../../../docs/API_REFERENCE.md)** — Documentação completa do SDK
