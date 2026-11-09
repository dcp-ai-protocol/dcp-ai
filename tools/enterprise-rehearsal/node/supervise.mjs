// External supervision of a rehearsal run (TEST ONLY). Standard library, ../process.mjs and ../secrets.mjs only, so the
// launcher can use it from the checkout.
//
// The supervisor owns every process of the run. The runner runs in its own process group with an IPC channel and asks
// the supervisor to create each server ({type:"spawn"}) and to stop it ({type:"stop"}): the supervisor creates the
// ServerProcess itself and records it in its own memory before waiting for readiness, so there is no window in which a
// server exists that the supervisor does not know about, and nothing depends on a blocked runner. When the runner
// exits, times out or the launcher is interrupted, the supervisor kills the runner's group, stops every server still
// running (quit, then the whole group), and, if secrets are left in the run, scans the evidence for them and deletes
// them, only inside the new work directory. It never kills a process it did not create.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ServerProcess, processTable } from '../process.mjs';
import { collectSecrets, scanSecrets } from '../secrets.mjs';
import { evidenceRoots, secretDirs } from './evidence.mjs';

const inside = (p, root) => p === root || p.startsWith(root + path.sep);
const isStrings = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');

/**
 * Validates a spawn request: one of the allowed executables, running a script inside the staged kit (node SCRIPT ... or
 * python -I SCRIPT ...), with a cwd inside it. Returns an error message or null.
 */
export function checkSpawn(msg, { executables, scriptRoot }) {
  if (typeof msg?.id !== 'string' || typeof msg.name !== 'string' || !isStrings(msg.argv)) return 'invalid spawn request';
  if (!executables.includes(msg.argv[0])) return `executable not allowed: ${msg.argv[0]}`;
  const script = msg.argv[1] === '-I' ? msg.argv[2] : msg.argv[1];
  if (typeof script !== 'string' || typeof msg.cwd !== 'string') return 'invalid spawn request';
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  };
  const scriptReal = real(script);
  const cwdReal = real(msg.cwd);
  if (scriptReal === null) return 'script not found';
  if (cwdReal === null) return 'cwd not found';
  if (!inside(scriptReal, scriptRoot) || !inside(cwdReal, scriptRoot)) return 'script or cwd outside the staged kit';
  if (msg.env !== undefined && (typeof msg.env !== 'object' || msg.env === null || !Object.values(msg.env).every((v) => typeof v === 'string'))) return 'invalid env';
  return null;
}

