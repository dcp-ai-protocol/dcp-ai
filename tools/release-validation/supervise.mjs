// Process supervision for the release validation. The external runner gives each wrapper its own process
// group (and the browser wrapper gives Chrome another), so signalling the group of the process we started
// does not reach them. This module finds every descendant through the process table, by parent link, while
// its parent is still alive, and stops all of them. POSIX only.
//
// Limits: a process that is detached by a parent that dies within one polling interval is never seen; if
// this supervisor is itself killed with SIGKILL nothing is cleaned; and when ps cannot be read nothing is
// signalled and the result says the cleanup is not complete.
import { spawnSync } from 'node:child_process';
import { runProcess, LIMITS } from '../conformance/external.js';

const PS = '/bin/ps'; // a fixed executable, not a PATH lookup
const POLL_MS = 250;
const BACKSTOP_MS = 30000;

/** The process table: pid, parent, group, state and start time. Throws when it cannot be read. */
export function processTable() {
  const r = spawnSync(PS, ['-A', '-o', 'pid=,ppid=,pgid=,stat=,lstart='], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024,
    env: { LC_ALL: 'C' },
  });
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error(`${PS} could not list the processes (${r.error?.message ?? `exit ${r.status}`})`);
  }
  const rows = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (m && +m[1] !== r.pid) rows.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], stat: m[4], started: m[5] });
  }
  return rows;
}

/** Every process of `table` that descends from one of `roots` (the roots themselves excluded). */
export function descendantsOf(roots, table) {
  const seen = new Set(roots);
  const out = [];
  const queue = [...roots];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of table) {
      if (row.ppid === parent && !seen.has(row.pid)) {
        seen.add(row.pid);
        out.push(row);
        queue.push(row.pid);
      }
    }
  }
  return out;
}

/**
 * Tracks the descendants of `root` (this process). A process is identified by pid and start time, so a
 * reused pid is never taken for one of ours; an orphan stays known after its parent died, and its own
 * children are still found through it.
 */
export function createSupervisor({ root = process.pid, table = processTable, kill = (pid, sig) => process.kill(pid, sig) } = {}) {
  const known = new Map(); // pid -> row as first seen
  const isAlive = (row, k) => row !== undefined && row.started === k.started && !row.stat.startsWith('Z');

  function observe() {
    const t = table();
    const byPid = new Map(t.map((r) => [r.pid, r]));
    const liveKnown = [...known.values()].filter((k) => isAlive(byPid.get(k.pid), k)).map((k) => k.pid);
    for (const d of descendantsOf([root, ...liveKnown], t)) if (!d.stat.startsWith('Z')) known.set(d.pid, d);
    const alive = [...known.values()].filter((k) => isAlive(byPid.get(k.pid), k));
    return { alive, ownGroup: byPid.get(root)?.pgid };
  }

  /** Freezes, then kills, every live descendant. Never signals this process or its group. */
  async function killAll() {
    const errors = [];
    const signal = (target, sig) => {
      try { kill(target, sig); } catch { /* already gone */ }
    };
    const sweep = (sig) => {
      let o;
      try { o = observe(); } catch (e) { errors.push(e.message); return null; }
      const ours = new Set(o.alive.map((k) => k.pid));
      for (const k of o.alive) {
        // A group is signalled only when its leader is one of ours; otherwise the process alone.
        if (k.pgid !== o.ownGroup && ours.has(k.pgid)) signal(-k.pgid, sig);
        signal(k.pid, sig);
      }
      return o.alive.map((k) => k.pid);
    };
    const found = sweep('SIGSTOP'); // nothing of ours can start a process after this
    sweep('SIGSTOP'); // what was started in between
    let alive = sweep('SIGKILL');
    for (let i = 0; i < 40 && alive !== null && alive.length > 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      alive = sweep('SIGKILL');
    }
    return { found, alive, errors, complete: errors.length === 0 && alive !== null && alive.length === 0 };
  }

  return { observe, killAll };
}

/**
 * Runs argv through the kit's runProcess under a deadline enforced on the whole tree: at the deadline every
 * descendant is stopped, whatever its group. After a normal exit, a descendant that is still alive is
 * reported as leaked and stopped. runProcess keeps its own later deadline as a backstop.
 */
export async function supervised(sup, argv, { deadlineMs, input = Buffer.alloc(0), cwd, env, limits = LIMITS }) {
  let hit = false;
  let killing = null;
  const poll = setInterval(() => {
    try { sup.observe(); } catch { /* reported by the final observation */ }
  }, POLL_MS);
  const timer = setTimeout(() => { hit = true; killing = sup.killAll(); }, deadlineMs);
  const started = Date.now();
  const { stdout, observed } = await runProcess(argv, input, { timeoutMs: deadlineMs + BACKSTOP_MS, limits, cwd, env });
  const finished = Date.now();
  clearTimeout(timer);
  clearInterval(poll);
  let cleanup = killing ? await killing : null;
  let leaked = [];
  if (!cleanup) {
    try { leaked = sup.observe().alive.map((k) => k.pid); } catch { leaked = null; }
    if (leaked === null || leaked.length > 0) cleanup = await sup.killAll();
  }
  return { stdout, observed, started, finished, supervisor: { deadline_ms: deadlineMs, deadline_hit: hit, leaked, cleanup } };
}
