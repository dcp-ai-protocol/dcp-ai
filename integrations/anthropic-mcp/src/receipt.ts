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
  maxTier,
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
  type SecurityTier,
} from '@dcp-ai/sdk';

type Channel = IntentV2['target']['channel'];
type VerifierPolicy = Parameters<typeof verifySignedBundleV2>[2];
// @dcp-ai/sdk releases after 2.1.2 read risk_score from the policy decision (spec §14.2);
// earlier ones ignore the second argument.
const computeTier = computeSecurityTier as (intent: IntentV2, policyDecision?: Pick<PolicyDecisionV2, 'risk_score'>) => SecurityTier;

/** The tier a risk score alone implies (spec §14.2: 200 standard, 500 elevated, 800 maximum); the same on every SDK version. */
function riskTier(risk: number): SecurityTier {
  return risk >= 800 ? 'maximum' : risk >= 500 ? 'elevated' : risk >= 200 ? 'standard' : 'routine';
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PASSPORT_CAPABILITIES: ReadonlySet<string> = new Set(['browse', 'api_call', 'email', 'calendar', 'payments', 'crm', 'file_write', 'code_exec']);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  /** `applied_policy_hash` of the decisions, `sha256:<64 hex>`; default: the hash of `defaultPolicy`'s rules. */
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

/** The result as the caller sees it, minus `_meta` (transport metadata, where the receipt itself travels): what the receipt hashes. */
export function resultSeen<T>(result: T): Omit<T, '_meta'> {
  if (!isObject(result)) return result as Omit<T, '_meta'>;
  const { _meta: _ignored, ...seen } = result;
  return seen as Omit<T, '_meta'>;
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
  const capabilities = params.capabilities ?? ['api_call'];
  const unknown = capabilities.filter((c) => !PASSPORT_CAPABILITIES.has(c));
  if (unknown.length > 0) throw new Error(`capabilities not in the passport schema: ${unknown.join(', ')} (allowed: ${[...PASSPORT_CAPABILITIES].join(', ')})`);
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
    capabilities: capabilities as AgentPassportV2['capabilities'],
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
 * policy decides. An approved call runs (`outcome: "completed"`). An escalated or blocked call
 * does not run and the wrapper returns an `isError` result instead (`outcome: "escalated"` /
 * `"blocked"`), so the refusal is evidence too. A handler that throws yields an `isError`
 * result with `outcome: "failed"`. The receipt is a V2 signed bundle with one audit entry,
 * verifiable on its own; `receipt.bundle.audit_entries[0].evidence` holds `tool`,
 * `result_ref` (the hash of the result when the tool ran, else null), `evidence_hash` (the
 * hash of `{ arguments, result }`) and, when the MCP `extra` carries one, `request_id`.
 * `arguments` are hashed as received, before the handler can touch them; `result` is what the
 * wrapper returns minus `_meta` (see `resultSeen`), whatever the outcome.
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
  if (!SHA256_PATTERN.test(appliedPolicyHash)) throw new Error('appliedPolicyHash must be sha256:<64 hex digits>');
  const agentId = identity.signedPassport.payload.agent_id;
  const humanId = identity.signedRpr.payload.human_id;

  return async (args: A, extra?: unknown) => {
    const now = new Date().toISOString();
    // The arguments as received, as JSON (what travelled on the wire: a Date is its string, a function
    // or an AbortSignal is dropped): a handler that mutates them must not change what the receipt attests.
    const argumentsJson = JSON.stringify(args);
    const argumentsSeen: unknown = argumentsJson === undefined ? undefined : JSON.parse(argumentsJson);
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
    // The SDK's tier from the intent, never below what the risk score implies (the published
    // 2.1.x SDK reads no risk score; 2.2.0 does; both end here with the same tier).
    const tier = maxTier(computeTier(draft, { risk_score: verdict.risk_score }), riskTier(verdict.risk_score));
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
    let outcome: string;
    let response: unknown;
    let ran = false;
    if (verdict.decision !== 'approve') {
      outcome = verdict.decision === 'block' ? 'blocked' : 'escalated';
      response = { content: [{ type: 'text', text: `DCP policy ${outcome} the call to ${toolName}: ${verdict.reasons.join('; ')}` }], isError: true };
    } else {
      ran = true;
      try {
        response = await handler(args, extra);
        outcome = 'completed';
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        outcome = 'failed';
        response = { content: [{ type: 'text', text: `${toolName} failed: ${message}` }], isError: true };
      }
    }
    // What the caller gets back: an MCP result object; a bare value becomes a text content.
    const base: Record<string, unknown> = isObject(response)
      ? response
      : { content: response == null ? [] : [{ type: 'text', text: String(response) }] };
    const result = resultSeen(base);
    const requestId = isObject(extra) && extra.requestId !== undefined ? String(extra.requestId) : undefined;

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
        result_ref: ran ? hashEvidence(result) : null,
        evidence_hash: hashEvidence({ arguments: argumentsSeen, result }),
        ...(requestId !== undefined ? { request_id: requestId } : {}),
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

    const meta = isObject(base._meta) ? base._meta : {};
    return { ...base, _meta: { ...meta, dcp_receipt: receipt } } as WithDcpReceipt<R>;
  };
}

export interface VerifyReceiptOptions {
  registry?: AlgorithmRegistry;
  /** Verifier policy for `verifySignedBundleV2`; default `DEFAULT_VERIFIER_POLICY`. */
  policy?: VerifierPolicy;
  /** When given, the receipt must name this tool. */
  tool?: string;
  /** When given, the receipt's `evidence.request_id` must equal it (the MCP request id the wrapper saw in `extra`). */
  requestId?: string | number;
  /**
   * The trust anchor: keys the verifier already trusts for this agent and its principal (from a
   * registry, a pinned earlier passport or RPR). When given, every signature in the receipt (the
   * bundle's, the RPR's, the passport's, the intent's and the policy decision's) must be made with a
   * key that is among them, with the same `kid`, `alg` and `public_key_b64`, and that is `active`
   * and unexpired in this list. Without it the receipt is only self-consistent: signed with the
   * keys its own passport and RPR list.
   */
  trustedKeys?: KeyEntry[];
  /** The agent the receipt must be from (`agent_passport.payload.agent_id`). */
  expectedAgentId?: string;
  /** The principal the receipt must be under (`responsible_principal_record.payload.human_id`). */
  expectedHumanId?: string;
  /**
   * Given together, the receipt's `evidence_hash` must be the hash of `{ arguments, result }`,
   * where `result` is what the caller received minus `_meta` (`resultSeen`). One without the
   * other is an error.
   */
  arguments?: unknown;
  result?: unknown;
}

/**
 * Verify a receipt: the full V2 bundle verification, plus that it has exactly one audit entry
 * and, when asked, that it names `tool` and that its `evidence_hash` is the hash of the given
 * `arguments` and `result`. Returns the verifier's result with any extra errors appended.
 */
export async function verifyDcpReceipt(receipt: SignedBundleV2, options: VerifyReceiptOptions = {}) {
  const wantAnchor = options.trustedKeys !== undefined;
  const invalid = (error: string) => ({ verified: false, anchored: false, errors: [error], warnings: [] as string[] });
  if (!isSignedBundleShape(receipt)) return invalid('not a signed bundle: bundle, signature and bundle.audit_entries (array) are required');
  if (wantAnchor && !Array.isArray(options.trustedKeys)) return invalid('trustedKeys must be an array of key entries');
  const registry = options.registry ?? defaultRegistry();
  let result: Awaited<ReturnType<typeof verifySignedBundleV2>>;
  try {
    result = await verifySignedBundleV2(receipt, registry, options.policy ?? DEFAULT_VERIFIER_POLICY);
  } catch (e) {
    // The published SDK throws on some malformed bundles (a null composite_sig, a null artifact) instead of failing closed.
    return invalid(`bundle verification error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const errors = [...result.errors];
  const passport = receipt.bundle.agent_passport?.payload as { agent_id?: unknown; keys?: unknown } | undefined;
  const rpr = receipt.bundle.responsible_principal_record?.payload as { human_id?: unknown; binding_keys?: unknown } | undefined;
  if (options.expectedAgentId !== undefined && passport?.agent_id !== options.expectedAgentId) {
    errors.push(`receipt is from agent ${String(passport?.agent_id)}, expected ${options.expectedAgentId}`);
  }
  if (options.expectedHumanId !== undefined && rpr?.human_id !== options.expectedHumanId) {
    errors.push(`receipt is under principal ${String(rpr?.human_id)}, expected ${options.expectedHumanId}`);
  }
  const anchorErrs = wantAnchor ? anchorErrors(receipt, asKeys(passport?.keys), asKeys(rpr?.binding_keys), options.trustedKeys as KeyEntry[]) : [];
  errors.push(...anchorErrs);
  const anchored = wantAnchor && anchorErrs.length === 0;
  const entries = receipt.bundle.audit_entries;
  const entry = entries.length === 1 && isObject(entries[0]) ? entries[0] : undefined;
  if (!entry) errors.push('a receipt carries exactly one audit entry');
  const evidence = isObject(entry?.evidence) ? entry.evidence : {};
  if (entry && options.tool !== undefined && evidence.tool !== options.tool) {
    errors.push(`receipt names tool ${String(evidence.tool)}, expected ${options.tool}`);
  }
  if (entry && options.requestId !== undefined && evidence.request_id !== String(options.requestId)) {
    errors.push(`receipt is for request ${String(evidence.request_id)}, expected ${String(options.requestId)}`);
  }
  const hasArgs = 'arguments' in options;
  const hasResult = 'result' in options;
  if (hasArgs !== hasResult) errors.push('arguments and result must be given together to check the evidence_hash');
  if (entry && hasArgs && hasResult) {
    const expected = hashEvidence({ arguments: options.arguments, result: options.result });
    if (evidence.evidence_hash !== expected) errors.push('evidence_hash does not match the given arguments and result');
  }
  return { ...result, anchored, verified: result.verified && errors.length === 0, errors };
}

const asKeys = (v: unknown): KeyEntry[] => (Array.isArray(v) ? (v.filter(isObject) as unknown as KeyEntry[]) : []);

/**
 * Every signature slot of a receipt with the key list the SDK verifier resolves it against (the
 * RPR against the RPR binding keys, the agent's artifacts against the passport keys, the bundle
 * against both, passport keys first), classical and pq.
 */
function signatureSlots(receipt: SignedBundleV2, passportKeys: KeyEntry[], rprKeys: KeyEntry[]): Array<{ where: string; kid: unknown; alg: unknown; keys: KeyEntry[] }> {
  const out: Array<{ where: string; kid: unknown; alg: unknown; keys: KeyEntry[] }> = [];
  const add = (where: string, sig: unknown, keys: KeyEntry[]) => {
    if (!isObject(sig)) return out.push({ where, kid: undefined, alg: undefined, keys });
    for (const slot of ['classical', 'pq'] as const) {
      const s = sig[slot];
      if (s === null && slot === 'pq') continue;
      out.push(isObject(s) ? { where: `${where}.${slot}`, kid: s.kid, alg: s.alg, keys } : { where: `${where}.${slot}`, kid: undefined, alg: undefined, keys });
    }
  };
  const artifact = (name: keyof SignedBundleV2['bundle']) => (receipt.bundle[name] as { composite_sig?: unknown } | undefined)?.composite_sig;
  add('signature', receipt.signature?.composite_sig, [...passportKeys, ...rprKeys]);
  add('responsible_principal_record', artifact('responsible_principal_record'), rprKeys);
  for (const name of ['agent_passport', 'intent', 'policy_decision'] as const) add(name, artifact(name), passportKeys);
  return out;
}

/**
 * Why the receipt's signatures are not all made with trusted keys. Each signing key is resolved
 * exactly as the SDK verifier resolves it (the first listed key with the slot's kid, in the list
 * for that artifact), so the key that is anchored is the key whose public key verified the
 * signature; it must then carry the slot's algorithm and match a trusted entry by kid, alg and
 * public key, and every matching trusted entry must be active and unexpired now. A kid listed
 * twice with different keys is not comparable.
 */
function anchorErrors(receipt: SignedBundleV2, passportKeys: KeyEntry[], rprKeys: KeyEntry[], trusted: KeyEntry[]): string[] {
  const errors: string[] = [];
  const nowMs = Date.now();
  for (const slot of signatureSlots(receipt, passportKeys, rprKeys)) {
    // ponytail: resolution mirrors the SDK's findKeyByKid; if the SDK ever changes it, change this with it.
    if (typeof slot.kid !== 'string' || typeof slot.alg !== 'string') {
      errors.push(`${slot.where}: signature slot without kid or alg`);
      continue;
    }
    const matches = slot.keys.filter((k) => k.kid === slot.kid);
    if (matches.length === 0) {
      errors.push(`${slot.where}: key ${slot.kid} is not listed by the receipt`);
      continue;
    }
    // The same entry may appear in both the passport and the RPR (one key pair for both roles);
    // two different keys under one kid are not comparable.
    const key = matches[0];
    if (matches.some((k) => k.alg !== key.alg || k.public_key_b64 !== key.public_key_b64)) {
      errors.push(`${slot.where}: kid ${slot.kid} is listed more than once with different keys`);
      continue;
    }
    if (key.alg !== slot.alg) {
      errors.push(`${slot.where}: key ${slot.kid} is ${String(key.alg)}, signature says ${slot.alg}`);
      continue;
    }
    const anchors = trusted.filter((t) => isObject(t) && t.kid === key.kid && t.alg === key.alg && t.public_key_b64 === key.public_key_b64);
    if (anchors.length === 0) {
      errors.push(`${slot.where}: key ${slot.kid} is not among the trusted keys`);
      continue;
    }
    for (const a of anchors) {
      if (a.status !== 'active') errors.push(`${slot.where}: trusted key ${slot.kid} is ${String(a.status)}`);
      else if (a.expires_at !== null && a.expires_at !== undefined) {
        const expires = Date.parse(String(a.expires_at));
        if (Number.isNaN(expires)) errors.push(`${slot.where}: trusted key ${slot.kid} has an invalid expires_at`);
        else if (expires < nowMs) errors.push(`${slot.where}: trusted key ${slot.kid} has expired`);
      }
    }
  }
  return errors;
}

/** The shape `verifySignedBundleV2` of the published SDK assumes before it reads anything; without it the SDK throws instead of failing closed. */
export function isSignedBundleShape(v: unknown): v is SignedBundleV2 & { bundle: { audit_entries: unknown[] } } {
  return (
    isObject(v) && isObject(v.bundle) && isObject(v.signature) && Array.isArray(v.bundle.audit_entries) &&
    (v.bundle.pq_checkpoints === undefined || Array.isArray(v.bundle.pq_checkpoints))
  );
}
