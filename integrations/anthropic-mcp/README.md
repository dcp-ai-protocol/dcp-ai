# DCP-AI ↔ Anthropic MCP Bridge

Provides DCP tools and resources for Anthropic Model Context Protocol (MCP) servers, enabling Claude and other MCP-compatible models to interact with DCP-certified agents.

## Overview

This bridge exposes DCP operations as MCP tools and resources, allowing any MCP-compatible AI model to:

- **Verify DCP bundles** — validate Citizenship Bundles including identity, signatures, and audit trail integrity.
- **Create DCP identities** — provision new Responsible Principal Records and Agent Passports.
- **Declare intents** — submit intents for policy evaluation with automatic risk tier computation.
- **Check agent status** — verify an agent's DCP citizenship validity.

## MCP Tools

| Tool | Description |
|---|---|
| `dcp_verify_bundle` | Verify a DCP Citizenship Bundle |
| `dcp_create_identity` | Create a new DCP digital identity (RPR + Passport) |
| `dcp_declare_intent` | Declare an intent for policy evaluation |
| `dcp_check_agent` | Check if an agent has valid DCP citizenship |

## MCP Resources

| URI | Description |
|---|---|
| `dcp://protocol/version` | Current DCP protocol version and capabilities |
| `dcp://protocol/algorithms` | Supported cryptographic algorithms |
| `dcp://protocol/tiers` | Security tier definitions and requirements |

## Usage

### Registering with an MCP Server

```javascript
import { DCP_MCP_TOOLS, DCP_MCP_RESOURCES, handleDcpToolCall } from './index.js';

// Register DCP tools with your MCP server
for (const tool of DCP_MCP_TOOLS) {
  mcpServer.registerTool(tool);
}

// Register DCP resources
for (const resource of DCP_MCP_RESOURCES) {
  mcpServer.registerResource(resource);
}

// Handle tool calls
mcpServer.onToolCall(async (name, args) => {
  return await handleDcpToolCall(name, args);
});
```

### Tool Call Examples

```javascript
import { handleDcpToolCall } from './index.js';

// Verify a bundle
const result = await handleDcpToolCall('dcp_verify_bundle', {
  bundle_json: JSON.stringify(myBundle),
  security_tier: 'standard',
});

// Declare an intent
const intent = await handleDcpToolCall('dcp_declare_intent', {
  agent_id: 'agent:my-agent',
  action_type: 'api_call',
  description: 'Fetch weather data from external API',
  risk_score: 150,
});
```

## Notes

- `dcp_verify_bundle` performs structural validation; full cryptographic verification requires the DCP core library.
- `dcp_create_identity` returns identifiers only — key generation and signing are separate steps.
- Risk tier is computed automatically from the risk score: routine (<200), standard (200-499), elevated (500-799), maximum (800+).
