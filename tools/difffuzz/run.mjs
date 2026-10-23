#!/usr/bin/env node
// Differential fuzzer: the same mutated V2 signed bundle goes through the
// TypeScript, Python, Go and Rust verifiers; any disagreement in the `valid`
// verdict, any crash and any timeout is a finding. See README.md.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

// ── CLI ──
const opts = {
  seed: '1',
  iterations: 200,
  timeout: 30000,
  modes: 'default,hybrid_required',
  python: process.env.DIFFFUZZ_PYTHON || 'python3',
  out: join(HERE, 'findings'),
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const m = a.match(/^--(seed|iterations|timeout|modes|python|out)(?:=(.*))?$/);
  if (!m) throw new Error(`Unknown argument ${a}`);
  opts[m[1]] = m[2] ?? process.argv[++i];
}
opts.iterations = Number(opts.iterations);
opts.timeout = Number(opts.timeout);
const MODES = opts.modes.split(',').map((m) => (m === 'default' ? '' : m));

// ── Deterministic PRNG (mulberry32 seeded from a string) ──
function hashSeed(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(hashSeed(opts.seed));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (n) => Math.floor(rand() * n);

// ── Seeds ──
const isSignedBundle = (v) =>
  v &&
  typeof v === 'object' &&
  v.bundle &&
  typeof v.bundle === 'object' &&
  v.bundle.dcp_bundle_version === '2.0' &&
  'signature' in v;
function collect(value, path, into) {
  if (isSignedBundle(value)) {
    into.push({ name: path, doc: value });
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => collect(v, `${path}[${i}]`, into));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) collect(v, path ? `${path}.${k}` : k, into);
}
function loadSeeds() {
  const seeds = [];
  const vectors = JSON.parse(
    readFileSync(join(ROOT, 'tests/interop/v2/bundle_vectors.json'), 'utf8'),
  );
  for (const key of [
    'signed_bundle',
    'must_accept_bundles',
    'classical_only_routine_bundle',
    'must_reject_bundles',
  ]) {
    collect(vectors[key], `bundle_vectors.${key}`, seeds);
  }
  collect(
    JSON.parse(readFileSync(join(ROOT, 'tests/interop/v2/cross_sdk_vectors.json'), 'utf8')),
    'cross_sdk_vectors',
    seeds,
  );
  const examples = join(ROOT, 'tests/conformance/examples');
  for (const f of readdirSync(examples)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    collect(JSON.parse(readFileSync(join(examples, f), 'utf8')), `examples/${f}`, seeds);
  }
  return seeds;
}

