/**
 * cancelOnDisconnect (docs/reviews/client-disconnect-plan.md 1.1) through a real Express app over
 * loopback HTTP, with raw sockets that leave: a healthy request's own `close` is not a
 * disconnect; a client that leaves cancels its supervised invocation, and only that one, whose slot
 * stays taken until the source really settles; nothing is written, no handler or onFailure runs;
 * configuration; and the supervisor's runWithSignal capability, deterministic, including
 * re-entrant aborts. Fixtures are released after every test, failed or not.
 *
 *   DCP_NEGATIVE_CONTROL=1 npx vitest run src/__tests__/client-disconnect.test.ts   # must fail once
 */
import { readFileSync } from 'node:fs';
import { getEventListeners, once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createSourceSupervisor, dcpVerify, type DCPVerifyOptions, type SourceSupervisor, type SourceSupervisorStats } from '../index.js';
import { supervise, supportsCancellation } from '../source-supervisor.js';

// @dcp-ai/openclaw's copies, loaded at run time: they lie outside this package's rootDir.
const OPENCLAW = fileURLToPath(new URL('../../../openclaw/src/', import.meta.url));
const { createSourceSupervisor: createFromOpenClawCopy } = (await import(`${OPENCLAW}tools/source-supervisor.ts`)) as typeof import('../source-supervisor.js');

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bundle = (name = 'base') => clone(VECTORS.signed_bundles[name]);
const NOW = Date.parse(VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict').now);
const CLEAR = () => clone(VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict').revocation);
const STRICT = VECTORS.profiles.strict;
const TRUSTED = VECTORS.trust_sets.principal;
const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i++) await sleep(5);
  expect(check()).toBe(true);
};

// Released after every test, also a failed one.
const servers: Server[] = [];
const sockets: Socket[] = [];
const held: Array<ReturnType<typeof deferred>> = [];
const hold = () => {
  const d = deferred();
  held.push(d);
  return d;
};
afterEach(async () => {
  held.splice(0).forEach((d) => d.resolve(TRUSTED));
  sockets.splice(0).forEach((s) => s.destroy());
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise((r) => s.close(r));
    }),
  );
});

type Seen = { reached: string[]; writes: string[]; events: string[]; listeners: Record<string, number[]> };

