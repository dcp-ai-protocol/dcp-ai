# DCP-AI + OpenAI Quick Start

Add cryptographic identity, policy gating, and audit trails to OpenAI function-calling agents.

---

## Installation

This guide uses the **OpenAI Node SDK**. If you use Python instead, skip to the Python section at the bottom.

```bash
npm install @dcp-ai/sdk openai
```

### Zero-config scaffold (alternative)

```bash
npm create @dcp-ai/openai my-app
cd my-app
npm install
```

Produces a runnable `index.js` with DCP identity + an OpenAI function-calling agent + audited tool calls already wired up.

---

## How DCP Integrates with OpenAI

DCP wraps OpenAI function calls in a signed audit pipeline. Each function call is declared as an intent, gated by policy, and logged to the audit chain.

```
OpenAI Chat Completion
  └─ function_call
       ├─ DCP: declare intent
       ├─ DCP: policy gate (approve/escalate/block)
       ├─ execute function
       ├─ DCP: log audit entry
       └─ return result to model
```

---

## Complete Working Example

```typescript
import OpenAI from 'openai';
import {
  generateKeypair,
  signObject,
  BundleBuilder,
  signBundle,
  verifySignedBundle,
} from '@dcp-ai/sdk';

const openai = new OpenAI();

// 1. Initialize DCP identity
const keys = generateKeypair();
const agentId = 'openai-agent-001';
const humanId = 'operator-001';

const hbr = {
  dcp_version: '1.0',
  human_id: humanId,
  legal_name: 'AI Operator',
  entity_type: 'natural_person',
  jurisdiction: 'US-CA',
  liability_mode: 'owner_responsible',
  override_rights: true,
  public_key: keys.publicKeyB64,
  issued_at: new Date().toISOString(),
  expires_at: null,
  contact: null,
};

const passport = {
  dcp_version: '1.0',
  agent_id: agentId,
  human_id: humanId,
  public_key: keys.publicKeyB64,
  capabilities: ['api_call', 'browse'],
  risk_tier: 'low',
  created_at: new Date().toISOString(),
  status: 'active',
};

// 2. Define OpenAI tools
const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
        },
        required: ['location'],
      },
    },
  },
];

// 3. DCP audit state
const auditLog: Array<{ intent: any; policy: any; audit: any }> = [];
let prevHash = '0'.repeat(64);
let seq = 0;

// 4. DCP-wrapped function executor
async function executeFunctionCall(call: OpenAI.ChatCompletionMessageToolCall): Promise<string> {
  const intentId = `intent-${++seq}`;
  const args = JSON.parse(call.function.arguments);

  // Declare intent
  const intent = {
    dcp_version: '1.0',
    intent_id: intentId,
    agent_id: agentId,
    human_id: humanId,
    timestamp: new Date().toISOString(),
    action_type: 'api_call',
    target: { channel: 'api', domain: call.function.name },
    data_classes: ['none'],
    estimated_impact: 'low',
    requires_consent: false,
  };

  // Policy gate
  const policy = {
    dcp_version: '1.0',
    intent_id: intentId,
    decision: 'approve',
    risk_score: 10,
    reasons: ['Low-risk function call'],
    required_confirmation: null,
    applied_policy_hash: 'sha256:policy-v1',
    timestamp: new Date().toISOString(),
  };

  if (policy.decision !== 'approve') {
    return JSON.stringify({ error: `Blocked by DCP policy: ${policy.reasons.join(', ')}` });
  }

  // Execute the function
  let result: string;
  switch (call.function.name) {
    case 'get_weather':
      result = JSON.stringify({ temp: 72, condition: 'sunny', location: args.location });
      break;
    default:
      result = JSON.stringify({ error: 'Unknown function' });
  }

  // Log audit entry
  const audit = {
    dcp_version: '1.0',
    audit_id: `audit-${seq}`,
    prev_hash: prevHash,
    timestamp: new Date().toISOString(),
    agent_id: agentId,
    human_id: humanId,
    intent_id: intentId,
    intent_hash: signObject(intent, keys.secretKeyB64),
    policy_decision: 'approved',
    outcome: `${call.function.name}(${call.function.arguments}) → ${result.slice(0, 100)}`,
    evidence: { tool: call.function.name, result_ref: null },
  };

  prevHash = signObject(audit, keys.secretKeyB64);
  auditLog.push({ intent, policy, audit });

  return result;
}

// 5. Run the conversation loop
async function runAgent(userMessage: string) {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a helpful assistant with DCP-verified identity.' },
    { role: 'user', content: userMessage },
  ];

  while (true) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      tools,
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'stop') {
      console.log('Assistant:', choice.message.content);
      break;
    }

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      messages.push(choice.message);

      for (const call of choice.message.tool_calls) {
        const result = await executeFunctionCall(call);
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
    }
  }

  // 6. Seal the DCP bundle
  if (auditLog.length > 0) {
    const last = auditLog[auditLog.length - 1];
    const bundle = new BundleBuilder()
      .responsiblePrincipalRecord(hbr)
      .agentPassport(passport)
      .intent(last.intent)
      .policyDecision(last.policy)
      .addAuditEntry(last.audit)
      .build();

    const signed = signBundle(bundle, keys.secretKeyB64);
    const verification = verifySignedBundle(signed);
    console.log('DCP Bundle verified:', verification.verified);
    console.log('Audit entries:', auditLog.length);
  }
}

await runAgent("What's the weather in San Francisco?");
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

When using OpenAI structured outputs, DCP can validate the output schema against the declared intent:

```typescript
const intent = {
  // ...
  action_type: 'api_call',
  target: { channel: 'api', domain: 'structured-output' },
  data_classes: ['contact_info'], // DCP tracks data sensitivity
  estimated_impact: 'medium',
  requires_consent: true, // Triggers human confirmation
};
```

The `requires_consent: true` flag will escalate to the human principal before executing, providing an additional safety layer for sensitive operations.

---

## V2.0 Upgrade

DCP v2.0 adds post-quantum composite signatures, adaptive security tiers, and enhanced audit chains to OpenAI function-calling agents.

### Installation (V2)

```bash
npm install @dcp-ai/sdk@latest openai
npx @dcp-ai/cli init   # generates hybrid keypairs (Ed25519 + ML-DSA-65)
```

### V2 Identity Setup

```typescript
import {
  getDefaultRegistry,
  registerDefaultProviders,
  deriveKid,
  BundleBuilderV2,
  signBundleV2,
  verifySignedBundleV2,
  computeSecurityTier,
} from '@dcp-ai/sdk';

