/**
 * DCP-09 §3.5 Mandate Chain Vector Generator
 *
 * Writes tests/interop/v2/mandate_chain_vectors.json: chains (root first) that
 * every SDK's chain verifier MUST accept, with the depth and effective tier it
 * must report, and chains it MUST reject with an error that contains
 * error_contains (case-insensitive). `keys` holds the human principal's keys
 * and each agent's keys by agent_id, and `verification_time` is the instant to
 * verify at, so the committed vectors never expire. tier_floor lists the
 * security tier the effective tier of a chain must raise an intent to.
 *
 * Run: cd sdks/typescript && npx vite-node src/__tests__/generate-mandate-chain-vectors.ts
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import type { DcpContext } from '../core/domain-separation.js';
import { compositeSign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { generateSessionNonce } from '../core/session-nonce.js';
import { verifyMandateChain } from '../core/delegation.js';
import { computeSecurityTier } from '../core/security-tier.js';
import type { KeyEntry } from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../../../../tests/interop/v2/mandate_chain_vectors.json');

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

async function generateKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}

// expires_at is null so the committed vectors never expire.
function keyEntries(keys: CompositeKeyPair): KeyEntry[] {
  return [keys.classical, keys.pq].map((k) => ({
    kid: k.kid,
    alg: k.alg,
    public_key_b64: k.publicKeyB64,
    created_at: '2026-10-21T00:00:00Z',
    expires_at: null,
    status: 'active',
  }));
}

type Mandate = Record<string, unknown>;

async function signed(payload: Mandate, context: DcpContext, keys: CompositeKeyPair, field: string): Promise<Mandate> {
  // An override of undefined removes a field, as JSON would.
  payload = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
  const bytes = new TextEncoder().encode(canonicalizeV2(payload));
  return { ...payload, [field]: await compositeSign(registry, context, bytes, keys) };
}

const without = (m: Mandate, ...fields: string[]): Mandate =>
  Object.fromEntries(Object.entries(m).filter(([k]) => !fields.includes(k)));

const HUMAN = 'human:interop-principal';
const ORCHESTRATOR = 'agent:interop-orchestrator';
const SUBAGENT = 'agent:interop-subagent';
const TOOL = 'agent:interop-tool';
const DEEPER = 'agent:interop-deeper';
const INTRUDER = 'agent:interop-intruder';
const VERIFICATION_TIME = '2026-10-22T12:00:00Z';

// A routine intent (spec §14.2) and one that is maximum on its own.
const ROUTINE_INTENT = { action_type: 'browse', data_classes: ['none'], estimated_impact: 'low' };
const MAXIMUM_INTENT = { ...ROUTINE_INTENT, data_classes: ['credentials'] };

async function main() {
  const human = await generateKeys();
  const agents: Record<string, CompositeKeyPair> = {
    [ORCHESTRATOR]: await generateKeys(),
    [SUBAGENT]: await generateKeys(),
    [TOOL]: await generateKeys(),
    [INTRUDER]: await generateKeys(),
  };
  const keys = {
    human_keys: keyEntries(human),
    agent_keys: Object.fromEntries(Object.entries(agents).map(([id, k]) => [id, keyEntries(k)])),
  };
  const signRoot = (payload: Mandate, by = human) => signed(payload, DCP_CONTEXTS.Delegation, by, 'human_composite_sig');
  const signSub = (payload: Mandate, by: CompositeKeyPair) => signed(payload, DCP_CONTEXTS.SubMandate, by, 'delegator_composite_sig');

  // ── The chain every verifier must accept: human → orchestrator → subagent → tool ──

  const rootPayload = (over: Mandate = {}): Mandate => ({
    dcp_version: '2.0',
    mandate_id: 'mandate:interop-root',
    session_nonce: generateSessionNonce(),
    human_id: HUMAN,
    agent_id: ORCHESTRATOR,
    authority_scope: [
      {
        domain: 'email',
        actions_permitted: ['read', 'draft', 'send'],
        data_classes: ['contact_info', 'company_confidential'],
        limits: { max_messages_per_day: 100, max_recipients: 5, region: 'EU' },
      },
      { domain: 'calendar', actions_permitted: ['read', 'create_event'] },
    ],
    valid_from: '2026-01-01T00:00:00Z',
    valid_until: '2099-01-01T00:00:00Z',
    revocable: true,
    timestamp: '2026-01-01T00:00:00Z',
    sub_delegation: { permitted: true, max_depth: 2 },
    minimum_security_tier: 'standard',
    ...over,
  });
  const sub1Payload = (over: Mandate = {}): Mandate => ({
    dcp_version: '2.0',
    mandate_id: 'mandate:interop-sub-1',
    session_nonce: generateSessionNonce(),
    human_id: HUMAN,
    agent_id: SUBAGENT,
    authority_scope: [
      {
        domain: 'email',
        actions_permitted: ['read', 'draft'],
        data_classes: ['contact_info'],
        limits: { max_messages_per_day: 50, max_recipients: 5, region: 'EU', require_approval: true },
      },
    ],
    valid_from: '2026-02-01T00:00:00Z',
    valid_until: '2098-01-01T00:00:00Z',
    revocable: true,
    timestamp: '2026-02-01T00:00:00Z',
    parent_mandate_id: 'mandate:interop-root',
    delegation_depth: 1,
    sub_delegation: { permitted: true, max_depth: 2 },
    minimum_security_tier: 'elevated',
    ...over,
  });
  const sub2Payload = (over: Mandate = {}): Mandate => ({
    dcp_version: '2.0',
    mandate_id: 'mandate:interop-sub-2',
    session_nonce: generateSessionNonce(),
    human_id: HUMAN,
    agent_id: TOOL,
    authority_scope: [
      {
        domain: 'email',
        actions_permitted: ['read'],
        data_classes: ['contact_info'],
        limits: { max_messages_per_day: 10, max_recipients: 1, region: 'EU', require_approval: true },
      },
    ],
    valid_from: '2026-03-01T00:00:00Z',
    valid_until: '2097-01-01T00:00:00Z',
    revocable: true,
    timestamp: '2026-03-01T00:00:00Z',
    parent_mandate_id: 'mandate:interop-sub-1',
    delegation_depth: 2,
    sub_delegation: { permitted: true, max_depth: 5 },
    minimum_security_tier: 'maximum',
    ...over,
  });

  const root = await signRoot(rootPayload());
  const sub1 = await signSub(sub1Payload(), agents[ORCHESTRATOR]);
  const sub2 = await signSub(sub2Payload(), agents[SUBAGENT]);
  const sub1Of = (over: Mandate) => signSub(sub1Payload(over), agents[ORCHESTRATOR]);

  // A plain root: no tier floor, no data_classes, no limits; one hop allowed.
  const plainRoot = await signRoot(
    rootPayload({
      mandate_id: 'mandate:interop-root-plain',
      authority_scope: [{ domain: 'calendar', actions_permitted: ['read', 'create_event'] }],
      sub_delegation: { permitted: true, max_depth: 1 },
      minimum_security_tier: undefined,
    }),
  );
  const plainSubPayload = (over: Mandate = {}): Mandate =>
    sub1Payload({
      mandate_id: 'mandate:interop-sub-plain',
      authority_scope: [{ domain: 'calendar', actions_permitted: ['read'] }],
      parent_mandate_id: 'mandate:interop-root-plain',
      sub_delegation: undefined,
      minimum_security_tier: undefined,
      ...over,
    });
  const plainSub = await signSub(plainSubPayload(), agents[ORCHESTRATOR]);
  // A root that does not permit sub-delegation at all.
  const sealedRoot = await signRoot(rootPayload({ mandate_id: 'mandate:interop-root-sealed', sub_delegation: undefined }));

  const mustAccept = [
    { name: 'depth_1', chain: [root, sub1], revoked_mandate_ids: [], expected: { depth: 1, effective_tier: 'elevated' } },
    { name: 'depth_2', chain: [root, sub1, sub2], revoked_mandate_ids: [], expected: { depth: 2, effective_tier: 'maximum' } },
    { name: 'root_only', chain: [root], revoked_mandate_ids: [], expected: { depth: 0, effective_tier: 'standard' } },
    { name: 'depth_1_without_tier_floor', chain: [plainRoot, plainSub], revoked_mandate_ids: [], expected: { depth: 1, effective_tier: null } },
    {
      name: 'revoked_sibling_does_not_affect_the_chain',
      chain: [root, sub1],
      revoked_mandate_ids: ['mandate:interop-sub-plain'],
      expected: { depth: 1, effective_tier: 'elevated' },
    },
  ];

  const scope1 = sub1Payload().authority_scope as Record<string, unknown>[];
  const email = (over: Record<string, unknown>) => [{ ...scope1[0], ...over }];
  const limits = (over: Record<string, unknown>) =>
    email({ limits: { ...(scope1[0].limits as Record<string, unknown>), ...over } });

  const mustReject: { name: string; chain: Mandate[]; revoked_mandate_ids?: string[]; verification_time?: string; error_contains: string }[] = [
    { name: 'widened_actions_permitted', chain: [root, await sub1Of({ authority_scope: email({ actions_permitted: ['read', 'draft', 'send', 'delete'] }) })], error_contains: 'actions_permitted' },
    { name: 'added_data_classes', chain: [root, await sub1Of({ authority_scope: email({ data_classes: ['contact_info', 'pii'] }) })], error_contains: 'data_classes' },
    {
      name: 'data_classes_where_parent_has_none',
      chain: [plainRoot, await signSub(plainSubPayload({ authority_scope: [{ domain: 'calendar', actions_permitted: ['read'], data_classes: ['contact_info'] }] }), agents[ORCHESTRATOR])],
      error_contains: 'data_classes',
    },
    { name: 'loosened_numeric_limit', chain: [root, await sub1Of({ authority_scope: limits({ max_messages_per_day: 500 }) })], error_contains: 'limits' },
    { name: 'changed_non_numeric_limit', chain: [root, await sub1Of({ authority_scope: limits({ region: 'US' }) })], error_contains: 'limits' },
    { name: 'dropped_limit_key', chain: [root, await sub1Of({ authority_scope: email({ limits: { max_messages_per_day: 50, region: 'EU' } }) })], error_contains: 'limits' },
    { name: 'limit_type_changed', chain: [root, await sub1Of({ authority_scope: limits({ max_recipients: 'many' }) })], error_contains: 'limits' },
    { name: 'unknown_domain', chain: [root, await sub1Of({ authority_scope: [{ domain: 'payments', actions_permitted: ['pay'] }] })], error_contains: 'authority_scope' },
    { name: 'validity_extended_beyond_parent', chain: [root, await sub1Of({ valid_until: '2099-06-01T00:00:00Z' })], error_contains: 'valid_until' },
    { name: 'validity_starts_before_parent', chain: [root, await sub1Of({ valid_from: '2025-06-01T00:00:00Z' })], error_contains: 'valid_from' },
    // 2098-12-31T23:30:00-01:00 is 2099-01-01T00:30:00Z, after the parent's valid_until; as text it sorts before it.
    { name: 'validity_offset_compared_as_text_would_pass', chain: [root, await sub1Of({ valid_until: '2098-12-31T23:30:00-01:00' })], error_contains: 'valid_until' },
    {
      name: 'depth_exceeded',
      chain: [root, sub1, sub2, await signSub(sub2Payload({ mandate_id: 'mandate:interop-sub-3', agent_id: DEEPER, parent_mandate_id: 'mandate:interop-sub-2', delegation_depth: 3, authority_scope: [{ domain: 'email', actions_permitted: ['read'], data_classes: [], limits: { max_messages_per_day: 1, max_recipients: 1, region: 'EU', require_approval: true } }] }), agents[TOOL])],
      error_contains: 'max_depth',
    },
    { name: 'sub_delegation_not_permitted', chain: [sealedRoot, await sub1Of({ parent_mandate_id: 'mandate:interop-root-sealed' })], error_contains: 'sub-delegation' },
    { name: 'missing_parent_mandate_id', chain: [root, await signSub(without(sub1Payload(), 'parent_mandate_id'), agents[ORCHESTRATOR])], error_contains: 'parent_mandate_id' },
    { name: 'wrong_parent_mandate_id', chain: [root, await sub1Of({ parent_mandate_id: 'mandate:interop-root-plain' })], error_contains: 'parent_mandate_id' },
    { name: 'lowered_minimum_security_tier', chain: [root, await sub1Of({ minimum_security_tier: 'routine' })], error_contains: 'minimum_security_tier' },
    { name: 'dropped_minimum_security_tier', chain: [root, await signSub(without(sub1Payload(), 'minimum_security_tier'), agents[ORCHESTRATOR])], error_contains: 'minimum_security_tier' },
    { name: 'unknown_minimum_security_tier', chain: [root, await sub1Of({ minimum_security_tier: 'ultra' })], error_contains: 'minimum_security_tier' },
    { name: 'revoked_root', chain: [root, sub1, sub2], revoked_mandate_ids: ['mandate:interop-root'], error_contains: 'revoked' },
    { name: 'revoked_intermediate', chain: [root, sub1, sub2], revoked_mandate_ids: ['mandate:interop-sub-1'], error_contains: 'revoked' },
    { name: 'sub_mandate_signed_by_wrong_agent', chain: [root, await signSub(sub1Payload(), agents[INTRUDER])], error_contains: 'delegator_composite_sig' },
    { name: 'sub_mandate_signed_by_its_own_agent', chain: [root, await signSub(sub1Payload(), agents[SUBAGENT])], error_contains: 'delegator_composite_sig' },
    { name: 'sub_mandate_signed_by_the_human', chain: [root, await signSub(sub1Payload(), human)], error_contains: 'delegator_composite_sig' },
    { name: 'sub_mandate_tampered_after_signing', chain: [root, { ...sub1, revocable: false }], error_contains: 'delegator_composite_sig' },
    { name: 'root_tampered_after_signing', chain: [{ ...root, agent_id: INTRUDER }, sub1], error_contains: 'human_composite_sig' },
    { name: 'root_signed_by_an_agent', chain: [await signRoot(rootPayload(), agents[ORCHESTRATOR]), sub1], error_contains: 'human_composite_sig' },
    { name: 'both_signatures_present', chain: [root, { ...sub1, human_composite_sig: root.human_composite_sig }], error_contains: 'human_composite_sig' },
    { name: 'root_with_delegator_signature', chain: [{ ...without(root, 'human_composite_sig'), delegator_composite_sig: root.human_composite_sig }], error_contains: 'human_composite_sig' },
    { name: 'sub_mandate_with_human_signature_only', chain: [root, { ...without(sub1, 'delegator_composite_sig'), human_composite_sig: sub1.delegator_composite_sig }], error_contains: 'delegator_composite_sig' },
    { name: 'sub_mandate_under_the_delegation_context', chain: [root, await signed(sub1Payload(), DCP_CONTEXTS.Delegation, agents[ORCHESTRATOR], 'delegator_composite_sig')], error_contains: 'delegator_composite_sig' },
    { name: 'delegation_depth_wrong', chain: [root, await sub1Of({ delegation_depth: 2 })], error_contains: 'delegation_depth' },
    { name: 'delegation_depth_missing', chain: [root, await signSub(without(sub1Payload(), 'delegation_depth'), agents[ORCHESTRATOR])], error_contains: 'delegation_depth' },
    { name: 'root_with_delegation_depth_1', chain: [await signRoot(rootPayload({ delegation_depth: 1 })), sub1], error_contains: 'delegation_depth' },
    { name: 'root_with_parent_mandate_id', chain: [await signRoot(rootPayload({ parent_mandate_id: 'mandate:interop-root' }))], error_contains: 'parent_mandate_id' },
    { name: 'human_id_changed', chain: [root, await sub1Of({ human_id: 'human:interop-other' })], error_contains: 'human_id' },
    { name: 'chain_out_of_order', chain: [sub1, root], error_contains: 'mandate[0]' },
    { name: 'not_yet_valid_at_verification_time', chain: [root, sub1], verification_time: '2026-01-15T00:00:00Z', error_contains: 'not yet valid' },
    { name: 'expired_at_verification_time', chain: [root, sub1], verification_time: '2098-06-01T00:00:00Z', error_contains: 'expired' },
    { name: 'malformed_sub_delegation', chain: [await signRoot(rootPayload({ sub_delegation: { permitted: true } })), sub1], error_contains: 'sub_delegation' },
    { name: 'duplicate_domain_in_child', chain: [root, await sub1Of({ authority_scope: [...email({}), ...email({ actions_permitted: ['send'] })] })], error_contains: 'authority_scope' },
  ];

  // Every vector gets the verdict the file promises, under this SDK.
  const at = (t: string) => new Date(t).getTime();
  for (const c of mustAccept) {
    const r = await verifyMandateChain(registry, c.chain as any, new Set(c.revoked_mandate_ids), keys, at(VERIFICATION_TIME));
    if (!r.valid || r.depth !== c.expected.depth || r.effective_tier !== c.expected.effective_tier) {
      throw new Error(`${c.name} must verify: ${JSON.stringify(r)}`);
    }
  }
  for (const c of mustReject) {
    const r = await verifyMandateChain(registry, c.chain as any, new Set(c.revoked_mandate_ids ?? []), keys, at(c.verification_time ?? VERIFICATION_TIME));
    if (r.valid || !r.errors.join('\n').toLowerCase().includes(c.error_contains)) {
      throw new Error(`${c.name} must be rejected with "${c.error_contains}": ${JSON.stringify(r.errors)}`);
    }
  }

  const tierFloorCases = [
    { name: 'floor_raises_routine_to_elevated', intent: ROUTINE_INTENT, policy_decision: { risk_score: 0 }, mandate_chain_tier: 'elevated' },
    { name: 'floor_below_the_tier_changes_nothing', intent: MAXIMUM_INTENT, policy_decision: { risk_score: 0 }, mandate_chain_tier: 'routine' },
    { name: 'floor_equal_to_the_tier_changes_nothing', intent: ROUTINE_INTENT, policy_decision: { risk_score: 0 }, mandate_chain_tier: 'routine' },
    { name: 'no_floor', intent: ROUTINE_INTENT, policy_decision: { risk_score: 0 }, mandate_chain_tier: null },
    { name: 'floor_with_explicit_intent_tier_takes_the_greater', intent: { ...ROUTINE_INTENT, security_tier: 'standard' }, policy_decision: { risk_score: 0 }, mandate_chain_tier: 'elevated' },
    { name: 'floor_without_policy_decision', intent: ROUTINE_INTENT, policy_decision: null, mandate_chain_tier: 'maximum' },
    { name: 'unknown_floor_fails_closed_to_elevated', intent: ROUTINE_INTENT, policy_decision: { risk_score: 0 }, mandate_chain_tier: 'ultra' },
  ].map((c) => ({ ...c, expected: computeSecurityTier(c.intent as any, c.policy_decision, c.mandate_chain_tier as any) }));

  const out = {
    _description:
      'Cross-SDK DCP-09 §3.5 mandate chain vectors. Every chain verifier MUST accept each must_accept chain (root first), verified at verification_time against keys (the human principal keys and each delegating agent keys by agent_id) with revoked_mandate_ids revoked, and report expected.depth and expected.effective_tier (the greatest minimum_security_tier along the chain, null when none sets one). It MUST reject each must_reject chain, at its own verification_time when it has one, with an error that contains error_contains (case-insensitive). tier_floor gives the security tier (DCP-AI v2.0 §14.2) computeSecurityTier returns for an intent, a policy decision and a mandate chain effective tier, which can only raise the tier.',
    _generator: 'sdks/typescript/src/__tests__/generate-mandate-chain-vectors.ts',
    _generated_at: new Date().toISOString(),
    verification_time: VERIFICATION_TIME,
    keys,
    must_accept: mustAccept,
    must_reject: mustReject,
    tier_floor: { cases: tierFloorCases },
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH}: ${mustAccept.length} must_accept, ${mustReject.length} must_reject, ${tierFloorCases.length} tier_floor cases`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
