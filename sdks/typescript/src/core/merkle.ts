/**
 * SHA-256 hashing and Merkle tree operations for DCP.
 */
import { createHash } from 'crypto';
import { canonicalize } from './crypto.js';

function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Compute the SHA-256 hash of a canonicalized JSON object. */
export function hashObject(obj: unknown): string {
  const canon = canonicalize(obj);
  return sha256Hex(Buffer.from(canon, 'utf8'));
}

/** Compute Merkle root from an array of hex leaf hashes. */
export function merkleRootFromHexLeaves(leaves: string[]): string | null {
  if (!leaves || leaves.length === 0) return null;
  let layer = leaves.slice();
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = Buffer.from(layer[i], 'hex');
      const right = Buffer.from(layer[i + 1], 'hex');
      next.push(sha256Hex(Buffer.concat([left, right])));
    }
    layer = next;
  }
  return layer[0];
}

/** Compute Merkle root for an array of audit entries. */
export function merkleRootForAuditEntries(auditEntries: unknown[]): string | null {
  const leaves = auditEntries.map(hashObject);
  return merkleRootFromHexLeaves(leaves);
}

/** Compute intent_hash for an Intent object (DCP-02). */
export function intentHash(intent: unknown): string {
  return hashObject(intent);
}

/** Compute prev_hash for audit entry chaining (DCP-03). */
export function prevHashForEntry(prevEntry: unknown): string {
  return hashObject(prevEntry);
}