// V2: Hybrid keypair via algorithm registry (Ed25519 + ML-DSA-65)
const registry = getDefaultRegistry();
registerDefaultProviders(registry);

const ed25519 = registry.getSigner('ed25519');
const mlDsa65 = registry.getSigner('ml-dsa-65');

const classicalKp = await ed25519.generateKeyPair();
const pqKp = await mlDsa65.generateKeyPair();

const keys = {
  classicalKid: deriveKid('ed25519', classicalKp.publicKey),
  pqKid: deriveKid('ml-dsa-65', pqKp.publicKey),
  classicalPub: Buffer.from(classicalKp.publicKey).toString('base64'),
  pqPub: Buffer.from(pqKp.publicKey).toString('base64'),
  classicalSecret: classicalKp.secretKey,
  pqSecret: pqKp.secretKey,
};

const hbr = {
  dcp_version: '2.0',
  human_id: 'operator-001',
  legal_name: 'AI Operator',
  entity_type: 'natural_person',
  jurisdiction: 'US-CA',
  liability_mode: 'owner_responsible',
  override_rights: true,
  keys: [
    { kid: keys.classicalKid, alg: 'ed25519', public_key_b64: keys.classicalPub },
    { kid: keys.pqKid, alg: 'ml-dsa-65', public_key_b64: keys.pqPub },
  ],
  issued_at: new Date().toISOString(),
  revocation_token: keys.revocationToken,
};

