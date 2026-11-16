package v2

// EXPERIMENTAL and opt-in: the ingress of one unit under the inactive candidate profile dcp-jcs-v2
// (docs/proposals/canonicalization-candidate, §3–§6). It is not normative and nothing calls it:
// dcp-jcs-v1 (CanonicalizeV2) and VerifySignedBundleV2At are unchanged, and dcp-jcs-v1 remains the
// only profile.
//
// Phase 1 only. From the original bytes of one unit it decides acceptance (UTF-8, BOM, the whole
// RFC 8259 grammar, scalar strings, unique keys, exact integers by N4, at most 64 levels) with the
// precedence and byte offsets of §6, and on acceptance materializes the exact value and produces its
// canonical bytes and SHA-256. It reads no transport envelope, selects no profile, and verifies,
// signs or admits nothing.

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// ErrExperimentalCandidateInternal marks a broken invariant of the experimental ingress. It is never
// a rejection of the data.
var ErrExperimentalCandidateInternal = errors.New("experimental candidate ingress: internal error")

// ExperimentalCandidateIngressResult is the outcome for the data. When Accepted is false, Class is
// one of BOM, UTF8_INVALID, SYNTAX, SURROGATE_UNPAIRED, DUPLICATE_KEY, NUMBER_NOT_INTEGER,
// NUMBER_OUT_OF_RANGE or DEPTH_EXCEEDED and Offset is its byte offset. When Accepted is true, Value
// is the exact value (map[string]any, []any, string, int64, bool or nil), Canonical its canonical
// bytes and CanonicalSHA256 their SHA-256 in hex.
type ExperimentalCandidateIngressResult struct {
	Accepted        bool
	Class           string
	Offset          int
	Value           any
	Canonical       []byte
	CanonicalSHA256 string
}

const (
	candidateMaxDepth   = 64
	candidateMaxInteger = "9007199254740991" // 2^53-1, 16 digits
)

type candidateGrammarStop struct{ offset int }

type candidateFrame struct {
	object    bool
	container any                 // map[string]any or *[]any; nil once a defect stops materialization
	keys      map[string]struct{} // only within 64 levels: deeper defects cannot be the earliest
	key       string
}

type candidateScanner struct {
	b         []byte
	pos       int
	hasDefect bool
	defClass  string
	defOffset int
}

// defect keeps the value-level defect with the earliest offset (§6.1, layer 3).
func (s *candidateScanner) defect(class string, offset int) {
	if !s.hasDefect || offset < s.defOffset {
		s.hasDefect, s.defClass, s.defOffset = true, class, offset
	}
}

func (s *candidateScanner) stop(offset int) { panic(candidateGrammarStop{offset}) }

func (s *candidateScanner) skipWS() {
	for s.pos < len(s.b) {
		switch s.b[s.pos] {
		case ' ', '\t', '\n', '\r':
			s.pos++
		default:
			return
		}
	}
}

// ExperimentalCandidateIngress is EXPERIMENTAL and opt-in (candidate dcp-jcs-v2, phase 1): the
// ingress of one unit from its original bytes. It returns the rejection class and byte offset, or the
// exact value, its canonical bytes and their SHA-256. The error is only for a broken invariant
// (ErrExperimentalCandidateInternal), never for the data. It verifies, signs or admits nothing.
func ExperimentalCandidateIngress(input []byte) (result ExperimentalCandidateIngressResult, err error) {
	b := input
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return ExperimentalCandidateIngressResult{Class: "BOM", Offset: 0}, nil
	}
	for i := 0; i < len(b); {
		r, size := utf8.DecodeRune(b[i:]) // rejects overlong forms, encoded surrogates and > U+10FFFF
		if r == utf8.RuneError && size == 1 {
			return ExperimentalCandidateIngressResult{Class: "UTF8_INVALID", Offset: i}, nil
		}
		i += size
	}
	s := &candidateScanner{b: b}
	defer func() {
		if p := recover(); p != nil {
			if g, ok := p.(candidateGrammarStop); ok {
				result, err = ExperimentalCandidateIngressResult{Class: "SYNTAX", Offset: g.offset}, nil
				return
			}
			result, err = ExperimentalCandidateIngressResult{}, fmt.Errorf("%w: %v", ErrExperimentalCandidateInternal, p)
		}
	}()
	value := s.document()
	if s.hasDefect {
		return ExperimentalCandidateIngressResult{Class: s.defClass, Offset: s.defOffset}, nil
	}
	canonical, err := appendCandidateCanonical(nil, value)
	if err != nil {
		return ExperimentalCandidateIngressResult{}, err
	}
	sum := sha256.Sum256(canonical)
	return ExperimentalCandidateIngressResult{Accepted: true, Value: value, Canonical: canonical, CanonicalSHA256: hex.EncodeToString(sum[:])}, nil
}

