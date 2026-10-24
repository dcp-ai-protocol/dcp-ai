// `dcp-ai verify` on V2 bundles: the normative verifier (schemas/v2 validation, then
// verifySignedBundleV2 from @dcp-ai/sdk with its DEFAULT_VERIFIER_POLICY), the rejection of the
// pre-normative envelope, and V1 as before. Each case runs the real binary in a child process,
// in a fresh temporary directory with no .dcp/ above it, with a 5 s timeout.
//
// Vectors: tests/interop/v2/bundle_vectors.json, the cross-SDK reference. Three
// must_reject_bundles cases are skipped: they reject only under a verifier policy with a maximum
// session duration, and the CLI verifies under the default policy, which has none.
//
//   node --test cli/__tests__/verify-v2-normative.test.mjs
//   DCP_NEGATIVE_CONTROL=1 node --test cli/__tests__/verify-v2-normative.test.mjs   # must fail once
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findConfigDir } from '../lib/config.js';

const CLI = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(CLI, 'bin', 'dcp-ai.js');
const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const vectors = read('tests/interop/v2/bundle_vectors.json');
const v1Bundle = read('tests/conformance/examples/citizenship_bundle.signed.json');
const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';

const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const plusL = (sigB64) => {
  const sig = Buffer.from(sigB64, 'base64');
  const s = BigInt('0x' + Buffer.from(sig.subarray(32)).reverse().toString('hex')) + L;
  return Buffer.concat([sig.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, '0'), 'hex').reverse()]).toString('base64');
};
const mutate = (sb, mutations) => {
  const c = structuredClone(sb);
  for (const { path, value } of mutations) {
    let t = c;
    for (const k of path.slice(0, -1)) t = t[k];
    t[path.at(-1)] = value;
  }
  return c;
};

// The vectors were signed on 21/10/2026 and verifySignedBundleV2 checks time (key age, expiry,
// session issue time) against Date.now(). Every child runs with Date.now fixed at CLOCK, through
// a temporary --require preload, so the verdicts do not depend on the calendar. Only the test
// children get it; the CLI has no clock option.
const CLOCK = '2026-10-24T00:00:00.000Z';
const clockDir = mkdtempSync(join(tmpdir(), 'dcp-cli-clock-'));
const PRELOAD = join(clockDir, 'clock.cjs');
writeFileSync(PRELOAD, `const now = Date.parse(${JSON.stringify(CLOCK)});\nDate.now = () => now;\n`);
process.on('exit', () => rmSync(clockDir, { recursive: true, force: true }));

const base = vectors.signed_bundle;
const rprKey = base.bundle.responsible_principal_record.payload.binding_keys.find((k) => k.alg === 'ed25519').public_key_b64;
const agentKey = base.bundle.agent_passport.payload.keys.find((k) => k.alg === 'ed25519').public_key_b64;

