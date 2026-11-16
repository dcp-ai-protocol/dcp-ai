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

## Implementation notes (informative)

> **Added 25/10/2026. Not normative.** These notes add no requirement and change nothing above: they describe how
> the reference code on `main` relates to this text. Where they differ, the normative text above stands.

- The core artifacts exist in two wire versions. V1 (`schemas/v1/`): no manifest, no `SignedPayload` envelopes, no
  `session_nonce`, one Ed25519 signature over the bundle, and at least one audit entry. V2 (`schemas/v2/`, specified in
  [DCP-AI v2.0](../DCP-AI-v2.0.md)): a signed manifest that commits to each artifact, `SignedPayload` envelopes for the
  RPR, passport, intent and policy decision, a session nonce, composite signatures, and an audit trail that may be
  empty.
- In V2 the RPR carries the principal's `binding_keys` and the passport is signed by the agent's own keys. A bundle
  that verifies proves its signatures match the keys it lists, not who the principal is: trust comes from the
  verifier's trust set ([docs/ADMISSION.md](../../docs/ADMISSION.md)).
