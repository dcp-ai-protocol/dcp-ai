/**
 * @dcp-ai/express — DCP verification middleware for Express.js
 *
 * Supports both V1 (Ed25519) and V2 (composite hybrid signatures) bundles.
 * A V2 bundle is accepted only when `verifySignedBundleV2` from `@dcp-ai/sdk`
 * accepts it under the middleware's verifier policy. With `trustedPrincipals`,
 * and optionally the strict-v1 `profile`, it is accepted only when it is
 * admitted (spec/profiles/admission): signed by keys the operator trusts for
 * its principal, and under the profile meeting every profile requirement.
 *
 * Usage:
 *   import { dcpVerify } from '@dcp-ai/express';
 *   app.use('/api/agents/*', dcpVerify({ requireBundle: true }));
 */

import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  AdmissionConfigError,
  canonicalizeV2,
  verifySignedBundle,
  type AdmissionResult,
  type PrincipalTrust,
  type ProfileCompliance,
  type StrictV1Profile,
  type StrictV1ProfileConfig,
  type VerificationMode,
  type VerifierPolicy,
  type VerifyV2Result,
} from '@dcp-ai/sdk';
import {
  admissionFailure,
  admissionPolicy,
  admit,
  detectVersion,
  isObject,
  parseRfc3339,
  policyFingerprint,
  resolveAdmission,
  resolveVerifierPolicy as resolvePolicy,
  TrustSourceError,
  v1Refusal,
  verifyV2,
  type RevocationSource,
  type SecurityTier,
  type TrustSource,
  type VerifierPolicyOptions,
} from './dcp-verify.js';

export type { SecurityTier, VerifierPolicyOptions, RevocationSource, TrustSource } from './dcp-verify.js';
export { denyListRevocationSource } from './dcp-verify.js';

export interface DCPVerifyOptions {
  requireBundle?: boolean;
  /** Ask the revocation service whether the agent and the bundle's keys are revoked, on every request. */
  checkRevocation?: boolean;
  revocationServiceUrl?: string;
  /**
   * With checkRevocation: reject the request (403) when the revocation status cannot be read
   * (service unreachable or throwing, a non-2xx answer, a body that is not JSON or has no
   * boolean `revoked`). Default false: such a request is let through (fail open).
   */
  revocationFailClosed?: boolean;
  onFailure?: (req: Request, res: Response, errors: string[], admission?: AdmissionResult) => void;
  headerName?: string;
  /**
   * Seconds a verified bundle stays cached, keyed by the SHA-256 of its canonical form, the
   * verifier policy and the tenant. 0 disables the cache. An entry never outlives the bundle's
   * session or signing keys. Principal trust, the profile checks and revocation are evaluated on
   * every request, cached or not.
   */
  cacheTtlSeconds?: number;
  /** Most verified bundles kept in the cache; the least recently used is evicted first. Default 1000. */
  cacheMaxEntries?: number;
  /** Require post-quantum signatures: every mode below hybrid_required becomes hybrid_required, and V1 bundles are refused. */
  requireHybrid?: boolean;
  /**
   * Verifier policy fields, merged over the SDK's `DEFAULT_VERIFIER_POLICY`. A `default_mode`
   * given without `risk_overrides` applies to every risk tier. An unknown field or a value of
   * the wrong type throws when the middleware is created.
   */
  verifierPolicy?: VerifierPolicyOptions;
  /** DCP-05: Require agent lifecycle state != decommissioned. */
  requireActiveLifecycle?: boolean;
  /**
   * The principals the operator trusts and their keys: a trust set
   * (schemas/v2/principal_trust_set.schema.json), or a function of the tenant that returns one,
   * called on every request. With it, only V2 bundles signed for a trusted principal with its
   * trusted keys reach the route.
   */
  trustedPrincipals?: TrustSource;
  /**
   * The strict-v1 profile (schemas/v2/admission_profile.schema.json). Requires trustedPrincipals
   * and revocationSource, and refuses requireBundle false, verifierPolicy, requireHybrid false
   * and the checkRevocation options.
   */
  profile?: StrictV1ProfileConfig | StrictV1Profile;
  /** The revocation source of the profile, e.g. denyListRevocationSource({ url }). */
  revocationSource?: RevocationSource;
  /** Milliseconds the revocation source may take before the request is refused. Default 5000. */
  revocationTimeoutMs?: number;
  /**
   * The tenant of a request, from the operator's own authenticated context (never a header the
   * client chooses). It selects the trust set and separates cached verdicts. Default: one tenant.
   */
  tenant?: (req: Request) => string;
  /** The clock, in milliseconds since the epoch. For tests; default Date.now. */
  clock?: () => number;
}