/** Scans the evidence for the secrets left in the work directory's runs, then deletes them (never through a link). */
export function removeLeftSecrets(work) {
  const result = { runs: [], deleted: [], scan: null, errors: [] };
  const workReal = fs.realpathSync(work);
  const runs = fs.readdirSync(workReal).filter((n) => n.startsWith('run-')).map((n) => path.join(workReal, n));
  for (const run of runs) {
    const dirs = secretDirs(run);
    if (dirs.length === 0) continue;
    result.runs.push(path.basename(run));
    try {
      const scan = scanSecrets(collectSecrets(dirs), evidenceRoots(run));
      result.scan = { pass: scan.pass, files: scan.files, findings: scan.findings };
    } catch (e) {
      result.scan = { pass: false, error: e.message };
    }
    for (const dir of dirs) {
      let real = null;
      try {
        real = fs.realpathSync(dir);
      } catch {
        real = null;
      }
      if (fs.lstatSync(dir).isSymbolicLink() || real === null || !inside(real, workReal)) {
        result.errors.push(`not deleted (symbolic link, or physically outside the work directory): ${dir}`);
        continue;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      result.deleted.push(path.relative(workReal, dir));
    }
  }
  return result;
}

/**
 * Runs the runner (argv) in its own process group, under deadlineMs, serving its spawn and stop requests. Resolves
 * with what happened; cleanRun(result) says whether the run ended cleanly.
 */
export function superviseRun(argv, { env = process.env, deadlineMs, work, executables, scriptRoot, ps = '/bin/ps', stopMs = 10_000, stdio = 'inherit' }) {
  return new Promise((resolve) => {
    const servers = new Map();
    let closed = false; // once the cleanup starts, no request is served: nothing can be created after it
    const result = { code: null, signal: null, timedOut: false, interrupted: null, runnerLeft: null, servers: [], protocol: [], secrets: null, error: null };
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: [stdio === 'inherit' ? 'ignore' : stdio, stdio, stdio, 'ipc'], env });
    const group = child.pid;
    const killRunner = () => {
      try {
        process.kill(-group, 'SIGKILL');
      } catch {
        // already gone
      }
    };
    const reply = (msg) => {
      try {
        if (child.connected) child.send(msg);
      } catch {
        // the runner is gone; the supervisor still owns the cleanup
      }
    };
    const stopServer = async (entry, by) => {
      if (!entry.stopping) {
        entry.stopping = entry.proc.stop(stopMs).then((r) => {
          const record = { name: entry.name, pid: entry.proc.pid, stopped_by: by, clean: r.clean, exit: r.exit, retained_before_cleanup: r.retained_before_cleanup, group_left: r.group_left, error: r.error ?? null };
          result.servers.push(record);
          return { ...record, stderr: entry.proc.stderr };
        });
      }
      return entry.stopping;
    };
    child.on('message', async (msg) => {
      if (closed) {
        result.protocol.push('message after the runner exited');
        return;
      }
      try {
        await serve(msg);
      } catch (e) {
        // Never a crash or an unhandled rejection: a protocol failure, with the servers already created kept for cleanup.
        result.protocol.push(`request failed: ${e.message}`);
        reply({ type: 'failed', id: msg?.id, error: 'request failed' });
      }
    });
    const serve = async (msg) => {
      if (msg?.type === 'spawn') {
        const problem = checkSpawn(msg, { executables, scriptRoot });
        if (problem || servers.has(msg.id)) {
          result.protocol.push(problem ?? `repeated server id ${msg.id}`);
          return reply({ type: 'failed', id: msg?.id, error: problem ?? 'repeated server id' });
        }
        const proc = new ServerProcess(msg.argv, { cwd: msg.cwd, env: msg.env, ps });
        const entry = { name: msg.name, proc }; // recorded before anything is awaited
        servers.set(msg.id, entry);
        try {
          await proc.ready(Number.isInteger(msg.readyMs) ? msg.readyMs : 20_000);
          reply({ type: 'ready', id: msg.id, port: proc.port, pid: proc.pid });
        } catch (e) {
          reply({ type: 'failed', id: msg.id, error: e.message });
        }
      } else if (msg?.type === 'stop' && servers.has(msg.id)) {
        reply({ type: 'stopped', id: msg.id, result: await stopServer(servers.get(msg.id), 'runner') });
      } else {
        result.protocol.push(`unknown or invalid message: ${JSON.stringify(msg).slice(0, 200)}`);
        reply({ type: 'failed', id: msg?.id, error: 'unknown or invalid message' });
      }
    };
    const timer = setTimeout(() => {
      result.timedOut = true;
      killRunner();
    }, deadlineMs);
    const onSignal = (signal) => {
      result.interrupted = signal;
      killRunner();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    let finished = false;
    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      Object.assign(result, { code, signal });
      setTimeout(async () => {
        closed = true;
        try {
          result.runnerLeft = group === undefined ? [] : processTable(ps).filter((p) => p.group === group && !p.state.startsWith('Z')).map((p) => p.pid);
          if (result.runnerLeft.length) killRunner();
        } catch (e) {
          result.error ??= e.message;
          killRunner();
        }
        // Every server the runner did not stop is stopped here: quit, then its whole group.
        for (const entry of servers.values()) {
          try {
            await stopServer(entry, 'supervisor');
          } catch (e) {
            result.error ??= `stopping ${entry.name}: ${e.message}`;
          }
        }
        if (work) {
          try {
            result.secrets = removeLeftSecrets(work);
          } catch (e) {
            result.secrets = { error: e.message, deleted: [], errors: [e.message] };
          }
        }
        resolve(result);
      }, 200);
    };
    child.on('exit', (code, signal) => finish(code, signal));
    // A runner that could not be spawned emits error and never exit: resolve anyway, as a failure.
    child.on('error', (e) => {
      result.error ??= `runner: ${e.message}`;
      if (child.pid === undefined) finish(null, null);
    });
  });
}

/**
 * A run is clean only when the runner exited 0 by itself, stopped every server it started (each one cleanly), spoke the
 * protocol, left nothing in its group, and left no secrets for the supervisor to delete.
 */
export const cleanRun = (r) =>
  r.code === 0 &&
  r.signal === null &&
  !r.timedOut &&
  !r.interrupted &&
  r.error === null &&
  r.protocol.length === 0 &&
  r.runnerLeft?.length === 0 &&
  r.servers.every((s) => s.stopped_by === 'runner' && s.clean) &&
  (r.secrets === null || (r.secrets.deleted?.length === 0 && r.secrets.errors?.length === 0 && !r.secrets.error));
