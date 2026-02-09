/**
 * @dcp-ai/openclaw — OpenClaw plugin for Digital Citizenship Protocol.
 *
 * Registers DCP agent tools with the OpenClaw plugin API:
 *  - dcp_identity_setup   (DCP-01: keygen + HBR + AgentPassport)
 *  - dcp_declare_intent   (DCP-02: Intent + PolicyDecision)
 *  - dcp_verify_bundle    (Signed bundle verification)
 *  - dcp_log_action       (DCP-03: AuditEntry with hash-chaining)
 *  - dcp_get_audit_trail  (DCP-03: retrieve audit trail)
 *  - dcp_sign_bundle      (Build + sign a full CitizenshipBundle)
 */
import { Type } from '@sinclair/typebox';
import {
  BundleBuilder,
  signBundle,
} from '@dcp-ai/sdk';

// Tools
import { IdentitySetupParams, executeIdentitySetup } from './tools/identity.js';
import { DeclareIntentParams, executeDeclareIntent } from './tools/intent.js';
import { VerifyBundleParams, executeVerifyBundle } from './tools/verify.js';
import {
  LogActionParams,
  executeLogAction,
  GetAuditTrailParams,
  executeGetAuditTrail,
} from './tools/audit.js';

// State
import { getSession, isIdentityReady, clearSession } from './state/agent-state.js';

// ── OpenClaw Plugin API types (minimal interface) ──

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
      'Generate a DCP identity (Ed25519 keypair + Human Binding Record + Agent Passport). ' +
      'Run this once at the start of a session before using other DCP tools.',
    parameters: IdentitySetupParams,
    async execute(_id, params) {
      return executeIdentitySetup(params as any);
    },
  });

  // ─── 2. dcp_declare_intent ───
  api.registerTool({
    name: 'dcp_declare_intent',
    description:
      'Declare an intent before performing a sensitive action (DCP-02). ' +
      'Required before API calls, file writes, code execution, emails, or payments. ' +
      'Returns a policy decision (approve/escalate/block) with risk score.',
    parameters: DeclareIntentParams,
    async execute(_id, params) {
      return executeDeclareIntent(params as any);
    },
  });

  // ─── 3. dcp_verify_bundle ───
  api.registerTool({
    name: 'dcp_verify_bundle',
    description:
      'Verify a DCP Signed Bundle: schema validation, Ed25519 signature, ' +
      'bundle hash, merkle root, intent_hash chain, and prev_hash chain.',
    parameters: VerifyBundleParams,
    async execute(_id, params) {
      return executeVerifyBundle(params as any);
    },
  });

  // ─── 4. dcp_log_action ───
  api.registerTool({
    name: 'dcp_log_action',
    description:
      'Record a completed action as an AuditEntry with automatic hash-chaining (DCP-03). ' +
      'Call after performing the action declared via dcp_declare_intent.',
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
      'Returns all hash-chained audit entries with their intent and evidence references.',
    parameters: GetAuditTrailParams,
    async execute(_id, params) {
      return executeGetAuditTrail(params as any);
    },
  });

  // ─── 6. dcp_sign_bundle ───
  api.registerTool({
    name: 'dcp_sign_bundle',
    description:
      'Build and sign a complete DCP CitizenshipBundle from the current session state. ' +
      'Includes HBR, AgentPassport, the most recent Intent + PolicyDecision, and full audit trail. ' +
      'Typically called at session end.',
    parameters: Type.Object({
      session_id: Type.String({
        description: 'OpenClaw session / thread identifier',
      }),
      intent_id: Type.Optional(
        Type.String({
          description:
            'Specific intent_id to include. If omitted, the most recent intent is used.',
        }),
      ),
    }),
    async execute(_id, params: Record<string, unknown>) {
      const sessionId = params.session_id as string;

      if (!isIdentityReady(sessionId)) {
        throw new Error(
          'DCP identity not set up. Run dcp_identity_setup first.',
        );
      }

      const session = getSession(sessionId);

      if (session.auditEntries.length === 0) {
        throw new Error(
          'No audit entries recorded. Log at least one action with dcp_log_action first.',
        );
      }

      // Pick intent (explicit or most recent)
      let intentId = params.intent_id as string | undefined;
      if (!intentId) {
        // Use the most recent intent
        const keys = Array.from(session.intents.keys());
        intentId = keys[keys.length - 1];
      }

      const intent = session.intents.get(intentId!);
      if (!intent) {
        throw new Error(`Intent ${intentId} not found in session.`);
      }

      const policy = session.policyDecisions.get(intentId!);
      if (!policy) {
        throw new Error(`PolicyDecision for intent ${intentId} not found.`);
      }

      // Build the bundle using @dcp-ai/sdk BundleBuilder
      const bundle = new BundleBuilder()
        .humanBindingRecord(session.hbr!)
        .agentPassport(session.passport!)
        .intent(intent)
        .policyDecision(policy);

      for (const entry of session.auditEntries) {
        bundle.addAuditEntry(entry);
      }

      const citizenshipBundle = bundle.build();

      // Sign the bundle
      const signed = signBundle(citizenshipBundle, {
        secretKeyB64: session.keypair!.secretKeyB64,
        signerType: 'human',
        signerId: session.hbr!.human_id,
      });

      return {
        signed_bundle: signed,
        agent_id: session.passport!.agent_id,
        human_id: session.hbr!.human_id,
        audit_entries_count: session.auditEntries.length,
        message: `CitizenshipBundle signed successfully with ${session.auditEntries.length} audit entries.`,
      };
    },
  });
}

// ── Re-exports for programmatic use ──

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
