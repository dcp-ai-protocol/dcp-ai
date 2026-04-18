/**
 * DCP-06 Succession tools — Digital Testament creation.
 *
 * Follows the same pattern as tools/identity.ts.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  registerDefaultProviders,
  getDefaultRegistry,
  createDigitalTestament,
} from '@dcp-ai/sdk';
import { getSession, isIdentityReady } from '../state/agent-state.js';

export const CreateTestamentParams = Type.Object({
  session_id: Type.String({ description: 'OpenClaw session / thread identifier' }),
  successor_preferences: Type.Array(
    Type.Object({
      agent_id: Type.String(),
      priority: Type.Number(),
    }),
    { description: 'Ordered list of preferred successors (DCP-06 §3.1)' },
  ),
  memory_classification: Type.Union(
    [Type.Literal('transferable'), Type.Literal('restricted'), Type.Literal('destroy')],
    { description: 'How to handle agent memory upon succession' },
  ),
});

export type CreateTestamentInput = Static<typeof CreateTestamentParams>;

export interface CreateTestamentResult {
  testament_id: string;
  agent_id: string;
  successor_count: number;
  message: string;
}

export async function executeCreateTestament(
  params: CreateTestamentInput,
): Promise<CreateTestamentResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
  }

  registerDefaultProviders();
  const registry = getDefaultRegistry();
  const session = getSession(params.session_id);

  const testament = await createDigitalTestament(registry, session.compositeKeys!, {
    agent_id: session.passportV2!.agent_id,
    session_nonce: session.sessionNonce!,
    successor_preferences: params.successor_preferences as any,
    memory_classification: params.memory_classification as any,
    human_consent_required: true,
  });

  session.digitalTestament = testament as any;

  return {
    testament_id: (testament as any).testament_id ?? crypto.randomUUID(),
    agent_id: session.passportV2!.agent_id,
    successor_count: params.successor_preferences.length,
    message: `Digital testament created (DCP-06 §3.1). ${params.successor_preferences.length} successor(s) registered. Memory: ${params.memory_classification}.`,
  };
}
