package v2

// EXPERIMENTAL and opt-in: phase 2 of the inactive candidate profile dcp-jcs-v2
// (docs/proposals/canonicalization-candidate, §5–§7): the unit from a transport, the profile it
// selects, and the decision to reject it, to delegate it to dcp-jcs-v1 through an explicit historical
// adapter, or to hand it to the candidate path. It is not normative and nothing calls it: dcp-jcs-v1,
// VerifySignedBundleV2At and every default are unchanged. It verifies, signs or admits nothing;
// "candidate" is never an acceptance (phase 3 verifies it).
//
// One byte-level grammar walker serves both the envelope extraction and the profile reader; the
// unit's own diagnosis is the unchanged phase 1 ingress. The historical adapter is consulted lazily,
// at most once per route, and its reading can never produce "candidate".

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"unicode/utf8"
)

// ExperimentalCandidateConfigError is a configuration error, returned when the router is created and
// never for the data. Code is POLICY_INVALID or CONFIG_INVALID.
type ExperimentalCandidateConfigError struct{ Code, Detail string }

func (e *ExperimentalCandidateConfigError) Error() string { return e.Code + ": " + e.Detail }

// ExperimentalCandidateAdapterError is a historical adapter that failed otherwise than by refusing the
// data (another error, a panic, or a value no JSON decoder produces); never a rejection.
type ExperimentalCandidateAdapterError struct{ Adapter, Message string }

func (e *ExperimentalCandidateAdapterError) Error() string {
	return "historical adapter " + e.Adapter + ": " + e.Message
}

// ErrHistoricalDecodeFailure marks the refusal of the data by a historical decoder: an adapter's Decode
// returns an error that wraps it, and the router follows the data path.
var ErrHistoricalDecodeFailure = errors.New("the historical decoder refused the data")

// ExperimentalHistoricalAdapter is a historical decoder. Decode receives its own copy of the unit and
// returns the decoder's value as is, or an error wrapping ErrHistoricalDecodeFailure. The router reads
// the profile from the value by the exact path, so the decoder must keep the last duplicate member, as
// encoding/json measurably does; parity is only claimed for adapters that pass the parity tests.
type ExperimentalHistoricalAdapter struct {
	Name   string
	Decode func(unit []byte) (any, error)
}

// ExperimentalHistoricalEncodingJSON is json.Unmarshal into interface{}, the decoding inside
// VerifySignedBundleV2At. It is offered by name; there is no default adapter.
var ExperimentalHistoricalEncodingJSON = ExperimentalHistoricalAdapter{
	Name: "encoding_json",
	Decode: func(unit []byte) (any, error) {
		var v any
		if err := json.Unmarshal(unit, &v); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrHistoricalDecodeFailure, err)
		}
		return v, nil
	},
}

// ExperimentalCandidateRouterConfig is the configuration, read once by NewExperimentalCandidateRouter.
// AcceptedProfiles is a []string or a []any (a decoded JSON list); nil is MISSING.
type ExperimentalCandidateRouterConfig struct {
	Transport        string
	AcceptedProfiles any
	Historical       *ExperimentalHistoricalAdapter
}

// ExperimentalCandidateExtraction is the unit of a transport, or the transport rejection (TransportOffset
// nil for NO_SIGNED_BUNDLE).
type ExperimentalCandidateExtraction struct {
	Rejected        bool
	Start, End      int
	Class, Detail   string
	TransportOffset *int
}

// ExperimentalCandidateWarning is the unit's diagnosis carried by a delegation (D7).
type ExperimentalCandidateWarning struct {
	Class           string
	Offset          int
	TransportOffset int
}

// ExperimentalCandidateHistorical is what the adapter returned: the decoder's value, or its refusal.
type ExperimentalCandidateHistorical struct {
	Adapter string
	OK      bool
	Decoded any
	Failed  string
}

// ExperimentalCandidateUnit is the unit's range in the input and a copy of its bytes.
type ExperimentalCandidateUnit struct {
	Start, End int
	Bytes      []byte
}

