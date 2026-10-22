# DCP-AI ↔ Model Context Protocol (MCP) Bridge

Signed DCP receipts for MCP tool calls, plus DCP tools and resources for MCP servers.

## Signed receipts per tool call

`withDcpReceipt` wraps any MCP tool handler so that every call comes back with a receipt that
proves who ran it, under which intent and policy decision, and what went in and out. A receipt is
an ordinary **DCP v2.0 signed bundle**: the agent's Responsible Principal Record (DCP-01) and Agent
Passport, an Intent (DCP-02) composite-signed with Ed25519 + ML-DSA-65 *before* the tool runs, the
Policy Decision, and one audit entry (DCP-03) with the SHA-256 of the arguments and of the result.
Nothing new on the wire: any DCP verifier checks it offline.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withDcpReceipt, createReceiptIdentity, verifyDcpReceipt } from '@dcp-ai/anthropic-mcp';

// One identity per session: new keys and session nonce, signed RPR and passport.
// Production deployments pass their own signed RPR and passport instead.
const identity = await createReceiptIdentity({ legalName: 'Example Operator', jurisdiction: 'CL' });

const server = new McpServer({ name: 'weather', version: '1.0.0' });
server.registerTool(
  'get_weather',
  { description: 'Weather for a city', inputSchema: { city: z.string() } },
  withDcpReceipt('get_weather', async ({ city }) => ({ content: [{ type: 'text', text: `Sunny in ${city}` }] }), { identity }),
);
```

Every result now carries `_meta.dcp_receipt`. The caller, or anyone later, verifies it and checks
that it is the receipt of *this* call:

```typescript
const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Santiago' } });
const { _meta, ...seen } = result;
const check = await verifyDcpReceipt(_meta.dcp_receipt, { tool: 'get_weather', arguments: { city: 'Santiago' }, result: seen });
check.verified; // false if the bundle, the tool name or the hash of { arguments, result } does not match
```

What happens on each call:

| Policy decision | Tool runs | Returned | Audit entry |
|---|---|---|---|
| `approve` | yes | the handler's result + `_meta.dcp_receipt` | `outcome: "completed"`, `result_ref` = hash of the result |
| `escalate` | no | `{ content, isError: true, _meta }` | `outcome: "escalated"`, `policy_decision: "escalated"`, `result_ref: null` |
| `block` | no | `{ content, isError: true, _meta }` | `outcome: "blocked"`, `policy_decision: "blocked"`, `result_ref: null` |
| handler throws | yes | `{ content, isError: true, _meta }` | `outcome: "failed"`, `result_ref` = hash of that error result |

A refusal is evidence too: the receipt of a blocked call shows the intent the agent declared and
the decision that stopped it.

### Classification and policy

By default every call is a low-impact `api_call` on channel `api` with `data_classes: ["none"]`,
which the default policy approves (risk 200). Tell the wrapper what a tool really does, and
decide yourself when the defaults do not fit:

```typescript
withDcpReceipt('pay_invoice', payInvoice, {
  identity,
  classify: (tool, args) => ({
    action_type: 'initiate_payment',
    channel: 'payments',
    estimated_impact: 'high',
    data_classes: ['financial_data'],
  }),
  // Default policy: risk = impact (low 200 / medium 500 / high 900) + 150 per sensitive data class, capped at 1000;
  // approve < 500, escalate < 800, block >= 800. Replace it with your own:
  decide: (intent) => ({ decision: 'escalate', risk_score: 900, reasons: ['payments need a human'] }),
  appliedPolicyHash: 'sha256:…', // hash of the policy you applied (default: hash of the default rules)
});
```

The intent's `security_tier` (and the decision's `resolved_tier`) is the SDK's tier for the intent
(DCP-AI v2.0 §14.2), never below what the risk score implies (200 standard, 500 elevated, 800
maximum), so the default call is `standard`. `appliedPolicyHash` must be `sha256:<64 hex>` and
`createReceiptIdentity` only accepts the passport schema's capabilities (`browse`, `api_call`,
`email`, `calendar`, `payments`, `crm`, `file_write`, `code_exec`); both are refused up front
because the reference verifier validates the schemas.

### Evidence hashes

`evidence.evidence_hash` is `sha256:` over the JSON text of `{ arguments, result }` with keys sorted
at every depth (`stableJson`), and `evidence.result_ref` the same over the result alone when the tool
ran. `arguments` are the arguments as received, copied before the handler runs, so a handler that
rewrites its input cannot change what the receipt attests. `result` is exactly what the wrapper
returns minus `_meta` (`resultSeen(result)`): the receipt travels in `_meta`, and a handler's own
`_meta` is transport metadata, not evidence. A handler that returns a bare value gets it wrapped as
`{ content: [{ type: "text", text }] }`, and that wrapper is what is hashed. When the MCP `extra`
carries a `requestId`, it is recorded as `evidence.request_id`.

Unlike the canonicalization profile, `stableJson` keeps any JSON number, so arguments and results
with decimals hash fine. It sorts keys with JavaScript's `sort()`; an object whose keys are integer
strings (`{ "10": 1, "9": 2 }`) is ordered the way V8 orders it, so recompute the hash in JavaScript
or avoid such keys when another language must check it.

Limits to know about:

- A receipt is bound to one call by its `intent_id` and `audit_id`, and to the MCP request by
  `request_id` when the server provides one; `verifyDcpReceipt` does not check time windows or
  deduplicate, so a verifier that must detect a replayed receipt keeps its own set of seen ids.
- Each receipt is self-contained (one audit entry, `prev_hash: "GENESIS"`); batching a session's
  receipts into one bundle is on the roadmap.
- `createReceiptIdentity` signs the RPR and the passport with the same key pair (the principal and
  the agent are one), which is right for tests and first runs only.

## DCP tools and resources

The bridge also exposes DCP operations as MCP tools and resources, so an MCP-compatible model can:

- **Verify DCP bundles** — run the reference V2 verifier (`verifySignedBundleV2`) on a signed bundle or receipt.
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
| `dcp_verify_bundle` | Verify a signed DCP v2.0 bundle or receipt with the reference verifier |
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
import { DCP_MCP_TOOLS, DCP_MCP_RESOURCES, handleDcpToolCall } from '@dcp-ai/anthropic-mcp';

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
import { handleDcpToolCall } from '@dcp-ai/anthropic-mcp';

// Verify a bundle or a receipt
const result = await handleDcpToolCall('dcp_verify_bundle', {
  bundle_json: JSON.stringify(myBundle),
}); // { verified, errors, warnings, details, timestamp }

// Declare an intent
const intent = await handleDcpToolCall('dcp_declare_intent', {
  agent_id: 'agent:my-agent',
  action_type: 'api_call',
  description: 'Fetch weather data from external API',
  risk_score: 150,
});
```

## Notes

- `dcp_verify_bundle` runs the full cryptographic verification of `@dcp-ai/sdk` (schema, hashes, manifest, composite signature, session binding, audit chain).
- Apart from `dcp_verify_bundle` and the receipts, the tool handlers return drafts: identifiers and fields to sign, never keys or signatures (`next_step` says what is missing).
- `dcp_create_identity` returns identifiers only — key generation and signing are separate steps.
- Risk tier is computed automatically from the risk score: routine (<200), standard (200-499), elevated (500-799), maximum (800+).
