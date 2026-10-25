/**
 * denyListRevocationSource leaves no response open (PR 78 review, FR1). Whatever way it settles,
 * the body it did not read (an error status, a declared or streamed oversize, a timeout or the
 * caller's signal during the body) is closed: the upstream deny-list server sees each response
 * close, not only a rejected promise. Through a real Express app with one slot (global and per
 * tenant) and consecutive requests; a complete list is the positive control.
 */
import type { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { afterEach, describe, expect, it } from 'vitest';
import { createSourceSupervisor, dcpVerify, denyListRevocationSource, type RevocationSource, type SourceSupervisor } from '../index.js';

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const strictCase = VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict');
const NOW = Date.parse(strictCase.now);
const LIST = { updated_at: strictCase.revocation.checked_at, revocations: [], kid_revocations: [] };
const MAX = 16 * 1024 * 1024;
const SUBJECTS = { agent_ids: [], kids: [] } as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i++) await sleep(5);
  expect(check()).toBe(true);
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise((r) => s.close(r));
    }),
  );
});
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

type Mode = 'valid' | 'status-503' | 'declared-oversize' | 'streamed-oversize' | 'pending-body';

/**
 * A deny-list server. Except for `valid`, its answer never ends: after the status and the first
 * bytes it writes one more byte every 20 ms until the client closes it. `open()` counts the
 * responses not closed yet, from the server's side.
 */
async function upstream(mode: Mode) {
  const responses: Array<{ closed: boolean }> = [];
  const url = await listen(
    createServer((_req, res) => {
      const entry = { closed: false };
      responses.push(entry);
      let timer: NodeJS.Timeout | undefined;
      res.on('close', () => {
        entry.closed = true;
        clearInterval(timer);
      });
      if (mode === 'valid') return void res.end(JSON.stringify(LIST));
      res.writeHead(mode === 'status-503' ? 503 : 200, mode === 'declared-oversize' ? { 'content-length': String(MAX + 1) } : {});
      if (mode === 'streamed-oversize') for (let i = 0; i <= 16; i++) res.write(Buffer.alloc(1024 * 1024, 0x20));
      else res.write(mode === 'pending-body' ? '{"updated_at":' : ' ');
      timer = setInterval(() => res.write(' '), 20);
    }),
  );
  return { url: `${url}/.well-known/dcp-revocations.json`, responses, open: () => responses.filter((r) => !r.closed).length };
}

/** strict-v1 through Express, its revocation supervised by `supervisor` with a 5 s deadline. */
async function app(revocationSource: RevocationSource, supervisor: SourceSupervisor) {
  const a = express();
  a.use(rateLimit({ windowMs: 60_000, limit: 10 })); // each app here answers 2 requests
  a.use(express.json({ limit: '5mb' }));
  const options = {
    clock: () => NOW,
    trustedPrincipals: VECTORS.trust_sets.principal,
    profile: VECTORS.profiles.strict,
    revocationSource,
    revocationTimeoutMs: 5_000,
    sourceSupervisor: supervisor,
    supervise: { revocation: true },
  };
  a.post('/p', dcpVerify(options), (_req, res) => res.json({ ok: true }));
  const url = await listen(createServer(a));
  return async () => {
    const r = await fetch(`${url}/p`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signed_bundle: VECTORS.signed_bundles.base }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
}

describe('denyListRevocationSource closes what it did not read (FR1)', () => {
  it('a complete list, twice with one slot: admitted, no response left open', async () => {
    const up = await upstream('valid');
    const s = createSourceSupervisor({ maxInFlight: 1, maxInFlightPerTenant: 1 });
    const post = await app(denyListRevocationSource({ url: up.url, timeoutMs: 60_000 }), s);
    for (let i = 0; i < 2; i++) expect(await post()).toEqual({ status: 200, body: { ok: true } });
    expect(up.responses).toHaveLength(2);
    await until(() => up.open() === 0);
    expect(s.stats().inFlight).toBe(0);
  });

  // Its own timeout and the supervisor's deadline are far away: only the fix can close these.
  it.each([
    { mode: 'status-503' as const, code: 'REVOCATION_UNAVAILABLE', timeoutMs: 60_000 },
    { mode: 'declared-oversize' as const, code: 'REVOCATION_INVALID', timeoutMs: 60_000 },
    { mode: 'streamed-oversize' as const, code: 'REVOCATION_INVALID', timeoutMs: 60_000 },
    // Its own timeout during the body (closed before the fix too): the control of the same path.
    { mode: 'pending-body' as const, code: 'REVOCATION_UNAVAILABLE', timeoutMs: 150 },
  ])('$mode with an open body, twice with one slot: $code, and each response closed (checked before the next request)', async ({ mode, code, timeoutMs }) => {
    const up = await upstream(mode);
    const s = createSourceSupervisor({ maxInFlight: 1, maxInFlightPerTenant: 1 });
    const post = await app(denyListRevocationSource({ url: up.url, timeoutMs }), s);
    for (let i = 0; i < 2; i++) {
      const { status, body } = await post();
      expect({ status, admitted: body.admitted, codes: body.codes }).toEqual({ status: 403, admitted: false, codes: [code] });
      await until(() => up.open() === 0);
    }
    expect(up.responses).toHaveLength(2);
    expect(s.stats()).toMatchObject({ inFlight: 0, timeouts: 0, saturated: 0 });
  });

  it.each([
    { mode: 'status-503' as const, code: 'REVOCATION_UNAVAILABLE' },
    { mode: 'declared-oversize' as const, code: 'REVOCATION_INVALID' },
  ])('called directly, $mode: the response is closed without the caller\'s signal or a timeout', async ({ mode, code }) => {
    const up = await upstream(mode);
    const caller = new AbortController();
    await expect(denyListRevocationSource({ url: up.url, timeoutMs: 60_000 })(SUBJECTS, { tenant: '', signal: caller.signal })).rejects.toMatchObject({ code });
    await until(() => up.open() === 0);
    expect(caller.signal.aborted).toBe(false);
  });

  it('the caller\'s signal while the body is pending: REVOCATION_UNAVAILABLE and the response closed', async () => {
    const up = await upstream('pending-body');
    const caller = new AbortController();
    const pending = denyListRevocationSource({ url: up.url, timeoutMs: 60_000 })(SUBJECTS, { tenant: '', signal: caller.signal });
    await until(() => up.responses.length === 1);
    await sleep(100); // the status and the first bytes have arrived
    caller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'REVOCATION_UNAVAILABLE' });
    await until(() => up.open() === 0);
  });
});

