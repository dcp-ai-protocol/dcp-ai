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
