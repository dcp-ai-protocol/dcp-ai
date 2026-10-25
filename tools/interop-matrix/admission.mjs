// Interop matrix, scenario 2: admission (spec/profiles/admission/README.md).
//
// Every SDK agent produces hybrid evidence whose manifest signs a session window and an
// audience; every SDK agent admits it with its combined admission API under strict-v1, an
// explicit trust set per tenant and a fresh local revocation snapshot, at a fixed clock. The
// expected result of every case is written here from the spec, never taken from an SDK.
// Design and agent protocol in README.md.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Agent, HERE, ROOT, launchers } from './agents.mjs';

const SDKS = ['ts', 'py', 'go', 'rust'];
// The case whose expectation the negative control makes wrong, and how long that run may take.
const NEGATIVE_CONTROL_CASE = 'trust_withdrawn';
const NEGATIVE_CONTROL_TIMEOUT_MS = 120_000;
const opts = {
  agents: SDKS, python: process.env.INTEROP_PYTHON || 'python3', timeout: 60000,
  out: join(HERE, 'out/admission'), negativeControl: null, skipNegativeControl: false,
  replay: null, checkNegativeControl: false, runId: randomUUID(),
};
for (let i = 2; i < process.argv.length; i++) {
  const [flag, value] = [process.argv[i], process.argv[i + 1]];
  if (flag === '--negative-control') opts.negativeControl = NEGATIVE_CONTROL_CASE;
  else if (flag === '--skip-negative-control') opts.skipNegativeControl = true;
  else if (flag === '--check-negative-control') opts.checkNegativeControl = true;
  else {
    if (flag === '--agents') opts.agents = value.split(',');
    else if (flag === '--python') opts.python = value;
    else if (flag === '--timeout') opts.timeout = Number(value);
    else if (flag === '--out') opts.out = resolve(value);
    else if (flag === '--replay') opts.replay = resolve(value);
    else if (flag === '--run-id') opts.runId = value;
    // A testing aid: make the expectation of another case wrong (implies --negative-control).
    else if (flag === '--negative-control-case') opts.negativeControl = value;
    else throw new Error(`unknown option ${flag}`);
    i++;
  }
}
for (const a of opts.agents) if (!SDKS.includes(a)) throw new Error(`unknown agent ${a} (known: ${SDKS.join(', ')})`);

// ── Operator data: clock, profile, trust and revocation (spec §2) ──

const VERIFIER_ID = 'verifier:interop-admission';
const OTHER_VERIFIER_ID = 'verifier:someone-else';
const PROFILE = { profile: 'strict-v1', verifier_id: VERIFIER_ID };
const POLICY_HASH = `sha256:${createHash('sha256').update('dcp-interop-matrix admission policy v1').digest('hex')}`;
const iso = (ms) => new Date(ms).toISOString();
// The signed session window is the profile's maximum, 300 s. Every admission runs at the fixed
// instant NOW inside it; the expiry case 1 ms after it (§4.2 P3). A fresh snapshot is 10 s old.
const T0 = Math.floor(Date.now() / 1000) * 1000;
const WINDOW = { session_issued_at: iso(T0), session_expires_at: iso(T0 + 300_000) };
const NOW = T0 + 120_000;
const EXPIRED_NOW = T0 + 300_001;
const FRESH_AGE_MS = 10_000;

// The trust set is enrolled out of band: built from the public keys each producer reported when
// it created or rotated its principal, never from a bundle under admission (§2.2).
const withStatus = (keys, status) => keys.map((k) => ({ ...k, status }));
const principalEntry = (e, keys = withStatus(e.principal_keys, 'active')) => ({ human_id: e.human_id, keys });
const trustSet = (version, principals) => ({ trust_set_version: version, principals });

// The revocation source of the harness: statuses of the producer's agent and of all its keys.
function snapshot(e, now, revokedKid = null) {
  const kids = [...e.principal_keys, ...e.rotated_principal_keys, ...e.agent_keys].map((k) => k.kid);
  return {
    checked_at: iso(now - FRESH_AGE_MS),
    agents: { [e.agent_id]: 'not_revoked' },
    keys: Object.fromEntries(kids.map((kid) => [kid, kid === revokedKid ? 'revoked' : 'not_revoked'])),
  };
}

