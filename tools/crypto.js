import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
const { decodeUTF8, encodeBase64, decodeBase64 } = naclUtil;
import stringify from "json-stable-stringify";
import { rejectedByPed1 } from "./ed25519-ped1.js";

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

// P-ED-1 (spec/profiles/crypto/README.md): S < L, A and R canonical and not of order dividing 8, then TweetNaCl's
// equation. As verifyDetached in sdks/typescript/src/core/ed25519-scalar.ts, the checks run only on input TweetNaCl
// accepts (Uint8Array arguments, a 64-byte signature, a 32-byte key), so its errors and their order stay the same.
function verifyDetached(msg, sig, pk) {
  if (
    msg instanceof Uint8Array && sig instanceof Uint8Array && pk instanceof Uint8Array &&
    sig.length === nacl.sign.signatureLength && pk.length === nacl.sign.publicKeyLength &&
    rejectedByPed1(sig, pk)
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
