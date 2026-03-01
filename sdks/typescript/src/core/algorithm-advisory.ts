/**
 * DCP v2.0 Algorithm Deprecation Advisory System (Gap #4).
 *
 * Provides a mechanism for coordinated ecosystem response to algorithm
 * breaks. Signed advisories are published by governance key holders and
 * consumed by verifiers to automatically deprecate/warn about affected
 * algorithms.
 *
 * Distribution: https://dcp-ai.org/.well-known/algorithm-advisories.json
 * Polling interval: configurable, default daily.
 */

import type {
  AlgorithmAdvisory,
  AdvisorySeverity,
  AdvisoryAction,
} from '../types/v2.js';
import type { CompositeSignature } from './composite-sig.js';
import { compositeVerify } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';

const ADVISORY_CONTEXT = 'DCP-AI.v2.AlgorithmAdvisory';

export interface AdvisoryCheckResult {
  affectedAlgorithms: string[];
  action: AdvisoryAction;
  severity: AdvisorySeverity;
  advisory_id: string;
  description: string;
  gracePeriodExpired: boolean;
}

/**
 * Check an advisory against the current date.
 *
 * Returns whether the advisory is active and whether its grace period
 * has expired.
 */
export function checkAdvisory(advisory: AlgorithmAdvisory, now?: Date): AdvisoryCheckResult {
  const currentDate = now || new Date();
  const effectiveDate = new Date(advisory.effective_date);
  const graceEnd = new Date(effectiveDate.getTime() + advisory.grace_period_days * 86400000);

  return {
    affectedAlgorithms: advisory.affected_algorithms,
    action: advisory.action,
    severity: advisory.severity,
    advisory_id: advisory.advisory_id,
    description: advisory.description,
    gracePeriodExpired: currentDate >= graceEnd,
  };
}

/**
 * Given a list of advisories, determine which algorithms are currently
 * deprecated, warned, or revoked.
 */
export function evaluateAdvisories(
  advisories: AlgorithmAdvisory[],
  now?: Date,
): {
  deprecated: Set<string>;
  warned: Set<string>;
  revoked: Set<string>;
  activeAdvisories: AdvisoryCheckResult[];
} {
  const currentDate = now || new Date();
  const deprecated = new Set<string>();
  const warned = new Set<string>();
  const revoked = new Set<string>();
  const activeAdvisories: AdvisoryCheckResult[] = [];

  for (const advisory of advisories) {
    const effectiveDate = new Date(advisory.effective_date);
    if (currentDate < effectiveDate) continue;

    const result = checkAdvisory(advisory, currentDate);
    activeAdvisories.push(result);

    for (const alg of advisory.affected_algorithms) {
      switch (advisory.action) {
        case 'deprecate':
          if (result.gracePeriodExpired) {
            deprecated.add(alg);
          } else {
            warned.add(alg);
          }
          break;
        case 'warn':
          warned.add(alg);
          break;
        case 'revoke':
          revoked.add(alg);
          break;
      }
    }
  }

  return { deprecated, warned, revoked, activeAdvisories };
}

/**
 * Apply advisory results to a verifier's accepted algorithms.
 *
 * Revoked and deprecated (post-grace) algorithms are removed.
 * Warned algorithms remain but generate warnings in verification output.
 */
export function applyAdvisoriesToPolicy(
  acceptedAlgs: string[],
  advisoryResult: ReturnType<typeof evaluateAdvisories>,
): {
  filteredAlgs: string[];
  removedAlgs: string[];
  warnings: string[];
} {
  const removedAlgs: string[] = [];
  const warnings: string[] = [];
  const blocked = new Set([...advisoryResult.deprecated, ...advisoryResult.revoked]);

  const filteredAlgs = acceptedAlgs.filter((alg) => {
    if (blocked.has(alg)) {
      removedAlgs.push(alg);
      return false;
    }
    if (advisoryResult.warned.has(alg)) {
      warnings.push(`Algorithm ${alg} has an active advisory warning`);
    }
    return true;
  });

  return { filteredAlgs, removedAlgs, warnings };
}

/**
 * Fetch advisories from a remote endpoint.
 * Falls back to an empty list on network errors.
 */
export async function fetchAdvisories(
  url: string = 'https://dcp-ai.org/.well-known/algorithm-advisories.json',
): Promise<AlgorithmAdvisory[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : (data.advisories || []);
  } catch {
    return [];
  }
}

/**
 * Advisory poller that checks for new advisories at a configurable interval.
 */
export class AdvisoryPoller {
  private advisories: AlgorithmAdvisory[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly url: string = 'https://dcp-ai.org/.well-known/algorithm-advisories.json',
    private readonly intervalMs: number = 86400000,
  ) {}

  async poll(): Promise<AlgorithmAdvisory[]> {
    this.advisories = await fetchAdvisories(this.url);
    return this.advisories;
  }

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getAdvisories(): AlgorithmAdvisory[] {
    return [...this.advisories];
  }

  evaluate(now?: Date): ReturnType<typeof evaluateAdvisories> {
    return evaluateAdvisories(this.advisories, now);
  }
}

// ── Phase 3: Automated Verifier Response to Advisories ──

import type { VerifierPolicy } from '../types/v2.js';

export interface AdvisoryAutoResponseResult {
  policyModified: boolean;
  removedClassicalAlgs: string[];
  removedPqAlgs: string[];
  addedReplacements: string[];
  warnings: string[];
  escalatedToGovernance: boolean;
}

