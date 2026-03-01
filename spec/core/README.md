# DCP Core

This directory contains the **core specification** for the Digital Citizenship Protocol — the minimum interoperable protocol surface that every DCP implementation must support.

## What is DCP Core?

DCP Core defines the artifacts, their relationships, and the verification model that allow any verifier to evaluate:

- **Who is responsible** for an agent (Responsible Principal binding)
- **What the agent declared** it intended to do (Intent Declaration)
- **What policy outcome** was applied (Policy Decision)
- **What verifiable evidence** was produced (Action Evidence / Audit Trail)
- **How all artifacts are bundled** for portable verification (Bundle Manifest)

The core is deliberately minimal. It defines *what* must be present and *how* to verify it, but delegates *how* to sign, *which* algorithms to use, *how* agents discover each other, and *how* governance policies are enforced to **profiles**.

## Core Artifacts

| Artifact | Purpose | Existing Spec |
|----------|---------|---------------|
| Responsible Principal Record | Binds an agent to a human or legal entity | [DCP-01](../DCP-01.md) (as "Responsible Principal Record") |
| Agent Passport | Agent identity, capabilities, key material | [DCP-01](../DCP-01.md) |
| Intent Declaration | Structured pre-action declaration | [DCP-02](../DCP-02.md) |
| Policy Outcome | Authorization decision for an intent | [DCP-02](../DCP-02.md) |
| Action Evidence | Hash-chained audit entries | [DCP-03](../DCP-03.md) |
| Bundle Manifest | Portable package binding all artifacts | [BUNDLE](../BUNDLE.md) |

## Documents

- [dcp-core.md](dcp-core.md) — Editorial core specification with full rationale and artifact definitions

## Relationship to Existing Specs

The core specification is an editorial overlay that organizes the existing normative specs (DCP-01 through DCP-03, BUNDLE, VERIFICATION) into a coherent core. It does not replace them — it provides a unified view of the minimum protocol surface.

## What is NOT Core

The following are explicitly outside the core and belong to profiles or services:

- Specific cryptographic algorithms (Ed25519, ML-DSA-65, etc.) → [Crypto Profile](../profiles/crypto/)
- Agent-to-agent discovery and communication → [A2A Profile](../profiles/a2a/)
- Risk tiers, jurisdiction, revocation, governance → [Governance Profile](../profiles/governance/)
- Verification servers, anchoring, transparency logs → Infrastructure Services
