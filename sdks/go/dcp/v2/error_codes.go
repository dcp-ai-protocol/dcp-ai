// Package v2 — DCP canonical error codes (Go port).

package v2

import "fmt"

// DcpErrorCode is a stable string identifier shared across SDKs.
type DcpErrorCode string

const (
	// Schema (E001-E099)
	ErrBundleSchemaInvalid   DcpErrorCode = "DCP-E001"
	ErrArtifactSchemaInvalid DcpErrorCode = "DCP-E002"
	ErrVersionUnsupported    DcpErrorCode = "DCP-E003"
	ErrManifestMissing       DcpErrorCode = "DCP-E004"

	// Signature (E100-E199)
	ErrClassicalSigInvalid    DcpErrorCode = "DCP-E100"
	ErrPqSigInvalid           DcpErrorCode = "DCP-E101"
	ErrCompositeBindingInvalid DcpErrorCode = "DCP-E102"
	ErrSignatureMissing        DcpErrorCode = "DCP-E103"
	ErrSignatureExpired        DcpErrorCode = "DCP-E104"

	// Hash/Chain (E200-E299)
	ErrHashChainBroken      DcpErrorCode = "DCP-E200"
	ErrManifestHashMismatch DcpErrorCode = "DCP-E201"
	ErrMerkleRootMismatch   DcpErrorCode = "DCP-E202"
	ErrDualHashMismatch     DcpErrorCode = "DCP-E203"
	ErrIntentHashMismatch   DcpErrorCode = "DCP-E204"

	// Identity (E300-E399)
	ErrAgentRevoked DcpErrorCode = "DCP-E300"
	ErrKeyExpired   DcpErrorCode = "DCP-E301"
	ErrKeyRevoked   DcpErrorCode = "DCP-E302"
	ErrKidMismatch  DcpErrorCode = "DCP-E303"
	ErrRprInvalid   DcpErrorCode = "DCP-E304"

	// Policy (E400-E499)
	ErrTierInsufficient DcpErrorCode = "DCP-E400"
	ErrPolicyViolation  DcpErrorCode = "DCP-E401"
	ErrDowngradeAttempt DcpErrorCode = "DCP-E402"
	ErrCapabilityDenied DcpErrorCode = "DCP-E403"

	// Session (E500-E599)
	ErrSessionNonceInvalid DcpErrorCode = "DCP-E500"
	ErrSessionExpired      DcpErrorCode = "DCP-E501"
	ErrSessionReplay       DcpErrorCode = "DCP-E502"
	ErrSequenceOutOfOrder  DcpErrorCode = "DCP-E503"

	// A2A (E600-E699)
	ErrA2AHandshakeFailed    DcpErrorCode = "DCP-E600"
	ErrA2ABundleRejected     DcpErrorCode = "DCP-E601"
	ErrA2ACapabilityMismatch DcpErrorCode = "DCP-E602"
	ErrA2ASessionClosed      DcpErrorCode = "DCP-E603"
	ErrA2ADecryptFailed      DcpErrorCode = "DCP-E604"

	// Rate limiting (E700-E799)
	ErrRateLimitExceeded DcpErrorCode = "DCP-E700"
	ErrCircuitOpen       DcpErrorCode = "DCP-E701"
	ErrBackpressure      DcpErrorCode = "DCP-E702"

	// Internal (E900-E999)
	ErrInternal             DcpErrorCode = "DCP-E900"
	ErrAlgorithmUnavailable DcpErrorCode = "DCP-E901"
	ErrHSM                  DcpErrorCode = "DCP-E902"
)

type errInfo struct {
	message   string
	retryable bool
}

