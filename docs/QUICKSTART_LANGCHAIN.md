# DCP-AI + LangChain Quick Start

Integrate the Digital Citizenship Protocol into your LangChain agents to add cryptographic identity, policy gating, and audit trails.

---

## Installation

This guide uses **LangChain.js** (TypeScript/Node). If you use **LangChain for Python** instead, skip to the Python section at the bottom.

```bash
npm install @dcp-ai/sdk langchain @langchain/core @langchain/openai
```

### Zero-config scaffold (alternative)

```bash
npm create @dcp-ai/langchain my-app
cd my-app
npm install
```

Produces a runnable `index.js` with DCP identity + a LangChain agent + audited tool calls already wired up.

---

## How DCP Integrates with LangChain

DCP wraps each LangChain tool invocation in a signed audit pipeline:

1. **Before execution** — Declare an intent and get a policy decision
2. **After execution** — Log an audit entry with the outcome
3. **At session end** — Seal everything into a signed Citizenship Bundle

```
LangChain Agent
  └─ Tool call
       ├─ DCP: declareIntent() → policy gate (approve/escalate/block)
       ├─ Tool execution
       ├─ DCP: logAudit() → hash-chained audit entry
       └─ DCP: signBundle() → sealed proof
```

---

## Complete Working Example

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';
import { DynamicTool } from '@langchain/core/tools';
import {
  generateKeypair,
  signObject,
  BundleBuilder,
  signBundle,
  verifySignedBundle,
} from '@dcp-ai/sdk';

// 1. Initialize DCP identity
const keys = generateKeypair();
const agentId = `agent-${crypto.randomUUID().slice(0, 8)}`;
const humanId = 'human-operator-001';

const hbr = {
  dcp_version: '1.0',
  human_id: humanId,
  legal_name: 'Operator',
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
  capabilities: ['browse', 'api_call'],
  risk_tier: 'low',
  created_at: new Date().toISOString(),
  status: 'active',
};

// 2. Create a DCP-aware tool
const auditLog: any[] = [];
let auditSeq = 0;
let prevHash = '0'.repeat(64);

function dcpWrappedTool(name: string, description: string, fn: (input: string) => Promise<string>) {
  return new DynamicTool({
    name,
    description,
    func: async (input: string) => {
      const intentId = `intent-${Date.now()}`;

      // Declare intent
      const intent = {
        dcp_version: '1.0',
        intent_id: intentId,
        agent_id: agentId,
        human_id: humanId,
        timestamp: new Date().toISOString(),
        action_type: 'api_call',
        target: { channel: 'api', domain: name },
        data_classes: ['none'],
        estimated_impact: 'low',
        requires_consent: false,
      };

      // Policy check
      const policy = {
        dcp_version: '1.0',
        intent_id: intentId,
        decision: 'approve',
        risk_score: 10,
        reasons: ['Low risk tool invocation'],
        required_confirmation: null,
        applied_policy_hash: 'sha256:policy-v1',
        timestamp: new Date().toISOString(),
      };

      if (policy.decision !== 'approve') {
        return `Action blocked by DCP policy: ${policy.reasons.join(', ')}`;
      }

      // Execute
      const result = await fn(input);

      // Audit
      const audit = {
        dcp_version: '1.0',
        audit_id: `audit-${++auditSeq}`,
        prev_hash: prevHash,
        timestamp: new Date().toISOString(),
        agent_id: agentId,
        human_id: humanId,
        intent_id: intentId,
        intent_hash: signObject(intent, keys.secretKeyB64),
        policy_decision: 'approved',
        outcome: `${name}: ${result.slice(0, 100)}`,
        evidence: { tool: name, result_ref: null },
      };

      prevHash = signObject(audit, keys.secretKeyB64);
      auditLog.push({ intent, policy, audit });

      return result;
    },
  });
}

// 3. Define tools
const tools = [
  dcpWrappedTool('search', 'Search the web', async (query) => {
    return `Results for: ${query}`;
  }),
  dcpWrappedTool('calculator', 'Do math', async (expr) => {
    return String(eval(expr));
  }),
];

// 4. Create agent
const model = new ChatOpenAI({ modelName: 'gpt-4' });
const agent = await createOpenAIFunctionsAgent({ llm: model, tools, prompt });
const executor = new AgentExecutor({ agent, tools });

// 5. Run agent
const response = await executor.invoke({ input: 'What is 42 * 17?' });

// 6. Seal the DCP bundle
const lastEntry = auditLog[auditLog.length - 1];
const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(hbr)
  .agentPassport(passport)
  .intent(lastEntry.intent)
  .policyDecision(lastEntry.policy)
  .addAuditEntry(lastEntry.audit)
  .build();

const signed = signBundle(bundle, keys.secretKeyB64);
const verification = verifySignedBundle(signed);
console.log('Bundle verified:', verification.verified);
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

For post-quantum security, use the V2 composite signature API:

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
from dcp_ai.langchain import DCPAgentWrapper, DCPTool, DCPCallback

# Wrap any LangChain agent so every tool invocation is DCP-gated and audited
wrapped = DCPAgentWrapper(agent, passport=my_passport)
result = wrapped.run("search for X and summarise")
# result.audit_trail contains the signed hash-chained record
```

The API mirrors the TypeScript version above. Module-level docstrings in `dcp_ai.langchain` document the full surface.

---

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[CrewAI Integration](./QUICKSTART_CREWAI.md)** — Multi-agent crews (Python)
- **[Express Middleware](./QUICKSTART_EXPRESS.md)** — Verify bundles in your API
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
