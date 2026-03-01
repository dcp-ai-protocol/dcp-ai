/**
 * DCP v2.0 Dual-Hash infrastructure (SHA-256 + SHA3-256).
 *
 * Running two independent hash families from day one provides defense-in-depth:
 * SHA-2 (Merkle-Damgård) and SHA-3 (Keccak sponge) use completely different
 * internal constructions, so a break in one is unlikely to affect the other.
 */

import { createHash } from 'crypto';

export interface DualHash {
  sha256: string;
  sha3_256: string;
}

export function sha256Hex(data: Uint8Array | Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha3_256Hex(data: Uint8Array | Buffer | string): string {
  return createHash('sha3-256').update(data).digest('hex');
}

/** Compute both SHA-256 and SHA3-256 over the same input. */
export function dualHash(data: Uint8Array | Buffer | string): DualHash {
  return {
    sha256: sha256Hex(data),
    sha3_256: sha3_256Hex(data),
  };
}

/** Dual-hash a canonicalized JSON payload (as UTF-8 bytes). */
export function dualHashCanonical(canonicalJson: string): DualHash {
  const bytes = Buffer.from(canonicalJson, 'utf8');
  return dualHash(bytes);
}

/** Compute dual Merkle roots from hex leaf hashes. */
export function dualMerkleRoot(leaves: DualHash[]): DualHash | null {
  if (!leaves || leaves.length === 0) return null;

  let sha2Layer = leaves.map((l) => l.sha256);
  let sha3Layer = leaves.map((l) => l.sha3_256);

  sha2Layer = merkleReduce(sha2Layer, 'sha256');
  sha3Layer = merkleReduce(sha3Layer, 'sha3-256');

  return { sha256: sha2Layer[0], sha3_256: sha3Layer[0] };
}

function merkleReduce(leaves: string[], hashAlg: string): string[] {
  let layer = leaves.slice();
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = Buffer.from(layer[i], 'hex');
      const right = Buffer.from(layer[i + 1], 'hex');
      next.push(
        createHash(hashAlg)
          .update(Buffer.concat([left, right]))
          .digest('hex'),
      );
    }
    layer = next;
  }
  return layer;
}
