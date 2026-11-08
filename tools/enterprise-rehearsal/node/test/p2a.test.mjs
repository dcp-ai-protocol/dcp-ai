// P2a tests (TEST ONLY): generator, operator, operator sources, application authorization and ledger, with the
// installed TypeScript SDK and, through python/cross_check.py, the installed Python SDK. Expectations are written here
// from the contract, the shared vectors (tests/interop/v2) and the design; they are never taken from an SDK's output.
//
//   cd <consumer>/node/rehearsal
//   REHEARSAL_PYTHON=<consumer>/python/bin/python REHEARSAL_WORK=<dir outside any checkout> \
//     node --test node/test/p2a.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { admitSignedBundleV2, evaluateDelegationActivationV2, generateSessionNonce } from '@dcp-ai/sdk';
import { KIT, assertInstalledSdk, assertOutsideGit, isObject, json, loadContract, readJson } from '../common.mjs';
import { chainEvidence, generate, loadMaterial, newRegistry, signAgentBundle } from '../fixtures.mjs';
import * as op from '../operator.mjs';
import { agentKeySnapshot, compositionSubjects, mandateSnapshot, readList, tenantConfig } from '../sources.mjs';
import { argsSha256, authorize, routePath } from '../authz.mjs';
import { LedgerError, actionKey, appendEffect, readEffects, reservations, reserve } from '../ledger.mjs';

const PYTHON = process.env.REHEARSAL_PYTHON;
const WORK = process.env.REHEARSAL_WORK;
const KEY_VECTOR = '4410142dba477671129838632ffb5511bcfe3ea5f69669d10aab9134a71588da';
const ARGS = (over = {}) => ({ sku: 'SKU-1', amount: 100, currency: 'EUR', ...over });
const codesOf = (errors) => [...new Set(errors.map((e) => e.code))].sort();
/** A copy without the member, as JSON would give it (a member set to undefined is still present in JavaScript). */
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

let run;
let mat;
let ids;
let registry;
let contract;

before(async () => {
  assertInstalledSdk();
  assert.ok(PYTHON && WORK, 'set REHEARSAL_PYTHON (consumer venv interpreter) and REHEARSAL_WORK (outside any checkout)');
  assertOutsideGit(WORK);
  contract = loadContract();
  run = path.join(WORK, `run-${Date.now()}`);
  await generate(path.join(run, 'material'));
  mat = loadMaterial(path.join(run, 'material'));
  ids = mat.manifest.identities;
  registry = newRegistry();
  fs.mkdirSync(path.join(run, 'evidence'));
});

const profile = () => ({ profile: 'strict-v1', verifier_id: contract.verifier_id });
const keyDoc = (name) => path.join(mat.dir, 'public', 'principals', `${name}.keys.json`);
const oob = (name) => fs.readFileSync(path.join(mat.dir, 'oob', `${name}.fingerprint`), 'utf8');
const lists = (state) => ({
  deny: readList(path.join(state, 'operator', 'revocation', 'deny-list.json')),
  mandates: readList(path.join(state, 'operator', 'revocation', 'mandates.json')),
});
/** T1 enrols P with p-k1 and then p-k2 (overlap); T2 enrols Q; T3 has no trust set. */
function standardState(name) {
  const s = path.join(run, `op-${name}`);
  op.init(s);
  op.enroll(s, 'T1', keyDoc('p-k1'), oob('p-k1'));
  op.enroll(s, 'T1', keyDoc('p-k2'), oob('p-k2'), { addKey: true });
  op.enroll(s, 'T2', keyDoc('q-k1'), oob('q-k1'));
  return s;
}
const listFiles = (dir, rel = '') =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? listFiles(dir, r) : [r];
  });
const reverseKeys = (v) =>
  Array.isArray(v) ? v.map(reverseKeys) : isObject(v) ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;

