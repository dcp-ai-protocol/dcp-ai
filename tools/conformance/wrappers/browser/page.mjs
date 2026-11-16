// Browser side of tools/conformance/wrappers/wasm-browser.mjs, served from its loopback server. It loads the public
// package (dist/index.js, which imports pkg/dcp_ai.js) and calls initDcp() as a web page does, then answers each case
// of the run's request through DcpWasm methods only, after JSON.parse of the case's bytes here. It reads no fixture
// and receives no expectation. It reports its environment, the exports it sees, the digest of every artifact it
// fetched and the clock shim, then posts once to the harness and renders what it posted.
//
// Contracts /1, /2 and /5 follow the classification of wrappers/wasm.mjs, through the class instead of the raw
// exports. The internal request dcp-ai-browser-direct/1 (browser/direct-sections.mjs) returns raw observations of
// direct method calls; its judge is in Node.
const REAL_NOW = Date.now;
const summary = document.getElementById('summary');
const pre = document.getElementById('result');
const describe = (e) => {
  try {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } catch {
    return 'an unprintable value';
  }
};
const MISSING_PQ = 'Signature error: pq_over_classical binding requires PQ signature';

// The documented number rejection behind path prefixes (`key '<k>': `, `array[<n>]: `): the automaton of
// wrappers/wasm.mjs, copied (that file is a script and cannot be imported). One pass, no backtracking; a message over
// 1 MiB of UTF-8 is never a rejection.
const MAX_REJECTION_MESSAGE = 1 << 20;
const REJECTION_TEXTS = ['Non-integer number in V2 canonical form: ', 'Non-finite number in V2 canonical form: '];
const KEY_OPEN = "key '";
const ARRAY_OPEN = 'array[';
const B = 1, KB = 1 << 5, E1 = 1 << 6, E2 = 1 << 7, D0 = 1 << 13, D = 1 << 14, F1 = 1 << 15, F2 = 1 << 16;
const K = (i) => 1 << i;
const A = (i) => 1 << (7 + i);
function step(set, c) {
  let next = 0;
  if (set & B) {
    if (c === KEY_OPEN[0]) next |= K(1);
    if (c === ARRAY_OPEN[0]) next |= A(1);
  }
  for (let i = 1; i <= 4; i++) if (set & K(i) && c === KEY_OPEN[i]) next |= i < 4 ? K(i + 1) : KB;
  if (set & KB) next |= c === "'" ? KB | E1 : KB;
  if (set & E1 && c === ':') next |= E2;
  if (set & E2 && c === ' ') next |= B;
  for (let i = 1; i <= 5; i++) if (set & A(i) && c === ARRAY_OPEN[i]) next |= i < 5 ? A(i + 1) : D0;
  const digit = c >= '0' && c <= '9';
  if (set & (D0 | D) && digit) next |= D;
  if (set & D && c === ']') next |= F1;
  if (set & F1 && c === ':') next |= F2;
  if (set & F2 && c === ' ') next |= B;
  return next;
}
function isDocumentedRejection(msg) {
  if (new TextEncoder().encode(msg).length > MAX_REJECTION_MESSAGE) return false;
  let set = B;
  for (let i = 0; set !== 0; i++) {
    if (set & B && REJECTION_TEXTS.some((t) => msg.startsWith(t, i))) return true;
    if (i === msg.length) return false;
    set = step(set, msg[i]);
  }
  return false;
}

const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const utf8 = (bytes) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const error = (id, e) => ({ id, status: 'error', message: describe(e).slice(0, 500) });
function observe(call) {
  try {
    return { kind: 'return', value: call() };
  } catch (e) {
    return { kind: 'throw', name: e?.name ?? null, message: e?.message ?? describe(e) };
  }
}

let fault = null;
// Every bundle case either calls verifyBundle under the shim (calls) or is answered before it, rejected by the page's
// parse (not_called, with its id): the harness checks that the two account for every case.
const clock = { calls: 0, not_called: [], restored_every_time: true, now_after: null };

