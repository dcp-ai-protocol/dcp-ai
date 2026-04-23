// Package v2 — DCP v2.0 Lazy PQ Checkpoint (Go port).

package v2

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
)

// AuditEventsMerkleRoot computes a SHA-256 Merkle root over canonicalised event payloads.
// Returns 64 lowercase hex chars (no "sha256:" prefix).
func AuditEventsMerkleRoot(events []map[string]interface{}) (string, error) {
	if len(events) == 0 {
		return "", errors.New("cannot compute Merkle root of empty event list")
	}
	leaves := make([]string, 0, len(events))
	for _, e := range events {
		c, err := CanonicalizeV2(e)
		if err != nil {
			return "", fmt.Errorf("canonicalize: %w", err)
		}
		sum := sha256.Sum256([]byte(c))
		leaves = append(leaves, hex.EncodeToString(sum[:]))
	}
	for len(leaves) > 1 {
		if len(leaves)%2 == 1 {
			leaves = append(leaves, leaves[len(leaves)-1])
		}
		next := make([]string, 0, len(leaves)/2)
		for i := 0; i < len(leaves); i += 2 {
			l, err := hex.DecodeString(leaves[i])
			if err != nil {
				return "", err
			}
			r, err := hex.DecodeString(leaves[i+1])
			if err != nil {
				return "", err
			}
			combined := append(l, r...)
			sum := sha256.Sum256(combined)
			next = append(next, hex.EncodeToString(sum[:]))
		}
		leaves = next
	}
	return leaves[0], nil
}

// CreatePQCheckpoint signs a Merkle-root checkpoint over a batch of events.
func CreatePQCheckpoint(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	events []map[string]interface{},
	sessionNonce string,
) (map[string]interface{}, error) {
	if len(events) == 0 {
		return nil, errors.New("cannot create checkpoint for empty event list")
	}
	root, err := AuditEventsMerkleRoot(events)
	if err != nil {
		return nil, err
	}
	fromID, _ := events[0]["audit_id"].(string)
	toID, _ := events[len(events)-1]["audit_id"].(string)

	payload := map[string]interface{}{
		"checkpoint_id": "ckpt-" + newUUIDv4(),
		"session_nonce": sessionNonce,
		"event_range": map[string]interface{}{
			"from_audit_id": fromID,
			"to_audit_id":   toID,
			"count":         len(events),
		},
		"merkle_root": "sha256:" + root,
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxAuditEvent, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}

func newUUIDv4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
		b[0], b[1], b[2], b[3], b[4], b[5],
		b[6], b[7], b[8], b[9],
		b[10], b[11], b[12], b[13], b[14], b[15],
	)
}

// PQCheckpointManager batches audit events and flushes a PQ checkpoint at interval.
type PQCheckpointManager struct {
	registry     *AlgorithmRegistry
	classicalKey CompositeKeyInfo
	pqKey        CompositeKeyInfo
	sessionNonce string

	interval    int
	tier        string
	pending     []map[string]interface{}
	checkpoints []map[string]interface{}
}

// NewPQCheckpointManager constructs a manager with an explicit interval.
func NewPQCheckpointManager(
	interval int,
	registry *AlgorithmRegistry,
	sessionNonce string,
	classicalKey, pqKey CompositeKeyInfo,
) (*PQCheckpointManager, error) {
	if interval < 1 {
		return nil, errors.New("checkpoint interval must be >= 1")
	}
	return &PQCheckpointManager{
		registry:     registry,
		classicalKey: classicalKey,
		pqKey:        pqKey,
		sessionNonce: sessionNonce,
		interval:     interval,
	}, nil
}

// NewPQCheckpointManagerWithTier constructs a manager driven by a security tier.
func NewPQCheckpointManagerWithTier(
	tier string,
	registry *AlgorithmRegistry,
	sessionNonce string,
	classicalKey, pqKey CompositeKeyInfo,
) *PQCheckpointManager {
	return &PQCheckpointManager{
		registry:     registry,
		classicalKey: classicalKey,
		pqKey:        pqKey,
		sessionNonce: sessionNonce,
		interval:     TierToCheckpointInterval(tier),
		tier:         tier,
	}
}

// Interval returns the current checkpoint interval.
func (m *PQCheckpointManager) Interval() int { return m.interval }

// Tier returns the current tier ("" if explicit interval was used).
func (m *PQCheckpointManager) Tier() string { return m.tier }

// SetTier updates the tier and recomputes the interval; does not flush pending.
func (m *PQCheckpointManager) SetTier(tier string) {
	m.tier = tier
	m.interval = TierToCheckpointInterval(tier)
}

// PendingCount returns the number of un-checkpointed events.
func (m *PQCheckpointManager) PendingCount() int { return len(m.pending) }

// Checkpoints returns a snapshot of emitted checkpoints.
func (m *PQCheckpointManager) Checkpoints() []map[string]interface{} {
	out := make([]map[string]interface{}, len(m.checkpoints))
	copy(out, m.checkpoints)
	return out
}

// RecordEvent appends an event; flushes if pending reaches interval.
func (m *PQCheckpointManager) RecordEvent(event map[string]interface{}) (map[string]interface{}, error) {
	m.pending = append(m.pending, event)
	if len(m.pending) >= m.interval {
		return m.Flush()
	}
	return nil, nil
}

// Flush forces a checkpoint over the current pending events (nil if none).
func (m *PQCheckpointManager) Flush() (map[string]interface{}, error) {
	if len(m.pending) == 0 {
		return nil, nil
	}
	ckpt, err := CreatePQCheckpoint(m.registry, m.classicalKey, m.pqKey, m.pending, m.sessionNonce)
	if err != nil {
		return nil, err
	}
	m.checkpoints = append(m.checkpoints, ckpt)
	m.pending = m.pending[:0]
	return ckpt, nil
}
