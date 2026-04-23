package dcp_test

import (
	"strings"
	"testing"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func TestClassifyMemory(t *testing.T) {
	entries := []v2.MemoryEntry{
		{Hash: "hA", Category: "operational", Size: 100},
		{Hash: "hB", Category: "relational", Size: 50},
		{Hash: "hC", Category: "secrets", Size: 30},
	}
	classification := map[string]string{
		"operational": "transfer",
		"relational":  "destroy",
		"secrets":     "destroy",
	}
	out := v2.ClassifyMemory(entries, classification)
	if len(out.Operational) != 1 || out.Operational[0].Hash != "hA" {
		t.Fatalf("operational=%v", out.Operational)
	}
	if len(out.RelationalDestroyed) != 2 {
		t.Fatalf("relational destroyed=%v", out.RelationalDestroyed)
	}
}

func TestClassifyMemoryUnknownDefaultsToDestroy(t *testing.T) {
	entries := []v2.MemoryEntry{{Hash: "hX", Category: "unknown", Size: 1}}
	out := v2.ClassifyMemory(entries, map[string]string{})
	if len(out.RelationalDestroyed) != 1 || out.RelationalDestroyed[0] != "hX" {
		t.Fatalf("unexpected: %v", out.RelationalDestroyed)
	}
	if len(out.Operational) != 0 {
		t.Fatalf("expected empty operational, got %v", out.Operational)
	}
}

func TestClassifyMemoryRetainDropsEntry(t *testing.T) {
	entries := []v2.MemoryEntry{{Hash: "hR", Category: "local", Size: 10}}
	out := v2.ClassifyMemory(entries, map[string]string{"local": "retain"})
	if len(out.Operational) != 0 || len(out.RelationalDestroyed) != 0 {
		t.Fatalf("retain should not transfer or destroy; got op=%v rd=%v", out.Operational, out.RelationalDestroyed)
	}
}

func TestCreateAndUpdateDigitalTestament(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	v1, err := v2.CreateDigitalTestament(reg, ck, pqk, v2.DigitalTestamentParams{
		AgentID:              "agent_123",
		SessionNonce:         strings.Repeat("a", 64),
		SuccessorPreferences: []map[string]interface{}{{"agent_id": "agent_succ", "priority": 1}},
		MemoryClassification: map[string]string{"operational": "transfer"},
		HumanConsentRequired: true,
	})
	if err != nil {
		t.Fatalf("CreateDigitalTestament: %v", err)
	}
	if v1["testament_version"] != 1 {
		t.Fatalf("v1 version = %v, want 1", v1["testament_version"])
	}
	if v1["prev_testament_hash"] != "GENESIS" {
		t.Fatalf("v1 prev_testament_hash = %v", v1["prev_testament_hash"])
	}

	falseVal := false
	v2n, err := v2.UpdateDigitalTestament(reg, ck, pqk, v1, v2.TestamentUpdates{
		SessionNonce:         strings.Repeat("b", 64),
		HumanConsentRequired: &falseVal,
	})
	if err != nil {
		t.Fatalf("UpdateDigitalTestament: %v", err)
	}
	if v2n["testament_version"] != 2 {
		t.Fatalf("v2 version = %v, want 2", v2n["testament_version"])
	}
	hash, _ := v2n["prev_testament_hash"].(string)
	if !strings.HasPrefix(hash, "sha256:") {
		t.Fatalf("v2 prev_testament_hash should start with sha256:, got %q", hash)
	}
	if v2n["human_consent_required"] != false {
		t.Fatalf("expected human_consent_required=false, got %v", v2n["human_consent_required"])
	}
}

func TestCreateMemoryTransferManifest(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)
	manifest, err := v2.CreateMemoryTransferManifest(reg, ck, pqk, v2.MemoryTransferManifestParams{
		SessionNonce:              strings.Repeat("a", 64),
		PredecessorAgentID:        "agent_pred",
		SuccessorAgentID:          "agent_succ",
		OperationalMemory:         []v2.MemoryEntry{{Hash: "hA", Category: "operational", Size: 100}},
		RelationalMemoryDestroyed: []string{"hB"},
		TransferHash:              map[string]string{"sha256": strings.Repeat("0", 64), "sha3_256": strings.Repeat("1", 64)},
	})
	if err != nil {
		t.Fatalf("CreateMemoryTransferManifest: %v", err)
	}
	if manifest["predecessor_agent_id"] != "agent_pred" {
		t.Fatalf("predecessor_agent_id mismatch")
	}
	sig, ok := manifest["composite_sig"].(*v2.CompositeSignature)
	if !ok || sig.Binding != "pq_over_classical" {
		t.Fatalf("unexpected composite_sig: %#v", manifest["composite_sig"])
	}
}

func TestExecuteSuccession(t *testing.T) {
	reg := buildRegistry(t)
	ck, pqk := makeKeys(t, reg)

	if _, err := v2.ExecuteSuccession(reg, ck, pqk, v2.SuccessionParams{
		PredecessorAgentID:         "agent_pred",
		SuccessorAgentID:           "agent_succ",
		SessionNonce:               strings.Repeat("a", 64),
		TransitionType:             "planned",
		HumanConsent:               nil,
		CeremonyParticipants:       nil,
		MemoryTransferManifestHash: "sha256:0000",
	}); err == nil {
		t.Fatalf("expected error for empty participants")
	}

	record, err := v2.ExecuteSuccession(reg, ck, pqk, v2.SuccessionParams{
		PredecessorAgentID:         "agent_pred",
		SuccessorAgentID:           "agent_succ",
		SessionNonce:               strings.Repeat("a", 64),
		TransitionType:             "planned",
		HumanConsent:               map[string]interface{}{"human_id": "h1", "decision": "approved"},
		CeremonyParticipants:       []string{"p1", "p2"},
		MemoryTransferManifestHash: "sha256:0000",
	})
	if err != nil {
		t.Fatalf("ExecuteSuccession: %v", err)
	}
	participants, _ := record["ceremony_participants"].([]string)
	if len(participants) != 2 {
		t.Fatalf("participants = %v", participants)
	}
	if record["transition_type"] != "planned" {
		t.Fatalf("transition_type = %v", record["transition_type"])
	}
}