// §5.2: the expected result, field by field. `codes` is the set of §5.3 codes.
function expected({ verified, trust, compliance, codes, version }) {
  return {
    verified,
    principal_trust: verified ? trust : 'not_evaluated',
    profile: 'strict-v1',
    profile_compliance: compliance,
    admitted: verified && trust === 'trusted' && compliance === 'compliant',
    action_authorized: false,
    recorded_decision: verified ? 'approve' : null,
    trust_set_version: version,
    codes: [...codes].sort(),
  };
}
const FIELDS = Object.keys(expected({ verified: true, trust: 'trusted', compliance: 'compliant', codes: [], version: '' }));

function normalize(result) {
  const out = {};
  for (const f of FIELDS) {
    if (f === 'codes') {
      out.codes = Array.isArray(result.errors) ? [...new Set(result.errors.map((e) => e?.code))].sort() : '(errors missing)';
    } else {
      out[f] = Object.hasOwn(result, f) ? result[f] : '(field missing)';
    }
  }
  return out;
}

// ── Production ──

async function produce(agent, name) {
  const id = await agent.call('identity', { owner_name: `Admission Owner (${name})`, jurisdiction: 'CL' });
  const it = await agent.call('intent', {
    action_type: 'api_call', channel: 'api', data_classes: ['none'], estimated_impact: 'low', risk_score: 100, applied_policy_hash: POLICY_HASH,
  });
  await agent.call('act', { intent_id: it.intent_id, outcome: 'call completed', tool: 'weather.lookup', result_ref: 'result-1' });
  const bundle = async (audience) =>
    (await agent.call('bundle', { intent_id: it.intent_id, ...WINDOW, intended_verifier: audience })).signed_bundle;
  const out = { enrollment: id, bundle: await bundle(VERIFIER_ID), otherAudience: await bundle(OTHER_VERIFIER_ID) };
  // Rotation (§2.2): a new principal key pair, reported out of band like the first one.
  const rotation = await agent.call('rotate_principal');
  if (rotation.human_id !== id.human_id || !Array.isArray(rotation.principal_keys) || rotation.principal_keys.length !== 2) {
    throw new Error(`${name}: rotate_principal must keep the human_id and report two new principal keys`);
  }
  out.enrollment = { ...id, rotated_principal_keys: rotation.principal_keys };
  out.rotated = await bundle(VERIFIER_ID);
  for (const [doc, audience] of [[out.bundle, VERIFIER_ID], [out.otherAudience, OTHER_VERIFIER_ID], [out.rotated, VERIFIER_ID]]) {
    const m = doc?.bundle?.manifest ?? {};
    const want = { ...WINDOW, intended_verifier: audience };
    for (const [k, v] of Object.entries(want)) {
      if (m[k] !== v) throw new Error(`${name}: signed manifest ${k} is ${JSON.stringify(m[k])}, not ${v}`);
    }
  }
  if (!Array.isArray(id.principal_keys) || id.principal_keys.length !== 2 || !Array.isArray(id.agent_keys) || id.agent_keys.length !== 2) {
    throw new Error(`${name}: identity must report two principal and two agent public keys`);
  }
  return out;
}

// ── Cases, in the order one consumer process runs them for one producer ──

