// Error contract of the DcpWasm methods whose results came back in band (MP-03 P1): canonicalize, the error
// envelope of the wasm exports (json_err), hashObject and deriveKid. Public cases go through initDcp and DcpWasm;
// raw cases call the wasm-bindgen exports of ./pkg and are labelled apart, never counted for the public API.
//
//   node test/interface-errors.mjs [--root <dir with dist/ and pkg/>] [--report <file.json>]
//
// Default root: this package. Exit 1 when a case fails. A thrown error passes only where a case expects exactly
// that class and message; any other throw, or a return where a throw is expected, fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const root = resolve(opt('--root') ?? fileURLToPath(new URL('..', import.meta.url)));
const raw = await import(pathToFileURL(join(root, 'pkg/dcp_ai.js')).href);
const { initDcp } = await import(pathToFileURL(join(root, 'dist/index.js')).href);
const dcp = await initDcp({ module_or_path: readFileSync(join(root, 'pkg/dcp_ai_bg.wasm')) });

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const NON_INTEGER = 'Non-integer number in V2 canonical form: 0.5';

const rows = [];
function observe(call) {
  try {
    return { kind: 'return', value: call() };
  } catch (e) {
    return { kind: 'throw', name: e?.name, message: e?.message };
  }
}
function check(id, layer, call, want) {
  const actual = observe(call);
  rows.push({ id, layer, actual, pass: want(actual) === true });
}
const returns = (value) => (a) => a.kind === 'return' && a.value === value;
const throwsError = (message) => (a) => a.kind === 'throw' && a.name === 'Error' && a.message === message;
const exactKeys = (o, keys) =>
  o !== null && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();

// ── Public canonicalize: values the old prefix test read as errors, and controls ──
const KEYS = {
  ordinary: ['ordinary', 'ordinary'],
  newline: ['line\nbreak', 'line\\nbreak'],
  backslash: ['slash\\q', 'slash\\\\q'],
  // A backslash before n: the old envelope was valid JSON that decoded to a newline, a silently different message.
  backslash_n: ['bs\\nkey', 'bs\\\\nkey'],
  quote: ['quote"key', 'quote\\"key'],
  tab: ['tab\tkey', 'tab\\tkey'],
  nul: ['nul\u0000key', 'nul\\u0000key'],
  unit_separator: ['us\u001fkey', 'us\\u001fkey'],
  non_ascii: ['ñandú', 'ñandú'],
};
const positives = [
  ['null', null, 'null'],
  ['true', true, 'true'],
  ['string', 'text', '"text"'],
  ['array', [1, 2], '[1,2]'],
  ['empty-object', {}, '{}'],
  ['ordinary-object', { b: 2, a: 1 }, '{"a":1,"b":2}'],
  ['error-string', { error: 'ordinary payload' }, '{"error":"ordinary payload"}'],
  ['error-null', { error: null }, '{"error":null}'],
  ['error-object', { error: { message: 'x' } }, '{"error":{"message":"x"}}'],
  ['error-number-and-later-key', { z: 1, error: 4 }, '{"error":4,"z":1}'],
  ['error-nested', { nested: { error: 'x' } }, '{"nested":{"error":"x"}}'],
  ['error-in-array', [{ error: 'x' }], '[{"error":"x"}]'],
  ['error_code-control', { error_code: 1, z: 2 }, '{"error_code":1,"z":2}'],
  ['envelope-lookalike-ok', { ok: true, canonical: 'x' }, '{"canonical":"x","ok":true}'],
  ['envelope-lookalike-error', { ok: false, error: 'x' }, '{"error":"x","ok":false}'],
  ...Object.entries(KEYS).map(([name, [key, escaped]]) => [`key-${name}`, { [key]: 1 }, `{"${escaped}":1}`]),
];
for (const [id, value, expected] of positives) check(`public/canonicalize/${id}`, 'public', () => dcp.canonicalize(value), returns(expected));

// Rejections: an Error with the canonicalizer's message, the key as JavaScript holds it (the quote is historically
// shown as an apostrophe).
for (const [name, [key]] of Object.entries(KEYS)) {
  const shown = key.replaceAll('"', "'");
  check(`public/canonicalize/fraction-${name}`, 'public', () => dcp.canonicalize({ [key]: 0.5 }),
    throwsError(`canonicalize: key '${shown}': ${NON_INTEGER}`));
}
check('public/canonicalize/fraction-under-error-key', 'public', () => dcp.canonicalize({ error: 0.5 }),
  throwsError(`canonicalize: key 'error': ${NON_INTEGER}`));
check('public/canonicalize/lone-surrogate', 'public', () => dcp.canonicalize({ a: '\ud800' }),
  (a) => a.kind === 'throw' && a.name === 'Error' && a.message.startsWith('canonicalize: JSON parse: '));
// JSON.stringify's own reading of a JS value is kept, not repaired (NaN becomes null before the binding).
check('public/canonicalize/nan-as-json-stringify-writes-it', 'public', () => dcp.canonicalize({ a: NaN }), returns('{"a":null}'));

