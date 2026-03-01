package v2

import "fmt"

// SignedPayload wraps an arbitrary payload with its hash and composite signature.
type SignedPayload struct {
	Payload      interface{}        `json:"payload"`
	PayloadHash  string             `json:"payload_hash"`
	CompositeSig CompositeSignature `json:"composite_sig"`
}

// PreparePayload canonicalizes the payload and computes its SHA-256 hash.
// Returns (canonicalBytes, payloadHash, error).
func PreparePayload(payload interface{}) ([]byte, string, error) {
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, "", fmt.Errorf("canonicalize payload: %w", err)
	}
	canonBytes := []byte(canonical)
	hash := SHA256Hex(canonBytes)
	return canonBytes, hash, nil
}

// VerifyPayloadHash re-canonicalizes the signed payload's inner payload
// and checks that the hash matches payload_hash.
func VerifyPayloadHash(signed *SignedPayload) (bool, error) {
	if signed == nil {
		return false, fmt.Errorf("nil signed payload")
	}
	canonical, err := CanonicalizeV2(signed.Payload)
	if err != nil {
		return false, fmt.Errorf("canonicalize payload: %w", err)
	}
	computed := SHA256Hex([]byte(canonical))
	return computed == signed.PayloadHash, nil
}
