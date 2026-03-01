/**
 * DCP v2.0 CryptoProvider and KemProvider interfaces.
 *
 * All signature algorithms and KEMs are accessed through these interfaces,
 * enabling crypto-agility: swap Ed25519 for ML-DSA-65 without changing
 * calling code.
 */

import { createHash } from 'crypto';
import type { CompositeSignature } from './composite-sig.js';

// ── Signature provider ──

export interface CryptoProvider {
  readonly alg: string;
  readonly keySize: number;
  readonly sigSize: number;
  readonly isConstantTime: boolean;

  generateKeypair(): Promise<{
    kid: string;
    publicKeyB64: string;
    secretKeyB64: string;
  }>;
  sign(message: Uint8Array, secretKeyB64: string): Promise<Uint8Array>;
  verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKeyB64: string,
  ): Promise<boolean>;
}

// ── KEM provider (optional, for encryption) ──

export interface KemProvider {
  readonly alg: string;

  generateKeypair(): Promise<{
    publicKeyB64: string;
    secretKeyB64: string;
  }>;
  encapsulate(publicKeyB64: string): Promise<{
    sharedSecret: Uint8Array;
    ciphertextB64: string;
  }>;
  decapsulate(
    ciphertextB64: string,
    secretKeyB64: string,
  ): Promise<Uint8Array>;
}

// ── Composite operations ──

export interface CompositeOps {
  compositeSign(
    context: string,
    payload: Uint8Array,
    classicalSecret: string,
    pqSecret: string,
  ): Promise<CompositeSignature>;

  compositeVerify(
    context: string,
    payload: Uint8Array,
    compositeSig: CompositeSignature,
    classicalPubkey: string,
    pqPubkey: string,
  ): Promise<{
    valid: boolean;
    classical_valid: boolean;
    pq_valid: boolean;
  }>;
}

// ── Key entry (V2 key object) ──

export type KeyStatus = 'active' | 'revoked' | 'expired';

export interface KeyEntry {
  kid: string;
  alg: string;
  public_key_b64: string;
  created_at: string;
  expires_at: string | null;
  status: KeyStatus;
}

// ── Deterministic kid derivation ──

/**
 * Derive a deterministic key identifier from algorithm name and public key bytes.
 *
 * kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
 *
 * This guarantees uniqueness and determinism: any SDK can recompute the kid.
 */
export function deriveKid(alg: string, publicKeyBytes: Uint8Array): string {
  const encoder = new TextEncoder();
  const algBytes = encoder.encode(alg);
  const separator = new Uint8Array([0x00]);
  const input = new Uint8Array(
    algBytes.length + 1 + publicKeyBytes.length,
  );
  input.set(algBytes, 0);
  input.set(separator, algBytes.length);
  input.set(publicKeyBytes, algBytes.length + 1);
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}
