/**
 * DCP-AI v2.0 Bundle Verification Vector Generator
 *
 * Writes tests/interop/v2/bundle_vectors.json: one signed bundle that every
 * SDK verifier MUST accept, and cases whose mutations (set `value` at `path`)
 * MUST make it reject the bundle with an error that names `error_contains`,
 * whole signed bundles it MUST reject the same way (must_reject_bundles), and
 * a classical-only control with its expected verdict per mode. Each case names
 * the spec/VERIFICATION.md step it checks. As in a real deployment the
 * principal (RPR binding_keys) signs the RPR and the bundle, and the agent
 * (passport keys) signs the passport, intent and policy decision.
 *
 * Run: cd sdks/typescript && npx vite-node src/__tests__/generate-bundle-vectors.ts
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
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
import { DEFAULT_VERIFIER_POLICY } from '../core/verify-v2.js';
import type {
  AgentPassportV2,
  AuditEventV2,
  IntentV2,
  KeyEntry,
  PolicyDecisionV2,
  ResponsiblePrincipalRecordV2,
} from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../../../../tests/interop/v2/bundle_vectors.json');

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

async function sign<T>(payload: T, context: DcpContext, keys: CompositeKeyPair, classicalOnly = false) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  const composite_sig = classicalOnly
    ? await classicalOnlySign(registry, context, canonicalBytes, keys.classical)
    : await compositeSign(registry, context, canonicalBytes, keys);
  return { payload, payload_hash: payloadHash, composite_sig };
}

/** Changes to the default bundle; classicalOnly signs everything without PQ. */
interface Variant {
  passport?: Partial<AgentPassportV2>;
  intent?: Partial<IntentV2>;
  policyDecision?: Partial<PolicyDecisionV2>;
  classicalOnly?: boolean;
  /** Drop the pq member from the bundle signature (the schema requires it, null for classical_only). */
  bundleSigWithoutPq?: boolean;
  /** Applied to every agent key entry (passport keys) or principal one (RPR binding_keys). */
  agentKey?: Partial<KeyEntry>;
  principalKey?: Partial<KeyEntry>;
  /** Manifest fields set before signing; undefined removes one. */
  manifest?: Record<string, unknown>;
  /** prev_hash of the first audit entry instead of GENESIS. */
  firstPrevHash?: string;
  /** No audit entries, with the manifest Go and Rust build for that (the TS builder refuses it). */
  noAuditEntries?: boolean;
}

// A routine intent (spec §14.2), the starting point of the security tier variants.
const ROUTINE_INTENT: Partial<IntentV2> = {
  action_type: 'browse',
  target: { channel: 'web' },
  data_classes: ['none'],
  estimated_impact: 'low',
};

