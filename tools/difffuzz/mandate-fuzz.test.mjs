// Self-tests of the mandate chain differential harness (tools/difffuzz/mandate-fuzz.mjs, format dcp-mandatefuzz/1). The
// implementations are synthetic: a child process that answers contract /4 from the expectations the plan carries (no SDK,
// no wrapper), altered by mode. They test the harness, its controls and its replay; they say nothing of any SDK.
//
//   node --test tools/difffuzz/mandate-fuzz.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS, SDKS, VARIANTS, buildCase, buildWrappers, canon, canonicalInteger, checkFinding, controlsOf, decodeInput, inputHash,
  normativeSignatures, parseArgs, planCases, replayFinding, runCampaign, signerSelfCheck, sweepSize, transportProbe,
} from './mandate-fuzz.mjs';
import { canon as boundaryCanon } from '../conformance/schema-boundary.js';
import { makeRng } from './fuzz.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-mandatefuzz-test-'));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const quiet = () => {};
let n = 0;

// The synthetic implementation: honest answers from the table (expectations of the plan), a fallback for inputs not in
// it (accept, with the greatest tier of the chain), then the alterations of the mode.
const FAKE = path.join(TMP, 'fake.mjs');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
import crypto from 'node:crypto';
const [tableFile, sdk, modeJson] = process.argv.slice(2);
const mode = JSON.parse(modeJson);
const table = JSON.parse(fs.readFileSync(tableFile, 'utf8'));
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
const TIERS = ['routine', 'standard', 'elevated', 'maximum'];
const mine = (x) => x === true || (Array.isArray(x) && x.includes(sdk));
if (mine(mode.crash_on_start)) process.exit(1);
if (mine(mode.sleep)) { setTimeout(() => {}, 60000); } else {
const ok = (valid, tier) => ({ status: 'ok', valid, errors: valid ? [] : ['synthetic rejection'], effective_tier: valid ? tier : null, depth: 0 });
const results = [];
for (const c of req.cases) {
  const key = crypto.createHash('sha256').update(JSON.stringify([c.chain_b64, c.keys_b64, c.revoked_mandate_ids, c.verification_time])).digest('hex');
  const e = table[key];
  const text = Buffer.from(c.chain_b64, 'base64').toString('utf8');
  let chain;
  try { chain = JSON.parse(text); } catch { process.stderr.write('synthetic wrapper: chain is not JSON'); process.exit(2); }
  const maxTier = chain.map((m) => m.minimum_security_tier).filter((t) => TIERS.includes(t)).sort((a, b) => TIERS.indexOf(b) - TIERS.indexOf(a))[0] ?? null;
  let a = e?.expect ? (e.expect.valid ? ok(true, e.expect.effective_tier) : ok(false)) : ok(true, maxTier);
  if (mine(mode.accept_all)) a = ok(true, maxTier);
  if (e && mode.flip?.[e.variant] && mine(mode.flip[e.variant])) a = a.valid ? ok(false) : ok(true, maxTier);
  if (mode.reject_text && mine(mode.reject_text.sdks) && text.includes(mode.reject_text.text)) a = ok(false);
  if (e && mode.tier && e.variant === mode.tier.variant && mine(mode.tier.sdks)) a = ok(true, 'routine');
  if (e && mode.status?.[e.variant] && mine(mode.status[e.variant].sdks)) a = mode.status[e.variant].answer;
  results.push({ id: c.id, ...a });
}
const doc = { contract: req.contract, run_id: req.run_id, nonce: req.nonce, implementation: { name: 'synthetic', version: '0' }, results };
const fault = mine(mode.fault?.sdks) && (mode.fault.when === 'always' || req.cases.length > 1) ? mode.fault.kind : null;
if (fault === 'missing') results.pop();
if (fault === 'duplicate') results.push(results[0]);
if (fault === 'extra') results.push({ ...results[0], id: 'not-sent' });
if (fault === 'stale') doc.run_id = '00000000-0000-4000-8000-000000000000';
if (fault === 'malformed') results[0].depth = -1;
if (fault === 'overflow') process.stdout.write('x'.repeat(200000));
else process.stdout.write(JSON.stringify(doc));
if (fault === 'exit1') process.exitCode = 1;
}
`);

/** The plan of `o` (controls included) as a table of expectations, keyed like the fake keys each request case. */
function tableFor(o) {
  const t = {};
  const add = (k) => { t[inputHash({ chain_b64: Buffer.from(k.chain_text).toString('base64'), keys_b64: Buffer.from(k.keys_text).toString('base64'), revoked_mandate_ids: k.revoked, verification_time: k.verification_time })] = { variant: k.variant, expect: k.expect }; };
  for (const k of planCases(o)) add(k);
  for (const d of [0, 1, 2]) for (const k of controlsOf(d)) add(k);
  const file = path.join(TMP, `table-${++n}.json`);
  fs.writeFileSync(file, JSON.stringify(t));
  return file;
}
const commands = (table, mode = {}) => Object.fromEntries(SDKS.map((s) => [s, [process.execPath, FAKE, table, s, JSON.stringify(mode)]]));
const opts = (over = {}) => ({ ...parseArgs(['--iterations', '0', '--batch-cases', '256', '--seed', 'self-test']), out: path.join(TMP, `findings-${++n}`), ...over });
const run = (o, mode, table = tableFor(o)) => runCampaign(o, { commands: commands(table, mode), log: quiet });
const sweepNames = (pred) => VARIANTS.flatMap((v) => (pred(v) ? [0, 1, 2].filter((d) => d >= v.minDepth).map(() => v.variant) : [])).sort();
const findingVariants = (r) => r.findings.filter((f) => f.kind === 'mutant').map((f) => f.variant).sort();
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : []);

// ── Construction ──

test('signer: the committed corpus verifies with this construction, and ML-DSA-65 with extraEntropy: false is deterministic', () => {
  const r = signerSelfCheck();
  assert.ok(r.committed_signatures_verified >= 10);
  assert.equal(r.ml_dsa_deterministic, true);
  assert.equal(r.ml_dsa_default_hedged, true);
});

test('dcp-jcs-v1: exact integers from raw tokens; fractions and overflowing literals have no form; equal to the corpus canonicalizer on safe values', () => {
  assert.deepEqual(['1.0', '5e1', '-0', '9007199254740992', '9007199254740993', '-9007199254740992'].map(canonicalInteger), ['1', '50', '0', '9007199254740992', '9007199254740993', '-9007199254740992']);
  for (const t of ['0.5', '1e400', 'NaN', '01']) assert.throws(() => canonicalInteger(t), t);
  for (const d of [0, 1, 2]) for (const k of controlsOf(d)) assert.equal(canon(k.semantic), boundaryCanon(k.semantic));
});

test('every variant at every depth carries the signatures its category states, and the sweep covers each exactly once', () => {
  const rng = makeRng('self-test');
  let count = 0;
  for (const v of VARIANTS) for (let d = v.minDepth; d <= 2; d++) {
    const k = buildCase(v, d, rng);
    count++;
    if (k.signing === 'resigned' || k.signing === 'none') assert.equal(k.check.normative, true, `${v.variant}@${d}`);
    if (k.signing === 'deliberate') assert.equal(k.check.deliberate.verifies_as_built, true, `${v.variant}@${d}`);
    if (k.signing === 'stale') assert.equal(k.check.stale.still_verifies, false, `${v.variant}@${d}`);
  }
  assert.equal(count, sweepSize());
  const plan = [...planCases({ seed: 's', iterations: 5 })];
  assert.equal(plan.length, sweepSize() + 5);
  assert.deepEqual(plan.filter((k) => k.sweep).map((k) => `${k.variant}@${k.depth}`).sort(), VARIANTS.flatMap((v) => [0, 1, 2].filter((d) => d >= v.minDepth).map((d) => `${v.variant}@${d}`)).sort());
  for (const d of [0, 1, 2]) assert.ok(normativeSignatures(controlsOf(d)[0].semantic, JSON.parse(controlsOf(d)[0].keys_text)));
});

// ── Campaigns against synthetic implementations ──

test('an honest implementation passes: the whole sweep, every control, zero random mutants included', async () => {
  const r = await run(opts(), {});
  assert.equal(r.exit, 0, JSON.stringify(r.error ?? r.coverage));
  assert.equal(r.sdk_campaign, false);
  assert.deepEqual(r.coverage, { sweep_required: sweepSize(), sweep_executed: sweepSize(), random_requested: 0, random_executed: 0, variants_exercised: VARIANTS.length, variants_defined: VARIANTS.length, complete: true });
  assert.equal(r.stats.controls.failed, 0);
  assert.ok(r.stats.evidence.rule_evidence > 100 && r.stats.evidence.agreement_without_expectation > 0 && r.stats.evidence.agreement_limited_attribution > 0);
});

test('commands that cannot start are an infrastructure error, even with zero random mutants', async () => {
  const bad = Object.fromEntries(SDKS.map((s) => [s, [path.join(TMP, 'no-such-wrapper')]]));
  const r = await runCampaign(opts(), { commands: bad, log: quiet });
  assert.equal(r.exit, 3);
  assert.match(r.error.message, /cannot start/);
  const three = Object.fromEntries(SDKS.slice(0, 3).map((s) => [s, bad[s]]));
  assert.equal((await runCampaign(opts(), { commands: three, log: quiet })).exit, 3);
});

test('accepting every chain fails the stale controls: no mutant is judged without its controls, and nothing is covered', async () => {
  const r = await run(opts(), { accept_all: true });
  assert.equal(r.exit, 1);
  assert.equal(r.stats.controls.failed, 3);
  assert.deepEqual(r.findings.map((f) => f.variant).sort(), ['stale_signature_depth_0', 'stale_signature_depth_1', 'stale_signature_depth_2']);
  assert.equal(r.coverage.sweep_executed, 0);
  assert.equal(r.coverage.complete, false);
});

test('one SDK that flips one variant gives a disagreement on exactly those cases; the three others answer completely', async () => {
  const r = await run(opts(), { flip: { action_added: ['py'] } });
  assert.equal(r.exit, 1);
  assert.deepEqual(findingVariants(r), sweepNames((v) => v.variant === 'action_added'));
  for (const f of r.findings) {
    assert.deepEqual(f.classes, ['disagreement']);
    assert.equal(f.decisions.py, 'accept:' + (f.depth === 1 ? 'elevated' : 'maximum'));
    for (const s of ['ts', 'go', 'rust']) assert.equal(f.decisions[s], 'reject');
  }
  assert.equal(r.stats.batch_failures, 0);
});

test('four SDKs that agree against an anchored expectation give an expectation finding; agreement is never the oracle', async () => {
  const r = await run(opts(), { flip: { limit_higher_than_parent: true } });
  assert.deepEqual(findingVariants(r), sweepNames((v) => v.variant === 'limit_higher_than_parent'));
  assert.ok(r.findings.every((f) => f.classes.join() === 'expectation'));
});

test('an observation or a limited attribution never hides a disagreement', async () => {
  const r = await run(opts(), { flip: { duplicate_member: ['go'], fraction: ['rust'], two_pow_53_plus_1_under_max_safe: ['ts'] } });
  assert.deepEqual(findingVariants(r), sweepNames((v) => ['duplicate_member', 'fraction', 'two_pow_53_plus_1_under_max_safe'].includes(v.variant)));
  assert.ok(r.findings.every((f) => f.classes.includes('disagreement')));
});

test('a wrong effective tier on a positive control fails that control; mutants of its depth are not judged', async () => {
  const r = await run(opts(), { tier: { variant: 'positive_depth_2', sdks: ['go'] } });
  assert.equal(r.exit, 1);
  assert.deepEqual(r.findings.map((f) => f.variant), ['positive_depth_2']);
  assert.ok(r.events.some((e) => e.kind === 'not_judged_control_failed' && e.depth === 2));
  assert.equal(r.coverage.complete, false);
});

test('an SDK error or unsupported answer is a fault of that SDK, never a verdict', async () => {
  const r = await run(opts(), { status: { action_added: { sdks: ['ts'], answer: { status: 'unsupported' } }, data_class_added: { sdks: ['py'], answer: { status: 'error', message: 'boom' } } } });
  assert.equal(r.exit, 1);
  assert.ok(r.findings.length > 0 && r.findings.every((f) => f.classes.includes('sdk_fault')));
});

test('one failed SDK batch is isolated without touching the batch ids of the three complete answers', async () => {
  const r = await run(opts({ maxRetries: 1000 }), { fault: { kind: 'exit1', sdks: ['go'], when: 'batch' } });
  assert.equal(r.exit, 1);
  assert.equal(r.stats.batch_failures, 1);
  assert.equal(r.stats.findings_by_class.batch_failure_not_reproduced, 1);
  assert.ok(r.stats.retries > 0);
  // The three others were judged on their own batch answers: no case has a fault or a disagreement.
  assert.equal(r.findings.length, 0);
  assert.equal(r.coverage.complete, true);
  const always = await run(opts({ maxRetries: 1000 }), { fault: { kind: 'exit1', sdks: ['go'], when: 'always' } });
  assert.equal(always.exit, 1);
  assert.ok(always.findings.length > 0 && always.findings.every((f) => f.classes.includes('sdk_fault')));
});

test('protocol faults, overflow, timeout and an exhausted retry budget are never a verdict', async () => {
  for (const kind of ['missing', 'duplicate', 'extra', 'stale', 'malformed', 'overflow']) {
    const r = await run(opts({ maxRetries: 0, stdoutBytes: 65536 }), { fault: { kind, sdks: ['rust'], when: 'always' } });
    assert.equal(r.exit, 3, kind);
    assert.match(r.error.message, /retry budget exhausted/, kind);
    assert.equal(r.events[0].category, kind === 'overflow' ? 'output_limit' : 'protocol', kind);
  }
  const slow = await run(opts({ maxRetries: 0, timeoutMs: 1000 }), { sleep: ['py'] });
  assert.equal(slow.exit, 3);
  assert.equal(slow.events[0].category, 'timeout');
});

test('bounds: oversized cases are skipped and counted but leave the coverage incomplete; a batch over --batch-bytes is refused', async () => {
  const small = await run(opts({ caseBytes: 4096 }), {});
  assert.equal(small.exit, 1);
  assert.equal(small.stats.skipped_oversize, sweepSize());
  assert.equal(small.coverage.complete, false);
  assert.equal(small.stats.controls.runs, 1);
  const tight = await run(opts({ batchBytes: 65536, caseBytes: 4096 }), {});
  assert.equal(tight.exit, 3);
  assert.match(tight.error.message, /exceeds --batch-bytes/);
});

test('the run stops after the batch with the first finding, preserved for review, and says so', async () => {
  const r = await run(opts({ batchCases: 16 }), { flip: { root_signed_by_agent: ['ts'] } });
  assert.equal(r.exit, 1);
  assert.match(r.stopped, /first finding/);
  assert.ok(r.coverage.sweep_executed < sweepSize());
});

test('findings beyond --max-findings are counted, not written or retained, and the run still fails', async () => {
  const o = opts({ maxFindings: 1 });
  const r = await run(o, { flip: { action_added: ['py'] } });
  assert.equal(r.exit, 1);
  assert.ok(r.stats.findings > 1);
  assert.equal(r.stats.findings_written, 1);
  assert.equal(r.findings.length, 1);
  assert.equal(files(o.out).length, 1);
});

test('minimization re-signs every candidate and keeps the four decisions; deliberate signatures are never minimized', async () => {
  const o = opts({ out: path.join(TMP, 'minimize') });
  const table = tableFor(o);
  const mode = { reject_text: { sdks: ['py'], text: '9007199254740991' }, flip: { sub_signed_by_human: ['ts'] } };
  const r = await runCampaign(o, { commands: commands(table, mode), log: quiet });
  const depth2 = r.findings.find((f) => f.variant === 'max_safe_integer_along_the_chain' && f.depth === 2);
  assert.ok(depth2, JSON.stringify(r.findings.map((f) => f.variant)));
  assert.equal(depth2.original_units, 3);
  assert.equal(depth2.minimized_units, 1);
  const file = files(o.out).find((f) => f.includes('max_safe_integer_along_the_chain') && JSON.parse(fs.readFileSync(f, 'utf8')).depth === 2);
  const f = checkFinding(JSON.parse(fs.readFileSync(file, 'utf8')));
  const chain = JSON.parse(decodeInput(f.minimized.input).chain_text);
  assert.ok(normativeSignatures(chain, JSON.parse(decodeInput(f.minimized.input).keys_text)));
  const deliberate = files(o.out).map((x) => JSON.parse(fs.readFileSync(x, 'utf8'))).find((x) => x.variant === 'sub_signed_by_human');
  assert.match(deliberate.minimization, /not applicable: signing deliberate/);
  // Replay: the same synthetic implementations reproduce the finding, its control baseline and its minimized input.
  const rep = await replayFinding({ ...o, replay: file }, { commands: commands(table, mode), log: quiet });
  assert.equal(rep.exit, 0, JSON.stringify(rep));
  assert.equal(rep.minimized.reproduces, true);
  assert.equal((await replayFinding({ ...o, replay: file }, { commands: commands(table, {}), log: quiet })).exit, 1);
  assert.equal((await replayFinding({ ...o, replay: file }, { commands: commands(table, { accept_all: true, reject_text: { sdks: true, text: 'mf-root' } }), log: quiet })).exit, 3);
});

// ── Replay of tampered findings ──

test('replay refuses malformed or tampered findings, with exit 3, before running anything', async () => {
  const o = opts({ out: path.join(TMP, 'tamper') });
  const table = tableFor(o);
  const mode = { flip: { action_added: ['py'] } };
  await runCampaign(o, { commands: commands(table, mode), log: quiet });
  const genuine = JSON.parse(fs.readFileSync(files(o.out)[0], 'utf8'));
  checkFinding(structuredClone(genuine));
  const b64 = (s) => Buffer.from(s).toString('base64');
  const edits = {
    'chain_b64 not canonical base64': (f) => { f.input.chain_b64 = '!!!notbase64'; },
    'keys_b64 not UTF-8': (f) => { f.input.keys_b64 = Buffer.from([0xff, 0xfe]).toString('base64'); },
    'revoked ids not strings': (f) => { f.input.revoked_mandate_ids = [17]; },
    'clock not RFC 3339': (f) => { f.input.verification_time = 'not-a-time'; },
    'clock changed under the old hash': (f) => { f.input.verification_time = '2026-10-22T12:00:01Z'; },
    'revoked ids changed under the old hash': (f) => { f.input.revoked_mandate_ids = ['mandate:mf-root']; },
    'chain bytes changed under the old hash': (f) => { f.input.chain_b64 = b64('[]'); },
    // A byte order mark is kept as U+FEFF (never stripped into the original chain): not JSON, even under a fresh hash.
    'a byte order mark before the chain, rehashed': (f) => { f.input.chain_b64 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(f.input.chain_b64, 'base64')]).toString('base64'); f.input_sha256 = inputHash(f.input); },
    'a missing SDK outcome': (f) => { delete f.outcomes.rust; },
    'an extra SDK outcome': (f) => { f.outcomes.wasm = f.outcomes.ts; },
    'fabricated decisions': (f) => { f.decisions.py = 'reject'; },
    'fabricated classes': (f) => { f.classes = ['expectation']; },
    'an outcome of unknown category': (f) => { f.outcomes.go = { category: 'maybe' }; },
    'a control tier changed': (f) => { f.control.expect.effective_tier = 'routine'; },
    'a control that did not pass': (f) => { f.control.outcomes.ts = { category: 'verdict', valid: false, effective_tier: null, errors: [] }; f.control.decisions.ts = 'reject'; },
    'a control input changed': (f) => { f.control.input.verification_time = '2030-01-01T00:00:00Z'; },
    'no control': (f) => { delete f.control; },
    'another format': (f) => { f.format = 'dcp-difffuzz/3'; },
    'five SDKs': (f) => { f.sdks = [...f.sdks, 'wasm']; },
    'no provenance': (f) => { delete f.provenance; },
    'a minimized input with the four decisions changed': (f) => { f.minimized = { input: f.input, input_sha256: f.input_sha256, decisions: { ...f.decisions, ts: 'accept:elevated' }, original_units: 2, minimized_units: 1, units: [], note: 'x' }; },
    'a minimized input changed under its hash': (f) => { f.minimized = { input: { ...f.input, verification_time: '2026-10-22T12:00:01Z' }, input_sha256: f.input_sha256, decisions: f.decisions, original_units: 2, minimized_units: 1, units: [], note: 'x' }; },
  };
  for (const [what, edit] of Object.entries(edits)) {
    const f = structuredClone(genuine);
    edit(f);
    const file = path.join(TMP, `tampered-${++n}.json`);
    fs.writeFileSync(file, JSON.stringify(f));
    const r = await replayFinding({ ...o, replay: file }, { commands: commands(table, mode), log: quiet });
    assert.equal(r.exit, 3, what);
    assert.match(r.error.message, /not a replayable finding/, what);
  }
  const fileOk = files(o.out)[0];
  assert.equal((await replayFinding({ ...o, replay: fileOk }, { commands: commands(table, mode), log: quiet })).exit, 0);
  const missing = Object.fromEntries(SDKS.map((s) => [s, [path.join(TMP, 'no-such-wrapper')]]));
  assert.equal((await replayFinding({ ...o, replay: fileOk }, { commands: missing, log: quiet })).exit, 3);
});

// ── Build, CLI and transport probe ──

test('the build deadline is checked before any step is launched', async () => {
  const o = { ...DEFAULTS, buildTimeoutMs: 1 };
  await assert.rejects(buildWrappers(o, TMP), /build deadline/);
});

test('the CLI: usage errors are exit 2 with a fresh error report; a run replaces an older passing report', () => {
  const cli = path.join(HERE, 'run-mandates.mjs');
  const report = path.join(TMP, 'cli-report.json');
  for (const args of [['--iterations', '-1'], ['--seed', 'a', '--seed', 'b'], ['--unknown'], ['--batch-cases', '4'], ['--transport-probe', '--replay', 'x.json']]) {
    fs.writeFileSync(report, JSON.stringify({ status: 'pass' }));
    const r = spawnSync(process.execPath, [cli, ...args, '--report', report], { encoding: 'utf8' });
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).status, 'error');
  }
  assert.equal(spawnSync(process.execPath, [cli, '--report'], { encoding: 'utf8' }).status, 2);
});

test('the transport probe records each component and needs only its control to be accepted', async () => {
  const o = opts();
  const table = tableFor(o);
  const ok = await transportProbe(o, { commands: commands(table, {}), log: quiet });
  assert.equal(ok.exit, 0, JSON.stringify(ok.error));
  for (const s of SDKS) {
    assert.equal(ok.results[s].control.decision, 'accept:elevated');
    assert.equal(ok.results[s].nan_token.reached_sdk, false);
    assert.equal(ok.results[s].nan_token.exit_code, 2);
  }
  assert.ok(ok.limits.some((l) => /never an SDK rejection/.test(l)));
  const bad = await transportProbe(o, { commands: commands(table, { accept_all: false, reject_text: { sdks: ['go'], text: 'mf-root' } }), log: quiet });
  assert.equal(bad.exit, 3);
});
