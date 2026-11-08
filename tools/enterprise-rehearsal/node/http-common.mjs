// HTTP and process plumbing shared by the rehearsal's Node servers and runner (TEST ONLY). Standard library only.
//
// Control protocol of every server (as ../process.mjs supervises it): stdout carries only JSON control events,
// {"ev":"ready","port":N} once listening and {"ev":"stopped"} before a clean exit; stdin takes {"cmd":"quit"}, and a
// closed stdin means the same. Diagnostics go to a log file, never to stdout.
import crypto from 'node:crypto';
import readline from 'node:readline';

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** The name whose token hash matches the bearer token, compared in constant time; null when none does. */
export function tokenOwner(authorization, hashes) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(typeof authorization === 'string' ? authorization : '');
  if (!m) return null;
  const presented = Buffer.from(sha256Hex(m[1]), 'hex');
  let owner = null;
  for (const [name, hash] of Object.entries(hashes)) {
    const expected = Buffer.from(String(hash), 'hex');
    if (expected.length === presented.length && crypto.timingSafeEqual(expected, presented)) owner = name;
  }
  return owner;
}

export const isJsonContentType = (value) => typeof value === 'string' && /^application\/json\s*(;\s*charset=utf-8\s*)?$/i.test(value);

/**
 * Reads a request body counting bytes while they arrive: {bytes} within maxBytes, or {tooLarge: true} as soon as the
 * declared Content-Length or the bytes received go over it. Nothing beyond the budget is kept.
 */
export function readBody(req, maxBytes) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) return Promise.resolve({ tooLarge: true });
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const done = (fn, value) => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      fn(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) done(resolve, { tooLarge: true });
      else chunks.push(chunk);
    };
    const onEnd = () => done(resolve, { bytes: Buffer.concat(chunks, size) });
    const onError = (e) => done(reject, e);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/** A loopback http URL without credentials; anything else is a configuration error. */
export function loopbackUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.username || u.password) throw new Error(`not a loopback URL: ${value}`);
  return u;
}

/** GET a JSON document from a loopback source: no redirects, one deadline for headers and body, a response budget. */
export async function fetchJsonCapped(url, { timeoutMs, maxBytes }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(loopbackUrl(url), { redirect: 'error', signal, headers: { accept: 'application/json' } });
  if (res.status !== 200) {
    await res.body?.cancel();
    throw new Error(`source answered ${res.status}`);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('source response over budget');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export const announce = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

/** Calls quit once, on {"cmd":"quit"} or when stdin closes. */
export function onQuit(quit) {
  let called = false;
  const once = () => {
    if (!called) {
      called = true;
      quit();
    }
  };
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    try {
      if (JSON.parse(line)?.cmd === 'quit') once();
    } catch {
      // not a control command
    }
  });
  rl.on('close', once);
}