const passport = {
  dcp_version: '2.0',
  agent_id: 'openai-agent-001',
  owner_rpr_hash: `sha256:${keys.hbrHash}`,
  keys: [
    { kid: keys.classicalKid, alg: 'ed25519', public_key_b64: keys.classicalPub },
    { kid: keys.pqKid, alg: 'ml-dsa-65', public_key_b64: keys.pqPub },
  ],
  capabilities: ['api_call', 'browse'],
  created_at: new Date().toISOString(),
  status: 'active',
};
```

### V2 Function Executor with Security Tiers

```typescript
async function executeFunctionCallV2(call: OpenAI.ChatCompletionMessageToolCall): Promise<string> {
  const intentId = `intent-${++seq}`;
  const args = JSON.parse(call.function.arguments);

  // V2: Intent with risk scoring
  const intent = {
    dcp_version: '2.0',
    intent_id: intentId,
    agent_id: agentId,
    timestamp: new Date().toISOString(),
    action_type: 'api_call',
    target: { channel: 'api', domain: call.function.name },
    data_classes: ['none'],
    risk_score: 50,
  };

  // V2: Automatic security tier computation
  const tier = computeSecurityTier(intent); // → 'standard'

  const policy = {
    dcp_version: '2.0',
    intent_id: intentId,
    decision: 'approve' as const,
    risk_score: intent.risk_score,
    resolved_tier: tier,
    timestamp: new Date().toISOString(),
  };

  // Execute the function
  let result: string;
  switch (call.function.name) {
    case 'get_weather':
      result = JSON.stringify({ temp: 72, condition: 'sunny', location: args.location });
      break;
    default:
      result = JSON.stringify({ error: 'Unknown function' });
  }

  // V2: Dual hash chain audit entry
  const audit = {
    dcp_version: '2.0',
    audit_id: `audit-${seq}`,
    prev_hash: prevHash,                     // SHA-256
    prev_hash_secondary: prevHashSecondary,  // SHA3-256
    agent_id: agentId,
    intent_id: intentId,
    outcome: `${call.function.name}(${call.function.arguments}) → ${result.slice(0, 100)}`,
    timestamp: new Date().toISOString(),
  };

  auditLog.push({ intent, policy, audit });
  return result;
}
```

### V2 Bundle Sealing with Composite Signatures

```typescript
// After conversation, seal with V2 composite signature
if (auditLog.length > 0) {
  const last = auditLog[auditLog.length - 1];
  const bundle = new BundleBuilderV2()
    .responsiblePrincipalRecord(hbr)
    .agentPassport(passport)
    .intent(last.intent)
    .policyDecision(last.policy)
    .addAuditEntries(auditLog.map(e => e.audit))
    .build(); // includes manifest with session_nonce

  const signed = signBundleV2(bundle, keys); // Ed25519 + ML-DSA-65 composite
  const verification = verifySignedBundleV2(signed);

  console.log('DCP V2 Bundle verified:', verification.verified);
  console.log('Security tier:', verification.resolvedTier);
  console.log('PQ signature:', verification.checks.pq_sig);
  console.log('Audit entries:', auditLog.length);
}
```

### V2 DCP Integration Points for OpenAI

| OpenAI Concept | DCP V1 Mapping | DCP V2 Additions |
|----------------|---------------|-----------------|
| System prompt identity | Passport + RPR | + hybrid keypairs, revocation token |
| Function definition | Capability | Unchanged |
| Function call | Intent → Policy | + risk_score, security tier |
| Function result | Audit entry | + dual hash chain, PQ checkpoints |
| Conversation session | Bundle | + manifest, session_nonce, composite sig |

### Structured Outputs with V2 Security Tiers

```typescript
// V2: High-risk intent triggers elevated tier automatically
const sensitiveIntent = {
  dcp_version: '2.0',
  action_type: 'api_call',
  data_classes: ['pii', 'financial'],  // sensitive data → elevated tier
  risk_score: 600,                      // → tier = 'elevated'
  requires_consent: true,
};

const tier = computeSecurityTier(sensitiveIntent); // → 'elevated'
// With elevated tier: hybrid_required verification, every-event PQ checkpoints
```

See [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for upgrading existing V1 OpenAI integrations.

---

## Python equivalent

If your agent is written with the OpenAI Python SDK, use the Python bridge:

```bash
pip install 'dcp-ai[openai]'
```

```python
from dcp_ai.openai import DCPOpenAIClient, DCP_TOOLS

client = DCPOpenAIClient(api_key=OPENAI_KEY, passport=my_passport)
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[...],
    tools=DCP_TOOLS,        # tool schema that the agent can call to declare intents / verify bundles
)
# response.audit_trail contains the signed hash-chained record
```

Same semantics as the TypeScript client above; the Python surface mirrors `DCP_TOOLS` and policy gating.

---

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[LangChain Integration](./QUICKSTART_LANGCHAIN.md)** — LangChain.js and LangChain Python
- **[Express Middleware](./QUICKSTART_EXPRESS.md)** — Verify bundles in your API
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
