/**
 * DCP v2.0 Hybrid KEM — X25519 + ML-KEM-768.
 *
 * Combines a classical ECDH key exchange with a post-quantum KEM. The shared
 * secret is derived by concatenating both component secrets under HKDF-SHA256
 * to produce a single 32-byte symmetric key.
 *
 * This provides security against both classical and quantum adversaries:
 * breaking the combined secret requires breaking *both* X25519 and ML-KEM-768.
 */

import { createHash, createHmac, randomBytes } from 'crypto';
import type { KemProvider } from './crypto-provider.js';

const BASE64 = {
  encode(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  },
  decode(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'base64'));
  },
};

export interface HybridKemKeypair {
  classicalPublicKeyB64: string;
  classicalSecretKeyB64: string;
  pqPublicKeyB64: string;
  pqSecretKeyB64: string;
  combinedPublicKeyB64: string;
}

export interface HybridEncapsulationResult {
  sharedSecret: Uint8Array;
  classicalCiphertextB64: string;
  pqCiphertextB64: string;
  combinedCiphertextB64: string;
}

function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  let t = Buffer.alloc(0);
  const okm = Buffer.alloc(length);
  let offset = 0;
  let counter = 1;
  while (offset < length) {
    const input = Buffer.concat([t, info, Buffer.from([counter])]);
    t = createHmac('sha256', prk).update(input).digest();
    const needed = Math.min(t.length, length - offset);
    t.copy(okm, offset, 0, needed);
    offset += needed;
    counter++;
  }
  return new Uint8Array(okm);
}

/**
 * Hybrid KEM that combines X25519 + ML-KEM-768.
 *
 * Key generation produces both a classical X25519 keypair and a ML-KEM-768
 * keypair. Encapsulation runs both KEMs and combines the shared secrets.
 */
export class HybridKemProvider implements KemProvider {
  readonly alg = 'x25519-ml-kem-768';

  constructor(
    private readonly classicalKem: KemProvider,
    private readonly pqKem: KemProvider,
  ) {}

  async generateKeypair(): Promise<{
    publicKeyB64: string;
    secretKeyB64: string;
  }> {
    const [classical, pq] = await Promise.all([
      this.classicalKem.generateKeypair(),
      this.pqKem.generateKeypair(),
    ]);

    const combinedPublic = JSON.stringify({
      classical: classical.publicKeyB64,
      pq: pq.publicKeyB64,
    });
    const combinedSecret = JSON.stringify({
      classical: classical.secretKeyB64,
      pq: pq.secretKeyB64,
    });

    return {
      publicKeyB64: Buffer.from(combinedPublic).toString('base64'),
      secretKeyB64: Buffer.from(combinedSecret).toString('base64'),
    };
  }

  async encapsulate(publicKeyB64: string): Promise<{
    sharedSecret: Uint8Array;
    ciphertextB64: string;
  }> {
    const combined = JSON.parse(Buffer.from(publicKeyB64, 'base64').toString());
    const classicalPk = combined.classical as string;
    const pqPk = combined.pq as string;

    const [classicalResult, pqResult] = await Promise.all([
      this.classicalKem.encapsulate(classicalPk),
      this.pqKem.encapsulate(pqPk),
    ]);

    const ikm = new Uint8Array(
      classicalResult.sharedSecret.length + pqResult.sharedSecret.length,
    );
    ikm.set(classicalResult.sharedSecret, 0);
    ikm.set(pqResult.sharedSecret, classicalResult.sharedSecret.length);

    const salt = new TextEncoder().encode('DCP-AI.v2.HybridKEM');
    const info = new TextEncoder().encode('x25519-ml-kem-768');
    const sharedSecret = hkdfSha256(ikm, salt, info, 32);

    const combinedCiphertext = JSON.stringify({
      classical: classicalResult.ciphertextB64,
      pq: pqResult.ciphertextB64,
    });

    return {
      sharedSecret,
      ciphertextB64: Buffer.from(combinedCiphertext).toString('base64'),
    };
  }

  async decapsulate(
    ciphertextB64: string,
    secretKeyB64: string,
  ): Promise<Uint8Array> {
    const ct = JSON.parse(Buffer.from(ciphertextB64, 'base64').toString());
    const sk = JSON.parse(Buffer.from(secretKeyB64, 'base64').toString());

    const [classicalSecret, pqSecret] = await Promise.all([
      this.classicalKem.decapsulate(ct.classical, sk.classical),
      this.pqKem.decapsulate(ct.pq, sk.pq),
    ]);

    const ikm = new Uint8Array(classicalSecret.length + pqSecret.length);
    ikm.set(classicalSecret, 0);
    ikm.set(pqSecret, classicalSecret.length);

    const salt = new TextEncoder().encode('DCP-AI.v2.HybridKEM');
    const info = new TextEncoder().encode('x25519-ml-kem-768');
    return hkdfSha256(ikm, salt, info, 32);
  }
}

/**
 * Session sealing: encrypt an entire bundle payload with the hybrid shared secret.
 * Uses AES-256-GCM with a random 12-byte IV.
 */
export interface SealedBundle {
  kem_alg: string;
  ciphertext_b64: string;
  combined_kem_ciphertext_b64: string;
  iv_b64: string;
  tag_b64: string;
}

export async function sealBundle(
  hybridKem: HybridKemProvider,
  recipientPublicKeyB64: string,
  plaintext: Uint8Array,
): Promise<SealedBundle> {
  const { sharedSecret, ciphertextB64 } = await hybridKem.encapsulate(recipientPublicKeyB64);

  const { createCipheriv } = await import('crypto');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sharedSecret, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    kem_alg: hybridKem.alg,
    ciphertext_b64: BASE64.encode(encrypted),
    combined_kem_ciphertext_b64: ciphertextB64,
    iv_b64: BASE64.encode(iv),
    tag_b64: BASE64.encode(tag),
  };
}

export async function unsealBundle(
  hybridKem: HybridKemProvider,
  recipientSecretKeyB64: string,
  sealed: SealedBundle,
): Promise<Uint8Array> {
  const sharedSecret = await hybridKem.decapsulate(
    sealed.combined_kem_ciphertext_b64,
    recipientSecretKeyB64,
  );

  const { createDecipheriv } = await import('crypto');
  const iv = BASE64.decode(sealed.iv_b64);
  const tag = BASE64.decode(sealed.tag_b64);
  const ciphertext = BASE64.decode(sealed.ciphertext_b64);

  const decipher = createDecipheriv('aes-256-gcm', sharedSecret, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}
