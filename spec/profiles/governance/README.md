# Governance Profile

**Status:** Editorial Draft  
**Scope:** Risk tiers, jurisdiction attestation, revocation, key recovery, and governance operations  

---

## Purpose

DCP Core defines the artifacts and verification model. The Governance Profile defines the policies, rules, and operational mechanisms that determine how those artifacts are managed over their lifecycle — who can revoke an agent, how risk levels are assigned, what jurisdictional requirements apply, and how keys are recovered.

This is explicitly outside the core because:

- Governance policies are deployment-specific (a government deployment has different rules than a startup)
- Risk tier assignment depends on the verifier's context, not the protocol structure
- Jurisdiction requirements vary by country and regulatory framework
- Key recovery and revocation mechanisms involve operational infrastructure
- Governance ceremonies require multi-party coordination that goes beyond verification

## What Lives Here (Not in Core)

### Adaptive Security Tiers

The four-tier system (routine, standard, elevated, maximum) that automatically selects cryptographic protection levels based on intent risk score, data classification, and action type.

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 14.

### Jurisdiction Attestation

Optional attestations by government or accredited authorities certifying the identity in a principal binding record for a specific jurisdiction.

See [DCP-01](../../DCP-01.md) Section "Jurisdiction Attestation" and [Government Deployment Guide](../../../docs/GOVERNMENT_DEPLOYMENT.md).

### Revocation

Mechanisms for revoking agents:

- **Standard revocation** via signed Revocation Records ([DCP-01](../../DCP-01.md))
- **Emergency revocation** via pre-registered revocation token (no signature needed)
- **Jurisdictional revocation lists** published by authorities

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 11.3 and the [AUDIT report](../../AUDIT-v2.0-FINAL.md) Gap #13.

### Key Recovery

M-of-N social recovery using Shamir's Secret Sharing, with shares encrypted via hybrid KEM.

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 11.2 and the [AUDIT report](../../AUDIT-v2.0-FINAL.md) Gap #1.

### Key Rotation

Rotation ceremony: new key signs proof-of-possession, old key counter-signs authorization, configurable grace window.

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 11.1.

### Governance Key Ceremonies

M-of-N multi-party governance operations for signing algorithm advisories and protocol decisions.

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 13.1 and the [AUDIT report](../../AUDIT-v2.0-FINAL.md) "Governance Key Ceremony".

### Verifier-Authoritative Policy

The principle that signature policy is set by the verifier's configuration, not by the agent. Including the never-downgrade rule for security tiers.

See [DCP-AI v2.0](../../DCP-AI-v2.0.md) Section 7.2.

## What Stays in Core

- The existence of a revocation commitment in the principal binding (the `revocation_token` field)
- The agent passport `status` field (active/suspended/revoked)
- The policy outcome artifact (but not how policy decisions are made)
- The audit trail (but not what governance events are recorded)

## Normative References

- [DCP-01](../../DCP-01.md) — Jurisdiction Attestation, Revocation Records
- [DCP-AI v2.0](../../DCP-AI-v2.0.md) — Sections 7.2 (Verifier Policy), 11 (Key Management), 13 (Governance), 14 (Security Tiers)
- [Government Deployment](../../../docs/GOVERNMENT_DEPLOYMENT.md) — Jurisdiction deployment playbook
- [Storage and Anchoring](../../../docs/STORAGE_AND_ANCHORING.md) — Revocation lists, transparency logs
- [Operator Guide](../../../docs/OPERATOR_GUIDE.md) — Running a verification service