/**
 * Automatically apply active advisories to a verifier policy.
 *
 * This is the Phase 3 automated response mechanism. When an advisory is
 * published by governance and its effective date has passed:
 *
 *   - `warn`: affected algorithms remain accepted; verification emits warnings
 *   - `deprecate` (grace period): same as warn
 *   - `deprecate` (post-grace): affected algorithms removed from accepted lists
 *   - `revoke`: affected algorithms immediately removed; replacement algorithms
 *     are added to accepted lists if not already present
 *
 * Critical advisories with `revoke` action also set the advisory_rejected_algs
 * field so the verifier hard-rejects bundles using those algorithms.
 */
export function autoApplyAdvisoriesToPolicy(
  policy: VerifierPolicy,
  advisories: AlgorithmAdvisory[],
  now?: Date,
): AdvisoryAutoResponseResult {
  const currentDate = now || new Date();
  const result: AdvisoryAutoResponseResult = {
    policyModified: false,
    removedClassicalAlgs: [],
    removedPqAlgs: [],
    addedReplacements: [],
    warnings: [],
    escalatedToGovernance: false,
  };

  const evaluation = evaluateAdvisories(advisories, currentDate);

  const blocked = new Set([...evaluation.deprecated, ...evaluation.revoked]);

  // Remove blocked algorithms from classical list
  const newClassical = policy.accepted_classical_algs.filter((alg) => {
    if (blocked.has(alg)) {
      result.removedClassicalAlgs.push(alg);
      result.policyModified = true;
      return false;
    }
    if (evaluation.warned.has(alg)) {
      result.warnings.push(`Classical algorithm '${alg}' has active advisory warning`);
    }
    return true;
  });

  // Remove blocked algorithms from PQ list
  const newPq = policy.accepted_pq_algs.filter((alg) => {
    if (blocked.has(alg)) {
      result.removedPqAlgs.push(alg);
      result.policyModified = true;
      return false;
    }
    if (evaluation.warned.has(alg)) {
      result.warnings.push(`PQ algorithm '${alg}' has active advisory warning`);
    }
    return true;
  });

  // Add replacement algorithms from active advisories
  for (const advisory of evaluation.activeAdvisories) {
    if (advisory.action === 'revoke' || (advisory.action === 'deprecate' && advisory.gracePeriodExpired)) {
      const sourceAdvisory = advisories.find((a) => a.advisory_id === advisory.advisory_id);
      if (sourceAdvisory) {
        for (const replacement of sourceAdvisory.replacement_algorithms) {
          if (!newPq.includes(replacement) && !newClassical.includes(replacement)) {
            newPq.push(replacement);
            result.addedReplacements.push(replacement);
            result.policyModified = true;
          }
        }
      }
    }
  }

  // Critical revocations with all PQ algorithms removed escalate to governance
  if (newPq.length === 0 && policy.accepted_pq_algs.length > 0) {
    result.escalatedToGovernance = true;
    result.warnings.push(
      'CRITICAL: All PQ algorithms removed by advisory. Escalating to governance. ' +
      'Manual intervention required to restore PQ capability.',
    );
  }

  // Apply changes
  if (result.policyModified) {
    policy.accepted_classical_algs = newClassical;
    policy.accepted_pq_algs = newPq;
    policy.advisory_rejected_algs = [...blocked];

    // If all classical algs removed and PQ still available, auto-switch to pq_only
    if (newClassical.length === 0 && newPq.length > 0) {
      policy.default_mode = 'pq_only';
      policy.min_classical = 0;
      policy.require_composite_binding = false;
      policy.allow_classical_fallback_disable = true;
      result.warnings.push(
        'All classical algorithms deprecated/revoked. Auto-switching to pq_only mode.',
      );
    }
  }

  return result;
}

/**
 * Governance-signed advisory verification.
 *
 * Verifies that an advisory is signed by at least `threshold` governance
 * key holders before applying it.
 */
export async function verifyGovernanceAdvisory(
  advisory: AlgorithmAdvisory,
  governanceSignatures: Array<{ party_id: string; kid: string; sig_b64: string }>,
  governancePublicKeys: Map<string, string>,
  threshold: number,
  registry: AlgorithmRegistry,
): Promise<{ valid: boolean; signaturesVerified: number; errors: string[] }> {
  const errors: string[] = [];
  let verified = 0;

  const advisoryBytes = new TextEncoder().encode(
    JSON.stringify({
      advisory_id: advisory.advisory_id,
      affected_algorithms: advisory.affected_algorithms,
      action: advisory.action,
      effective_date: advisory.effective_date,
      issued_at: advisory.issued_at,
    }),
  );

  const contextTag = 'DCP-AI.v2.AlgorithmAdvisory';
  const separator = new Uint8Array([0x00]);
  const contextBytes = new TextEncoder().encode(contextTag);
  const dsm = new Uint8Array(contextBytes.length + 1 + advisoryBytes.length);
  dsm.set(contextBytes);
  dsm.set(separator, contextBytes.length);
  dsm.set(advisoryBytes, contextBytes.length + 1);

  for (const sig of governanceSignatures) {
    const pubkey = governancePublicKeys.get(sig.kid);
    if (!pubkey) {
      errors.push(`Governance key ${sig.kid} not found`);
      continue;
    }

    try {
      const alg = sig.kid.includes('mldsa') ? 'ml-dsa-65' : 'ed25519';
      const provider = registry.getSigner(alg);
      const sigBytes = new Uint8Array(Buffer.from(sig.sig_b64, 'base64'));
      const valid = await provider.verify(dsm, sigBytes, pubkey);
      if (valid) verified++;
      else errors.push(`Signature from ${sig.party_id} (${sig.kid}) invalid`);
    } catch (err) {
      errors.push(`Error verifying ${sig.party_id}: ${(err as Error).message}`);
    }
  }

  return {
    valid: verified >= threshold,
    signaturesVerified: verified,
    errors,
  };
}
