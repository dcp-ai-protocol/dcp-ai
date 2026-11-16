/**
 * Mandate acknowledgment vectors (MP-02 F4; docs/reviews/mp02-acknowledgment-design.md v0.2 § 11).
 *
 * Writes tests/interop/v2/mandate_acknowledgment_vectors.json: a self-contained composition (bundles, mandates,
 * trust set, profiles, policies, revocation snapshots), awareness thresholds and acknowledgments, and cases that
 * give the evidence, the acknowledgments, the thresholds, the operator configuration and the outcome every SDK
 * MUST produce: whether the composition is admitted, the activation, the ordered list of codes (design § 7.2) and
 * which acknowledgments verify. Expected outcomes are written here by hand, from the design; the generator only
 * checks that the TypeScript SDK produces them, and fails without writing anything otherwise.
 *
 * Every key is generated for the run and only public keys are written; times are fixed. No earlier vector file is
 * read or written.
 *
 * Run (local dependencies only), from sdks/typescript:
 *   node --input-type=module -e "import { runnerImport } from 'vite'; await runnerImport('./src/__tests__/generate-mandate-acknowledgment-vectors.ts')"
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { SlhDsa192fProvider } from '../providers/slh-dsa-192f.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS, MANDATE_ACKNOWLEDGMENT_CONTEXT, domainSeparatedMessage } from '../core/domain-separation.js';
import type { DcpContext } from '../core/domain-separation.js';
import { classicalOnlySign, compositeSign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import type { CompositeSignature } from '../core/composite-sig.js';
import { preparePayload } from '../core/signed-payload.js';
import { sha256Hex } from '../core/dual-hash.js';
import { generateSessionNonce } from '../core/session-nonce.js';
import { experimentalCandidateIngress } from '../core/experimental-candidate-ingress.js';
import { BundleBuilderV2 } from '../bundle/builder-v2.js';
import { signBundleV2 } from '../bundle/signer-v2.js';
import { DEFAULT_VERIFIER_POLICY, PQ_ONLY_VERIFIER_POLICY } from '../core/verify-v2.js';
import { admitDelegatedBundleV2, type DelegatedOperator } from '../core/delegated-admission.js';
import { createMandateAcknowledgment, evaluateDelegationActivationV2, chainHashes, mandateHash } from '../core/mandate-acknowledgment.js';
import type { AgentPassportV2, AuditEventV2, IntentV2, KeyEntry, PolicyDecisionV2, ResponsiblePrincipalRecordV2, SignedBundleV2, VerifierPolicy } from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../../../../tests/interop/v2/mandate_acknowledgment_vectors.json');

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
const slhDsa = new SlhDsa192fProvider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);
registry.registerSigner(slhDsa);

const VERIFIER_ID = 'verifier:acme-api';
const PRINCIPAL = 'human:acme-ops';
const ORCH = 'agent:acme-orchestrator';
const SUB = 'agent:acme-subagent';
const TOOL = 'agent:acme-tool';
const AGENTS = [ORCH, SUB, TOOL];

const ISSUED = Date.parse('2026-11-07T10:00:00Z');
const NOW = ISSUED + 60_000;
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const t = (s: unknown) => Date.parse(s as string);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const utf8 = (v: unknown) => new TextEncoder().encode(canonicalizeV2(v));
const sha256Of = (obj: unknown) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(obj), 'utf8'))}`;

type Rec = Record<string, unknown>;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const unsigned = (r: Rec): Rec => {
  const { composite_sig: _s, ...p } = r;
  return p;
};

const ALL_KIDS: string[] = [];
async function generateKeys(pq: 'ml-dsa-65' | 'slh-dsa-192f' = 'ml-dsa-65'): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await (pq === 'ml-dsa-65' ? mlDsa65 : slhDsa).generateKeypair();
  ALL_KIDS.push(c.kid, p.kid);
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: pq, secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const keyEntries = (keys: CompositeKeyPair): KeyEntry[] =>
  [keys.classical, keys.pq].map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: '2026-10-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z', status: 'active' }));

async function signArtifact<T>(payload: T, context: DcpContext, keys: CompositeKeyPair) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
}

async function buildBundle(agentId: string, principalKeys: CompositeKeyPair, agentKeys: CompositeKeyPair, passportKeys: KeyEntry[]): Promise<SignedBundleV2> {
  const nonce = generateSessionNonce();
  const rpr: ResponsiblePrincipalRecordV2 = {
    dcp_version: '2.0', human_id: PRINCIPAL, session_nonce: nonce, legal_name: 'Acme Operations', entity_type: 'organization',
    jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true, issued_at: '2026-10-01T00:00:00Z',
    expires_at: null, contact: null, binding_keys: keyEntries(principalKeys),
  };
  const passport: AgentPassportV2 = {
    dcp_version: '2.0', agent_id: agentId, session_nonce: nonce, keys: passportKeys, principal_binding_reference: PRINCIPAL,
    capabilities: ['api_call'], risk_tier: 'medium', created_at: '2026-10-01T00:00:00Z', status: 'active',
  };
  const intent: IntentV2 = {
    dcp_version: '2.0', intent_id: 'intent:acme-001', session_nonce: nonce, agent_id: agentId, human_id: PRINCIPAL,
    timestamp: iso(ISSUED + 1_000), action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  };
  const policyDecision: PolicyDecisionV2 = {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 100,
    reasons: ['Routine API call'], required_confirmation: null, applied_policy_hash: sha256Of({ policy: 'acme' }), timestamp: iso(ISSUED + 2_000),
  };
  const audit: AuditEventV2 = {
    dcp_version: '2.0', audit_id: 'audit:acme-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
    timestamp: iso(ISSUED + 3_000), agent_id: agentId, human_id: PRINCIPAL, intent_id: intent.intent_id, intent_hash: sha256Of(intent),
    policy_decision: 'approved', outcome: 'api_called', evidence: { tool: 'http', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
  };
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await signArtifact(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principalKeys))
    .agentPassport(await signArtifact(passport, DCP_CONTEXTS.AgentPassport, agentKeys))
    .intent(await signArtifact(intent, DCP_CONTEXTS.Intent, agentKeys))
    .policyDecision(await signArtifact(policyDecision, DCP_CONTEXTS.PolicyDecision, agentKeys))
    .addAuditEntries([audit])
    .build();
  Object.assign(bundle.manifest, { session_issued_at: iso(ISSUED), session_expires_at: iso(ISSUED + 300_000), intended_verifier: VERIFIER_ID });
  return signBundleV2(bundle, { registry, signerType: 'organization', signerId: PRINCIPAL, keys: principalKeys });
}

const providerOf = (alg: string) => (alg === 'ed25519' ? ed25519 : alg === 'ml-dsa-65' ? mlDsa65 : slhDsa);

/** A pq_over_classical signature whose classical component is invalid and whose PQ component verifies over it. */
async function badClassical(payload: Rec, context: string, keys: CompositeKeyPair): Promise<CompositeSignature> {
  const dsm = domainSeparatedMessage(context, utf8(payload));
  const classical = await ed25519.sign(dsm, keys.classical.secretKeyB64);
  classical[0] ^= 1;
  const message = new Uint8Array(dsm.length + classical.length);
  message.set(dsm);
  message.set(classical, dsm.length);
  const pq = await providerOf(keys.pq.alg).sign(message, keys.pq.secretKeyB64);
  return { classical: { alg: 'ed25519', kid: keys.classical.kid, sig_b64: b64(classical) }, pq: { alg: keys.pq.alg, kid: keys.pq.kid, sig_b64: b64(pq) }, binding: 'pq_over_classical' };
}

