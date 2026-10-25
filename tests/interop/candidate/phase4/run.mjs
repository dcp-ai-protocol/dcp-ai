#!/usr/bin/env node
// EXPERIMENTAL candidate dcp-jcs-v2, phase 4: the producer x consumer matrix (5 x 5: TypeScript, Python,
// Go, Rust, WASM). Every producer signs the same input bytes with its public opt-in APIs; every consumer
// verifies every output, and byte-level negatives made from the fresh outputs, with the phase 3 verifier,
// reporting the verdict and the calls it observed to its historical decoder.
// Expected: 575 positive results (115 units x 5 consumers) and 400 negative ones (16 x 5 x 5), 975 in all.
//
// The run is refused, never partly passed, when a step is missing or exits with an error (after writing
// results too), when a result is missing, repeated, unknown or malformed, when anything comes from another
// run or before this one started (run_id, created_at, mtime), when producers disagree on a unit beyond the
// PQ signature values, or when the deadline passes: the whole process group of the step is then killed.
//
// Usage: node run.mjs [--out <dir>] [--deadline <seconds>]   (a fresh run directory under --out or the tmp dir;
//                                                              the deadline also from DCP_PHASE4_DEADLINE; exit 2 if invalid)
//        node run.mjs --cost [--out <dir>]                    (gate 10: one equivalent pair per platform, N = 20
//                                                              after 3 warm-ups, at most 60 s each; builds timed apart)
//        node run.mjs --self-test                             (the controls of the runner)
// Needs the builds: sdks/typescript (npm run build), sdks/wasm (build:wasm, build:ts); Python with the SDK's
// dependencies (DCP_PHASE4_PYTHON, default python3), Go and Cargo. Nothing here publishes anything.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const SPECS_PATH = join(HERE, 'phase4-specs.json');
const SPECS = JSON.parse(readFileSync(SPECS_PATH, 'utf8'));
export const SDKS = ['ts', 'py', 'go', 'rust', 'wasm'];

/** The approved IDs: every positive unit of a producer (its cases in each mode, and the ring). */
export function positiveCases(specs = SPECS) {
  return [...specs.cases.flatMap((c) => c.modes.map((m) => `${c.id}-${m}`)), 'R'];
}

/** Every result expected, keyed producer|case|consumer. */
export function expectedResults(specs = SPECS, sdks = SDKS) {
  const out = new Map();
  for (const producer of sdks) {
    for (const c of positiveCases(specs)) for (const consumer of sdks) out.set(`${producer}|${c}|${consumer}`, specs.positive_expect);
    for (const n of specs.negatives) for (const consumer of sdks) out.set(`${producer}|${n.id}|${consumer}`, n.expect);
  }
  return out;
}

/** Every step a run must take, in order. */
export function requiredSteps(sdks = SDKS) {
  return ['ts inputs', ...sdks.map((s) => `${s} produce`), ...sdks.map((s) => `${s} ring`), ...sdks.map((s) => `negatives ${s}`), ...sdks.map((s) => `${s} verify`)];
}

const OUTCOMES = ['reject', 'v1_path', 'candidate'];
const ENTERED = ['none', 'dcp-jcs-v1', 'dcp-jcs-v2'];

/**
 * The verdict over one run: `exits` maps every step to its exit status, `results` are the consumers'
 * lines, `now` the instant the run ended.
 */