// ── Mutators ──
// A mutant is a JS value plus "raw" placeholders: strings of the form
// "\0RAW:<token>\0" are spliced into the serialized text verbatim, so numbers
// such as 1.0, 1e2, -0 or 2^64 reach every parser exactly as written.
const RAW = (token) => `\0RAW:${token}\0`;
function serialize(doc) {
  return JSON.stringify(doc).replace(/"\\u0000RAW:([^"\\]*)\\u0000"/g, '$1');
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Every (container, key) slot in the document, with its JSON path.
function slots(doc) {
  const out = [];
  const walk = (container, path) => {
    const keys = Array.isArray(container) ? container.map((_, i) => i) : Object.keys(container);
    for (const k of keys) {
      const p = [...path, k];
      out.push({ container, key: k, path: p, value: container[k] });
      if (container[k] && typeof container[k] === 'object') walk(container[k], p);
    }
  };
  walk(doc, []);
  return out;
}
const fmtPath = (p) =>
  p
    .map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`))
    .join('')
    .replace(/^\./, '');
const BASE64 = /^[A-Za-z0-9+/]{16,}={0,2}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ENUMISH = /^[a-z][a-z0-9_-]{1,31}$/;
const PROTO_KEYS = [
  'constructor',
  '__proto__',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'prototype',
];
const ARTIFACTS = ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'];

function randomValue() {
  return pick([
    null,
    true,
    false,
    0,
    1,
    -1,
    'x',
    '',
    [],
    {},
    [null],
    { a: 1 },
    RAW('1e2'),
    'constructor',
  ]);
}
function otherType(v) {
  const kinds = {
    string: 'str',
    number: 'num',
    boolean: 'bool',
    object: Array.isArray(v) ? 'arr' : v === null ? 'null' : 'obj',
  };
  const current = kinds[typeof v];
  const candidates = { str: 'text', num: 42, bool: true, arr: [v], obj: { value: v }, null: null };
  const next = pick(Object.keys(candidates).filter((k) => k !== current));
  return candidates[next];
}

const mutators = {
  delete_key(doc) {
    const s = pick(slots(doc).filter((x) => isObj(x.container)));
    if (!s) return null;
    delete s.container[s.key];
    return fmtPath(s.path);
  },
  set_null(doc) {
    const s = pick(slots(doc));
    if (!s) return null;
    s.container[s.key] = null;
    return fmtPath(s.path);
  },
  swap_type(doc) {
    const s = pick(slots(doc));
    if (!s) return null;
    s.container[s.key] = otherType(s.value);
    return fmtPath(s.path);
  },
  swap_siblings(doc) {
    const s = pick(
      slots(doc).filter((x) => isObj(x.container) && Object.keys(x.container).length > 1),
    );
    if (!s) return null;
    const other = pick(Object.keys(s.container).filter((k) => k !== s.key));
    [s.container[s.key], s.container[other]] = [s.container[other], s.container[s.key]];
    return `${fmtPath(s.path)} <-> ${other}`;
  },
  flip_base64_char(doc) {
    const all = slots(doc).filter((x) => typeof x.value === 'string' && BASE64.test(x.value));
    if (!all.length) return null;
    const s = pick(all);
    if (!s) return null;
    const i = randInt(s.value.length - (s.value.endsWith('=') ? 2 : 0));
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let c = alphabet[randInt(64)];
    if (c === s.value[i]) c = alphabet[(alphabet.indexOf(c) + 1) % 64];
    s.container[s.key] = s.value.slice(0, i) + c + s.value.slice(i + 1);
    return `${fmtPath(s.path)}[${i}]`;
  },
  prototype_key(doc) {
    const all = slots(doc).filter((x) => typeof x.value === 'string' && ENUMISH.test(x.value));
    if (!all.length) return null;
    const s = pick(all);
    if (!s) return null;
    const k = pick(PROTO_KEYS);
    s.container[s.key] = k;
    return `${fmtPath(s.path)} = ${k}`;
  },
  prototype_key_as_key(doc) {
    const s = pick(slots(doc).filter((x) => isObj(x.container)));
    if (!s) return null;
    const k = pick(PROTO_KEYS);
    s.container[k] = s.value;
    delete s.container[s.key];
    return `${fmtPath(s.path)} renamed to ${k}`;
  },
  add_unknown_key(doc) {
    const s = pick(slots(doc).filter((x) => isObj(x.value)));
    if (!s) return null;
    const k = `x_${randInt(1e6).toString(36)}`;
    s.value[k] = randomValue();
    return `${fmtPath([...s.path, k])}`;
  },
  duplicate_artifact(doc) {
    const b = doc.bundle;
    if (!isObj(b)) return null;
    const [from, to] = [pick(ARTIFACTS), pick(ARTIFACTS)];
    // A seed that lacks the artifact (a must_reject bundle) has nothing to copy: clone(undefined) throws.
    if (b[from] === undefined) return null;
    if (rand() < 0.5 || from === to) {
      b[to] = clone(b[from]);
      return `bundle.${to} = bundle.${from}`;
    }
    if (!isObj(b[from]) || !isObj(b[to])) return null;
    const part = pick(['composite_sig', 'payload', 'payload_hash']);
    if (b[from][part] === undefined) return null;
    b[to][part] = clone(b[from][part]);
    return `bundle.${to}.${part} = bundle.${from}.${part}`;
  },
  number_variant(doc) {
    const all = slots(doc).filter((x) => typeof x.value === 'number');
    if (!all.length) return null;
    const s = pick(all);
    if (!s) return null;
    const n = s.value;
    const token = pick([
      `${n}.0`,
      `${n}e0`,
      `${n === 0 ? 1 : n}e2`,
      '-0',
      '0.1',
      `${n}.5`,
      '1.0',
      '1e2',
      '18446744073709551616',
      '-9223372036854775809',
      '1' + '0'.repeat(40),
      '1e400',
      '-1e-400',
      '4.9e-324',
      '9007199254740993',
    ]);
    s.container[s.key] = RAW(token);
    return `${fmtPath(s.path)} = ${token}`;
  },
  timestamp_variant(doc) {
    const all = slots(doc).filter((x) => typeof x.value === 'string' && RFC3339.test(x.value));
    if (!all.length) return null;
    const s = pick(all);
    if (!s) return null;
    const t = new Date(s.value);
    // A must_reject seed carries impossible dates (2026-13-45) that match the pattern but name no instant.
    if (Number.isNaN(t.getTime())) return null;
    const iso = t.toISOString();
    const offset = (sign, h) => {
      const shifted = new Date(t.getTime() + sign * h * 3600000).toISOString().slice(0, 19);
      return `${shifted}${sign > 0 ? '+' : '-'}${String(h).padStart(2, '0')}:00`;
    };
    const v = pick([
      offset(1, 5),
      offset(-1, 5),
      offset(1, 14),
      offset(-1, 12), // same instant, other offsets
      iso.replace('Z', '+00:00'),
      iso.replace(/\.\d{3}Z$/, 'Z'),
      iso.replace('Z', '.123456789Z'),
      iso.replace('Z', ''),
      iso.slice(0, 10),
      iso.replace('T', ' '),
      iso.toLowerCase(),
      iso.replace('Z', '+0500'),
      iso.replace('Z', '+24:00'),
      iso.replace('Z', '+05:60'),
      iso.replace(/T\d{2}/, 'T24'),
      iso.replace(/T\d{2}:\d{2}:\d{2}/, 'T23:59:60'),
      iso.replace(/-\d{2}T/, '-32T'),
      iso.replace(/-\d{2}-/, '-13-'),
      iso.replace(/-\d{2}T/, '-00T'),
      '0001-01-01T00:00:00Z',
      '1969-12-31T23:59:59Z',
      '1970-01-01T00:00:00Z',
      '2038-01-19T03:14:08Z',
      '9999-12-31T23:59:59Z',
      '+10000-01-01T00:00:00Z',
      '275760-09-13T00:00:00Z',
      '2026-02-29T00:00:00Z',
      '2024-02-29T00:00:00Z',
      '',
      'now',
      '0',
      '1761004800',
      `${iso}Z`,
      ` ${iso}`,
      `${iso} `,
    ]);
    s.container[s.key] = v;
    return `${fmtPath(s.path)} = ${JSON.stringify(v)}`;
  },
  oversized_string(doc) {
    const s = pick(slots(doc));
    if (!s) return null;
    const size = pick([65536, 1 << 20]);
    s.container[s.key] = pick(['A', 'é', '\u0000']).repeat(size);
    return `${fmtPath(s.path)} = <${size} chars>`;
  },
  deep_nesting(doc) {
    // ponytail: depth 100 stays inside every parser's limit (serde_json's
    // default is 128) so this exercises the verifiers, not the JSON parsers.
    const s = pick(slots(doc));
    if (!s) return null;
    let v = pick([null, 'leaf', 1]);
    for (let i = 0; i < 100; i++) v = rand() < 0.5 ? { n: v } : [v];
    s.container[s.key] = v;
    return `${fmtPath(s.path)} = <depth 100>`;
  },
  reorder_keys(doc) {
    const shuffle = (v) => {
      if (Array.isArray(v)) return v.map(shuffle);
      if (!isObj(v)) return v;
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      const out = {};
      for (const k of keys) out[k] = shuffle(v[k]);
      return out;
    };
    const shuffled = shuffle(doc);
    for (const k of Object.keys(doc)) delete doc[k];
    Object.assign(doc, shuffled);
    return '<all keys>';
  },
};
const MUTATOR_NAMES = Object.keys(mutators);

// ── Shims ──
const TMP = join(tmpdir(), 'dcp-difffuzz');
mkdirSync(TMP, { recursive: true });
function build() {
  const tsDist = join(ROOT, 'sdks/typescript/dist/index.js');
  if (!existsSync(tsDist))
    throw new Error(`${tsDist} not found: run "npm install && npm run build" in sdks/typescript`);
  const run = (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`);
  };
  const goBin = join(TMP, 'go-shim');
  run('go', ['build', '-o', goBin, '.'], join(HERE, 'shims/go'));
  run('cargo', ['build', '--release', '--quiet'], join(HERE, 'shims/rust'));
  return {
    ts: ['node', [join(HERE, 'shims/ts/verify.mjs')]],
    py: [opts.python, [join(HERE, 'shims/py/verify.py')]],
    go: [goBin, []],
    rust: [join(HERE, 'shims/rust/target/release/difffuzz-rust-shim'), []],
  };
}

