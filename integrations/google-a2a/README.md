# DCP-AI ↔ A2A (Agent-to-Agent) Protocol Bridge

Carries the signed DCP Agent Passport inside the A2A Agent Card, so an A2A consumer can verify
the passport's hash and self-signature offline before delegating a task. The passport names a
responsible principal; this bridge does not verify that principal's RPR or establish admission.
It also maps A2A tasks onto DCP intents and audit entries.

## Installation

> **Release status (25/10/2026).** npm has `@dcp-ai/google-a2a` 2.0.0, without the passport in the Agent Card (`attachPassportToAgentCard`, `agentCardPassport`, `verifyAgentCardPassport`): those are in the source on `main` (version 2.1.0, not published). The source package's `@dcp-ai/sdk` dependency is `^2.0.0`; an ordinary npm install resolves it to 2.1.1. Therefore, building this checkout without the local-SDK override below would use the older cryptographic providers. `verifyAgentCardPassport` uses the SDK's composite-signature helpers, not its full `verifySignedBundleV2` verifier.

From a checkout (this page's version, on the SDK of `main`):

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build
cd ../../integrations/google-a2a && npm install
npm install --no-save --package-lock=false --ignore-scripts --install-links ../../sdks/typescript
npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/google-a2a
```

The published version (2.0.0):

```bash
npm install @dcp-ai/google-a2a
```

## The passport inside the Agent Card

A2A lets an Agent Card declare extensions in `capabilities.extensions` (`AgentExtension`: `uri`,
`description`, `required`, `params`). The DCP passport extension, URI
`https://dcp-ai.org/a2a/extensions/passport/v2`, carries the agent's
`SignedPayload<AgentPassportV2>` (DCP-01) in `params.passport`: the passport the agent signed
with the Ed25519 + ML-DSA-65 keys it lists, with its `principal_binding_reference` to the
Responsible Principal Record. Nothing new on the wire.

```typescript
// Fragment: signedPassport is your agent's SignedPayload<AgentPassportV2>
import { passportToAgentCard, verifyAgentCardPassport, agentCardToPassport } from '@dcp-ai/google-a2a';

// Publisher: the signed passport (as produced by the DCP SDK or @dcp-ai/openclaw) goes into the card.
const card = passportToAgentCard(signedPassport, 'https://my-agent.example.com/a2a');

// Consumer: check passport consistency; trust and endpoint possession require the steps below.
const check = await verifyAgentCardPassport(card);
if (!check.verified) throw new Error(check.errors.join('; '));
check.passport.agent_id; // the verified DCP agent
```

### What verification proves, and what it does not

`verifyAgentCardPassport` checks that the extension is present, the `payload_hash` matches, the
composite signature is `pq_over_classical` (Ed25519 plus ML-DSA-65 or SLH-DSA-192f, each slot
pinned to its algorithm) and verifies under the AgentPassport context with keys the passport
itself lists (active, unexpired, each `kid` the hash of its public key), timestamps match an RFC 3339 pattern and
parse with `Date.parse` (not a full calendar check: some impossible dates, such as February 30, are normalized and pass),
the passport is `active`, and `metadata.dcp_agent_id` and `expectedAgentId`, when given, name
the same agent. A card that fails one of these listed checks is rejected; this is not a full JSON Schema validation of the passport, so fields outside these checks are not validated.

A passport is public, and anyone can copy it into their own card. So a `verified` result alone
proves that the passport is **self-consistent**: signed by the keys it lists. It does not prove
that the party serving the card holds those keys, nor that `url`, `name`, `provider` or `skills`
belong to the passport's agent. To make it an identity check:

- Pass `trustedKeys`: the keys you already trust for that agent (from a registry, a pinned earlier
  passport, or the `binding_keys` of an RPR whose principal you anchor outside the bundle, when the principal signs for
  the agent; a valid signature on an RPR alone does not make it trusted) and
  `expectedAgentId`. Both signing keys must be among them, and the trusted entries themselves must
  be `active` and unexpired (your record of a key is authoritative over the passport's copy); the
  result then says `anchored: true`. `anchored` only reports that `trustedKeys` was given, even when the
  verification fails: for an anchored check, require `verified && anchored`.
- Use only `result.passport`, never the card's unsigned fields, as the agent's identity.
- Before delegating a task, demand proof of possession from the endpoint: the SDK's
  `generateRegistrationPoP` / `verifyRegistrationPoP`, or a DCP-04 A2A session.
  `verifyRegistrationPoP` only checks the signature over the challenge it is given: your own protocol must issue a
  fresh, unpredictable nonce from the verifier, enforce its expiry and single use, and bind it to the kid, the agent
  and the endpoint. Do not trust a PoP that the endpoint sends on its own or reuses. A2A 1.0's
  `AgentCard.signatures` (JWS over the card) is the protocol's own way to bind the rest of the
  card; this bridge does not implement it.

`attachPassportToAgentCard(card, signedPassport)` adds the extension to a card you already have
(replacing an earlier DCP passport), `agentCardPassport(card)` reads it, and
`agentCardToPassport(card)` returns the carried passport instead of a skeleton when the card has
one.

## Supported DCP Specifications

DCP-01 through DCP-09, as partial mappings (the functions below); not a full implementation of those specifications.

## Overview

The Google A2A Protocol defines a standard for agent discovery and communication. This bridge maps DCP identity and audit concepts onto A2A primitives:

- **Agent Passports ↔ Agent Cards** — carry DCP passports in discoverable A2A Agent Cards, subject to the trust and proof-of-possession limits above.
- **A2A Tasks → DCP Intents** — convert incoming A2A task requests into DCP Intents for policy evaluation and audit logging.
- **Audit wrapping** — attach DCP audit entries to A2A task executions for traceability.

## Functions

| Function | Direction | Description |
|---|---|---|
| `passportToAgentCard(passport, endpoint)` | DCP → A2A | Convert an Agent Passport (signed or bare) to an A2A Agent Card; a signed one is carried in the DCP extension |
| `attachPassportToAgentCard(card, signedPassport)` | DCP → A2A | Put a signed passport into an existing card's `capabilities.extensions` |
| `agentCardPassport(card)` | A2A → DCP | The signed passport a card carries, if any |
| `verifyAgentCardPassport(card, options?)` | A2A → DCP | Verify the carried passport offline |
| `agentCardToPassport(card)` | A2A → DCP | The carried passport, or a skeleton for a card without one |
| `wrapA2ATaskWithAudit(task, agentId, intentId)` | A2A + DCP | Wrap a task with a DCP audit entry |
| `a2aTaskToIntent(task, agentId)` | A2A → DCP | Convert a task request into a DCP Intent |
| `addMandateToA2AHandshake(handshake, mandate)` | DCP → A2A | Inject DCP-09 mandate into A2A handshake |
| `createLifecycleNotification(agentId, event, details)` | DCP → A2A | Create A2A notification for lifecycle events (DCP-05) |

## Agent Card Metadata

DCP metadata is embedded in the Agent Card's `metadata` field:

```json
{
  "dcp_agent_id": "agent:uuid",
  "dcp_version": "2.0",
  "dcp_security_tier": "standard",
  "dcp_owner_rpr_hash": "sha256:...",
  "dcp_lifecycle_state": "active",
  "dcp_mandate_id": null
}
```

These fields are unsigned card data: `dcp_security_tier` is always `"standard"` (it is not computed), and `dcp_owner_rpr_hash` holds the passport's `owner_rpr_hash` or, for a V2 passport, its `principal_binding_reference` (the RPR's `human_id`, not a hash). They help discovery; identity comes only from the verified passport (`result.passport`).

## Usage

```javascript
// Fragment: myPassport and incomingTask come from your application
import { passportToAgentCard, a2aTaskToIntent } from '@dcp-ai/google-a2a';

// Publish a DCP agent as an A2A Agent Card
const card = passportToAgentCard(myPassport, 'https://my-agent.example.com/a2a');

// Convert an incoming A2A task to a DCP Intent
const intent = a2aTaskToIntent(incomingTask, 'agent:my-agent-id');
```

## Notes

- Agent Card `authentication.schemes` is set to `['dcp-bundle']` to signal that this agent uses DCP bundle-based authentication.
- Passport skills are derived from DCP capabilities, with underscores replaced by spaces for human-readable names.
- Skeleton conversions (A2A → DCP) of a card without the DCP extension produce partial records that need key generation and signing before use.
- The card fields this bridge writes (`authentication`, `metadata`, …) predate A2A 1.0, whose card uses `supportedInterfaces` and `securitySchemes`; `capabilities.extensions` is valid in both. Aligning the rest of the card with A2A 1.0 is a separate change.
