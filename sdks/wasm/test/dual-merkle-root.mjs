// Runs the built package over tests/conformance/v2/merkle_vectors.json (spec/VERIFICATION.md V2-11 and its erratum):
// the raw export wasm_dual_merkle_root and DcpClient.dualMerkleRoot must give the exact dual roots for 1, 2, 3 and 5
// leaves and for reordered leaves. The vectors are first checked against a second independent reduction written here
// with node:crypto (no SDK). Needs `npm run build:wasm` and `npm run build:ts` first.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initDcp } from '../dist/index.js';

const V = JSON.parse(readFileSync(new URL('../../../tests/conformance/v2/merkle_vectors.json', import.meta.url), 'utf8'));
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });
const raw = await import('../pkg/dcp_ai.js');

const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};

// Independent reference: raw 32-byte digests, H(left || right), odd layer duplicates its last node.
const ALG = { sha256: 'sha256', sha3_256: 'sha3-256' };
function reference(hexLeaves, field) {
  let layer = hexLeaves.map((h) => Buffer.from(h, 'hex'));
  while (layer.length > 1) {
    if (layer.length % 2) layer.push(layer[layer.length - 1]);
    const next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(createHash(ALG[field]).update(Buffer.concat([layer[i], layer[i + 1]])).digest());
    layer = next;
  }
  return layer[0].toString('hex');
}

check('6 cases with 1, 2, 3 and 5 leaves', V.cases.length === 6 && [1, 2, 3, 5].every((n) => V.cases.some((c) => c.leaves.length === n)), V.cases.length);
for (const c of V.cases) {
  for (const f of ['sha256', 'sha3_256']) {
    check(`${c.name}: the vector matches the independent reference (${f})`, reference(c.leaves.map((l) => l[f]), f) === c.expected[f], c.expected[f]);
  }
  const exported = JSON.parse(raw.wasm_dual_merkle_root(JSON.stringify(c.leaves)));
  check(`${c.name}: wasm_dual_merkle_root`, exported.sha256 === c.expected.sha256 && exported.sha3_256 === c.expected.sha3_256 && Object.keys(exported).length === 2, exported);
  let client;
  try { client = dcp.dualMerkleRoot(c.leaves); } catch (e) { client = { error: e.message }; }
  check(`${c.name}: DcpClient.dualMerkleRoot`, client.sha256 === c.expected.sha256 && client.sha3_256 === c.expected.sha3_256, client);
}
const golden = V.cases.find((c) => c.name === 'two_leaves_golden');
const reordered = V.cases.find((c) => c.name === 'two_leaves_golden_reordered');
check('order matters', golden.expected.sha256 !== reordered.expected.sha256 && golden.expected.sha3_256 !== reordered.expected.sha3_256, null);
const one = V.cases.find((c) => c.name === 'one_leaf');
check('one leaf is its own root', one.expected.sha256 === one.leaves[0].sha256 && one.expected.sha3_256 === one.leaves[0].sha3_256, one.expected);

// Errors kept from before: an empty array and input that is not JSON; and leaves that are not 32-byte hex digests.
check('empty array: same error as before', raw.wasm_dual_merkle_root('[]') === '{"error":"Empty leaves array"}', raw.wasm_dual_merkle_root('[]'));
check('not JSON: a JSON parse error', JSON.parse(raw.wasm_dual_merkle_root('[')).error?.startsWith('JSON parse: '), raw.wasm_dual_merkle_root('['));
let threw = false;
try { dcp.dualMerkleRoot([]); } catch { threw = true; }
check('DcpClient.dualMerkleRoot([]) throws', threw, null);
const valid = golden.leaves[0];
for (const [label, leaves] of [
  ['a non-hex leaf', [{ ...valid, sha256: 'zz'.repeat(32) }, valid]],
  ['a 31-byte leaf', [{ ...valid, sha3_256: valid.sha3_256.slice(2) }, valid]],
  ['a text leaf', [{ sha256: 'hello', sha3_256: 'world' }]],
]) {
  const out = JSON.parse(raw.wasm_dual_merkle_root(JSON.stringify(leaves)));
  check(`${label}: an error, never a root`, typeof out.error === 'string' && out.sha256 === undefined, out);
}

// Uppercase hex leaves are valid digests: the roots come back in lowercase, the same as for lowercase leaves.
const upper = (leaves) => leaves.map((l) => ({ sha256: l.sha256.toUpperCase(), sha3_256: l.sha3_256.toUpperCase() }));
for (const c of [one, golden]) {
  const out = JSON.parse(raw.wasm_dual_merkle_root(JSON.stringify(upper(c.leaves))));
  check(`${c.name}: uppercase leaves give the lowercase root`, out.sha256 === c.expected.sha256 && out.sha3_256 === c.expected.sha3_256, out);
}

if (failures.length) {
  console.error(`dual Merkle root (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`dual Merkle root (wasm): ${checks} checks passed`);
