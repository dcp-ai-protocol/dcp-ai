/**
 * DCP bundle verification on top of the published @dcp-ai/sdk 2.1.x. The same file is
 * integrations/express/src/dcp-verify.ts and integrations/openclaw/src/tools/dcp-verify.ts;
 * keep them identical.
 *
 * The verdict on a V2 bundle comes from verifySignedBundleV2. This module adds only what
 * SDK 2.1.x skips and an integration can check without re-implementing the verifier
 * (VERIFICATION.md steps):
 *  - V2-9/V2-10: the verification mode is the stricter of the policy mode for the passport's
 *    risk_tier (own properties of risk_overrides only; 2.1.x follows the prototype chain, so a
 *    risk_tier of "constructor" disabled every signature check) and the mode of the security
 *    tier of the intent and policy decision (2.1.x ignores the tier);
 *  - V2-3: the Merkle root of an empty audit trail is 64 zeros;
 *  - V2-4: session_expires_at, when present, is an RFC 3339 timestamp;
 *  - V2-13: passport keys and RPR binding keys are not revoked or expired, and their expires_at,
 *    when present, is an RFC 3339 timestamp in the future;
 *  - V2-7: a PQ signature that is present verifies.
 * Still unchecked with 2.1.x: the per-artifact signatures (V2-8). Drop each addition once the
 * packages depend on an SDK release that checks it.
 */
import {
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  verifySignedBundleV2,
  type SignedBundleV2,
  type VerificationMode,
  type VerifierPolicy,
} from '@dcp-ai/sdk';

export type RiskTier = keyof VerifierPolicy['risk_overrides'];
export type SecurityTier = 'routine' | 'standard' | 'elevated' | 'maximum';

/** Verifier policy fields to set over a base policy. */
export type VerifierPolicyOptions = Partial<Omit<VerifierPolicy, 'risk_overrides'>> & {
  risk_overrides?: Partial<VerifierPolicy['risk_overrides']>;
};

export interface V2Verdict {
  verified: boolean;
  errors: string[];
  warnings: string[];
  /** The mode the bundle was verified in, once it could be resolved. */
  verificationMode?: VerificationMode;
  /** The security tier of the bundle's intent and policy decision (spec §14.2). */
  securityTier?: SecurityTier;
}

export const VERIFICATION_MODES: readonly VerificationMode[] = ['classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];
export const RISK_TIERS: readonly RiskTier[] = ['low', 'medium', 'high'];
const SIGNED_ARTIFACTS = ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'] as const;
const EMPTY_TRAIL_ROOT = `sha256:${'0'.repeat(64)}`;

// Built once: the providers the V2 verifier needs (Ed25519, ML-DSA-65, SLH-DSA-192f).
const registry = new AlgorithmRegistry();
for (const provider of [new Ed25519Provider(), new MlDsa65Provider(), new SlhDsa192fProvider()]) {
  registry.registerSigner(provider);
}

export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short printable form of an untrusted value (never recurses into it). */
export function printable(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value.slice(0, 80)) : typeof value === 'object' ? (value === null ? 'null' : 'an object') : String(value);
}

// ── Verifier policy ──

const isMode = (value: unknown): value is VerificationMode =>
  typeof value === 'string' && (VERIFICATION_MODES as readonly string[]).includes(value);
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
const isStringList = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isBoolean = (value: unknown) => typeof value === 'boolean';

const POLICY_FIELDS: Record<string, (value: unknown) => boolean> = {
  default_mode: isMode,
  risk_overrides: (value) =>
    isObject(value) &&
    Object.entries(value).every(([tier, mode]) => (RISK_TIERS as readonly string[]).includes(tier) && (mode === undefined || isMode(mode))),
  min_classical: isCount,
  min_pq: isCount,
  max_key_age_days: isCount,
  max_session_duration_seconds: isCount,
  accepted_classical_algs: isStringList,
  accepted_pq_algs: isStringList,
  accepted_hash_algs: isStringList,
  advisory_rejected_algs: isStringList,
  require_session_binding: isBoolean,
  require_composite_binding: isBoolean,
  allow_v1_bundles: isBoolean,
  allow_classical_fallback_disable: isBoolean,
  warn_classical_only_deprecated: isBoolean,
  require_session_expiry: isBoolean,
  require_audience_binding: isBoolean,
  verifier_id: (value) => typeof value === 'string',
};