// One long-lived shim process per (SDK, mode); restarted after a crash or
// timeout. verdict() resolves to {valid, errors} | {crash} | {timeout}.
class Shim {
  constructor(name, cmd, args, mode) {
    Object.assign(this, {
      name,
      cmd,
      args: [...args, ...(mode ? [mode] : []), '--loop'],
      proc: null,
    });
  }
  start() {
    this.proc = spawn(this.cmd, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.stderr = '';
    this.proc.stderr.on('data', (d) => (this.stderr = (this.stderr + d).slice(-4000)));
    this.lines = createInterface({ input: this.proc.stdout });
    this.exit = new Promise((res) => this.proc.on('exit', (code, signal) => res({ code, signal })));
  }
  verdict(text) {
    if (!this.proc) this.start();
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.lines.off('line', onLine);
        resolve(v);
      };
      const onLine = (line) => {
        try {
          finish(JSON.parse(line));
        } catch {
          finish({ crash: `unparseable verdict: ${line.slice(0, 200)}` });
        }
      };
      const timer = setTimeout(() => {
        this.kill();
        finish({ timeout: opts.timeout });
      }, opts.timeout);
      this.lines.on('line', onLine);
      this.exit.then(({ code, signal }) => {
        if (!done) {
          this.proc = null;
          // The message, not the stack frames.
          const message = this.stderr
            .split('\n')
            .filter((l) => l.trim() && !/^\s+at /.test(l))
            .slice(0, 6)
            .join(' | ');
          finish({ crash: `exit ${code ?? signal}: ${message}` });
        }
      });
      this.proc.stdin.write(text + '\n');
    });
  }
  kill() {
    if (this.proc) this.proc.kill('SIGKILL');
    this.proc = null;
  }
}

