package v2

// spec/VERIFICATION.md V2-2: the signed bundle against signed_bundle.schema.json and each SignedPayload.payload
// against its artifact schema (bound by bundle member name), from the IR that tools/schema-ir/generate.mjs compiles
// out of schemas/v2 (schema_v2_generated.go; no schema file or network access at verification time). Internal: the
// package exports no schema-only API; verifySignedBundleV2AtProfile runs this before any other check.
//
// It validates the value the existing decoder already produced (encoding/json into interface{} values), so its
// native value set is exactly that decoder's: nil, bool, float64, string, []interface{} and map[string]interface{}.
// Any other Go value is not a JSON value here (a type error where a schema visits it). The decoder's own behavior is
// kept as it was: a repeated member keeps its last value, invalid UTF-8 and lone surrogate escapes become U+FFFD,
// numbers are binary64 (an overflow such as 1e400 is a decode error, before this check), and a top-level null is
// validated as null.
//
//   - integer is a finite float64 with no fraction (2 and 2.0 alike); a bool is never a number;
//   - an object's members are its map keys; a member of an open object that no schema names is not visited;
//   - lengths in code points (runes); enum and const by exact string equality; uniqueItems over strings with a set;
//     patterns through the IR's deterministic programs (full-string match, as these anchored sources say); date-time
//     as ajv-formats 3.0.1 asserts it (below), not time.Parse;
//   - oneOf: exactly one branch valid, reported once at the instance;
//   - unknown members of a closed object are reported in code-point order (a Go map has no order);
//   - at most 16 errors and then a truncation marker; the verdict never depends on the cap; diagnostics name the
//     instance pointer (RFC 6901, each token escaped and then cut to 64 code points) and the keyword, never a value.
//
// Nothing is written to the input. The IR is parsed once (sync.Once) and is read-only afterwards, so concurrent
// verifications share it safely.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

const schemaErrorsCap = 16
const schemaTokenCap = 64

type schemaProgramItem struct {
	Ranges [][2]int `json:"ranges"`
	Min    int      `json:"min"`
	Max    *int     `json:"max"`
}

type schemaProgram struct {
	Source       string                `json:"source"`
	Alternatives [][]schemaProgramItem `json:"alternatives"`
}

type schemaNode struct {
	Site        string           `json:"site"`
	Types       []string         `json:"types"`
	Properties  [][2]any         `json:"properties"`
	Required    []string         `json:"required"`
	Closed      bool             `json:"closed"`
	Items       *int             `json:"items"`
	OneOf       []int            `json:"oneOf"`
	Enum        []string         `json:"enum"`
	Const       *string          `json:"const"`
	Pattern     *int             `json:"pattern"`
	Format      string           `json:"format"`
	MinLength   *int             `json:"minLength"`
	MaxLength   *int             `json:"maxLength"`
	MinItems    *int             `json:"minItems"`
	UniqueItems bool             `json:"uniqueItems"`
	Minimum     *float64         `json:"minimum"`
	Maximum     *float64         `json:"maximum"`
	Ref         *int             `json:"ref"`
	props       []schemaProperty // derived: the named members in IR order
	named       map[string]int   // derived
}

type schemaProperty struct {
	name string
	node int
}

type schemaIR struct {
	Format   string          `json:"format"`
	Patterns []schemaProgram `json:"patterns"`
	Nodes    []schemaNode    `json:"nodes"`
	Roots    struct {
		SignedBundle int      `json:"signed_bundle"`
		Payloads     [][2]any `json:"payloads"`
	} `json:"roots"`
	Overlays map[string][]struct {
		Node    int    `json:"node"`
		Keyword string `json:"keyword"`
		Value   string `json:"value"`
	} `json:"overlays"`
	payloads []schemaProperty // derived
}

var (
	schemaOnce   sync.Once
	schemaLoaded *schemaIR
	schemaErr    error
)

func loadSchemaIR() (*schemaIR, error) {
	schemaOnce.Do(func() {
		sum := sha256.Sum256([]byte(schemaV2IR))
		if hex.EncodeToString(sum[:]) != schemaV2IRSHA256 {
			schemaErr = errors.New("the V2 schema IR does not match its sha256")
			return
		}
		var ir schemaIR
		if err := json.Unmarshal([]byte(schemaV2IR), &ir); err != nil {
			schemaErr = fmt.Errorf("the V2 schema IR does not parse: %w", err)
			return
		}
		if ir.Format != "dcp-ai.v2-schema-ir/1" {
			schemaErr = fmt.Errorf("unsupported V2 schema IR %q", ir.Format)
			return
		}
		for i := range ir.Nodes {
			n := &ir.Nodes[i]
			if n.Properties == nil {
				continue
			}
			n.named = make(map[string]int, len(n.Properties))
			for _, p := range n.Properties {
				name, id := p[0].(string), int(p[1].(float64))
				n.props = append(n.props, schemaProperty{name, id})
				n.named[name] = id
			}
		}
		for _, p := range ir.Roots.Payloads {
			ir.payloads = append(ir.payloads, schemaProperty{p[0].(string), int(p[1].(float64))})
		}
		schemaLoaded = &ir
	})
	return schemaLoaded, schemaErr
}

