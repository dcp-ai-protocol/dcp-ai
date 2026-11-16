// EXPERIMENTAL candidate ingress (phase 1) through the built package: the JS wrapper and the real
// wasm module, over the public corpus cases that test one unit from its bytes (87 baseline + 81 bare
// document cases; bundles and transport envelopes belong to later phases), plus the JS/wasm boundary.
// Needs `npm run build:wasm` and `npm run build:ts` first.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initDcp } from '../dist/index.js';

const dir = new URL('../../../docs/proposals/canonicalization-candidate/', import.meta.url);
const baseline = JSON.parse(readFileSync(new URL('baseline-corpus.json', dir), 'utf8')).cases;
const design = JSON.parse(readFileSync(new URL('corpus.json', dir), 'utf8')).cases;
const document = design.filter((c) => c.mode === 'document' && c.transport === 'bare' && !c.options);
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const inputOf = (c) => new Uint8Array(c.input_hex !== undefined ? Buffer.from(c.input_hex, 'hex') : Buffer.from(c.input_json, 'utf8'));
const text = (b) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);

check('corpus counts', baseline.length === 87 && document.length === 81 && design.length - document.length === 106, {
  baseline: baseline.length,
  document: document.length,
});
for (const c of baseline) {
  const input = inputOf(c);
  check(`${c.id} input`, sha(input) === c.input_sha256, c.input_sha256);
  const r = dcp.experimentalCandidateIngress(input);
  if (c.expected === 'accept') {
    check(`baseline ${c.id}`, r.status === 'accept' && text(r.canonical) === c.canonical && r.canonicalSha256 === c.canonical_sha256 && sha(r.canonical) === c.canonical_sha256, r);
  } else {
    check(`baseline ${c.id}`, r.status === 'reject' && r.class === c.reject_class, r);
  }
}
for (const c of document) {
  const input = inputOf(c);
  check(`${c.id} input`, sha(input) === c.input_sha256, c.input_sha256);
  const r = dcp.experimentalCandidateIngress(input);
  const e = c.expected;
  if (e.result === 'accept') {
    check(`design ${c.id}`, r.status === 'accept' && r.canonicalSha256 === e.canonical_sha256 && sha(r.canonical) === e.canonical_sha256, r);
  } else {
    check(`design ${c.id}`, r.status === 'reject' && r.class === e.class && r.offset === e.offset, r);
  }
}

// The boundary: bytes reach Rust unchanged (non-UTF-8, BOM, NUL), a 20 000-level unit returns, and a
// value that is not a Uint8Array is a TypeError, never coerced into bytes.
const reject = (bytes) => dcp.experimentalCandidateIngress(Uint8Array.from(bytes));
check('invalid byte', JSON.stringify(reject([0x5b, 0x22, 0xff, 0x22, 0x5d])) === '{"status":"reject","class":"UTF8_INVALID","offset":2}', reject([0x5b, 0x22, 0xff, 0x22, 0x5d]));
check('bom', JSON.stringify(reject([0xef, 0xbb, 0xbf, 0x7b, 0x7d])) === '{"status":"reject","class":"BOM","offset":0}', null);
const nul = dcp.experimentalCandidateIngress(new TextEncoder().encode('["a\\u0000b"]'));
check('nul escape', nul.status === 'accept' && text(nul.canonical) === '["a\\u0000b"]', nul);
const deep = dcp.experimentalCandidateIngress(new TextEncoder().encode('['.repeat(20000) + ']'.repeat(19999)));
check('20000 levels with a late grammar error', deep.status === 'reject' && deep.class === 'SYNTAX' && deep.offset === 39999, deep);
const view = new Uint8Array(new TextEncoder().encode('xx{"b":1,"a":2}yy').buffer, 2, 13);
const sub = dcp.experimentalCandidateIngress(view);
check('a view of a larger buffer', sub.status === 'accept' && text(sub.canonical) === '{"a":2,"b":1}', sub);
for (const wrong of ['{}', [0x7b, 0x7d], null, new ArrayBuffer(2)]) {
  let thrown = null;
  try {
    dcp.experimentalCandidateIngress(wrong);
  } catch (e) {
    thrown = e;
  }
  check(`wrong argument ${Object.prototype.toString.call(wrong)}`, thrown instanceof TypeError, String(thrown));
}

if (failures.length > 0) {
  console.error(`experimental candidate ingress (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`experimental candidate ingress (wasm): ${checks} checks passed (87 baseline + 81 bare document cases, boundary)`);
