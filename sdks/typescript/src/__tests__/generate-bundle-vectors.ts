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
import { auditEventsMerkleRoot } from '../core/pq-checkpoint.js';
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
  /** prev_hash of the second audit entry instead of the first entry's hash. */
  secondPrevHash?: string;
  /** The intent is signed under this session_nonce; the manifest commits to that intent. */
  intentNonce?: string;
  /** The second audit entry carries this session_nonce; the manifest commits to that trail. */
  auditNonce?: string;
  /** Changes to the RPR, and to both audit entries (the chain is recomputed over them). */
  rpr?: Partial<ResponsiblePrincipalRecordV2>;
  audit?: Partial<AuditEventV2>;
  /** Keys in place of the agent's (passport keys and the artifacts it signs) or the principal's (RPR). */
  agentKeys?: CompositeKeyPair;
  principalKeys?: CompositeKeyPair;
  /** Keys that sign the bundle instead of the principal's. */
  bundleKeys?: CompositeKeyPair;
  /** signature.created_at, outside the signed manifest, set after signing. */
  createdAt?: string;
  /** Edits the passport key entries before the passport is signed. */
  passportKeysEdit?: (keys: KeyEntry[]) => void;
  /** The policy decision, or the second audit entry, carries no session_nonce; the manifest commits to it. */
  policyNoNonce?: boolean;
  auditNoNonce?: boolean;
  /** A PQ checkpoint over the two audit entries, signed by the agent unless keys says otherwise. */
  checkpoint?: {
    count?: number;
    nonce?: string;
    merkleRoot?: string;
    keys?: CompositeKeyPair;
    /** The manifest lists it / the bundle carries it (both by default). */
    listed?: boolean;
    carried?: boolean;
    /** Applied to the signed checkpoint. */
    mutate?: (cp: Record<string, any>) => void;
  };
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
    const principalKeys = variant.principalKeys ?? principal;
    const agentKeys = variant.agentKeys ?? agent;
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
      binding_keys: keyEntries(principalKeys).map((k) => ({ ...k, ...variant.principalKey })),
      ...variant.rpr,
    };
    const passport: AgentPassportV2 = {
      dcp_version: '2.0',
      agent_id: 'agent:interop-bot',
      session_nonce: nonce,
      // A far-future expiry with an offset, so every verifier parses one on the happy path.
      keys: keyEntries(agentKeys).map((k) => ({ ...k, expires_at: '2099-12-31T18:59:59-05:00', ...variant.agentKey })),
      principal_binding_reference: rpr.human_id,
      capabilities: ['browse', 'api_call'],
      risk_tier: 'medium',
      created_at: '2026-10-21T00:00:00Z',
      status: 'active',
      ...variant.passport,
    };
    variant.passportKeysEdit?.(passport.keys);
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
      ...variant.audit,
    };
    const audit2: AuditEventV2 = {
      ...audit,
      audit_id: 'audit:interop-002',
      prev_hash: variant.secondPrevHash ?? sha256Of(audit),
      timestamp: '2026-10-21T12:02:00Z',
    };

    const signedIntent = await sign(intent, DCP_CONTEXTS.Intent, agentKeys, variant.classicalOnly);
    const bundle = new BundleBuilderV2(nonce)
      .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principalKeys, variant.classicalOnly))
      .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport, agentKeys, variant.classicalOnly))
      .intent(signedIntent)
      .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision, agentKeys, variant.classicalOnly))
      .addAuditEntries([audit, audit2])
      .build();
    if (variant.noAuditEntries) {
      bundle.audit_entries = [];
      Object.assign(bundle.manifest, { audit_count: 0, audit_merkle_root: `sha256:${'0'.repeat(64)}` });
    }
    // The builder refuses nonces that differ, so these are patched in after it,
    // with the manifest committing to the patched artifact.
    if (variant.intentNonce) {
      bundle.intent = await sign({ ...intent, session_nonce: variant.intentNonce }, DCP_CONTEXTS.Intent, agent);
      bundle.manifest.intent_hash = bundle.intent.payload_hash;
    }
    if (variant.policyNoNonce) {
      const { session_nonce: _omitted, ...withoutNonce } = policyDecision;
      bundle.policy_decision = await sign(withoutNonce, DCP_CONTEXTS.PolicyDecision, agentKeys) as never;
      bundle.manifest.policy_hash = bundle.policy_decision.payload_hash;
    }
    if (variant.auditNoNonce) {
      const { session_nonce: _omitted, ...withoutNonce } = audit2;
      bundle.audit_entries[1] = withoutNonce as AuditEventV2;
      bundle.manifest.audit_merkle_root = `sha256:${auditEventsMerkleRoot(bundle.audit_entries)}`;
    }
    if (variant.auditNonce) {
      bundle.audit_entries[1] = { ...audit2, session_nonce: variant.auditNonce };
      bundle.manifest.audit_merkle_root = `sha256:${auditEventsMerkleRoot(bundle.audit_entries)}`;
    }
    if (variant.checkpoint) {
      const c = variant.checkpoint;
      const checkpoint = {
        checkpoint_id: 'ckpt-interop-001',
        session_nonce: c.nonce ?? nonce,
        event_range: { from_audit_id: audit.audit_id, to_audit_id: audit2.audit_id, count: c.count ?? 2 },
        merkle_root: c.merkleRoot ?? `sha256:${auditEventsMerkleRoot(bundle.audit_entries)}`,
      };
      const { canonicalBytes } = preparePayload(checkpoint);
      const signedCheckpoint: Record<string, any> = {
        ...checkpoint,
        composite_sig: await compositeSign(registry, DCP_CONTEXTS.AuditEvent, canonicalBytes, c.keys ?? agentKeys),
      };
      c.mutate?.(signedCheckpoint);
      if (c.carried ?? true) bundle.pq_checkpoints = [signedCheckpoint as never];
      if (c.listed ?? true) bundle.manifest.pq_checkpoints = [checkpoint.checkpoint_id];
    }
    Object.assign(
      bundle.manifest,
      { session_issued_at: '2026-10-21T00:00:00Z', session_expires_at: '2099-12-31T23:59:59+05:00' },
      variant.manifest,
    );
    const signer = { registry, signerType: 'human' as const, signerId: rpr.human_id };
    const bundleKeys = variant.bundleKeys ?? principalKeys;
    const signedBundle = variant.classicalOnly
      ? await signBundleV2ClassicalOnly(bundle, { ...signer, key: bundleKeys.classical })
      : await signBundleV2(bundle, { ...signer, keys: bundleKeys });
    if (variant.bundleSigWithoutPq) delete (signedBundle.signature.composite_sig as Partial<CompositeSignature>).pq;
    if (variant.createdAt) signedBundle.signature.created_at = variant.createdAt;
    // A bundle from a signer that predates session_issued_at: the signers now
    // stamp it whenever there is an expiry, so the manifest is signed again without it.
    if (variant.manifest && 'session_issued_at' in variant.manifest && variant.manifest.session_issued_at === undefined) {
      delete signedBundle.bundle.manifest.session_issued_at;
      const { canonicalBytes, payloadHash } = preparePayload(signedBundle.bundle.manifest);
      signedBundle.signature.composite_sig = variant.classicalOnly
        ? await classicalOnlySign(registry, DCP_CONTEXTS.Bundle, canonicalBytes, bundleKeys.classical)
        : await compositeSign(registry, DCP_CONTEXTS.Bundle, canonicalBytes, bundleKeys);
      signedBundle.signature.manifest_hash = payloadHash;
    }
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
    signerId: rpr.human_id,
    keys: agent,
  });

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // The same 32 bytes with a trailing bit set: a lenient decoder reads the key, a strict one refuses it.
  const withTrailingBit = (b64: string) => {
    if (!b64.includes('=')) return b64; // no padding, no trailing bits to set
    const i = b64.indexOf('=') - 1;
    return b64.slice(0, i) + B64[B64.indexOf(b64[i]) ^ 1] + b64.slice(i + 1);
  };
  // Non-canonical encodings of the same signature bytes (V2-5): a lenient decoder reads them.
  const sigEncodings: [string, (s: string) => string][] = [
    ['with_junk_after', (s) => s + 'x'],
    ['with_extra_padding', (s) => s + '='],
    ['with_a_newline', (s) => s.slice(0, 10) + '\n' + s.slice(10)],
    ['with_trailing_bits', withTrailingBit],
    ['unpadded', (s) => s.replace(/=+$/, '')],
  ];
  const sigSlots: [string, string[]][] = [
    ['bundle_classical', ['signature', 'composite_sig', 'classical', 'sig_b64']],
    ['bundle_pq', ['signature', 'composite_sig', 'pq', 'sig_b64']],
    ['intent_classical', ['bundle', 'intent', 'composite_sig', 'classical', 'sig_b64']],
  ];
  const atPath = (obj: any, path: string[]) => path.reduce((node, key) => node[key], obj);
  const sigEncodingCases = sigSlots.flatMap(([slot, path]) =>
    sigEncodings
      .map(([name, edit]) => [name, edit(atPath(signedBundle, path))] as const)
      .filter(([, value]) => value !== atPath(signedBundle, path))
      .map(([name, value]) => ({
        name: `${slot}_sig_b64_${name}`,
        spec_step: 'V2-5',
        error_contains: 'sig_b64 is not canonical base64',
        mutations: [set(path, value)],
      })),
  );
  const mustReject = [
    ...sigEncodingCases,
    // The rest of the unsigned signature block (V2-4).
    {
      name: 'signature_manifest_hash_other',
      spec_step: 'V2-4',
      error_contains: 'manifest_hash',
      mutations: [set(['signature', 'manifest_hash'], sha256Of({ not: 'the manifest' }))],
    },
    {
      name: 'signature_hash_alg_unknown',
      spec_step: 'V2-4',
      error_contains: 'hash_alg',
      mutations: [set(['signature', 'hash_alg'], 'md5')],
    },
    // The unsigned signer block must not contradict the signature (V2-4).
    {
      name: 'signature_signer_id_other',
      spec_step: 'V2-4',
      error_contains: 'signer id',
      mutations: [set(['signature', 'signer', 'id'], 'human:someone-else')],
    },
    {
      name: 'signature_signer_kids_other',
      spec_step: 'V2-4',
      error_contains: 'signer kids',
      mutations: [set(['signature', 'signer', 'kids'], [agent.classical.kid, agent.pq.kid])],
    },
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
    // An artifact without any composite_sig, not a zeroed one (V2-8).
    ...(['intent', 'agent_passport', 'policy_decision'] as const).map((name) => ({
      name: `${name}_unsigned`,
      spec_step: 'V2-8',
      error_contains: name,
      mutations: [set(['bundle', name], { payload: b[name].payload, payload_hash: b[name].payload_hash })],
    })),
    ...['1.0', '3.0'].map((version) => ({
      name: `dcp_bundle_version_${version.replace('.', '_')}`,
      spec_step: 'V2-1',
      error_contains: 'version',
      mutations: [set(['bundle', 'dcp_bundle_version'], version)],
    })),
  ];

  // Classical-only bundles from a passport that declares itself low risk, which
  // DEFAULT_VERIFIER_POLICY maps to classical_only: only the security tier
  // (spec §14.3) rejects them, with an error about the missing PQ signature.
  const lowRisk = { classicalOnly: true, passport: { risk_tier: 'low' as const }, policyDecision: { risk_score: 0 } };
  type BundleCase = {
    name: string;
    spec_step: string;
    error_contains: string;
    /** Merged over each mode's policy when verifying this case. */
    verifier_policy_overrides?: Record<string, unknown>;
    variant: Variant;
  };
  const mustRejectBundles: BundleCase[] = [
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
    {
      // Expired as an instant; a verifier that cannot parse the +14:00 offset reports a parse error
      // instead of "expired", which the error_contains check catches.
      name: 'passport_key_expired_with_offset',
      spec_step: 'V2-13',
      error_contains: 'expired',
      variant: { agentKey: { expires_at: '2020-01-01T00:00:00+14:00' } },
    },
    ...['2026-13-45T00:00:00Z', '2026-10-22', '2026-10-22T00:00:00'].map((value, i) => ({
      name: `passport_key_expires_at_${['impossible_date', 'date_only', 'no_offset'][i]}`,
      spec_step: 'V2-13',
      error_contains: 'expires_at',
      variant: { agentKey: { expires_at: value } },
    })),
    {
      name: 'rpr_binding_key_expires_at_impossible_date',
      spec_step: 'V2-13',
      error_contains: 'expires_at',
      variant: { principalKey: { expires_at: '2026-13-45T00:00:00Z' } },
    },
    // Security tier downgrade (V2-9, V2-10): the agent cannot lower the tier its
    // intent and policy decision imply, so a classical-only signature never
    // satisfies an elevated one, whatever the passport or the intent declares.
    {
      name: 'classical_only_estimated_impact_high',
      spec_step: 'V2-10',
      error_contains: 'pq',
      variant: { ...lowRisk, intent: { ...ROUTINE_INTENT, estimated_impact: 'high' } },
    },
    {
      name: 'classical_only_payment_declaring_security_tier_routine',
      spec_step: 'V2-10',
      error_contains: 'pq',
      variant: {
        ...lowRisk,
        intent: { ...ROUTINE_INTENT, action_type: 'initiate_payment', target: { channel: 'payments' }, security_tier: 'routine' },
      },
    },
    {
      name: 'classical_only_policy_risk_score_900_declaring_security_tier_routine',
      spec_step: 'V2-10',
      error_contains: 'pq',
      variant: { ...lowRisk, intent: { ...ROUTINE_INTENT, security_tier: 'routine' }, policyDecision: { risk_score: 900 } },
    },
    // Prototype keys in enumerated fields (V2-2, V2-9): the mode lookup for the
    // passport's risk_tier must not read an inherited property (a TypeScript
    // verifier once resolved no mode at all for "constructor" and accepted the
    // bundle), and an unknown intent value fails closed to elevated.
    ...['constructor', '__proto__', 'toString', 'hasOwnProperty'].map((name): BundleCase => ({
      name: `classical_only_payment_from_passport_risk_tier_${name.replace(/_/g, '')}`,
      spec_step: 'V2-9',
      error_contains: 'pq',
      variant: {
        ...lowRisk,
        passport: { risk_tier: name as 'low' },
        intent: { ...ROUTINE_INTENT, action_type: 'initiate_payment', target: { channel: 'payments' } },
      },
    })),
    {
      name: 'classical_only_intent_action_type_constructor',
      spec_step: 'V2-9',
      error_contains: 'pq',
      variant: { ...lowRisk, intent: { ...ROUTINE_INTENT, action_type: 'constructor' as 'browse' } },
    },
    {
      name: 'classical_only_intent_estimated_impact_constructor',
      spec_step: 'V2-9',
      error_contains: 'pq',
      variant: { ...lowRisk, intent: { ...ROUTINE_INTENT, estimated_impact: 'constructor' as 'low' } },
    },
    {
      name: 'classical_only_intent_security_tier_constructor',
      spec_step: 'V2-9',
      error_contains: 'pq',
      variant: { ...lowRisk, intent: { ...ROUTINE_INTENT, security_tier: 'constructor' as 'routine' } },
    },
    // Canonicalization profile (spec/CANONICALIZATION_PROFILE.md § 4): only dcp-jcs-v1 exists.
    {
      name: 'canonicalization_profile_unknown',
      spec_step: 'V2-3',
      error_contains: 'canonicalization_profile',
      variant: { manifest: { canonicalization_profile: 'dcp-jcs-v2' } },
    },
    {
      name: 'canonicalization_profile_not_a_string',
      spec_step: 'V2-3',
      error_contains: 'canonicalization_profile',
      variant: { manifest: { canonicalization_profile: 1 } },
    },
    // Session nonce consistency (V2-4): every artifact and audit entry shares
    // the manifest's nonce. Each bundle here is signed over what it carries.
    {
      name: 'intent_session_nonce_differs',
      spec_step: 'V2-4',
      error_contains: 'nonce',
      variant: { intentNonce: generateSessionNonce() },
    },
    {
      name: 'audit_entry_session_nonce_differs',
      spec_step: 'V2-4',
      error_contains: 'nonce',
      variant: { auditNonce: generateSessionNonce() },
    },
    {
      name: 'manifest_session_nonce_differs_from_artifacts',
      spec_step: 'V2-4',
      error_contains: 'nonce',
      variant: { manifest: { session_nonce: generateSessionNonce() } },
    },
    // Manifest integrity (V2-3).
    {
      name: 'manifest_intent_hash_mismatch',
      spec_step: 'V2-3',
      error_contains: 'intent_hash',
      variant: { manifest: { intent_hash: sha256Of({ not: 'the intent' }) } },
    },
    {
      name: 'manifest_audit_merkle_root_mismatch',
      spec_step: 'V2-3',
      error_contains: 'audit',
      variant: { manifest: { audit_merkle_root: sha256Of({ not: 'the trail' }) } },
    },
    {
      // The manifest commits to this trail, whose second entry does not chain to the first.
      name: 'audit_chain_hash_wrong',
      spec_step: 'V2-3',
      error_contains: 'chain',
      variant: { secondPrevHash: sha256Of({ not: 'the first entry' }) },
    },
    // The bundle signer is the principal (V2-6): the agent's own keys, which also
    // sign its passport, cannot pair a published RPR with that passport.
    {
      name: 'bundle_signed_by_agent_keys',
      spec_step: 'V2-6',
      error_contains: 'rpr binding_keys',
      variant: { bundleKeys: agent },
    },
    // A kid names the key it was derived from (V2-13), whichever list holds it.
    {
      name: 'passport_key_kid_not_derived',
      spec_step: 'V2-13',
      error_contains: 'not derived',
      variant: { agentKeys: { ...agent, classical: { ...agent.classical, kid: 'a'.repeat(32) } } },
    },
    {
      name: 'rpr_binding_key_kid_not_derived',
      spec_step: 'V2-13',
      error_contains: 'not derived',
      variant: { principalKeys: { ...principal, pq: { ...principal.pq, kid: 'b'.repeat(32) } } },
    },
    // Cross-artifact consistency (V2-14): each bundle is validly signed over what it carries.
    ...(['revoked', 'suspended', 'commissioned', 'decommissioned'] as const).map((status): BundleCase => ({
      name: `passport_status_${status}`,
      spec_step: 'V2-14',
      error_contains: 'agent_passport status',
      variant: { passport: { status } },
    })),
    {
      name: 'rpr_expired',
      spec_step: 'V2-14',
      error_contains: 'responsible_principal_record expired',
      variant: { rpr: { expires_at: '2020-01-01T00:00:00Z' } },
    },
    {
      name: 'rpr_expires_at_impossible_date',
      spec_step: 'V2-14',
      error_contains: 'responsible_principal_record has an invalid expires_at',
      variant: { rpr: { expires_at: '2026-13-45T00:00:00Z' } },
    },
    {
      name: 'passport_principal_binding_reference_other',
      spec_step: 'V2-14',
      error_contains: 'principal_binding_reference',
      variant: { passport: { principal_binding_reference: 'human:someone-else' } },
    },
    { name: 'intent_agent_id_other', spec_step: 'V2-14', error_contains: 'intent agent_id', variant: { intent: { agent_id: 'agent:someone-else' } } },
    { name: 'intent_human_id_other', spec_step: 'V2-14', error_contains: 'intent human_id', variant: { intent: { human_id: 'human:someone-else' } } },
    {
      name: 'policy_decision_intent_id_other',
      spec_step: 'V2-14',
      error_contains: 'policy_decision intent_id',
      variant: { policyDecision: { intent_id: 'intent:someone-else' } },
    },
    {
      name: 'audit_entry_intent_hash_other',
      spec_step: 'V2-14',
      error_contains: 'audit_entries[0] intent_hash',
      variant: { audit: { intent_hash: sha256Of({ not: 'the intent' }) } },
    },
    ...(['intent_id', 'agent_id', 'human_id'] as const).map((field): BundleCase => ({
      name: `audit_entry_${field}_other`,
      spec_step: 'V2-14',
      error_contains: `audit_entries[0] ${field}`,
      variant: { audit: { [field]: `${field.split('_')[0]}:someone-else` } },
    })),
    // The session duration bound reads only signed data (V2-4): signature.created_at
    // is set an hour before the session ends, outside the manifest.
    // Every artifact and audit entry carries the session nonce (V2-4).
    { name: 'policy_decision_without_session_nonce', spec_step: 'V2-4', error_contains: 'nonce', variant: { policyNoNonce: true } },
    { name: 'audit_entry_without_session_nonce', spec_step: 'V2-4', error_contains: 'nonce', variant: { auditNoNonce: true } },
    // A key is canonical base64, so every verifier decodes the same bytes (V2-13).
    {
      name: 'passport_key_public_key_with_trailing_bits',
      spec_step: 'V2-13',
      error_contains: 'canonical base64',
      variant: { passportKeysEdit: (keys) => { keys[0].public_key_b64 = withTrailingBit(keys[0].public_key_b64); } },
    },
    {
      name: 'passport_pq_key_public_key_unpadded',
      spec_step: 'V2-13',
      error_contains: 'canonical base64',
      variant: { passportKeysEdit: (keys) => { keys[1].public_key_b64 = keys[1].public_key_b64.replace(/=+$/, ''); } },
    },
    // A maximum session duration needs both ends of the session (V2-4).
    {
      name: 'session_expires_at_missing_under_policy_max',
      spec_step: 'V2-4',
      error_contains: 'session_expires_at',
      verifier_policy_overrides: { max_session_duration_seconds: 3_000_000_000 },
      variant: { manifest: { session_expires_at: undefined } },
    },
    // The session start is the signed session_issued_at (V2-4).
    {
      name: 'session_issued_at_missing_under_policy_max',
      spec_step: 'V2-4',
      error_contains: 'session_issued_at',
      verifier_policy_overrides: { max_session_duration_seconds: 3600 },
      variant: { manifest: { session_issued_at: undefined } },
    },
    ...['2099-01-01T00:00:00Z', 'n/a', '2026-10-21'].map((value, i): BundleCase => ({
      name: `session_issued_at_${['in_the_future', 'not_a_timestamp', 'date_only'][i]}`,
      spec_step: 'V2-4',
      error_contains: 'session_issued_at',
      variant: { manifest: { session_issued_at: value } },
    })),
    {
      name: 'audit_entry_policy_decision_other',
      spec_step: 'V2-14',
      error_contains: 'audit_entries[0] policy_decision',
      variant: { audit: { policy_decision: 'blocked' } },
    },
    {
      name: 'session_longer_than_policy_max_with_late_created_at',
      spec_step: 'V2-4',
      error_contains: 'session duration',
      verifier_policy_overrides: { max_session_duration_seconds: 3600 },
      variant: { createdAt: '2099-12-31T18:00:00Z' },
    },
    // PQ checkpoints (V2-12): exactly the ones the manifest lists, each over its
    // audit entries and signed by the agent with both algorithms.
    {
      name: 'pq_checkpoint_pq_signature_invalid',
      spec_step: 'V2-12',
      error_contains: 'pq_checkpoints[ckpt-interop-001]',
      variant: { checkpoint: { mutate: (cp) => { cp.composite_sig.pq.sig_b64 = corrupt(cp.composite_sig.pq.sig_b64); } } },
    },
    {
      name: 'pq_checkpoint_merkle_root_other',
      spec_step: 'V2-12',
      error_contains: 'merkle_root does not match',
      variant: { checkpoint: { merkleRoot: sha256Of({ not: 'the trail' }) } },
    },
    {
      name: 'pq_checkpoint_event_range_count_wrong',
      spec_step: 'V2-12',
      error_contains: 'event_range does not match',
      variant: { checkpoint: { count: 3 } },
    },
    {
      name: 'pq_checkpoint_listed_but_missing',
      spec_step: 'V2-12',
      error_contains: 'does not carry',
      variant: { checkpoint: { carried: false } },
    },
    {
      name: 'pq_checkpoint_carried_but_not_listed',
      spec_step: 'V2-12',
      error_contains: 'not listed in the manifest',
      variant: { checkpoint: { listed: false } },
    },
    {
      name: 'pq_checkpoint_signed_by_principal',
      spec_step: 'V2-12',
      error_contains: 'passport keys',
      variant: { checkpoint: { keys: principal } },
    },
    {
      name: 'pq_checkpoint_session_nonce_differs',
      spec_step: 'V2-12',
      error_contains: 'nonce',
      variant: { checkpoint: { nonce: generateSessionNonce() } },
    },
  ];

  const vectors = {
    _description:
      'Cross-SDK V2 bundle verification vectors (spec/VERIFICATION.md V2). ' +
      'Every verifier MUST accept signed_bundle. After applying the mutations of any must_reject ' +
      'case (set value at path, in order) it MUST reject it, whatever its verification mode, with ' +
      'an error that contains error_contains (case-insensitive). It MUST also reject every ' +
      'must_reject_bundles entry the same way, and give classical_only_routine_bundle the verdict ' +
      'in verified_by_mode. Every must_accept_bundles entry MUST verify in every mode. A case with ' +
      'verifier_policy_overrides is verified under each mode\'s policy with those fields replaced. ' +
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
      {
        name: 'pq_checkpoint_over_the_trail',
        spec_step: 'V2-12',
        signed_bundle: (await build({ checkpoint: {} })).signedBundle,
      },
      {
        // DCP-05 § 3.1: a declining agent may still act.
        name: 'passport_status_declining',
        spec_step: 'V2-14',
        signed_bundle: (await build({ passport: { status: 'declining' } })).signedBundle,
      },
      {
        name: 'rpr_expires_in_the_future',
        spec_step: 'V2-14',
        signed_bundle: (await build({ rpr: { expires_at: '2099-12-31T23:59:59Z' } })).signedBundle,
      },
      // A bundle is evidence of what happened, including an action the policy escalated or blocked.
      ...(await Promise.all(
        (['escalate', 'block'] as const).map(async (decision) => ({
          name: `${decision === 'block' ? 'blocked' : 'escalated'}_action_recorded`,
          spec_step: 'V2-14',
          signed_bundle: (
            await build({
              policyDecision: { decision, required_confirmation: { type: 'human_approve', fields: ['action_type'] } },
              audit: { policy_decision: decision === 'block' ? 'blocked' : 'escalated' },
            })
          ).signedBundle,
        })),
      )),
      {
        // RFC 3339 years start at 0000.
        name: 'session_issued_at_year_0000',
        spec_step: 'V2-4',
        signed_bundle: (await build({ manifest: { session_issued_at: '0000-01-01T00:00:00Z' } })).signedBundle,
      },
      {
        // Timestamps compare at millisecond precision: the 0.0009 s past the maximum are dropped.
        name: 'session_duration_at_millisecond_precision',
        spec_step: 'V2-4',
        verifier_policy_overrides: {
          max_session_duration_seconds: (Date.parse('2099-12-31T18:59:59Z') - Date.parse('2026-10-21T00:00:00Z')) / 1000,
        },
        signed_bundle: (await build({ manifest: { session_expires_at: '2099-12-31T18:59:59.0009Z' } })).signedBundle,
      },
      {
        // 2026-10-21 to 2099-12-31 is about 2.3e9 seconds.
        name: 'session_within_policy_max',
        spec_step: 'V2-4',
        verifier_policy_overrides: { max_session_duration_seconds: 3_000_000_000 },
        signed_bundle: (await build()).signedBundle,
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
