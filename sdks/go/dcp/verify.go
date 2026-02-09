package dcp

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// VerifySignedBundle performs full DCP verification on a signed bundle.
// Checks signature, bundle_hash, merkle_root, intent_hash chain, and prev_hash chain.
func VerifySignedBundle(sb *SignedBundle, publicKeyB64 string) *VerificationResult {
	if sb == nil {
		return &VerificationResult{Verified: false, Errors: []string{"nil signed bundle"}}
	}

	pubKey := publicKeyB64
	if pubKey == "" {
		pubKey = sb.Signature.SignerInfo.PublicKeyB64
	}
	if pubKey == "" {
		return &VerificationResult{Verified: false, Errors: []string{"missing public key"}}
	}

	// 1) Signature verification
	ok, err := VerifyObject(sb.Bundle, sb.Signature.SigB64, pubKey)
	if err != nil || !ok {
		return &VerificationResult{Verified: false, Errors: []string{"SIGNATURE INVALID"}}
	}

	// 2) bundle_hash
	if strings.HasPrefix(sb.Signature.BundleHash, "sha256:") {
		canon, err := Canonicalize(sb.Bundle)
		if err != nil {
			return &VerificationResult{Verified: false, Errors: []string{fmt.Sprintf("canonicalize error: %v", err)}}
		}
		h := sha256.Sum256([]byte(canon))
		expectedHex := hex.EncodeToString(h[:])
		got := sb.Signature.BundleHash[len("sha256:"):]
		if got != expectedHex {
			return &VerificationResult{Verified: false, Errors: []string{"BUNDLE HASH MISMATCH"}}
		}
	}

	// 3) merkle_root
	if sb.Signature.MerkleRoot != nil && strings.HasPrefix(*sb.Signature.MerkleRoot, "sha256:") {
		var leaves []string
		for _, entry := range sb.Bundle.AuditEntries {
			h, err := HashObject(entry)
			if err != nil {
				return &VerificationResult{Verified: false, Errors: []string{fmt.Sprintf("hash audit entry: %v", err)}}
			}
			leaves = append(leaves, h)
		}
		expectedMerkle, err := MerkleRootFromHexLeaves(leaves)
		if err != nil {
			return &VerificationResult{Verified: false, Errors: []string{fmt.Sprintf("merkle root: %v", err)}}
		}
		gotMerkle := (*sb.Signature.MerkleRoot)[len("sha256:"):]
		if gotMerkle != expectedMerkle {
			return &VerificationResult{Verified: false, Errors: []string{"MERKLE ROOT MISMATCH"}}
		}
	}

	// 4) intent_hash and prev_hash chain
	expectedIntentHash, err := HashObject(sb.Bundle.Intent)
	if err != nil {
		return &VerificationResult{Verified: false, Errors: []string{fmt.Sprintf("intent hash: %v", err)}}
	}

	prevHashExpected := "GENESIS"
	for i, entry := range sb.Bundle.AuditEntries {
		if entry.IntentHash != expectedIntentHash {
			return &VerificationResult{
				Verified: false,
				Errors: []string{fmt.Sprintf("intent_hash (entry %d): expected %s, got %s", i, expectedIntentHash, entry.IntentHash)},
			}
		}
		if entry.PrevHash != prevHashExpected {
			return &VerificationResult{
				Verified: false,
				Errors: []string{fmt.Sprintf("prev_hash chain (entry %d): expected %s, got %s", i, prevHashExpected, entry.PrevHash)},
			}
		}
		h, err := HashObject(entry)
		if err != nil {
			return &VerificationResult{Verified: false, Errors: []string{fmt.Sprintf("hash entry: %v", err)}}
		}
		prevHashExpected = h
	}

	return &VerificationResult{Verified: true}
}
