/**
 * The signed DCP Agent Passport inside an A2A Agent Card.
 *
 * A2A lets an Agent Card declare extensions in `capabilities.extensions` (`AgentExtension`:
 * `uri`, `description`, `required`, `params`). The DCP passport extension carries the agent's
 * `SignedPayload<AgentPassportV2>` in `params.passport`, so an A2A consumer can verify, offline
 * and before any task, that the agent it discovered is a DCP citizen: a passport signed with
 * its own listed keys (Ed25519 + ML-DSA-65) and bound to a responsible principal.
 */
import {
  compositeVerify,
  preparePayload,
  verifyPayloadHash,
  getDefaultRegistry,
  registerDefaultProviders,
  DCP_CONTEXTS,
  type AlgorithmRegistry,
  type AgentPassportV2,
  type KeyEntry,
  type SignedPayload,
} from '@dcp-ai/sdk';

/** URI of the DCP passport extension in `capabilities.extensions`. */
export const DCP_PASSPORT_EXTENSION_URI = 'https://dcp-ai.org/a2a/extensions/passport/v2';

export interface AgentExtension {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
}

/** The A2A Agent Card fields this bridge reads or writes; anything else passes through. */
export interface AgentCard {
  name?: string;
  provider?: { organization?: string; url?: string; [key: string]: unknown };
  capabilities?: { extensions?: AgentExtension[]; [key: string]: unknown };
  skills?: Array<{ id: string; [key: string]: unknown }>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type SignedPassport = SignedPayload<AgentPassportV2>;

export function isSignedPassport(v: unknown): v is SignedPassport {
  return (
    typeof v === 'object' && v !== null && 'payload' in v && 'composite_sig' in v && 'payload_hash' in v &&
    typeof (v as SignedPassport).payload === 'object' && (v as SignedPassport).payload !== null
  );
}

/** A copy of the card carrying the passport in the DCP extension; an earlier DCP passport extension is replaced. */
export function attachPassportToAgentCard(card: AgentCard, signedPassport: SignedPassport): AgentCard {
  const extensions = (card.capabilities?.extensions ?? []).filter((e) => e?.uri !== DCP_PASSPORT_EXTENSION_URI);
  extensions.push({
    uri: DCP_PASSPORT_EXTENSION_URI,
    description: 'DCP-AI Agent Passport (DCP-01), composite-signed; verify with @dcp-ai/google-a2a verifyAgentCardPassport',
    required: false,
    params: { dcp_version: '2.0', passport: signedPassport },
  });
  return {
    ...card,
    capabilities: { ...card.capabilities, extensions },
    metadata: {
      ...card.metadata,
      dcp_agent_id: signedPassport.payload.agent_id,
      dcp_version: signedPassport.payload.dcp_version ?? '2.0',
      dcp_lifecycle_state: signedPassport.payload.status,
    },
  };
}

/** The signed passport the card carries, or undefined when it has no DCP passport extension. */
export function agentCardPassport(card: AgentCard): SignedPassport | undefined {
  const ext = card?.capabilities?.extensions?.find((e) => e?.uri === DCP_PASSPORT_EXTENSION_URI);
  const passport = ext?.params?.passport;
  return isSignedPassport(passport) ? passport : undefined;
}

export interface VerifyAgentCardPassportOptions {
  registry?: AlgorithmRegistry;
  /** Verification time; default now. */
  now?: Date;
}

export interface AgentCardPassportResult {
  verified: boolean;
  errors: string[];
  /** The passport payload, once its hash and signature verify. */
  passport?: AgentPassportV2;
}

function activeKey(keys: KeyEntry[], slot: { kid: string; alg: string }, nowMs: number): KeyEntry | string {
  const key = keys.find((k) => k && k.kid === slot.kid);
  if (!key) return `key ${slot.kid} is not in the passport`;
  if (key.alg !== slot.alg) return `key ${slot.kid} is ${key.alg}, signature says ${slot.alg}`;
  if (key.status !== 'active') return `key ${slot.kid} is ${key.status}`;
  if (key.expires_at !== null && key.expires_at !== undefined) {
    const expires = Date.parse(key.expires_at);
    if (Number.isNaN(expires)) return `key ${slot.kid} has an invalid expires_at`;
    if (expires < nowMs) return `key ${slot.kid} has expired`;
  }
  return key;
}

/**
 * Verify the DCP passport an Agent Card carries: the extension is present, the payload hash
 * matches, the composite signature is `pq_over_classical` and verifies under the AgentPassport
 * context with keys the passport itself lists (active, unexpired, of the signature's algorithm),
 * the passport is `active`, and `metadata.dcp_agent_id`, when present, names the same agent.
 * Anything malformed fails closed. The caller still decides whether to trust the principal the
 * passport binds to (`principal_binding_reference`), as with any DCP bundle.
 */
export async function verifyAgentCardPassport(card: AgentCard, options: VerifyAgentCardPassportOptions = {}): Promise<AgentCardPassportResult> {
  try {
    return await verify(card, options);
  } catch (e) {
    return { verified: false, errors: [`passport verification error: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

async function verify(card: AgentCard, options: VerifyAgentCardPassportOptions): Promise<AgentCardPassportResult> {
  const signed = agentCardPassport(card);
  if (!signed) return { verified: false, errors: ['the Agent Card carries no DCP passport extension'] };
  const errors: string[] = [];
  const p = signed.payload;
  if (!verifyPayloadHash(signed)) errors.push('passport payload_hash mismatch');
  if (p.dcp_version !== '2.0') errors.push(`unsupported passport dcp_version ${String(p.dcp_version)}`);
  if (typeof p.agent_id !== 'string' || p.agent_id === '') errors.push('passport agent_id missing');
  if (typeof p.principal_binding_reference !== 'string' || p.principal_binding_reference === '') errors.push('passport principal_binding_reference missing');
  if (p.status !== 'active') errors.push(`passport status is ${String(p.status)}`);
  if (!Array.isArray(p.keys) || p.keys.length === 0) errors.push('passport lists no keys');
  const declared = card.metadata?.dcp_agent_id;
  if (declared !== undefined && declared !== p.agent_id) errors.push(`metadata.dcp_agent_id ${String(declared)} is not the passport agent_id ${String(p.agent_id)}`);
  if (errors.length > 0) return { verified: false, errors };

  const sig = signed.composite_sig;
  if (sig?.binding !== 'pq_over_classical' || !sig.classical || !sig.pq) {
    return { verified: false, errors: ['passport signature must be pq_over_classical with both signatures'] };
  }
  const nowMs = (options.now ?? new Date()).getTime();
  const classical = activeKey(p.keys, sig.classical, nowMs);
  const pq = activeKey(p.keys, sig.pq, nowMs);
  if (typeof classical === 'string') errors.push(classical);
  if (typeof pq === 'string') errors.push(pq);
  if (errors.length > 0) return { verified: false, errors };

  const registry = options.registry ?? (registerDefaultProviders(), getDefaultRegistry());
  const { canonicalBytes } = preparePayload(p);
  const result = await compositeVerify(registry, DCP_CONTEXTS.AgentPassport, canonicalBytes, sig, (classical as KeyEntry).public_key_b64, (pq as KeyEntry).public_key_b64);
  if (!result.valid) {
    return { verified: false, errors: [`passport composite signature does not verify (classical ${result.classical_valid}, pq ${result.pq_valid})`] };
  }
  return { verified: true, errors: [], passport: p };
}
