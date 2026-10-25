import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
const { decodeUTF8, encodeBase64, decodeBase64 } = naclUtil;
import stringify from "json-stable-stringify";

// V2 artifacts are signed and verified with @dcp-ai/sdk (see lib/verify.js).

export function canonicalize(obj) {
  return stringify(obj);
}

// --- V1: Ed25519 ---

export function generateKeypair() {
  const kp = nacl.sign.keyPair();
  return {
    publicKeyB64: encodeBase64(kp.publicKey),
    secretKeyB64: encodeBase64(kp.secretKey)
  };
}

export function signObject(obj, secretKeyB64) {
  const msg = decodeUTF8(canonicalize(obj));
  const sk = decodeBase64(secretKeyB64);
  const sig = nacl.sign.detached(msg, sk);
  return encodeBase64(sig);
}

// RFC 8032 §5.1.7 requires S < L, which TweetNaCl does not check. Copy of
// verifyDetached in sdks/typescript/src/core/ed25519-scalar.ts: the range is
// checked only on input TweetNaCl accepts, so its errors stay the same.
const L = [
  0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10
];

function scalarBelowL(sig) {
  for (let i = 31; i >= 0; i--) {
    if (sig[32 + i] !== L[i]) return sig[32 + i] < L[i];
  }
  return false; // S = L
}

function verifyDetached(msg, sig, pk) {
  if (
    msg instanceof Uint8Array && sig instanceof Uint8Array && pk instanceof Uint8Array &&
    sig.length === nacl.sign.signatureLength && pk.length === nacl.sign.publicKeyLength &&
    !scalarBelowL(sig)
  ) {
    return false;
  }
  return nacl.sign.detached.verify(msg, sig, pk);
}

export function verifyObject(obj, signatureB64, publicKeyB64) {
  const msg = decodeUTF8(canonicalize(obj));
  const sig = decodeBase64(signatureB64);
  const pk = decodeBase64(publicKeyB64);
  return verifyDetached(msg, sig, pk);
}
