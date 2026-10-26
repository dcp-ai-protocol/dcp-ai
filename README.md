<sub>**English** · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<div align="center">

# DCP-AI — Digital Citizenship Protocol for AI Agents

### A Portable Accountability Layer for AI Agents on Open Networks

[![Protocol](https://img.shields.io/badge/protocol-v2.0-blue)](#protocol-specifications)
[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/dcp-ai-protocol/dcp-ai/ci.yml?branch=main&label=CI)](https://github.com/dcp-ai-protocol/dcp-ai/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/dcp-ai-protocol/dcp-ai/graph/badge.svg)](https://codecov.io/gh/dcp-ai-protocol/dcp-ai)
[![Paper DOI](https://img.shields.io/badge/paper-10.5281%2Fzenodo.19040913-0077B5?logo=doi&logoColor=white)](https://doi.org/10.5281/zenodo.19040913)
[![Software DOI](https://img.shields.io/badge/software-10.5281%2Fzenodo.19656026-blue?logo=doi&logoColor=white)](https://doi.org/10.5281/zenodo.19656026)

[![npm @dcp-ai/sdk](https://img.shields.io/npm/v/@dcp-ai/sdk?label=%40dcp-ai%2Fsdk&logo=npm)](https://www.npmjs.com/package/@dcp-ai/sdk)
[![npm @dcp-ai/cli](https://img.shields.io/npm/v/@dcp-ai/cli?label=%40dcp-ai%2Fcli&logo=npm)](https://www.npmjs.com/package/@dcp-ai/cli)
[![npm @dcp-ai/wasm](https://img.shields.io/npm/v/@dcp-ai/wasm?label=%40dcp-ai%2Fwasm&logo=npm)](https://www.npmjs.com/package/@dcp-ai/wasm)
[![PyPI dcp-ai](https://img.shields.io/pypi/v/dcp-ai?label=PyPI%20dcp-ai&logo=pypi&logoColor=white)](https://pypi.org/project/dcp-ai/)
[![crates.io dcp-ai](https://img.shields.io/crates/v/dcp-ai?label=crates.io%20dcp-ai&logo=rust)](https://crates.io/crates/dcp-ai)
[![Go Reference](https://pkg.go.dev/badge/github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2.svg)](https://pkg.go.dev/github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2)
[![Docker images](https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/dcp-ai-protocol/dcp-ai/pkgs/container/dcp-ai%2Fverification)

</div>

---

## What is DCP?

The **Digital Citizenship Protocol (DCP)** defines a portable accountability layer for AI agents, allowing any verifier to evaluate:

- **Who is responsible** for an agent (Responsible Principal binding),
- **What the agent declared** it intended to do (Intent Declaration),
- **What policy outcome** was applied (Policy Decision),
- **What verifiable evidence** was produced (Audit Trail),
- **How agents are managed** throughout their lifecycle (Lifecycle Management),
- **What happens when agents transition** or are decommissioned (Digital Succession),
- **How conflicts are resolved** between agents and principals (Dispute Resolution),
- **What rights and obligations** govern agent behavior (Rights Framework), and
- **How authority is delegated** from humans to agents (Personal Representation).

DCP combines cryptographic signatures, hash chains and independent verification without requiring a central verification service. In V2, the RPR, passport, intent and policy decision are individually signed; audit entries are committed through the signed manifest rather than signed individually.

> This protocol was co-created by a human and an AI agent — designed for the collaboration it seeks to govern.

---

## Architecture

DCP is organized into three conceptual layers:

### DCP Core

The **minimum interoperable protocol** that every implementation must support. Core defines the artifacts, their relationships, and the verification model:

- **Responsible Principal Binding** — links every agent to a human or legal entity that assumes accountability
- **Agent Passport** — the agent's portable identity, capabilities, and key material
- **Intent Declaration** — structured declaration of what the agent intends to do, before it acts
- **Policy Outcome** — the authorization decision applied to an intent
- **Action Evidence** — hash-chained, tamper-evident audit entries with Merkle proofs
- **Bundle Manifest** — the portable package that binds all artifacts together for verification

See [spec/core/](spec/core/) for the core specification.

### Profiles

**Extensions and specializations** that build on top of the core but are not required for basic interoperability:

- **Crypto Profile** — algorithm selection, hybrid post-quantum signatures, crypto-agility, verifier policy ([spec/profiles/crypto/](spec/profiles/crypto/))
- **Agent-to-Agent (A2A) Profile** — discovery, handshake, session management, transport bindings ([spec/profiles/a2a/](spec/profiles/a2a/))
- **Governance Profile** — risk tiers, jurisdiction attestation, revocation, key recovery, governance ceremonies ([spec/profiles/governance/](spec/profiles/governance/))

### Services

**Operational infrastructure** that supports the protocol but is not part of the normative core:

- Verification servers, anchoring services, transparency logs, revocation registries
- These are deployment choices, not protocol requirements

---

## Protocol Specifications

| Spec | Title | Description |
|------|-------|-------------|
| [DCP-01](spec/DCP-01.md) | Identity & Human Binding | Agent identity, operator attestation, key binding |
| [DCP-02](spec/DCP-02.md) | Intent Declaration & Policy Gating | Declared intents, security tier enforcement, policy evaluation |
| [DCP-03](spec/DCP-03.md) | Audit Chain & Transparency | Hash-chained audit entries, Merkle proofs, transparency logs |
| [DCP-04](spec/DCP-04.md) | Agent-to-Agent Communication | Authenticated inter-agent messaging, delegation, trust chains |
| [DCP-05](spec/DCP-05.md) | Agent Lifecycle Management | Commission, monitor, decline, and decommission agents with state machine enforcement |
| [DCP-06](spec/DCP-06.md) | Digital Succession & Inheritance | Digital testaments, memory transfer, successor designation |
| [DCP-07](spec/DCP-07.md) | Conflict Resolution & Dispute Arbitration | Disputes, escalation levels, arbitration, jurisprudence |
| [DCP-08](spec/DCP-08.md) | Rights & Obligations Framework | Rights declarations, obligation records, violation reporting |
| [DCP-09](spec/DCP-09.md) | Personal Representation & Delegation | Delegation mandates, verifiable sub-delegation chains back to the human, awareness thresholds, principal mirrors |
| [DCP-AI v2.0](spec/DCP-AI-v2.0.md) | Post-Quantum Normative Specification | Complete v2.0 spec with hybrid PQ crypto, 4-tier security model |

See also: [Core specification](spec/core/dcp-core.md) | [Profiles overview](spec/profiles/)

---

## Quick Start

> **Published packages (26/10/2026).** npm now provides `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` and `@dcp-ai/cli` 2.1.0, and the updated adapters and scaffolders. See the [13-package inventory](docs/NPM_RELEASES.md) and [security upgrade notes](SECURITY.md#supported-versions). These npm versions include the documented verifier fixes and features; Python, Go and Rust releases are separate. To run the repository’s reference CLI and source tests, build the checkout:
>
> ```bash
> git clone https://github.com/dcp-ai-protocol/dcp-ai.git
> cd dcp-ai/sdks/typescript && npm install && npm run build
> cd ../.. && npm install
> ```

### Option A: CLI wizard (demo)

```bash
npx @dcp-ai/cli init   # the published @dcp-ai/cli
```

The interactive wizard (`@dcp-ai/cli`) asks for a name, a jurisdiction, a framework and a security tier, and writes
a `.dcp/` folder with keys and RPR-like and passport-like records. It is a demo, not a way to create a V2 identity:
its "ML-DSA-65" keys are simulated (random bytes), and the records are unsigned and do not match the V2 schemas.
To create an identity and bundles that verify, follow the Quick start of your SDK (Option B). The limits are
listed in
[Agent creation](docs/AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only).

The wizard in this repository needs `@dcp-ai/sdk` 2.2.0; from a checkout (after building the SDK as above), run it
in your project's directory:

```bash
cd /path/to/dcp-ai/cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
cd /path/to/your-project && node /path/to/dcp-ai/cli/bin/dcp-ai.js init
```

The lower-level reference CLI, `bin/dcp.js` at the root of the checkout, serves scripting and CI pipelines. It
reads and writes only inside the current directory:

```bash
cd /path/to/your-bundles
node /path/to/dcp-ai/bin/dcp.js verify-bundle --policy hybrid_preferred bundle.signed.json
```

### Option B: SDK directly

Install one of the two:

- the SDK of `main`, built from a checkout, for source development:

  ```bash
  npm install /path/to/dcp-ai/sdks/typescript
  ```

- or the published SDK 2.2.0, which includes these fixes and features:

  ```bash
  npm install @dcp-ai/sdk@^2.2.0
  ```

Verify a signed V2 bundle with the current V2 bundle verifier of `main` (signatures, hashes, session binding, the
security tier). It checks the primary audit chain, not the optional SHA3-256 secondary chain (see
[Dual Hash Chains](docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)):

```typescript
import { readFileSync } from 'node:fs';
import { getDefaultRegistry, registerDefaultProviders, verifySignedBundleV2 } from '@dcp-ai/sdk';

registerDefaultProviders();
const signedBundle = JSON.parse(readFileSync('bundle.signed.json', 'utf8'));
const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
console.log(result.verified, result.errors);
```

A verified bundle proves integrity and signature by the keys it lists, not who the principal is: to accept
evidence only from principals you trust, use [admission](docs/ADMISSION.md). Neither verification nor admission
authorizes an action. To build and sign bundles, follow
the Quick start of your SDK: [TypeScript](sdks/typescript/README.md#quick-start-v2),
[Python](sdks/python/README.md#quickstart), [Go](sdks/go/README.md#quickstart--v2),
[Rust](sdks/rust/README.md#quickstart) or [WASM](sdks/wasm/README.md#quickstart--typescript-wrapper).

---

## Security Tiers

| Tier | Verification mode | PQ checkpoint | Typical use |
|------|-------------------|---------------|-------------|
| **Routine** | `classical_only` | every 50 events | Public data reads, informational queries |
| **Standard** | `hybrid_preferred` | every 10 events | API access, standard agent operations |
| **Elevated** | `hybrid_required` | every event | Financial transactions, PII access, cross-org delegation |
| **Maximum** | `hybrid_required` | every event | Government systems, critical infrastructure, regulated industries |

The tier is computed for each action from the intent and the policy's risk score (spec §14.2), and a verifier
enforces the stricter of its own mode and the tier's (spec §14.3). Operator or multi-party attestation,
hardware-bound keys and anchoring are deployment choices: the SDKs do not require or check them at any tier.

---

## Ecosystem

```mermaid
graph TB
  subgraph sdks["SDKs (5 languages)"]
    TS["TypeScript SDK"]
    PY["Python SDK"]
    GO["Go SDK"]
    RS["Rust SDK"]
    WA["WASM Module"]
  end

  subgraph integrations["Integrations (11)"]
    EX["Express Middleware"]
    FA["FastAPI Middleware"]
    LC["LangChain"]
    OA["OpenAI"]
    CR["CrewAI"]
    AGNO["Agno (agno-dcp)"]
    OC["OpenClaw Plugin"]
    W3C["W3C DID/VC Bridge"]
    A2A["Google A2A Bridge"]
    MCP["Anthropic MCP Bridge"]
    AG["AutoGen Bridge"]
  end

  subgraph tools["Tooling"]
    CLI["CLI Wizard"]
    PG["Playground"]
    TPL["Templates"]
  end

  subgraph services["Infrastructure Services"]
    VER["Verification Server"]
    ANC["Anchoring Service"]
    TL["Transparency Log"]
    REV["Revocation Service"]
  end

  subgraph infra["Deployment"]
    SOL["Smart Contract L2"]
    GH["GitHub Actions"]
    DK["Docker Compose"]
  end

  TS --> EX
  TS --> OC
  TS --> W3C
  TS --> A2A
  TS --> MCP
  TS --> AG
  PY --> FA
  PY --> LC
  PY --> OA
  PY --> CR
  RS --> WA

  CLI --> TS
  TPL --> LC
  TPL --> CR
  TPL --> OA
  TPL --> EX

  VER -. "strict-v1 configured source" .-> REV
  ANC -. "planned on-chain submission" .-> SOL
  DK --> VER
  DK --> ANC
  DK --> TL
  DK --> REV
  GH --> VER
```

---

## SDKs

Create, sign, and verify Citizenship Bundles in your preferred language. All SDKs support DCP v2.0 and post-quantum hybrid cryptography.

| SDK | Package | Features | Docs |
|-----|---------|----------|------|
| **TypeScript** | `@dcp-ai/sdk` | BundleBuilder, hybrid PQ crypto, JSON Schema validation, Vitest | [sdks/typescript/](sdks/typescript/README.md) |
| **Python** | `dcp-ai` | Pydantic v2 models, CLI (Typer), PQ extras, optional plugins | [sdks/python/](sdks/python/README.md) |
| **Go** | `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` | Native types, hybrid signatures, bundle verification | [sdks/go/](sdks/go/README.md) |
| **Rust** | `dcp-ai` | serde, ed25519-dalek + fips203/204/205, optional WASM feature | [sdks/rust/](sdks/rust/README.md) |
| **WASM** | `@dcp-ai/wasm` | Browser verification, PQ crypto in WebAssembly, compiled from Rust | [sdks/wasm/](sdks/wasm/README.md) |

---

## Framework Integrations

Drop-in DCP governance for popular AI and web frameworks.

| Integration | Package | Pattern | Docs |
|-------------|---------|---------|------|
| **Express** | [![npm](https://img.shields.io/npm/v/@dcp-ai/express?label=%40dcp-ai%2Fexpress&logo=npm)](https://www.npmjs.com/package/@dcp-ai/express) | `dcpVerify()` middleware, `req.dcpAgent` | [integrations/express/](integrations/express/README.md) |
| **FastAPI** | [![PyPI extra](https://img.shields.io/pypi/v/dcp-ai?label=dcp-ai%5Bfastapi%5D&logo=pypi&logoColor=white)](https://pypi.org/project/dcp-ai/) | `DCPVerifyMiddleware`, `Depends(require_dcp)` | [integrations/fastapi/](integrations/fastapi/README.md) |
| **LangChain** | [![PyPI extra](https://img.shields.io/pypi/v/dcp-ai?label=dcp-ai%5Blangchain%5D&logo=pypi&logoColor=white)](https://pypi.org/project/dcp-ai/) | `DCPAgentWrapper`, `DCPTool`, `DCPCallback` | [integrations/langchain/](integrations/langchain/README.md) |
| **OpenAI** | [![PyPI extra](https://img.shields.io/pypi/v/dcp-ai?label=dcp-ai%5Bopenai%5D&logo=pypi&logoColor=white)](https://pypi.org/project/dcp-ai/) | `DCPOpenAIClient`, `DCP_TOOLS` function calling | [integrations/openai/](integrations/openai/README.md) |
| **CrewAI** | [![PyPI extra](https://img.shields.io/pypi/v/dcp-ai?label=dcp-ai%5Bcrewai%5D&logo=pypi&logoColor=white)](https://pypi.org/project/dcp-ai/) | `DCPCrewAgent`, `DCPCrew` multi-agent governance | [integrations/crewai/](integrations/crewai/README.md) |
| **Agno** | [![PyPI](https://img.shields.io/pypi/v/agno-dcp?label=agno-dcp&logo=pypi&logoColor=white&color=blue)](https://pypi.org/project/agno-dcp/) | `DCPAgent`, `DCPTeam`, `DCPWorkflow` wrappers (separate package) | [agno-dcp repo](https://github.com/dcp-ai-protocol/agno-dcp) |
| **OpenClaw** | [![npm](https://img.shields.io/npm/v/@dcp-ai/openclaw?label=%40dcp-ai%2Fopenclaw&logo=npm)](https://www.npmjs.com/package/@dcp-ai/openclaw) | Plugin + SKILL.md, 6 agent tools | [integrations/openclaw/](integrations/openclaw/README.md) |
| **W3C DID/VC** | [![npm](https://img.shields.io/npm/v/@dcp-ai/w3c-did?label=%40dcp-ai%2Fw3c-did&logo=npm)](https://www.npmjs.com/package/@dcp-ai/w3c-did) | DID Document ↔ DCP identity bridge, VC issuance | [integrations/w3c-did/](integrations/w3c-did/README.md) |
| **Google A2A** | [![npm](https://img.shields.io/npm/v/@dcp-ai/google-a2a?label=%40dcp-ai%2Fgoogle-a2a&logo=npm)](https://www.npmjs.com/package/@dcp-ai/google-a2a) | Signed DCP passport inside the A2A Agent Card (`verifyAgentCardPassport`), tasks to intents | [integrations/google-a2a/](integrations/google-a2a/README.md) |
| **Anthropic MCP** | [![npm](https://img.shields.io/npm/v/@dcp-ai/anthropic-mcp?label=%40dcp-ai%2Fanthropic-mcp&logo=npm)](https://www.npmjs.com/package/@dcp-ai/anthropic-mcp) | Signed DCP receipt per MCP tool call (`withDcpReceipt`), DCP tools and resources | [integrations/anthropic-mcp/](integrations/anthropic-mcp/README.md) |
| **AutoGen** | [![npm](https://img.shields.io/npm/v/@dcp-ai/autogen?label=%40dcp-ai%2Fautogen&logo=npm)](https://www.npmjs.com/package/@dcp-ai/autogen) | AutoGen Agent ↔ DCP wrapper, group chat governance | [integrations/autogen/](integrations/autogen/README.md) |

---

## Templates

Starter walkthroughs for common frameworks. They show where identity, intent, policy, audit logging and bundle
sealing fit, with placeholder keys and signatures (`«generated»`, `«sig»`): they generate no keys, sign nothing,
and their bundles do not verify. The Express template's middleware checks bundle structure only, not signatures or
admission. For real keys, signatures and verification, use the [quickstarts](docs/README.md) and the
[framework integrations](#framework-integrations).

| Template | Description | Command |
|----------|-------------|---------|
| **LangChain** | LangChain.js call wrapped in the DCP flow, with placeholder signatures | `npm create @dcp-ai/langchain my-app` |
| **CrewAI** | Multi-agent crew simulation with DCP passports and audit trail, with placeholder signatures | `npm create @dcp-ai/crewai my-app` |
| **OpenAI** | OpenAI function calling with DCP intent, policy and audit wrapping, with placeholder signatures | `npm create @dcp-ai/openai my-app` |
| **Express** | Express server with a structural DCP check (no signature verification) and discovery endpoints | `npm create @dcp-ai/express my-app` |

`npm create @dcp-ai/<name>` runs the `@dcp-ai/create-<name>` scaffolder, which copies the template into a new
folder. See [templates/](templates/) for full source.

---

## Playground

An interactive web-based playground for exploring DCP concepts — create identities, declare intents, sign bundles, and verify signatures directly in the browser. Its cryptography runs locally with `tweetnacl` and Web Crypto. It is a demonstration: its post-quantum
signatures are simulated and its canonical form and Merkle root are simplified, so what it builds is not evidence
and need not verify with the SDK verifiers (see its [limitations](playground/README.md#limitations)).

```bash
# From the repository root; ES modules require HTTP, not file://
python3 -m http.server 8080 --bind 127.0.0.1 --directory playground
# Open http://localhost:8080 in your browser
```

See [playground/](playground/) for details.

---

## Infrastructure Services

Backend services for anchoring, transparency, and revocation. These are operational components — not part of the normative core protocol.

| Service | Port | Description | Docs |
|---------|------|-------------|------|
| **Verification** | 3000 | HTTP API for verifying Signed Bundles | [server/](server/README.md) |
| **Anchoring** | 3001 | Merkle batching of bundle hashes, recorded locally; on-chain submission is not implemented | [services/anchor/](services/anchor/README.md) |
| **Transparency Log** | 3002 | CT-style Merkle log with inclusion proofs | [services/transparency-log/](services/transparency-log/README.md) |
| **Revocation** | 3003 | Agent revocation registry + `.well-known` | [services/revocation/](services/revocation/README.md) |

Deploy all services with one command:

```bash
cd docker && docker compose up -d
```

---

## Documentation

### Normative Specifications

| Document | Description |
|----------|-------------|
| [DCP-01](spec/DCP-01.md) | Identity & Human Binding |
| [DCP-02](spec/DCP-02.md) | Intent Declaration & Policy Gating |
| [DCP-03](spec/DCP-03.md) | Audit Chain & Transparency |
| [DCP-04](spec/DCP-04.md) | Agent-to-Agent Communication |
| [DCP-05](spec/DCP-05.md) | Agent Lifecycle Management |
| [DCP-06](spec/DCP-06.md) | Digital Succession & Inheritance |
| [DCP-07](spec/DCP-07.md) | Conflict Resolution & Dispute Arbitration |
| [DCP-08](spec/DCP-08.md) | Rights & Obligations Framework |
| [DCP-09](spec/DCP-09.md) | Personal Representation & Delegation |
| [DCP-AI v2.0](spec/DCP-AI-v2.0.md) | Post-Quantum Normative Specification |
| [BUNDLE](spec/BUNDLE.md) | Citizenship Bundle format |
| [VERIFICATION](spec/VERIFICATION.md) | Verification procedures & checklist |
| [CANONICALIZATION_PROFILE](spec/CANONICALIZATION_PROFILE.md) | Canonical JSON profile `dcp-jcs-v1` behind every signature and hash |
| [DCP Core](spec/core/dcp-core.md) | Core protocol editorial specification |
| [Profiles](spec/profiles/README.md) | Optional profiles: crypto, A2A, governance and admission (`strict-v1`) |

### Getting Started

| Guide | Description |
|-------|-------------|
| [QUICKSTART](docs/QUICKSTART.md) | General quick start guide |
| [QUICKSTART_LANGCHAIN](docs/QUICKSTART_LANGCHAIN.md) | LangChain integration walkthrough |
| [QUICKSTART_CREWAI](docs/QUICKSTART_CREWAI.md) | CrewAI multi-agent setup |
| [QUICKSTART_AGNO](docs/QUICKSTART_AGNO.md) | Agno agents, teams and workflows with `agno-dcp` (live demo) |
| [QUICKSTART_OPENAI](docs/QUICKSTART_OPENAI.md) | OpenAI function-calling integration |
| [QUICKSTART_EXPRESS](docs/QUICKSTART_EXPRESS.md) | Express middleware setup |

### API Reference

| Document | Description |
|----------|-------------|
| [OpenAPI Spec](api/openapi.yaml) | REST API (OpenAPI 3.1) |
| [Protocol Buffers](api/proto/) | gRPC service definitions |
| [API README](api/README.md) | API overview and usage |

### Architecture & Security

| Document | Description |
|----------|-------------|
| [TECHNICAL_ARCHITECTURE](docs/TECHNICAL_ARCHITECTURE.md) | System architecture for global-scale deployment |
| [SECURITY_MODEL](docs/SECURITY_MODEL.md) | Threat model, attack vectors, protection layers |
| [STORAGE_AND_ANCHORING](docs/STORAGE_AND_ANCHORING.md) | P2P storage, optional blockchain anchoring |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Map of the repository for contributors |

### Testing & Assurance

| Tool | Description |
|------|-------------|
| [Interop matrix](tools/interop-matrix/README.md) | Live agents on the four SDKs (and the reference verifier) create, sign and verify each other's citizenship bundles, untouched and tampered with in transit |
| [Differential fuzzer](tools/difffuzz/README.md) | The same mutated signed bundle through the four SDK verifiers; any disagreement is a finding |
| [Shared vectors](tests/interop/v2/) | Bundles, mandate chains and attack cases every SDK must accept or reject the same way |

### Guides

| Guide | Description |
|-------|-------------|
| [AGENT_CREATION_AND_CERTIFICATION](docs/AGENT_CREATION_AND_CERTIFICATION.md) | P2P agent creation flow, DCP certification |
| [OPERATOR_GUIDE](docs/OPERATOR_GUIDE.md) | Running a verification service |
| [MIGRATION_V1_V2](docs/MIGRATION_V1_V2.md) | Migrating from DCP v1.0 to v2.0 |
| [ADMISSION](docs/ADMISSION.md) | Accepting bundles only from trusted principals, optionally under `strict-v1` |
| [OBSERVABILITY](docs/OBSERVABILITY.md) | OpenTelemetry traces and metrics from the SDKs |

### Proposals (experimental, not normative)

| Document | Description |
|----------|-------------|
| [Canonicalization candidate `dcp-jcs-v2`](docs/proposals/canonicalization-candidate/README.md) | Experimental candidate profile, disabled by default, its design and opt-in SDK APIs; `dcp-jcs-v1` remains the default and the only normative canonicalization profile |

### Standards Alignment

| Document | Description |
|----------|-------------|
| [NIST_CONFORMITY](docs/NIST_CONFORMITY.md) | NIST post-quantum cryptography conformance |
| [EU_AI_ACT_MAPPING](docs/EU_AI_ACT_MAPPING.md) | EU AI Act logging, human oversight and record-keeping obligations mapped to DCP artifacts |
| [ROADMAP](ROADMAP.md) | Project evolution roadmap |

### Community

| Document | Description |
|----------|-------------|
| [EARLY_ADOPTERS](docs/EARLY_ADOPTERS.md) | Early adopter program and case studies |
| [CONTRIBUTING](CONTRIBUTING.md) | Contribution guidelines |
| [GOVERNANCE](GOVERNANCE.md) | Project governance model |

### Vision

| Document | Description |
|----------|-------------|
| [GENESIS_PAPER](docs/GENESIS_PAPER.md) | Founding whitepaper |

---

## Cryptographic Algorithms

DCP v2.0 employs a hybrid cryptographic architecture for quantum-resistant security. Algorithm selection and crypto-agility are governed by the [Crypto Profile](spec/profiles/crypto/).

This table describes the protocol design. The SDKs do not execute the combined X25519 + ML-KEM-768 exchange; the caller supplies the A2A session key. Current V2 bundle verifiers do not recompute the optional secondary audit chain or secondary Merkle root. See [NIST conformity](docs/NIST_CONFORMITY.md) and the [security model](docs/SECURITY_MODEL.md) for implementation limits.

| Algorithm | Standard | Purpose |
|-----------|----------|---------|
| **Ed25519** | RFC 8032 | Classical digital signatures |
| **ML-DSA-65** | FIPS 204 | Post-quantum digital signatures (Dilithium) |
| **ML-KEM-768** | FIPS 203 | Post-quantum key encapsulation mechanism (Kyber) |
| **SLH-DSA-192f** | FIPS 205 | Hash-based backup signatures (SPHINCS+) |
| **X25519 + ML-KEM-768** | Hybrid | Combined classical + PQ key exchange |
| **SHA-256 + SHA3-256** | FIPS 180-4 / FIPS 202 | Dual hash chains for audit integrity |

---

## Repository Layout

```
dcp-ai/
├── spec/                    # Normative specifications (DCP-01 through DCP-09, v2.0)
│   ├── core/                # DCP Core editorial specification
│   └── profiles/            # Profile specifications (crypto, a2a, governance, admission)
├── schemas/                 # JSON Schemas (draft 2020-12, v2 includes DCP-05–09)
├── tools/                   # Validation, conformance, crypto + Merkle helpers
│   ├── interop-matrix/      # Live interoperability between agents on the four SDKs
│   ├── difffuzz/            # Differential fuzzer of the four V2 verifiers
│   └── canonicalization-lab/ # Design model of the dcp-jcs-v2 candidate
├── tests/                   # Conformance tests, fixtures, interop vectors (tests/interop/candidate: experimental)
├── bin/dcp.js               # Reference CLI
├── cli/                     # Interactive CLI wizard (@dcp-ai/cli)
├── sdks/
│   ├── typescript/          # TypeScript SDK (@dcp-ai/sdk)
│   ├── python/              # Python SDK (dcp-ai)
│   ├── go/                  # Go SDK
│   ├── rust/                # Rust SDK (dcp-ai)
│   └── wasm/                # WASM module (@dcp-ai/wasm)
├── integrations/
│   ├── express/             # Express middleware
│   ├── fastapi/             # FastAPI middleware
│   ├── langchain/           # LangChain integration
│   ├── openai/              # OpenAI integration
│   ├── crewai/              # CrewAI integration
│   ├── openclaw/            # OpenClaw plugin
│   ├── w3c-did/             # W3C DID/VC bridge
│   ├── google-a2a/          # Google A2A bridge
│   ├── anthropic-mcp/       # Anthropic MCP bridge
│   └── autogen/             # Microsoft AutoGen bridge
├── templates/               # Framework templates (langchain, crewai, openai, express)
├── packages/create-*/       # npm create @dcp-ai/<name> scaffolders
├── playground/              # Web-based interactive playground
├── server/                  # Reference verification server
├── services/
│   ├── anchor/              # Blockchain anchoring service
│   ├── transparency-log/    # CT-style Merkle transparency log
│   └── revocation/          # Agent revocation registry
├── contracts/ethereum/      # DCPAnchor.sol for EVM L2
├── docker/                  # Docker Compose + multi-stage Dockerfile
├── api/                     # OpenAPI 3.1 + Protocol Buffers (gRPC)
├── docs/                    # Guides, architecture, standards alignment; docs/proposals: experimental designs
└── .github/                 # CI/CD workflows + reusable GitHub Actions
```

---

## Development

```bash
# Build the workspace SDK first: the root uses it to test the checked-out source
(cd sdks/typescript && npm install && npm run build)

# Install dependencies
npm install

# Run tests
npm test

# Run protocol conformance suite
npm run conformance

# Cross-SDK checks (build sdks/typescript first; needs Python, Go and Rust)
node tools/interop-matrix/run.mjs
node tools/difffuzz/run.mjs

# Start verification server (port 3000)
npm run server
```

---

## Contributing

We welcome contributions from both humans and AI agents.

- Read the [Contributing Guide](CONTRIBUTING.md) for development workflow and standards.
- See [Governance](GOVERNANCE.md) for decision-making processes and roles.

---

## Citation

If you use DCP-AI in your research, please cite both the paper (the conceptual framework) and the software release (the specific implementation you used).

**Paper**

> Naranjo Emparanza, D. (2026). *Agents Don't Need a Better Brain — They Need a World: Toward a Digital Citizenship Protocol for Autonomous AI Systems*. Zenodo. https://doi.org/10.5281/zenodo.19040913

**Software**

Cite the release you used. The concept DOI [`10.5281/zenodo.19656025`](https://doi.org/10.5281/zenodo.19656025)
resolves to the latest archived version; the v2.0.2 release has its own:

> Naranjo Emparanza, D. (2026). *DCP-AI v2.0.2 — Digital Citizenship Protocol for AI Agents (Reference Implementation)*. Zenodo. https://doi.org/10.5281/zenodo.19656026

See [`CITATION.cff`](CITATION.cff) for a machine-readable format.

---

## License

[Apache-2.0](LICENSE)

---

<div align="center">

*"This protocol was co-created by a human and an AI agent — the first protocol designed for AI digital citizenship, built by the very collaboration it seeks to govern."*

</div>
