package v2_test

// Experimental candidate dcp-jcs-v2, phase 4: the Go adapter of the producer x consumer matrix
// (tests/interop/candidate/phase4/run.mjs). It runs only when the runner sets DCP_PHASE4_RUN; modes
// produce, ring and verify read and write the run directory in the format of the other adapters. Value
// inputs are read with encoding/json and UseNumber; the decoder calls are counted by the test-only verifier.

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

var p4mSDKs = []string{"ts", "py", "go", "rust", "wasm"}

var p4mParts = [][3]string{
	{"rpr", "DCP-AI.v2.ResponsiblePrincipal", "principal"},
	{"passport", "DCP-AI.v2.AgentPassport", "agent"},
	{"intent", "DCP-AI.v2.Intent", "agent"},
	{"policy", "DCP-AI.v2.PolicyDecision", "agent"},
}

type p4mKey struct {
	Alg  string `json:"alg"`
	Kid  string `json:"kid"`
	Pk   string `json:"pk"`
	Sk64 string `json:"sk64"`
	Sk   string `json:"sk"`
}

type p4mPair struct {
	Classical p4mKey `json:"classical"`
	PQ        p4mKey `json:"pq"`
}

type p4mMeta struct {
	Classical    bool     `json:"classical"`
	DualHash     bool     `json:"dual_hash"`
	Extensions   bool     `json:"extensions"`
	Checkpoint   bool     `json:"checkpoint"`
	SessionNonce string   `json:"session_nonce"`
	IssuedAt     string   `json:"session_issued_at"`
	ExpiresAt    string   `json:"session_expires_at"`
	CreatedAt    string   `json:"created_at"`
	Entries      []string `json:"entries"`
}

type p4mRun struct {
	t     *testing.T
	dir   string
	id    string
	specs struct {
		Cases []struct {
			ID    string   `json:"id"`
			Modes []string `json:"modes"`
		} `json:"cases"`
		Session struct {
			Now string `json:"now"`
		} `json:"session"`
	}
	keys map[string]p4mPair
}

func (r *p4mRun) read(path ...string) []byte {
	b, err := os.ReadFile(filepath.Join(append([]string{r.dir}, path...)...))
	if err != nil {
		r.t.Fatal(err)
	}
	return b
}

func (r *p4mRun) write(data []byte, path ...string) {
	p := filepath.Join(append([]string{r.dir}, path...)...)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		r.t.Fatal(err)
	}
	if err := os.WriteFile(p, data, 0o644); err != nil {
		r.t.Fatal(err)
	}
}

func (r *p4mRun) meta(caseID string) p4mMeta {
	var m p4mMeta
	if err := json.Unmarshal(r.read("inputs", caseID, "meta.json"), &m); err != nil {
		r.t.Fatal(err)
	}
	return m
}

func p4mStamp() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

// The producer's own decoder for value inputs: encoding/json, numbers kept as json.Number.
func (r *p4mRun) decode(b []byte) any {
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var v any
	if err := d.Decode(&v); err != nil {
		r.t.Fatal(err)
	}
	return v
}

func (r *p4mRun) piece(caseID, mode, name string) v2.ExperimentalCandidateInput {
	b := r.read("inputs", caseID, name+".json")
	if mode == "bytes" {
		return v2.ExperimentalCandidateBytes(b)
	}
	return v2.ExperimentalCandidateHostValue(r.decode(b))
}

func p4mKeys(p p4mPair, classicalOnly bool) v2.ExperimentalCandidateKeys {
	k := v2.ExperimentalCandidateKeys{Classical: v2.CompositeKeyInfo{Kid: p.Classical.Kid, Alg: "ed25519", SecretKeyB64: p.Classical.Sk64, PublicKeyB64: p.Classical.Pk}}
	if !classicalOnly {
		k.PQ = &v2.CompositeKeyInfo{Kid: p.PQ.Kid, Alg: "ml-dsa-65", SecretKeyB64: p.PQ.Sk, PublicKeyB64: p.PQ.Pk}
	}
	return k
}

