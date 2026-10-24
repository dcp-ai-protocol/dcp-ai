// `dcp-ai verify` and the Ed25519 S range (RFC 8032 §5.1.7): S >= L is invalid, even when the
// group equation holds, as it does for S + k·L (§8.4). Each case runs the real binary in a child
// process, in a fresh temporary directory with no .dcp/ above it, and checks its output and exit
// code. On a V1 file `verify` checks only the Ed25519 signature over canonical(bundle): it exits 0
// only when it printed that the signature is VALID, and 1 when it is INVALID, when there is no key
// or no usable signature, when the file is not a signed bundle, and when the file, the JSON, the
// base64 or a size is wrong. Exit 0 on a V1 file is that signature check, not admission. A V2
// bundle gets schema validation and the normative verifier instead: verify-v2-normative.test.mjs.
//
// V1 is `signature.sig_b64` over canonical(bundle). The historical `signature.classical.value`
// over `${domain_sep}|${canonical(bundle)}`, with top-level dcp_version 2.0 and signature.binding
// composite, is no longer verified: the CLI rejects it as a pre-normative V2 envelope before it
// reads any key or signature, so every case on that path expects the rejection. Normative V2 is
// covered by verify-v2-normative.test.mjs.
//
//   node --test cli/__tests__/verify-s-range.test.mjs
//   DCP_NEGATIVE_CONTROL=1 node --test cli/__tests__/verify-s-range.test.mjs   # must fail once
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import stringify from 'json-stable-stringify';
import { findConfigDir } from '../lib/config.js';

const BIN = fileURLToPath(new URL('../bin/dcp-ai.js', import.meta.url));
const kat = JSON.parse(readFileSync(new URL('../../tests/nist-kat/ed25519/vectors.json', import.meta.url), 'utf8')).test_vectors;
const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';

const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const hex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const b64 = (u) => Buffer.from(u).toString('base64');
const scalarOf = (sig) => BigInt('0x' + Buffer.from(sig.subarray(32)).reverse().toString('hex'));
const withScalar = (sig, s) =>
  new Uint8Array([...sig.subarray(0, 32), ...Buffer.from(s.toString(16).padStart(64, '0'), 'hex').reverse()]);
const plusL = (sig) => withScalar(sig, scalarOf(sig) + L);
/** k = 1, 2 and the largest k for which S + k·L still fits in 32 bytes. */
const ks = (sig) => [...new Set([1n, 2n, (2n ** 256n - 1n - scalarOf(sig)) / L])];
const flipR = (sig) => { const s = new Uint8Array(sig); s[0] ^= 1; return s; };

// A = the identity, so [S]B = R for any message (weak keys are E4, unchanged).
const IDENTITY = hex('01' + '00'.repeat(31));
const MINUS_B = hex('58' + '66'.repeat(30) + 'e6');
const sigOf = (r, s) => withScalar(new Uint8Array([...r, ...new Uint8Array(32)]), s);

const keys = kat.map((t) => nacl.sign.keyPair.fromSeed(hex(t.secret_key_hex)));
const bundle = { intent: { action_type: 'api_call', probe: 'dcp-ed25519-review/cli-s-range' } };

// The two formats, each with the bytes it signs, the file it is in, and what verify now says.
const paths = {
  v1: {
    outcome: (want) => want,
    bytes: (b) => new TextEncoder().encode(stringify(b)),
    file: (b, sig, pk) => ({ bundle: b, signature: { sig_b64: sig, signer: { public_key_b64: pk } } }),
  },
  'v2-classical': {
    outcome: () => historical,
    bytes: (b, tag = 'DCP-BUNDLE-SIG-v2') => new TextEncoder().encode(`${tag}|${stringify(b)}`),
    file: (b, sig, pk, tag) => ({
      dcp_version: '2.0',
      bundle: b,
      signature: {
        binding: 'composite',
        ...(tag ? { domain_sep: tag } : {}),
        classical: { value: sig },
        signer: { keys: [{ algorithm: 'Ed25519', public_key_b64: pk }] },
      },
    }),
  },
};

