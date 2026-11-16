// strict-v1 admission with @dcp-ai/express over real HTTP, the bundle in the JSON body.
//
// The recommended way to send a hybrid bundle: in `signed_bundle` of a JSON body, under a body
// budget you choose. A hybrid bundle (Ed25519 + ML-DSA-65) is about 33 KB, above Node's default
// 16 KiB header limit, so in the X-DCP-Bundle header Node refuses it with 431 before Express runs.
//
// Runs offline on the shared admission vectors (synthetic keys and bundles): the operator's trust
// set and profile, a clock fixed at the vectors' time, and a local revocation source that answers
// "not revoked" for the subjects it is asked about, 30 s before that time. It checks every outcome
// below on 127.0.0.1, closes its server and exits 1 if any outcome is not the expected one.
//
//   cd integrations/express && npm run build && node examples/strict-v1-body.mjs [--report FILE]
//
// In a real deployment: drop `clock`, load the trust set from your own configuration, take the
// tenant from your own authentication, use denyListRevocationSource({ url }) or your own source,
// and size the body budget for your bundles and every proxy in front of the server (README.md).

import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { dcpVerify } from '../dist/index.js';

const vectors = JSON.parse(readFileSync(new URL('../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const now = Date.parse(vectors.cases.find((c) => c.name === 'A_known_principal_strict').now);

// This example's choice, not a protocol limit: twice the size of its largest bundle (33 KB).
// Measure your largest bundle (it grows with audit entries and PQ checkpoints) and leave margin.
const BODY_BUDGET_BYTES = 64 * 1024;

// The operator's configuration, kept apart from requests: nothing in a request selects it.
const operator = { trustSet: vectors.trust_sets.principal, profile: vectors.profiles.strict };

// How far each request got: Express, past the body parser, the trust and revocation sources, the
// route. A request the budget refuses must stop at the parser.
const counters = { express: 0, parsed: 0, trust_source: 0, revocation_source: 0, handler: 0, body_refused: 0 };

const app = express();
app.use((req, res, next) => (counters.express++, next()));
// Verification and admission cost CPU (ML-DSA, a revocation lookup): rate-limit what reaches them.
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));
app.use(express.json({ limit: BODY_BUDGET_BYTES }));
app.use((req, res, next) => (counters.parsed++, next()));
app.post(
  '/agent/action',
  dcpVerify({
    trustedPrincipals: () => (counters.trust_source++, operator.trustSet),
    profile: operator.profile,
    revocationSource: async ({ agent_ids, kids }) => {
      counters.revocation_source++;
      return {
        checked_at: new Date(now - 30_000).toISOString(),
        agents: Object.fromEntries(agent_ids.map((id) => [id, 'not_revoked'])),
        keys: Object.fromEntries(kids.map((kid) => [kid, 'not_revoked'])),
      };
    },
    clock: () => now,
  }),
  (req, res) => {
    counters.handler++;
    // Admission says the evidence is authentic and comes from a principal you trust. It is not a
    // permission to run the action: `actionAuthorized` is always false, and your own
    // authorization decides what the request may do.
    res.json({ reached: true, admission: req.dcpAgent.admission });
  },
);
app.use((err, req, res, next) => {
  if (err?.type !== 'entity.too.large') return next(err);
  counters.body_refused++;
  res.status(413).json({ error: `Request body over ${BODY_BUDGET_BYTES} bytes` });
});

function send(port, { headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/agent/action', method: 'POST', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // a response that is not JSON (Node's own 431) is reported by its status
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

const json = (value) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const base = vectors.signed_bundles.base;
const bundleBytes = Buffer.byteLength(JSON.stringify(base));
const filler = 'x'.repeat(BODY_BUDGET_BYTES);
const none = { express: 0, parsed: 0, trust_source: 0, revocation_source: 0, handler: 0, body_refused: 0 };

// Each case: the request, the expected status, the counters it must move (others must stay at 0
// unless listed in `free`), and a check of the response body.
const CASES = [
  {
    name: 'trusted bundle in the body',
    request: json({ signed_bundle: base }),
    status: 200,
    counters: { ...none, express: 1, parsed: 1, trust_source: 1, revocation_source: 1, handler: 1 },
    check: (b) => b?.reached === true && b.admission?.admitted === true && b.admission.principalTrust === 'trusted'
      && b.admission.profileCompliance === 'compliant' && b.admission.actionAuthorized === false,
  },
  {
    name: 'unknown principal in the body',
    request: json({ signed_bundle: vectors.signed_bundles.unknown_principal }),
    status: 403,
    counters: { ...none, express: 1, parsed: 1 },
    free: ['trust_source', 'revocation_source'],
    check: (b) => b?.admitted === false && JSON.stringify(b.codes) === '["TRUST_PRINCIPAL_UNKNOWN"]',
  },
  {
    name: 'bundle for another verifier in the body',
    request: json({ signed_bundle: vectors.signed_bundles.other_intended_verifier }),
    status: 403,
    counters: { ...none, express: 1, parsed: 1 },
    free: ['trust_source', 'revocation_source'],
    check: (b) => b?.admitted === false && [...b.codes].sort().join() === 'PROFILE_AUDIENCE_MISMATCH,VERIFICATION_FAILED',
  },
  {
    name: 'body over the budget',
    request: json({ signed_bundle: base, filler }),
    status: 413,
    // Refused by the body parser: verification, trust and revocation never run.
    counters: { ...none, express: 1, body_refused: 1 },
    check: (b) => typeof b?.error === 'string',
  },
];
// Still supported for bundles that fit the header limits of the server and every proxy; a hybrid
// bundle does not fit Node's default, and Node answers 431 before Express sees the request.
if (bundleBytes > http.maxHeaderSize) {
  CASES.push({
    name: 'same hybrid bundle in the X-DCP-Bundle header',
    request: { headers: { 'x-dcp-bundle': JSON.stringify(base) } },
    status: 431,
    counters: { ...none },
    check: () => true,
  });
}

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => (server.once('listening', resolve), server.once('error', reject)));
const results = [];
try {
  for (const c of CASES) {
    const before = { ...counters };
    let response;
    try {
      response = await send(server.address().port, c.request);
    } catch (e) {
      response = { status: null, error: e.message };
    }
    const moved = Object.fromEntries(Object.keys(counters).map((k) => [k, counters[k] - before[k]]));
    const countersOk = Object.keys(c.counters).every((k) => c.free?.includes(k) || moved[k] === c.counters[k]);
    const ok = response.status === c.status && countersOk && c.check(response.json);
    results.push({
      case: c.name, request_bytes: Buffer.byteLength(c.request.body ?? '') + Buffer.byteLength(c.request.headers['x-dcp-bundle'] ?? ''),
      status: response.status, expected_status: c.status, counters: moved, response: response.json ?? response.error ?? null, ok,
    });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(response.status).padEnd(4)} ${c.name}  ${JSON.stringify(moved)}`);
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

const pass = results.every((r) => r.ok);
const report = {
  node: process.version,
  http_max_header_size: http.maxHeaderSize,
  body_budget_bytes: BODY_BUDGET_BYTES,
  hybrid_bundle_bytes: bundleBytes,
  clock: new Date(now).toISOString(),
  results,
  pass,
};
const out = process.argv.indexOf('--report');
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(report, null, 2) + '\n');
console.log(pass ? 'EXAMPLE PASS: every outcome as expected' : 'EXAMPLE FAIL: an outcome was not the expected one');
process.exit(pass ? 0 : 1);
