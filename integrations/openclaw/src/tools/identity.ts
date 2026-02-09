/**
 * dcp_identity_setup — Generate Ed25519 keypair + HBR + AgentPassport.
 *
 * This tool runs once during agent onboarding. It creates the full DCP
 * identity chain: a Human Binding Record linking the OpenClaw owner to
 * the agent, and an Agent Passport declaring the agent's capabilities.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  generateKeypair,
  signObject,
  type HumanBindingRecord,
  type AgentPassport,
} from '@dcp-ai/sdk';
import { getSession } from '../state/agent-state.js';

// ── Parameter Schema ──

export const IdentitySetupParams = Type.Object({
  session_id: Type.String({
    description: 'OpenClaw session / thread identifier',
  }),
  owner_name: Type.String({
    description: 'Legal name of the human owner (for HBR)',
  }),
  entity_type: Type.Union([Type.Literal('natural_person'), Type.Literal('organization')], {
    description: 'Whether the owner is a natural person or organization',
    default: 'natural_person',
  }),
  jurisdiction: Type.String({
    description: 'ISO 3166-1 jurisdiction code (e.g. "US", "ES", "MX")',
  }),
  capabilities: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('browse'),
        Type.Literal('api_call'),
        Type.Literal('email'),
        Type.Literal('calendar'),
        Type.Literal('payments'),
        Type.Literal('crm'),
        Type.Literal('file_write'),
        Type.Literal('code_exec'),
      ]),
      { description: 'Agent capabilities (DCP-01). Defaults to browse + api_call.' },
    ),
  ),
  risk_tier: Type.Optional(
    Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')], {
      description: 'Agent risk tier. Defaults to medium.',
      default: 'medium',
    }),
  ),
  contact: Type.Optional(
    Type.String({ description: 'Owner contact email (optional)' }),
  ),
});

export type IdentitySetupInput = Static<typeof IdentitySetupParams>;

// ── Execution ──

export interface IdentitySetupResult {
  agent_id: string;
  human_id: string;
  public_key: string;
  capabilities: string[];
  risk_tier: string;
  message: string;
}

export async function executeIdentitySetup(
  params: IdentitySetupInput,
): Promise<IdentitySetupResult> {
  const session = getSession(params.session_id);

  // Generate Ed25519 keypair
  const keypair = generateKeypair();
  session.keypair = keypair;

  const now = new Date().toISOString();
  const humanId = `hbr:${crypto.randomUUID()}`;
  const agentId = `agent:${crypto.randomUUID()}`;
  const capabilities = params.capabilities ?? ['browse', 'api_call'];
  const riskTier = params.risk_tier ?? 'medium';

  // Build Human Binding Record (DCP-01)
  const hbrUnsigned: Omit<HumanBindingRecord, 'signature'> = {
    dcp_version: '1.0',
    human_id: humanId,
    legal_name: params.owner_name,
    entity_type: params.entity_type ?? 'natural_person',
    jurisdiction: params.jurisdiction,
    liability_mode: 'owner_responsible',
    override_rights: true,
    issued_at: now,
    expires_at: null,
    contact: params.contact ?? null,
  };

  const hbr: HumanBindingRecord = {
    ...hbrUnsigned,
    signature: signObject(hbrUnsigned, keypair.secretKeyB64),
  };
  session.hbr = hbr;

  // Build Agent Passport (DCP-01)
  const passportUnsigned: Omit<AgentPassport, 'signature'> = {
    dcp_version: '1.0',
    agent_id: agentId,
    public_key: keypair.publicKeyB64,
    human_binding_reference: humanId,
    capabilities,
    risk_tier: riskTier,
    created_at: now,
    status: 'active',
  };

  const passport: AgentPassport = {
    ...passportUnsigned,
    signature: signObject(passportUnsigned, keypair.secretKeyB64),
  };
  session.passport = passport;

  return {
    agent_id: agentId,
    human_id: humanId,
    public_key: keypair.publicKeyB64,
    capabilities,
    risk_tier: riskTier,
    message: `DCP identity created. Agent ${agentId} bound to ${params.owner_name} (${params.jurisdiction}).`,
  };
}