/**
 * The fields of a configured verifier policy. An unknown field or a value of the wrong type
 * throws; a field set to undefined is left out. `allowed` limits the accepted fields.
 */
export function checkPolicyFields(configured: unknown, label: string, allowed?: readonly string[]): VerifierPolicyOptions {
  if (configured === undefined || configured === null) return {};
  if (!isObject(configured)) throw new TypeError(`${label} must be an object`);
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(configured)) {
    if (value === undefined) continue;
    if (!Object.hasOwn(POLICY_FIELDS, key) || (allowed && !allowed.includes(key))) {
      throw new Error(`Unknown ${label} field: ${key}`);
    }
    if (!POLICY_FIELDS[key](value)) throw new TypeError(`${label}.${key} has an invalid value: ${printable(value)}`);
    fields[key] =
      key === 'risk_overrides'
        ? Object.fromEntries(Object.entries(value as object).filter(([, mode]) => mode !== undefined))
        : value;
  }
  return fields as VerifierPolicyOptions;
}

export function allTiers(mode: VerificationMode): VerifierPolicy['risk_overrides'] {
  return { low: mode, medium: mode, high: mode };
}

const MODE_RANK: Record<VerificationMode, number> = { classical_only: 0, hybrid_preferred: 1, hybrid_required: 2, pq_only: 3 };

/** The stricter of two modes; pq_only counts as the strictest (spec §14.3: a pq_only policy stays pq_only). */
export function stricterMode(a: VerificationMode, b: VerificationMode): VerificationMode {
  return MODE_RANK[a] >= MODE_RANK[b] ? a : b;
}

/**
 * `configured` (checked by checkPolicyFields) over `base`, by default the SDK's
 * DEFAULT_VERIFIER_POLICY. A default_mode given without risk_overrides applies to every risk
 * tier; risk_overrides entries set their tiers over the others. `requireHybrid` raises every
 * mode below hybrid_required to hybrid_required.
 */
export function resolveVerifierPolicy(
  configured: unknown,
  { requireHybrid = false, label = 'verifierPolicy' }: { requireHybrid?: boolean; label?: string } = {},
): VerifierPolicy {
  const fields = checkPolicyFields(configured, label);
  const tierModes = fields.default_mode ? allTiers(fields.default_mode) : DEFAULT_VERIFIER_POLICY.risk_overrides;
  const policy: VerifierPolicy = {
    ...DEFAULT_VERIFIER_POLICY,
    ...fields,
    risk_overrides: { ...tierModes, ...fields.risk_overrides } as VerifierPolicy['risk_overrides'],
  };
  if (requireHybrid) {
    policy.default_mode = stricterMode(policy.default_mode, 'hybrid_required');
    for (const tier of RISK_TIERS) policy.risk_overrides[tier] = stricterMode(policy.risk_overrides[tier], 'hybrid_required');
  }
  return policy;
}

/** The policy mode for a passport risk tier: low, medium or high, own properties of risk_overrides only. */
export function policyModeFor(policy: VerifierPolicy, riskTier: unknown): VerificationMode | undefined {
  if (typeof riskTier !== 'string' || !(RISK_TIERS as readonly string[]).includes(riskTier)) return undefined;
  if (!Object.hasOwn(policy.risk_overrides, riskTier)) return undefined;
  const mode = policy.risk_overrides[riskTier as RiskTier];
  return isMode(mode) ? mode : undefined;
}

// ── Security tier (spec §14.2) ──

const ACTION_TYPES: ReadonlySet<unknown> = new Set([
  'browse', 'api_call', 'send_email', 'create_calendar_event', 'initiate_payment', 'update_crm', 'write_file', 'execute_code',
]);
const DATA_CLASSES: ReadonlySet<unknown> = new Set([
  'none', 'contact_info', 'pii', 'credentials', 'financial_data', 'health_data', 'children_data', 'company_confidential',
]);
const IMPACTS: ReadonlySet<unknown> = new Set(['low', 'medium', 'high']);
const MAXIMUM_DATA_CLASSES: ReadonlySet<unknown> = new Set(['credentials', 'children_data']);
const ELEVATED_DATA_CLASSES: ReadonlySet<unknown> = new Set(['pii', 'financial_data', 'health_data']);
const TIER_RANK: Record<SecurityTier, number> = { routine: 0, standard: 1, elevated: 2, maximum: 3 };
const TIER_MODE: Record<SecurityTier, VerificationMode> = {
  routine: 'classical_only',
  standard: 'hybrid_preferred',
  elevated: 'hybrid_required',
  maximum: 'hybrid_required',
};

