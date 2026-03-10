// playground/js/core/hash.js — SHA-256, canonicalize (JCS), Merkle root

export async function sha256(data) {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Bytes(bytes) {
  const buffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

export async function computeMerkleRoot(entries) {
  let leaves = [];
  for (const e of entries) {
    leaves.push(await sha256(canonicalize(e)));
  }
  if (leaves.length === 0) return '0'.repeat(64);
  while (leaves.length > 1) {
    if (leaves.length % 2 === 1) leaves.push(leaves[leaves.length - 1]);
    const next = [];
    for (let i = 0; i < leaves.length; i += 2) {
      next.push(await sha256(leaves[i] + leaves[i + 1]));
    }
    leaves = next;
  }
  return leaves[0];
}

export async function hashArtifact(obj) {
  return 'sha256:' + (await sha256(canonicalize(obj)));
}