// verifyBundle reads Date.now through the wasm glue: it returns the case's verification_time only during the one
// synchronous call and is restored in finally, also when the call throws.
function atTime(ms, call) {
  Date.now = () => ms;
  try {
    if (fault === 'verify-throws') throw new Error(`thrown inside the call at ${Date.now()}`);
    return call();
  } finally {
    if (fault !== 'clock-not-restored') Date.now = REAL_NOW;
    clock.calls += 1;
    if (Date.now !== REAL_NOW) clock.restored_every_time = false;
  }
}

function canonicalize(dcp, c) {
  let value;
  try {
    value = JSON.parse(utf8(fromB64(c.input_b64)));
  } catch {
    return { id: c.id, status: 'rejected', code: 'parse' };
  }
  try {
    return { id: c.id, status: 'ok', output_b64: toB64(new TextEncoder().encode(dcp.canonicalize(value))) };
  } catch (e) {
    // DcpWasm.canonicalize throws Error('canonicalize: <message of the binding>'); nothing else is a rejection.
    const msg = e?.name === 'Error' && typeof e.message === 'string' && e.message.startsWith('canonicalize: ') ? e.message.slice(14) : null;
    if (msg !== null && msg.startsWith('JSON parse: ')) return { id: c.id, status: 'rejected', code: 'parse' };
    if (msg !== null && isDocumentedRejection(msg)) return { id: c.id, status: 'rejected', code: 'profile' };
    return error(c.id, e);
  }
}

function digest(dcp, c) {
  let text;
  try {
    text = utf8(fromB64(c.input_b64));
  } catch {
    return { id: c.id, status: 'error', message: 'DcpWasm digests take text; these bytes are not UTF-8' };
  }
  try {
    return { id: c.id, status: 'ok', hex: c.alg === 'sha256' ? dcp.dualHash(text).sha256 : dcp.sha3_256(text) };
  } catch (e) {
    return error(c.id, e);
  }
}

function merkle(dcp, c) {
  try {
    const r = dcp.dualMerkleRoot(c.leaves);
    return { id: c.id, status: 'ok', sha256: r.sha256, sha3_256: r.sha3_256 };
  } catch (e) {
    return error(c.id, e);
  }
}

function composite(dcp, c) {
  let payload;
  try {
    payload = JSON.parse(utf8(fromB64(c.payload_b64)));
  } catch {
    return { id: c.id, status: 'rejected', code: 'parse' };
  }
  try {
    const r = dcp.compositeVerify(c.context, payload, c.composite_sig, c.classical_public_key_b64, c.pq_public_key_b64 ?? undefined);
    return { id: c.id, status: 'ok', valid: r.valid, classical_valid: r.classical_valid, pq_valid: r.pq_valid };
  } catch (e) {
    if (e?.name === 'Error' && e.message === `compositeVerify: ${MISSING_PQ}` && c.composite_sig?.binding === 'pq_over_classical' && c.composite_sig?.pq === null) {
      return { id: c.id, status: 'rejected', code: 'missing_pq_signature' };
    }
    return error(c.id, e);
  }
}

const exposed = (r, k) => (Object.hasOwn(r, k) ? { exposed: true, value: r[k] } : { exposed: false });
function bundle(dcp, c, effective) {
  let value;
  try {
    value = JSON.parse(utf8(fromB64(c.bundle_b64)));
  } catch (e) {
    clock.not_called.push({ id: c.id, reason: describe(e).slice(0, 200) });
    return { id: c.id, status: 'rejected', code: 'parse' };
  }
  let r;
  try {
    r = atTime(c.time_ms, () => dcp.verifyBundle(value, c.policy));
  } catch (e) {
    return error(c.id, e);
  }
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return { id: c.id, status: 'error', message: 'verifyBundle returned something other than an object' };
  const out = { id: c.id, status: 'ok', verified: r.verified, errors: r.errors };
  if (effective) out.effective = { verification_mode: exposed(r, 'verification_mode'), resolved_tier: exposed(r, 'resolved_tier') };
  return out;
}