export interface DCPAgent {
  agentId: string;
  humanId: string;
  publicKey: string;
  capabilities: string[];
  riskTier: string;
  status: string;
  dcpVersion: '1.0' | '2.0';
  /** V2: Key identifiers of the passport keys. */
  kids?: string[];
  /** V2: Session nonce for the bundle. */
  sessionNonce?: string;
  /** DCP-05: Agent lifecycle state. */
  lifecycleState?: string;
  /** DCP-09: Active delegation mandate ID. */
  mandateId?: string;
  /** V2: Warnings of the SDK verifier for an accepted bundle (e.g. a classical-only signature). */
  warnings?: string[];
  /** V2: The verification mode the bundle was verified in. */
  verificationMode?: VerificationMode;
  /** V2: The security tier of the bundle's intent and policy decision (spec §14.2). */
  securityTier?: SecurityTier;
  /** With trustedPrincipals: the admission of the bundle (spec/profiles/admission § 5.2). */
  admission?: {
    admitted: true;
    principalTrust: PrincipalTrust;
    profile: 'strict-v1' | null;
    profileCompliance: ProfileCompliance;
    /** The decision the bundle records (approve, escalate, block): evidence, not a permission. */
    recordedDecision: string | null;
    trustSetVersion: string | null;
    /** Always false: admitting the evidence does not authorize an action. */
    actionAuthorized: false;
  };
}

const OPTION_TYPES: Record<keyof DCPVerifyOptions, readonly string[]> = {
  requireBundle: ['boolean'],
  checkRevocation: ['boolean'],
  revocationServiceUrl: ['string'],
  revocationFailClosed: ['boolean'],
  onFailure: ['function'],
  headerName: ['string'],
  cacheTtlSeconds: ['number'],
  cacheMaxEntries: ['number'],
  requireHybrid: ['boolean'],
  verifierPolicy: ['object'],
  requireActiveLifecycle: ['boolean'],
  trustedPrincipals: ['object', 'function'],
  profile: ['object'],
  revocationSource: ['function'],
  revocationTimeoutMs: ['number'],
  tenant: ['function'],
  clock: ['function'],
};

