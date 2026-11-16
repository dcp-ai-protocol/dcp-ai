package dcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type chainTimeCase struct {
	Name              string                   `json:"name"`
	Chain             []map[string]interface{} `json:"chain"`
	RevokedMandateIDs []string                 `json:"revoked_mandate_ids"`
	Keys              *v2.MandateChainKeys     `json:"keys"`
	VerificationTime  string                   `json:"verification_time"`
	Expected          *struct {
		Depth         int     `json:"depth"`
		EffectiveTier *string `json:"effective_tier"`
	} `json:"expected"`
	ErrorContains string `json:"error_contains"`
}

type chainTimeVectors struct {
	VerificationTime string              `json:"verification_time"`
	Keys             v2.MandateChainKeys `json:"keys"`
	MustAccept       []chainTimeCase     `json:"must_accept"`
	MustReject       []chainTimeCase     `json:"must_reject"`
}

func loadChainTimeVectors(t *testing.T) chainTimeVectors {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "mandate_chain_time_vectors.json"))
	if err != nil {
		t.Fatalf("read mandate chain time vectors: %v", err)
	}
	var v chainTimeVectors
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("parse mandate chain time vectors: %v", err)
	}
	return v
}

// at is the case's verification time, or the vectors' one; RFC3339Nano keeps any digits, which the verifier truncates.
func (v chainTimeVectors) at(t *testing.T, c chainTimeCase) time.Time {
	t.Helper()
	s := c.VerificationTime
	if s == "" {
		s = v.VerificationTime
	}
	now, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatalf("%s: verification time %q: %v", c.Name, s, err)
	}
	return now
}

func (v chainTimeVectors) keysOf(c chainTimeCase) v2.MandateChainKeys {
	if c.Keys != nil {
		return *c.Keys
	}
	return v.Keys
}

