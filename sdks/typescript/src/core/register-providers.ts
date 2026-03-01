/**
 * DCP v2.0 Default Provider Registration.
 *
 * Registers all available CryptoProviders in the default AlgorithmRegistry.
 * Call once at application startup.
 */

import { getDefaultRegistry } from './crypto-registry.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { SlhDsa192fProvider } from '../providers/slh-dsa-192f.js';

let registered = false;

/**
 * Register all built-in signature providers (Ed25519, ML-DSA-65, SLH-DSA-192f)
 * in the default AlgorithmRegistry. Idempotent.
 */
export function registerDefaultProviders(): void {
  if (registered) return;
  const registry = getDefaultRegistry();
  registry.registerSigner(new Ed25519Provider());
  registry.registerSigner(new MlDsa65Provider());
  registry.registerSigner(new SlhDsa192fProvider());
  registered = true;
}
