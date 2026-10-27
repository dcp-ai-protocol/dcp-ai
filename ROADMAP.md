# DCP-AI Roadmap

**Rust release (26/10/2026).** Rust `dcp-ai` 2.11.0 is published on crates.io, including verifier fixes, admission and experimental opt-in APIs. `dcp-jcs-v1` remains the normative default. See [Rust 2.11.0](docs/RUST_RELEASE.md).

**Go release (26/10/2026).** Go SDK `v2.11.0` is available from the module tag `sdks/go/v2.11.0`, including verifier fixes, admission and experimental opt-in APIs. Rust publication remains separate. See [Go v2.11.0](docs/GO_RELEASE.md).

**Python release (26/10/2026).** `dcp-ai` 2.10.0 is now available on PyPI, including the verifier fixes, admission and the experimental opt-in APIs. Go and Rust publication remains separate. See [Python 2.10.0](docs/PYTHON_RELEASE.md).

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
- Collect feedback from real integrations to inform subsequent minor releases
- Run managed reference deployments of the four services (verification, anchor, transparency-log, revocation) where community demand justifies it
- Grow the maintainer base beyond the founding maintainer (see [GOVERNANCE.md](GOVERNANCE.md))
- Publish case studies and integration patterns

### Delivered since v2.0 launch

Seven minor releases shipped on 2026-04-22..23 (v2.1.0 through v2.7.0)
closed the cross-SDK behavioral-parity gap identified by the first external
crosswalk. Before these releases, DCP-04..09 behavior lived only in the
TypeScript SDK; afterwards every core SDK speaks the same protocol surface.
v2.8.0 and v2.8.1 (2026-04-26) then pinned byte-exact canonicalization
across the four SDKs, v2.9.0 (2026-10-21) made the reference verifier
verify normative V2 bundles, and v2.10.0 (2026-10-22) made every SDK verifier enforce the
full V2 procedure, security tier included.

- **v2.1.0** — OpenTelemetry OTLP exporter for TS + Python telemetry parity.
- **v2.2.0** — DCP-05 lifecycle + DCP-06 succession ported to Python, Rust, Go.
- **v2.3.0** — DCP-07 dispute + DCP-08 rights + DCP-09 delegation / awareness / mirror ported to Python, Rust, Go (21 functions × 3 SDKs).
- **v2.4.0** — Production hardening primitives in Python, Rust, Go (session-nonce helpers, security-tier engine, emergency revocation, lazy PQ checkpoints with `PQCheckpointManager`).
- **v2.5.0** — DCP-04 Agent-to-Agent: full AES-256-GCM session layer in Python (via `cryptography`) and Go (stdlib `crypto/aes`); discovery + handshake scaffolding in Rust.
- **v2.6.0** — Blinded RPR, multi-party authorization, and algorithm-advisory helpers cross-ported from Python to Rust and Go.
- **v2.7.0** — 38 canonical `DcpErrorCode` values + `detect_wire_format` helper aligned across all four core SDKs, so cross-SDK error handling matches on a single stable string.
- **v2.8.0** — Canonicalization profile `dcp-jcs-v1` ([`spec/CANONICALIZATION_PROFILE.md`](spec/CANONICALIZATION_PROFILE.md)) pins the cases RFC 8785 leaves implementation-defined, closing the four-SDK divergence on `1.0`, `1e2` and `undefined`; 14 shared edge-case interop vectors.
- **v2.8.1** — `canonicalization_profile` manifest field wired across the four SDKs: builders emit `"dcp-jcs-v1"`, verifiers treat an absent field as `dcp-jcs-v1` and reject unknown values.
- **v2.9.0** (2026-10-21) — The reference verifier, CLI and server verify normative V2 bundles through `@dcp-ai/sdk`; Go and TypeScript canonicalization fixed against `dcp-jcs-v1`; all open dependency security alerts closed (Go and Rust 2.9.0, Python 2.8.2, `@dcp-ai/sdk` 2.1.2).
- **v2.10.0** (2026-10-22) — Verifiers in all four SDKs enforce VERIFICATION.md V2-7/V2-8, the security tier, audit-trail binding and key validity; a critical `@dcp-ai/sdk` verification bypass is fixed; the Blinded RPR commitment is salted; Python gains ML-KEM-768, FIPS 205 and V2 bundles; the services gain operator authentication, registration gates and denial-of-service limits.

<a id="in-the-repository-not-released-yet"></a>

### After v2.10.0

