// Revocation service of the MP-05 rehearsal (TEST ONLY): operator infrastructure, not part of DCP.
//
// Serves the operator's deny list (GET /deny-list.json) and list of revoked mandates (GET /mandates.json) on 127.0.0.1,
// read from the operator state at every query, and records every query it really receives (count, and a line in
// service-queries.jsonl). Mode "normal" serves the operator's file exactly as it is, updated_at included: it never
// stamps the time it serves, so an old or malformed list reaches the consumer as old or malformed and fails closed
// there; only the operator refreshes a list (operator.mjs refresh-lists). A file that cannot be read or parsed gives
// 503. "stale" is an explicit fault injection for tests (updated_at 600 s before now); "down" answers 503.
// GET /stats and POST /mode need the operator's test token. Standard library only.
//
//   node node/revocation-service.mjs CONFIG.json      (CONFIG: {"state": DIR, "run": DIR}; spawned by the runner)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { announce, onQuit, tokenOwner } from './http-common.mjs';
import { appendEffect } from './ledger.mjs';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = readJson(process.argv[2]);
const tokens = readJson(path.join(config.state, 'operator', 'tokens.json'));
const LISTS = { '/deny-list.json': ['deny-list.json', 'deny_list'], '/mandates.json': ['mandates.json', 'mandates'] };
const MODES = new Set(['normal', 'down', 'stale']);
const queries = { deny_list: 0, mandates: 0 };
let mode = 'normal';

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
  res.end(text);
}

function readSmallBody(req, max = 256) {
  return new Promise((resolve) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > max) req.destroy();
    });
    req.on('end', () => resolve(text));
    req.on('close', () => resolve(text));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && Object.hasOwn(LISTS, url.pathname)) {
    const [file, name] = LISTS[url.pathname];
    queries[name] += 1;
    appendEffect(path.join(config.run, 'service-queries.jsonl'), { list: name, mode, at: new Date().toISOString() });
    if (mode === 'down') return reply(res, 503, { error: 'unavailable' });
    let doc;
    try {
      doc = readJson(path.join(config.state, 'operator', 'revocation', file));
    } catch {
      return reply(res, 503, { error: 'unavailable' });
    }
    if (mode === 'stale') return reply(res, 200, { ...doc, updated_at: new Date(Date.now() - 600_000).toISOString() });
    return reply(res, 200, doc);
  }
  if (tokenOwner(req.headers.authorization, { operator: tokens.operator }) !== 'operator') return reply(res, 401, { error: 'unauthenticated' });
  if (req.method === 'GET' && url.pathname === '/stats') return reply(res, 200, { mode, queries });
  if (req.method === 'POST' && url.pathname === '/mode') {
    let wanted;
    try {
      wanted = JSON.parse(await readSmallBody(req)).mode;
    } catch {
      wanted = undefined;
    }
    if (!MODES.has(wanted)) return reply(res, 400, { error: 'mode must be normal, down or stale' });
    mode = wanted;
    return reply(res, 200, { mode });
  }
  return reply(res, 404, { error: 'not found' });
});

server.listen(0, '127.0.0.1', () => announce({ ev: 'ready', port: server.address().port }));
onQuit(() => {
  server.close(() => {
    announce({ ev: 'stopped' });
    process.exit(0);
  });
  server.closeAllConnections();
});
