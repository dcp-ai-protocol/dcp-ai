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

// SignPayload wraps payload in a SignedPayload signed under context: a
// composite signature when pqKey is set, a classical-only one otherwise.
func SignPayload(
	registry *AlgorithmRegistry,
	context string,
	payload interface{},
	classicalKey CompositeKeyInfo,
	pqKey *CompositeKeyInfo,
) (SignedPayload, error) {
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return SignedPayload{}, fmt.Errorf("canonicalize payload: %w", err)
	}
	var sig *CompositeSignature
	if pqKey != nil {
		sig, err = CompositeSign(registry, context, []byte(canonical), classicalKey, *pqKey)
	} else {
		sig, err = ClassicalOnlySign(registry, context, []byte(canonical), classicalKey)
	}
	if err != nil {
		return SignedPayload{}, fmt.Errorf("sign payload: %w", err)
	}
	return SignedPayload{
		Payload:      payload,
		PayloadHash:  "sha256:" + SHA256Hex([]byte(canonical)),
		CompositeSig: *sig,
	}, nil
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
