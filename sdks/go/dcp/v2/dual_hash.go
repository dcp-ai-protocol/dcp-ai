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

// merkleRootHex reduces a layer of hex-encoded leaf hashes to a single root
// using the provided hashFn. Odd layers are balanced by duplicating the last
// leaf, matching the Python/TS/WASM behaviour.
func merkleRootHex(leaves []string, hashFn func([]byte) string) (string, error) {
	if len(leaves) == 0 {
		return "", nil
	}
	layer := make([][]byte, len(leaves))
	for i, s := range leaves {
		b, err := hex.DecodeString(s)
		if err != nil {
			return "", err
		}
		layer[i] = b
	}
	for len(layer) > 1 {
		if len(layer)%2 == 1 {
			layer = append(layer, layer[len(layer)-1])
		}
		next := make([][]byte, 0, len(layer)/2)
		for i := 0; i < len(layer); i += 2 {
			combined := append([]byte{}, layer[i]...)
			combined = append(combined, layer[i+1]...)
			h := hashFn(combined)
			decoded, err := hex.DecodeString(h)
			if err != nil {
				return "", err
			}
			next = append(next, decoded)
		}
		layer = next
	}
	return hex.EncodeToString(layer[0]), nil
}

// DualMerkleRoot reduces two parallel layers (SHA-256 + SHA3-256) of leaf
// commitments into a single pair of Merkle roots. Returns a zero-value
// DualHash and ok=false when the leaf list is empty. Byte-identical to
// dualMerkleRoot (TypeScript) and dual_merkle_root (Python).
func DualMerkleRoot(leaves []DualHash) (DualHash, bool) {
	if len(leaves) == 0 {
		return DualHash{}, false
	}
	sha256Leaves := make([]string, len(leaves))
	sha3Leaves := make([]string, len(leaves))
	for i, l := range leaves {
		sha256Leaves[i] = l.SHA256
		sha3Leaves[i] = l.SHA3256
	}
	sha256Root, err := merkleRootHex(sha256Leaves, SHA256Hex)
	if err != nil {
		return DualHash{}, false
	}
	sha3Root, err := merkleRootHex(sha3Leaves, SHA3256Hex)
	if err != nil {
		return DualHash{}, false
	}
	return DualHash{SHA256: sha256Root, SHA3256: sha3Root}, true
}
