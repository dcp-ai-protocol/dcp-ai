package v2

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// CryptoProvider defines the interface for signature-based cryptographic operations.
type CryptoProvider interface {
	Alg() string
	KeySize() int
	SigSize() int
	IsConstantTime() bool
	GenerateKeypair() (*GeneratedKeypair, error)
	Sign(message []byte, secretKeyB64 string) ([]byte, error)
	Verify(message []byte, signature []byte, publicKeyB64 string) (bool, error)
}

// GeneratedKeypair holds a freshly generated keypair with its derived kid.
type GeneratedKeypair struct {
	Kid          string
	PublicKeyB64 string
	SecretKeyB64 string
}

// KemProvider defines the interface for Key Encapsulation Mechanism operations.
type KemProvider interface {
	Alg() string
	GenerateKeypair() (*KemKeypair, error)
	Encapsulate(publicKeyB64 string) (*EncapsulateResult, error)
	Decapsulate(ciphertextB64 string, secretKeyB64 string) ([]byte, error)
}

// KemKeypair holds a KEM keypair.
type KemKeypair struct {
	Kid          string
	PublicKeyB64 string
	SecretKeyB64 string
}

// EncapsulateResult holds the output of a KEM encapsulation.
type EncapsulateResult struct {
	CiphertextB64  string
	SharedSecretB64 string
}

// KeyEntry represents a public key entry in a V2 artifact.
type KeyEntry struct {
	Kid          string  `json:"kid"`
	Alg          string  `json:"alg"`
	PublicKeyB64 string  `json:"public_key_b64"`
	CreatedAt    string  `json:"created_at"`
	ExpiresAt    *string `json:"expires_at"`
	Status       string  `json:"status"`
}

// DeriveKid computes a deterministic key identifier:
// kid = hex(SHA-256(UTF8(alg) || 0x00 || publicKeyBytes))[0:32]
func DeriveKid(alg string, publicKeyBytes []byte) string {
	h := sha256.New()
	h.Write([]byte(alg))
	h.Write([]byte{0x00})
	h.Write(publicKeyBytes)
	digest := h.Sum(nil)
	full := hex.EncodeToString(digest)
	if len(full) < 32 {
		return full
	}
	return full[:32]
}

// ErrUnknownAlgorithm is returned when a requested algorithm is not registered.
type ErrUnknownAlgorithm struct {
	Alg  string
	Kind string
}

func (e *ErrUnknownAlgorithm) Error() string {
	return fmt.Sprintf("unknown %s algorithm: %s", e.Kind, e.Alg)
}
