# Documentation

This index lists the DCP-AI documentation by task: getting started, architecture and security, testing, reference,
operations, specifications and proposals. The current package versions for every registry are in
[Published versions](#published-versions).

## Published versions

Verified on 26/10/2026. Package versions are independent of the DCP wire and specification version (2.0).

| Registry | Package | Version | Release notes |
|---|---|---|---|
| npm | [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) (TypeScript SDK) | 2.2.0 | [npm packages](NPM_RELEASES.md) |
| npm | [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.0 | [npm packages](NPM_RELEASES.md) |
| npm | [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.0 | [npm packages](NPM_RELEASES.md) |
| PyPI | [`dcp-ai`](https://pypi.org/project/dcp-ai/2.10.0/) (Python SDK) | 2.10.0 | [Python release](PYTHON_RELEASE.md) |
| Go modules | `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` | v2.11.0 | [Go release](GO_RELEASE.md) |
| crates.io | [`dcp-ai`](https://crates.io/crates/dcp-ai/2.11.0) (Rust SDK) | 2.11.0 | [Rust release](RUST_RELEASE.md) |

- The npm adapters and scaffolders are optional and separate from the protocol core; their exact versions are in
  [NPM_RELEASES.md](NPM_RELEASES.md), which lists all 13 npm packages.
- Affected earlier versions and upgrade notes are in [SECURITY.md](../SECURITY.md#supported-versions); moving from
  DCP v1.0 is covered by [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md).
- In every SDK, `dcp-jcs-v1` remains the normative and default canonicalization; the `dcp-jcs-v2` APIs are
  experimental and opt-in. Verification does not establish principal trust, admission or authorization.
- This inventory covers the four registries above; it does not cover container images.

## Quick Start

- [QUICKSTART.md](QUICKSTART.md) — Produce and verify evidence with an SDK (published packages or a source checkout); demos are marked separately
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
