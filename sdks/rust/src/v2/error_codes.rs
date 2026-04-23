//! DCP v2.0 Canonical error codes — Rust port.

use std::fmt;

/// DCP canonical error code. The display representation (e.g. `DCP-E100`)
/// is the stable identifier shared across SDKs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DcpErrorCode {
    // Schema errors (E001-E099)
    BundleSchemaInvalid,
    ArtifactSchemaInvalid,
    VersionUnsupported,
    ManifestMissing,
    // Signature errors (E100-E199)
    ClassicalSigInvalid,
    PqSigInvalid,
    CompositeBindingInvalid,
    SignatureMissing,
    SignatureExpired,
    // Hash/Chain errors (E200-E299)
    HashChainBroken,
    ManifestHashMismatch,
    MerkleRootMismatch,
    DualHashMismatch,
    IntentHashMismatch,
    // Identity errors (E300-E399)
    AgentRevoked,
    KeyExpired,
    KeyRevoked,
    KidMismatch,
    RprInvalid,
    // Policy errors (E400-E499)
    TierInsufficient,
    PolicyViolation,
    DowngradeAttempt,
    CapabilityDenied,
    // Session errors (E500-E599)
    SessionNonceInvalid,
    SessionExpired,
    SessionReplay,
    SequenceOutOfOrder,
    // A2A errors (E600-E699)
    A2aHandshakeFailed,
    A2aBundleRejected,
    A2aCapabilityMismatch,
    A2aSessionClosed,
    A2aDecryptFailed,
    // Rate limiting (E700-E799)
    RateLimitExceeded,
    CircuitOpen,
    Backpressure,
    // Internal (E900-E999)
    InternalError,
    AlgorithmUnavailable,
    HsmError,
}

