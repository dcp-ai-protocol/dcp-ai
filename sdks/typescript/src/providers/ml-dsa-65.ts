/**
 * ML-DSA-65 CryptoProvider — wraps @noble/post-quantum.
 *
 * FIPS 204, NIST Level 3. Primary post-quantum signature algorithm.
 * Public key: 1952 B, Signature: 3309 B.
 */

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import type { CryptoProvider } from '../core/crypto-provider.js';
import { deriveKid } from '../core/crypto-provider.js';

const BASE64 = {
  encode(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  },
  decode(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'base64'));
  },
};

export class MlDsa65Provider implements CryptoProvider {
  readonly alg = 'ml-dsa-65';
  readonly keySize = 1952;
  readonly sigSize = 3309;
  readonly isConstantTime = true;

  async generateKeypair(): Promise<{
    kid: string;
    publicKeyB64: string;
    secretKeyB64: string;
  }> {
    const keys = ml_dsa65.keygen();
    const kid = deriveKid(this.alg, keys.publicKey);
    return {
      kid,
      publicKeyB64: BASE64.encode(keys.publicKey),
      secretKeyB64: BASE64.encode(keys.secretKey),
    };
  }

  async sign(
    message: Uint8Array,
    secretKeyB64: string,
  ): Promise<Uint8Array> {
    const sk = BASE64.decode(secretKeyB64);
    return ml_dsa65.sign(message, sk);
  }

  async verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKeyB64: string,
  ): Promise<boolean> {
    const pk = BASE64.decode(publicKeyB64);
    try {
      return ml_dsa65.verify(signature, message, pk);
    } catch {
      return false;
    }
  }
}
