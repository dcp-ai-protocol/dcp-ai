"""
dcp-ai: Python SDK for the Digital Citizenship Protocol for AI Agents.

Provides models, cryptographic signing/verification, schema validation,
Merkle tree operations, and a builder for DCP Citizenship Bundles.
"""

from __future__ import annotations

from typing import Any

from dcp_ai.models import (
    ResponsiblePrincipalRecord,
    AgentPassport,
    Intent,
    IntentTarget,
    PolicyDecision,
    AuditEntry,
    AuditEvidence,
    CitizenshipBundle,
    SignedBundle,
    BundleSignature,
    SignerInfo,
    RevocationRecord,
    HumanConfirmation,
)
from dcp_ai.crypto import generate_keypair, sign_object, verify_object, canonicalize
from dcp_ai.merkle import hash_object, merkle_root_for_audit_entries, intent_hash, prev_hash_for_entry
from dcp_ai.verify import verify_signed_bundle
from dcp_ai.bundle import BundleBuilder, sign_bundle

import dcp_ai.v2 as v2

__version__ = "1.0.0"


def detect_dcp_version(artifact: dict[str, Any]) -> str | None:
    """Detect the DCP protocol version from an artifact dict.

    Checks dcp_version, dcp_bundle_version, and bundle.dcp_bundle_version fields.
    Returns "1.0", "2.0", or None if unrecognised.
    """
    version = artifact.get("dcp_version")
    if version in ("1.0", "2.0"):
        return version

    bundle_version = artifact.get("dcp_bundle_version")
    if bundle_version == "2.0":
        return "2.0"

    nested_version = artifact.get("bundle", {}).get("dcp_bundle_version")
    if nested_version == "2.0":
        return "2.0"

    return None


__all__ = [
    "ResponsiblePrincipalRecord", "AgentPassport", "Intent", "IntentTarget",
    "PolicyDecision", "AuditEntry", "AuditEvidence",
    "CitizenshipBundle", "SignedBundle", "BundleSignature", "SignerInfo",
    "RevocationRecord", "HumanConfirmation",
    "generate_keypair", "sign_object", "verify_object", "canonicalize",
    "hash_object", "merkle_root_for_audit_entries", "intent_hash", "prev_hash_for_entry",
    "verify_signed_bundle",
    "BundleBuilder", "sign_bundle",
    "v2",
    "detect_dcp_version",
]
