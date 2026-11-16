// Portable POSIX process supervision for the optional rehearsal, not an SDK API.
// Servers emit {ev:'ready',port:<loopback port>} and accept {cmd:'quit'} on stdin.
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

export function processTable(ps = '/bin/ps') {
  const result = spawnSync(ps, ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8', timeout: 5000 });
  if (result.error || result.status !== 0 || !result.stdout.trim()) throw new Error('process table unavailable');
  return result.stdout.trim().split('\n').map(line => {
    const [pid, group, state] = line.trim().split(/\s+/);
    if (!/^\d+$/.test(pid) || !/^\d+$/.test(group) || !state) throw new Error('invalid process table');
    return { pid: Number(pid), group: Number(group), state };
  });
}

function bounded(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })])
    .finally(() => clearTimeout(timer));
}

export class ServerProcess {
  constructor(argv, { cwd, env = process.env, ps = '/bin/ps' } = {}) {
    this.ps = ps;
    this.events = [];
    this.waiters = new Set();
    this.stderr = '';
    this.closed = false;
    this.exitInfo = null;
    this.failure = null;
    this.child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pid = this.child.pid ?? null; // available before waiting for ready
    this.child.stdin.on('error', () => {});
    this.child.on('error', error => { this.failure = error.message; this.notify(); });
    this.exited = new Promise(resolve => this.child.once('exit', (code, signal) => {
      this.exitInfo = { code, signal }; this.notify(); resolve(this.exitInfo);
    }));
    this.child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4096); });
    let stdoutBytes = 0;
    this.child.stdout.on('data', data => {
      stdoutBytes += data.length;
      if (stdoutBytes > 32768) { this.failure = 'control output budget exceeded'; this.notify(); }
    });
    readline.createInterface({ input: this.child.stdout }).on('line', line => {
      if (this.failure) return;
      try {
        const event = JSON.parse(line);
        if (!event || typeof event !== 'object' || !['ready', 'stopped'].includes(event.ev)) throw Error('unknown event');
        if (this.events.some(e => e.ev === event.ev)) throw Error('duplicate event');
        this.events.push(event);
      } catch { this.failure = 'invalid server control event'; }
      this.notify();
    });
  }
  notify() { for (const waiter of [...this.waiters]) waiter(); }
  ready(ms = 20000) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (fn, value) => { clearTimeout(timer); this.waiters.delete(check); fn(value); };
      const check = () => {
        if (this.failure) return finish(reject, new Error(this.failure));
        if (this.exitInfo) return finish(reject, new Error('server exited before readiness'));
        if (this.closed) return finish(reject, new Error('server already stopped'));
        const event = this.events.find(e => e.ev === 'ready');
        if (event) {
          if (!Number.isInteger(event.port) || event.port < 1 || event.port > 65535) return finish(reject, new Error('invalid ready port'));
          this.port = event.port;
          return finish(resolve, this);
        }
      };
      timer = setTimeout(() => finish(reject, new Error('server readiness deadline exceeded')), ms);
      this.waiters.add(check); check();
    });
  }
  stop(ms = 10000) {
    if (!this.stopping) this.stopping = this._stop(ms);
    return this.stopping;
  }
  async _stop(ms) {
    this.closed = true; this.notify();
    if (this.pid === null) return { clean: false, error: 'server never started', group_left: null };
    if (!this.exitInfo) {
      try { this.child.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch { /* handled by exit/deadline */ }
    }
    const exit = this.exitInfo ?? await bounded(this.exited, ms);
    let before, after, tableError = null;
    const members = () => processTable(this.ps).filter(p => p.group === this.pid && !p.state.startsWith('Z')).map(p => p.pid);
    try { before = members(); } catch (error) { tableError = error.message; before = null; }
    // Always try to stop the owned group, even when ps failed or the parent exited.
    try { process.kill(-this.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') tableError ??= error.message; }
    if (!exit) await bounded(this.exited, 2000);
    await new Promise(resolve => setTimeout(resolve, 100));
    try { after = members(); } catch (error) { tableError ??= error.message; after = null; }
    const clean = !this.failure && !tableError && exit?.code === 0 && exit.signal === null && before?.length === 0 && after?.length === 0;
    return { clean, exit, retained_before_cleanup: before, group_left: after,
      ...(clean ? {} : { error: this.failure ?? tableError ?? (exit === null ? 'shutdown deadline exceeded' : before?.length ? 'server left a process behind' : 'unclean server exit') }) };
  }
}
