// Package v2 — DCP v2.0 Emergency Revocation (Go port).

package v2

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

// EmergencyRevocationTokenPair is the output of GenerateEmergencyRevocationToken.
type EmergencyRevocationTokenPair struct {
	RevocationSecret           string // 64 hex chars
	EmergencyRevocationToken   string // "sha256:<hex>"
}

// GenerateEmergencyRevocationToken produces a secret + commitment pair.
// The secret MUST be stored offline; the commitment is embedded in the passport.
func GenerateEmergencyRevocationToken() EmergencyRevocationTokenPair {
	var secret [32]byte
	_, _ = rand.Read(secret[:])
	sum := sha256.Sum256(secret[:])
	return EmergencyRevocationTokenPair{
		RevocationSecret:         hex.EncodeToString(secret[:]),
		EmergencyRevocationToken: "sha256:" + hex.EncodeToString(sum[:]),
	}
}

// VerifyEmergencyRevocationSecret checks sha256(secret) == commitmentToken.
func VerifyEmergencyRevocationSecret(revocationSecret, commitmentToken string) bool {
	if !strings.HasPrefix(commitmentToken, "sha256:") {
		return false
	}
	expected := commitmentToken[len("sha256:"):]
	secretBytes, err := hex.DecodeString(revocationSecret)
	if err != nil || len(secretBytes) != 32 {
		return false
	}
	sum := sha256.Sum256(secretBytes)
	actual := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}

// BuildEmergencyRevocation constructs an unsigned emergency-revocation request.
func BuildEmergencyRevocation(agentID, humanID, revocationSecret string) map[string]interface{} {
	return map[string]interface{}{
		"type":              "emergency_revocation",
		"agent_id":          agentID,
		"human_id":          humanID,
		"revocation_secret": revocationSecret,
		"timestamp":         utcNowISO(),
		"reason":            "key_compromise_emergency",
	}
}