export function aggregate({ results, exits, steps, runId, startedAt, now, deadlineHit, expected }) {
  const problems = [];
  if (deadlineHit) problems.push('deadline: the run did not finish in time');
  for (const step of steps) if (!(step in exits)) problems.push(`step ${step} did not run`);
  for (const [step, status] of Object.entries(exits)) {
    if (!steps.includes(step)) problems.push(`unknown step ${step}`);
    else if (status !== 0) problems.push(`step ${step} exited with ${status}`);
  }
  const seen = new Map();
  for (const r of results) {
    if (r === null || typeof r !== 'object' || r.run_id !== runId) {
      problems.push(`stale: a result of another run (${r?.run_id})`);
      continue;
    }
    const key = `${r.producer}|${r.case}|${r.consumer}`;
    const at = typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN;
    if (!Number.isFinite(at) || at < startedAt || at > now) problems.push(`stale or invalid created_at for ${key}: ${r.created_at}`);
    if (!expected.has(key)) {
      problems.push(`unknown result ${key}`);
      continue;
    }
    if (seen.has(key)) {
      problems.push(`duplicate result ${key}`);
      continue;
    }
    seen.set(key, r);
    const valid = OUTCOMES.includes(r.outcome) && ENTERED.includes(r.entered)
      && (r.class === null || typeof r.class === 'string')
      && (r.verified === null || typeof r.verified === 'boolean')
      && Number.isInteger(r.decoder_calls) && r.decoder_calls >= 0 && Array.isArray(r.errors);
    if (!valid) {
      problems.push(`no valid outcome for ${key}: ${JSON.stringify(r)}`);
      continue;
    }
    const want = expected.get(key);
    const ok = r.outcome === want.outcome && r.entered === want.entered && r.decoder_calls === want.decoder_calls
      && (want.class === undefined || r.class === want.class)
      && (want.verified === undefined || r.verified === want.verified)
      && (r.entered === 'none') === (r.verified === null);
    if (!ok) problems.push(`${key}: got ${JSON.stringify({ outcome: r.outcome, class: r.class, entered: r.entered, verified: r.verified, decoder_calls: r.decoder_calls, errors: r.errors })}, want ${JSON.stringify(want)}`);
  }
  for (const key of expected.keys()) if (!seen.has(key)) problems.push(`missing result ${key}`);
  return { ok: problems.length === 0, problems, counted: seen.size, expected: expected.size };
}

// ── Comparing producers: an exact copy, with only the known PQ signature values masked ──

/** An exact copy: members kept as data, `__proto__` included. */
function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).map((k) => [k, clone(v[k])]));
}

/** A deterministic text of a value: members sorted, `__proto__` and every other member as data. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

/**
 * A unit with the ML-DSA signature values masked at their known places only: the bundle signature, the
 * four artifacts and each PQ checkpoint. A member named pq or sig_b64 anywhere else is data.
 */
export function maskedUnit(unit) {
  const u = clone(unit);
  const mask = (holder) => {
    const pq = holder && typeof holder === 'object' && Object.hasOwn(holder, 'composite_sig') ? holder.composite_sig?.pq : undefined;
    if (pq && typeof pq === 'object' && Object.hasOwn(pq, 'sig_b64')) pq.sig_b64 = '<pq>';
  };
  mask(u.signature);
  for (const name of ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision']) mask(u.bundle?.[name]);
  for (const cp of Array.isArray(u.bundle?.pq_checkpoints) ? u.bundle.pq_checkpoints : []) mask(cp);
  return stable(u);
}

/** The outputs of every producer for a case agree: the same manifest_hash, the same unit but the PQ signatures. */
function crossProducer(run, producers) {
  const problems = [];
  const groups = new Map();
  for (const p of producers) {
    for (const c of positiveCases()) {
      const file = join(run, 'produced', p, `${c}.bin`);
      if (!existsSync(file)) continue;
      const unit = JSON.parse(readFileSync(file, 'utf8'));
      const spec = c === 'R' ? 'S01' : c.split('-')[0];
      if (!groups.has(spec)) groups.set(spec, []);
      groups.get(spec).push({ who: `${p}/${c}`, hash: unit.signature.manifest_hash, unit: maskedUnit(unit) });
    }
  }
  for (const [spec, list] of groups) {
    const first = list[0];
    for (const x of list.slice(1)) {
      if (x.hash !== first.hash) problems.push(`${spec}: manifest_hash of ${x.who} is not that of ${first.who}`);
      else if (x.unit !== first.unit) problems.push(`${spec}: ${x.who} differs from ${first.who} beyond the PQ signature values`);
    }
  }
  return { problems, groups: groups.size, compared: [...groups.values()].reduce((n, l) => n + l.length, 0) };
}

// ── Steps: a process group, killed hard at the deadline ──

/**
 * Runs one step in its own process group. At the deadline the whole group is killed with SIGKILL, which a
 * process cannot ignore, and the step is reported as timed out.
 */
export function runStep(cmd, argv, { cwd, env, deadlineAt }) {
  return new Promise((done) => {
    const left = deadlineAt - Date.now();
    if (left <= 0) return done({ status: null, timedOut: true, stdout: '', stderr: 'no time left' });
    const child = spawn(cmd, argv, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, left);
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ status: null, timedOut, stdout, stderr: `${stderr}\n${e.message}` });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      if (timedOut) {
        try {
          process.kill(-child.pid, 'SIGKILL'); // whatever of the group is still there
        } catch {
          // the group is gone
        }
      }
      done({ status, timedOut, stdout, stderr });
    });
  });
}