function knownTier(tier: unknown): SecurityTier {
  return typeof tier === 'string' && Object.hasOwn(TIER_RANK, tier) ? (tier as SecurityTier) : 'elevated';
}

/**
 * The security tier of an intent and its policy decision, as spec §14.2 and the SDK releases
 * after 2.1.2 compute it (2.1.x reads risk_score from the intent and has neither fail-closed
 * rule): risk_score comes from the policy decision only and must be an integer from 0 to 1000
 * (no policy decision counts as 0); a missing or unknown action_type, estimated_impact,
 * data_classes or risk_score fails closed to at least elevated; intent.security_tier can only
 * raise the tier, and an unknown one counts as elevated.
 */
export function computeSecurityTier(intent: unknown, policyDecision?: unknown): SecurityTier {
  const raw = isObject(intent) ? intent : {};
  const riskScore = policyDecision === undefined || policyDecision === null ? 0 : isObject(policyDecision) ? policyDecision.risk_score : undefined;
  const scoreKnown = Number.isInteger(riskScore) && (riskScore as number) >= 0 && (riskScore as number) <= 1000;
  const score = scoreKnown ? (riskScore as number) : 0;
  const dataClasses: unknown[] = Array.isArray(raw.data_classes) ? raw.data_classes : [undefined];
  const unknownValue =
    !scoreKnown || !ACTION_TYPES.has(raw.action_type) || !IMPACTS.has(raw.estimated_impact) || dataClasses.some((d) => !DATA_CLASSES.has(d));

  let tier: SecurityTier;
  if (score >= 800 || dataClasses.some((d) => MAXIMUM_DATA_CLASSES.has(d))) {
    tier = 'maximum';
  } else if (
    score >= 500 ||
    unknownValue ||
    dataClasses.some((d) => ELEVATED_DATA_CLASSES.has(d)) ||
    raw.action_type === 'initiate_payment' ||
    raw.estimated_impact === 'high'
  ) {
    tier = 'elevated';
  } else if (score >= 200 || raw.estimated_impact === 'medium') {
    tier = 'standard';
  } else {
    tier = 'routine';
  }
  if (raw.security_tier !== undefined && raw.security_tier !== null) {
    const explicit = knownTier(raw.security_tier);
    if (TIER_RANK[explicit] > TIER_RANK[tier]) tier = explicit;
  }
  return tier;
}

/** The mode a verifier enforces (spec §14.3): the stricter of the policy mode and the tier's mode; pq_only stays pq_only. */
export function effectiveMode(policyMode: VerificationMode, tier: SecurityTier): VerificationMode {
  return policyMode === 'pq_only' ? 'pq_only' : stricterMode(policyMode, TIER_MODE[tier]);
}

/** "2.0" when bundle.dcp_bundle_version is "2.0", "1.0" when bundle.responsible_principal_record.dcp_version is "1.0", else null. */
export function detectVersion(signedBundle: unknown): '1.0' | '2.0' | null {
  const bundle = isObject(signedBundle) ? signedBundle.bundle : undefined;
  if (!isObject(bundle)) return null;
  if (bundle.dcp_bundle_version === '2.0') return '2.0';
  if (isObject(bundle.responsible_principal_record) && bundle.responsible_principal_record.dcp_version === '1.0') return '1.0';
  return null;
}

// ── V1 ──

/**
 * Why a V1 bundle is refused under `policy`, or null. A V1 bundle has one Ed25519 signature
 * and no post-quantum one, so it passes only where VERIFICATION.md V2-10 would accept a
 * classical-only bundle: allow_v1_bundles is true, requireHybrid is off, and the stricter of the
 * policy mode for the passport's risk_tier (default_mode when it has none) and the mode of the
 * security tier of the V1 intent and policy decision is classical_only or hybrid_preferred. V1
 * risk_score is 0 to 1: it is scaled by 1000 and rounded, and a missing or invalid one fails
 * closed to elevated.
 */
