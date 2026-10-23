/**
 * @dcp-ai/express — DCP verification middleware for Express.js
 *
 * Supports both V1 (Ed25519) and V2 (composite hybrid signatures) bundles.
 * A V2 bundle is accepted only when `verifySignedBundleV2` from `@dcp-ai/sdk`
 * accepts it under the middleware's verifier policy.
 *
 * Usage:
 *   import { dcpVerify } from '@dcp-ai/express';
 *   app.use('/api/agents/*', dcpVerify({ requireBundle: true }));
 */

import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  verifySignedBundle,
  verifySignedBundleV2,
  type SignedBundleV2,
  type VerificationMode,
  type VerifierPolicy,
} from '@dcp-ai/sdk';

type RiskTier = keyof VerifierPolicy['risk_overrides'];

/** Verifier policy fields to set over the SDK's `DEFAULT_VERIFIER_POLICY`. */
export type VerifierPolicyOptions = Partial<Omit<VerifierPolicy, 'risk_overrides'>> & {
  risk_overrides?: Partial<VerifierPolicy['risk_overrides']>;
};

export interface DCPVerifyOptions {
  requireBundle?: boolean;
  checkRevocation?: boolean;
  revocationServiceUrl?: string;
  onFailure?: (req: Request, res: Response, errors: string[]) => void;
  headerName?: string;
  /**
   * Seconds a verified bundle stays cached, keyed by the SHA-256 of the whole signed bundle. 0
   * disables the cache. An entry never outlives the bundle's session or signing keys.
   */
  cacheTtlSeconds?: number;
  /** Most verified bundles kept in the cache; the least recently used is evicted first. Default 1000. */
  cacheMaxEntries?: number;
  /** V2: require hybrid composite signatures: every risk tier whose mode is classical_only or hybrid_preferred becomes hybrid_required. */
  requireHybrid?: boolean;
  /**
   * V2: verifier policy, merged over the SDK's `DEFAULT_VERIFIER_POLICY` and passed to
   * `verifySignedBundleV2`. A `default_mode` given without `risk_overrides` applies to every
   * risk tier.
   */
  verifierPolicy?: VerifierPolicyOptions;
  /** DCP-05: Require agent lifecycle state != decommissioned. */
  requireActiveLifecycle?: boolean;
}

export interface DCPAgent {
  agentId: string;
  humanId: string;
  publicKey: string;
  capabilities: string[];
  riskTier: string;
  status: string;
  dcpVersion: '1.0' | '2.0';
  /** V2: Key identifiers. */
  kids?: string[];
  /** V2: Session nonce for the bundle. */
  sessionNonce?: string;
  /** DCP-05: Agent lifecycle state. */
  lifecycleState?: string;
  /** DCP-09: Active delegation mandate ID. */
  mandateId?: string;
  /** V2: Warnings of the SDK verifier for an accepted bundle (e.g. a classical-only signature). */
  warnings?: string[];
}

