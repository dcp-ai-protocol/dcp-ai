package providers

// The SLH-DSA-192f provider with real keys: a key generated, a message signed and verified, the rejection of
// any alteration, and inputs of the wrong size answered with an error or a rejection, never a panic.

import (
	"encoding/base64"
	"testing"
)

func noPanic(t *testing.T, label string, f func()) {
	t.Helper()
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("%s: panic %v", label, r)
		}
	}()
	f()
}

func TestSlhDsa192fProviderRoundTrip(t *testing.T) {
	p := &SlhDsa192fProvider{}
	kp, err := p.GenerateKeypair()
	if err != nil {
		t.Fatal(err)
	}
	pk, _ := base64.StdEncoding.DecodeString(kp.PublicKeyB64)
	sk, _ := base64.StdEncoding.DecodeString(kp.SecretKeyB64)
	if len(pk) != p.KeySize() || len(sk) != 96 {
		t.Fatalf("key sizes %d and %d", len(pk), len(sk))
	}
	message := []byte("DCP-AI.v2.Delegation\x00mandate")
	var sig []byte
	noPanic(t, "sign", func() { sig, err = p.Sign(message, kp.SecretKeyB64) })
	if err != nil || len(sig) != p.SigSize() {
		t.Fatalf("sign: %v, %d bytes", err, len(sig))
	}
	var ok bool
	noPanic(t, "verify", func() { ok, err = p.Verify(message, sig, kp.PublicKeyB64) })
	if err != nil || !ok {
		t.Fatalf("verify own signature: %v %v", ok, err)
	}

	other, _ := p.GenerateKeypair()
	flipped := func(b []byte, at int) []byte { c := append([]byte(nil), b...); c[at] ^= 1; return c }
	for label, call := range map[string]func() (bool, error){
		"another message":     func() (bool, error) { return p.Verify(flipped(message, 0), sig, kp.PublicKeyB64) },
		"signature first bit": func() (bool, error) { return p.Verify(message, flipped(sig, 0), kp.PublicKeyB64) },
		"signature last bit":  func() (bool, error) { return p.Verify(message, flipped(sig, len(sig)-1), kp.PublicKeyB64) },
		"another key":         func() (bool, error) { return p.Verify(message, sig, other.PublicKeyB64) },
	} {
		var ok bool
		var err error
		noPanic(t, label, func() { ok, err = call() })
		if ok || err != nil {
			t.Fatalf("%s: ok=%v err=%v, want a rejection", label, ok, err)
		}
	}
}

func TestSlhDsa192fProviderWrongSizes(t *testing.T) {
	p := &SlhDsa192fProvider{}
	kp, _ := p.GenerateKeypair()
	pk, _ := base64.StdEncoding.DecodeString(kp.PublicKeyB64)
	sk, _ := base64.StdEncoding.DecodeString(kp.SecretKeyB64)
	message := []byte("m")
	sig, err := p.Sign(message, kp.SecretKeyB64)
	if err != nil {
		t.Fatal(err)
	}
	resize := func(b []byte, n int) []byte {
		out := make([]byte, n)
		copy(out, b)
		return out
	}
	for _, n := range []int{0, 47, 49} {
		key := base64.StdEncoding.EncodeToString(resize(pk, n))
		var ok bool
		var err error
		noPanic(t, "public key size", func() { ok, err = p.Verify(message, sig, key) })
		if ok || err == nil {
			t.Fatalf("public key of %d bytes: ok=%v err=%v, want an error", n, ok, err)
		}
	}
	for _, n := range []int{0, 95, 97} {
		key := base64.StdEncoding.EncodeToString(resize(sk, n))
		var err error
		noPanic(t, "secret key size", func() { _, err = p.Sign(message, key) })
		if err == nil {
			t.Fatalf("secret key of %d bytes: want an error", n)
		}
	}
	for _, n := range []int{0, 35663, 35665} {
		var ok bool
		var err error
		noPanic(t, "signature size", func() { ok, err = p.Verify(message, resize(sig, n), kp.PublicKeyB64) })
		if ok || err != nil {
			t.Fatalf("signature of %d bytes: ok=%v err=%v, want a rejection", n, ok, err)
		}
	}
}