// document reads one JSON text iteratively: the grammar is checked to the end at any depth.
func (s *candidateScanner) document() any {
	b, n := s.b, len(s.b)
	var stack []*candidateFrame
	const (
		stValue = iota
		stKey
		stAfter
	)
	state := stValue
	var current any
	s.skipWS()
	for {
		switch state {
		case stValue:
			if s.pos >= n {
				s.stop(n)
			}
			switch c := b[s.pos]; {
			case c == '{' || c == '[':
				object := c == '{'
				depth := len(stack) + 1
				if depth > candidateMaxDepth {
					s.defect("DEPTH_EXCEEDED", s.pos)
				}
				frame := &candidateFrame{object: object}
				if !s.hasDefect {
					if object {
						frame.container = map[string]any{}
					} else {
						list := make([]any, 0)
						frame.container = &list
					}
				}
				if object && depth <= candidateMaxDepth {
					frame.keys = map[string]struct{}{}
				}
				stack = append(stack, frame)
				s.pos++
				s.skipWS()
				closer := byte(']')
				if object {
					closer = '}'
				}
				if s.pos < n && b[s.pos] == closer {
					s.pos++
					current = frameValue(frame)
					stack = stack[:len(stack)-1]
					state = stAfter
				} else if object {
					state = stKey
				}
			case c == '"':
				current = s.str()
				state = stAfter
			case c == '-' || (c >= '0' && c <= '9'):
				current = s.number()
				state = stAfter
			case c == 't':
				s.literal("true")
				current, state = true, stAfter
			case c == 'f':
				s.literal("false")
				current, state = false, stAfter
			case c == 'n':
				s.literal("null")
				current, state = nil, stAfter
			default:
				s.stop(s.pos)
			}
		case stKey:
			if s.pos >= n {
				s.stop(n)
			}
			if b[s.pos] != '"' {
				s.stop(s.pos)
			}
			start := s.pos
			key := s.str()
			frame := stack[len(stack)-1]
			if frame.keys != nil {
				if _, seen := frame.keys[key]; seen {
					s.defect("DUPLICATE_KEY", start)
				} else {
					frame.keys[key] = struct{}{}
				}
			}
			frame.key = key
			s.skipWS()
			if s.pos >= n {
				s.stop(n)
			}
			if b[s.pos] != ':' {
				s.stop(s.pos)
			}
			s.pos++
			s.skipWS()
			state = stValue
		case stAfter:
			if len(stack) == 0 {
				s.skipWS()
				if s.pos != n {
					s.stop(s.pos)
				}
				return current
			}
			frame := stack[len(stack)-1]
			if !s.hasDefect && frame.container != nil {
				if frame.object {
					frame.container.(map[string]any)[frame.key] = current
				} else {
					list := frame.container.(*[]any)
					*list = append(*list, current)
				}
			}
			s.skipWS()
			if s.pos >= n {
				s.stop(n)
			}
			closer := byte(']')
			if frame.object {
				closer = '}'
			}
			switch b[s.pos] {
			case ',':
				s.pos++
				s.skipWS()
				if frame.object {
					state = stKey
				} else {
					state = stValue
				}
			case closer:
				s.pos++
				current = frameValue(frame)
				stack = stack[:len(stack)-1]
			default:
				s.stop(s.pos)
			}
		}
	}
}

func frameValue(f *candidateFrame) any {
	if list, ok := f.container.(*[]any); ok {
		return *list
	}
	return f.container
}

func (s *candidateScanner) literal(word string) {
	for k := 0; k < len(word); k++ {
		if s.pos+k >= len(s.b) {
			s.stop(len(s.b))
		}
		if s.b[s.pos+k] != word[k] {
			s.stop(s.pos + k)
		}
	}
	s.pos += len(word)
}

