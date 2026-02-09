---
name: dcp-citizenship
description: Digital Citizenship Protocol — identity, intent declaration, and audit trail for AI agents
metadata: {"openclaw":{"requires":{"bins":["node"],"plugins":["@dcp-ai/openclaw"]}}}
---

# DCP Citizenship — AI Agent Governance

You have access to the **Digital Citizenship Protocol (DCP)** tools. These tools
ensure that every action you take is **declared, verified, and auditable**,
binding your actions to a human owner.

## Setup (run once per session)

Before performing any sensitive action, set up your DCP identity:

```
dcp_identity_setup({
  session_id: "<current session/thread id>",
  owner_name: "<human owner's name>",
  jurisdiction: "<ISO country code, e.g. US, ES, MX>",
  capabilities: ["browse", "api_call"],  // what you're allowed to do
  risk_tier: "medium"
})
```

This generates an Ed25519 keypair, a Human Binding Record, and an Agent Passport.

## Before every sensitive action

**Always** declare an intent before performing actions like:
- Web browsing, API calls, file writes, code execution, emails, payments

```
dcp_declare_intent({
  session_id: "<session id>",
  action_type: "api_call",          // browse | api_call | send_email | write_file | execute_code | ...
  target_channel: "api",            // web | api | email | filesystem | runtime | ...
  estimated_impact: "medium",       // low | medium | high
  data_classes: ["contact_info"]    // none | pii | credentials | financial_data | ...
})
```

The response tells you if you can proceed:
- **approve** → Go ahead with the action.
- **escalate** → Ask the human owner for confirmation before proceeding.
- **block** → Do NOT proceed. Inform the user that the action is too risky.

## After every action

Log the result for the audit trail:

```
dcp_log_action({
  session_id: "<session id>",
  intent_id: "<intent_id from declare_intent>",
  outcome: "API returned 200 OK with user profile",
  evidence_tool: "web.fetch",
  evidence_result_ref: "https://api.example.com/users/123"
})
```

## Verify external bundles

If you receive a DCP Signed Bundle from another agent, verify it:

```
dcp_verify_bundle({
  signed_bundle: { ... },  // the full signed bundle JSON
  public_key: "base64..."  // optional, uses bundle's signer key if omitted
})
```

## End of session

Build and sign the complete CitizenshipBundle for the session:

```
dcp_sign_bundle({
  session_id: "<session id>"
})
```

## Mapping OpenClaw tools to DCP action_types

| OpenClaw Tool | DCP action_type | DCP channel |
|---|---|---|
| `browser.*` | `browse` | `web` |
| `exec`, `bash` | `execute_code` | `runtime` |
| `web.fetch`, `web.search` | `api_call` | `api` |
| `write`, `edit`, `apply_patch` | `write_file` | `filesystem` |
| `sessions_send` | `api_call` | `api` |
| `cron`, `webhook` | `api_call` | `api` |

## Important rules

1. **Always** run `dcp_identity_setup` before any other DCP tool.
2. **Always** declare intent before sensitive actions and respect the policy decision.
3. **Always** log actions after completion for the audit trail.
4. If an intent is **blocked**, do NOT perform the action. Explain to the user why.
5. If an intent is **escalated**, ask the user for explicit confirmation before proceeding.
6. The audit trail is **immutable** — each entry is hash-chained to the previous one.