export function v1Refusal(policy: VerifierPolicy, requireHybrid: boolean, bundle: unknown): string | null {
  if (!policy.allow_v1_bundles) return 'V1 bundles are not accepted: verifier policy allow_v1_bundles is false';
  if (requireHybrid) return 'V1 bundles are not accepted: requireHybrid needs a post-quantum signature';
  const b = isObject(bundle) ? bundle : {};
  const riskTier = isObject(b.agent_passport) ? b.agent_passport.risk_tier : undefined;
  const policyMode = riskTier === undefined ? policy.default_mode : policyModeFor(policy, riskTier);
  if (!policyMode) return `V1 bundles are not accepted: agent_passport risk_tier ${printable(riskTier)} is not low, medium or high`;
  const v1Score = isObject(b.policy_decision) ? b.policy_decision.risk_score : undefined;
  const riskScore = typeof v1Score === 'number' && v1Score >= 0 && v1Score <= 1 ? Math.round(v1Score * 1000) : undefined;
  const tier = computeSecurityTier(b.intent, { risk_score: riskScore });
  const mode = effectiveMode(policyMode, tier);
  if (mode === 'classical_only' || mode === 'hybrid_preferred') return null;
  return `V1 bundles are not accepted here: the policy requires ${mode} for this bundle (security tier ${tier}), and a V1 bundle has no post-quantum signature`;
}

// ── V2 ──

/**
 * Shape checks that give clearer errors than the SDK's and keep SDK 2.1.x from throwing on a
 * malformed bundle. Never a verdict: an empty list only means the bundle can be verified.
 */
