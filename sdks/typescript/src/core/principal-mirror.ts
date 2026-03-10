/**
 * DCP-09 v2.0 Principal Mirror.
 *
 * Generates human-readable narrative summaries of agent actions,
 * synthesized from audit chains. Provides transparency without
 * requiring the principal to read raw audit trails.
 */

import { createHash } from 'crypto';
import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type { PrincipalMirror, AuditEventV2 } from '../types/v2.js';

/**
 * Generate a principal mirror narrative from an audit chain.
 */
export async function generateMirror(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    mirror_id: string;
    session_nonce: string;
    agent_id: string;
    human_id: string;
    period: { from: string; to: string };
    audit_entries: AuditEventV2[];
    narrative: string;
    decision_summary: string;
  },
): Promise<PrincipalMirror> {
  const auditChainHash = computeAuditChainHash(params.audit_entries);

  const payload = {
    dcp_version: '2.0' as const,
    mirror_id: params.mirror_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    human_id: params.human_id,
    period: params.period,
    narrative: params.narrative,
    action_count: params.audit_entries.length,
    decision_summary: params.decision_summary,
    audit_chain_hash: auditChainHash,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Delegation, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Compute a hash over the audit chain entries for integrity binding.
 */
function computeAuditChainHash(entries: AuditEventV2[]): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(canonicalizeV2(entry));
  }
  return 'sha256:' + hash.digest('hex');
}
