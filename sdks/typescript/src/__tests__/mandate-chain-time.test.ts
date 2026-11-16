/**
 * DCP-09 §3.5.2 chain time rules: the shared signed vectors every SDK must agree on
 * (tests/interop/v2/mandate_chain_time_vectors.json) and the verification time as this SDK takes it: floored to the
 * millisecond, also before the Unix epoch, and refused without an exception when it is not an instant.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { createDelegationMandate, verifyMandateChain } from '../core/delegation.js';
import { generateSessionNonce, parseRfc3339 } from '../core/session-nonce.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../../..');
let V: any;
const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);
const call = verifyMandateChain as (...a: unknown[]) => ReturnType<typeof verifyMandateChain>;

beforeAll(() => {
  V = JSON.parse(readFileSync(resolve(REPO, 'tests/interop/v2/mandate_chain_time_vectors.json'), 'utf-8'));
});

function timeOf(c: any): number {
  const t = parseRfc3339(c.verification_time ?? V.verification_time);
  if (t === undefined) throw new Error(`${c.name}: the verification time is not an instant`);
  return t;
}

describe('mandate chain time vectors (mandate_chain_time_vectors.json)', () => {
  it('every must_accept chain verifies with the expected depth and effective tier', async () => {
    expect(V.must_accept.length).toBe(9);
    for (const c of V.must_accept) {
      const result = await verifyMandateChain(registry, c.chain, new Set(c.revoked_mandate_ids), c.keys ?? V.keys, timeOf(c));
      expect(result.errors, c.name).toEqual([]);
      expect(result.valid, c.name).toBe(true);
      expect({ depth: result.depth, effective_tier: result.effective_tier }, c.name).toEqual(c.expected);
    }
  });

  it('every must_reject chain is rejected with an error naming error_contains', async () => {
    expect(V.must_reject.length).toBe(13);
    for (const c of V.must_reject) {
      const result = await verifyMandateChain(registry, c.chain, new Set(c.revoked_mandate_ids), c.keys ?? V.keys, timeOf(c));
      expect(result.valid, c.name).toBe(false);
      expect(result.errors.join('\n').toLowerCase(), c.name).toContain(c.error_contains);
    }
  });

  it('case names are unique', () => {
    const names = [...V.must_accept, ...V.must_reject].map((c: any) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every must_accept mandate validates against the wire schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const dir = resolve(REPO, 'schemas/v2');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) ajv.addSchema(JSON.parse(readFileSync(resolve(dir, file), 'utf-8')));
    const validate = ajv.getSchema('https://dcp-ai.org/schemas/v2/delegation_mandate.schema.json')!;
    for (const { name, chain } of V.must_accept) {
      for (const mandate of chain) expect(validate(mandate), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });
});

describe('verifyMandateChain verification time', () => {
  const expiring = () => V.must_accept.find((c: any) => c.name === 'every_signer_key_expires_at_the_verification_time');

  it('floors a number to the millisecond the key expiries are read at', async () => {
    const c = expiring();
    const at = parseRfc3339(V.verification_time)!;
    expect((await verifyMandateChain(registry, c.chain, new Set(), c.keys, at + 0.999)).valid).toBe(true);
    const later = await verifyMandateChain(registry, c.chain, new Set(), c.keys, at + 1);
    expect(later.valid).toBe(false);
    expect(later.errors.join('\n')).toContain('has expired or has an invalid expires_at');
    expect((await verifyMandateChain(registry, c.chain, new Set(), c.keys, new Date(at))).valid).toBe(true);
  });

  it('floors before the Unix epoch too: -0.5 ms is the millisecond -1, not 0', async () => {
    const c = await ed25519.generateKeypair();
    const p = await mlDsa65.generateKeypair();
    const human = {
      classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
      pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
    };
    const root = await createDelegationMandate(registry, human, {
      mandate_id: 'mandate:before-epoch', session_nonce: generateSessionNonce(), human_id: 'human:alice', agent_id: 'agent:a',
      authority_scope: [{ domain: 'email', actions_permitted: ['read'] }], valid_from: '1969-01-01T00:00:00Z', valid_until: '1970-12-31T00:00:00Z', revocable: true,
    });
    const keys = {
      human_keys: [human.classical, human.pq].map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: '1969-01-01T00:00:00Z', expires_at: '1969-12-31T23:59:59.999Z', status: 'active' as const })),
      agent_keys: {},
    };
    expect((await verifyMandateChain(registry, [root], new Set(), keys, -0.5)).errors).toEqual([]);
    expect((await verifyMandateChain(registry, [root], new Set(), keys, -1)).valid).toBe(true);
    const at0 = await verifyMandateChain(registry, [root], new Set(), keys, 0);
    expect(at0.valid).toBe(false);
    expect(at0.errors.join('\n')).toContain('has expired or has an invalid expires_at');
  });

  it('refuses a verification time that is not an instant, without an exception', async () => {
    const c = V.must_accept[0];
    for (const now of [NaN, Infinity, -Infinity, new Date('not a date'), '2026-10-22T12:00:00Z', null, {}, [], true, 1n]) {
      await expect(call(registry, c.chain, new Set(), V.keys, now)).resolves.toEqual({
        valid: false, errors: ['verification time is not an instant'], depth: 0, effective_tier: null,
      });
    }
  });
});
