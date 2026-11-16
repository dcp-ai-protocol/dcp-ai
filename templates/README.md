# Templates

Starter templates that walk through where DCP fits in popular AI frameworks and web servers: identity, intent declaration, policy gating, audit logging and bundle sealing.

> **Walkthroughs, not signers.** The templates use placeholder keys and signatures (`«generated»`, `«sig»`): they generate no keys, sign nothing, and their bundles do not verify. The Express template's middleware checks bundle structure only, not signatures. For real keys, signatures and verification, follow the quickstarts in [docs/](../docs/README.md). The same templates ship as `npm create @dcp-ai/<name>` (`packages/create-*`).

## Available Templates

| Template | Language | Description |
|----------|----------|-------------|
| [express/](express/) | Node.js | Express server with a structural DCP check (no signature verification) and discovery endpoints |
| [openai/](openai/) | Node.js | OpenAI function calling with DCP intent/policy/audit wrapping |
| [langchain/](langchain/) | Node.js | LangChain.js 0.3 call wrapped in the DCP flow |
| [crewai/](crewai/) | Python | Multi-agent crew simulation with DCP passports and audit trail |

## Quick Start

Each template can be run independently, from the repository root (each command runs in a subshell, so the next one
starts from the root again). The Express server stays in the foreground: stop it with Ctrl+C before the next one.

```bash
# Express
(cd templates/express && npm install && npm start)

# OpenAI (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/openai && npm install && npm start)

# LangChain (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/langchain && npm install && npm start)

# CrewAI (standalone Python)
(cd templates/crewai && python main.py)
```

## DCP Lifecycle

Together the templates illustrate this conceptual DCP v2.0 flow; each one covers only part of it (the Express
template, for example, creates no identity, seals no bundle and executes no action):

1. **Bootstrap session** — Generate a 256-bit session nonce; the dual keypairs (Ed25519 + ML-DSA-65) are placeholders
2. **Create RPR** — Bind the AI agent to a responsible human principal
3. **Issue passport** — Declare agent capabilities and risk tier
4. **Declare intent** — Before each action, declare what the agent wants to do
5. **Gate by policy** — Evaluate risk score and get approve/escalate/block decision. In the templates this step is a
   stub that always returns `approve`; the Express template has no policy step and checks only the bundle's
   self-declared capabilities
6. **Execute action** — Only proceed if policy approves
7. **Log audit** — Record the action in a hash-chained audit trail
8. **Seal bundle** — Assemble all artifacts into a Citizenship Bundle, with placeholder composite signatures

## See Also

- [Quick Start Guide](../docs/QUICKSTART.md)
- [API Reference](../docs/API_REFERENCE.md)
- [Migration Guide (V1 to V2)](../docs/MIGRATION_V1_V2.md)
