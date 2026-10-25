# @dcp-ai/openclaw — DCP Integration for OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) plugin that adds **Digital Citizenship Protocol (DCP)** tools to AI agents. An action is declared, risk-scored and
recorded in a hash-chained audit trail bound to a human owner when the agent calls these tools: the plugin does not
intercept the agent's other tools. To gate every sensitive action, the host must intercept those tool calls itself
and call `dcp_declare_intent` / `dcp_log_action` around them. Session state lives in an in-memory `Map` and is lost
when the process restarts.

## Supported DCP Specifications

DCP-01 through DCP-09, partially: the tools below create records in the shapes of these specifications, and
`dcp_verify_bundle` verifies bundles. It does not implement them in full.

## Features

- **Identity (DCP-01)** — Ed25519 keypair generation, Responsible Principal Record, Agent Passport
- **Intent Declaration (DCP-02)** — Risk scoring and a policy decision before sensitive actions, which the host enforces
- **Audit Trail (DCP-03)** — Hash-chained action log with evidence references: tamper-evident (an altered entry breaks the chain), not immutable, and kept in memory
- **Lifecycle (DCP-05)** — Commission, vitality reporting, decommission agents
- **Succession (DCP-06)** — Digital testament with successor preferences and memory classification
- **Delegation (DCP-09)** — Create delegation mandates for human→agent authority transfer
- **Bundle Verification** — V2 Signed Bundles are verified by the SDK's `verifySignedBundleV2` (signatures, hashes, session binding, audit chain, key validity) under the operator's verifier policy
- **Bundle Signing** — Build and sign a CitizenshipBundle at session end: one intent and its policy decision, with the session's audit entries (see the note under [Risk Scoring](#risk-scoring))
- **DCP-05 to DCP-09 records** — Commissioning, vitality, decommissioning, testament and mandate records are kept in the session state; `dcp_sign_bundle` does not add them to the bundle and the plugin sends them nowhere
- **SKILL.md** — Companion skill that teaches the agent how to use DCP tools

## Installation

> **Release status (25/10/2026).** npm has `@dcp-ai/openclaw` 2.0.0 only; this README follows the source on `main` (version 2.1.0, not published). The published 2.0.0 **does not verify the signatures of V2 bundles** in `dcp_verify_bundle`: it checks their structure only, so a forged or altered V2 bundle passes (fixed on `main`, see the `[Unreleased]` section of [CHANGELOG.md](../../CHANGELOG.md)). Do not rely on 2.0.0 for V2 bundles; the operator policy, trusted principals and the source supervisor are not in it either. Until `@dcp-ai/sdk` 2.2.0 is on npm, this package depends on the workspace SDK (`"@dcp-ai/sdk": "file:../../sdks/typescript"`); publishing it needs the dependency raised to `^2.2.0`, and the publish workflow refuses a package that depends on a local path.

