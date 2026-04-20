package dcp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"golang.org/x/crypto/sha3"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func fixturesDir() string {
	_, thisFile, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "conformance")
}

type goldenVectors struct {
	Canonicalization  map[string]struct {
		Input             interface{} `json:"input"`
		ExpectedCanonical string      `json:"expected_canonical"`
	} `json:"canonicalization"`
	V2Canonicalization map[string]struct {
		Input             interface{} `json:"input"`
		ExpectedCanonical string      `json:"expected_canonical"`
	} `json:"v2_canonicalization"`
	HashVectors map[string]struct {
		InputUTF8   string `json:"input_utf8"`
		ExpectedHex string `json:"expected_hex"`
	} `json:"hash_vectors"`
	V1BundleVerification struct {
		PublicKeyB64       string   `json:"public_key_b64"`
		ExpectedBundleHash string   `json:"expected_bundle_hash"`
		ExpectedMerkleRoot string   `json:"expected_merkle_root"`
		IntentHash         string   `json:"intent_hash"`
		AuditEntryHashes   []string `json:"audit_entry_hashes"`
		PrevHashChain      []string `json:"prev_hash_chain"`
	} `json:"v1_bundle_verification"`
	DualHashVectors struct {
		IntentCanonical struct {
			CanonicalJSON string `json:"canonical_json"`
			SHA256        string `json:"sha256"`
			SHA3256       string `json:"sha3_256"`
		} `json:"intent_canonical"`
		AuditEntryDualHashes []struct {
			SHA256  string `json:"sha256"`
			SHA3256 string `json:"sha3_256"`
		} `json:"audit_entry_dual_hashes"`
		DualMerkleRoots struct {
			SHA256  string `json:"sha256"`
			SHA3256 string `json:"sha3_256"`
		} `json:"dual_merkle_roots"`
		RawDualHash struct {
			InputUTF8 string `json:"input_utf8"`
			SHA256    string `json:"sha256"`
			SHA3256   string `json:"sha3_256"`
		} `json:"raw_dual_hash"`
	} `json:"dual_hash_vectors"`
}

func loadGoldenVectors(t *testing.T) goldenVectors {
	t.Helper()
	path := filepath.Join(fixturesDir(), "v2", "golden_vectors.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read golden vectors: %v", err)
	}
	var gv goldenVectors
	if err := json.Unmarshal(data, &gv); err != nil {
		t.Fatalf("failed to parse golden vectors: %v", err)
	}
	return gv
}

func loadSignedBundle(t *testing.T) *SignedBundle {
	t.Helper()
	path := filepath.Join(fixturesDir(), "examples", "citizenship_bundle.signed.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read signed bundle: %v", err)
	}
	var sb SignedBundle
	if err := json.Unmarshal(data, &sb); err != nil {
		t.Fatalf("failed to parse signed bundle: %v", err)
	}
	return &sb
}

// ---------------------------------------------------------------------------
// 1. V1 Bundle Verification (backward compatibility)
// ---------------------------------------------------------------------------

func TestV1BundleVerifiesWithEmbeddedKey(t *testing.T) {
	sb := loadSignedBundle(t)
	result := VerifySignedBundle(sb, "")
	if !result.Verified {
		t.Fatalf("V1 bundle should verify: %v", result.Errors)
	}
}

func TestV1BundleVerifiesWithExplicitKey(t *testing.T) {
	sb := loadSignedBundle(t)
	gv := loadGoldenVectors(t)
	result := VerifySignedBundle(sb, gv.V1BundleVerification.PublicKeyB64)
	if !result.Verified {
		t.Fatalf("V1 bundle should verify with explicit key: %v", result.Errors)
	}
}

