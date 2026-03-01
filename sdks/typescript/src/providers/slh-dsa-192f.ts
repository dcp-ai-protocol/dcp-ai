/**
 * SLH-DSA-SHA2-192f CryptoProvider — wraps @noble/post-quantum.
 *
 * FIPS 205, NIST Level 3. Backup PQ signature (hash-based, conservative).
 * Public key: 48 B, Signature: 35664 B.
 * Slow signing (~160 ms) but mathematically independent from lattice-based ML-DSA.
 */

import { slh_dsa_sha2_192f } from '@noble/post-quantum/slh-dsa.js';
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

export class SlhDsa192fProvider implements CryptoProvider {
  readonly alg = 'slh-dsa-192f';
  readonly keySize = 48;
  readonly sigSize = 35664;
  readonly isConstantTime = true;

  async generateKeypair(): Promise<{
    kid: string;
    publicKeyB64: string;
    secretKeyB64: string;
  }> {
    const keys = slh_dsa_sha2_192f.keygen();
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
    return slh_dsa_sha2_192f.sign(message, sk);
  }

  async verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKeyB64: string,
  ): Promise<boolean> {
    const pk = BASE64.decode(publicKeyB64);
    try {
      return slh_dsa_sha2_192f.verify(signature, message, pk);
    } catch {
      return false;
    }
  }
}