const VERIFICATION_MODES: readonly VerificationMode[] = ['classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];
const RISK_TIERS: readonly RiskTier[] = ['low', 'medium', 'high'];
const SIGNED_ARTIFACTS = ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'] as const;

// Built once: the providers the V2 verifier needs (Ed25519, ML-DSA-65, SLH-DSA-192f).
const registry = new AlgorithmRegistry();
for (const provider of [new Ed25519Provider(), new MlDsa65Provider(), new SlhDsa192fProvider()]) {
  registry.registerSigner(provider);
}

/**
 * The policy the middleware passes to `verifySignedBundleV2`: `verifierPolicy` over the SDK's
 * `DEFAULT_VERIFIER_POLICY`, then `requireHybrid`. Throws on an unknown verification mode.
 */
export function resolveVerifierPolicy(
  options: Pick<DCPVerifyOptions, 'verifierPolicy' | 'requireHybrid'> = {},
): VerifierPolicy {
  // A field explicitly set to undefined keeps the default instead of switching a check off.
  const configured: VerifierPolicyOptions = Object.fromEntries(
    Object.entries(options.verifierPolicy ?? {}).filter(([, value]) => value !== undefined),
  );
  const tierModes = configured.default_mode
    ? Object.fromEntries(RISK_TIERS.map((tier) => [tier, configured.default_mode]))
    : DEFAULT_VERIFIER_POLICY.risk_overrides;
  const policy: VerifierPolicy = {
    ...DEFAULT_VERIFIER_POLICY,
    ...configured,
    risk_overrides: { ...tierModes, ...configured.risk_overrides } as VerifierPolicy['risk_overrides'],
  };
  if (options.requireHybrid) {
    const raise = (mode: VerificationMode): VerificationMode =>
      mode === 'classical_only' || mode === 'hybrid_preferred' ? 'hybrid_required' : mode;
    policy.default_mode = raise(policy.default_mode);
    for (const tier of RISK_TIERS) policy.risk_overrides[tier] = raise(policy.risk_overrides[tier]);
  }
  for (const mode of [policy.default_mode, ...RISK_TIERS.map((tier) => policy.risk_overrides[tier])]) {
    if (!VERIFICATION_MODES.includes(mode)) {
      throw new Error(`Unknown verification mode in verifierPolicy: ${String(mode)}`);
    }
  }
  return policy;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detectVersion(obj: any): '1.0' | '2.0' | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.bundle?.dcp_bundle_version === '2.0') return '2.0';
  if (obj.bundle?.responsible_principal_record?.dcp_version === '1.0') return '1.0';
  return null;
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

/**
 * Shape checks that give clearer errors than the SDK's, and keep the published @dcp-ai/sdk
 * 2.1.x from throwing on a malformed bundle. Never a verdict: an empty list only means the
 * bundle can go to the SDK verifier.
 */
function v2ShapeErrors(signedBundle: any): string[] {
  const { bundle, signature } = signedBundle;
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
  if (!Array.isArray(bundle.audit_entries)) errors.push('Missing or invalid audit_entries');
  if (bundle.pq_checkpoints !== undefined && !Array.isArray(bundle.pq_checkpoints)) {
    errors.push('Invalid pq_checkpoints');
  }
  if (!isObject(signature.composite_sig) || !isObject(signature.composite_sig.classical)) {
    errors.push('Missing composite_sig in bundle signature');
  }
  return errors;
}

async function checkV2Bundle(
  signedBundle: any,
  policy: VerifierPolicy,
  requireActiveLifecycle: boolean,
): Promise<{ verified: boolean; errors: string[]; warnings: string[] }> {
  const shapeErrors = v2ShapeErrors(signedBundle);
  if (shapeErrors.length > 0) return { verified: false, errors: shapeErrors, warnings: [] };

  let result: Awaited<ReturnType<typeof verifySignedBundleV2>>;
  try {
    result = await verifySignedBundleV2(signedBundle as SignedBundleV2, registry, policy);
  } catch (err) {
    // @dcp-ai/sdk 2.1.x throws on some malformed bundles instead of failing closed.
    const reason = err instanceof Error ? err.message : String(err);
    return { verified: false, errors: [`V2 verification error: ${reason}`], warnings: [] };
  }

  const errors = [...result.errors];
  // VERIFICATION.md V2-7: a PQ signature that is present must verify in every mode. @dcp-ai/sdk
  // 2.1.x accepts an invalid one under hybrid_preferred with a warning, but reports it in
  // details.signature_valid. pq_only does not require the classical signature.
  if (result.verified && result.details?.signature_valid !== true && result.details?.verification_mode !== 'pq_only') {
    errors.push('Bundle composite signature does not verify (a PQ signature that is present must verify)');
  }
  if (requireActiveLifecycle && signedBundle.bundle.agent_passport.payload.status === 'decommissioned') {
    errors.push('Agent is decommissioned (DCP-05 §5.1). Active lifecycle required.');
  }
  return { verified: errors.length === 0, errors, warnings: result.warnings };
}

async function checkRevocationStatus(agentId: string, kids: string[] | undefined, url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/check/${encodeURIComponent(agentId)}`);
    if (response.ok) {
      const data = await response.json() as any;
      if (data.revoked) return true;
    }

    // V2: Check kid-level revocation
    if (kids) {
      for (const kid of kids) {
        const kidResponse = await fetch(`${url}/v2/check/kid/${encodeURIComponent(kid)}`);
        if (kidResponse.ok) {
          const kidData = await kidResponse.json() as any;
          if (kidData.revoked) return true;
        }
      }
    }
  } catch {
    // If revocation service is unavailable, fail-open by default
  }
  return false;
}

/**
 * Why a V1 bundle (one Ed25519 signature, no post-quantum one) is refused under this policy, or
 * null. A V1 passport's risk tier is self-declared, so V1 is refused as soon as any tier requires
 * a post-quantum signature.
 */
function v1PolicyRefusal(policy: VerifierPolicy, requireHybrid: boolean): string | null {
  if (!policy.allow_v1_bundles) return 'V1 bundles are not accepted: verifier policy allow_v1_bundles is false';
  if (requireHybrid) return 'V1 bundles are not accepted: requireHybrid needs a post-quantum signature';
  const modes = [policy.default_mode, ...RISK_TIERS.map((tier) => policy.risk_overrides[tier])];
  const strict = modes.find((mode) => mode === 'hybrid_required' || mode === 'pq_only');
  if (strict) {
    return `V1 bundles are not accepted: the verifier policy requires ${strict} for a risk tier, and a V1 bundle has no post-quantum signature`;
  }
  return null;
}

/**
 * When a cached verdict on this bundle stops holding: after the TTL, or when the session, the RPR,
 * a passport key or an RPR binding key expires, whichever comes first. A timestamp that does not
 * parse gives 0 (not cached).
 */
function verdictExpiry(signedBundle: any, ttlSeconds: number): number {
  const bundle = signedBundle.bundle ?? {};
  const rpr = bundle.responsible_principal_record?.payload ?? bundle.responsible_principal_record;
  const passport = bundle.agent_passport?.payload ?? bundle.agent_passport;
  const keys = [
    ...(Array.isArray(passport?.keys) ? passport.keys : []),
    ...(Array.isArray(rpr?.binding_keys) ? rpr.binding_keys : []),
  ];
  const stamps = [bundle.manifest?.session_expires_at, rpr?.expires_at, ...keys.map((key: any) => key?.expires_at)];
  let expires = Date.now() + ttlSeconds * 1000;
  for (const stamp of stamps) {
    if (stamp === undefined || stamp === null) continue;
    const time = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
    if (Number.isNaN(time)) return 0;
    expires = Math.min(expires, time);
  }
  return expires;
}

/** Verified agents by signed-bundle hash, each until its expiry; least recently used evicted first. */
class VerdictCache {
  private readonly entries = new Map<string, { agent: DCPAgent; expires: number }>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): DCPAgent | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (Date.now() >= entry.expires) return undefined;
    this.entries.set(key, entry); // now the most recently used
    return structuredClone(entry.agent);
  }

  set(key: string, agent: DCPAgent, expires: number): void {
    const now = Date.now();
    if (expires <= now) return;
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      for (const [k, entry] of this.entries) if (now >= entry.expires) this.entries.delete(k);
    }
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { agent: structuredClone(agent), expires });
  }
}

/**
 * Express middleware that verifies DCP signed bundles (V1 + V2).
 */
export function dcpVerify(options: DCPVerifyOptions = {}) {
  const {
    requireBundle = true,
    checkRevocation = false,
    revocationServiceUrl = 'http://localhost:3003',
    onFailure,
    headerName = 'x-dcp-bundle',
    cacheTtlSeconds = 0,
    cacheMaxEntries = 1000,
    requireActiveLifecycle = false,
  } = options;
  if (!Number.isInteger(cacheMaxEntries) || cacheMaxEntries < 1) {
    throw new Error('cacheMaxEntries must be a positive integer');
  }
  const policy = resolveVerifierPolicy(options);
  const v1Refusal = v1PolicyRefusal(policy, Boolean(options.requireHybrid));

  // One cache per middleware: its verdicts hold only under this middleware's policy and options.
  // The key is the SHA-256 of the whole signed bundle, so no other bundle can reuse a verdict.
  const cache = new VerdictCache(cacheMaxEntries);
  const cacheKeyFor = (signedBundle: unknown) =>
    createHash('sha256').update(JSON.stringify(signedBundle)).digest('hex');

  const fail = (req: Request, res: Response, errors: string[], warnings?: string[]) => {
    if (onFailure) return onFailure(req, res, errors);
    return res.status(403).json(warnings ? { verified: false, errors, warnings } : { verified: false, errors });
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

      const cacheKey = cacheTtlSeconds > 0 ? cacheKeyFor(signedBundle) : '';
      const cached = cacheKey ? cache.get(cacheKey) : undefined;
      let agent: DCPAgent;

      if (cached) {
        agent = cached;
      } else {
        const version = detectVersion(signedBundle);
        if (version === '2.0') {
          const { verified, errors, warnings } = await checkV2Bundle(signedBundle, policy, requireActiveLifecycle);
          if (!verified) return fail(req, res, errors, warnings);
          agent = extractV2Agent(signedBundle, warnings);
        } else if (version === '1.0') {
          if (v1Refusal) return fail(req, res, [v1Refusal]);
          const result = verifySignedBundle(signedBundle);
          if (!result.verified) return fail(req, res, result.errors || ['Verification failed']);
          agent = extractV1Agent(signedBundle);
        } else {
          return fail(req, res, [
            'Unrecognized DCP bundle version: expected bundle.dcp_bundle_version "2.0" or bundle.responsible_principal_record.dcp_version "1.0"',
          ]);
        }
      }

      // Revocation is checked on every request, cached verdict or not.
      if (checkRevocation) {
        const v2 = agent.dcpVersion === '2.0';
        if (await checkRevocationStatus(agent.agentId, v2 ? agent.kids : undefined, revocationServiceUrl)) {
          return fail(req, res, [v2 ? 'Agent or key has been revoked' : 'Agent has been revoked']);
        }
      }

      if (cacheKey && !cached) cache.set(cacheKey, agent, verdictExpiry(signedBundle, cacheTtlSeconds));

      req.dcpAgent = agent;
      next();
    } catch (err: any) {
      const errors = [`DCP verification error: ${err.message}`];
      if (onFailure) return onFailure(req, res, errors);
      return res.status(500).json({ verified: false, errors });
    }
  };
}