func TestV1BundleRejectsWrongKey(t *testing.T) {
	sb := loadSignedBundle(t)
	result := VerifySignedBundle(sb, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	if result.Verified {
		t.Fatal("should reject wrong key")
	}
}

func TestV1BundleRejectsTamperedAudit(t *testing.T) {
	sb := loadSignedBundle(t)
	sb.Bundle.AuditEntries[0].Outcome = "tampered"
	result := VerifySignedBundle(sb, "")
	if result.Verified {
		t.Fatal("should reject tampered audit entry")
	}
}

func TestV1BundleRejectsTamperedIntent(t *testing.T) {
	sb := loadSignedBundle(t)
	sb.Bundle.Intent.ActionType = "execute_code"
	result := VerifySignedBundle(sb, "")
	if result.Verified {
		t.Fatal("should reject tampered intent")
	}
}

func TestV1BundleHashMatches(t *testing.T) {
	sb := loadSignedBundle(t)
	gv := loadGoldenVectors(t)
	expected := gv.V1BundleVerification.ExpectedBundleHash
	canon, err := Canonicalize(sb.Bundle)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	h := sha256.Sum256([]byte(canon))
	computed := "sha256:" + hex.EncodeToString(h[:])
	if computed != expected {
		t.Fatalf("bundle hash mismatch: got %s, want %s", computed, expected)
	}
}

func TestV1MerkleRootMatches(t *testing.T) {
	sb := loadSignedBundle(t)
	gv := loadGoldenVectors(t)
	expected := gv.V1BundleVerification.ExpectedMerkleRoot
	var leaves []string
	for _, entry := range sb.Bundle.AuditEntries {
		h, err := HashObject(entry)
		if err != nil {
			t.Fatalf("hash audit entry: %v", err)
		}
		leaves = append(leaves, h)
	}
	root, err := MerkleRootFromHexLeaves(leaves)
	if err != nil {
		t.Fatalf("merkle root: %v", err)
	}
	if fmt.Sprintf("sha256:%s", root) != expected {
		t.Fatalf("merkle root mismatch: got sha256:%s, want %s", root, expected)
	}
}

func TestV1IntentHashMatches(t *testing.T) {
	sb := loadSignedBundle(t)
	gv := loadGoldenVectors(t)
	expected := gv.V1BundleVerification.IntentHash
	computed, err := HashObject(sb.Bundle.Intent)
	if err != nil {
		t.Fatalf("hash intent: %v", err)
	}
	if computed != expected {
		t.Fatalf("intent hash mismatch: got %s, want %s", computed, expected)
	}
}

func TestV1PrevHashChain(t *testing.T) {
	sb := loadSignedBundle(t)
	gv := loadGoldenVectors(t)
	chain := gv.V1BundleVerification.PrevHashChain
	prev := "GENESIS"
	if prev != chain[0] {
		t.Fatalf("chain[0] mismatch: got %s, want %s", prev, chain[0])
	}
	for i, entry := range sb.Bundle.AuditEntries {
		if entry.PrevHash != prev {
			t.Fatalf("entry %d prev_hash mismatch: got %s, want %s", i, entry.PrevHash, prev)
		}
		h, err := HashObject(entry)
		if err != nil {
			t.Fatalf("hash entry %d: %v", i, err)
		}
		prev = h
		if prev != chain[i+1] {
			t.Fatalf("chain[%d] mismatch: got %s, want %s", i+1, prev, chain[i+1])
		}
	}
}

// ---------------------------------------------------------------------------
// 2. Golden Canonical Vectors
// ---------------------------------------------------------------------------

func TestCanonicalSimpleSortedKeys(t *testing.T) {
	gv := loadGoldenVectors(t)
	c := gv.Canonicalization["simple_sorted_keys"]
	result, err := Canonicalize(c.Input)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	if result != c.ExpectedCanonical {
		t.Fatalf("got %s, want %s", result, c.ExpectedCanonical)
	}
}

func TestCanonicalNestedObjects(t *testing.T) {
	gv := loadGoldenVectors(t)
	c := gv.Canonicalization["nested_objects"]
	result, err := Canonicalize(c.Input)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	if result != c.ExpectedCanonical {
		t.Fatalf("got %s, want %s", result, c.ExpectedCanonical)
	}
}

func TestCanonicalMixedTypes(t *testing.T) {
	gv := loadGoldenVectors(t)
	c := gv.Canonicalization["mixed_types"]
	result, err := Canonicalize(c.Input)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	if result != c.ExpectedCanonical {
		t.Fatalf("got %s, want %s", result, c.ExpectedCanonical)
	}
}

func TestCanonicalWithNull(t *testing.T) {
	gv := loadGoldenVectors(t)
	c := gv.Canonicalization["with_null"]
	result, err := Canonicalize(c.Input)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	if result != c.ExpectedCanonical {
		t.Fatalf("got %s, want %s", result, c.ExpectedCanonical)
	}
}

func TestCanonicalUnicode(t *testing.T) {
	gv := loadGoldenVectors(t)
	c := gv.Canonicalization["unicode"]
	result, err := Canonicalize(c.Input)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	if result != c.ExpectedCanonical {
		t.Fatalf("got %s, want %s", result, c.ExpectedCanonical)
	}
}

func TestV2CanonicalIntegerOnly(t *testing.T) {
	gv := loadGoldenVectors(t)
	c := gv.V2Canonicalization["integer_only"]
	result, err := v2.CanonicalizeV2(c.Input)
	if err != nil {
		t.Fatalf("canonicalize_v2: %v", err)
	}
	if result != c.ExpectedCanonical {
		t.Fatalf("got %s, want %s", result, c.ExpectedCanonical)
	}
}

func TestV2CanonicalRejectsFloats(t *testing.T) {
	input := map[string]interface{}{"score": 0.5}
	_, err := v2.CanonicalizeV2(input)
	if err == nil {
		t.Fatal("should reject float value")
	}
}

func TestV2CanonicalRejectsNestedFloats(t *testing.T) {
	input := map[string]interface{}{"outer": map[string]interface{}{"inner": 3.14}}
	_, err := v2.CanonicalizeV2(input)
	if err == nil {
		t.Fatal("should reject nested float")
	}
}

func TestV2AssertNoFloatsPassesIntegers(t *testing.T) {
	input := map[string]interface{}{"a": float64(1), "b": []interface{}{float64(2), float64(3)}}
	if err := v2.AssertNoFloats(input); err != nil {
		t.Fatalf("should pass for integers: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Hash vectors
// ---------------------------------------------------------------------------

func TestSHA256Hello(t *testing.T) {
	gv := loadGoldenVectors(t)
	expected := gv.HashVectors["sha256_hello"].ExpectedHex
	computed := v2.SHA256Hex([]byte("hello"))
	if computed != expected {
		t.Fatalf("got %s, want %s", computed, expected)
	}
}

func TestSHA256Empty(t *testing.T) {
	gv := loadGoldenVectors(t)
	expected := gv.HashVectors["sha256_empty"].ExpectedHex
	computed := v2.SHA256Hex([]byte(""))
	if computed != expected {
		t.Fatalf("got %s, want %s", computed, expected)
	}
}

func TestSHA3256Hello(t *testing.T) {
	gv := loadGoldenVectors(t)
	expected := gv.HashVectors["sha3_256_hello"].ExpectedHex
	computed := v2.SHA3256Hex([]byte("hello"))
	if computed != expected {
		t.Fatalf("got %s, want %s", computed, expected)
	}
}

func TestSHA3256Empty(t *testing.T) {
	gv := loadGoldenVectors(t)
	expected := gv.HashVectors["sha3_256_empty"].ExpectedHex
	computed := v2.SHA3256Hex([]byte(""))
	if computed != expected {
		t.Fatalf("got %s, want %s", computed, expected)
	}
}

func TestAuditEntryHashes(t *testing.T) {
	sb := loadSignedBundle(t)
	gv := loadGoldenVectors(t)
	expected := gv.V1BundleVerification.AuditEntryHashes
	for i, entry := range sb.Bundle.AuditEntries {
		h, err := HashObject(entry)
		if err != nil {
			t.Fatalf("hash entry %d: %v", i, err)
		}
		if h != expected[i] {
			t.Fatalf("entry %d hash: got %s, want %s", i, h, expected[i])
		}
	}
}

// ---------------------------------------------------------------------------
// 3. Dual-Hash Chain Tests
// ---------------------------------------------------------------------------

func TestDualHashRawMatches(t *testing.T) {
	gv := loadGoldenVectors(t)
	dv := gv.DualHashVectors.RawDualHash
	result := v2.ComputeDualHash([]byte(dv.InputUTF8))
	if result.SHA256 != dv.SHA256 {
		t.Fatalf("SHA-256: got %s, want %s", result.SHA256, dv.SHA256)
	}
	if result.SHA3256 != dv.SHA3256 {
		t.Fatalf("SHA3-256: got %s, want %s", result.SHA3256, dv.SHA3256)
	}
}

func TestDualHashSHA256SHA3Differ(t *testing.T) {
	result := v2.ComputeDualHash([]byte("test data"))
	if result.SHA256 == result.SHA3256 {
		t.Fatal("SHA-256 and SHA3-256 should differ")
	}
}

func TestDualHashCanonicalIntentMatches(t *testing.T) {
	gv := loadGoldenVectors(t)
	ic := gv.DualHashVectors.IntentCanonical
	result := v2.DualHashCanonical(ic.CanonicalJSON)
	if result.SHA256 != ic.SHA256 {
		t.Fatalf("SHA-256: got %s, want %s", result.SHA256, ic.SHA256)
	}
	if result.SHA3256 != ic.SHA3256 {
		t.Fatalf("SHA3-256: got %s, want %s", result.SHA3256, ic.SHA3256)
	}
}

func TestDualHashAuditEntriesMatch(t *testing.T) {
	sb := loadSignedBundle(t)
	gv := loadGoldenVectors(t)
	expected := gv.DualHashVectors.AuditEntryDualHashes
	for i, entry := range sb.Bundle.AuditEntries {
		canon, err := Canonicalize(entry)
		if err != nil {
			t.Fatalf("canonicalize entry %d: %v", i, err)
		}
		result := v2.DualHashCanonical(canon)
		if result.SHA256 != expected[i].SHA256 {
			t.Fatalf("entry %d SHA-256: got %s, want %s", i, result.SHA256, expected[i].SHA256)
		}
		if result.SHA3256 != expected[i].SHA3256 {
			t.Fatalf("entry %d SHA3-256: got %s, want %s", i, result.SHA3256, expected[i].SHA3256)
		}
	}
}

func TestDualMerkleRootsMatch(t *testing.T) {
	gv := loadGoldenVectors(t)
	dv := gv.DualHashVectors
	expected := dv.DualMerkleRoots

	sha256Leaves := make([]string, len(dv.AuditEntryDualHashes))
	sha3Leaves := make([]string, len(dv.AuditEntryDualHashes))
	for i, dh := range dv.AuditEntryDualHashes {
		sha256Leaves[i] = dh.SHA256
		sha3Leaves[i] = dh.SHA3256
	}

	sha256Root, err := MerkleRootFromHexLeaves(sha256Leaves)
	if err != nil {
		t.Fatalf("sha256 merkle: %v", err)
	}
	if sha256Root != expected.SHA256 {
		t.Fatalf("SHA-256 root: got %s, want %s", sha256Root, expected.SHA256)
	}

	sha3Root, err := merkleRootSHA3(sha3Leaves)
	if err != nil {
		t.Fatalf("sha3 merkle: %v", err)
	}
	if sha3Root != expected.SHA3256 {
		t.Fatalf("SHA3-256 root: got %s, want %s", sha3Root, expected.SHA3256)
	}
}

func TestDualMerkleSHA256MatchesV1(t *testing.T) {
	gv := loadGoldenVectors(t)
	v1Root := gv.V1BundleVerification.ExpectedMerkleRoot[len("sha256:"):]
	dualRoot := gv.DualHashVectors.DualMerkleRoots.SHA256
	if dualRoot != v1Root {
		t.Fatalf("dual SHA-256 root should match V1 root: got %s, want %s", dualRoot, v1Root)
	}
}

func TestDualHashChainIntegrity(t *testing.T) {
	sb := loadSignedBundle(t)
	gv := loadGoldenVectors(t)
	chain := gv.V1BundleVerification.PrevHashChain
	dualHashes := gv.DualHashVectors.AuditEntryDualHashes

	prevSHA256 := "GENESIS"
	for i, entry := range sb.Bundle.AuditEntries {
		if entry.PrevHash != prevSHA256 {
			t.Fatalf("entry %d: prev_hash mismatch: got %s, want %s", i, entry.PrevHash, prevSHA256)
		}
		canon, err := Canonicalize(entry)
		if err != nil {
			t.Fatalf("canonicalize %d: %v", i, err)
		}
		dh := v2.DualHashCanonical(canon)
		prevSHA256 = dh.SHA256
		if prevSHA256 != chain[i+1] {
			t.Fatalf("chain[%d]: got %s, want %s", i+1, prevSHA256, chain[i+1])
		}
		if dh.SHA3256 != dualHashes[i].SHA3256 {
			t.Fatalf("entry %d SHA3-256: got %s, want %s", i, dh.SHA3256, dualHashes[i].SHA3256)
		}
	}
}

// merkleRootSHA3 computes a Merkle root using SHA3-256 from hex-encoded leaves.
func merkleRootSHA3(leaves []string) (string, error) {
	if len(leaves) == 0 {
		return "", nil
	}
	layer := make([]string, len(leaves))
	copy(layer, leaves)

	for len(layer) > 1 {
		if len(layer)%2 == 1 {
			layer = append(layer, layer[len(layer)-1])
		}
		var next []string
		for i := 0; i < len(layer); i += 2 {
			left, err := hex.DecodeString(layer[i])
			if err != nil {
				return "", err
			}
			right, err := hex.DecodeString(layer[i+1])
			if err != nil {
				return "", err
			}
			combined := append(left, right...)
			h := sha3.Sum256(combined)
			next = append(next, hex.EncodeToString(h[:]))
		}
		layer = next
	}
	return layer[0], nil
}
