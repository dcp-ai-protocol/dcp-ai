/**
 * Byte checks of the Ed25519 points of P-ED-1 (docs/reviews/mp02-ed25519-implementation-design.md § 1): a
 * canonical encoding, and membership in E[8], the points of order dividing 8. Internal: used by verifyDetached,
 * not exported by the package. No curve arithmetic: comparisons with p and with a fixed table.
 */

/**
 * Whether 32 bytes are a canonical encoding: y < p, where y is the little-endian integer with bit 255 cleared,
 * and no sign bit when x = 0, that is when y = 1 or y = p - 1. Whether the point is on the curve is left to
 * TweetNaCl, which rejects a key that does not decode, and to its byte comparison of R.
 */
export function isCanonicalEncoding(b: Uint8Array): boolean {
  if (b.length !== 32) return false;
  const top = b[31] & 0x7f;
  let middleAllFf = true;
  let middleAllZero = true;
  for (let i = 1; i < 31; i++) {
    if (b[i] !== 0xff) middleAllFf = false;
    if (b[i] !== 0) middleAllZero = false;
  }
  // p = 2^255 - 19 is ed ff .. ff 7f: y >= p only with the same middle and top, and a low byte >= 0xed.
  if (top === 0x7f && middleAllFf && b[0] >= 0xed) return false;
  if (b[31] & 0x80) {
    const yIsOne = b[0] === 1 && middleAllZero && top === 0;
    const yIsPMinusOne = b[0] === 0xec && middleAllFf && top === 0x7f;
    if (yIsOne || yIsPMinusOne) return false;
  }
  return true;
}

/**
 * The canonical encodings of the 8 points of E[8]. Derived by the independent review model, not copied from a
 * library (.claude/mp02-20261107/claude-f5-design/small-order-points.json), and equal to the constants of
 * tests/interop/v2/ed25519_ped1_vectors.json.
 */
const SMALL_ORDER_HEX = [
  '0000000000000000000000000000000000000000000000000000000000000000', // order 4
  '0000000000000000000000000000000000000000000000000000000000000080', // order 4
  '0100000000000000000000000000000000000000000000000000000000000000', // order 1, the identity
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05', // order 8
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85', // order 8
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', // order 8
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa', // order 8
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', // order 2
];

const SMALL_ORDER: readonly Uint8Array[] = SMALL_ORDER_HEX.map((h) => {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
});

/** The table, for the tests. */
export const SMALL_ORDER_ENCODINGS_HEX: readonly string[] = SMALL_ORDER_HEX;

/**
 * Whether 32 bytes are one of the 8 encodings of E[8]. Meant for an encoding already found canonical: a
 * non-canonical encoding of a point of E[8] is not in the table, and is rejected by isCanonicalEncoding instead.
 */
export function isSmallOrderEncoding(b: Uint8Array): boolean {
  if (b.length !== 32) return false;
  return SMALL_ORDER.some((t) => {
    for (let i = 0; i < 32; i++) if (t[i] !== b[i]) return false;
    return true;
  });
}
