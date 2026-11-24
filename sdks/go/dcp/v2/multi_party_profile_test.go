package v2_test

// Multi-party authorization under the opt-in mpa-v1 profile
// (spec/profiles/multi-party): the shared vectors in
// tests/interop/v2/multi_party_vectors.json, through the public API, and what
// the vectors cannot express. Mirrors
// sdks/typescript/src/__tests__/multi-party-auth.test.ts.

import (
	"bytes"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type mpaExpect struct {
	Authorized      bool     `json:"authorized"`
	Structure       string   `json:"structure"`
	Verification    string   `json:"verification"`
	PartiesCounted  *int     `json:"parties_counted"`
	RequiredParties *int     `json:"required_parties"`
	Codes           []string `json:"codes"`
}

type mpaCase struct {
	Name      string `json:"name"`
	Group     string `json:"group"`
	Rule      string `json:"rule"`
	Record    string `json:"record"`
	PolicySet string `json:"policy_set"`
	TrustSet  string `json:"trust_set"`
	NowMs     int64  `json:"now_ms"`
	Expected  struct {
		Operation  string          `json:"operation"`
		Target     string          `json:"target"`
		Parameters json.RawMessage `json:"parameters"`
	} `json:"expected"`
	Expect mpaExpect `json:"expect"`
}

type mpaVectors struct {
	Profile           string                     `json:"profile"`
	MaxAuthorizations int                        `json:"max_authorizations"`
	TrustSets         map[string]json.RawMessage `json:"trust_sets"`
	PolicySets        map[string]json.RawMessage `json:"policy_sets"`
	Records           map[string]json.RawMessage `json:"records"`
	Cases             []mpaCase                  `json:"cases"`
	ConfigCases       []struct {
		Name       string          `json:"name"`
		PolicySet  json.RawMessage `json:"policy_set"`
		ExpectCode *string         `json:"expect_code"`
	} `json:"config_cases"`
	TrustConfigCases []struct {
		Name       string          `json:"name"`
		TrustSet   json.RawMessage `json:"trust_set"`
		ExpectCode string          `json:"expect_code"`
	} `json:"trust_config_cases"`
}

var loadMpaVectors = sync.OnceValue(func() *mpaVectors {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "interop", "v2", "multi_party_vectors.json"))
	if err != nil {
		panic(err)
	}
	var vecs mpaVectors
	if err := json.Unmarshal(data, &vecs); err != nil {
		panic(err)
	}
	return &vecs
})

func mpaRegistry() *v2.AlgorithmRegistry {
	reg := v2.NewAlgorithmRegistry()
	reg.RegisterSigner(&providers.Ed25519Provider{})
	reg.RegisterSigner(&providers.MlDsa65Provider{})
	return reg
}

func mpaCaseNamed(t *testing.T, name string) mpaCase {
	t.Helper()
	for _, c := range loadMpaVectors().Cases {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no case %s", name)
	return mpaCase{}
}

// mpaParameters decodes a JSON object keeping its numbers exact.
func mpaParameters(t *testing.T, raw json.RawMessage) map[string]interface{} {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var m map[string]interface{}
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("parameters: %v", err)
	}
	return m
}

func mpaOptions(t *testing.T, c mpaCase) v2.MultiPartyOptions {
	t.Helper()
	vecs := loadMpaVectors()
	policy, err := v2.NewMultiPartyPolicyStore(vecs.PolicySets[c.PolicySet])
	if err != nil {
		t.Fatalf("policy set %s: %v", c.PolicySet, err)
	}
	trust, err := v2.NewPrincipalTrustStore(vecs.TrustSets[c.TrustSet])
	if err != nil {
		t.Fatalf("trust set %s: %v", c.TrustSet, err)
	}
	return v2.MultiPartyOptions{
		Policy:   policy,
		Trust:    trust,
		Expected: v2.MultiPartyExpected{Operation: c.Expected.Operation, Target: c.Expected.Target, Parameters: mpaParameters(t, c.Expected.Parameters)},
		Now:      time.UnixMilli(c.NowMs),
	}
}

func mpaEvaluate(t *testing.T, reg *v2.AlgorithmRegistry, c mpaCase, record []byte) *v2.MultiPartyEvaluation {
	t.Helper()
	r, err := v2.EvaluateMultiPartyAuthorization(reg, record, mpaOptions(t, c))
	if err != nil {
		t.Fatalf("%s: %v", c.Name, err)
	}
	return r
}

func mpaCodes(r *v2.MultiPartyEvaluation) []string {
	codes := []string{}
	for _, e := range r.Errors {
		if !slices.Contains(codes, e.Code) {
			codes = append(codes, e.Code)
		}
	}
	slices.Sort(codes)
	return codes
}

