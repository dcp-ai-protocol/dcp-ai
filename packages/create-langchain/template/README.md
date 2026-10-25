# DCP-AI + LangChain Template

A walkthrough of the DCP flow around a LangChain call.

> **A walkthrough, not a signer.** The keys and signatures in `index.js` are placeholders (`«generated»`, `«sig»`): the template shows the shape of the DCP v2.0 flow, but it generates no keys, signs nothing, and its bundles do not verify. It reads nothing from `.dcp/`. For real keys and signatures, follow [docs/QUICKSTART_LANGCHAIN.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_LANGCHAIN.md).

The template pins LangChain.js 0.3 (`langchain` and `@langchain/openai` `^0.3.0`); the guide shows the current LangChain.js v1 API.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run it. With `OPENAI_API_KEY` the template calls the OpenAI API (billed by OpenAI). If the call fails for any reason (no key, network, quota, model), it prints a simulated response and still records `outcome: "success"`, so the audit entry does not show that the call succeeded. Set the key in your environment:
   ```bash
   node index.js
   ```

## What this template does

- Wraps a LangChain call in the DCP flow
- Every action is declared as an Intent; the policy step is a stub that always returns `approve` (risk 50), so the
  escalate and block branches show the flow but are not reached
- Every response gets an audit entry
- The agent's Citizenship Bundle carries placeholder signatures

## Files

- `index.js` — LangChain call with the DCP flow
- `package.json` — Dependencies
