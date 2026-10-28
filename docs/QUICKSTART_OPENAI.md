# DCP-AI + OpenAI Quick Start

Add cryptographic identity, policy gating, and audit trails to OpenAI function-calling agents.

---

## Installation

This guide uses the **OpenAI Node SDK**. If you use Python instead, skip to the Python section at the bottom.

The registry install uses `@dcp-ai/sdk` 2.2.1 for both V1 and V2 examples; a source checkout is optional (see [installation](../sdks/typescript/README.md#installation)). The examples use the Chat Completions API of the OpenAI Node SDK (`openai` v4 or later; recent versions add custom tool calls, which the loop refuses). Running them calls the OpenAI API and needs `OPENAI_API_KEY`.

```bash
npm install @dcp-ai/sdk@^2.2.1 openai
```

### Zero-config scaffold (alternative)

```bash
npm create @dcp-ai/openai my-app
cd my-app
npm install
```

Produces a runnable `index.js` that walks an OpenAI function-calling agent through the DCP flow (identity,
intents, policy decisions, audit entries) with placeholder keys and signatures (`«generated»`, `«sig»`): it
generates no keys, signs nothing, and its bundles are not verifiable evidence (see
[templates/openai](../templates/openai/README.md)). The examples below use real keys and signatures.

---

## How DCP Integrates with OpenAI

DCP wraps OpenAI function calls in a policy gate and seals each call as signed evidence: the call is declared as
an intent, your policy decides, only an approved call runs, and an audit entry closes it.

```
OpenAI Chat Completion
  └─ tool call
       ├─ DCP: intent → your policy gate (approve / escalate / block)
       ├─ execute the function (approved calls only)
       ├─ DCP: audit entry → bundle signed by the operator
       └─ return the result to the model
```

---

## Complete Working Example

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

## DCP Integration Points

| OpenAI Concept | DCP Mapping |
|----------------|-------------|
| System prompt identity | Agent Passport + RPR |
| Function definition | Capability declaration |
| Function call | Intent Declaration → Policy Gate |
| Function result | Audit Entry (hash-chained) |
| Conversation session | Citizenship Bundle |

---

## Structured Outputs with DCP

An intent declares the data and impact of a call; your policy gate is what acts on them:

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

`requires_consent: true` records the requirement; DCP does not ask the human by itself. In the example above,
`evaluatePolicy` escalates such an intent (not low-impact, not `none` data), so the function does not run and the
sealed bundle records `escalated` and `awaiting_human_approval` until your application gets the human's approval.

---

## V2.0 Upgrade

DCP v2.0 adds post-quantum composite signatures, adaptive security tiers and session binding. This section works with published `@dcp-ai/sdk` 2.2.1 (see Installation).

### V2 identity

Build the registry, the hybrid keys of the principal and the agent, the session nonce, the signed RPR and passport
and the `signed()` and `sha256Of()` helpers exactly as in the TypeScript SDK's
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2).

### V2 sealing of a function call, with security tiers

A fragment that continues the Quick Start (V2). `sealCallV2` does not run the function: it seals the record of one
call, with synthetic values, into a V2 bundle whose intent and policy decision the agent signs, sealed by the
principal. Call it with the decision your policy made; when the decision is `approve`, the outcome it records
(`<function>_completed`) is only true if your code ran the function and saw it finish.

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

A higher tier asks more of the verifier: at `elevated` and `maximum` the verification mode is `hybrid_required`, so
the bundle must carry both signatures (spec §14.3).

### V2 DCP integration points for OpenAI

| OpenAI Concept | DCP V1 Mapping | DCP V2 Additions |
|----------------|---------------|-----------------|
| System prompt identity | Passport + RPR | + hybrid keys (`binding_keys`, `keys`) and session nonce |
| Function definition | Capability | Unchanged |
| Function call | Intent → Policy | + integer `risk_score` (0–1000), security tier, signed artifacts |
| Function result | Audit entry | + `sha256:` hashes, optional dual hash chain and PQ checkpoints |
| Conversation session | Bundle | + manifest, composite signature by the principal |

See [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for upgrading existing V1 OpenAI integrations.

---

## Python equivalent

If your agent is written with the OpenAI Python SDK, use the Python bridge (the published version; from a
checkout, `pip install -e "/path/to/dcp-ai/sdks/python[openai]"`):

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

`DCPOpenAIClient` declares an intent for each call and records a V2 audit event. `DCP_TOOLS` are function
definitions for DCP operations the model may request: `dcp_verify_bundle`, `dcp_declare_intent`,
`dcp_commission_agent`, `dcp_report_vitality`, `dcp_declare_rights` and `dcp_create_mandate`; your code executes
them. The Python bridge is not the hand-written TypeScript example above: it keeps unsigned records, evaluates no policy, and records `policy_decision: "approved"` for calls without making an authorization decision. See the [Python integration README](../integrations/openai/README.md) for its scope and the published verifier limitations.

---

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[LangChain Integration](./QUICKSTART_LANGCHAIN.md)** — LangChain.js and LangChain Python
- **[Express Middleware](./QUICKSTART_EXPRESS.md)** — Verify bundles in your API
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
