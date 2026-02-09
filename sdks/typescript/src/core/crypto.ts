/**
 * Ed25519 signing and verification for DCP bundles.
 * Uses tweetnacl for cryptographic operations.
 */
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import stringify from 'json-stable-stringify';
import type { Keypair } from '../types/index.js';

const { decodeUTF8, encodeBase64, decodeBase64 } = naclUtil;

/** Canonical JSON serialization (deterministic key ordering). */
export function canonicalize(obj: unknown): string {
  return stringify(obj);
}

/** Generate a new Ed25519 keypair. */
export function generateKeypair(): Keypair {
  const kp = nacl.sign.keyPair();
  return {
    publicKeyB64: encodeBase64(kp.publicKey),
    secretKeyB64: encodeBase64(kp.secretKey),
  };
}

/** Derive the public key from a secret key (base64). */
export function publicKeyFromSecret(secretKeyB64: string): string {
  const sk = decodeBase64(secretKeyB64);
  const kp = nacl.sign.keyPair.fromSecretKey(sk);
  return encodeBase64(kp.publicKey);
}

/** Sign a JSON object with Ed25519 (detached signature). Returns base64 signature. */
export function signObject(obj: unknown, secretKeyB64: string): string {
  const msg = decodeUTF8(canonicalize(obj));
  const sk = decodeBase64(secretKeyB64);
  const sig = nacl.sign.detached(msg, sk);
  return encodeBase64(sig);
}

/** Verify an Ed25519 detached signature on a JSON object. */
export function verifyObject(
  obj: unknown,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  const msg = decodeUTF8(canonicalize(obj));
  const sig = decodeBase64(signatureB64);
  const pk = decodeBase64(publicKeyB64);
  return nacl.sign.detached.verify(msg, sig, pk);
}