/**
 * Node's fetch follows its signal weakly: once its request is garbage-collected (after the headers),
 * aborting no longer reaches the body. The helper stops its own read instead. Run in a child with
 * --expose-gc, on this package's helper bundled with the esbuild already installed.
 */
const GC_CHILD = `
import http from 'node:http';
import { createRequire } from 'node:module';
const { denyListRevocationSource } = createRequire(import.meta.url)('./helper.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The phase is observed, not assumed: the native fetch's headers have arrived, a turn has passed
// for the read to start, and the call is still pending when gc() runs.
const nativeFetch = globalThis.fetch;
let headers;
globalThis.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  headers?.();
  return response;
};
let open = 0;
const timers = new Set();
const upstream = http.createServer((_req, res) => {
  open++;
  const timer = setInterval(() => res.write(' '), 20);
  timers.add(timer);
  res.on('close', () => { open--; clearInterval(timer); timers.delete(timer); });
  res.writeHead(200);
  res.write('{"updated_at":');
});
const results = [];
try {
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + upstream.address().port + '/list.json';
  for (const how of ['timeout', 'caller']) {
    for (let i = 0; i < 3; i++) {
      const caller = new AbortController();
      const arrived = new Promise((r) => (headers = r));
      const source = denyListRevocationSource({ url, timeoutMs: how === 'timeout' ? 300 : 60000 });
      let settled = false;
      const call = source({ agent_ids: [], kids: [] }, { tenant: '', signal: caller.signal }).then(() => 'resolved', (e) => e.code).finally(() => (settled = true));
      await arrived;
      await new Promise((r) => setImmediate(r));
      if (settled) throw new Error('the call settled before the garbage collection: the body read was not exercised');
      globalThis.gc();
      if (how === 'caller') caller.abort();
      let guard;
      const outcome = await Promise.race([call, new Promise((r) => (guard = setTimeout(r, 3000, 'hung')))]);
      clearTimeout(guard);
      for (let waited = 0; open > 0 && waited < 2000; waited += 5) await sleep(5);
      results.push({ how, outcome, open });
    }
  }
} finally {
  for (const timer of timers) clearInterval(timer);
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  globalThis.fetch = nativeFetch;
}
console.log(JSON.stringify(results));
`;

describe('denyListRevocationSource after a garbage collection (FR1)', () => {
  it('its own timeout and the caller\'s signal still end the body read and close the response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcp-deny-list-gc-'));
    try {
      const { build } = await import('esbuild');
      await build({ entryPoints: [fileURLToPath(new URL('../dcp-verify.ts', import.meta.url))], outfile: join(dir, 'helper.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
      writeFileSync(join(dir, 'child.mjs'), GC_CHILD);
      const child = spawnSync(process.execPath, ['--expose-gc', join(dir, 'child.mjs')], { encoding: 'utf8', timeout: 60_000 });
      // Exits by itself once its servers and timers are closed: a leak is a timeout here, an exception a status.
      expect({ status: child.status, signal: child.signal }, child.stderr).toEqual({ status: 0, signal: null });
      const results = JSON.parse(child.stdout.trim().split('\n').pop()!);
      expect(results).toEqual(['timeout', 'timeout', 'timeout', 'caller', 'caller', 'caller'].map((how) => ({ how, outcome: 'REVOCATION_UNAVAILABLE', open: 0 })));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
