/**
 * ML-KEM-768 KemProvider — wraps @noble/post-quantum.
 *
 * FIPS 203, NIST Level 3. Primary post-quantum KEM.
 * Public key: 1184 B, Ciphertext: 1088 B.
 */

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import type { KemProvider } from '../core/crypto-provider.js';

const BASE64 = {
  encode(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  },
  decode(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'base64'));
  },
};

export class MlKem768Provider implements KemProvider {
  readonly alg = 'ml-kem-768';

  async generateKeypair(): Promise<{
    publicKeyB64: string;
    secretKeyB64: string;
  }> {
    const keys = ml_kem768.keygen();
    return {
      publicKeyB64: BASE64.encode(keys.publicKey),
      secretKeyB64: BASE64.encode(keys.secretKey),
    };
  }

  async encapsulate(publicKeyB64: string): Promise<{
    sharedSecret: Uint8Array;
    ciphertextB64: string;
  }> {
    const pk = BASE64.decode(publicKeyB64);
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(pk);
    return {
      sharedSecret,
      ciphertextB64: BASE64.encode(cipherText),
    };
  }

  async decapsulate(
    ciphertextB64: string,
    secretKeyB64: string,
  ): Promise<Uint8Array> {
    const ct = BASE64.decode(ciphertextB64);
    const sk = BASE64.decode(secretKeyB64);
    return ml_kem768.decapsulate(ct, sk);
  }
}
