/**
 * DCP-08 v2.0 Rights & Obligations.
 *
 * Implements rights declarations, obligation recording, violation reporting,
 * and compliance checking. Rights violations can optionally create disputes
 * via DCP-07 integration.
 */

import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type {
  RightType,
  ComplianceStatus,
  RightEntry,
  RightsDeclaration,
  ObligationRecord,
  RightsViolationReport,
} from '../types/v2.js';

/**
 * Declare rights for an agent (typically invoked at commissioning).
 */
export async function declareRights(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    declaration_id: string;
    session_nonce: string;
    agent_id: string;
    rights: RightEntry[];
    jurisdiction: string;
  },
): Promise<RightsDeclaration> {
  const payload = {
    dcp_version: '2.0' as const,
    declaration_id: params.declaration_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    rights: params.rights,
    jurisdiction: params.jurisdiction,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Rights, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Record an obligation between an agent and its responsible principal.
 */
export async function recordObligation(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    obligation_id: string;
    session_nonce: string;
    agent_id: string;
    human_id: string;
    obligation_type: string;
    compliance_status: ComplianceStatus;
    evidence_hashes: string[];
  },
): Promise<ObligationRecord> {
  const payload = {
    dcp_version: '2.0' as const,
    obligation_id: params.obligation_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    human_id: params.human_id,
    obligation_type: params.obligation_type,
    compliance_status: params.compliance_status,
    evidence_hashes: params.evidence_hashes,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Rights, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Report a rights violation. Optionally links to a DCP-07 dispute.
 */
export async function reportViolation(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    violation_id: string;
    session_nonce: string;
    agent_id: string;
    violated_right: RightType;
    evidence_hashes: string[];
    dispute_id: string | null;
  },
): Promise<RightsViolationReport> {
  const payload = {
    dcp_version: '2.0' as const,
    violation_id: params.violation_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    violated_right: params.violated_right,
    evidence_hashes: params.evidence_hashes,
    dispute_id: params.dispute_id,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Rights, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Check rights compliance for an agent against its declared rights.
 */
export function checkRightsCompliance(
  declaration: RightsDeclaration,
  obligations: ObligationRecord[],
): { compliant: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const obligation of obligations) {
    if (obligation.compliance_status === 'non_compliant') {
      violations.push(
        `Obligation ${obligation.obligation_id} (${obligation.obligation_type}) is non-compliant`,
      );
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}
