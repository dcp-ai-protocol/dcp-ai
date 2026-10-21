import crypto from "crypto";
import stringify from "json-stable-stringify";

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha3_256Hex(buf) {
  return crypto.createHash("sha3-256").update(buf).digest("hex");
}

export function canonicalize(obj) {
  return stringify(obj);
}

// --- V1: SHA-256 only ---

export function hashObject(obj) {
  const canon = canonicalize(obj);
  return sha256Hex(Buffer.from(canon, "utf8"));
}

// --- V2: Dual hash (SHA-256 + SHA3-256) ---

export function dualHashObject(obj) {
  const canon = Buffer.from(canonicalize(obj), "utf8");
  return {
    sha256: sha256Hex(canon),
    "sha3-256": sha3_256Hex(canon),
  };
}

export function dualHashBuffer(buf) {
  return {
    sha256: sha256Hex(buf),
    "sha3-256": sha3_256Hex(buf),
  };
}

// --- Merkle trees ---

export function merkleRootFromHexLeaves(leaves, algorithm = "sha256") {
  if (!leaves || leaves.length === 0) return null;
  const hashFn = algorithm === "sha3-256" ? sha3_256Hex : sha256Hex;
  let layer = leaves.slice();
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = Buffer.from(layer[i], "hex");
      const right = Buffer.from(layer[i + 1], "hex");
      next.push(hashFn(Buffer.concat([left, right])));
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
 * V1: SHA-256(canonical(intent)) as hex string.
 */
export function intentHash(intent) {
  return hashObject(intent);
}

/**
 * V2: Dual intent hash with both algorithms.
 */
export function dualIntentHash(intent) {
  return dualHashObject(intent);
}

/**
 * Compute prev_hash for audit entry chaining (DCP-03).
 * For entry at index n (n >= 1): prev_hash = SHA-256(canonical(entry_{n-1})) as hex.
 * For the first entry (n === 0): prev_hash must be "GENESIS".
 */
export function prevHashForEntry(prevEntry) {
  return hashObject(prevEntry);
}
