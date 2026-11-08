package v2

// Admission from bytes (opt-in, MP-02 F3): a V2 signed bundle admitted from the bytes of one JSON text,
// under dcp-jcs-v1. Go port of the TypeScript SDK's core/v1-ingress.ts; design:
// docs/reviews/mp02-security-composition-design.md § 3.
//
// One route, in this order:
//  1. a private copy of the caller's slice; nothing reads the caller's slice again;
//  2. the candidate scanner, unchanged, over that copy: its rejections keep their class and offset;
//  3. the portable integer domain: every number literal outside strings is a plain integer, with no
//     fraction, no exponent and no -0 (NUMBER_NOT_PORTABLE, at the literal's first byte);
//  4. json.Unmarshal of the same copy into a `var raw any` (the verifier's numeric semantics), canonicalized
//     with dcp-jcs-v1 and compared byte for byte with the scanner's canonical bytes: a difference or a decode
//     error is a local fault, INGRESS_PARSER_MISMATCH. A top-level scalar, null or array is portable JSON;
//     the admission rejects its structure;
//  5. AdmitSignedBundleV2 over that same private copy, which nobody else holds: it decodes it with the same
//     json.Unmarshal.
//
// Nothing else changes: dcp-jcs-v1, the candidate dcp-jcs-v2, the scanner, the profiles, the defaults and
// AdmitSignedBundleV2 keep their behavior. A transport that rewrites 100 as 100.0 is rejected here even
// when the signature still verifies. The copy does not protect against another goroutine writing the
// caller's slice while it is copied: that is a data race in the caller.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
)

// IngressOutcome is the ingress verdict of AdmitSignedBundleV2FromBytes.
type IngressOutcome struct {
	Accepted bool `json:"accepted"`
	// Layer is the step that rejected: scanner, domain or parser; nil when accepted.
	Layer *string `json:"layer"`
	Class *string `json:"class"`
	// Offset is the byte offset in the input; nil when accepted and for a parser fault.
	Offset *int `json:"offset"`
	// UnitSHA256 is the SHA-256 of the copied bytes.
	UnitSHA256 string `json:"unit_sha256"`
	// CanonicalSHA256 is the SHA-256 of the canonical bytes; nil when rejected.
	CanonicalSHA256 *string `json:"canonical_sha256"`
}

// IngressAdmissionResult is the result of AdmitSignedBundleV2FromBytes. Admission and Value are nil when
// the ingress rejects, as nothing was verified.
type IngressAdmissionResult struct {
	Ingress   IngressOutcome   `json:"ingress"`
	Admission *AdmissionResult `json:"admission"`
	// Value is the copy decoded into `any`, as compared.
	Value any `json:"value"`
}

var portableInteger = regexp.MustCompile(`^-?(0|[1-9][0-9]*)$`)

func isNumberByte(c byte) bool {
	return (c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-'
}

// firstNonPortableNumber returns the offset of the first number literal outside strings that is not a plain
// integer, or -1. Only for a unit the scanner accepted, so the text is well-formed JSON and every string is
// closed.
func firstNonPortableNumber(b []byte) int {
	inString := false
	for i := 0; i < len(b); {
		c := b[i]
		switch {
		case inString:
			if c == '\\' {
				i += 2 // the escaped byte cannot end the string
				continue
			}
			if c == '"' {
				inString = false
			}
			i++
		case c == '"':
			inString = true
			i++
		case c == '-' || (c >= '0' && c <= '9'):
			j := i + 1
			for j < len(b) && isNumberByte(b[j]) {
				j++
			}
			if literal := b[i:j]; !portableInteger.Match(literal) || string(literal) == "-0" {
				return i
			}
			i = j
		default:
			i++
		}
	}
	return -1
}

func decodeIngressJSON(unit []byte) (any, error) {
	var raw any
	err := json.Unmarshal(unit, &raw)
	return raw, err
}

// AdmitSignedBundleV2FromBytes admits a V2 signed bundle from the bytes of one JSON text (see the file
// comment). A rejected ingress is a result with a nil Admission; the error is only for a broken scanner
// invariant (ErrExperimentalCandidateInternal) or the configuration errors of AdmitSignedBundleV2.
func AdmitSignedBundleV2FromBytes(registry *AlgorithmRegistry, input []byte, opts AdmitOptions) (*IngressAdmissionResult, error) {
	return admitFromBytes(registry, input, opts, decodeIngressJSON, nil)
}

// admitFromBytes is the route with its two test points: another decoder, and a call just before the bridge
// to AdmitSignedBundleV2. Only the test build reaches them (v1_ingress_export_test.go); no request or option
// selects them.
func admitFromBytes(registry *AlgorithmRegistry, input []byte, opts AdmitOptions, decode func([]byte) (any, error), beforeAdmit func()) (*IngressAdmissionResult, error) {
	unit := append([]byte{}, input...) // a copy: a subslice would share the caller's array
	sum := sha256.Sum256(unit)
	unitSHA256 := hex.EncodeToString(sum[:])
	reject := func(layer, class string, offset *int) *IngressAdmissionResult {
		return &IngressAdmissionResult{Ingress: IngressOutcome{Layer: &layer, Class: &class, Offset: offset, UnitSHA256: unitSHA256}}
	}

	scanned, err := ExperimentalCandidateIngress(unit)
	if err != nil {
		return nil, err
	}
	if !scanned.Accepted {
		offset := scanned.Offset
		return reject("scanner", scanned.Class, &offset), nil
	}
	if at := firstNonPortableNumber(unit); at >= 0 {
		return reject("domain", "NUMBER_NOT_PORTABLE", &at), nil
	}

	value, err := decode(unit)
	same := false
	if err == nil {
		if canonical, cerr := CanonicalizeV2(value); cerr == nil {
			same = bytes.Equal([]byte(canonical), scanned.Canonical)
		}
	}
	if !same {
		return reject("parser", "INGRESS_PARSER_MISMATCH", nil), nil
	}

	if beforeAdmit != nil {
		beforeAdmit()
	}
	admission, err := AdmitSignedBundleV2(registry, unit, opts)
	if err != nil {
		return nil, err
	}
	canonicalSHA256 := scanned.CanonicalSHA256
	return &IngressAdmissionResult{
		Ingress:   IngressOutcome{Accepted: true, UnitSHA256: unitSHA256, CanonicalSHA256: &canonicalSHA256},
		Admission: admission,
		Value:     value,
	}, nil
}