// One signature bit flipped in the middle of a component's bytes; the length stays valid.
function flipped(sig, part) {
  const b = fromB64(sig[part].sig_b64);
  b[b.length >> 1] ^= 1;
  return { ...sig, [part]: { ...sig[part], sig_b64: toB64(b) } };
}

// A fresh hybrid key pair, generated here and never posted; only verdicts, algorithms and the binding leave the page.
function hybrid(dcp, c) {
  const kp = dcp.generateHybridKeypair();
  const sig = dcp.compositeSign(c.context, c.payload, kp.classical.secret_key_b64, kp.classical.kid, kp.pq.secret_key_b64, kp.pq.kid);
  const verify = (context, payload, s) => observe(() => {
    const r = dcp.compositeVerify(context, payload, s, kp.classical.public_key_b64, kp.pq.public_key_b64);
    return { valid: r.valid, classical_valid: r.classical_valid, pq_valid: r.pq_valid };
  });
  return {
    binding: sig.binding,
    algs: [sig.classical?.alg, sig.pq?.alg],
    kids_are_the_pair: sig.classical?.kid === kp.classical.kid && sig.pq?.kid === kp.pq.kid,
    signed: verify(c.context, c.payload, sig),
    payload_altered: verify(c.context, c.altered_payload, sig),
    context_altered: verify(c.other_context, c.payload, sig),
    classical_signature_altered: verify(c.context, c.payload, flipped(sig, 'classical')),
    pq_signature_altered: verify(c.context, c.payload, flipped(sig, 'pq')),
  };
}

function direct(dcp, c) {
  if (c.call === 'domainSeparatedMessage') return { id: c.id, observed: observe(() => dcp.domainSeparatedMessage(c.context, c.payload_hex)) };
  if (c.call === 'computeSecurityTier') {
    return { id: c.id, observed: observe(() => (Object.hasOwn(c, 'policy_decision') ? dcp.computeSecurityTier(c.intent, c.policy_decision) : dcp.computeSecurityTier(c.intent))) };
  }
  if (c.call === 'compositeVerify') {
    let payload;
    try {
      payload = JSON.parse(utf8(fromB64(c.payload_b64)));
    } catch (e) {
      return { id: c.id, observed: { kind: 'throw', name: 'payload', message: describe(e) } };
    }
    return { id: c.id, observed: observe(() => dcp.compositeVerify(c.context, payload, c.composite_sig, c.classical_public_key_b64, c.pq_public_key_b64 ?? undefined)) };
  }
  return { id: c.id, observed: observe(() => hybrid(dcp, c)) };
}

function answer(dcp, req, c) {
  if (req.contract === 'direct') return direct(dcp, c);
  if (c.op === 'canonicalize') return canonicalize(dcp, c);
  if (c.op === 'digest') return digest(dcp, c);
  if (c.op === 'dual_merkle_root') return merkle(dcp, c);
  if (c.op === 'composite_verify') return composite(dcp, c);
  return bundle(dcp, c, req.contract === 5);
}

// Self-test faults for the direct judge (browser/direct-sections.mjs): a repeated answer, a throw where a value is
// expected, and, in every section, the first returned value altered.
function directFault(req, results) {
  if (fault === 'duplicate-answer') results.push({ ...results[0] });
  if (fault === 'error-for-rejection') results[0] = { id: results[0].id, observed: { kind: 'throw', name: 'Error', message: 'fault: an error where a value is expected' } };
  if (fault !== 'invert-verdict') return;
  const seen = new Set();
  results.forEach((r, i) => {
    const call = req.cases[i].call;
    if (seen.has(call) || r.observed?.kind !== 'return') return;
    seen.add(call);
    const v = r.observed.value;
    if (call === 'domainSeparatedMessage') r.observed.value = v.slice(0, -1) + (v.endsWith('0') ? '1' : '0');
    else if (call === 'computeSecurityTier') r.observed.value = { ...v, tier: v.tier === 'routine' ? 'maximum' : 'routine' };
    else if (call === 'compositeVerify') r.observed.value = { ...v, valid: !v.valid, classical_valid: !v.classical_valid };
    else r.observed.value = { ...v, signed: { kind: 'return', value: { ...v.signed.value, valid: false } } };
  });
}

