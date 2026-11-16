package v2_test

// E5 gaps found in MP-03 P4: an operator configuration error is a typed error, never a result, through two public
// functions whose own tests did not reach it. Mirrors sdks/typescript/src/__tests__/e5-config-errors.test.ts.
//
//   - AdmitSignedBundleV2FromBytes: on bytes its ingress accepts, *AdmissionConfigError with the code
//     AdmitSignedBundleV2 gives for the same options. On bytes the ingress rejects, the ingress decides first (scanner,
//     domain, parser, then admission, where the configuration is read): a result with the rejection and no admission.
//   - EvaluateDelegationActivationV2: the 6 config_cases of delegated_admission_vectors.json give the
//     *AdmissionConfigError and code AdmitDelegatedBundleV2 gives (delegated_admission_test.go), before any evidence.

import (
	"encoding/json"
	"errors"
	"testing"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func e5BadOptions(t *testing.T, v *delegatedVectors) map[string]v2.AdmitOptions {
	t.Helper()
	var policy v2.VerifierPolicy
	if err := json.Unmarshal(v.Policies["weak_classical"], &policy); err != nil {
		t.Fatal(err)
	}
	withPolicy := f3Strict(t, v)
	withPolicy.Policy = &policy
	withoutTrust := f3Strict(t, v)
	withoutTrust.Trust = nil
	return map[string]v2.AdmitOptions{"a profile with a verifier policy": withPolicy, "a profile without a trust set": withoutTrust}
}

func TestE5FromBytesConfigErrors(t *testing.T) {
	v, _, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	bundle := []byte(v.SignedBundles["orch"])
	control := f3Strict(t, v)
	control.Now = now
	r, err := v2.AdmitSignedBundleV2FromBytes(reg, bundle, control)
	if err != nil || !r.Ingress.Accepted || r.Admission == nil || !r.Admission.Admitted {
		t.Fatalf("control: %v %+v", err, r)
	}
	for name, opts := range e5BadOptions(t, v) {
		opts.Now = now
		t.Run(name, func(t *testing.T) {
			var cfg *v2.AdmissionConfigError
			if _, err := v2.AdmitSignedBundleV2(reg, bundle, opts); !errors.As(err, &cfg) || cfg.Code != "CONFIG_PROFILE_CONTRADICTION" {
				t.Fatalf("object API: %v", err)
			}
			var fromBytes *v2.AdmissionConfigError
			if _, err := v2.AdmitSignedBundleV2FromBytes(reg, bundle, opts); !errors.As(err, &fromBytes) || fromBytes.Code != cfg.Code {
				t.Fatalf("from bytes: %v, want %s", err, cfg.Code)
			}
			r, err := v2.AdmitSignedBundleV2FromBytes(reg, []byte("{"), opts)
			if err != nil || r.Ingress.Accepted || r.Ingress.Layer == nil || *r.Ingress.Layer != "scanner" || r.Admission != nil {
				t.Fatalf("rejected bytes: the ingress decides first, got %v %+v", err, r)
			}
		})
	}
}

func TestE5ActivationConfigErrors(t *testing.T) {
	v, _, now := loadDelegated(t)
	reg := delegatedRegistry(nil)
	if len(v.ConfigCases) != 6 {
		t.Fatalf("%d config cases, want 6", len(v.ConfigCases))
	}
	for _, c := range v.ConfigCases {
		t.Run(c.Name, func(t *testing.T) {
			op := v2.DelegatedOperator{Revocation: v.Revocations["all_not_revoked"], MandateRevocation: v.MandateRevocations["all_not_revoked"], Now: now}
			if s, ok := c.Operator["trust"].(string); ok {
				op.TrustSetJSON = v.TrustSets[s]
			}
			if s, ok := c.Operator["profile"].(string); ok {
				op.ProfileJSON = v.Profiles[s]
			}
			if s, ok := c.Operator["policy"].(string); ok {
				op.Policy = v.Policies[s]
			}
			if f, ok := c.Operator["max_revocation_age_seconds"].(float64); ok {
				op.MaxRevocationAgeSeconds = int(f)
			}
			chain, _ := json.Marshal([]json.RawMessage{v.Mandates["root"]})
			evidence := v2.ActivationEvidence{DelegatedEvidence: v2.DelegatedEvidence{SignedBundle: v.SignedBundles["orch"], MandateChain: chain}}
			_, err := v2.EvaluateDelegationActivationV2(reg, evidence, op)
			var cfg *v2.AdmissionConfigError
			if !errors.As(err, &cfg) || cfg.Code != c.Code {
				t.Fatalf("got %v, want %s", err, c.Code)
			}
		})
	}
}