// S09: members an artifact and its composite_sig do not sign, added to the intent artifact.
func (r *p4mRun) withExtensions(a p4mArtifact) v2.ExperimentalCandidateInput {
	if a.value != nil {
		out := map[string]any{}
		for k, v := range a.value {
			out[k] = v
		}
		sig := map[string]any{}
		for k, v := range a.value["composite_sig"].(map[string]any) {
			sig[k] = v
		}
		sig["x_sig_ext"] = "unsigned"
		out["composite_sig"] = sig
		out["x_artifact_ext"] = "unsigned"
		return v2.ExperimentalCandidateHostValue(out)
	}
	head := []byte(`{"composite_sig":{`)
	if !bytes.HasPrefix(a.bytes, head) {
		r.t.Fatal("an artifact that is not canonical")
	}
	return v2.ExperimentalCandidateBytes(append([]byte(`{"x_artifact_ext":"unsigned","composite_sig":{"x_sig_ext":"unsigned",`), a.bytes[len(head):]...))
}

type p4mArtifact struct {
	bytes []byte
	value map[string]any
}

func (a p4mArtifact) input() v2.ExperimentalCandidateInput {
	if a.value != nil {
		return v2.ExperimentalCandidateHostValue(a.value)
	}
	return v2.ExperimentalCandidateBytes(a.bytes)
}

func (r *p4mRun) assemble(reg *v2.AlgorithmRegistry, caseID, mode string, artifacts map[string]p4mArtifact) []byte {
	md := r.meta(caseID)
	intent := artifacts["intent"].input()
	if md.Extensions {
		intent = r.withExtensions(artifacts["intent"])
	}
	parts := v2.ExperimentalCandidateBundleParts{RPR: artifacts["rpr"].input(), Passport: artifacts["passport"].input(), Intent: intent, PolicyDecision: artifacts["policy"].input()}
	for _, e := range md.Entries {
		parts.AuditEntries = append(parts.AuditEntries, r.piece(caseID, mode, e))
	}
	if md.Checkpoint {
		parts.PQCheckpoints = []v2.ExperimentalCandidateInput{r.piece(caseID, mode, "checkpoint-0")}
	}
	signer := v2.ExperimentalCandidateBundleSigner{SignerType: "human", SignerID: "human:candidate-principal", Keys: p4mKeys(r.keys["principal"], md.Classical)}
	options := v2.ExperimentalCandidateBundleOptions{SessionNonce: md.SessionNonce, SessionIssuedAt: &md.IssuedAt, SessionExpiresAt: &md.ExpiresAt, CreatedAt: &md.CreatedAt, DualHash: md.DualHash}
	out, err := v2.ExperimentalCandidateSignBundle(reg, parts, signer, options)
	if err != nil {
		r.t.Fatalf("%s-%s: %v", caseID, mode, err)
	}
	return out.Bytes
}

type p4mIndexEntry struct {
	Case      string `json:"case"`
	SHA256    string `json:"sha256"`
	RunID     string `json:"run_id"`
	CreatedAt string `json:"created_at"`
}

func (r *p4mRun) produced(name string, data []byte, index *[]p4mIndexEntry) {
	r.write(data, "produced", "go", name+".bin")
	h := sha256.Sum256(data)
	*index = append(*index, p4mIndexEntry{name, hex.EncodeToString(h[:]), r.id, p4mStamp()})
}

func (r *p4mRun) writeIndex(file string, index []p4mIndexEntry) {
	b, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		r.t.Fatal(err)
	}
	r.write(b, "produced", "go", file)
}

