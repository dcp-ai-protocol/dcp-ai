/**
 * @dcp-ai/express — DCP verification middleware for Express.js
 *
 * Usage:
 *   import { dcpVerify } from '@dcp-ai/express';
 *   app.use('/api/agents/*', dcpVerify({ requireBundle: true }));
 */

import type { Request, Response, NextFunction } from 'express';

// Re-export types for convenience
export interface DCPVerifyOptions {
  /** Require a DCP bundle on every request (default: true). */
  requireBundle?: boolean;
  /** Check revocation status (default: false). */
  checkRevocation?: boolean;
  /** Custom failure handler. */
  onFailure?: (req: Request, res: Response, errors: string[]) => void;
  /** Header name for the signed bundle (default: 'x-dcp-bundle'). */
  headerName?: string;
  /** Cache verification results for N seconds (default: 0 = no cache). */
  cacheTtlSeconds?: number;
}

export interface DCPAgent {
  agentId: string;
  humanId: string;
  publicKey: string;
  capabilities: string[];
  riskTier: string;
  status: string;
}

// Simple LRU cache for verification results
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

/**
 * Express middleware that verifies DCP signed bundles.
 * Extracts the bundle from X-DCP-Bundle header or request body.
 * On success, injects `req.dcpAgent` with agent metadata.
 */
export function dcpVerify(options: DCPVerifyOptions = {}) {
  const {
    requireBundle = true,
    checkRevocation = false,
    onFailure,
    headerName = 'x-dcp-bundle',
    cacheTtlSeconds = 0,
  } = options;

  return async (req: Request & { dcpAgent?: DCPAgent }, res: Response, next: NextFunction) => {
    try {
      // Dynamic import to avoid hard dependency at module level
      const { verifySignedBundle } = await import('@dcp-ai/sdk');

      // Extract signed bundle from header or body
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

      // Check cache
      const cacheKey = signedBundle.signature?.sig_b64;
      if (cacheTtlSeconds > 0 && cacheKey) {
        const cached = getCached(cacheKey);
        if (cached?.verified) {
          req.dcpAgent = cached.agent;
          return next();
        }
      }

      // Verify
      const result = verifySignedBundle(signedBundle);

      if (!result.verified) {
        const errors = result.errors || ['Verification failed'];
        if (onFailure) return onFailure(req, res, errors);
        return res.status(403).json({ verified: false, errors });
      }

      // Extract agent info
      const bundle = signedBundle.bundle;
      const agent: DCPAgent = {
        agentId: bundle.agent_passport?.agent_id || '',
        humanId: bundle.human_binding_record?.human_id || '',
        publicKey: bundle.agent_passport?.public_key || '',
        capabilities: bundle.agent_passport?.capabilities || [],
        riskTier: bundle.agent_passport?.risk_tier || 'medium',
        status: bundle.agent_passport?.status || 'active',
      };

      // Check revocation (placeholder — integrate with revocation service)
      if (checkRevocation && agent.status === 'revoked') {
        const errors = ['Agent has been revoked'];
        if (onFailure) return onFailure(req, res, errors);
        return res.status(403).json({ verified: false, errors });
      }

      // Cache and proceed
      if (cacheTtlSeconds > 0 && cacheKey) {
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
