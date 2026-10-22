/**
 * DCP-AI v2.0 Bundle Verification Vector Generator
 *
 * Writes tests/interop/v2/bundle_vectors.json: one signed bundle that every
 * SDK verifier MUST accept, and cases whose mutations (set `value` at `path`)
 * MUST make it reject the bundle with an error that names `error_contains`
 * (spec/VERIFICATION.md V2-6 to V2-8). As in a real
 * deployment the principal (RPR binding_keys) signs the RPR and the bundle,
 * and the agent (passport keys) signs the passport, intent and policy decision.
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
import { compositeSign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { preparePayload } from '../core/signed-payload.js';
import { sha256Hex } from '../core/dual-hash.js';
import { generateSessionNonce } from '../core/session-nonce.js';
import { BundleBuilderV2 } from '../bundle/builder-v2.js';
import { signBundleV2 } from '../bundle/signer-v2.js';
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

async function sign<T>(payload: T, context: DcpContext, keys: CompositeKeyPair) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  const composite_sig = await compositeSign(registry, context, canonicalBytes, keys);
  return { payload, payload_hash: payloadHash, composite_sig };
}

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
    binding_keys: keyEntries(principal),
  };
  const passport: AgentPassportV2 = {
    dcp_version: '2.0',
    agent_id: 'agent:interop-bot',
    session_nonce: nonce,
    keys: keyEntries(agent),
    principal_binding_reference: rpr.human_id,
    capabilities: ['browse', 'api_call'],
    risk_tier: 'medium',
    created_at: '2026-10-21T00:00:00Z',
    status: 'active',
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
  };
  const audit: AuditEventV2 = {
    dcp_version: '2.0',
    audit_id: 'audit:interop-001',
    session_nonce: nonce,
    prev_hash: 'GENESIS',
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

  const signedIntent = await sign(intent, DCP_CONTEXTS.Intent, agent);
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal))
    .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport, agent))
    .intent(signedIntent)
    .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision, agent))
    .addAuditEntries([audit, audit2])
    .build();
  const signedBundle = await signBundleV2(bundle, {
    registry,
    signerType: 'human',
    signerId: rpr.human_id,
    keys: principal,
  });

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

  const vectors = {
    _description:
      'Cross-SDK V2 bundle verification vectors (spec/VERIFICATION.md V2-6 to V2-8). ' +
      'Every verifier MUST accept signed_bundle. After applying the mutations of any must_reject ' +
      'case (set value at path, in order) it MUST reject it, whatever its verification mode, with ' +
      'an error that contains error_contains (case-insensitive).',
    _generator: 'sdks/typescript/src/__tests__/generate-bundle-vectors.ts',
    signed_bundle: signedBundle,
    must_reject: mustReject,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(vectors, null, 2) + '\n');
  console.log(`Bundle vectors written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
