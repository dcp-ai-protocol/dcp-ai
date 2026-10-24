/**
 * DCP-AI admission vectors (spec/profiles/admission).
 *
 * Writes tests/interop/v2/admission_vectors.json: signed bundles, trust sets, a strict-v1
 * profile, and cases that give the bundle, the clock, the trust set, the revocation snapshot
 * and the outcome every SDK MUST produce, with the rule of the spec each case checks. The
 * expected outcomes are written here by hand, from the spec; the generator only checks that
 * the TypeScript SDK produces them, and fails otherwise. Configuration cases give a trust set
 * or profile that MUST be refused with the given code.
 *
 * Every key is generated for the run; times are fixed, so the vectors never expire.
 *
 * Run: cd sdks/typescript && npx vite-node src/__tests__/generate-admission-vectors.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import type { DcpContext } from '../core/domain-separation.js';
import { classicalOnlySign, compositeSign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { preparePayload } from '../core/signed-payload.js';
import { sha256Hex } from '../core/dual-hash.js';
import { generateSessionNonce } from '../core/session-nonce.js';
import { BundleBuilderV2 } from '../bundle/builder-v2.js';
import { signBundleV2, signBundleV2ClassicalOnly } from '../bundle/signer-v2.js';
import { verifySignedBundleV2 } from '../core/verify-v2.js';
import {
  AdmissionConfigError,
  admitSignedBundleV2,
  createPrincipalTrustStore,
  resolveStrictV1Profile,
  revocationSubjects,
  type AdmissionResult,
  type RevocationSnapshot,
} from '../core/admission.js';
import type {
  AgentPassportV2,
  AuditEventV2,
  IntentV2,
  KeyEntry,
  PolicyDecisionV2,
  ResponsiblePrincipalRecordV2,
  SignedBundleV2,
} from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../../..');
const OUTPUT_PATH = resolve(ROOT, 'tests/interop/v2/admission_vectors.json');
const V1_BUNDLE = resolve(ROOT, 'tests/conformance/examples/citizenship_bundle.signed.json');

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

const VERIFIER_ID = 'verifier:acme-api';
const PRINCIPAL = 'human:acme-ops';
const AGENT = 'agent:acme-bot';

// The session window of every bundle unless a variant says otherwise: 300 s, the strict-v1 maximum.
const ISSUED = Date.parse('2026-11-02T10:00:00Z');
const NOW = ISSUED + 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

async function generateKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}

const keyEntries = (keys: CompositeKeyPair, expiresAt: string | null): KeyEntry[] =>
  [keys.classical, keys.pq].map((k) => ({
    kid: k.kid,
    alg: k.alg,
    public_key_b64: k.publicKeyB64,
    created_at: '2026-10-01T00:00:00Z',
    expires_at: expiresAt,
    status: 'active',
  }));

async function sign<T>(payload: T, context: DcpContext, keys: CompositeKeyPair, classicalOnly = false) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  const composite_sig = classicalOnly
    ? await classicalOnlySign(registry, context, canonicalBytes, keys.classical)
    : await compositeSign(registry, context, canonicalBytes, keys);
  return { payload, payload_hash: payloadHash, composite_sig };
}

const sha256Of = (obj: unknown) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(obj), 'utf8'))}`;

interface Variant {
  humanId?: string;
  /** The RPR binding_keys and the keys that sign the RPR and the bundle. */
  principalKeys: CompositeKeyPair;
  agentKeys: CompositeKeyPair;
  decision?: 'approve' | 'escalate' | 'block';
  classicalOnly?: boolean;
  /** Manifest fields set before signing; undefined removes one (session_issued_at is re-signed out). */
  manifest?: Record<string, unknown>;
}

const AUDITED: Record<string, string> = { approve: 'approved', escalate: 'escalated', block: 'blocked' };

async function build(v: Variant): Promise<SignedBundleV2> {
  const nonce = generateSessionNonce();
  const humanId = v.humanId ?? PRINCIPAL;
  const decision = v.decision ?? 'approve';
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
    binding_keys: keyEntries(v.principalKeys, null),
  };
  const passport: AgentPassportV2 = {
    dcp_version: '2.0',
    agent_id: AGENT,
    session_nonce: nonce,
    keys: keyEntries(v.agentKeys, '2099-12-31T23:59:59Z'),
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
    agent_id: AGENT,
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
    decision,
    risk_score: 100,
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
    agent_id: AGENT,
    human_id: humanId,
    intent_id: intent.intent_id,
    intent_hash: sha256Of(intent),
    policy_decision: AUDITED[decision] as AuditEventV2['policy_decision'],
    outcome: decision === 'approve' ? 'api_called' : 'not_executed',
    evidence: { tool: 'http', result_ref: null, evidence_hash: null },
    pq_checkpoint_ref: null,
  };

  const co = v.classicalOnly;
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal, v.principalKeys, co))
    .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport, v.agentKeys, co))
    .intent(await sign(intent, DCP_CONTEXTS.Intent, v.agentKeys, co))
    .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision, v.agentKeys, co))
    .addAuditEntries([audit])
    .build();
  Object.assign(
    bundle.manifest,
    { session_issued_at: iso(ISSUED), session_expires_at: iso(ISSUED + 300_000), intended_verifier: VERIFIER_ID },
    v.manifest,
  );
  for (const [k, value] of Object.entries(bundle.manifest)) if (value === undefined) delete (bundle.manifest as unknown as Record<string, unknown>)[k];
  const signer = { registry, signerType: 'organization' as const, signerId: humanId };
  const signed = co
    ? await signBundleV2ClassicalOnly(bundle, { ...signer, key: v.principalKeys.classical })
    : await signBundleV2(bundle, { ...signer, keys: v.principalKeys });
  // The signers stamp session_issued_at whenever there is an expiry: re-sign a manifest without it.
  if (v.manifest && 'session_issued_at' in v.manifest && v.manifest.session_issued_at === undefined) {
    delete signed.bundle.manifest.session_issued_at;
    const { canonicalBytes, payloadHash } = preparePayload(signed.bundle.manifest);
    signed.signature.composite_sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, canonicalBytes, v.principalKeys);
    signed.signature.manifest_hash = payloadHash;
  }
  return signed;
}

