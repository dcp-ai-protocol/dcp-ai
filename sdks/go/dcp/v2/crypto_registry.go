package v2

import "sort"

// AlgorithmRegistry manages registered signature and KEM providers.
type AlgorithmRegistry struct {
	sigProviders map[string]CryptoProvider
	kemProviders map[string]KemProvider
}

// NewAlgorithmRegistry creates an empty registry.
func NewAlgorithmRegistry() *AlgorithmRegistry {
	return &AlgorithmRegistry{
		sigProviders: make(map[string]CryptoProvider),
		kemProviders: make(map[string]KemProvider),
	}
}

// RegisterSigner adds a signature provider, keyed by its Alg().
func (r *AlgorithmRegistry) RegisterSigner(p CryptoProvider) {
	r.sigProviders[p.Alg()] = p
}

// RegisterKem adds a KEM provider, keyed by its Alg().
func (r *AlgorithmRegistry) RegisterKem(p KemProvider) {
	r.kemProviders[p.Alg()] = p
}

// GetSigner returns the signature provider for the given algorithm.
func (r *AlgorithmRegistry) GetSigner(alg string) (CryptoProvider, error) {
	p, ok := r.sigProviders[alg]
	if !ok {
		return nil, &ErrUnknownAlgorithm{Alg: alg, Kind: "signer"}
	}
	return p, nil
}

// GetKem returns the KEM provider for the given algorithm.
func (r *AlgorithmRegistry) GetKem(alg string) (KemProvider, error) {
	p, ok := r.kemProviders[alg]
	if !ok {
		return nil, &ErrUnknownAlgorithm{Alg: alg, Kind: "kem"}
	}
	return p, nil
}

// HasSigner reports whether a signer is registered for the given algorithm.
func (r *AlgorithmRegistry) HasSigner(alg string) bool {
	_, ok := r.sigProviders[alg]
	return ok
}

// HasKem reports whether a KEM is registered for the given algorithm.
func (r *AlgorithmRegistry) HasKem(alg string) bool {
	_, ok := r.kemProviders[alg]
	return ok
}

// ListSigners returns sorted algorithm names for all registered signers.
func (r *AlgorithmRegistry) ListSigners() []string {
	names := make([]string, 0, len(r.sigProviders))
	for k := range r.sigProviders {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

// ListKems returns sorted algorithm names for all registered KEMs.
func (r *AlgorithmRegistry) ListKems() []string {
	names := make([]string, 0, len(r.kemProviders))
	for k := range r.kemProviders {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}
