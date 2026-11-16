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
  deriveKid,
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
  /**
   * The trust anchor: keys the verifier already trusts for this agent (its passport keys from a
   * registry, a pinned earlier passport, or the `binding_keys` of a verified RPR when the
   * principal signs for the agent). When given, both signing keys must be among them, with the
   * same `kid`, `alg` and `public_key_b64`. Without it the result is only self-consistent.
   */
  trustedKeys?: KeyEntry[];
  /** The agent the card is expected to be; the passport's `agent_id` must equal it. */
  expectedAgentId?: string;
}

export interface AgentCardPassportResult {
  verified: boolean;
  errors: string[];
  /**
   * True when the signing keys were checked against `trustedKeys`. A result that is verified
   * but not anchored proves only that the passport is signed by the keys it lists itself.
   */
  anchored: boolean;
  /** The passport payload, once its hash and signature verify. */
  passport?: AgentPassportV2;
}

const CLASSICAL_ALGS: ReadonlySet<string> = new Set(['ed25519']);
const PQ_ALGS: ReadonlySet<string> = new Set(['ml-dsa-65', 'slh-dsa-192f']);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The instant an RFC 3339 timestamp names, or undefined for anything else (no dates, no RFC 2822, no local times). */
function instant(v: unknown): number | undefined {
  if (typeof v !== 'string' || !RFC3339.test(v)) return undefined;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? undefined : ms;
}

function keyError(slot: unknown, allowed: ReadonlySet<string>, keys: KeyEntry[], nowMs: number, trusted?: KeyEntry[]): KeyEntry | string {
  if (typeof slot !== 'object' || slot === null) return 'signature slot missing';
  const { kid, alg } = slot as { kid?: unknown; alg?: unknown };
  if (typeof kid !== 'string' || kid === '' || typeof alg !== 'string') return 'signature slot without kid or alg';
  if (!allowed.has(alg)) return `signature algorithm ${alg} is not allowed in this slot (${[...allowed].join(', ')})`;
  const key = keys.find((k) => k && k.kid === kid);
  if (!key) return `key ${kid} is not in the passport`;
  if (key.alg !== alg) return `key ${kid} is ${key.alg}, signature says ${alg}`;
  if (typeof key.public_key_b64 !== 'string' || key.public_key_b64 === '') return `key ${kid} has no public key`;
  if (deriveKid(alg, Buffer.from(key.public_key_b64, 'base64')) !== kid) return `key ${kid} is not the kid of its public key`;
  if (key.status !== 'active') return `key ${kid} is ${key.status}`;
  if (instant(key.created_at) === undefined) return `key ${kid} has an invalid created_at`;
  if (key.expires_at !== null && key.expires_at !== undefined) {
    const expires = instant(key.expires_at);
    if (expires === undefined) return `key ${kid} has an invalid expires_at`;
    if (expires < nowMs) return `key ${kid} has expired`;
  }
  if (trusted) {
    // The trusted entry is the authoritative one: it must match and be live itself, so a key the
    // verifier has since revoked or let expire cannot be revived by the passport's own copy.
    // Every matching entry must be live: a revocation recorded next to a stale active copy still wins.
    const anchors = trusted.filter((t) => t && t.kid === kid && t.alg === alg && t.public_key_b64 === key.public_key_b64);
    if (anchors.length === 0) return `key ${kid} is not among the trusted keys`;
    for (const anchor of anchors) {
      if (anchor.status !== 'active') return `trusted key ${kid} is ${String(anchor.status)}`;
      if (anchor.expires_at !== null && anchor.expires_at !== undefined) {
        const expires = instant(anchor.expires_at);
        if (expires === undefined) return `trusted key ${kid} has an invalid expires_at`;
        if (expires < nowMs) return `trusted key ${kid} has expired`;
      }
    }
  }
  return key;
}

