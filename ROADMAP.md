# DCP-AI Roadmap

This document describes the planned evolution of the DCP-AI project. The roadmap is organized in phases that can overlap but must respect dependency order.

---

## Phase 1 — Stabilize Core Semantics

**Status:** Complete

Define and document the minimum interoperable protocol surface — the artifacts, relationships, and verification model that every DCP implementation must support.

- ✅ `spec/core/dcp-core.md` published as the editorial core specification
- ✅ Core vs. profile-scoped artifacts delineated
- ✅ Responsible Principal Record (RPR) established as the definitive terminology
- ✅ Verification model documented independently of cryptographic algorithm choices
- ✅ Cross-references wired between the core specification and DCP-01 through DCP-09 plus DCP-AI v2.0

### Deliverables

- `spec/core/dcp-core.md` — editorial core specification
- `spec/core/README.md` — core index and rationale
- `README.md` presenting DCP Core / Profiles / Services architecture

---

## Phase 2 — Separate Profiles

**Status:** Complete for README coverage; normative profile documents ongoing.

Factor out algorithm-specific, transport-specific, and governance-specific details into profile documents that extend the core without being required for basic interoperability.

- **Crypto Profile** — algorithm registry, hybrid/PQ signatures, composite binding, crypto-agility, verifier policy
- **A2A Profile** — agent discovery, handshake protocol, session management, transport bindings
- **Governance Profile** — risk tiers, jurisdiction attestation, revocation policy, key recovery, governance ceremonies

### Deliverables

- `spec/profiles/crypto/README.md`
- `spec/profiles/a2a/README.md`
- `spec/profiles/governance/README.md`
- Profile-specific normative documents (future, beyond initial READMEs)

### Principles

- Profiles MUST NOT contradict the core
- Profiles MAY define additional artifacts, fields, or verification steps
- A conformant core implementation is valid without any profile
- Profiles are versioned independently of the core

---

## Phase 3 — Standards Positioning

**Status:** Deferred

Formal standards submission (IETF Internet-Draft, W3C working group adoption, or DIF contribution) is deferred until the protocol has real-world adoption feedback from early adopters. The reasoning: standards bodies favour designs with production use under their belt, and the ~12-month turnaround of a typical draft is better spent after v2.0.x has been exercised by actual integrations rather than before.

When resumed, candidate forums include:

- **IETF** — for the wire-format / canonicalization / verification-policy subset
- **W3C** — for the Verifiable-Credentials integration layer
- **DIF (Decentralized Identity Foundation)** — for the agent-identity model

In the meantime the project's specs remain citable via Zenodo (paper DOI [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913), software DOI [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)).

---

## Phase 4 — Align Schemas and Implementations

**Status:** Substantially complete with v2.0.x shipped.

- ✅ RPR-named schemas validated across all five SDKs (TS, Python, Go, Rust, WASM)
- ✅ Cross-SDK conformance tests running on every CI push (`tests/interop/v2/`)
- ✅ 39 v2 JSON Schemas + 9 v1 schemas published under `schemas/`
- 🔄 Separation of core-only vs. full conformance (future refinement — current suite runs as a single matrix)
- 🔄 Profile-specific JSON Schemas under `schemas/profiles/` (future — current profiles are descriptive READMEs)

### Principles

- RPR terminology is the canonical naming across all artifacts
- Conformance tests for core are a strict subset of full conformance

---

## Phase 5 — Adoption and operations

**Status:** In progress

With the stack shipped, the next phase is adoption:

- Attract early adopters per the [Early Adopter Program](docs/EARLY_ADOPTERS.md)
- Collect feedback from real integrations to inform v2.1
- Run managed reference deployments of the four services (verification, anchor, transparency-log, revocation) where community demand justifies it
- Grow the maintainer base beyond the founding maintainer (see [GOVERNANCE.md](GOVERNANCE.md))
- Publish case studies and integration patterns

### Out of scope for Phase 5

- First-party SaaS of the reference services (operators self-host)
- Acquiring a certification or accreditation programme (premature)

---

## Out of Scope (general)

The following remain explicitly deferred:

- Schema field renames without backward-compatible aliases
- Breaking changes to published registry packages without a clean major-version transition
- Centralised runtime infrastructure owned by the project itself

---

## Guiding Principles

1. **Non-destructive migration** — every change must be reversible and must not break existing imports, tests, or scripts
2. **Editorial first** — documentation and conceptual clarity precede code changes
3. **Additive over subtractive** — prefer creating new files and cross-references over moving or deleting existing ones
4. **Core minimalism** — the core should define the smallest useful protocol surface; everything else is a profile or a service
5. **Interoperability focus** — the core must be implementable in any language without framework-specific dependencies