To use the version this page describes, build it from a checkout and install it from there:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build       # the SDK of main
cd ../../integrations/openclaw && npm install && npm run build  # this package
# then, in your OpenClaw plugins directory:
npm install /path/to/dcp-ai/integrations/openclaw
```

The published version (2.0.0), without those fixes and features:

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

The tool's `verifier_policy` parameter is set by the calling model, so it can only make that policy stricter: `default_mode` raises every risk tier to at least that mode (`classical_only` < `hybrid_preferred` < `hybrid_required`; `pq_only` combined with any other mode gives `hybrid_required`, because `pq_only` drops the classical signature the other modes require), `require_session_binding` and `require_composite_binding` can only be turned on, and `allow_v1_bundles` can only be turned off. Any other field is an error.

### What is checked

- **V2**: `verifySignedBundleV2` from `@dcp-ai/sdk`, with an Ed25519 / ML-DSA-65 / SLH-DSA-192f registry and the policy above. It checks the artifact payload hashes and the manifest; session binding, expiry and the signed session start (`session_issued_at`); the bundle signature over the manifest, made by the principal with the RPR `binding_keys`, and the unsigned `signature` block that must agree with it; each artifact's own signature; the verification mode, the stricter of the policy mode for the passport's `risk_tier` and the mode of the security tier of the intent and policy decision (spec §14.2); PQ checkpoints; cross-artifact consistency (passport status, RPR expiry, one agent, principal and intent across the artifacts and audit entries); the audit hash chain (SHA-256: the secondary SHA3-256 chain or root of V2-11 is not recomputed); and key validity, kid derivation and canonical base64 keys (`spec/VERIFICATION.md` V2-1 to V2-14).
- **V1** (one Ed25519 signature): verified with `verifySignedBundle` only where VERIFICATION.md V2-10 would accept a classical-only bundle: `allow_v1_bundles` is true and the stricter of the policy mode for the V1 passport's `risk_tier` and the mode of the security tier of the V1 intent and policy decision (V1 `risk_score` is 0 to 1, scaled by 1000; a missing one counts as `elevated`) is `classical_only` or `hybrid_preferred`. Under the default policy a routine or standard V1 intent passes; a payment, sensitive data, a high estimated impact or a risk score of 0.5 or more is refused.
- A bundle whose version cannot be detected is rejected.

Only `allow_v1_bundles`, the mode and the tier apply to a V1 bundle: audience binding, session expiry and duration
limits, an `accepted_classical_algs` without Ed25519 and advisories that reject Ed25519 are V2 checks, and a V1 bundle
that passes the mode check is accepted even when they are set. If you need those controls, set
`allow_v1_bundles: false`, or use trusted principals with the strict-v1 profile.

The result carries the verifier's `errors` and `warnings`, `resolved_tier` (the security tier) and, for V2, `verification_mode`. `agent_id`, `human_id` and `session_nonce` are only returned for a verified bundle.

### What "verified" means

A verified bundle is internally consistent and signed by the keys it lists itself: the RPR `binding_keys` for the bundle signature, the passport keys for the agent's artifacts. It does not prove who the principal is: anyone can create keys and an RPR naming any `human_id`. For that, configure trusted principals (next section). A verified bundle can also be replayed until its session expires; the operator policy's `require_audience_binding` with a `verifier_id` (the bundle's `manifest.intended_verifier` must name it) and `require_session_expiry` / `max_session_duration_seconds` limit that, without making it single-use.

### Trusted principals and strict-v1

```typescript
import { configureVerifier, denyListRevocationSource } from '@dcp-ai/openclaw';

configureVerifier({
  trustedPrincipals: trustSet,                     // or () => trust set, read on every call
  profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
});
```

With `trustedPrincipals`, the result adds `admitted`, `principal_trust`, `profile`, `profile_compliance`, `codes`, `recorded_decision`, `trust_set_version` and `action_authorized` (always `false`), and names the agent and principal only for an admitted bundle (`docs/ADMISSION.md`, `spec/profiles/admission`). `verified` keeps its meaning, the verifier's verdict. Under the profile the model's `verifier_policy` parameter is refused, even a stricter one, and parameters the tool does not define (a trust set, an audience, a revocation snapshot) are ignored. `configureVerifier` throws `AdmissionConfigError` on a contradiction (a profile with `verifierPolicy`, or without trusted principals or a revocation source) and keeps the previous configuration. A `trustedPrincipals` function that throws, or returns `undefined`, `null` or an invalid trust set, gives `admitted: false` with the reason in `errors`; the tool does not throw. Runnable: `examples/strict-v1.mjs`.

The tests run every case of `tests/interop/v2/bundle_vectors.json`, each under the operator policy with its `verifier_policy_overrides`.

### Supervising the trust source

```typescript
import { configureVerifier, createSourceSupervisor } from '@dcp-ai/openclaw';

