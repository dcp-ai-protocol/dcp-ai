/**
 * DCP v2.0 Composite Signature Operations.
 *
 * Implements cryptographically-bound hybrid signatures where the PQ signature
 * covers the classical signature, preventing stripping attacks.
 *
 * Binding protocol:
 *   Step 1: classical_sig = Classical.sign(context || 0x00 || payload)
 *   Step 2: pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)
 *
 * Verification:
 *   Step 1: Verify pq_sig over (context || 0x00 || payload || classical_sig)
 *   Step 2: Verify classical_sig over (context || 0x00 || payload)
 */

import type { CryptoProvider } from './crypto-provider.js';
import type { CompositeSignature, SignatureEntry } from './composite-sig.js';
import type { DcpContext } from './domain-separation.js';
import { domainSeparatedMessage } from './domain-separation.js';
import { AlgorithmRegistry } from './crypto-registry.js';

export interface CompositeKeyInfo {
  kid: string;
  secretKeyB64: string;
  publicKeyB64: string;
  alg: string;
}

export interface CompositeKeyPair {
  classical: CompositeKeyInfo;
  pq: CompositeKeyInfo;
}

export interface CompositeVerifyResult {
  valid: boolean;
  classical_valid: boolean;
  pq_valid: boolean;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Produce a composite-bound hybrid signature.
 *
 * The PQ signature covers the classical signature, binding them together.
 * Stripping either component causes both to fail verification.
 */
export async function compositeSign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  keys: CompositeKeyPair,
): Promise<CompositeSignature> {
  const classical = registry.getSigner(keys.classical.alg);
  const pq = registry.getSigner(keys.pq.alg);

  const dsm = domainSeparatedMessage(context, canonicalPayloadBytes);

  const classicalSigBytes = await classical.sign(dsm, keys.classical.secretKeyB64);

  const compositeMessage = concat(dsm, classicalSigBytes);
  const pqSigBytes = await pq.sign(compositeMessage, keys.pq.secretKeyB64);

  const classicalEntry: SignatureEntry = {
    alg: keys.classical.alg,
    kid: keys.classical.kid,
    sig_b64: Buffer.from(classicalSigBytes).toString('base64'),
  };

  const pqEntry: SignatureEntry = {
    alg: keys.pq.alg,
    kid: keys.pq.kid,
    sig_b64: Buffer.from(pqSigBytes).toString('base64'),
  };

  return {
    classical: classicalEntry,
    pq: pqEntry,
    binding: 'pq_over_classical',
  };
}

/**
 * Produce a classical-only composite signature (transition mode).
 */
export async function classicalOnlySign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  key: CompositeKeyInfo,
): Promise<CompositeSignature> {
  const provider = registry.getSigner(key.alg);
  const dsm = domainSeparatedMessage(context, canonicalPayloadBytes);
  const sigBytes = await provider.sign(dsm, key.secretKeyB64);

  return {
    classical: {
      alg: key.alg,
      kid: key.kid,
      sig_b64: Buffer.from(sigBytes).toString('base64'),
    },
    pq: null,
    binding: 'classical_only',
  };
}

export type VerifyStrategy = 'parallel' | 'pq_first';

/**
 * Verify a composite-bound hybrid signature.
 *
 * For `pq_over_classical` binding:
 *   1. Verify PQ sig over (dsm || classical_sig) — fails if classical was tampered
 *   2. Verify classical sig over dsm
 *
 * Strategies:
 *   - `parallel` (default): Both verified concurrently via Promise.all
 *   - `pq_first`: PQ verified first; if it fails, skip classical (fast-fail)
 */
export async function compositeVerify(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  compositeSig: CompositeSignature,
  classicalPubkeyB64: string,
  pqPubkeyB64?: string,
  strategy: VerifyStrategy = 'parallel',
): Promise<CompositeVerifyResult> {
  const dsm = domainSeparatedMessage(context, canonicalPayloadBytes);

  if (compositeSig.binding === 'classical_only') {
    if (compositeSig.pq !== null) {
      return { valid: false, classical_valid: false, pq_valid: false };
    }
    const classicalProvider = registry.getSigner(compositeSig.classical.alg);
    const classicalSigBytes = Buffer.from(compositeSig.classical.sig_b64, 'base64');
    const classicalValid = await classicalProvider.verify(
      dsm,
      new Uint8Array(classicalSigBytes),
      classicalPubkeyB64,
    );
    return { valid: classicalValid, classical_valid: classicalValid, pq_valid: false };
  }

  if (compositeSig.binding !== 'pq_over_classical') {
    return { valid: false, classical_valid: false, pq_valid: false };
  }

  if (!compositeSig.pq || !pqPubkeyB64) {
    return { valid: false, classical_valid: false, pq_valid: false };
  }

  const classicalProvider = registry.getSigner(compositeSig.classical.alg);
  const pqProvider = registry.getSigner(compositeSig.pq.alg);

  const classicalSigBytes = new Uint8Array(
    Buffer.from(compositeSig.classical.sig_b64, 'base64'),
  );
  const pqSigBytes = new Uint8Array(
    Buffer.from(compositeSig.pq.sig_b64, 'base64'),
  );

  const compositeMessage = concat(dsm, classicalSigBytes);

  if (strategy === 'pq_first') {
    const pqValid = await pqProvider.verify(compositeMessage, pqSigBytes, pqPubkeyB64);
    if (!pqValid) {
      return { valid: false, classical_valid: false, pq_valid: false };
    }
    const classicalValid = await classicalProvider.verify(dsm, classicalSigBytes, classicalPubkeyB64);
    return {
      valid: classicalValid && pqValid,
      classical_valid: classicalValid,
      pq_valid: pqValid,
    };
  }

  const [classicalValid, pqValid] = await Promise.all([
    classicalProvider.verify(dsm, classicalSigBytes, classicalPubkeyB64),
    pqProvider.verify(compositeMessage, pqSigBytes, pqPubkeyB64),
  ]);

  return {
    valid: classicalValid && pqValid,
    classical_valid: classicalValid,
    pq_valid: pqValid,
  };
}
