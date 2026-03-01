# DCP-AI Roadmap

This document describes the planned evolution of the DCP-AI project. The roadmap is organized in phases that can overlap but must respect dependency order.

---

## Phase 1 — Stabilize Core Semantics

**Status:** In progress

Define and document the minimum interoperable protocol surface — the artifacts, relationships, and verification model that every DCP implementation must support.

- Publish `spec/core/dcp-core.md` as the editorial core specification
- Clarify which artifacts are core vs. profile-scoped
- Establish Responsible Principal Record (RPR) as the definitive terminology
- Document the verification model independently of cryptographic algorithm choices
- Establish cross-references between the core specification and the existing normative specs (DCP-01 through DCP-04, DCP-AI v2.0)

### Deliverables

- `spec/core/dcp-core.md` — editorial core specification
- `spec/core/README.md` — core index and rationale
- Updated `README.md` presenting DCP Core / Profiles / Services architecture

---

## Phase 2 — Separate Profiles

**Status:** In progress

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

## Phase 3 — Prepare IETF Positioning

**Status:** Planning

Evaluate which parts of DCP are suitable for IETF standardization and prepare the positioning strategy.

- Identify the subset of DCP Core that could form an Internet-Draft
- Document what should stay outside the IETF track (profiles, services, implementation details)
- Review the existing `docs/IETF_DRAFT.md` for alignment with the core/profiles separation
- Articulate the IETF standardization strategy

### Deliverables

- Updated `docs/IETF_DRAFT.md` aligned with stabilized core
- Gap analysis between current IETF draft and the stabilized core

---

## Phase 4 — Align Schemas and Implementations

**Status:** Future

Once core semantics and profile boundaries are stable, align the runtime artifacts:

- Validate RPR-named schemas across all SDKs and implementations
- Align conformance tests with the core/profiles structure
- Update CI to validate core conformance independently of profile conformance
- Publish profile-specific JSON Schemas under `schemas/profiles/`

### Principles

- RPR terminology is the canonical naming across all artifacts
- Conformance tests for core are a strict subset of full conformance

---

## Out of Scope (for now)

The following are explicitly deferred:

- Runtime refactoring of SDKs or services
- Removal of legacy files or compatibility shims
- Changes to CI/CD pipelines
- Changes to `package.json`, `pyproject.toml`, `Cargo.toml`, or `go.mod`
- Schema field renames without backward-compatible aliases

---

## Guiding Principles

1. **Non-destructive migration** — every change must be reversible and must not break existing imports, tests, or scripts
2. **Editorial first** — documentation and conceptual clarity precede code changes
3. **Additive over subtractive** — prefer creating new files and cross-references over moving or deleting existing ones
4. **Core minimalism** — the core should define the smallest useful protocol surface; everything else is a profile or a service
5. **Interoperability focus** — the core must be implementable in any language without framework-specific dependencies
