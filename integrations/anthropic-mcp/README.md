# DCP-AI ↔ Anthropic MCP Bridge

Provides DCP tools and resources for Anthropic Model Context Protocol (MCP) servers, enabling Claude and other MCP-compatible models to interact with DCP-certified agents.

## Overview

This bridge exposes DCP operations as MCP tools and resources, allowing any MCP-compatible AI model to:

- **Verify DCP bundles** — validate Citizenship Bundles including identity, signatures, and audit trail integrity.
- **Create DCP identities** — provision new Responsible Principal Records and Agent Passports.
- **Declare intents** — submit intents for policy evaluation with automatic risk tier computation.
- **Check agent status** — verify an agent's DCP citizenship validity.
- **Lifecycle management (DCP-05)** — commission, report vitality, and decommission agents.
- **Succession (DCP-06)** — create digital testaments with successor preferences.
- **Disputes (DCP-07)** — file disputes between agents with evidence hashes.
- **Rights (DCP-08)** — declare agent rights within a jurisdiction.
- **Delegation (DCP-09)** — create human→agent delegation mandates.

## Supported DCP Specifications

DCP-01 through DCP-09.

## MCP Tools

| Tool | Description |
|---|---|
| `dcp_verify_bundle` | Verify a DCP Citizenship Bundle |
| `dcp_create_identity` | Create a new DCP digital identity (RPR + Passport) |
| `dcp_declare_intent` | Declare an intent for policy evaluation |
| `dcp_check_agent` | Check if an agent has valid DCP citizenship |
| `dcp_commission_agent` | Commission an agent (DCP-05) |
| `dcp_report_vitality` | Report agent vitality metrics (DCP-05) |
| `dcp_decommission_agent` | Decommission an agent (DCP-05) |
| `dcp_create_testament` | Create a digital testament (DCP-06) |
| `dcp_file_dispute` | File a dispute between agents (DCP-07) |
| `dcp_declare_rights` | Declare agent rights (DCP-08) |
| `dcp_create_mandate` | Create a delegation mandate (DCP-09) |

## MCP Resources

| URI | Description |
|---|---|
| `dcp://protocol/version` | Current DCP protocol version and capabilities |
| `dcp://protocol/algorithms` | Supported cryptographic algorithms |
| `dcp://protocol/tiers` | Security tier definitions and requirements |
| `dcp://protocol/lifecycle-states` | Agent lifecycle state definitions (DCP-05) |

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
