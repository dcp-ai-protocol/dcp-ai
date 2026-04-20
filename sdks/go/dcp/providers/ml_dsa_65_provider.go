package providers

import (
	"encoding/base64"
	"fmt"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// MlDsa65Provider implements v2.CryptoProvider using ML-DSA-65 (FIPS 204, Level 3).
type MlDsa65Provider struct{}

func (p *MlDsa65Provider) Alg() string         { return "ml-dsa-65" }
func (p *MlDsa65Provider) KeySize() int         { return 1952 }
func (p *MlDsa65Provider) SigSize() int         { return 3309 }
func (p *MlDsa65Provider) IsConstantTime() bool { return true }

func (p *MlDsa65Provider) GenerateKeypair() (*v2.GeneratedKeypair, error) {
	pk, sk, err := mldsa65.GenerateKey(nil)
	if err != nil {
		return nil, fmt.Errorf("ml-dsa-65 keygen: %w", err)
	}
	pkBytes, err := pk.MarshalBinary()
	if err != nil {
		return nil, fmt.Errorf("ml-dsa-65 marshal pk: %w", err)
	}
	skBytes, err := sk.MarshalBinary()
	if err != nil {
		return nil, fmt.Errorf("ml-dsa-65 marshal sk: %w", err)
	}
	kid := v2.DeriveKid("ml-dsa-65", pkBytes)
	return &v2.GeneratedKeypair{
		Kid:          kid,
		PublicKeyB64: base64.StdEncoding.EncodeToString(pkBytes),
		SecretKeyB64: base64.StdEncoding.EncodeToString(skBytes),
	}, nil
}

func (p *MlDsa65Provider) Sign(message []byte, secretKeyB64 string) ([]byte, error) {
	skBytes, err := base64.StdEncoding.DecodeString(secretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("decode secret key: %w", err)
	}
	var sk mldsa65.PrivateKey
	if err := sk.UnmarshalBinary(skBytes); err != nil {
		return nil, fmt.Errorf("unmarshal ml-dsa-65 sk: %w", err)
	}
	sig := make([]byte, mldsa65.SignatureSize)
	if err := mldsa65.SignTo(&sk, message, nil, false, sig); err != nil {
		return nil, fmt.Errorf("ml-dsa-65 sign: %w", err)
	}
	return sig, nil
}

func (p *MlDsa65Provider) Verify(message []byte, signature []byte, publicKeyB64 string) (bool, error) {
	pkBytes, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil {
		return false, fmt.Errorf("decode public key: %w", err)
	}
	var pk mldsa65.PublicKey
	if err := pk.UnmarshalBinary(pkBytes); err != nil {
		return false, fmt.Errorf("unmarshal ml-dsa-65 pk: %w", err)
	}
	return mldsa65.Verify(&pk, message, nil, signature), nil
}

var _ v2.CryptoProvider = (*MlDsa65Provider)(nil)
