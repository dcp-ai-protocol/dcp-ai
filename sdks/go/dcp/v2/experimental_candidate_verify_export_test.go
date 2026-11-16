package v2

// Test-only access to the experimental candidate verifier: this file is compiled only into the test
// build of the package, so none of it is part of the API.

// NewExperimentalCandidateVerifierForTests is NewExperimentalCandidateVerifier whose probe records each
// verifier it is about to run and whose "encoding_json" decoder counts its calls.
func NewExperimentalCandidateVerifierForTests(cfg ExperimentalCandidateVerifierConfig, probe func(entered string), decodes *int) (*ExperimentalCandidateVerifier, error) {
	var historical *ExperimentalHistoricalAdapter
	if cfg.Historical == "encoding_json" {
		historical = &ExperimentalHistoricalAdapter{Name: "encoding_json", Decode: func(unit []byte) (any, error) {
			*decodes++
			return decodeEncodingJSON(unit)
		}}
	}
	router, err := NewExperimentalCandidateRouter(ExperimentalCandidateRouterConfig{Transport: cfg.Transport, AcceptedProfiles: cfg.AcceptedProfiles, Historical: historical})
	if err != nil {
		return nil, err
	}
	return &ExperimentalCandidateVerifier{router: router, probe: probe}, nil
}
