# DCP Profiles

Profiles are extensions that build on [DCP Core](../core/) to address specific deployment needs. They are not required for basic interoperability — a conformant core implementation is valid without any profile.

## Available Profiles

| Profile | Scope | Directory |
|---------|-------|-----------|
| **Crypto** | Algorithm selection, hybrid/PQ signatures, composite binding, crypto-agility, verifier policy | [crypto/](crypto/) |
| **A2A** | Agent discovery, session establishment, transport bindings, message exchange | [a2a/](a2a/) |
| **Governance** | Risk tiers, jurisdiction attestation, revocation, key recovery, governance ceremonies | [governance/](governance/) |
| **Admission** | Principal trust sets and the operator-fixed `strict-v1` profile on top of verification | [admission/](admission/) |

## Design Principles

- Profiles MUST NOT contradict DCP Core requirements
- Profiles MAY define additional artifacts, fields, or verification steps
- Profiles MAY specify algorithm choices, transport bindings, or governance policies
- A conformant core implementation is valid without any profile
- Profiles are versioned independently of the core

## Relationship to Existing Specs

The profile structure provides an organizational framework for material that already exists in the repository:

- The **Crypto Profile** draws from [DCP-AI v2.0](../DCP-AI-v2.0.md) Sections 2–5 (algorithms, composite signatures, verification modes)
- The **A2A Profile** draws from [DCP-04](../DCP-04.md) (agent-to-agent communication)
- The **Governance Profile** draws from [DCP-AI v2.0](../DCP-AI-v2.0.md) Sections 13–14 (governance, adaptive security tiers) and [DCP-01](../DCP-01.md) (jurisdiction attestation, revocation)

The existing normative specs remain authoritative. These profile READMEs provide editorial context and explain the separation between core and profile concerns.

## Implementation notes (informative)

> **Added 25/10/2026. Not normative.** These notes add no requirement and change nothing above: they describe how
> the reference code on `main` relates to this text. Where they differ, the normative text above stands.

- "Valid without any profile" is about interoperability of the core artifacts. It does not exempt an implementation
  from the Core requirements, and a deployment still applies its own verifier policy (for example the verification
  mode a risk tier requires) and, where it uses one, the admission profile.
- A bundle that verifies is internally consistent and signed by the keys it lists itself; that alone does not make
  its principal trusted, admit it or authorize an action. Trust in a principal comes from the verifier's own trust
  set: see [docs/ADMISSION.md](../../docs/ADMISSION.md) and the [admission profile](admission/).
