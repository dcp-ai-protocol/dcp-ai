// Go agent for tools/interop-matrix (protocol in ../../README.md).
// Built against the LOCAL Go SDK through the replace directive in go.mod.
package main

import (
	"bufio"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type keyPair struct{ classical, pq v2.CompositeKeyInfo }

type intentState struct {
	intent, policy v2.SignedPayload
	decision       string
	trail          []v2.AuditEventV2
}

type agentState struct {
	human, agent            keyPair
	nonce, humanID, agentID string
	rpr, passport           v2.SignedPayload
	intents                 map[string]*intentState
}

var (
	registry = v2.NewAlgorithmRegistry()
	ed       = &providers.Ed25519Provider{}
	mldsa    = &providers.MlDsa65Provider{}
	state    *agentState
)

func now() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

func sha256Of(text string) string { return "sha256:" + v2.SHA256Hex([]byte(text)) }

func uuid4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func newKey(p v2.CryptoProvider) (v2.CompositeKeyInfo, error) {
	k, err := p.GenerateKeypair()
	if err != nil {
		return v2.CompositeKeyInfo{}, err
	}
	return v2.CompositeKeyInfo{Kid: k.Kid, Alg: p.Alg(), SecretKeyB64: k.SecretKeyB64, PublicKeyB64: k.PublicKeyB64}, nil
}

func newKeyPair() (keyPair, error) {
	c, err := newKey(ed)
	if err != nil {
		return keyPair{}, err
	}
	p, err := newKey(mldsa)
	return keyPair{c, p}, err
}

func entries(k keyPair, at string) []v2.KeyEntry {
	out := []v2.KeyEntry{}
	for _, c := range []v2.CompositeKeyInfo{k.classical, k.pq} {
		out = append(out, v2.KeyEntry{Kid: c.Kid, Alg: c.Alg, PublicKeyB64: c.PublicKeyB64, CreatedAt: at, ExpiresAt: nil, Status: "active"})
	}
	return out
}

func sign(payload map[string]interface{}, context string, k keyPair) (v2.SignedPayload, error) {
	return v2.SignPayload(registry, context, payload, k.classical, &k.pq)
}

func canonicalHash(v interface{}) (string, error) {
	c, err := v2.CanonicalizeV2(v)
	if err != nil {
		return "", err
	}
	return sha256Of(c), nil
}

func identity(args json.RawMessage) (interface{}, error) {
	var a struct {
		OwnerName    string `json:"owner_name"`
		Jurisdiction string `json:"jurisdiction"`
	}
	if err := json.Unmarshal(args, &a); err != nil {
		return nil, err
	}
	human, err := newKeyPair()
	if err != nil {
		return nil, err
	}
	agent, err := newKeyPair()
	if err != nil {
		return nil, err
	}
	at, nonce := now(), v2.GenerateSessionNonce()
	s := &agentState{human: human, agent: agent, nonce: nonce, humanID: "rpr:" + uuid4(), agentID: "agent:" + uuid4(), intents: map[string]*intentState{}}
	rpr := map[string]interface{}{
		"dcp_version": "2.0", "human_id": s.humanID, "session_nonce": nonce, "legal_name": a.OwnerName,
		"entity_type": "natural_person", "jurisdiction": a.Jurisdiction, "liability_mode": "owner_responsible",
		"override_rights": true, "issued_at": at, "expires_at": nil, "contact": nil, "binding_keys": entries(human, at),
	}
	passport := map[string]interface{}{
		"dcp_version": "2.0", "agent_id": s.agentID, "session_nonce": nonce, "keys": entries(agent, at),
		"principal_binding_reference": s.humanID, "capabilities": []string{"api_call", "payments"},
		"risk_tier": "medium", "created_at": at, "status": "active",
	}
	if s.rpr, err = sign(rpr, v2.CtxResponsiblePrincipal, human); err != nil {
		return nil, err
	}
	if s.passport, err = sign(passport, v2.CtxAgentPassport, agent); err != nil {
		return nil, err
	}
	state = s
	return map[string]string{"agent_id": s.agentID, "human_id": s.humanID, "session_nonce": nonce}, nil
}

func intent(args json.RawMessage) (interface{}, error) {
	var a struct {
		ActionType        string   `json:"action_type"`
		Channel           string   `json:"channel"`
		DataClasses       []string `json:"data_classes"`
		EstimatedImpact   string   `json:"estimated_impact"`
		RiskScore         int      `json:"risk_score"`
		AppliedPolicyHash string   `json:"applied_policy_hash"`
	}
	if err := json.Unmarshal(args, &a); err != nil {
		return nil, err
	}
	if state == nil {
		return nil, errors.New("no identity")
	}
	at := now()
	tier := v2.ComputeSecurityTier(v2.SecurityTierInput{
		RiskScore: a.RiskScore, DataClasses: a.DataClasses, ActionType: a.ActionType, EstimatedImpact: a.EstimatedImpact,
	}).Tier
	id := "intent:" + uuid4()
	in := map[string]interface{}{
		"dcp_version": "2.0", "intent_id": id, "session_nonce": state.nonce, "agent_id": state.agentID,
		"human_id": state.humanID, "timestamp": at, "action_type": a.ActionType,
		"target": map[string]interface{}{"channel": a.Channel, "to": nil}, "data_classes": a.DataClasses,
		"estimated_impact": a.EstimatedImpact, "requires_consent": a.EstimatedImpact == "high", "security_tier": tier,
	}
	decision := "block"
	if a.RiskScore < 500 {
		decision = "approve"
	} else if a.RiskScore < 800 {
		decision = "escalate"
	}
	var confirmation interface{}
	if decision != "approve" {
		confirmation = map[string]interface{}{"type": "human_approve", "fields": []string{"action_type"}}
	}
	policy := map[string]interface{}{
		"dcp_version": "2.0", "intent_id": id, "session_nonce": state.nonce, "decision": decision,
		"risk_score": a.RiskScore, "reasons": []string{fmt.Sprintf("interop-matrix: risk_score %d", a.RiskScore)},
		"required_confirmation": confirmation, "applied_policy_hash": a.AppliedPolicyHash, "timestamp": at,
		"resolved_tier": tier,
	}
	it := &intentState{decision: decision, trail: []v2.AuditEventV2{}}
	var err error
	if it.intent, err = sign(in, v2.CtxIntent, state.agent); err != nil {
		return nil, err
	}
	if it.policy, err = sign(policy, v2.CtxPolicyDecision, state.agent); err != nil {
		return nil, err
	}
	state.intents[id] = it
	return map[string]string{"intent_id": id, "decision": decision, "security_tier": tier}, nil
}

func lookup(intentID string) (*intentState, error) {
	if state != nil {
		if it, ok := state.intents[intentID]; ok {
			return it, nil
		}
	}
	return nil, fmt.Errorf("unknown intent %s", intentID)
}

func act(args json.RawMessage) (interface{}, error) {
	var a struct {
		IntentID  string `json:"intent_id"`
		Outcome   string `json:"outcome"`
		Tool      string `json:"tool"`
		ResultRef string `json:"result_ref"`
	}
	if err := json.Unmarshal(args, &a); err != nil {
		return nil, err
	}
	it, err := lookup(a.IntentID)
	if err != nil {
		return nil, err
	}
	prev := "GENESIS"
	if n := len(it.trail); n > 0 {
		if prev, err = canonicalHash(it.trail[n-1]); err != nil {
			return nil, err
		}
	}
	intentHash, err := canonicalHash(it.intent.Payload)
	if err != nil {
		return nil, err
	}
	evidenceHash := sha256Of(a.ResultRef)
	entry := v2.AuditEventV2{
		DCPVersion: "2.0", AuditID: "audit:" + uuid4(), SessionNonce: state.nonce, PrevHash: prev, HashAlg: "sha256",
		Timestamp: now(), AgentID: state.agentID, HumanID: state.humanID, IntentID: a.IntentID, IntentHash: intentHash,
		PolicyDecision: map[string]string{"approve": "approved", "escalate": "escalated", "block": "blocked"}[it.decision],
		Outcome:        a.Outcome,
		Evidence:       v2.AuditEvidenceV2{Tool: &a.Tool, ResultRef: &a.ResultRef, EvidenceHash: &evidenceHash},
	}
	it.trail = append(it.trail, entry)
	return map[string]interface{}{"audit_id": entry.AuditID, "count": len(it.trail)}, nil
}

func bundle(args json.RawMessage) (interface{}, error) {
	var a struct {
		IntentID string `json:"intent_id"`
	}
	if err := json.Unmarshal(args, &a); err != nil {
		return nil, err
	}
	it, err := lookup(a.IntentID)
	if err != nil {
		return nil, err
	}
	b, err := v2.BuildBundleV2(v2.BundleBuildInput{
		RPR: state.rpr, Passport: state.passport, Intent: it.intent, Policy: it.policy,
		AuditEntries: it.trail, SessionNonce: state.nonce,
	})
	if err != nil {
		return nil, err
	}
	signed, err := v2.SignBundleV2(registry, b, state.human.classical, &state.human.pq)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"signed_bundle": signed}, nil
}

