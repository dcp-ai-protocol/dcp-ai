// Package v2 — DCP v2.0 Session Nonce (Go port).

package v2

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"time"
)

var sessionNoncePattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// GenerateSessionNonce returns a cryptographically random 256-bit session nonce
// as 64 lowercase hex characters.
func GenerateSessionNonce() string {
	var b [32]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// IsValidSessionNonce reports whether s is a well-formed session nonce.
func IsValidSessionNonce(s string) bool {
	return len(s) == 64 && sessionNoncePattern.MatchString(s)
}

// SessionBindingResult is the outcome of VerifySessionBinding.
type SessionBindingResult struct {
	Valid bool
	Nonce string
	Error string
}

// VerifySessionBinding ensures all artifacts share the same session_nonce.
func VerifySessionBinding(artifacts []map[string]interface{}) SessionBindingResult {
	if len(artifacts) == 0 {
		return SessionBindingResult{Error: "No artifacts to verify"}
	}
	first, _ := artifacts[0]["session_nonce"].(string)
	if !IsValidSessionNonce(first) {
		return SessionBindingResult{Error: fmt.Sprintf("Invalid session_nonce in artifact[0]: %q", first)}
	}
	for i, art := range artifacts[1:] {
		nonce, _ := art["session_nonce"].(string)
		if nonce != first {
			return SessionBindingResult{
				Error: fmt.Sprintf("Session nonce mismatch: artifact[0]=%s, artifact[%d]=%s", first, i+1, nonce),
			}
		}
	}
	return SessionBindingResult{Valid: true, Nonce: first}
}

var defaultSessionDurations = map[string]int{
	"routine":  86400,
	"standard": 14400,
	"elevated": 3600,
	"maximum":  900,
}

// GenerateSessionExpiry returns an ISO-8601 UTC timestamp duration seconds in the future.
// If duration is zero, the per-tier default is used (defaulting to 4h when tier is unknown).
func GenerateSessionExpiry(duration int, tier string) string {
	if duration == 0 {
		if d, ok := defaultSessionDurations[tier]; ok {
			duration = d
		} else {
			duration = 14400
		}
	}
	return time.Now().UTC().Add(time.Duration(duration) * time.Second).Format("2006-01-02T15:04:05.000Z")
}

// IsSessionExpired reports whether the ISO-8601 timestamp is in the past.
func IsSessionExpired(expiresAt string) bool {
	t, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		t2, err2 := time.Parse("2006-01-02T15:04:05.000Z", expiresAt)
		if err2 != nil {
			return false
		}
		t = t2
	}
	return t.Before(time.Now().UTC())
}
