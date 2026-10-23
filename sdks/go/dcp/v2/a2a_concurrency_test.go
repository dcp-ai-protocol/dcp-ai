package v2

import (
	"strings"
	"sync"
	"testing"
)

// One session used from many goroutines: before the mutex this died with
// "fatal error: concurrent map writes" in DecryptMessage. Run with -race.
func TestA2ASessionConcurrentUse(t *testing.T) {
	key := make([]byte, 32)
	sender, _ := CreateA2ASession("sess", key, "a", "b", "standard", 0)
	receiver, _ := CreateA2ASession("sess", key, "b", "a", "standard", 0)
	const n = 200
	msgs := make([]map[string]interface{}, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			m, err := EncryptMessage(sender, map[string]interface{}{"i": i})
			if err != nil {
				t.Error(err)
				return
			}
			msgs[i] = m
			_ = NeedsRekeying(sender)
		}(i)
	}
	wg.Wait()
	seen := map[interface{}]bool{}
	for _, m := range msgs {
		if seen[m["sequence"]] {
			t.Fatalf("sequence %v issued twice", m["sequence"])
		}
		seen[m["sequence"]] = true
	}
	var accepted sync.WaitGroup
	errs := make(chan error, 2*n)
	for _, m := range msgs {
		for copy := 0; copy < 2; copy++ { // every message twice: exactly one copy is accepted
			accepted.Add(1)
			go func(m map[string]interface{}) {
				defer accepted.Done()
				_, err := DecryptMessage(receiver, m)
				errs <- err
			}(m)
		}
	}
	accepted.Wait()
	close(errs)
	ok := 0
	for err := range errs {
		if err == nil {
			ok++
		}
	}
	if ok != n {
		t.Fatalf("%d of %d distinct messages accepted, want each exactly once", ok, n)
	}
}

// IntentV2 and PolicyDecisionV2 carry the optional tier fields of the schema.
func TestIntentAndPolicyCarryTheirTiers(t *testing.T) {
	intent, _ := CanonicalizeV2(IntentV2{DCPVersion: "2.0", SecurityTier: "elevated", Target: IntentTargetV2{Channel: "api"}})
	policy, _ := CanonicalizeV2(PolicyDecisionV2{DCPVersion: "2.0", ResolvedTier: "elevated"})
	none, _ := CanonicalizeV2(IntentV2{DCPVersion: "2.0", Target: IntentTargetV2{Channel: "api"}})
	for name, s := range map[string]string{"intent": intent, "policy": policy} {
		if !strings.Contains(s, `"elevated"`) {
			t.Fatalf("%s lost its tier: %s", name, s)
		}
	}
	if strings.Contains(none, "security_tier") {
		t.Fatalf("an intent without a tier must not emit one: %s", none)
	}
}
