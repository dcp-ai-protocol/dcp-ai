# Templates

Starter templates demonstrating DCP integration with popular AI frameworks and web servers. Each template shows the complete DCP v2.0 lifecycle: identity setup, intent declaration, policy gating, audit logging, and bundle signing.

## Available Templates

| Template | Language | Description |
|----------|----------|-------------|
| [express/](express/) | Node.js | Express server with DCP verification middleware and discovery endpoints |
| [openai/](openai/) | Node.js | OpenAI function calling with DCP intent/policy/audit wrapping |
| [langchain/](langchain/) | Node.js | LangChain agent with full DCP lifecycle per LLM call |
| [crewai/](crewai/) | Python | Multi-agent crew simulation with DCP passports and audit trail |

## Quick Start

Each template can be run independently:

```bash
# Express
cd templates/express && npm install && npm start

# OpenAI (requires OPENAI_API_KEY for live calls, simulates without it)
cd templates/openai && npm install && npm start

# LangChain (requires OPENAI_API_KEY for live calls, simulates without it)
cd templates/langchain && npm install && npm start

# CrewAI (standalone Python)
cd templates/crewai && python main.py
```

## DCP Lifecycle

All templates follow the same DCP v2.0 flow:

1. **Bootstrap session** — Generate a 256-bit session nonce and dual keypairs (Ed25519 + ML-DSA-65)
2. **Create RPR** — Bind the AI agent to a responsible human principal
3. **Issue passport** — Declare agent capabilities and risk tier
4. **Declare intent** — Before each action, declare what the agent wants to do
5. **Gate by policy** — Evaluate risk score and get approve/escalate/block decision
6. **Execute action** — Only proceed if policy approves
7. **Log audit** — Record the action in a hash-chained audit trail
8. **Seal bundle** — Assemble all artifacts into a composite-signed Citizenship Bundle

## See Also

- [Quick Start Guide](../docs/QUICKSTART.md)
- [API Reference](../docs/API_REFERENCE.md)
- [Migration Guide (V1 to V2)](../docs/MIGRATION_V1_V2.md)
