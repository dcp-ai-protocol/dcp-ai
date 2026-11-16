// Self-tests of the external supervisor (TEST ONLY): small runs with fake runners and servers, no rehearsal campaign.
//   node --test node/test/supervise.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { processTable } from '../../process.mjs';
import { cleanRun, superviseRun } from '../supervise.mjs';

const groupAlive = (pgid) => processTable().some((p) => p.group === pgid && !p.state.startsWith('Z'));

function workspace(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mp05-supervise-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const write = (dir, name, text) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};

// A server that announces readiness and then ignores quit and SIGTERM; and one that cooperates.
const STUBBORN = `process.on('SIGTERM', () => {}); process.stdin.resume(); console.log(JSON.stringify({ ev: 'ready', port: 1 })); setInterval(() => {}, 1000);`;
const COOPERATIVE = `console.log(JSON.stringify({ ev: 'ready', port: 1 }));
require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => { if (JSON.parse(l).cmd === 'quit') { console.log(JSON.stringify({ ev: 'stopped' })); process.exit(0); } });`;

/** A fake runner (ESM) that talks to the supervisor over IPC, then does `then`. */
function fakeRunner(dir, server, then) {
  const serverFile = write(dir, `server-${crypto.randomBytes(3).toString('hex')}.cjs`, server);
  return write(
    dir,
    `runner-${crypto.randomBytes(3).toString('hex')}.mjs`,
    `const ask = (msg) => new Promise((resolve) => { process.on('message', function on(m) { if (m.id === msg.id) { process.off('message', on); resolve(m); } }); process.send(msg); });
const spawnReq = { type: 'spawn', id: 's1', name: 'server', argv: [process.execPath, ${JSON.stringify(serverFile)}], cwd: ${JSON.stringify(dir)}, env: { PATH: process.env.PATH ?? '' } };
${then}
`,
  );
}

const options = (dir, extra = {}) => ({ deadlineMs: 20_000, executables: [process.execPath], scriptRoot: dir, stopMs: 500, stdio: 'ignore', ...extra });

test('a blocked runner and a server that ignores quit and SIGTERM are both cleaned at the deadline', async (t) => {
  const dir = workspace(t);
  const runner = fakeRunner(dir, STUBBORN, `await ask(spawnReq); setInterval(() => {}, 1000); // blocked: no finally will run`);
  const r = await superviseRun([process.execPath, runner], options(dir, { deadlineMs: 1500 }));
  assert.equal(r.timedOut, true);
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].stopped_by, 'supervisor');
  assert.equal(groupAlive(r.servers[0].pid), false, 'nothing left in the server group');
  assert.deepEqual(r.runnerLeft, []);
  assert.equal(cleanRun(r), false);
});

test('a runner killed right after asking for a server leaves nothing behind (no registration window)', async (t) => {
  const dir = workspace(t);
  const runner = fakeRunner(dir, STUBBORN, `process.send(spawnReq, () => process.kill(process.pid, 'SIGKILL'));`);
  const r = await superviseRun([process.execPath, runner], options(dir));
  assert.equal(r.signal, 'SIGKILL');
  assert.equal(r.servers.length, 1, 'the request reached the supervisor, which created the server');
  for (const s of r.servers) {
    assert.equal(s.stopped_by, 'supervisor');
    assert.equal(groupAlive(s.pid), false, `server ${s.pid} cleaned`);
  }
  assert.equal(cleanRun(r), false);
});

test('a healthy runner that stops its server is a clean run (valid control)', async (t) => {
  const dir = workspace(t);
  const runner = fakeRunner(dir, COOPERATIVE, `await ask(spawnReq); const r = await ask({ type: 'stop', id: 's1' }); if (!r.result.clean) process.exitCode = 1; process.disconnect();`);
  const r = await superviseRun([process.execPath, runner], options(dir));
  assert.equal(r.code, 0);
  assert.deepEqual(r.servers.map((s) => [s.stopped_by, s.clean]), [['runner', true]]);
  assert.deepEqual(r.protocol, []);
  assert.equal(cleanRun(r), true);
});

