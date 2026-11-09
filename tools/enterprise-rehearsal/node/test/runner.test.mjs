// Self-tests of the rehearsal plan and runner (TEST ONLY): small controls, no servers and no campaign.
//   cd <consumer>/node/rehearsal && node --test node/test/runner.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GROUPS, LANES, buildPlan, checkPlan, evaluateStep } from '../plan.mjs';
import { createRunDir } from '../runner.mjs';

const zero = { trust: 0, deny: 0, mandates: 0, reservations: 0, effects: 0 };

test('the plan covers both lanes and every group, each with a valid and a negative step', () => {
  const plan = buildPlan();
  assert.equal(checkPlan(plan), plan.steps.length);
  for (const lane of LANES) for (const group of GROUPS) assert.ok(plan.steps.some((s) => s.lane === lane && s.group === group), `${lane} ${group}`);
  assert.equal(new Set(plan.steps.map((s) => s.id)).size, plan.steps.length);
  assert.ok(plan.steps.every((s) => s.request === null || s.expect.tenant !== undefined), 'every request step states its tenant');
});

test('checkPlan refuses an empty plan, an omitted group, a repeated id and missing expectations', () => {
  const plan = buildPlan();
  assert.throws(() => checkPlan({ ...plan, steps: [] }), /empty plan/);
  assert.throws(() => checkPlan({ ...plan, steps: plan.steps.filter((s) => !(s.lane === 'python' && s.group === 'G7')) }), /python has no G7/);
  assert.throws(() => checkPlan({ ...plan, steps: [...plan.steps, plan.steps[0]] }), /repeated step id/);
  const incomplete = structuredClone(plan);
  delete incomplete.steps[3].expect.deltas.mandates;
  assert.throws(() => checkPlan(incomplete), /no complete expectations/);
  assert.throws(() => checkPlan({ ...plan, steps: plan.steps.filter((s) => !(s.lane === 'node' && s.group === 'G4' && s.valid)) }), /needs a valid and a negative/);
});

test('evaluateStep: a matching observation passes; an inverted expectation, a source not called and an exception fail', () => {
  const step = buildPlan().steps.find((s) => s.id === 'node.G5.agent_revoked');
  const matching = { status: 403, body: { ok: false, admitted: false, codes: ['REVOCATION_REVOKED'] }, tenant: 'T1', deltas: { ...zero, trust: 1, deny: 1 } };
  assert.deepEqual(evaluateStep(step, matching), []);
  const inverted = { ...step, expect: { ...step.expect, status: 200, codes: [] } };
  assert.ok(evaluateStep(inverted, matching).length > 0, 'an inverted expectation must fail');
  assert.match(evaluateStep(step, { ...matching, deltas: { ...zero, trust: 1 } }).join(), /delta deny/, 'a source that was not called must fail');
  assert.match(evaluateStep(step, { error: 'fetch failed' }).join(), /infrastructure/, 'an exception is never a refusal');
  assert.match(evaluateStep(step, { ...matching, tenant: 'T2' }).join(), /tenant/);
  assert.match(evaluateStep(step, { ...matching, body: { ...matching.body, codes: ['REVOCATION_REVOKED', 'EXTRA'] } }).join(), /DCP codes/, 'an unexplained extra code fails');
  assert.match(evaluateStep(step, { ...matching, status: 500, body: { code: 'APP_INTERNAL_ERROR' } }).join(), /status/);
});

test('evaluateStep: an absent observation never matches, not even an expected null tenant', () => {
  const step = buildPlan().steps.find((s) => s.id === 'node.G3.no_token');
  const observed = { status: 401, body: { ok: false, code: 'APP_UNAUTHENTICATED' }, tenant: null, deltas: { ...zero } };
  assert.deepEqual(evaluateStep(step, observed), [], 'a real observation of no tenant');
  assert.match(evaluateStep(step, { ...observed, tenant: 'missing' }).join(), /tenant/, 'no observation at all must fail');
});

test('evaluateStep: a 200 must carry the real DCP outcome, never action_authorized true', () => {
  const step = buildPlan().steps.find((s) => s.id === 'python.G7.valid');
  const dcp = { admitted: true, delegation_active: true, action_authorized: false };
  const observed = { status: 200, body: { ok: true, application_authorized: true, dcp }, tenant: 'T1', deltas: { ...zero, trust: 1, deny: 1, mandates: 1, effects: 1 } };
  assert.deepEqual(evaluateStep(step, observed), []);
  assert.match(evaluateStep(step, { ...observed, body: { ok: true, application_authorized: true } }).join(), /DCP outcome/, 'a missing outcome fails');
  assert.match(evaluateStep(step, { ...observed, body: { ...observed.body, dcp: { ...dcp, action_authorized: true } } }).join(), /action_authorized|DCP outcome/);
  assert.match(evaluateStep(step, { ...observed, body: { ...observed.body, dcp: { ...dcp, delegation_active: false } } }).join(), /DCP outcome/);
});

test('evaluateStep: concurrency needs exactly one 200 and seven 409, each with its tenant', () => {
  const step = buildPlan().steps.find((s) => s.id === 'node.G9.eight_concurrent');
  const dcp = { admitted: true, delegation_active: true, action_authorized: false };
  const ok = { status: 200, body: { ok: true, application_authorized: true, dcp } };
  const consumed = { status: 409, body: { code: 'APP_ALREADY_CONSUMED', dcp } };
  const observed = { responses: [ok, ...Array(7).fill(consumed)], tenants: Array(8).fill('T1'), deltas: { trust: 8, deny: 8, mandates: 8, reservations: 1, effects: 1 } };
  assert.deepEqual(evaluateStep(step, observed), []);
  assert.ok(evaluateStep(step, { ...observed, responses: [ok, ok, ...Array(6).fill(consumed)] }).length > 0, 'two 200 must fail');
  assert.ok(evaluateStep(step, { ...observed, deltas: { ...observed.deltas, effects: 2 } }).length > 0, 'two effects must fail');
});

test('a run directory and its report are never reused', (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mp05-runner-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const first = createRunDir(work);
  const second = createRunDir(work);
  assert.notEqual(first.id, second.id, 'each run gets a new id');
  fs.writeFileSync(path.join(first.dir, 'report.json'), '{"status":"PASS"}');
  assert.throws(() => createRunDir(work, first.id), /EEXIST/, 'an old run directory, with its report, is refused');
  assert.equal(fs.readFileSync(path.join(first.dir, 'report.json'), 'utf8'), '{"status":"PASS"}', 'and left untouched');
});
