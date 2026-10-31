package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

// jsonText is s as encoding/json writes it: each invalid UTF-8 byte becomes U+FFFD.
func jsonText(t *testing.T, s string) string {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var out string
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestWellFormed(t *testing.T) {
	for _, c := range []struct{ name, in, want string }{
		{"valid UTF-8 is unchanged", "ok é \U0001F600 �", "ok é \U0001F600 �"},
		{"each consecutive invalid byte is one U+FFFD", "a\xff\xfeb", "a��b"},
		{"a truncated multibyte sequence is one U+FFFD per byte", "x\xe2\x82", "x��"},
		{"valid text around invalid bytes is kept", "\xffé\xc3", "�é�"},
	} {
		got := wellFormed(c.in)
		if string(got) != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
		if string(got) != jsonText(t, c.in) {
			t.Errorf("%s: %q differs from what encoding/json writes", c.name, got)
		}
	}
}

// A long diagnostic of invalid bytes: a path the JSON input of --bound-selftest cannot reach, since JSON text is valid UTF-8.
func TestBoundedLongInvalidDiagnostic(t *testing.T) {
	in := strings.Repeat("\xff", 300)
	kept, truncated := bounded([]string{in})
	if len(kept) != 1 || kept[0] != strings.Repeat("\xff", 256) {
		t.Fatalf("unexpected kept errors: %q", kept)
	}
	if got := jsonText(t, kept[0]); got != strings.Repeat("�", 256) {
		t.Fatalf("the kept prefix is not 256 code points as the driver reads it: %q", got)
	}
	original := bytes.Repeat([]byte("�"), 300)
	h := sha256.New()
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(original)))
	h.Write(n[:])
	h.Write(original)
	want := map[string]interface{}{"original_count": 1, "kept": 1, "original_code_points": 300, "sha256": hex.EncodeToString(h.Sum(nil))}
	for k, v := range want {
		if truncated[k] != v {
			t.Errorf("truncated[%s] = %v, want %v", k, truncated[k], v)
		}
	}
	if len(truncated) != len(want) {
		t.Errorf("truncated has %d keys, want %d", len(truncated), len(want))
	}
}

func TestBoundedWithinLimitsUnchanged(t *testing.T) {
	in := []string{"a\xffb", strings.Repeat("m", 256)}
	kept, truncated := bounded(in)
	if truncated != nil || len(kept) != 2 || kept[0] != in[0] || kept[1] != in[1] {
		t.Fatalf("a list within the bounds changed: %q %v", kept, truncated)
	}
}