func candidateHex(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'f':
		return int(c-'a') + 10
	case c >= 'A' && c <= 'F':
		return int(c-'A') + 10
	}
	return -1
}

func (s *candidateScanner) hex4(at int) int {
	v := 0
	for k := 0; k < 4; k++ {
		if at+k >= len(s.b) {
			s.stop(len(s.b))
		}
		h := candidateHex(s.b[at+k])
		if h < 0 {
			s.stop(at + k)
		}
		v = v*16 + h
	}
	return v
}

// lowSurrogateAt reads a \uDC00–\uDFFF escape at `at` without consuming it, or returns -1.
func (s *candidateScanner) lowSurrogateAt(at int) int {
	b := s.b
	if at+6 > len(b) || b[at] != '\\' || b[at+1] != 'u' {
		return -1
	}
	v := 0
	for k := 2; k < 6; k++ {
		h := candidateHex(b[at+k])
		if h < 0 {
			return -1
		}
		v = v*16 + h
	}
	if v >= 0xDC00 && v <= 0xDFFF {
		return v
	}
	return -1
}

// str reads a string at its opening quote, unescaped. A lone surrogate is kept as its three-byte
// generalized UTF-8 form, so it stays one unit in key comparisons; such a value is never accepted.
func (s *candidateScanner) str() string {
	b, n := s.b, len(s.b)
	s.pos++
	var out strings.Builder
	segment := s.pos
	for {
		if s.pos >= n {
			s.stop(n)
		}
		c := b[s.pos]
		if c == '"' {
			out.Write(b[segment:s.pos])
			s.pos++
			return out.String()
		}
		if c < 0x20 {
			s.stop(s.pos)
		}
		if c != '\\' {
			s.pos++
			continue
		}
		out.Write(b[segment:s.pos])
		escape := s.pos
		if escape+1 >= n {
			s.stop(n)
		}
		switch e := b[escape+1]; e {
		case '"', '\\', '/':
			out.WriteByte(e)
			s.pos = escape + 2
		case 'b':
			out.WriteByte('\b')
			s.pos = escape + 2
		case 'f':
			out.WriteByte('\f')
			s.pos = escape + 2
		case 'n':
			out.WriteByte('\n')
			s.pos = escape + 2
		case 'r':
			out.WriteByte('\r')
			s.pos = escape + 2
		case 't':
			out.WriteByte('\t')
			s.pos = escape + 2
		case 'u':
			unit := s.hex4(escape + 2)
			s.pos = escape + 6
			switch {
			case unit >= 0xD800 && unit <= 0xDBFF:
				if low := s.lowSurrogateAt(s.pos); low >= 0 {
					out.WriteRune(rune(0x10000 + (unit-0xD800)<<10 + (low - 0xDC00)))
					s.pos += 6
				} else {
					s.defect("SURROGATE_UNPAIRED", escape)
					writeSurrogateUnit(&out, unit)
				}
			case unit >= 0xDC00 && unit <= 0xDFFF:
				s.defect("SURROGATE_UNPAIRED", escape)
				writeSurrogateUnit(&out, unit)
			default:
				out.WriteRune(rune(unit))
			}
		default:
			s.stop(escape + 1)
		}
		segment = s.pos
	}
}

func writeSurrogateUnit(out *strings.Builder, unit int) {
	out.WriteByte(byte(0xE0 | unit>>12))
	out.WriteByte(byte(0x80 | (unit>>6)&0x3F))
	out.WriteByte(byte(0x80 | unit&0x3F))
}

func (s *candidateScanner) digits(at int) int {
	for at < len(s.b) && s.b[at] >= '0' && s.b[at] <= '9' {
		at++
	}
	return at
}