type schemaError struct {
	Instance  string
	Keyword   string
	Site      string
	Member    string
	HasMember bool
}

type schemaResult struct {
	Valid     bool
	Errors    []schemaError
	Truncated bool
}

// schemaBoundedToken is an RFC 6901 token, escaped first and then cut to 64 code points with a marker.
func schemaBoundedToken(t string) string {
	t = strings.ReplaceAll(strings.ReplaceAll(t, "~", "~0"), "/", "~1")
	if utf8.RuneCountInString(t) <= schemaTokenCap {
		return t
	}
	n := 0
	for i := range t {
		if n == schemaTokenCap {
			return t[:i] + "…[cut]"
		}
		n++
	}
	return t
}

func schemaTypeOK(t string, v any) bool {
	switch t {
	case "null":
		return v == nil
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "string":
		_, ok := v.(string)
		return ok
	case "integer":
		f, ok := v.(float64)
		return ok && !math.IsInf(f, 0) && !math.IsNaN(f) && math.Trunc(f) == f
	case "array":
		_, ok := v.([]any)
		return ok
	case "object":
		_, ok := v.(map[string]any)
		return ok
	}
	return false
}

// schemaMatchProgram is the full-string match of a compiled program over the runes of s.
func schemaMatchProgram(p *schemaProgram, s string) bool {
	cps := []rune(s)
	for _, items := range p.Alternatives {
		i, ok := 0, true
		for _, it := range items {
			n := 0
			for (it.Max == nil || n < *it.Max) && i < len(cps) && schemaInRanges(it.Ranges, cps[i]) {
				i++
				n++
			}
			if n < it.Min {
				ok = false
				break
			}
		}
		if ok && i == len(cps) {
			return true
		}
	}
	return false
}

func schemaInRanges(ranges [][2]int, c rune) bool {
	for _, r := range ranges {
		if int(c) >= r[0] && int(c) <= r[1] {
			return true
		}
	}
	return false
}

// date-time: ajv-formats 3.0.1 fullFormats["date-time"] (getDateTime(true)), the format lib/verify.js asserts. A
// compatibility boundary, quirks included, not a reading of RFC 3339; the V2-4, V2-13 and V2-14 temporal parsers are a
// later, different layer. Ported from ajv-formats (https://github.com/ajv-validator/ajv-formats), under its license:
//
// MIT License
//
// Copyright (c) 2020 Evgeny Poberezkin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// DATE_TIME_SEPARATOR = /t|\s/i: "t", "T" and ECMAScript white space and line terminators.
var schemaDateTimeSeparators = func() map[rune]bool {
	m := map[rune]bool{0x74: true, 0x54: true, 0x09: true, 0x0a: true, 0x0b: true, 0x0c: true, 0x0d: true, 0x20: true,
		0xa0: true, 0x1680: true, 0x2028: true, 0x2029: true, 0x202f: true, 0x205f: true, 0x3000: true, 0xfeff: true}
	for c := rune(0x2000); c <= 0x200a; c++ {
		m[c] = true
	}
	return m
}()

var schemaDays = [13]int{0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}

func schemaDigits(s string, i, n int) bool {
	if len(s) < i+n {
		return false
	}
	for k := 0; k < n; k++ {
		if s[i+k] < '0' || s[i+k] > '9' {
			return false
		}
	}
	return true
}

func schemaAtoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func schemaIsDate(s string) bool {
	if len(s) != 10 || !schemaDigits(s, 0, 4) || s[4] != '-' || !schemaDigits(s, 5, 2) || s[7] != '-' || !schemaDigits(s, 8, 2) {
		return false
	}
	year, month, day := schemaAtoi(s[0:4]), schemaAtoi(s[5:7]), schemaAtoi(s[8:10])
	leap := year%4 == 0 && (year%100 != 0 || year%400 == 0)
	last := 0
	if month >= 1 && month <= 12 {
		last = schemaDays[month]
		if month == 2 && leap {
			last = 29
		}
	}
	return month >= 1 && month <= 12 && day >= 1 && day <= last
}

