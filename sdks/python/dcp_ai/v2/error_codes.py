"""
DCP v2.0 Error Codes — Python port.

Canonical error codes with the same identifiers as the TS SDK so that
cross-SDK error handling can match on a single stable string.

CBOR encode/decode remains TS-only in 2.x (third-party Python adopters
can use the `cbor2` PyPI package directly); `detect_wire_format` here is
sufficient to route an incoming byte stream to the right parser.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class DcpErrorCode(str, Enum):
    # Schema errors (E001-E099)
    BUNDLE_SCHEMA_INVALID = "DCP-E001"
    ARTIFACT_SCHEMA_INVALID = "DCP-E002"
    VERSION_UNSUPPORTED = "DCP-E003"
    MANIFEST_MISSING = "DCP-E004"

    # Signature errors (E100-E199)
    CLASSICAL_SIG_INVALID = "DCP-E100"
    PQ_SIG_INVALID = "DCP-E101"
    COMPOSITE_BINDING_INVALID = "DCP-E102"
    SIGNATURE_MISSING = "DCP-E103"
    SIGNATURE_EXPIRED = "DCP-E104"

    # Hash/Chain errors (E200-E299)
    HASH_CHAIN_BROKEN = "DCP-E200"
    MANIFEST_HASH_MISMATCH = "DCP-E201"
    MERKLE_ROOT_MISMATCH = "DCP-E202"
    DUAL_HASH_MISMATCH = "DCP-E203"
    INTENT_HASH_MISMATCH = "DCP-E204"

    # Identity errors (E300-E399)
    AGENT_REVOKED = "DCP-E300"
    KEY_EXPIRED = "DCP-E301"
    KEY_REVOKED = "DCP-E302"
    KID_MISMATCH = "DCP-E303"
    RPR_INVALID = "DCP-E304"

    # Policy errors (E400-E499)
    TIER_INSUFFICIENT = "DCP-E400"
    POLICY_VIOLATION = "DCP-E401"
    DOWNGRADE_ATTEMPT = "DCP-E402"
    CAPABILITY_DENIED = "DCP-E403"

    # Session errors (E500-E599)
    SESSION_NONCE_INVALID = "DCP-E500"
    SESSION_EXPIRED = "DCP-E501"
    SESSION_REPLAY = "DCP-E502"
    SEQUENCE_OUT_OF_ORDER = "DCP-E503"

    # A2A errors (E600-E699)
    A2A_HANDSHAKE_FAILED = "DCP-E600"
    A2A_BUNDLE_REJECTED = "DCP-E601"
    A2A_CAPABILITY_MISMATCH = "DCP-E602"
    A2A_SESSION_CLOSED = "DCP-E603"
    A2A_DECRYPT_FAILED = "DCP-E604"

    # Rate limiting (E700-E799)
    RATE_LIMIT_EXCEEDED = "DCP-E700"
    CIRCUIT_OPEN = "DCP-E701"
    BACKPRESSURE = "DCP-E702"

    # Internal (E900-E999)
    INTERNAL_ERROR = "DCP-E900"
    ALGORITHM_UNAVAILABLE = "DCP-E901"
    HSM_ERROR = "DCP-E902"


# Mapping: code -> (message, retryable). Retryable is used by call-site
# decision logic (e.g. should we back off and retry on network blips).
ERROR_DESCRIPTIONS: dict[DcpErrorCode, tuple[str, bool]] = {
    DcpErrorCode.BUNDLE_SCHEMA_INVALID: ("Bundle does not conform to DCP schema", False),
    DcpErrorCode.ARTIFACT_SCHEMA_INVALID: ("Artifact does not conform to DCP schema", False),
    DcpErrorCode.VERSION_UNSUPPORTED: ("DCP version not supported", False),
    DcpErrorCode.MANIFEST_MISSING: ("Bundle manifest is missing", False),
    DcpErrorCode.CLASSICAL_SIG_INVALID: ("Classical (Ed25519) signature verification failed", False),
    DcpErrorCode.PQ_SIG_INVALID: ("Post-quantum signature verification failed", False),
    DcpErrorCode.COMPOSITE_BINDING_INVALID: ("Composite signature binding is invalid", False),
    DcpErrorCode.SIGNATURE_MISSING: ("Required signature is missing", False),
    DcpErrorCode.SIGNATURE_EXPIRED: ("Signature has expired", False),
    DcpErrorCode.HASH_CHAIN_BROKEN: ("Audit hash chain integrity check failed", False),
    DcpErrorCode.MANIFEST_HASH_MISMATCH: ("Manifest hash does not match artifact", False),
    DcpErrorCode.MERKLE_ROOT_MISMATCH: ("Merkle root does not match audit entries", False),
    DcpErrorCode.DUAL_HASH_MISMATCH: ("Dual hash chain inconsistency detected", False),
    DcpErrorCode.INTENT_HASH_MISMATCH: ("Intent hash does not match", False),
    DcpErrorCode.AGENT_REVOKED: ("Agent has been revoked", False),
    DcpErrorCode.KEY_EXPIRED: ("Signing key has expired", False),
    DcpErrorCode.KEY_REVOKED: ("Signing key has been revoked", False),
    DcpErrorCode.KID_MISMATCH: ("Key identifier does not match public key", False),
    DcpErrorCode.RPR_INVALID: ("Responsible Principal Record is invalid", False),
    DcpErrorCode.TIER_INSUFFICIENT: ("Security tier does not meet minimum requirement", False),
    DcpErrorCode.POLICY_VIOLATION: ("Action violates policy", False),
    DcpErrorCode.DOWNGRADE_ATTEMPT: ("Security tier downgrade is not allowed", False),
    DcpErrorCode.CAPABILITY_DENIED: ("Requested capability is not authorized", False),
    DcpErrorCode.SESSION_NONCE_INVALID: ("Session nonce is invalid", False),
    DcpErrorCode.SESSION_EXPIRED: ("Session has expired", False),
    DcpErrorCode.SESSION_REPLAY: ("Session replay detected", False),
    DcpErrorCode.SEQUENCE_OUT_OF_ORDER: ("Message sequence out of order", False),
    DcpErrorCode.A2A_HANDSHAKE_FAILED: ("A2A handshake failed", True),
    DcpErrorCode.A2A_BUNDLE_REJECTED: ("Peer rejected presented bundle", False),
    DcpErrorCode.A2A_CAPABILITY_MISMATCH: ("Peer does not satisfy requested capabilities", False),
    DcpErrorCode.A2A_SESSION_CLOSED: ("A2A session is closed", False),
    DcpErrorCode.A2A_DECRYPT_FAILED: ("AES-GCM decryption failed (tag mismatch)", False),
    DcpErrorCode.RATE_LIMIT_EXCEEDED: ("Rate limit exceeded", True),
    DcpErrorCode.CIRCUIT_OPEN: ("Circuit breaker is open", True),
    DcpErrorCode.BACKPRESSURE: ("Backpressure applied — retry later", True),
    DcpErrorCode.INTERNAL_ERROR: ("Internal error", True),
    DcpErrorCode.ALGORITHM_UNAVAILABLE: ("Requested algorithm is not registered", False),
    DcpErrorCode.HSM_ERROR: ("Hardware security module reported an error", True),
}


@dataclass
class DcpError:
    code: DcpErrorCode
    message: str
    retryable: bool
    timestamp: str
    details: dict[str, Any] = field(default_factory=dict)


class DcpProtocolError(Exception):
    """Exception raised by SDK helpers when they need to surface a DcpErrorCode."""

    def __init__(self, code: DcpErrorCode, message: str | None = None, details: dict[str, Any] | None = None):
        msg, retryable = ERROR_DESCRIPTIONS.get(code, ("Unknown error", False))
        self.code = code
        self.retryable = retryable
        self.details = details or {}
        self.timestamp = _now_iso()
        super().__init__(f"[{code.value}] {message or msg}")

    def to_error(self) -> DcpError:
        msg, retryable = ERROR_DESCRIPTIONS.get(self.code, ("Unknown error", False))
        return DcpError(
            code=self.code,
            message=str(self).split("] ", 1)[1] if "] " in str(self) else msg,
            retryable=retryable,
            timestamp=self.timestamp,
            details=self.details,
        )


def create_dcp_error(
    code: DcpErrorCode,
    message: str | None = None,
    details: dict[str, Any] | None = None,
) -> DcpError:
    """Build a structured DcpError record with the shared message + retryable flag."""
    msg, retryable = ERROR_DESCRIPTIONS.get(code, ("Unknown error", False))
    return DcpError(
        code=code,
        message=message or msg,
        retryable=retryable,
        timestamp=_now_iso(),
        details=details or {},
    )


def is_dcp_error(value: Any) -> bool:
    """Return True if `value` looks like a structured DcpError."""
    if isinstance(value, DcpError):
        return True
    if isinstance(value, dict):
        return "code" in value and "message" in value and "retryable" in value
    return False


# ── Wire-format detection ──


def detect_wire_format(data: bytes) -> str:
    """Return 'json' or 'cbor' based on the first byte.

    JSON artifacts start with '{' (0x7b), '[' (0x5b), or whitespace. Anything
    else is routed to CBOR.
    """
    if not data:
        return "json"
    first = data[0]
    if first in (0x7B, 0x5B, 0x20, 0x0A, 0x0D, 0x09):
        return "json"
    return "cbor"


def _now_iso() -> str:
    ts = datetime.now(timezone.utc)
    return ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z"
