package dcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// The mandate validity helper (DCP-09 §3.5.2 rule 4, §3.6): the shared vectors
// every SDK must agree on (tests/interop/v2/mandate_validity_vectors.json). A
// mandate that is not a JSON object cannot be passed to the typed API (a map);
// those cases are skipped by name, and JSON null is the nil map.
func TestMandateValidityVectors(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "mandate_validity_vectors.json"))
	if err != nil {
		t.Fatalf("read mandate validity vectors: %v", err)
	}
	var vecs struct {
		VerificationTime string `json:"verification_time"`
		Cases            []struct {
			Name              string          `json:"name"`
			Mandate           json.RawMessage `json:"mandate"`
			RevokedMandateIDs []string        `json:"revoked_mandate_ids"`
			Now               string          `json:"now"`
			Expect            struct {
				Valid  bool   `json:"valid"`
				Reason string `json:"reason"`
			} `json:"expect"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &vecs); err != nil {
		t.Fatalf("parse mandate validity vectors: %v", err)
	}
	if len(vecs.Cases) != 94 {
		t.Fatalf("%d cases, want 94", len(vecs.Cases))
	}
	var skipped []string
	for _, c := range vecs.Cases {
		var raw interface{}
		if err := json.Unmarshal(c.Mandate, &raw); err != nil {
			t.Fatalf("%s: mandate: %v", c.Name, err)
		}
		mandate, isMap := raw.(map[string]interface{})
		if !isMap && raw != nil {
			skipped = append(skipped, c.Name)
			continue
		}
		revoked := map[string]bool{}
		for _, id := range c.RevokedMandateIDs {
			revoked[id] = true
		}
		at := c.Now
		if at == "" {
			at = vecs.VerificationTime
		}
		now, err := time.Parse(time.RFC3339Nano, at)
		if err != nil {
			t.Fatalf("%s: now: %v", c.Name, err)
		}
		got := v2.VerifyMandateValidityAt(mandate, revoked, now)
		if got.Valid != c.Expect.Valid || got.Reason != c.Expect.Reason {
			t.Errorf("%s: got %+v, want %+v", c.Name, got, c.Expect)
		}
	}
	sort.Strings(skipped)
	if want := []string{"mandate_array", "mandate_boolean", "mandate_number", "mandate_string"}; !equalStrings(skipped, want) {
		t.Errorf("skipped %v, want exactly %v", skipped, want)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func validityMandate(from, until string) map[string]interface{} {
	return map[string]interface{}{"mandate_id": "mandate-validity-0001", "valid_from": from, "valid_until": until}
}

// VerifyMandateValidity keeps reading the current time.
func TestMandateValidityCurrentTime(t *testing.T) {
	iso := func(d time.Duration) string { return time.Now().Add(d).UTC().Format(time.RFC3339Nano) }
	cases := []struct {
		from, until string
		want        v2.MandateValidity
	}{
		{iso(-time.Hour), iso(time.Hour), v2.MandateValidity{Valid: true}},
		{iso(-2 * time.Hour), iso(-time.Hour), v2.MandateValidity{Reason: "Mandate has expired"}},
		{iso(time.Hour), iso(2 * time.Hour), v2.MandateValidity{Reason: "Mandate is not yet valid"}},
	}
	for _, c := range cases {
		if got := v2.VerifyMandateValidity(validityMandate(c.from, c.until), nil); got != c.want {
			t.Errorf("%s..%s: got %+v, want %+v", c.from, c.until, got, c.want)
		}
	}
}

// VerifyMandateValidityAt takes now as given: the zero time is year 1, a time in
// any location is its instant, and what is below the millisecond is dropped.
func TestMandateValidityAtClock(t *testing.T) {
	window := validityMandate("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z")
	if got := v2.VerifyMandateValidityAt(validityMandate("0001-01-01T00:00:00Z", "0001-01-01T00:00:00Z"), nil, time.Time{}); !got.Valid {
		t.Errorf("year-1 window at the zero time: %+v", got)
	}
	if got := v2.VerifyMandateValidityAt(window, nil, time.Time{}); got.Reason != "Mandate is not yet valid" {
		t.Errorf("2026 window at the zero time: %+v", got)
	}
	end := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	plusTwo := time.FixedZone("+02:00", 2*3600)
	for _, at := range []time.Time{end.Add(-time.Millisecond), end, end.Add(time.Millisecond)} {
		if a, b := v2.VerifyMandateValidityAt(window, nil, at), v2.VerifyMandateValidityAt(window, nil, at.In(plusTwo)); a != b {
			t.Errorf("%v: UTC %+v, +02:00 %+v", at, a, b)
		}
	}
	if got := v2.VerifyMandateValidityAt(window, nil, end.Add(999999*time.Nanosecond)); !got.Valid {
		t.Errorf("below the millisecond after valid_until: %+v", got)
	}
	if got := v2.VerifyMandateValidityAt(window, nil, end.Add(time.Millisecond)); got.Reason != "Mandate has expired" {
		t.Errorf("one millisecond after valid_until: %+v", got)
	}
	// Times 2^64 ms away alias the window in int64 milliseconds; compared as times they are far after and far before it.
	base := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	future := time.Unix(base.Unix()+18446744073709551, 616000000)
	past := time.Unix(base.Unix()-18446744073709552, 384000000)
	if future.UnixMilli() != base.UnixMilli() || past.UnixMilli() != base.UnixMilli() {
		t.Fatalf("the aliases do not alias: %d %d %d", future.UnixMilli(), past.UnixMilli(), base.UnixMilli())
	}
	if got := v2.VerifyMandateValidityAt(window, nil, future); got.Reason != "Mandate has expired" {
		t.Errorf("a time 2^64 ms after the window (year %d): %+v", future.Year(), got)
	}
	if got := v2.VerifyMandateValidityAt(window, nil, past); got.Reason != "Mandate is not yet valid" {
		t.Errorf("a time 2^64 ms before the window (year %d): %+v", past.Year(), got)
	}
}

// A revoked entry set to false revokes nothing, as before; a nil map revokes nothing.
func TestMandateValidityRevokedMap(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	window := validityMandate("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z")
	for _, revoked := range []map[string]bool{nil, {}, {"mandate-validity-0001": false}} {
		if got := v2.VerifyMandateValidityAt(window, revoked, now); !got.Valid {
			t.Errorf("%v: %+v", revoked, got)
		}
	}
	if got := v2.VerifyMandateValidityAt(window, map[string]bool{"mandate-validity-0001": true}, now); got.Reason != "Mandate has been revoked" {
		t.Errorf("revoked: %+v", got)
	}
}
