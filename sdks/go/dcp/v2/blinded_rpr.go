// Package v2 — DCP v2.0 Blinded RPR (Go port).

package v2

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
)

var piiSaltPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

const legacyPIIHashWarning = "legacy unsalted pii_hash (deprecated): anyone who guesses legal_name and contact can confirm them"

// GeneratePIISalt returns 32 random bytes as 64 lowercase hex chars. Set it as
// pii_salt on the full RPR before signing it, and never publish it.
func GeneratePIISalt() string {
	var b [32]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// ComputePIIHash produces the sha256:<hex> commitment over an RPR's PII fields
// and pii_salt. Without pii_salt it is the legacy unsalted commitment
// (deprecated), kept so existing records can still be opened.
func ComputePIIHash(rpr map[string]interface{}) (string, error) {
	pii := map[string]interface{}{
		"contact":    rpr["contact"],
		"legal_name": rpr["legal_name"],
	}
	if salt := rpr["pii_salt"]; salt != nil {
		pii["pii_salt"] = salt
	}
	canon, err := CanonicalizeV2(pii)
	if err != nil {
		return "", fmt.Errorf("canonicalize pii: %w", err)
	}
	sum := sha256.Sum256([]byte(canon))
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

// BlindRPR strips contact, legal_name and pii_salt and substitutes a hash
// commitment. It fails when pii_salt is missing or malformed: an unsalted
// commitment can be confirmed by guessing the PII.
func BlindRPR(rpr map[string]interface{}) (map[string]interface{}, error) {
	if salt, _ := rpr["pii_salt"].(string); !piiSaltPattern.MatchString(salt) {
		return nil, errors.New("BlindRPR requires pii_salt (32 random bytes as 64 lowercase hex): set it with GeneratePIISalt() before signing the RPR")
	}
	piiHash, err := ComputePIIHash(rpr)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"dcp_version":      "2.0",
		"human_id":         rpr["human_id"],
		"session_nonce":    rpr["session_nonce"],
		"blinded":          true,
		"pii_hash":         piiHash,
		"entity_type":      rpr["entity_type"],
		"jurisdiction":     rpr["jurisdiction"],
		"liability_mode":   rpr["liability_mode"],
		"override_rights":  rpr["override_rights"],
		"issued_at":        rpr["issued_at"],
		"expires_at":       rpr["expires_at"],
		"binding_keys":     rpr["binding_keys"],
	}, nil
}

// BlindedRprCheck is the result of VerifyBlindedRPR.
type BlindedRprCheck struct {
	Valid    bool
	Errors   []string
	Warnings []string
}

// VerifyBlindedRPR ensures a full RPR discloses the expected blinded commitment.
// A full RPR without pii_salt is checked against the legacy unsalted
// commitment and adds a deprecation warning.
func VerifyBlindedRPR(fullRPR, blinded map[string]interface{}) BlindedRprCheck {
	errs := []string{}
	warnings := []string{}
	expected, err := ComputePIIHash(fullRPR)
	if err != nil {
		errs = append(errs, "compute pii_hash: "+err.Error())
	}
	got, _ := blinded["pii_hash"].(string)
	if err == nil && got != expected {
		errs = append(errs, fmt.Sprintf("pii_hash mismatch: expected %s, got %s", expected, got))
	}
	if fullRPR["pii_salt"] == nil {
		warnings = append(warnings, legacyPIIHashWarning)
	}
	keys := []string{"human_id", "session_nonce", "entity_type", "jurisdiction", "liability_mode", "override_rights", "issued_at", "expires_at", "binding_keys"}
	for _, k := range keys {
		if !equal(fullRPR[k], blinded[k]) {
			errs = append(errs, k+" mismatch")
		}
	}
	return BlindedRprCheck{Valid: len(errs) == 0, Errors: errs, Warnings: warnings}
}

// IsBlindedRPR checks the `blinded` flag on an RPR payload.
func IsBlindedRPR(rpr map[string]interface{}) bool {
	blinded, _ := rpr["blinded"].(bool)
	return blinded
}

// equal compares canonical JSON, so []string and []interface{} (or a
// typed map and its decoded form) with the same content are equal.
func equal(a, b interface{}) bool {
	ca, errA := MarshalCanonical(a)
	cb, errB := MarshalCanonical(b)
	return errA == nil && errB == nil && bytes.Equal(ca, cb)
}
