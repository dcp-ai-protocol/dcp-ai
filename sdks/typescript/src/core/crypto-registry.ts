/**
 * DCP v2.0 Algorithm Registry.
 *
 * Maps canonical algorithm identifiers to CryptoProvider / KemProvider
 * instances, enabling runtime algorithm selection and crypto-agility.
 */

import type { CryptoProvider, KemProvider } from './crypto-provider.js';

export class AlgorithmRegistry {
  private sigProviders = new Map<string, CryptoProvider>();
  private kemProviders = new Map<string, KemProvider>();

  registerSigner(provider: CryptoProvider): void {
    this.sigProviders.set(provider.alg, provider);
  }

  registerKem(provider: KemProvider): void {
    this.kemProviders.set(provider.alg, provider);
  }

  getSigner(alg: string): CryptoProvider {
    const p = this.sigProviders.get(alg);
    if (!p) {
      throw new Error(`Unknown signing algorithm: ${alg}`);
    }
    return p;
  }

  getKem(alg: string): KemProvider {
    const p = this.kemProviders.get(alg);
    if (!p) {
      throw new Error(`Unknown KEM algorithm: ${alg}`);
    }
    return p;
  }

  hasSigner(alg: string): boolean {
    return this.sigProviders.has(alg);
  }

  hasKem(alg: string): boolean {
    return this.kemProviders.has(alg);
  }

  listSigners(): string[] {
    return [...this.sigProviders.keys()];
  }

  listKems(): string[] {
    return [...this.kemProviders.keys()];
  }
}

let defaultRegistry: AlgorithmRegistry | null = null;

/**
 * Returns the shared default registry. Lazily initialized on first call.
 * Providers must be registered by calling `registerDefaultProviders()`.
 */
export function getDefaultRegistry(): AlgorithmRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new AlgorithmRegistry();
  }
  return defaultRegistry;
}