// ── Main ──
const seeds = loadSeeds();
if (!seeds.length) throw new Error('no V2 signed bundles found');
const cmds = build();
const shims = {};
for (const mode of MODES)
  shims[mode] = Object.fromEntries(
    Object.entries(cmds).map(([n, [c, a]]) => [n, new Shim(n, c, a, mode)]),
  );
mkdirSync(opts.out, { recursive: true });

const stats = {
  iterations: 0,
  verdicts: 0,
  agreements: 0,
  findings: 0,
  fromValid: 0,
  byMutator: {},
};
const modeName = (m) => m || 'default';

async function judge(mode, text) {
  const verdicts = Object.fromEntries(
    await Promise.all(
      Object.entries(shims[mode]).map(async ([n, s]) => [n, await s.verdict(text)]),
    ),
  );
  const valids = Object.values(verdicts).map((v) => v.valid);
  const broken = Object.values(verdicts).some((v) => 'crash' in v || 'timeout' in v);
  const agree = !broken && valids.every((v) => v === valids[0]);
  return { verdicts, agree, valid: agree ? valids[0] : undefined };
}
function record(file, finding) {
  stats.findings++;
  writeFileSync(join(opts.out, file), JSON.stringify(finding, null, 2) + '\n');
  const summary = Object.entries(finding.verdicts)
    .map(
      ([mode, vs]) =>
        `${mode}: ${Object.entries(vs)
          .map(([n, v]) => `${n}=${'crash' in v ? 'CRASH' : 'timeout' in v ? 'TIMEOUT' : v.valid}`)
          .join(' ')}`,
    )
    .join('; ');
  console.log(
    `FINDING ${file}: ${finding.mutations.map((m) => `${m.mutator}(${m.detail})`).join(' + ')} on ${finding.seed_name} -> ${summary}`,
  );
}