const flipB64 = (s: string, at: number) => {
  const bytes = Buffer.from(s, 'base64');
  bytes[at] ^= 1;
  return bytes.toString('base64');
};
/** The same bytes in a non-canonical encoding: non-zero trailing bits before the padding (V2-5). */
function nonCanonicalB64(s: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const at = s.indexOf('=') - 1;
  return s.slice(0, at) + alphabet[alphabet.indexOf(s[at]) | 1] + s.slice(at + 1);
}

interface Expected {
  composition_admitted: boolean;
  activation: 'not_evaluated' | 'evaluated';
  delegation_active: boolean;
  /** Ordered, design § 7.2. */
  codes: string[];
  /** One per mandate when evaluated; empty when not evaluated. */
  verified: boolean[];
}

interface Case {
  name: string;
  group: string;
  rule: string;
  leaf: string;
  chain: string[];
  delegators: string[];
  /** Names in `acknowledgments`, in this order; or a JSON value that is not an array. */
  acknowledgments: string[] | { not_an_array: unknown };
  awareness_thresholds: string[] | { not_an_array: unknown };
  profile: string | null;
  policy: string | null;
  max_revocation_age_seconds: number | null;
  trust: string;
  revocation: string;
  mandate_revocation: string;
  expected: Expected;
}

