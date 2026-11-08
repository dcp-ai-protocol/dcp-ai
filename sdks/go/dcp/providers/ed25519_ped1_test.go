package providers_test

// P-ED-1 (MP-02 F5c): the frozen vectors of tests/interop/v2/ed25519_ped1_vectors.json through the public paths of the
// Go SDK. Every expectation comes from the corpus, the predicates of an independent review model; none from the SDK.
// Design: docs/reviews/mp02-ed25519-implementation-design.md v0.2.4, §§ 4–6.
//
//   - historical (26) and signatures (41): Ed25519Provider.Verify, the V2 provider. A wrong key length is the provider's
//     exact error; a wrong signature length is false with no error, as crypto/ed25519 (§ 4);
//   - encodings (52): the helper, IsCanonicalEncoding and IsSmallOrderEncoding;
//   - objects (4): dcp.VerifyObject, the V1 path, after checking that dcp.Canonicalize gives the corpus bytes;
//   - composite (2): v2.CompositeSign over the exact DSM, with a classical test provider that returns the corpus
//     signature only for those bytes and a fresh ML-DSA-65 key, then v2.CompositeVerify with the real providers.
//
// A canonical encoding that does not decode (the corpus a_encoding of public-key-not-on-curve) is crypto/ed25519's
// rejection, not the byte guard's.

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"
	"testing"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"
	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/internal/ed25519ped1"
	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

const ped1Frozen = "f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396"

type ped1Case struct {
	ID           string   `json:"id"`
	PublicKeyHex string   `json:"public_key_hex"`
	SignatureHex string   `json:"signature_hex"`
	MessageHex   string   `json:"message_hex"`
	Accept       bool     `json:"accept"`
	Kind         string   `json:"kind"`
	Failing      []string `json:"failing"`
	SBelowL      bool     `json:"s_below_l"`
	ACanonical   bool     `json:"a_canonical"`
	RCanonical   bool     `json:"r_canonical"`
	ASmallOrder  bool     `json:"a_small_order"`
	RSmallOrder  bool     `json:"r_small_order"`
}

type ped1Vectors struct {
	Constants struct {
		SmallOrderEncodingsHex []string `json:"small_order_encodings_hex"`
	} `json:"constants"`
	Historical []ped1Case `json:"historical"`
	Encodings  []struct {
		ID            string `json:"id"`
		EncodingHex   string `json:"encoding_hex"`
		CanonicalRule bool   `json:"canonical_rule"`
		SmallOrder    *bool  `json:"small_order"`
	} `json:"encodings"`
	Signatures []ped1Case `json:"signatures"`
	Objects    struct {
		Object       map[string]interface{} `json:"object"`
		CanonicalHex string                 `json:"canonical_hex"`
		Cases        []ped1Case             `json:"cases"`
	} `json:"objects"`
	Composite struct {
		Context          string     `json:"context"`
		PayloadCanonical string     `json:"payload_canonical"`
		DsmHex           string     `json:"dsm_hex"`
		Cases            []ped1Case `json:"cases"`
	} `json:"composite"`
}

func loadPED1(t *testing.T) *ped1Vectors {
	t.Helper()
	raw, err := os.ReadFile("../../../../tests/interop/v2/ed25519_ped1_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256(raw); hex.EncodeToString(sum[:]) != ped1Frozen {
		t.Fatalf("the corpus is not the frozen one")
	}
	var v ped1Vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return &v
}

func unhex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func parts(t *testing.T, c ped1Case) (msg, sig, pk []byte) {
	return unhex(t, c.MessageHex), unhex(t, c.SignatureHex), unhex(t, c.PublicKeyHex)
}