function command(sdk, mode, run, runId) {
  const env = { ...process.env, DCP_PHASE4_RUN: run, DCP_PHASE4_MODE: mode, DCP_PHASE4_SPECS: SPECS_PATH, DCP_PHASE4_SDK: sdk, DCP_PHASE4_RUN_ID: runId };
  switch (sdk) {
    case 'ts':
      return [process.execPath, [join(HERE, 'adapters/ts.mjs'), mode, run], { cwd: ROOT, env }];
    case 'wasm':
      return [process.execPath, [join(HERE, 'adapters/wasm.mjs'), mode, run], { cwd: ROOT, env }];
    case 'py':
      return [process.env.DCP_PHASE4_PYTHON ?? 'python3', [join(HERE, 'adapters/py_adapter.py'), mode, run], { cwd: ROOT, env: { ...env, PYTHONPATH: join(ROOT, 'sdks/python') } }];
    case 'go':
      if (mode === 'build-cost') return ['go', ['test', '-count=1', '-run', '^$', './dcp/v2/'], { cwd: join(ROOT, 'sdks/go'), env }];
      return ['go', ['test', './dcp/v2/', '-run', '^TestExperimentalCandidatePhase4Matrix$', '-count=1'], { cwd: join(ROOT, 'sdks/go'), env }];
    case 'rust': {
      // Cost is measured on the release profile; the matrix runs on the default (debug) one.
      const release = mode === 'cost' || mode === 'build-cost' ? ['--release'] : [];
      if (mode === 'build-cost') return ['cargo', ['test', ...release, '--quiet', '--no-run', '--test', 'experimental_candidate_phase4_matrix'], { cwd: join(ROOT, 'sdks/rust'), env }];
      return ['cargo', ['test', ...release, '--quiet', '--test', 'experimental_candidate_phase4_matrix', '--', '--nocapture'], { cwd: join(ROOT, 'sdks/rust'), env }];
    }
  }
  throw new Error(`unknown sdk ${sdk}`);
}