// ExperimentalCandidateRoute is the outcome: "reject" (Class, Detail, Offset, TransportOffset, Profile),
// "v1_path" (Profile dcp-jcs-v1, ProfileSource field, absent or historical, Warnings, Historical) or
// "candidate" (Value, Canonical, CanonicalSHA256; not an acceptance). Offsets are nil when absent.
type ExperimentalCandidateRoute struct {
	Outcome         string
	Class, Detail   string
	Offset          *int
	TransportOffset *int
	Unit            *ExperimentalCandidateUnit
	Profile         string
	ProfileSource   string
	Attempts        []string
	Warnings        []ExperimentalCandidateWarning
	Historical      *ExperimentalCandidateHistorical
	Value           any
	Canonical       []byte
	CanonicalSHA256 string
}

// ── The byte-level grammar walker ──────────────────────────────────────────

type walkMember struct{ container, nameStart, nameEnd, valueStart, valueEnd, valueObject int }

type walkStop struct{ offset int }

type candidateWalk struct {
	ok         bool
	offset     int // the grammar error, when !ok
	rootStart  int
	rootObject bool
	members    []walkMember
}

// candidateWalkGrammar checks the RFC 8259 grammar of b[start:end] as one JSON text, iteratively and at
// any depth, without decoding: strings are delimited and their escapes checked, bytes of 0x80 and above
// inside them are left to the encoding check. It records the members of the objects within recordDepth
// levels. On a grammar error, offset is the first byte that cannot extend a prefix of a JSON text.
func candidateWalkGrammar(b []byte, start, end, recordDepth int) (w candidateWalk) {
	pos := start
	defer func() {
		if p := recover(); p != nil {
			s, ok := p.(walkStop)
			if !ok {
				panic(p)
			}
			w = candidateWalk{offset: s.offset}
		}
	}()
	stop := func(offset int) { panic(walkStop{offset}) }
	need := func() byte {
		if pos >= end {
			stop(end)
		}
		return b[pos]
	}
	skipWS := func() {
		for pos < end && (b[pos] == ' ' || b[pos] == '\t' || b[pos] == '\n' || b[pos] == '\r') {
			pos++
		}
	}
	isDigit := func(c byte) bool { return c >= '0' && c <= '9' }
	isHex := func(c byte) bool { return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') }
	str := func() {
		pos++
		for {
			c := need()
			if c == '"' {
				pos++
				return
			}
			if c < 0x20 {
				stop(pos)
			}
			if c != '\\' {
				pos++
				continue
			}
			pos++
			switch e := need(); e {
			case 'u':
				for k := 0; k < 4; k++ {
					pos++
					if !isHex(need()) {
						stop(pos)
					}
				}
				pos++
			case '"', '\\', '/', 'b', 'f', 'n', 'r', 't':
				pos++
			default:
				stop(pos)
			}
		}
	}
	digits := func() {
		for pos < end && isDigit(b[pos]) {
			pos++
		}
	}
	number := func() {
		if b[pos] == '-' {
			pos++
		}
		switch c := need(); {
		case c == '0':
			pos++
		case isDigit(c):
			digits()
		default:
			stop(pos)
		}
		if pos < end && b[pos] == '.' {
			pos++
			if !isDigit(need()) {
				stop(pos)
			}
			digits()
		}
		if pos < end && (b[pos] == 'e' || b[pos] == 'E') {
			pos++
			if c := need(); c == '+' || c == '-' {
				pos++
			}
			if !isDigit(need()) {
				stop(pos)
			}
			digits()
		}
	}
	literal := func(word string) {
		for k := 0; k < len(word); k++ {
			if pos >= end {
				stop(end)
			}
			if b[pos] != word[k] {
				stop(pos)
			}
			pos++
		}
	}

	type frame struct {
		object             bool
		id, depth, pending int
	}
	var stack []*frame
	var members []walkMember
	nextID := 0
	skipWS()
	rootStart, rootObject := pos, false
	const (
		stValue = iota
		stKey
		stAfter
	)
	state := stValue
	for {
		switch state {
		case stValue:
			switch c := need(); {
			case c == '{' || c == '[':
				object := c == '{'
				if len(stack) == 0 {
					rootObject = object
				} else if parent := stack[len(stack)-1]; parent.pending >= 0 && object {
					members[parent.pending].valueObject = nextID
				}
				stack = append(stack, &frame{object: object, id: nextID, depth: len(stack) + 1, pending: -1})
				nextID++
				pos++
				skipWS()
				closer := byte(']')
				if object {
					closer = '}'
				}
				if pos < end && b[pos] == closer {
					pos++
					stack = stack[:len(stack)-1]
					state = stAfter
				} else if object {
					state = stKey
				}
			case c == '"':
				str()
				state = stAfter
			case c == '-' || isDigit(c):
				number()
				state = stAfter
			case c == 't':
				literal("true")
				state = stAfter
			case c == 'f':
				literal("false")
				state = stAfter
			case c == 'n':
				literal("null")
				state = stAfter
			default:
				stop(pos)
			}
		case stKey:
			if need() != '"' {
				stop(pos)
			}
			nameStart := pos
			str()
			nameEnd := pos
			skipWS()
			if need() != ':' {
				stop(pos)
			}
			pos++
			skipWS()
			if f := stack[len(stack)-1]; f.depth <= recordDepth {
				f.pending = len(members)
				members = append(members, walkMember{f.id, nameStart, nameEnd, pos, -1, -1})
			}
			state = stValue
		case stAfter:
			if len(stack) == 0 {
				skipWS()
				if pos != end {
					stop(pos)
				}
				return candidateWalk{ok: true, rootStart: rootStart, rootObject: rootObject, members: members}
			}
			f := stack[len(stack)-1]
			if f.pending >= 0 {
				members[f.pending].valueEnd = pos
				f.pending = -1
			}
			skipWS()
			closer := byte(']')
			if f.object {
				closer = '}'
			}
			switch need() {
			case ',':
				pos++
				skipWS()
				if f.object {
					state = stKey
				} else {
					state = stValue
				}
			case closer:
				pos++
				stack = stack[:len(stack)-1]
			default:
				stop(pos)
			}
		}
	}
}

// candidateStringEquals reports whether the string b[start:end] (quotes included, grammar already
// checked) unescapes to the ASCII target.
func candidateStringEquals(b []byte, start, end int, target string) bool {
	i, k := start+1, 0
	for i < end-1 {
		var unit int
		if b[i] == '\\' {
			if b[i+1] == 'u' {
				for _, h := range b[i+2 : i+6] {
					unit = unit*16 + candidateHex(h)
				}
				i += 6
			} else {
				unit = int(map[byte]byte{'"': '"', '\\': '\\', '/': '/', 'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t'}[b[i+1]])
				i += 2
			}
		} else {
			if b[i] >= 0x80 {
				return false // the targets are ASCII
			}
			unit = int(b[i])
			i++
		}
		if k >= len(target) || unit != int(target[k]) {
			return false
		}
		k++
	}
	return k == len(target)
}

func candidateLastMember(b []byte, members []walkMember, container int, name string) *walkMember {
	for i := len(members) - 1; i >= 0; i-- {
		if members[i].container == container && candidateStringEquals(b, members[i].nameStart, members[i].nameEnd, name) {
			return &members[i]
		}
	}
	return nil
}

func candidateFirstInvalidUTF8(b []byte) int {
	for i := 0; i < len(b); {
		r, size := utf8.DecodeRune(b[i:])
		if r == utf8.RuneError && size == 1 {
			return i
		}
		i += size
	}
	return -1
}

func candidateExtract(b []byte, transport string) ExperimentalCandidateExtraction {
	n := len(b)
	if transport == "bare" {
		return ExperimentalCandidateExtraction{Start: 0, End: n}
	}
	reject := func(class, detail string, offset *int) ExperimentalCandidateExtraction {
		return ExperimentalCandidateExtraction{Rejected: true, Class: class, Detail: detail, TransportOffset: offset}
	}
	at := func(i int) *int { return &i }
	if n >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return reject("TRANSPORT_INVALID", "BOM", at(0)) // T1
	}
	w := candidateWalkGrammar(b, 0, n, 1) // T2
	if !w.ok {
		return reject("TRANSPORT_INVALID", "SYNTAX", at(w.offset))
	}
	if !w.rootObject {
		return reject("TRANSPORT_INVALID", "NOT_AN_OBJECT", at(w.rootStart)) // T3
	}
	var named []walkMember
	for _, m := range w.members {
		if m.container == 0 && candidateStringEquals(b, m.nameStart, m.nameEnd, "signed_bundle") {
			named = append(named, m)
		}
	}
	if len(named) == 0 {
		return reject("TRANSPORT_INVALID", "NO_SIGNED_BUNDLE", nil) // T4
	}
	if len(named) > 1 {
		return reject("TRANSPORT_AMBIGUOUS", "SIGNED_BUNDLE_REPEATED", at(named[1].nameStart))
	}
	start, end := named[0].valueStart, named[0].valueEnd
	if bad := candidateFirstInvalidUTF8(b[:start]); bad >= 0 { // T5: before the unit, then after it
		return reject("TRANSPORT_INVALID", "UTF8_INVALID", at(bad))
	}
	if bad := candidateFirstInvalidUTF8(b[end:]); bad >= 0 {
		return reject("TRANSPORT_INVALID", "UTF8_INVALID", at(end+bad))
	}
	return ExperimentalCandidateExtraction{Start: start, End: end}
}