var errorDescriptions = map[DcpErrorCode]errInfo{
	ErrBundleSchemaInvalid:     {"Bundle does not conform to DCP schema", false},
	ErrArtifactSchemaInvalid:   {"Artifact does not conform to DCP schema", false},
	ErrVersionUnsupported:      {"DCP version not supported", false},
	ErrManifestMissing:         {"Bundle manifest is missing", false},
	ErrClassicalSigInvalid:     {"Classical (Ed25519) signature verification failed", false},
	ErrPqSigInvalid:            {"Post-quantum signature verification failed", false},
	ErrCompositeBindingInvalid: {"Composite signature binding is invalid", false},
	ErrSignatureMissing:        {"Required signature is missing", false},
	ErrSignatureExpired:        {"Signature has expired", false},
	ErrHashChainBroken:         {"Audit hash chain integrity check failed", false},
	ErrManifestHashMismatch:    {"Manifest hash does not match artifact", false},
	ErrMerkleRootMismatch:      {"Merkle root does not match audit entries", false},
	ErrDualHashMismatch:        {"Dual hash chain inconsistency detected", false},
	ErrIntentHashMismatch:      {"Intent hash does not match", false},
	ErrAgentRevoked:            {"Agent has been revoked", false},
	ErrKeyExpired:              {"Signing key has expired", false},
	ErrKeyRevoked:              {"Signing key has been revoked", false},
	ErrKidMismatch:             {"Key identifier does not match public key", false},
	ErrRprInvalid:              {"Responsible Principal Record is invalid", false},
	ErrTierInsufficient:        {"Security tier does not meet minimum requirement", false},
	ErrPolicyViolation:         {"Action violates policy", false},
	ErrDowngradeAttempt:        {"Security tier downgrade is not allowed", false},
	ErrCapabilityDenied:        {"Requested capability is not authorized", false},
	ErrSessionNonceInvalid:     {"Session nonce is invalid", false},
	ErrSessionExpired:          {"Session has expired", false},
	ErrSessionReplay:           {"Session replay detected", false},
	ErrSequenceOutOfOrder:      {"Message sequence out of order", false},
	ErrA2AHandshakeFailed:      {"A2A handshake failed", true},
	ErrA2ABundleRejected:       {"Peer rejected presented bundle", false},
	ErrA2ACapabilityMismatch:   {"Peer does not satisfy requested capabilities", false},
	ErrA2ASessionClosed:        {"A2A session is closed", false},
	ErrA2ADecryptFailed:        {"AES-GCM decryption failed (tag mismatch)", false},
	ErrRateLimitExceeded:       {"Rate limit exceeded", true},
	ErrCircuitOpen:             {"Circuit breaker is open", true},
	ErrBackpressure:            {"Backpressure applied — retry later", true},
	ErrInternal:                {"Internal error", true},
	ErrAlgorithmUnavailable:    {"Requested algorithm is not registered", false},
	ErrHSM:                     {"Hardware security module reported an error", true},
}

// DcpError is the canonical DCP error struct.
type DcpError struct {
	Code      DcpErrorCode
	Message   string
	Retryable bool
	Timestamp string
	Details   map[string]interface{}
}

// Error implements the `error` interface so DcpError can be returned from funcs.
func (e *DcpError) Error() string {
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// Retry returns the retryable flag for a code.
func (c DcpErrorCode) Retry() bool {
	info, ok := errorDescriptions[c]
	if !ok {
		return false
	}
	return info.retryable
}

// Description returns the canonical message + retryable flag.
func (c DcpErrorCode) Description() (string, bool) {
	info, ok := errorDescriptions[c]
	if !ok {
		return "Unknown error", false
	}
	return info.message, info.retryable
}

// CreateDcpError builds a DcpError with the canonical message + retryable flag.
// If `message` is "", the default description is used.
func CreateDcpError(code DcpErrorCode, message string, details map[string]interface{}) *DcpError {
	msg, retryable := code.Description()
	if message == "" {
		message = msg
	}
	if details == nil {
		details = map[string]interface{}{}
	}
	return &DcpError{
		Code:      code,
		Message:   message,
		Retryable: retryable,
		Timestamp: utcNowISO(),
		Details:   details,
	}
}

// IsDcpError reports whether err is a *DcpError.
func IsDcpError(err error) bool {
	_, ok := err.(*DcpError)
	return ok
}

// DetectWireFormat returns "json" or "cbor" based on the first byte.
func DetectWireFormat(data []byte) string {
	if len(data) == 0 {
		return "json"
	}
	switch data[0] {
	case 0x7B, 0x5B, 0x20, 0x0A, 0x0D, 0x09:
		return "json"
	}
	return "cbor"
}
