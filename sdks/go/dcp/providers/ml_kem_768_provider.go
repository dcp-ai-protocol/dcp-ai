package providers

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"github.com/cloudflare/circl/kem/mlkem/mlkem768"

	v2 "github.com/dcp-ai/dcp-ai-go/dcp/v2"
)

// MlKem768Provider implements v2.KemProvider using ML-KEM-768 (FIPS 203, Level 3).
type MlKem768Provider struct{}

func (p *MlKem768Provider) Alg() string { return "ml-kem-768" }

func (p *MlKem768Provider) GenerateKeypair() (*v2.KemKeypair, error) {
	pk, sk, err := mlkem768.GenerateKeyPair(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("ml-kem-768 keygen: %w", err)
	}
	pkBytes, err := pk.MarshalBinary()
	if err != nil {
		return nil, fmt.Errorf("ml-kem-768 marshal pk: %w", err)
	}
	skBytes, err := sk.MarshalBinary()
	if err != nil {
		return nil, fmt.Errorf("ml-kem-768 marshal sk: %w", err)
	}
	kid := v2.DeriveKid("ml-kem-768", pkBytes)
	return &v2.KemKeypair{
		Kid:          kid,
		PublicKeyB64: base64.StdEncoding.EncodeToString(pkBytes),
		SecretKeyB64: base64.StdEncoding.EncodeToString(skBytes),
	}, nil
}

func (p *MlKem768Provider) Encapsulate(publicKeyB64 string) (*v2.EncapsulateResult, error) {
	pkBytes, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil {
		return nil, fmt.Errorf("decode public key: %w", err)
	}
	var pk mlkem768.PublicKey
	if err := pk.Unpack(pkBytes); err != nil {
		return nil, fmt.Errorf("unpack ml-kem-768 pk: %w", err)
	}

	ct := make([]byte, mlkem768.CiphertextSize)
	ss := make([]byte, mlkem768.SharedKeySize)
	seed := make([]byte, mlkem768.EncapsulationSeedSize)
	if _, err := rand.Read(seed); err != nil {
		return nil, fmt.Errorf("ml-kem-768 random seed: %w", err)
	}
	pk.EncapsulateTo(ct, ss, seed)

	return &v2.EncapsulateResult{
		CiphertextB64:   base64.StdEncoding.EncodeToString(ct),
		SharedSecretB64: base64.StdEncoding.EncodeToString(ss),
	}, nil
}

func (p *MlKem768Provider) Decapsulate(ciphertextB64 string, secretKeyB64 string) ([]byte, error) {
	ctBytes, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return nil, fmt.Errorf("decode ciphertext: %w", err)
	}
	skBytes, err := base64.StdEncoding.DecodeString(secretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("decode secret key: %w", err)
	}
	var sk mlkem768.PrivateKey
	if err := sk.Unpack(skBytes); err != nil {
		return nil, fmt.Errorf("unpack ml-kem-768 sk: %w", err)
	}

	ss := make([]byte, mlkem768.SharedKeySize)
	sk.DecapsulateTo(ss, ctBytes)
	return ss, nil
}

var _ v2.KemProvider = (*MlKem768Provider)(nil)
