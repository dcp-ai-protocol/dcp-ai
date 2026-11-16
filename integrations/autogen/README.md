# DCP-AI ↔ Microsoft AutoGen Bridge

Builds DCP-shaped records for Microsoft AutoGen conversations: agent configurations with a DCP identity, audit entries for messages, intents for function calls and delegation mandates.

The records are plain objects: **unsigned, and without content hashes or a hash chain**. The bridge does no cryptography and does not import AutoGen. They are drafts that need adapting to the DCP schemas: for example, an intent has `action_type: "function_call"`, which is not in the schema's enum, and no `session_nonce`, `human_id`, `estimated_impact` or `requires_consent`. Signing and chaining them with a DCP SDK (for example the TypeScript SDK's `BundleBuilderV2` and `signBundleV2`) does not by itself make them a normative bundle: adapt them to the schemas first.

## Installation

```bash
npm install @dcp-ai/autogen
```

npm's 2.0.1 (26/10/2026) has the same `index.js` as the source on `main`. It has no dependencies.

## Supported DCP Specifications

DCP-01 through DCP-09, as partial mappings: the records follow shapes from these specifications, but the bridge does not implement them in full.

## Overview

This bridge integrates DCP-AI with Microsoft's AutoGen framework for multi-agent orchestration. It provides:

- **DCP-aware agent configs** — extend AutoGen agent definitions with DCP identity, capabilities, and security tiers.
- **Message auditing** — build a DCP-shaped audit entry for a message you pass to it.
- **GroupChat sessions** — copy the agents of a group chat with a shared DCP session nonce, for correlated audit trails.
- **Function call intents** — convert AutoGen function calls into intent drafts; the policy evaluation and the gating before execution are yours.

## Functions

| Function | Description |
|---|---|
| `createDcpAutoGenAgent(config)` | Create a DCP-aware AutoGen agent configuration |
| `auditAutoGenMessage(message, sender, recipient)` | Generate a DCP audit entry for a message |
| `createDcpGroupChat(agents, config)` | Create a DCP GroupChat with shared session nonce |
| `autoGenFunctionToIntent(functionCall, agentConfig)` | Convert a function call to a DCP Intent |
| `delegateGroupChatRole(groupChat, agentConfig, authorityScope)` | Delegate authority scope to an agent in a GroupChat (DCP-09) |

## Usage

```javascript
import {
  createDcpAutoGenAgent,
  auditAutoGenMessage,
  createDcpGroupChat,
  autoGenFunctionToIntent,
} from '@dcp-ai/autogen';

// Create DCP-aware agents
const coder = createDcpAutoGenAgent({
  name: 'Coder',
  system_message: 'You write code.',
  capabilities: ['code_generation', 'code_review'],
  security_tier: 'standard',
});

const reviewer = createDcpAutoGenAgent({
  name: 'Reviewer',
  system_message: 'You review code.',
  capabilities: ['code_review'],
  security_tier: 'elevated',
});

// Set up a group chat with shared session nonce
const chat = createDcpGroupChat([coder, reviewer], {
  security_tier: 'elevated',
  max_rounds: 20,
});

// Audit a message exchange
const auditEntry = auditAutoGenMessage(
  { role: 'assistant', content: 'Here is the code...' },
  coder,
  reviewer,
);

// Create an intent before executing a function
const intent = autoGenFunctionToIntent(
  { name: 'execute_code', arguments: { code: 'print("hello")' } },
  coder,
);
```

In this example `auditAutoGenMessage` receives the original `coder` and `reviewer`, which do not carry the group chat's
session nonce: `createDcpGroupChat` returns copies of the agents, with the nonce, in `chat.agents`. The function only
returns an entry; it does not add the nonce or store the entry anywhere.

## Security Tier Resolution

When two agents with different security tiers communicate, the audit entry uses the **higher** of the two tiers. An unknown tier counts as `standard`.

## Notes

- The `content_hash` field in audit entries is set to `null` by default; integrate with DCP's cryptographic layer to compute SHA-256 hashes of message content.
- Session nonces are 256-bit random hex strings shared across all agents in a GroupChat.
- The configurations are plain objects that your own AutoGen (or Semantic Kernel) code reads; the bridge has no dependency on either.