These changes are on `main` after the `v2.10.0` tag. As of 26 October 2026, the npm releases include SDK 2.2.0, WASM 2.1.0 and the updated adapters and CLI; see the [published package inventory](docs/NPM_RELEASES.md). Other ecosystems have separate releases. The [`[Unreleased]` section of the changelog](CHANGELOG.md#unreleased) preserves the development history; it does not mean these npm features are unavailable.

- **Admission** — trusted principals and the `strict-v1` profile ([`docs/ADMISSION.md`](docs/ADMISSION.md), [`spec/profiles/admission`](spec/profiles/admission/README.md)) in the four SDKs, the Express, FastAPI and OpenClaw integrations, the reference verifier, the server and the CLI. Verification alone still grants no trust; admission never authorizes an action.
- **Canonicalization candidate `dcp-jcs-v2`** — experimental, opt-in ingress, router, bytes verifier and producers in TypeScript, Python, Go, Rust and WASM, with a five-by-five cross matrix ([`docs/proposals/canonicalization-candidate`](docs/proposals/canonicalization-candidate/README.md)). Not normative and not active: `dcp-jcs-v1` stays the only profile, and moving the candidate to a later phase or making it a default needs its own decision.

### Out of scope for Phase 5

- First-party SaaS of the reference services (operators self-host)
- Acquiring a certification or accreditation programme (premature)

---

## Proposal: direction after v2.10

**Status:** Proposal for maintainer discussion. Nothing in this section is scheduled
or promised; an item becomes part of the roadmap only after it is accepted in an
issue or pull request of its own.

### Positioning

DCP does not compete with tool-access protocols (MCP), agent-to-agent protocols
(A2A), agent-payment protocols or the AI-agent identity drafts at the IETF (at
the time of writing, October 2026, individual submissions as far as we know). It is the accountability and evidence layer on top of them. It
answers the question those protocols leave open: who answers for what this agent
did, and how can a third party check it without trusting the operator?

### What the v2.10 round showed

- The surface is larger than the adoption: 9 specifications, 39 v2 schemas,
  5 SDKs, 10 integrations and 4 services.
- Most verifier defects found were disagreements between the four SDK verifiers,
  not flaws in a single algorithm: a verification-mode bypass in TypeScript,
  Ed25519 accepted in the post-quantum slot in Go and Rust, a null artifact
  skipped in Go, timestamps compared as text in Rust.
- Operations depend on one person (as of October 2026): the npm publishing
  credentials blocked the release of a security fix, and creating a security
  advisory needs rights the maintainer account does not have.

### Proposed priorities

1. **Operational security (weeks).** Publish without long-lived tokens (npm and
   crates.io trusted publishing, as PyPI already does). Turn every vulnerability
   of the v2.10 round into a negative vector that all four SDKs must reject.
   Differential fuzzing: the same mutated bundle goes to every verifier and any
   disagreement is a bug. An external audit. A second maintainer with admin rights.
2. **A small core and one verifier.** A DCP Core 3.0 limited to the Responsible
   Principal Record, passport, intent, policy decision, action evidence and
   bundle, with DCP-05 to DCP-09 as experimental profiles until they have
   production users. One normative verifier (candidate: the Rust crate, which
   already compiles to wasm) with bindings; the other SDKs build bundles.
3. **Delegation chains.** Human, agent, subagent, tool and payment: every hop is
   signed and may only narrow permissions, never widen them; the chain verifies
   offline back to the responsible human; a subagent cannot lower the security
   tier of whoever delegated to it (the intent already cannot lower its own).
   They extend the DCP-09 delegation mandate, which would move into the core if
   Priority 2 is adopted.
4. **Integrate, do not compete.** A signed receipt per tool call in the existing
   MCP integration; the DCP passport carried inside the A2A Agent Card (the
   `google-a2a` integration already converts between the two); HTTP Message
   Signatures (RFC 9421); accept identity from WIMSE/SPIFFE, OAuth or DIDs and
   bind it to a responsible human.
5. **Regulatory evidence.** A mapping of the audit trail to the logging,
   human-oversight and record-keeping duties of the EU AI Act (Articles 12, 14
   and 26), in the style of `docs/NIST_CONFORMITY.md`. The mapping and the
   application dates must be checked against the text in force before they are cited.

### Notes from the agent side

- Routine actions must stay cheap. If every tool call costs a post-quantum
  signature and a full bundle, nobody will adopt it. Receipts of one session can
  be gathered in a Merkle tree and signed with the hybrid scheme when the session
  closes or when the security tier is elevated.
- The main risk for an agent is not a stolen key. It is prompt injection while
  holding legitimate keys. What bounds it is the intent signed before acting, an
  independent policy decision, short-lived least-privilege mandates, and evidence
  that shows whether the action left the declared intent.
- Being able to prove that it acted within its mandate protects the agent and the
  human who answers for it.

### Not proposed

- New specifications without at least two independent implementers.
- A central service run by the project (see "Out of scope for Phase 5").
- An IETF submission before two or three integrations run in production (Phase 3
  defers it for adoption feedback; this makes the threshold concrete).

### Open questions

- Is a Core 3.0 cut acceptable given the guiding principle "additive over
  subtractive"? Moving DCP-05 to DCP-09 to experimental profiles is a breaking change.
- Which implementation becomes the normative verifier, and what is the migration
  path for the SDKs that stop verifying?
- Should delegation chains reuse an existing capability format (UCAN, Biscuit) or
  stay DCP-native?
- Who is the second maintainer, and how is admin access shared safely?

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
