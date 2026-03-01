package v2

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
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

// CanonicalizeV2 produces RFC 8785-style canonical JSON with float prohibition.
// Keys are sorted lexicographically, output is compact, and any non-integer
// float64 value causes an error.
func CanonicalizeV2(obj interface{}) (string, error) {
	data, err := json.Marshal(obj)
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}

	var raw interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", fmt.Errorf("unmarshal: %w", err)
	}

	if err := AssertNoFloats(raw); err != nil {
		return "", err
	}

	sorted := sortJSONKeys(raw)
	result, err := json.Marshal(sorted)
	if err != nil {
		return "", fmt.Errorf("re-marshal: %w", err)
	}
	return string(result), nil
}

// sortJSONKeys recursively sorts map keys for deterministic output.
func sortJSONKeys(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		ordered := make(orderedMap, 0, len(keys))
		for _, k := range keys {
			ordered = append(ordered, kv{Key: k, Value: sortJSONKeys(val[k])})
		}
		return ordered
	case []interface{}:
		for i, item := range val {
			val[i] = sortJSONKeys(item)
		}
		return val
	default:
		return v
	}
}

// orderedMap preserves insertion order when marshalled to JSON.
type orderedMap []kv

type kv struct {
	Key   string
	Value interface{}
}

func (om orderedMap) MarshalJSON() ([]byte, error) {
	buf := []byte{'{'}
	for i, pair := range om {
		if i > 0 {
			buf = append(buf, ',')
		}
		key, err := json.Marshal(pair.Key)
		if err != nil {
			return nil, err
		}
		val, err := json.Marshal(pair.Value)
		if err != nil {
			return nil, err
		}
		buf = append(buf, key...)
		buf = append(buf, ':')
		buf = append(buf, val...)
	}
	buf = append(buf, '}')
	return buf, nil
}