// ExperimentalCandidateExtractUnit is EXPERIMENTAL and opt-in (candidate dcp-jcs-v2, phase 2): the unit
// of a transport, by the phases T1–T5 of §6.3 for an envelope (the whole input for "bare"), as offsets
// in the input. The error is only for a transport other than "bare" or "envelope".
func ExperimentalCandidateExtractUnit(input []byte, transport string) (ExperimentalCandidateExtraction, error) {
	if transport != "bare" && transport != "envelope" {
		return ExperimentalCandidateExtraction{}, fmt.Errorf("transport must be \"bare\" or \"envelope\", not %q", transport)
	}
	return candidateExtract(input, transport), nil
}

// candidateReadProfile is the profile a walkable unit selects: the exact path, the last duplicate at
// each step (§7). offset is -1 when the field is absent.
func candidateReadProfile(b []byte, start, end int) (profile string, offset int, err error) {
	w := candidateWalkGrammar(b, start, end, 3)
	if !w.ok {
		return "", -1, fmt.Errorf("%w: the grammar walker refused a unit the ingress walked", ErrExperimentalCandidateInternal)
	}
	if !w.rootObject {
		return "absent", -1, nil
	}
	bundle := candidateLastMember(b, w.members, 0, "bundle")
	if bundle == nil || bundle.valueObject < 0 {
		return "absent", -1, nil
	}
	manifest := candidateLastMember(b, w.members, bundle.valueObject, "manifest")
	if manifest == nil || manifest.valueObject < 0 {
		return "absent", -1, nil
	}
	field := candidateLastMember(b, w.members, manifest.valueObject, "canonicalization_profile")
	if field == nil {
		return "absent", -1, nil
	}
	for _, known := range []string{"dcp-jcs-v1", "dcp-jcs-v2"} {
		if b[field.valueStart] == '"' && candidateStringEquals(b, field.valueStart, field.valueEnd, known) {
			return known, field.valueStart - start, nil
		}
	}
	return "unknown", field.valueStart - start, nil
}

