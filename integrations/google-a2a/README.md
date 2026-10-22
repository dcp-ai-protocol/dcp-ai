# DCP-AI ↔ A2A (Agent-to-Agent) Protocol Bridge

Carries the signed DCP Agent Passport inside the A2A Agent Card, so an A2A consumer can verify
offline, before delegating a task, that the agent it discovered is a DCP citizen bound to a
responsible principal. Also maps A2A tasks onto DCP intents and audit entries.

## The passport inside the Agent Card

A2A lets an Agent Card declare extensions in `capabilities.extensions` (`AgentExtension`: `uri`,
`description`, `required`, `params`). The DCP passport extension, URI
`https://dcp-ai.org/a2a/extensions/passport/v2`, carries the agent's
`SignedPayload<AgentPassportV2>` (DCP-01) in `params.passport`: the passport the agent signed
with the Ed25519 + ML-DSA-65 keys it lists, with its `principal_binding_reference` to the
Responsible Principal Record. Nothing new on the wire.

```typescript
import { passportToAgentCard, verifyAgentCardPassport, agentCardToPassport } from '@dcp-ai/google-a2a';

// Publisher: the signed passport (as produced by the DCP SDK or @dcp-ai/openclaw) goes into the card.
const card = passportToAgentCard(signedPassport, 'https://my-agent.example.com/a2a');

// Consumer: verify before trusting the card's claims.
const check = await verifyAgentCardPassport(card);
if (!check.verified) throw new Error(check.errors.join('; '));
check.passport.agent_id; // the verified DCP agent
```

`verifyAgentCardPassport` checks that the extension is present, the `payload_hash` matches, the
composite signature is `pq_over_classical` and verifies under the AgentPassport context with keys
the passport itself lists (active, unexpired, of the signature's algorithm), the passport is
`active`, and `metadata.dcp_agent_id`, when present, names the same agent. Anything malformed
fails closed. As with any DCP bundle, the consumer still decides whether to trust the principal
the passport binds to.

`attachPassportToAgentCard(card, signedPassport)` adds the extension to a card you already have
(replacing an earlier DCP passport), `agentCardPassport(card)` reads it, and
`agentCardToPassport(card)` returns the carried passport instead of a skeleton when the card has
one.

## Supported DCP Specifications

DCP-01 through DCP-09.

## Overview

The Google A2A Protocol defines a standard for agent discovery and communication. This bridge maps DCP identity and audit concepts onto A2A primitives:

- **Agent Passports ↔ Agent Cards** — publish DCP-certified agents as discoverable A2A Agent Cards, and import A2A agents into the DCP ecosystem.
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

This allows A2A consumers to discover DCP-certified agents and verify their identity.

## Usage

```javascript
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
