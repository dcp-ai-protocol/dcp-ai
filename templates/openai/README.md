# DCP-AI + OpenAI Function Calling Template

A walkthrough of the DCP flow around OpenAI function calling.

> **A walkthrough, not a signer.** The keys and signatures in `index.js` are placeholders (`«generated»`, `«sig»`): the template shows the shape of the DCP v2.0 flow, but it generates no keys, signs nothing, and its bundles do not verify. It reads nothing from `.dcp/`. For real keys and signatures, follow [docs/QUICKSTART_OPENAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_OPENAI.md).

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run it. With `OPENAI_API_KEY` the template calls the OpenAI API (billed by OpenAI). If that first call fails for any reason (no key, network, quota, model), it falls back to simulated function calls; the message it prints about a missing key does not diagnose the cause. Set the key in your environment, not in the command:
   ```bash
   node index.js
   ```

## What this template does

- Registers DCP-aware tools as OpenAI functions
- Each function call creates a DCP Intent before execution; the policy step is a stub that always returns `approve`
  (risk 120), so the "blocked by policy" branch is not reached
- The tools (`lookupWeather`, `sendEmail`, `searchWeb`) always return simulated data, even when the model is called for
  real: their results and audit entries do not show that any external action took place
- Every response gets an audit entry, hash-chained to the previous one
- A Citizenship Bundle with placeholder signatures is printed after the conversation

## Files

- `index.js` — OpenAI function calling with the DCP flow
- `package.json` — Dependencies
