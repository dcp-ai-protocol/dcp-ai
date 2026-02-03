import crypto from "crypto";
import stringify from "json-stable-stringify";

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function canonicalize(obj) {
  return stringify(obj);
}

export function hashObject(obj) {
  const canon = canonicalize(obj);
  return sha256Hex(Buffer.from(canon, "utf8"));
}

export function merkleRootFromHexLeaves(leaves) {
  if (!leaves || leaves.length === 0) return null;
  let layer = leaves.slice();
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = Buffer.from(layer[i], "hex");
      const right = Buffer.from(layer[i + 1], "hex");
      next.push(sha256Hex(Buffer.concat([left, right])));
    }
    layer = next;
  }
  return layer[0];
}

export function merkleRootForAuditEntries(auditEntries) {
  const leaves = auditEntries.map(hashObject);
  return merkleRootFromHexLeaves(leaves);
}

/**
 * Compute intent_hash for an Intent object (DCP-02).
 * intent_hash = SHA-256(canonical(intent)) as hex string.
 */
export function intentHash(intent) {
  return hashObject(intent);
}

/**
 * Compute prev_hash for audit entry chaining (DCP-03).
 * For entry at index n (n >= 1): prev_hash = SHA-256(canonical(entry_{n-1})) as hex.
 * For the first entry (n === 0): prev_hash must be "GENESIS".
 */
export function prevHashForEntry(prevEntry) {
  return hashObject(prevEntry);
}
