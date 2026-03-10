/**
 * DCP-07 v2.0 Arbitration & Jurisprudence.
 *
 * Implements arbitration panels (reusing M-of-N governance ceremony pattern),
 * resolution submission, jurisprudence bundle creation, and precedent lookup.
 */

import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type {
  AuthorityLevel,
  ArbitrationResolution,
  JurisprudenceBundle,
} from '../types/v2.js';

export interface ArbitrationPanel {
  arbitrator_ids: string[];
  threshold: number;
  created_at: string;
}

/**
 * Create an arbitration panel (M-of-N pattern from governance.ts).
 */
export function createArbitrationPanel(
  arbitratorIds: string[],
  threshold: number,
): ArbitrationPanel {
  if (arbitratorIds.length < threshold) {
    throw new Error(
      `Arbitration panel: need at least ${threshold} arbitrators, got ${arbitratorIds.length}`,
    );
  }
  if (threshold < 1) {
    throw new Error('Arbitration panel: threshold must be >= 1');
  }

  return {
    arbitrator_ids: arbitratorIds,
    threshold,
    created_at: new Date().toISOString(),
  };
}

/**
 * Submit a resolution for a dispute.
 */
export async function submitResolution(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    dispute_id: string;
    session_nonce: string;
    arbitrator_ids: string[];
    resolution: string;
    binding: boolean;
    precedent_references?: string[];
  },
): Promise<ArbitrationResolution> {
  const payload = {
    dcp_version: '2.0' as const,
    dispute_id: params.dispute_id,
    session_nonce: params.session_nonce,
    arbitrator_ids: params.arbitrator_ids,
    resolution: params.resolution,
    binding: params.binding,
    precedent_references: params.precedent_references,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Dispute, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Build a jurisprudence bundle from a resolved dispute.
 */
export async function buildJurisprudenceBundle(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    jurisprudence_id: string;
    session_nonce: string;
    dispute_id: string;
    resolution_id: string;
    category: string;
    precedent_summary: string;
    applicable_contexts: string[];
    authority_level: AuthorityLevel;
  },
): Promise<JurisprudenceBundle> {
  const payload = {
    dcp_version: '2.0' as const,
    jurisprudence_id: params.jurisprudence_id,
    session_nonce: params.session_nonce,
    dispute_id: params.dispute_id,
    resolution_id: params.resolution_id,
    category: params.category,
    precedent_summary: params.precedent_summary,
    applicable_contexts: params.applicable_contexts,
    authority_level: params.authority_level,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Dispute, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Lookup precedent from a jurisprudence collection.
 */
export function lookupPrecedent(
  jurisprudence: JurisprudenceBundle[],
  category: string,
  context?: string,
): JurisprudenceBundle[] {
  return jurisprudence.filter((j) => {
    if (j.category !== category) return false;
    if (context && !j.applicable_contexts.includes(context)) return false;
    return true;
  });
}
