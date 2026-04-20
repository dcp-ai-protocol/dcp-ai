package providers

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"github.com/cloudflare/circl/sign/slhdsa"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// SlhDsa192fProvider implements v2.CryptoProvider using SLH-DSA-SHA2-192f (FIPS 205, Level 3).
// Backup PQ family — hash-based, conservative, mathematically independent from ML-DSA.
type SlhDsa192fProvider struct{}

func (p *SlhDsa192fProvider) Alg() string         { return "slh-dsa-192f" }
func (p *SlhDsa192fProvider) KeySize() int         { return 48 }
func (p *SlhDsa192fProvider) SigSize() int         { return 35664 }
func (p *SlhDsa192fProvider) IsConstantTime() bool { return true }

func (p *SlhDsa192fProvider) GenerateKeypair() (*v2.GeneratedKeypair, error) {
	pk, sk, err := slhdsa.GenerateKey(rand.Reader, slhdsa.SHA2_192f)
	if err != nil {
		return nil, fmt.Errorf("slh-dsa-192f keygen: %w", err)
	}
	pkBytes, err := pk.MarshalBinary()
	if err != nil {
		return nil, fmt.Errorf("slh-dsa-192f marshal pk: %w", err)
	}
	skBytes, err := sk.MarshalBinary()
	if err != nil {
		return nil, fmt.Errorf("slh-dsa-192f marshal sk: %w", err)
	}
	kid := v2.DeriveKid("slh-dsa-192f", pkBytes)
	return &v2.GeneratedKeypair{
		Kid:          kid,
		PublicKeyB64: base64.StdEncoding.EncodeToString(pkBytes),
		SecretKeyB64: base64.StdEncoding.EncodeToString(skBytes),
	}, nil
}

func (p *SlhDsa192fProvider) Sign(message []byte, secretKeyB64 string) ([]byte, error) {
	skBytes, err := base64.StdEncoding.DecodeString(secretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("decode secret key: %w", err)
	}
	sk := new(slhdsa.PrivateKey)
	if err := sk.UnmarshalBinary(skBytes); err != nil {
		return nil, fmt.Errorf("unmarshal slh-dsa-192f sk: %w", err)
	}
	sig, err := slhdsa.SignDeterministic(sk, slhdsa.NewMessage(message), nil)
	if err != nil {
		return nil, fmt.Errorf("slh-dsa-192f sign: %w", err)
	}
	return sig, nil
}

func (p *SlhDsa192fProvider) Verify(message []byte, signature []byte, publicKeyB64 string) (bool, error) {
	pkBytes, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil {
		return false, fmt.Errorf("decode public key: %w", err)
	}
	pk := new(slhdsa.PublicKey)
	if err := pk.UnmarshalBinary(pkBytes); err != nil {
		return false, fmt.Errorf("unmarshal slh-dsa-192f pk: %w", err)
	}
	return slhdsa.Verify(pk, slhdsa.NewMessage(message), signature, nil), nil
}

var _ v2.CryptoProvider = (*SlhDsa192fProvider)(nil)