impl DcpErrorCode {
    /// The stable string identifier (e.g. `DCP-E100`).
    pub fn code(&self) -> &'static str {
        use DcpErrorCode::*;
        match self {
            BundleSchemaInvalid => "DCP-E001",
            ArtifactSchemaInvalid => "DCP-E002",
            VersionUnsupported => "DCP-E003",
            ManifestMissing => "DCP-E004",
            ClassicalSigInvalid => "DCP-E100",
            PqSigInvalid => "DCP-E101",
            CompositeBindingInvalid => "DCP-E102",
            SignatureMissing => "DCP-E103",
            SignatureExpired => "DCP-E104",
            HashChainBroken => "DCP-E200",
            ManifestHashMismatch => "DCP-E201",
            MerkleRootMismatch => "DCP-E202",
            DualHashMismatch => "DCP-E203",
            IntentHashMismatch => "DCP-E204",
            AgentRevoked => "DCP-E300",
            KeyExpired => "DCP-E301",
            KeyRevoked => "DCP-E302",
            KidMismatch => "DCP-E303",
            RprInvalid => "DCP-E304",
            TierInsufficient => "DCP-E400",
            PolicyViolation => "DCP-E401",
            DowngradeAttempt => "DCP-E402",
            CapabilityDenied => "DCP-E403",
            SessionNonceInvalid => "DCP-E500",
            SessionExpired => "DCP-E501",
            SessionReplay => "DCP-E502",
            SequenceOutOfOrder => "DCP-E503",
            A2aHandshakeFailed => "DCP-E600",
            A2aBundleRejected => "DCP-E601",
            A2aCapabilityMismatch => "DCP-E602",
            A2aSessionClosed => "DCP-E603",
            A2aDecryptFailed => "DCP-E604",
            RateLimitExceeded => "DCP-E700",
            CircuitOpen => "DCP-E701",
            Backpressure => "DCP-E702",
            InternalError => "DCP-E900",
            AlgorithmUnavailable => "DCP-E901",
            HsmError => "DCP-E902",
        }
    }

    /// Canonical message + retryable flag for this code.
    pub fn description(&self) -> (&'static str, bool) {
        use DcpErrorCode::*;
        match self {
            BundleSchemaInvalid => ("Bundle does not conform to DCP schema", false),
            ArtifactSchemaInvalid => ("Artifact does not conform to DCP schema", false),
            VersionUnsupported => ("DCP version not supported", false),
            ManifestMissing => ("Bundle manifest is missing", false),
            ClassicalSigInvalid => ("Classical (Ed25519) signature verification failed", false),
            PqSigInvalid => ("Post-quantum signature verification failed", false),
            CompositeBindingInvalid => ("Composite signature binding is invalid", false),
            SignatureMissing => ("Required signature is missing", false),
            SignatureExpired => ("Signature has expired", false),
            HashChainBroken => ("Audit hash chain integrity check failed", false),
            ManifestHashMismatch => ("Manifest hash does not match artifact", false),
            MerkleRootMismatch => ("Merkle root does not match audit entries", false),
            DualHashMismatch => ("Dual hash chain inconsistency detected", false),
            IntentHashMismatch => ("Intent hash does not match", false),
            AgentRevoked => ("Agent has been revoked", false),
            KeyExpired => ("Signing key has expired", false),
            KeyRevoked => ("Signing key has been revoked", false),
            KidMismatch => ("Key identifier does not match public key", false),
            RprInvalid => ("Responsible Principal Record is invalid", false),
            TierInsufficient => ("Security tier does not meet minimum requirement", false),
            PolicyViolation => ("Action violates policy", false),
            DowngradeAttempt => ("Security tier downgrade is not allowed", false),
            CapabilityDenied => ("Requested capability is not authorized", false),
            SessionNonceInvalid => ("Session nonce is invalid", false),
            SessionExpired => ("Session has expired", false),
            SessionReplay => ("Session replay detected", false),
            SequenceOutOfOrder => ("Message sequence out of order", false),
            A2aHandshakeFailed => ("A2A handshake failed", true),
            A2aBundleRejected => ("Peer rejected presented bundle", false),
            A2aCapabilityMismatch => ("Peer does not satisfy requested capabilities", false),
            A2aSessionClosed => ("A2A session is closed", false),
            A2aDecryptFailed => ("AES-GCM decryption failed (tag mismatch)", false),
            RateLimitExceeded => ("Rate limit exceeded", true),
            CircuitOpen => ("Circuit breaker is open", true),
            Backpressure => ("Backpressure applied — retry later", true),
            InternalError => ("Internal error", true),
            AlgorithmUnavailable => ("Requested algorithm is not registered", false),
            HsmError => ("Hardware security module reported an error", true),
        }
    }

    /// Is this error transient/retryable?
    pub fn retryable(&self) -> bool {
        self.description().1
    }
}

impl fmt::Display for DcpErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// Canonical DCP error value.
#[derive(Debug, Clone)]
pub struct DcpError {
    pub code: DcpErrorCode,
    pub message: String,
    pub retryable: bool,
    pub timestamp: String,
    pub details: serde_json::Value,
}

/// Build a `DcpError` with the standard message + retryable flag for the code.
pub fn create_dcp_error(
    code: DcpErrorCode,
    message: Option<String>,
    details: Option<serde_json::Value>,
) -> DcpError {
    let (default_msg, retryable) = code.description();
    DcpError {
        code,
        message: message.unwrap_or_else(|| default_msg.to_string()),
        retryable,
        timestamp: crate::v2::lifecycle::utc_now_iso_pub(),
        details: details.unwrap_or(serde_json::Value::Null),
    }
}

/// Wire-format sniff — returns `"json"` or `"cbor"`.
pub fn detect_wire_format(data: &[u8]) -> &'static str {
    if data.is_empty() {
        return "json";
    }
    match data[0] {
        0x7B | 0x5B | 0x20 | 0x0A | 0x0D | 0x09 => "json",
        _ => "cbor",
    }
}
