"""
dcp-ai: Python SDK for the Digital Citizenship Protocol for AI Agents.

Provides models, cryptographic signing/verification, schema validation,
Merkle tree operations, and a builder for DCP Citizenship Bundles.
"""

from dcp_ai.models import (
    HumanBindingRecord,
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

__version__ = "1.0.0"

__all__ = [
    "HumanBindingRecord", "AgentPassport", "Intent", "IntentTarget",
    "PolicyDecision", "AuditEntry", "AuditEvidence",
    "CitizenshipBundle", "SignedBundle", "BundleSignature", "SignerInfo",
    "RevocationRecord", "HumanConfirmation",
    "generate_keypair", "sign_object", "verify_object", "canonicalize",
    "hash_object", "merkle_root_for_audit_entries", "intent_hash", "prev_hash_for_entry",
    "verify_signed_bundle",
    "BundleBuilder", "sign_bundle",
]
