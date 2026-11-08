/**
 * Delegated admission vectors (MP-02 F1; docs/reviews/mp02-security-composition-design.md v0.2 § 1 and § 7).
 *
 * Writes tests/interop/v2/delegated_admission_vectors.json: signed bundles, mandates, trust sets, profiles,
 * policies, revocation snapshots of agents and keys and of mandates, and cases that give the leaf bundle, the
 * chain, the delegator bundles, the operator configuration and the outcome every SDK MUST produce, with the
 * rule each case checks. Expected outcomes are written here by hand, from the design; the generator only
 * checks that the TypeScript SDK produces them, and fails without writing anything otherwise. Configuration
 * cases give an operator configuration that MUST be refused with the given code.
 *
 * Every key is generated for the run; times are fixed, so the vectors never expire. No earlier vector file is
 * read or written.
 *
 * Run (local dependencies only, no npx), from sdks/typescript:
 *   node --input-type=module -e "import { runnerImport } from 'vite'; await runnerImport('./src/__tests__/generate-delegated-admission-vectors.ts')"
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { SlhDsa192fProvider } from '../providers/slh-dsa-192f.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS, domainSeparatedMessage } from '../core/domain-separation.js';
import type { DcpContext } from '../core/domain-separation.js';
import { classicalOnlySign, compositeSign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import type { CompositeSignature } from '../core/composite-sig.js';
import { preparePayload } from '../core/signed-payload.js';
import { sha256Hex } from '../core/dual-hash.js';
import { generateSessionNonce } from '../core/session-nonce.js';
import { BundleBuilderV2 } from '../bundle/builder-v2.js';
import { signBundleV2, signBundleV2ClassicalOnly } from '../bundle/signer-v2.js';
import { DEFAULT_VERIFIER_POLICY, PQ_ONLY_VERIFIER_POLICY } from '../core/verify-v2.js';
import { AdmissionConfigError, admitSignedBundleV2 } from '../core/admission.js';
import { admitDelegatedBundleV2, type DelegatedOperator } from '../core/delegated-admission.js';
import type {
  AgentPassportV2,
  AuditEventV2,
  IntentV2,
  KeyEntry,
  PolicyDecisionV2,
  ResponsiblePrincipalRecordV2,
  SignedBundleV2,
  VerifierPolicy,
} from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../../../../tests/interop/v2/delegated_admission_vectors.json');

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
const slhDsa = new SlhDsa192fProvider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);
registry.registerSigner(slhDsa);

const VERIFIER_ID = 'verifier:acme-api';
const PRINCIPAL = 'human:acme-ops';
const OTHER_PRINCIPAL = 'human:other-org';
const ORCH = 'agent:acme-orchestrator';
const SUB = 'agent:acme-subagent';
const TOOL = 'agent:acme-tool';
const EXTRA = 'agent:acme-extra';
const AGENTS = [ORCH, SUB, TOOL, EXTRA];

const ISSUED = Date.parse('2026-11-07T10:00:00Z');
const NOW = ISSUED + 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const sha256Of = (obj: unknown) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(obj), 'utf8'))}`;

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

const keyEntries = (keys: CompositeKeyPair, expiresAt: string | null = null): KeyEntry[] =>
  [keys.classical, keys.pq].map((k) => ({
    kid: k.kid,
    alg: k.alg,
    public_key_b64: k.publicKeyB64,
    created_at: '2026-10-01T00:00:00Z',
    expires_at: expiresAt,
    status: 'active',
  }));

async function signArtifact<T>(payload: T, context: DcpContext, keys: CompositeKeyPair, classicalOnly = false) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  const composite_sig = classicalOnly
    ? await classicalOnlySign(registry, context, canonicalBytes, keys.classical)
    : await compositeSign(registry, context, canonicalBytes, keys);
  return { payload, payload_hash: payloadHash, composite_sig };
}

interface Variant {
  humanId?: string;
  /** Signs the RPR and the bundle. */
  principalKeys: CompositeKeyPair;
  bindingKeys: KeyEntry[];
  agentId: string;
  /** Signs the passport, the intent and the policy decision. */
  agentKeys: CompositeKeyPair;
  passportKeys: KeyEntry[];
  classicalOnly?: boolean;
  riskScore?: number;
  manifest?: Record<string, unknown>;
  /** Another session's nonce on the policy decision, validly signed and committed by the manifest: V2-4 rejects the mix. */
  policyNonce?: string;
}

async function build(v: Variant): Promise<SignedBundleV2> {
  const nonce = generateSessionNonce();
  const humanId = v.humanId ?? PRINCIPAL;
  const rpr: ResponsiblePrincipalRecordV2 = {
    dcp_version: '2.0',
    human_id: humanId,
    session_nonce: nonce,
    legal_name: 'Acme Operations',
    entity_type: 'organization',
    jurisdiction: 'US-CA',
    liability_mode: 'owner_responsible',
    override_rights: true,
    issued_at: '2026-10-01T00:00:00Z',
    expires_at: null,
    contact: null,
    binding_keys: v.bindingKeys,
  };
  const passport: AgentPassportV2 = {
    dcp_version: '2.0',
    agent_id: v.agentId,
    session_nonce: nonce,
    keys: v.passportKeys,
    principal_binding_reference: humanId,
    capabilities: ['api_call'],
    risk_tier: 'medium',
    created_at: '2026-10-01T00:00:00Z',
    status: 'active',
  };
  const intent: IntentV2 = {
    dcp_version: '2.0',
    intent_id: 'intent:acme-001',
    session_nonce: nonce,
    agent_id: v.agentId,
    human_id: humanId,
    timestamp: iso(ISSUED + 1_000),
    action_type: 'api_call',
    target: { channel: 'api', domain: 'api.example.com' },
    data_classes: ['none'],
    estimated_impact: 'low',
    requires_consent: false,
  };
  const policyDecision: PolicyDecisionV2 = {
    dcp_version: '2.0',
    intent_id: intent.intent_id,
    session_nonce: nonce,
    decision: 'approve',
    risk_score: v.riskScore ?? 100,
    reasons: ['Routine API call'],
    required_confirmation: null,
    applied_policy_hash: sha256Of({ policy: 'acme' }),
    timestamp: iso(ISSUED + 2_000),
  };
  const audit: AuditEventV2 = {
    dcp_version: '2.0',
    audit_id: 'audit:acme-001',
    session_nonce: nonce,
    prev_hash: 'GENESIS',
    hash_alg: 'sha256',
    timestamp: iso(ISSUED + 3_000),
    agent_id: v.agentId,
    human_id: humanId,
    intent_id: intent.intent_id,
    intent_hash: sha256Of(intent),
    policy_decision: 'approved',
    outcome: 'api_called',
    evidence: { tool: 'http', result_ref: null, evidence_hash: null },
    pq_checkpoint_ref: null,
  };
  const co = v.classicalOnly;
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await signArtifact(rpr, DCP_CONTEXTS.ResponsiblePrincipal, v.principalKeys, co))
    .agentPassport(await signArtifact(passport, DCP_CONTEXTS.AgentPassport, v.agentKeys, co))
    .intent(await signArtifact(intent, DCP_CONTEXTS.Intent, v.agentKeys, co))
    .policyDecision(await signArtifact(policyDecision, DCP_CONTEXTS.PolicyDecision, v.agentKeys, co))
    .addAuditEntries([audit])
    .build();
  if (v.policyNonce) {
    // The builder refuses mixed nonces; replace the signed decision after building, as a producer could.
    const other = await signArtifact({ ...policyDecision, session_nonce: v.policyNonce }, DCP_CONTEXTS.PolicyDecision, v.agentKeys, co);
    bundle.policy_decision = other;
    bundle.manifest.policy_hash = other.payload_hash;
  }
  Object.assign(
    bundle.manifest,
    { session_issued_at: iso(ISSUED), session_expires_at: iso(ISSUED + 300_000), intended_verifier: VERIFIER_ID },
    v.manifest,
  );
  const signer = { registry, signerType: 'organization' as const, signerId: humanId };
  return co
    ? await signBundleV2ClassicalOnly(bundle, { ...signer, key: v.principalKeys.classical })
    : await signBundleV2(bundle, { ...signer, keys: v.principalKeys });
}