/** An unknown option or a value of the wrong type throws: a misspelt option must not switch a check off. */
function checkOptions(options: unknown): void {
  if (!isObject(options)) throw new TypeError('dcpVerify options must be an object');
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    if (!Object.hasOwn(OPTION_TYPES, key)) throw new Error(`Unknown dcpVerify option: ${key}`);
    const types = OPTION_TYPES[key as keyof DCPVerifyOptions];
    if (!types.includes(typeof value) || value === null) {
      throw new TypeError(`dcpVerify option ${key} must be a ${types.join(' or ')}`);
    }
  }
  const o = options as DCPVerifyOptions;
  if (o.cacheTtlSeconds !== undefined && !(Number.isFinite(o.cacheTtlSeconds) && o.cacheTtlSeconds >= 0)) {
    throw new TypeError('cacheTtlSeconds must be a non-negative number');
  }
  if (o.cacheMaxEntries !== undefined && !(Number.isInteger(o.cacheMaxEntries) && o.cacheMaxEntries >= 1)) {
    throw new Error('cacheMaxEntries must be a positive integer');
  }
  if (o.trustedPrincipals !== undefined && o.requireBundle === false) {
    // A request without a bundle would reach the route that refuses one with an unadmitted bundle.
    throw new AdmissionConfigError('CONFIG_PROFILE_CONTRADICTION', 'trustedPrincipals does not allow requireBundle false: a request without a bundle would reach the route');
  }
  if (o.profile !== undefined) {
    // The profile fixes what these options would otherwise loosen.
    const contradiction = (what: string) => new AdmissionConfigError('CONFIG_PROFILE_CONTRADICTION', `strict-v1 does not allow ${what}`);
    if (o.verifierPolicy !== undefined) throw contradiction('verifierPolicy: the profile sets the verifier policy (profile.verifier_policy may tighten it)');
    if (o.requireHybrid === false) throw contradiction('requireHybrid false');
    for (const key of ['checkRevocation', 'revocationServiceUrl', 'revocationFailClosed'] as const) {
      if (o[key] !== undefined) throw contradiction(`${key}: the profile checks revocation with revocationSource, failing closed`);
    }
  }
}

/**
 * The policy the middleware verifies V2 bundles with: `verifierPolicy` over the SDK's
 * `DEFAULT_VERIFIER_POLICY`, then `requireHybrid`. Throws on an unknown field or a wrong type.
 */
export function resolveVerifierPolicy(
  options: Pick<DCPVerifyOptions, 'verifierPolicy' | 'requireHybrid'> = {},
): VerifierPolicy {
  return resolvePolicy(options.verifierPolicy, { requireHybrid: options.requireHybrid === true });
}

function extractV2Agent(signedBundle: any, warnings: string[]): DCPAgent {
  const bundle = signedBundle.bundle;
  const passport = bundle.agent_passport?.payload;
  const rpr = bundle.responsible_principal_record?.payload;
  const nonce = bundle.manifest?.session_nonce;

  return {
    agentId: passport?.agent_id || '',
    humanId: rpr?.human_id || passport?.principal_binding_reference || '',
    publicKey: passport?.keys?.[0]?.public_key_b64 || '',
    capabilities: passport?.capabilities || [],
    riskTier: passport?.risk_tier || 'medium',
    status: passport?.status || 'active',
    dcpVersion: '2.0',
    kids: (passport?.keys || []).map((k: any) => k.kid),
    sessionNonce: nonce,
    lifecycleState: passport?.status || 'active',
    mandateId: bundle.manifest?.mandate_id,
    warnings,
  };
}

function extractV1Agent(signedBundle: any): DCPAgent {
  const bundle = signedBundle.bundle;
  return {
    agentId: bundle.agent_passport?.agent_id || '',
    humanId: bundle.responsible_principal_record?.human_id || '',
    publicKey: bundle.agent_passport?.public_key || '',
    capabilities: bundle.agent_passport?.capabilities || [],
    riskTier: bundle.agent_passport?.risk_tier || 'medium',
    status: bundle.agent_passport?.status || 'active',
    dcpVersion: '1.0',
  };
}

/** Every key a V2 bundle can be signed with: passport keys, RPR binding keys, and the bundle signature's kids. */
function revocationKids(signedBundle: any): string[] {
  const { bundle, signature } = signedBundle;
  const kids = [
    ...bundle.agent_passport.payload.keys.map((key: any) => key?.kid),
    ...(bundle.responsible_principal_record.payload.binding_keys ?? []).map((key: any) => key?.kid),
    signature.composite_sig.classical?.kid,
    signature.composite_sig.pq?.kid,
  ];
  return [...new Set(kids.filter((kid): kid is string => typeof kid === 'string'))];
}

/**
 * When a cached verdict on this bundle stops holding: after the TTL, or when the session, the RPR,
 * a passport key or an RPR binding key expires, whichever comes first. A timestamp that is not
 * RFC 3339 gives 0 (not cached).
 */
