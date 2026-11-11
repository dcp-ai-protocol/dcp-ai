// `dcp-ai verify` on V1 files under P-ED-1 (MP-03 P3): the CLI checks the Ed25519 signature over canonical(bundle) with
// TweetNaCl after lib/ed25519-ped1.js. Expectations come from the frozen corpus tests/interop/v2/ed25519_ped1_vectors.json
// (its 4 object cases are signatures over canonical(object), the bytes the CLI checks), never from the CLI. Each case
// runs the real binary in a child process, in a fresh temporary directory with no .dcp/ above it: exit 0 only when it
// printed VALID, exit 1 when INVALID. Every weak case now INVALID is also shown accepted by TweetNaCl alone on the same
// bytes. V2 files keep their path (verify-v2-normative.test.mjs); the helper ships in the package (checked below).
//
//   node --test cli/__tests__/verify-ped1.test.mjs
//   DCP_NEGATIVE_CONTROL=1 node --test cli/__tests__/verify-ped1.test.mjs   # must fail once
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, BIN, INSTALLED, dependency, findConfigDir } from './cli-under-test.mjs';

const nacl = await dependency('tweetnacl');
const stringify = await dependency('json-stable-stringify');

const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';
const raw = readFileSync(new URL('../../tests/interop/v2/ed25519_ped1_vectors.json', import.meta.url));
const V = JSON.parse(raw);
const kat = JSON.parse(readFileSync(new URL('../../tests/nist-kat/ed25519/vectors.json', import.meta.url), 'utf8')).test_vectors;
const hex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const b64 = (u) => Buffer.from(u).toString('base64');
const IDENTITY = hex('01' + '00'.repeat(31));
const FORGERY = new Uint8Array([...IDENTITY, ...new Uint8Array(32)]); // R = A = identity, S = 0: any message
const file = (bundle, sig, pk) => ({ bundle, signature: { sig_b64: sig, signer: { public_key_b64: pk } } });

/** Runs `dcp-ai verify bundle.json` on `content` in a fresh directory; `dcpKey` goes to .dcp/keys. */
function verify(content, { dcpKey } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dcp-cli-ped1-'));
  try {
    assert.equal(findConfigDir(dir), null, `a .dcp/ above ${dir} would supply the key`);
    if (dcpKey) {
      mkdirSync(join(dir, '.dcp', 'keys'), { recursive: true });
      writeFileSync(join(dir, '.dcp', 'keys', 'ed25519_public.key'), dcpKey + '\n');
    }
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify(content));
    const r = spawnSync(process.execPath, [BIN, 'verify', 'bundle.json'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
    assert.equal(r.error, undefined, 'the binary ran and finished within 5 s');
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    const verdict = /✓ Ed25519 signature VALID$/m.test(out) ? 'VALID' : /✗ Ed25519 signature INVALID$/m.test(out) ? 'INVALID' : null;
    return { status: r.status, verdict, out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const expect = (got, verdict) => assert.deepEqual([got.status, got.verdict], verdict === 'VALID' ? [0, 'VALID'] : [1, 'INVALID'], got.out);

test('the frozen corpus; the CLI helper is the reference copy', () => {
  assert.equal(createHash('sha256').update(raw).digest('hex'), 'f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396');
  assert.deepEqual(readFileSync(join(CLI, 'lib', 'ed25519-ped1.js')), readFileSync(new URL('../../tools/ed25519-ped1.js', import.meta.url)));
});

for (const c of V.objects.cases) {
  test(`the corpus's ${c.id} as a V1 file: ${c.accept ? 'VALID, exit 0' : 'INVALID, exit 1'}`, () => {
    assert.equal(Buffer.from(stringify(V.objects.object)).toString('hex'), c.message_hex, 'the bytes the CLI checks');
    if (!c.accept) assert.equal(nacl.sign.detached.verify(hex(c.message_hex), hex(c.signature_hex), hex(c.public_key_hex)), true, 'TweetNaCl alone accepts');
    // The negative control inverts the one accepted case.
    const want = c.accept !== (NEGATIVE_CONTROL && c.id === 'object/normal-key') ? 'VALID' : 'INVALID';
    expect(verify(file(V.objects.object, b64(hex(c.signature_hex)), b64(hex(c.public_key_hex)))), want);
  });
}

test('the identity forgery: INVALID, with the embedded key and with the .dcp/ key; TweetNaCl alone accepts it', () => {
  const bundle = { intent: { action_type: 'api_call', probe: 'dcp-mp03-p3/cli' } };
  assert.equal(nacl.sign.detached.verify(new TextEncoder().encode(stringify(bundle)), FORGERY, IDENTITY), true);
  expect(verify(file(bundle, b64(FORGERY), b64(IDENTITY))), 'INVALID');
  expect(verify({ bundle, signature: { sig_b64: b64(FORGERY) } }, { dcpKey: b64(IDENTITY) }), 'INVALID');
});

test('KAT keys: their signature VALID, another bundle or R INVALID', () => {
  for (const t of kat) {
    const kp = nacl.sign.keyPair.fromSeed(hex(t.secret_key_hex));
    const bundle = { intent: { action_type: 'api_call', probe: t.name } };
    const sig = nacl.sign.detached(new TextEncoder().encode(stringify(bundle)), kp.secretKey);
    expect(verify(file(bundle, b64(sig), b64(kp.publicKey))), 'VALID');
    expect(verify(file({ ...bundle, extra: 1 }, b64(sig), b64(kp.publicKey))), 'INVALID');
    const r = new Uint8Array(sig);
    r[0] ^= 1;
    expect(verify(file(bundle, b64(r), b64(kp.publicKey))), 'INVALID');
  }
});

test('the packed CLI ships the helper next to the binary', () => {
  if (INSTALLED) {
    // An installed package is the packed CLI: the two files are in it. (`npm pack --dry-run` below asks what the
    // source tree would pack, which says nothing about an artifact that already exists.)
    const { files: shipped } = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8'));
    for (const f of ['bin/dcp-ai.js', 'lib/ed25519-ped1.js']) {
      assert.ok(shipped.includes(f.split('/')[0]), `${f.split('/')[0]} is in package.json files`);
      assert.ok(statSync(join(CLI, f)).isFile(), f);
    }
    return;
  }
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'], { cwd: CLI, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const files = JSON.parse(r.stdout)[0].files.map((f) => f.path);
  for (const f of ['bin/dcp-ai.js', 'lib/ed25519-ped1.js']) assert.ok(files.includes(f), f);
});