type Mandate = Record<string, unknown>;

async function signMandate(payload: Mandate, context: DcpContext, keys: CompositeKeyPair, field: string): Promise<Mandate> {
  const bytes = new TextEncoder().encode(canonicalizeV2(payload));
  return { ...payload, [field]: await compositeSign(registry, context, bytes, keys) };
}

/** A pq_over_classical signature whose classical component is invalid and whose PQ component verifies over it. */
async function badClassicalSignature(payload: Mandate, context: DcpContext, keys: CompositeKeyPair): Promise<CompositeSignature> {
  const dsm = domainSeparatedMessage(context, new TextEncoder().encode(canonicalizeV2(payload)));
  const classical = await ed25519.sign(dsm, keys.classical.secretKeyB64);
  classical[0] ^= 1;
  const message = new Uint8Array(dsm.length + classical.length);
  message.set(dsm);
  message.set(classical, dsm.length);
  const pq = await mlDsa65.sign(message, keys.pq.secretKeyB64);
  return {
    classical: { alg: 'ed25519', kid: keys.classical.kid, sig_b64: b64(classical) },
    pq: { alg: 'ml-dsa-65', kid: keys.pq.kid, sig_b64: b64(pq) },
    binding: 'pq_over_classical',
  };
}

function withSig(m: Mandate, field: string, edit: (sig: CompositeSignature) => void): Mandate {
  const copy = JSON.parse(JSON.stringify(m)) as Mandate;
  edit(copy[field] as CompositeSignature);
  return copy;
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
  const index = alphabet.indexOf(s[at]);
  return s.slice(0, at) + alphabet[index | 1] + s.slice(at + 1);
}

const trustKey = (k: CompositeKeyPair['classical'], extra: Record<string, unknown> = {}) => ({
  kid: k.kid,
  alg: k.alg,
  public_key_b64: k.publicKeyB64,
  status: 'active',
  ...extra,
});
const trustPair = (keys: CompositeKeyPair, extra: Record<string, unknown> = {}) => [trustKey(keys.classical, extra), trustKey(keys.pq, extra)];

interface Expected {
  admitted: boolean;
  delegation_verified: boolean;
  codes: string[];
  security_tier?: string | null;
  verification_mode?: string | null;
  effective_floor?: string | null;
}

interface Case {
  name: string;
  group: string;
  rule: string;
  leaf: string;
  chain: string[];
  delegators: string[];
  profile: string | null;
  policy: string | null;
  max_revocation_age_seconds: number | null;
  trust: string;
  revocation: string | null;
  mandate_revocation: string | null;
  expected: Expected & { activation: 'not_evaluated'; delegation_active: false; action_authorized: false };
  /** The same leaf, policy and trust through admitSignedBundleV2, with no chain. */
  control_public_admitted?: boolean;
}

