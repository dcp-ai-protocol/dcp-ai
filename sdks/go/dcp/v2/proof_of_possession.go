package v2

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
)

// PopChallenge represents a proof-of-possession challenge for key registration.
type PopChallenge struct {
	Kid       string `json:"kid"`
	AgentID   string `json:"agent_id"`
	Timestamp string `json:"timestamp"`
	Nonce     string `json:"nonce"`
}

// KeyRotationRecord represents a key rotation with PoP and authorization.
type KeyRotationRecord struct {
	Type                string         `json:"type"`
	OldKid              string         `json:"old_kid"`
	NewKid              string         `json:"new_kid"`
	NewKey              KeyRotationKey `json:"new_key"`
	Timestamp           string         `json:"timestamp"`
	ProofOfPossession   SignatureEntry `json:"proof_of_possession"`
	AuthorizationSig    SignatureEntry `json:"authorization_sig"`
}

// KeyRotationKey contains the new key's metadata.
type KeyRotationKey struct {
	Kid          string  `json:"kid"`
	Alg          string  `json:"alg"`
	PublicKeyB64 string  `json:"public_key_b64"`
	CreatedAt    string  `json:"created_at"`
	ExpiresAt    *string `json:"expires_at"`
	Status       string  `json:"status"`
}

// canonicalJSON produces a sorted-key JSON encoding (simplified RFC 8785).
func canonicalJSON(v interface{}) ([]byte, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return marshalSorted(m)
}

func marshalSorted(m map[string]interface{}) ([]byte, error) {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	buf := []byte("{")
	for i, k := range keys {
		if i > 0 {
			buf = append(buf, ',')
		}
		kb, _ := json.Marshal(k)
		buf = append(buf, kb...)
		buf = append(buf, ':')
		vb, err := json.Marshal(m[k])
		if err != nil {
			return nil, err
		}
		buf = append(buf, vb...)
	}
	buf = append(buf, '}')
	return buf, nil
}

// GenerateRegistrationPoP creates a proof-of-possession for initial key registration.
func GenerateRegistrationPoP(
	provider CryptoProvider,
	challenge *PopChallenge,
	secretKeyB64 string,
) (*SignatureEntry, error) {
	canonical, err := canonicalJSON(challenge)
	if err != nil {
		return nil, fmt.Errorf("canonicalize challenge: %w", err)
	}
	dsm, err := DomainSeparatedMessage(CtxProofOfPossession, canonical)
	if err != nil {
		return nil, err
	}
	sig, err := provider.Sign(dsm, secretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("sign PoP: %w", err)
	}
	return &SignatureEntry{
		Alg:    provider.Alg(),
		Kid:    challenge.Kid,
		SigB64: base64.StdEncoding.EncodeToString(sig),
	}, nil
}

// VerifyRegistrationPoP verifies a proof-of-possession for key registration.
func VerifyRegistrationPoP(
	provider CryptoProvider,
	challenge *PopChallenge,
	pop *SignatureEntry,
	publicKeyB64 string,
) (bool, error) {
	canonical, err := canonicalJSON(challenge)
	if err != nil {
		return false, fmt.Errorf("canonicalize challenge: %w", err)
	}
	dsm, err := DomainSeparatedMessage(CtxProofOfPossession, canonical)
	if err != nil {
		return false, err
	}
	sigBytes, err := base64.StdEncoding.DecodeString(pop.SigB64)
	if err != nil {
		return false, fmt.Errorf("decode sig: %w", err)
	}
	return provider.Verify(dsm, sigBytes, publicKeyB64)
}

type rotationPayload struct {
	NewKid    string `json:"new_kid"`
	OldKid    string `json:"old_kid"`
	Timestamp string `json:"timestamp"`
}

// CreateKeyRotation creates a key rotation record with PoP and authorization.
func CreateKeyRotation(
	oldProvider CryptoProvider,
	newProvider CryptoProvider,
	oldKid string,
	oldSecretKeyB64 string,
	newKid string,
	newSecretKeyB64 string,
	newPublicKeyB64 string,
	newAlg string,
	timestamp string,
	expiresAt *string,
) (*KeyRotationRecord, error) {
	payload := rotationPayload{
		OldKid:    oldKid,
		NewKid:    newKid,
		Timestamp: timestamp,
	}
	canonical, err := canonicalJSON(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize rotation payload: %w", err)
	}
	dsm, err := DomainSeparatedMessage(CtxKeyRotation, canonical)
	if err != nil {
		return nil, err
	}

	popSig, err := newProvider.Sign(dsm, newSecretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("sign PoP: %w", err)
	}
	authSig, err := oldProvider.Sign(dsm, oldSecretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("sign authorization: %w", err)
	}

	return &KeyRotationRecord{
		Type:      "key_rotation",
		OldKid:    oldKid,
		NewKid:    newKid,
		Timestamp: timestamp,
		NewKey: KeyRotationKey{
			Kid:          newKid,
			Alg:          newAlg,
			PublicKeyB64: newPublicKeyB64,
			CreatedAt:    timestamp,
			ExpiresAt:    expiresAt,
			Status:       "active",
		},
		ProofOfPossession: SignatureEntry{
			Alg:    newProvider.Alg(),
			Kid:    newKid,
			SigB64: base64.StdEncoding.EncodeToString(popSig),
		},
		AuthorizationSig: SignatureEntry{
			Alg:    oldProvider.Alg(),
			Kid:    oldKid,
			SigB64: base64.StdEncoding.EncodeToString(authSig),
		},
	}, nil
}

// VerifyKeyRotation verifies a key rotation record.
// Returns (valid, popValid, authValid).
func VerifyKeyRotation(
	oldProvider CryptoProvider,
	newProvider CryptoProvider,
	record *KeyRotationRecord,
	oldPublicKeyB64 string,
	newPublicKeyB64 string,
) (bool, bool, bool, error) {
	payload := rotationPayload{
		OldKid:    record.OldKid,
		NewKid:    record.NewKid,
		Timestamp: record.Timestamp,
	}
	canonical, err := canonicalJSON(payload)
	if err != nil {
		return false, false, false, fmt.Errorf("canonicalize: %w", err)
	}
	dsm, err := DomainSeparatedMessage(CtxKeyRotation, canonical)
	if err != nil {
		return false, false, false, err
	}

	popSig, err := base64.StdEncoding.DecodeString(record.ProofOfPossession.SigB64)
	if err != nil {
		return false, false, false, fmt.Errorf("decode pop sig: %w", err)
	}
	authSig, err := base64.StdEncoding.DecodeString(record.AuthorizationSig.SigB64)
	if err != nil {
		return false, false, false, fmt.Errorf("decode auth sig: %w", err)
	}

	popValid, err := newProvider.Verify(dsm, popSig, newPublicKeyB64)
	if err != nil {
		return false, false, false, err
	}
	authValid, err := oldProvider.Verify(dsm, authSig, oldPublicKeyB64)
	if err != nil {
		return false, false, false, err
	}

	return popValid && authValid, popValid, authValid, nil
}
