<sub>[English](QUICKSTART_LANGCHAIN.md) · [中文](QUICKSTART_LANGCHAIN.zh-CN.md) · **Español** · [日本語](QUICKSTART_LANGCHAIN.ja.md) · [Português](QUICKSTART_LANGCHAIN.pt-BR.md)</sub>

<a id="dcp-ai--langchain-quick-start"></a>
<a id="dcp-ai-langchain-quick-start"></a>

# DCP-AI + LangChain: inicio rápido

> Traducción informativa de [la versión en inglés](QUICKSTART_LANGCHAIN.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Integra el Digital Citizenship Protocol en tus agentes de LangChain para añadir identidad criptográfica, control por política y rastros de auditoría.

---

<a id="installation"></a>

## Instalación

Esta guía usa **LangChain.js v1** (TypeScript/Node, Node.js 22 o posterior). Si usas **LangChain para Python**,
salta a la sección de Python al final.

La instalación desde el registro usa `@dcp-ai/sdk` 2.2.0. Los ejemplos DCP siguientes funcionan con ese SDK publicado; el checkout es opcional para desarrollar. Véase el [estado de publicación](../sdks/typescript/README.md#installation) del SDK TypeScript.

```bash
npm install @dcp-ai/sdk@^2.2.0 langchain @langchain/core @langchain/openai zod
```

<a id="zero-config-scaffold-alternative"></a>

### Scaffold sin configuración (alternativa)

```bash
npm create @dcp-ai/langchain my-app
cd my-app
npm install
```

Genera un `index.js` ejecutable que recorre el flujo DCP con una llamada de LangChain.js, con claves y firmas
de relleno (`«generated»`, `«sig»`): no genera claves, no firma nada y sus bundles no son evidencia
verificable (véase [templates/langchain](../templates/langchain/README.md)); los ejemplos de abajo usan claves y
firmas reales. El scaffold fija LangChain.js **0.3**
(`langchain` y `@langchain/openai` `^0.3.0`) y usa `ChatOpenAI` directamente; las API de agentes de esa línea
(`AgentExecutor`, `createOpenAIFunctionsAgent`) pasaron a `@langchain/classic` en LangChain.js v1; esta guía sigue la API de v1.

---

<a id="how-dcp-integrates-with-langchain"></a>

## Cómo se integra DCP con LangChain

DCP envuelve cada invocación de una herramienta de LangChain en un control por política y la sella como evidencia firmada:

1. **Antes de la ejecución:** declara una intención y obtén una decisión de política de tus propias reglas.
2. **Ejecución:** solo se ejecuta lo que la política aprobó.
3. **Después de la ejecución:** registra una entrada de auditoría (`intent_hash` y la cadena `prev_hash` se calculan por ti) y
   sella la llamada en un Citizenship Bundle firmado.

```
LangChain Agent
  └─ Tool call
       ├─ DCP: intent → your policy gate (approve / escalate / block)
       ├─ Tool execution (approved calls only)
       └─ DCP: audit entry → bundle signed by the operator
```

---

<a id="complete-working-example"></a>

## Ejemplo completo funcional

La parte DCP se ejecuta tal como está escrita con el SDK de TypeScript. La parte de LangChain sigue la API de agentes de LangChain.js v1
(`createAgent` y `tool` de `langchain`) y llama a la API de OpenAI, así que necesita `OPENAI_API_KEY`.

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

## Puntos de integración de DCP

| Concepto de LangChain | Correspondencia en DCP |
|-------------------|-------------|
| Identidad del agente | Agent Passport (vinculado a la persona mediante el RPR) |
| Invocación de herramienta | Declaración de intención → control por política |
| Resultado de la herramienta | Entrada de auditoría (encadenada por hash) |
| Sesión del agente | Citizenship Bundle (sellado al final) |
| Cadena de razonamiento | Rastro de auditoría con referencias a evidencias |

---

<a id="v2-post-quantum-upgrade"></a>

## Actualización poscuántica V2

Para seguridad poscuántica, usa la API de firma compuesta V2 (un fragmento; el
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) del SDK de TypeScript construye y firma un bundle V2 completo):

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

Si tu stack de LangChain es Python en lugar de Node, usa en su lugar el puente integrado del SDK de Python:

```bash
pip install "dcp-ai[langchain]>=2.10.0,<3"
```

```python
# Fragment, inside an async function: `agent` is your LangChain agent or runnable; `passport` and `rpr` are
# V2 payload dicts (the agent's passport and the principal's RPR).
from dcp_ai.langchain import DCPAgentWrapper

wrapped = DCPAgentWrapper(agent=agent, passport=passport, rpr=rpr)
result = await wrapped.invoke({"input": "search for X and summarise"})
events = wrapped.get_audit_trail()  # V2 audit events, hash-chained; seal them into a bundle to sign them
```

`DCPAgentWrapper` declara una intención y una decisión de política para cada invocación, rechaza un `block` y registra un
evento de auditoría; `DCPTool` permite a un agente verificar los bundles de otros agentes, y `DCPCallback` registra eventos de auditoría a partir de
callbacks de LangChain. Los registros no están firmados, la política por defecto aprueba todas las llamadas y un `escalate` sigue ejecutando
el agente; `DCPCallback` necesita un handler propio con LangChain 1.x, y PyPI 2.10.0 verifica V1 y V2 con la política configurada (2.9.0 enviaba todos los bundles a V1). Véase [integrations/langchain/README.md](../integrations/langchain/README.md) para estos
límites y la superficie completa; el puente de Python no es el ejemplo de TypeScript escrito a mano de arriba.

---

<a id="next-steps"></a>

## Siguientes pasos

- **[Inicio rápido principal](./QUICKSTART.md)** — Uso básico del SDK
- **[Integración con CrewAI](./QUICKSTART_CREWAI.md)** — Equipos multiagente (Python)
- **[Middleware de Express](./QUICKSTART_EXPRESS.md)** — Verifica bundles en tu API
- **[Referencia de la API](./API_REFERENCE.md)** — Documentación completa del SDK
