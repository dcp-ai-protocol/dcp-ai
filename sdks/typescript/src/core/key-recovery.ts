/**
 * DCP v2.0 Key Recovery — M-of-N Shamir's Secret Sharing (Gap #1).
 *
 * At identity creation time, the human's master secret is split into N shares
 * using Shamir's Secret Sharing over GF(256). Any M shares can reconstruct
 * the original secret. Shares are distributed to recovery contacts.
 *
 * This is a pure implementation of Shamir's scheme over GF(2^8) using the
 * irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11B, same as AES).
 */

import { randomBytes } from 'crypto';
import type { RecoveryConfig, RecoveryShareHolder, CompositeSignature } from '../types/v2.js';

export interface ShamirShare {
  index: number;
  data: Uint8Array;
}

export interface RecoverySetup {
  config: Omit<RecoveryConfig, 'composite_sig'>;
  shares: ShamirShare[];
}

// GF(2^8) arithmetic with irreducible polynomial x^8 + x^4 + x^3 + x + 1

const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);

(function initGF256Tables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    // Multiply by generator 0x03 (primitive root of GF(256) with AES polynomial)
    let doubled = (x << 1) & 0x1ff;
    if (doubled & 0x100) doubled ^= 0x11b;
    x = doubled ^ x;
  }
  EXP_TABLE[255] = EXP_TABLE[0];
})();

function gf256Mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 255];
}

function gf256Div(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] - LOG_TABLE[b] + 255) % 255];
}

/**
 * Evaluate a polynomial at x in GF(256).
 * coefficients[0] is the constant term (the secret byte).
 */
function evaluatePolynomial(coefficients: Uint8Array, x: number): number {
  if (x === 0) throw new Error('Cannot evaluate at x=0 (reserved for secret)');
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    result = gf256Mul(result, x) ^ coefficients[i];
  }
  return result;
}

/**
 * Split a secret byte array into N shares with threshold M using Shamir's
 * Secret Sharing over GF(2^8). Each byte of the secret is independently
 * split with a fresh random polynomial of degree M-1.
 *
 * @param secret - The secret to split
 * @param threshold - Minimum shares needed for reconstruction (M)
 * @param totalShares - Total number of shares to generate (N), max 255
 * @returns Array of N shares, each with a 1-based index
 */
export function shamirSplit(
  secret: Uint8Array,
  threshold: number,
  totalShares: number,
): ShamirShare[] {
  if (threshold < 2) throw new Error('Threshold must be >= 2');
  if (totalShares < threshold) throw new Error('totalShares must be >= threshold');
  if (totalShares > 255) throw new Error('totalShares must be <= 255');
  if (secret.length === 0) throw new Error('Secret must not be empty');

  const shares: ShamirShare[] = [];
  for (let i = 0; i < totalShares; i++) {
    shares.push({ index: i + 1, data: new Uint8Array(secret.length) });
  }

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coefficients = new Uint8Array(threshold);
    coefficients[0] = secret[byteIdx];
    const rnd = randomBytes(threshold - 1);
    for (let c = 1; c < threshold; c++) {
      coefficients[c] = rnd[c - 1];
    }

    for (let s = 0; s < totalShares; s++) {
      shares[s].data[byteIdx] = evaluatePolynomial(coefficients, shares[s].index);
    }
  }

  return shares;
}

/**
 * Reconstruct the secret from M or more Shamir shares using Lagrange
 * interpolation over GF(2^8).
 *
 * @param shares - At least `threshold` shares
 * @returns The reconstructed secret
 */
export function shamirReconstruct(shares: ShamirShare[]): Uint8Array {
  if (shares.length < 2) throw new Error('Need at least 2 shares to reconstruct');

  const secretLen = shares[0].data.length;
  for (const s of shares) {
    if (s.data.length !== secretLen) {
      throw new Error('All shares must have the same length');
    }
  }

  const secret = new Uint8Array(secretLen);
  const xs = shares.map((s) => s.index);

  for (let byteIdx = 0; byteIdx < secretLen; byteIdx++) {
    let value = 0;
    for (let i = 0; i < shares.length; i++) {
      let lagrangeBasis = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        // basis_i = product of (x_j / (x_j ^ x_i)) for j != i, evaluated at x=0
        // At x=0: (0 ^ x_j) / (x_i ^ x_j) = x_j / (x_i ^ x_j)
        lagrangeBasis = gf256Mul(
          lagrangeBasis,
          gf256Div(xs[j], xs[i] ^ xs[j]),
        );
      }
      value ^= gf256Mul(shares[i].data[byteIdx], lagrangeBasis);
    }
    secret[byteIdx] = value;
  }

  return secret;
}

/**
 * Set up key recovery for a human identity.
 *
 * @param params - Recovery parameters
 * @returns RecoverySetup with the config (to publish) and shares (to distribute)
 */
export function setupKeyRecovery(params: {
  humanId: string;
  masterSecret: Uint8Array;
  threshold: number;
  holders: Array<{ holderId: string; holderKid: string }>;
}): RecoverySetup {
  const totalShares = params.holders.length;
  if (totalShares < params.threshold) {
    throw new Error('Number of holders must be >= threshold');
  }

  const shares = shamirSplit(params.masterSecret, params.threshold, totalShares);

  const shareHolders: RecoveryShareHolder[] = params.holders.map((h, i) => ({
    holder_id: h.holderId,
    share_index: i + 1,
    holder_kid: h.holderKid,
  }));

  return {
    config: {
      type: 'recovery_config',
      human_id: params.humanId,
      threshold: params.threshold,
      total_shares: totalShares,
      share_holders: shareHolders,
      created_at: new Date().toISOString(),
    },
    shares,
  };
}
