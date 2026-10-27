# Documentation

**Rust release (26/10/2026).** Rust `dcp-ai` 2.11.0 is published on crates.io, including verifier fixes, admission and experimental opt-in APIs. `dcp-jcs-v1` remains the normative default. See [Rust 2.11.0](RUST_RELEASE.md).

**Go release (26/10/2026).** Go SDK `v2.11.0` is available from the module tag `sdks/go/v2.11.0`, including verifier fixes, admission and experimental opt-in APIs. Rust publication remains separate. See [Go v2.11.0](GO_RELEASE.md).

**Python release (26/10/2026).** `dcp-ai` 2.10.0 is now available on PyPI, including the verifier fixes, admission and the experimental opt-in APIs. Go and Rust publication remains separate. See [Python 2.10.0](PYTHON_RELEASE.md).

**npm publication (26/10/2026).** The 13 versions in [NPM_RELEASES.md](NPM_RELEASES.md) are published, including the TypeScript/WASM candidate APIs and TypeScript admission. Entries below retain their development history; `[Unreleased]` does not mean these npm features are unavailable. Python, Go and Rust releases are separate.

## Quick Start

- [QUICKSTART.md](QUICKSTART.md) — Get up and running in a few minutes (published packages and a source checkout)
- [QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md) — Express middleware integration
- [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) — LangChain tool wrapping
- [QUICKSTART_OPENAI.md](QUICKSTART_OPENAI.md) — OpenAI function calling (Node SDK, Chat Completions; Python client wrapper)
- [QUICKSTART_CREWAI.md](QUICKSTART_CREWAI.md) — CrewAI multi-agent crews
- [QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) — Agno agents, teams and workflows with `agno-dcp`

## Architecture & Security

- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — System architecture and deployment blueprint
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — Threat model, attack vectors, protection layers
- [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) — P2P storage and optional blockchain anchoring
- [ARCHITECTURE.md](ARCHITECTURE.md) — Map of the repository for contributors
- [OBSERVABILITY.md](OBSERVABILITY.md) — OpenTelemetry traces and metrics from the SDKs

## Testing & Assurance

- [tools/interop-matrix](../tools/interop-matrix/README.md) — Live agents on the four SDKs sign and verify each other's bundles, untouched and tampered with in transit
- [tools/difffuzz](../tools/difffuzz/README.md) — Differential fuzzing of the four V2 verifiers
- [tests/interop/v2](../tests/interop/v2/) — Shared vectors every SDK must accept or reject
- [tests/interop/candidate/phase4](../tests/interop/candidate/phase4/README.md) — Cross matrix of the experimental `dcp-jcs-v2` producers (five SDKs)

## Reference

- [API_REFERENCE.md](API_REFERENCE.md) — TypeScript SDK API reference, as on `main`
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
- [spec/profiles](../spec/profiles/README.md) — Optional profiles: crypto, A2A, governance and admission

## Proposals (experimental, not normative)

- [proposals/canonicalization-candidate](proposals/canonicalization-candidate/README.md) — The inactive `dcp-jcs-v2` candidate and its opt-in SDK APIs; `dcp-jcs-v1` stays the only profile

## Community & Vision

- [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) — Early adopter program, benefits, and requirements
- [GENESIS_PAPER.md](GENESIS_PAPER.md) — Founding whitepaper

---

For protocol specifications, see [spec/](../spec/). For contributing guidelines, see [CONTRIBUTING.md](../CONTRIBUTING.md).