// candidateDecodedProfile is the profile a decoded value carries at the exact path.
func candidateDecodedProfile(value any) string {
	node := value
	for _, key := range []string{"bundle", "manifest", "canonicalization_profile"} {
		m, ok := node.(map[string]any)
		if !ok {
			return "absent"
		}
		if node, ok = m[key]; !ok {
			return "absent"
		}
	}
	if s, ok := node.(string); ok && (s == "dcp-jcs-v1" || s == "dcp-jcs-v2") {
		return s
	}
	return "unknown"
}

// candidateDecoderTypes reports whether a returned value has only what encoding/json produces: nil,
// bool, float64, json.Number, string, []any and map[string]any, with no shared or cyclic references.
func candidateDecoderTypes(value any) bool {
	seen := map[uintptr]bool{}
	stack := []any{value}
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch t := v.(type) {
		case nil, bool, float64, json.Number, string:
		case map[string]any:
			p := reflect.ValueOf(t).Pointer()
			if seen[p] {
				return false
			}
			seen[p] = true
			for _, child := range t {
				stack = append(stack, child)
			}
		case []any:
			if len(t) > 0 {
				p := reflect.ValueOf(t).Pointer()
				if seen[p] {
					return false
				}
				seen[p] = true
			}
			stack = append(stack, t...)
		default:
			return false
		}
	}
	return true
}

// ExperimentalCandidateRouter routes over a private snapshot of its configuration, taken by
// NewExperimentalCandidateRouter; nothing reads the caller's configuration again.
type ExperimentalCandidateRouter struct {
	transport            string
	acceptsV1, acceptsV2 bool
	adapterName          string
	decode               func([]byte) (any, error)
}

