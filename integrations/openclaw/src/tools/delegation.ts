/**
 * DCP-09 Delegation tools — Delegation Mandate creation.
 *
 * Follows the same pattern as tools/identity.ts.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  registerDefaultProviders,
  getDefaultRegistry,
  createDelegationMandate,
} from '@dcp-ai/sdk';
import { getSession, isIdentityReady } from '../state/agent-state.js';

export const CreateMandateParams = Type.Object({
  session_id: Type.String({ description: 'OpenClaw session / thread identifier' }),
  human_id: Type.String({ description: 'Human principal granting delegation' }),
  authority_scope: Type.Array(Type.String(), {
    description: 'Scopes of authority being delegated (DCP-09 §3.1)',
  }),
  valid_from: Type.Optional(
    Type.String({ description: 'ISO 8601 start of validity (defaults to now)' }),
  ),
  valid_until: Type.Optional(
    Type.String({ description: 'ISO 8601 end of validity' }),
  ),
});

export type CreateMandateInput = Static<typeof CreateMandateParams>;

export interface CreateMandateResult {
  mandate_id: string;
  agent_id: string;
  human_id: string;
  authority_scope: string[];
  message: string;
}

export async function executeCreateMandate(
  params: CreateMandateInput,
): Promise<CreateMandateResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
  }

  registerDefaultProviders();
  const registry = getDefaultRegistry();
  const session = getSession(params.session_id);

  const now = new Date().toISOString();
  const mandateId = `mandate:${crypto.randomUUID()}`;

  const mandate = await createDelegationMandate(registry, session.compositeKeys!, {
    mandate_id: mandateId,
    session_nonce: session.sessionNonce!,
    human_id: params.human_id,
    agent_id: session.passportV2!.agent_id,
    authority_scope: params.authority_scope as any,
    valid_from: params.valid_from ?? now,
    valid_until: params.valid_until ?? new Date(Date.now() + 86400000).toISOString(),
    revocable: true,
  });

  session.delegationMandate = mandate as any;

  return {
    mandate_id: mandateId,
    agent_id: session.passportV2!.agent_id,
    human_id: params.human_id,
    authority_scope: params.authority_scope,
    message: `Delegation mandate created (DCP-09 §3.1). ${params.human_id} delegates [${params.authority_scope.join(', ')}] to agent ${session.passportV2!.agent_id}.`,
  };
}
