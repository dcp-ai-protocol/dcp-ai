package v2

// EXPERIMENTAL, opt-in (candidate dcp-jcs-v2, phase 3): verification of the original bytes of a signed
// bundle. The bytes are routed once by the phase 2 router, and then at most one verifier runs:
//
//   - "reject": none.
//   - "v1_path": VerifySignedBundleV2At on the unit bytes, which is what a current caller hands it,
//     whatever the historical decoder made of them; its own parser gives its own verdict.
//   - "candidate": today's verifier, accepting exactly dcp-jcs-v2, on the candidate's canonical bytes,
//     so encoding/json never reads a literal the candidate normalized.
//
// There is no second attempt under another profile. Verified means the signatures and commitments
// verified; it grants no trust or admission and authorizes nothing.

import (
	"encoding/json"
	"fmt"
	"time"
)

// ExperimentalCandidateVerifierConfig is the configuration of NewExperimentalCandidateVerifier.
// Historical names the decoder by a closed name: only "encoding_json", the decoding inside
// VerifySignedBundleV2At, which the verifier builds itself, so no exported value can change it.
type ExperimentalCandidateVerifierConfig struct {
	Transport        string
	AcceptedProfiles any
	Historical       string
}

// ExperimentalCandidateVerification is the route, the verifier it entered ("none", "dcp-jcs-v1" or
// "dcp-jcs-v2", at most one) and that verifier's result as is (nil when none ran).
type ExperimentalCandidateVerification struct {
	Route        ExperimentalCandidateRoute
	Entered      string
	Verification *V2VerificationResult
}

// ExperimentalCandidateVerifier verifies original bytes over a router (NewExperimentalCandidateVerifier).
type ExperimentalCandidateVerifier struct {
	router *ExperimentalCandidateRouter
	probe  func(entered string) // observes which verifier is about to run; set only by the tests
}

// decodeEncodingJSON is the private, fixed decoder behind the name "encoding_json".
func decodeEncodingJSON(unit []byte) (any, error) {
	var v any
	if err := json.Unmarshal(unit, &v); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrHistoricalDecodeFailure, err)
	}
	return v, nil
}

// NewExperimentalCandidateVerifier is EXPERIMENTAL, opt-in (candidate dcp-jcs-v2, phase 3): a verifier
// of original bytes over a router created from cfg (NewExperimentalCandidateRouter: validated before
// any input, no default profile).
func NewExperimentalCandidateVerifier(cfg ExperimentalCandidateVerifierConfig) (*ExperimentalCandidateVerifier, error) {
	var historical *ExperimentalHistoricalAdapter // any other name: the router refuses it, after the policy and transport
	if cfg.Historical == "encoding_json" {
		historical = &ExperimentalHistoricalAdapter{Name: "encoding_json", Decode: decodeEncodingJSON}
	}
	router, err := NewExperimentalCandidateRouter(ExperimentalCandidateRouterConfig{
		Transport:        cfg.Transport,
		AcceptedProfiles: cfg.AcceptedProfiles,
		Historical:       historical,
	})
	if err != nil {
		return nil, err
	}
	return &ExperimentalCandidateVerifier{router: router}, nil
}

// Configuration is a fresh copy of the effective configuration.
func (v *ExperimentalCandidateVerifier) Configuration() (transport string, acceptedProfiles []string, historical string) {
	return v.router.Configuration()
}

// VerifyAt routes input and runs at most one verifier, with the parameters of VerifySignedBundleV2At.
// The error is an adapter or internal error, never a rejection of the data.
func (v *ExperimentalCandidateVerifier) VerifyAt(registry *AlgorithmRegistry, input []byte, policy VerifierPolicy, now time.Time) (ExperimentalCandidateVerification, error) {
	route, err := v.router.Route(input)
	if err != nil {
		return ExperimentalCandidateVerification{}, err
	}
	switch route.Outcome {
	case "reject":
		return ExperimentalCandidateVerification{Route: route, Entered: "none"}, nil
	case "v1_path":
		v.enter("dcp-jcs-v1")
		return ExperimentalCandidateVerification{Route: route, Entered: "dcp-jcs-v1",
			Verification: VerifySignedBundleV2At(registry, route.Unit.Bytes, policy, now)}, nil
	case "candidate":
		unit, _ := route.Value.(map[string]any)
		bundle, _ := unit["bundle"].(map[string]any)
		manifest, _ := bundle["manifest"].(map[string]any)
		if manifest["canonicalization_profile"] != "dcp-jcs-v2" {
			return ExperimentalCandidateVerification{}, fmt.Errorf("%w: a candidate route whose value does not name dcp-jcs-v2", ErrExperimentalCandidateInternal)
		}
		v.enter("dcp-jcs-v2")
		return ExperimentalCandidateVerification{Route: route, Entered: "dcp-jcs-v2",
			Verification: verifySignedBundleV2AtProfile(registry, route.Canonical, policy, now, "dcp-jcs-v2")}, nil
	}
	return ExperimentalCandidateVerification{}, fmt.Errorf("%w: unknown route outcome %q", ErrExperimentalCandidateInternal, route.Outcome)
}

func (v *ExperimentalCandidateVerifier) enter(profile string) {
	if v.probe != nil {
		v.probe(profile)
	}
}
