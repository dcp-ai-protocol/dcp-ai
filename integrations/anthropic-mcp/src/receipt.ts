/**
 * Signed receipts for MCP tool calls.
 *
 * A receipt is an ordinary DCP v2.0 signed bundle, nothing new on the wire: the
 * agent's Responsible Principal Record and Agent Passport, an Intent composite-signed
 * before the tool runs, the Policy Decision that let it run (or not), and one audit
 * entry carrying the SHA-256 of the tool's arguments and result. Any DCP verifier
 * checks it offline with `verifySignedBundleV2`; `verifyDcpReceipt` also recomputes
 * the evidence hash from the arguments and result the caller saw.
 */
import crypto from 'crypto';
import {
  BundleBuilderV2,
  signBundleV2,
  verifySignedBundleV2,
  compositeSign,
  preparePayload,
  computeSecurityTier,
  canonicalizeV2,
  sha256Hex,
  generateSessionNonce,
  getDefaultRegistry,
  registerDefaultProviders,
  DCP_CONTEXTS,
  DEFAULT_VERIFIER_POLICY,
  type AlgorithmRegistry,
  type CompositeKeyPair,
  type SignedPayload,
  type ResponsiblePrincipalRecordV2,
  type AgentPassportV2,
  type IntentV2,
  type PolicyDecisionV2,
  type PolicyDecisionType,
  type AuditEventV2,
  type SignedBundleV2,
  type KeyEntry,
  type ActionType,
  type DataClass,
  type Impact,
} from '@dcp-ai/sdk';

type Channel = IntentV2['target']['channel'];
type VerifierPolicy = Parameters<typeof verifySignedBundleV2>[2];
// @dcp-ai/sdk releases after 2.1.2 read risk_score from the policy decision (spec §14.2);
// earlier ones ignore the second argument.
const computeTier = computeSecurityTier as (intent: IntentV2, policyDecision?: Pick<PolicyDecisionV2, 'risk_score'>) => IntentV2['security_tier'] & string;

/** The signed identity a receipt binds every call to; one per session nonce. */
export interface DcpReceiptIdentity {
  /** Session nonce shared by the RPR, the passport and every receipt of the session. */
  sessionNonce: string;
  /** The agent's signing keys (Ed25519 + ML-DSA-65), listed in the passport. */
  keys: CompositeKeyPair;
  signedRpr: SignedPayload<ResponsiblePrincipalRecordV2>;
  signedPassport: SignedPayload<AgentPassportV2>;
}

/** How a tool call maps onto a DCP Intent (DCP-02). Everything is optional; see the defaults. */
export interface ToolCallClassification {
  /** Default `api_call`. */
  action_type?: ActionType;
  /** Default `api`. */
  channel?: Channel;
  /** Default `['none']`. */
  data_classes?: DataClass[];
  /** Default `low`. */
  estimated_impact?: Impact;
  /** Default: true when the impact is `high`. */
  requires_consent?: boolean;
}

export interface PolicyVerdict {
  decision: PolicyDecisionType;
  /** Integer millirisk, 0-1000. */
  risk_score: number;
  reasons: string[];
}

export interface DcpReceiptOptions {
  identity: DcpReceiptIdentity;
  /** Defaults to the SDK registry with Ed25519 and ML-DSA-65 registered. */
  registry?: AlgorithmRegistry;
  /** Maps a call onto an intent; the default classifies every call as a low-impact `api_call` with no data classes. */
  classify?: (toolName: string, args: unknown) => ToolCallClassification;
  /** Decides whether the call runs; the default is `defaultPolicy`. */
  decide?: (intent: IntentV2) => PolicyVerdict;
  /** `applied_policy_hash` of the decisions; default: the hash of `defaultPolicy`'s rules. */
  appliedPolicyHash?: string;
}

/** An MCP `CallToolResult`: what a wrapped handler returns when the call does not run or fails. */
export interface DcpReceiptResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * What a wrapped handler returns: the handler's own result, or a `DcpReceiptResult` with
 * `isError` when the call was escalated, blocked or failed; always with the receipt in `_meta`.
 */
