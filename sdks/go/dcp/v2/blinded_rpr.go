// Package v2 — DCP v2.0 Blinded RPR (Go port).

package v2

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// ComputePIIHash produces the sha256:<hex> commitment over an RPR's PII fields.
func ComputePIIHash(rpr map[string]interface{}) (string, error) {
	pii := map[string]interface{}{
		"contact":    rpr["contact"],
		"legal_name": rpr["legal_name"],
	}
	canon, err := CanonicalizeV2(pii)
	if err != nil {
		return "", fmt.Errorf("canonicalize pii: %w", err)
	}
	sum := sha256.Sum256([]byte(canon))
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

// BlindRPR strips contact + legal_name and substitutes a hash commitment.
func BlindRPR(rpr map[string]interface{}) (map[string]interface{}, error) {
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
	Valid  bool
	Errors []string
}

// VerifyBlindedRPR ensures a full RPR discloses the expected blinded commitment.
func VerifyBlindedRPR(fullRPR, blinded map[string]interface{}) BlindedRprCheck {
	errs := []string{}
	expected, err := ComputePIIHash(fullRPR)
	if err != nil {
		errs = append(errs, "compute pii_hash: "+err.Error())
	}
	got, _ := blinded["pii_hash"].(string)
	if err == nil && got != expected {
		errs = append(errs, fmt.Sprintf("pii_hash mismatch: expected %s, got %s", expected, got))
	}
	keys := []string{"human_id", "entity_type", "jurisdiction", "liability_mode", "override_rights", "issued_at", "expires_at"}
	for _, k := range keys {
		if !equal(fullRPR[k], blinded[k]) {
			errs = append(errs, k+" mismatch")
		}
	}
	return BlindedRprCheck{Valid: len(errs) == 0, Errors: errs}
}

// IsBlindedRPR checks the `blinded` flag on an RPR payload.
func IsBlindedRPR(rpr map[string]interface{}) bool {
	blinded, _ := rpr["blinded"].(bool)
	return blinded
}

func equal(a, b interface{}) bool {
	// Best-effort structural equality that's tolerant of []string vs []interface{}.
	switch av := a.(type) {
	case []string:
		bv, ok := b.([]string)
		if !ok {
			return false
		}
		if len(av) != len(bv) {
			return false
		}
		for i := range av {
			if av[i] != bv[i] {
				return false
			}
		}
		return true
	default:
		return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
	}
}
