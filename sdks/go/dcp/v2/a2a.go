// Package v2 — DCP-04 A2A (Go port).
//
// Discovery + handshake factories + session layer (AES-256-GCM) using Go
// stdlib. The ephemeral KEM exchange that produces the 32-byte session key
// is out of scope of this module; callers obtain the key via ML-KEM-768 or
// X25519 (already available via the provider registry) and pass it into
// CreateSession.

package v2

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ── Discovery ──

func CreateAgentDirectoryA2A(organization string, agents []map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"dcp_version":  "2.0",
		"organization": organization,
		"agents":       agents,
	}
}

func FindAgentByCapability(directory map[string]interface{}, required []string) map[string]interface{} {
	agents, _ := directory["agents"].([]map[string]interface{})
	for _, agent := range agents {
		if agent["status"] != "active" {
			continue
		}
		caps, _ := agent["capabilities"].([]string)
		ok := true
		for _, r := range required {
			found := false
			for _, c := range caps {
				if c == r {
					found = true
					break
				}
			}
			if !found {
				ok = false
				break
			}
		}
		if ok {
			return agent
		}
	}
	return nil
}

func FindAgentByID(directory map[string]interface{}, agentID string) map[string]interface{} {
	agents, _ := directory["agents"].([]map[string]interface{})
	for _, agent := range agents {
		if agent["agent_id"] == agentID && agent["status"] == "active" {
			return agent
		}
	}
	return nil
}

func ValidateDirectoryEntry(entry map[string]interface{}) []string {
	errs := []string{}
	if s, _ := entry["agent_id"].(string); s == "" {
		errs = append(errs, "Missing agent_id")
	}
	if s, _ := entry["agent_name"].(string); s == "" {
		errs = append(errs, "Missing agent_name")
	}
	caps, _ := entry["capabilities"].([]string)
	if len(caps) == 0 {
		errs = append(errs, "capabilities must be non-empty array")
	}
	if s, _ := entry["bundle_endpoint"].(string); s == "" {
		errs = append(errs, "Missing bundle_endpoint")
	}
	if s, _ := entry["a2a_endpoint"].(string); s == "" {
		errs = append(errs, "Missing a2a_endpoint")
	}
	if s, _ := entry["status"].(string); s != "active" && s != "suspended" && s != "revoked" {
		errs = append(errs, "Invalid status")
	}
	return errs
}

// ── Handshake ──

// GenerateHandshakeNonce returns a 256-bit handshake nonce (64 lowercase hex chars).
func GenerateHandshakeNonce() string {
	var b [32]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func CreateHello(
	initiatorBundle map[string]interface{},
	kemPublicKeyB64 string,
	requestedCapabilities []string,
	securityTier string,
) map[string]interface{} {
	return map[string]interface{}{
		"type":              "A2A_HELLO",
		"protocol_version":  "2.0",
		"initiator_bundle":  initiatorBundle,
		"ephemeral_kem_public_key": map[string]interface{}{
			"alg":            "x25519-ml-kem-768",
			"public_key_b64": kemPublicKeyB64,
		},
		"nonce": GenerateHandshakeNonce(),
		"supported_algorithms": map[string]interface{}{
			"signing": []string{"ed25519", "ml-dsa-65"},
			"kem":     []string{"x25519-ml-kem-768"},
			"cipher":  []string{"aes-256-gcm"},
		},
		"requested_capabilities": requestedCapabilities,
		"security_tier":          securityTier,
		"timestamp":              utcNowISO(),
	}
}

func CreateWelcome(
	responderBundle map[string]interface{},
	kemPublicKeyB64 string,
	kemCiphertextB64 string,
	resolvedTier string,
) map[string]interface{} {
	return map[string]interface{}{
		"type":             "A2A_WELCOME",
		"protocol_version": "2.0",
		"responder_bundle": responderBundle,
		"ephemeral_kem_public_key": map[string]interface{}{
			"alg":            "x25519-ml-kem-768",
			"public_key_b64": kemPublicKeyB64,
		},
		"nonce": GenerateHandshakeNonce(),
		"kem_ciphertext": map[string]interface{}{
			"alg":            "x25519-ml-kem-768",
			"ciphertext_b64": kemCiphertextB64,
		},
		"selected_algorithms": map[string]interface{}{
			"signing": "ed25519",
			"kem":     "x25519-ml-kem-768",
			"cipher":  "aes-256-gcm",
		},
		"resolved_security_tier": resolvedTier,
		"timestamp":              utcNowISO(),
	}
}

// DeriveSessionID hashes the two nonces + session key into a stable 64-hex session id.
func DeriveSessionID(agentIDA, agentIDB, nonceAHex, nonceBHex string, sessionKey []byte) (string, error) {
	nonceA, err := hex.DecodeString(nonceAHex)
	if err != nil {
		return "", err
	}
	nonceB, err := hex.DecodeString(nonceBHex)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte("DCP-AI.v2.A2A.Session"))
	h.Write([]byte{0})
	h.Write([]byte(agentIDA))
	h.Write([]byte{0})
	h.Write([]byte(agentIDB))
	h.Write([]byte{0})
	h.Write(nonceA)
	h.Write(nonceB)
	h.Write(sessionKey)
	return hex.EncodeToString(h.Sum(nil)), nil
}

