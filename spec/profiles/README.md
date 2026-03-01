# DCP Profiles

Profiles are extensions that build on [DCP Core](../core/) to address specific deployment needs. They are not required for basic interoperability — a conformant core implementation is valid without any profile.

## Available Profiles

| Profile | Scope | Directory |
|---------|-------|-----------|
| **Crypto** | Algorithm selection, hybrid/PQ signatures, composite binding, crypto-agility, verifier policy | [crypto/](crypto/) |
| **A2A** | Agent discovery, session establishment, transport bindings, message exchange | [a2a/](a2a/) |
| **Governance** | Risk tiers, jurisdiction attestation, revocation, key recovery, governance ceremonies | [governance/](governance/) |

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