async function main() {
  // ── Keys ──
  const P = await generateKeys(); // the principal: RPR, bundles and the root mandates
  const orchK = await generateKeys(); // the orchestrator's bundle artifacts, its sub-mandate, its acknowledgments
  const orchAck = await generateKeys(); // only acknowledgments
  const orchThr = await generateKeys(); // only thresholds
  const orchSlh = await generateKeys('slh-dsa-192f'); // only SLH-DSA acknowledgments or thresholds
  const subK = await generateKeys();
  const toolK = await generateKeys();
  const passportOf: Record<string, KeyEntry[]> = {
    [ORCH]: [...keyEntries(orchK), ...keyEntries(orchAck), ...keyEntries(orchThr), ...keyEntries(orchSlh)],
    [SUB]: keyEntries(subK),
    [TOOL]: keyEntries(toolK),
  };

  // ── Bundles ──
  const signed_bundles: Record<string, SignedBundleV2> = {
    orch: await buildBundle(ORCH, P, orchK, passportOf[ORCH]),
    sub: await buildBundle(SUB, P, subK, passportOf[SUB]),
    tool: await buildBundle(TOOL, P, toolK, passportOf[TOOL]),
  };

  // ── Mandates ──
  const WINDOW = { valid_from: '2026-11-01T00:00:00Z', valid_until: '2027-11-01T00:00:00Z' };
  const scope = (max: number, actions: string[]) => [{ domain: 'procurement', actions_permitted: actions, data_classes: ['company_confidential'], limits: { max_order: max } }];
  const rootPayload = (over: Rec = {}): Rec => ({
    dcp_version: '2.0', mandate_id: 'mandate:acme-root', session_nonce: generateSessionNonce(), human_id: PRINCIPAL, agent_id: ORCH,
    authority_scope: scope(10000, ['quote', 'order']), ...WINDOW, revocable: true, timestamp: '2026-11-01T00:00:00Z',
    sub_delegation: { permitted: true, max_depth: 2 }, ...over,
  });
  const signMandate = async (payload: Rec, context: DcpContext, keys: CompositeKeyPair, field: string) => ({ ...payload, [field]: await compositeSign(registry, context, utf8(payload), keys) });
  const mandates: Record<string, Rec> = {};
  mandates.root = await signMandate(rootPayload(), DCP_CONTEXTS.Delegation, P, 'human_composite_sig');
  mandates.sub = await signMandate({
    dcp_version: '2.0', mandate_id: 'mandate:acme-sub', session_nonce: generateSessionNonce(), human_id: PRINCIPAL, agent_id: SUB,
    authority_scope: scope(5000, ['quote']), ...WINDOW, revocable: true, timestamp: '2026-11-02T00:00:00Z',
    parent_mandate_id: 'mandate:acme-root', delegation_depth: 1, sub_delegation: { permitted: true, max_depth: 2 },
  }, DCP_CONTEXTS.SubMandate, orchK, 'delegator_composite_sig');
  mandates.sub2 = await signMandate({
    dcp_version: '2.0', mandate_id: 'mandate:acme-sub2', session_nonce: generateSessionNonce(), human_id: PRINCIPAL, agent_id: TOOL,
    authority_scope: scope(1000, ['quote']), ...WINDOW, revocable: true, timestamp: '2026-11-03T00:00:00Z',
    parent_mandate_id: 'mandate:acme-sub', delegation_depth: 2,
  }, DCP_CONTEXTS.SubMandate, subK, 'delegator_composite_sig');
  // A mandate acknowledged before its validity starts (design § 6), and one whose validity ends just after now.
  mandates.root_future = await signMandate(rootPayload({ mandate_id: 'mandate:acme-root-future', valid_from: '2026-11-05T00:00:00Z' }), DCP_CONTEXTS.Delegation, P, 'human_composite_sig');
  mandates.root_short = await signMandate(rootPayload({ mandate_id: 'mandate:acme-root-short', valid_until: iso(NOW + 10_000) }), DCP_CONTEXTS.Delegation, P, 'human_composite_sig');
  const chainOf = (names: string[]) => names.map((n) => mandates[n]);

  // ── Thresholds ──
  const thresholds: Record<string, Rec> = {};
  const rules = (value: unknown = 5000) => [{ dimension: 'spend', operator: 'gt', value, action_if_triggered: 'escalate' }];
  const thresholdPayload = (mandate: string, id: string, over: Rec = {}): Rec => {
    const m = mandates[mandate];
    return {
      dcp_version: '2.0', threshold_id: id, session_nonce: m.session_nonce, agent_id: m.agent_id, human_id: m.human_id,
      threshold_rules: rules(), timestamp: iso(t(m.timestamp) + HOUR), ...over,
    };
  };
  const signThreshold = async (payload: Rec, keys: CompositeKeyPair, context: string = DCP_CONTEXTS.Awareness) =>
    ({ ...payload, composite_sig: await compositeSign(registry, context, utf8(payload), keys) });
  const keysOf: Record<string, CompositeKeyPair> = { [ORCH]: orchK, [SUB]: subK, [TOOL]: toolK };
  for (const [name, mandate] of [['thr_root', 'root'], ['thr_sub', 'sub'], ['thr_sub2', 'sub2'], ['thr_root_future', 'root_future'], ['thr_root_short', 'root_short']] as const) {
    thresholds[name] = await signThreshold(thresholdPayload(mandate, `threshold:${name}`), keysOf[mandates[mandate].agent_id as string]);
  }
  thresholds.thr_root_b = await signThreshold(thresholdPayload('root', 'threshold:thr_root_b'), orchK);
  thresholds.thr_root_at_mandate = await signThreshold(thresholdPayload('root', 'threshold:thr_root_at_mandate', { timestamp: mandates.root.timestamp }), orchK);
  thresholds.thr_root_early = await signThreshold(thresholdPayload('root', 'threshold:thr_root_early', { timestamp: iso(t(mandates.root.timestamp) - HOUR) }), orchK);
  thresholds.thr_root_slh = await signThreshold(thresholdPayload('root', 'threshold:thr_root_slh'), orchSlh);
  thresholds.thr_root_thrkey = await signThreshold(thresholdPayload('root', 'threshold:thr_root_thrkey'), orchThr);
  thresholds.thr_root_changed = await signThreshold(thresholdPayload('root', 'threshold:thr_root', { threshold_rules: [...rules(), { dimension: 'count', operator: 'gte', value: 10, action_if_triggered: 'notify' }] }), orchK);
  thresholds.thr_root_by_sub = await signThreshold(thresholdPayload('root', 'threshold:thr_root_by_sub', { agent_id: SUB }), subK);
  thresholds.thr_root_other_human = await signThreshold(thresholdPayload('root', 'threshold:thr_root_other_human', { human_id: 'human:acme-other' }), orchK);
  thresholds.thr_root_other_session = await signThreshold(thresholdPayload('root', 'threshold:thr_root_other_session', { session_nonce: mandates.sub.session_nonce }), orchK);
  thresholds.thr_root_ack_context = await signThreshold(thresholdPayload('root', 'threshold:thr_root_ack_context'), orchK, MANDATE_ACKNOWLEDGMENT_CONTEXT);
  thresholds.thr_root_bad_classical = { ...thresholdPayload('root', 'threshold:thr_root_bad_classical') };
  thresholds.thr_root_bad_classical.composite_sig = await badClassical(thresholds.thr_root_bad_classical, DCP_CONTEXTS.Awareness, orchK);
  thresholds.thr_root_classical_only = { ...thresholdPayload('root', 'threshold:thr_root_classical_only') };
  thresholds.thr_root_classical_only.composite_sig = await classicalOnlySign(registry, DCP_CONTEXTS.Awareness, utf8(thresholds.thr_root_classical_only), orchK.classical);
  thresholds.thr_root_max = await signThreshold(thresholdPayload('root', 'threshold:thr_root_max', {
    threshold_rules: [...rules(9007199254740991), { dimension: 'refund', operator: 'lt', value: -9007199254740991, action_if_triggered: 'block' }],
  }), orchK);
  // 4242 is written as 4242.0 in the file (an integral float, design § 2.1); the signature covers its canonical form, 4242.
  thresholds.thr_root_float = await signThreshold(thresholdPayload('root', 'threshold:thr_root_float', { threshold_rules: rules(4242) }), orchK);
  // The long-mantissa threshold: the host value is 1; its Go bytes are written in go_bytes_cases.
  thresholds.thr_root_one = await signThreshold(thresholdPayload('root', 'threshold:thr_root_one', { threshold_rules: rules(1) }), orchK);
  // Outside the domain: rejected by their form before any signature, which is over an in-domain value.
  for (const [name, value] of [['thr_root_2p53', 9007199254740992], ['thr_root_minus_2p53', -9007199254740992], ['thr_root_fraction', 1.5], ['thr_root_bool', true]] as const) {
    const signed = await signThreshold(thresholdPayload('root', `threshold:${name}`), orchK);
    thresholds[name] = { ...signed, threshold_rules: rules(value) };
  }

  // ── Acknowledgments ──
  const acknowledgments: Record<string, Rec> = {};
  const create = (chain: string[], threshold: string, keys: CompositeKeyPair, id: string, at: number) =>
    createMandateAcknowledgment(registry, keys, { mandateChain: chainOf(chain), awarenessThreshold: thresholds[threshold], acknowledgmentId: id, acknowledgedAt: iso(at) }) as unknown as Promise<Rec>;
  const at = (mandate: string, hours = 2) => t(mandates[mandate].timestamp) + hours * HOUR;
  acknowledgments.a_root = await create(['root'], 'thr_root', orchK, 'ack:acme-root', at('root'));
  acknowledgments.a_sub = await create(['root', 'sub'], 'thr_sub', subK, 'ack:acme-sub', at('sub'));
  acknowledgments.a_sub2 = await create(['root', 'sub', 'sub2'], 'thr_sub2', toolK, 'ack:acme-sub2', at('sub2'));
  acknowledgments.a_root_future = await create(['root_future'], 'thr_root_future', orchK, 'ack:acme-root-future', t('2026-11-03T00:00:00Z'));
  acknowledgments.a_root_b = await create(['root'], 'thr_root_b', orchK, 'ack:acme-root-b', at('root'));
  acknowledgments.a_root_slh = await create(['root'], 'thr_root', orchSlh, 'ack:acme-root-slh', at('root'));
  acknowledgments.a_root_thrslh = await create(['root'], 'thr_root_slh', orchK, 'ack:acme-root-thrslh', at('root'));
  acknowledgments.a_root_ackkey = await create(['root'], 'thr_root', orchAck, 'ack:acme-root-ackkey', at('root'));
  acknowledgments.a_root_thrkey = await create(['root'], 'thr_root_thrkey', orchK, 'ack:acme-root-thrkey', at('root'));
  acknowledgments.a_root_ackkey_thrkey = await create(['root'], 'thr_root_thrkey', orchAck, 'ack:acme-root-both', at('root'));
  acknowledgments.a_root_edges = await create(['root'], 'thr_root_at_mandate', orchK, 'ack:acme-root-edges', t(mandates.root.timestamp));
  acknowledgments.a_root_short_edge = await create(['root_short'], 'thr_root_short', orchK, 'ack:acme-root-short', NOW + 10_000);
  acknowledgments.a_root_t4_edge = await create(['root'], 'thr_root', orchK, 'ack:acme-root-t4', NOW + 30_000);
  acknowledgments.a_root_t5_edge = await create(['root'], 'thr_root', orchK, 'ack:acme-root-t5', t(mandates.sub.timestamp));
  acknowledgments.a_root_6_emoji = await create(['root'], 'thr_root', orchK, '😀😀😀😀😀😀', at('root'));
  for (const name of ['thr_root_max', 'thr_root_float', 'thr_root_one', 'thr_root_changed', 'thr_root_by_sub', 'thr_root_other_human', 'thr_root_other_session',
    'thr_root_ack_context', 'thr_root_bad_classical', 'thr_root_classical_only', 'thr_root_2p53', 'thr_root_minus_2p53', 'thr_root_fraction', 'thr_root_bool']) {
    // Each threshold's own acknowledgment, signed over its exact hash (the creation helper checks the threshold's form first).
    const u = thresholds[name];
    let hashable = true;
    try { canonicalizeV2(unsigned(u)); } catch { hashable = false; }
    // A threshold outside the domain has no hash; its acknowledgment names the hash of the in-domain threshold it was signed as.
    const thresholdHashOf = hashable ? sha256Of(unsigned(u)) : sha256Of(unsigned({ ...u, threshold_rules: rules() }));
    const payload = {
      dcp_version: '2.0', acknowledgment_format: 'dcp09-mandate-ack-v1', acknowledgment_id: `ack:${name}`, mandate_id: mandates.root.mandate_id,
      mandate_hash: mandateHash(mandates.root), chain_hash: chainHashes([mandates.root])[0], session_nonce: mandates.root.session_nonce,
      human_id: PRINCIPAL, agent_id: ORCH, awareness_threshold_id: u.threshold_id, awareness_threshold_hash: thresholdHashOf,
      acknowledged_at: iso(at('root')),
    };
    if (name === 'thr_root_changed') payload.awareness_threshold_hash = sha256Of(unsigned(thresholds.thr_root)); // the hash before the change
    acknowledgments[`a_${name}`] = { ...payload, composite_sig: await compositeSign(registry, MANDATE_ACKNOWLEDGMENT_CONTEXT, utf8(payload), orchK) };
  }

  // Re-signed by the right agent, so only the named property fails.
  const resign = async (base: string, edits: Rec, keys: CompositeKeyPair = orchK, context: string = MANDATE_ACKNOWLEDGMENT_CONTEXT) => {
    const payload = { ...unsigned(acknowledgments[base]), ...edits };
    return { ...payload, composite_sig: await compositeSign(registry, context, utf8(payload), keys) };
  };
  const signedForm = (m: Rec) => sha256Of(m);
  acknowledgments.a_root_hash_of_sub = await resign('a_root', { mandate_hash: mandateHash(mandates.sub) });
  acknowledgments.a_root_hash_signed_form = await resign('a_root', { mandate_hash: signedForm(mandates.root) });
  acknowledgments.a_sub_chain_reversed = await resign('a_sub', { chain_hash: sha256Of([mandateHash(mandates.sub), mandateHash(mandates.root)]) }, subK);
  acknowledgments.a_sub_chain_transplant = await resign('a_sub', { chain_hash: sha256Of([mandateHash(mandates.root_future), mandateHash(mandates.sub)]) }, subK);
  acknowledgments.a_root_nonce_of_sub = await resign('a_root', { session_nonce: mandates.sub.session_nonce });
  acknowledgments.a_root_other_human = await resign('a_root', { human_id: 'human:acme-other' });
  acknowledgments.a_root_agent_sub = await resign('a_root', { agent_id: SUB });
  acknowledgments.a_root_other_mandate_id = await resign('a_root', { mandate_id: 'mandate:acme-other' });
  acknowledgments.a_sub_same_id = await resign('a_sub', { acknowledgment_id: 'ack:acme-root' }, subK);
  acknowledgments.a_sub_names_thr_root = await resign('a_sub', { awareness_threshold_id: thresholds.thr_root.threshold_id, awareness_threshold_hash: sha256Of(unsigned(thresholds.thr_root)) }, subK);
  acknowledgments.a_root_awareness_context = await resign('a_root', {}, orchK, DCP_CONTEXTS.Awareness);
  acknowledgments.a_root_delegation_context = await resign('a_root', {}, orchK, DCP_CONTEXTS.Delegation);
  acknowledgments.a_root_submandate_context = await resign('a_root', {}, orchK, DCP_CONTEXTS.SubMandate);
  acknowledgments.a_root_by_sub = await resign('a_root', {}, subK);
  acknowledgments.a_root_by_principal = await resign('a_root', {}, P);
  const sigOf = (name: string) => acknowledgments[name].composite_sig as CompositeSignature;
  acknowledgments.a_root_pq_altered = { ...acknowledgments.a_root, composite_sig: { ...sigOf('a_root'), pq: { ...sigOf('a_root').pq!, sig_b64: flipB64(sigOf('a_root').pq!.sig_b64, 100) } } };
  acknowledgments.a_root_classical_altered = { ...acknowledgments.a_root, composite_sig: { ...sigOf('a_root'), classical: { ...sigOf('a_root').classical, sig_b64: flipB64(sigOf('a_root').classical.sig_b64, 10) } } };
  acknowledgments.a_root_bad_classical = { ...acknowledgments.a_root, composite_sig: await badClassical(unsigned(acknowledgments.a_root), MANDATE_ACKNOWLEDGMENT_CONTEXT, orchK) };
  acknowledgments.a_root_classical_only = { ...acknowledgments.a_root, composite_sig: await classicalOnlySign(registry, MANDATE_ACKNOWLEDGMENT_CONTEXT, utf8(unsigned(acknowledgments.a_root)), orchK.classical) };
  acknowledgments.a_root_pq_null = { ...acknowledgments.a_root, composite_sig: { ...sigOf('a_root'), pq: null } };
  acknowledgments.a_root_kid_of_pq_key = { ...acknowledgments.a_root, composite_sig: { ...sigOf('a_root'), classical: { ...sigOf('a_root').classical, kid: orchK.pq.kid } } };
  acknowledgments.a_root_extra_member = await resign('a_root', { note: 'extra' });
  acknowledgments.a_root_5_emoji = await resign('a_root', { acknowledgment_id: '😀😀😀😀😀' });
  acknowledgments.a_root_nonce_upper = await resign('a_root', { session_nonce: (mandates.root.session_nonce as string).toUpperCase() });
  acknowledgments.a_root_not_rfc3339 = await resign('a_root', { acknowledged_at: '2026-11-01T02:00:00' });
  acknowledgments.a_root_noncanonical_b64 = { ...acknowledgments.a_root, composite_sig: { ...sigOf('a_root'), classical: { ...sigOf('a_root').classical, sig_b64: nonCanonicalB64(sigOf('a_root').classical.sig_b64) } } };
  // Time: T1 to T5, each at 1 ms past its limit.
  acknowledgments.a_root_t1 = await resign('a_thr_root_max', { awareness_threshold_id: thresholds.thr_root_early.threshold_id, awareness_threshold_hash: sha256Of(unsigned(thresholds.thr_root_early)), acknowledgment_id: 'ack:acme-root-t1', acknowledged_at: iso(t(mandates.root.timestamp) - 1) });
  acknowledgments.a_root_t2 = await resign('a_root', { acknowledgment_id: 'ack:acme-root-t2', acknowledged_at: iso(t(thresholds.thr_root.timestamp) - 1) });
  acknowledgments.a_root_short_t3 = await resign('a_root_short_edge', { acknowledged_at: iso(NOW + 10_001) });
  acknowledgments.a_root_t4 = await resign('a_root', { acknowledgment_id: 'ack:acme-root-t4b', acknowledged_at: iso(NOW + 30_001) });
  acknowledgments.a_root_t5 = await resign('a_root', { acknowledgment_id: 'ack:acme-root-t5b', acknowledged_at: iso(t(mandates.sub.timestamp) + 1) });
  acknowledgments.a_root_t5_and_nonce = await resign('a_root_t5', { session_nonce: mandates.sub.session_nonce });
  acknowledgments.a_sub_t1 = await resign('a_sub', { acknowledged_at: iso(t(mandates.sub.timestamp) - 1) }, subK);
  acknowledgments.a_sub_nonce_and_chain = await resign('a_sub', { session_nonce: mandates.root.session_nonce, chain_hash: sha256Of([mandateHash(mandates.sub), mandateHash(mandates.root)]) }, subK);
  acknowledgments.a_root_slh_by_sub = await resign('a_root_thrslh', {}, subK);

  // ── Operator configuration ──
  const trustPair = (keys: CompositeKeyPair) => [keys.classical, keys.pq].map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, status: 'active' }));
  const trust_sets = { base: { trust_set_version: '2026-11-07.f4', principals: [{ human_id: PRINCIPAL, keys: trustPair(P) }] } };
  const profiles = {
    strict: { profile: 'strict-v1', verifier_id: VERIFIER_ID },
    strict_ml_dsa_only: { profile: 'strict-v1', verifier_id: VERIFIER_ID, verifier_policy: { accepted_pq_algs: ['ml-dsa-65'] } },
    strict_slh_advisory: { profile: 'strict-v1', verifier_id: VERIFIER_ID, verifier_policy: { advisory_rejected_algs: ['slh-dsa-192f'] } },
  };
  const policies: Record<string, VerifierPolicy> = {
    pq_only: PQ_ONLY_VERIFIER_POLICY,
    pq_only_classical_advisory: { ...PQ_ONLY_VERIFIER_POLICY, advisory_rejected_algs: ['ed25519'] },
    weak_classical: { ...DEFAULT_VERIFIER_POLICY, default_mode: 'classical_only', risk_overrides: { low: 'classical_only', medium: 'classical_only', high: 'classical_only' } },
  };
  const CHECKED = iso(NOW - 10_000);
  const kids = [...ALL_KIDS].sort();
  const snapshot = (over: { agents?: Record<string, string>; keys?: Record<string, string>; drop?: string[] } = {}) => ({
    checked_at: CHECKED,
    agents: Object.fromEntries(AGENTS.map((a) => [a, over.agents?.[a] ?? 'not_revoked'])),
    keys: Object.fromEntries(kids.filter((k) => !(over.drop ?? []).includes(k)).map((k) => [k, over.keys?.[k] ?? 'not_revoked'])),
  });
  const revocations = {
    all_not_revoked: snapshot(),
    orch_revoked: snapshot({ agents: { [ORCH]: 'revoked' } }),
    ack_key_revoked: snapshot({ keys: { [orchAck.classical.kid]: 'revoked' } }),
    ack_key_unknown: snapshot({ keys: { [orchAck.pq.kid]: 'unknown' } }),
    ack_key_absent: snapshot({ drop: [orchAck.classical.kid] }),
    threshold_key_revoked: snapshot({ keys: { [orchThr.pq.kid]: 'revoked' } }),
    threshold_key_unknown: snapshot({ keys: { [orchThr.classical.kid]: 'unknown' } }),
    slh_key_revoked: snapshot({ keys: { [orchSlh.pq.kid]: 'revoked' } }),
    ack_revoked_and_threshold_unknown: snapshot({ keys: { [orchAck.classical.kid]: 'revoked', [orchThr.classical.kid]: 'unknown' } }),
  };
  const MANDATE_IDS = Object.values(mandates).map((m) => m.mandate_id as string);
  const mandateSnapshot = (over: Record<string, string> = {}) => ({ checked_at: CHECKED, mandates: Object.fromEntries(MANDATE_IDS.map((id) => [id, over[id] ?? 'not_revoked'])) });
  const mandate_revocations = { all_not_revoked: mandateSnapshot(), root_revoked: mandateSnapshot({ 'mandate:acme-root': 'revoked' }) };

  // ── Cases ──
  const C0 = { leaf: 'orch', chain: ['root'], delegators: [] as string[] };
  const C1 = { leaf: 'sub', chain: ['root', 'sub'], delegators: ['orch'] };
  const C2 = { leaf: 'tool', chain: ['root', 'sub', 'sub2'], delegators: ['orch', 'sub'] };
  const cases: Case[] = [];
  const add = (name: string, group: string, rule: string, io: Partial<Case> & Pick<Case, 'acknowledgments' | 'awareness_thresholds'>, expected: Expected) => {
    const policy = io.policy ?? null;
    cases.push({
      name, group, rule, ...C0,
      profile: policy ? null : 'strict', policy, max_revocation_age_seconds: policy ? 300 : null,
      trust: 'base', revocation: 'all_not_revoked', mandate_revocation: 'all_not_revoked',
      ...io,
      expected,
    });
  };
  const active = (n: number): Expected => ({ composition_admitted: true, activation: 'evaluated', delegation_active: true, codes: [], verified: new Array(n).fill(true) });
  const fails = (codes: string[], verified: boolean[]): Expected => ({ composition_admitted: true, activation: 'evaluated', delegation_active: false, codes, verified });
  const notEvaluated = (admitted: boolean, codes: string[] = []): Expected => ({ composition_admitted: admitted, activation: 'not_evaluated', delegation_active: false, codes, verified: [] });
  const r0 = { acknowledgments: ['a_root'], awareness_thresholds: ['thr_root'] };
  const r1 = { ...C1, acknowledgments: ['a_root', 'a_sub'], awareness_thresholds: ['thr_root', 'thr_sub'] };
  const single = (ack: string, threshold = 'thr_root', over: Partial<Case> = {}) => ({ acknowledgments: [ack], awareness_thresholds: [threshold], ...over });

  // POS
  add('root_only', 'POS', 'design 4: one mandate, one acknowledgment', r0, active(1));
  add('depth_one', 'POS', 'design 4: every mandate acknowledged by its agent', r1, active(2));
  add('depth_two_any_order', 'POS', 'design 4: acknowledgments and thresholds in any order', { ...C2, acknowledgments: ['a_sub2', 'a_root', 'a_sub'], awareness_thresholds: ['thr_sub', 'thr_sub2', 'thr_root'] }, active(3));
  add('acknowledged_before_valid_from', 'POS', 'design 6: an acknowledgment may precede valid_from', { chain: ['root_future'], ...single('a_root_future', 'thr_root_future') }, active(1));
  add('pq_only', 'POS', 'design 5: pq_only applies the policy as F2', { ...r1, policy: 'pq_only' }, active(2));
  add('pq_only_classical_advisory', 'POS', 'design 5: pq_only skips the classical policy, as F2', { ...r1, policy: 'pq_only_classical_advisory' }, active(2));
  add('weak_classical_policy', 'POS', 'design 5: a classical_only policy does not lower the acknowledgment contract', { ...r1, policy: 'weak_classical' }, active(2));
  add('slh_acknowledgment', 'POS', 'design 5: ed25519 + slh-dsa-192f on the acknowledgment', single('a_root_slh'), active(1));
  add('slh_threshold', 'POS', 'design 5: ed25519 + slh-dsa-192f on the threshold', single('a_root_thrslh', 'thr_root_slh'), active(1));
  add('t1_t2_equal', 'POS', 'design 6: acknowledged_at equal to the mandate and threshold timestamps', single('a_root_edges', 'thr_root_at_mandate'), active(1));
  add('t3_equal', 'POS', 'design 6: acknowledged_at equal to valid_until', { chain: ['root_short'], ...single('a_root_short_edge', 'thr_root_short') }, active(1));
  add('t4_equal', 'POS', 'design 6: acknowledged_at equal to now plus 30 s', single('a_root_t4_edge'), active(1));
  add('t5_equal', 'POS', 'design 6: the parent acknowledgment at the sub-mandate timestamp', { ...C1, acknowledgments: ['a_root_t5_edge', 'a_sub'], awareness_thresholds: ['thr_root', 'thr_sub'] }, active(2));
  add('six_astral_code_points', 'POS', 'design 2: minLength counts code points', single('a_root_6_emoji'), active(1));
  add('safe_integer_limits', 'POS', 'design 2.1: +-(2^53 - 1)', single('a_thr_root_max', 'thr_root_max'), active(1));
  add('integral_float', 'POS', 'design 2.1: 4242.0 has an integer value (written as 4242.0)', single('a_thr_root_float', 'thr_root_float'), active(1));
  add('value_one', 'POS', 'design 2.2: the host value 1 (its long-mantissa Go bytes are in go_bytes_cases)', single('a_thr_root_one', 'thr_root_one'), active(1));

  // CARD
  add('no_acknowledgments', 'CARD', 'design 7.2 cardinality 1', { ...C1, acknowledgments: [], awareness_thresholds: [] }, fails(['ACK_MISSING', 'ACK_MISSING'], [false, false]));
  add('intermediate_missing', 'CARD', 'design 7.2 cardinality 1', { ...C2, acknowledgments: ['a_root', 'a_sub2'], awareness_thresholds: ['thr_root', 'thr_sub2'] }, fails(['ACK_MISSING'], [false, false, false]));
  add('two_for_one_mandate', 'CARD', 'design 7.2 cardinality 1', { acknowledgments: ['a_root', 'a_root_b'], awareness_thresholds: ['thr_root', 'thr_root_b'] }, fails(['ACK_DUPLICATE'], [false]));
  add('unexpected', 'CARD', 'design 7.2 cardinality 2', { acknowledgments: ['a_root', 'a_sub'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_UNEXPECTED'], [false]));
  add('repeated_acknowledgment_id', 'CARD', 'design 7.2 cardinality 3', { ...C1, acknowledgments: ['a_root', 'a_sub_same_id'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_DUPLICATE'], [false, false]));
  add('threshold_repeated', 'CARD', 'design 7.2 cardinality 4', { acknowledgments: ['a_root'], awareness_thresholds: ['thr_root', 'thr_root'] }, fails(['ACK_THRESHOLD_DUPLICATE'], [false]));
  add('threshold_missing', 'CARD', 'design 7.2 cardinality 5', { acknowledgments: ['a_root'], awareness_thresholds: [] }, fails(['ACK_THRESHOLD_MISSING'], [false]));
  add('threshold_reused', 'CARD', 'design 7.2 cardinality 6: one threshold per acknowledgment, within a call', { ...C1, acknowledgments: ['a_root', 'a_sub_names_thr_root'], awareness_thresholds: ['thr_root'] }, fails(['ACK_THRESHOLD_REUSED'], [false, false]));
  add('threshold_unexpected', 'CARD', 'design 7.2 cardinality 7', { acknowledgments: ['a_root'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_THRESHOLD_UNEXPECTED'], [false]));
  add('mandate_id_not_in_chain', 'CARD', 'design 4.4: mandate_id is the matching key', single('a_root_other_mandate_id'), fails(['ACK_MISSING', 'ACK_UNEXPECTED'], [false]));

  // BIND (re-signed: only the binding fails)
  add('mandate_hash_of_another', 'BIND', 'design 4.4 check 1', single('a_root_hash_of_sub'), fails(['ACK_MANDATE_MISMATCH'], [false]));
  add('mandate_hash_with_signature', 'BIND', 'design 2: the hash excludes the signature fields', single('a_root_hash_signed_form'), fails(['ACK_MANDATE_MISMATCH'], [false]));
  add('nonce_of_another_mandate', 'BIND', 'design 4.4 check 2', single('a_root_nonce_of_sub'), fails(['ACK_MANDATE_MISMATCH'], [false]));
  add('other_human', 'BIND', 'design 4.4 check 3', single('a_root_other_human'), fails(['ACK_MANDATE_MISMATCH'], [false]));
  add('other_agent', 'BIND', 'design 4.4 check 4', single('a_root_agent_sub'), fails(['ACK_MANDATE_MISMATCH'], [false]));
  add('chain_hash_reversed', 'BIND', 'design 4.4 check 5', { ...C1, acknowledgments: ['a_root', 'a_sub_chain_reversed'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_CHAIN_MISMATCH'], [true, false]));
  add('chain_transplanted', 'BIND', 'design 4.4 check 5: another root', { ...C1, acknowledgments: ['a_root', 'a_sub_chain_transplant'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_CHAIN_MISMATCH'], [true, false]));
  add('threshold_changed', 'BIND', 'design 4.4 check 6', single('a_thr_root_changed', 'thr_root_changed'), fails(['ACK_THRESHOLD_MISMATCH'], [false]));
  add('threshold_of_another_agent', 'BIND', 'design 4.4 check 7 (F4-4)', single('a_thr_root_by_sub', 'thr_root_by_sub'), fails(['ACK_THRESHOLD_MISMATCH'], [false]));
  add('threshold_of_another_human', 'BIND', 'design 4.4 check 8', single('a_thr_root_other_human', 'thr_root_other_human'), fails(['ACK_THRESHOLD_MISMATCH'], [false]));
  add('threshold_of_another_session', 'BIND', 'design 4.4 check 9', single('a_thr_root_other_session', 'thr_root_other_session'), fails(['ACK_THRESHOLD_MISMATCH'], [false]));

  // SIG
  add('under_awareness_context', 'SIG', 'design 2: the acknowledgment context', single('a_root_awareness_context'), fails(['ACK_SIGNATURE_INVALID'], [false]));
  add('under_delegation_context', 'SIG', 'design 2', single('a_root_delegation_context'), fails(['ACK_SIGNATURE_INVALID'], [false]));
  add('under_submandate_context', 'SIG', 'design 2', single('a_root_submandate_context'), fails(['ACK_SIGNATURE_INVALID'], [false]));
  add('pq_component_altered', 'SIG', 'design 4.2 C', single('a_root_pq_altered'), fails(['ACK_SIGNATURE_INVALID'], [false]));
  add('classical_component_altered', 'SIG', 'design 4.2 C: the PQ component covers the classical one', single('a_root_classical_altered'), fails(['ACK_SIGNATURE_INVALID'], [false]));
  add('classical_invalid_pq_resigned', 'SIG', 'design 5: the classical component is verified', single('a_root_bad_classical'), fails(['ACK_SIGNATURE_INVALID'], [false]));
  add('classical_invalid_pq_resigned_pq_only', 'SIG', 'design 5: the classical component is verified under pq_only too', { ...single('a_root_bad_classical'), policy: 'pq_only' }, fails(['ACK_SIGNATURE_INVALID'], [false]));
  add('threshold_classical_invalid_pq_resigned', 'SIG', 'design 5', single('a_thr_root_bad_classical', 'thr_root_bad_classical'), fails(['ACK_THRESHOLD_SIGNATURE_INVALID'], [false]));
  add('threshold_classical_invalid_pq_resigned_pq_only', 'SIG', 'design 5, under pq_only', { ...single('a_thr_root_bad_classical', 'thr_root_bad_classical'), policy: 'pq_only' }, fails(['ACK_THRESHOLD_SIGNATURE_INVALID'], [false]));
  add('threshold_under_acknowledgment_context', 'SIG', 'design 2: thresholds keep DCP-AI.v2.Awareness', single('a_thr_root_ack_context', 'thr_root_ack_context'), fails(['ACK_THRESHOLD_SIGNATURE_INVALID'], [false]));
  add('classical_only', 'SIG', 'design 2: the form requires pq_over_classical', single('a_root_classical_only'), fails(['ACK_FORM_INVALID'], [false]));
  add('pq_null', 'SIG', 'design 2: the form requires a PQ component', single('a_root_pq_null'), fails(['ACK_FORM_INVALID'], [false]));
  add('threshold_classical_only', 'SIG', 'design 2 (F4-3)', single('a_thr_root_classical_only', 'thr_root_classical_only'), fails(['ACK_THRESHOLD_INVALID'], [false]));
  add('root_acknowledged_by_sub', 'SIG', 'design 4.2 B: only the mandate agent\'s passport', single('a_root_by_sub'), fails(['ACK_KEY_UNKNOWN', 'ACK_KEY_UNKNOWN'], [false]));
  add('acknowledged_with_principal_key', 'SIG', 'design 4.2 B', single('a_root_by_principal'), fails(['ACK_KEY_UNKNOWN', 'ACK_KEY_UNKNOWN'], [false]));
  add('classical_names_pq_key', 'SIG', 'design 4.2 B: a key of another algorithm', single('a_root_kid_of_pq_key'), fails(['ACK_KEY_INVALID'], [false]));
  add('slh_not_accepted', 'SIG', 'design 5: the policy', { ...single('a_root_slh'), profile: 'strict_ml_dsa_only' }, fails(['ACK_ALGORITHM_REJECTED'], [false]));
  add('slh_advisory', 'SIG', 'design 5: an active advisory', { ...single('a_root_slh'), profile: 'strict_slh_advisory' }, fails(['ACK_ALGORITHM_REJECTED'], [false]));

  // TIME
  add('t1_before_mandate', 'TIME', 'design 6 T1', single('a_root_t1', 'thr_root_early'), fails(['ACK_TIME_INVALID'], [false]));
  add('t2_before_threshold', 'TIME', 'design 6 T2', single('a_root_t2'), fails(['ACK_TIME_INVALID'], [false]));
  add('t3_after_valid_until', 'TIME', 'design 6 T3', { chain: ['root_short'], ...single('a_root_short_t3', 'thr_root_short') }, fails(['ACK_TIME_INVALID'], [false]));
  add('t4_after_now', 'TIME', 'design 6 T4', single('a_root_t4'), fails(['ACK_TIME_INVALID'], [false]));
  add('t5_parent_after_child', 'TIME', 'design 6 T5, attributed to the parent', { ...C1, acknowledgments: ['a_root_t5', 'a_sub'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_TIME_INVALID'], [false, true]));

  // REV
  add('ack_only_key_revoked', 'REV', 'design 4.2 step 10', { ...single('a_root_ackkey'), revocation: 'ack_key_revoked' }, fails(['ACK_KEY_REVOKED'], [false]));
  add('ack_only_key_unknown', 'REV', 'design 4.2 step 10', { ...single('a_root_ackkey'), revocation: 'ack_key_unknown' }, fails(['ACK_KEY_REVOCATION_UNKNOWN'], [false]));
  add('ack_only_key_absent', 'REV', 'design 4.2 step 10', { ...single('a_root_ackkey'), revocation: 'ack_key_absent' }, fails(['ACK_KEY_REVOCATION_UNKNOWN'], [false]));
  add('threshold_only_key_revoked', 'REV', 'design 4.2 step 10', { ...single('a_root_thrkey', 'thr_root_thrkey'), revocation: 'threshold_key_revoked' }, fails(['ACK_KEY_REVOKED'], [false]));
  add('threshold_only_key_unknown', 'REV', 'design 4.2 step 10', { ...single('a_root_thrkey', 'thr_root_thrkey'), revocation: 'threshold_key_unknown' }, fails(['ACK_KEY_REVOCATION_UNKNOWN'], [false]));
  add('slh_ack_only_key_revoked', 'REV', 'design 4.2 step 10, SLH-DSA', { ...single('a_root_slh'), revocation: 'slh_key_revoked' }, fails(['ACK_KEY_REVOKED'], [false]));
  add('slh_threshold_only_key_revoked', 'REV', 'design 4.2 step 10, SLH-DSA', { ...single('a_root_thrslh', 'thr_root_slh'), revocation: 'slh_key_revoked' }, fails(['ACK_KEY_REVOKED'], [false]));
  const twoKids = [[orchAck.classical.kid, 'ACK_KEY_REVOKED'], [orchThr.classical.kid, 'ACK_KEY_REVOCATION_UNKNOWN']].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, c]) => c);
  add('two_keys_in_kid_order', 'MULTI', 'design 7.2: revocation by ascending kid', { ...single('a_root_ackkey_thrkey', 'thr_root_thrkey'), revocation: 'ack_revoked_and_threshold_unknown' }, fails(twoKids, [false]));

  // NOACT and PREC
  add('agent_revoked', 'NOACT', 'design 4.3: the composition is not admitted', { ...r0, revocation: 'orch_revoked' }, notEvaluated(false));
  add('mandate_revoked', 'NOACT', 'design 4.3', { ...r1, mandate_revocation: 'root_revoked' }, notEvaluated(false));
  add('leaf_mismatch', 'NOACT', 'design 4.3', { ...r0, leaf: 'sub' }, notEvaluated(false));
  add('acknowledgments_not_an_array', 'PREC', 'design 4.3: admitted composition, invalid container', { acknowledgments: { not_an_array: { a: 1 } }, awareness_thresholds: ['thr_root'] }, notEvaluated(true, ['ACK_INPUT_INVALID']));
  add('thresholds_not_an_array', 'PREC', 'design 4.3', { acknowledgments: ['a_root'], awareness_thresholds: { not_an_array: 'thr_root' } }, notEvaluated(true, ['ACK_INPUT_INVALID']));
  add('both_containers_invalid', 'PREC', 'design 7.2 snapshot: acknowledgments first', { acknowledgments: { not_an_array: null }, awareness_thresholds: { not_an_array: 1 } }, notEvaluated(true, ['ACK_INPUT_INVALID', 'ACK_INPUT_INVALID']));
  add('rejected_composition_invalid_container', 'PREC', 'design 4.3', { acknowledgments: { not_an_array: {} }, awareness_thresholds: ['thr_root'], revocation: 'orch_revoked' }, notEvaluated(false, ['ACK_INPUT_INVALID']));
  add('rejected_composition_malformed_acknowledgment', 'PREC', 'design 4.3: no ACK_ code when not evaluated', { ...single('a_root_extra_member'), revocation: 'orch_revoked' }, notEvaluated(false));
  add('form_stops_cardinality', 'PREC', 'design 7.2: form stops', { ...C1, acknowledgments: ['a_root_extra_member'], awareness_thresholds: ['thr_root'] }, fails(['ACK_FORM_INVALID'], [false, false]));
  add('form_acknowledgment_then_threshold', 'PREC', 'design 7.2 form: acknowledgments, then thresholds', { acknowledgments: ['a_root_extra_member'], awareness_thresholds: ['thr_root_fraction'] }, fails(['ACK_FORM_INVALID', 'ACK_THRESHOLD_INVALID'], [false]));

  // FORM and DOM
  add('extra_member', 'FORM', 'design 2: closed record', single('a_root_extra_member'), fails(['ACK_FORM_INVALID'], [false]));
  add('five_astral_code_points', 'FORM', 'design 2: minLength counts code points', single('a_root_5_emoji'), fails(['ACK_FORM_INVALID'], [false]));
  add('nonce_uppercase', 'FORM', 'design 2', single('a_root_nonce_upper'), fails(['ACK_FORM_INVALID'], [false]));
  add('instant_without_offset', 'FORM', 'design 2: the RFC 3339 subset', single('a_root_not_rfc3339'), fails(['ACK_FORM_INVALID'], [false]));
  add('signature_not_canonical_base64', 'FORM', 'design 2 (V2-5)', single('a_root_noncanonical_b64'), fails(['ACK_FORM_INVALID'], [false]));
  add('value_2p53', 'DOM', 'design 2.1', single('a_thr_root_2p53', 'thr_root_2p53'), fails(['ACK_THRESHOLD_INVALID'], [false]));
  add('value_minus_2p53', 'DOM', 'design 2.1', single('a_thr_root_minus_2p53', 'thr_root_minus_2p53'), fails(['ACK_THRESHOLD_INVALID'], [false]));
  add('value_fraction', 'DOM', 'design 2.1', single('a_thr_root_fraction', 'thr_root_fraction'), fails(['ACK_THRESHOLD_INVALID'], [false]));
  add('value_boolean', 'DOM', 'design 2.1', single('a_thr_root_bool', 'thr_root_bool'), fails(['ACK_THRESHOLD_INVALID'], [false]));

  // MULTI
  add('nonce_and_chain', 'MULTI', 'design 7.2: every failed check, in order', { ...C1, acknowledgments: ['a_root', 'a_sub_nonce_and_chain'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_MANDATE_MISMATCH', 'ACK_CHAIN_MISMATCH'], [true, false]));
  // a_sub_t1 is 1 ms before the sub-mandate, so also before its threshold (one hour after the mandate): T1 and T2.
  add('keys_then_time_of_next', 'MULTI', 'design 7.2: mandate by mandate', { ...C1, acknowledgments: ['a_root_by_sub', 'a_sub_t1'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_KEY_UNKNOWN', 'ACK_KEY_UNKNOWN', 'ACK_TIME_INVALID', 'ACK_TIME_INVALID'], [false, false]));
  add('invalid_parent_skips_t5', 'MULTI', 'design 4.2 step 9', { ...C1, acknowledgments: ['a_root_t5_and_nonce', 'a_sub'], awareness_thresholds: ['thr_root', 'thr_sub'] }, fails(['ACK_MANDATE_MISMATCH'], [false, true]));
  add('unexpected_and_threshold_repeated', 'MULTI', 'design 7.2 cardinality', { acknowledgments: ['a_root', 'a_sub'], awareness_thresholds: ['thr_root', 'thr_sub', 'thr_sub'] }, fails(['ACK_UNEXPECTED', 'ACK_THRESHOLD_DUPLICATE'], [false]));
  add('keys_and_policy', 'MULTI', 'design 7.2 B: keys, then policy', { ...single('a_root_slh_by_sub', 'thr_root_slh'), profile: 'strict_ml_dsa_only' }, fails(['ACK_KEY_UNKNOWN', 'ACK_KEY_UNKNOWN', 'ACK_ALGORITHM_REJECTED'], [false]));

  // ── Lone surrogates, as JSON text (design 2.1): parsed by the host SDKs; Rust records only that serde_json rejects the text ──
  const withText = (record: Rec, field: string, raw: string) => {
    const marker = '__F4_LONE_SURROGATE__';
    return JSON.stringify(field === 'dimension' ? { ...record, threshold_rules: [{ ...(record.threshold_rules as Rec[])[0], dimension: marker }] } : { ...record, [field]: marker }).replace(`"${marker}"`, `"${raw}"`);
  };
  const text_cases = [
    { name: 'threshold_lone_high_surrogate', base_case: 'root_only', replace: { container: 'awareness_thresholds', index: 0 }, text: withText(thresholds.thr_root, 'dimension', 'spend\\ud800'), expected_codes: ['ACK_THRESHOLD_INVALID'] },
    { name: 'threshold_lone_low_surrogate', base_case: 'root_only', replace: { container: 'awareness_thresholds', index: 0 }, text: withText(thresholds.thr_root, 'dimension', '\\udc00spend'), expected_codes: ['ACK_THRESHOLD_INVALID'] },
    { name: 'acknowledgment_id_lone_surrogate', base_case: 'root_only', replace: { container: 'acknowledgments', index: 0 }, text: withText(acknowledgments.a_root, 'acknowledgment_id', 'ack:acme\\ud83d'), expected_codes: ['ACK_FORM_INVALID'] },
  ];

  // ── Go's bytes contract (design 2.2): the value 1 written with a long mantissa; host SDKs read the host value 1 ──
  const oneText = JSON.stringify(thresholds.thr_root_one);
  if (oneText.split('"value":1,').length !== 2) throw new Error('the value 1 is not unique in thr_root_one');
  const go_bytes_cases = [{
    name: 'long_mantissa_value_one',
    base_case: 'value_one',
    replace: { container: 'awareness_thresholds', index: 0 },
    go_text: oneText.replace('"value":1,', `"value":1${'0'.repeat(5000)}e-5000,`),
    // Two explicit expectations, chosen by the real parse: this records no runtime's behavior as a requirement.
    expected_exact_value: 1,
    expected_canonical_of: 'awareness_thresholds.thr_root_one',
    expected_canonical_sha256: sha256Hex(Buffer.from(canonicalizeV2(thresholds.thr_root_one), 'utf8')),
    expectations: {
      parser_matches_canonical: {
        rule: 'json.Unmarshal of go_text reproduces the canonical bytes of the exact value: the base case',
        activation: 'evaluated', delegation_active: true, codes: [] as string[],
      },
      parser_differs_or_fails: {
        rule: 'json.Unmarshal of go_text differs from those canonical bytes or fails: a local parser fault (design 2.2)',
        activation: 'evaluated', delegation_active: false, codes: ['ACK_PARSER_MISMATCH'],
      },
    },
    port_requirement: 'Go decodes go_text with its real parser, compares CanonicalizeV2 of that value with the expected canonical bytes, and applies the expectation that condition selects; a private test decoder that alters the value exercises parser_differs_or_fails whatever the runtime does. Accepting either outcome without checking the condition is not allowed.',
    runtime_observation: 'docs/reviews/go-long-number-independent-results.json: go1.26.0 decodes this literal as 0. An observation of that runtime, not a requirement for later ones.',
  }];

  const dsmPayload = '{"acknowledgment":"vector"}';
  const domain_separation = {
    context: MANDATE_ACKNOWLEDGMENT_CONTEXT,
    payload_canonical: dsmPayload,
    dsm_hex: Buffer.from(domainSeparatedMessage(MANDATE_ACKNOWLEDGMENT_CONTEXT, new TextEncoder().encode(dsmPayload))).toString('hex'),
  };

  const vectors = {
    description:
      'Mandate acknowledgment (opt-in, DCP-09 3.3): the activation of a delegation evaluated over the delegated admission. Expected outcomes are written from the rules; the codes are an ordered list (design 7.2); messages are not compared.',
    design: 'docs/reviews/mp02-acknowledgment-design.md v0.2',
    generated_by: 'sdks/typescript/src/__tests__/generate-mandate-acknowledgment-vectors.ts',
    verifier_id: VERIFIER_ID,
    now: iso(NOW),
    domain_separation,
    signed_bundles,
    mandates,
    awareness_thresholds: thresholds,
    acknowledgments,
    trust_sets,
    profiles,
    policies,
    revocations,
    mandate_revocations,
    cases,
    text_cases,
    go_bytes_cases,
  };

  // ── Check every expected outcome against the TypeScript SDK, then write ──
  const failures: string[] = [];
  const container = (v: Case['acknowledgments'], from: Record<string, Rec>) => (Array.isArray(v) ? v.map((n) => copy(from[n])) : copy(v.not_an_array));
  const run = async (c: Case, replace?: { container: string; index: number; value: unknown }) => {
    const operator = {
      trust: copy(trust_sets[c.trust as 'base']),
      ...(c.profile ? { profile: copy(profiles[c.profile as keyof typeof profiles]) } : {}),
      ...(c.policy ? { policy: copy(policies[c.policy]) } : {}),
      ...(c.max_revocation_age_seconds !== null ? { maxRevocationAgeSeconds: c.max_revocation_age_seconds } : {}),
      revocation: copy(revocations[c.revocation as keyof typeof revocations]),
      mandateRevocation: copy(mandate_revocations[c.mandate_revocation as keyof typeof mandate_revocations]),
      now: NOW,
    } as unknown as DelegatedOperator;
    const evidence = {
      signedBundle: copy(signed_bundles[c.leaf]),
      mandateChain: c.chain.map((n) => copy(mandates[n])),
      delegatorBundles: c.delegators.map((n) => copy(signed_bundles[n])),
      acknowledgments: container(c.acknowledgments, acknowledgments),
      awarenessThresholds: container(c.awareness_thresholds, thresholds),
    };
    if (replace) (evidence[replace.container === 'acknowledgments' ? 'acknowledgments' : 'awarenessThresholds'] as unknown[])[replace.index] = replace.value;
    const result = await evaluateDelegationActivationV2(evidence, registry, operator);
    const f2 = await admitDelegatedBundleV2({ signedBundle: evidence.signedBundle, mandateChain: evidence.mandateChain, delegatorBundles: evidence.delegatorBundles }, registry, operator);
    if (JSON.stringify(result.composition) !== JSON.stringify(f2)) failures.push(`${c.name}: composition differs from admitDelegatedBundleV2`);
    if (result.action_authorized !== false) failures.push(`${c.name}: action_authorized`);
    return result;
  };
  for (const c of cases) {
    const result = await run(c);
    const got: Expected = {
      composition_admitted: result.composition.admitted,
      activation: result.activation,
      delegation_active: result.delegation_active,
      codes: result.errors.map((e) => e.code),
      verified: result.acknowledgments.map((a) => a.verified),
    };
    if (JSON.stringify(got) !== JSON.stringify(c.expected)) {
      failures.push(`${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(got)}; ${result.errors.map((e) => e.message).join(' | ')} ${result.composition.errors.map((e) => e.code).join(',')}`);
    }
  }
  for (const tc of text_cases) {
    const base = cases.find((c) => c.name === tc.base_case) as Case;
    const result = await run(base, { ...tc.replace, value: JSON.parse(tc.text) });
    const codes = result.errors.map((e) => e.code);
    if (JSON.stringify(codes) !== JSON.stringify(tc.expected_codes)) failures.push(`${tc.name}: got ${JSON.stringify(codes)}`);
  }
  for (const g of go_bytes_cases) {
    const scanned = experimentalCandidateIngress(new TextEncoder().encode(g.go_text));
    if (scanned.status !== 'accept' || Buffer.from(scanned.canonical).toString('utf8') !== canonicalizeV2(thresholds.thr_root_one)) failures.push(`${g.name}: the scanner's canonical of the Go bytes is not the host threshold's`);
  }

  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed; nothing written:\n${failures.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  let text = `${JSON.stringify(vectors, null, 2)}\n`;
  const floatMarker = '"value": 4242,';
  if (text.split(floatMarker).length !== 2) throw new Error('the integral float marker is not unique');
  text = text.replace(floatMarker, '"value": 4242.0,');
  writeFileSync(OUTPUT_PATH, text);
  console.log(`Wrote ${OUTPUT_PATH}: ${cases.length} cases, ${text_cases.length} text cases, ${go_bytes_cases.length} Go bytes case, ${Object.keys(acknowledgments).length} acknowledgments, ${Object.keys(thresholds).length} thresholds.`);
}

await main();
