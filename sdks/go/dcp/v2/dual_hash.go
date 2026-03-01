package v2

import (
	"crypto/sha256"
	"encoding/hex"

	"golang.org/x/crypto/sha3"
)

// DualHash holds both SHA-256 and SHA3-256 hex digests.
type DualHash struct {
	SHA256  string `json:"sha256"`
	SHA3256 string `json:"sha3_256"`
}

// SHA256Hex returns the hex-encoded SHA-256 digest of data.
func SHA256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// SHA3256Hex returns the hex-encoded SHA3-256 digest of data.
func SHA3256Hex(data []byte) string {
	h := sha3.Sum256(data)
	return hex.EncodeToString(h[:])
}

// ComputeDualHash returns SHA-256 and SHA3-256 digests for raw bytes.
func ComputeDualHash(data []byte) DualHash {
	return DualHash{
		SHA256:  SHA256Hex(data),
		SHA3256: SHA3256Hex(data),
	}
}

// DualHashCanonical computes the dual hash of a canonical JSON string.
func DualHashCanonical(canonicalJSON string) DualHash {
	return ComputeDualHash([]byte(canonicalJSON))
}
