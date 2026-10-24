/**
 * What @dcp-ai/express and @dcp-ai/openclaw add around the SDK verifier. The same file is
 * integrations/express/src/dcp-verify.ts and integrations/openclaw/src/tools/dcp-verify.ts;
 * keep them identical.
 *
 * The verdict on a V2 bundle is verifySignedBundleV2's, from the workspace SDK
 * (sdks/typescript) until @dcp-ai/sdk 2.2.0 is on npm. This module only adds what is the
 * integrations' own: merging and checking the configured verifier policy, the V1 rule, version
 * detection, and shape checks that give clearer errors.
 */
import {
  AdmissionConfigError,
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  canonicalizeV2,
  computeSecurityTier,
  createPrincipalTrustStore,
  effectiveVerificationMode,
  evaluateAdmissionV2,
  resolveStrictV1Profile,
  revocationSnapshotFromDenyList,
  revocationSubjects,
  verifySignedBundleV2,
  type AdmissionResult,
  type IntentV2,
  type PrincipalTrustSet,
  type PrincipalTrustStore,
  type RevocationSnapshot,
  type RevocationSubjects,
  type SecurityTier,
  type SignedBundleV2,
  type StrictV1Profile,
  type StrictV1ProfileConfig,
  type VerificationMode,
  type VerifierPolicy,
  type VerifyV2Result,
} from '@dcp-ai/sdk';
import { createHash } from 'node:crypto';

export type { SecurityTier } from '@dcp-ai/sdk';
export type RiskTier = keyof VerifierPolicy['risk_overrides'];

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
  /** The verifier's full result (a failed one for a bundle the shape checks refused). */
  verification: VerifyV2Result;
}

export const VERIFICATION_MODES: readonly VerificationMode[] = ['classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];
export const RISK_TIERS: readonly RiskTier[] = ['low', 'medium', 'high'];
const SIGNED_ARTIFACTS = ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'] as const;

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

/**
 * The later of two modes in the order classical_only < hybrid_preferred < hybrid_required < pq_only,
 * as the operator's requireHybrid applies it (spec §14.3: a pq_only policy stays pq_only). Not a
 * combination of requirements: pq_only does not require the classical signature, so a policy that
 * someone other than the operator tightens must not use it (the OpenClaw tool uses requireBoth).
 */
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
  const intent = (isObject(b.intent) ? b.intent : {}) as unknown as IntentV2;
  const tier = computeSecurityTier(intent, { risk_score: riskScore as number });
  const mode = effectiveVerificationMode(policyMode, tier);
  if (mode === 'classical_only' || mode === 'hybrid_preferred') return null;
  return `V1 bundles are not accepted here: the policy requires ${mode} for this bundle (security tier ${tier}), and a V1 bundle has no post-quantum signature`;
}

// ── V2 ──

/**
 * Shape checks that give clearer errors than the SDK's ("Missing manifest" rather than a
 * malformed-bundle error). Never a verdict: an empty list only means the bundle goes to the SDK.
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
  if (!Array.isArray(bundle.audit_entries)) errors.push('Missing or invalid audit_entries');
  return errors;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Milliseconds since the epoch of an RFC 3339 timestamp with a Z or ±hh:mm offset, or undefined
 * for anything else, as the SDK verifier parses them (it does not export its parser). Used to
 * expire cached verdicts.
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

/**
 * Verifies a V2 signed bundle under `policy` at `now` (default the system clock): the shape checks
 * above, then verifySignedBundleV2.
 */
export async function verifyV2(signedBundle: unknown, policy: VerifierPolicy, now?: number): Promise<V2Verdict> {
  const shapeErrors = v2ShapeErrors(signedBundle);
  if (shapeErrors.length > 0) {
    return { verified: false, errors: shapeErrors, warnings: [], verification: { verified: false, errors: shapeErrors, warnings: [], details: {} } };
  }
  const result = await verifySignedBundleV2(signedBundle as SignedBundleV2, registry, policy, { now });
  return {
    verified: result.verified,
    errors: result.errors,
    warnings: result.warnings,
    verificationMode: result.details?.verification_mode,
    securityTier: result.details?.resolved_tier,
    verification: result,
  };
}

// ── Admission: principal trust and the strict-v1 profile (spec/profiles/admission) ──