test('secrets left by a killed runner are scanned and deleted, only inside the work directory', async (t) => {
  const dir = workspace(t);
  const work = path.join(dir, 'work');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'outside the work directory');
  const key = (n) => Buffer.alloc(32, n).toString('base64');
  const runner = fakeRunner(
    dir,
    COOPERATIVE,
    `import fs from 'node:fs'; import path from 'node:path';
const run = path.join(${JSON.stringify(work)}, 'run-1');
fs.mkdirSync(path.join(run, 'material', 'secrets', 'keys'), { recursive: true });
fs.writeFileSync(path.join(run, 'material', 'secrets', 'keys', 'k.json'), JSON.stringify({ classical: { secretKeyB64: ${JSON.stringify(key(1))} }, pq: { secretKeyB64: ${JSON.stringify(key(2))} } }));
fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify({ status: 'incomplete' }));
fs.mkdirSync(path.join(run, 'lanes', 'node', 'state'), { recursive: true });
fs.symlinkSync(${JSON.stringify(outside)}, path.join(run, 'lanes', 'node', 'state', 'secrets'));
setInterval(() => {}, 1000);`,
  );
  fs.mkdirSync(work);
  const r = await superviseRun([process.execPath, runner], options(dir, { deadlineMs: 1500, work }));
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.secrets.deleted, [path.join('run-1', 'material', 'secrets')]);
  assert.ok(!fs.existsSync(path.join(work, 'run-1', 'material', 'secrets')), 'the secrets are gone');
  assert.ok(fs.existsSync(path.join(work, 'run-1', 'report.json')), 'the evidence stays');
  assert.match(r.secrets.errors.join(), /symbolic link/, 'a link is reported, not followed');
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'outside the work directory');
  assert.equal(cleanRun(r), false);
});

test('an invalid or unknown message fails the supervision, and nothing outside the kit is spawned', async (t) => {
  const dir = workspace(t);
  const runner = fakeRunner(
    dir,
    COOPERATIVE,
    `await ask({ type: 'bogus', id: 'b1' });
const refused = await ask({ ...spawnReq, id: 's2', argv: ['/bin/sh', '-c', 'sleep 60'] });
if (refused.type !== 'failed') process.exitCode = 1;
process.disconnect();`,
  );
  const r = await superviseRun([process.execPath, runner], options(dir));
  assert.equal(r.code, 0);
  assert.equal(r.servers.length, 0, 'nothing was spawned');
  assert.equal(r.protocol.length, 2);
  assert.equal(cleanRun(r), false);
});

test('a spawn request with a cwd that does not exist is a protocol failure, and earlier servers are still cleaned', async (t) => {
  const dir = workspace(t);
  const runner = fakeRunner(
    dir,
    STUBBORN,
    `await ask(spawnReq);
const refused = await ask({ ...spawnReq, id: 's2', cwd: ${JSON.stringify(path.join(dir, 'no-such-dir'))} });
if (refused.type !== 'failed' || refused.error !== 'cwd not found') process.exitCode = 3;
process.disconnect();`,
  );
  const r = await superviseRun([process.execPath, runner], options(dir));
  assert.equal(r.code, 0, 'the runner saw a failed reply, not a crash of the supervisor');
  assert.deepEqual(r.protocol, ['cwd not found']);
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].stopped_by, 'supervisor', 'the server created before is cleaned');
  assert.equal(groupAlive(r.servers[0].pid), false);
  assert.equal(cleanRun(r), false);
});

test('a runner that cannot be spawned resolves as a failure instead of hanging', { timeout: 10_000 }, async (t) => {
  const dir = workspace(t);
  const r = await superviseRun([path.join(dir, 'no-such-node')], options(dir));
  assert.match(r.error, /runner: .*ENOENT/);
  assert.equal(r.code, null);
  assert.equal(cleanRun(r), false);
});

test('a ps that fails is reported and never counts as clean', async (t) => {
  const dir = workspace(t);
  const runner = fakeRunner(dir, COOPERATIVE, `process.disconnect();`);
  const r = await superviseRun([process.execPath, runner], options(dir, { ps: path.join(dir, 'no-such-ps') }));
  assert.equal(r.code, 0);
  assert.match(r.error, /process table unavailable/);
  assert.equal(cleanRun(r), false);
});
