/**
 * Ed25519 CryptoProvider — wraps tweetnacl.
 *
 * This is the classical signature provider used in both V1 and V2.
 * In V2, it forms the classical half of composite signatures.
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import type { CryptoProvider } from '../core/crypto-provider.js';
import { deriveKid } from '../core/crypto-provider.js';

const { encodeBase64, decodeBase64 } = naclUtil;

export class Ed25519Provider implements CryptoProvider {
  readonly alg = 'ed25519';
  readonly keySize = 32;
  readonly sigSize = 64;
  readonly isConstantTime = true;

  async generateKeypair(): Promise<{
    kid: string;
    publicKeyB64: string;
    secretKeyB64: string;
  }> {
    const kp = nacl.sign.keyPair();
    const kid = deriveKid(this.alg, kp.publicKey);
    return {
      kid,
      publicKeyB64: encodeBase64(kp.publicKey),
      secretKeyB64: encodeBase64(kp.secretKey),
    };
  }

  async sign(
    message: Uint8Array,
    secretKeyB64: string,
  ): Promise<Uint8Array> {
    const sk = decodeBase64(secretKeyB64);
    return nacl.sign.detached(message, sk);
  }

  async verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKeyB64: string,
  ): Promise<boolean> {
    const pk = decodeBase64(publicKeyB64);
    return nacl.sign.detached.verify(message, signature, pk);
  }
}
