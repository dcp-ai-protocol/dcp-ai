/**
 * @dcp-ai/express — DCP verification middleware for Express.js
 *
 * Supports both V1 (Ed25519) and V2 (composite hybrid signatures) bundles.
 *
 * Usage:
 *   import { dcpVerify } from '@dcp-ai/express';
 *   app.use('/api/agents/*', dcpVerify({ requireBundle: true }));
 */

import type { Request, Response, NextFunction } from 'express';

export interface DCPVerifyOptions {
  requireBundle?: boolean;
  checkRevocation?: boolean;
  revocationServiceUrl?: string;
  onFailure?: (req: Request, res: Response, errors: string[]) => void;
  headerName?: string;
  cacheTtlSeconds?: number;
  /** V2: Require hybrid composite signatures (default: false for backward compat). */
  requireHybrid?: boolean;
  /** V2: Verification policy override. */
  verifierPolicy?: {
    default_mode?: 'classical_only' | 'hybrid_required' | 'hybrid_preferred' | 'pq_only';
    require_session_binding?: boolean;
    require_composite_binding?: boolean;
  };
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
}

const _cache = new Map<string, { result: any; expires: number }>();

function getCached(key: string): any | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    _cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key: string, result: any, ttl: number): void {
  if (ttl <= 0) return;
  _cache.set(key, { result, expires: Date.now() + ttl * 1000 });
}

function detectVersion(obj: any): '1.0' | '2.0' | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.bundle?.dcp_bundle_version === '2.0') return '2.0';
  if (obj.bundle?.responsible_principal_record?.dcp_version === '1.0') return '1.0';
  return null;
}

function extractV2Agent(signedBundle: any): DCPAgent {
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

async function checkV2Bundle(signedBundle: any, options: DCPVerifyOptions): Promise<{ verified: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bundle = signedBundle.bundle;
  const signature = signedBundle.signature;

  if (!bundle || !signature) {
    errors.push('Missing bundle or signature fields');
    return { verified: false, errors, warnings };
  }

  if (bundle.dcp_bundle_version !== '2.0') {
    errors.push('Invalid dcp_bundle_version');
  }

  // Manifest integrity
  if (!bundle.manifest) {
    errors.push('Missing manifest');
  } else {
    if (!bundle.manifest.session_nonce || !/^[0-9a-f]{64}$/.test(bundle.manifest.session_nonce)) {
      errors.push('Invalid or missing session_nonce in manifest');
    }
    for (const field of ['rpr_hash', 'passport_hash', 'intent_hash', 'policy_hash', 'audit_merkle_root']) {
      if (!bundle.manifest[field]) {
        errors.push(`Missing manifest.${field}`);
      }
    }
  }

  // Required artifacts with SignedPayload envelope
  for (const field of ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision']) {
    const artifact = bundle[field];
    if (!artifact?.payload) {
      errors.push(`Missing or invalid ${field} (expected SignedPayload)`);
    } else if (!artifact.composite_sig) {
      errors.push(`Missing composite_sig in ${field}`);
    }
  }

  // Composite signature check
  if (signature.composite_sig) {
    const cs = signature.composite_sig;
    const policy = options.verifierPolicy || {};
    const mode = policy.default_mode || (options.requireHybrid ? 'hybrid_required' : 'hybrid_preferred');

    if (!cs.classical) {
      errors.push('Missing classical signature');
    }

    if (cs.binding === 'pq_over_classical' && !cs.pq) {
      errors.push('PQ signature missing despite pq_over_classical binding');
    }

    if (mode === 'hybrid_required' && cs.binding === 'classical_only') {
      errors.push('Verifier policy requires hybrid signatures');
    } else if (mode === 'hybrid_preferred' && cs.binding === 'classical_only') {
      warnings.push('Bundle uses classical_only binding (no PQ protection)');
    }

    if (policy.require_composite_binding && cs.binding !== 'pq_over_classical') {
      errors.push('Composite binding required but not present');
    }
  } else {
    errors.push('Missing composite_sig in bundle signature');
  }

  // Session binding validation
  const requireSessionBinding = options.verifierPolicy?.require_session_binding ?? true;
  if (requireSessionBinding && bundle.manifest) {
    const nonce = bundle.manifest.session_nonce;
    const artifacts = [
      bundle.agent_passport?.payload,
      bundle.responsible_principal_record?.payload,
      bundle.intent?.payload,
      bundle.policy_decision?.payload,
    ].filter(Boolean);

    for (const art of artifacts) {
      if (art.session_nonce && art.session_nonce !== nonce) {
        errors.push('Session nonce mismatch across artifacts');
        break;
      }
    }
  }

  // DCP-05: Lifecycle state check
  if (options.requireActiveLifecycle) {
    const passport = bundle.agent_passport?.payload;
    if (passport?.status === 'decommissioned') {
      errors.push('Agent is decommissioned (DCP-05 §5.1). Active lifecycle required.');
    }
  }

  return { verified: errors.length === 0, errors, warnings };
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
  } = options;

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
          const errors = ['Missing DCP signed bundle. Provide via X-DCP-Bundle header or body.signed_bundle.'];
          if (onFailure) return onFailure(req, res, errors);
          return res.status(403).json({ verified: false, errors });
        }
        return next();
      }

      // Cache check
      const cacheKey = JSON.stringify(signedBundle.signature?.composite_sig || signedBundle.signature?.sig_b64 || '');
      if (cacheTtlSeconds > 0 && cacheKey) {
        const cached = getCached(cacheKey);
        if (cached?.verified) {
          req.dcpAgent = cached.agent;
          return next();
        }
      }

      const version = detectVersion(signedBundle);

      if (version === '2.0') {
        // V2 verification path
        const { verified, errors, warnings } = await checkV2Bundle(signedBundle, options);

        if (!verified) {
          if (onFailure) return onFailure(req, res, errors);
          return res.status(403).json({ verified: false, errors, warnings });
        }

        const agent = extractV2Agent(signedBundle);

        // Revocation check
        if (checkRevocation) {
          const revoked = await checkRevocationStatus(agent.agentId, agent.kids, revocationServiceUrl);
          if (revoked) {
            const errors = ['Agent or key has been revoked'];
            if (onFailure) return onFailure(req, res, errors);
            return res.status(403).json({ verified: false, errors });
          }
        }

        if (cacheTtlSeconds > 0) {
          setCache(cacheKey, { verified: true, agent }, cacheTtlSeconds);
        }

        req.dcpAgent = agent;
        return next();
      }

      // V1 verification path
      const { verifySignedBundle } = await import('@dcp-ai/sdk');
      const result = verifySignedBundle(signedBundle);

      if (!result.verified) {
        const errors = result.errors || ['Verification failed'];
        if (onFailure) return onFailure(req, res, errors);
        return res.status(403).json({ verified: false, errors });
      }

      const agent = extractV1Agent(signedBundle);

      if (checkRevocation) {
        const revoked = await checkRevocationStatus(agent.agentId, undefined, revocationServiceUrl);
        if (revoked) {
          const errors = ['Agent has been revoked'];
          if (onFailure) return onFailure(req, res, errors);
          return res.status(403).json({ verified: false, errors });
        }
      }

      if (cacheTtlSeconds > 0) {
        setCache(cacheKey, { verified: true, agent }, cacheTtlSeconds);
      }

      req.dcpAgent = agent;
      next();
    } catch (err: any) {
      const errors = [`DCP verification error: ${err.message}`];
      if (onFailure) return onFailure(req, res, errors);
      return res.status(500).json({ verified: false, errors });
    }
  };
}
