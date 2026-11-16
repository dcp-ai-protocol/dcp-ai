// Real Express application, installed consumer only. No cryptographic load: exhaust the
// request budget on unauthenticated operator reads, then check both action routes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ServerProcess } from '../../process.mjs';
import { KIT, assertVerified, readJson } from '../common.mjs';
import { init } from '../operator.mjs';

test('Express bounds requests before authentication and action ingress, ignoring spoofed forwarding headers', { timeout: 30_000 }, async (t) => {
  const consumer = path.dirname(path.dirname(KIT));
  const verified = process.env.REHEARSAL_VERIFY_REPORT;
  assert.ok(verified, 'set REHEARSAL_VERIFY_REPORT to the launcher verify.json');
  assertVerified(verified, consumer);
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mp05-rate-limit-')));
  const state = path.join(dir, 'state');
  const run = path.join(dir, 'run');
  fs.mkdirSync(run);
  init(state);
  const tokens = readJson(path.join(state, 'secrets', 'tokens.json'));
  const config = path.join(dir, 'app.json');
  fs.writeFileSync(config, JSON.stringify({
    lane: 'node', consumer, verify_report: verified, state, run,
    revocation: { deny_list_url: 'http://127.0.0.1:1/deny-list.json', mandates_url: 'http://127.0.0.1:1/mandates.json' },
  }));
  const server = new ServerProcess([process.execPath, path.join(KIT, 'node', 'app-express.mjs'), config], { cwd: KIT });
  t.after(async () => {
    const result = await server.stop(3000);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(result.clean, true, JSON.stringify(result));
  });
  await server.ready();
  const base = `http://127.0.0.1:${server.port}`;
  const request = async (url, options = {}) => {
    const r = await fetch(base + url, { ...options, signal: AbortSignal.timeout(3000) });
    return { status: r.status, retry: r.headers.get('retry-after'), body: await r.json() };
  };
  const positive = await request('/v1/operator/state', { headers: { authorization: `Bearer ${tokens.operator}` } });
  assert.equal(positive.status, 200);
  assert.equal(positive.body.trust_calls, 0);
  for (let i = 1; i < 600; i++) {
    assert.equal((await request('/v1/operator/state')).status, 401, `within budget ${i + 1}`);
  }
  for (const route of ['/v1/operator/state', '/v1/direct/actions/quote', '/v1/delegated/actions/quote']) {
    const action = route.includes('/actions/');
    const r = await request(route, {
      method: action ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${action ? tokens.tenants.T1 : tokens.operator}`, 'x-forwarded-for': '198.51.100.7', ...(action ? { 'content-type': 'application/json' } : {}) },
      ...(action ? { body: '{}' } : {}),
    });
    assert.equal(r.status, 429, route);
    assert.equal(r.body.code, 'APP_RATE_LIMITED');
    assert.ok(Number(r.retry) > 0);
  }
  assert.equal(fs.existsSync(path.join(run, 'observations.jsonl')), false, 'action ingress never ran');
  assert.equal(fs.existsSync(path.join(run, 'executions.jsonl')), false, 'no application effect');
  assert.deepEqual(fs.readdirSync(path.join(run, 'ledger')), [], 'no reservation');
});
