# DCP-AI + LangChain Quick Start

Integrate the Digital Citizenship Protocol into your LangChain agents to add cryptographic identity, policy gating, and audit trails.

---

## Installation

This guide uses **LangChain.js v1** (TypeScript/Node, Node.js 22 or later). If you use **LangChain for Python**
instead, skip to the Python section at the bottom.

The registry install gives the published `@dcp-ai/sdk` (npm's `latest` was 2.1.1 on 25/10/2026); the DCP code below
works with it and with the SDK built from a checkout (see the TypeScript SDK's
[Release status](../sdks/typescript/README.md#installation)).

```bash
npm install @dcp-ai/sdk langchain @langchain/core @langchain/openai zod
```

### Zero-config scaffold (alternative)

```bash
npm create @dcp-ai/langchain my-app
cd my-app
npm install
```

Produces a runnable `index.js` that walks a LangChain.js call through the DCP flow with placeholder keys and
signatures (`«generated»`, `«sig»`): it generates no keys, signs nothing, and its bundles are not verifiable
evidence (see [templates/langchain](../templates/langchain/README.md)); the examples below use real keys and
signatures. The scaffold pins LangChain.js **0.3**
(`langchain` and `@langchain/openai` `^0.3.0`) and uses `ChatOpenAI` directly; the agent APIs of that line
(`AgentExecutor`, `createOpenAIFunctionsAgent`) moved to `@langchain/classic` in LangChain.js v1; this guide follows the v1 API.

---

## How DCP Integrates with LangChain

DCP wraps each LangChain tool invocation in a policy gate and seals it as signed evidence:

1. **Before execution:** declare an intent and get a policy decision from your own rules.
2. **Execution:** only what the policy approved runs.
3. **After execution:** record an audit entry (`intent_hash` and the `prev_hash` chain are computed for you) and
   seal the call into a signed Citizenship Bundle.

```
LangChain Agent
  └─ Tool call
       ├─ DCP: intent → your policy gate (approve / escalate / block)
       ├─ Tool execution (approved calls only)
       └─ DCP: audit entry → bundle signed by the operator
```

---

## Complete Working Example

The DCP part runs as written with the TypeScript SDK. The LangChain part follows the LangChain.js v1 agents API
(`createAgent` and `tool` from `langchain`) and calls the OpenAI API, so it needs `OPENAI_API_KEY`.

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

## DCP Integration Points

| LangChain Concept | DCP Mapping |
|-------------------|-------------|
| Agent identity | Agent Passport (bound to Human via RPR) |
| Tool invocation | Intent Declaration → Policy Gate |
| Tool result | Audit Entry (hash-chained) |
| Agent session | Citizenship Bundle (sealed at end) |
| Chain of thought | Audit trail with evidence references |

---

## V2 Post-Quantum Upgrade

For post-quantum security, use the V2 composite signature API (a fragment; the TypeScript SDK's
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) builds and signs a complete V2 bundle):

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

## LangChain for Python

If your LangChain stack is Python rather than Node, use the Python SDK's built-in bridge instead:

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

`DCPAgentWrapper` declares an intent and a policy decision for each invocation, refuses a `block`, and records an
audit event; `DCPTool` lets an agent verify other agents' bundles, and `DCPCallback` records audit events from
LangChain callbacks. The records are unsigned, the default policy approves every call, and an `escalate` still runs
the agent; `DCPCallback` needs a handler of your own with LangChain 1.x, and on PyPI's 2.9.0 `DCPTool` sends every
bundle to the V1 verifier. See [integrations/langchain/README.md](../integrations/langchain/README.md) for these
limits and the full surface; the Python bridge is not the hand-written TypeScript example above.

---

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[CrewAI Integration](./QUICKSTART_CREWAI.md)** — Multi-agent crews (Python)
- **[Express Middleware](./QUICKSTART_EXPRESS.md)** — Verify bundles in your API
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