func candidateSnapshotPolicy(policy any) (v1, v2 bool, err error) {
	invalid := func(detail string) error { return &ExperimentalCandidateConfigError{"POLICY_INVALID", detail} }
	var entries []any
	switch p := policy.(type) {
	case nil:
		return false, false, invalid("MISSING")
	case []string:
		if p == nil {
			return false, false, invalid("MISSING")
		}
		for _, s := range p {
			entries = append(entries, s)
		}
	case []any:
		if p == nil {
			return false, false, invalid("MISSING")
		}
		entries = append(entries, p...)
	default:
		return false, false, invalid("NOT_A_NON_EMPTY_LIST")
	}
	if len(entries) == 0 {
		return false, false, invalid("NOT_A_NON_EMPTY_LIST")
	}
	seen := map[string]bool{}
	for _, e := range entries {
		if _, ok := e.(string); !ok {
			return false, false, invalid("NOT_STRINGS")
		}
	}
	for _, e := range entries {
		if seen[e.(string)] {
			return false, false, invalid("REPEATED")
		}
		seen[e.(string)] = true
	}
	for s := range seen {
		if s != "dcp-jcs-v1" && s != "dcp-jcs-v2" {
			return false, false, invalid("UNKNOWN_PROFILE")
		}
	}
	return seen["dcp-jcs-v1"], seen["dcp-jcs-v2"], nil
}

// NewExperimentalCandidateRouter is EXPERIMENTAL and opt-in (candidate dcp-jcs-v2, phase 2): a router
// over a snapshot of cfg, validated here, before any input: the transport, the accepted profiles (no
// default) and the historical adapter (no default; its name and Decode function are captured now).
func NewExperimentalCandidateRouter(cfg ExperimentalCandidateRouterConfig) (*ExperimentalCandidateRouter, error) {
	v1, v2, err := candidateSnapshotPolicy(cfg.AcceptedProfiles)
	if err != nil {
		return nil, err
	}
	if cfg.Transport != "bare" && cfg.Transport != "envelope" {
		return nil, &ExperimentalCandidateConfigError{"CONFIG_INVALID", "TRANSPORT"}
	}
	if cfg.Historical == nil || cfg.Historical.Name == "" || cfg.Historical.Decode == nil {
		return nil, &ExperimentalCandidateConfigError{"CONFIG_INVALID", "HISTORICAL_ADAPTER"}
	}
	return &ExperimentalCandidateRouter{
		transport: cfg.Transport, acceptsV1: v1, acceptsV2: v2,
		adapterName: cfg.Historical.Name, decode: cfg.Historical.Decode,
	}, nil
}

// Configuration returns a fresh copy of the effective configuration; changing it changes nothing.
func (r *ExperimentalCandidateRouter) Configuration() (transport string, acceptedProfiles []string, historical string) {
	if r.acceptsV1 {
		acceptedProfiles = append(acceptedProfiles, "dcp-jcs-v1")
	}
	if r.acceptsV2 {
		acceptedProfiles = append(acceptedProfiles, "dcp-jcs-v2")
	}
	return r.transport, acceptedProfiles, r.adapterName
}

// consult calls the adapter once, on its own copy of the unit. Another error, a panic, or a value no
// JSON decoder produces is an ExperimentalCandidateAdapterError, never a rejection of the data.
func (r *ExperimentalCandidateRouter) consult(unit []byte) (h *ExperimentalCandidateHistorical, err error) {
	fail := func(format string, args ...any) error {
		return &ExperimentalCandidateAdapterError{Adapter: r.adapterName, Message: fmt.Sprintf(format, args...)}
	}
	defer func() {
		if p := recover(); p != nil {
			h, err = nil, fail("panicked: %v", p)
		}
	}()
	value, decodeErr := r.decode(append([]byte(nil), unit...))
	if decodeErr != nil {
		if errors.Is(decodeErr, ErrHistoricalDecodeFailure) {
			return &ExperimentalCandidateHistorical{Adapter: r.adapterName, Failed: decodeErr.Error()}, nil
		}
		return nil, fail("returned an error that is not a refusal of the data: %v", decodeErr)
	}
	if !candidateDecoderTypes(value) {
		return nil, fail("returned a value no JSON decoder produces")
	}
	return &ExperimentalCandidateHistorical{Adapter: r.adapterName, OK: true, Decoded: value}, nil
}