export type WithDcpReceipt<R> = ([R] extends [never] ? DcpReceiptResult : R extends object ? R : DcpReceiptResult) & {
  isError?: boolean;
  _meta: { dcp_receipt: SignedBundleV2 };
};

const IMPACT_RISK: Record<Impact, number> = { low: 200, medium: 500, high: 900 };
const SENSITIVE: ReadonlySet<string> = new Set(['pii', 'credentials', 'financial_data', 'health_data', 'children_data']);

/**
 * The default policy: risk is the impact's score (low 200, medium 500, high 900) plus 150 per
 * sensitive data class, capped at 1000; below 500 approve, below 800 escalate, else block.
 */
export function defaultPolicy(intent: IntentV2): PolicyVerdict {
  const sensitive = intent.data_classes.filter((d) => SENSITIVE.has(d)).length;
  const risk = Math.min(1000, IMPACT_RISK[intent.estimated_impact] + 150 * sensitive);
  if (risk >= 800) return { decision: 'block', risk_score: risk, reasons: ['risk_score >= 800'] };
  if (risk >= 500) return { decision: 'escalate', risk_score: risk, reasons: ['risk_score >= 500: human confirmation required'] };
  return { decision: 'approve', risk_score: risk, reasons: ['risk_score < 500'] };
}

const DEFAULT_POLICY_HASH = `sha256:${sha256Hex(
  new TextEncoder().encode('dcp-ai/anthropic-mcp defaultPolicy v1: impact 200/500/900 + 150 per sensitive class; approve < 500, escalate < 800, block >= 800'),
)}`;

/** JSON text with keys sorted at every depth: the bytes `hashEvidence` hashes. Unlike the canonical profile it keeps any JSON number. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value)) ?? 'null';
}

/** `sha256:<hex>` over `stableJson(value)`. */
export function hashEvidence(value: unknown): string {
  return `sha256:${sha256Hex(new TextEncoder().encode(stableJson(value)))}`;
}

function defaultRegistry(): AlgorithmRegistry {
  registerDefaultProviders();
  return getDefaultRegistry();
}

async function sign<T extends object>(registry: AlgorithmRegistry, context: (typeof DCP_CONTEXTS)[keyof typeof DCP_CONTEXTS], payload: T, keys: CompositeKeyPair): Promise<SignedPayload<T>> {
  const prepared = preparePayload(payload);
  const composite_sig = await compositeSign(registry, context, prepared.canonicalBytes, keys);
  return { payload, payload_hash: prepared.payloadHash, composite_sig };
}

export interface CreateIdentityParams {
  /** The responsible human or organization (`human_id`); default `rpr:<uuid>`. */
  humanId?: string;
  legalName: string;
  entityType?: 'natural_person' | 'organization';
  jurisdiction: string;
  /** Default `agent:<uuid>`. */
  agentId?: string;
  capabilities?: string[];
  riskTier?: 'low' | 'medium' | 'high';
  registry?: AlgorithmRegistry;
}

/**
 * A fresh identity for a session: new Ed25519 + ML-DSA-65 keys, a new session nonce,
 * and the RPR and passport signed with them. Production deployments bring their own
 * signed RPR and passport; this is for tests and first runs.
 */