// number reads a number literal: its grammar, then its exact value by N4 (§3.3).
func (s *candidateScanner) number() any {
	b, n := s.b, len(s.b)
	start := s.pos
	negative := b[s.pos] == '-'
	if negative {
		s.pos++
	}
	if s.pos >= n {
		s.stop(n)
	}
	intStart := s.pos
	switch c := b[s.pos]; {
	case c == '0':
		s.pos++
	case c >= '1' && c <= '9':
		s.pos = s.digits(s.pos)
	default:
		s.stop(s.pos)
	}
	intEnd := s.pos
	fracStart, fracEnd := intEnd, intEnd
	if s.pos < n && b[s.pos] == '.' {
		s.pos++
		if s.pos >= n {
			s.stop(n)
		}
		if b[s.pos] < '0' || b[s.pos] > '9' {
			s.stop(s.pos)
		}
		fracStart = s.pos
		s.pos = s.digits(s.pos)
		fracEnd = s.pos
	}
	expNegative := false
	expStart, expEnd := s.pos, s.pos
	if s.pos < n && (b[s.pos] == 'e' || b[s.pos] == 'E') {
		s.pos++
		if s.pos >= n {
			s.stop(n)
		}
		if b[s.pos] == '+' || b[s.pos] == '-' {
			expNegative = b[s.pos] == '-'
			s.pos++
			if s.pos >= n {
				s.stop(n)
			}
		}
		if b[s.pos] < '0' || b[s.pos] > '9' {
			s.stop(s.pos)
		}
		expStart = s.pos
		s.pos = s.digits(s.pos)
		expEnd = s.pos
	}
	// N4. X saturates at len(literal) + 17: past it the outcome cannot change.
	limit := s.pos - start + 17
	x := 0
	for _, d := range b[expStart:expEnd] {
		x = x*10 + int(d-'0')
		if x > limit {
			x = limit
		}
	}
	all := string(b[intStart:intEnd]) + string(b[fracStart:fracEnd])
	significant := strings.TrimLeft(all, "0")
	if significant == "" {
		return int64(0) // D is empty: the value is 0, whatever the exponent
	}
	d := strings.TrimRight(significant, "0")
	if expNegative {
		x = -x
	}
	scale := x - (fracEnd - fracStart) + (len(significant) - len(d))
	if scale < 0 {
		s.defect("NUMBER_NOT_INTEGER", start)
		return int64(0)
	}
	if len(d)+scale > 16 {
		s.defect("NUMBER_OUT_OF_RANGE", start)
		return int64(0)
	}
	full := d + strings.Repeat("0", scale)
	if len(full) == 16 && full > candidateMaxInteger {
		s.defect("NUMBER_OUT_OF_RANGE", start)
		return int64(0)
	}
	v, err := strconv.ParseInt(full, 10, 64)
	if err != nil {
		panic(fmt.Sprintf("exact integer %q does not parse: %v", full, err))
	}
	if negative {
		return -v
	}
	return v
}

// appendCandidateCanonical applies the dcp-jcs-v1 output rules (§3.4) to an accepted value, at most
// 64 levels deep.
func appendCandidateCanonical(out []byte, v any) ([]byte, error) {
	switch t := v.(type) {
	case nil:
		return append(out, "null"...), nil
	case bool:
		if t {
			return append(out, "true"...), nil
		}
		return append(out, "false"...), nil
	case int64:
		return strconv.AppendInt(out, t, 10), nil
	case string:
		return appendCandidateString(out, t), nil
	case []any:
		out = append(out, '[')
		for i, item := range t {
			if i > 0 {
				out = append(out, ',')
			}
			var err error
			if out, err = appendCandidateCanonical(out, item); err != nil {
				return nil, err
			}
		}
		return append(out, ']'), nil
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys) // byte order of valid UTF-8 is code point order
		out = append(out, '{')
		for i, k := range keys {
			if i > 0 {
				out = append(out, ',')
			}
			out = appendCandidateString(out, k)
			out = append(out, ':')
			var err error
			if out, err = appendCandidateCanonical(out, t[k]); err != nil {
				return nil, err
			}
		}
		return append(out, '}'), nil
	}
	return nil, fmt.Errorf("%w: unexpected materialized type %T", ErrExperimentalCandidateInternal, v)
}

func appendCandidateString(out []byte, s string) []byte {
	const hexDigits = "0123456789abcdef"
	out = append(out, '"')
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c == '"':
			out = append(out, '\\', '"')
		case c == '\\':
			out = append(out, '\\', '\\')
		case c == '\b':
			out = append(out, '\\', 'b')
		case c == '\t':
			out = append(out, '\\', 't')
		case c == '\n':
			out = append(out, '\\', 'n')
		case c == '\f':
			out = append(out, '\\', 'f')
		case c == '\r':
			out = append(out, '\\', 'r')
		case c < 0x20:
			out = append(out, '\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&0xF])
		default:
			out = append(out, c)
		}
	}
	return append(out, '"')
}
