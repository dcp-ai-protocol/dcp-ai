//! v2.7 error codes + wire format detect (Rust).

use dcp_ai::v2::error_codes::{
    create_dcp_error, detect_wire_format, DcpErrorCode,
};

#[test]
fn error_codes_have_stable_identifiers() {
    assert_eq!(DcpErrorCode::PqSigInvalid.to_string(), "DCP-E101");
    assert_eq!(DcpErrorCode::HashChainBroken.code(), "DCP-E200");
    assert_eq!(DcpErrorCode::A2aDecryptFailed.code(), "DCP-E604");
    assert_eq!(DcpErrorCode::RateLimitExceeded.code(), "DCP-E700");
    assert_eq!(DcpErrorCode::HsmError.code(), "DCP-E902");
}

#[test]
fn retryable_flag_matches_semantics() {
    assert!(DcpErrorCode::RateLimitExceeded.retryable());
    assert!(DcpErrorCode::A2aHandshakeFailed.retryable());
    assert!(!DcpErrorCode::PqSigInvalid.retryable());
    assert!(!DcpErrorCode::AgentRevoked.retryable());
}

#[test]
fn create_dcp_error_uses_default_message() {
    let err = create_dcp_error(DcpErrorCode::ManifestMissing, None, None);
    assert_eq!(err.code.code(), "DCP-E004");
    assert!(err.message.contains("manifest"));
    assert!(!err.retryable);
}

#[test]
fn create_dcp_error_supports_override() {
    let err = create_dcp_error(
        DcpErrorCode::InternalError,
        Some("database connection dropped".into()),
        None,
    );
    assert_eq!(err.message, "database connection dropped");
    assert!(err.retryable);
}

#[test]
fn detect_wire_format_routing() {
    assert_eq!(detect_wire_format(b""), "json");
    assert_eq!(detect_wire_format(b"{\"dcp_version\": \"2.0\"}"), "json");
    assert_eq!(detect_wire_format(b"[1, 2, 3]"), "json");
    assert_eq!(detect_wire_format(b"  {"), "json");
    // CBOR map of 3 entries starts with 0xa3 (major type 5, 3 entries)
    assert_eq!(detect_wire_format(&[0xa3, 0x01, 0x02]), "cbor");
    assert_eq!(detect_wire_format(&[0xd8, 0x1e]), "cbor");
}