async function main() {
  // ── Keys ──
  const P = await generateKeys(); // the principal's bundle key
  const R = await generateKeys(); // a principal key that only signs mandates
  const Rslh = await generateKeys('slh-dsa-192f');
  const P2 = await generateKeys(); // the principal's rotated key
  const X = await generateKeys(); // in a trust set but not in the RPR
  const O = await generateKeys(); // another trusted principal
  const orchBundle = await generateKeys();
  const orchMandate = await generateKeys(); // signs sub-mandates only
  const orchSlh = await generateKeys('slh-dsa-192f');
  const orchNew = await generateKeys();
  const subKeys = await generateKeys();
  const toolKeys = await generateKeys();
  const extraKeys = await generateKeys();

  const binding = [...keyEntries(P), ...keyEntries(R), ...keyEntries(Rslh), ...keyEntries(P2)];
  const passportOf: Record<string, KeyEntry[]> = {
    [ORCH]: [...keyEntries(orchBundle, '2099-12-31T23:59:59Z'), ...keyEntries(orchMandate, '2099-12-31T23:59:59Z'), ...keyEntries(orchSlh, '2099-12-31T23:59:59Z')],
    [SUB]: keyEntries(subKeys, '2099-12-31T23:59:59Z'),
    [TOOL]: keyEntries(toolKeys, '2099-12-31T23:59:59Z'),
    [EXTRA]: keyEntries(extraKeys, '2099-12-31T23:59:59Z'),
  };
  const signingKeys: Record<string, CompositeKeyPair> = { [ORCH]: orchBundle, [SUB]: subKeys, [TOOL]: toolKeys, [EXTRA]: extraKeys };
  const agentBundle = (agentId: string, over: Partial<Variant> = {}) =>
    build({ principalKeys: P, bindingKeys: binding, agentId, agentKeys: signingKeys[agentId], passportKeys: passportOf[agentId], ...over });

  // ── Bundles ──
  const signed_bundles: Record<string, SignedBundleV2> = {
    orch: await agentBundle(ORCH),
    sub: await agentBundle(SUB),
    tool: await agentBundle(TOOL),
    extra: await agentBundle(EXTRA),
    orch_signed_by_rotated_principal_key: await agentBundle(ORCH, { principalKeys: P2 }),
    orch_standard_tier: await agentBundle(ORCH, { riskScore: 200 }),
    orch_classical_only: await agentBundle(ORCH, { classicalOnly: true }),
    orch_session_expired: await agentBundle(ORCH, { manifest: { session_issued_at: iso(NOW - 400_000), session_expires_at: iso(NOW - 100_000) } }),
    orch_other_audience: await agentBundle(ORCH, { manifest: { intended_verifier: 'verifier:someone-else' } }),
    orch_two_sessions: await agentBundle(ORCH, { policyNonce: generateSessionNonce() }),
    orch_other_principal: await build({
      humanId: OTHER_PRINCIPAL, principalKeys: O, bindingKeys: keyEntries(O), agentId: ORCH, agentKeys: orchBundle, passportKeys: passportOf[ORCH],
    }),
    orch_rotated_agent_keys: await agentBundle(ORCH, { passportKeys: keyEntries(orchNew, '2099-12-31T23:59:59Z'), agentKeys: orchNew }),
    orch_mandate_key_expired: await agentBundle(ORCH, {
      passportKeys: [...keyEntries(orchBundle, '2099-12-31T23:59:59Z'), ...keyEntries(orchMandate, '2026-11-01T00:00:00Z')],
    }),
    sub_shares_principal_key: await agentBundle(SUB, { passportKeys: [...passportOf[SUB], keyEntries(P)[0]] }),
    sub_shares_orch_key: await agentBundle(SUB, { passportKeys: [...passportOf[SUB], keyEntries(orchBundle)[0]] }),
    sub_kid_twice: await agentBundle(SUB, { passportKeys: [...passportOf[SUB], passportOf[SUB][0]] }),
  };

  // ── Mandates ──
  const WINDOW = { valid_from: '2026-11-01T00:00:00Z', valid_until: '2027-11-01T00:00:00Z' };
  const rootPayload = (over: Mandate = {}): Mandate => ({
    dcp_version: '2.0',
    mandate_id: 'mandate:acme-root',
    session_nonce: generateSessionNonce(),
    human_id: PRINCIPAL,
    agent_id: ORCH,
    authority_scope: [{ domain: 'procurement', actions_permitted: ['quote', 'order'], data_classes: ['company_confidential'], limits: { max_order: 10000 } }],
    ...WINDOW,
    revocable: true,
    timestamp: '2026-11-01T00:00:00Z',
    sub_delegation: { permitted: true, max_depth: 2 },
    ...over,
  });
  const subPayload = (over: Mandate = {}): Mandate => ({
    dcp_version: '2.0',
    mandate_id: 'mandate:acme-sub',
    session_nonce: generateSessionNonce(),
    human_id: PRINCIPAL,
    agent_id: SUB,
    authority_scope: [{ domain: 'procurement', actions_permitted: ['quote'], data_classes: ['company_confidential'], limits: { max_order: 5000 } }],
    ...WINDOW,
    revocable: true,
    timestamp: '2026-11-02T00:00:00Z',
    parent_mandate_id: 'mandate:acme-root',
    delegation_depth: 1,
    sub_delegation: { permitted: true, max_depth: 2 },
    ...over,
  });
  const sub2Payload = (over: Mandate = {}): Mandate => ({
    dcp_version: '2.0',
    mandate_id: 'mandate:acme-sub2',
    session_nonce: generateSessionNonce(),
    human_id: PRINCIPAL,
    agent_id: TOOL,
    authority_scope: [{ domain: 'procurement', actions_permitted: ['quote'], data_classes: [], limits: { max_order: 1000 } }],
    ...WINDOW,
    revocable: true,
    timestamp: '2026-11-03T00:00:00Z',
    parent_mandate_id: 'mandate:acme-sub',
    delegation_depth: 2,
    ...over,
  });
  const root = (keys: CompositeKeyPair, over: Mandate = {}, context: DcpContext = DCP_CONTEXTS.Delegation) =>
    signMandate(rootPayload(over), context, keys, 'human_composite_sig');
  const sub = (keys: CompositeKeyPair, over: Mandate = {}, context: DcpContext = DCP_CONTEXTS.SubMandate) =>
    signMandate(subPayload(over), context, keys, 'delegator_composite_sig');

  const rootByP = await root(P);
  const rootClassicalOnly = rootPayload();
  rootClassicalOnly.human_composite_sig = await classicalOnlySign(
    registry, DCP_CONTEXTS.Delegation, new TextEncoder().encode(canonicalizeV2(rootClassicalOnly)), P.classical,
  );
  const rootBadClassical = rootPayload();
  rootBadClassical.human_composite_sig = await badClassicalSignature(rootBadClassical, DCP_CONTEXTS.Delegation, P);
  const truncated = (s: string) => Buffer.from(s, 'base64').subarray(0, 63).toString('base64');

  const mandates: Record<string, Mandate> = {
    root: rootByP,
    root_floor_routine: await root(P, { minimum_security_tier: 'routine' }),
    root_floor_elevated: await root(P, { minimum_security_tier: 'elevated' }),
    root_floor_maximum: await root(P, { minimum_security_tier: 'maximum' }),
    root_by_mandate_only_key: await root(R),
    root_by_slh_key: await root(Rslh),
    root_by_key_not_in_rpr: await root(X),
    root_by_rotated_key: await root(P2),
    root_by_agent: await root(orchBundle),
    root_other_human_id: await root(P, { human_id: 'human:acme-other' }),
    root_expired: await root(P, { valid_from: '2026-10-01T00:00:00Z', valid_until: '2026-11-06T00:00:00Z' }),
    root_not_yet_valid: await root(P, { valid_from: '2026-11-08T00:00:00Z' }),
    root_bundle_context: await root(P, {}, DCP_CONTEXTS.Bundle),
    root_pq_invalid: withSig(rootByP, 'human_composite_sig', (s) => { s.pq!.sig_b64 = flipB64(s.pq!.sig_b64, 100); }),
    root_classical_invalid_pq_valid: rootBadClassical,
    root_classical_only: rootClassicalOnly,
    root_sig_not_canonical_b64: withSig(rootByP, 'human_composite_sig', (s) => { s.classical.sig_b64 = nonCanonicalB64(s.classical.sig_b64); }),
    root_sig_63_bytes: withSig(rootByP, 'human_composite_sig', (s) => { s.classical.sig_b64 = truncated(s.classical.sig_b64); }),
    root_dcp_version_2_1: await root(P, { dcp_version: '2.1' }),
    root_nonce_uppercase: await root(P, { session_nonce: generateSessionNonce().toUpperCase() }),
    root_scope_empty_action: await root(P, { authority_scope: [{ domain: 'procurement', actions_permitted: [''], data_classes: ['company_confidential'], limits: { max_order: 10000 } }] }),
    root_scope_empty_data_class: await root(P, { authority_scope: [{ domain: 'procurement', actions_permitted: ['quote', 'order'], data_classes: [''], limits: { max_order: 10000 } }] }),
    root_scope_unknown_member: await root(P, { authority_scope: [{ ...{ domain: 'procurement', actions_permitted: ['quote', 'order'], data_classes: ['company_confidential'], limits: { max_order: 10000 } }, note: 'not in the schema' }] }),
    root_sub_delegation_unknown_member: await root(P, { sub_delegation: { permitted: true, max_depth: 2, scope: 'all' } }),
    root_open_limits: await root(P, {
      authority_scope: [{ domain: 'procurement', actions_permitted: ['quote', 'order'], data_classes: ['company_confidential'], limits: { max_order: 10000, region: 'EU', approvers: ['cfo'], window: { days: 30, business_only: true } } }],
    }),
    sub: await sub(orchMandate),
    sub_signed_by_leaf: await sub(subKeys),
    sub_delegation_context: await sub(orchMandate, {}, DCP_CONTEXTS.Delegation),
    sub_lowers_floor: await sub(orchMandate, { minimum_security_tier: 'standard' }),
    sub_window_beyond_parent: await sub(orchMandate, { valid_until: '2028-01-01T00:00:00Z' }),
    sub_by_slh_key: await sub(orchSlh),
    sub_by_rotated_agent_key: await sub(orchNew),
    sub_same_id_as_root: await sub(orchMandate, { mandate_id: 'mandate:acme-root' }),
    sub2: await signMandate(sub2Payload(), DCP_CONTEXTS.SubMandate, subKeys, 'delegator_composite_sig'),
    sub2_back_to_orchestrator: await signMandate(sub2Payload({ agent_id: ORCH }), DCP_CONTEXTS.SubMandate, subKeys, 'delegator_composite_sig'),
  };
  mandates.root_floor_elevated_then_lower = mandates.root_floor_elevated;

  // ── Operator configuration ──
  const acme = (keys: Array<Record<string, unknown>>) => ({ human_id: PRINCIPAL, keys });
  const other = { human_id: OTHER_PRINCIPAL, keys: trustPair(O) };
  const trustSet = (version: string, acmeKeys: Array<Record<string, unknown>> | null) => ({
    trust_set_version: version,
    principals: [...(acmeKeys ? [acme(acmeKeys)] : []), other],
  });
  const PAST = '2026-11-01T00:00:00Z';
  const trust_sets = {
    base: trustSet('2026-11-07.1', [...trustPair(P), ...trustPair(R), ...trustPair(Rslh)]),
    rotation_overlap: trustSet('2026-11-07.2', [...trustPair(P), ...trustPair(P2), ...trustPair(R), ...trustPair(Rslh)]),
    old_key_retired: trustSet('2026-11-07.3', [...trustPair(P, { status: 'revoked' }), ...trustPair(P2), ...trustPair(R), ...trustPair(Rslh)]),
    without_mandate_only_key: trustSet('2026-11-07.4', [...trustPair(P), ...trustPair(Rslh)]),
    with_key_not_in_rpr: trustSet('2026-11-07.5', [...trustPair(P), ...trustPair(R), ...trustPair(Rslh), ...trustPair(X)]),
    mandate_only_key_revoked: trustSet('2026-11-07.6', [...trustPair(P), ...trustPair(R, { status: 'revoked' }), ...trustPair(Rslh)]),
    mandate_only_key_expired: trustSet('2026-11-07.7', [...trustPair(P), ...trustPair(R, { expires_at: PAST }), ...trustPair(Rslh)]),
    mandate_only_key_not_yet_valid: trustSet('2026-11-07.8', [...trustPair(P), ...trustPair(R, { not_before: '2026-11-08T00:00:00Z' }), ...trustPair(Rslh)]),
    without_principal: trustSet('2026-11-07.9', null),
    principal_retired: trustSet('2026-11-07.10', [...trustPair(P, { status: 'revoked' }), ...trustPair(R, { status: 'revoked' }), ...trustPair(Rslh, { status: 'revoked' })]),
  };
  const profiles = {
    strict: { profile: 'strict-v1', verifier_id: VERIFIER_ID },
    strict_ml_dsa_only: { profile: 'strict-v1', verifier_id: VERIFIER_ID, verifier_policy: { accepted_pq_algs: ['ml-dsa-65'] } },
    strict_slh_advisory: { profile: 'strict-v1', verifier_id: VERIFIER_ID, verifier_policy: { advisory_rejected_algs: ['slh-dsa-192f'] } },
  };
  const policies: Record<string, VerifierPolicy> = {
    weak_classical: {
      ...DEFAULT_VERIFIER_POLICY,
      default_mode: 'classical_only',
      risk_overrides: { low: 'classical_only', medium: 'classical_only', high: 'classical_only' },
    },
    pq_only: PQ_ONLY_VERIFIER_POLICY,
    pq_only_classical_advisory: { ...PQ_ONLY_VERIFIER_POLICY, advisory_rejected_algs: ['ed25519'] },
  };

  const CHECKED = iso(NOW - 10_000);
  const statuses = (ids: string[], over: Record<string, string> = {}, drop: string[] = []) =>
    Object.fromEntries(ids.filter((id) => !drop.includes(id)).map((id) => [id, over[id] ?? 'not_revoked']));
  const kids = [...ALL_KIDS].sort();
  const snapshot = (over: { agents?: Record<string, string>; keys?: Record<string, string>; drop?: string[]; checkedAt?: string } = {}) => ({
    checked_at: over.checkedAt ?? CHECKED,
    agents: statuses(AGENTS, over.agents),
    keys: statuses(kids, over.keys, over.drop),
  });
  const revocations = {
    all_not_revoked: snapshot(),
    orchestrator_revoked: snapshot({ agents: { [ORCH]: 'revoked' } }),
    submandate_key_absent: snapshot({ drop: [orchMandate.classical.kid, orchMandate.pq.kid] }),
    submandate_key_revoked: snapshot({ keys: { [orchMandate.classical.kid]: 'revoked' } }),
    mandate_only_key_revoked: snapshot({ keys: { [R.classical.kid]: 'revoked' } }),
    stale: snapshot({ checkedAt: iso(NOW - 301_000) }),
  };
  const MANDATE_IDS = ['mandate:acme-root', 'mandate:acme-sub', 'mandate:acme-sub2'];
  const mandateSnapshot = (over: Record<string, string> = {}, checkedAt = CHECKED) => ({ checked_at: checkedAt, mandates: statuses(MANDATE_IDS, over) });
  const mandate_revocations = {
    all_not_revoked: mandateSnapshot(),
    root_revoked: mandateSnapshot({ 'mandate:acme-root': 'revoked' }),
    intermediate_revoked: mandateSnapshot({ 'mandate:acme-sub': 'revoked' }),
    sub_unknown: mandateSnapshot({ 'mandate:acme-sub': 'unknown' }),
    stale: mandateSnapshot({}, iso(NOW - 301_000)),
  };

  // ── Cases ──
  const cases: Case[] = [];
  const add = (
    name: string,
    group: string,
    rule: string,
    io: Partial<Pick<Case, 'leaf' | 'chain' | 'delegators' | 'profile' | 'policy' | 'max_revocation_age_seconds' | 'trust' | 'revocation' | 'mandate_revocation' | 'control_public_admitted'>>,
    expected: Expected,
  ) => {
    const profile = io.policy !== undefined && io.profile === undefined ? null : io.profile ?? 'strict';
    cases.push({
      name,
      group,
      rule,
      leaf: io.leaf ?? 'orch',
      chain: io.chain ?? ['root'],
      delegators: io.delegators ?? [],
      profile,
      policy: io.policy ?? null,
      max_revocation_age_seconds: profile === null ? io.max_revocation_age_seconds ?? 300 : null,
      trust: io.trust ?? 'base',
      revocation: io.revocation === undefined ? 'all_not_revoked' : io.revocation,
      mandate_revocation: io.mandate_revocation === undefined ? 'all_not_revoked' : io.mandate_revocation,
      expected: { ...expected, activation: 'not_evaluated', delegation_active: false, action_authorized: false },
      ...(io.control_public_admitted !== undefined ? { control_public_admitted: io.control_public_admitted } : {}),
    });
  };
  const ok = (extra: Partial<Expected> = {}): Expected => ({ admitted: true, delegation_verified: true, codes: [], ...extra });
  const no = (codes: string[], delegationVerified = false): Expected => ({ admitted: false, delegation_verified: delegationVerified, codes });
  const depth1 = { leaf: 'sub', chain: ['root', 'sub'], delegators: ['orch'] };
  const depth2 = { leaf: 'tool', chain: ['root', 'sub', 'sub2'], delegators: ['orch', 'sub'] };

  // POS
  add('root_only', 'POS', 'design 1.3: a chain of the root alone, leaf = the root agent', {}, ok({ security_tier: 'routine', verification_mode: 'hybrid_required', effective_floor: null }));
  add('principal_orchestrator_subagent', 'POS', 'design 1.3: depth 1; mandate nonces differ from every bundle nonce (step 9)', depth1, ok());
  add('depth_two', 'POS', 'design 1.3: depth 2 with two delegator bundles', depth2, ok());
  add('rotation_overlap', 'POS', 'design 5: leaf signed by the new key, root by the old, both active in the trust set', { leaf: 'orch_signed_by_rotated_principal_key', trust: 'rotation_overlap' }, ok());
  add('floor_maximum_reported', 'POS', 'design 1.4: the floor raises the reported tier of a standard bundle', { leaf: 'orch_standard_tier', chain: ['root_floor_maximum'] }, ok({ security_tier: 'maximum', verification_mode: 'hybrid_required', effective_floor: 'maximum' }));
  add('open_limits_accepted', 'POS', 'schema: limits is an open object; the preflight adds no constraint to it', { chain: ['root_open_limits'] }, ok());
  add('agent_key_rotation', 'POS', 'design 5: the delegator signs with a key of its current passport', { leaf: 'sub', chain: ['root', 'sub_by_rotated_agent_key'], delegators: ['orch_rotated_agent_keys'] }, ok());

  // PISO
  add('floor_raises_weak_policy', 'PISO', 'design 1.4: a classical_only bundle the public API admits under a weak policy fails once the chain floor is elevated', { leaf: 'orch_classical_only', chain: ['root_floor_elevated'], policy: 'weak_classical', control_public_admitted: true }, no(['VERIFICATION_FAILED', 'DELEGATION_CHAIN_INVALID']));
  add('no_floor_weak_policy', 'PISO', 'design 1.4: the same bundle and policy with a chain without floor', { leaf: 'orch_classical_only', chain: ['root'], policy: 'weak_classical', control_public_admitted: true }, ok({ security_tier: 'routine', verification_mode: 'classical_only', effective_floor: null }));
  add('pq_only_stays_with_routine_floor', 'PISO', 'design 1.4: a routine floor never lowers pq_only', { chain: ['root_floor_routine'], policy: 'pq_only' }, ok({ security_tier: 'routine', verification_mode: 'pq_only', effective_floor: 'routine' }));
  add('sub_mandate_lowers_floor', 'PISO', 'DCP-09 3.5.2 rule 6', { leaf: 'sub', chain: ['root_floor_elevated', 'sub_lowers_floor'], delegators: ['orch'] }, no(['DELEGATION_CHAIN_INVALID']));

  // ALG
  add('root_algorithm_not_accepted', 'ALG', 'design 1.3 step 7: the root uses SLH-DSA-192f, which the policy does not accept; the bundle is ML-DSA-65', { chain: ['root_by_slh_key'], profile: 'strict_ml_dsa_only' }, no(['DELEGATION_ALGORITHM_REJECTED']));
  add('sub_algorithm_advisory', 'ALG', 'design 1.3 step 7: a sub-mandate signed with an algorithm an active advisory rejects', { ...depth1, chain: ['root', 'sub_by_slh_key'], profile: 'strict_slh_advisory' }, no(['DELEGATION_ALGORITHM_REJECTED']));
  add('pq_only_classical_advisory', 'ALG', 'design 1.3 step 7: under pq_only the classical entries of advisory_rejected_algs do not apply (as V2-10 Q1)', { policy: 'pq_only_classical_advisory' }, ok({ verification_mode: 'pq_only' }));
  add('pq_only_invalid_classical_component', 'ALG', 'design 1.3 step 7: under pq_only a mandate still needs a valid classical component (DCP-09 3.5.1)', { chain: ['root_classical_invalid_pq_valid'], policy: 'pq_only' }, no(['DELEGATION_CHAIN_INVALID']));

  // PRIN
  add('chain_human_id_differs', 'PRIN', 'design 1.3 steps 4 and 8', { chain: ['root_other_human_id'] }, no(['DELEGATION_PRINCIPAL_MISMATCH', 'TRUST_PRINCIPAL_UNKNOWN']));
  add('root_key_only_in_rpr', 'PRIN', 'design 1.3 step 8: a root key the RPR lists but the trust set does not', { chain: ['root_by_mandate_only_key'], trust: 'without_mandate_only_key' }, no(['TRUST_KEY_NOT_ANCHORED']));
  add('root_key_not_in_rpr', 'PRIN', 'DCP-09 3.5.2: root keys are the RPR binding_keys, even if the trust set lists the key', { chain: ['root_by_key_not_in_rpr'], trust: 'with_key_not_in_rpr' }, no(['DELEGATION_CHAIN_INVALID']));
  add('root_key_revoked_in_trust_set', 'PRIN', 'design 1.3 step 8 (T2)', { chain: ['root_by_mandate_only_key'], trust: 'mandate_only_key_revoked' }, no(['TRUST_KEY_REVOKED']));
  add('root_key_expired_in_trust_set', 'PRIN', 'design 1.3 step 8 (T2)', { chain: ['root_by_mandate_only_key'], trust: 'mandate_only_key_expired' }, no(['TRUST_KEY_EXPIRED']));
  add('root_key_not_yet_valid', 'PRIN', 'design 1.3 step 8 (T2)', { chain: ['root_by_mandate_only_key'], trust: 'mandate_only_key_not_yet_valid' }, no(['TRUST_KEY_NOT_YET_VALID']));
  add('root_signed_by_agent', 'PRIN', 'DCP-09 3.5.2 rule 1: a root signed with the agent passport keys', { chain: ['root_by_agent'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('principal_absent', 'PRIN', 'admission T1 and design 1.3 step 8', { trust: 'without_principal' }, no(['TRUST_PRINCIPAL_UNKNOWN']));
  add('principal_retired', 'PRIN', 'admission T2 and design 1.3 step 8: every key of the principal revoked', { trust: 'principal_retired' }, no(['TRUST_KEY_REVOKED']));

  // HOJA y DELEG
  add('leaf_agent_differs', 'DELEG', 'design 1.3 step 4', { ...depth1, leaf: 'extra' }, no(['DELEGATION_LEAF_MISMATCH']));
  add('sub_signed_by_leaf', 'DELEG', 'DCP-09 3.5.2 rule 2: the leaf cannot sign its own sub-mandate', { ...depth1, chain: ['root', 'sub_signed_by_leaf'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('delegator_missing', 'DELEG', 'design 1.3 step 4', { ...depth1, delegators: [] }, no(['DELEGATION_DELEGATOR_MISSING', 'DELEGATION_CHAIN_INVALID']));
  add('delegator_twice', 'DELEG', 'design 1.3 step 4', { ...depth1, delegators: ['orch', 'orch'] }, no(['DELEGATION_DELEGATOR_UNEXPECTED']));
  add('delegator_extra', 'DELEG', 'design 1.3 step 4', { ...depth1, delegators: ['orch', 'extra'] }, no(['DELEGATION_DELEGATOR_UNEXPECTED']));
  add('delegator_other_principal', 'DELEG', 'design 1.3 step 4', { ...depth1, delegators: ['orch_other_principal'] }, no(['DELEGATION_PRINCIPAL_MISMATCH']));
  add('delegator_session_expired', 'DELEG', 'design 1.3 step 3: no relaxation for delegator bundles', { ...depth1, delegators: ['orch_session_expired'] }, no(['DELEGATION_DELEGATOR_NOT_ADMITTED', 'DELEGATION_CHAIN_INVALID']));
  add('delegator_other_audience', 'DELEG', 'design 1.3 step 3 under strict-v1: P2, and the profile policy binds the audience (V2-4), so the bundle does not verify and its keys are not used', { ...depth1, delegators: ['orch_other_audience'] }, no(['DELEGATION_DELEGATOR_NOT_ADMITTED', 'DELEGATION_CHAIN_INVALID']));
  add('delegator_two_sessions', 'DELEG', 'design 1.3 steps 3 and 9: artifacts of two sessions, validly signed, rejected by V2-4', { ...depth1, delegators: ['orch_two_sessions'] }, no(['DELEGATION_DELEGATOR_NOT_ADMITTED', 'DELEGATION_CHAIN_INVALID']));
  add('key_shared_principal_and_leaf', 'DELEG', 'design 1.3 step 5', { ...depth1, leaf: 'sub_shares_principal_key' }, no(['DELEGATION_KEY_AMBIGUOUS']));
  add('key_shared_leaf_and_delegator', 'DELEG', 'design 1.3 step 5', { ...depth1, leaf: 'sub_shares_orch_key' }, no(['DELEGATION_KEY_AMBIGUOUS']));
  add('key_shared_two_delegators', 'DELEG', 'design 1.3 step 5', { ...depth2, delegators: ['orch', 'sub_shares_orch_key'] }, no(['DELEGATION_KEY_AMBIGUOUS']));
  add('kid_twice_in_one_list', 'DELEG', 'design 1.3 step 5', { ...depth1, leaf: 'sub_kid_twice' }, no(['DELEGATION_KEY_AMBIGUOUS']));
  add('mandate_id_repeated', 'DELEG', 'design 1.3 step 1', { ...depth1, chain: ['root', 'sub_same_id_as_root'] }, no(['DELEGATION_REPEATED_ID']));
  add('agent_repeated', 'DELEG', 'design 1.3 step 1', { leaf: 'orch', chain: ['root', 'sub', 'sub2_back_to_orchestrator'], delegators: ['orch', 'sub'] }, no(['DELEGATION_REPEATED_ID']));

  // REV
  add('revocation_unavailable', 'REV', 'admission R1 for the composition', { revocation: null }, no(['REVOCATION_UNAVAILABLE'], true));
  add('intermediate_agent_revoked', 'REV', 'design 1.3 step 10', { ...depth1, revocation: 'orchestrator_revoked' }, no(['REVOCATION_REVOKED', 'DELEGATION_DELEGATOR_NOT_ADMITTED']));
  add('submandate_key_status_absent', 'REV', 'design 1.3 step 10: a key used only by a sub-mandate is a subject', { ...depth1, revocation: 'submandate_key_absent' }, no(['REVOCATION_UNKNOWN'], true));
  add('submandate_key_revoked', 'REV', 'design 1.3 step 10', { ...depth1, revocation: 'submandate_key_revoked' }, no(['REVOCATION_REVOKED'], true));
  add('root_key_revoked_in_snapshot', 'REV', 'design 1.3 step 10: a root key that signs no bundle is a subject', { chain: ['root_by_mandate_only_key'], revocation: 'mandate_only_key_revoked' }, no(['REVOCATION_REVOKED'], true));
  add('revocation_stale', 'REV', 'admission R3 for the composition', { revocation: 'stale' }, no(['REVOCATION_STALE'], true));
  add('root_mandate_revoked', 'REV', 'DCP-09 3.5.2 rule 7 with design 1.3 step 10', { ...depth1, mandate_revocation: 'root_revoked' }, no(['REVOCATION_REVOKED', 'DELEGATION_CHAIN_INVALID']));
  add('intermediate_mandate_revoked', 'REV', 'DCP-09 3.5.2 rule 7: a revoked ancestor invalidates its descendants', { ...depth2, mandate_revocation: 'intermediate_revoked' }, no(['REVOCATION_REVOKED', 'DELEGATION_CHAIN_INVALID']));
  add('mandate_revocation_unavailable', 'REV', 'design 1.3 step 10 (R1)', { ...depth1, mandate_revocation: null }, no(['REVOCATION_UNAVAILABLE'], true));
  add('mandate_status_unknown', 'REV', 'design 1.3 step 10 (R5)', { ...depth1, mandate_revocation: 'sub_unknown' }, no(['REVOCATION_UNKNOWN'], true));
  add('mandate_revocation_stale', 'REV', 'design 1.3 step 10 (R3)', { ...depth1, mandate_revocation: 'stale' }, no(['REVOCATION_STALE'], true));

  // TIEMPO y AUD
  add('before_valid_from', 'TIME', 'DCP-09 3.5.2 rule 4', { chain: ['root_not_yet_valid'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('after_valid_until', 'TIME', 'DCP-09 3.5.2 rule 4', { chain: ['root_expired'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('delegator_key_expired', 'TIME', 'V2-13: an expired passport key rejects the delegator bundle, so its keys are not used', { ...depth1, delegators: ['orch_mandate_key_expired'] }, no(['DELEGATION_DELEGATOR_NOT_ADMITTED', 'DELEGATION_CHAIN_INVALID']));
  add('child_window_beyond_parent', 'TIME', 'DCP-09 3.5.2 rule 4', { ...depth1, chain: ['root', 'sub_window_beyond_parent'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('leaf_session_expired', 'TIME', 'V2-4 and P3 on the leaf', { leaf: 'orch_session_expired' }, no(['VERIFICATION_FAILED', 'PROFILE_SESSION_EXPIRED', 'DELEGATION_CHAIN_INVALID']));
  add('leaf_other_audience', 'TIME', 'P2 and the profile audience binding (V2-4) on the leaf, as admission_vectors 8_other_intended_verifier', { leaf: 'orch_other_audience' }, no(['PROFILE_AUDIENCE_MISMATCH', 'VERIFICATION_FAILED', 'DELEGATION_CHAIN_INVALID']));

  // FIRMA
  add('root_classical_only', 'SIG', 'DCP-09 3.5.1: pq_over_classical only (preflight)', { chain: ['root_classical_only'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('sub_under_delegation_context', 'SIG', 'DCP-09 3.5.1: sub-mandates use DCP-AI.v2.SubMandate', { ...depth1, chain: ['root', 'sub_delegation_context'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('root_under_bundle_context', 'SIG', 'DCP-09 3.5.1: roots use DCP-AI.v2.Delegation', { chain: ['root_bundle_context'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('root_pq_component_invalid', 'SIG', 'DCP-09 3.5.2 rule 1', { chain: ['root_pq_invalid'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('root_sig_not_canonical_base64', 'SIG', 'V2-5 in the preflight', { chain: ['root_sig_not_canonical_b64'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('root_sig_wrong_size', 'SIG', 'design: canonical signature size in the preflight', { chain: ['root_sig_63_bytes'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('mandate_dcp_version', 'SIG', 'schema: dcp_version "2.0" in the preflight', { chain: ['root_dcp_version_2_1'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('mandate_nonce_uppercase', 'SIG', 'schema: session_nonce of 64 lowercase hex in the preflight', { chain: ['root_nonce_uppercase'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('scope_action_empty_string', 'SIG', 'schema: actions_permitted items have minLength 1 (signed root; independent review R3)', { chain: ['root_scope_empty_action'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('scope_data_class_empty_string', 'SIG', 'schema: data_classes items have minLength 1 (signed root; independent review R3)', { chain: ['root_scope_empty_data_class'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('scope_unknown_member', 'SIG', 'schema: authority_scope items are closed (signed root; independent review R3)', { chain: ['root_scope_unknown_member'] }, no(['DELEGATION_CHAIN_INVALID']));
  add('sub_delegation_unknown_member', 'SIG', 'schema: sub_delegation is closed (signed root; independent review R3)', { chain: ['root_sub_delegation_unknown_member'] }, no(['DELEGATION_CHAIN_INVALID']));

  // ROT
  add('root_signed_by_retired_key', 'ROT', 'design 5: the old key is revoked in the trust set', { leaf: 'orch_signed_by_rotated_principal_key', trust: 'old_key_retired' }, no(['TRUST_KEY_REVOKED']));
  add('root_by_new_key_only_in_rpr', 'ROT', 'design 5: a new key is never trusted from the RPR', { chain: ['root_by_rotated_key'] }, no(['TRUST_KEY_NOT_ANCHORED']));
  add('sub_by_key_no_longer_in_passport', 'ROT', 'design 5: verified at now with the current passport', { ...depth1, delegators: ['orch_rotated_agent_keys'] }, no(['DELEGATION_CHAIN_INVALID']));

  const config_cases = [
    { name: 'no_profile_without_max_age', rule: 'design 1.2', operator: { policy: 'weak_classical', trust: 'base' }, expected_code: 'CONFIG_INVALID_VALUE' },
    { name: 'no_profile_max_age_zero', rule: 'design 1.2', operator: { policy: 'weak_classical', trust: 'base', max_revocation_age_seconds: 0 }, expected_code: 'CONFIG_INVALID_VALUE' },
    { name: 'no_profile_max_age_301', rule: 'design 1.2', operator: { policy: 'weak_classical', trust: 'base', max_revocation_age_seconds: 301 }, expected_code: 'CONFIG_INVALID_VALUE' },
    { name: 'profile_with_max_age', rule: 'design 1.2', operator: { profile: 'strict', trust: 'base', max_revocation_age_seconds: 300 }, expected_code: 'CONFIG_PROFILE_CONTRADICTION' },
    { name: 'profile_with_policy', rule: 'design 1.2', operator: { profile: 'strict', policy: 'weak_classical', trust: 'base' }, expected_code: 'CONFIG_PROFILE_CONTRADICTION' },
    { name: 'no_trust_set', rule: 'design 1.2', operator: { profile: 'strict' }, expected_code: 'CONFIG_INVALID_VALUE' },
  ];

  const vectors = {
    description:
      'Delegated admission (opt-in): a leaf bundle, its DCP-09 mandate chain and the bundle of every delegating agent, verified at one instant against the operator trust set, policy and revocation snapshots. Expected outcomes are written from the rules; agreement between SDKs is not the criterion.',
    spec: 'docs/reviews/mp02-security-composition-design.md v0.2, sections 1 and 7; spec/profiles/admission; spec/DCP-09.md 3.5',
    generated_by: 'sdks/typescript/src/__tests__/generate-delegated-admission-vectors.ts',
    verifier_id: VERIFIER_ID,
    now: iso(NOW),
    signed_bundles,
    mandates,
    trust_sets,
    profiles,
    policies,
    revocations,
    mandate_revocations,
    cases,
    config_cases,
  };

  // ── Check every expected outcome against the TypeScript SDK, then write ──
  const failures: string[] = [];
  const nonces = new Set(Object.values(signed_bundles).map((b) => b.bundle.manifest.session_nonce));
  for (const m of Object.values(mandates)) if (nonces.has(m.session_nonce as string)) failures.push('a mandate shares a nonce with a bundle');
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  for (const c of cases) {
    const operator = {
      trust: copy(trust_sets[c.trust as keyof typeof trust_sets]),
      ...(c.profile ? { profile: copy(profiles[c.profile as keyof typeof profiles]) } : {}),
      ...(c.policy ? { policy: copy(policies[c.policy]) } : {}),
      ...(c.max_revocation_age_seconds !== null ? { maxRevocationAgeSeconds: c.max_revocation_age_seconds } : {}),
      revocation: c.revocation ? copy(revocations[c.revocation as keyof typeof revocations]) : null,
      mandateRevocation: c.mandate_revocation ? copy(mandate_revocations[c.mandate_revocation as keyof typeof mandate_revocations]) : null,
      now: NOW,
    };
    const result = await admitDelegatedBundleV2(
      { signedBundle: copy(signed_bundles[c.leaf]), mandateChain: c.chain.map((n) => copy(mandates[n])), delegatorBundles: c.delegators.map((n) => copy(signed_bundles[n])) },
      registry,
      operator as unknown as DelegatedOperator,
    );
    const got: Record<string, unknown> = {
      admitted: result.admitted,
      delegation_verified: result.delegation_verified,
      codes: [...new Set(result.errors.map((e) => e.code))].sort(),
    };
    const want: Record<string, unknown> = { admitted: c.expected.admitted, delegation_verified: c.expected.delegation_verified, codes: [...c.expected.codes].sort() };
    for (const field of ['security_tier', 'verification_mode', 'effective_floor'] as const) {
      if (c.expected[field] !== undefined) {
        want[field] = c.expected[field];
        got[field] = field === 'effective_floor' ? result.chain?.effective_floor ?? null : result[field];
      }
    }
    if (result.action_authorized !== false || result.delegation_active !== false || result.activation !== 'not_evaluated') failures.push(`${c.name}: activation or authorization`);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${c.name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}; ${result.errors.map((e) => e.message).join(' | ')}`);
    }
    if (c.control_public_admitted !== undefined) {
      const pub = await admitSignedBundleV2(copy(signed_bundles[c.leaf]), registry, { policy: copy(policies[c.policy as string]), trust: copy(trust_sets[c.trust as keyof typeof trust_sets]) as never, now: NOW });
      if (pub.admitted !== c.control_public_admitted) failures.push(`${c.name}: public admission control is ${pub.admitted}`);
    }
  }
  for (const c of config_cases) {
    const o = c.operator as Record<string, unknown>;
    const operator = {
      ...(o.trust ? { trust: copy(trust_sets[o.trust as keyof typeof trust_sets]) } : {}),
      ...(o.profile ? { profile: copy(profiles[o.profile as keyof typeof profiles]) } : {}),
      ...(o.policy ? { policy: copy(policies[o.policy as string]) } : {}),
      ...(o.max_revocation_age_seconds !== undefined ? { maxRevocationAgeSeconds: o.max_revocation_age_seconds as number } : {}),
      revocation: copy(revocations.all_not_revoked),
      mandateRevocation: copy(mandate_revocations.all_not_revoked),
      now: NOW,
    };
    try {
      await admitDelegatedBundleV2({ signedBundle: copy(signed_bundles.orch), mandateChain: [copy(mandates.root)] }, registry, operator as never);
      failures.push(`${c.name}: accepted`);
    } catch (e) {
      if (!(e instanceof AdmissionConfigError) || e.code !== c.expected_code) failures.push(`${c.name}: ${(e as Error).message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`${failures.length} case(s) do not match; nothing written:\n${failures.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(vectors, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH}: ${cases.length} cases, ${config_cases.length} configuration cases, ${Object.keys(signed_bundles).length} bundles, ${Object.keys(mandates).length} mandates.`);
}

await main();
