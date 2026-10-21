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

export function verifyObject(obj, signatureB64, publicKeyB64) {
  const msg = decodeUTF8(canonicalize(obj));
  const sig = decodeBase64(signatureB64);
  const pk = decodeBase64(publicKeyB64);
  return nacl.sign.detached.verify(msg, sig, pk);
}
