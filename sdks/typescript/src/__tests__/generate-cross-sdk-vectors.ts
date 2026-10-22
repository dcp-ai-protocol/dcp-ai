/**
 * Cross-SDK vector generator — TypeScript section.
 *
 * Writes the `typescript` section of tests/interop/v2/cross_sdk_vectors.json:
 * an SLH-DSA-192f signature, an ML-KEM-768 encapsulation and a full signed V2
 * bundle (hybrid Ed25519 + ML-DSA-65), all produced by this SDK, for the other
 * SDKs to verify. The `python` section comes from
 * sdks/python/tests/generate_cross_sdk_vectors.py and is verified here in
 * cross-sdk.test.ts.
 *
 * Run: cd sdks/typescript && npx tsx src/__tests__/generate-cross-sdk-vectors.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { MlKem768Provider } from '../providers/ml-kem-768.js';
import { SlhDsa192fProvider } from '../providers/slh-dsa-192f.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { compositeSign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import type { KeyEntry } from '../core/crypto-provider.js';
import { DCP_CONTEXTS, domainSeparatedMessage } from '../core/domain-separation.js';
import { sha256Hex } from '../core/dual-hash.js';
import { generateSessionNonce } from '../core/session-nonce.js';
import { preparePayload } from '../core/signed-payload.js';
import type { SignedPayload } from '../core/signed-payload.js';
import { BundleBuilderV2 } from '../bundle/builder-v2.js';
import { signBundleV2 } from '../bundle/signer-v2.js';
import type {
  AgentPassportV2,
  AuditEventV2,
  IntentV2,
  PolicyDecisionV2,
  ResponsiblePrincipalRecordV2,
} from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../../../../tests/interop/v2/cross_sdk_vectors.json');

const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
const registry = new AlgorithmRegistry();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

async function compositeKeys(): Promise<CompositeKeyPair> {
  const ed = await ed25519.generateKeypair();
  const pq = await mlDsa65.generateKeypair();
  return {
    classical: {
      kid: ed.kid,
      alg: 'ed25519',
      secretKeyB64: ed.secretKeyB64,
      publicKeyB64: ed.publicKeyB64,
    },
    pq: {
      kid: pq.kid,
      alg: 'ml-dsa-65',
      secretKeyB64: pq.secretKeyB64,
      publicKeyB64: pq.publicKeyB64,
    },
  };
}

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

async function signPayload<T>(
  payload: T,
  context: string,
  keys: CompositeKeyPair,
): Promise<SignedPayload<T>> {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  const composite_sig = await compositeSign(registry, context, canonicalBytes, keys);
  return { payload, payload_hash: payloadHash, composite_sig };
}

/** Same artifacts as the Python generator: principal signs RPR and bundle, agent the rest. */
async function signedBundleV2() {
  const agentKeys = await compositeKeys();
  const principalKeys = await compositeKeys();
  const nonce = generateSessionNonce();
  const agentId = 'agent-cross-sdk-ts';

  const rpr: ResponsiblePrincipalRecordV2 = {
    dcp_version: '2.0',
    human_id: 'human-cross-sdk',
    session_nonce: nonce,
    legal_name: 'Cross SDK Test Principal',
    entity_type: 'natural_person',
    jurisdiction: 'US',
    liability_mode: 'owner_responsible',
    override_rights: true,
    issued_at: '2026-10-21T00:00:00Z',
    expires_at: null,
    contact: null,
    binding_keys: keyEntries(principalKeys),
  };
  const passport: AgentPassportV2 = {
    dcp_version: '2.0',
    agent_id: agentId,
    session_nonce: nonce,
    keys: keyEntries(agentKeys),
    principal_binding_reference: 'human-cross-sdk',
    capabilities: ['api_call', 'browse'],
    risk_tier: 'high',
    created_at: '2026-10-21T00:00:00Z',
    status: 'active',
  };
  const intent: IntentV2 = {
    dcp_version: '2.0',
    intent_id: 'intent-cross-sdk-ts',
    session_nonce: nonce,
    agent_id: agentId,
    human_id: 'human-cross-sdk',
    timestamp: '2026-10-21T12:00:00Z',
    action_type: 'api_call',
    target: { channel: 'api', domain: 'example.com' },
    data_classes: ['none'],
    estimated_impact: 'low',
    requires_consent: false,
  };
  const policy: PolicyDecisionV2 = {
    dcp_version: '2.0',
    intent_id: intent.intent_id,
    session_nonce: nonce,
    decision: 'approve',
    risk_score: 120,
    reasons: ['low risk action'],
    required_confirmation: null,
    applied_policy_hash: `sha256:${'0'.repeat(64)}`,
    timestamp: '2026-10-21T12:00:01Z',
  };

  const auditEntries: AuditEventV2[] = [];
  let prevHash = 'GENESIS';
  for (let i = 0; i < 3; i++) {
    const entry: AuditEventV2 = {
      dcp_version: '2.0',
      audit_id: `audit-ts-${i}`,
      session_nonce: nonce,
      prev_hash: prevHash,
      hash_alg: 'sha256',
      timestamp: `2026-10-21T12:0${i}:30Z`,
      agent_id: agentId,
      human_id: 'human-cross-sdk',
      intent_id: intent.intent_id,
      intent_hash: preparePayload(intent).payloadHash,
      policy_decision: 'approved',
      outcome: `action_${i}_completed`,
      evidence: { tool: 'http_client', result_ref: null, evidence_hash: null },
      pq_checkpoint_ref: null,
    };
    auditEntries.push(entry);
    prevHash = `sha256:${sha256Hex(Buffer.from(canonicalizeV2(entry), 'utf8'))}`;
  }

  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(
      await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principalKeys),
    )
    .agentPassport(await signPayload(passport, DCP_CONTEXTS.AgentPassport, agentKeys))
    .intent(await signPayload(intent, DCP_CONTEXTS.Intent, agentKeys))
    .policyDecision(await signPayload(policy, DCP_CONTEXTS.PolicyDecision, agentKeys))
    .addAuditEntries(auditEntries)
    .enableDualHash()
    .build();

  return signBundleV2(bundle, {
    registry,
    signerType: 'human',
    signerId: 'human-cross-sdk',
    keys: principalKeys,
    dualHash: true,
  });
}

