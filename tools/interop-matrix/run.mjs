// Interop matrix orchestrator (design and agent protocol in README.md).
//
// Starts one agent process per SDK, has each one produce citizenship bundles,
// has every agent verify every bundle, untouched and tampered with in transit,
// and fails on any unexpected verdict, crash or timeout.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const ALL = ['ts', 'py', 'go', 'rust', 'ref'];
// Agents that only verify: the reference verifier (lib/verify.js) has no producer side.
const VERIFY_ONLY = new Set(['ref']);

const opts = { agents: ALL, python: process.env.INTEROP_PYTHON || 'python3', timeout: 60000, out: join(HERE, 'out') };
for (let i = 2; i < process.argv.length; i++) {
  const [flag, value] = [process.argv[i], process.argv[i + 1]];
  if (flag === '--agents') opts.agents = value.split(',');
  else if (flag === '--python') opts.python = value;
  else if (flag === '--timeout') opts.timeout = Number(value);
  else if (flag === '--out') opts.out = resolve(value);
  else throw new Error(`unknown option ${flag}`);
  i++;
}
for (const a of opts.agents) if (!ALL.includes(a)) throw new Error(`unknown agent ${a} (known: ${ALL.join(', ')})`);

// ── Agents ──

function launchers() {
  const run = (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`);
  };
  const out = {};
  if (opts.agents.includes('ts')) {
    if (!existsSync(join(ROOT, 'sdks/typescript/dist/index.js'))) throw new Error('build sdks/typescript first: npm install && npm run build');
    out.ts = ['node', [join(HERE, 'agents/ts/agent.mjs')]];
  }
  if (opts.agents.includes('py')) out.py = [opts.python, [join(HERE, 'agents/py/agent.py')]];
  if (opts.agents.includes('go')) {
    const bin = join(tmpdir(), 'dcp-interop-go-agent');
    run('go', ['build', '-o', bin, '.'], join(HERE, 'agents/go'));
    out.go = [bin, []];
  }
  if (opts.agents.includes('rust')) {
    run('cargo', ['build', '--release', '--quiet'], join(HERE, 'agents/rust'));
    out.rust = [join(HERE, 'agents/rust/target/release/interop-rust-agent'), []];
  }
  if (opts.agents.includes('ref')) {
    if (!existsSync(join(ROOT, 'node_modules/@dcp-ai/sdk'))) throw new Error('install the reference verifier first: npm install at the repository root');
    out.ref = ['node', [join(HERE, 'agents/ref/agent.mjs')]];
  }
  return out;
}

class Agent {
  constructor(name, cmd, args) {
    this.name = name;
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
      const timer = setTimeout(() => this.die(`timeout after ${opts.timeout} ms in ${cmd}`), opts.timeout);
      this.pending.set(id, { resolve, reject, timer, cmd });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }
  async stop() {
    if (!this.dead) await this.call('shutdown').catch(() => {});
    this.proc.kill();
  }
}

// ── Scenario 1: DCP-01 to DCP-03 ──

const POLICY_HASH = `sha256:${createHash('sha256').update('dcp-interop-matrix policy v1').digest('hex')}`;
const MODES = ['', 'hybrid_required'];
const modeName = (m) => m || 'default';
const clone = (v) => JSON.parse(JSON.stringify(v));

async function produce(agent, ownerName) {
  const id = await agent.call('identity', { owner_name: ownerName, jurisdiction: 'CL' });
  const routine = await agent.call('intent', {
    action_type: 'api_call', channel: 'api', data_classes: ['none'], estimated_impact: 'low', risk_score: 100, applied_policy_hash: POLICY_HASH,
  });
  for (let i = 1; i <= 3; i++) {
    await agent.call('act', { intent_id: routine.intent_id, outcome: `call ${i} completed`, tool: 'weather.lookup', result_ref: `result-${i}` });
  }
  const payment = await agent.call('intent', {
    action_type: 'initiate_payment', channel: 'payments', data_classes: ['financial_data'], estimated_impact: 'high', risk_score: 900,
    applied_policy_hash: POLICY_HASH,
  });
  if (payment.decision !== 'block') throw new Error(`${agent.name}: risk 900 must be blocked, got ${payment.decision}`);
  await agent.call('act', { intent_id: payment.intent_id, outcome: 'blocked by policy', tool: 'payments.transfer', result_ref: 'not-executed' });
  return {
    identity: id,
    routine: (await agent.call('bundle', { intent_id: routine.intent_id })).signed_bundle,
    payment: (await agent.call('bundle', { intent_id: payment.intent_id })).signed_bundle,
  };
}

// Each attack takes the producer's bundles (and another producer's) and returns a tampered copy.
const ATTACKS = {
  intent_changed: (b) => ((b.bundle.intent.payload.estimated_impact = 'high'), b),
  audit_reordered: (b) => (([b.bundle.audit_entries[0], b.bundle.audit_entries[1]] = [b.bundle.audit_entries[1], b.bundle.audit_entries[0]]), b),
  audit_entry_dropped: (b) => (b.bundle.audit_entries.pop(), b),
  session_spliced: (b) => ((b.bundle.manifest.session_nonce = 'ab'.repeat(32)), b),
  bundle_signature_swapped: (b, own) => ((b.signature = clone(own.payment.signature)), b),
  passport_swapped: (b, _own, other) => ((b.bundle.agent_passport = clone(other.routine.bundle.agent_passport)), b),
  pq_stripped: (b) => ((b.signature.composite_sig = { ...b.signature.composite_sig, pq: null, binding: 'classical_only' }), b),
  // Same session and signer: the manifest's own hashes must catch artifacts from another bundle.
  intent_from_other_bundle: (b, own) => ((b.bundle.intent = clone(own.payment.bundle.intent)), (b.bundle.policy_decision = clone(own.payment.bundle.policy_decision)), b),
  trail_from_other_bundle: (b, own) => ((b.bundle.audit_entries = clone(own.payment.bundle.audit_entries)), b),
};
const ATTACK_MODES = { pq_stripped: ['hybrid_required'] };

async function main() {
  const cmds = launchers();
  const agents = Object.fromEntries(Object.entries(cmds).map(([n, [c, a]]) => [n, new Agent(n, c, a)]));
  const names = opts.agents;
  if (!names.some((n) => !VERIFY_ONLY.has(n))) throw new Error('at least one producing agent is needed (ts, py, go or rust)');
  mkdirSync(opts.out, { recursive: true });
  const failures = [];
  const cells = {}; // `${producer}>${verifier}` -> { pass, total }
  const started = Date.now();
  try {
    const produced = {};
    for (const p of names.filter((n) => !VERIFY_ONLY.has(n))) {
      try {
        produced[p] = await produce(agents[p], `Interop Owner (${p})`);
      } catch (e) {
        failures.push({ producer: p, case: 'produce', error: e.message });
      }
    }
    const producers = names.filter((p) => produced[p]);
    if (producers.length < 2) console.log('note: passport_swapped needs two producers and is skipped');
    for (const [i, p] of producers.entries()) {
      const other = produced[producers[(i + 1) % producers.length]];
      const cases = [
        ['routine', produced[p].routine, true, MODES],
        ['payment', produced[p].payment, true, MODES],
        ...Object.entries(ATTACKS).map(([name, attack]) => [name, attack(clone(produced[p].routine), produced[p], other), false, ATTACK_MODES[name] ?? MODES]),
      ];
      for (const v of names) {
        const cell = (cells[`${p}>${v}`] = { pass: 0, total: 0 });
        for (const [name, doc, expected, modes] of cases) {
          if (name === 'passport_swapped' && producers.length < 2) continue;
          for (const mode of modes) {
            cell.total++;
            let verdict;
            try {
              verdict = await agents[v].call('verify', { signed_bundle: doc, mode });
            } catch (e) {
              verdict = { error: e.message };
            }
            if (verdict.valid === expected) {
              cell.pass++;
              continue;
            }
            const file = join(opts.out, `${p}-${v}-${name}-${modeName(mode)}.json`);
            writeFileSync(file, JSON.stringify({ producer: p, verifier: v, case: name, mode: modeName(mode), expected, verdict, signed_bundle: doc }, null, 2));
            failures.push({ producer: p, verifier: v, case: name, mode: modeName(mode), expected, verdict, file });
          }
        }
      }
    }
  } finally {
    await Promise.all(Object.values(agents).map((a) => a.stop()));
  }

  // Report: producer rows, verifier columns.
  const pad = (s, n) => String(s).padEnd(n);
  const lines = [`producer \\ verifier  ${names.map((v) => pad(v, 10)).join('')}`];
  for (const p of names.filter((n) => !VERIFY_ONLY.has(n))) {
    lines.push(`${pad(p, 21)}${names.map((v) => {
      const c = cells[`${p}>${v}`];
      return pad(c ? `${c.pass === c.total ? 'ok' : 'FAIL'} ${c.pass}/${c.total}` : 'no bundle', 10);
    }).join('')}`);
  }
  const report = { agents: names, cells, failures, seconds: (Date.now() - started) / 1000 };
  writeFileSync(join(opts.out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nScenario 1 (DCP-01 to 03): 2 bundles + ${Object.keys(ATTACKS).length} attacks per producer, modes ${MODES.map(modeName).join(', ')}\n`);
  console.log(lines.join('\n'));
  for (const f of failures) {
    console.log(`\nFAIL ${f.producer}${f.verifier ? ` > ${f.verifier}` : ''} ${f.case}${f.mode ? ` [${f.mode}]` : ''}: ${f.error ?? `expected ${f.expected ? 'valid' : 'invalid'}, got ${JSON.stringify(f.verdict).slice(0, 400)}`}`);
  }
  console.log(`\n${failures.length === 0 ? 'INTEROP MATRIX PASS' : `INTEROP MATRIX FAIL: ${failures.length} unexpected results`} (${report.seconds.toFixed(1)} s, report in ${join(opts.out, 'report.json')})`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