const environment = () => ({
  user_agent: navigator.userAgent,
  node_absent: typeof process === 'undefined',
  secure_context: window.isSecureContext,
  webassembly: typeof WebAssembly === 'object',
});

async function run() {
  let req = null;
  const body = { run_id: null, nonce: null, terminal: 'infrastructure_failure', error: null, environment: environment(), api: null, received_sha256: null, clock, results: [] };
  try {
    req = await (await fetch('request', { cache: 'no-store' })).json();
    fault = req.fault;
    body.run_id = req.run_id;
    body.nonce = fault === 'bad-nonce' ? `${req.nonce}-stale` : req.nonce;
    const mod = await import('./dist/index.js');
    const raw = await import('./pkg/dcp_ai.js');
    const dcp = await mod.initDcp();
    body.api = { module: Object.keys(mod).sort(), prototype: Object.getOwnPropertyNames(mod.DcpWasm.prototype).sort(), raw: Object.keys(raw).sort() };
    if (fault === 'extra-export') body.api.module = [...body.api.module, 'injectedExport'].sort();
    body.results = req.cases.map((c) => {
      try {
        return answer(dcp, req, c);
      } catch (e) {
        return error(c.id, e);
      }
    });
    clock.now_after = Date.now();
    body.received_sha256 = {};
    for (const rel of req.assets) {
      body.received_sha256[rel] = hex(await crypto.subtle.digest('SHA-256', await (await fetch(new URL(rel, location.href), { cache: 'no-store' })).arrayBuffer()));
    }
    if (fault === 'wrong-hash') body.received_sha256['pkg/dcp_ai_bg.wasm'] = '0'.repeat(64);
    if (fault === 'drop-case') body.results.shift();
    if (fault === 'invert-verdict') {
      const r = body.results.find((x) => typeof x.verified === 'boolean');
      if (r) r.verified = !r.verified;
    }
    if (fault === 'error-for-rejection') {
      const i = body.results.findIndex((x) => x.status === 'rejected' || x.verified === false);
      if (i >= 0) body.results[i] = { id: body.results[i].id, status: 'error', message: 'fault: an error where a rejection is expected' };
    }
    if (req.contract === 'direct') directFault(req, body.results);
    if (fault === 'unexpected-request') await fetch('dist/not-in-the-allowlist.js', { cache: 'no-store' }).catch(() => {});
    body.terminal = 'done';
    if (fault === 'done-with-error') body.error = 'fault: done and an error at once';
  } catch (e) {
    body.error = describe(e);
    clock.now_after = Date.now();
  }
  const tally = {};
  for (const r of body.results) tally[r.status ?? r.observed?.kind] = (tally[r.status ?? r.observed?.kind] ?? 0) + 1;
  pre.textContent = JSON.stringify(body, null, 1);
  let harness = 'not sent (fault: no-result)';
  if (fault !== 'no-result') {
    const post = () => fetch('result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const res = await post();
      harness = `received (HTTP ${res.status})`;
      if (fault === 'duplicate-post') harness += `; second post HTTP ${(await post()).status}`;
    } catch (e) {
      harness = `not received (${describe(e)})`;
    }
  }
  const counts = Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ');
  summary.textContent = `terminal: ${body.terminal}${body.error ? ` (${body.error})` : ''}; ${body.results.length} results (${counts || 'none'}); result post: ${harness}`;
  document.title = `DCP WASM browser run: ${body.terminal}`;
}

run();
