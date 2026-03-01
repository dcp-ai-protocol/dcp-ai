/**
 * X25519 KemProvider — classical ECDH key exchange as a KEM.
 *
 * Uses Node.js crypto X25519 for Diffie-Hellman key agreement, wrapped as
 * a KEM interface (keygen, encapsulate, decapsulate). The "ciphertext" is
 * the ephemeral public key, and the shared secret is the raw DH output
 * hashed with SHA-256.
 */

import { createHash, generateKeyPairSync, diffieHellman, createPublicKey, createPrivateKey } from 'crypto';
import type { KemProvider } from '../core/crypto-provider.js';

const BASE64 = {
  encode(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  },
  decode(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'base64'));
  },
};

export class X25519KemProvider implements KemProvider {
  readonly alg = 'x25519';

  async generateKeypair(): Promise<{
    publicKeyB64: string;
    secretKeyB64: string;
  }> {
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    const pkRaw = publicKey.export({ type: 'spki', format: 'der' });
    const skRaw = privateKey.export({ type: 'pkcs8', format: 'der' });
    return {
      publicKeyB64: Buffer.from(pkRaw).toString('base64'),
      secretKeyB64: Buffer.from(skRaw).toString('base64'),
    };
  }

  async encapsulate(publicKeyB64: string): Promise<{
    sharedSecret: Uint8Array;
    ciphertextB64: string;
  }> {
    const { publicKey: ephPub, privateKey: ephPriv } = generateKeyPairSync('x25519');

    const recipientPub = createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      type: 'spki',
      format: 'der',
    });

    const rawSecret = diffieHellman({ publicKey: recipientPub, privateKey: ephPriv });
    const sharedSecret = createHash('sha256').update(rawSecret).digest();

    const ephPubDer = ephPub.export({ type: 'spki', format: 'der' });

    return {
      sharedSecret: new Uint8Array(sharedSecret),
      ciphertextB64: Buffer.from(ephPubDer).toString('base64'),
    };
  }

  async decapsulate(
    ciphertextB64: string,
    secretKeyB64: string,
  ): Promise<Uint8Array> {
    const ephPub = createPublicKey({
      key: Buffer.from(ciphertextB64, 'base64'),
      type: 'spki',
      format: 'der',
    });

    const recipientPriv = createPrivateKey({
      key: Buffer.from(secretKeyB64, 'base64'),
      type: 'pkcs8',
      format: 'der',
    });

    const rawSecret = diffieHellman({ publicKey: ephPub, privateKey: recipientPriv });
    const sharedSecret = createHash('sha256').update(rawSecret).digest();
    return new Uint8Array(sharedSecret);
  }
}