/** The negatives of one producer, made from its fresh outputs by byte edits. */
function makeNegatives(run, producer, runId) {
  const read = (c) => readFileSync(join(run, 'produced', producer, `${c}.bin`));
  const replaceOnce = (buf, find, by) => {
    const f = Buffer.from(find, 'latin1');
    const i = buf.indexOf(f);
    if (i < 0 || buf.indexOf(f, i + 1) >= 0) throw new Error(`${producer}: ${find.slice(0, 40)} must occur exactly once`);
    return Buffer.concat([buf.subarray(0, i), Buffer.isBuffer(by) ? by : Buffer.from(by, 'latin1'), buf.subarray(i + f.length)]);
  };
  const base = read('S01-bytes');
  const unit = JSON.parse(base.toString('utf8'));
  const flip = (b64) => {
    const b = Buffer.from(b64, 'base64');
    b[0] ^= 0xff;
    return b.toString('base64');
  };
  const edits = {
    NBOM: () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), base]),
    NUTF8: () => replaceOnce(base, 'bob@example.com', Buffer.concat([Buffer.from('bob'), Buffer.from([0xff]), Buffer.from('example.com')])),
    NSYNTAX: () => base.subarray(0, base.length - 1),
    NSURR: () => replaceOnce(base, 'bob@example.com', 'bob\\ud800example.com'),
    NDUP: () => replaceOnce(base, '"risk_score":450', '"risk_score":450,"risk_score":450'),
    NFRAC: () => replaceOnce(base, '"risk_score":450', '"risk_score":1.5'),
    NRANGE: () => replaceOnce(base, '"risk_score":450', '"risk_score":9007199254740992'),
    NDEPTH: () => replaceOnce(read('S08-bytes'), '["deep"]', '[["deep"]]'),
    NTRANS: () => base,
    NAMBIG: () => Buffer.concat([Buffer.from('{"signed_bundle":'), base, Buffer.from(',"signed_bundle":null}')]),
    NPUNK: () => replaceOnce(base, '"canonicalization_profile":"dcp-jcs-v2"', '"canonicalization_profile":"dcp-jcs-v3"'),
    NPNA: () => base,
    NPAY: () => replaceOnce(base, '"action_type":"send_email"', '"action_type":"send_fax"'),
    NMAN: () => replaceOnce(base, '"session_expires_at":"2099-12-31T23:59:59+05:00"', '"session_expires_at":"2099-12-30T23:59:59+05:00"'),
    NSIGC: () => replaceOnce(base, unit.signature.composite_sig.classical.sig_b64, flip(unit.signature.composite_sig.classical.sig_b64)),
    NSIGQ: () => replaceOnce(base, unit.signature.composite_sig.pq.sig_b64, flip(unit.signature.composite_sig.pq.sig_b64)),
  };
  const dir = join(run, 'negatives', producer);
  mkdirSync(dir, { recursive: true });
  const index = SPECS.negatives.map((n) => {
    const bytes = edits[n.id]();
    writeFileSync(join(dir, `${n.id}.bin`), bytes);
    return { case: n.id, config: n.config, sha256: createHash('sha256').update(bytes).digest('hex'), run_id: runId, created_at: new Date().toISOString() };
  });
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2));
}

function checkFresh(run, startedAt, now, runId, producers) {
  const problems = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.mtimeMs < startedAt - 1000) problems.push(`stale file ${p}`);
    }
  };
  walk(run);
  for (const p of producers) {
    for (const index of ['index.json', 'ring.json']) {
      const file = join(run, 'produced', p, index);
      if (!existsSync(file)) {
        problems.push(`${p}: no ${index}`);
        continue;
      }
      for (const e of JSON.parse(readFileSync(file, 'utf8'))) {
        const at = Date.parse(e.created_at);
        if (e.run_id !== runId || !Number.isFinite(at) || at < startedAt || at > now) problems.push(`${p}: ${e.case} is not of this run`);
      }
    }
  }
  return problems;
}

