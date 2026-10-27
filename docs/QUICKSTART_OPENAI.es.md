<sub>[English](QUICKSTART_OPENAI.md) · [中文](QUICKSTART_OPENAI.zh-CN.md) · **Español** · [日本語](QUICKSTART_OPENAI.ja.md) · [Português](QUICKSTART_OPENAI.pt-BR.md)</sub>

<a id="dcp-ai--openai-quick-start"></a>
<a id="dcp-ai-openai-quick-start"></a>

# DCP-AI + OpenAI: inicio rápido

> Traducción informativa de [la versión en inglés](QUICKSTART_OPENAI.md), actualizada el 27/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Añade identidad criptográfica, control por política y rastros de auditoría a agentes de OpenAI con llamadas a funciones.

---

<a id="installation"></a>

## Instalación

Esta guía usa el **SDK de OpenAI para Node**. Si usas Python, salta a la sección de Python al final.

La instalación desde el registro usa `@dcp-ai/sdk` 2.2.0 para los ejemplos V1 y V2; el checkout es opcional (véase [instalación](../sdks/typescript/README.md#installation)). Los ejemplos usan la API Chat Completions del SDK Node de OpenAI (`openai` v4 o posterior; las versiones recientes añaden llamadas a herramientas personalizadas, que el bucle rechaza). Ejecutarlos llama a la API de OpenAI y requiere `OPENAI_API_KEY`.

```bash
npm install @dcp-ai/sdk@^2.2.0 openai
```

<a id="zero-config-scaffold-alternative"></a>

### Scaffold sin configuración (alternativa)

```bash
npm create @dcp-ai/openai my-app
cd my-app
npm install
```

Genera un `index.js` ejecutable que recorre el flujo DCP con un agente de OpenAI con llamadas a funciones (identidad,
intenciones, decisiones de política, entradas de auditoría) con claves y firmas de relleno (`«generated»`, `«sig»`): no
genera claves, no firma nada y sus bundles no son evidencia verificable (véase
[templates/openai](../templates/openai/README.md)). Los ejemplos de abajo usan claves y firmas reales.

---

<a id="how-dcp-integrates-with-openai"></a>

## Cómo se integra DCP con OpenAI

DCP envuelve las llamadas a funciones de OpenAI en un control por política y sella cada llamada como evidencia firmada: la llamada se declara como
una intención, tu política decide, solo se ejecuta una llamada aprobada y una entrada de auditoría la cierra.

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

## Ejemplo completo funcional

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

## Puntos de integración de DCP

| Concepto de OpenAI | Correspondencia en DCP |
|----------------|-------------|
| Identidad en el prompt de sistema | Agent Passport + RPR |
| Definición de función | Declaración de capacidades |
| Llamada a función | Declaración de intención → control por política |
| Resultado de la función | Entrada de auditoría (encadenada por hash) |
| Sesión de conversación | Citizenship Bundle |

---

<a id="structured-outputs-with-dcp"></a>

## Salidas estructuradas con DCP

Una intención declara los datos y el impacto de una llamada; tu control por política es lo que actúa sobre ellos:

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

`requires_consent: true` registra el requisito; DCP no pregunta a la persona por sí mismo. En el ejemplo anterior,
`evaluatePolicy` escala una intención así (no es de bajo impacto ni de datos `none`), de modo que la función no se ejecuta y el
bundle sellado registra `escalated` y `awaiting_human_approval` hasta que tu aplicación obtenga la aprobación de la persona.

---

<a id="v20-upgrade"></a>

## Actualización a V2.0

DCP v2.0 añade firmas compuestas poscuánticas, niveles de seguridad adaptativos y vinculación de sesión. Esta sección funciona con `@dcp-ai/sdk` 2.2.0 publicado (véase Instalación).

<a id="v2-identity"></a>

### Identidad V2

Construye el registro, las claves híbridas del principal y del agente, el nonce de sesión, el RPR y el pasaporte firmados
y las funciones auxiliares `signed()` y `sha256Of()` exactamente como en el
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) del SDK de TypeScript.

<a id="v2-sealing-of-a-function-call-with-security-tiers"></a>

### Sellado V2 de una llamada a función, con niveles de seguridad

Un fragmento que continúa el Quick Start (V2). `sealCallV2` no ejecuta la función: sella el registro de una
llamada, con valores sintéticos, en un bundle V2 cuya intención y decisión de política firma el agente, sellado por el
principal. Llámala con la decisión que tomó tu política; cuando la decisión es `approve`, el resultado que registra
(`<function>_completed`) solo es cierto si tu código ejecutó la función y vio que terminaba.

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

Un nivel más alto exige más al verificador: en `elevated` y `maximum` el modo de verificación es `hybrid_required`, así que
el bundle debe llevar ambas firmas (spec §14.3).

<a id="v2-dcp-integration-points-for-openai"></a>

### Puntos de integración de DCP V2 para OpenAI

| Concepto de OpenAI | Correspondencia en DCP V1 | Añadidos de DCP V2 |
|----------------|---------------|-----------------|
| Identidad en el prompt de sistema | Pasaporte + RPR | + claves híbridas (`binding_keys`, `keys`) y nonce de sesión |
| Definición de función | Capacidad | Sin cambios |
| Llamada a función | Intención → política | + `risk_score` entero (0–1000), nivel de seguridad, artefactos firmados |
| Resultado de la función | Entrada de auditoría | + hashes `sha256:`, cadena de doble hash opcional y checkpoints PQ |
| Sesión de conversación | Bundle | + manifiesto, firma compuesta del principal |

Véase [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) para actualizar integraciones V1 existentes con OpenAI.

---

<a id="python-equivalent"></a>

## Equivalente en Python

Si tu agente está escrito con el SDK de OpenAI para Python, usa el puente de Python (la versión publicada; desde una
copia del repositorio, `pip install -e "/path/to/dcp-ai/sdks/python[openai]"`):

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

`DCPOpenAIClient` declara una intención para cada llamada y registra un evento de auditoría V2. `DCP_TOOLS` son definiciones
de funciones para operaciones DCP que el modelo puede solicitar: `dcp_verify_bundle`, `dcp_declare_intent`,
`dcp_commission_agent`, `dcp_report_vitality`, `dcp_declare_rights` y `dcp_create_mandate`; tu código las
ejecuta. El puente de Python no es el ejemplo de TypeScript escrito a mano de arriba: conserva registros sin firmar, no evalúa políticas y registra `policy_decision: "approved"` para las llamadas sin tomar una decisión de autorización. Consulta el [README de la integración de Python](../integrations/openai/README.md) para conocer su alcance y las limitaciones del verificador publicado.

---

<a id="next-steps"></a>

## Siguientes pasos

- **[Inicio rápido principal](./QUICKSTART.md)** — Uso básico del SDK
- **[Integración con LangChain](./QUICKSTART_LANGCHAIN.md)** — LangChain.js y LangChain para Python
- **[Middleware de Express](./QUICKSTART_EXPRESS.md)** — Verifica bundles en tu API
- **[Referencia de la API](./API_REFERENCE.md)** — Documentación completa del SDK