func (r *p4mRun) produce(reg *v2.AlgorithmRegistry) {
	var kids strings.Builder
	for _, who := range []string{"principal", "agent"} {
		for _, c := range []string{"classical", "pq"} {
			k := r.keys[who].Classical
			if c == "pq" {
				k = r.keys[who].PQ
			}
			pk, err := base64.StdEncoding.DecodeString(k.Pk)
			if err != nil {
				r.t.Fatal(err)
			}
			fmt.Fprintf(&kids, "%s.%s %s\n", who, c, v2.DeriveKid(k.Alg, pk))
		}
	}
	r.write([]byte(kids.String()), "kids", "go.json")
	var index []p4mIndexEntry
	for _, c := range r.specs.Cases {
		md := r.meta(c.ID)
		for _, m := range c.Modes {
			artifacts := map[string]p4mArtifact{}
			for _, p := range p4mParts {
				out, err := v2.ExperimentalCandidateSignPayload(reg, p[1], r.piece(c.ID, m, p[0]), p4mKeys(r.keys[p[2]], md.Classical))
				if err != nil {
					r.t.Fatalf("%s-%s %s: %v", c.ID, m, p[0], err)
				}
				if m == "bytes" {
					artifacts[p[0]] = p4mArtifact{bytes: out.Bytes}
				} else {
					artifacts[p[0]] = p4mArtifact{value: out.SignedPayload}
				}
				if c.ID == "S01" && m == "bytes" {
					r.write(out.Bytes, "produced", "go", "artifacts", p[0]+".bin")
				}
			}
			r.produced(c.ID+"-"+m, r.assemble(reg, c.ID, m, artifacts), &index)
		}
	}
	r.writeIndex("index.json", index)
}

func (r *p4mRun) ring(reg *v2.AlgorithmRegistry) {
	next := p4mSDKs[3] // the producer after go
	artifacts := map[string]p4mArtifact{}
	for _, p := range p4mParts {
		artifacts[p[0]] = p4mArtifact{bytes: r.read("produced", next, "artifacts", p[0]+".bin")}
	}
	var index []p4mIndexEntry
	r.produced("R", r.assemble(reg, "S01", "bytes", artifacts), &index)
	r.writeIndex("ring.json", index)
}

type p4mItem struct {
	producer, caseID string
	data             []byte
	transport        string
	accepted         []string
}

func (r *p4mRun) items() []p4mItem {
	var out []p4mItem
	for _, producer := range p4mSDKs {
		for _, file := range []string{"index.json", "ring.json"} {
			if _, err := os.Stat(filepath.Join(r.dir, "produced", producer, file)); err != nil {
				continue
			}
			var index []p4mIndexEntry
			if err := json.Unmarshal(r.read("produced", producer, file), &index); err != nil {
				r.t.Fatal(err)
			}
			for _, e := range index {
				out = append(out, p4mItem{producer, e.Case, r.read("produced", producer, e.Case+".bin"), "bare", []string{"dcp-jcs-v2"}})
			}
		}
		if _, err := os.Stat(filepath.Join(r.dir, "negatives", producer, "index.json")); err != nil {
			continue
		}
		var negs []struct {
			Case   string `json:"case"`
			Config struct {
				Transport string   `json:"transport"`
				Accepted  []string `json:"accepted"`
			} `json:"config"`
		}
		if err := json.Unmarshal(r.read("negatives", producer, "index.json"), &negs); err != nil {
			r.t.Fatal(err)
		}
		for _, n := range negs {
			out = append(out, p4mItem{producer, n.Case, r.read("negatives", producer, n.Case+".bin"), n.Config.Transport, n.Config.Accepted})
		}
	}
	return out
}

func (r *p4mRun) verify(reg *v2.AlgorithmRegistry) {
	now, err := time.Parse(time.RFC3339, r.specs.Session.Now)
	if err != nil {
		r.t.Fatal(err)
	}
	type counted struct {
		v     *v2.ExperimentalCandidateVerifier
		calls *int
	}
	verifiers := map[string]counted{}
	var lines bytes.Buffer
	for _, it := range r.items() {
		key := it.transport + "|" + strings.Join(it.accepted, ",")
		c, ok := verifiers[key]
		if !ok {
			calls := new(int)
			v, err := v2.NewExperimentalCandidateVerifierForTests(v2.ExperimentalCandidateVerifierConfig{Transport: it.transport, AcceptedProfiles: it.accepted, Historical: "encoding_json"}, nil, calls)
			if err != nil {
				r.t.Fatal(err)
			}
			c = counted{v, calls}
			verifiers[key] = c
		}
		*c.calls = 0
		res, err := c.v.VerifyAt(reg, it.data, v2.DefaultVerifierPolicy(), now)
		if err != nil {
			r.t.Fatalf("%s %s: %v", it.producer, it.caseID, err)
		}
		line := map[string]any{
			"run_id": r.id, "consumer": "go", "producer": it.producer, "case": it.caseID, "created_at": p4mStamp(),
			"outcome": res.Route.Outcome, "class": nil, "entered": res.Entered, "verified": nil, "decoder_calls": *c.calls, "errors": []string{},
		}
		if res.Route.Class != "" {
			line["class"] = res.Route.Class
		}
		if res.Verification != nil {
			line["verified"] = res.Verification.Verified
			errs := res.Verification.Errors
			if len(errs) > 3 {
				errs = errs[:3]
			}
			if errs != nil {
				line["errors"] = errs
			}
		}
		b, err := json.Marshal(line)
		if err != nil {
			r.t.Fatal(err)
		}
		lines.Write(append(b, '\n'))
	}
	p := filepath.Join(r.dir, "results", "go.jsonl")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		r.t.Fatal(err)
	}
	f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		r.t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.Write(lines.Bytes()); err != nil {
		r.t.Fatal(err)
	}
}