/** An Express app over loopback; requests name themselves with x-test-id, and every write is recorded. */
async function app(options: DCPVerifyOptions, { before }: { before?: RequestHandler } = {}) {
  const seen: Seen = { reached: [], writes: [], events: [], listeners: {} };
  const a = express();
  a.use(rateLimit({ windowMs: 60_000, limit: 10_000 }));
  a.use(express.json({ limit: '5mb' }));
  a.use((req: any, res, next) => {
    const id = String(req.headers['x-test-id'] ?? '');
    req.auth = { tenant: String(req.headers.authorization ?? 'Bearer tenant-a').replace('Bearer ', '') };
    for (const method of ['writeHead', 'write', 'end'] as const) {
      const original = (res as any)[method].bind(res);
      (res as any)[method] = (...args: unknown[]) => {
        seen.writes.push(`${id}:${method}`);
        return original(...args);
      };
    }
    const count = () => res.listenerCount('close') + res.listenerCount('finish') + req.listenerCount('close');
    req.on('close', () => seen.events.push(`${id}:request-close`));
    res.on('finish', () => seen.events.push(`${id}:response-finish`));
    res.on('close', () => setImmediate(() => (seen.listeners[id] ??= []).push(count())));
    (seen.listeners[id] ??= []).push(count()); // the count before dcpVerify, our own listeners included
    next();
  });
  if (before) a.use(before);
  a.post('/p', dcpVerify({
    clock: () => NOW,
    tenant: (req: any) => req.auth.tenant,
    ...options,
  }), (req: any, res) => {
    seen.reached.push(String(req.headers['x-test-id'] ?? ''));
    res.json({ ok: true });
  });
  const server = createServer({ maxHeaderSize: 256 * 1024 }, a);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const post = async (id: string, tenant = 'tenant-a') => {
    const r = await fetch(`http://127.0.0.1:${port}/p`, {
      signal: AbortSignal.timeout(4000), // a request that never gets an answer fails here, not by the test timeout
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tenant}`, 'x-test-id': id },
      body: JSON.stringify({ signed_bundle: bundle() }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  /** A request on a raw socket that the test can drop; `partial` sends only part of a longer body. */
  const raw = async (id: string, { tenant = 'tenant-a', partial = false, json = undefined as string | undefined } = {}) => {
    const socket = connect(port, '127.0.0.1');
    sockets.push(socket);
    socket.on('error', () => {});
    const received: Buffer[] = [];
    socket.on('data', (d) => received.push(d as Buffer));
    await once(socket, 'connect');
    const body = partial ? '' : json ?? JSON.stringify({ signed_bundle: bundle() });
    const headers = [
      'POST /p HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      // A body the JSON parser leaves alone stays unread while dcpVerify runs.
      `Content-Type: ${partial ? 'application/octet-stream' : 'application/json'}`,
      `Authorization: Bearer ${tenant}`,
      `X-Test-Id: ${id}`,
      ...(partial ? [`X-DCP-Bundle: ${JSON.stringify(bundle())}`, 'Content-Length: 1000'] : [`Content-Length: ${Buffer.byteLength(body)}`]),
      '',
      '',
    ].join('\r\n');
    socket.write(headers + (partial ? '{"unread": ' : body));
    return { socket, received: () => Buffer.concat(received).toString('latin1') };
  };
  return { post, raw, seen };
}

/** A source that records its contexts and waits for `answer`. */
function watched<T>(answer: () => Promise<T> | T) {
  const contexts: any[] = [];
  const source = (...args: any[]) => {
    contexts.push(args[args.length - 1]);
    return answer();
  };
  return { contexts, source: source as any };
}

/** An onFailure that records which request called it, and answers 403. */
const recordFailures = (seen: string[]) => (req: any, res: any, errors: string[]) => {
  seen.push(String(req.headers['x-test-id'] ?? ''));
  res.status(403).json({ errors });
};

const trustOptions = (s: SourceSupervisor, trustedPrincipals: unknown, trustTimeoutMs = 5000): DCPVerifyOptions => ({
  trustedPrincipals: trustedPrincipals as any,
  sourceSupervisor: s,
  supervise: { trustTimeoutMs },
  cancelOnDisconnect: true,
});

describe('a healthy request', () => {
  it('whose body was read: admitted, its own request close does not abort the source', async () => {
    const { contexts, source } = watched(() => TRUSTED);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post, seen } = await app(trustOptions(s, source));
    const r = await post('healthy').catch((error) => ({ status: 0, body: String(error) }));
    expect(r.status).toBe(NEGATIVE_CONTROL ? 403 : 200); // the negative control inverts this expectation
    expect(seen.events.indexOf('healthy:request-close')).toBeGreaterThanOrEqual(0);
    expect(seen.events.indexOf('healthy:request-close')).toBeLessThan(seen.events.indexOf('healthy:response-finish'));
    expect(contexts[0].signal.aborted).toBe(false);
    expect(seen.reached).toEqual(['healthy']);
    expect(s.stats()).toMatchObject({ inFlight: 0, cancelled: 0 });
  });

  it('leaves no listener of the middleware behind: admitted, refused and unavailable', async () => {
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const answers = [() => TRUSTED, () => VECTORS.trust_sets.empty, () => { throw new Error('down'); }];
    const { post, seen } = await app(trustOptions(s, () => answers.shift()!()));
    expect((await post('admitted')).status).toBe(200);
    expect((await post('refused')).status).toBe(403);
    expect((await post('unavailable')).status).toBe(503);
    await sleep(20);
    for (const id of ['admitted', 'refused', 'unavailable']) {
      const [before, after] = seen.listeners[id];
      expect(after).toBe(before); // the middleware's listeners have gone
    }
  });
});

describe('a client that leaves during admission', () => {
  it('cancels its pending trust source, writes nothing, and keeps the slot until the source settles', async () => {
    const pending = hold();
    const { contexts, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post, raw, seen } = await app(trustOptions(s, source));
    const client = await raw('gone');
    await until(() => contexts.length === 1);
    client.socket.destroy();
    await until(() => contexts[0].signal.aborted);
    await sleep(20);
    expect(seen.writes.filter((w) => w.startsWith('gone:'))).toEqual([]);
    expect(seen.reached).toEqual([]);
    expect(s.stats()).toMatchObject({ inFlight: 1, cancelled: 1, timeouts: 0 });
    // Another request on the same supervisor: no free slot, and the source is not called.
    const other = await post('other');
    expect(other.status).toBe(503);
    expect(contexts).toHaveLength(1);
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
    expect(s.stats()).toMatchObject({ lateResults: 1 });
    expect((await post('after')).status).toBe(200);
    expect(seen.reached).toEqual(['after']);
  });

  it('never calls onFailure for it, while it still does for a request that stays', async () => {
    const pending = hold();
    const failures: string[] = [];
    const { contexts, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post, raw } = await app({ ...trustOptions(s, source), onFailure: recordFailures(failures) });
    const client = await raw('gone');
    await until(() => contexts.length === 1);
    client.socket.destroy();
    await until(() => s.stats().cancelled === 1);
    expect((await post('stays')).status).toBe(403); // no free slot: onFailure answers it
    expect(failures).toEqual(['stays']);
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
  });

  it('with maxInFlightPerTenant, another tenant is admitted while the slot is held', async () => {
    const pending = hold();
    const calls: string[] = [];
    const s = createSourceSupervisor({ maxInFlight: 2, maxInFlightPerTenant: 1 });
    const { post, raw } = await app(trustOptions(s, ({ tenant }: any) => (calls.push(tenant), tenant === 'tenant-a' ? pending.promise : TRUSTED)));
    const client = await raw('gone', { tenant: 'tenant-a' });
    await until(() => calls.length === 1);
    client.socket.destroy();
    await until(() => s.stats().cancelled === 1);
    expect((await post('a-again', 'tenant-a')).status).toBe(503);
    expect((await post('b', 'tenant-b')).status).toBe(200);
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
  });

  it('cancels its pending revocation source; the next request finds no slot (REVOCATION_UNAVAILABLE)', async () => {
    const pending = hold();
    const { contexts, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post, raw, seen } = await app({
      trustedPrincipals: TRUSTED, profile: STRICT, revocationSource: source, revocationTimeoutMs: 5000,
      sourceSupervisor: s, supervise: { revocation: true }, cancelOnDisconnect: true,
    });
    const client = await raw('gone');
    await until(() => contexts.length === 1);
    client.socket.destroy();
    await until(() => contexts[0].signal.aborted);
    expect(s.stats()).toMatchObject({ inFlight: 1, cancelled: 1 });
    const other = await post('other');
    expect(other.status).toBe(403);
    expect(other.body.codes).toEqual(['REVOCATION_UNAVAILABLE']);
    expect(seen.writes.filter((w) => w.startsWith('gone:'))).toEqual([]);
    pending.resolve(CLEAR());
    await until(() => s.stats().inFlight === 0);
    expect((await post('after')).status).toBe(200);
  });

  it('a late error after it left is consumed: no unhandledRejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const pending = hold();
      const { contexts, source } = watched(() => pending.promise.then(() => { throw new Error('late'); }));
      const s = createSourceSupervisor({ maxInFlight: 1 });
      const { raw } = await app(trustOptions(s, source));
      const client = await raw('gone');
      await until(() => contexts.length === 1);
      client.socket.destroy();
      await until(() => s.stats().cancelled === 1);
      pending.resolve(undefined);
      await until(() => s.stats().lateErrors === 1);
      await sleep(20);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('gone before admission starts: the source is never called and no slot is taken', async () => {
    const { contexts, source } = watched(() => TRUSTED);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    // The operator's middleware before dcpVerify waits until the client has left.
    const before: RequestHandler = (_req, res, next) => (res.writableFinished ? next() : res.once('close', () => next()));
    const { raw, seen } = await app(trustOptions(s, source), { before });
    const client = await raw('gone');
    await sleep(50);
    client.socket.destroy();
    await sleep(50);
    expect(contexts).toEqual([]);
    expect(s.stats()).toMatchObject({ inFlight: 0, cancelled: 0, saturated: 0 });
    expect(seen.writes.filter((w) => w.startsWith('gone:'))).toEqual([]);
  });

  it.each([
    ['a request without a bundle', { json: '{}' }, {}],
    ['a tenant function that throws', {}, { tenant: () => { throw new Error('no tenant'); } }],
  ])('gone before dcpVerify runs, %s: no onFailure, no answer', async (_name, request, over) => {
    const { contexts, source } = watched(() => TRUSTED);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const failures: string[] = [];
    const before: RequestHandler = (_req, res, next) => (res.writableFinished ? next() : res.once('close', () => next()));
    const { raw, seen } = await app({ ...trustOptions(s, source), onFailure: recordFailures(failures), ...over } as DCPVerifyOptions, { before });
    const client = await raw('gone', request as any);
    await sleep(50);
    client.socket.destroy();
    await sleep(50);
    expect(failures).toEqual([]);
    expect(seen.writes.filter((w) => w.startsWith('gone:'))).toEqual([]);
    expect(contexts).toEqual([]);
  });

  it('an upload cut short (bundle in the header, body never complete) is a client that left', async () => {
    const pending = hold();
    const { contexts, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { raw, seen } = await app(trustOptions(s, source));
    const client = await raw('cut', { partial: true });
    await until(() => contexts.length === 1);
    client.socket.destroy();
    await until(() => contexts[0].signal.aborted);
    expect(s.stats()).toMatchObject({ inFlight: 1, cancelled: 1 });
    expect(seen.writes.filter((w) => w.startsWith('cut:'))).toEqual([]);
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
  });

  it('leaves no listener of the middleware behind', async () => {
    const pending = hold();
    const { contexts, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { raw, seen } = await app(trustOptions(s, source));
    const client = await raw('gone');
    await until(() => contexts.length === 1);
    client.socket.destroy();
    await until(() => (seen.listeners.gone ?? []).length === 2);
    const [before, after] = seen.listeners.gone;
    expect(after).toBe(before);
  });

  it('without cancelOnDisconnect nothing changes: the source is not aborted when the client leaves', async () => {
    const pending = hold();
    const { contexts, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { raw } = await app({ trustedPrincipals: source, sourceSupervisor: s, supervise: { trustTimeoutMs: 5000 } });
    const client = await raw('gone');
    await until(() => contexts.length === 1);
    client.socket.destroy();
    await sleep(100);
    expect(contexts[0].signal.aborted).toBe(false);
    expect(s.stats()).toMatchObject({ inFlight: 1, cancelled: 0 });
  });
});

describe('races', () => {
  it('the deadline first, the client still there: the usual 503, and its later departure changes nothing', async () => {
    const pending = hold();
    const { source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { raw } = await app(trustOptions(s, source, 100));
    const client = await raw('late');
    await until(() => client.received().includes('HTTP/1.1 503'));
    client.socket.destroy();
    await sleep(30);
    expect(s.stats()).toMatchObject({ timeouts: 1, cancelled: 0, inFlight: 1 });
  });

  it('the client first: only cancelled is counted, and the deadline timer is cleared', async () => {
    const pending = hold();
    const { contexts, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { raw } = await app(trustOptions(s, source, 150));
    const client = await raw('gone');
    await until(() => contexts.length === 1);
    client.socket.destroy();
    await until(() => s.stats().cancelled === 1);
    await sleep(250); // past the deadline
    expect(s.stats()).toMatchObject({ cancelled: 1, timeouts: 0 });
  });
});

describe('runWithSignal (the supervisor capability)', () => {
  it('a signal already aborted: cancelled at once, no slot, no call', async () => {
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const controller = new AbortController();
    controller.abort();
    const call = vi.fn();
    expect(await supervise(s, 'trust', 't', 1000, call, controller.signal)).toEqual({ status: 'cancelled' });
    expect(call).not.toHaveBeenCalled();
    expect(s.stats()).toMatchObject({ inFlight: 0, cancelled: 1 });
  });

  it("aborted while pending: decided cancelled, the call's signal aborted, the slot held until it settles", async () => {
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const controller = new AbortController();
    const pending = hold();
    let seen: AbortSignal | undefined;
    const outcome = supervise(s, 'revocation', 't', 5000, (signal) => ((seen = signal), pending.promise), controller.signal);
    controller.abort();
    expect(await outcome).toEqual({ status: 'cancelled' });
    expect(seen!.aborted).toBe(true);
    expect(s.stats()).toMatchObject({ inFlight: 1, cancelled: 1 });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    pending.resolve(null);
    await until(() => s.stats().inFlight === 0);
    expect(s.stats().lateResults).toBe(1);
  });

  it('removes its listener on every decision, and an abort after the decision changes nothing', async () => {
    const s = createSourceSupervisor({ maxInFlight: 3 });
    const signals = [new AbortController(), new AbortController(), new AbortController()];
    expect(await supervise(s, 'trust', 't', 5000, () => TRUSTED, signals[0].signal)).toMatchObject({ status: 'ok' });
    const timedOut = supervise(s, 'trust', 't', 20, () => hold().promise, signals[1].signal);
    expect(await timedOut).toEqual({ status: 'timeout' });
    const closing = supervise(s, 'trust', 't', 5000, () => hold().promise, signals[2].signal);
    await s.close();
    expect(await closing).toEqual({ status: 'closed' });
    for (const c of signals) {
      expect(getEventListeners(c.signal, 'abort')).toHaveLength(0);
      c.abort();
    }
    expect(s.stats()).toMatchObject({ cancelled: 0, timeouts: 1, closed: 1 });
  });

  it('a source whose abort listener re-enters close() and aborts again: one decision, counted once', async () => {
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const controller = new AbortController();
    const outcome = supervise(s, 'trust', 't', 5000, (signal) => {
      signal.addEventListener('abort', () => {
        void s.close();
        controller.abort();
      });
      return hold().promise;
    }, controller.signal);
    controller.abort();
    expect(await outcome).toEqual({ status: 'cancelled' });
    expect(s.stats()).toMatchObject({ cancelled: 1, closed: 0, timeouts: 0, inFlight: 1 });
  });

  it('a deadline whose abort re-enters close(): one decision, counted once', async () => {
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const outcome = supervise(s, 'trust', 't', 20, (signal) => {
      signal.addEventListener('abort', () => void s.close());
      return hold().promise;
    });
    expect(await outcome).toEqual({ status: 'timeout' });
    expect(s.stats()).toMatchObject({ timeouts: 1, closed: 0 });
  });

  it('close() then the signal, and the signal then close(): whichever comes first decides, alone', async () => {
    const a = createSourceSupervisor({ maxInFlight: 1 });
    const ca = new AbortController();
    const first = supervise(a, 'trust', 't', 5000, () => hold().promise, ca.signal);
    await a.close();
    ca.abort();
    expect(await first).toEqual({ status: 'closed' });
    expect(a.stats()).toMatchObject({ closed: 1, cancelled: 0 });
    const b = createSourceSupervisor({ maxInFlight: 1 });
    const cb = new AbortController();
    const second = supervise(b, 'trust', 't', 5000, () => hold().promise, cb.signal);
    cb.abort();
    await b.close();
    expect(await second).toEqual({ status: 'cancelled' });
    expect(b.stats()).toMatchObject({ closed: 0, cancelled: 1 });
  });
});

describe('configuration', () => {
  const s = createSourceSupervisor({ maxInFlight: 1 });
  const fn = () => TRUSTED;
  const rev = async () => CLEAR();
  /** A supervisor of an older package: the same protocol, `run` only, no runWithSignal. */
  const older = (() => {
    const run = async (_source: string, _tenant: string, _ms: number, call: (signal: AbortSignal) => unknown) => ({ status: 'ok', value: await call(new AbortController().signal) });
    const object = { stats: () => ({}), close: async () => ({ inFlight: 0 }) };
    Object.defineProperty(object, Symbol.for('dcp-ai.source-supervisor.v1'), { value: Object.freeze({ version: 1, run }) });
    return object as unknown as SourceSupervisor;
  })();

  it.each<[string, unknown, string]>([
    ['without trustedPrincipals', { cancelOnDisconnect: true }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['without supervision', { trustedPrincipals: fn, cancelOnDisconnect: true }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with the trust function unsupervised', { trustedPrincipals: fn, profile: STRICT, revocationSource: rev, sourceSupervisor: s, supervise: { revocation: true }, cancelOnDisconnect: true }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with the revocation source unsupervised', { trustedPrincipals: fn, profile: STRICT, revocationSource: rev, sourceSupervisor: s, supervise: { trustTimeoutMs: 100 }, cancelOnDisconnect: true }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with checkRevocation', { ...trustOptions(s, fn), checkRevocation: true }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with a supervisor of an older package', trustOptions(older, fn), 'CONFIG_INVALID_VALUE'],
  ])('refuses cancelOnDisconnect %s', (_name, options, code) => {
    expect(() => dcpVerify(options as DCPVerifyOptions)).toThrow(expect.objectContaining({ code }));
  });

  it.each([['yes'], [1], [null]])('refuses cancelOnDisconnect %j', (value) => {
    expect(() => dcpVerify({ ...trustOptions(s, fn), cancelOnDisconnect: value } as any)).toThrow(TypeError);
  });

  it('accepts it with every source supervised; an older supervisor still works without it', async () => {
    expect(() => dcpVerify(trustOptions(s, fn))).not.toThrow();
    expect(() => dcpVerify({ trustedPrincipals: TRUSTED, profile: STRICT, revocationSource: rev, sourceSupervisor: s, supervise: { revocation: true }, cancelOnDisconnect: true })).not.toThrow();
    expect(() => dcpVerify({ ...trustOptions(s, fn), cancelOnDisconnect: false })).not.toThrow();
    const { post } = await app({ trustedPrincipals: fn, sourceSupervisor: older, supervise: { trustTimeoutMs: 100 } });
    expect((await post('older')).status).toBe(200);
  });

  // That OpenClaw's configureVerifier has no such option is checked in @dcp-ai/openclaw's own
  // suite (client-disconnect-config.test.ts): this package's CI job installs only its own deps.
  it("a supervisor made by @dcp-ai/openclaw's copy supports it", async () => {
    const copy = createFromOpenClawCopy({ maxInFlight: 1 });
    expect(supportsCancellation(copy)).toBe(true);
    expect(supportsCancellation(older)).toBe(false);
    const { post } = await app(trustOptions(copy, fn));
    expect((await post('copy')).status).toBe(200);
  });

  it('the stats of a supervisor from an older package (no cancelled) still type-check as SourceSupervisorStats', () => {
    // Compile time: tsc fails here if `cancelled` becomes required again.
    const previous: Omit<SourceSupervisorStats, 'cancelled'> = { open: true, inFlight: 0, tenants: 0, timeouts: 0, saturated: 0, closed: 0, lateResults: 0, lateErrors: 0, droppedEvents: 0 };
    const asCurrent: SourceSupervisorStats = previous;
    expect(asCurrent.cancelled ?? 0).toBe(0);
  });
});
