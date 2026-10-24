# Documentation

## Quick Start

- [QUICKSTART.md](QUICKSTART.md) — Get up and running in 60 seconds
- [QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md) — Express middleware integration
- [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) — LangChain tool wrapping
- [QUICKSTART_OPENAI.md](QUICKSTART_OPENAI.md) — OpenAI Agents SDK integration
- [QUICKSTART_CREWAI.md](QUICKSTART_CREWAI.md) — CrewAI multi-agent crews

## Architecture & Security

- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — System architecture and deployment blueprint
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — Threat model, attack vectors, protection layers
- [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) — P2P storage and optional blockchain anchoring

## Testing & Assurance

- [tools/interop-matrix](../tools/interop-matrix/README.md) — Live agents on the four SDKs sign and verify each other's bundles, untouched and tampered with in transit
- [tools/difffuzz](../tools/difffuzz/README.md) — Differential fuzzing of the four V2 verifiers
- [tests/interop/v2](../tests/interop/v2/) — Shared vectors every SDK must accept or reject

## Reference

- [API_REFERENCE.md](API_REFERENCE.md) — Complete TypeScript SDK API documentation
- [NIST_CONFORMITY.md](NIST_CONFORMITY.md) — NIST FIPS 203/204/205 conformance statement
- [EU_AI_ACT_MAPPING.md](EU_AI_ACT_MAPPING.md) — EU AI Act (Regulation (EU) 2024/1689) logging, human oversight and record-keeping obligations mapped to DCP artifacts
- [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) — Migrating from DCP v1.0 to v2.0

## Operations

- [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) — Running a DCP verification service
- [ADMISSION.md](ADMISSION.md) — Accepting bundles only from trusted principals, and the strict-v1 profile
- [AGENT_CREATION_AND_CERTIFICATION.md](AGENT_CREATION_AND_CERTIFICATION.md) — Agent creation flow and certification

## Specifications

- [spec/DCP-01.md](../spec/DCP-01.md) — Identity & Responsible Principal Binding
- [spec/DCP-02.md](../spec/DCP-02.md) — Intent Declaration & Policy Gating
- [spec/DCP-03.md](../spec/DCP-03.md) — Audit Chain & Transparency
- [spec/DCP-04.md](../spec/DCP-04.md) — Agent-to-Agent Communication
- [spec/DCP-05.md](../spec/DCP-05.md) — Agent Lifecycle Management
- [spec/DCP-06.md](../spec/DCP-06.md) — Digital Succession & Inheritance
- [spec/DCP-07.md](../spec/DCP-07.md) — Conflict Resolution & Dispute Arbitration
- [spec/DCP-08.md](../spec/DCP-08.md) — Rights & Obligations Framework
- [spec/DCP-09.md](../spec/DCP-09.md) — Personal Representation & Delegation

## Community & Vision

- [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) — Early adopter program, benefits, and requirements
- [GENESIS_PAPER.md](GENESIS_PAPER.md) — Founding whitepaper

---

For protocol specifications, see [spec/](../spec/). For contributing guidelines, see [CONTRIBUTING.md](../CONTRIBUTING.md).