async function main() {
  const slh = new SlhDsa192fProvider();
  const slhKp = await slh.generateKeypair();
  const message = domainSeparatedMessage(
    DCP_CONTEXTS.AgentPassport,
    new TextEncoder().encode(
      canonicalizeV2({ agent_id: 'agent-cross-sdk-ts', dcp_version: '2.0' }),
    ),
  );
  const slhSig = await slh.sign(message, slhKp.secretKeyB64);

  const kem = new MlKem768Provider();
  const kemKp = await kem.generateKeypair();
  const { sharedSecret, ciphertextB64 } = await kem.encapsulate(kemKp.publicKeyB64);

  const vectors = existsSync(OUTPUT_PATH)
    ? JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'))
    : {
        _description:
          'Cross-SDK vectors: each section is produced by the SDK it is named after and verified by the others (SLH-DSA-192f signature, ML-KEM-768 decapsulation, full signed V2 bundle).',
        _security_notice:
          'TEST-ONLY keys, generated for interoperability testing. Consider them public and compromised by design; never use them in production.',
      };

  vectors.typescript = {
    _generator: 'sdks/typescript/src/__tests__/generate-cross-sdk-vectors.ts',
    _generated_at: new Date().toISOString(),
    slh_dsa_192f: {
      kid: slhKp.kid,
      public_key_b64: slhKp.publicKeyB64,
      message_hex: Buffer.from(message).toString('hex'),
      sig_b64: Buffer.from(slhSig).toString('base64'),
    },
    ml_kem_768: {
      public_key_b64: kemKp.publicKeyB64,
      secret_key_b64: kemKp.secretKeyB64,
      ciphertext_b64: ciphertextB64,
      shared_secret_hex: Buffer.from(sharedSecret).toString('hex'),
    },
    signed_bundle_v2: await signedBundleV2(),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(vectors, null, 2) + '\n');
  console.log(`Wrote typescript section to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
