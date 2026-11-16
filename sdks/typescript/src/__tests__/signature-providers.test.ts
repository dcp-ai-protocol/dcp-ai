/**
 * The simulated HsmCryptoProvider (src/providers/hsm-provider.ts) was removed on 06/11/2026: it had
 * no hardware backend and its verify accepted any signature of the right length. These tests keep
 * it out of the source, the public API and the default registry, and check that each registered
 * signer accepts its own signature and returns false for signatures it did not make.
 */
import { existsSync } from 'fs';
import { describe, it, expect } from 'vitest';
import * as sdk from '../index.js';

describe('retired simulated HSM provider', () => {
  it('is not in the source', async () => {
    expect(existsSync(new URL('../providers/hsm-provider.ts', import.meta.url))).toBe(false);
    const retired: string = '../providers/hsm-provider.js';
    await expect(import(/* @vite-ignore */ retired)).rejects.toThrow();
  });

  it('is not in the public API', () => {
    expect(Object.keys(sdk).filter((name) => /hsm/i.test(name))).toEqual([]);
  });

  it('is not a default signer', () => {
    sdk.registerDefaultProviders();
    const registry = sdk.getDefaultRegistry();
    const signers = registry.listSigners();
    expect(signers).toEqual(['ed25519', 'ml-dsa-65', 'slh-dsa-192f']);
    expect(signers.map((alg) => registry.getSigner(alg).constructor)).toEqual([
      sdk.Ed25519Provider,
      sdk.MlDsa65Provider,
      sdk.SlhDsa192fProvider,
    ]);
  });
});

describe('registered signers return false for signatures they did not make', () => {
  const message = new TextEncoder().encode('DCP-AI signature provider control');
  const otherMessage = new TextEncoder().encode('DCP-AI signature provider control.');

  for (const alg of ['ed25519', 'ml-dsa-65', 'slh-dsa-192f']) {
    it(alg, { timeout: 120_000 }, async () => {
      sdk.registerDefaultProviders();
      const provider = sdk.getDefaultRegistry().getSigner(alg);
      const own = await provider.generateKeypair();
      const other = await provider.generateKeypair();
      const signature = await provider.sign(message, own.secretKeyB64);
      expect(signature.length).toBe(provider.sigSize);

      expect(await provider.verify(message, signature, own.publicKeyB64)).toBe(true);
      expect(await provider.verify(message, new Uint8Array(provider.sigSize), own.publicKeyB64)).toBe(false);
      expect(await provider.verify(message, signature, other.publicKeyB64)).toBe(false);
      expect(await provider.verify(otherMessage, signature, own.publicKeyB64)).toBe(false);
    });
  }
});