function args() {
  const a = process.argv.slice(2);
  const get = (name) => {
    const i = a.indexOf(name);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const deadline = Number(get('--deadline') ?? process.env.DCP_PHASE4_DEADLINE ?? 1800);
  if (!Number.isFinite(deadline) || deadline <= 0) {
    console.error(`--deadline must be a positive number of seconds, not ${get('--deadline') ?? process.env.DCP_PHASE4_DEADLINE}`);
    process.exit(2);
  }
  return { selfTest: a.includes('--self-test'), cost: a.includes('--cost'), out: get('--out'), deadline };
}

async function main() {
  const a = args();
  if (a.selfTest) return selfTest();
  if (a.cost) return cost(a);
  const sdks = SDKS;
  const parent = a.out ? resolve(a.out) : tmpdir();
  mkdirSync(parent, { recursive: true });
  const run = mkdtempSync(join(parent, 'dcp-phase4-'));
  const runId = randomUUID();
  const startedAt = Date.now();
  const deadlineAt = startedAt + a.deadline * 1000;
  writeFileSync(join(run, 'run.json'), JSON.stringify({ run_id: runId, started_at: new Date(startedAt).toISOString(), sdks }, null, 2));
  const exits = {};
  let deadlineHit = false;
  const step = async (sdk, mode) => {
    const [cmd, argv, opts] = command(sdk, mode, run, runId);
    const t0 = Date.now();
    const r = await runStep(cmd, argv, { ...opts, deadlineAt });
    if (r.timedOut) deadlineHit = true;
    exits[`${sdk} ${mode}`] = r.status ?? -1;
    writeFileSync(join(run, `log-${sdk}-${mode}.txt`), `${r.stdout}\n--- stderr ---\n${r.stderr}`);
    console.log(`${sdk} ${mode}: ${r.status === 0 ? 'ok' : r.timedOut ? 'killed at the deadline' : `exit ${r.status}`} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  };
  await step('ts', 'inputs');
  for (const sdk of sdks) await step(sdk, 'produce');
  for (const sdk of sdks) await step(sdk, 'ring');
  for (const sdk of sdks) {
    try {
      makeNegatives(run, sdk, runId);
      exits[`negatives ${sdk}`] = 0;
    } catch (e) {
      exits[`negatives ${sdk}`] = 1;
      console.error(`negatives ${sdk}: ${e.message}`);
    }
  }
  for (const sdk of sdks) await step(sdk, 'verify');

  const results = [];
  for (const sdk of sdks) {
    const file = join(run, 'results', `${sdk}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) if (line.trim()) results.push(JSON.parse(line));
  }
  const now = Date.now();
  const verdict = aggregate({ results, exits, steps: requiredSteps(sdks), runId, startedAt, now, deadlineHit, expected: expectedResults(SPECS, sdks) });
  const cross = crossProducer(run, sdks);
  const fresh = checkFresh(run, startedAt, now, runId, sdks);
  const kids = sdks.map((s) => ({ s, k: existsSync(join(run, 'kids', `${s}.json`)) ? readFileSync(join(run, 'kids', `${s}.json`), 'utf8') : null }));
  const kidProblems = kids.filter((x) => x.k === null || x.k !== kids[0].k).map((x) => `kids of ${x.s} differ or are missing`);
  const problems = [...verdict.problems, ...cross.problems, ...fresh, ...kidProblems];
  const summary = {
    run_id: runId, run, sdks, results: verdict.counted, expected: verdict.expected,
    cross_producer_groups: cross.groups, cross_producer_units: cross.compared,
    ok: problems.length === 0, problem_count: problems.length, problems: problems.slice(0, 200), finished_at: new Date().toISOString(),
  };
  writeFileSync(join(run, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, problems: summary.problems.slice(0, 20) }, null, 2));
  process.exit(summary.ok ? 0 : 1);
}

// ── Cost (gate 10): one equivalent pair per platform, measured by its adapter ──

export const COST_OPS = ['produce_v1', 'produce_candidate', 'verify_today', 'verify_v1_path', 'verify_candidate'];
const COST_CHECKS = ['same_payload_hashes', 'same_session', 'same_entries', 'today_verified', 'v1_path', 'candidate'];
const COST_BUDGET_MS = 60_000;

/** The median and p90 (nearest rank) of the samples, as every adapter computes them. */
export function costStats(samples) {
  const s = [...samples].sort((x, y) => x - y);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { median, p90: s[Math.ceil(0.9 * s.length) - 1] };
}

/**
 * A platform's cost report is complete: its platform, this run, every check true, 20 non-negative samples
 * per operation whose median and p90 are those reported, a boundary for each, and a total within budget.
 */
export function checkCost(report, sdk, runId, startedAt, now) {
  const problems = [];
  const close = (x, y) => Number.isFinite(x) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
  const at = Date.parse(report?.created_at);
  if (report?.sdk !== sdk) problems.push(`a report of ${report?.sdk}, not of ${sdk}`);
  if (report?.run_id !== runId || !Number.isFinite(at) || at < startedAt || at > now) problems.push('not of this run');
  if (report?.n !== 20 || report?.warmup !== 3) problems.push('not 20 samples after 3 warm-ups');
  for (const c of COST_CHECKS) if (report?.checks?.[c] !== true) problems.push(`check ${c} is not true`);
  for (const op of COST_OPS) {
    const o = report?.ops?.[op];
    const samples = o?.samples_ms;
    if (!Array.isArray(samples) || samples.length !== 20 || !samples.every((x) => Number.isFinite(x) && x >= 0)) {
      problems.push(`operation ${op} has no 20 valid samples`);
    } else {
      const { median, p90 } = costStats(samples);
      if (!close(o.median_ms, median) || !close(o.p90_ms, p90)) problems.push(`operation ${op}: median or p90 not those of its samples`);
    }
    const boundary = report?.boundaries?.[op];
    if (typeof boundary !== 'string' || boundary.trim() === '') problems.push(`operation ${op} has no boundary`);
  }
  const total = report?.measured_ms;
  if (!Number.isFinite(total) || total < 0 || total > COST_BUDGET_MS) problems.push(`measured in ${total} ms, not within 0 and ${COST_BUDGET_MS}`);
  return problems;
}