/** The kid entry of a trust set for one key. */
const trusted = (k: CompositeKeyPair['classical'], extra: Record<string, unknown> = {}) => ({
  kid: k.kid,
  alg: k.alg,
  public_key_b64: k.publicKeyB64,
  status: 'active',
  ...extra,
});

type Expected = Pick<AdmissionResult, 'verified' | 'principal_trust' | 'profile_compliance' | 'admitted' | 'recorded_decision'> & {
  codes: string[];
};

interface Case {
  name: string;
  rule: string;
  reason: string;
  bundle: string;
  now: string;
  profile: string | null;
  trust: string | null;
  /** Under a profile only; null = the source could not answer. */
  revocation?: RevocationSnapshot | null;
  expected: Expected & { action_authorized: false };
}

async function main() {
  const principal = await generateKeys();
  const rotated = await generateKeys();
  const agent = await generateKeys();
  const attacker = await generateKeys();
  const stranger = await generateKeys();

  const bundles: Record<string, unknown> = {
    base: await build({ principalKeys: principal, agentKeys: agent }),
    escalated: await build({ principalKeys: principal, agentKeys: agent, decision: 'escalate' }),
    blocked: await build({ principalKeys: principal, agentKeys: agent, decision: 'block' }),
    rotated_keys: await build({ principalKeys: rotated, agentKeys: agent }),
    unknown_principal: await build({ humanId: 'human:stranger', principalKeys: stranger, agentKeys: agent }),
    attacker_claims_known_human_id: await build({ principalKeys: attacker, agentKeys: agent }),
    classical_key_substituted: await build({ principalKeys: { classical: attacker.classical, pq: principal.pq }, agentKeys: agent }),
    pq_key_substituted: await build({ principalKeys: { classical: principal.classical, pq: attacker.pq }, agentKeys: agent }),
    no_intended_verifier: await build({ principalKeys: principal, agentKeys: agent, manifest: { intended_verifier: undefined } }),
    other_intended_verifier: await build({ principalKeys: principal, agentKeys: agent, manifest: { intended_verifier: 'verifier:someone-else' } }),
    no_session_issued_at: await build({ principalKeys: principal, agentKeys: agent, manifest: { session_issued_at: undefined } }),
    no_session_expires_at: await build({ principalKeys: principal, agentKeys: agent, manifest: { session_expires_at: undefined } }),
    session_301_s: await build({ principalKeys: principal, agentKeys: agent, manifest: { session_expires_at: iso(ISSUED + 301_000) } }),
    session_300_001_s: await build({ principalKeys: principal, agentKeys: agent, manifest: { session_expires_at: iso(ISSUED + 300_001) } }),
    classical_only: await build({ principalKeys: principal, agentKeys: agent, classicalOnly: true }),
    v1_bundle: JSON.parse(readFileSync(V1_BUNDLE, 'utf8')),
  };
  // The PQ signature over the manifest, one byte flipped (still canonical base64): present and invalid.
  const pqInvalid = structuredClone(bundles.base) as SignedBundleV2;
  const pqSig = Buffer.from(pqInvalid.signature.composite_sig.pq!.sig_b64, 'base64');
  pqSig[10] ^= 0x01;
  pqInvalid.signature.composite_sig.pq!.sig_b64 = pqSig.toString('base64');
  bundles.pq_signature_invalid = pqInvalid;

  const version = (v: string) => `2026-11-02.${v}`;
  const trustSets: Record<string, unknown> = {
    principal: { trust_set_version: version('principal'), principals: [{ human_id: PRINCIPAL, keys: [trusted(principal.classical), trusted(principal.pq)] }] },
    empty: { trust_set_version: version('empty'), principals: [] },
    classical_only_trusted: { trust_set_version: version('classical-only'), principals: [{ human_id: PRINCIPAL, keys: [trusted(principal.classical)] }] },
    pq_only_trusted: { trust_set_version: version('pq-only'), principals: [{ human_id: PRINCIPAL, keys: [trusted(principal.pq)] }] },
    classical_revoked: {
      trust_set_version: version('classical-revoked'),
      principals: [{ human_id: PRINCIPAL, keys: [trusted(principal.classical, { status: 'revoked' }), trusted(principal.pq)] }],
    },
    pq_status_expired: {
      trust_set_version: version('pq-expired'),
      principals: [{ human_id: PRINCIPAL, keys: [trusted(principal.classical), trusted(principal.pq, { status: 'expired' })] }],
    },
    classical_expires_before_now: {
      trust_set_version: version('classical-expires-before-now'),
      principals: [{ human_id: PRINCIPAL, keys: [trusted(principal.classical, { expires_at: iso(NOW - 1) }), trusted(principal.pq)] }],
    },
    classical_expires_at_now: {
      trust_set_version: version('classical-expires-at-now'),
      principals: [{ human_id: PRINCIPAL, keys: [trusted(principal.classical, { expires_at: iso(NOW) }), trusted(principal.pq)] }],
    },
    // Rotation: the old keys stay active until 12:00, the new ones are valid from 09:00 (C, D).
    rotation_overlap: {
      trust_set_version: version('rotation-overlap'),
      principals: [{
        human_id: PRINCIPAL,
        keys: [
          trusted(principal.classical, { expires_at: '2026-11-02T12:00:00Z' }),
          trusted(principal.pq, { expires_at: '2026-11-02T12:00:00Z' }),
          trusted(rotated.classical, { not_before: '2026-11-02T09:00:00Z' }),
          trusted(rotated.pq, { not_before: '2026-11-02T09:00:00Z' }),
        ],
      }],
    },
    // The overlap ended: the old keys' expiry is one millisecond before NOW.
    rotation_overlap_ended: {
      trust_set_version: version('rotation-overlap-ended'),
      principals: [{
        human_id: PRINCIPAL,
        keys: [
          trusted(principal.classical, { expires_at: iso(NOW - 1) }),
          trusted(principal.pq, { expires_at: iso(NOW - 1) }),
          trusted(rotated.classical, { not_before: '2026-11-02T09:00:00Z' }),
          trusted(rotated.pq, { not_before: '2026-11-02T09:00:00Z' }),
        ],
      }],
    },
    // The new keys become valid one millisecond after NOW.
    rotation_not_yet_valid: {
      trust_set_version: version('rotation-not-yet-valid'),
      principals: [{ human_id: PRINCIPAL, keys: [trusted(rotated.classical, { not_before: iso(NOW + 1) }), trusted(rotated.pq, { not_before: iso(NOW + 1) })] }],
    },
    // The old keys retired: their entries carry an expiry before NOW, the new ones are active.
    rotation_completed: {
      trust_set_version: version('rotation-completed'),
      principals: [{
        human_id: PRINCIPAL,
        keys: [
          trusted(principal.classical, { status: 'expired' }),
          trusted(principal.pq, { status: 'expired' }),
          trusted(rotated.classical),
          trusted(rotated.pq),
        ],
      }],
    },
    // The stranger is trusted under its own human_id; the attacker's keys are trusted for nobody.
    stranger_trusted_too: {
      trust_set_version: version('stranger'),
      principals: [
        { human_id: PRINCIPAL, keys: [trusted(principal.classical), trusted(principal.pq)] },
        { human_id: 'human:stranger-2', keys: [trusted(stranger.classical), trusted(stranger.pq)] },
      ],
    },
  };
  for (const set of Object.values(trustSets)) createPrincipalTrustStore(set); // all valid

  const profiles: Record<string, unknown> = {
    strict: { profile: 'strict-v1', verifier_id: VERIFIER_ID },
    strict_120_s: { profile: 'strict-v1', verifier_id: VERIFIER_ID, max_session_duration_seconds: 120 },
    strict_other_verifier: { profile: 'strict-v1', verifier_id: 'verifier:other-api' },
  };

  // The revocation snapshot of a bundle: every subject not_revoked, checked 30 s before `now`.
  const strictPolicy = resolveStrictV1Profile(profiles.strict).policy;
  async function subjects(bundleName: string, now: number) {
    const verification = await verifySignedBundleV2(bundles[bundleName] as SignedBundleV2, registry, strictPolicy as never, { now });
    return revocationSubjects(bundles[bundleName], verification);
  }
  async function snapshot(bundleName: string, now: number, edit?: (s: RevocationSnapshot) => void): Promise<RevocationSnapshot> {
    const { agent_ids, kids } = await subjects(bundleName, now);
    const s: RevocationSnapshot = {
      checked_at: iso(now - 30_000),
      agents: Object.fromEntries(agent_ids.map((id) => [id, 'not_revoked'])),
      keys: Object.fromEntries(kids.map((kid) => [kid, 'not_revoked'])),
    };
    edit?.(s);
    return s;
  }

  const outcome = (o: Partial<Expected> & { codes: string[] }): Case['expected'] => ({
    verified: true,
    principal_trust: 'trusted',
    profile_compliance: 'compliant',
    admitted: o.codes.length === 0,
    recorded_decision: 'approve',
    action_authorized: false,
    ...o,
    codes: [...o.codes].sort(),
  });
  const rejectedUnverified = (codes: string[]): Case['expected'] =>
    outcome({ verified: false, principal_trust: 'not_evaluated', profile_compliance: 'non_compliant', admitted: false, recorded_decision: null, codes });
  const untrusted = (codes: string[]): Case['expected'] => outcome({ principal_trust: 'untrusted', admitted: false, codes });
  const nonCompliant = (codes: string[]): Case['expected'] => outcome({ profile_compliance: 'non_compliant', admitted: false, codes });

  const strict = async (name: string, rule: string, reason: string, bundle: string, trust: string, expected: Case['expected'], opts: { now?: number; profile?: string; revocation?: RevocationSnapshot | null } = {}): Promise<Case> => {
    const now = opts.now ?? NOW;
    return {
      name, rule, reason, bundle, now: iso(now), profile: opts.profile ?? 'strict', trust,
      revocation: opts.revocation === undefined ? await snapshot(bundle, now) : opts.revocation,
      expected,
    };
  };

  const ACCEPTED = outcome({ codes: [] });
  const kidOf = (k: CompositeKeyPair['classical']) => k.kid;

  const cases: Case[] = [
    // ── Positive controls ──
    await strict('A_known_principal_strict', '§5.2', 'Known principal, both principal keys trusted and active, coherent bundle, right audience, 300 s session, fresh revocation snapshot: admitted.', 'base', 'principal', ACCEPTED),
    {
      name: 'B_general_verifier_unchanged', rule: '§1', reason: 'No trust set and no profile: the verifier\'s verdict alone, nothing else evaluated.',
      bundle: 'base', now: iso(NOW), profile: null, trust: null,
      expected: outcome({ principal_trust: 'not_evaluated', profile_compliance: 'not_evaluated', codes: [] }),
    },
    {
      name: 'B_trust_without_profile', rule: '§3', reason: 'A trust set without the profile: the principal is trusted, the bundle admitted under the default policy.',
      bundle: 'base', now: iso(NOW), profile: null, trust: 'principal',
      expected: outcome({ profile_compliance: 'not_evaluated', codes: [] }),
    },
    await strict('C_new_key_added_to_trust_set', '§2.2 rotation', 'Bundle signed with new keys the operator added to the trust set: admitted.', 'rotated_keys', 'rotation_overlap', ACCEPTED),
    await strict('C_new_key_not_yet_in_trust_set', '§3 T2', 'The same bundle before the operator added the new keys: not anchored.', 'rotated_keys', 'principal', untrusted(['TRUST_KEY_NOT_ANCHORED'])),
    await strict('D_overlap_old_keys_still_active', '§2.2 rotation', 'During the overlap the old keys stay active: a bundle signed with them is admitted.', 'base', 'rotation_overlap', ACCEPTED),
    await strict('D_overlap_old_keys_after_retirement', '§3 T2', 'After the rotation the old keys are retired in the trust set: a bundle signed with them is refused.', 'base', 'rotation_completed', untrusted(['TRUST_KEY_EXPIRED'])),
    await strict('D_overlap_ended_old_keys', '§3 T2', 'The overlap ended one millisecond before now: a bundle signed with the old keys is refused.', 'base', 'rotation_overlap_ended', untrusted(['TRUST_KEY_EXPIRED'])),
    await strict('D_overlap_ended_new_keys', '§2.2 rotation', 'After the overlap a bundle signed with the new keys is admitted.', 'rotated_keys', 'rotation_overlap_ended', ACCEPTED),
    await strict('D_new_keys_before_not_before', '§3 T2', 'New keys whose not_before is one millisecond after now: not valid yet.', 'rotated_keys', 'rotation_not_yet_valid', untrusted(['TRUST_KEY_NOT_YET_VALID'])),
    await strict('E_escalated_decision_is_evidence', '§5.2', 'A bundle recording an escalate decision is admitted as evidence; action_authorized stays false.', 'escalated', 'principal', outcome({ recorded_decision: 'escalate', codes: [] })),
    await strict('E_blocked_decision_is_evidence', '§5.2', 'A bundle recording a block decision is admitted as evidence; action_authorized stays false.', 'blocked', 'principal', outcome({ recorded_decision: 'block', codes: [] })),

    // ── 1–7: principal trust ──
    await strict('1_unknown_principal_strict', '§3 T1', 'A self-consistent bundle from a principal the trust set does not list: verified, not admitted.', 'unknown_principal', 'principal', untrusted(['TRUST_PRINCIPAL_UNKNOWN'])),
    await strict('1_empty_trust_set', '§3 T1', 'An empty trust set trusts no one.', 'base', 'empty', untrusted(['TRUST_PRINCIPAL_UNKNOWN'])),
    {
      name: '1_unknown_principal_trust_only', rule: '§3 T1', reason: 'The same bundle under the default policy with a trust set: verified, not admitted.',
      bundle: 'unknown_principal', now: iso(NOW), profile: null, trust: 'principal',
      expected: outcome({ principal_trust: 'untrusted', profile_compliance: 'not_evaluated', admitted: false, codes: ['TRUST_PRINCIPAL_UNKNOWN'] }),
    },
    await strict('1_trusted_keys_under_another_human_id', '§3 T1', 'Keys trusted for human:stranger-2 do not make human:stranger trusted.', 'unknown_principal', 'stranger_trusted_too', untrusted(['TRUST_PRINCIPAL_UNKNOWN'])),
    await strict('2_attacker_uses_known_human_id', '§3 T2', 'The known human_id with the attacker\'s own keys: every principal component is unanchored.', 'attacker_claims_known_human_id', 'principal', untrusted(['TRUST_KEY_NOT_ANCHORED'])),
    await strict('3_classical_key_substituted', '§3 T2', 'The principal\'s PQ key with someone else\'s Ed25519 key: the classical components are unanchored.', 'classical_key_substituted', 'principal', untrusted(['TRUST_KEY_NOT_ANCHORED'])),
    await strict('4_pq_key_substituted', '§3 T2', 'The principal\'s Ed25519 key with someone else\'s ML-DSA key: the PQ components are unanchored.', 'pq_key_substituted', 'principal', untrusted(['TRUST_KEY_NOT_ANCHORED'])),
    await strict('5_only_classical_key_trusted', '§3 T2', 'Trusting only the Ed25519 key does not make the PQ key trusted.', 'base', 'classical_only_trusted', untrusted(['TRUST_KEY_NOT_ANCHORED'])),
    await strict('5_only_pq_key_trusted', '§3 T2', 'Trusting only the ML-DSA key does not make the Ed25519 key trusted.', 'base', 'pq_only_trusted', untrusted(['TRUST_KEY_NOT_ANCHORED'])),
    await strict('6_key_revoked_in_trust_set', '§3 T2', 'The bundle lists the key as active; the trust set, authoritative, has it revoked.', 'base', 'classical_revoked', untrusted(['TRUST_KEY_REVOKED'])),
    await strict('6_key_status_expired_in_trust_set', '§3 T2', 'The trust set marks the PQ key expired.', 'base', 'pq_status_expired', untrusted(['TRUST_KEY_EXPIRED'])),
    await strict('6_key_expires_before_now', '§3 T2', 'The trusted key expired one millisecond before now.', 'base', 'classical_expires_before_now', untrusted(['TRUST_KEY_EXPIRED'])),
    await strict('6_key_expires_exactly_now', '§3 T2', 'expires_at equal to now is not before now: still valid.', 'base', 'classical_expires_at_now', ACCEPTED),

    // ── 8–10: audience and session window ──
    await strict('8_no_intended_verifier', '§4.2 P2', 'The signed manifest names no verifier.', 'no_intended_verifier', 'principal', rejectedUnverified(['PROFILE_AUDIENCE_MISSING', 'VERIFICATION_FAILED'])),
    await strict('8_other_intended_verifier', '§4.2 P2', 'The signed manifest names another verifier.', 'other_intended_verifier', 'principal', rejectedUnverified(['PROFILE_AUDIENCE_MISMATCH', 'VERIFICATION_FAILED'])),
    await strict('8_profile_for_another_verifier', '§4.2 P2', 'This verifier is not the one the bundle names.', 'base', 'principal', rejectedUnverified(['PROFILE_AUDIENCE_MISMATCH', 'VERIFICATION_FAILED']), { profile: 'strict_other_verifier' }),
    await strict('9_no_session_issued_at', '§4.2 P3', 'No signed session start.', 'no_session_issued_at', 'principal', rejectedUnverified(['PROFILE_SESSION_START_MISSING', 'VERIFICATION_FAILED'])),
    await strict('9_no_session_expires_at', '§4.2 P3', 'No signed session expiry.', 'no_session_expires_at', 'principal', rejectedUnverified(['PROFILE_SESSION_EXPIRY_MISSING', 'VERIFICATION_FAILED'])),
    await strict('10_session_300_s_exactly', '§4.2 P3', 'A 300 s session is at the maximum: admitted (that is the base bundle).', 'base', 'principal', ACCEPTED),
    await strict('10_session_301_s', '§4.2 P3', 'A 301 s session exceeds the maximum.', 'session_301_s', 'principal', rejectedUnverified(['PROFILE_SESSION_TOO_LONG', 'VERIFICATION_FAILED'])),
    await strict('10_session_300_001_s', '§4.2 P3', 'One millisecond over the maximum, at millisecond precision.', 'session_300_001_s', 'principal', rejectedUnverified(['PROFILE_SESSION_TOO_LONG', 'VERIFICATION_FAILED'])),
    await strict('10_operator_lowers_maximum', '§4.1', 'The operator lowered the maximum to 120 s: the 300 s session exceeds it.', 'base', 'principal', rejectedUnverified(['PROFILE_SESSION_TOO_LONG', 'VERIFICATION_FAILED']), { profile: 'strict_120_s' }),
    await strict('10_expires_exactly_now', '§4.2 P3', 'now equal to session_expires_at: not expired.', 'base', 'principal', ACCEPTED, { now: ISSUED + 300_000 }),
    await strict('10_expired_one_ms_ago', '§4.2 P3', 'now one millisecond after session_expires_at.', 'base', 'principal', rejectedUnverified(['PROFILE_SESSION_EXPIRED', 'VERIFICATION_FAILED']), { now: ISSUED + 300_001 }),
    await strict('10_start_30_s_ahead', '§4.2 P3', 'session_issued_at 30 s after now is within the clock skew.', 'base', 'principal', ACCEPTED, { now: ISSUED - 30_000 }),
    await strict('10_start_30_001_s_ahead', '§4.2 P3', 'session_issued_at 30.001 s after now is beyond the clock skew.', 'base', 'principal', rejectedUnverified(['PROFILE_SESSION_NOT_STARTED', 'VERIFICATION_FAILED']), { now: ISSUED - 30_001 }),

    // ── 11–12: signatures ──
    await strict('11_v1_bundle', '§4.2 P1', 'strict-v1 admits V2 bundles only; nothing else is evaluated.', 'v1_bundle', 'principal', rejectedUnverified(['PROFILE_V2_REQUIRED']), { revocation: null }),
    await strict('11_classical_only_bundle', '§4.2 P4', 'Classical-only signatures: the profile requires both components.', 'classical_only', 'principal', rejectedUnverified(['PROFILE_HYBRID_REQUIRED', 'VERIFICATION_FAILED'])),
    await strict('12_pq_signature_present_and_invalid', '§5.1', 'The PQ signature over the manifest is present and invalid: verification fails in every mode.', 'pq_signature_invalid', 'principal', rejectedUnverified(['VERIFICATION_FAILED'])),

    // ── 13: revocation ──
    await strict('13_agent_revoked', '§4.3 R4', 'The agent is revoked.', 'base', 'principal', nonCompliant(['REVOCATION_REVOKED']), {
      revocation: await snapshot('base', NOW, (s) => { s.agents[AGENT] = 'revoked'; }),
    }),
    await strict('13_principal_key_revoked', '§4.3 R4', 'The principal\'s Ed25519 key is revoked in the snapshot.', 'base', 'principal', nonCompliant(['REVOCATION_REVOKED']), {
      revocation: await snapshot('base', NOW, (s) => { s.keys[kidOf(principal.classical)] = 'revoked'; }),
    }),
    await strict('13_agent_key_revoked', '§4.3 R4', 'The agent\'s ML-DSA key is revoked in the snapshot.', 'base', 'principal', nonCompliant(['REVOCATION_REVOKED']), {
      revocation: await snapshot('base', NOW, (s) => { s.keys[kidOf(agent.pq)] = 'revoked'; }),
    }),
    await strict('13_status_unknown', '§4.3 R5', 'The source says it does not know one key.', 'base', 'principal', nonCompliant(['REVOCATION_UNKNOWN']), {
      revocation: await snapshot('base', NOW, (s) => { s.keys[kidOf(principal.pq)] = 'unknown'; }),
    }),
    await strict('13_subject_missing', '§4.3 R5', 'The snapshot does not cover the agent.', 'base', 'principal', nonCompliant(['REVOCATION_UNKNOWN']), {
      revocation: await snapshot('base', NOW, (s) => { delete s.agents[AGENT]; }),
    }),
    await strict('13_stale_by_1_ms', '§4.3 R3', 'checked_at 300.001 s before now.', 'base', 'principal', nonCompliant(['REVOCATION_STALE']), {
      revocation: await snapshot('base', NOW, (s) => { s.checked_at = iso(NOW - 300_001); }),
    }),
    await strict('13_age_exactly_300_s', '§4.3 R3', 'checked_at exactly 300 s before now is not stale.', 'base', 'principal', ACCEPTED, {
      revocation: await snapshot('base', NOW, (s) => { s.checked_at = iso(NOW - 300_000); }),
    }),
    await strict('13_stale_and_revoked', '§4.3 R3 R4', 'A stale snapshot that marks the agent revoked reports both.', 'base', 'principal', nonCompliant(['REVOCATION_REVOKED', 'REVOCATION_STALE']), {
      revocation: await snapshot('base', NOW, (s) => { s.checked_at = iso(NOW - 600_000); s.agents[AGENT] = 'revoked'; }),
    }),
    await strict('13_checked_30_s_ahead', '§4.3 R2', 'checked_at 30 s after now is within the clock skew.', 'base', 'principal', ACCEPTED, {
      revocation: await snapshot('base', NOW, (s) => { s.checked_at = iso(NOW + 30_000); }),
    }),
    await strict('13_checked_30_001_s_ahead', '§4.3 R2', 'checked_at 30.001 s after now: a snapshot dated in the future.', 'base', 'principal', nonCompliant(['REVOCATION_INVALID']), {
      revocation: await snapshot('base', NOW, (s) => { s.checked_at = iso(NOW + 30_001); }),
    }),
    await strict('13_checked_at_not_rfc3339', '§4.3 R2', 'checked_at is not an RFC 3339 timestamp.', 'base', 'principal', nonCompliant(['REVOCATION_INVALID']), {
      revocation: await snapshot('base', NOW, (s) => { s.checked_at = '2026-11-02 10:00:30'; }),
    }),
    await strict('13_status_not_in_schema', '§4.3 R2', 'A status other than revoked, not_revoked or unknown.', 'base', 'principal', nonCompliant(['REVOCATION_INVALID']), {
      revocation: await snapshot('base', NOW, (s) => { (s.agents as Record<string, string>)[AGENT] = 'clear'; }),
    }),
    await strict('13_extra_field', '§4.3 R2', 'A field outside the schema.', 'base', 'principal', nonCompliant(['REVOCATION_INVALID']), {
      revocation: await snapshot('base', NOW, (s) => { (s as unknown as Record<string, unknown>).revoked = false; }),
    }),
    await strict('13_unavailable', '§4.3 R1', 'The source could not answer (timeout, error): no snapshot.', 'base', 'principal', nonCompliant(['REVOCATION_UNAVAILABLE']), { revocation: null }),
  ];

  // ── Configuration cases (7, 14) ──
  const good = trustSets.principal as { trust_set_version: string; principals: Array<{ human_id: string; keys: Array<Record<string, unknown>> }> };
  const withKeys = (keys: Array<Record<string, unknown>>) => ({ trust_set_version: 'bad', principals: [{ human_id: PRINCIPAL, keys }] });
  const k0 = good.principals[0].keys[0];
  const k1 = good.principals[0].keys[1];
  const configCases = [
    { name: '7_kid_not_derived', rule: '§2.2', kind: 'trust_set', config: withKeys([{ ...k0, kid: kidOf(attacker.classical) }, k1]), expected_code: 'CONFIG_TRUST_KID_NOT_DERIVED' },
    { name: '7_kid_of_other_alg', rule: '§2.2', kind: 'trust_set', config: withKeys([{ ...k0, kid: k1.kid }, k1]), expected_code: 'CONFIG_TRUST_KID_NOT_DERIVED' },
    { name: '7_duplicate_human_id', rule: '§2.2', kind: 'trust_set', config: { trust_set_version: 'bad', principals: [good.principals[0], { human_id: PRINCIPAL, keys: [trusted(rotated.classical)] }] }, expected_code: 'CONFIG_TRUST_DUPLICATE' },
    { name: '7_same_key_for_two_principals', rule: '§2.2', kind: 'trust_set', config: { trust_set_version: 'bad', principals: [good.principals[0], { human_id: 'human:other', keys: [k0] }] }, expected_code: 'CONFIG_TRUST_DUPLICATE' },
    { name: '7_identical_key_twice', rule: '§2.2', kind: 'trust_set', config: withKeys([k0, k0]), expected_code: 'CONFIG_TRUST_DUPLICATE' },
    { name: '7_empty_human_id', rule: '§2.2', kind: 'trust_set', config: { trust_set_version: 'bad', principals: [{ human_id: '', keys: [k0] }] }, expected_code: 'CONFIG_TRUST_EMPTY_ID' },
    { name: '7_missing_human_id', rule: '§2.2', kind: 'trust_set', config: { trust_set_version: 'bad', principals: [{ keys: [k0] }] }, expected_code: 'CONFIG_TRUST_EMPTY_ID' },
    { name: '7_key_wrong_length', rule: '§2.2', kind: 'trust_set', config: withKeys([{ ...k0, public_key_b64: Buffer.alloc(31, 7).toString('base64') }]), expected_code: 'CONFIG_TRUST_MALFORMED_KEY' },
    { name: '7_key_not_canonical_base64', rule: '§2.2', kind: 'trust_set', config: withKeys([{ ...k0, public_key_b64: `${k0.public_key_b64 as string}\n` }]), expected_code: 'CONFIG_TRUST_MALFORMED_KEY' },
    { name: '7_unknown_alg', rule: '§2.2', kind: 'trust_set', config: withKeys([{ ...k0, alg: 'ed448' }]), expected_code: 'CONFIG_TRUST_MALFORMED_KEY' },
    { name: '7_unknown_key_field', rule: '§2.2', kind: 'trust_set', config: withKeys([{ ...k0, trusted_by: 'bundle' }]), expected_code: 'CONFIG_UNKNOWN_FIELD' },
    { name: '7_unknown_top_field', rule: '§2.2', kind: 'trust_set', config: { ...good, source_url: 'https://example.com' }, expected_code: 'CONFIG_UNKNOWN_FIELD' },
    { name: '7_bad_status', rule: '§2.2', kind: 'trust_set', config: withKeys([{ ...k0, status: 'trusted' }]), expected_code: 'CONFIG_INVALID_VALUE' },
    { name: '7_bad_expires_at', rule: '§2.2', kind: 'trust_set', config: withKeys([{ ...k0, expires_at: '2027-01-01' }]), expected_code: 'CONFIG_INVALID_VALUE' },
    { name: '7_missing_version', rule: '§2.2', kind: 'trust_set', config: { principals: good.principals }, expected_code: 'CONFIG_INVALID_VALUE' },
    { name: '7_empty_keys', rule: '§2.2', kind: 'trust_set', config: { trust_set_version: 'bad', principals: [{ human_id: PRINCIPAL, keys: [] }] }, expected_code: 'CONFIG_INVALID_VALUE' },

    ...[
      ['14_allow_v1_bundles', { verifier_policy: { allow_v1_bundles: true } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_no_session_binding', { verifier_policy: { require_session_binding: false } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_no_session_expiry', { verifier_policy: { require_session_expiry: false } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_no_audience_binding', { verifier_policy: { require_audience_binding: false } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_no_composite_binding', { verifier_policy: { require_composite_binding: false } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_classical_fallback', { verifier_policy: { allow_classical_fallback_disable: true } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_classical_only_mode', { verifier_policy: { default_mode: 'classical_only' } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_pq_only_mode', { verifier_policy: { default_mode: 'pq_only' } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_hybrid_preferred_tier', { verifier_policy: { risk_overrides: { high: 'hybrid_preferred' } } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_pq_only_tier', { verifier_policy: { risk_overrides: { low: 'pq_only' } } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_min_pq_zero', { verifier_policy: { min_pq: 0 } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_no_pq_algs', { verifier_policy: { accepted_pq_algs: [] } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_extra_classical_alg', { verifier_policy: { accepted_classical_algs: ['ed25519', 'ecdsa-p256'] } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_longer_policy_session', { verifier_policy: { max_session_duration_seconds: 600 } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_policy_no_session_limit', { verifier_policy: { max_session_duration_seconds: 0 } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_policy_other_verifier_id', { verifier_policy: { verifier_id: 'verifier:other-api' } }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_session_maximum_301', { max_session_duration_seconds: 301 }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_session_maximum_0', { max_session_duration_seconds: 0 }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_revocation_age_301', { max_revocation_age_seconds: 301 }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_no_verifier_id', { verifier_id: undefined }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_empty_verifier_id', { verifier_id: '' }, 'CONFIG_PROFILE_CONTRADICTION'],
      ['14_session_maximum_string', { max_session_duration_seconds: '300' }, 'CONFIG_INVALID_VALUE'],
      ['14_session_maximum_fraction', { max_session_duration_seconds: 120.5 }, 'CONFIG_INVALID_VALUE'],
      ['14_verifier_id_number', { verifier_id: 42 }, 'CONFIG_INVALID_VALUE'],
      ['14_unknown_profile', { profile: 'strict-v2' }, 'CONFIG_INVALID_VALUE'],
      ['14_bad_mode_value', { verifier_policy: { default_mode: 'none' } }, 'CONFIG_INVALID_VALUE'],
      ['14_flag_as_string', { verifier_policy: { require_session_binding: 'true' } }, 'CONFIG_INVALID_VALUE'],
      ['14_unknown_option', { fail_open: true }, 'CONFIG_UNKNOWN_FIELD'],
      ['14_unknown_policy_field', { verifier_policy: { trust_bundle_keys: true } }, 'CONFIG_UNKNOWN_FIELD'],
      ['14_unknown_risk_tier', { verifier_policy: { risk_overrides: { critical: 'hybrid_required' } } }, 'CONFIG_UNKNOWN_FIELD'],
    ].map(([name, change, code]) => {
      const config: Record<string, unknown> = { ...(profiles.strict as object), ...(change as object) };
      for (const [k, v] of Object.entries(config)) if (v === undefined) delete config[k];
      return { name, rule: '§4.1', kind: 'profile', config, expected_code: code };
    }),
  ];
  // Tightening that the profile accepts.
  const acceptedProfiles = [
    { name: 'profile_tightened', rule: '§4.1', config: { ...(profiles.strict as object), max_session_duration_seconds: 60, max_revocation_age_seconds: 30, verifier_policy: { accepted_pq_algs: ['ml-dsa-65'], advisory_rejected_algs: ['slh-dsa-192f'], max_session_duration_seconds: 45, require_session_binding: true, default_mode: 'hybrid_required', verifier_id: VERIFIER_ID } }, expected_max_session_duration_seconds: 45, expected_max_revocation_age_seconds: 30 },
    { name: 'profile_defaults', rule: '§4.1', config: profiles.strict, expected_max_session_duration_seconds: 300, expected_max_revocation_age_seconds: 300 },
  ];

  // ── Check the TypeScript SDK gives every expected outcome ──
  const failures: string[] = [];
  for (const c of cases) {
    const result = await admitSignedBundleV2(structuredClone(bundles[c.bundle]), registry, {
      profile: c.profile ? (profiles[c.profile] as never) : undefined,
      trust: c.trust ? (trustSets[c.trust] as never) : undefined,
      revocation: c.revocation,
      now: Date.parse(c.now),
    });
    const got = {
      verified: result.verified,
      principal_trust: result.principal_trust,
      profile_compliance: result.profile_compliance,
      admitted: result.admitted,
      recorded_decision: result.recorded_decision,
      action_authorized: result.action_authorized,
      codes: [...new Set(result.errors.map((e) => e.code))].sort(),
    };
    if (JSON.stringify(got) !== JSON.stringify(c.expected)) {
      failures.push(`${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(got)} ${JSON.stringify(result.errors)} ${JSON.stringify(result.verification.errors)}`);
    }
  }
  for (const c of configCases) {
    try {
      if (c.kind === 'trust_set') createPrincipalTrustStore(c.config);
      else resolveStrictV1Profile(c.config);
      failures.push(`${c.name}: accepted, expected ${c.expected_code}`);
    } catch (e) {
      const code = e instanceof AdmissionConfigError ? e.code : String(e);
      if (code !== c.expected_code) failures.push(`${c.name}: ${code}, expected ${c.expected_code}`);
    }
  }
  for (const c of acceptedProfiles) {
    const p = resolveStrictV1Profile(c.config);
    if (p.maxSessionDurationSeconds !== c.expected_max_session_duration_seconds || p.maxRevocationAgeSeconds !== c.expected_max_revocation_age_seconds) {
      failures.push(`${c.name}: got ${p.maxSessionDurationSeconds}/${p.maxRevocationAgeSeconds}`);
    }
  }
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }

  const out = {
    description:
      'DCP-AI admission vectors (spec/profiles/admission/README.md). Each case gives a signed bundle, the clock (now), the profile, ' +
      'the trust set and the revocation snapshot, and the outcome every SDK MUST produce: verified, principal_trust, ' +
      'profile_compliance, admitted, recorded_decision, action_authorized (always false) and the sorted set of error codes. ' +
      'revocation is evaluated under a profile only; null means the source could not answer. config_cases MUST be refused ' +
      'with expected_code; accepted_profiles MUST load with the given effective limits. Expected values come from the spec, ' +
      'not from any implementation.',
    spec: 'spec/profiles/admission/README.md',
    generated_by: 'sdks/typescript/src/__tests__/generate-admission-vectors.ts',
    verifier_id: VERIFIER_ID,
    signed_bundles: bundles,
    trust_sets: trustSets,
    profiles,
    cases,
    config_cases: configCases,
    accepted_profiles: acceptedProfiles,
  };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  // The conformance examples of the three admission schemas (tools/conformance.js).
  const example = (file: string, value: unknown) =>
    writeFileSync(resolve(ROOT, 'tests/conformance/examples', file), `${JSON.stringify(value, null, 2)}\n`);
  example('principal_trust_set_v2.json', trustSets.rotation_overlap);
  example('admission_profile_v2.json', acceptedProfiles[0].config);
  example('revocation_snapshot_v2.json', cases.find((c) => c.name === 'A_known_principal_strict')!.revocation);
  console.log(`Wrote ${cases.length} cases, ${configCases.length} configuration cases and ${acceptedProfiles.length} accepted profiles to ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
