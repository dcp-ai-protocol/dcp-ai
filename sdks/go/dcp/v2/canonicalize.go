package v2

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"unicode/utf8"
)

// AssertNoFloats walks a decoded JSON value and returns an error if any
// non-integer float64 is found. JSON numbers that are whole integers
// (e.g. 42.0) are permitted; actual fractional values are rejected.
func AssertNoFloats(value interface{}) error {
	return assertNoFloats(value, "")
}

func assertNoFloats(value interface{}, path string) error {
	switch v := value.(type) {
	case map[string]interface{}:
		for k, child := range v {
			p := path + "." + k
			if err := assertNoFloats(child, p); err != nil {
				return err
			}
		}
	case []interface{}:
		for i, child := range v {
			p := fmt.Sprintf("%s[%d]", path, i)
			if err := assertNoFloats(child, p); err != nil {
				return err
			}
		}
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("non-finite float at %s: %v", path, v)
		}
		if v != math.Trunc(v) {
			return fmt.Errorf("non-integer float at %s: %v", path, v)
		}
	}
	return nil
}

// CanonicalizeV2 produces canonical JSON per profile dcp-jcs-v1
// (spec/CANONICALIZATION_PROFILE.md): sorted keys, compact form,
// RFC 8785 string escaping and integer-only numbers. Any non-integer
// float64 value causes an error.
func CanonicalizeV2(obj interface{}) (string, error) {
	raw, err := toJSONValue(obj)
	if err != nil {
		return "", err
	}
	if err := AssertNoFloats(raw); err != nil {
		return "", err
	}
	out, err := appendCanonical(nil, raw)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// MarshalCanonical is CanonicalizeV2 without the integer-only check, for
// V1 artifacts and other payloads that may carry fractional numbers.
func MarshalCanonical(obj interface{}) ([]byte, error) {
	raw, err := toJSONValue(obj)
	if err != nil {
		return nil, err
	}
	return appendCanonical(nil, raw)
}

// toJSONValue round-trips obj through encoding/json so struct tags and
// custom marshalers apply and only plain JSON types remain.
func toJSONValue(obj interface{}) (interface{}, error) {
	data, err := json.Marshal(obj)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}
	var raw interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return raw, nil
}

// appendCanonical serializes a decoded JSON value by hand: encoding/json
// escapes <, >, & and U+2028/U+2029 and keeps the sign of -0, which
// breaks Rules 3 and 4 of the profile.
func appendCanonical(dst []byte, v interface{}) ([]byte, error) {
	var err error
	switch val := v.(type) {
	case nil:
		return append(dst, "null"...), nil
	case bool:
		return strconv.AppendBool(dst, val), nil
	case string:
		return appendCanonicalString(dst, val), nil
	case float64:
		if val == 0 {
			val = 0 // Rule 4: -0 is emitted as 0
		}
		num, err := json.Marshal(val)
		if err != nil {
			return nil, err
		}
		return append(dst, num...), nil
	case []interface{}:
		dst = append(dst, '[')
		for i, item := range val {
			if i > 0 {
				dst = append(dst, ',')
			}
			if dst, err = appendCanonical(dst, item); err != nil {
				return nil, err
			}
		}
		return append(dst, ']'), nil
	case map[string]interface{}:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		// Byte order of UTF-8 strings is Unicode code point order (Rule 1).
		sort.Strings(keys)
		dst = append(dst, '{')
		for i, k := range keys {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = appendCanonicalString(dst, k)
			dst = append(dst, ':')
			if dst, err = appendCanonical(dst, val[k]); err != nil {
				return nil, err
			}
		}
		return append(dst, '}'), nil
	default:
		return nil, fmt.Errorf("canonicalize: unsupported type %T", v)
	}
}

// appendCanonicalString escapes only what RFC 8785 §3.2 requires: '"',
// '\\' and C0 control characters. Everything else is emitted as UTF-8.
func appendCanonicalString(dst []byte, s string) []byte {
	const hex = "0123456789abcdef"
	dst = append(dst, '"')
	for _, r := range s {
		switch r {
		case '"', '\\':
			dst = append(dst, '\\', byte(r))
		case '\b':
			dst = append(dst, '\\', 'b')
		case '\f':
			dst = append(dst, '\\', 'f')
		case '\n':
			dst = append(dst, '\\', 'n')
		case '\r':
			dst = append(dst, '\\', 'r')
		case '\t':
			dst = append(dst, '\\', 't')
		default:
			if r < 0x20 {
				dst = append(dst, '\\', 'u', '0', '0', hex[r>>4], hex[r&0xF])
			} else {
				dst = utf8.AppendRune(dst, r)
			}
		}
	}
	return append(dst, '"')
}
