/**
 * Ed25519 verification under P-ED-1 (docs/reviews/mp02-ed25519-implementation-design.md), the one path of
 * verifyObject (V1) and of the Ed25519 provider (V2). Internal, not exported by the package.
 *
 * Before TweetNaCl, on input TweetNaCl itself accepts, it rejects:
 * - S >= L: RFC 8032 §5.1.7 requires 0 <= S < L, which TweetNaCl does not check (S + k·L verifies, §8.4);
 * - A or R that is not a canonical encoding;
 * - A or R in E[8], the points of order dividing 8, the identity included.
 * TweetNaCl then computes the equation: [S]B = R + [k]A with k = SHA-512(R || A || M) mod L, without cofactor,
 * comparing its canonical encoding of [S]B - [k]A with the bytes of R. P-ED-1 is a DCP criterion: it does not
 * require torsion-free points, so a mixed-order A or R for which the equation holds is accepted.
 */
import nacl from 'tweetnacl';
import { isCanonicalEncoding, isSmallOrderEncoding } from './ed25519-point.js';

/** L = 2^252 + 27742317777372353535851937790883648493, little-endian. */
const L = new Uint8Array([
  0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
]);

/** Whether S, the second half of a 64-byte signature, is below L. Exported for the tests. */
export function scalarBelowL(sig: Uint8Array): boolean {
  for (let i = 31; i >= 0; i--) {
    if (sig[32 + i] !== L[i]) return sig[32 + i] < L[i];
  }
  return false; // S = L
}

/** The conditions of P-ED-1 that TweetNaCl does not check, on a 64-byte signature and a 32-byte key. */
function rejectedByPed1(sig: Uint8Array, pk: Uint8Array): boolean {
  const r = sig.subarray(0, 32);
  return (
    !scalarBelowL(sig) ||
    !isCanonicalEncoding(pk) ||
    isSmallOrderEncoding(pk) ||
    !isCanonicalEncoding(r) ||
    isSmallOrderEncoding(r)
  );
}

/**
 * nacl.sign.detached.verify under P-ED-1: false when S >= L or when A or R is non-canonical or in E[8]. The
 * checks run only on input TweetNaCl itself accepts (Uint8Array arguments, a 64-byte signature, a 32-byte key);
 * anything else goes to TweetNaCl as it is, so it keeps its errors and their order. The inputs are only read.
 */
export function verifyDetached(msg: Uint8Array, sig: Uint8Array, pk: Uint8Array): boolean {
  if (
    msg instanceof Uint8Array &&
    sig instanceof Uint8Array &&
    pk instanceof Uint8Array &&
    sig.length === nacl.sign.signatureLength &&
    pk.length === nacl.sign.publicKeyLength &&
    rejectedByPed1(sig, pk)
  ) {
    return false;
  }
  return nacl.sign.detached.verify(msg, sig, pk);
}
