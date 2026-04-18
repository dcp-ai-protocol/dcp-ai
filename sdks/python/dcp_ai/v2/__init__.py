"""
DCP v2 post-quantum protocol modules.

Phase 2 additions:
  - Blinded RPR mode (PII protection)
  - Multi-party M-of-N authorization
  - Algorithm advisory system
  - Parallel/PQ-first composite verification strategies
"""

from __future__ import annotations

from dcp_ai.v2.canonicalize import assert_no_floats, canonicalize_v2
from dcp_ai.v2.composite_sig import CompositeSignature, SignatureEntry
from dcp_ai.v2.crypto_provider import CryptoProvider, KemProvider, derive_kid
from dcp_ai.v2.crypto_registry import AlgorithmRegistry, get_default_registry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS, domain_separated_message
from dcp_ai.v2.dual_hash import (
    dual_hash,
    dual_hash_canonical,
    dual_merkle_root,
    sha256_hex,
    sha3_256_hex,
)
from dcp_ai.v2.models import (
    AgentPassportV2,
    AuditEventV2,
    BlindedResponsiblePrincipalRecordV2,
    BundleManifest,
    DcpCapabilities,
    ResponsiblePrincipalRecordV2,
    IntentV2,
    KeyEntryV2,
    PolicyDecisionV2,
    PQCheckpoint,
    VerifierPolicy,
    CommissioningCertificate,
    VitalityReport,
    VitalityMetrics,
    DecommissioningRecord,
    SuccessorPreference,
    DigitalTestament,
    SuccessionRecord,
    MemoryTransferEntry,
    DualHashRef,
    MemoryTransferManifest,
    DisputeRecord,
    ArbitrationResolution,
    JurisprudenceBundle,
    ObjectionRecord,
    RightEntry,
    RightsDeclaration,
    ObligationRecord,
    RightsViolationReport,
    AuthorityScopeEntry,
    DelegationMandate,
    AdvisoryDeclaration,
    PrincipalMirror,
    InteractionRecord,
    ThresholdRule,
    AwarenessThreshold,
)
from dcp_ai.v2.signed_payload import (
    SignedPayloadData,
    prepare_payload,
    verify_payload_hash,
)
from dcp_ai.v2.composite_ops import (
    CompositeKeyInfo,
    CompositeVerifyResult,
    classical_only_sign,
    composite_sign,
    composite_verify,
)
from dcp_ai.v2.proof_of_possession import (
    create_key_rotation,
    generate_registration_pop,
    verify_key_rotation,
    verify_registration_pop,
)
from dcp_ai.v2.blinded_rpr import (
    blind_rpr,
    compute_pii_hash,
    is_blinded_rpr,
    verify_blinded_rpr,
)
from dcp_ai.v2.multi_party_auth import (
    MultiPartyAuthorization,
    MultiPartyPolicy,
    PartyAuthorization,
    verify_multi_party_authorization,
)
from dcp_ai.v2.algorithm_advisory import (
    AlgorithmAdvisory,
    AdvisoryCheckResult,
    apply_advisories_to_policy,
    check_advisory,
    evaluate_advisories,
)

__all__ = [
    "assert_no_floats",
    "canonicalize_v2",
    "CompositeSignature",
    "SignatureEntry",
    "CryptoProvider",
    "KemProvider",
    "derive_kid",
    "AlgorithmRegistry",
    "get_default_registry",
    "DCP_CONTEXTS",
    "domain_separated_message",
    "dual_hash",
    "dual_hash_canonical",
    "dual_merkle_root",
    "sha256_hex",
    "sha3_256_hex",
    "AgentPassportV2",
    "AuditEventV2",
    "BlindedResponsiblePrincipalRecordV2",
    "BundleManifest",
    "DcpCapabilities",
    "ResponsiblePrincipalRecordV2",
    "IntentV2",
    "KeyEntryV2",
    "PolicyDecisionV2",
    "PQCheckpoint",
    "VerifierPolicy",
    # DCP-05: Agent Lifecycle
    "CommissioningCertificate",
    "VitalityReport",
    "VitalityMetrics",
    "DecommissioningRecord",
    # DCP-06: Succession
    "SuccessorPreference",
    "DigitalTestament",
    "SuccessionRecord",
    "MemoryTransferEntry",
    "DualHashRef",
    "MemoryTransferManifest",
    # DCP-07: Dispute Resolution
    "DisputeRecord",
    "ArbitrationResolution",
    "JurisprudenceBundle",
    "ObjectionRecord",
    # DCP-08: Rights & Obligations
    "RightEntry",
    "RightsDeclaration",
    "ObligationRecord",
    "RightsViolationReport",
    # DCP-09: Delegation & Representation
    "AuthorityScopeEntry",
    "DelegationMandate",
    "AdvisoryDeclaration",
    "PrincipalMirror",
    "InteractionRecord",
    "ThresholdRule",
    "AwarenessThreshold",
    "SignedPayloadData",
    "prepare_payload",
    "verify_payload_hash",
    "CompositeKeyInfo",
    "CompositeVerifyResult",
    "classical_only_sign",
    "composite_sign",
    "composite_verify",
    "create_key_rotation",
    "generate_registration_pop",
    "verify_key_rotation",
    "verify_registration_pop",
    # Phase 2: Blinded RPR
    "blind_rpr",
    "compute_pii_hash",
    "is_blinded_rpr",
    "verify_blinded_rpr",
    # Phase 2: Multi-party M-of-N auth
    "MultiPartyAuthorization",
    "MultiPartyPolicy",
    "PartyAuthorization",
    "verify_multi_party_authorization",
    # Phase 2: Algorithm advisory
    "AlgorithmAdvisory",
    "AdvisoryCheckResult",
    "apply_advisories_to_policy",
    "check_advisory",
    "evaluate_advisories",
]