func named(t *testing.T, v *ped1Vectors, id string) ped1Case {
	t.Helper()
	all := append(append(append(append([]ped1Case{}, v.Historical...), v.Signatures...), v.Objects.Cases...), v.Composite.Cases...)
	for _, c := range all {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("no case %s", id)
	return ped1Case{}
}

var ped1L, _ = new(big.Int).SetString("7237005577332262213973186563042994240857116359379907606001950938285454250989", 10)

func withScalar(sig []byte, s *big.Int) []byte {
	be := s.FillBytes(make([]byte, 32))
	out := append([]byte{}, sig[:32]...)
	for i := 31; i >= 0; i-- {
		out = append(out, be[i])
	}
	return out
}

func scalarOf(sig []byte) *big.Int {
	be := make([]byte, 32)
	for i := 0; i < 32; i++ {
		be[i] = sig[63-i]
	}
	return new(big.Int).SetBytes(be)
}

func TestPED1Corpus(t *testing.T) {
	v := loadPED1(t)
	got := []int{len(v.Historical), len(v.Encodings), len(v.Signatures), len(v.Objects.Cases), len(v.Composite.Cases)}
	if fmt.Sprint(got) != fmt.Sprint([]int{26, 52, 41, 4, 2}) {
		t.Fatalf("counts %v", got)
	}
}

func TestPED1Provider(t *testing.T) {
	v := loadPED1(t)
	cases := append(append([]ped1Case{}, v.Historical...), v.Signatures...)
	if len(cases) != 67 {
		t.Fatalf("%d cases", len(cases))
	}
	ed := &providers.Ed25519Provider{}
	for _, c := range cases {
		t.Run(c.ID, func(t *testing.T) {
			msg, sig, pk := parts(t, c)
			ok, err := ed.Verify(msg, sig, b64(pk))
			switch {
			case c.Kind == "length" && len(pk) != 32:
				want := fmt.Sprintf("invalid public key length: got %d, want 32", len(pk))
				if ok || err == nil || err.Error() != want {
					t.Fatalf("got %v, %v; want false and %q", ok, err, want)
				}
			case c.Kind == "length":
				if ok || err != nil || c.Accept {
					t.Fatalf("a %d-byte signature: got %v, %v; want false, nil", len(sig), ok, err)
				}
			default:
				if err != nil || ok != c.Accept {
					t.Fatalf("got %v, %v; want %v (%s %v)", ok, err, c.Accept, c.Kind, c.Failing)
				}
			}
		})
	}
}

func TestPED1MixedOrderPointsAreAccepted(t *testing.T) {
	v := loadPED1(t)
	ed := &providers.Ed25519Provider{}
	for _, id := range []string{"signature/public-key-mixed-order-k-multiple-of-8", "signature/ped1-mixed-a-and-r-cancel-reduced"} {
		c := named(t, v, id)
		msg, sig, pk := parts(t, c)
		if ok, err := ed.Verify(msg, sig, b64(pk)); !c.Accept || !ok || err != nil {
			t.Fatalf("%s: got %v, %v; P-ED-1 does not require torsion-free points", id, ok, err)
		}
	}
}

func TestPED1Helper(t *testing.T) {
	v := loadPED1(t)
	if fmt.Sprint(ed25519ped1.SmallOrderEncodingsHex[:]) != fmt.Sprint(v.Constants.SmallOrderEncodingsHex) {
		t.Fatal("the table is not the corpus E[8]")
	}
	for _, e := range v.Encodings {
		b := unhex(t, e.EncodingHex)
		// The corpus small_order is about the decoded point; the helper compares bytes after the canonical check.
		inTable := e.CanonicalRule && e.SmallOrder != nil && *e.SmallOrder
		if ed25519ped1.IsCanonicalEncoding(b) != e.CanonicalRule || ed25519ped1.IsSmallOrderEncoding(b) != inTable {
			t.Errorf("%s: canonical %v, in table %v", e.ID, ed25519ped1.IsCanonicalEncoding(b), ed25519ped1.IsSmallOrderEncoding(b))
		}
	}
	for _, n := range []int{0, 31, 33} {
		if ed25519ped1.IsCanonicalEncoding(make([]byte, n)) || ed25519ped1.IsSmallOrderEncoding(make([]byte, n)) {
			t.Errorf("a %d-byte encoding", n)
		}
	}
}

func TestPED1ScalarBelowLAlone(t *testing.T) {
	sig := func(s *big.Int) []byte { return withScalar(make([]byte, 64), s) }
	one := big.NewInt(1)
	two256m1 := new(big.Int).Sub(new(big.Int).Lsh(one, 256), one)
	for _, s := range []*big.Int{big.NewInt(0), new(big.Int).Sub(ped1L, one)} {
		if !ed25519ped1.ScalarBelowL(sig(s)) {
			t.Errorf("S = %v is below L", s)
		}
	}
	for _, s := range []*big.Int{ped1L, new(big.Int).Add(ped1L, one), new(big.Int).Add(ped1L, new(big.Int).Lsh(one, 248)), two256m1} {
		if ed25519ped1.ScalarBelowL(sig(s)) {
			t.Errorf("S = %v is not below L", s)
		}
	}
	if ed25519ped1.ScalarBelowL(make([]byte, 63)) {
		t.Error("a 63-byte signature")
	}
}

func TestPED1RejectsDirect(t *testing.T) {
	v := loadPED1(t)
	for _, c := range append(append([]ped1Case{}, v.Historical...), v.Signatures...) {
		_, sig, pk := parts(t, c)
		want := c.Kind != "length" && (!c.SBelowL || !c.ACanonical || !c.RCanonical || c.ASmallOrder || c.RSmallOrder)
		if ed25519ped1.Rejects(sig, pk) != want {
			t.Errorf("%s: Rejects %v, want %v", c.ID, !want, want)
		}
	}
}

func TestPED1V1Objects(t *testing.T) {
	v := loadPED1(t)
	canon, err := dcp.Canonicalize(v.Objects.Object)
	if err != nil || hex.EncodeToString([]byte(canon)) != v.Objects.CanonicalHex {
		t.Fatalf("Canonicalize: %q, %v", canon, err)
	}
	for _, c := range v.Objects.Cases {
		if c.MessageHex != v.Objects.CanonicalHex {
			t.Fatalf("%s: not over the canonical object", c.ID)
		}
		_, sig, pk := parts(t, c)
		if ok, err := dcp.VerifyObject(v.Objects.Object, b64(sig), b64(pk)); err != nil || ok != c.Accept {
			t.Errorf("%s: got %v, %v; want %v", c.ID, ok, err, c.Accept)
		}
	}
}

// fixedClassical returns the corpus signature, only for exactly the corpus DSM.
type fixedClassical struct {
	dsm, sig []byte
	calls    [][]byte
}

func (p *fixedClassical) Alg() string          { return "ed25519" }
func (p *fixedClassical) KeySize() int         { return 32 }
func (p *fixedClassical) SigSize() int         { return 64 }
func (p *fixedClassical) IsConstantTime() bool { return true }
func (p *fixedClassical) GenerateKeypair() (*v2.GeneratedKeypair, error) {
	return nil, fmt.Errorf("not used")
}
func (p *fixedClassical) Sign(message []byte, _ string) ([]byte, error) {
	p.calls = append(p.calls, append([]byte{}, message...))
	if !bytes.Equal(message, p.dsm) {
		return nil, fmt.Errorf("not the corpus DSM")
	}
	return append([]byte{}, p.sig...), nil
}
func (p *fixedClassical) Verify([]byte, []byte, string) (bool, error) {
	return false, fmt.Errorf("not used")
}

func TestPED1Composite(t *testing.T) {
	v := loadPED1(t)
	payload := []byte(v.Composite.PayloadCanonical)
	dsm, err := v2.DomainSeparatedMessage(v.Composite.Context, payload)
	if err != nil || hex.EncodeToString(dsm) != v.Composite.DsmHex {
		t.Fatalf("DomainSeparatedMessage: %v", err)
	}
	for _, c := range v.Composite.Cases {
		t.Run(c.ID, func(t *testing.T) {
			_, sig, pk := parts(t, c)
			fixed := &fixedClassical{dsm: dsm, sig: sig}
			mldsa := &providers.MlDsa65Provider{}
			pq, err := mldsa.GenerateKeypair()
			if err != nil {
				t.Fatal(err)
			}
			signing := v2.NewAlgorithmRegistry()
			signing.RegisterSigner(fixed)
			signing.RegisterSigner(mldsa)
			cs, err := v2.CompositeSign(signing, v.Composite.Context, payload,
				v2.CompositeKeyInfo{Kid: "ped1-corpus", Alg: "ed25519", SecretKeyB64: "unused", PublicKeyB64: b64(pk)},
				v2.CompositeKeyInfo{Kid: pq.Kid, Alg: "ml-dsa-65", SecretKeyB64: pq.SecretKeyB64, PublicKeyB64: pq.PublicKeyB64})
			if err != nil {
				t.Fatal(err)
			}
			if len(fixed.calls) != 1 || !bytes.Equal(fixed.calls[0], dsm) || cs.Classical.SigB64 != b64(sig) {
				t.Fatal("the classical component is not the corpus signature over the exact DSM")
			}
			verifying := v2.NewAlgorithmRegistry()
			verifying.RegisterSigner(&providers.Ed25519Provider{})
			verifying.RegisterSigner(mldsa)
			r, err := v2.CompositeVerify(verifying, v.Composite.Context, payload, cs, b64(pk), pq.PublicKeyB64)
			// The PQ component is real and valid; the corpus says the equation and the byte comparison hold on this
			// DSM, so for the negative the only reason left is P-ED-1.
			if err != nil || r.Valid != c.Accept || r.ClassicalValid != c.Accept || !r.PQValid {
				t.Fatalf("got %+v, %v; want valid %v, classical %v, pq true", r, err, c.Accept, c.Accept)
			}
		})
	}
}

func TestPED1CombinedDefects(t *testing.T) {
	v := loadPED1(t)
	ed := &providers.Ed25519Provider{}
	msg, sig, pk := parts(t, named(t, v, "signature/a-small-order/order-8-26e8958f-05"))
	for _, bad := range [][]byte{sig[:63], append(append([]byte{}, sig...), 0)} {
		if ok, err := ed.Verify(msg, bad, b64(pk)); ok || err != nil {
			t.Errorf("a small-order A with a %d-byte signature: got %v, %v; want false, nil", len(bad), ok, err)
		}
	}
	if ok, err := ed.Verify(msg, sig, b64(append(append([]byte{}, pk...), 0))); ok || err == nil ||
		err.Error() != "invalid public key length: got 33, want 32" {
		t.Errorf("a 33-byte small-order key: got %v, %v", ok, err)
	}
	if ok, err := ed.Verify(msg, sig, "!"+b64(pk)); ok || err == nil || !strings.HasPrefix(err.Error(), "decode public key:") {
		t.Errorf("invalid base64: got %v, %v", ok, err)
	}
	nmsg, nsig, npk := parts(t, named(t, v, "signature/a-non-canonical-small-order/y-p"))
	if ok, err := ed.Verify(nmsg, append(append([]byte{}, nsig...), 0), b64(npk)); ok || err != nil {
		t.Errorf("a non-canonical A with a 65-byte signature: got %v, %v", ok, err)
	}
	if ok, err := ed.Verify(msg, withScalar(sig, new(big.Int).Add(scalarOf(sig), ped1L)), b64(pk)); ok || err != nil {
		t.Errorf("a small-order A and S + L: got %v, %v; want false, nil", ok, err)
	}
	obj := v.Objects.Object
	osig, opk := unhex(t, named(t, v, "object/a-small-order").SignatureHex), unhex(t, named(t, v, "object/a-small-order").PublicKeyHex)
	if ok, err := dcp.VerifyObject(obj, b64(osig[:63]), b64(opk)); ok || err != nil {
		t.Errorf("V1, a 63-byte signature: got %v, %v", ok, err)
	}
	if ok, err := dcp.VerifyObject(obj, b64(osig), b64(opk[:31])); ok || err == nil ||
		err.Error() != "invalid public key length: got 31, want 32" {
		t.Errorf("V1, a 31-byte key: got %v, %v", ok, err)
	}
}

func TestPED1InputsOnlyRead(t *testing.T) {
	v := loadPED1(t)
	ed := &providers.Ed25519Provider{}
	for _, id := range []string{"signature/normal-key", "signature/a-small-order/order-8-26e8958f-05",
		"signature/r-small-order/order-8-26e8958f-05", "signature/r-non-canonical-small-order/y-p", "signature/normal-key-s-plus-l"} {
		c := named(t, v, id)
		msg, sig, pk := parts(t, c)
		m, s, k := append([]byte{}, msg...), append([]byte{}, sig...), append([]byte{}, pk...)
		if ed25519ped1.Rejects(sig, pk) == c.Accept {
			t.Errorf("%s: Rejects", id)
		}
		if ok, err := ed.Verify(msg, sig, b64(pk)); err != nil || ok != c.Accept {
			t.Errorf("%s: got %v, %v", id, ok, err)
		}
		if !bytes.Equal(m, msg) || !bytes.Equal(s, sig) || !bytes.Equal(k, pk) {
			t.Errorf("%s: an input changed", id)
		}
	}
}

// The baseline: crypto/ed25519 alone accepts the 16 isolated weak-point negatives. It checks S < L, and R's
// canonicity through its byte comparison, but neither A's canonicity nor small order; so P-ED-1 is the only reason
// the provider rejects them. S + L it already rejects.
func TestPED1StdlibBaseline(t *testing.T) {
	v := loadPED1(t)
	ed := &providers.Ed25519Provider{}
	n := 0
	for _, c := range v.Signatures {
		if c.Kind != "isolated" || len(c.Failing) != 1 || c.Failing[0] == "equation" {
			continue
		}
		n++
		msg, sig, pk := parts(t, c)
		raw := ed25519.Verify(ed25519.PublicKey(pk), msg, sig)
		ok, err := ed.Verify(msg, sig, b64(pk))
		wantRaw := c.Failing[0] != "s_range"
		if raw != wantRaw || ok || err != nil {
			t.Errorf("%s: crypto/ed25519 %v (want %v), provider %v, %v", c.ID, raw, wantRaw, ok, err)
		}
	}
	if n != 17 {
		t.Fatalf("%d isolated negatives, want 17", n)
	}
}
