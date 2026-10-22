"""
DCP v2.0 Blinded RPR Mode — PII Protection (Gap #2).

Strips PII from ResponsiblePrincipalRecordV2 and replaces it with a salted
hash commitment, enabling publication to transparency logs without violating
GDPR Article 17 or equivalent privacy regulations. The salt (pii_salt) stays
in the full RPR.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from typing import Any

from dcp_ai.v2.models import (
    ResponsiblePrincipalRecordV2,
    BlindedResponsiblePrincipalRecordV2,
)
from dcp_ai.v2.canonicalize import canonicalize_v2

_PII_SALT_PATTERN = re.compile(r"[0-9a-f]{64}")
_MALFORMED_PII_SALT_ERROR = "pii_salt is not 32 random bytes as 64 lowercase hex"
_LEGACY_PII_HASH_WARNING = (
    "legacy unsalted pii_hash (deprecated): anyone who guesses legal_name and contact can confirm them"
)


def _is_valid_pii_salt(salt: object) -> bool:
    return isinstance(salt, str) and _PII_SALT_PATTERN.fullmatch(salt) is not None


def generate_pii_salt() -> str:
    """Generate a pii_salt: 32 random bytes as 64 lowercase hex chars.

    Set it on the full RPR before signing it, and never publish it.
    """
    return secrets.token_hex(32)


def compute_pii_hash(rpr: ResponsiblePrincipalRecordV2) -> str:
    """Compute sha256 commitment over the PII fields and pii_salt of a full RPR.

    Without pii_salt this is the legacy unsalted commitment (deprecated), kept
    so existing records can still be opened.
    """
    pii_fields: dict[str, Any] = {
        "contact": rpr.contact,
        "legal_name": rpr.legal_name,
    }
    if rpr.pii_salt is not None:
        pii_fields["pii_salt"] = rpr.pii_salt
    canonical = canonicalize_v2(pii_fields)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def blind_rpr(rpr: ResponsiblePrincipalRecordV2) -> BlindedResponsiblePrincipalRecordV2:
    """Create a blinded RPR from a full RPR, replacing PII with a salted hash.

    Raises ValueError when the RPR has no valid pii_salt: an unsalted
    commitment can be confirmed by guessing the PII.
    """
    if not _is_valid_pii_salt(rpr.pii_salt):
        raise ValueError(
            "blind_rpr requires rpr.pii_salt (32 random bytes as 64 lowercase hex): "
            "set it with generate_pii_salt() before signing the RPR"
        )
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
    """Verify a full RPR matches a blinded RPR (regulatory disclosure).

    A full RPR without pii_salt is checked against the legacy unsalted
    commitment and adds a deprecation warning; a present pii_salt that is not
    64 lowercase hex characters is an error.
    """
    errors: list[str] = []
    warnings: list[str] = []

    expected_pii_hash = compute_pii_hash(full_rpr)
    if blinded_rpr.pii_hash != expected_pii_hash:
        errors.append(
            f"pii_hash mismatch: expected {expected_pii_hash}, got {blinded_rpr.pii_hash}"
        )
    if full_rpr.pii_salt is None:
        warnings.append(_LEGACY_PII_HASH_WARNING)
    elif not _is_valid_pii_salt(full_rpr.pii_salt):
        errors.append(_MALFORMED_PII_SALT_ERROR)

    if full_rpr.human_id != blinded_rpr.human_id:
        errors.append("human_id mismatch")
    if full_rpr.session_nonce != blinded_rpr.session_nonce:
        errors.append("session_nonce mismatch")
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
    if full_rpr.binding_keys != blinded_rpr.binding_keys:
        errors.append("binding_keys mismatch")

    return {"valid": len(errors) == 0, "errors": errors, "warnings": warnings}


def is_blinded_rpr(rpr: Any) -> bool:
    """Check whether an RPR payload is blinded."""
    if isinstance(rpr, BlindedResponsiblePrincipalRecordV2):
        return True
    if isinstance(rpr, dict):
        return rpr.get("blinded") is True
    return False
