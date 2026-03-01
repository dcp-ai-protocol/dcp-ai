# DCP-AI ↔ Google A2A Protocol Bridge

Bridges between DCP Agent Passports and Google A2A (Agent-to-Agent) Protocol Agent Cards, enabling DCP-certified agents to participate in Google A2A networks with post-quantum security.

## Overview

The Google A2A Protocol defines a standard for agent discovery and communication. This bridge maps DCP identity and audit concepts onto A2A primitives:

- **Agent Passports ↔ Agent Cards** — publish DCP-certified agents as discoverable A2A Agent Cards, and import A2A agents into the DCP ecosystem.
- **A2A Tasks → DCP Intents** — convert incoming A2A task requests into DCP Intents for policy evaluation and audit logging.
- **Audit wrapping** — attach DCP audit entries to A2A task executions for traceability.

## Functions

| Function | Direction | Description |
|---|---|---|
| `passportToAgentCard(passport, endpoint)` | DCP → A2A | Convert an Agent Passport to an A2A Agent Card |
| `agentCardToPassport(card)` | A2A → DCP | Convert an A2A Agent Card to an Agent Passport skeleton |
| `wrapA2ATaskWithAudit(task, agentId, intentId)` | A2A + DCP | Wrap a task with a DCP audit entry |
| `a2aTaskToIntent(task, agentId)` | A2A → DCP | Convert a task request into a DCP Intent |

## Agent Card Metadata

DCP metadata is embedded in the Agent Card's `metadata` field:

```json
{
  "dcp_agent_id": "agent:uuid",
  "dcp_version": "2.0",
  "dcp_security_tier": "standard",
  "dcp_owner_rpr_hash": "sha256:..."
}
```

This allows A2A consumers to discover DCP-certified agents and verify their identity.

## Usage

```javascript
import { passportToAgentCard, a2aTaskToIntent } from './index.js';

// Publish a DCP agent as an A2A Agent Card
const card = passportToAgentCard(myPassport, 'https://my-agent.example.com/a2a');

// Convert an incoming A2A task to a DCP Intent
const intent = a2aTaskToIntent(incomingTask, 'agent:my-agent-id');
```

## Notes

- Agent Card `authentication.schemes` is set to `['dcp-bundle']` to signal that this agent uses DCP bundle-based authentication.
- Passport skills are derived from DCP capabilities, with underscores replaced by spaces for human-readable names.
- Skeleton conversions (A2A → DCP) produce partial records that need key generation and signing before use.
