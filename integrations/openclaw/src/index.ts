/**
 * @dcp-ai/openclaw — OpenClaw plugin for Digital Citizenship Protocol (V2).
 *
 * Registers DCP agent tools with the OpenClaw plugin API:
 *  - dcp_identity_setup   (DCP-01: dual keygen + RPR + AgentPassport, composite sigs)
 *  - dcp_declare_intent   (DCP-02: Intent + PolicyDecision, composite sigs)
 *  - dcp_verify_bundle    (V1/V2 bundle verification)
 *  - dcp_log_action       (DCP-03: AuditEntry with dual-hash chains + PQ checkpoints)
 *  - dcp_get_audit_trail  (DCP-03: retrieve audit trail)
 *  - dcp_sign_bundle      (Build + sign V2 CitizenshipBundle with manifest + composite sig)
 */
import { Type } from '@sinclair/typebox';
import {
  registerDefaultProviders,
  getDefaultRegistry,
  compositeSign,
  preparePayload,
  canonicalizeV2,
  sha256Hex,
  sha3_256Hex,
  auditEventsMerkleRoot,
  DCP_CONTEXTS,
  type CitizenshipBundleV2,
  type BundleManifest,
  type SignedBundleV2,
  type BundleSignatureV2,
} from '@dcp-ai/sdk';

import { IdentitySetupParams, executeIdentitySetup } from './tools/identity.js';
import { DeclareIntentParams, executeDeclareIntent } from './tools/intent.js';
import { VerifyBundleParams, executeVerifyBundle } from './tools/verify.js';
import {
  LogActionParams,
  executeLogAction,
  GetAuditTrailParams,
  executeGetAuditTrail,
} from './tools/audit.js';
import { getSession, isIdentityReady, clearSession } from './state/agent-state.js';

// ── OpenClaw Plugin API types ──

