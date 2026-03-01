package providers

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	v2 "github.com/dcp-ai/dcp-ai-go/dcp/v2"
)

// Ed25519Provider implements v2.CryptoProvider using Ed25519.
type Ed25519Provider struct{}

func (p *Ed25519Provider) Alg() string          { return "ed25519" }
func (p *Ed25519Provider) KeySize() int          { return 32 }
func (p *Ed25519Provider) SigSize() int          { return 64 }
func (p *Ed25519Provider) IsConstantTime() bool  { return true }

// GenerateKeypair creates a new Ed25519 keypair and derives its kid.
func (p *Ed25519Provider) GenerateKeypair() (*v2.GeneratedKeypair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("ed25519 keygen: %w", err)
	}
	kid := v2.DeriveKid("ed25519", []byte(pub))
	return &v2.GeneratedKeypair{
		Kid:          kid,
		PublicKeyB64: base64.StdEncoding.EncodeToString(pub),
		SecretKeyB64: base64.StdEncoding.EncodeToString(priv),
	}, nil
}

// Sign produces an Ed25519 signature over message.
func (p *Ed25519Provider) Sign(message []byte, secretKeyB64 string) ([]byte, error) {
	sk, err := base64.StdEncoding.DecodeString(secretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("decode secret key: %w", err)
	}
	if len(sk) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid secret key length: got %d, want %d", len(sk), ed25519.PrivateKeySize)
	}
	return ed25519.Sign(ed25519.PrivateKey(sk), message), nil
}

// Verify checks an Ed25519 signature over message.
func (p *Ed25519Provider) Verify(message []byte, signature []byte, publicKeyB64 string) (bool, error) {
	pk, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil {
		return false, fmt.Errorf("decode public key: %w", err)
	}
	if len(pk) != ed25519.PublicKeySize {
		return false, fmt.Errorf("invalid public key length: got %d, want %d", len(pk), ed25519.PublicKeySize)
	}
	return ed25519.Verify(ed25519.PublicKey(pk), message, signature), nil
}

// Ensure Ed25519Provider satisfies v2.CryptoProvider at compile time.
var _ v2.CryptoProvider = (*Ed25519Provider)(nil)
