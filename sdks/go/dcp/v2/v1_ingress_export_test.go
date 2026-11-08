package v2

// Test-only access to the two test points of AdmitSignedBundleV2FromBytes: this file is compiled only into
// the test build of the package, so none of it is part of the API.

// AdmitFromBytesForTests is the same route with another decoder (nil: json.Unmarshal into any) and a call
// just before the bridge to AdmitSignedBundleV2 (nil: none).
func AdmitFromBytesForTests(registry *AlgorithmRegistry, input []byte, opts AdmitOptions, decode func([]byte) (any, error), beforeAdmit func()) (*IngressAdmissionResult, error) {
	if decode == nil {
		decode = decodeIngressJSON
	}
	return admitFromBytes(registry, input, opts, decode, beforeAdmit)
}
