import { describe, it, expect, beforeAll } from 'vitest';
import {
  compositeSign,
  preparePayload,
  generateSessionNonce,
  getDefaultRegistry,
  registerDefaultProviders,
  DCP_CONTEXTS,
  type AgentPassportV2,
  type CompositeKeyPair,
  type KeyEntry,
  type SignedPayload,
} from '@dcp-ai/sdk';
import {
  passportToAgentCard,
  agentCardToPassport,
  attachPassportToAgentCard,
  agentCardPassport,
  verifyAgentCardPassport,
  DCP_PASSPORT_EXTENSION_URI,
} from '../index.js';

let signed: SignedPayload<AgentPassportV2>;
let keys: CompositeKeyPair;
let intruder: CompositeKeyPair;

async function makeKeys(): Promise<CompositeKeyPair> {
  const registry = getDefaultRegistry();
  const c = await registry.getSigner('ed25519').generateKeypair();
  const p = await registry.getSigner('ml-dsa-65').generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}

function entries(k: CompositeKeyPair, over: Partial<KeyEntry> = {}): KeyEntry[] {
  return [k.classical, k.pq].map((x) => ({ kid: x.kid, alg: x.alg as KeyEntry['alg'], public_key_b64: x.publicKeyB64, created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active', ...over }));
}

async function signPassport(payload: AgentPassportV2, by: CompositeKeyPair): Promise<SignedPayload<AgentPassportV2>> {
  const prepared = preparePayload(payload);
  return { payload, payload_hash: prepared.payloadHash, composite_sig: await compositeSign(getDefaultRegistry(), DCP_CONTEXTS.AgentPassport, prepared.canonicalBytes, by) };
}

function passportPayload(k: CompositeKeyPair, over: Partial<AgentPassportV2> = {}): AgentPassportV2 {
  return {
    dcp_version: '2.0',
    agent_id: 'agent:a2a-test',
    session_nonce: generateSessionNonce(),
    keys: entries(k),
    principal_binding_reference: 'rpr:test-owner',
    capabilities: ['api_call', 'browse'] as AgentPassportV2['capabilities'],
    risk_tier: 'medium',
    created_at: '2026-01-01T00:00:00Z',
    status: 'active',
    ...over,
  };
}

beforeAll(async () => {
  registerDefaultProviders();
  keys = await makeKeys();
  intruder = await makeKeys();
  signed = await signPassport(passportPayload(keys), keys);
}, 60_000);

describe('the signed passport inside the Agent Card', () => {
  it('passportToAgentCard puts a signed passport in the DCP extension and the card round-trips and verifies', async () => {
    const card = passportToAgentCard(signed, 'https://agent.example/a2a');
    const ext = card.capabilities!.extensions!.find((e) => e.uri === DCP_PASSPORT_EXTENSION_URI)!;
    expect(ext.required).toBe(false);
    expect(ext.params!.passport).toEqual(signed);
    expect(card.metadata!.dcp_agent_id).toBe('agent:a2a-test');
    expect(card.skills!.map((s) => s.id)).toEqual(['api_call', 'browse']);
    expect(agentCardPassport(card)).toEqual(signed);
    expect(agentCardToPassport(card)).toEqual(signed.payload);
    const result = await verifyAgentCardPassport(card);
    expect(result.errors).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.anchored).toBe(false);
    expect(result.passport?.agent_id).toBe('agent:a2a-test');
    // Anchored to keys the verifier already trusts, and to the agent it expects.
    const anchored = await verifyAgentCardPassport(card, { trustedKeys: entries(keys), expectedAgentId: 'agent:a2a-test' });
    expect(anchored.verified, anchored.errors.join('\n')).toBe(true);
    expect(anchored.anchored).toBe(true);
    const otherAnchor = await verifyAgentCardPassport(card, { trustedKeys: entries(intruder) });
    // The anchor's own lifecycle is authoritative: a key the verifier revoked or let expire does not verify.
    const revokedAnchor = await verifyAgentCardPassport(card, { trustedKeys: entries(keys, { status: 'revoked' }) });
    expect(revokedAnchor.verified).toBe(false);
    expect(revokedAnchor.errors.join('\n')).toContain('trusted key');
    const expiredAnchor = await verifyAgentCardPassport(card, { trustedKeys: entries(keys, { expires_at: '2020-01-01T00:00:00Z' }) });
    expect(expiredAnchor.verified).toBe(false);
    expect(expiredAnchor.errors.join('\n')).toContain('has expired');
    const notArray = await verifyAgentCardPassport(card, { trustedKeys: 'nope' as any });
    expect(notArray.verified).toBe(false);
    expect(notArray.errors[0]).toContain('trustedKeys must be an array');
    expect(otherAnchor.verified).toBe(false);
    expect(otherAnchor.errors.join('\n')).toContain('trusted keys');
    const otherAgent = await verifyAgentCardPassport(card, { expectedAgentId: 'agent:someone-else' });
    expect(otherAgent.verified).toBe(false);
    expect(otherAgent.errors.join('\n')).toContain('expected');
    // The card survives a JSON round trip, as it will over HTTP.
    expect((await verifyAgentCardPassport(JSON.parse(JSON.stringify(card)))).verified).toBe(true);
  }, 60_000);

  it('a bare passport still yields a card, without the extension, and a card without it is a skeleton', async () => {
    const card = passportToAgentCard(signed.payload, 'https://agent.example/a2a');
    expect(card.capabilities!.extensions).toBeUndefined();
    expect(agentCardPassport(card)).toBeUndefined();
    const result = await verifyAgentCardPassport(card);
    expect(result.verified).toBe(false);
    expect(result.errors[0]).toContain('no DCP passport extension');
    expect(agentCardToPassport(card).keys).toEqual([]);
  });

  it('attachPassportToAgentCard keeps other extensions and replaces an earlier DCP passport', () => {
    const card = { name: 'x', capabilities: { streaming: true, extensions: [{ uri: 'https://other.example/ext' }] } };
    const once = attachPassportToAgentCard(card, signed);
    const twice = attachPassportToAgentCard(once, signed);
    expect(twice.capabilities!.extensions!.map((e) => e.uri)).toEqual(['https://other.example/ext', DCP_PASSPORT_EXTENSION_URI]);
    expect(twice.capabilities!.streaming).toBe(true);
  });

  it('rejects a tampered, re-signed, stripped, revoked, expired or mislabelled passport', async () => {
    const card = passportToAgentCard(signed, 'https://agent.example/a2a');
    const withPassport = (p: SignedPayload<AgentPassportV2>, meta: Record<string, unknown> = {}) => ({ ...attachPassportToAgentCard(card, p), metadata: { ...attachPassportToAgentCard(card, p).metadata, ...meta } });
    const cases: Array<[string, Promise<SignedPayload<AgentPassportV2>> | SignedPayload<AgentPassportV2>, Record<string, unknown>, string]> = [
      ['payload changed after signing', { ...signed, payload: { ...signed.payload, agent_id: 'agent:evil' } }, { dcp_agent_id: 'agent:evil' }, 'payload_hash'],
      ['hash fixed up but signature stale', { ...signed, payload: { ...signed.payload, risk_tier: 'low' }, payload_hash: preparePayload({ ...signed.payload, risk_tier: 'low' }).payloadHash }, {}, 'does not verify'],
      ['signed by keys the passport does not list', signPassport(passportPayload(keys), intruder), {}, 'not in the passport'],
      ['intruder lists its own keys but claims the agent id', signPassport(passportPayload(intruder), intruder), { dcp_agent_id: 'agent:other' }, 'dcp_agent_id'],
      ['classical_only signature', { ...signed, composite_sig: { ...signed.composite_sig, pq: null, binding: 'classical_only' as const } }, {}, 'pq_over_classical'],
      ['revoked passport', signPassport(passportPayload(keys, { status: 'revoked' }), keys), {}, 'status is revoked'],
      ['revoked key', signPassport(passportPayload(keys, { keys: entries(keys, { status: 'revoked' }) }), keys), {}, 'is revoked'],
      ['expired key', signPassport(passportPayload(keys, { keys: entries(keys, { expires_at: '2020-01-01T00:00:00Z' }) }), keys), {}, 'has expired'],
      ['no principal binding', signPassport(passportPayload(keys, { principal_binding_reference: '' }), keys), {}, 'principal_binding_reference'],
      ['two Ed25519 keys posing as hybrid', (async () => {
        const c2 = await getDefaultRegistry().getSigner('ed25519').generateKeypair();
        const fake: CompositeKeyPair = { ...keys, pq: { kid: c2.kid, alg: 'ed25519', secretKeyB64: c2.secretKeyB64, publicKeyB64: c2.publicKeyB64 } };
        return signPassport(passportPayload(fake), fake);
      })(), {}, 'not allowed in this slot'],
      ['kid that is not the kid of its key', signPassport(passportPayload(keys, { keys: entries(keys).map((k, i) => (i === 0 ? { ...k, kid: '0'.repeat(32) } : k)) }), { ...keys, classical: { ...keys.classical, kid: '0'.repeat(32) } }), {}, 'is not the kid of its public key'],
      ['expires_at that is not RFC 3339', signPassport(passportPayload(keys, { keys: entries(keys, { expires_at: '2099-01-01' }) }), keys), {}, 'invalid expires_at'],
      ['created_at that is not RFC 3339', signPassport(passportPayload(keys, { created_at: 'not-a-date' }), keys), {}, 'created_at'],
    ];
    for (const [name, p, meta, needle] of cases) {
      const result = await verifyAgentCardPassport(withPassport(await p, meta));
      expect(result.verified, name).toBe(false);
      expect(result.errors.join('\n'), name).toContain(needle);
    }
  }, 120_000);

  it('fails closed on malformed cards', async () => {
    for (const card of [null, {}, { capabilities: { extensions: 'nope' } }, { capabilities: { extensions: [{ uri: DCP_PASSPORT_EXTENSION_URI, params: { passport: 'x' } }] } }, { capabilities: { extensions: [{ uri: DCP_PASSPORT_EXTENSION_URI, params: { passport: { payload: null, payload_hash: 'x', composite_sig: {} } } }] } }, { capabilities: { extensions: [{ uri: DCP_PASSPORT_EXTENSION_URI, params: { passport: { payload: { keys: 'none' }, payload_hash: 'x', composite_sig: {} } } }] } }]) {
      const result = await verifyAgentCardPassport(card as any);
      expect(result.verified).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