// ── json_err through another public method: the envelope must parse, so the method throws its own Error ──
for (const name of ['ordinary', 'newline', 'backslash', 'tab']) {
  const key = KEYS[name][0];
  check(`public/compositeSign/fraction-${name}`, 'public',
    () => dcp.compositeSign('DCP-AI.v2.Intent', { [key]: 0.5 }, 'AA==', 'k', 'AA==', 'k'),
    throwsError(`compositeSign: key '${key}': ${NON_INTEGER}`));
}

// ── hashObject and deriveKid: a valid result has a fixed format; the error envelope never passes as one ──
check('public/hashObject/valid', 'public', () => dcp.hashObject({ a: 1 }), returns(sha256('{"a":1}')));
check('public/hashObject/error-key-valid', 'public', () => dcp.hashObject({ error: 'x' }), returns(sha256('{"error":"x"}')));
check('public/hashObject/lone-surrogate', 'public', () => dcp.hashObject({ a: '\ud800' }),
  (a) => a.kind === 'throw' && a.name === 'Error' && a.message.startsWith('hashObject: JSON parse: '));
const zeroKey = Buffer.alloc(32);
const kidOf = (alg, pk) => createHash('sha256').update(Buffer.concat([Buffer.from(alg), Buffer.from([0]), pk])).digest('hex').slice(0, 32);
check('public/deriveKid/valid', 'public', () => dcp.deriveKid('ed25519', zeroKey.toString('base64')), returns(kidOf('ed25519', zeroKey)));
check('public/deriveKid/invalid-base64', 'public', () => dcp.deriveKid('ed25519', '!'),
  (a) => a.kind === 'throw' && a.name === 'Error' && a.message.startsWith('deriveKid: base64 decode: '));

// ── Raw exports (./pkg), apart: the historical export keeps its contract; the new one is tagged ──
check('raw/canonicalize_v2/valid', 'raw', () => raw.wasm_canonicalize_v2('{"b":2,"a":1}'), returns('{"a":1,"b":2}'));
check('raw/canonicalize_v2/error-key-stays-ambiguous', 'raw', () => raw.wasm_canonicalize_v2('{"error":"x"}'), returns('{"error":"x"}'));
check('raw/canonicalize_v2/fraction-ordinary-bytes', 'raw', () => raw.wasm_canonicalize_v2('{"ordinary":0.5}'),
  returns(`{"error":"key 'ordinary': ${NON_INTEGER}"}`));
check('raw/canonicalize_v2/fraction-quote-bytes', 'raw', () => raw.wasm_canonicalize_v2('{"quote\\"key":0.5}'),
  returns(`{"error":"key 'quote'key': ${NON_INTEGER}"}`));
check('raw/canonicalize_v2/parse-error-bytes', 'raw', () => raw.wasm_canonicalize_v2('{'),
  returns('{"error":"JSON parse: EOF while parsing an object at line 1 column 1"}'));
for (const name of ['newline', 'backslash', 'backslash_n', 'tab', 'nul', 'unit_separator']) {
  const [key] = KEYS[name];
  check(`raw/canonicalize_v2/fraction-${name}-is-json`, 'raw', () => JSON.parse(raw.wasm_canonicalize_v2(JSON.stringify({ [key]: 0.5 }))),
    (a) => a.kind === 'return' && exactKeys(a.value, ['error']) && a.value.error === `key '${key}': ${NON_INTEGER}`);
}
const tagged = (text) => JSON.parse(raw.wasm_canonicalize_v2_result(text));
check('raw/canonicalize_v2_result/ok', 'raw', () => tagged('{"error":"x"}'),
  (a) => a.kind === 'return' && exactKeys(a.value, ['ok', 'canonical']) && a.value.ok === true && a.value.canonical === '{"error":"x"}');
check('raw/canonicalize_v2_result/ok-lookalike', 'raw', () => tagged('{"ok":false,"error":"x"}'),
  (a) => a.kind === 'return' && exactKeys(a.value, ['ok', 'canonical']) && a.value.ok === true && a.value.canonical === '{"error":"x","ok":false}');
check('raw/canonicalize_v2_result/fraction-newline', 'raw', () => tagged(JSON.stringify({ 'line\nbreak': 0.5 })),
  (a) => a.kind === 'return' && exactKeys(a.value, ['ok', 'error']) && a.value.ok === false && a.value.error === `key 'line\nbreak': ${NON_INTEGER}`);
check('raw/canonicalize_v2_result/parse-error', 'raw', () => tagged('{'),
  (a) => a.kind === 'return' && exactKeys(a.value, ['ok', 'error']) && a.value.ok === false && a.value.error.startsWith('JSON parse: '));

const hashes = Object.fromEntries(['pkg/dcp_ai.js', 'pkg/dcp_ai_bg.wasm', 'dist/index.js'].map((f) => [f, sha256(readFileSync(join(root, f)))]));
const failures = rows.filter((r) => !r.pass).map((r) => r.id);
const report = { runtime: `node ${process.version}`, root, hashes, checks: rows.length, passes: rows.length - failures.length, failures, rows };
const reportPath = opt('--report');
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checks: report.checks, passes: report.passes, failures }, null, 1));
process.exit(failures.length === 0 ? 0 : 1);