export async function createReceiptIdentity(params: CreateIdentityParams): Promise<DcpReceiptIdentity> {
  const registry = params.registry ?? defaultRegistry();
  const classicalKp = await registry.getSigner('ed25519').generateKeypair();
  const pqKp = await registry.getSigner('ml-dsa-65').generateKeypair();
  const keys: CompositeKeyPair = {
    classical: { kid: classicalKp.kid, alg: 'ed25519', secretKeyB64: classicalKp.secretKeyB64, publicKeyB64: classicalKp.publicKeyB64 },
    pq: { kid: pqKp.kid, alg: 'ml-dsa-65', secretKeyB64: pqKp.secretKeyB64, publicKeyB64: pqKp.publicKeyB64 },
  };
  const now = new Date().toISOString();
  const keyEntries: KeyEntry[] = [keys.classical, keys.pq].map((k) => ({
    kid: k.kid,
    alg: k.alg as KeyEntry['alg'],
    public_key_b64: k.publicKeyB64,
    created_at: now,
    expires_at: null,
    status: 'active',
  }));
  const sessionNonce = generateSessionNonce();
  const humanId = params.humanId ?? `rpr:${crypto.randomUUID()}`;
  const agentId = params.agentId ?? `agent:${crypto.randomUUID()}`;
  const rpr: ResponsiblePrincipalRecordV2 = {
    dcp_version: '2.0',
    human_id: humanId,
    session_nonce: sessionNonce,
    legal_name: params.legalName,
    entity_type: params.entityType ?? 'natural_person',
    jurisdiction: params.jurisdiction,
    liability_mode: 'owner_responsible',
    override_rights: true,
    issued_at: now,
    expires_at: null,
    contact: null,
    binding_keys: keyEntries,
  };
  const passport: AgentPassportV2 = {
    dcp_version: '2.0',
    agent_id: agentId,
    session_nonce: sessionNonce,
    keys: keyEntries,
    principal_binding_reference: humanId,
    capabilities: (params.capabilities ?? ['api_call']) as AgentPassportV2['capabilities'],
    risk_tier: params.riskTier ?? 'medium',
    created_at: now,
    status: 'active',
  };
  return {
    sessionNonce,
    keys,
    signedRpr: await sign(registry, DCP_CONTEXTS.ResponsiblePrincipal, rpr, keys),
    signedPassport: await sign(registry, DCP_CONTEXTS.AgentPassport, passport, keys),
  };
}

/**
 * Wrap an MCP tool handler so every call returns a signed receipt in `_meta.dcp_receipt`.
 *
 * Before the tool runs, the call is classified into an Intent and composite-signed, and the
 * policy decides. An approved call runs and its arguments and result are hashed into the
 * audit entry (`outcome: "completed"`). An escalated or blocked call does not run and the
 * wrapper returns an `isError` result instead (`outcome: "escalated"` / `"blocked"`), so the
 * refusal is evidence too. A handler that throws yields an `isError` result with
 * `outcome: "failed"`. The receipt is a V2 signed bundle with one audit entry, verifiable
 * on its own; `receipt.bundle.audit_entries[0].evidence` holds `tool`, `result_ref` (the
 * result's hash) and `evidence_hash` (the hash of `{ arguments, result }`).
 */