function verify(file, { dcpKey, bin = BIN } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dcp-cli-v2-'));
  try {
    assert.equal(findConfigDir(dir), null, `a .dcp/ above ${dir} would supply the key`);
    if (dcpKey !== undefined) {
      mkdirSync(join(dir, '.dcp', 'keys'), { recursive: true });
      writeFileSync(join(dir, '.dcp', 'keys', 'ed25519_public.key'), dcpKey);
    }
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify(file));
    const r = spawnSync(process.execPath, ['--require', PRELOAD, bin, 'verify', 'bundle.json'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
    assert.equal(r.error, undefined, 'the binary ran and finished within 5 s');
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    const verdict = (re) => (out.match(re) ? out.match(re)[1] : null);
    return {
      status: r.status,
      v2: verdict(/[✓✗] V2 normative verification (VALID|INVALID)$/m),
      v1: verdict(/[✓✗] Ed25519 signature (VALID|INVALID)$/m),
      legacy: /✗ Unsupported pre-normative V2 envelope/.test(out),
      errors: [...out.matchAll(/^ {4}- (.*)$/gm)].map((m) => m[1]),
      out,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const expectV2 = (r, verdict) => {
  assert.deepEqual([r.status, r.v2, r.v1, r.legacy], [verdict === 'VALID' ? 0 : 1, verdict, null, false], r.out);
};
const expectLegacy = (r) => assert.deepEqual([r.status, r.v2, r.v1, r.legacy], [1, null, null, true], r.out);

test(`the children run with Date.now fixed at ${CLOCK}`, () => {
  const r = spawnSync(process.execPath, ['--require', PRELOAD, '-p', 'new Date(Date.now()).toISOString()'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.stdout.trim(), CLOCK, r.stderr);
});

// V2 positives: real hybrid bundles, and the routine classical-only bundle the default policy accepts.
test('signed_bundle (hybrid, pq_over_classical): VALID, exit 0', () => {
  const r = verify(base);
  expectV2(r, NEGATIVE_CONTROL ? 'INVALID' : 'VALID');
  assert.match(r.out, /default verifier policy/);
  assert.match(r.out, /not an admission or trust decision/);
});
for (const c of vectors.must_accept_bundles) {
  test(`must_accept ${c.name}: VALID, exit 0`, () => expectV2(verify(c.signed_bundle), 'VALID'));
}
test('classical_only_routine_bundle under the default policy: VALID, exit 0', () => {
  expectV2(verify(vectors.classical_only_routine_bundle.signed_bundle), 'VALID');
});

// V2 negatives: hashes, payloads, manifest, audit, nonces, keys, classical and PQ signatures,
// expiry, policy. Each is rejected with the SDK's or the schema's errors.
for (const c of vectors.must_reject) {
  test(`must_reject ${c.name}: INVALID, exit 1`, () => {
    const r = verify(mutate(base, c.mutations));
    expectV2(r, 'INVALID');
    assert.notEqual(r.errors.length, 0, r.out);
  });
}
for (const c of vectors.must_reject_bundles.filter((c) => !c.verifier_policy_overrides)) {
  test(`must_reject_bundles ${c.name}: INVALID, exit 1`, () => {
    const r = verify(c.signed_bundle);
    expectV2(r, 'INVALID');
    assert.notEqual(r.errors.length, 0, r.out);
  });
}
test('the bundle signature with S + L: INVALID, exit 1', () => {
  expectV2(verify(mutate(base, [{ path: ['signature', 'composite_sig', 'classical', 'sig_b64'], value: plusL(base.signature.composite_sig.classical.sig_b64) }])), 'INVALID');
});

// classical_only (pq: null): no PQ signature covers the classical bytes, so here only the S range
// check rejects S + L. The original bundle verifies above.
test('classical_only_routine_bundle with S + L: INVALID, exit 1', () => {
  const routine = vectors.classical_only_routine_bundle.signed_bundle;
  assert.deepEqual([routine.signature.composite_sig.binding, routine.signature.composite_sig.pq], ['classical_only', null]);
  const sig = routine.signature.composite_sig.classical.sig_b64;
  const r = verify(mutate(routine, [{ path: ['signature', 'composite_sig', 'classical', 'sig_b64'], value: plusL(sig) }]));
  expectV2(r, 'INVALID');
  assert.notEqual(r.errors.length, 0, r.out);
});

// The local key pins the principal's signing key (RPR binding_keys), never the agent's.
test('.dcp/ key = the principal key: VALID with the pin, exit 0', () => {
  const r = verify(base, { dcpKey: rprKey + '\n' });
  expectV2(r, 'VALID');
  assert.match(r.out, /pinned to \.dcp\/keys\/ed25519_public\.key/);
});
for (const [name, key, error] of [
  ['another key', Buffer.alloc(32, 7).toString('base64'), 'Bundle is not signed by the expected public key.'],
  ['the agent key', agentKey, 'Bundle is not signed by the expected public key.'],
  ['an empty file', '', 'Local public key file .dcp/keys/ed25519_public.key is empty.'],
]) {
  test(`.dcp/ key = ${name}: INVALID, exit 1`, () => {
    const r = verify(base, { dcpKey: key });
    expectV2(r, 'INVALID');
    assert.deepEqual(r.errors, [error], r.out);
  });
}

// Pre-normative envelope, alone or mixed with a V1 or V2 bundle: rejected before any verification.
const legacy = {
  'historical classical V2 file': { dcp_version: '2.0', bundle: base.bundle, signature: { binding: 'composite', classical: { value: 'AA==' }, signer: { keys: [{ algorithm: 'Ed25519', public_key_b64: rprKey }] } } },
  'top-level bundle_manifest': { bundle_manifest: {}, bundle: {}, signature: {} },
  'V1 bundle + top-level dcp_version 2.0': { ...v1Bundle, dcp_version: '2.0' },
  'V1 bundle + signature.binding composite': { ...v1Bundle, signature: { ...v1Bundle.signature, binding: 'composite' } },
  'V1 bundle + top-level bundle_manifest': { ...v1Bundle, bundle_manifest: {} },
  'normative V2 bundle + top-level dcp_version 2.0': { ...base, dcp_version: '2.0' },
  'normative V2 bundle + signature.binding composite': { ...base, signature: { ...base.signature, binding: 'composite' } },
};
for (const [name, file] of Object.entries(legacy)) {
  test(`${name}: pre-normative envelope rejected, exit 1`, () => {
    const r = verify(file);
    expectLegacy(r);
    assert.match(r.out, /signBundleV2/);
  });
}

// V1 as before.
const expectV1 = (r, verdict) => {
  assert.deepEqual([r.status, r.v1, r.v2, r.legacy], [verdict === 'VALID' ? 0 : 1, verdict, null, false], r.out);
};
test('V1 conformance example: Ed25519 VALID, exit 0; altered or S + L: INVALID, exit 1', () => {
  expectV1(verify(v1Bundle), 'VALID');
  const altered = structuredClone(v1Bundle);
  altered.bundle.intent.action_type = 'execute_code';
  expectV1(verify(altered), 'INVALID');
  const sPlusL = structuredClone(v1Bundle);
  sPlusL.signature.sig_b64 = plusL(v1Bundle.signature.sig_b64);
  expectV1(verify(sPlusL), 'INVALID');
});

// The schema copies the package ships are byte-identical to schemas/v2.
test('cli/lib/schemas/v2 are byte-identical copies of schemas/v2', () => {
  const dir = join(CLI, 'lib', 'schemas', 'v2');
  const files = readdirSync(dir).sort();
  assert.deepEqual(files, [
    'agent_passport', 'audit_entry', 'bundle_manifest', 'composite_signature', 'intent', 'key_entry',
    'policy_decision', 'pq_checkpoint', 'responsible_principal_record', 'signed_bundle', 'signed_payload',
  ].map((n) => `${n}.schema.json`));
  for (const f of files) {
    assert.ok(readFileSync(join(dir, f)).equals(readFileSync(join(CLI, '..', 'schemas', 'v2', f))), f);
  }
});

// The package on its own: the files package.json ships plus a copy of its node_modules, outside
// the repository, with no node_modules above it.
test('the packaged files alone verify V2 and V1 bundles', () => {
  const pkg = mkdtempSync(join(tmpdir(), 'dcp-cli-pkg-'));
  try {
    for (let d = dirname(pkg); d !== dirname(d); d = dirname(d)) {
      assert.equal(existsSync(join(d, 'node_modules')), false, `node_modules above ${pkg}`);
    }
    const { files } = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8'));
    for (const f of ['package.json', ...files]) cpSync(join(CLI, f), join(pkg, f), { recursive: true });
    cpSync(join(CLI, 'node_modules'), join(pkg, 'node_modules'), { recursive: true });
    const bin = join(pkg, 'bin', 'dcp-ai.js');
    expectV2(verify(base, { bin }), 'VALID');
    expectV2(verify(vectors.must_reject_bundles[0].signed_bundle, { bin }), 'INVALID');
    expectV1(verify(v1Bundle, { bin }), 'VALID');
  } finally {
    rmSync(pkg, { recursive: true, force: true });
  }
});
