/**
 * DCP-09 §3.5 mandate chains: the shared vectors every SDK must agree on
 * (tests/interop/v2/mandate_chain_vectors.json), the builders, and the tier
 * floor a verified chain feeds into the security tier.
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
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { createDelegationMandate, createSubMandate, verifyMandateChain } from '../core/delegation.js';
import type { MandateChainKeys } from '../core/delegation.js';
import { computeSecurityTier } from '../core/security-tier.js';
import { parseRfc3339 } from '../core/session-nonce.js';
import { generateSessionNonce } from '../core/session-nonce.js';
import type { IntentV2, KeyEntry, SecurityTier } from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../../..');
const VECTORS_PATH = resolve(REPO, 'tests/interop/v2/mandate_chain_vectors.json');

let V: any;
const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

beforeAll(() => {
  V = JSON.parse(readFileSync(VECTORS_PATH, 'utf-8'));
});

async function generateKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}

function keyEntries(keys: CompositeKeyPair, expiresAt: string | null = null): KeyEntry[] {
  return [keys.classical, keys.pq].map((k) => ({
    kid: k.kid,
    alg: k.alg,
    public_key_b64: k.publicKeyB64,
    created_at: '2026-10-21T00:00:00Z',
    expires_at: expiresAt,
    status: 'active' as const,
  }));
}

describe('mandate chain vectors (mandate_chain_vectors.json)', () => {
  it('every must_accept chain verifies with the expected depth and effective tier', async () => {
    const now = parseRfc3339(V.verification_time)!;
    expect(V.must_accept.length).toBeGreaterThan(0);
    for (const { name, chain, revoked_mandate_ids, expected } of V.must_accept) {
      const result = await verifyMandateChain(registry, chain, new Set(revoked_mandate_ids), V.keys, now);
      expect(result.errors, name).toEqual([]);
      expect(result.valid, name).toBe(true);
      expect({ depth: result.depth, effective_tier: result.effective_tier }, name).toEqual(expected);
    }
  });

  it('every must_accept mandate validates against the wire schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const dir = resolve(REPO, 'schemas/v2');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      ajv.addSchema(JSON.parse(readFileSync(resolve(dir, file), 'utf-8')));
    }
    const validate = ajv.getSchema('https://dcp-ai.org/schemas/v2/delegation_mandate.schema.json')!;
    for (const { name, chain } of V.must_accept) {
      for (const mandate of chain) {
        expect(validate(mandate), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      }
    }
  });

  it('every must_reject chain is rejected with an error naming error_contains', async () => {
    expect(V.must_reject.length).toBeGreaterThan(10);
    for (const { name, chain, revoked_mandate_ids, verification_time, error_contains } of V.must_reject) {
      const now = parseRfc3339(verification_time ?? V.verification_time)!;
      const result = await verifyMandateChain(registry, chain, new Set(revoked_mandate_ids), V.keys, now);
      expect(result.valid, name).toBe(false);
      expect(result.errors.join('\n').toLowerCase(), name).toContain(error_contains);
    }
  });

  it('the tier floor cases resolve as expected', () => {
    expect(V.tier_floor.cases.length).toBeGreaterThan(0);
    for (const c of V.tier_floor.cases) {
      expect(computeSecurityTier(c.intent, c.policy_decision, c.mandate_chain_tier), c.name).toBe(c.expected);
    }
  });
});

describe('mandate chain builders', () => {
  const scope = [
    { domain: 'email', actions_permitted: ['read', 'draft', 'send'], data_classes: ['contact_info'], limits: { max_messages_per_day: 100, region: 'EU' } },
    { domain: 'calendar', actions_permitted: ['read', 'create_event'] },
  ];
  const window = { valid_from: '2026-01-01T00:00:00Z', valid_until: '2099-01-01T00:00:00Z', revocable: true };

  it('a root mandate without chain fields is unchanged on the wire', async () => {
    const human = await generateKeys();
    const root = await createDelegationMandate(registry, human, {
      mandate_id: 'mandate:root', session_nonce: generateSessionNonce(), human_id: 'human:alice', agent_id: 'agent:orchestrator',
      authority_scope: scope, ...window,
    });
    expect(Object.keys(root).sort()).toEqual([
      'agent_id', 'authority_scope', 'dcp_version', 'human_composite_sig', 'human_id', 'mandate_id',
      'revocable', 'session_nonce', 'timestamp', 'valid_from', 'valid_until',
    ]);
  });

  it('builds a human → agent → subagent → tool chain that verifies, and refuses it once the root is revoked', async () => {
    const [human, orchestrator, subagent, tool] = await Promise.all([generateKeys(), generateKeys(), generateKeys(), generateKeys()]);
    const root = await createDelegationMandate(registry, human, {
      mandate_id: 'mandate:root', session_nonce: generateSessionNonce(), human_id: 'human:alice', agent_id: 'agent:orchestrator',
      authority_scope: scope, ...window, sub_delegation: { permitted: true, max_depth: 2 }, minimum_security_tier: 'standard',
    });
    const sub1 = await createSubMandate(registry, orchestrator, root, {
      mandate_id: 'mandate:sub-1', session_nonce: generateSessionNonce(), agent_id: 'agent:subagent',
      authority_scope: [{ domain: 'email', actions_permitted: ['read', 'draft'], data_classes: ['contact_info'], limits: { max_messages_per_day: 20, region: 'EU', approval: true } }],
      ...window, sub_delegation: { permitted: true, max_depth: 2 }, minimum_security_tier: 'elevated',
    });
    const sub2 = await createSubMandate(registry, subagent, sub1, {
      mandate_id: 'mandate:sub-2', session_nonce: generateSessionNonce(), agent_id: 'agent:tool',
      authority_scope: [{ domain: 'email', actions_permitted: ['read'], data_classes: [], limits: { max_messages_per_day: 5, region: 'EU', approval: true } }],
      ...window, minimum_security_tier: 'maximum',
    });
    expect(sub1).toMatchObject({ parent_mandate_id: 'mandate:root', delegation_depth: 1, human_id: 'human:alice' });
    expect(sub2).toMatchObject({ parent_mandate_id: 'mandate:sub-1', delegation_depth: 2 });
    expect('human_composite_sig' in sub1).toBe(false);

    const keys: MandateChainKeys = {
      human_keys: keyEntries(human, '2099-12-31T23:59:59Z'),
      agent_keys: { 'agent:orchestrator': keyEntries(orchestrator), 'agent:subagent': keyEntries(subagent), 'agent:tool': keyEntries(tool) },
    };
    const ok = await verifyMandateChain(registry, [root, sub1, sub2], new Set(), keys);
    expect(ok.errors).toEqual([]);
    expect(ok).toMatchObject({ valid: true, depth: 2, effective_tier: 'maximum' });
    expect(await verifyMandateChain(registry, [root], new Set(), keys)).toMatchObject({ valid: true, depth: 0, effective_tier: 'standard' });

    const revokedRoot = await verifyMandateChain(registry, [root, sub1, sub2], new Set(['mandate:root']), keys);
    expect(revokedRoot.valid).toBe(false);
    expect(revokedRoot.errors).toEqual(['mandate[0]: revoked']);

    // A key that is not active, or has expired at the verification time, cannot vouch for a hop.
    const revokedKey = { ...keys, agent_keys: { ...keys.agent_keys, 'agent:orchestrator': keyEntries(orchestrator).map((k) => ({ ...k, status: 'revoked' as const })) } };
    expect((await verifyMandateChain(registry, [root, sub1], new Set(), revokedKey)).errors.join()).toContain('delegator_composite_sig');
    expect((await verifyMandateChain(registry, [root, sub1], new Set(), keys, parseRfc3339('2100-01-01T00:00:00Z')!)).errors.join()).toContain('expired');

    // A chain out of order, or starting at a sub-mandate, never verifies.
    expect((await verifyMandateChain(registry, [sub1, root], new Set(), keys)).valid).toBe(false);
    expect((await verifyMandateChain(registry, [sub1], new Set(), keys)).valid).toBe(false);
    expect((await verifyMandateChain(registry, [], new Set(), keys)).valid).toBe(false);
    expect((await verifyMandateChain(registry, [null as any], new Set(), keys)).errors).toEqual(['mandate[0]: not an object']);
  });
});

describe('security tier floor from a mandate chain', () => {
  const routine: IntentV2 = { action_type: 'browse', data_classes: ['none'], estimated_impact: 'low' } as IntentV2;
  it('can only raise the tier', () => {
    expect(computeSecurityTier(routine, { risk_score: 0 })).toBe('routine');
    expect(computeSecurityTier(routine, { risk_score: 0 }, 'elevated')).toBe('elevated');
    expect(computeSecurityTier(routine, { risk_score: 0 }, null)).toBe('routine');
    expect(computeSecurityTier({ ...routine, data_classes: ['credentials'] }, { risk_score: 0 }, 'routine')).toBe('maximum');
    expect(computeSecurityTier(routine, { risk_score: 0 }, 'bogus' as SecurityTier)).toBe('elevated');
  });
});