export function withDcpReceipt<A, R>(
  toolName: string,
  handler: (args: A, extra?: unknown) => Promise<R> | R,
  options: DcpReceiptOptions,
): (args: A, extra?: unknown) => Promise<WithDcpReceipt<R>> {
  const registry = options.registry ?? defaultRegistry();
  const { identity } = options;
  const decide = options.decide ?? defaultPolicy;
  const appliedPolicyHash = options.appliedPolicyHash ?? DEFAULT_POLICY_HASH;
  const agentId = identity.signedPassport.payload.agent_id;
  const humanId = identity.signedRpr.payload.human_id;

  return async (args: A, extra?: unknown) => {
    const now = new Date().toISOString();
    const c = options.classify?.(toolName, args) ?? {};
    const impact = c.estimated_impact ?? 'low';
    const intentId = `intent:${crypto.randomUUID()}`;
    const draft: IntentV2 = {
      dcp_version: '2.0',
      intent_id: intentId,
      session_nonce: identity.sessionNonce,
      agent_id: agentId,
      human_id: humanId,
      timestamp: now,
      action_type: c.action_type ?? 'api_call',
      target: { channel: c.channel ?? 'api', to: toolName },
      data_classes: c.data_classes ?? ['none'],
      estimated_impact: impact,
      requires_consent: c.requires_consent ?? impact === 'high',
    };
    const verdict = decide(draft);
    const tier = computeTier(draft, { risk_score: verdict.risk_score });
    const intent: IntentV2 = { ...draft, security_tier: tier };
    const signedIntent = await sign(registry, DCP_CONTEXTS.Intent, intent, identity.keys);

    const policy: PolicyDecisionV2 = {
      dcp_version: '2.0',
      intent_id: intentId,
      session_nonce: identity.sessionNonce,
      decision: verdict.decision,
      risk_score: verdict.risk_score,
      reasons: verdict.reasons,
      required_confirmation:
        verdict.decision === 'approve' ? null : { type: 'human_approve', fields: ['action_type', 'target', 'estimated_impact'] },
      applied_policy_hash: appliedPolicyHash,
      timestamp: now,
      resolved_tier: tier,
    };
    const signedPolicy = await sign(registry, DCP_CONTEXTS.PolicyDecision, policy, identity.keys);

    // Run the tool only on approval; a refusal or a failure is still a receipt.
    let result: unknown = null;
    let outcome: string;
    let response: R | DcpReceiptResult;
    if (verdict.decision !== 'approve') {
      outcome = verdict.decision === 'block' ? 'blocked' : 'escalated';
      response = { content: [{ type: 'text', text: `DCP policy ${outcome} the call to ${toolName}: ${verdict.reasons.join('; ')}` }], isError: true };
    } else {
      try {
        result = await handler(args, extra);
        outcome = 'completed';
        response = result as R;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result = { error: message };
        outcome = 'failed';
        response = { content: [{ type: 'text', text: `${toolName} failed: ${message}` }], isError: true };
      }
    }

    const entry: AuditEventV2 = {
      dcp_version: '2.0',
      audit_id: `audit:${crypto.randomUUID()}`,
      session_nonce: identity.sessionNonce,
      prev_hash: 'GENESIS',
      hash_alg: 'sha256',
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      human_id: humanId,
      intent_id: intentId,
      intent_hash: `sha256:${sha256Hex(new TextEncoder().encode(canonicalizeV2(intent)))}`,
      policy_decision: verdict.decision === 'approve' ? 'approved' : verdict.decision === 'escalate' ? 'escalated' : 'blocked',
      outcome,
      evidence: {
        tool: toolName,
        result_ref: outcome === 'completed' ? hashEvidence(result) : null,
        evidence_hash: hashEvidence({ arguments: args, result }),
      },
      pq_checkpoint_ref: null,
    };

    const bundle = new BundleBuilderV2(identity.sessionNonce)
      .responsiblePrincipalRecord(identity.signedRpr)
      .agentPassport(identity.signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntry(entry)
      .build();
    const receipt = await signBundleV2(bundle, { registry, signerType: 'human', signerId: humanId, keys: identity.keys });

    const base = (response !== null && typeof response === 'object' ? response : { content: [{ type: 'text', text: String(response) }] }) as object;
    const meta = (base as { _meta?: Record<string, unknown> })._meta ?? {};
    return { ...base, _meta: { ...meta, dcp_receipt: receipt } } as WithDcpReceipt<R>;
  };
}

export interface VerifyReceiptOptions {
  registry?: AlgorithmRegistry;
  /** Verifier policy for `verifySignedBundleV2`; default `DEFAULT_VERIFIER_POLICY`. */
  policy?: VerifierPolicy;
  /** When given, the receipt must name this tool. */
  tool?: string;
  /** When given with `result`, the receipt's `evidence_hash` must match these. */
  arguments?: unknown;
  result?: unknown;
}

/**
 * Verify a receipt: the full V2 bundle verification, plus that it has exactly one audit entry
 * and, when asked, that it names `tool` and that its `evidence_hash` is the hash of the given
 * `arguments` and `result`. Returns the verifier's result with any extra errors appended.
 */
export async function verifyDcpReceipt(receipt: SignedBundleV2, options: VerifyReceiptOptions = {}) {
  const registry = options.registry ?? defaultRegistry();
  const result = await verifySignedBundleV2(receipt, registry, options.policy ?? DEFAULT_VERIFIER_POLICY);
  const errors = [...result.errors];
  const entries = receipt?.bundle?.audit_entries;
  const entry = Array.isArray(entries) && entries.length === 1 ? entries[0] : undefined;
  if (!entry) errors.push('a receipt carries exactly one audit entry');
  if (entry && options.tool !== undefined && entry.evidence?.tool !== options.tool) {
    errors.push(`receipt names tool ${String(entry.evidence?.tool)}, expected ${options.tool}`);
  }
  if (entry && 'arguments' in options && 'result' in options) {
    const expected = hashEvidence({ arguments: options.arguments, result: options.result });
    if (entry.evidence?.evidence_hash !== expected) errors.push('evidence_hash does not match the given arguments and result');
  }
  return { ...result, verified: result.verified && errors.length === 0, errors };
}