const sha256Of = (obj: unknown) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(obj), 'utf8'))}`;

function corrupt(sigB64: string): string {
  const bytes = Buffer.from(sigB64, 'base64');
  bytes[0] ^= 0xff;
  return bytes.toString('base64');
}

async function main() {
  const principal = await generateKeys();
  const agent = await generateKeys();
  const nonce = generateSessionNonce();

  async function build(variant: Variant = {}) {
    const rpr: ResponsiblePrincipalRecordV2 = {
      dcp_version: '2.0',
      human_id: 'human:interop-principal',
      session_nonce: nonce,
      legal_name: 'Interop Principal',
      entity_type: 'natural_person',
      jurisdiction: 'US-CA',
      liability_mode: 'owner_responsible',
      override_rights: true,
      issued_at: '2026-10-21T00:00:00Z',
      expires_at: null,
      contact: null,
      binding_keys: keyEntries(principal).map((k) => ({ ...k, ...variant.principalKey })),
    };
    const passport: AgentPassportV2 = {
      dcp_version: '2.0',
      agent_id: 'agent:interop-bot',
      session_nonce: nonce,
      // A far-future expiry with an offset, so every verifier parses one on the happy path.
      keys: keyEntries(agent).map((k) => ({ ...k, expires_at: '2099-12-31T18:59:59-05:00', ...variant.agentKey })),
      principal_binding_reference: rpr.human_id,
      capabilities: ['browse', 'api_call'],
      risk_tier: 'medium',
      created_at: '2026-10-21T00:00:00Z',
      status: 'active',
      ...variant.passport,
    };
    const intent: IntentV2 = {
      dcp_version: '2.0',
      intent_id: 'intent:interop-001',
      session_nonce: nonce,
      agent_id: passport.agent_id,
      human_id: rpr.human_id,
      timestamp: '2026-10-21T12:00:00Z',
      action_type: 'send_email',
      target: { channel: 'email', to: 'bob@example.com', domain: 'example.com' },
      data_classes: ['contact_info'],
      estimated_impact: 'medium',
      requires_consent: false,
      ...variant.intent,
    };
    const policyDecision: PolicyDecisionV2 = {
      dcp_version: '2.0',
      intent_id: intent.intent_id,
      session_nonce: nonce,
      decision: 'approve',
      risk_score: 450,
      reasons: ['Known recipient domain'],
      required_confirmation: null,
      applied_policy_hash: sha256Of({ policy: 'default' }),
      timestamp: '2026-10-21T12:00:01Z',
      ...variant.policyDecision,
    };
    const audit: AuditEventV2 = {
      dcp_version: '2.0',
      audit_id: 'audit:interop-001',
      session_nonce: nonce,
      prev_hash: variant.firstPrevHash ?? 'GENESIS',
      hash_alg: 'sha256',
      timestamp: '2026-10-21T12:01:00Z',
      agent_id: passport.agent_id,
      human_id: rpr.human_id,
      intent_id: intent.intent_id,
      intent_hash: sha256Of(intent),
      policy_decision: 'approved',
      outcome: 'email_sent',
      evidence: { tool: 'smtp', result_ref: null, evidence_hash: null },
      pq_checkpoint_ref: null,
    };
    const audit2: AuditEventV2 = { ...audit, audit_id: 'audit:interop-002', prev_hash: sha256Of(audit), timestamp: '2026-10-21T12:02:00Z' };

    const signedIntent = await sign(intent, DCP_CONTEXTS.Intent, agent, variant.classicalOnly);
    const bundle = new BundleBuilderV2(nonce)
      .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal, variant.classicalOnly))
      .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport, agent, variant.classicalOnly))
      .intent(signedIntent)
      .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision, agent, variant.classicalOnly))
      .addAuditEntries([audit, audit2])
      .build();
    if (variant.noAuditEntries) {
      bundle.audit_entries = [];
      Object.assign(bundle.manifest, { audit_count: 0, audit_merkle_root: `sha256:${'0'.repeat(64)}` });
    }
    Object.assign(bundle.manifest, { session_expires_at: '2099-12-31T23:59:59+05:00' }, variant.manifest);
    const signer = { registry, signerType: 'human' as const, signerId: rpr.human_id };
    const signedBundle = variant.classicalOnly
      ? await signBundleV2ClassicalOnly(bundle, { ...signer, key: principal.classical })
      : await signBundleV2(bundle, { ...signer, keys: principal });
    if (variant.bundleSigWithoutPq) delete (signedBundle.signature.composite_sig as Partial<CompositeSignature>).pq;
    return { rpr, passport, intent, policyDecision, bundle, signedIntent, signedBundle };
  }

  const { rpr, passport, intent, policyDecision, bundle, signedIntent, signedBundle } = await build();

  const b = signedBundle.bundle;
  const bundleSig = signedBundle.signature.composite_sig;
  const intentSig = signedIntent.composite_sig;
  const set = (path: string[], value: unknown) => ({ path, value });
  const dsm = (context: DcpContext, payload: unknown) =>
    domainSeparatedMessage(context, new TextEncoder().encode(canonicalizeV2(payload)));
  // What the PQ slot of a pq_over_classical signature covers.
  const overClassical = (context: DcpContext, payload: unknown, classicalSigB64: string) =>
    new Uint8Array(Buffer.concat([dsm(context, payload), Buffer.from(classicalSigB64, 'base64')]));
  const signB64 = async (provider: Ed25519Provider | MlDsa65Provider, skB64: string, msg: Uint8Array) =>
    Buffer.from(await provider.sign(msg, skB64)).toString('base64');
  const passportMlDsaSig = await signB64(mlDsa65, agent.pq.secretKeyB64, dsm(DCP_CONTEXTS.AgentPassport, passport));
  const agentSigned = await signBundleV2(structuredClone(bundle), {
    registry,
    signerType: 'organization',
    signerId: passport.agent_id,
    keys: agent,
  });

  const mustReject = [
    {
      name: 'bundle_pq_signature_invalid',
      spec_step: 'V2-7',
      error_contains: 'bundle',
      mutations: [set(['signature', 'composite_sig', 'pq', 'sig_b64'], corrupt(bundleSig.pq!.sig_b64))],
    },
    {
      name: 'rpr_classical_signature_invalid',
      spec_step: 'V2-8',
      error_contains: 'responsible_principal_record',
      mutations: [
        set(
          ['bundle', 'responsible_principal_record', 'composite_sig', 'classical', 'sig_b64'],
          corrupt(b.responsible_principal_record.composite_sig.classical.sig_b64),
        ),
      ],
    },
    {
      name: 'passport_pq_signature_invalid',
      spec_step: 'V2-8',
      error_contains: 'agent_passport',
      mutations: [
        set(['bundle', 'agent_passport', 'composite_sig', 'pq', 'sig_b64'], corrupt(b.agent_passport.composite_sig.pq!.sig_b64)),
      ],
    },
    {
      name: 'intent_signatures_zeroed',
      spec_step: 'V2-8',
      error_contains: 'intent',
      mutations: [
        set(['bundle', 'intent', 'composite_sig'], {
          ...intentSig,
          classical: { ...intentSig.classical, sig_b64: Buffer.alloc(64).toString('base64') },
          pq: { ...intentSig.pq!, sig_b64: Buffer.alloc(3309).toString('base64') },
        }),
      ],
    },
    {
      name: 'intent_signed_by_principal',
      spec_step: 'V2-8',
      error_contains: 'intent',
      mutations: [set(['bundle', 'intent', 'composite_sig'], (await sign(intent, DCP_CONTEXTS.Intent, principal)).composite_sig)],
    },
    {
      name: 'intent_payload_hash_wrong',
      spec_step: 'V2-3',
      error_contains: 'intent',
      mutations: [set(['bundle', 'intent', 'payload_hash'], sha256Of({ not: 'the intent' }))],
    },
    {
      // A self-consistent chain from GENESIS, but not the one the manifest commits to.
      name: 'audit_entries_replaced',
      spec_step: 'V2-3',
      error_contains: 'audit',
      mutations: [
        set(['bundle', 'audit_entries'], (() => {
          const first = { ...b.audit_entries[0], outcome: 'email_deleted' };
          return [first, { ...b.audit_entries[1], prev_hash: sha256Of(first), outcome: 'email_deleted' }];
        })()),
      ],
    },
    {
      name: 'audit_entries_truncated',
      spec_step: 'V2-3',
      error_contains: 'audit',
      mutations: [set(['bundle', 'audit_entries'], [b.audit_entries[0]])],
    },
    {
      name: 'policy_decision_signed_under_intent_context',
      spec_step: 'V2-8',
      error_contains: 'policy_decision',
      mutations: [
        set(['bundle', 'policy_decision', 'composite_sig'], (await sign(policyDecision, DCP_CONTEXTS.Intent, agent)).composite_sig),
      ],
    },
    {
      name: 'bundle_pq_slot_holds_ed25519',
      spec_step: 'V2-7',
      error_contains: 'bundle',
      mutations: [
        set(['signature', 'composite_sig', 'pq'], {
          alg: 'ed25519',
          kid: principal.classical.kid,
          sig_b64: await signB64(
            ed25519,
            principal.classical.secretKeyB64,
            overClassical(DCP_CONTEXTS.Bundle, b.manifest, bundleSig.classical.sig_b64),
          ),
        }),
      ],
    },
    {
      name: 'intent_pq_slot_holds_ed25519',
      spec_step: 'V2-8',
      error_contains: 'intent',
      mutations: [
        set(['bundle', 'intent', 'composite_sig', 'pq'], {
          alg: 'ed25519',
          kid: agent.classical.kid,
          sig_b64: await signB64(
            ed25519,
            agent.classical.secretKeyB64,
            overClassical(DCP_CONTEXTS.Intent, intent, intentSig.classical.sig_b64),
          ),
        }),
      ],
    },
    {
      name: 'passport_classical_slot_holds_ml_dsa',
      spec_step: 'V2-8',
      error_contains: 'agent_passport',
      mutations: [
        set(['bundle', 'agent_passport', 'composite_sig'], {
          classical: { alg: 'ml-dsa-65', kid: agent.pq.kid, sig_b64: passportMlDsaSig },
          pq: {
            alg: 'ml-dsa-65',
            kid: agent.pq.kid,
            sig_b64: await signB64(
              mlDsa65,
              agent.pq.secretKeyB64,
              overClassical(DCP_CONTEXTS.AgentPassport, passport, passportMlDsaSig),
            ),
          },
          binding: 'pq_over_classical',
        }),
      ],
    },
    {
      name: 'policy_decision_kid_names_another_algorithm',
      spec_step: 'V2-8',
      error_contains: 'policy_decision',
      mutations: [set(['bundle', 'policy_decision', 'composite_sig', 'classical', 'kid'], agent.pq.kid)],
    },
    {
      name: 'intent_null',
      spec_step: 'V2-8',
      error_contains: 'intent',
      mutations: [set(['bundle', 'intent'], null)],
    },
    {
      name: 'policy_decision_not_an_object',
      spec_step: 'V2-8',
      error_contains: 'policy_decision',
      mutations: [set(['bundle', 'policy_decision'], 'x')],
    },
    {
      name: 'rpr_null_in_agent_signed_bundle',
      spec_step: 'V2-8',
      error_contains: 'responsible_principal_record',
      mutations: [
        set(['signature'], agentSigned.signature),
        set(['bundle', 'responsible_principal_record'], null),
      ],
    },
  ];

  // Classical-only bundles from a passport that declares itself low risk, which
  // DEFAULT_VERIFIER_POLICY maps to classical_only: only the security tier
  // (spec §14.3) rejects them, with an error about the missing PQ signature.
  const lowRisk = { classicalOnly: true, passport: { risk_tier: 'low' as const }, policyDecision: { risk_score: 0 } };
  const mustRejectBundles: { name: string; spec_step: string; error_contains: string; variant: Variant }[] = [
    {
      name: 'classical_only_payment_from_low_risk_passport',
      spec_step: 'V2-10',
      error_contains: 'pq',
      variant: { ...lowRisk, intent: { ...ROUTINE_INTENT, action_type: 'initiate_payment', target: { channel: 'payments' } } },
    },
    {
      name: 'classical_only_policy_risk_score_900',
      spec_step: 'V2-10',
      error_contains: 'pq',
      variant: { ...lowRisk, intent: ROUTINE_INTENT, policyDecision: { risk_score: 900 } },
    },
    {
      name: 'classical_only_explicit_security_tier_elevated',
      spec_step: 'V2-10',
      error_contains: 'pq',
      variant: { ...lowRisk, intent: { ...ROUTINE_INTENT, security_tier: 'elevated' } },
    },
    {
      // The control's bundle signature without its pq member: the schema requires
      // pq, null for classical_only, and an absent one is not a classical_only signature.
      name: 'classical_only_bundle_signature_without_pq',
      spec_step: 'V2-5',
      error_contains: 'bundle',
      variant: { ...lowRisk, intent: ROUTINE_INTENT, bundleSigWithoutPq: true },
    },
    {
      name: 'audit_chain_not_starting_at_genesis',
      spec_step: 'V2-3',
      error_contains: 'chain',
      variant: { firstPrevHash: `sha256:${'0'.repeat(64)}` },
    },
    {
      // What the TypeScript builder wrote for an empty audit trail before the
      // empty root was defined as 64 zeros.
      name: 'empty_audit_trail_with_another_root',
      spec_step: 'V2-3',
      error_contains: 'audit',
      variant: { noAuditEntries: true, manifest: { audit_merkle_root: 'sha256:undefined' } },
    },
    { name: 'manifest_without_rpr_hash', spec_step: 'V2-3', error_contains: 'rpr_hash', variant: { manifest: { rpr_hash: undefined } } },
    {
      name: 'session_expired',
      spec_step: 'V2-4',
      error_contains: 'session expired',
      variant: { manifest: { session_expires_at: '2020-01-01T00:00:00Z' } },
    },
    {
      name: 'session_expired_with_offset',
      spec_step: 'V2-4',
      error_contains: 'session expired',
      variant: { manifest: { session_expires_at: '2020-01-01T09:00:00+05:00' } },
    },
    ...['n/a', '', '2099-12-31', 4102444800].map((value, i) => ({
      name: `session_expires_at_${['not_a_timestamp', 'empty', 'date_only', 'not_a_string'][i]}`,
      spec_step: 'V2-4',
      error_contains: 'session_expires_at',
      variant: { manifest: { session_expires_at: value } },
    })),
    {
      name: 'passport_key_expires_at_not_a_timestamp',
      spec_step: 'V2-13',
      error_contains: 'expires_at',
      variant: { agentKey: { expires_at: 'n/a' } },
    },
    {
      name: 'passport_key_expires_at_not_a_string',
      spec_step: 'V2-13',
      error_contains: 'expires_at',
      variant: { agentKey: { expires_at: 4102444800 as unknown as string } },
    },
    { name: 'passport_key_revoked', spec_step: 'V2-13', error_contains: 'revoked', variant: { agentKey: { status: 'revoked' } } },
    {
      name: 'passport_key_expired',
      spec_step: 'V2-13',
      error_contains: 'expired',
      variant: { agentKey: { expires_at: '2020-01-01T00:00:00Z' } },
    },
    { name: 'passport_key_status_expired', spec_step: 'V2-13', error_contains: 'expired', variant: { agentKey: { status: 'expired' } } },
    { name: 'rpr_binding_key_revoked', spec_step: 'V2-13', error_contains: 'revoked', variant: { principalKey: { status: 'revoked' } } },
    {
      name: 'rpr_binding_key_status_expired',
      spec_step: 'V2-13',
      error_contains: 'expired',
      variant: { principalKey: { status: 'expired' } },
    },
    {
      name: 'rpr_binding_key_expired',
      spec_step: 'V2-13',
      error_contains: 'expired',
      variant: { principalKey: { expires_at: '2020-01-01T00:00:00Z' } },
    },
  ];

  const vectors = {
    _description:
      'Cross-SDK V2 bundle verification vectors (spec/VERIFICATION.md V2). ' +
      'Every verifier MUST accept signed_bundle. After applying the mutations of any must_reject ' +
      'case (set value at path, in order) it MUST reject it, whatever its verification mode, with ' +
      'an error that contains error_contains (case-insensitive). It MUST also reject every ' +
      'must_reject_bundles entry the same way, and give classical_only_routine_bundle the verdict ' +
      'in verified_by_mode. Every must_accept_bundles entry MUST verify in every mode. ' +
      'default_verifier_policy is the TypeScript DEFAULT_VERIFIER_POLICY; a ' +
      'verifier that takes a policy MUST accept it and verify signed_bundle under it.',
    _generator: 'sdks/typescript/src/__tests__/generate-bundle-vectors.ts',
    default_verifier_policy: DEFAULT_VERIFIER_POLICY,
    signed_bundle: signedBundle,
    must_reject: mustReject,
    classical_only_routine_bundle: {
      _description:
        'Control for must_reject_bundles: the same classical-only, low-risk bundle with a routine ' +
        'intent. verified_by_mode is the expected verdict under each verification mode.',
      signed_bundle: (await build({ ...lowRisk, intent: ROUTINE_INTENT })).signedBundle,
      verified_by_mode: { classical_only: true, hybrid_preferred: true, hybrid_required: false, pq_only: false },
    },
    must_accept_bundles: [
      {
        name: 'empty_audit_trail',
        spec_step: 'V2-3',
        signed_bundle: (await build({ noAuditEntries: true })).signedBundle,
      },
    ],
    must_reject_bundles: await Promise.all(
      mustRejectBundles.map(async ({ variant, ...rest }) => ({
        ...rest,
        signed_bundle: (await build(variant)).signedBundle,
      })),
    ),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(vectors, null, 2) + '\n');
  console.log(`Bundle vectors written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
