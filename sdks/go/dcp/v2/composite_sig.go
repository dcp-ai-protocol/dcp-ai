package v2

import (
	"encoding/json"
	"errors"
)

// SignatureEntry represents a single algorithm's signature component.
type SignatureEntry struct {
	Alg    string `json:"alg"`
	Kid    string `json:"kid"`
	SigB64 string `json:"sig_b64"`
}

// CompositeSignature pairs a classical signature with an optional
// post-quantum signature and a binding tag.
type CompositeSignature struct {
	Classical SignatureEntry  `json:"classical"`
	PQ        *SignatureEntry `json:"pq"`
	Binding   string          `json:"binding"`
}

// UnmarshalJSON requires the pq member, which is null for classical_only
// (schemas/v2/composite_signature.schema.json): an absent one would otherwise
// decode exactly like null.
func (cs *CompositeSignature) UnmarshalJSON(data []byte) error {
	var members map[string]json.RawMessage
	if err := json.Unmarshal(data, &members); err != nil {
		return err
	}
	if _, ok := members["pq"]; !ok {
		return errors.New("composite signature has no pq member")
	}
	type plain CompositeSignature
	return json.Unmarshal(data, (*plain)(cs))
}