func CreateCloseMessage(sessionID, reason string, finalSequence uint64, auditSummaryHash string) map[string]interface{} {
	return map[string]interface{}{
		"type":               "A2A_CLOSE",
		"session_id":         sessionID,
		"reason":             reason,
		"final_sequence":     finalSequence,
		"audit_summary_hash": auditSummaryHash,
		"timestamp":          utcNowISO(),
	}
}

// ── Session ──

// A2ASession holds symmetric-channel state between two agents.
type A2ASession struct {
	SessionID           string
	SessionKey          []byte
	AgentIDLocal        string
	AgentIDRemote       string
	SecurityTier        string
	RekeyingInterval    int
	MessageCounterSend  int
	MessageCounterRecv  int
	CreatedAt           string
	LastActivity        string
	Status              string // "active" | "rekeying" | "closed"
}

// CreateA2ASession constructs a new A2A session. `sessionKey` must be 32 bytes.
func CreateA2ASession(
	sessionID string,
	sessionKey []byte,
	localAgentID, remoteAgentID, securityTier string,
	rekeyingInterval int,
) (*A2ASession, error) {
	if len(sessionKey) != 32 {
		return nil, errors.New("session_key must be 32 bytes (256 bits)")
	}
	if rekeyingInterval <= 0 {
		rekeyingInterval = 1000
	}
	now := utcNowISO()
	return &A2ASession{
		SessionID:        sessionID,
		SessionKey:       sessionKey,
		AgentIDLocal:     localAgentID,
		AgentIDRemote:    remoteAgentID,
		SecurityTier:     securityTier,
		RekeyingInterval: rekeyingInterval,
		CreatedAt:        now,
		LastActivity:     now,
		Status:           "active",
	}, nil
}

// EncryptMessage encrypts a JSON payload and bumps the send counter.
func EncryptMessage(session *A2ASession, payload map[string]interface{}) (map[string]interface{}, error) {
	if session.Status != "active" {
		return nil, fmt.Errorf("cannot send on %s session", session.Status)
	}
	plain, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	sequence := session.MessageCounterSend
	session.MessageCounterSend++
	timestamp := utcNowISO()
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return nil, fmt.Errorf("rand: %w", err)
	}
	block, err := aes.NewCipher(session.SessionKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	aad := buildAAD(session.SessionID, sequence, session.AgentIDLocal, timestamp)
	ct := gcm.Seal(nil, iv, plain, aad)
	// ct == ciphertext || tag (tag = last 16 bytes)
	ciphertext := ct[:len(ct)-16]
	tag := ct[len(ct)-16:]
	session.LastActivity = timestamp
	return map[string]interface{}{
		"session_id":        session.SessionID,
		"sequence":          sequence,
		"type":              "A2A_MESSAGE",
		"encrypted_payload": base64.StdEncoding.EncodeToString(ciphertext),
		"iv":                base64.StdEncoding.EncodeToString(iv),
		"tag":               base64.StdEncoding.EncodeToString(tag),
		"sender_agent_id":   session.AgentIDLocal,
		"timestamp":         timestamp,
	}, nil
}