func TestMultiPartyVectors(t *testing.T) {
	vecs := loadMpaVectors()
	if vecs.Profile != v2.MPAV1 || vecs.MaxAuthorizations != v2.MPAV1MaxAuthorizations {
		t.Fatalf("profile %q, max authorizations %d", vecs.Profile, vecs.MaxAuthorizations)
	}
	if len(vecs.Cases) < 62 || len(vecs.ConfigCases) < 21 || len(vecs.TrustConfigCases) < 1 {
		t.Fatalf("vectors are missing: %d cases, %d configuration cases", len(vecs.Cases), len(vecs.ConfigCases))
	}
	reg := mpaRegistry()
	for _, c := range vecs.Cases {
		t.Run(c.Group+"/"+c.Name, func(t *testing.T) {
			raw := vecs.Records[c.Record]
			r := mpaEvaluate(t, reg, c, raw)
			got := mpaExpect{r.Authorized, r.Structure, r.Verification, r.PartiesCounted, r.RequiredParties, mpaCodes(r)}
			if !reflect.DeepEqual(got, c.Expect) {
				gotJSON, _ := json.Marshal(got)
				wantJSON, _ := json.Marshal(c.Expect)
				t.Fatalf("%s\n got %s\nwant %s", c.Rule, gotJSON, wantJSON)
			}
			var policy, trust struct {
				Version  string `json:"policy_set_version"`
				TVersion string `json:"trust_set_version"`
			}
			_ = json.Unmarshal(vecs.PolicySets[c.PolicySet], &policy)
			_ = json.Unmarshal(vecs.TrustSets[c.TrustSet], &trust)
			if r.Profile != "mpa-v1" || r.PolicySetVersion != policy.Version || r.TrustSetVersion != trust.TVersion {
				t.Fatalf("profile %q, policy set %q, trust set %q", r.Profile, r.PolicySetVersion, r.TrustSetVersion)
			}
			var rec struct {
				Operation string `json:"operation"`
				Payload   struct {
					Request struct {
						Target    string `json:"target"`
						RequestID string `json:"request_id"`
						ExpiresAt string `json:"expires_at"`
					} `json:"request"`
				} `json:"operation_payload"`
				Authorizations []struct {
					PartyID string `json:"party_id"`
					Role    string `json:"role"`
				} `json:"authorizations"`
			}
			_ = json.Unmarshal(raw, &rec)
			if c.Expect.Structure != "valid" {
				if r.Operation != nil || r.Target != nil || r.RequestID != nil || r.ExpiresAt != nil || len(r.Parties) != 0 {
					t.Fatalf("a malformed record echoes nothing: %+v", r)
				}
			} else {
				req := rec.Payload.Request
				if r.Operation == nil || r.Target == nil || r.RequestID == nil || r.ExpiresAt == nil ||
					*r.Operation != rec.Operation || *r.Target != req.Target || *r.RequestID != req.RequestID || *r.ExpiresAt != req.ExpiresAt {
					t.Fatalf("the signed request is not echoed: %+v", r)
				}
				if len(r.Parties) != len(rec.Authorizations) {
					t.Fatalf("%d parties for %d authorizations", len(r.Parties), len(rec.Authorizations))
				}
				verified := 0
				for i, p := range r.Parties {
					if p.PartyID != rec.Authorizations[i].PartyID || p.Role != rec.Authorizations[i].Role {
						t.Fatalf("party %d is %+v", i, p)
					}
					if (p.Verified == nil) != (c.Expect.Verification == "not_evaluated") {
						t.Fatalf("party %d: verified %v under verification %s", i, p.Verified, c.Expect.Verification)
					}
					if p.Verified != nil && *p.Verified {
						verified++
					}
				}
				if c.Expect.PartiesCounted != nil && verified != *c.Expect.PartiesCounted {
					t.Fatalf("%d parties verified, %d counted", verified, *c.Expect.PartiesCounted)
				}
			}
			for _, e := range r.Errors {
				if utf8.RuneCountInString(e.Message) > 300 {
					t.Fatalf("message of %d characters", utf8.RuneCountInString(e.Message))
				}
			}
			// The JSON form keeps the names of the profile.
			encoded, _ := json.Marshal(r)
			var keys map[string]json.RawMessage
			_ = json.Unmarshal(encoded, &keys)
			want := []string{"authorized", "errors", "expires_at", "operation", "parties", "parties_counted", "policy_set_version", "profile", "request_id", "required_parties", "structure", "target", "trust_set_version", "verification"}
			got2 := make([]string, 0, len(keys))
			for k := range keys {
				got2 = append(got2, k)
			}
			slices.Sort(got2)
			if !slices.Equal(got2, want) {
				t.Fatalf("JSON members %v", got2)
			}
		})
	}
}

func TestMultiPartyPolicyConfiguration(t *testing.T) {
	for _, c := range loadMpaVectors().ConfigCases {
		t.Run(c.Name, func(t *testing.T) {
			store, err := v2.NewMultiPartyPolicyStore(c.PolicySet)
			if c.ExpectCode == nil {
				if err != nil || store == nil {
					t.Fatalf("a valid policy set does not load: %v", err)
				}
				return
			}
			var cfg *v2.MultiPartyConfigError
			if !errors.As(err, &cfg) || cfg.Code != *c.ExpectCode || store != nil {
				t.Fatalf("got %v, want %s", err, *c.ExpectCode)
			}
		})
	}
	for _, bad := range []string{``, `null`, `[]`, `"x"`, `{"policy_set_version":`} {
		var cfg *v2.MultiPartyConfigError
		if _, err := v2.NewMultiPartyPolicyStore([]byte(bad)); !errors.As(err, &cfg) || cfg.Code != "CONFIG_INVALID_VALUE" {
			t.Fatalf("%q: %v", bad, err)
		}
	}
}

func TestMultiPartyAKeyUnderTwoPartiesDoesNotLoad(t *testing.T) {
	vecs := loadMpaVectors()
	for _, c := range vecs.TrustConfigCases {
		var cfg *v2.AdmissionConfigError
		if store, err := v2.NewPrincipalTrustStore(c.TrustSet); !errors.As(err, &cfg) || cfg.Code != c.ExpectCode || store != nil {
			t.Fatalf("%s: got %v, want %s", c.Name, err, c.ExpectCode)
		}
	}
	// The evaluation takes only stores their loaders returned.
	base := mpaCaseNamed(t, "two_of_three")
	for name, change := range map[string]func(*v2.MultiPartyOptions){
		"no trust store":         func(o *v2.MultiPartyOptions) { o.Trust = nil },
		"a trust store by hand":  func(o *v2.MultiPartyOptions) { o.Trust = &v2.PrincipalTrustStore{} },
		"no policy store":        func(o *v2.MultiPartyOptions) { o.Policy = nil },
		"a policy store by hand": func(o *v2.MultiPartyOptions) { o.Policy = &v2.MultiPartyPolicyStore{} },
	} {
		opts := mpaOptions(t, base)
		change(&opts)
		var cfg *v2.MultiPartyConfigError
		if r, err := v2.EvaluateMultiPartyAuthorization(mpaRegistry(), vecs.Records[base.Record], opts); !errors.As(err, &cfg) || r != nil {
			t.Fatalf("%s: got %v, %v", name, r, err)
		}
	}
}

