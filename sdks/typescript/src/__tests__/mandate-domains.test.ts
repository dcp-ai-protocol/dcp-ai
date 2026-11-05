/**
 * DCP-09 §3.5.2 rule 5, a domain that appears twice in one mandate: the shared signed vectors every SDK must agree on
 * (tests/interop/v2/mandate_domain_vectors.json), at every depth, the root included, with domains compared as exact
 * strings. The verdicts are the protocol's; the exact error lists are this SDK's diagnostics, checked as a regression.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { verifyMandateChain } from '../core/delegation.js';
import { parseRfc3339 } from '../core/session-nonce.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let V: any;
const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

beforeAll(() => {
  V = JSON.parse(readFileSync(resolve(__dirname, '../../../../tests/interop/v2/mandate_domain_vectors.json'), 'utf-8'));
});

describe('mandate domain vectors (mandate_domain_vectors.json)', () => {
  it('every must_accept chain verifies with the expected depth and effective tier', async () => {
    expect(V.must_accept.length).toBe(8);
    for (const c of V.must_accept) {
      const result = await verifyMandateChain(registry, c.chain, new Set(c.revoked_mandate_ids), V.keys, parseRfc3339(V.verification_time)!);
      expect(result.errors, c.name).toEqual([]);
      expect(result.valid, c.name).toBe(true);
      expect({ depth: result.depth, effective_tier: result.effective_tier }, c.name).toEqual(c.expected);
    }
  });

  it('every must_reject chain is rejected, with exactly the listed errors', async () => {
    expect(V.must_reject.length).toBe(15);
    const mismatches: unknown[] = [];
    for (const c of V.must_reject) {
      const result = await verifyMandateChain(registry, c.chain, new Set(c.revoked_mandate_ids), V.keys, parseRfc3339(V.verification_time)!);
      const want = { valid: false, errors: c.errors, depth: 0, effective_tier: null };
      if (JSON.stringify(result) !== JSON.stringify(want)) mismatches.push({ name: c.name, got: result });
    }
    expect(mismatches).toEqual([]);
  });

  it('case names are unique', () => {
    const names = [...V.must_accept, ...V.must_reject].map((c: any) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
