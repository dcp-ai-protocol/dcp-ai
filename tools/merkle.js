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