func schemaIsTime(s string) bool {
	if !schemaDigits(s, 0, 2) || len(s) < 6 || s[2] != ':' || !schemaDigits(s, 3, 2) || s[5] != ':' || !schemaDigits(s, 6, 2) {
		return false
	}
	at := func(i int) byte {
		if i < len(s) {
			return s[i]
		}
		return 0
	}
	i := 8
	if at(i) == '.' {
		j := i + 1
		for schemaDigits(s, j, 1) {
			j++
		}
		if j == i+1 {
			return false
		}
		i = j
	}
	sec, err := strconv.ParseFloat(s[6:i], 64) // binary64, as JavaScript's Number("59.99999999999999999") is 60
	if err != nil {
		return false
	}
	tz, sign, tzH, tzM := false, 1, 0, 0
	switch at(i) {
	case 'z', 'Z':
		tz = true
		i++
	case '+', '-':
		if !schemaDigits(s, i+1, 2) {
			return false
		}
		tz = true
		if s[i] == '-' {
			sign = -1
		}
		tzH = schemaAtoi(s[i+1 : i+3])
		i += 3
		if at(i) == ':' && schemaDigits(s, i+1, 2) {
			tzM = schemaAtoi(s[i+1 : i+3])
			i += 3
		} else if schemaDigits(s, i, 2) {
			tzM = schemaAtoi(s[i : i+2])
			i += 2
		}
	}
	if i != len(s) {
		return false
	}
	hr, mn := schemaAtoi(s[0:2]), schemaAtoi(s[3:5])
	if tzH > 23 || tzM > 59 || !tz {
		return false
	}
	if hr <= 23 && mn <= 59 && sec < 60 {
		return true
	}
	utcMin := mn - tzM*sign
	utcHr := hr - tzH*sign
	if utcMin < 0 {
		utcHr--
	}
	return (utcHr == 23 || utcHr == -1) && (utcMin == 59 || utcMin == -1) && sec < 61
}

// schemaIsDateTime is true when the string is a date-time as ajv-formats 3.0.1 (full mode) accepts it.
func schemaIsDateTime(s string) bool {
	at, size := -1, 0
	for i, r := range s {
		if !schemaDateTimeSeparators[r] {
			continue
		}
		if at >= 0 {
			return false
		}
		at, size = i, utf8.RuneLen(r)
	}
	return at >= 0 && schemaIsDate(s[:at]) && schemaIsTime(s[at+size:])
}

type schemaStop struct{}

type schemaSink func(ptr, keyword string, n *schemaNode, member string, hasMember bool)