function cases(p, enrolled, produced) {
  const e = enrolled[p];
  const others = Object.entries(enrolled).filter(([n]) => n !== p).map(([, o]) => principalEntry(o));
  const all = [principalEntry(e), ...others];
  const overlap = [principalEntry(e, [...withStatus(e.principal_keys, 'active'), ...withStatus(e.rotated_principal_keys, 'active')]), ...others];
  const retired = [principalEntry(e, [...withStatus(e.principal_keys, 'revoked'), ...withStatus(e.rotated_principal_keys, 'active')]), ...others];
  const v = (step) => `tenant-a.${p}.${step}`;
  const trusted = (version) => ({ verified: true, trust: 'trusted', compliance: 'compliant', codes: [], version });
  const unknown = (version) => ({ verified: true, trust: 'untrusted', compliance: 'compliant', codes: ['TRUST_PRINCIPAL_UNKNOWN'], version });
  const revoked = { verified: true, trust: 'trusted', compliance: 'non_compliant', codes: ['REVOCATION_REVOKED'], version: v('3-restored') };
  const list = [
    { name: 'trusted_admitted', rule: '§5.2 admitted', configure: ['A', trustSet(v('1'), all)], expect: trusted(v('1')) },
    { name: 'trust_withdrawn', rule: '§3 T1, same bundle', configure: ['A', trustSet(v('2-withdrawn'), others)], expect: unknown(v('2-withdrawn')) },
    { name: 'trust_restored', rule: '§5.2 admitted, same bundle', configure: ['A', trustSet(v('3-restored'), all)], expect: trusted(v('3-restored')) },
    { name: 'tenant_b_empty_trust', rule: '§3 T1, tenant B', tenant: 'B', expect: unknown('tenant-b.1') },
    { name: 'principal_key_revoked', rule: '§4.3 R4', revokedKid: e.principal_keys[0].kid, expect: revoked },
    { name: 'agent_key_revoked', rule: '§4.3 R4', revokedKid: e.agent_keys[1].kid, expect: revoked },
    {
      name: 'other_audience', rule: '§4.2 P2, §5.1 step 2', doc: produced[p].otherAudience,
      expect: { verified: false, compliance: 'non_compliant', codes: ['PROFILE_AUDIENCE_MISMATCH', 'VERIFICATION_FAILED'], version: v('3-restored') },
    },
    {
      name: 'session_expired', rule: '§4.2 P3, §5.1 step 2', now: EXPIRED_NOW,
      expect: { verified: false, compliance: 'non_compliant', codes: ['PROFILE_SESSION_EXPIRED', 'VERIFICATION_FAILED'], version: v('3-restored') },
    },
    // Rotation (§2.2): the operator adds the new keys, keeps the old ones for an overlap, retires them.
    {
      name: 'rotation_new_keys_not_enrolled', rule: '§3 T2, §2.2 rotation', doc: produced[p].rotated,
      expect: { verified: true, trust: 'untrusted', compliance: 'compliant', codes: ['TRUST_KEY_NOT_ANCHORED'], version: v('3-restored') },
    },
    { name: 'rotation_overlap_new_keys', rule: '§2.2 rotation overlap', configure: ['A', trustSet(v('4-overlap'), overlap)], doc: produced[p].rotated, expect: trusted(v('4-overlap')) },
    { name: 'rotation_overlap_old_keys', rule: '§2.2 rotation overlap', expect: trusted(v('4-overlap')) },
    {
      name: 'rotation_old_keys_retired', rule: '§3 T2, §2.2 rotation', configure: ['A', trustSet(v('5-retired'), retired)],
      expect: { verified: true, trust: 'untrusted', compliance: 'compliant', codes: ['TRUST_KEY_REVOKED'], version: v('5-retired') },
    },
    { name: 'rotation_new_keys_after_retirement', rule: '§2.2 rotation', doc: produced[p].rotated, expect: trusted(v('5-retired')) },
  ];
  const out = list.map((c) => ({
    tenant: 'A', doc: produced[p].bundle, now: NOW, ...c,
    revocation: snapshot(e, c.now ?? NOW, c.revokedKid ?? null),
    expect: expected({ trust: 'not_evaluated', ...c.expect }),
  }));
  if (opts.negativeControl) {
    // A wrong expectation on purpose: only `admitted` is inverted, so the runner must report
    // exactly that field of exactly that case and exit non-zero.
    const k = out.find((c) => c.name === opts.negativeControl);
    if (!k) throw new Error(`unknown case ${opts.negativeControl}`);
    k.expect.admitted = !k.expect.admitted;
    k.rule += ' [NEGATIVE CONTROL: admitted deliberately inverted]';
  }
  return out;
}

// ── Run ──

function sha256File(path) {
  return createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');
}
const SOURCES = [
  'spec/profiles/admission/README.md',
  'tests/interop/v2/admission_vectors.json',
  'sdks/typescript/src/core/admission.ts', 'sdks/typescript/src/core/verify-v2.ts', 'sdks/typescript/dist/index.js',
  'sdks/python/dcp_ai/v2/admission.py', 'sdks/python/dcp_ai/v2/verify.py',
  'sdks/go/dcp/v2/admission.go', 'sdks/go/dcp/v2/verify_bundle.go',
  'sdks/rust/src/v2/admission.rs', 'sdks/rust/src/v2/verify_bundle.rs',
  'tools/interop-matrix/admission.mjs', 'tools/interop-matrix/agents.mjs',
  'tools/interop-matrix/agents/ts/agent.mjs', 'tools/interop-matrix/agents/py/agent.py',
  'tools/interop-matrix/agents/go/main.go', 'tools/interop-matrix/agents/rust/src/main.rs',
];
function version(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || r.stderr).trim().split('\n')[0] : `unavailable (${cmd})`;
}

