package v2

// Test-only access to the internal verifier with a mandate chain floor: this file is compiled only into the
// test build of the package, so none of it is part of the API.

import "time"

// VerifySignedBundleV2AtFloorForTests is the internal step AdmitDelegatedBundleV2 verifies each bundle with.
func VerifySignedBundleV2AtFloorForTests(registry *AlgorithmRegistry, signedBundleJSON []byte, policy VerifierPolicy, now time.Time, tierFloor string) *V2VerificationResult {
	return verifySignedBundleV2AtFloor(registry, signedBundleJSON, policy, now, "dcp-jcs-v1", tierFloor, false)
}

// VerifySignedBundleV2AtContractForTests is the same step with the policy contract already checked.
func VerifySignedBundleV2AtContractForTests(registry *AlgorithmRegistry, signedBundleJSON []byte, policy VerifierPolicy, now time.Time) *V2VerificationResult {
	return verifySignedBundleV2AtFloor(registry, signedBundleJSON, policy, now, "dcp-jcs-v1", "", true)
}

// The private tables the parity tests compare with the schemas.
var (
	MandateFieldsForTests       = mandateFields
	MandateRequiredForTests     = mandateRequired
	ScopeFieldsForTests         = scopeFields
	ScopeRequiredForTests       = scopeRequired
	SubDelegationFieldsForTests = subDelegationFields
	PolicyRequiredForTests      = policyRequired
)

// PolicyFieldForTests is one member of the policy schema table: its type, minimum and minimum number of items.
type PolicyFieldForTests struct {
	Type              string
	Minimum, MinItems int
}

// PolicyFieldsForTests returns a copy of the policy schema table.
func PolicyFieldsForTests() map[string]PolicyFieldForTests {
	out := map[string]PolicyFieldForTests{}
	for k, r := range policyFields {
		out[k] = PolicyFieldForTests{r.Type, r.Minimum, r.MinItems}
	}
	return out
}