/** Runs `dcp-ai verify <args>` with bundle.json holding `file` (a string as is, else JSON). */
function verify(file, { dcpKey, args = ['bundle.json'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dcp-cli-s-range-'));
  try {
    assert.equal(findConfigDir(dir), null, `a .dcp/ above ${dir} would supply the key`);
    if (dcpKey) {
      mkdirSync(join(dir, '.dcp', 'keys'), { recursive: true });
      writeFileSync(join(dir, '.dcp', 'keys', 'ed25519_public.key'), dcpKey + '\n');
    }
    writeFileSync(join(dir, 'bundle.json'), typeof file === 'string' ? file : JSON.stringify(file));
    const r = spawnSync(process.execPath, [BIN, 'verify', ...args], { cwd: dir, encoding: 'utf8', timeout: 5000 });
    assert.equal(r.error, undefined, 'the binary ran and finished within 5 s');
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    return {
      status: r.status,
      verdict: out.match(/✓ (Ed25519|V2 classical) signature VALID$/m)
        ? 'VALID'
        : out.match(/✗ (Ed25519|V2 classical) signature INVALID$/m) ? 'INVALID' : null,
      error: out.match(/Error verifying bundle: (.*)$/m)?.[1] ?? null,
      legacy: /✗ Unsupported pre-normative V2 envelope/.test(out),
      out,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const valid = { status: 0, verdict: 'VALID', error: null, legacy: false };
const invalid = { status: 1, verdict: 'INVALID', error: null, legacy: false };
const fails = (error) => ({ status: 1, verdict: null, error, legacy: false });
const historical = { status: 1, verdict: null, error: null, legacy: true };
const says = (want) => (want.legacy ? 'rejected as pre-normative V2' : want.verdict ?? want.error);
const check = (got, want) => {
  const { out, ...observed } = got;
  assert.deepEqual(observed, want, out);
};

for (const [name, p] of Object.entries(paths)) {
  const want = p.outcome;
  for (const [i, t] of kat.entries()) {
    const kp = keys[i];
    const pk = b64(kp.publicKey);
    const sig = nacl.sign.detached(p.bytes(bundle), kp.secretKey);

    test(`${name}, ${t.name} key: a signature over its bytes: ${says(want(valid))}`, () => {
      check(verify(p.file(bundle, b64(sig), pk)), want(NEGATIVE_CONTROL && name === 'v1' && i === 0 ? invalid : valid));
    });
    test(`${name}, ${t.name} key: S = L: ${says(want(invalid))}`, () => {
      check(verify(p.file(bundle, b64(withScalar(sig, L)), pk)), want(invalid));
    });
    for (const k of ks(sig)) {
      test(`${name}, ${t.name} key: S + ${k}·L: ${says(want(invalid))}`, () => {
        check(verify(p.file(bundle, b64(withScalar(sig, scalarOf(sig) + k * L)), pk)), want(invalid));
      });
    }
  }

  test(`${name}: S = L - 1 with R = -B, A = identity (same top byte as L): ${says(want(valid))}`, () => {
    check(verify(p.file(bundle, b64(sigOf(MINUS_B, L - 1n)), b64(IDENTITY))), want(valid));
  });
  test(`${name}: S = 0 with R = A = identity: ${says(want(valid))}`, () => {
    check(verify(p.file(bundle, b64(sigOf(IDENTITY, 0n)), b64(IDENTITY))), want(valid));
  });
  for (const k of [1n, 2n, 15n]) {
    test(`${name}: S = ${k}·L with R = A = identity, where the equation holds: ${says(want(invalid))}`, () => {
      check(verify(p.file(bundle, b64(sigOf(IDENTITY, k * L)), b64(IDENTITY))), want(invalid));
    });
  }

  const pk = b64(keys[0].publicKey);
  const sig = nacl.sign.detached(p.bytes(bundle), keys[0].secretKey);
  const sPlusL = plusL(sig);

  test(`${name}: another bundle, another R or another key: ${says(want(invalid))}`, () => {
    check(verify(p.file({ ...bundle, extra: 1 }, b64(sig), pk)), want(invalid));
    check(verify(p.file(bundle, b64(flipR(sig)), pk)), want(invalid));
    check(verify(p.file(bundle, b64(sig), b64(keys[1].publicKey))), want(invalid));
  });
  test(`${name}: a 31- or 33-byte key with an S + L signature: ${says(want(fails('bad public key size')))}, exit 1`, () => {
    check(verify(p.file(bundle, b64(sPlusL), b64(keys[0].publicKey.subarray(0, 31)))), want(fails('bad public key size')));
    check(verify(p.file(bundle, b64(sPlusL), b64(new Uint8Array([...keys[0].publicKey, 0])))), want(fails('bad public key size')));
  });
  test(`${name}: a 63- or 65-byte S + L signature, also with a 31-byte key: ${says(want(fails('bad signature size')))}, exit 1`, () => {
    check(verify(p.file(bundle, b64(sPlusL.subarray(0, 63)), pk)), want(fails('bad signature size')));
    check(verify(p.file(bundle, b64(new Uint8Array([...sPlusL, 0])), pk)), want(fails('bad signature size')));
    check(verify(p.file(bundle, b64(sPlusL.subarray(0, 63)), b64(keys[0].publicKey.subarray(0, 31)))), want(fails('bad signature size')));
  });
  test(`${name}: invalid base64 in the S + L signature or in the key: ${says(want(fails('invalid encoding')))}, exit 1`, () => {
    check(verify(p.file(bundle, b64(sPlusL) + '!', pk)), want(fails('invalid encoding')));
    check(verify(p.file(bundle, b64(sPlusL), pk + '!')), want(fails('invalid encoding')));
  });
}

test('v2-classical: with or without domain_sep, honest or S + L: rejected as pre-normative V2', () => {
  const tag = 'DCP-AI.v2.Bundle';
  const sig = nacl.sign.detached(paths['v2-classical'].bytes(bundle, tag), keys[0].secretKey);
  const pk = b64(keys[0].publicKey);
  check(verify(paths['v2-classical'].file(bundle, b64(sig), pk, tag)), historical);
  check(verify(paths['v2-classical'].file(bundle, b64(sig), pk)), historical);
  check(verify(paths['v2-classical'].file(bundle, b64(plusL(sig)), pk, tag)), historical);
});

test('v1: the key in .dcp/keys/ed25519_public.key wins over the embedded one', () => {
  const sig = nacl.sign.detached(paths.v1.bytes(bundle), keys[0].secretKey);
  const file = (s) => paths.v1.file(bundle, b64(s), b64(keys[1].publicKey));
  const dcpKey = b64(keys[0].publicKey);
  check(verify(file(sig)), invalid);
  check(verify(file(sig), { dcpKey }), valid);
  check(verify(file(plusL(sig)), { dcpKey }), invalid);
});

// Input errors: exit 1, as before.
test('a missing argument, a missing file or invalid JSON: exit 1, no verdict', () => {
  const usage = verify({}, { args: [] });
  assert.deepEqual([usage.status, usage.verdict], [1, null], usage.out);
  assert.match(usage.out, /Usage: dcp-ai verify <bundle\.json>/);
  const missing = verify({}, { args: ['missing.json'] });
  assert.deepEqual([missing.status, missing.verdict], [1, null], missing.out);
  assert.match(missing.out, /File not found: missing\.json/);
  const json = verify('{"bundle":');
  assert.deepEqual([json.status, json.verdict], [1, null], json.out);
  assert.notEqual(json.error, null, json.out);
});

// Nothing verified: the same warning as before, and exit 1. The message says "no public key"
// also when the key is there and the signature is missing or empty.
{
  const sig = b64(nacl.sign.detached(paths.v1.bytes(bundle), keys[0].secretKey));
  const pk = b64(keys[0].publicKey);
  const unverified = {
    'v1 without a key': [{ bundle, signature: { sig_b64: sig } }],
    'v1 with a key and no signature': [{ bundle, signature: { signer: { public_key_b64: pk } } }],
    'v1 with a key and an empty sig_b64': [{ bundle, signature: { sig_b64: '', signer: { public_key_b64: pk } } }],
    'a .dcp/ key and no signature': [{ bundle }, { dcpKey: pk }],
  };
  for (const [name, [file, opts]] of Object.entries(unverified)) {
    test(`${name}: no public key warning, exit 1`, () => {
      const r = verify(file, opts);
      assert.deepEqual([r.status, r.verdict, r.error], [1, null, null], r.out);
      assert.match(r.out, /⚠ No public key available for cryptographic verification/);
    });
  }

  test('v2-classical without a key, or with a key and no classical value: rejected as pre-normative V2', () => {
    const keysOnly = { keys: [{ algorithm: 'Ed25519', public_key_b64: pk }] };
    check(verify({ dcp_version: '2.0', bundle, signature: { binding: 'composite', classical: { value: sig } } }), historical);
    check(verify({ dcp_version: '2.0', bundle, signature: { binding: 'composite', signer: keysOnly } }), historical);
  });

  const unsigned = {
    'an object without a bundle': { intent: bundle.intent },
    'a root array': [],
    'a root number': 42,
    'a root string': 'bundle',
    'root true': true,
    'root false': false,
    'bundle: null': { bundle: null, signature: { sig_b64: sig, signer: { public_key_b64: pk } } },
    'bundle: 0': { bundle: 0 },
    'bundle: ""': { bundle: '' },
    'bundle: false': { bundle: false },
  };
  for (const [name, value] of Object.entries(unsigned)) {
    test(`${name}: not a signed bundle warning, exit 1`, () => {
      const r = verify(JSON.stringify(value));
      assert.deepEqual([r.status, r.verdict, r.error], [1, null, null], r.out);
      assert.match(r.out, /⚠ Not a signed bundle format — structural check only/);
    });
  }

  test('root null: an error, exit 1, as before', () => {
    const r = verify('null');
    assert.deepEqual([r.status, r.verdict], [1, null], r.out);
    assert.notEqual(r.error, null, r.out);
  });
}