export function v2ShapeErrors(signedBundle: unknown): string[] {
  const { bundle, signature } = isObject(signedBundle) ? signedBundle : ({} as Record<string, any>);
  if (!isObject(bundle) || !isObject(signature)) return ['Missing bundle or signature fields'];

  const errors: string[] = [];
  if (!isObject(bundle.manifest)) {
    errors.push('Missing manifest');
  } else if (typeof bundle.manifest.session_nonce !== 'string' || !/^[0-9a-f]{64}$/.test(bundle.manifest.session_nonce)) {
    errors.push('Invalid or missing session_nonce in manifest');
  }
  for (const name of SIGNED_ARTIFACTS) {
    const artifact = bundle[name];
    if (!isObject(artifact) || !isObject(artifact.payload)) {
      errors.push(`Missing or invalid ${name} (expected SignedPayload)`);
    } else if (!isObject(artifact.composite_sig)) {
      errors.push(`Missing composite_sig in ${name}`);
    }
  }
  if (isObject(bundle.agent_passport?.payload) && !Array.isArray(bundle.agent_passport.payload.keys)) {
    errors.push('Missing agent_passport keys');
  }
  const bindingKeys = bundle.responsible_principal_record?.payload?.binding_keys;
  if (bindingKeys !== undefined && bindingKeys !== null && !Array.isArray(bindingKeys)) {
    errors.push('Invalid responsible_principal_record binding_keys');
  }
  if (!Array.isArray(bundle.audit_entries)) errors.push('Missing or invalid audit_entries');
  if (bundle.pq_checkpoints !== undefined && !Array.isArray(bundle.pq_checkpoints)) {
    errors.push('Invalid pq_checkpoints');
  }
  if (!isObject(signature.composite_sig) || !isObject(signature.composite_sig.classical)) {
    errors.push('Missing composite_sig in bundle signature');
  }
  return errors;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Milliseconds since the epoch of an RFC 3339 timestamp with a Z or ±hh:mm offset, or undefined
 * for anything else (a date without a time, no offset, an impossible date, a non-string).
 */
export function parseRfc3339(value: unknown): number | undefined {
  const m = typeof value === 'string' ? RFC3339.exec(value) : null;
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const [offsetHours, offsetMinutes] = [Number(m[9] ?? 0), Number(m[10] ?? 0)];
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0);
  if (
    month < 1 || month > 12 || day < 1 || day > lastDay.getUTCDate() ||
    hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59
  ) {
    return undefined;
  }
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  t.setUTCHours(hour, minute, second, Number((m[7] ?? '').slice(0, 3).padEnd(3, '0')));
  const offset = (m[8] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  return t.getTime() - offset * 60_000;
}

/** The V2-3, V2-4 and V2-13 checks SDK 2.1.x skips (see the module comment). */
export function localV2Errors(bundle: Record<string, any>, now = Date.now()): string[] {
  const errors: string[] = [];
  const expiresAt = bundle.manifest.session_expires_at;
  if (expiresAt !== undefined && expiresAt !== null && parseRfc3339(expiresAt) === undefined) {
    errors.push(`Invalid session_expires_at: ${printable(expiresAt)}`);
  }
  if (bundle.audit_entries.length === 0 && bundle.manifest.audit_merkle_root !== EMPTY_TRAIL_ROOT) {
    errors.push('Manifest audit_merkle_root of an empty audit trail must be 64 zeros');
  }
  const keys = [
    ...bundle.agent_passport.payload.keys.map((key: unknown) => ['passport', key] as const),
    ...(bundle.responsible_principal_record.payload.binding_keys ?? []).map((key: unknown) => ['RPR binding', key] as const),
  ];
  for (const [owner, key] of keys) {
    if (!isObject(key)) {
      errors.push(`A ${owner} key is not an object`);
      continue;
    }
    const kid = printable(key.kid);
    if (key.status === 'revoked' || key.status === 'expired') errors.push(`${owner} key ${kid} is ${key.status}`);
    if (key.expires_at !== undefined && key.expires_at !== null) {
      const expires = parseRfc3339(key.expires_at);
      if (expires === undefined) errors.push(`${owner} key ${kid} has an invalid expires_at: ${printable(key.expires_at)}`);
      else if (expires < now) errors.push(`${owner} key ${kid} has expired`);
    }
  }
  return errors;
}

/**
 * Verifies a V2 signed bundle under `policy`: shape checks, the effective verification mode,
 * the checks above, then verifySignedBundleV2 with that mode for every risk tier.
 */
export async function verifyV2(signedBundle: unknown, policy: VerifierPolicy): Promise<V2Verdict> {
  const rejected = (errors: string[], context: Partial<V2Verdict> = {}): V2Verdict => ({ verified: false, errors, warnings: [], ...context });
  const shapeErrors = v2ShapeErrors(signedBundle);
  if (shapeErrors.length > 0) return rejected(shapeErrors);
  const { bundle } = signedBundle as Record<string, any>;

  const riskTier = bundle.agent_passport.payload.risk_tier;
  const policyMode = policyModeFor(policy, riskTier);
  if (!policyMode) {
    return rejected([`agent_passport risk_tier ${printable(riskTier)} is not low, medium or high, so no verification mode (classical or PQ) applies`]);
  }
  const securityTier = computeSecurityTier(bundle.intent.payload, bundle.policy_decision.payload);
  const verificationMode = effectiveMode(policyMode, securityTier);
  const context = { verificationMode, securityTier };

  const localErrors = localV2Errors(bundle);
  if (localErrors.length > 0) return rejected(localErrors, context);

  let result: Awaited<ReturnType<typeof verifySignedBundleV2>>;
  try {
    const modePolicy: VerifierPolicy = { ...policy, default_mode: verificationMode, risk_overrides: allTiers(verificationMode) };
    result = await verifySignedBundleV2(signedBundle as SignedBundleV2, registry, modePolicy);
  } catch (err) {
    // SDK 2.1.x throws on some malformed bundles instead of failing closed.
    return rejected([`V2 verification error: ${err instanceof Error ? err.message : String(err)}`], context);
  }

  const errors = [...result.errors];
  // V2-7: SDK 2.1.x accepts an invalid PQ signature under hybrid_preferred with a warning, but
  // reports it in details.signature_valid. pq_only does not require the classical signature.
  if (result.verified && result.details?.signature_valid !== true && verificationMode !== 'pq_only') {
    errors.push('Bundle composite signature does not verify (a PQ signature that is present must verify)');
  }
  return { verified: errors.length === 0, errors, warnings: result.warnings, ...context };
}
