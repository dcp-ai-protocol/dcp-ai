// P-ED-1, the Ed25519 acceptance criterion of DCP (spec/profiles/crypto/README.md), as byte checks for a verifier
// that computes the equation with TweetNaCl. The same checks as sdks/typescript/src/core/ed25519-point.ts and
// ed25519-scalar.ts, which the SDK does not export. One of three byte-identical copies, one per part that ships on
// its own: tools/ed25519-ped1.js (the reference verifier), cli/lib/ed25519-ped1.js (@dcp-ai/cli) and
// playground/js/core/ed25519-ped1.js (the static playground). tools/ed25519-ped1-consumers.test.mjs checks that they
// are identical and that the table is the one of the frozen tests/interop/v2/ed25519_ped1_vectors.json.
//
// rejectedByPed1(sig, pk) takes a 64-byte signature and a 32-byte key; the caller checks types and sizes first, so
// that TweetNaCl keeps its own errors and their order. It is true when S >= L, when A or R is not a canonical
// encoding, or when A or R is one of the 8 points of order dividing 8 (the identity included). TweetNaCl then computes
// [S]B = R + [k]A with k reduced mod L, without cofactor, comparing its encoding of [S]B - [k]A with the bytes of R.
// Mixed-order points are not rejected: P-ED-1 does not require torsion-free points. No curve arithmetic here.

/** L = 2^252 + 27742317777372353535851937790883648493, little-endian. */
const L = [
  0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
];

/** Whether S, the second half of a 64-byte signature, is below L, compared from the most significant byte. */
export function scalarBelowL(sig) {
  for (let i = 31; i >= 0; i--) {
    if (sig[32 + i] !== L[i]) return sig[32 + i] < L[i];
  }
  return false; // S = L
}

/**
 * Whether 32 bytes are a canonical encoding: y < p (p = 2^255 - 19, y little-endian with bit 255 cleared), and no
 * sign bit when x = 0, that is when y = 1 or y = p - 1. Whether the point is on the curve is left to TweetNaCl, which
 * rejects a key that does not decode, and to its byte comparison of R.
 */
export function isCanonicalEncoding(b) {
  if (b.length !== 32) return false;
  const top = b[31] & 0x7f;
  let middleAllFf = true;
  let middleAllZero = true;
  for (let i = 1; i < 31; i++) {
    if (b[i] !== 0xff) middleAllFf = false;
    if (b[i] !== 0) middleAllZero = false;
  }
  // p is ed ff .. ff 7f: y >= p only with the same middle and top, and a low byte >= 0xed.
  if (top === 0x7f && middleAllFf && b[0] >= 0xed) return false;
  if (b[31] & 0x80) {
    const yIsOne = b[0] === 1 && middleAllZero && top === 0;
    const yIsPMinusOne = b[0] === 0xec && middleAllFf && top === 0x7f;
    if (yIsOne || yIsPMinusOne) return false;
  }
  return true;
}

/** The canonical encodings of the 8 points of E[8], the constants of the frozen corpus. */
export const SMALL_ORDER_ENCODINGS_HEX = Object.freeze([
  "0000000000000000000000000000000000000000000000000000000000000000", // order 4
  "0000000000000000000000000000000000000000000000000000000000000080", // order 4
  "0100000000000000000000000000000000000000000000000000000000000000", // order 1, the identity
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", // order 8
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85", // order 8
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a", // order 8
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa", // order 8
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", // order 2
]);

const SMALL_ORDER = SMALL_ORDER_ENCODINGS_HEX.map((h) => {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
});

/** Whether 32 bytes are one of the 8 encodings of E[8]; meant for an encoding already found canonical. */
export function isSmallOrderEncoding(b) {
  if (b.length !== 32) return false;
  return SMALL_ORDER.some((t) => {
    for (let i = 0; i < 32; i++) if (t[i] !== b[i]) return false;
    return true;
  });
}

/** The conditions of P-ED-1 that TweetNaCl does not check, on a 64-byte signature and a 32-byte key. Only reads. */
export function rejectedByPed1(sig, pk) {
  const r = sig.subarray(0, 32);
  return !scalarBelowL(sig) || !isCanonicalEncoding(pk) || isSmallOrderEncoding(pk) || !isCanonicalEncoding(r) || isSmallOrderEncoding(r);
}
