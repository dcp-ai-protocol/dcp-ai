/**
 * DCP v2.0 Composite Signature types.
 *
 * Composite signatures cryptographically bind classical and PQ signatures
 * to prevent stripping attacks. The PQ signature covers the classical
 * signature, so removing either component breaks verification.
 */

export type BindingMode = 'pq_over_classical' | 'classical_only';

export interface SignatureEntry {
  alg: string;
  kid: string;
  sig_b64: string;
}

export interface CompositeSignature {
  classical: SignatureEntry;
  pq: SignatureEntry | null;
  binding: BindingMode;
}
