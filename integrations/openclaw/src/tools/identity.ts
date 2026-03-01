/**
 * dcp_identity_setup — Generate V2 composite identity.
 *
 * Creates a full DCP v2.0 identity: session nonce, dual keypair
 * (Ed25519 + ML-DSA-65), AgentPassportV2, ResponsiblePrincipalRecordV2,
 * emergency revocation token, all wrapped in SignedPayload envelopes
 * with composite signatures.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  generateSessionNonce,
  deriveKid,
  registerDefaultProviders,
  getDefaultRegistry,
  compositeSign,
  preparePayload,
  generateEmergencyRevocationToken,
  DCP_CONTEXTS,
  type AgentPassportV2,
  type ResponsiblePrincipalRecordV2,
  type KeyEntry,
  type SignedPayload,
  type CompositeKeyPair,
} from '@dcp-ai/sdk';
import { getSession } from '../state/agent-state.js';

// ── Parameter Schema ──

export const IdentitySetupParams = Type.Object({
  session_id: Type.String({
    description: 'OpenClaw session / thread identifier',
  }),
  owner_name: Type.String({
    description: 'Legal name of the human owner (for RPR)',
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

export interface IdentitySetupResult {
  agent_id: string;
  human_id: string;
  session_nonce: string;
  classical_kid: string;
  pq_kid: string;
  capabilities: string[];
  risk_tier: string;
  emergency_revocation_token: string;
  message: string;
}

export async function executeIdentitySetup(
  params: IdentitySetupInput,
): Promise<IdentitySetupResult> {
  registerDefaultProviders();
  const registry = getDefaultRegistry();
  const session = getSession(params.session_id);

  // Generate session nonce (256-bit random, anti-splicing)
  const sessionNonce = generateSessionNonce();
  session.sessionNonce = sessionNonce;
  session.dcpVersion = '2.0';

  // Generate dual keypair: Ed25519 (classical) + ML-DSA-65 (PQ)
  const ed25519 = registry.getSigner('ed25519');
  const mlDsa65 = registry.getSigner('ml-dsa-65');

  const classicalKp = await ed25519.generateKeypair();
  const pqKp = await mlDsa65.generateKeypair();

  const compositeKeys: CompositeKeyPair = {
    classical: {
      kid: classicalKp.kid,
      alg: 'ed25519',
      secretKeyB64: classicalKp.secretKeyB64,
      publicKeyB64: classicalKp.publicKeyB64,
    },
    pq: {
      kid: pqKp.kid,
      alg: 'ml-dsa-65',
      secretKeyB64: pqKp.secretKeyB64,
      publicKeyB64: pqKp.publicKeyB64,
    },
  };
  session.compositeKeys = compositeKeys;

  // Also store V1 keypair for backward compat
  session.keypair = {
    publicKeyB64: classicalKp.publicKeyB64,
    secretKeyB64: classicalKp.secretKeyB64,
  };

  const now = new Date().toISOString();
  const humanId = `rpr:${crypto.randomUUID()}`;
  const agentId = `agent:${crypto.randomUUID()}`;
  const capabilities = params.capabilities ?? ['browse', 'api_call'];
  const riskTier = params.risk_tier ?? 'medium';

  // Generate emergency revocation token (Gap #13)
  const emergencyToken = generateEmergencyRevocationToken();
  session.emergencyToken = emergencyToken;

  // Build key entries for passport/RPR
  const classicalKeyEntry: KeyEntry = {
    kid: classicalKp.kid,
    alg: 'ed25519',
    public_key_b64: classicalKp.publicKeyB64,
    created_at: now,
    expires_at: null,
    status: 'active',
  };
  const pqKeyEntry: KeyEntry = {
    kid: pqKp.kid,
    alg: 'ml-dsa-65',
    public_key_b64: pqKp.publicKeyB64,
    created_at: now,
    expires_at: null,
    status: 'active',
  };

  // Build AgentPassportV2
  const passport: AgentPassportV2 = {
    dcp_version: '2.0',
    agent_id: agentId,
    session_nonce: sessionNonce,
    keys: [classicalKeyEntry, pqKeyEntry],
    principal_binding_reference: humanId,
    capabilities: capabilities as any,
    risk_tier: riskTier as any,
    created_at: now,
    status: 'active',
    emergency_revocation_token: emergencyToken.emergency_revocation_token,
  };
  session.passportV2 = passport;

  // Wrap passport in SignedPayload with composite sig
  const passportPrepared = preparePayload(passport);
  const passportSig = await compositeSign(
    registry,
    DCP_CONTEXTS.AgentPassport,
    passportPrepared.canonicalBytes,
    compositeKeys,
  );
  const signedPassport: SignedPayload<AgentPassportV2> = {
    payload: passport,
    payload_hash: passportPrepared.payloadHash,
    composite_sig: passportSig,
  };
  session.signedPassport = signedPassport;

  // Build ResponsiblePrincipalRecordV2
  const rpr: ResponsiblePrincipalRecordV2 = {
    dcp_version: '2.0',
    human_id: humanId,
    session_nonce: sessionNonce,
    legal_name: params.owner_name,
    entity_type: (params.entity_type ?? 'natural_person') as any,
    jurisdiction: params.jurisdiction,
    liability_mode: 'owner_responsible',
    override_rights: true,
    issued_at: now,
    expires_at: null,
    contact: params.contact ?? null,
    binding_keys: [classicalKeyEntry, pqKeyEntry],
  };
  session.rprV2 = rpr;

  // Wrap RPR in SignedPayload
  const rprPrepared = preparePayload(rpr);
  const rprSig = await compositeSign(
    registry,
    DCP_CONTEXTS.ResponsiblePrincipal,
    rprPrepared.canonicalBytes,
    compositeKeys,
  );
  const signedRpr: SignedPayload<ResponsiblePrincipalRecordV2> = {
    payload: rpr,
    payload_hash: rprPrepared.payloadHash,
    composite_sig: rprSig,
  };
  session.signedRpr = signedRpr;

  return {
    agent_id: agentId,
    human_id: humanId,
    session_nonce: sessionNonce,
    classical_kid: classicalKp.kid,
    pq_kid: pqKp.kid,
    capabilities,
    risk_tier: riskTier,
    emergency_revocation_token: emergencyToken.emergency_revocation_token,
    message: `DCP v2.0 identity created. Agent ${agentId} bound to ${params.owner_name} (${params.jurisdiction}). Composite keys: Ed25519 + ML-DSA-65.`,
  };
}