async function cost(a) {
  const parent = a.out ? resolve(a.out) : tmpdir();
  mkdirSync(parent, { recursive: true });
  const run = mkdtempSync(join(parent, 'dcp-phase4-cost-'));
  const runId = randomUUID();
  const startedAt = Date.now();
  const deadlineAt = startedAt + a.deadline * 1000;
  const builds = {};
  const problems = [];
  const step = async (sdk, mode, until) => {
    const [cmd, argv, opts] = command(sdk, mode, run, runId);
    const t0 = Date.now();
    const r = await runStep(cmd, argv, { ...opts, deadlineAt: until });
    writeFileSync(join(run, `log-${sdk}-${mode}.txt`), `${r.stdout}\n--- stderr ---\n${r.stderr}`);
    const ms = Date.now() - t0;
    console.log(`${sdk} ${mode}: ${r.status === 0 ? 'ok' : r.timedOut ? 'killed at the deadline' : `exit ${r.status}`} (${(ms / 1000).toFixed(1)} s)`);
    if (r.status !== 0) problems.push(`${sdk} ${mode}: ${r.timedOut ? 'deadline' : `exit ${r.status}`}`);
    return ms;
  };
  await step('ts', 'inputs', deadlineAt);
  // The builds are timed apart, before; TypeScript and WASM come built (their own build steps).
  for (const sdk of ['go', 'rust']) builds[sdk] = await step(sdk, 'build-cost', deadlineAt);
  // Each platform's process, start-up included, gets the 60 s budget; the builds ran before.
  for (const sdk of SDKS) await step(sdk, 'cost', Math.min(deadlineAt, Date.now() + COST_BUDGET_MS));
  const now = Date.now();
  const reports = {};
  for (const sdk of SDKS) {
    const file = join(run, 'cost', `${sdk}.json`);
    if (!existsSync(file)) {
      problems.push(`${sdk}: no cost report`);
      continue;
    }
    reports[sdk] = JSON.parse(readFileSync(file, 'utf8'));
    for (const p of checkCost(reports[sdk], sdk, runId, startedAt, now)) problems.push(`${sdk}: ${p}`);
  }
  const table = Object.fromEntries(Object.entries(reports).map(([sdk, r]) => [sdk, Object.fromEntries(COST_OPS.map((op) => [op, { median_ms: +r.ops[op].median_ms.toFixed(3), p90_ms: +r.ops[op].p90_ms.toFixed(3) }]))]));
  const summary = { run_id: runId, run, build_ms: builds, table, ok: problems.length === 0, problems, finished_at: new Date().toISOString() };
  writeFileSync(join(run, 'cost-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
}

// ── The controls of the runner ──

async function selfTest() {
  const runId = 'self-test';
  const startedAt = Date.parse('2026-10-25T00:00:00Z');
  const now = Date.parse('2026-10-25T01:00:00Z');
  const expected = expectedResults();
  const steps = requiredSteps();
  const good = [...expected].map(([key, want]) => {
    const [producer, c, consumer] = key.split('|');
    return { run_id: runId, producer, case: c, consumer, created_at: '2026-10-25T00:01:00Z', outcome: want.outcome, class: want.class ?? null,
      entered: want.entered, verified: want.verified ?? null, decoder_calls: want.decoder_calls, errors: [] };
  });
  const allOk = Object.fromEntries(steps.map((s) => [s, 0]));
  const verdict = (o) => aggregate({ results: good, exits: allOk, steps, runId, startedAt, now, deadlineHit: false, expected, ...o });
  const failures = [];
  let controls = 0;
  const expect = (name, ok, want) => {
    controls++;
    if (ok !== want) failures.push(name);
  };
  const with0 = (change) => [{ ...good[0], ...change }, ...good.slice(1)];
  expect('complete and correct', verdict({}).ok, true);
  expect('975 results expected', good.length === 975, true);
  expect('a result missing', verdict({ results: good.slice(1) }).ok, false);
  expect('a result repeated', verdict({ results: [...good, good[0]] }).ok, false);
  expect('an unknown case', verdict({ results: [...good.slice(1), { ...good[0], case: 'S99-bytes' }] }).ok, false);
  expect('an unknown consumer', verdict({ results: [...good.slice(1), { ...good[0], consumer: 'java' }] }).ok, false);
  expect('a line without an outcome', verdict({ results: with0({ outcome: undefined }) }).ok, false);
  expect('an invalid entered', verdict({ results: with0({ entered: 'yes' }) }).ok, false);
  expect('decoder calls missing', verdict({ results: with0({ decoder_calls: undefined }) }).ok, false);
  expect('decoder calls wrong', verdict({ results: with0({ decoder_calls: 1 }) }).ok, false);
  expect('no steps at all', verdict({ exits: {} }).ok, false);
  expect('the inputs step missing', verdict({ exits: Object.fromEntries(steps.filter((s) => s !== 'ts inputs').map((s) => [s, 0])) }).ok, false);
  expect('a later failure of a step', verdict({ exits: { ...allOk, 'go verify': 2 } }).ok, false);
  expect('a result of another run', verdict({ results: with0({ run_id: 'earlier' }) }).ok, false);
  expect('a result before the run', verdict({ results: with0({ created_at: '2026-10-24T00:00:00Z' }) }).ok, false);
  expect('created_at not a date', verdict({ results: with0({ created_at: 'not-a-date' }) }).ok, false);
  expect('created_at missing', verdict({ results: with0({ created_at: undefined }) }).ok, false);
  expect('the deadline passed', verdict({ deadlineHit: true }).ok, false);
  expect('a wrong verdict', verdict({ results: with0({ verified: false }) }).ok, false);

  // A cost report is refused when incomplete, failed, inconsistent, of another platform or run, or over budget.
  const samples = Array.from({ length: 20 }, (_, i) => i + 1);
  const ops = Object.fromEntries(COST_OPS.map((op) => [op, { median_ms: 10.5, p90_ms: 18, samples_ms: samples }]));
  const report = { sdk: 'go', run_id: runId, created_at: '2026-10-25T00:02:00Z', n: 20, warmup: 3, measured_ms: 1000, ops,
    checks: Object.fromEntries(COST_CHECKS.map((c) => [c, true])), boundaries: Object.fromEntries(COST_OPS.map((op) => [op, 'b'])) };
  const costOk = (change) => checkCost({ ...report, ...change }, 'go', runId, startedAt, now).length === 0;
  const withOp = (change) => ({ ops: { ...ops, verify_today: { ...ops.verify_today, ...change } } });
  expect('a complete cost report', costOk({}), true);
  expect('a cost check false', costOk({ checks: { ...report.checks, same_entries: false } }), false);
  expect('a cost operation with 19 samples', costOk(withOp({ samples_ms: samples.slice(1) })), false);
  expect('a negative sample', costOk(withOp({ samples_ms: [-1, ...samples.slice(1)] })), false);
  expect('a median not that of the samples', costOk(withOp({ median_ms: -123 })), false);
  expect('a p90 not that of the samples', costOk(withOp({ p90_ms: 20 })), false);
  expect('a cost report of another run', costOk({ run_id: 'other' }), false);
  expect('a cost report of another platform', costOk({ sdk: 'rust' }), false);
  expect('a cost report over budget', costOk({ measured_ms: 60_001 }), false);
  expect('a negative total', costOk({ measured_ms: -1 }), false);
  expect('a total that is not a number', costOk({ measured_ms: '5' }), false);
  expect('a cost operation without its boundary', costOk({ boundaries: { ...report.boundaries, verify_today: undefined } }), false);
  expect('an empty boundary', costOk({ boundaries: { ...report.boundaries, verify_today: ' ' } }), false);

  // The comparison masks only the known PQ signature values.
  const unit = JSON.parse('{"bundle":{"intent":{"composite_sig":{"classical":{"sig_b64":"c"},"pq":{"sig_b64":"q1"}},"payload":{"target":{"pq":{"sig_b64":"data"},"__proto__":{"x":1}}}},"pq_checkpoints":[{"composite_sig":{"pq":{"sig_b64":"q2"}}}]},"signature":{"composite_sig":{"pq":{"sig_b64":"q3"}}}}');
  const variant = (edit) => {
    const u = JSON.parse(JSON.stringify(unit));
    edit(u);
    return u;
  };
  const same = (a, b) => maskedUnit(a) === maskedUnit(b);
  expect('PQ signatures of the bundle, an artifact and a checkpoint are masked', same(unit, variant((u) => {
    u.signature.composite_sig.pq.sig_b64 = 'other';
    u.bundle.intent.composite_sig.pq.sig_b64 = 'other';
    u.bundle.pq_checkpoints[0].composite_sig.pq.sig_b64 = 'other';
  })), true);
  expect('a member pq.sig_b64 in a payload is data', same(unit, variant((u) => (u.bundle.intent.payload.target.pq.sig_b64 = 'changed'))), false);
  expect('a member __proto__ is data', same(unit, JSON.parse(JSON.stringify(unit).replace('{"x":1}', '{"x":2}'))), false);
  expect('a classical signature is not masked', same(unit, variant((u) => (u.bundle.intent.composite_sig.classical.sig_b64 = 'd'))), false);

  // A real process that ignores SIGTERM, with a child of its own, is killed at the deadline, group included.
  const dir = mkdtempSync(join(tmpdir(), 'dcp-phase4-self-'));
  const pidFile = join(dir, 'grandchild.pid');
  const script = `process.on('SIGTERM', () => {});
const c = require('child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
setInterval(() => {}, 1000);`;
  // ps reports a process as running, as a zombie (killed, not reaped yet: not running) or not at all.
  const state = (pid) => {
    const out = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
    return out === '' ? 'gone' : out.startsWith('Z') ? 'zombie' : 'running';
  };
  const t0 = Date.now();
  const step = runStep(process.execPath, ['-e', script], { cwd: dir, env: process.env, deadlineAt: Date.now() + 1500 });
  // The grandchild must exist, with a valid PID and running, before the deadline: its absence later
  // proves nothing otherwise.
  let pid = null;
  while (Date.now() - t0 < 1200 && pid === null) {
    await new Promise((d) => setTimeout(d, 50));
    const n = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : NaN;
    if (Number.isInteger(n) && n > 1) pid = n;
  }
  const runningBefore = pid !== null && Date.now() - t0 < 1500 && state(pid) === 'running';
  const r = await step;
  const elapsed = Date.now() - t0;
  expect('a step past the deadline is reported as timed out', r.timedOut && r.status !== 0, true);
  expect('the kill is bounded', elapsed < 6000, true);
  expect('the grandchild ran, with a valid PID, before the deadline', runningBefore, true);
  await new Promise((d) => setTimeout(d, 200));
  const after = pid === null ? 'unknown' : state(pid);
  expect('the grandchild is not running after the kill', runningBefore && (after === 'gone' || after === 'zombie'), true);
  // The check is not vacuous: a grandchild that left the group (its own session) is seen running.
  const escapedFile = join(dir, 'escaped.pid');
  const escape = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });
require('fs').writeFileSync(${JSON.stringify(escapedFile)}, String(c.pid));
setInterval(() => {}, 1000);`;
  await runStep(process.execPath, ['-e', escape], { cwd: dir, env: process.env, deadlineAt: Date.now() + 800 });
  const escaped = existsSync(escapedFile) ? Number(readFileSync(escapedFile, 'utf8')) : NaN;
  expect('a grandchild outside the group is seen running', Number.isInteger(escaped) && escaped > 1 && state(escaped) === 'running', true);
  if (Number.isInteger(escaped) && escaped > 1) {
    try {
      process.kill(escaped, 'SIGKILL');
    } catch {
      // already gone
    }
  }

  if (failures.length > 0) {
    console.error(`phase 4 runner self-test: ${failures.length} of ${controls} controls failed`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`phase 4 runner self-test: ${controls} controls passed (steps, results, fields, freshness, masking, a real process group killed at the deadline in ${elapsed} ms, grandchild ${pid} ${after})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