/** Starts a child; `done` resolves with its JSON output. The caller kills whatever is still running in its finally. */
function startChild(cmd, args) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => reject(new Error(`timeout: ${cmd} ${args.join(' ')}`)), 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(JSON.parse(out));
      else reject(new Error(`${cmd} exited with ${code}: ${err}`));
    });
  });
  return { child, done };
}
const stillRunning = (child) => child.exitCode === null && child.signalCode === null;
const tmpDir = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function crossCheck(cases, name) {
  const file = path.join(run, 'evidence', `${name}.cases.json`);
  fs.writeFileSync(file, JSON.stringify(cases));
  const r = spawnSync(PYTHON, ['-I', path.join(KIT, 'python', 'cross_check.py'), file], { encoding: 'utf8', timeout: 180_000 });
  assert.equal(r.status, 0, `cross_check.py: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('material: portable, checked against its manifest, secrets kept apart', () => {
  const secrets = path.join(mat.dir, 'secrets');
  assert.equal(fs.statSync(secrets).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(secrets, 'keys')).mode & 0o777, 0o700);
  const needles = [];
  for (const f of fs.readdirSync(path.join(secrets, 'keys'))) {
    assert.equal(fs.statSync(path.join(secrets, 'keys', f)).mode & 0o777, 0o600, f);
    const s = readJson(path.join(secrets, 'keys', f));
    for (const k of [s.classical, s.pq]) {
      const bytes = Buffer.from(k.secretKeyB64, 'base64');
      const hex = bytes.toString('hex');
      needles.push(k.secretKeyB64, bytes.toString('base64url'), hex, hex.toUpperCase());
    }
  }
  const visible = listFiles(mat.dir).filter((rel) => !rel.startsWith('secrets/'));
  assert.ok(visible.length > 40, `${visible.length} public files`);
  for (const rel of visible) {
    const text = fs.readFileSync(path.join(mat.dir, rel), 'utf8');
    for (const n of needles) assert.ok(!text.includes(n), `${rel} contains secret material`);
    for (const p of [mat.dir, WORK, os.homedir(), '/private/', '/Users/', 'file:']) assert.ok(!text.includes(p), `${rel} contains ${p}`);
  }
  assert.deepEqual(
    listFiles(mat.dir).filter((rel) => /trust/i.test(rel)),
    [],
    'the generator never writes a trust set',
  );
  const copy = path.join(run, 'material-tampered');
  fs.cpSync(path.join(mat.dir, 'public'), path.join(copy, 'public'), { recursive: true });
  fs.cpSync(path.join(mat.dir, 'oob'), path.join(copy, 'oob'), { recursive: true });
  const m2 = path.join(copy, 'public', 'mandates', 'm2.json');
  fs.writeFileSync(m2, fs.readFileSync(m2, 'utf8').replace('"max_amount": 5000', '"max_amount": 50000'));
  assert.throws(() => loadMaterial(copy), /does not match the manifest/);
});

test('operator: out-of-band enrolment, no self-trusted keys, withdrawal, retirement and lists', async () => {
  const s = path.join(run, 'op-operator');
  op.init(s);
  const trustT1 = path.join(s, 'operator', 'tenants', 'T1', 'trust.json');
  const untouched = fs.readFileSync(trustT1);
  const doc = readJson(keyDoc('p-k1'));
  const tampered = path.join(run, 'p-k1.other-human.json');
  fs.writeFileSync(tampered, JSON.stringify({ ...doc, human_id: ids.Q }));
  const swapped = path.join(run, 'p-k1.swapped-kid.json');
  fs.writeFileSync(swapped, JSON.stringify({ ...doc, keys: [{ ...doc.keys[0], kid: doc.keys[1].kid }, doc.keys[1]] }));
  assert.throws(() => op.enroll(s, 'T1', keyDoc('p-k1'), oob('p-k2')), { code: 'OP_FINGERPRINT_MISMATCH' });
  assert.throws(() => op.enroll(s, 'T1', tampered, oob('p-k1')), { code: 'OP_FINGERPRINT_MISMATCH' });
  assert.throws(() => op.enroll(s, 'T1', swapped, oob('p-k1')), { code: 'OP_KEY_DOCUMENT_INVALID' });
  assert.throws(() => op.enroll(s, 'T3', keyDoc('p-k1'), oob('p-k1')), { code: 'OP_NO_TRUST_SET' });
  assert.deepEqual(fs.readFileSync(trustT1), untouched, 'refusals leave the trust set as it was');

  op.enroll(s, 'T1', keyDoc('p-k1'), oob('p-k1'));
  op.enroll(s, 'T2', keyDoc('q-k1'), oob('q-k1'));
  assert.throws(() => op.enroll(s, 'T1', keyDoc('p-k1'), oob('p-k1')), { code: 'OP_ALREADY_ENROLLED' });
  const a0 = (principalKeyset = 'p-k1') =>
    signAgentBundle(mat, registry, { agent: 'A0', keyset: 'a0-k1', principalKeyset, action: 'quote', args: ARGS(), route: 'direct' });
  const admits = async (tenant, bundle, codes) => {
    const { trust } = tenantConfig(s, tenant);
    const r = await admitSignedBundleV2(structuredClone(bundle), registry, {
      profile: profile(),
      trust,
      revocation: agentKeySnapshot(lists(s).deny, compositionSubjects(bundle)),
    });
    assert.deepEqual(codesOf(r.errors), [...codes].sort());
    assert.equal(r.admitted, codes.length === 0);
    assert.equal(r.action_authorized, false);
  };
  await admits('T1', await a0(), []);
  await admits('T2', await a0(), ['TRUST_PRINCIPAL_UNKNOWN']);
  await admits('T1', await a0('p-k2'), ['TRUST_KEY_NOT_ANCHORED']); // in the RPR, never trusted from it
  op.enroll(s, 'T1', keyDoc('p-k2'), oob('p-k2'), { addKey: true });
  await admits('T1', await a0('p-k2'), []);

  const entry = readJson(trustT1).principals.find((p) => p.human_id === ids.P);
  op.withdraw(s, 'T1', ids.P);
  await admits('T1', await a0(), ['TRUST_PRINCIPAL_UNKNOWN']);
  assert.throws(() => op.enroll(s, 'T1', keyDoc('p-k1'), oob('p-k1')), { code: 'OP_ALREADY_ENROLLED' });
  op.restore(s, 'T1', ids.P);
  assert.deepEqual(readJson(trustT1).principals.find((p) => p.human_id === ids.P), entry);
  await admits('T1', await a0(), []);

  op.retireKey(s, 'T1', ids.P, mat.manifest.keysets['p-k1'].kids);
  await admits('T1', await a0(), ['TRUST_KEY_EXPIRED']);
  await admits('T1', await a0('p-k2'), []);

  op.editRevocation(s, { revokeAgents: [ids.A0] });
  await admits('T1', await a0('p-k2'), ['REVOCATION_REVOKED']);
  op.editRevocation(s, { unrevokeAgents: [ids.A0] });
  await admits('T1', await a0('p-k2'), []);
  op.editRevocation(s, { revokeMandates: ['mandate:mp05-m2'] });
  assert.deepEqual(mandateSnapshot(lists(s).mandates, [mat.mandates.m1, mat.mandates.m2]).mandates, {
    'mandate:mp05-m1': 'not_revoked',
    'mandate:mp05-m2': 'revoked',
  });
  assert.equal(mandateSnapshot({ updated_at: 'yesterday', revoked_mandates: [] }, [mat.mandates.m1]), null);
  assert.equal(agentKeySnapshot({ updated_at: new Date().toISOString(), revocations: 'all' }, { agent_ids: [], kids: [] }), null);

  assert.match(readJson(trustT1).trust_set_version, /^T1\.\d+$/);
  const tokens = readJson(path.join(s, 'secrets', 'tokens.json'));
  const visible = [fs.readFileSync(path.join(s, 'operator', 'log.jsonl'), 'utf8'), fs.readFileSync(path.join(s, 'operator', 'tokens.json'), 'utf8')];
  for (const t of [tokens.operator, ...Object.values(tokens.tenants)]) assert.ok(visible.every((v) => !v.includes(t)), 'a token outside secrets/');
  assert.equal(fs.statSync(path.join(s, 'secrets')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(s, 'secrets', 'tokens.json')).mode & 0o777, 0o600);
});

test('authorization: arguments, intent binding, operator policy and scope (unit)', () => {
  const policy = {
    domain: contract.domain,
    direct_agents: { 'agent:a0': ['quote', 'order'] },
    delegated_principals: { 'human:p': ['quote', 'order'] },
    max_amount: { quote: 10000, order: 10000 },
  };
  const entry = (over = {}) => ({
    domain: contract.domain,
    actions_permitted: ['quote', 'order'],
    data_classes: ['company_confidential', 'financial_data'],
    limits: { max_amount: 5000 },
    ...over,
  });
  const root = { authority_scope: [entry({ actions_permitted: ['quote', 'order', 'refund'], limits: { max_amount: 10000 } })] };
  const intentFor = (action, args, route = 'delegated', over = {}) => ({
    action_type: 'api_call',
    target: {
      channel: 'api',
      domain: contract.domain,
      url: routePath(contract, route, action),
      x_rehearsal: { action, args_sha256: argsSha256(args) },
    },
    data_classes: [...contract.actions[action].data_classes],
    ...over,
  });
  const outcome = ({ action = 'order', args = ARGS(), route = 'delegated', intent, chain, agentId = 'agent:a0', principalId = 'human:p' } = {}) => {
    const r = authorize({
      contract,
      policy,
      route,
      action,
      args,
      intent: intent ?? intentFor(action, args, route),
      agentId,
      principalId,
      chain: chain ?? (route === 'delegated' ? [root, { authority_scope: [entry()] }] : undefined),
    });
    return r.ok ? 'OK' : r.code;
  };
  assert.equal(outcome(), 'OK');
  const bound = intentFor('order', ARGS());
  for (const args of [
    ARGS({ amount: true }),
    ARGS({ amount: -1 }),
    ARGS({ amount: 0 }),
    ARGS({ amount: -0 }),
    ARGS({ amount: '100' }),
    ARGS({ amount: 1.5 }),
    ARGS({ amount: 2 ** 53 }),
    ARGS({ currency: 'USD' }),
    ARGS({ sku: 'bad sku' }),
    ARGS({ sku: 'ABC\n' }),
    ARGS({ sku: 'ABC\r' }),
    ARGS({ sku: 'A'.repeat(65) }),
    { ...ARGS(), note: 'x' },
    { sku: 'SKU-1', amount: 100 },
    ['SKU-1', 100, 'EUR'],
  ]) {
    assert.equal(outcome({ args, intent: bound }), 'APP_ARGS_INVALID', JSON.stringify(args));
  }
  const t = bound.target;
  for (const intent of [
    { ...bound, action_type: 'initiate_payment' },
    { ...bound, target: { ...t, to: null } },
    { ...bound, target: { ...t, channel: 'payments' } },
    { ...bound, target: { ...t, domain: 'billing.example.com' } },
    { ...bound, target: { ...t, url: routePath(contract, 'direct', 'order') } },
    { ...bound, target: { ...t, x_rehearsal: { action: 'quote', args_sha256: argsSha256(ARGS()) } } },
    { ...bound, target: { ...t, x_rehearsal: { action: 'order', args_sha256: argsSha256(ARGS({ amount: 200 })) } } },
    { ...bound, target: { ...t, x_rehearsal: { ...t.x_rehearsal, nonce: '1' } } },
    { ...bound, data_classes: ['financial_data', 'pii'] },
    { ...bound, data_classes: ['company_confidential'] },
    { ...bound, data_classes: ['financial_data', 'financial_data'] },
    without(bound, 'data_classes'),
  ]) {
    assert.equal(outcome({ intent }), 'APP_INTENT_MISMATCH', JSON.stringify(intent));
  }
  const wide = [root, { authority_scope: [entry({ actions_permitted: ['quote', 'order', 'refund'] })] }];
  assert.equal(outcome({ action: 'refund', chain: wide }), 'APP_ACTION_NOT_AUTHORIZED');
  assert.equal(outcome({ action: 'quote', route: 'direct' }), 'OK');
  assert.equal(outcome({ action: 'quote', route: 'direct', agentId: 'agent:other' }), 'APP_ACTION_NOT_AUTHORIZED');
  assert.equal(outcome({ principalId: 'human:other' }), 'APP_ACTION_NOT_AUTHORIZED');
  assert.equal(outcome({ action: 'delete', intent: bound }), 'APP_ACTION_NOT_AUTHORIZED');
  assert.equal(outcome({ args: ARGS({ amount: 10000 }), route: 'direct' }), 'OK');
  assert.equal(outcome({ args: ARGS({ amount: 10001 }), route: 'direct' }), 'APP_ARGS_OUT_OF_SCOPE');
  const leaf = (...entries) => [root, { authority_scope: entries }];
  const scope = [
    [leaf(entry({ domain: 'billing.example.com' })), ARGS(), 'APP_DOMAIN_OUT_OF_SCOPE'],
    [leaf(entry(), entry()), ARGS(), 'APP_DOMAIN_OUT_OF_SCOPE'],
    [leaf(entry({ actions_permitted: ['quote'] })), ARGS(), 'APP_ACTION_OUT_OF_SCOPE'],
    [leaf(entry({ data_classes: ['company_confidential'] })), ARGS(), 'APP_DATA_CLASS_OUT_OF_SCOPE'],
    [leaf(without(entry(), 'data_classes')), ARGS(), 'APP_DATA_CLASS_OUT_OF_SCOPE'],
    [leaf(entry()), ARGS({ amount: 5000 }), 'OK'],
    [leaf(entry()), ARGS({ amount: 5001 }), 'APP_ARGS_OUT_OF_SCOPE'],
    [[{ authority_scope: [entry({ limits: { max_amount: 3000 } })] }, { authority_scope: [entry()] }], ARGS({ amount: 4000 }), 'APP_ARGS_OUT_OF_SCOPE'],
    [leaf(entry({ limits: {} })), ARGS({ amount: 9000 }), 'OK'],
    [leaf(without(entry(), 'limits')), ARGS({ amount: 9000 }), 'OK'],
    [leaf(entry({ limits: { max_amount: '5000' } })), ARGS(), 'APP_ARGS_OUT_OF_SCOPE'],
    [leaf(entry({ limits: { max_amount: true } })), ARGS(), 'APP_ARGS_OUT_OF_SCOPE'],
    [leaf(entry({ limits: { max_amount: 5000.5 } })), ARGS(), 'APP_ARGS_OUT_OF_SCOPE'],
    [leaf(entry({ limits: [5000] })), ARGS(), 'APP_ARGS_OUT_OF_SCOPE'],
    [[], ARGS(), 'APP_DELEGATION_NOT_ACTIVE'],
  ];
  for (const [chain, args, want] of scope) assert.equal(outcome({ chain, args }), want, JSON.stringify(chain));
});

test('delegated chains: composition, activation and authorization in TypeScript and Python', async () => {
  const sB = standardState('b'); // P with p-k1 and p-k2 in T1
  const sC = standardState('c'); // and then p-k1 retired
  op.retireKey(sC, 'T1', ids.P, mat.manifest.keysets['p-k1'].kids);
  const sD = standardState('d'); // and then m2 revoked
  op.editRevocation(sD, { revokeMandates: ['mandate:mp05-m2'] });

  const cases = [];
  const add = async (name, state, chain, leaf, expect, over = {}, mandateList) => {
    const evidence = await chainEvidence(mat, registry, chain, leaf, over);
    const { policy, trust } = tenantConfig(state, 'T1');
    const l = lists(state);
    cases.push({
      name,
      route: 'delegated',
      action: leaf.action,
      args: leaf.requestArgs ?? leaf.args,
      evidence,
      expect,
      operator: { tenant: 'T1', policy, trust, profile: profile(), deny_list: l.deny, mandate_list: mandateList === undefined ? l.mandates : mandateList },
    });
  };
  const ok = (app) => ({ admitted: true, active: true, composition: [], activation: [], app });
  const refused = (composition) => ({ admitted: false, composition, app: null });
  const inactive = (activation) => ({ admitted: true, active: false, composition: [], ...activation, app: 'APP_DELEGATION_NOT_ACTIVE' });
  const order = (amount = 100) => ({ action: 'order', args: ARGS({ amount }) });

  await add('valid_order_at_leaf_limit', sB, 'valid', order(5000), ok('OK'));
  await add('valid_order_over_leaf_limit', sB, 'valid', order(5001), ok('APP_ARGS_OUT_OF_SCOPE'));
  await add('valid_quote', sB, 'valid', { action: 'quote', args: ARGS() }, ok('OK'));
  await add('leaf_other_domain', sB, 'dom', order(), ok('APP_DOMAIN_OUT_OF_SCOPE'));
  await add('leaf_without_financial_data', sB, 'dc', order(), ok('APP_DATA_CLASS_OUT_OF_SCOPE'));
  await add('leaf_without_financial_data_quote', sB, 'dc', { action: 'quote', args: ARGS() }, ok('OK'));
  await add('leaf_quote_only', sB, 'q', order(), ok('APP_ACTION_OUT_OF_SCOPE'));
  await add('refund_in_mandates_not_in_policy', sB, 'r', { action: 'refund', args: ARGS() }, ok('APP_ACTION_NOT_AUTHORIZED'));
  await add('order_in_wider_leaf', sB, 'r', order(), ok('OK'));
  await add('low_chain_at_limit', sB, 'low', order(3000), ok('OK'));
  await add('low_chain_over_limit', sB, 'low', order(3001), ok('APP_ARGS_OUT_OF_SCOPE'));
  await add('args_not_the_signed_ones', sB, 'valid', { ...order(), requestArgs: ARGS({ amount: 200 }) }, ok('APP_INTENT_MISMATCH'));
  await add('extra_data_class_signed', sB, 'valid', { ...order(), intent: { data_classes: ['financial_data', 'pii'] } }, ok('APP_INTENT_MISMATCH'));
  await add('other_route_signed', sB, 'valid', { ...order(), route: 'direct' }, ok('APP_INTENT_MISMATCH'));
  await add('boolean_amount_signed', sB, 'valid', { action: 'order', args: ARGS({ amount: true }) }, ok('APP_ARGS_INVALID'));
  await add('principal_rotated_overlap', sB, 'rot_principal', order(), ok('OK'));
  await add('principal_rotated_after_retirement', sC, 'rot_principal', order(), ok('OK'));
  await add('agent_rotated', sB, 'rot_agent', order(), ok('OK'));
  // Vector-backed SDK refusals: delegated_admission_vectors root_key_expired_in_trust_set, after_valid_until,
  // before_valid_from, sub_by_key_no_longer_in_passport, intermediate_mandate_revoked, mandate_revocation_unavailable.
  // DCP-09 § 3.5.2 rule 5 has chain-level vectors (mandate_chain_vectors must_reject loosened_numeric_limit and
  // dropped_limit_key); its composition code is taken from the composition vectors of rules 4 and 6.
  await add('looser_sub_mandate_limit', sB, 'looser', order(), refused(['DELEGATION_CHAIN_INVALID']));
  await add('old_root_after_retirement', sC, 'valid', order(), refused(['TRUST_KEY_EXPIRED']), { principal: { name: 'P', keyset: 'p-k2' } });
  await add('leaf_mandate_expired', sB, 'expired', order(), refused(['DELEGATION_CHAIN_INVALID']));
  await add('leaf_mandate_not_yet_valid', sB, 'future', order(), refused(['DELEGATION_CHAIN_INVALID']));
  await add('old_m2_after_agent_rotation', sB, 'valid', order(), refused(['DELEGATION_CHAIN_INVALID']), { delegators: [{ agent: 'A1', keyset: 'a1-k2' }] });
  await add('leaf_mandate_revoked', sD, 'valid', order(), refused(['DELEGATION_CHAIN_INVALID', 'REVOCATION_REVOKED']));
  await add('mandate_list_unavailable', sB, 'valid', order(), refused(['REVOCATION_UNAVAILABLE']), {}, null);
  // Activation refusals: mandate_acknowledgment_vectors intermediate_missing and root_acknowledged_by_sub; the two
  // rotation cases have no vector, so only what follows from construction is asserted (P2b plan fixes the codes).
  await add('leaf_acknowledgment_missing', sB, 'valid', order(), inactive({ activation: ['ACK_MISSING'] }), {
    acknowledgments: ['m1'],
    awareness_thresholds: ['m1'],
  });
  await add('leaf_acknowledgment_signed_by_a1', sB, 'valid', order(), inactive({ activation: ['ACK_KEY_UNKNOWN', 'ACK_KEY_UNKNOWN'] }), {
    acknowledgments: ['m1', 'm2_by_a1'],
  });
  await add('old_acknowledgments_after_root_reissue', sB, 'rot_principal', order(), inactive({ includes: 'ACK_MANDATE_MISMATCH', verified: [false, false] }), {
    acknowledgments: ['m1', 'm2'],
    awareness_thresholds: ['m1', 'm2'],
  });
  await add('old_a1_acknowledgment_after_agent_rotation', sB, 'rot_agent', order(), inactive({ only: ['ACK_KEY_UNKNOWN'] }), {
    acknowledgments: ['m1', 'm2_a1k2'],
    awareness_thresholds: ['m1', 'm2_a1k2'],
  });

  const evaluate = async (c) => {
    const ev = structuredClone(c.evidence);
    const r = await evaluateDelegationActivationV2(ev, registry, {
      trust: c.operator.trust,
      profile: c.operator.profile,
      revocation: agentKeySnapshot(c.operator.deny_list, compositionSubjects(ev)),
      mandateRevocation: mandateSnapshot(c.operator.mandate_list, ev.mandateChain),
      now: Date.now(),
    });
    const out = {
      name: c.name,
      admitted: r.composition.admitted,
      delegation_active: r.delegation_active,
      action_authorized: r.action_authorized || r.composition.action_authorized,
      composition_codes: codesOf(r.composition.errors),
      activation_codes: r.errors.map((e) => e.code),
      verified: r.acknowledgments.map((a) => a.verified),
    };
    if (!out.admitted) return { ...out, app: null, ledger_key: null };
    if (!out.delegation_active) return { ...out, app: 'APP_DELEGATION_NOT_ACTIVE', ledger_key: null };
    const leaf = ev.signedBundle.bundle;
    const d = authorize({
      contract,
      policy: c.operator.policy,
      route: 'delegated',
      action: c.action,
      args: c.args,
      intent: leaf.intent.payload,
      agentId: leaf.agent_passport.payload.agent_id,
      principalId: leaf.responsible_principal_record.payload.human_id,
      chain: ev.mandateChain,
    });
    return { ...out, app: d.ok ? 'OK' : d.code, ledger_key: d.ok ? actionKey(c.operator.tenant, leaf.intent.payload_hash) : null };
  };
  const check = (lane, c, got) => {
    const e = c.expect;
    const where = `${lane} ${c.name}: ${JSON.stringify(got)}`;
    assert.equal(got.admitted, e.admitted, where);
    assert.equal(got.action_authorized, false, where);
    assert.deepEqual(got.composition_codes, [...e.composition].sort(), where);
    if (e.admitted) assert.equal(got.delegation_active, e.active, where);
    if (e.activation) assert.deepEqual(got.activation_codes, e.activation, where);
    if (e.includes) assert.ok(got.activation_codes.includes(e.includes), where);
    if (e.only) assert.ok(got.activation_codes.length > 0 && got.activation_codes.every((x) => e.only.includes(x)), where);
    if (e.verified) assert.deepEqual(got.verified, e.verified, where);
    assert.equal(got.app, e.app, where);
  };
  const ts = [];
  for (const c of cases) ts.push(await evaluate(c));
  const py = crossCheck(cases, 'delegated');
  fs.writeFileSync(path.join(run, 'evidence', 'delegated.results.json'), json({ typescript: ts, python: py }));
  cases.forEach((c, i) => check('typescript', c, ts[i]));
  cases.forEach((c, i) => check('python', c, py[i]));
  cases.forEach((c, i) => assert.equal(py[i].ledger_key, ts[i].ledger_key, `${c.name}: ledger key`));
});

test('direct route and the signed nonce: the ledger key follows the signed intent only', async (t) => {
  const s = standardState('e');
  const { policy, trust } = tenantConfig(s, 'T1');
  const operator = { tenant: 'T1', policy, trust, profile: profile(), deny_list: lists(s).deny, mandate_list: null };
  const sign = (action, extra = {}) => signAgentBundle(mat, registry, { agent: 'A0', keyset: 'a0-k1', action, args: ARGS(), route: 'direct', ...extra });
  const signed = await sign('order');
  const tampered = structuredClone(signed);
  tampered.bundle.intent.payload.session_nonce = generateSessionNonce();
  const cases = [
    { name: 'order', bundle: signed, action: 'order', args: ARGS(), expect: { admitted: true, app: 'OK' } },
    { name: 'order_reserialized', bundle: reverseKeys(signed), action: 'order', args: ARGS(), expect: { admitted: true, app: 'OK' } },
    { name: 'order_new_intent', bundle: await sign('order'), action: 'order', args: ARGS(), expect: { admitted: true, app: 'OK' } },
    { name: 'refund_not_in_policy', bundle: await sign('refund'), action: 'refund', args: ARGS(), expect: { admitted: true, app: 'APP_ACTION_NOT_AUTHORIZED' } },
    { name: 'args_not_the_signed_ones', bundle: signed, action: 'order', args: ARGS({ amount: 200 }), expect: { admitted: true, app: 'APP_INTENT_MISMATCH' } },
    { name: 'signed_nonce_tampered', bundle: tampered, action: 'order', args: ARGS(), expect: { admitted: false, includes: 'VERIFICATION_FAILED', app: null } },
  ].map((c) => ({ ...c, route: 'direct', evidence: { signedBundle: c.bundle }, operator }));
  const ts = [];
  for (const c of cases) {
    const r = await admitSignedBundleV2(structuredClone(c.bundle), registry, {
      profile: profile(),
      trust,
      revocation: agentKeySnapshot(operator.deny_list, compositionSubjects(c.bundle)),
    });
    const out = { name: c.name, admitted: r.admitted, action_authorized: r.action_authorized, codes: codesOf(r.errors) };
    if (!r.admitted) {
      ts.push({ ...out, app: null, ledger_key: null });
      continue;
    }
    const b = c.bundle.bundle;
    const d = authorize({
      contract,
      policy,
      route: 'direct',
      action: c.action,
      args: c.args,
      intent: b.intent.payload,
      agentId: b.agent_passport.payload.agent_id,
      principalId: b.responsible_principal_record.payload.human_id,
    });
    ts.push({ ...out, app: d.ok ? 'OK' : d.code, ledger_key: d.ok ? actionKey('T1', b.intent.payload_hash) : null });
  }
  const py = crossCheck(cases.map(({ bundle, ...c }) => c), 'direct');
  fs.writeFileSync(path.join(run, 'evidence', 'direct.results.json'), json({ typescript: ts, python: py }));
  for (const [lane, results] of [['typescript', ts], ['python', py]]) {
    cases.forEach((c, i) => {
      const got = results[i];
      const where = `${lane} ${c.name}: ${JSON.stringify(got)}`;
      assert.equal(got.admitted, c.expect.admitted, where);
      assert.equal(got.action_authorized, false, where);
      if (c.expect.includes) assert.ok(got.codes.includes(c.expect.includes), where);
      if (c.expect.admitted) assert.deepEqual(got.codes, [], where);
      assert.equal(got.app, c.expect.app, where);
    });
  }
  const key = (name) => ts[cases.findIndex((c) => c.name === name)].ledger_key;
  assert.equal(key('order_reserialized'), key('order'), 'the key ignores the serialization');
  assert.notEqual(key('order_new_intent'), key('order'), 'a new signed intent is a new action');
  cases.forEach((c, i) => assert.equal(py[i].ledger_key, ts[i].ledger_key, `${c.name}: ledger key`));
  const ledger = tmpDir(t, 'mp05-ledger-direct-');
  assert.equal(reserve(ledger, 'T1', key('order')), true);
  assert.equal(reserve(ledger, 'T1', key('order_reserialized')), false, 'a replay with another serialization is caught');
  assert.equal(reserve(ledger, 'T1', key('order_new_intent')), true);
});

test('ledger: one reservation per key, short writes fail closed, effects stay parseable', (t) => {
  const dir = tmpDir(t, 'mp05-ledger-');
  const zeros = `sha256:${'0'.repeat(64)}`;
  assert.equal(actionKey('T1', zeros), KEY_VECTOR);
  assert.notEqual(actionKey('T2', zeros), KEY_VECTOR);
  for (const [t, h] of [['T 1', zeros], ['T1', 'sha256:XYZ'], ['T1', '0'.repeat(64)], [1, zeros]]) {
    assert.throws(() => actionKey(t, h), LedgerError);
  }
  assert.equal(reserve(dir, 'T1', KEY_VECTOR), true);
  assert.equal(reserve(dir, 'T1', KEY_VECTOR), false);
  assert.deepEqual(reservations(dir, 'T1'), [KEY_VECTOR]);
  assert.equal(reserve(dir, 'T2', KEY_VECTOR), true);
  assert.equal(fs.statSync(path.join(dir, 'T1')).mode & 0o777, 0o700);
  const short = (fd, buf, off, len) => fs.writeSync(fd, buf, off, len - 5);
  const k = actionKey('T1', `sha256:${'1'.repeat(64)}`);
  assert.throws(() => reserve(dir, 'T1', k, { write: short }), /short write/);
  assert.equal(reserve(dir, 'T1', k), false, 'a failed reservation stays consumed: at most one attempt');
  const effects = path.join(dir, 'executions.jsonl');
  appendEffect(effects, { key: 'a' });
  appendEffect(effects, { key: 'b' });
  assert.deepEqual(readEffects(effects).map((r) => r.key), ['a', 'b']);
  assert.throws(() => appendEffect(effects, { key: 'c' }, { write: short }), /short write/);
  assert.throws(() => readEffects(effects), LedgerError);
});

test('ledger: between two processes that try every key, each key is reserved exactly once', async (t) => {
  const evidence = {};
  for (const pair of [
    ['node', 'node'],
    ['node', 'python'],
  ]) {
    const dir = tmpDir(t, 'mp05-race-');
    const keys = Array.from({ length: 200 }, (_, i) => actionKey('T1', `sha256:${String(i).padStart(64, '0')}`));
    const keysFile = path.join(dir, 'keys.json');
    fs.writeFileSync(keysFile, JSON.stringify(keys));
    const startAt = String(Date.now() + 1500);
    const command = (who) =>
      who === 'node'
        ? [process.execPath, [path.join(KIT, 'node', 'test', 'ledger-race-child.mjs'), dir, 'T1', startAt, keysFile]]
        : [PYTHON, ['-I', path.join(KIT, 'python', 'ledger_race_child.py'), dir, 'T1', startAt, keysFile]];
    const started = pair.map((who) => startChild(...command(who)));
    let results;
    try {
      results = await Promise.all(started.map((s) => s.done));
    } finally {
      for (const { child } of started) if (stillRunning(child)) child.kill('SIGKILL');
    }
    // The property is exactly one reservation per key; how the scheduler splits them between processes is not.
    assert.equal(new Set(results.map((r) => r.pid)).size, results.length, 'distinct processes');
    for (const r of results) assert.equal(r.attempted, keys.length, 'each process tried every key');
    const won = results.flatMap((r) => r.won);
    assert.equal(won.length, keys.length, 'no key reserved twice');
    assert.deepEqual([...won].sort(), [...keys].sort(), 'every key reserved');
    assert.deepEqual(reservations(dir, 'T1'), [...keys].sort());
    evidence[pair.join('+')] = results.map((r, i) => ({ process: pair[i], pid: r.pid, attempted: r.attempted, won: r.won.length }));
  }
  fs.writeFileSync(path.join(run, 'evidence', 'ledger-race.json'), json(evidence));
});

test('output and staging guards resolve symbolic links (synthetic Git work tree)', async (t) => {
  const base = fs.realpathSync(tmpDir(t, 'mp05-guard-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'sub'));
  fs.symlinkSync(path.join(repo, 'sub'), path.join(base, 'link-to-sub'));
  fs.symlinkSync(path.join(base, 'missing'), path.join(base, 'dangling'));
  for (const p of [
    path.join(repo, 'sub', 'out'),
    path.join(base, 'link-to-sub'),
    path.join(base, 'link-to-sub', 'out'),
    path.join(base, 'link-to-sub', 'a', 'b'),
  ]) {
    assert.throws(() => assertOutsideGit(p), /inside the Git work tree/, p);
  }
  assert.throws(() => assertOutsideGit(path.join(base, 'dangling', 'out')), /cannot be resolved/);
  assert.doesNotThrow(() => assertOutsideGit(path.join(base, 'outside', 'out')));
  await assert.rejects(generate(path.join(base, 'link-to-sub', 'material')), /inside the Git work tree/);
  assert.throws(() => op.init(path.join(base, 'link-to-sub', 'state')), /inside the Git work tree/);
  assert.deepEqual(fs.readdirSync(path.join(repo, 'sub')), [], 'nothing written through the link');

  // stage.mjs, from a copy of this kit inside the synthetic repository.
  const kit = path.join(repo, 'kit');
  fs.cpSync(KIT, kit, { recursive: true });
  const consumerStub = (dir) => {
    fs.mkdirSync(path.join(dir, 'node', 'node_modules', '@dcp-ai', 'sdk'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node', 'node_modules', '@dcp-ai', 'sdk', 'package.json'), '{}');
    return dir;
  };
  const stage = (consumer) => spawnSync(process.execPath, [path.join(kit, 'node', 'stage.mjs'), '--consumer', consumer], { encoding: 'utf8' });
  consumerStub(path.join(repo, 'consumer'));
  fs.symlinkSync(path.join(repo, 'consumer'), path.join(base, 'consumer-link'));
  const viaLink = stage(path.join(base, 'consumer-link'));
  assert.equal(viaLink.status, 2, viaLink.stderr);
  assert.match(viaLink.stderr, /physically inside the repository/);
  assert.ok(!fs.existsSync(path.join(repo, 'consumer', 'node', 'rehearsal')));

  const consumer = consumerStub(path.join(base, 'consumer'));
  const elsewhere = path.join(base, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'STAGED.json'), '{}');
  fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'kept');
  fs.symlinkSync(elsewhere, path.join(consumer, 'node', 'rehearsal'));
  const linkedDest = stage(consumer);
  assert.equal(linkedDest.status, 2, linkedDest.stderr);
  assert.match(linkedDest.stderr, /symbolic link or not a directory/);
  assert.equal(fs.readFileSync(path.join(elsewhere, 'keep.txt'), 'utf8'), 'kept', 'the link target is untouched');

  fs.unlinkSync(path.join(consumer, 'node', 'rehearsal'));
  const valid = stage(consumer);
  assert.equal(valid.status, 0, valid.stderr);
  assert.ok(fs.existsSync(path.join(consumer, 'node', 'rehearsal', 'STAGED.json')), 'a valid destination is staged');
});
