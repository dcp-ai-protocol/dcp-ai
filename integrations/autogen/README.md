# DCP-AI ↔ Microsoft AutoGen Bridge

Enables Microsoft AutoGen agents to carry DCP digital citizenship, providing identity, audit trails, and post-quantum security for multi-agent conversations.

## Overview

This bridge integrates DCP-AI with Microsoft's AutoGen framework for multi-agent orchestration. It provides:

- **DCP-aware agent configs** — extend AutoGen agent definitions with DCP identity, capabilities, and security tiers.
- **Message auditing** — generate DCP audit entries for every message exchanged between AutoGen agents.
- **GroupChat sessions** — bind all agents in a group chat to a shared DCP session nonce for correlated audit trails.
- **Function call intents** — convert AutoGen function calls into DCP Intents for policy evaluation before execution.

## Functions

| Function | Description |
|---|---|
| `createDcpAutoGenAgent(config)` | Create a DCP-aware AutoGen agent configuration |
| `auditAutoGenMessage(message, sender, recipient)` | Generate a DCP audit entry for a message |
| `createDcpGroupChat(agents, config)` | Create a DCP GroupChat with shared session nonce |
| `autoGenFunctionToIntent(functionCall, agentConfig)` | Convert a function call to a DCP Intent |

## Usage

```javascript
import {
  createDcpAutoGenAgent,
  auditAutoGenMessage,
  createDcpGroupChat,
  autoGenFunctionToIntent,
} from './index.js';

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

## Security Tier Resolution

When two agents with different security tiers communicate, the audit entry uses the **higher** of the two tiers. This ensures that elevated-security agents always receive appropriately classified audit trails.

## Notes

- The `content_hash` field in audit entries is set to `null` by default; integrate with DCP's cryptographic layer to compute SHA-256 hashes of message content.
- Session nonces are 256-bit random hex strings shared across all agents in a GroupChat.
- This bridge is compatible with both AutoGen and Semantic Kernel agent patterns.