const started = Date.now();
// Baseline: every seed, unmutated, must get one verdict per mode.
const baseline = new Map();
for (const seed of seeds) {
  const text = serialize(seed.doc);
  const verdicts = {};
  for (const mode of MODES) {
    const j = await judge(mode, text);
    stats.verdicts++;
    if (j.agree) stats.agreements++;
    else verdicts[modeName(mode)] = j.verdicts;
    baseline.set(`${seed.name}|${mode}`, j.valid);
  }
  if (Object.keys(verdicts).length)
    record(`${opts.seed}-baseline-${seed.name.replace(/[^\w.-]+/g, '_')}.json`, {
      seed: opts.seed,
      iteration: 'baseline',
      seed_name: seed.name,
      mutations: [{ mutator: 'none', detail: '' }],
      verdicts,
      mutant_json: text,
    });
}
console.log(
  `seeds: ${seeds.length} (${seeds.map((s) => `${s.name}=${MODES.map((m) => baseline.get(`${s.name}|${m}`)).join('/')}`).join(', ')})`,
);

// Most seeds are must_reject bundles, which every SDK already rejects; only a
// baseline-valid seed can expose an accept/reject disagreement, so at least
// half of the iterations start from one.
const validSeeds = seeds.filter((s) => baseline.get(`${s.name}|${MODES[0]}`) === true);
for (let i = 1; i <= opts.iterations; i++) {
  stats.iterations++;
  const fromValid = validSeeds.length > 0 && rand() < 0.5;
  const seed = fromValid ? pick(validSeeds) : pick(seeds);
  if (baseline.get(`${seed.name}|${MODES[0]}`) === true) stats.fromValid++;
  const doc = clone(seed.doc);
  const mutations = [];
  const count = rand() < 0.7 ? 1 : 2;
  for (let tries = 0; mutations.length < count && tries < 20; tries++) {
    const name = pick(MUTATOR_NAMES);
    const detail = mutators[name](doc);
    if (detail !== null) mutations.push({ mutator: name, detail });
  }
  if (!mutations.length) mutations.push({ mutator: 'none', detail: 'no eligible slot' });
  const onlyReorder = mutations.every((m) => m.mutator === 'reorder_keys');
  const text = serialize(doc);
  const verdicts = {};
  for (const mode of MODES) {
    const j = await judge(mode, text);
    stats.verdicts++;
    const expected = baseline.get(`${seed.name}|${mode}`);
    // Reordering keys must never change a verdict.
    if (j.agree && !(onlyReorder && expected !== undefined && j.valid !== expected))
      stats.agreements++;
    else
      verdicts[modeName(mode)] =
        onlyReorder && j.agree
          ? { ...j.verdicts, expected_from_seed: { valid: expected } }
          : j.verdicts;
  }
  for (const m of mutations) stats.byMutator[m.mutator] = (stats.byMutator[m.mutator] || 0) + 1;
  if (Object.keys(verdicts).length)
    record(`${opts.seed}-${i}.json`, {
      seed: opts.seed,
      iteration: i,
      seed_name: seed.name,
      mutations,
      verdicts,
      mutant_json: text,
    });
  if (i % 100 === 0)
    console.log(
      `${i}/${opts.iterations} iterations, ${stats.findings} findings, ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
}

for (const mode of MODES) for (const s of Object.values(shims[mode])) s.kill();
console.log(
  `\nseed ${opts.seed}: ${stats.iterations} iterations x ${MODES.length} modes = ${stats.verdicts} verdicts (incl. ${seeds.length * MODES.length} baselines), ${stats.agreements} agreements, ${stats.findings} findings, ${stats.fromValid}/${stats.iterations} iterations from a baseline-valid seed (${validSeeds.length}/${seeds.length} seeds), ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
console.log(
  `mutations: ${Object.entries(stats.byMutator)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')}`,
);
process.exit(stats.findings ? 1 : 0);