// ── Cost (gate 10): equivalent pairs, N = 20 after 3 warm-ups, median and p90 ──

func p4mCPU() string {
	if runtime.GOOS == "darwin" {
		if out, err := exec.Command("sysctl", "-n", "machdep.cpu.brand_string").Output(); err == nil {
			return strings.TrimSpace(string(out))
		}
	}
	if b, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "model name") {
				return strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
			}
		}
	}
	return runtime.GOARCH
}

func p4mMeasure(t *testing.T, fn func() error) map[string]any {
	for i := 0; i < 3; i++ {
		if err := fn(); err != nil {
			t.Fatal(err)
		}
	}
	samples := make([]float64, 20)
	for i := range samples {
		t0 := time.Now()
		if err := fn(); err != nil {
			t.Fatal(err)
		}
		samples[i] = float64(time.Since(t0).Nanoseconds()) / 1e6
	}
	s := append([]float64(nil), samples...)
	sort.Float64s(s)
	return map[string]any{"median_ms": (s[9] + s[10]) / 2, "p90_ms": s[17], "samples_ms": samples}
}

// cost: today's builder and signer against the candidate producer, and the three verifications.
func (r *p4mRun) cost(reg *v2.AlgorithmRegistry) {
	md := r.meta("S01")
	payloads := map[string]any{}
	for _, p := range p4mParts {
		payloads[p[0]] = r.decode(r.read("inputs", "S01", p[0]+".json"))
	}
	keysOf := func(who string) v2.ExperimentalCandidateKeys { return p4mKeys(r.keys[who], false) }
	// The v1 builder takes typed entries, and AuditEvidenceV2 omits null members: the entries go through
	// the struct, the chain is recomputed over them, and both producers sign these same entries.
	var entries []v2.AuditEventV2
	var entryBytes [][]byte
	for i, e := range md.Entries {
		var ev v2.AuditEventV2
		if err := json.Unmarshal(r.read("inputs", "S01", e+".json"), &ev); err != nil {
			r.t.Fatal(err)
		}
		if i > 0 {
			c, err := v2.CanonicalizeV2(entries[i-1])
			if err != nil {
				r.t.Fatal(err)
			}
			ev.PrevHash = "sha256:" + v2.SHA256Hex([]byte(c))
		}
		b, err := json.Marshal(ev)
		if err != nil {
			r.t.Fatal(err)
		}
		entries, entryBytes = append(entries, ev), append(entryBytes, b)
	}
	produceV1 := func() ([]byte, error) {
		a := map[string]v2.SignedPayload{}
		for _, p := range p4mParts {
			k := keysOf(p[2])
			sp, err := v2.SignPayload(reg, p[1], payloads[p[0]], k.Classical, k.PQ)
			if err != nil {
				return nil, err
			}
			a[p[0]] = sp
		}
		bundle, err := v2.BuildBundleV2(v2.BundleBuildInput{RPR: a["rpr"], Passport: a["passport"], Intent: a["intent"], Policy: a["policy"], AuditEntries: entries, SessionNonce: md.SessionNonce})
		if err != nil {
			return nil, err
		}
		bundle.Manifest.SessionIssuedAt, bundle.Manifest.SessionExpiresAt = md.IssuedAt, md.ExpiresAt
		k := keysOf("principal")
		signed, err := v2.SignBundleV2(reg, bundle, k.Classical, k.PQ)
		if err != nil {
			return nil, err
		}
		return json.Marshal(signed)
	}
	produceCandidate := func() ([]byte, error) {
		a := map[string]p4mArtifact{}
		for _, p := range p4mParts {
			out, err := v2.ExperimentalCandidateSignPayload(reg, p[1], v2.ExperimentalCandidateHostValue(payloads[p[0]]), keysOf(p[2]))
			if err != nil {
				return nil, err
			}
			a[p[0]] = p4mArtifact{value: out.SignedPayload}
		}
		parts := v2.ExperimentalCandidateBundleParts{RPR: a["rpr"].input(), Passport: a["passport"].input(), Intent: a["intent"].input(), PolicyDecision: a["policy"].input()}
		for _, b := range entryBytes {
			parts.AuditEntries = append(parts.AuditEntries, v2.ExperimentalCandidateBytes(b))
		}
		out, err := v2.ExperimentalCandidateSignBundle(reg, parts, v2.ExperimentalCandidateBundleSigner{SignerType: "human", SignerID: "human:candidate-principal", Keys: keysOf("principal")},
			v2.ExperimentalCandidateBundleOptions{SessionNonce: md.SessionNonce, SessionIssuedAt: &md.IssuedAt, SessionExpiresAt: &md.ExpiresAt, CreatedAt: &md.CreatedAt})
		return out.Bytes, err
	}
	v1, err := produceV1()
	if err != nil {
		r.t.Fatal(err)
	}
	candidate, err := produceCandidate()
	if err != nil {
		r.t.Fatal(err)
	}
	now, err := time.Parse(time.RFC3339, r.specs.Session.Now)
	if err != nil {
		r.t.Fatal(err)
	}
	verifier, err := v2.NewExperimentalCandidateVerifier(v2.ExperimentalCandidateVerifierConfig{Transport: "bare", AcceptedProfiles: []string{"dcp-jcs-v1", "dcp-jcs-v2"}, Historical: "encoding_json"})
	if err != nil {
		r.t.Fatal(err)
	}
	policy := v2.DefaultVerifierPolicy()
	today := v2.VerifySignedBundleV2At(reg, v1, policy, now)
	viaV1, err1 := verifier.VerifyAt(reg, v1, policy, now)
	viaCandidate, err2 := verifier.VerifyAt(reg, candidate, policy, now)
	if err1 != nil || err2 != nil {
		r.t.Fatal(err1, err2)
	}
	r.write(v1, "cost", "go-v1.bin")
	r.write(candidate, "cost", "go-candidate.bin")
	var u1, u2 map[string]any
	if json.Unmarshal(v1, &u1) != nil || json.Unmarshal(candidate, &u2) != nil {
		r.t.Fatal("the pair does not decode")
	}
	field := func(u map[string]any, path ...string) any {
		var v any = u
		for _, p := range path {
			m, _ := v.(map[string]any)
			v = m[p]
		}
		return v
	}
	same := func(path ...string) bool {
		x, y := field(u1, path...), field(u2, path...)
		_, isString := x.(string)
		return isString && reflect.DeepEqual(x, y)
	}
	checks := map[string]bool{
		"same_payload_hashes": same("bundle", "responsible_principal_record", "payload_hash") && same("bundle", "agent_passport", "payload_hash") &&
			same("bundle", "intent", "payload_hash") && same("bundle", "policy_decision", "payload_hash"),
		"same_session":   same("bundle", "manifest", "session_nonce") && same("bundle", "manifest", "session_issued_at") && same("bundle", "manifest", "session_expires_at"),
		"same_entries":   reflect.DeepEqual(field(u1, "bundle", "audit_entries"), field(u2, "bundle", "audit_entries")),
		"today_verified": today.Verified,
		"v1_path":        viaV1.Entered == "dcp-jcs-v1" && viaV1.Verification != nil && viaV1.Verification.Verified,
		"candidate":      viaCandidate.Entered == "dcp-jcs-v2" && viaCandidate.Verification != nil && viaCandidate.Verification.Verified,
	}
	for name, ok := range checks {
		if !ok {
			r.t.Fatalf("the pair is not equivalent: %v (%v); today %v", checks, name, today.Errors)
		}
	}
	secondary := func(u map[string]any) bool {
		_, ok := field(u, "bundle", "manifest", "audit_merkle_root_secondary").(string)
		return ok
	}
	differences := map[string]any{
		"secondary_root": map[string]bool{"v1": secondary(u1), "candidate": secondary(u2)},
		"profile":        map[string]any{"v1": field(u1, "bundle", "manifest", "canonicalization_profile"), "candidate": field(u2, "bundle", "manifest", "canonicalization_profile")},
		"serialization":  map[string]string{"v1": "json.Marshal of the typed SignedBundleV2 (struct field order, HTML escapes)", "candidate": "canonical bytes (dcp-jcs, from the producer)"},
		"entries":        "through AuditEventV2 (null evidence members omitted), chain recomputed; the same entries on both sides",
	}
	boundaries := map[string]string{
		"produce_v1":        "the four artifacts signed with SignPayload, BuildBundleV2, SignBundleV2, json.Marshal",
		"produce_candidate": "the four artifacts signed by the candidate producer (value inputs; entries as bytes), the bundle assembled and signed, canonical bytes",
		"verify_today":      "VerifySignedBundleV2At(bytes): the API takes bytes and decodes them itself",
		"verify_v1_path":    "the bytes into the phase 3 verifier (accepting dcp-jcs-v1 and dcp-jcs-v2): ingress, route, the historical decoder, today's verifier",
		"verify_candidate":  "the bytes into the same verifier: ingress, route, the candidate verifier",
	}
	verifyErr := func(res v2.ExperimentalCandidateVerification, err error) error { return err }
	t0 := time.Now()
	ops := map[string]any{
		"produce_v1":        p4mMeasure(r.t, func() error { _, err := produceV1(); return err }),
		"produce_candidate": p4mMeasure(r.t, func() error { _, err := produceCandidate(); return err }),
		"verify_today":      p4mMeasure(r.t, func() error { v2.VerifySignedBundleV2At(reg, v1, policy, now); return nil }),
		"verify_v1_path":    p4mMeasure(r.t, func() error { return verifyErr(verifier.VerifyAt(reg, v1, policy, now)) }),
		"verify_candidate":  p4mMeasure(r.t, func() error { return verifyErr(verifier.VerifyAt(reg, candidate, policy, now)) }),
	}
	report, err := json.MarshalIndent(map[string]any{
		"sdk": "go", "run_id": r.id, "created_at": p4mStamp(), "n": 20, "warmup": 3, "platform": "Go (go test, sdks/go)",
		"versions": map[string]string{"go": runtime.Version()}, "cpu": p4mCPU(), "bytes": map[string]int{"v1": len(v1), "candidate": len(candidate)},
		"differences": differences, "boundaries": boundaries, "checks": checks, "ops": ops, "measured_ms": float64(time.Since(t0).Nanoseconds()) / 1e6,
	}, "", "  ")
	if err != nil {
		r.t.Fatal(err)
	}
	r.write(report, "cost", "go.json")
}

func TestExperimentalCandidatePhase4Matrix(t *testing.T) {
	dir := os.Getenv("DCP_PHASE4_RUN")
	if dir == "" {
		t.Skip("run by tests/interop/candidate/phase4/run.mjs")
	}
	r := &p4mRun{t: t, dir: dir, id: os.Getenv("DCP_PHASE4_RUN_ID")}
	if r.id == "" {
		t.Fatal("DCP_PHASE4_RUN_ID is required")
	}
	specs, err := os.ReadFile(os.Getenv("DCP_PHASE4_SPECS"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(specs, &r.specs); err != nil {
		t.Fatal(err)
	}
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	switch os.Getenv("DCP_PHASE4_MODE") {
	case "produce", "ring", "cost":
		if err := json.Unmarshal(r.read("inputs", "keys.json"), &r.keys); err != nil {
			t.Fatal(err)
		}
		switch os.Getenv("DCP_PHASE4_MODE") {
		case "produce":
			r.produce(reg)
		case "ring":
			r.ring(reg)
		default:
			r.cost(reg)
		}
	case "verify":
		r.verify(reg)
	default:
		t.Fatalf("unknown mode %q", os.Getenv("DCP_PHASE4_MODE"))
	}
}