// validateSignedBundleV2Schema is V2-2 for doc under the accepted canonicalization profile: "dcp-jcs-v1" is the
// normative schema; "dcp-jcs-v2" (only the explicitly selected experimental route) replaces exactly one const,
// canonicalization_profile.
func validateSignedBundleV2Schema(doc any, acceptedProfile string) (res schemaResult, err error) {
	ir, err := loadSchemaIR()
	if err != nil {
		return res, err
	}
	replaced := map[int]string{}
	switch acceptedProfile {
	case "dcp-jcs-v1":
	case "dcp-jcs-v2":
		overlay := ir.Overlays["dcp-jcs-v2"]
		if len(overlay) != 1 || overlay[0].Keyword != "const" {
			return res, errors.New("the V2 schema IR has no dcp-jcs-v2 overlay")
		}
		replaced[overlay[0].Node] = overlay[0].Value
	default:
		return res, fmt.Errorf("unknown canonicalization profile %q", acceptedProfile)
	}

	var visit func(id int, v any, ptr string, sink schemaSink)
	visit = func(id int, v any, ptr string, sink schemaSink) {
		n := &ir.Nodes[id]
		if n.Ref != nil {
			visit(*n.Ref, v, ptr, sink)
		}
		if n.Types != nil {
			ok := false
			for _, t := range n.Types {
				ok = ok || schemaTypeOK(t, v)
			}
			if !ok {
				sink(ptr, "type", n, "", false)
			}
		}
		if n.Enum != nil {
			s, isStr := v.(string)
			found := false
			for _, e := range n.Enum {
				found = found || (isStr && e == s)
			}
			if !found {
				sink(ptr, "enum", n, "", false)
			}
		}
		if n.Const != nil {
			want, overlaid := replaced[id]
			if !overlaid {
				want = *n.Const
			}
			if s, isStr := v.(string); !isStr || s != want {
				sink(ptr, "const", n, "", false)
			}
		}
		if s, isStr := v.(string); isStr {
			if n.MinLength != nil || n.MaxLength != nil {
				l := utf8.RuneCountInString(s)
				if n.MinLength != nil && l < *n.MinLength {
					sink(ptr, "minLength", n, "", false)
				}
				if n.MaxLength != nil && l > *n.MaxLength {
					sink(ptr, "maxLength", n, "", false)
				}
			}
			if n.Pattern != nil && !schemaMatchProgram(&ir.Patterns[*n.Pattern], s) {
				sink(ptr, "pattern", n, "", false)
			}
			if n.Format == "date-time" && !schemaIsDateTime(s) {
				sink(ptr, "format", n, "", false)
			}
		}
		if a, isArr := v.([]any); isArr {
			if n.MinItems != nil && len(a) < *n.MinItems {
				sink(ptr, "minItems", n, "", false)
			}
			if n.UniqueItems {
				seen, allStr, dup := map[string]bool{}, true, false
				for _, x := range a {
					s, isStr := x.(string)
					allStr = allStr && isStr
					dup = dup || (isStr && seen[s])
					seen[s] = true
				}
				if allStr && dup {
					sink(ptr, "uniqueItems", n, "", false)
				}
			}
			if n.Items != nil {
				for i, x := range a {
					visit(*n.Items, x, ptr+"/"+strconv.Itoa(i), sink)
				}
			}
		}
		if o, isObj := v.(map[string]any); isObj {
			for _, r := range n.Required {
				if _, present := o[r]; !present {
					sink(ptr, "required", n, r, true)
				}
			}
			if n.Closed {
				keys := make([]string, 0, len(o))
				for k := range o {
					if _, known := n.named[k]; !known {
						keys = append(keys, k)
					}
				}
				sort.Strings(keys) // UTF-8 byte order is code-point order
				for _, k := range keys {
					sink(ptr, "additionalProperties", n, k, true)
				}
			}
			for _, p := range n.props {
				if x, present := o[p.name]; present {
					visit(p.node, x, ptr+"/"+schemaBoundedToken(p.name), sink)
				}
			}
		}
		if f, isNum := v.(float64); isNum && !math.IsInf(f, 0) && !math.IsNaN(f) {
			if n.Minimum != nil && f < *n.Minimum {
				sink(ptr, "minimum", n, "", false)
			}
			if n.Maximum != nil && f > *n.Maximum {
				sink(ptr, "maximum", n, "", false)
			}
		}
		if n.OneOf != nil {
			valid := 0
			for _, b := range n.OneOf {
				failed := false
				visit(b, v, ptr, func(string, string, *schemaNode, string, bool) { failed = true })
				if !failed {
					valid++
				}
			}
			if valid != 1 {
				sink(ptr, "oneOf", n, "", false)
			}
		}
	}

	res.Valid = true
	top := func(ptr, keyword string, n *schemaNode, member string, hasMember bool) {
		res.Valid = false
		if len(res.Errors) >= schemaErrorsCap {
			res.Truncated = true
			panic(schemaStop{})
		}
		e := schemaError{Instance: ptr, Keyword: keyword, Site: n.Site + "/" + keyword}
		if hasMember {
			e.Member, e.HasMember = schemaBoundedToken(member), true
		}
		res.Errors = append(res.Errors, e)
	}
	func() {
		defer func() {
			if p := recover(); p != nil {
				if _, stop := p.(schemaStop); !stop {
					panic(p)
				}
			}
		}()
		visit(ir.Roots.SignedBundle, doc, "", top)
		root, _ := doc.(map[string]any)
		bundle, _ := root["bundle"].(map[string]any)
		for _, p := range ir.payloads {
			env, _ := bundle[p.name].(map[string]any)
			if payload, ok := env["payload"].(map[string]any); ok {
				visit(p.node, payload, "/bundle/"+p.name+"/payload", top)
			}
		}
	}()
	return res, nil
}

// schemaDiagnostics are the verifier's errors for a schema failure: one line per error, then the truncation marker.
// No input value is echoed.
func schemaDiagnostics(r schemaResult) []string {
	lines := make([]string, 0, len(r.Errors)+1)
	for _, e := range r.Errors {
		instance := e.Instance
		if instance == "" {
			instance = "/"
		}
		line := "schema: " + instance + " " + e.Keyword
		if e.HasMember {
			line += " " + e.Member
		}
		lines = append(lines, line)
	}
	if r.Truncated {
		lines = append(lines, "schema: further errors not listed")
	}
	return lines
}
