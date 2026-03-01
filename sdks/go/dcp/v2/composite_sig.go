package v2

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