// Route is EXPERIMENTAL and opt-in (candidate dcp-jcs-v2, phase 2): reject, delegate to dcp-jcs-v1,
// or select the candidate path (§6.4), from the original bytes, on a private copy. The error is an
// ExperimentalCandidateAdapterError or an internal error, never a rejection of the data.
func (r *ExperimentalCandidateRouter) Route(input []byte) (ExperimentalCandidateRoute, error) {
	b := append([]byte(nil), input...) // a private copy: nothing the caller or the adapter does reaches it
	x := candidateExtract(b, r.transport)
	if x.Rejected {
		return ExperimentalCandidateRoute{Outcome: "reject", Class: x.Class, Detail: x.Detail, TransportOffset: x.TransportOffset, Attempts: []string{}, Warnings: []ExperimentalCandidateWarning{}}, nil
	}
	start, end := x.Start, x.End
	unit := b[start:end]
	scan, err := ExperimentalCandidateIngress(unit)
	if err != nil {
		return ExperimentalCandidateRoute{}, err
	}
	rng := func(withBytes bool) *ExperimentalCandidateUnit {
		u := &ExperimentalCandidateUnit{Start: start, End: end}
		if withBytes {
			u.Bytes = append([]byte(nil), unit...)
		}
		return u
	}
	var diagnosis *ExperimentalCandidateWarning
	if !scan.Accepted {
		diagnosis = &ExperimentalCandidateWarning{Class: scan.Class, Offset: scan.Offset, TransportOffset: start + scan.Offset}
	}
	reject := func(class string, offset int, profile string) ExperimentalCandidateRoute {
		route := ExperimentalCandidateRoute{Outcome: "reject", Class: class, Unit: rng(false), Profile: profile, Attempts: []string{}, Warnings: []ExperimentalCandidateWarning{}}
		if offset >= 0 {
			o, t := offset, start+offset
			route.Offset, route.TransportOffset = &o, &t
		}
		return route
	}
	delegate := func(source string, h *ExperimentalCandidateHistorical) ExperimentalCandidateRoute {
		warnings := []ExperimentalCandidateWarning{}
		if diagnosis != nil {
			warnings = append(warnings, *diagnosis)
		}
		return ExperimentalCandidateRoute{Outcome: "v1_path", Unit: rng(true), Profile: "dcp-jcs-v1", ProfileSource: source, Attempts: []string{"dcp-jcs-v1"}, Warnings: warnings, Historical: h}
	}

	walkable := diagnosis == nil || (diagnosis.Class != "BOM" && diagnosis.Class != "UTF8_INVALID" && diagnosis.Class != "SYNTAX")
	if walkable {
		profile, offset, err := candidateReadProfile(b, start, end)
		if err != nil {
			return ExperimentalCandidateRoute{}, err
		}
		switch {
		case profile == "unknown":
			return reject("PROFILE_UNKNOWN", offset, ""), nil
		case profile == "absent" || profile == "dcp-jcs-v1":
			if !r.acceptsV1 {
				return reject("PROFILE_NOT_ACCEPTED", offset, "dcp-jcs-v1"), nil
			}
			h, err := r.consult(unit)
			if err != nil {
				return ExperimentalCandidateRoute{}, err
			}
			source := "field"
			if profile == "absent" {
				source = "absent"
			}
			return delegate(source, h), nil
		case !r.acceptsV2:
			return reject("PROFILE_NOT_ACCEPTED", offset, "dcp-jcs-v2"), nil
		case diagnosis != nil:
			return reject(diagnosis.Class, diagnosis.Offset, "dcp-jcs-v2"), nil
		}
		return ExperimentalCandidateRoute{Outcome: "candidate", Unit: rng(true), Profile: "dcp-jcs-v2", Attempts: []string{"dcp-jcs-v2"}, Warnings: []ExperimentalCandidateWarning{},
			Value: scan.Value, Canonical: scan.Canonical, CanonicalSHA256: scan.CanonicalSHA256}, nil
	}
	// Not walkable: the historical adapter decides, once; its reading never selects the candidate.
	h, err := r.consult(unit)
	if err != nil {
		return ExperimentalCandidateRoute{}, err
	}
	if !h.OK {
		return reject(diagnosis.Class, diagnosis.Offset, ""), nil
	}
	if profile := candidateDecodedProfile(h.Decoded); profile != "absent" && profile != "dcp-jcs-v1" {
		return reject(diagnosis.Class, diagnosis.Offset, ""), nil
	}
	if !r.acceptsV1 {
		return reject("PROFILE_NOT_ACCEPTED", -1, "dcp-jcs-v1"), nil
	}
	return delegate("historical", h), nil
}
