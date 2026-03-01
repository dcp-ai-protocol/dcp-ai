/**
 * DCP-AI v2.0 Interop Vector Generator
 *
 * Generates golden test vectors (keys, signatures, composite sigs, attack
 * vectors) consumed by ALL SDKs for cross-language interop verification.
 *
 * Run: cd sdks/typescript && npx tsx src/__tests__/generate-interop-vectors.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS, domainSeparatedMessage } from '../core/domain-separation.js';
import {
  compositeSign,
  classicalOnlySign,
} from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { deriveKid } from '../core/crypto-provider.js';
import { sha256Hex, sha3_256Hex } from '../core/dual-hash.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_PATH = resolve(__dirname, '../../../../tests/interop/v2/interop_vectors.json');

function toHex(data: Uint8Array): string {
  return Buffer.from(data).toString('hex');
}

async function main() {
  const registry = new AlgorithmRegistry();
  const ed25519 = new Ed25519Provider();
  const mlDsa65 = new MlDsa65Provider();
  registry.registerSigner(ed25519);
  registry.registerSigner(mlDsa65);

  // --- Key generation ---
  const edKp = await ed25519.generateKeypair();
  const pqKp = await mlDsa65.generateKeypair();

  const keys: CompositeKeyPair = {
    classical: {
      kid: edKp.kid,
      alg: 'ed25519',
      secretKeyB64: edKp.secretKeyB64,
      publicKeyB64: edKp.publicKeyB64,
    },
    pq: {
      kid: pqKp.kid,
      alg: 'ml-dsa-65',
      secretKeyB64: pqKp.secretKeyB64,
      publicKeyB64: pqKp.publicKeyB64,
    },
  };

  // --- kid derivation vectors ---
  const edPkBytes = Buffer.from(edKp.publicKeyB64, 'base64');
  const pqPkBytes = Buffer.from(pqKp.publicKeyB64, 'base64');
  const edKidRecomputed = deriveKid('ed25519', new Uint8Array(edPkBytes));
  const pqKidRecomputed = deriveKid('ml-dsa-65', new Uint8Array(pqPkBytes));

  // --- Payload and canonical form ---
  const testPayloads = {
    agent_passport: {
      dcp_version: '2.0',
      agent_id: 'agent-interop-test-001',
      session_nonce: 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8',
      capabilities: ['api_call', 'browse'],
      risk_tier: 'medium',
      status: 'active',
    },
    intent: {
      dcp_version: '2.0',
      intent_id: 'intent-interop-001',
      session_nonce: 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8',
      agent_id: 'agent-interop-test-001',
      action_type: 'send_email',
      estimated_impact: 'medium',
    },
    audit_event: {
      dcp_version: '2.0',
      audit_id: 'audit-interop-001',
      session_nonce: 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8',
      agent_id: 'agent-interop-test-001',
      outcome: 'success',
    },
  };

  const canonicals: Record<string, string> = {};
  const payloadHashes: Record<string, { sha256: string; sha3_256: string }> = {};
  for (const [name, payload] of Object.entries(testPayloads)) {
    const canonical = canonicalizeV2(payload);
    canonicals[name] = canonical;
    const bytes = new TextEncoder().encode(canonical);
    payloadHashes[name] = {
      sha256: sha256Hex(bytes),
      sha3_256: sha3_256Hex(bytes),
    };
  }

  // --- Domain-separated messages ---
  const dsmVectors: Record<string, string> = {};
  const contextPairs: [string, string, string][] = [
    ['passport_dsm', DCP_CONTEXTS.AgentPassport, canonicals.agent_passport],
    ['intent_dsm', DCP_CONTEXTS.Intent, canonicals.intent],
    ['audit_dsm', DCP_CONTEXTS.AuditEvent, canonicals.audit_event],
  ];
  for (const [name, ctx, canonical] of contextPairs) {
    const dsm = domainSeparatedMessage(ctx, new TextEncoder().encode(canonical));
    dsmVectors[name] = toHex(dsm);
  }

  // --- Ed25519 standalone signatures ---
  const ed25519Signatures: Record<string, any> = {};
  const sigContextPairs: [string, string, string][] = [
    ['passport_ed25519', DCP_CONTEXTS.AgentPassport, 'agent_passport'],
    ['intent_ed25519', DCP_CONTEXTS.Intent, 'intent'],
    ['audit_ed25519', DCP_CONTEXTS.AuditEvent, 'audit_event'],
  ];
  for (const [name, ctx, payloadKey] of sigContextPairs) {
    const payloadBytes = new TextEncoder().encode(canonicals[payloadKey]);
    const dsm = domainSeparatedMessage(ctx, payloadBytes);
    const sig = await ed25519.sign(dsm, edKp.secretKeyB64);
    ed25519Signatures[name] = {
      context: ctx,
      payload_key: payloadKey,
      signer_kid: edKp.kid,
      sig_b64: Buffer.from(sig).toString('base64'),
    };
  }

  // --- Composite signatures (Ed25519 + ML-DSA-65) ---
  const compositeSignatures: Record<string, any> = {};
  const compositeContexts: [string, string, string][] = [
    ['passport_composite', DCP_CONTEXTS.AgentPassport, 'agent_passport'],
    ['intent_composite', DCP_CONTEXTS.Intent, 'intent'],
    ['audit_composite', DCP_CONTEXTS.AuditEvent, 'audit_event'],
  ];
  for (const [name, ctx, payloadKey] of compositeContexts) {
    const payloadBytes = new TextEncoder().encode(canonicals[payloadKey]);
    const sig = await compositeSign(registry, ctx, payloadBytes, keys);
    compositeSignatures[name] = {
      context: ctx,
      payload_key: payloadKey,
      composite_sig: {
        classical: sig.classical,
        pq: sig.pq,
        binding: sig.binding,
      },
    };
  }

  // --- Classical-only signatures ---
  const classicalOnlySignatures: Record<string, any> = {};
  const classicalPayloadBytes = new TextEncoder().encode(canonicals.intent);
  const classicalOnlySig = await classicalOnlySign(
    registry,
    DCP_CONTEXTS.Intent,
    classicalPayloadBytes,
    keys.classical,
  );
  classicalOnlySignatures.intent_classical_only = {
    context: DCP_CONTEXTS.Intent,
    payload_key: 'intent',
    composite_sig: {
      classical: classicalOnlySig.classical,
      pq: classicalOnlySig.pq,
      binding: classicalOnlySig.binding,
    },
  };

  // --- Attack vectors ---
  const passportCompSig = compositeSignatures.passport_composite.composite_sig;
  const strippedPq = {
    classical: { ...passportCompSig.classical },
    pq: null,
    binding: 'pq_over_classical',
  };
  const strippedAndDowngraded = {
    classical: { ...passportCompSig.classical },
    pq: null,
    binding: 'classical_only',
  };

  const tamperedClassical = JSON.parse(JSON.stringify(passportCompSig));
  const tamperedSigBytes = Buffer.from(tamperedClassical.classical.sig_b64, 'base64');
  tamperedSigBytes[0] ^= 0xff;
  tamperedClassical.classical.sig_b64 = tamperedSigBytes.toString('base64');

  const tamperedPq = JSON.parse(JSON.stringify(passportCompSig));
  const tamperedPqSigBytes = Buffer.from(tamperedPq.pq.sig_b64, 'base64');
  tamperedPqSigBytes[0] ^= 0xff;
  tamperedPq.pq.sig_b64 = tamperedPqSigBytes.toString('base64');

  // Cross-context: intent signature tested under audit context
  const crossContextSig = compositeSignatures.intent_composite.composite_sig;

  // --- Session splicing vectors ---
  const sessionA_nonce = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const sessionB_nonce = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const passportA = {
    dcp_version: '2.0',
    agent_id: 'agent-session-A',
    session_nonce: sessionA_nonce,
    status: 'active',
  };
  const intentB = {
    dcp_version: '2.0',
    intent_id: 'intent-session-B',
    session_nonce: sessionB_nonce,
    agent_id: 'agent-session-A',
    action_type: 'send_email',
  };
  const passportA_canonical = canonicalizeV2(passportA);
  const intentB_canonical = canonicalizeV2(intentB);
  const passportA_bytes = new TextEncoder().encode(passportA_canonical);
  const intentB_bytes = new TextEncoder().encode(intentB_canonical);
  const passportA_sig = await compositeSign(registry, DCP_CONTEXTS.AgentPassport, passportA_bytes, keys);
  const intentB_sig = await compositeSign(registry, DCP_CONTEXTS.Intent, intentB_bytes, keys);

  // --- Domain separation: all contexts produce distinct DSMs ---
  const dsmAllContexts: Record<string, string> = {};
  const sharedPayload = canonicals.intent;
  const sharedPayloadBytes = new TextEncoder().encode(sharedPayload);
  for (const [ctxName, ctxValue] of Object.entries(DCP_CONTEXTS)) {
    const dsm = domainSeparatedMessage(ctxValue, sharedPayloadBytes);
    dsmAllContexts[ctxName] = toHex(dsm);
  }

  // --- Build output ---
  const vectors = {
    _description: 'DCP-AI v2.0 Cross-Language Interop Test Vectors. Generated by TypeScript SDK. All SDKs MUST verify these vectors.',
    _generated_at: new Date().toISOString(),
    _generator: 'sdks/typescript/src/__tests__/generate-interop-vectors.ts',

    test_keys: {
      ed25519: {
        kid: edKp.kid,
        alg: 'ed25519',
        public_key_b64: edKp.publicKeyB64,
        secret_key_b64: edKp.secretKeyB64,
      },
      ml_dsa_65: {
        kid: pqKp.kid,
        alg: 'ml-dsa-65',
        public_key_b64: pqKp.publicKeyB64,
        secret_key_b64: pqKp.secretKeyB64,
      },
    },

    kid_derivation: {
      ed25519: {
        alg: 'ed25519',
        public_key_b64: edKp.publicKeyB64,
        expected_kid: edKidRecomputed,
      },
      ml_dsa_65: {
        alg: 'ml-dsa-65',
        public_key_b64: pqKp.publicKeyB64,
        expected_kid: pqKidRecomputed,
      },
    },

    canonicalization: {
      agent_passport: {
        input: testPayloads.agent_passport,
        expected_canonical: canonicals.agent_passport,
      },
      intent: {
        input: testPayloads.intent,
        expected_canonical: canonicals.intent,
      },
      audit_event: {
        input: testPayloads.audit_event,
        expected_canonical: canonicals.audit_event,
      },
    },

    payload_hashes: payloadHashes,

    domain_separated_messages: dsmVectors,

    domain_separation_all_contexts: {
      _description: 'Same payload under all DCP v2 contexts. All DSMs must be distinct.',
      payload_canonical: sharedPayload,
      dsm_hex: dsmAllContexts,
    },

    ed25519_signatures: ed25519Signatures,

    composite_signatures: compositeSignatures,

    classical_only_signatures: classicalOnlySignatures,

    attack_vectors: {
      stripping_pq_removal: {
        _description: 'PQ signature stripped from pq_over_classical composite. Verification MUST fail.',
        context: DCP_CONTEXTS.AgentPassport,
        payload_key: 'agent_passport',
        composite_sig: strippedPq,
        expected_valid: false,
      },
      stripping_pq_with_downgrade: {
        _description: 'PQ signature stripped and binding changed to classical_only. Classical sig verifies under classical_only but was NOT produced for that binding.',
        context: DCP_CONTEXTS.AgentPassport,
        payload_key: 'agent_passport',
        composite_sig: strippedAndDowngraded,
        expected_classical_valid: true,
        expected_pq_valid: false,
        _note: 'Verifier POLICY must reject this if hybrid_required. The signature is technically valid under classical_only mode.',
      },
      tampered_classical_sig: {
        _description: 'Classical signature byte 0 flipped. Both classical and PQ verification MUST fail.',
        context: DCP_CONTEXTS.AgentPassport,
        payload_key: 'agent_passport',
        composite_sig: tamperedClassical,
        expected_valid: false,
        expected_classical_valid: false,
        expected_pq_valid: false,
      },
      tampered_pq_sig: {
        _description: 'PQ signature byte 0 flipped. PQ verification MUST fail, classical MAY pass.',
        context: DCP_CONTEXTS.AgentPassport,
        payload_key: 'agent_passport',
        composite_sig: tamperedPq,
        expected_valid: false,
        expected_pq_valid: false,
      },
      cross_context_replay: {
        _description: 'Composite signature created under Intent context, verified under AuditEvent context. MUST fail.',
        sign_context: DCP_CONTEXTS.Intent,
        verify_context: DCP_CONTEXTS.AuditEvent,
        payload_key: 'intent',
        composite_sig: crossContextSig,
        expected_valid: false,
      },
    },

    session_splicing: {
      _description: 'Artifacts from different sessions with different nonces. Bundle verification MUST reject mixed nonces.',
      session_a: {
        nonce: sessionA_nonce,
        passport: passportA,
        passport_canonical: passportA_canonical,
        passport_composite_sig: {
          classical: passportA_sig.classical,
          pq: passportA_sig.pq,
          binding: passportA_sig.binding,
        },
      },
      session_b: {
        nonce: sessionB_nonce,
        intent: intentB,
        intent_canonical: intentB_canonical,
        intent_composite_sig: {
          classical: intentB_sig.classical,
          pq: intentB_sig.pq,
          binding: intentB_sig.binding,
        },
      },
    },
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(vectors, null, 2) + '\n');
  console.log(`Interop vectors written to ${OUTPUT_PATH}`);
  console.log(`  Ed25519 kid: ${edKp.kid}`);
  console.log(`  ML-DSA-65 kid: ${pqKp.kid}`);
  console.log(`  Composite signatures: ${Object.keys(compositeSignatures).length}`);
  console.log(`  Attack vectors: ${Object.keys(vectors.attack_vectors).length}`);
}

main().catch((err) => {
  console.error('Failed to generate interop vectors:', err);
  process.exit(1);
});