/**
 * Verify the DCP passport an Agent Card carries.
 *
 * What a `verified` result proves: the card carries a passport whose payload hash matches, whose
 * composite signature (`pq_over_classical`, Ed25519 plus ML-DSA-65 or SLH-DSA-192f) verifies
 * under the AgentPassport context with keys the passport itself lists (active, unexpired, with
 * the `kid` of their public key), whose timestamps are RFC 3339, which is `active`, which names
 * the agent `metadata.dcp_agent_id` and `expectedAgentId` name, and, when `trustedKeys` is given
 * (`anchored: true`), whose signing keys are keys the verifier already trusts for that agent.
 *
 * What it does not prove: that the party serving the card holds those keys, or that `url`,
 * `name`, `provider` or `skills` belong to the passport's agent. A passport is public and anyone
 * can copy it into their own card. Before delegating a task, use only `result.passport`, not the
 * card's unsigned fields, and demand proof of possession from the endpoint (the SDK's
 * `generateRegistrationPoP` / `verifyRegistrationPoP`, or a DCP-04 A2A session); A2A 1.0's
 * `AgentCard.signatures` (JWS over the card) binds the rest of the card. Anything malformed
 * fails closed.
 */
export async function verifyAgentCardPassport(card: AgentCard, options: VerifyAgentCardPassportOptions = {}): Promise<AgentCardPassportResult> {
  try {
    return await verify(card, options);
  } catch (e) {
    return { verified: false, anchored: false, errors: [`passport verification error: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

async function verify(card: AgentCard, options: VerifyAgentCardPassportOptions): Promise<AgentCardPassportResult> {
  const anchored = options.trustedKeys !== undefined;
  const invalid = (errors: string[]): AgentCardPassportResult => ({ verified: false, anchored, errors });
  if (anchored && !Array.isArray(options.trustedKeys)) return invalid(['trustedKeys must be an array of key entries']);
  const signed = agentCardPassport(card);
  if (!signed) return invalid(['the Agent Card carries no DCP passport extension']);
  const errors: string[] = [];
  const p = signed.payload;
  if (!verifyPayloadHash(signed)) errors.push('passport payload_hash mismatch');
  if (p.dcp_version !== '2.0') errors.push(`unsupported passport dcp_version ${String(p.dcp_version)}`);
  if (typeof p.agent_id !== 'string' || p.agent_id === '') errors.push('passport agent_id missing');
  if (typeof p.principal_binding_reference !== 'string' || p.principal_binding_reference === '') errors.push('passport principal_binding_reference missing');
  if (p.status !== 'active') errors.push(`passport status is ${String(p.status)}`);
  if (instant(p.created_at) === undefined) errors.push('passport created_at is not an RFC 3339 timestamp');
  if (!Array.isArray(p.keys) || p.keys.length === 0) errors.push('passport lists no keys');
  const declared = card.metadata?.dcp_agent_id;
  if (declared !== undefined && declared !== p.agent_id) errors.push(`metadata.dcp_agent_id ${String(declared)} is not the passport agent_id ${String(p.agent_id)}`);
  if (options.expectedAgentId !== undefined && options.expectedAgentId !== p.agent_id) errors.push(`passport agent_id ${String(p.agent_id)} is not the expected ${options.expectedAgentId}`);
  if (errors.length > 0) return invalid(errors);

  const sig = signed.composite_sig;
  if (sig?.binding !== 'pq_over_classical' || !sig.classical || !sig.pq) {
    return invalid(['passport signature must be pq_over_classical with both signatures']);
  }
  const nowMs = (options.now ?? new Date()).getTime();
  const classical = keyError(sig.classical, CLASSICAL_ALGS, p.keys, nowMs, options.trustedKeys);
  const pq = keyError(sig.pq, PQ_ALGS, p.keys, nowMs, options.trustedKeys);
  if (typeof classical === 'string') errors.push(classical);
  if (typeof pq === 'string') errors.push(pq);
  if (errors.length > 0) return invalid(errors);

  const registry = options.registry ?? (registerDefaultProviders(), getDefaultRegistry());
  const { canonicalBytes } = preparePayload(p);
  const result = await compositeVerify(registry, DCP_CONTEXTS.AgentPassport, canonicalBytes, sig, (classical as KeyEntry).public_key_b64, (pq as KeyEntry).public_key_b64);
  if (!result.valid) {
    return invalid([`passport composite signature does not verify (classical ${result.classical_valid}, pq ${result.pq_valid})`]);
  }
  return { verified: true, anchored, errors: [], passport: p };
}
