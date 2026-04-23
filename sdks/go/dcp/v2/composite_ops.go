package v2

import (
	"encoding/base64"
	"fmt"
)

// CompositeKeyInfo holds key material for composite signing.
type CompositeKeyInfo struct {
	Kid          string
	Alg          string
	SecretKeyB64 string
	PublicKeyB64 string
}

// CompositeVerifyResult reports the outcome of composite verification.
type CompositeVerifyResult struct {
	Valid          bool
	ClassicalValid bool
	PQValid        bool
}

// CompositeSign produces a composite-bound hybrid signature (PQ over classical).
//
// Protocol:
//
//	1. classical_sig = classical.sign(context || 0x00 || payload)
//	2. pq_sig = pq.sign(context || 0x00 || payload || classical_sig)
func CompositeSign(
	registry *AlgorithmRegistry,
	context string,
	canonicalPayload []byte,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
) (*CompositeSignature, error) {
	classicalProv, err := registry.GetSigner(classicalKey.Alg)
	if err != nil {
		return nil, err
	}
	pqProv, err := registry.GetSigner(pqKey.Alg)
	if err != nil {
		return nil, err
	}

	dsm, err := DomainSeparatedMessage(context, canonicalPayload)
	if err != nil {
		return nil, err
	}

	classicalSig, err := classicalProv.Sign(dsm, classicalKey.SecretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("classical sign: %w", err)
	}

	if len(dsm) > MaxMessageBytes || len(classicalSig) > MaxMessageBytes {
		return nil, fmt.Errorf("composite message exceeds %d bytes", MaxMessageBytes)
	}
	compositeMessage := make([]byte, 0, len(dsm)+len(classicalSig))
	compositeMessage = append(compositeMessage, dsm...)
	compositeMessage = append(compositeMessage, classicalSig...)

	pqSig, err := pqProv.Sign(compositeMessage, pqKey.SecretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("pq sign: %w", err)
	}

	pqEntry := &SignatureEntry{
		Alg:    pqKey.Alg,
		Kid:    pqKey.Kid,
		SigB64: base64.StdEncoding.EncodeToString(pqSig),
	}

	return &CompositeSignature{
		Classical: SignatureEntry{
			Alg:    classicalKey.Alg,
			Kid:    classicalKey.Kid,
			SigB64: base64.StdEncoding.EncodeToString(classicalSig),
		},
		PQ:      pqEntry,
		Binding: "pq_over_classical",
	}, nil
}

// ClassicalOnlySign produces a classical-only composite signature (transition mode).
func ClassicalOnlySign(
	registry *AlgorithmRegistry,
	context string,
	canonicalPayload []byte,
	key CompositeKeyInfo,
) (*CompositeSignature, error) {
	provider, err := registry.GetSigner(key.Alg)
	if err != nil {
		return nil, err
	}

	dsm, err := DomainSeparatedMessage(context, canonicalPayload)
	if err != nil {
		return nil, err
	}

	sig, err := provider.Sign(dsm, key.SecretKeyB64)
	if err != nil {
		return nil, fmt.Errorf("classical sign: %w", err)
	}

	return &CompositeSignature{
		Classical: SignatureEntry{
			Alg:    key.Alg,
			Kid:    key.Kid,
			SigB64: base64.StdEncoding.EncodeToString(sig),
		},
		PQ:      nil,
		Binding: "classical_only",
	}, nil
}

// CompositeVerify verifies a composite-bound hybrid signature.
//
// For pq_over_classical binding:
//
//	1. Verify PQ sig over (dsm || classical_sig)
//	2. Verify classical sig over dsm
func CompositeVerify(
	registry *AlgorithmRegistry,
	context string,
	canonicalPayload []byte,
	compositeSig *CompositeSignature,
	classicalPubkeyB64 string,
	pqPubkeyB64 string,
) (*CompositeVerifyResult, error) {
	dsm, err := DomainSeparatedMessage(context, canonicalPayload)
	if err != nil {
		return nil, err
	}

	if compositeSig.Binding == "classical_only" {
		if compositeSig.PQ != nil {
			return &CompositeVerifyResult{}, nil
		}
		classicalProv, err := registry.GetSigner(compositeSig.Classical.Alg)
		if err != nil {
			return nil, err
		}
		classicalSigBytes, err := base64.StdEncoding.DecodeString(compositeSig.Classical.SigB64)
		if err != nil {
			return nil, fmt.Errorf("decode classical sig: %w", err)
		}
		classicalValid, err := classicalProv.Verify(dsm, classicalSigBytes, classicalPubkeyB64)
		if err != nil {
			return nil, err
		}
		return &CompositeVerifyResult{
			Valid:          classicalValid,
			ClassicalValid: classicalValid,
			PQValid:        false,
		}, nil
	}

	if compositeSig.Binding != "pq_over_classical" {
		return &CompositeVerifyResult{}, nil
	}

	if compositeSig.PQ == nil || pqPubkeyB64 == "" {
		return &CompositeVerifyResult{}, nil
	}

	classicalProv, err := registry.GetSigner(compositeSig.Classical.Alg)
	if err != nil {
		return nil, err
	}
	pqProv, err := registry.GetSigner(compositeSig.PQ.Alg)
	if err != nil {
		return nil, err
	}

	classicalSigBytes, err := base64.StdEncoding.DecodeString(compositeSig.Classical.SigB64)
	if err != nil {
		return nil, fmt.Errorf("decode classical sig: %w", err)
	}
	pqSigBytes, err := base64.StdEncoding.DecodeString(compositeSig.PQ.SigB64)
	if err != nil {
		return nil, fmt.Errorf("decode pq sig: %w", err)
	}

	if len(dsm) > MaxMessageBytes || len(classicalSigBytes) > MaxMessageBytes {
		return nil, fmt.Errorf("composite message exceeds %d bytes", MaxMessageBytes)
	}
	compositeMessage := make([]byte, 0, len(dsm)+len(classicalSigBytes))
	compositeMessage = append(compositeMessage, dsm...)
	compositeMessage = append(compositeMessage, classicalSigBytes...)

	classicalValid, err := classicalProv.Verify(dsm, classicalSigBytes, classicalPubkeyB64)
	if err != nil {
		return nil, err
	}
	pqValid, err := pqProv.Verify(compositeMessage, pqSigBytes, pqPubkeyB64)
	if err != nil {
		return nil, err
	}

	return &CompositeVerifyResult{
		Valid:          classicalValid && pqValid,
		ClassicalValid: classicalValid,
		PQValid:        pqValid,
	}, nil
}
