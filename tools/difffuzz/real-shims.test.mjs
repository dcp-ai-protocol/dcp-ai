// Bounded test of the four REAL shims under protocol /3, apart from the self-tests (difffuzz.test.mjs never runs an
// SDK). It builds the shims once with buildShims and needs: go and cargo with the locked dependencies (from the network,
// or from the local caches with DIFFFUZZ_OFFLINE=1), a Python 3.10+ with the sdks/python dependencies (DIFFFUZZ_PYTHON,
// default python3), and the built TypeScript SDK (sdks/typescript/dist). No campaign: a few fixed documents.
//   DIFFFUZZ_PYTHON=<python> [DIFFFUZZ_OFFLINE=1] node --test tools/difffuzz/real-shims.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { LIMITS as KIT_LIMITS, runProcess } from '../conformance/external.js';
import { DEFAULTS, ERRORS_MAX, ERROR_CODEPOINTS_MAX, NOW_MS, ROOT, SDKS, buildShims, runBatch, validMarker } from './fuzz.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'difffuzz-real-'));
let cmds;
before(async () => {
  ({ commands: cmds } = await buildShims({ offline: process.env.DIFFFUZZ_OFFLINE === '1', buildTimeoutMs: 600000, python: process.env.DIFFFUZZ_PYTHON || 'python3' }, tmp));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The bound of protocol /3, written again from its definition: code points as JavaScript iterates a string, literal
// prefixes, and the sha256 of each original as its UTF-8 length (4 bytes, big-endian) then its UTF-8 bytes.
function expected(errors) {
  const cps = errors.map((e) => Array.from(e));
  if (errors.length <= ERRORS_MAX && cps.every((c) => c.length <= ERROR_CODEPOINTS_MAX)) return { errors };
  const h = crypto.createHash('sha256');
  for (const e of errors) {
    const b = Buffer.from(e, 'utf8');
    const n = Buffer.alloc(4);
    n.writeUInt32BE(b.length);
    h.update(n).update(b);
  }
  const kept = cps.slice(0, ERRORS_MAX).map((c) => c.slice(0, ERROR_CODEPOINTS_MAX).join(''));
  return { errors: kept, truncated: { original_count: errors.length, kept: kept.length, original_code_points: cps.reduce((n, c) => n + c.length, 0), sha256: h.digest('hex') } };
}
// Through the driver's own process runner, with the driver's default stdout limit: in the environment observed
// (macOS, Node 22, CPython 3.12) spawnSync with a large stdin intermittently hung a slow-starting Python reader, also
// without any SDK; runProcess did not.
const selftest = async (sdk, lists) => {
  const argv = [...cmds[sdk].slice(0, -1), '--bound-selftest'];
  const { stdout, observed } = await runProcess(argv, Buffer.from(JSON.stringify({ lists })), { timeoutMs: 120000, limits: { ...KIT_LIMITS, stdoutBytes: DEFAULTS.stdoutBytes } });
  const clean = observed.exit_code === 0 && observed.signal === null && !observed.timed_out && !observed.output_limit && !observed.cleanup_incomplete && !observed.group_alive_after_exit && !observed.spawn_error;
  assert.ok(clean, `${sdk}: ${JSON.stringify(observed)}`);
  const out = JSON.parse(stdout.toString('utf8')).bounded;
  assert.ok(Array.isArray(out) && out.length === lists.length, `${sdk}: ${out?.length} results for ${lists.length} lists`);
  return { out, bytes: stdout.length };
};

test('each shim bounds a list exactly as protocol /3 defines it: 255/256/257 code points, 7/8/9 messages, multibyte, astral, normal lists unchanged', async () => {
  const E = 'é';
  const A = '\u{1F600}';
  const lists = [
    ['a'.repeat(255)], ['a'.repeat(256)], ['a'.repeat(257)], [E.repeat(256)], [E.repeat(257)], [A.repeat(256)], [A.repeat(257)],
    Array(7).fill('m'), Array(8).fill('m'), Array(9).fill('m'), ['normal error one', 'normal error two'], [], Array(9).fill(A.repeat(300)),
  ];
  for (const sdk of SDKS) {
    const { out } = await selftest(sdk, lists);
    assert.deepEqual(out, lists.map(expected), sdk);
    for (const o of out) if (o.truncated) assert.ok(validMarker(o.errors, o.truncated), `${sdk}: marker`);
  }
});

test('the worst bounded output of 256 lists stays within the default stdout in every shim, Python included, and is exact', async (t) => {
  const lists = Array(256).fill(Array(9).fill('\u{1F600}'.repeat(300)));
  const want = expected(lists[0]);
  for (const sdk of SDKS) {
    const { out, bytes } = await selftest(sdk, lists);
    t.diagnostic(`${sdk}: ${bytes} bytes for 256 worst lists`);
    assert.ok(bytes < DEFAULTS.stdoutBytes, `${sdk}: ${bytes}`);
    assert.equal(out.length, 256, sdk);
    out.forEach((o, i) => assert.deepEqual(o, want, `${sdk}: list ${i}`));
  }
});

const B = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/interop/v2/bundle_vectors.json'), 'utf8'));
const policy = B.default_verifier_policy;
const set = (p, v) => { const d = structuredClone(B.signed_bundle); p.slice(0, -1).reduce((n, k) => n[k], d)[p.at(-1)] = v; return d; };
const mutated = (name) => { const c = B.must_reject.find((x) => x.name === name); const d = structuredClone(B.signed_bundle); for (const m of c.mutations) { m.path.slice(0, -1).reduce((n, k) => n[k], d)[m.path.at(-1)] = m.value; } return d; };
const job = (doc, i) => ({ wireId: `${String(i).padStart(2, '0')}${crypto.randomBytes(11).toString('hex')}`, policy, bytes: Buffer.from(JSON.stringify(doc)) });
const limits = { timeoutMs: 120000, stdoutBytes: DEFAULTS.stdoutBytes, batchBytes: DEFAULTS.batchBytes };

test('a batch that overflowed 8 MiB before /3 (nine echoed 1 MiB values) now verifies in every shim, verdicts unchanged', async (t) => {
  const docs = [B.signed_bundle, ...Array(8).fill(set(['signature', 'signer', 'id'], 'A'.repeat(1 << 20))), set(['signature', 'composite_sig', 'classical', 'alg'], 'A'.repeat(1 << 20)), mutated('bundle_pq_signature_invalid')];
  const jobs = docs.map(job);
  for (const sdk of SDKS) {
    const b = await runBatch(cmds[sdk], jobs, limits, NOW_MS);
    assert.equal(b.judged.ok, true, `${sdk}: ${b.judged.category} ${b.judged.detail}`);
    t.diagnostic(`${sdk}: request ${Buffer.byteLength(JSON.stringify(b.request))} bytes, stdout ${b.observed.stdout_bytes} bytes`);
    const r = jobs.map((j) => b.judged.results.get(j.wireId));
    assert.deepEqual(r[0], { category: 'verdict', verified: true, errors: [] }, `${sdk}: the positive`);
    for (const x of r.slice(1, 9)) {
      assert.equal(x.verified, false, sdk);
      assert.ok(x.truncated && validMarker(x.errors, x.truncated) && x.truncated.original_code_points >= 1 << 20, `${sdk}: the echoed signer.id is cut and marked`);
    }
    assert.equal(r[9].verified, false, `${sdk}: long classical.alg`);
    assert.equal(r[10].verified, false, `${sdk}: normal negative`);
    assert.equal(r[10].truncated, undefined, `${sdk}: a normal negative is not marked`);
    assert.ok(r.every((x) => x.category === 'verdict'), sdk);
  }
});

test('the TypeScript shim summarizes exactly the list the SDK returns (same verdict, same prefix, same sha256)', async () => {
  const sdk = await import(path.join(ROOT, 'sdks/typescript/dist/index.js'));
  const registry = new sdk.AlgorithmRegistry();
  registry.registerSigner(new sdk.Ed25519Provider());
  registry.registerSigner(new sdk.MlDsa65Provider());
  const docs = [B.signed_bundle, set(['signature', 'composite_sig', 'classical', 'alg'], 'A'.repeat(1 << 20)), set(['signature', 'signer', 'id'], '\u{1F600}'.repeat(1 << 18)), mutated('bundle_pq_signature_invalid')];
  const jobs = docs.map(job);
  const b = await runBatch(cmds.ts, jobs, limits, NOW_MS);
  assert.equal(b.judged.ok, true);
  for (const [i, d] of docs.entries()) {
    const direct = await sdk.verifySignedBundleV2(d, registry, policy, { now: NOW_MS });
    const got = b.judged.results.get(jobs[i].wireId);
    assert.deepEqual(got, { category: 'verdict', verified: direct.verified, ...expected(direct.errors) }, `case ${i}`);
  }
});

test("Codex's small repro: a positive and eight 1 MiB classical.alg negatives in one batch fit and keep their verdicts", async () => {
  const jobs = [B.signed_bundle, ...Array(8).fill(set(['signature', 'composite_sig', 'classical', 'alg'], 'A'.repeat(1 << 20)))].map(job);
  for (const sdk of SDKS) {
    const b = await runBatch(cmds[sdk], jobs, limits, NOW_MS);
    assert.equal(b.judged.ok, true, `${sdk}: ${b.judged.category} ${b.judged.detail}`);
    assert.deepEqual(jobs.map((j) => b.judged.results.get(j.wireId).verified), [true, ...Array(8).fill(false)], sdk);
  }
});