// DecryptMessage verifies AAD + tag, returns the decoded JSON, and advances the recv counter.
func DecryptMessage(session *A2ASession, msg map[string]interface{}) (map[string]interface{}, error) {
	if msg["session_id"] != session.SessionID {
		return nil, errors.New("session ID mismatch")
	}
	if msg["sender_agent_id"] != session.AgentIDRemote {
		return nil, errors.New("unexpected sender")
	}
	seq, _ := intOf(msg["sequence"])
	if seq <= session.MessageCounterRecv-1 && session.MessageCounterRecv > 0 {
		if seq < session.MessageCounterRecv-1000 {
			return nil, errors.New("message sequence too old (outside window)")
		}
	}
	iv, err := base64.StdEncoding.DecodeString(mustString(msg["iv"]))
	if err != nil {
		return nil, fmt.Errorf("decode iv: %w", err)
	}
	tag, err := base64.StdEncoding.DecodeString(mustString(msg["tag"]))
	if err != nil {
		return nil, fmt.Errorf("decode tag: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(mustString(msg["encrypted_payload"]))
	if err != nil {
		return nil, fmt.Errorf("decode ciphertext: %w", err)
	}
	block, err := aes.NewCipher(session.SessionKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	aad := buildAAD(mustString(msg["session_id"]), seq, mustString(msg["sender_agent_id"]), mustString(msg["timestamp"]))
	plain, err := gcm.Open(nil, iv, append(ciphertext, tag...), aad)
	if err != nil {
		return nil, fmt.Errorf("gcm open: %w", err)
	}
	if seq+1 > session.MessageCounterRecv {
		session.MessageCounterRecv = seq + 1
	}
	session.LastActivity = mustString(msg["timestamp"])
	var out map[string]interface{}
	if err := json.Unmarshal(plain, &out); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return out, nil
}

// NeedsRekeying returns true if the session hit the rekey interval on send.
func NeedsRekeying(session *A2ASession) bool {
	return session.MessageCounterSend >= session.RekeyingInterval
}

// GenerateResumeProof produces an HMAC-SHA256 proof binding session + last seq.
func GenerateResumeProof(session *A2ASession, lastSeenSequence int) string {
	m := hmac.New(sha256.New, session.SessionKey)
	m.Write([]byte(fmt.Sprintf("%s%d", session.SessionID, lastSeenSequence)))
	return hex.EncodeToString(m.Sum(nil))
}

func VerifyResumeProof(session *A2ASession, lastSeenSequence int, proof string) bool {
	expected := GenerateResumeProof(session, lastSeenSequence)
	return hmac.Equal([]byte(expected), []byte(proof))
}

func DeriveRekeyedSessionKey(oldSessionKey, newSharedSecret []byte, sessionID string) []byte {
	info := []byte("DCP-AI.v2.A2A.Rekey" + sessionID)
	m := hmac.New(sha256.New, oldSessionKey)
	m.Write(append(newSharedSecret, info...))
	return m.Sum(nil)
}

// ── helpers ──

func buildAAD(sessionID string, sequence int, senderID, timestamp string) []byte {
	return []byte(fmt.Sprintf("%s%d%s%s", sessionID, sequence, senderID, timestamp))
}

func intOf(v interface{}) (int, bool) {
	switch x := v.(type) {
	case int:
		return x, true
	case int64:
		return int(x), true
	case uint64:
		return int(x), true
	case float64:
		return int(x), true
	}
	return 0, false
}

func mustString(v interface{}) string {
	s, _ := v.(string)
	return s
}

// Make sure time package is referenced so goimports doesn't drop it.
var _ = time.Now