func verify(args json.RawMessage) (interface{}, error) {
	var a struct {
		SignedBundle json.RawMessage `json:"signed_bundle"`
		Mode         string          `json:"mode"`
	}
	if err := json.Unmarshal(args, &a); err != nil {
		return nil, err
	}
	policy := v2.DefaultVerifierPolicy()
	if a.Mode != "" {
		policy.DefaultMode = a.Mode
		policy.RiskOverrides = map[string]string{"low": a.Mode, "medium": a.Mode, "high": a.Mode}
	}
	r := v2.VerifySignedBundleV2WithPolicy(registry, a.SignedBundle, policy)
	return map[string]interface{}{"valid": r.Verified, "errors": r.Errors}, nil
}

var commands = map[string]func(json.RawMessage) (interface{}, error){
	"identity": identity, "intent": intent, "act": act, "bundle": bundle, "verify": verify,
	"shutdown": func(json.RawMessage) (interface{}, error) { return map[string]interface{}{}, nil },
}

func handle(cmd string, args json.RawMessage) (result interface{}, err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("panic: %v", p)
		}
	}()
	h, ok := commands[cmd]
	if !ok {
		return nil, fmt.Errorf("unknown command %s", cmd)
	}
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage("{}")
	}
	return h(args)
}

func main() {
	registry.RegisterSigner(ed)
	registry.RegisterSigner(mldsa)
	out := json.NewEncoder(os.Stdout)
	out.SetEscapeHTML(false)
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 1<<20), 256<<20)
	for sc.Scan() {
		line := sc.Bytes()
		if strings.TrimSpace(string(line)) == "" {
			continue
		}
		var req struct {
			ID   json.RawMessage `json:"id"`
			Cmd  string          `json:"cmd"`
			Args json.RawMessage `json:"args"`
		}
		var result interface{}
		err := json.Unmarshal(line, &req)
		if err == nil {
			result, err = handle(req.Cmd, req.Args)
		}
		id := req.ID
		if len(id) == 0 {
			id = json.RawMessage("null")
		}
		resp := map[string]interface{}{"id": id, "ok": err == nil}
		if err != nil {
			resp["error"] = err.Error()
		} else {
			resp["result"] = result
		}
		if encErr := out.Encode(resp); encErr != nil {
			_ = out.Encode(map[string]interface{}{"id": id, "ok": false, "error": encErr.Error()})
		}
		if err == nil && req.Cmd == "shutdown" {
			os.Exit(0)
		}
	}
	if err := sc.Err(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