function verdictExpiry(signedBundle: any, ttlSeconds: number, now: number): number {
  const bundle = signedBundle.bundle ?? {};
  const rpr = bundle.responsible_principal_record?.payload ?? bundle.responsible_principal_record;
  const passport = bundle.agent_passport?.payload ?? bundle.agent_passport;
  const keys = [
    ...(Array.isArray(passport?.keys) ? passport.keys : []),
    ...(Array.isArray(rpr?.binding_keys) ? rpr.binding_keys : []),
  ];
  const stamps = [bundle.manifest?.session_expires_at, rpr?.expires_at, ...keys.map((key: any) => key?.expires_at)];
  let expires = now + ttlSeconds * 1000;
  for (const stamp of stamps) {
    if (stamp === undefined || stamp === null) continue;
    const time = parseRfc3339(stamp);
    if (time === undefined) return 0;
    expires = Math.min(expires, time);
  }
  return expires;
}

/**
 * A cached verdict: the V2 verifier's result (for admission, which is evaluated again on every
 * request), or the agent of an accepted bundle and the kids the revocation check asks about.
 */
type CachedVerdict = { verification: VerifyV2Result; agent?: undefined; kids?: undefined } | { agent: DCPAgent; kids: string[]; verification?: undefined };

/** Verdicts by bundle hash, policy and tenant, each until its expiry; least recently used evicted first. */
class VerdictCache {
  private readonly entries = new Map<string, CachedVerdict & { expires: number }>();

  constructor(private readonly maxEntries: number) {}

  get(key: string, now: number): CachedVerdict | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (now >= entry.expires) return undefined;
    this.entries.set(key, entry); // now the most recently used
    return structuredClone(entry);
  }

  set(key: string, verdict: CachedVerdict, expires: number, now: number): void {
    if (expires <= now) return;
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      for (const [k, entry] of this.entries) if (now >= entry.expires) this.entries.delete(k);
    }
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { ...structuredClone(verdict), expires });
  }
}

/**
 * The cache key of a signed bundle under a policy and tenant: SHA-256 over the canonical bundle,
 * the policy fingerprint and the tenant, so two requests share a key only for the same JSON value
 * under the same policy for the same tenant. undefined when the bundle has no canonical form (a
 * non-integer number such as 1e999, or nesting too deep): such a bundle is not cached.
 */
function cacheKeyFor(signedBundle: unknown, policyKey: string, tenant: string): string | undefined {
  try {
    const bundleHash = createHash('sha256').update(canonicalizeV2(signedBundle)).digest('hex');
    return createHash('sha256').update(JSON.stringify([bundleHash, policyKey, tenant])).digest('hex');
  } catch {
    return undefined;
  }
}

type RevocationStatus = 'revoked' | 'clear' | 'unavailable';

/**
 * One revocation lookup: revoked when the JSON body has a truthy `revoked`, clear when it is
 * `false`, unavailable otherwise (fetch throws, a non-2xx answer, a body that is not JSON or
 * whose `revoked` is missing or another falsy value).
 */
