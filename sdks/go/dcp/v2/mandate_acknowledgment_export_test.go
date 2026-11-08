package v2

// Test-only access to the mandate acknowledgment internals: this file is compiled only into the test build of the
// package, so none of it is part of the API.

// EvaluateDelegationActivationWithDecoderForTests is EvaluateDelegationActivationV2 with another decoder for the
// bytes contract (design § 2.2), to exercise ACK_PARSER_MISMATCH whatever the runtime's parser does.
func EvaluateDelegationActivationWithDecoderForTests(registry *AlgorithmRegistry, evidence ActivationEvidence, operator DelegatedOperator, decode func([]byte) (any, error)) (*DelegationActivationResult, error) {
	return evaluateDelegationActivation(registry, evidence, operator, decode)
}

// CreateMandateAcknowledgmentWithDecoderForTests is CreateMandateAcknowledgment with another decoder for its
// bytes contract, to exercise a parser that does not reproduce the scanner's canonical bytes.
func CreateMandateAcknowledgmentWithDecoderForTests(registry *AlgorithmRegistry, classicalKey, pqKey CompositeKeyInfo, p MandateAcknowledgmentParams, decode func([]byte) (any, error)) (map[string]interface{}, error) {
	return createMandateAcknowledgment(registry, classicalKey, pqKey, p, decode)
}

// The record tables the parity test compares with the schemas.
var (
	AckFieldsForTests       = ackFields
	ThresholdFieldsForTests = thresholdFields
	RuleFieldsForTests      = ruleFields
	RuleOperatorsForTests   = ruleOperators
	RuleActionsForTests     = ruleActions
)

// ValidContextForTests and CandidateContextForTests say whether a context is valid for domain separation and
// whether the experimental producer accepts it.
func ValidContextForTests(ctx string) bool     { return validContexts[ctx] }
func CandidateContextForTests(ctx string) bool { return candidateContexts[ctx] }

// The hashes and checks of the design.
func MandateHashForTests(m map[string]interface{}) (string, error) { return mandateHashOf(m) }
func ChainHashesForTests(ms []map[string]interface{}) ([]string, error) {
	_, chains, err := chainHashesOf(ms)
	return chains, err
}
func ThresholdHashForTests(u map[string]interface{}) (string, error) { return thresholdHashOf(u) }
func AcknowledgmentFormErrorForTests(v interface{}) string           { return acknowledgmentFormError(v) }
func IsSafeIntegerValueForTests(v interface{}) bool                  { return isSafeIntegerValue(v) }