// Runs the runner itself with one wrong expectation and requires it to fail exactly there. The
// child's report must be the one it wrote in this run (its run id), so a child that cannot start
// is never mistaken for a correct control by a report left by an earlier run.
function runNegativeControl({ script = join(HERE, 'admission.mjs'), dir = mkdtempSync(join(tmpdir(), 'dcp-admission-negative-')), timeoutMs = NEGATIVE_CONTROL_TIMEOUT_MS } = {}) {
  const runId = randomUUID();
  const r = spawnSync(process.execPath, [
    script, '--negative-control', '--agents', 'ts', '--python', opts.python, '--out', dir, '--run-id', runId,
  ], { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' });
  let report = null;
  try {
    report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  } catch {
    // no report: the checks below fail
  }
  const failures = report?.failures ?? [];
  const f = failures[0] ?? {};
  const results = report?.results ?? [];
  const cellKeys = Object.keys(report?.cells ?? {});
  const checks = {
    exit_code_1: r.status === 1,
    finished_in_time: r.error === undefined,
    report_from_this_run: report?.run_id === runId,
    negative_control_run: report?.negative_control_run === true,
    negative_control_case: report?.negative_control_case === NEGATIVE_CONTROL_CASE,
    only_ts_ts_pair: cellKeys.length === 1 && cellKeys[0] === 'ts>ts' && report.cells['ts>ts'].total === 13 && report.cells['ts>ts'].pass === 12,
    twelve_of_13_results_pass: results.length === 13 && results.filter((x) => x.pass).length === 12,
    one_failure_admitted_of_case: failures.length === 1 && f.producer === 'ts' && f.consumer === 'ts' && f.case === NEGATIVE_CONTROL_CASE
      && JSON.stringify(f.mismatched) === '["admitted"]',
  };
  return {
    command: `node ${script} --negative-control --agents ts --out <new temporary directory> --run-id <uuid>`,
    report_dir: dir, run_id: runId, exit_code: r.status, signal: r.signal, spawn_error: r.error?.code ?? null,
    checks, runner_failed_as_required: Object.values(checks).every(Boolean),
  };
}

// --check-negative-control: the control must accept a correct run and refuse a child that cannot
// start, both with no report and with a report left in its directory by an earlier run, and a
// child that hangs, which it stops at the time limit.
function checkNegativeControl() {
  const normal = runNegativeControl();
  const missing = join(HERE, 'no-such-runner.mjs');
  const noReport = runNegativeControl({ script: missing });
  const staleDir = mkdtempSync(join(tmpdir(), 'dcp-admission-stale-'));
  cpSync(join(normal.report_dir, 'report.json'), join(staleDir, 'report.json'));
  const stale = runNegativeControl({ script: missing, dir: staleDir });
  const hangDir = mkdtempSync(join(tmpdir(), 'dcp-admission-hang-'));
  writeFileSync(join(hangDir, 'hang.mjs'), 'setInterval(() => {}, 1 << 30);\n');
  const hangStarted = Date.now();
  const hung = runNegativeControl({ script: join(hangDir, 'hang.mjs'), timeoutMs: 3000 });
  hung.elapsed_ms = Date.now() - hangStarted;
  const outcome = {
    normal_run_accepted: normal.runner_failed_as_required,
    startup_failure_without_report_refused: !noReport.runner_failed_as_required && noReport.exit_code === 1,
    startup_failure_with_stale_report_refused: !stale.runner_failed_as_required && stale.exit_code === 1,
    hung_child_stopped_and_refused: !hung.runner_failed_as_required && hung.spawn_error === 'ETIMEDOUT' && hung.elapsed_ms < 10_000,
  };
  console.log(JSON.stringify({ outcome, normal, startup_failure_without_report: noReport, startup_failure_with_stale_report: stale, hung_child: hung }, null, 2));
  const ok = Object.values(outcome).every(Boolean);
  console.log(ok ? 'NEGATIVE CONTROL CHECK PASS' : 'NEGATIVE CONTROL CHECK FAIL');
  process.exit(ok ? 0 : 1);
}

// --replay FILE: one recorded admission, run again in a fresh consumer (no identity, no private
// keys) with the configuration the failure recorded; it must give exactly the recorded output.
async function replay(file) {
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  for (const f of ['consumer', 'tenant', 'trust_set', 'profile', 'signed_bundle', 'now_ms', 'observed']) {
    if (rec[f] === undefined || rec[f] === null) {
      console.log(`REPLAY INCOMPLETE: ${f} missing in ${file}`);
      process.exit(2);
    }
  }
  const cmds = launchers([rec.consumer], opts.python);
  const agent = new Agent(rec.consumer, ...cmds[rec.consumer], opts.timeout);
  let observed;
  try {
    const conf = await agent.call('configure', { tenant: rec.tenant, trust_set: rec.trust_set, profile: rec.profile });
    if (conf.config_error) throw new Error(`configure: ${conf.config_error}`);
    const raw = await agent.call('admit', { tenant: rec.tenant, signed_bundle: rec.signed_bundle, revocation: rec.revocation, now_ms: rec.now_ms });
    observed = { ...normalize(raw), verification_errors: raw.verification_errors };
  } catch (e) {
    observed = { error: e.message };
  } finally {
    await agent.stop();
  }
  // Every key of either side, `error` included: a key present on one side only is a difference,
  // so two different errors, or an error against a result, never count as a reproduction.
  const compared = [...new Set([...Object.keys(rec.observed), ...Object.keys(observed)])].sort();
  const same = (f) => Object.hasOwn(observed, f) === Object.hasOwn(rec.observed, f) && JSON.stringify(observed[f]) === JSON.stringify(rec.observed[f]);
  const differs = compared.filter((f) => !same(f));
  console.log(JSON.stringify({ file, consumer: rec.consumer, case: rec.case, compared, recorded: rec.observed, replayed: observed, differs }, null, 2));
  console.log(differs.length === 0 ? 'REPLAY REPRODUCED the recorded result exactly' : `REPLAY DIFFERS in ${differs.join(', ')}`);
  process.exit(differs.length === 0 ? 0 : 1);
}

async function main() {
  const names = opts.agents;
  const cmds = launchers(names, opts.python);
  const agents = Object.fromEntries(Object.entries(cmds).map(([n, [c, a]]) => [n, new Agent(n, c, a, opts.timeout)]));
  mkdirSync(opts.out, { recursive: true });
  const failures = [];
  const results = [];
  const cells = {};
  const started = Date.now();
  try {
    const produced = {};
    for (const p of names) {
      try {
        produced[p] = await produce(agents[p], p);
      } catch (e) {
        failures.push({ producer: p, case: 'produce', error: e.message });
      }
    }
    // Key and RPR timestamps are the producers' real clock: they must precede the fixed NOW.
    if (Date.now() >= NOW - 5000) throw new Error('production took too long for the fixed clock; rerun on a less loaded machine');
    const producers = names.filter((p) => produced[p]);
    const enrolled = Object.fromEntries(producers.map((p) => [p, produced[p].enrollment]));
    for (const c of names) {
      // The configuration each tenant of this consumer has loaded last, whichever case loaded it.
      const effective = {};
      const config = async (tenant, trust, loadedIn) => {
        const r = await agents[c].call('configure', { tenant, trust_set: trust, profile: PROFILE });
        if (r.config_error) throw new Error(`${c}.configure ${tenant}: ${r.config_error}`);
        effective[tenant] = { trust_set: trust, profile: PROFILE, loaded_in: loadedIn };
      };
      try {
        await config('B', trustSet('tenant-b.1', []), 'setup');
      } catch (e) {
        failures.push({ consumer: c, case: 'configure tenant B', error: e.message });
        continue;
      }
      for (const p of producers) {
        const cell = (cells[`${p}>${c}`] = { pass: 0, total: 0 });
        for (const k of cases(p, enrolled, produced)) {
          cell.total++;
          let observed;
          try {
            if (k.configure) await config(...k.configure, `${p} ${k.name}`);
            const raw = await agents[c].call('admit', { tenant: k.tenant, signed_bundle: k.doc, revocation: k.revocation, now_ms: k.now });
            observed = normalize(raw);
            observed.verification_errors = raw.verification_errors;
          } catch (e) {
            observed = { error: e.message };
          }
          const mismatched = FIELDS.filter((f) => JSON.stringify(observed[f]) !== JSON.stringify(k.expect[f]));
          const pass = mismatched.length === 0;
          results.push({ producer: p, consumer: c, case: k.name, rule: k.rule, tenant: k.tenant, now: iso(k.now), pass, expected: k.expect, observed });
          if (pass) {
            cell.pass++;
            continue;
          }
          // Minimal reproduction: everything the consumer was given for this one admission, with the
          // tenant's effective configuration even when an earlier case loaded it. `--replay` runs it.
          const file = join(opts.out, `${p}-${c}-${k.name}.json`);
          const conf = effective[k.tenant] ?? {};
          writeFileSync(file, JSON.stringify({
            producer: p, consumer: c, case: k.name, rule: k.rule, now_ms: k.now, tenant: k.tenant,
            profile: conf.profile ?? null, trust_set: conf.trust_set ?? null, configuration_loaded_in: conf.loaded_in ?? null,
            revocation: k.revocation, expected: k.expect, observed, mismatched, signed_bundle: k.doc,
          }, null, 2));
          failures.push({ producer: p, consumer: c, case: k.name, mismatched, expected: k.expect, observed, file });
        }
      }
    }
  } finally {
    await Promise.all(Object.values(agents).map((a) => a.stop()));
  }

  const negative_control = opts.negativeControl || opts.skipNegativeControl ? null : runNegativeControl();
  if (negative_control && !negative_control.runner_failed_as_required) {
    failures.push({ case: 'negative_control', error: `the runner did not fail on a wrong expectation: ${JSON.stringify(negative_control)}` });
  }
  const report = {
    scenario: 'admission (spec/profiles/admission)',
    run_id: opts.runId,
    negative_control_run: opts.negativeControl !== null,
    negative_control_case: opts.negativeControl,
    base_commit: version('git', ['-C', ROOT, 'rev-parse', 'HEAD']),
    environment: {
      node: process.version, python: version(opts.python, ['--version']), go: version('go', ['version']), rustc: version('rustc', ['--version']),
    },
    clock: { t0: iso(T0), now: iso(NOW), expired_now: iso(EXPIRED_NOW), revocation_age_ms: FRESH_AGE_MS, signed_window: WINDOW },
    profile: PROFILE, other_verifier_id: OTHER_VERIFIER_ID,
    agents: names, cells, failures, negative_control, results,
    sources_sha256: Object.fromEntries(SOURCES.map((s) => [s, sha256File(s)])),
    seconds: (Date.now() - started) / 1000,
  };
  writeFileSync(join(opts.out, 'report.json'), JSON.stringify(report, null, 2));

  const pad = (s, n) => String(s).padEnd(n);
  const lines = [`producer \\ consumer  ${names.map((n) => pad(n, 12)).join('')}`];
  for (const p of names) {
    lines.push(`${pad(p, 21)}${names.map((c) => {
      const cell = cells[`${p}>${c}`];
      return pad(cell ? `${cell.pass === cell.total ? 'ok' : 'FAIL'} ${cell.pass}/${cell.total}` : 'none', 12);
    }).join('')}`);
  }
  const perPair = results.length / Math.max(1, Object.keys(cells).length);
  console.log(`\nScenario 2 (admission, strict-v1): ${perPair} cases per pair\n`);
  console.log(lines.join('\n'));
  if (negative_control) console.log(`\nnegative control: exit ${negative_control.exit_code}, ${negative_control.runner_failed_as_required ? 'failed as required' : 'DID NOT FAIL AS REQUIRED'}`);
  for (const f of failures) {
    console.log(`\nFAIL ${f.producer ?? ''}${f.consumer ? ` > ${f.consumer}` : ''} ${f.case}: ${f.error ?? `fields ${f.mismatched.join(', ')}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.observed).slice(0, 600)}`}`);
  }
  console.log(`\n${failures.length === 0 ? 'ADMISSION MATRIX PASS' : `ADMISSION MATRIX FAIL: ${failures.length} unexpected results`} (${report.seconds.toFixed(1)} s, report in ${join(opts.out, 'report.json')})`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const entry = opts.checkNegativeControl ? Promise.resolve(checkNegativeControl()) : opts.replay ? replay(opts.replay) : main();
entry.catch((e) => {
  console.error(e);
  process.exit(2);
});