/** The operator's trusted principals: a trust set, or a function of the operator's tenant that returns one. */
export type TrustSource =
  | PrincipalTrustSet
  | PrincipalTrustStore
  | ((context: { tenant: string }) => PrincipalTrustSet | PrincipalTrustStore | Promise<PrincipalTrustSet | PrincipalTrustStore>);

/**
 * The operator's revocation source: the status of `subjects` (the agent and the verified signer
 * kids) and when it was established. Return null, throw or time out when it cannot answer: the
 * request is then refused (REVOCATION_UNAVAILABLE). An error whose `code` is REVOCATION_INVALID
 * reports an answer that could not be read (REVOCATION_INVALID).
 */
export type RevocationSource = (
  subjects: RevocationSubjects,
  context: { tenant: string },
) => RevocationSnapshot | null | Promise<RevocationSnapshot | null>;

export interface AdmissionOptions {
  trustedPrincipals?: TrustSource;
  profile?: StrictV1ProfileConfig | StrictV1Profile;
  revocationSource?: RevocationSource;
  revocationTimeoutMs?: number;
}

/** What the operator configured for admission, checked once. */
export interface AdmissionSetup {
  trust: TrustSource;
  /** Loaded once when the trust set is static. */
  staticTrust?: PrincipalTrustStore;
  profile?: StrictV1Profile;
  revocationSource?: RevocationSource;
  revocationTimeoutMs: number;
}

const contradiction = (message: string) => new AdmissionConfigError('CONFIG_PROFILE_CONTRADICTION', message);

/**
 * The admission the operator configured, or undefined when neither trusted principals nor a
 * profile is set. A profile needs trusted principals and a revocation source; a revocation source
 * needs a profile. A static trust set and the profile are loaded here, so their errors
 * (AdmissionConfigError) surface when the middleware or tool is configured.
 */
export function resolveAdmission(options: AdmissionOptions): AdmissionSetup | undefined {
  const { trustedPrincipals, profile: profileConfig, revocationSource, revocationTimeoutMs = 5000 } = options;
  if (!(Number.isFinite(revocationTimeoutMs) && revocationTimeoutMs > 0)) {
    throw new AdmissionConfigError('CONFIG_INVALID_VALUE', 'revocationTimeoutMs must be a positive number');
  }
  if (revocationSource !== undefined && typeof revocationSource !== 'function') {
    throw new AdmissionConfigError('CONFIG_INVALID_VALUE', 'revocationSource must be a function');
  }
  const profile = profileConfig === undefined ? undefined : resolveStrictV1Profile(profileConfig);
  if (profile && trustedPrincipals === undefined) throw contradiction('strict-v1 requires trustedPrincipals');
  if (profile && revocationSource === undefined) throw contradiction('strict-v1 requires a revocationSource');
  if (!profile && revocationSource !== undefined) {
    throw new AdmissionConfigError('CONFIG_INVALID_VALUE', 'revocationSource is used by the strict-v1 profile only; set profile');
  }
  if (trustedPrincipals === undefined) return undefined;
  const staticTrust = typeof trustedPrincipals === 'function' ? undefined : createPrincipalTrustStore(trustedPrincipals);
  return { trust: trustedPrincipals, staticTrust, profile, revocationSource, revocationTimeoutMs };
}

/** SHA-256 of the canonical form of a verifier policy: part of a cached verdict's identity. */
export function policyFingerprint(policy: VerifierPolicy): string {
  return createHash('sha256').update(canonicalizeV2(policy)).digest('hex');
}

/** The verifier policy of an admission setup with a profile, else `policy`. */
export function admissionPolicy(setup: AdmissionSetup | undefined, policy: VerifierPolicy): VerifierPolicy {
  return setup?.profile ? (setup.profile.policy as VerifierPolicy) : policy;
}

function withTimeout<T>(value: T | Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([Promise.resolve(value), timeout]).finally(() => clearTimeout(timer));
}

/** The revocation snapshot for `subjects`, or what stands for a source that could not answer. */
async function revocationFor(setup: AdmissionSetup, subjects: RevocationSubjects, tenant: string): Promise<unknown> {
  try {
    return (await withTimeout(setup.revocationSource!(subjects, { tenant }), setup.revocationTimeoutMs)) ?? null;
  } catch (e) {
    // A failure is never a not_revoked: unavailable, or an answer that could not be read.
    return (e as { code?: unknown })?.code === 'REVOCATION_INVALID' ? { source_error: 'invalid' } : null;
  }
}

