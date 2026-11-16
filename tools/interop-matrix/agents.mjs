// Agent processes shared by the interop-matrix scenarios (agent protocol in README.md):
// building and starting one agent per SDK, and a request/response channel to each.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');

export function launchers(names, python) {
  const run = (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`);
  };
  const out = {};
  if (names.includes('ts')) {
    if (!existsSync(join(ROOT, 'sdks/typescript/dist/index.js'))) throw new Error('build sdks/typescript first: npm install && npm run build');
    out.ts = ['node', [join(HERE, 'agents/ts/agent.mjs')]];
  }
  if (names.includes('py')) out.py = [python, [join(HERE, 'agents/py/agent.py')]];
  if (names.includes('go')) {
    const bin = join(tmpdir(), 'dcp-interop-go-agent');
    run('go', ['build', '-o', bin, '.'], join(HERE, 'agents/go'));
    out.go = [bin, []];
  }
  if (names.includes('rust')) {
    run('cargo', ['build', '--release', '--quiet'], join(HERE, 'agents/rust'));
    out.rust = [join(HERE, 'agents/rust/target/release/interop-rust-agent'), []];
  }
  if (names.includes('ref')) {
    if (!existsSync(join(ROOT, 'node_modules/@dcp-ai/sdk'))) throw new Error('install the reference verifier first: npm install at the repository root');
    out.ref = ['node', [join(HERE, 'agents/ref/agent.mjs')]];
  }
  return out;
}

export class Agent {
  constructor(name, cmd, args, timeout) {
    this.name = name;
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.dead = null; // why the agent can no longer answer, once it cannot
    this.proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.on('error', (e) => this.die(`cannot run ${cmd}: ${e.message}`));
    this.proc.stdin.on('error', () => {}); // a write after the agent died; its exit is reported
    this.proc.stderr.on('data', (d) => (this.stderr = (this.stderr + d).slice(-4000)));
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return this.failAll(`unparseable response: ${line.slice(0, 200)}`);
      }
      const p = this.pending.get(msg.id);
      if (!p) return this.die(`response to unknown request ${msg.id}`);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(`${this.name}.${p.cmd}: ${msg.error}`));
    });
    this.proc.on('exit', (code, signal) => this.die(`exited (${code ?? signal}): ${this.stderr.split('\n').filter((l) => l.trim()).slice(-6).join(' | ')}`));
  }
  // An agent that crashed, timed out or answered out of turn is out of sync: stop it and fail
  // every pending and later request at once instead of waiting a timeout for each.
  die(reason) {
    if (!this.dead) this.dead = reason;
    this.proc.kill('SIGKILL');
    this.failAll(this.dead);
  }
  failAll(reason) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`${this.name}.${p.cmd}: ${reason}`));
    }
    this.pending.clear();
  }
  call(cmd, args = {}) {
    if (this.dead) return Promise.reject(new Error(`${this.name}.${cmd}: ${this.dead}`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.die(`timeout after ${this.timeout} ms in ${cmd}`), this.timeout);
      this.pending.set(id, { resolve, reject, timer, cmd });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }
  async stop() {
    if (!this.dead) await this.call('shutdown').catch(() => {});
    this.proc.kill();
  }
}
