package v2

import (
	"bytes"
	"encoding/json"
	"errors"
)

// RawAuditEventV2 is one V2 audit entry exactly as received: the literal bytes of that JSON object, so every member
// at every depth keeps its presence and null-ness, unknown members included, in the entry and in its evidence.
// Wherever the dcp-jcs-v1 canonicalizer accepts it, its canonical bytes, and so its prev_hash and Merkle leaf, are
// those of the input. Number spelling, escapes and repeated member names stay as received. When encoding/json embeds
// MarshalJSON output in a larger document it compacts whitespace and escapes <, >, &, U+2028 and U+2029, which
// changes those bytes but not the value.
//
// It never normalizes, repairs or re-signs, and it keeps invalid evidence as it is, so a verifier rejects it for the
// same reason. The only check is that the input is one JSON object; null is refused too, not ignored. Typed is a
// lossy view for reading fields, not for forwarding.
//
// A built value is immutable: NewRawAuditEventV2 and UnmarshalJSON copy their input, and Bytes and MarshalJSON
// return new copies, so nothing aliases a caller's buffer. UnmarshalJSON replaces the value only when the new input
// is valid; when it returns an error the value keeps its previous content, which does not describe the failed
// input, so the error must always be checked. Concurrent reads are safe while no UnmarshalJSON runs on the same
// value. The zero value holds no entry: MarshalJSON returns an error instead of emitting null, Bytes returns nil
// and Typed returns an error. A nil *RawAuditEventV2 is a different case: encoding/json encodes it as null itself,
// without calling MarshalJSON.
type RawAuditEventV2 struct {
	raw []byte
}

var (
	errRawAuditEventEmpty     = errors.New("RawAuditEventV2 holds no entry")
	errRawAuditEventNotJSON   = errors.New("an audit entry must be exactly one JSON value")
	errRawAuditEventNotObject = errors.New("an audit entry must be a JSON object")
)

// NewRawAuditEventV2 copies b, which must be exactly one JSON object (whitespace around it is kept).
func NewRawAuditEventV2(b []byte) (RawAuditEventV2, error) {
	if !json.Valid(b) {
		return RawAuditEventV2{}, errRawAuditEventNotJSON
	}
	if trimmed := bytes.TrimLeft(b, " \t\r\n"); len(trimmed) == 0 || trimmed[0] != '{' {
		return RawAuditEventV2{}, errRawAuditEventNotObject
	}
	return RawAuditEventV2{raw: bytes.Clone(b)}, nil
}

// Bytes returns a copy of the entry's bytes, or nil for the zero value.
func (e RawAuditEventV2) Bytes() []byte {
	if e.raw == nil {
		return nil
	}
	return bytes.Clone(e.raw)
}

// MarshalJSON returns a copy of the entry's bytes; the zero value is an error, not null.
func (e RawAuditEventV2) MarshalJSON() ([]byte, error) {
	if e.raw == nil {
		return nil, errRawAuditEventEmpty
	}
	return bytes.Clone(e.raw), nil
}

// UnmarshalJSON keeps a copy of b when it is one JSON object; otherwise it returns an error and leaves e unchanged.
func (e *RawAuditEventV2) UnmarshalJSON(b []byte) error {
	if e == nil {
		return errors.New("RawAuditEventV2: UnmarshalJSON on a nil pointer")
	}
	v, err := NewRawAuditEventV2(b)
	if err != nil {
		return err
	}
	*e = v
	return nil
}

// Typed decodes the entry into AuditEventV2, a lossy view (see AuditEventV2); never marshal it to forward the entry.
func (e RawAuditEventV2) Typed() (AuditEventV2, error) {
	var t AuditEventV2
	if e.raw == nil {
		return t, errRawAuditEventEmpty
	}
	err := json.Unmarshal(e.raw, &t)
	return t, err
}
