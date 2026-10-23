# @dcp-ai/openclaw — DCP Integration for OpenClaw

[OpenClaw](https://github.com/nicepkg/openclaw) plugin that adds **Digital Citizenship Protocol (DCP)** governance to AI agents. Every action the agent takes is declared, risk-scored, and recorded in a cryptographically chained audit trail bound to a human owner.

## Supported DCP Specifications

DCP-01 through DCP-09.

## Features

- **Identity (DCP-01)** — Ed25519 keypair generation, Responsible Principal Record, Agent Passport
- **Intent Declaration (DCP-02)** — Risk scoring and policy gating before sensitive actions
- **Audit Trail (DCP-03)** — Hash-chained, immutable action log with evidence references
- **Lifecycle (DCP-05)** — Commission, vitality reporting, decommission agents
- **Succession (DCP-06)** — Digital testament with successor preferences and memory classification
- **Delegation (DCP-09)** — Create delegation mandates for human→agent authority transfer
- **Bundle Verification** — V2 Signed Bundles are verified by the SDK's `verifySignedBundleV2` (signatures, hashes, session binding, audit chain, key validity) under the operator's verifier policy
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
| `dcp_identity_setup` | Generate keypair + RPR + AgentPassport | DCP-01 |
| `dcp_declare_intent` | Declare intent, get policy decision (approve/escalate/block) | DCP-02 |
| `dcp_verify_bundle` | Verify a Signed Bundle with the SDK verifier (signature + hashes + session binding) | VERIFICATION |
| `dcp_log_action` | Record action as AuditEntry with hash-chaining | DCP-03 |
| `dcp_get_audit_trail` | Retrieve session audit trail | DCP-03 |
| `dcp_commission_agent` | Commission an agent (lifecycle → commissioned) | DCP-05 |
| `dcp_report_vitality` | Report vitality metrics, get computed score | DCP-05 |
| `dcp_decommission_agent` | Decommission an agent (graceful/immediate/emergency) | DCP-05 |
| `dcp_create_testament` | Create digital testament with successor preferences | DCP-06 |
| `dcp_create_mandate` | Create human→agent delegation mandate | DCP-09 |
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
    │   ├── audit.ts           # dcp_log_action + dcp_get_audit_trail
    │   ├── lifecycle.ts       # dcp_commission_agent + dcp_report_vitality + dcp_decommission_agent
    │   ├── succession.ts      # dcp_create_testament
    │   └── delegation.ts      # dcp_create_mandate
    └── state/
        └── agent-state.ts     # Per-session DCP state management
```

## Bundle Verification

### Policy: set by the operator, tightened by the model

The verifier policy of `dcp_verify_bundle` is the operator's: the SDK's `DEFAULT_VERIFIER_POLICY` unless the host sets another one, with `register(api, { verifierPolicy })` or `configureVerifier({ verifierPolicy })` (fields over the default policy; a `default_mode` without `risk_overrides` applies to every risk tier; an unknown field or a wrong type throws).

```typescript
import register, { configureVerifier } from '@dcp-ai/openclaw';

configureVerifier({ verifierPolicy: { default_mode: 'hybrid_required', require_audience_binding: true, verifier_id: 'my-service' } });
```

The tool's `verifier_policy` parameter is set by the calling model, so it can only make that policy stricter: `default_mode` raises every risk tier to at least that mode (`classical_only` < `hybrid_preferred` < `hybrid_required` < `pq_only`), `require_session_binding` and `require_composite_binding` can only be turned on, and `allow_v1_bundles` can only be turned off. Any other field is an error.

### What is checked

- **V2**: the verification mode is the stricter of the policy mode for the passport's `risk_tier` (which must be `low`, `medium` or `high`) and the mode of the security tier computed from the intent and the policy decision (spec §14.2). The bundle then goes to `verifySignedBundleV2` from `@dcp-ai/sdk`, with an Ed25519 / ML-DSA-65 / SLH-DSA-192f registry and that mode: payload hashes and manifest, session binding and expiry, the bundle's composite signature over the manifest against the passport or RPR keys, audit hash chain and key validity.
- **V1** (one Ed25519 signature): verified with `verifySignedBundle` only where VERIFICATION.md V2-10 would accept a classical-only bundle: `allow_v1_bundles` is true and the stricter of the policy mode for the V1 passport's `risk_tier` and the mode of the security tier of the V1 intent and policy decision (V1 `risk_score` is 0 to 1, scaled by 1000; a missing one counts as `elevated`) is `classical_only` or `hybrid_preferred`. Under the default policy a routine or standard V1 intent passes; a payment, sensitive data, a high estimated impact or a risk score of 0.5 or more is refused.
- A bundle whose version cannot be detected is rejected.

The result carries the verifier's `errors` and `warnings`, `resolved_tier` (the security tier) and, for V2, `verification_mode`. `agent_id`, `human_id` and `session_nonce` are only returned for a verified bundle.

### What "verified" means, and what `@dcp-ai/sdk` 2.1.x leaves out

A verified bundle is internally consistent and signed by the keys it lists itself (the passport keys and the RPR binding keys). It does not prove who the principal is: anyone can create keys and an RPR naming any `human_id`. That needs the verifier to pin the principal's trusted keys, and this plugin has no such option yet. A verified bundle can also be replayed until its session expires; the operator policy's `require_audience_binding` with a `verifier_id` (the bundle's `manifest.intended_verifier` must name it) and `require_session_expiry` / `max_session_duration_seconds` limit that.

The published `@dcp-ai/sdk` 2.1.x verifier skips several checks of `spec/VERIFICATION.md`; the plugin does them itself: the verification mode from the risk tier and the security tier (V2-9, V2-10), the Merkle root of an empty audit trail (V2-3), `session_expires_at` as an RFC 3339 timestamp (V2-4), the status and `expires_at` of the passport keys and RPR binding keys (V2-13), and a PQ signature that is present but invalid (V2-7). One gap remains until the package depends on an SDK release that closes it: **the per-artifact signatures of the RPR, passport, intent and policy decision are not verified** (V2-8; 8 of the 65 must-reject bundles in `tests/interop/v2/bundle_vectors.json`, marked as expected failures in the tests). The bundle signature still covers every artifact through the manifest hashes. PQ checkpoint signatures are not verified either.

## Concept Mapping: OpenClaw → DCP

| OpenClaw Concept | DCP Equivalent |
|---|---|
| Owner (human) | `ResponsiblePrincipalRecord` |
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

Apache-2.0
