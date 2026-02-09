# @dcp-ai/openclaw — DCP Integration for OpenClaw

[OpenClaw](https://github.com/nicepkg/openclaw) plugin that adds **Digital Citizenship Protocol (DCP)** governance to AI agents. Every action the agent takes is declared, risk-scored, and recorded in a cryptographically chained audit trail bound to a human owner.

## Features

- **Identity (DCP-01)** — Ed25519 keypair generation, Human Binding Record, Agent Passport
- **Intent Declaration (DCP-02)** — Risk scoring and policy gating before sensitive actions
- **Audit Trail (DCP-03)** — Hash-chained, immutable action log with evidence references
- **Bundle Verification** — Full schema + signature + hash verification of Signed Bundles
- **Bundle Signing** — Build and sign a complete CitizenshipBundle at session end
- **SKILL.md** — Companion skill that teaches the agent how to use DCP tools

## Installation

```bash
# In your OpenClaw plugins directory
npm install @dcp-ai/openclaw
```

Add to your OpenClaw config:

```yaml
plugins:
  - "@dcp-ai/openclaw"
```

## Tools Registered

| Tool | Description | DCP Spec |
|------|-------------|----------|
| `dcp_identity_setup` | Generate keypair + HBR + AgentPassport | DCP-01 |
| `dcp_declare_intent` | Declare intent, get policy decision (approve/escalate/block) | DCP-02 |
| `dcp_verify_bundle` | Verify a Signed Bundle (schema + signature + hashes) | VERIFICATION |
| `dcp_log_action` | Record action as AuditEntry with hash-chaining | DCP-03 |
| `dcp_get_audit_trail` | Retrieve session audit trail | DCP-03 |
| `dcp_sign_bundle` | Build + sign CitizenshipBundle from session state | BUNDLE |

## Usage Flow

```
┌─────────────────────────────────────────────────────┐
│                  Session Start                       │
│  dcp_identity_setup(owner, jurisdiction, caps)       │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼─────────────┐
          │   For each sensitive      │
          │   action:                 │
          │                           │
          │  1. dcp_declare_intent()  │
          │     → approve/escalate/   │
          │       block               │
          │                           │
          │  2. [perform action]      │
          │                           │
          │  3. dcp_log_action()      │
          └────────────┬─────────────┘
                       │ (repeat)
          ┌────────────▼─────────────┐
          │     Session End           │
          │  dcp_sign_bundle()        │
          │  → SignedBundle           │
          └───────────────────────────┘
```

## Architecture

```
integrations/openclaw/
├── package.json               # Dependencies: @dcp-ai/sdk, @sinclair/typebox
├── tsconfig.json
├── SKILL.md                   # Companion skill with agent instructions
├── README.md                  # This file
└── src/
    ├── index.ts               # Plugin entry — registerTool() calls
    ├── tools/
    │   ├── identity.ts        # dcp_identity_setup
    │   ├── intent.ts          # dcp_declare_intent
    │   ├── verify.ts          # dcp_verify_bundle
    │   └── audit.ts           # dcp_log_action + dcp_get_audit_trail
    └── state/
        └── agent-state.ts     # Per-session DCP state management
```

## Concept Mapping: OpenClaw → DCP

| OpenClaw Concept | DCP Equivalent |
|---|---|
| Owner (human) | `HumanBindingRecord` |
| Agent session | `AgentPassport` (capabilities mapped from allowed tools) |
| Tool call | `Intent` (action_type derived from tool name) |
| Tool allowlist/denylist | `PolicyDecision` |
| DM pairing | `HumanConfirmation` |
| Agent actions | `AuditEntry` with hash-chaining |

## OpenClaw Tool → DCP Action Type Mapping

| OpenClaw Tool | DCP `action_type` | DCP `channel` |
|---|---|---|
| `browser.*` | `browse` | `web` |
| `exec`, `bash` | `execute_code` | `runtime` |
| `web.fetch`, `web.search` | `api_call` | `api` |
| `write`, `edit`, `apply_patch` | `write_file` | `filesystem` |
| `sessions_send` | `api_call` | `api` |
| `cron`, `webhook` | `api_call` | `api` |

## Risk Scoring

The intent declaration tool computes a risk score based on:

- **Action type** — payments and code execution score higher than browsing
- **Estimated impact** — low / medium / high
- **Data classes** — PII, credentials, financial data increase the score

Policy decisions:
- **approve** (risk < 0.5) — proceed normally
- **escalate** (0.5 ≤ risk < 0.8) — ask human for confirmation
- **block** (risk ≥ 0.8) — action denied, requires explicit override

## Programmatic Usage

The tools can also be used directly without the OpenClaw plugin system:

```typescript
import {
  executeIdentitySetup,
  executeDeclareIntent,
  executeLogAction,
  executeGetAuditTrail,
} from '@dcp-ai/openclaw';

// Set up identity
const identity = await executeIdentitySetup({
  session_id: 'my-session',
  owner_name: 'Alice',
  jurisdiction: 'US',
});

// Declare intent
const intent = await executeDeclareIntent({
  session_id: 'my-session',
  action_type: 'api_call',
  target_channel: 'api',
  estimated_impact: 'low',
});

// Log action
await executeLogAction({
  session_id: 'my-session',
  intent_id: intent.intent_id,
  outcome: 'API call succeeded',
  evidence_tool: 'web.fetch',
});

// Get audit trail
const trail = await executeGetAuditTrail({ session_id: 'my-session' });
console.log(trail.entries);
```

## Dependencies

- [`@dcp-ai/sdk`](../../sdks/typescript/README.md) — DCP TypeScript SDK (types, crypto, builder, signer, verifier)
- [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) — JSON Schema type builder (used by OpenClaw for tool parameters)

## License

MIT
