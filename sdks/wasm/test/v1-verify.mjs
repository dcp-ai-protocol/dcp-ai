// V1 verification through the built wasm package, where it used to trap: std::time::Instant::now()
// panics on wasm32-unknown-unknown, and the V1 path of both verify bindings reached it. Checks valid and
// invalid V1 bundles through wasm_verify_signed_bundle and the V1 branch of wasm_verify_signed_bundle_v2,
// V2 controls, and the same verdicts and errors whatever the state of the JavaScript `performance`
// clock (normal, missing, throwing, NaN, Infinity, going backwards, finite readings with an infinite
// difference, a BigInt, a string, an object whose valueOf throws), restored afterwards.
// Needs `npm run build:wasm` and `npm run build:ts` first.
import { readFileSync } from 'node:fs';
import * as pkg from '../pkg/dcp_ai.js';
import { initDcp } from '../dist/index.js';

const root = new URL('../../../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

const conformanceV1 = read('tests/conformance/examples/citizenship_bundle.signed.json');
const admissionV1 = read('tests/interop/v2/admission_vectors.json').signed_bundles.v1_bundle;
const vectors = read('tests/interop/v2/bundle_vectors.json');
const otherKey = JSON.parse(pkg.wasm_generate_keypair()).public_key_b64;
const b64 = (n) => Buffer.alloc(n, 7).toString('base64');
const withSignature = (signed, changes) => {
  const out = structuredClone(signed);
  Object.assign(out.signature, changes);
  return out;
};
const sig = conformanceV1.signature.sig_b64;

// [label, signed bundle, explicit public key for wasm_verify_signed_bundle, expected verdict, expected errors]
const V1 = [
  ['valid conformance V1', conformanceV1, undefined, true, []],
  ['valid admission V1', admissionV1, undefined, true, []],
  ['signature altered', withSignature(conformanceV1, { sig_b64: (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1) }), undefined, false, ['SIGNATURE INVALID']],
  ['signer key altered', withSignature(conformanceV1, { signer: { ...conformanceV1.signature.signer, public_key_b64: otherKey } }), undefined, false, ['SIGNATURE INVALID']],
  ['explicit wrong key', conformanceV1, otherKey, false, ['SIGNATURE INVALID']],
  ['signature of 63 bytes', withSignature(conformanceV1, { sig_b64: b64(63) }), undefined, false, ['SIGNATURE INVALID']],
  ['key of 31 bytes', withSignature(conformanceV1, { signer: { ...conformanceV1.signature.signer, public_key_b64: b64(31) } }), undefined, false, ['SIGNATURE INVALID']],
  ['signature not base64', withSignature(conformanceV1, { sig_b64: '!!!not base64!!!' }), undefined, false, ['SIGNATURE INVALID']],
  ['sig_b64 not a string', withSignature(conformanceV1, { sig_b64: 7 }), undefined, false, ['Missing sig_b64']],
];
const V2 = [
  ['V2 signed bundle', vectors.signed_bundle, true],
  [`V2 ${vectors.must_reject_bundles[0].name}`, vectors.must_reject_bundles[0].signed_bundle, false],
];

const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};

/** Every case through both bindings: verdict and errors, or the exception it threw. */
function runAll() {
  const out = {};
  const call = (fn) => {
    try {
      const r = JSON.parse(fn());
      return { verified: r.verified, errors: r.errors ?? [] }; // a verified result may omit errors
    } catch (e) {
      return { threw: `${e?.constructor?.name}: ${e?.message}` };
    }
  };
  for (const [label, signed, key] of V1) {
    out[`v1-binding ${label}`] = call(() => pkg.wasm_verify_signed_bundle(JSON.stringify(signed), key));
    if (key === undefined) out[`v2-binding ${label}`] = call(() => pkg.wasm_verify_signed_bundle_v2(JSON.stringify(signed), undefined));
  }
  for (const [label, signed] of V2) out[`v2-binding ${label}`] = call(() => pkg.wasm_verify_signed_bundle_v2(JSON.stringify(signed), undefined));
  return out;
}

const normal = runAll();
for (const [label, , key, verified, errors] of V1) {
  for (const binding of key === undefined ? ['v1-binding', 'v2-binding'] : ['v1-binding']) {
    const r = normal[`${binding} ${label}`];
    check(`${binding} ${label}`, r.threw === undefined && r.verified === verified && JSON.stringify(r.errors) === JSON.stringify(errors), r);
  }
}
for (const [label, , verified] of V2) {
  const r = normal[`v2-binding ${label}`];
  check(`v2-binding ${label}`, r.threw === undefined && r.verified === verified && (verified ? r.errors.length === 0 : r.errors.length > 0), r);
}

// The clock states: verdicts and errors must not change, and nothing may trap. A mocked `now` counts its
// calls, which shows the stopwatch did read it.
let valueOfCalls = 0;
const original = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const originalValue = globalThis.performance;
const states = {
  missing: null,
  throwing: () => {
    throw new Error('synthetic');
  },
  nan: () => NaN,
  infinity: () => Infinity,
  backwards: (() => {
    let t = 1_000_000;
    return () => (t -= 1);
  })(),
  // Finite readings whose difference is infinite: no latency sample, nothing else changes.
  'infinite span': (() => {
    let i = 0;
    return () => (i++ % 2 === 0 ? -Number.MAX_VALUE : Number.MAX_VALUE);
  })(),
  // Values that are not numbers are never converted: no valueOf runs, and no sample is taken.
  bigint: () => 10n,
  string: () => '5',
  'object whose valueOf throws': () => ({
    valueOf() {
      valueOfCalls++;
      throw new Error('synthetic');
    },
  }),
};
for (const [state, now] of Object.entries(states)) {
  let calls = 0;
  let results;
  try {
    if (now === null) {
      delete globalThis.performance;
    } else {
      Object.defineProperty(globalThis, 'performance', {
        value: { now: (...a) => (calls++, now(...a)) },
        configurable: true,
        writable: true,
        enumerable: original?.enumerable ?? true,
      });
    }
    results = runAll();
  } finally {
    Object.defineProperty(globalThis, 'performance', original);
  }
  check(`${state}: same verdicts and errors, no trap`, JSON.stringify(results) === JSON.stringify(normal), results);
  if (now !== null) check(`${state}: the stopwatch read performance.now`, calls > 0, calls);
}
check('no valueOf ran', valueOfCalls === 0, valueOfCalls);
check('performance restored', globalThis.performance === originalValue && typeof performance.now() === 'number', null);

if (failures.length > 0) {
  console.error(`v1 verify (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`v1 verify (wasm): ${checks} checks passed (V1 through both bindings, V2 controls, 10 performance states)`);
