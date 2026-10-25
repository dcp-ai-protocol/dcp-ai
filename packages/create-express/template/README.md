# DCP-AI + Express API Server Template

An Express API that shows where DCP bundle checks go in a server.

> **It does not verify signatures.** The template's `verifyBundle` checks the structure of a bundle only (version, manifest fields, the presence of composite signatures, session nonces). It verifies no signature, so a forged or altered bundle passes. Use it to see the routes and the flow, not as a verifier. To verify bundles, use [`@dcp-ai/express`](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/integrations/express/README.md) (from a checkout until its next release) or the SDK's `verifySignedBundleV2`, as in [docs/QUICKSTART_EXPRESS.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_EXPRESS.md).

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   node index.js
   ```

The template does not read `.dcp/`, so `npx @dcp-ai/cli init` is not needed (and that wizard is a demo: [Agent creation](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only)).

## What this template does

- Runs an Express API server with a DCP middleware that checks bundle **structure** (see above)
- Agents present a Citizenship Bundle to reach the protected routes
- Rate-limits the public and protected routes
- Keeps an in-memory registry of the agents named by bundles that passed the structural check: their `agent_id` and
  capabilities are self-declared and unverified, and the registry is lost on restart
- `/agents/action` performs nothing: it checks the action against the bundle's self-declared capabilities and returns
  an `action_id`
- Provides `/verify`, `/health`, `/agents/*` and `/.well-known/dcp-capabilities.json`

## Endpoints

| Method | Path               | Auth     | Description                        |
|--------|--------------------|----------|------------------------------------|
| GET    | `/health`          | None     | Health check                       |
| POST   | `/verify`          | None     | Structural check of a DCP bundle (no signature verification) |
| POST   | `/agents/action`   | DCP      | Simulated acknowledgement: capability check against the bundle, no action executed (requires bundle) |
| GET    | `/agents/registry` | DCP      | List registered agents             |
| GET    | `/.well-known/dcp-capabilities.json` | None | Capability discovery |

## Files

- `index.js` — Express server with the DCP middleware
- `package.json` — Dependencies