/**
 * Admission of a signed bundle (spec/profiles/admission § 5.1) given its verification: the trust
 * set for `tenant` from the operator's source and, under the profile, the revocation snapshot from
 * the operator's revocation source, both evaluated now. A bundle that is not V2 gets a failed
 * verification: it carries no principal signature to anchor.
 */
export async function admit(
  setup: AdmissionSetup,
  signedBundle: unknown,
  verification: VerifyV2Result | undefined,
  { tenant, now }: { tenant: string; now: number },
): Promise<AdmissionResult> {
  const trust = setup.staticTrust ?? (await (setup.trust as Exclude<TrustSource, PrincipalTrustSet | PrincipalTrustStore>)({ tenant }));
  const checked = verification ?? {
    verified: false,
    errors: ['Only V2 bundles can be admitted against trusted principals'],
    warnings: [],
    details: {},
  };
  const revocation =
    setup.profile && checked.verified ? await revocationFor(setup, revocationSubjects(signedBundle, checked), tenant) : undefined;
  return evaluateAdmissionV2({ signedBundle, verification: checked, profile: setup.profile, trust, revocation: revocation as RevocationSnapshot | null | undefined, now });
}

/** The fields of a refused admission a caller may see: codes and bounded messages, no keys. */
export function admissionFailure(result: AdmissionResult) {
  return {
    verified: result.verified,
    admitted: false as const,
    principal_trust: result.principal_trust,
    profile: result.profile,
    profile_compliance: result.profile_compliance,
    codes: [...new Set(result.errors.map((e) => e.code))].sort(),
    errors: result.errors.map((e) => e.message),
  };
}

/** A revocation source that could not answer (REVOCATION_UNAVAILABLE) or answered unreadably (REVOCATION_INVALID). */
class RevocationSourceError extends Error {
  constructor(
    readonly code: 'REVOCATION_UNAVAILABLE' | 'REVOCATION_INVALID',
    message: string,
  ) {
    super(message);
  }
}

/**
 * A revocation source that fetches a complete deny list (revocationSnapshotFromDenyList from the
 * SDK: the reference revocation service's /.well-known/dcp-revocations.json format) from `url`, with the
 * operator's `headers`, within `timeoutMs` (default 5000), following no redirect. A network error,
 * a timeout or a non-2xx answer is REVOCATION_UNAVAILABLE; a body of another shape REVOCATION_INVALID.
 */
export function denyListRevocationSource(options: { url: string; headers?: Record<string, string>; timeoutMs?: number }): RevocationSource {
  const { url, headers = {}, timeoutMs = 5000 } = isObject(options) ? (options as typeof options) : ({} as typeof options);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AdmissionConfigError('CONFIG_INVALID_VALUE', 'denyListRevocationSource: url must be an absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AdmissionConfigError('CONFIG_INVALID_VALUE', 'denyListRevocationSource: url must be http or https');
  }
  if (!isObject(headers) || !Object.values(headers).every((v) => typeof v === 'string')) {
    throw new AdmissionConfigError('CONFIG_INVALID_VALUE', 'denyListRevocationSource: headers must map names to strings');
  }
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    throw new AdmissionConfigError('CONFIG_INVALID_VALUE', 'denyListRevocationSource: timeoutMs must be a positive number');
  }
  return async (subjects) => {
    let response: Response;
    try {
      response = await fetch(parsed, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new RevocationSourceError('REVOCATION_UNAVAILABLE', 'revocation list could not be fetched');
    }
    if (!response.ok) throw new RevocationSourceError('REVOCATION_UNAVAILABLE', `revocation list answered ${response.status}`);
    let document: unknown;
    try {
      document = await response.json();
    } catch (e) {
      if ((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError') {
        throw new RevocationSourceError('REVOCATION_UNAVAILABLE', 'revocation list timed out');
      }
      throw new RevocationSourceError('REVOCATION_INVALID', 'revocation list is not JSON');
    }
    return revocationSnapshotFromDenyList(document, subjects);
  };
}
