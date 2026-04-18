// playground/js/core/crypto.js — Ed25519 keygen, signing, verification, kid

import { sha256Bytes } from './hash.js';
import { canonicalize } from './hash.js';
import { b64encode } from './utils.js';

export async function generateKeypair() {
  const kp = nacl.sign.keyPair();
  const kid = await computeKid('ed25519', kp.publicKey);
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    pubB64: nacl.util.encodeBase64(kp.publicKey),
    secB64: nacl.util.encodeBase64(kp.secretKey),
    kid,
  };
}

export async function computeKid(alg, pubKeyBytes) {
  const encoder = new TextEncoder();
  const algBytes = encoder.encode(alg);
  const sep = new Uint8Array([0x00]);
  const combined = new Uint8Array(algBytes.length + 1 + pubKeyBytes.length);
  combined.set(algBytes, 0);
  combined.set(sep, algBytes.length);
  combined.set(pubKeyBytes, algBytes.length + 1);
  const hash = await sha256Bytes(combined);
  return hash.substring(0, 32);
}

export function signDetached(payload, context, secretKey) {
  const canonical = canonicalize(payload);
  const encoder = new TextEncoder();
  const ctxBytes = encoder.encode(context);
  const payloadBytes = encoder.encode(canonical);
  const sep = new Uint8Array([0x00]);
  const msg = new Uint8Array(ctxBytes.length + 1 + payloadBytes.length);
  msg.set(ctxBytes, 0);
  msg.set(sep, ctxBytes.length);
  msg.set(payloadBytes, ctxBytes.length + 1);
  return nacl.sign.detached(msg, secretKey);
}

export function verifyDetached(payload, context, sigBytes, publicKey) {
  const canonical = typeof payload === 'string' ? payload : canonicalize(payload);
  const encoder = new TextEncoder();
  const ctxBytes = encoder.encode(context);
  const payloadBytes = encoder.encode(canonical);
  const sep = new Uint8Array([0x00]);
  const msg = new Uint8Array(ctxBytes.length + 1 + payloadBytes.length);
  msg.set(ctxBytes, 0);
  msg.set(sep, ctxBytes.length);
  msg.set(payloadBytes, ctxBytes.length + 1);
  return nacl.sign.detached.verify(msg, sigBytes, publicKey);
}
