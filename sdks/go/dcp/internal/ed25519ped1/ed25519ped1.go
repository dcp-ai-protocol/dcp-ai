// Package ed25519ped1 holds the byte checks of P-ED-1, the Ed25519 acceptance criterion of DCP
// (docs/reviews/mp02-ed25519-implementation-design.md). Internal: used by dcp.VerifyObject (V1) and by the Ed25519
// provider (V2) before crypto/ed25519.Verify.
//
// A signature is rejected when S >= L, when A or R is not a canonical encoding, or when A or R is one of the 8 points
// of order dividing 8 (the identity included). crypto/ed25519 then checks the equation [S]B = R + [k]A with
// k = SHA-512(R || A || M) mod L, without cofactor, comparing the canonical encoding of the computed R with the bytes
// of R. The checks compare bytes with constants, with no curve arithmetic. Mixed-order points are not rejected:
// P-ED-1 does not require torsion-free points.
package ed25519ped1

import "encoding/hex"

// l is L = 2^252 + 27742317777372353535851937790883648493, little-endian.
var l = [32]byte{
	0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
}

// SmallOrderEncodingsHex are the canonical encodings of the 8 points of E[8], derived by the independent review
// model (.claude/mp02-20261107/claude-f5-design/small-order-points.json) and equal to the constants of
// tests/interop/v2/ed25519_ped1_vectors.json.
var SmallOrderEncodingsHex = [8]string{
	"0000000000000000000000000000000000000000000000000000000000000000", // order 4
	"0000000000000000000000000000000000000000000000000000000000000080", // order 4
	"0100000000000000000000000000000000000000000000000000000000000000", // order 1, the identity
	"26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", // order 8
	"26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85", // order 8
	"c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a", // order 8
	"c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa", // order 8
	"ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", // order 2
}

var smallOrder = func() (out [8][32]byte) {
	for i, h := range SmallOrderEncodingsHex {
		b, err := hex.DecodeString(h)
		if err != nil || len(b) != 32 {
			panic("ed25519ped1: bad table entry")
		}
		copy(out[i][:], b)
	}
	return out
}()

// ScalarBelowL reports whether S, the second half of a 64-byte signature, is below L.
func ScalarBelowL(sig []byte) bool {
	if len(sig) != 64 {
		return false
	}
	for i := 31; i >= 0; i-- {
		if sig[32+i] != l[i] {
			return sig[32+i] < l[i]
		}
	}
	return false // S = L
}

// IsCanonicalEncoding reports whether 32 bytes have y < p (y little-endian, bit 255 cleared) and no sign bit when
// x = 0, that is when y = 1 or y = p - 1. Whether the point is on the curve is left to crypto/ed25519, which rejects
// a key that does not decode, and to its byte comparison of R.
func IsCanonicalEncoding(b []byte) bool {
	if len(b) != 32 {
		return false
	}
	top := b[31] & 0x7f
	middleAllFF, middleAllZero := true, true
	for i := 1; i < 31; i++ {
		if b[i] != 0xff {
			middleAllFF = false
		}
		if b[i] != 0 {
			middleAllZero = false
		}
	}
	// p = 2^255 - 19 is ed ff .. ff 7f: y >= p only with the same middle and top, and a low byte >= 0xed.
	if top == 0x7f && middleAllFF && b[0] >= 0xed {
		return false
	}
	if b[31]&0x80 != 0 {
		yIsOne := b[0] == 1 && middleAllZero && top == 0
		yIsPMinusOne := b[0] == 0xec && middleAllFF && top == 0x7f
		if yIsOne || yIsPMinusOne {
			return false
		}
	}
	return true
}

// IsSmallOrderEncoding reports whether 32 bytes are one of the 8 encodings of E[8]; meant for an encoding already
// found canonical.
func IsSmallOrderEncoding(b []byte) bool {
	if len(b) != 32 {
		return false
	}
	for _, t := range smallOrder {
		if string(t[:]) == string(b) {
			return true
		}
	}
	return false
}

// Rejects reports whether P-ED-1 rejects a signature before crypto/ed25519. Only on input crypto/ed25519 verifies: a
// 64-byte signature and a 32-byte key. Anything else returns false and goes to crypto/ed25519 as before. The inputs
// are only read.
func Rejects(sig, pk []byte) bool {
	if len(sig) != 64 || len(pk) != 32 {
		return false
	}
	r := sig[:32]
	return !ScalarBelowL(sig) ||
		!IsCanonicalEncoding(pk) ||
		IsSmallOrderEncoding(pk) ||
		!IsCanonicalEncoding(r) ||
		IsSmallOrderEncoding(r)
}