const supervisor = createSourceSupervisor({ maxInFlight: 16 });
configureVerifier({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
});
```

**Deadline, capacity and scope.**

- The function gets `{ tenant, signal }`. A trust set that arrives after `trustTimeoutMs` (an integer from 1 to 2147483647), measured on a monotonic clock when it arrives, is not used. The call then gives the same `admitted: false` as a failing source (`The trusted principals are unavailable (TRUST_SOURCE_FAILED)`).
- At most `maxInFlight` calls run at once, with no queue. **A slot is freed only when the function really settles**: a source that never settles keeps its slot until the process restarts.
- The capacity is per supervisor object, and a supervisor created by `@dcp-ai/express`, ESM or CJS, can be shared.
- A Node process with nothing else pending stays alive until the deadline answers.
- With the strict-v1 profile, `supervise: { revocation: true }` runs the `revocationSource` under the same supervisor, with `revocationTimeoutMs` as its deadline (then an integer from 1 to 2147483647). `supervise` takes `trustTimeoutMs`, `revocation: true` or both, and `revocation: true` works with a static trust set.
  - The source gets `(subjects, { tenant, signal })`, and each answer gives the result it gives without supervision.
  - `null`, a failure, a timeout, no free slot and a closed supervisor give `admitted: false` with `codes: ["REVOCATION_UNAVAILABLE"]`. `REVOCATION_INVALID` counts only before the deadline.
  - Trust and revocation calls share the supervisor's slots.
  - `denyListRevocationSource` also aborts its fetch when the supervisor's `signal` aborts.
  - Without it, revocation keeps `revocationTimeoutMs` as before.

**Reconfiguring.**

- `configureVerifier` may keep the same supervisor with a new trust set, profile, deadline or choice of sources: its counters stay, and a call keeps the deadline it started with.
- It throws `AdmissionConfigError` (`CONFIG_PROFILE_CONTRADICTION`), keeping the previous configuration, when it would replace or remove a supervisor that still has calls in flight, whichever source it supervises. A call counts from the moment `executeVerifyBundle` starts, so also while it still verifies the bundle and has not called its source yet, and its slot counts until its source settles. That holds even after `supervisor.close({ drainMs })` returned with calls still in flight: closing refuses new calls but frees no slot. Replace it once `supervisor.stats().inFlight` is 0, or restart the process.
- The model's parameters cannot set any of this.

**Cancellation.**

- Supervisors from this version also offer a cancellation capability, used by `@dcp-ai/express`'s `cancelOnDisconnect`.
- `dcp_verify_bundle` has no such option: its host gives no signal of a caller that left, and `configureVerifier({ cancelOnDisconnect })` throws as an unknown option.
- `stats().cancelled` is optional in the type, for supervisors of older packages: read it as `?? 0`.

**What it does not do.** The same limits as in `@dcp-ai/express`:

- it does not stop a function's work, bound the work it starts on its own, or isolate the CPU of an observer or a source;
- `onSourceEvent` must be fast; one call at a time, the rest dropped and counted. A promise or thenable it returns is assimilated as `Promise.resolve` does, so a thenable resolved with a pending promise keeps it busy. Promises a thenable starts and does not return are out of reach.
- Counters stop at `Number.MAX_SAFE_INTEGER`.

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

- **approve** (risk < 500) — proceed normally
- **escalate** (500 ≤ risk < 800) — ask human for confirmation
- **block** (risk ≥ 800) — action denied, requires explicit override

The score is an integer in millirisk, from 0 to 1000 (`risk: 650/1000` in the tool's answer). The decision is advice to the agent: nothing in the plugin stops an action that was escalated or
blocked, or one that was never declared.

`dcp_sign_bundle` takes one intent (its `intent_id`, or the most recent one) and **all** the session's audit
entries. The verifier requires every audit entry to carry the bundle's `intent_id`, so a session that logged actions
under more than one intent produces a bundle that `verifySignedBundleV2` refuses; the tool does not split one bundle
per intent.

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
