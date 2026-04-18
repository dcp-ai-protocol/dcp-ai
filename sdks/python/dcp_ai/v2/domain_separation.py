"""
Domain separation context tags for DCP v2 signing operations.
"""

from __future__ import annotations

DCP_CONTEXTS: dict[str, str] = {
    "AgentPassport": "DCP-AI.v2.AgentPassport",
    "ResponsiblePrincipal": "DCP-AI.v2.ResponsiblePrincipal",
    "Intent": "DCP-AI.v2.Intent",
    "PolicyDecision": "DCP-AI.v2.PolicyDecision",
    "AuditEvent": "DCP-AI.v2.AuditEvent",
    "Bundle": "DCP-AI.v2.Bundle",
    "Revocation": "DCP-AI.v2.Revocation",
    "KeyRotation": "DCP-AI.v2.KeyRotation",
    "ProofOfPossession": "DCP-AI.v2.ProofOfPossession",
    "JurisdictionAttestation": "DCP-AI.v2.JurisdictionAttestation",
    "HumanConfirmation": "DCP-AI.v2.HumanConfirmation",
    "MultiPartyAuth": "DCP-AI.v2.MultiPartyAuth",
    "Lifecycle": "DCP-AI.v2.Lifecycle",
    "Succession": "DCP-AI.v2.Succession",
    "Dispute": "DCP-AI.v2.Dispute",
    "Rights": "DCP-AI.v2.Rights",
    "Delegation": "DCP-AI.v2.Delegation",
    "Awareness": "DCP-AI.v2.Awareness",
}

_VALID_CONTEXTS = frozenset(DCP_CONTEXTS.values())


def domain_separated_message(context: str, canonical_payload_bytes: bytes) -> bytes:
    """Build a domain-separated message: UTF8(context) || 0x00 || canonical_payload_bytes.

    Raises ValueError if context is not a recognised DCP v2 context tag.
    """
    if context not in _VALID_CONTEXTS:
        raise ValueError(
            f"Unknown domain separation context: {context!r}. "
            f"Valid contexts: {sorted(_VALID_CONTEXTS)}"
        )
    return context.encode("utf-8") + b"\x00" + canonical_payload_bytes
