/**
 * Ed25519 verification with the S range check that TweetNaCl omits.
 *
 * RFC 8032 §5.1.7 requires 0 <= S < L. TweetNaCl does not check it, so it
 * accepts S + k·L, another encoding of a valid signature (§8.4). Internal:
 * used by the Ed25519 provider and by verifyObject, not exported.
 */
import nacl from 'tweetnacl';

/** L = 2^252 + 27742317777372353535851937790883648493, little-endian. */
const L = new Uint8Array([
  0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
]);

/** Whether S, the second half of a 64-byte signature, is below L. */
function scalarBelowL(sig: Uint8Array): boolean {
  for (let i = 31; i >= 0; i--) {
    if (sig[32 + i] !== L[i]) return sig[32 + i] < L[i];
  }
  return false; // S = L
}

/**
 * nacl.sign.detached.verify that also returns false when S >= L. The range is
 * checked only on input TweetNaCl itself accepts (Uint8Array arguments, a
 * 64-byte signature, a 32-byte key); anything else goes to TweetNaCl as it is,
 * so it keeps its errors and their order.
 */
export function verifyDetached(msg: Uint8Array, sig: Uint8Array, pk: Uint8Array): boolean {
  if (
    msg instanceof Uint8Array &&
    sig instanceof Uint8Array &&
    pk instanceof Uint8Array &&
    sig.length === nacl.sign.signatureLength &&
    pk.length === nacl.sign.publicKeyLength &&
    !scalarBelowL(sig)
  ) {
    return false;
  }
  return nacl.sign.detached.verify(msg, sig, pk);
}