interface OpenClawToolDef {
  name: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

interface OpenClawPluginAPI {
  registerTool: (tool: OpenClawToolDef) => void;
}

// ── Plugin Entry Point ──

export default function register(api: OpenClawPluginAPI): void {
  // ─── 1. dcp_identity_setup ───
  api.registerTool({
    name: 'dcp_identity_setup',
    description:
      'Generate a DCP v2.0 identity (Ed25519 + ML-DSA-65 dual keypair + RPR + Agent Passport ' +
      'with composite signatures + emergency revocation token). ' +
      'Run once at session start before other DCP tools.',
    parameters: IdentitySetupParams,
    async execute(_id, params) {
      return executeIdentitySetup(params as any);
    },
  });

  // ─── 2. dcp_declare_intent ───
  api.registerTool({
    name: 'dcp_declare_intent',
    description:
      'Declare an intent before performing a sensitive action (DCP-02 V2). ' +
      'Returns a policy decision (approve/escalate/block) with integer risk score (0-1000 millirisk). ' +
      'Intent is composite-signed with Ed25519 + ML-DSA-65.',
    parameters: DeclareIntentParams,
    async execute(_id, params) {
      return executeDeclareIntent(params as any);
    },
  });

  // ─── 3. dcp_verify_bundle ───
  api.registerTool({
    name: 'dcp_verify_bundle',
    description:
      'Verify a DCP SignedBundle (V1 or V2 auto-detected). ' +
      'V2: validates composite signatures, manifest integrity, session binding, hash chains, PQ checkpoints.',
    parameters: VerifyBundleParams,
    async execute(_id, params) {
      return executeVerifyBundle(params as any);
    },
  });

  // ─── 4. dcp_log_action ───
  api.registerTool({
    name: 'dcp_log_action',
    description:
      'Record an action as a V2 AuditEntry with dual-hash chains (SHA-256 + SHA3-256). ' +
      'Ed25519-signed per-event; PQ checkpoint produced every 10 events (lazy PQ model). ' +
      'Call after performing the action from dcp_declare_intent.',
    parameters: LogActionParams,
    async execute(_id, params) {
      return executeLogAction(params as any);
    },
  });

  // ─── 5. dcp_get_audit_trail ───
  api.registerTool({
    name: 'dcp_get_audit_trail',
    description:
      'Retrieve the DCP audit trail for the current session. ' +
      'Returns V2 audit entries with dual-hash chains and PQ checkpoint count.',
    parameters: GetAuditTrailParams,
    async execute(_id, params) {
      return executeGetAuditTrail(params as any);
    },
  });

  // ─── 6. dcp_sign_bundle ───
  api.registerTool({
    name: 'dcp_sign_bundle',
    description:
      'Build and sign a V2 CitizenshipBundle from session state. ' +
      'Computes manifest (artifact hashes + audit Merkle root), ' +
      'composite-signs the manifest, includes PQ checkpoints. ' +
      'Typically called at session end.',
    parameters: Type.Object({
      session_id: Type.String({
        description: 'OpenClaw session / thread identifier',
      }),
      intent_id: Type.Optional(
        Type.String({
          description: 'Specific intent_id to include. Defaults to most recent.',
        }),
      ),
    }),
    async execute(_id, params: Record<string, unknown>) {
      const sessionId = params.session_id as string;

      if (!isIdentityReady(sessionId)) {
        throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
      }

      registerDefaultProviders();
      const registry = getDefaultRegistry();
      const session = getSession(sessionId);

      if (session.auditEntriesV2.length === 0) {
        throw new Error('No audit entries. Log at least one action with dcp_log_action first.');
      }

      // Pick intent
      let intentId = params.intent_id as string | undefined;
      if (!intentId) {
        const keys = Array.from(session.intentsV2.keys());
        intentId = keys[keys.length - 1];
      }

      const signedIntent = session.signedIntents.get(intentId!);
      if (!signedIntent) {
        throw new Error(`Intent ${intentId} not found in session.`);
      }

      const signedPolicy = session.signedPolicies.get(intentId!);
      if (!signedPolicy) {
        throw new Error(`PolicyDecision for intent ${intentId} not found.`);
      }

      // Flush any pending PQ checkpoint events
      // (handled by manager.flush() if needed in the future)

      // Compute manifest
      const rprCanonical = canonicalizeV2(session.signedRpr!.payload);
      const passportCanonical = canonicalizeV2(session.signedPassport!.payload);
      const intentCanonical = canonicalizeV2(signedIntent.payload);
      const policyCanonical = canonicalizeV2(signedPolicy.payload);

      const rprHash = `sha256:${sha256Hex(Buffer.from(rprCanonical, 'utf8'))}`;
      const passportHash = `sha256:${sha256Hex(Buffer.from(passportCanonical, 'utf8'))}`;
      const intentHash = `sha256:${sha256Hex(Buffer.from(intentCanonical, 'utf8'))}`;
      const policyHash = `sha256:${sha256Hex(Buffer.from(policyCanonical, 'utf8'))}`;

      // Audit Merkle root
      const auditMerkleRoot = `sha256:${auditEventsMerkleRoot(session.auditEntriesV2)}`;

      // Secondary Merkle root (SHA3-256) for dual-hash
      const auditLeavesSha3 = session.auditEntriesV2.map(e => {
        const canonical = canonicalizeV2(e);
        return sha3_256Hex(Buffer.from(canonical, 'utf8'));
      });
      let sha3Layer = auditLeavesSha3.slice();
      while (sha3Layer.length > 1) {
        if (sha3Layer.length % 2 === 1) sha3Layer.push(sha3Layer[sha3Layer.length - 1]);
        const next: string[] = [];
        for (let i = 0; i < sha3Layer.length; i += 2) {
          const combined = Buffer.concat([
            Buffer.from(sha3Layer[i], 'hex'),
            Buffer.from(sha3Layer[i + 1], 'hex'),
          ]);
          next.push(sha3_256Hex(combined));
        }
        sha3Layer = next;
      }
      const auditMerkleRootSecondary = `sha3-256:${sha3Layer[0]}`;

      const manifest: BundleManifest = {
        session_nonce: session.sessionNonce!,
        rpr_hash: rprHash,
        passport_hash: passportHash,
        intent_hash: intentHash,
        policy_hash: policyHash,
        audit_merkle_root: auditMerkleRoot,
        audit_merkle_root_secondary: auditMerkleRootSecondary,
        audit_count: session.auditEntriesV2.length,
        pq_checkpoints: session.pqCheckpoints.map(c => c.checkpoint_id),
      };

      // Build V2 bundle
      const bundle: CitizenshipBundleV2 = {
        dcp_bundle_version: '2.0',
        manifest,
        responsible_principal_record: session.signedRpr!,
        agent_passport: session.signedPassport!,
        intent: signedIntent,
        policy_decision: signedPolicy,
        audit_entries: session.auditEntriesV2,
        pq_checkpoints: session.pqCheckpoints.length > 0 ? session.pqCheckpoints : undefined,
      };

      // Composite-sign the manifest
      const manifestPrepared = preparePayload(manifest);
      const bundleSig = await compositeSign(
        registry,
        DCP_CONTEXTS.Bundle,
        manifestPrepared.canonicalBytes,
        session.compositeKeys!,
      );

      const signature: BundleSignatureV2 = {
        hash_alg: 'sha256+sha3-256',
        created_at: new Date().toISOString(),
        signer: {
          type: 'human',
          id: session.rprV2!.human_id,
          kids: [session.compositeKeys!.classical.kid, session.compositeKeys!.pq.kid],
        },
        manifest_hash: manifestPrepared.payloadHash,
        composite_sig: bundleSig,
      };

      const signedBundle: SignedBundleV2 = { bundle, signature };

      return {
        signed_bundle: signedBundle,
        agent_id: session.passportV2!.agent_id,
        human_id: session.rprV2!.human_id,
        session_nonce: session.sessionNonce,
        audit_entries_count: session.auditEntriesV2.length,
        pq_checkpoints_count: session.pqCheckpoints.length,
        message: `V2 CitizenshipBundle signed with composite signatures. ` +
          `${session.auditEntriesV2.length} audit entries, ${session.pqCheckpoints.length} PQ checkpoints.`,
      };
    },
  });
}

// ── Re-exports ──

export { getSession, isIdentityReady, clearSession, listSessions } from './state/agent-state.js';
export { executeIdentitySetup, IdentitySetupParams } from './tools/identity.js';
export { executeDeclareIntent, DeclareIntentParams } from './tools/intent.js';
export { executeVerifyBundle, VerifyBundleParams } from './tools/verify.js';
export {
  executeLogAction,
  LogActionParams,
  executeGetAuditTrail,
  GetAuditTrailParams,
} from './tools/audit.js';