func revokedSet(ids []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// mandate_chain_time_vectors.json (DCP-09 §3.5.2): windows, nesting and the
// expires_at of both signer slots, as millisecond instants, on real signatures.
func TestMandateChainTimeVectors(t *testing.T) {
	reg := newRegistry()
	v := loadChainTimeVectors(t)
	if len(v.MustAccept) != 9 || len(v.MustReject) != 13 {
		t.Fatalf("%d must_accept and %d must_reject, want 9 and 13", len(v.MustAccept), len(v.MustReject))
	}
	seen := map[string]bool{}
	for _, c := range append(append([]chainTimeCase{}, v.MustAccept...), v.MustReject...) {
		if seen[c.Name] {
			t.Fatalf("duplicate case name %s", c.Name)
		}
		seen[c.Name] = true
	}
	for _, c := range v.MustAccept {
		r := v2.VerifyMandateChain(reg, c.Chain, revokedSet(c.RevokedMandateIDs), v.keysOf(c), v.at(t, c))
		if !r.Valid || len(r.Errors) != 0 || r.Depth != c.Expected.Depth || (r.EffectiveTier != "") != (c.Expected.EffectiveTier != nil) {
			t.Errorf("%s: %+v", c.Name, r)
		}
	}
	for _, c := range v.MustReject {
		r := v2.VerifyMandateChain(reg, c.Chain, revokedSet(c.RevokedMandateIDs), v.keysOf(c), v.at(t, c))
		if r.Valid || !strings.Contains(strings.ToLower(strings.Join(r.Errors, "\n")), c.ErrorContains) {
			t.Errorf("%s: want an error containing %q, got %+v", c.Name, c.ErrorContains, r)
		}
	}
}

func chainTimeCaseNamed(t *testing.T, v chainTimeVectors, name string) chainTimeCase {
	t.Helper()
	for _, c := range v.MustAccept {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no must_accept case %s", name)
	return chainTimeCase{}
}

// The verification time is truncated to the millisecond; the zero time stays
// the current time, as before; and times are compared as time.Time, so one
// 2^64 ms away does not alias a time inside the window.
func TestMandateChainVerificationTime(t *testing.T) {
	reg := newRegistry()
	v := loadChainTimeVectors(t)
	expiring := chainTimeCaseNamed(t, v, "every_signer_key_expires_at_the_verification_time")
	at := v.at(t, expiring)
	if r := v2.VerifyMandateChain(reg, expiring.Chain, nil, *expiring.Keys, at.Add(999999*time.Nanosecond)); !r.Valid {
		t.Errorf("below the millisecond after the keys' expiry: %+v", r)
	}
	if r := v2.VerifyMandateChain(reg, expiring.Chain, nil, *expiring.Keys, at.Add(time.Millisecond)); r.Valid || !strings.Contains(strings.Join(r.Errors, "\n"), "has expired or has an invalid expires_at") {
		t.Errorf("one millisecond after the keys' expiry: %+v", r)
	}
	// The zero time is the current time (after 2026-10-22, when these keys expire), not the year 1.
	if r := v2.VerifyMandateChain(reg, expiring.Chain, nil, *expiring.Keys, time.Time{}); r.Valid {
		t.Errorf("the zero time must read the current time: %+v", r)
	}
	if r := v2.VerifyMandateChain(reg, v.MustAccept[0].Chain, nil, v.Keys, time.Time{}); !r.Valid {
		t.Errorf("the zero time must read the current time: %+v", r)
	}
	future := time.Unix(at.Unix()+18446744073709551, 616000000)
	past := time.Unix(at.Unix()-18446744073709552, 384000000)
	if future.UnixMilli() != at.UnixMilli() || past.UnixMilli() != at.UnixMilli() {
		t.Fatalf("the aliases do not alias: %d %d %d", future.UnixMilli(), past.UnixMilli(), at.UnixMilli())
	}
	extreme := chainTimeCaseNamed(t, v, "windows_from_year_0000_to_year_9999_offsets_crossing_both")
	if r := v2.VerifyMandateChain(reg, extreme.Chain, nil, v.Keys, future); r.Valid || !strings.Contains(strings.Join(r.Errors, "\n"), "expired at the verification time") {
		t.Errorf("a time 2^64 ms after (year %d): %+v", future.Year(), r)
	}
	if r := v2.VerifyMandateChain(reg, extreme.Chain, nil, v.Keys, past); r.Valid || !strings.Contains(strings.Join(r.Errors, "\n"), "not yet valid at the verification time") {
		t.Errorf("a time 2^64 ms before (year %d): %+v", past.Year(), r)
	}
}

// Truncation is a floor before the Unix epoch too: -0.5 ms is the millisecond -1, not 0.
func TestMandateChainFloorBeforeTheEpoch(t *testing.T) {
	reg := newRegistry()
	humanC, humanPQ := chainKeys(t, reg)
	root, err := v2.CreateDelegationMandate(reg, humanC, humanPQ, v2.DelegationMandateParams{
		MandateID: "mandate:before-epoch", SessionNonce: v2.GenerateSessionNonce(), HumanID: "human:alice", AgentID: "agent:a",
		AuthorityScope: []map[string]interface{}{{"domain": "email", "actions_permitted": []interface{}{"read"}}},
		ValidFrom:      "1969-01-01T00:00:00Z", ValidUntil: "1970-12-31T00:00:00Z", Revocable: true,
	})
	if err != nil {
		t.Fatalf("CreateDelegationMandate: %v", err)
	}
	entries := chainKeyEntries(humanC, humanPQ)
	for _, e := range entries {
		e.(map[string]interface{})["expires_at"] = "1969-12-31T23:59:59.999Z"
	}
	keys := v2.MandateChainKeys{HumanKeys: entries, AgentKeys: map[string][]interface{}{}}
	epoch := time.Unix(0, 0).UTC()
	if r := v2.VerifyMandateChain(reg, []map[string]interface{}{root}, nil, keys, epoch.Add(-500*time.Microsecond)); !r.Valid {
		t.Errorf("-0.5 ms is the keys' expiry: %+v", r)
	}
	if r := v2.VerifyMandateChain(reg, []map[string]interface{}{root}, nil, keys, epoch); r.Valid {
		t.Errorf("the epoch is after the keys' expiry: %+v", r)
	}
}