async function revocationLookup(url: string): Promise<RevocationStatus> {
  try {
    const response = await fetch(url);
    if (!response.ok) return 'unavailable';
    const data = (await response.json()) as any;
    if (data?.revoked === false) return 'clear';
    return data?.revoked ? 'revoked' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** The agent's status (`/check/<agent_id>`) and, for V2, each key's (`/v2/check/kid/<kid>`). */
async function checkRevocationStatus(agentId: string, kids: string[], url: string): Promise<RevocationStatus> {
  const lookups = [`${url}/check/${encodeURIComponent(agentId)}`, ...kids.map((kid) => `${url}/v2/check/kid/${encodeURIComponent(kid)}`)];
  let status: RevocationStatus = 'clear';
  for (const lookup of lookups) {
    const result = await revocationLookup(lookup);
    if (result === 'revoked') return 'revoked';
    if (result === 'unavailable') status = 'unavailable';
  }
  return status;
}

/**
 * Express middleware that verifies DCP signed bundles (V1 + V2).
 */
export function dcpVerify(options: DCPVerifyOptions = {}) {
  checkOptions(options);
  const {
    requireBundle = true,
    checkRevocation = false,
    revocationServiceUrl = 'http://localhost:3003',
    revocationFailClosed = false,
    onFailure,
    headerName = 'x-dcp-bundle',
    cacheTtlSeconds = 0,
    cacheMaxEntries = 1000,
    requireHybrid = false,
    requireActiveLifecycle = false,
    tenant: tenantOf,
    clock = Date.now,
  } = options;
  const admission = resolveAdmission(options);
  const policy = admissionPolicy(admission, resolveVerifierPolicy(options));
  const policyKey = policyFingerprint(policy);

  // One cache per middleware; its entries are keyed by bundle, policy and tenant.
  const cache = new VerdictCache(cacheMaxEntries);

  const fail = (req: Request, res: Response, errors: string[], warnings?: string[]) => {
    if (onFailure) return onFailure(req, res, errors);
    return res.status(403).json(warnings ? { verified: false, errors, warnings } : { verified: false, errors });
  };
  const refuse = (req: Request, res: Response, result: AdmissionResult) => {
    const body = admissionFailure(result);
    if (onFailure) return onFailure(req, res, body.errors, result);
    return res.status(403).json(body);
  };
  // The operator's trust source failed or gave no valid trust set: refused, never admitted.
  const trustUnavailable = (req: Request, res: Response, verified: boolean, err: TrustSourceError) => {
    const errors = [`The principal trust set is unavailable (${err.code})`];
    if (onFailure) return onFailure(req, res, errors);
    return res.status(503).json({
      verified,
      admitted: false,
      principal_trust: 'not_evaluated',
      profile: admission?.profile ? 'strict-v1' : null,
      profile_compliance: 'not_evaluated',
      codes: [],
      errors,
    });
  };

  return async (req: Request & { dcpAgent?: DCPAgent }, res: Response, next: NextFunction) => {
    try {
      let signedBundle: any = null;
      const headerValue = req.headers[headerName];
      if (typeof headerValue === 'string') {
        try {
          signedBundle = JSON.parse(headerValue);
        } catch {
          signedBundle = null;
        }
      }

      if (!signedBundle && (req.body as any)?.signed_bundle) {
        signedBundle = (req.body as any).signed_bundle;
      }

      if (!signedBundle) {
        if (requireBundle) {
          return fail(req, res, ['Missing DCP signed bundle. Provide via X-DCP-Bundle header or body.signed_bundle.']);
        }
        return next();
      }

      const now = clock();
      const tenant = tenantOf ? tenantOf(req) : '';
      if (typeof tenant !== 'string') throw new TypeError('the tenant function must return a string');
      const cacheKey = cacheTtlSeconds > 0 ? cacheKeyFor(signedBundle, policyKey, tenant) : undefined;
      const cached = cacheKey ? cache.get(cacheKey, now) : undefined;
      const version = detectVersion(signedBundle);

      // ── Admission: trusted principals, and the strict-v1 profile ──
      if (admission) {
        let verification = cached?.verification;
        let verdict: Awaited<ReturnType<typeof verifyV2>> | undefined;
        if (version === '2.0' && !verification) {
          verdict = await verifyV2(signedBundle, policy, now);
          verification = verdict.verification;
          if (cacheKey && verification.verified) cache.set(cacheKey, { verification }, verdictExpiry(signedBundle, cacheTtlSeconds, now), now);
        }
        let result: AdmissionResult;
        try {
          result = await admit(admission, signedBundle, version === '2.0' ? verification : undefined, { tenant, now });
        } catch (err) {
          if (!(err instanceof TrustSourceError)) throw err;
          return trustUnavailable(req, res, verification?.verified === true, err);
        }
        if (!result.admitted) return refuse(req, res, result);
        if (requireActiveLifecycle && signedBundle.bundle.agent_passport.payload.status === 'decommissioned') {
          return fail(req, res, ['Agent is decommissioned (DCP-05 §5.1). Active lifecycle required.']);
        }
        const agent = extractV2Agent(signedBundle, result.verification.warnings);
        agent.verificationMode = result.verification.details?.verification_mode;
        agent.securityTier = result.verification.details?.resolved_tier;
        agent.admission = {
          admitted: true,
          principalTrust: result.principal_trust,
          profile: result.profile,
          profileCompliance: result.profile_compliance,
          recordedDecision: result.recorded_decision,
          trustSetVersion: result.trust_set_version,
          actionAuthorized: false,
        };
        if (checkRevocation) {
          // Trusted principals without the profile may still use the revocation service.
          const status = await checkRevocationStatus(agent.agentId, revocationKids(signedBundle), revocationServiceUrl);
          if (status === 'revoked') return fail(req, res, ['Agent or key has been revoked']);
          if (status === 'unavailable' && revocationFailClosed) return fail(req, res, ['Revocation status unavailable (revocationFailClosed)']);
        }
        req.dcpAgent = agent;
        return next();
      }

      // ── Verification only ──
      let verdict = cached?.agent ? { agent: cached.agent, kids: cached.kids } : undefined;
      const fresh = !verdict;
      if (!verdict) {
        if (version === '2.0') {
          const result = await verifyV2(signedBundle, policy, now);
          const errors = [...result.errors];
          if (result.verified && requireActiveLifecycle && signedBundle.bundle.agent_passport.payload.status === 'decommissioned') {
            errors.push('Agent is decommissioned (DCP-05 §5.1). Active lifecycle required.');
          }
          if (errors.length > 0) return fail(req, res, errors, result.warnings);
          const agent = extractV2Agent(signedBundle, result.warnings);
          agent.verificationMode = result.verificationMode;
          agent.securityTier = result.securityTier;
          verdict = { agent, kids: revocationKids(signedBundle) };
        } else if (version === '1.0') {
          const refusal = v1Refusal(policy, requireHybrid, signedBundle.bundle);
          if (refusal) return fail(req, res, [refusal]);
          let result: ReturnType<typeof verifySignedBundle>;
          try {
            result = verifySignedBundle(signedBundle);
          } catch (err) {
            return fail(req, res, [`V1 verification error: ${err instanceof Error ? err.message : String(err)}`]);
          }
          if (!result.verified) return fail(req, res, result.errors || ['Verification failed']);
          verdict = { agent: extractV1Agent(signedBundle), kids: [] };
        } else {
          return fail(req, res, [
            'Unrecognized DCP bundle version: expected bundle.dcp_bundle_version "2.0" or bundle.responsible_principal_record.dcp_version "1.0"',
          ]);
        }
      }

      // Revocation is checked on every request, cached verdict or not.
      if (checkRevocation) {
        const status = await checkRevocationStatus(verdict.agent.agentId, verdict.kids, revocationServiceUrl);
        if (status === 'revoked') {
          return fail(req, res, [verdict.agent.dcpVersion === '2.0' ? 'Agent or key has been revoked' : 'Agent has been revoked']);
        }
        if (status === 'unavailable' && revocationFailClosed) {
          return fail(req, res, ['Revocation status unavailable (revocationFailClosed)']);
        }
      }

      if (cacheKey && fresh) cache.set(cacheKey, verdict, verdictExpiry(signedBundle, cacheTtlSeconds, now), now);

      req.dcpAgent = verdict.agent;
      next();
    } catch (err: any) {
      const errors = [`DCP verification error: ${err.message}`];
      if (onFailure) return onFailure(req, res, errors);
      return res.status(500).json({ verified: false, errors });
    }
  };
}