func TestMultiPartyVerifiesNoSignatureOfARequestRefusedEarlier(t *testing.T) {
	vecs := loadMpaVectors()
	for _, name := range []string{"seventeen_authorizations", "without_request", "another_audience", "expired", "target_the_operator_does_not_have", "same_party_twice", "self_assigned_role", "sixteen_authorizations"} {
		reg, n := countingRegistry()
		c := mpaCaseNamed(t, name)
		if r := mpaEvaluate(t, reg, c, vecs.Records[c.Record]); r.Authorized || n.Load() != 0 {
			t.Fatalf("%s: authorized %v after %d verifications", name, r.Authorized, n.Load())
		}
	}
	reg, n := countingRegistry()
	c := mpaCaseNamed(t, "two_of_three")
	if r := mpaEvaluate(t, reg, c, vecs.Records[c.Record]); !r.Authorized || n.Load() != 4 {
		t.Fatalf("authorized %v after %d verifications", r.Authorized, n.Load())
	}
}

func TestMultiPartyKeepsNoState(t *testing.T) {
	vecs := loadMpaVectors()
	c := mpaCaseNamed(t, "two_of_three")
	reg := mpaRegistry()
	opts := mpaOptions(t, c)
	var wg sync.WaitGroup
	results := make([]bool, 4)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := v2.EvaluateMultiPartyAuthorization(reg, vecs.Records[c.Record], opts)
			results[i] = err == nil && r.Authorized
		}()
	}
	wg.Wait()
	if slices.Contains(results, false) {
		t.Fatalf("the same request, evaluated four times at once: %v", results)
	}
}

func TestMultiPartyARecordThatIsNotAnObjectGetsAResult(t *testing.T) {
	c := mpaCaseNamed(t, "two_of_three")
	for _, record := range []string{``, `null`, `[]`, `"record"`, `7`, `true`, `{"type":`, `{} {}`} {
		r := mpaEvaluate(t, mpaRegistry(), c, []byte(record))
		if r.Authorized || r.Structure != "invalid" || !slices.Equal(mpaCodes(r), []string{"MPA_SCHEMA_INVALID"}) {
			t.Fatalf("%q: %+v", record, r)
		}
	}
}

func TestMultiPartyDoesNotTakeARoleFromTheRecord(t *testing.T) {
	vecs := loadMpaVectors()
	c := mpaCaseNamed(t, "required_role_missing")
	var record map[string]interface{}
	if err := json.Unmarshal(vecs.Records[c.Record], &record); err != nil {
		t.Fatal(err)
	}
	record["authorizations"].([]interface{})[0].(map[string]interface{})["role"] = "owner" // an unsigned change of role
	promoted, _ := json.Marshal(record)
	if r := mpaEvaluate(t, mpaRegistry(), c, promoted); r.Authorized || !slices.Equal(mpaCodes(r), []string{"MPA_ROLE_MISMATCH"}) {
		t.Fatalf("%+v", r)
	}
}

func TestMultiPartyARegistryWithoutOneOfTheAlgorithmsRefuses(t *testing.T) {
	vecs := loadMpaVectors()
	c := mpaCaseNamed(t, "two_of_three")
	classicalOnly := v2.NewAlgorithmRegistry()
	classicalOnly.RegisterSigner(&providers.Ed25519Provider{})
	r := mpaEvaluate(t, classicalOnly, c, vecs.Records[c.Record])
	if r.Authorized || r.Verification != "failed" || !slices.Equal(mpaCodes(r), []string{"MPA_SIGNATURE_INVALID"}) {
		t.Fatalf("%+v", r)
	}
}

func TestMultiPartyWhatTheExecutorStatesWronglyIsAnError(t *testing.T) {
	vecs := loadMpaVectors()
	c := mpaCaseNamed(t, "two_of_three")
	for name, change := range map[string]func(*v2.MultiPartyExpected){
		"an operation outside the list": func(e *v2.MultiPartyExpected) { e.Operation = "delete_everything" },
		"no target":                     func(e *v2.MultiPartyExpected) { e.Target = "" },
		"parameters not representable":  func(e *v2.MultiPartyExpected) { e.Parameters = map[string]interface{}{"ratio": 0.5} },
	} {
		opts := mpaOptions(t, c)
		change(&opts.Expected)
		var cfg *v2.MultiPartyConfigError
		if r, err := v2.EvaluateMultiPartyAuthorization(mpaRegistry(), vecs.Records[c.Record], opts); !errors.As(err, &cfg) || cfg.Code != "CONFIG_INVALID_VALUE" || r != nil {
			t.Fatalf("%s: got %v, %v", name, r, err)
		}
	}
	// No parameters at all is the empty object.
	empty := mpaCaseNamed(t, "empty_parameters")
	opts := mpaOptions(t, empty)
	opts.Expected.Parameters = nil
	if r, err := v2.EvaluateMultiPartyAuthorization(mpaRegistry(), vecs.Records[empty.Record], opts); err != nil || !r.Authorized {
		t.Fatalf("nil parameters: %v, %v", r, err)
	}
}

type mpaTestParty struct {
	id            string
	classical, pq v2.CompositeKeyInfo
	trusted       map[string]interface{}
}

func newMpaParty(t *testing.T, id string) mpaTestParty {
	t.Helper()
	c, err := (&providers.Ed25519Provider{}).GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	p, err := (&providers.MlDsa65Provider{}).GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	return mpaTestParty{
		id:        id,
		classical: v2.CompositeKeyInfo{Kid: c.Kid, Alg: "ed25519", SecretKeyB64: c.SecretKeyB64, PublicKeyB64: c.PublicKeyB64},
		pq:        v2.CompositeKeyInfo{Kid: p.Kid, Alg: "ml-dsa-65", SecretKeyB64: p.SecretKeyB64, PublicKeyB64: p.PublicKeyB64},
		trusted: map[string]interface{}{"human_id": id, "keys": []interface{}{
			map[string]interface{}{"kid": c.Kid, "alg": "ed25519", "public_key_b64": c.PublicKeyB64, "status": "active"},
			map[string]interface{}{"kid": p.Kid, "alg": "ml-dsa-65", "public_key_b64": p.PublicKeyB64, "status": "active"},
		}},
	}
}

