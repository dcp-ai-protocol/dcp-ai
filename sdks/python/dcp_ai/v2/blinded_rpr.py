"""
DCP v2.0 Blinded RPR Mode — PII Protection (Gap #2).

Strips PII from ResponsiblePrincipalRecordV2 and replaces it with a hash
commitment, enabling publication to transparency logs without violating
GDPR Article 17 or equivalent privacy regulations.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from dcp_ai.v2.models import (
    ResponsiblePrincipalRecordV2,
    BlindedResponsiblePrincipalRecordV2,
)
from dcp_ai.v2.canonicalize import canonicalize_v2


def compute_pii_hash(rpr: ResponsiblePrincipalRecordV2) -> str:
    """Compute sha256 commitment over the PII fields of a full RPR."""
    pii_fields = {
        "contact": rpr.contact,
        "legal_name": rpr.legal_name,
    }
    canonical = canonicalize_v2(pii_fields)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def blind_rpr(rpr: ResponsiblePrincipalRecordV2) -> BlindedResponsiblePrincipalRecordV2:
    """Create a blinded RPR from a full RPR, replacing PII with a hash."""
    pii_hash = compute_pii_hash(rpr)
    return BlindedResponsiblePrincipalRecordV2(
        dcp_version="2.0",
        human_id=rpr.human_id,
        session_nonce=rpr.session_nonce,
        blinded=True,
        pii_hash=pii_hash,
        entity_type=rpr.entity_type,
        jurisdiction=rpr.jurisdiction,
        liability_mode=rpr.liability_mode,
        override_rights=rpr.override_rights,
        issued_at=rpr.issued_at,
        expires_at=rpr.expires_at,
        binding_keys=rpr.binding_keys,
    )


def verify_blinded_rpr(
    full_rpr: ResponsiblePrincipalRecordV2,
    blinded_rpr: BlindedResponsiblePrincipalRecordV2,
) -> dict[str, Any]:
    """Verify a full RPR matches a blinded RPR (regulatory disclosure)."""
    errors: list[str] = []

    expected_pii_hash = compute_pii_hash(full_rpr)
    if blinded_rpr.pii_hash != expected_pii_hash:
        errors.append(
            f"pii_hash mismatch: expected {expected_pii_hash}, got {blinded_rpr.pii_hash}"
        )

    if full_rpr.human_id != blinded_rpr.human_id:
        errors.append("human_id mismatch")
    if full_rpr.entity_type != blinded_rpr.entity_type:
        errors.append("entity_type mismatch")
    if full_rpr.jurisdiction != blinded_rpr.jurisdiction:
        errors.append("jurisdiction mismatch")
    if full_rpr.liability_mode != blinded_rpr.liability_mode:
        errors.append("liability_mode mismatch")
    if full_rpr.override_rights != blinded_rpr.override_rights:
        errors.append("override_rights mismatch")
    if full_rpr.issued_at != blinded_rpr.issued_at:
        errors.append("issued_at mismatch")
    if full_rpr.expires_at != blinded_rpr.expires_at:
        errors.append("expires_at mismatch")

    return {"valid": len(errors) == 0, "errors": errors}


def is_blinded_rpr(rpr: Any) -> bool:
    """Check whether an RPR payload is blinded."""
    if isinstance(rpr, BlindedResponsiblePrincipalRecordV2):
        return True
    if isinstance(rpr, dict):
        return rpr.get("blinded") is True
    return False
