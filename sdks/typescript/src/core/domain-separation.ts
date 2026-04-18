/**
 * DCP v2.0 Domain Separation.
 *
 * Every V2 signature includes a context tag to prevent cross-artifact replay.
 * signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
 */

export const DCP_CONTEXTS = {
  AgentPassport: 'DCP-AI.v2.AgentPassport',
  ResponsiblePrincipal: 'DCP-AI.v2.ResponsiblePrincipal',
  Intent: 'DCP-AI.v2.Intent',
  PolicyDecision: 'DCP-AI.v2.PolicyDecision',
  AuditEvent: 'DCP-AI.v2.AuditEvent',
  Bundle: 'DCP-AI.v2.Bundle',
  Revocation: 'DCP-AI.v2.Revocation',
  KeyRotation: 'DCP-AI.v2.KeyRotation',
  ProofOfPossession: 'DCP-AI.v2.ProofOfPossession',
  JurisdictionAttestation: 'DCP-AI.v2.JurisdictionAttestation',
  HumanConfirmation: 'DCP-AI.v2.HumanConfirmation',
  MultiPartyAuth: 'DCP-AI.v2.MultiPartyAuth',
  // DCP-05: Agent Lifecycle
  Lifecycle: 'DCP-AI.v2.Lifecycle',
  // DCP-06: Succession
  Succession: 'DCP-AI.v2.Succession',
  // DCP-07: Dispute Resolution
  Dispute: 'DCP-AI.v2.Dispute',
  // DCP-08: Rights & Obligations
  Rights: 'DCP-AI.v2.Rights',
  // DCP-09: Delegation & Representation
  Delegation: 'DCP-AI.v2.Delegation',
  Awareness: 'DCP-AI.v2.Awareness',
} as const;

export type DcpContext = (typeof DCP_CONTEXTS)[keyof typeof DCP_CONTEXTS];

const VALID_CONTEXTS = new Set<string>(Object.values(DCP_CONTEXTS));

/**
 * Build the domain-separated message that gets signed.
 * Format: UTF8(context_tag) || 0x00 || canonical_payload_bytes
 */
export function domainSeparatedMessage(
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
): Uint8Array {
  if (!VALID_CONTEXTS.has(context)) {
    throw new Error(`Invalid DCP context tag: ${context}`);
  }
  const encoder = new TextEncoder();
  const ctxBytes = encoder.encode(context);
  const separator = new Uint8Array([0x00]);
  const result = new Uint8Array(
    ctxBytes.length + 1 + canonicalPayloadBytes.length,
  );
  result.set(ctxBytes, 0);
  result.set(separator, ctxBytes.length);
  result.set(canonicalPayloadBytes, ctxBytes.length + 1);
  return result;
}