func TestMultiPartyWhatTheSDKSignsTheSDKAuthorizes(t *testing.T) {
	reg := mpaRegistry()
	owner, admin := newMpaParty(t, "human:owner"), newMpaParty(t, "human:admin")
	now := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	payload, err := v2.NewMultiPartyRequest(v2.MultiPartyRequestInput{
		Target: "agent:signed-here", Audience: "verifier:here", Parameters: map[string]interface{}{"reason": "administrative"}, IssuedAt: now, ValiditySeconds: 600,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := payload["request"].(map[string]interface{})
	id, _ := request["request_id"].(string)
	if request["profile"] != "mpa-v1" || request["target"] != "agent:signed-here" || request["audience"] != "verifier:here" ||
		request["issued_at"] != "2026-11-18T12:00:00.000Z" || request["expires_at"] != "2026-11-18T12:10:00.000Z" ||
		!regexp.MustCompile(`^mpa:[0-9a-f]{32}$`).MatchString(id) {
		t.Fatalf("request %v", request)
	}
	other, err := v2.NewMultiPartyRequest(v2.MultiPartyRequestInput{Target: "a", Audience: "b", ValiditySeconds: 1})
	if err != nil || other["request"].(map[string]interface{})["request_id"] == id {
		t.Fatalf("a second request: %v, %v", other, err)
	}

	var authorizations []map[string]interface{}
	for _, p := range []struct {
		party mpaTestParty
		role  string
	}{{owner, "owner"}, {admin, "org_admin"}} {
		a, err := v2.CreatePartyAuthorization(reg, "revoke_agent", payload, p.party.id, p.role, p.party.classical, p.party.pq)
		if err != nil {
			t.Fatal(err)
		}
		authorizations = append(authorizations, a)
	}
	record := v2.BuildMultiPartyAuthorization("revoke_agent", payload, authorizations, 0)
	if record["required_parties"] != 2 {
		t.Fatalf("required_parties %v", record["required_parties"])
	}
	recordJSON, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	policyJSON, _ := json.Marshal(map[string]interface{}{
		"policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
		"subjects": []interface{}{map[string]interface{}{
			"target":     "agent:signed-here",
			"parties":    []interface{}{map[string]interface{}{"party_id": owner.id, "role": "owner"}, map[string]interface{}{"party_id": admin.id, "role": "org_admin"}},
			"operations": map[string]interface{}{"revoke_agent": map[string]interface{}{"required_parties": 2, "allowed_roles": []string{"owner", "org_admin"}, "required_roles": []string{"owner"}}},
		}},
	})
	trustJSON, _ := json.Marshal(map[string]interface{}{"trust_set_version": "here.1", "principals": []interface{}{owner.trusted, admin.trusted}})
	policy, err := v2.NewMultiPartyPolicyStore(policyJSON)
	if err != nil {
		t.Fatal(err)
	}
	trust, err := v2.NewPrincipalTrustStore(trustJSON)
	if err != nil {
		t.Fatal(err)
	}
	r, err := v2.EvaluateMultiPartyAuthorization(reg, recordJSON, v2.MultiPartyOptions{
		Policy: policy, Trust: trust, Now: now.Add(time.Second),
		Expected: v2.MultiPartyExpected{Operation: "revoke_agent", Target: "agent:signed-here", Parameters: map[string]interface{}{"reason": "administrative"}},
	})
	if err != nil || len(r.Errors) != 0 || !r.Authorized || r.PartiesCounted == nil || *r.PartiesCounted != 2 || r.RequestID == nil || *r.RequestID != id {
		t.Fatalf("%+v, %v", r, err)
	}
	if policy.Version() != "here.1" || policy.Audience() != "verifier:here" || policy.MaxValiditySeconds() != 600 {
		t.Fatalf("policy store accessors: %q %q %d", policy.Version(), policy.Audience(), policy.MaxValiditySeconds())
	}
	// The structure of the same record says nothing about who signed.
	var generic map[string]interface{}
	_ = json.Unmarshal(recordJSON, &generic)
	if check := v2.CheckMultiPartyAuthorizationStructure(generic, nil); !check.Valid {
		t.Fatalf("structure: %v", check.Errors)
	}
}

// mpaSetting is two parties of one target, the operator's stores for them, and a signer of any payload.
type mpaSetting struct {
	reg          *v2.AlgorithmRegistry
	now          time.Time
	owner, admin mpaTestParty
	policy       *v2.MultiPartyPolicyStore
	trust        *v2.PrincipalTrustStore
}

func newMpaSetting(t *testing.T) mpaSetting {
	t.Helper()
	owner, admin := newMpaParty(t, "human:owner"), newMpaParty(t, "human:admin")
	policyJSON, _ := json.Marshal(map[string]interface{}{
		"policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
		"subjects": []interface{}{map[string]interface{}{
			"target":     "agent:signed-here",
			"parties":    []interface{}{map[string]interface{}{"party_id": owner.id, "role": "owner"}, map[string]interface{}{"party_id": admin.id, "role": "org_admin"}},
			"operations": map[string]interface{}{"revoke_agent": map[string]interface{}{"required_parties": 2, "allowed_roles": []string{"owner", "org_admin"}, "required_roles": []string{"owner"}}},
		}},
	})
	trustJSON, _ := json.Marshal(map[string]interface{}{"trust_set_version": "here.1", "principals": []interface{}{owner.trusted, admin.trusted}})
	policy, err := v2.NewMultiPartyPolicyStore(policyJSON)
	if err != nil {
		t.Fatal(err)
	}
	trust, err := v2.NewPrincipalTrustStore(trustJSON)
	if err != nil {
		t.Fatal(err)
	}
	return mpaSetting{reg: mpaRegistry(), now: time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC), owner: owner, admin: admin, policy: policy, trust: trust}
}

func (s mpaSetting) request(parameters map[string]interface{}) (map[string]interface{}, error) {
	return v2.NewMultiPartyRequest(v2.MultiPartyRequestInput{Target: "agent:signed-here", Audience: "verifier:here", Parameters: parameters, IssuedAt: s.now, ValiditySeconds: 600})
}

// signedOver is a record whose two parties signed payload, whatever it holds: the signer signs what it is given.
func (s mpaSetting) signedOver(t *testing.T, payload map[string]interface{}) []byte {
	t.Helper()
	var authorizations []map[string]interface{}
	for _, p := range []struct {
		party mpaTestParty
		role  string
	}{{s.owner, "owner"}, {s.admin, "org_admin"}} {
		a, err := v2.CreatePartyAuthorization(s.reg, "revoke_agent", payload, p.party.id, p.role, p.party.classical, p.party.pq)
		if err != nil {
			t.Fatal(err)
		}
		authorizations = append(authorizations, a)
	}
	recordJSON, err := json.Marshal(v2.BuildMultiPartyAuthorization("revoke_agent", payload, authorizations, 0))
	if err != nil {
		t.Fatal(err)
	}
	return recordJSON
}

func (s mpaSetting) evaluate(record []byte, parameters map[string]interface{}) (*v2.MultiPartyEvaluation, error) {
	return v2.EvaluateMultiPartyAuthorization(s.reg, record, v2.MultiPartyOptions{
		Policy: s.policy, Trust: s.trust, Now: s.now.Add(time.Second),
		Expected: v2.MultiPartyExpected{Operation: "revoke_agent", Target: "agent:signed-here", Parameters: parameters},
	})
}

func mpaNotRepresentable(r *v2.MultiPartyEvaluation, err error) bool {
	return err == nil && !r.Authorized && r.Structure == "invalid" && r.Verification == "not_evaluated" && reflect.DeepEqual(mpaCodes(r), []string{"MPA_NOT_REPRESENTABLE"})
}

func mpaInvalidValue(err error) bool {
	var cfg *v2.MultiPartyConfigError
	return errors.As(err, &cfg) && cfg.Code == "CONFIG_INVALID_VALUE"
}

func TestMultiPartyTakesTheIntegersABinary64HoldsExactlyAndNoOtherNumber(t *testing.T) {
	s := newMpaSetting(t)
	request, evaluate, notRepresentable := s.request, s.evaluate, mpaNotRepresentable
	signedOver := func(payload map[string]interface{}) []byte { return s.signedOver(t, payload) }

	// The largest integers of the profile are built, signed, stated and authorized.
	const largest = int64(1)<<53 - 1
	within := map[string]interface{}{"ceiling": largest, "floor": -largest}
	atTheLimit, err := request(within)
	if err != nil {
		t.Fatal(err)
	}
	if r, err := evaluate(signedOver(atTheLimit), within); err != nil || !r.Authorized || len(r.Errors) != 0 {
		t.Fatalf("the largest integers: %+v, %v", r, err)
	}

	for name, parameters := range map[string]map[string]interface{}{
		"2^53":                    {"amount": largest + 1},
		"-(2^53)":                 {"amount": -largest - 1},
		"an identifier in uint64": {"new_key_id": uint64(1234567890123456789)},
		"10^21 as a float64":      {"amount": 1e21},
		"2^53 as a float64":       {"amount": float64(largest + 1)},
		"2^53 as a json.Number":   {"amount": json.Number("9007199254740992")},
		"2^53 inside an array":    {"limits": []interface{}{1, map[string]interface{}{"amount": largest + 1}}},
	} {
		var cfg *v2.MultiPartyConfigError
		// One more is not a request the SDK builds...
		if payload, err := request(parameters); !errors.As(err, &cfg) || cfg.Code != "CONFIG_INVALID_VALUE" || payload != nil {
			t.Fatalf("%s, built: %v, %v", name, payload, err)
		}
		// ...nor parameters an executor can state...
		cfg = nil
		if r, err := evaluate(signedOver(atTheLimit), parameters); !errors.As(err, &cfg) || cfg.Code != "CONFIG_INVALID_VALUE" || r != nil {
			t.Fatalf("%s, stated: %+v, %v", name, r, err)
		}
		// ...and a record that holds one decides nothing, whoever signed it: 2^53 and 2^53 + 1 are one number
		// to whoever reads JSON numbers as binary64, so a signature over one would stand for the other.
		over := signedOver(map[string]interface{}{"request": atTheLimit["request"], "parameters": parameters})
		if r, err := evaluate(over, within); !notRepresentable(r, err) {
			t.Fatalf("%s, in a record: %+v, %v", name, r, err)
		}
	}
	// The digits of the record are what is judged: 2^53 + 1 written where 2^53 - 1 was signed.
	rewritten := bytes.Replace(signedOver(atTheLimit), []byte(`"ceiling":9007199254740991`), []byte(`"ceiling":9007199254740993`), 1)
	if !bytes.Contains(rewritten, []byte("9007199254740993")) {
		t.Fatal("the record was not rewritten")
	}
	if r, err := evaluate(rewritten, within); !notRepresentable(r, err) {
		t.Fatalf("a record rewritten to 2^53 + 1: %+v, %v", r, err)
	}
}

func TestMultiPartyTakesWellFormedTextOnly(t *testing.T) {
	s := newMpaSetting(t)
	// The control: a character outside the BMP is text like any other, written as it is or as an escaped pair.
	paired := map[string]interface{}{"note": "key \U0001F511"}
	withPair, err := s.request(paired)
	if err != nil {
		t.Fatal(err)
	}
	control := s.signedOver(t, withPair)
	escaped := bytes.Replace(control, []byte("\U0001F511"), []byte(`\ud83d\udd11`), 1)
	if bytes.Equal(control, escaped) {
		t.Fatal("the pair was not escaped")
	}
	for name, record := range map[string][]byte{"as it is": control, "as an escaped pair": escaped} {
		if r, err := s.evaluate(record, paired); err != nil || !r.Authorized || len(r.Errors) != 0 {
			t.Fatalf("a character outside the BMP, %s: %+v, %v", name, r, err)
		}
	}
	// U+FFFD itself is a character: signed, stated and authorized, also written as its escape.
	replacement := map[string]interface{}{"path": "keys/\uFFFD"}
	withReplacement, err := s.request(replacement)
	if err != nil {
		t.Fatal(err)
	}
	signed := s.signedOver(t, withReplacement)
	for name, record := range map[string][]byte{"as it is": signed, "as its escape": bytes.Replace(signed, []byte("\uFFFD"), []byte(`\ufffd`), 1)} {
		if r, err := s.evaluate(record, replacement); err != nil || !r.Authorized {
			t.Fatalf("U+FFFD, %s: %+v, %v", name, r, err)
		}
	}

	plainParameters := map[string]interface{}{"path": "keys/a"}
	plain, err := s.request(plainParameters)
	if err != nil {
		t.Fatal(err)
	}
	// What a caller states in Go is a string of bytes. One that is not UTF-8 is not text: encoding/json would write
	// U+FFFD in its place, and "keys/\xff" would be authorized by parties that signed "keys/\uFFFD".
	for name, parameters := range map[string]map[string]interface{}{
		"a byte that is not UTF-8":     {"path": "keys/\xff"},
		"an overlong encoding":         {"path": "keys/\xc0\xaf"},
		"a surrogate encoded as UTF-8": {"path": "keys/\xed\xa0\x80"},
		"in a member name":             {"k\xff": 1},
		"inside an array":              {"paths": []interface{}{"a", map[string]interface{}{"deep": "\xff"}}},
	} {
		if payload, err := s.request(parameters); !mpaInvalidValue(err) || payload != nil {
			t.Fatalf("%s, built: %v, %v", name, payload, err)
		}
		if r, err := s.evaluate(signed, parameters); !mpaInvalidValue(err) || r != nil {
			t.Fatalf("%s, stated: %+v, %v", name, r, err)
		}
	}
	for name, in := range map[string]v2.MultiPartyRequestInput{
		"target":     {Target: "agent:\xff", Audience: "verifier:here", ValiditySeconds: 600},
		"audience":   {Target: "agent:signed-here", Audience: "verifier:\xff", ValiditySeconds: 600},
		"request id": {Target: "agent:signed-here", Audience: "verifier:here", ValiditySeconds: 600, RequestID: "mpa:\xff"},
	} {
		if payload, err := v2.NewMultiPartyRequest(in); !mpaInvalidValue(err) || payload != nil {
			t.Fatalf("%s that is not UTF-8, built: %v, %v", name, payload, err)
		}
	}
	if r, err := v2.EvaluateMultiPartyAuthorization(s.reg, s.signedOver(t, plain), v2.MultiPartyOptions{
		Policy: s.policy, Trust: s.trust, Now: s.now.Add(time.Second),
		Expected: v2.MultiPartyExpected{Operation: "revoke_agent", Target: "agent:\xff", Parameters: plainParameters},
	}); !mpaInvalidValue(err) || r != nil {
		t.Fatalf("a target that is not UTF-8, stated: %+v, %v", r, err)
	}

	// A record is JSON text. Half a pair as an escape, or bytes that are not UTF-8, inside operation_payload: this
	// decoder would read U+FFFD, another SDK cannot read it at all, so it is not a record of the profile.
	record := s.signedOver(t, plain)
	for name, change := range map[string][2]string{
		"a high surrogate alone":                    {`"path":"keys/a"`, `"path":"keys/\ud800"`},
		"a low surrogate alone":                     {`"path":"keys/a"`, `"path":"\udc00keys"`},
		"a pair the wrong way round":                {`"path":"keys/a"`, `"path":"\udc00\ud800"`},
		"a high surrogate before another escape":    {`"path":"keys/a"`, `"path":"\ud800\n"`},
		"a high surrogate before an escaped letter": {`"path":"keys/a"`, `"path":"\ud800\u0041"`},
		"two high surrogates":                       {`"path":"keys/a"`, `"path":"\ud83d\ud83d"`},
		"a high surrogate at the end":               {`"path":"keys/a"`, `"path":"keys/\uD83D"`},
		"in a member name":                          {`"path":"keys/a"`, `"k\ud83d":"keys/a"`},
		"bytes that are not UTF-8":                  {`"path":"keys/a"`, "\"path\":\"keys/\xff\""},
		"in the target of the request":              {`"target":"agent:signed-here"`, `"target":"agent:\ud800"`},
	} {
		rewritten := bytes.Replace(record, []byte(change[0]), []byte(change[1]), 1)
		if bytes.Equal(record, rewritten) {
			t.Fatalf("%s: the record was not rewritten", name)
		}
		if r, err := s.evaluate(rewritten, plainParameters); !mpaNotRepresentable(r, err) {
			t.Fatalf("%s, in a record: %+v, %v", name, r, err)
		}
	}
	// Outside operation_payload nothing changes: a party the policy does not have is unknown, however it is spelled.
	elsewhere := bytes.Replace(record, []byte(`"party_id":"human:admin"`), []byte(`"party_id":"human:\ud800"`), 1)
	if r, err := s.evaluate(elsewhere, plainParameters); err != nil || r.Authorized || !reflect.DeepEqual(mpaCodes(r), []string{"MPA_PARTY_UNKNOWN"}) {
		t.Fatalf("an unpaired surrogate in a party_id: %+v, %v", r, err)
	}
}

func TestMultiPartyBoundsHowDeepThePayloadNests(t *testing.T) {
	s := newMpaSetting(t)
	nested := func(levels int) interface{} {
		var value interface{} = 1
		for i := 0; i < levels; i++ {
			if i%2 == 1 {
				value = []interface{}{value}
			} else {
				value = map[string]interface{}{"in": value}
			}
		}
		return value
	}
	// operation_payload is the first of 32 levels and parameters the second, so a member of it may nest 30 more.
	deepest := map[string]interface{}{"limits": nested(30)}
	atTheLimit, err := s.request(deepest)
	if err != nil {
		t.Fatal(err)
	}
	if r, err := s.evaluate(s.signedOver(t, atTheLimit), deepest); err != nil || !r.Authorized || len(r.Errors) != 0 {
		t.Fatalf("32 levels: %+v, %v", r, err)
	}
	deeper := map[string]interface{}{"limits": nested(31)}
	if payload, err := s.request(deeper); !mpaInvalidValue(err) || payload != nil {
		t.Fatalf("33 levels, built: %v, %v", payload, err)
	}
	if r, err := s.evaluate(s.signedOver(t, atTheLimit), deeper); !mpaInvalidValue(err) || r != nil {
		t.Fatalf("33 levels, stated: %+v, %v", r, err)
	}
	over := s.signedOver(t, map[string]interface{}{"request": atTheLimit["request"], "parameters": deeper})
	if r, err := s.evaluate(over, deepest); !mpaNotRepresentable(r, err) {
		t.Fatalf("33 levels, in a record: %+v, %v", r, err)
	}
}

func TestMultiPartyARequiredPartiesNoBinary64HoldsIsNotAnIntegerOfTheSchema(t *testing.T) {
	c := mpaCaseNamed(t, "two_of_three")
	var compact bytes.Buffer
	if err := json.Compact(&compact, loadMpaVectors().Records[c.Record]); err != nil {
		t.Fatal(err)
	}
	record := compact.Bytes()
	digits := bytes.Repeat([]byte("9"), 400)
	rewritten := bytes.Replace(record, []byte(`"required_parties":2`), append([]byte(`"required_parties":`), digits...), 1)
	if !bytes.Contains(rewritten, digits) {
		t.Fatal("the record was not rewritten")
	}
	r := mpaEvaluate(t, mpaRegistry(), c, rewritten)
	if r.Authorized || r.Structure != "invalid" || !reflect.DeepEqual(mpaCodes(r), []string{"MPA_SCHEMA_INVALID"}) {
		t.Fatalf("%+v", r)
	}
}

func TestMultiPartyWithoutARegistryIsAnErrorNotAPanic(t *testing.T) {
	s := newMpaSetting(t)
	payload, err := s.request(nil)
	if err != nil {
		t.Fatal(err)
	}
	record := s.signedOver(t, payload)
	r, err := v2.EvaluateMultiPartyAuthorization(nil, record, v2.MultiPartyOptions{
		Policy: s.policy, Trust: s.trust, Now: s.now.Add(time.Second),
		Expected: v2.MultiPartyExpected{Operation: "revoke_agent", Target: "agent:signed-here"},
	})
	if !mpaInvalidValue(err) || r != nil {
		t.Fatalf("evaluated without a registry: %+v, %v", r, err)
	}
	if a, err := v2.CreatePartyAuthorization(nil, "revoke_agent", payload, s.owner.id, "owner", s.owner.classical, s.owner.pq); err == nil || a != nil {
		t.Fatalf("signed without a registry: %v, %v", a, err)
	}
}

func TestMultiPartyReadsTheClockInMillisecondsAsTheOtherSDKsDo(t *testing.T) {
	s := newMpaSetting(t)
	payload, err := s.request(nil)
	if err != nil {
		t.Fatal(err)
	}
	record := s.signedOver(t, payload)
	// The owner's classical key expires at an exact millisecond. Half a millisecond later is, in milliseconds, that
	// same instant, and a key is expired only when its expiry is before now.
	expiry := s.now.Add(time.Second)
	keys := s.owner.trusted["keys"].([]interface{})
	classical := maps.Clone(keys[0].(map[string]interface{}))
	classical["expires_at"] = expiry.Format("2006-01-02T15:04:05.000Z")
	trustJSON, _ := json.Marshal(map[string]interface{}{"trust_set_version": "here.2", "principals": []interface{}{
		map[string]interface{}{"human_id": s.owner.id, "keys": []interface{}{classical, keys[1]}}, s.admin.trusted,
	}})
	trust, err := v2.NewPrincipalTrustStore(trustJSON)
	if err != nil {
		t.Fatal(err)
	}
	at := func(now time.Time) *v2.MultiPartyEvaluation {
		r, err := v2.EvaluateMultiPartyAuthorization(s.reg, record, v2.MultiPartyOptions{
			Policy: s.policy, Trust: trust, Now: now, Expected: v2.MultiPartyExpected{Operation: "revoke_agent", Target: "agent:signed-here"},
		})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	if r := at(expiry.Add(500 * time.Microsecond)); !r.Authorized {
		t.Fatalf("half a millisecond after the key's expiry: %+v", r)
	}
	if r := at(expiry.Add(time.Millisecond)); r.Authorized || !reflect.DeepEqual(mpaCodes(r), []string{"MPA_KEY_EXPIRED"}) {
		t.Fatalf("a millisecond after the key's expiry: %+v", r)
	}
}

func TestMultiPartyRefusesToBuildARequestTheProfileWouldNotAccept(t *testing.T) {
	base := v2.MultiPartyRequestInput{Target: "agent:x", Audience: "verifier:y", ValiditySeconds: 60}
	for name, change := range map[string]func(*v2.MultiPartyRequestInput){
		"no target":                    func(in *v2.MultiPartyRequestInput) { in.Target = "" },
		"an audience too long":         func(in *v2.MultiPartyRequestInput) { in.Audience = string(bytes.Repeat([]byte("a"), 257)) },
		"no validity":                  func(in *v2.MultiPartyRequestInput) { in.ValiditySeconds = 0 },
		"a validity over a day":        func(in *v2.MultiPartyRequestInput) { in.ValiditySeconds = 86_401 },
		"a request_id too long":        func(in *v2.MultiPartyRequestInput) { in.RequestID = string(bytes.Repeat([]byte("a"), 129)) },
		"parameters not representable": func(in *v2.MultiPartyRequestInput) { in.Parameters = map[string]interface{}{"ratio": 0.5} },
	} {
		in := base
		change(&in)
		var cfg *v2.MultiPartyConfigError
		if payload, err := v2.NewMultiPartyRequest(in); !errors.As(err, &cfg) || cfg.Code != "CONFIG_INVALID_VALUE" || payload != nil {
			t.Fatalf("%s: got %v, %v", name, payload, err)
		}
		if cfg.Message == "" || cfg.Error() != "CONFIG_INVALID_VALUE: "+cfg.Message {
			t.Fatalf("%s: the error reads %q", name, cfg.Error())
		}
	}
}

func TestMultiPartyWithNoClockGivenTheSystemClockDecides(t *testing.T) {
	reg := mpaRegistry()
	owner, admin := newMpaParty(t, "human:owner"), newMpaParty(t, "human:admin")
	policyJSON, _ := json.Marshal(map[string]interface{}{
		"policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
		"subjects": []interface{}{map[string]interface{}{
			"target":     "agent:signed-here",
			"parties":    []interface{}{map[string]interface{}{"party_id": owner.id, "role": "owner"}, map[string]interface{}{"party_id": admin.id, "role": "org_admin"}},
			"operations": map[string]interface{}{"revoke_agent": map[string]interface{}{"required_parties": 2, "allowed_roles": []string{"owner", "org_admin"}, "required_roles": []string{"owner"}}},
		}},
	})
	trustJSON, _ := json.Marshal(map[string]interface{}{"trust_set_version": "here.1", "principals": []interface{}{owner.trusted, admin.trusted}})
	policy, err := v2.NewMultiPartyPolicyStore(policyJSON)
	if err != nil {
		t.Fatal(err)
	}
	trust, err := v2.NewPrincipalTrustStore(trustJSON)
	if err != nil {
		t.Fatal(err)
	}
	evaluated := func(issuedAt time.Time) *v2.MultiPartyEvaluation {
		t.Helper()
		payload, err := v2.NewMultiPartyRequest(v2.MultiPartyRequestInput{Target: "agent:signed-here", Audience: "verifier:here", IssuedAt: issuedAt, ValiditySeconds: 60})
		if err != nil {
			t.Fatal(err)
		}
		var authorizations []map[string]interface{}
		for _, p := range []struct {
			party mpaTestParty
			role  string
		}{{owner, "owner"}, {admin, "org_admin"}} {
			a, err := v2.CreatePartyAuthorization(reg, "revoke_agent", payload, p.party.id, p.role, p.party.classical, p.party.pq)
			if err != nil {
				t.Fatal(err)
			}
			authorizations = append(authorizations, a)
		}
		recordJSON, err := json.Marshal(v2.BuildMultiPartyAuthorization("revoke_agent", payload, authorizations, 0))
		if err != nil {
			t.Fatal(err)
		}
		r, err := v2.EvaluateMultiPartyAuthorization(reg, recordJSON, v2.MultiPartyOptions{
			Policy: policy, Trust: trust, Expected: v2.MultiPartyExpected{Operation: "revoke_agent", Target: "agent:signed-here"},
		})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	// Issued by the builder's clock and read by the evaluator's: in force.
	if fresh := evaluated(time.Time{}); !fresh.Authorized || len(fresh.Errors) != 0 {
		t.Fatalf("a request issued now: %+v", fresh)
	}
	// Issued an hour ago for a minute: over.
	if stale := evaluated(time.Now().Add(-time.Hour)); stale.Authorized || !reflect.DeepEqual(mpaCodes(stale), []string{"MPA_EXPIRED"}) {
		t.Fatalf("a request that ended an hour ago: %+v", stale)
	}
}

func TestMultiPartyAPartySignsNothingItCannotSign(t *testing.T) {
	reg := mpaRegistry()
	party := newMpaParty(t, "human:owner")
	// A payload dcp-jcs-v1 cannot represent.
	if a, err := v2.CreatePartyAuthorization(reg, "revoke_agent", map[string]interface{}{"ratio": 0.5}, party.id, "owner", party.classical, party.pq); err == nil || a != nil {
		t.Fatalf("a payload that is not representable: %v, %v", a, err)
	}
	// A secret key that is not one.
	broken := party.classical
	broken.SecretKeyB64 = "AAAA"
	if a, err := v2.CreatePartyAuthorization(reg, "revoke_agent", map[string]interface{}{}, party.id, "owner", broken, party.pq); err == nil || a != nil {
		t.Fatalf("a key that is not one: %v, %v", a, err)
	}
}

func TestMultiPartyTheStructuralCheckIsNotAnAuthorization(t *testing.T) {
	unsigned := func(id, role string) map[string]interface{} {
		return map[string]interface{}{"party_id": id, "role": role, "composite_sig": map[string]interface{}{"classical": map[string]interface{}{"alg": "ed25519", "kid": "00000000000000000000000000000000", "sig_b64": "AAAAAAAAAAA="}, "pq": nil, "binding": "classical_only"}}
	}
	record := map[string]interface{}{
		"type": "multi_party_authorization", "operation": "revoke_agent", "operation_payload": map[string]interface{}{}, "required_parties": 2,
		"authorizations": []interface{}{unsigned("anyone", "owner"), unsigned("anyone", "owner")},
	}
	// Signed by no one, and it is "valid": the check is about the shape.
	checked := v2.CheckMultiPartyAuthorizationStructure(record, nil)
	if !checked.Valid || len(checked.Errors) != 0 {
		t.Fatalf("%+v", checked)
	}
	// The old name gives the same answer.
	if old := v2.VerifyMultiPartyAuthorization(record, nil); !reflect.DeepEqual(old, checked) { //nolint:staticcheck // the deprecated name, on purpose
		t.Fatalf("%+v", old)
	}
	record["authorizations"] = []interface{}{unsigned("a", "org_admin")}
	short := v2.CheckMultiPartyAuthorizationStructure(record, nil)
	if short.Valid || !reflect.DeepEqual(short, v2.VerifyMultiPartyAuthorization(record, nil)) { //nolint:staticcheck // the deprecated name, on purpose
		t.Fatalf("%+v", short)
	}
}
