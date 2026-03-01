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

export function dualMerkleRootForAuditEntries(auditEntries) {
  const leaves256 = auditEntries.map(e => dualHashObject(e).sha256);
  const leavesSha3 = auditEntries.map(e => dualHashObject(e)["sha3-256"]);
  return {
    sha256: merkleRootFromHexLeaves(leaves256, "sha256"),
    "sha3-256": merkleRootFromHexLeaves(leavesSha3, "sha3-256"),
  };
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

/**
 * V2: Generate a bundle_manifest with hashes for each artifact.
 */
export function generateBundleManifest(bundle) {
  const artifacts = {};
  const fields = [
    "responsible_principal_record",
    "agent_passport",
    "intent",
    "policy_decision",
    "human_confirmation",
  ];

  for (const field of fields) {
    if (bundle[field]) {
      artifacts[field] = dualHashObject(bundle[field]);
    }
  }

  if (Array.isArray(bundle.audit_entries)) {
    artifacts.audit_entries = bundle.audit_entries.map((e, i) => ({
      index: i,
      ...dualHashObject(e),
    }));
  }

  const bundleDual = dualHashObject(bundle);
  return {
    schema_version: "2.0",
    artifacts,
    bundle_hash: bundleDual,
    merkle_root: Array.isArray(bundle.audit_entries)
      ? dualMerkleRootForAuditEntries(bundle.audit_entries)
      : null,
  };
}
