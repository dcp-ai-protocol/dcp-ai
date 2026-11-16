// Runner of the MP-05 rehearsal (TEST ONLY): G1-G10 on both lanes, against real servers on 127.0.0.1.
//
//   node node/runner.mjs --work DIR --consumer DIR --verify-report FILE [--lanes node,python] [--keep-secrets]
//
// Started only by node/rehearse.mjs (verify.py, staging, a 900 s supervisor), with an IPC channel: the supervisor
// creates and stops every server on the runner's request (node/supervise.mjs), so it knows each one from the moment it
// exists and can clean it even when the runner is killed. It writes report.json as
// "incomplete" first, in a new run directory, and the plan with every expectation before the first request. Each step
// records status, codes, the authenticated tenant, the deltas of reservations, effects and source calls, and
// failures; a refusal is never inferred from an exception. Servers are supervised by ../process.mjs and stopped in a
// finally; an unclean stop fails the run. Secrets are collected and scanned for in the evidence (../secrets.mjs), then
// deleted, always in the finally. Exit code 0 only when every step passed, every server stopped cleanly and the scan
// found nothing.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSecrets, scanSecrets } from '../secrets.mjs';
import { evidenceRoots, secretDirs } from './evidence.mjs';
import { KIT, assertInstalledSdk, assertOutsideGit, assertVerified, checkStaged, iso, isObject, json, readJson, writeAtomic, writeNew } from './common.mjs';
import { chainEvidence, generate, loadMaterial, newRegistry, signAgentBundle } from './fixtures.mjs';
import { readEffects, reservations } from './ledger.mjs';
import * as op from './operator.mjs';
import { buildPlan, checkPlan, evaluateStep } from './plan.mjs';

export const REPORT_FORMAT = 'dcp-ai-mp05-rehearsal-report-v1';
const TENANTS = ['T1', 'T2', 'T3'];
const REQUEST_MS = 10_000;
const GROUP_MS = 60_000;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** A new run directory: never an existing one, so an old report is never reused. */
export function createRunDir(work, id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`) {
  const dir = path.join(work, `run-${id}`);
  fs.mkdirSync(dir); // not recursive: an existing directory is an error
  return { id, dir };
}

// IPC with the supervisor: one pending reply per request id.
const pending = new Map();
let requests = 0;
process.on('message', (m) => {
  const wake = pending.get(m?.id);
  if (wake) {
    pending.delete(m.id);
    wake(m);
  }
});
function ask(msg) {
  if (!process.send || !process.connected) throw new Error('the runner must be started by node/rehearse.mjs (no supervisor channel)');
  return new Promise((resolve) => {
    pending.set(msg.id, resolve);
    process.send(msg);
  });
}

/** A server the supervisor creates and stops on the runner's behalf. */
class SupervisedServer {
  constructor(name, argv, { cwd, env }) {
    requests += 1;
    Object.assign(this, { id: `${name}-${requests}`, name, argv, cwd, env, pid: null, port: null, stderr: '' });
  }

  async ready(ms) {
    const r = await ask({ type: 'spawn', id: this.id, name: this.name, argv: this.argv, cwd: this.cwd, env: this.env, readyMs: ms });
    if (r.type !== 'ready') throw new Error(`${this.name}: ${r.error}`);
    Object.assign(this, { port: r.port, pid: r.pid });
    return this;
  }

  async stop() {
    const r = await ask({ type: 'stop', id: this.id });
    if (r.type !== 'stopped') return { clean: false, error: r.error ?? 'stop refused' };
    this.stderr = r.result.stderr ?? '';
    return r.result;
  }
}

const reverseKeys = (v) =>
  Array.isArray(v) ? v.map(reverseKeys) : isObject(v) ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;

function manifestOverride(kind, now = Date.now()) {
  if (kind === 'expired') return { session_issued_at: iso(now - 400_000), session_expires_at: iso(now - 100_000) };
  if (kind === 'audience') return { intended_verifier: 'verifier:someone-else' };
  return undefined;
}

/** Textual mutations of a valid body, for G10. Each must apply exactly where intended. */
function mutate(text, mutation, budget) {
  const replaceOnce = (from, to) => {
    if (text.split(from).length !== 2) throw new Error(`mutation ${mutation} does not apply exactly once`);
    return Buffer.from(text.replace(from, to), 'utf8');
  };
  switch (mutation) {
    case 'duplicate_key_in_envelope':
      return Buffer.from(`{"args":${JSON.stringify(JSON.parse(text).args)},${text.slice(1)}`, 'utf8');
    case 'duplicate_key_in_args':
      return replaceOnce('"args":{"sku":"SKU-1",', '"args":{"sku":"SKU-1","sku":"SKU-1",');
    case 'duplicate_key_in_bundle':
      return text.startsWith('{"evidence":')
        ? replaceOnce('"evidence":{"signed_bundle":{"bundle":{', '"evidence":{"signed_bundle":{"bundle":{"dcp_bundle_version":"2.0",')
        : replaceOnce('"signed_bundle":{"bundle":{', '"signed_bundle":{"bundle":{"dcp_bundle_version":"2.0",');
    case 'fraction':
      return replaceOnce('"amount":100,', '"amount":100.0,');
    case 'rounded_fraction':
      // 100.0000000000000001 is 100 in binary64: a native parser would round it, the ingress refuses it first.
      return replaceOnce('"amount":100,', '"amount":100.0000000000000001,');
    case 'exponent':
      return replaceOnce('"amount":100,', '"amount":1e2,');
    case 'negative_zero':
      return replaceOnce('"amount":100,', '"amount":-0,');
    case 'lone_surrogate':
      return replaceOnce('"sku":"SKU-1"', '"sku":"\\ud800"');
    case 'invalid_utf8': {
      const at = text.indexOf('"sku":"SKU-1"');
      if (at < 0 || text.indexOf('"sku":"SKU-1"', at + 1) >= 0) throw new Error('mutation invalid_utf8 does not apply exactly once');
      const head = Buffer.from(text.slice(0, at + 7), 'utf8');
      return Buffer.concat([head, Buffer.from([0xff]), Buffer.from(text.slice(at + 7), 'utf8')]);
    }
    case 'over_budget':
    case 'over_budget_chunked':
      return Buffer.from(text + ' '.repeat(budget + 1 - Buffer.byteLength(text)), 'utf8');
    case 'envelope_member':
      return Buffer.from(`{"note":"x",${text.slice(1)}`, 'utf8');
    default:
      return Buffer.from(text, 'utf8'); // bundle_header and content_type change headers only
  }
}

class Lane {
  constructor(runner, name) {
    Object.assign(this, { runner, name, bodies: {}, servers: [], savedLists: {} });
    this.dir = path.join(runner.dir, 'lanes', name);
    this.state = path.join(this.dir, 'state');
    this.run = path.join(this.dir, 'run');
  }

  async start() {
    const { material, args } = this.runner;
    fs.mkdirSync(this.run, { recursive: true });
    op.init(this.state);
    const doc = (k) => path.join(material.dir, 'public', 'principals', `${k}.keys.json`);
    op.enroll(this.state, 'T2', doc('q-k1'), fs.readFileSync(path.join(material.dir, 'oob', 'q-k1.fingerprint'), 'utf8'));
    this.tokens = readJson(path.join(this.state, 'secrets', 'tokens.json'));
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'C.UTF-8' };
    const serviceConfig = path.join(this.dir, 'service.json');
    writeNew(serviceConfig, json({ state: this.state, run: this.run }));
    this.service = this.supervise('revocation-service', [process.execPath, path.join(KIT, 'node', 'revocation-service.mjs'), serviceConfig], env);
    await this.service.ready(20_000);
    this.serviceBase = `http://127.0.0.1:${this.service.port}`;
    const appConfig = path.join(this.dir, 'app.json');
    writeNew(
      appConfig,
      json({
        lane: this.name,
        consumer: args.consumer,
        verify_report: args.verifyReport,
        state: this.state,
        run: this.run,
        revocation: { deny_list_url: `${this.serviceBase}/deny-list.json`, mandates_url: `${this.serviceBase}/mandates.json` },
      }),
    );
    const argv =
      this.name === 'node'
        ? [process.execPath, path.join(KIT, 'node', 'app-express.mjs'), appConfig]
        : [path.join(args.consumer, 'python', 'bin', 'python'), '-I', path.join(KIT, 'python', 'app_fastapi.py'), appConfig];
    this.app = this.supervise(this.name === 'node' ? 'app-express' : 'app-fastapi', argv, env);
    await this.app.ready(20_000);
    this.base = `http://127.0.0.1:${this.app.port}`;
  }

  /** A server created by the supervisor, which owns it from the moment it exists. */
  supervise(name, argv, env) {
    const proc = new SupervisedServer(name, argv, { cwd: KIT, env });
    this.servers.push({ name, proc });
    return proc;
  }

  async stop() {
    const results = [];
    for (const { name, proc } of [...this.servers].reverse()) {
      const r = await proc.stop();
      fs.writeFileSync(path.join(this.dir, `${name}.stderr.log`), proc.stderr);
      results.push({ lane: this.name, server: name, pid: proc.pid, clean: r.clean, exit: r.exit, retained_before_cleanup: r.retained_before_cleanup, group_left: r.group_left, error: r.error ?? null });
    }
    this.servers = [];
    return results;
  }

  async getJson(url) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.tokens.operator}` }, signal: AbortSignal.timeout(REQUEST_MS) });
    if (res.status !== 200) throw new Error(`${url} answered ${res.status}`);
    return res.json();
  }

  async snapshot() {
    const appState = await this.getJson(`${this.base}/v1/operator/state`);
    const stats = await this.getJson(`${this.serviceBase}/stats`);
    const ledger = path.join(this.run, 'ledger');
    return {
      trust: appState.trust_calls,
      deny: stats.queries.deny_list,
      mandates: stats.queries.mandates,
      reservations: TENANTS.reduce((n, t) => n + reservations(ledger, t).length, 0),
      effects: readEffects(path.join(this.run, 'executions.jsonl')).length,
    };
  }

  async observations(ids, ms = 3_000) {
    const file = path.join(this.run, 'observations.jsonl');
    for (const deadline = Date.now() + ms; ; ) {
      const seen = readEffects(file).filter((o) => ids.includes(o.request_id));
      if (seen.length >= ids.length || Date.now() > deadline) return ids.map((id) => seen.find((o) => o.request_id === id) ?? null);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async action(a) {
    const { material } = this.runner;
    const ids = material.manifest.identities;
    const trustFile = path.join(this.state, 'operator', 'tenants', a.tenant ?? 'T1', 'trust.json');
    const document = (keyset, tamper) => {
      const file = path.join(material.dir, 'public', 'principals', `${keyset}.keys.json`);
      if (!tamper) return file;
      const copy = path.join(this.dir, `${keyset}.tampered.json`);
      fs.writeFileSync(copy, JSON.stringify({ ...readJson(file), human_id: ids.Q }));
      return copy;
    };
    const fingerprint = (keyset) => fs.readFileSync(path.join(material.dir, 'oob', `${keyset}.fingerprint`), 'utf8');
    switch (a.op) {
      case 'refresh-lists':
        op.refreshLists(this.state); // the operator's explicit refresh; the service never refreshes on its own
        return {};
      case 'list-file': {
        // The operator publishing a list that is really old, has a malformed date, or cannot be read; "fresh" puts
        // the last good list back and refreshes it.
        const file = path.join(this.state, 'operator', 'revocation', a.list === 'deny' ? 'deny-list.json' : 'mandates.json');
        const put = (text) => {
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, text);
          fs.renameSync(tmp, file);
        };
        if (a.state === 'fresh') {
          if (this.savedLists[a.list] !== undefined) put(this.savedLists[a.list]);
          delete this.savedLists[a.list];
          op.refreshLists(this.state);
          return {};
        }
        this.savedLists[a.list] ??= fs.readFileSync(file, 'utf8');
        const doc = JSON.parse(this.savedLists[a.list]);
        if (a.state === 'unreadable') put('{');
        else if (a.state === 'aged') put(JSON.stringify({ ...doc, updated_at: iso(Date.now() - 600_000) }));
        else if (a.state === 'malformed_date') put(JSON.stringify({ ...doc, updated_at: 'not-a-date' }));
        else throw new Error(`unknown list state ${a.state}`);
        return {};
      }
      case 'enroll':
      case 'add-key': {
        const before = fs.readFileSync(trustFile);
        try {
          op.enroll(this.state, a.tenant, document(a.document, a.tamper), fingerprint(a.fingerprint), { addKey: a.op === 'add-key' });
        } catch (e) {
          if (!a.refused) throw e;
          return { operator: e.code, trust_unchanged: fs.readFileSync(trustFile).equals(before) };
        }
        if (a.refused) return { operator: 'accepted', trust_unchanged: fs.readFileSync(trustFile).equals(before) };
        return {};
      }
      case 'withdraw':
        return op.withdraw(this.state, a.tenant, ids[a.principal]) && {};
      case 'restore':
        return op.restore(this.state, a.tenant, ids[a.principal]) && {};
      case 'retire-key':
        return op.retireKey(this.state, a.tenant, ids[a.principal], material.manifest.keysets[a.keyset].kids) && {};
      case 'revoke-agent':
        return op.editRevocation(this.state, { revokeAgents: [ids[a.agent]] }) ?? {};
      case 'unrevoke-agent':
        return op.editRevocation(this.state, { unrevokeAgents: [ids[a.agent]] }) ?? {};
      case 'revoke-kid':
        return op.editRevocation(this.state, { revokeKids: [material.manifest.keysets[a.keyset].kids[0]] }) ?? {};
      case 'unrevoke-kid':
        return op.editRevocation(this.state, { unrevokeKids: [material.manifest.keysets[a.keyset].kids[0]] }) ?? {};
      case 'revoke-mandate':
        return op.editRevocation(this.state, { revokeMandates: [a.mandate] }) ?? {};
      case 'unrevoke-mandate':
        return op.editRevocation(this.state, { unrevokeMandates: [a.mandate] }) ?? {};
      case 'mode': {
        const res = await fetch(`${this.serviceBase}/mode`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.tokens.operator}`, 'content-type': 'application/json' },
          body: JSON.stringify({ mode: a.mode }),
          signal: AbortSignal.timeout(REQUEST_MS),
        });
        if (res.status !== 200) throw new Error(`service mode ${a.mode}: ${res.status}`);
        return {};
      }
      default:
        throw new Error(`unknown operator action ${a.op}`);
    }
  }

  /** The body of a request spec, as the bytes to send, the route, the action and extra headers. */
  async build(spec) {
    const { material, registry } = this.runner;
    if (spec.kind === 'direct') {
      const signed = await signAgentBundle(material, registry, {
        agent: 'A0',
        keyset: 'a0-k1',
        principalKeyset: spec.principalKeyset ?? 'p-k1',
        action: spec.action,
        args: spec.args,
        route: 'direct',
        manifest: manifestOverride(spec.manifest),
      });
      const envelope = { signed_bundle: signed, args: spec.requestArgs ?? spec.args, ...(spec.envelope ?? {}) };
      return { route: 'direct', action: spec.action, text: JSON.stringify(envelope) };
    }
    if (spec.kind === 'delegated') {
      const ev = await chainEvidence(
        material,
        registry,
        spec.chain,
        { action: spec.action, args: spec.args, route: spec.signRoute ?? 'delegated', intent: spec.intent, manifest: manifestOverride(spec.manifest) },
        spec.over ?? {},
      );
      const evidence = {
        signed_bundle: ev.signedBundle,
        mandate_chain: ev.mandateChain,
        delegator_bundles: ev.delegatorBundles,
        acknowledgments: ev.acknowledgments,
        awareness_thresholds: ev.awarenessThresholds,
      };
      return { route: 'delegated', action: spec.action, text: JSON.stringify({ evidence, args: spec.requestArgs ?? spec.args }) };
    }
    throw new Error(`cannot build ${spec.kind}`);
  }

  async send(route, action, bytes, { tenant, headers = {}, requestId, chunked = false }) {
    const h = { 'content-type': 'application/json', 'x-request-id': requestId, ...headers };
    if (tenant === 'unknown') h.authorization = `Bearer ${crypto.randomBytes(32).toString('hex')}`;
    else if (tenant) h.authorization = `Bearer ${this.tokens.tenants[tenant]}`;
    const parse = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return { unparseable: true };
      }
    };
    if (chunked) return this.sendChunked(route, action, bytes, h, parse);
    const res = await fetch(`${this.base}/v1/${route}/actions/${action}`, { method: 'POST', headers: h, body: bytes, signal: AbortSignal.timeout(REQUEST_MS) });
    return { status: res.status, body: parse(await res.text()) };
  }

  /** The body in 16 KiB chunks, Transfer-Encoding chunked and no Content-Length: the server must count while reading. */
  sendChunked(route, action, bytes, headers, parse) {
    return new Promise((resolve, reject) => {
      let answered = false;
      const req = http.request({
        host: '127.0.0.1',
        port: this.app.port,
        method: 'POST',
        path: `/v1/${route}/actions/${action}`,
        headers: { ...headers, 'transfer-encoding': 'chunked' },
      });
      const timer = setTimeout(() => req.destroy(new Error('chunked request deadline exceeded')), REQUEST_MS);
      req.on('response', (res) => {
        answered = true;
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode, body: parse(text) });
        });
      });
      req.on('error', (e) => {
        if (!answered) {
          clearTimeout(timer);
          reject(e);
        }
      });
      for (let at = 0; at < bytes.length; at += 16384) req.write(bytes.subarray(at, at + 16384));
      req.end();
    });
  }

  async step(step) {
    const started = Date.now();
    const observed = { request_sha256: [] };
    try {
      const before = await this.snapshot();
      for (const a of step.before) Object.assign(observed, await this.action(a));
      const spec = step.request;
      if (spec) {
        const rid = (n) => `${step.id}-${n}`;
        if (spec.kind === 'concurrent') {
          const built = await this.build(spec.request);
          const bytes = Buffer.from(built.text, 'utf8');
          this.bodies[step.name] = built;
          const ids = Array.from({ length: spec.count }, (_, n) => rid(n));
          const results = await Promise.all(ids.map((id) => this.send(built.route, built.action, bytes, { tenant: spec.request.tenant, requestId: id })));
          observed.responses = results.map((r) => ({ status: r.status, body: { code: r.body.code ?? null, ok: r.body.ok, application_authorized: r.body.application_authorized, dcp: r.body.dcp } }));
          // An absent observation is "missing"; a null tenant is a real observation of no tenant.
          observed.tenants = (await this.observations(ids)).map((o) => (o ? o.tenant : 'missing'));
          observed.request_sha256 = [sha256(bytes)];
        } else {
          let built;
          let bytes;
          let headers = spec.headers ?? {};
          let tenant = spec.tenant;
          if (spec.kind === 'replay') {
            built = this.bodies[spec.of];
            if (!built) throw new Error(`nothing to replay from ${spec.of}`);
            tenant = 'T1';
            bytes = Buffer.from(spec.reserialize ? JSON.stringify(reverseKeys(JSON.parse(built.text))) : built.text, 'utf8');
          } else if (spec.kind === 'raw') {
            built = await this.build(spec.base);
            tenant = spec.base.tenant;
            const budget = this.runner.contract.routes[built.route].max_body_bytes;
            bytes = mutate(built.text, spec.mutation, budget);
            if (spec.mutation === 'bundle_header') headers = { 'x-dcp-bundle': JSON.stringify({ bundle: { dcp_bundle_version: '2.0' }, signature: {} }) };
            if (spec.mutation === 'content_type') headers = { 'content-type': 'text/plain' };
          } else {
            built = await this.build(spec);
            bytes = Buffer.from(built.text, 'utf8');
          }
          this.bodies[step.name] = built;
          const chunked = spec.kind === 'raw' && spec.mutation === 'over_budget_chunked';
          const r = await this.send(built.route, built.action, bytes, { tenant, headers, requestId: rid(0), chunked });
          observed.status = r.status;
          observed.body = r.body;
          const [seen] = await this.observations([rid(0)]);
          observed.tenant = seen ? seen.tenant : 'missing'; // absent observation vs a real null tenant
          observed.request_sha256 = [sha256(bytes)];
        }
      }
      const after = await this.snapshot();
      observed.deltas = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]));
    } catch (e) {
      observed.error = e.message;
    }
    const failures = evaluateStep(step, observed);
    const body = observed.body ?? {};
    return {
      id: step.id,
      lane: step.lane,
      group: step.group,
      valid: step.valid,
      result: failures.length === 0 ? 'PASS' : 'FAIL',
      expected: step.expect,
      observed: {
        error: observed.error ?? null,
        status: observed.status ?? null,
        code: body.code ?? null,
        codes: body.codes ?? null,
        dcp: body.dcp ?? null,
        admitted: body.admitted ?? null,
        activation_codes: body.activation_codes ?? null,
        reason: body.reason ?? null,
        tenant: observed.tenant ?? null,
        tenants: observed.tenants ?? null,
        responses: observed.responses?.map((r) => r.status) ?? null,
        operator: observed.operator ?? null,
        trust_unchanged: observed.trust_unchanged ?? null,
        deltas: observed.deltas ?? null,
      },
      request_sha256: observed.request_sha256,
      failures,
      duration_ms: Date.now() - started,
    };
  }
}

function parseArgs(argv) {
  const out = { lanes: ['node', 'python'], keepSecrets: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep-secrets') out.keepSecrets = true;
    else if (a === '--work') out.work = path.resolve(argv[++i]);
    else if (a === '--consumer') out.consumer = path.resolve(argv[++i]);
    else if (a === '--verify-report') out.verifyReport = path.resolve(argv[++i]);
    else if (a === '--lanes') out.lanes = argv[++i].split(',');
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.work || !out.consumer || !out.verifyReport || !out.lanes.every((l) => ['node', 'python'].includes(l))) {
    throw new Error('usage: node node/runner.mjs --work DIR --consumer DIR --verify-report FILE [--lanes node,python] [--keep-secrets]');
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertInstalledSdk();
  checkStaged();
  assertVerified(args.verifyReport, args.consumer);
  assertOutsideGit(args.work);
  const { id, dir } = createRunDir(args.work);
  const reportFile = path.join(dir, 'report.json');
  const report = {
    report_format: REPORT_FORMAT,
    run_id: id,
    status: 'incomplete',
    started_at: iso(Date.now()),
    finished_at: null,
    lanes: args.lanes,
    plan_sha256: null,
    steps: [],
    cleanup: [],
    secret_scan: null,
    failures: [],
  };
  writeAtomic(reportFile, report);
  const runner = { dir, args, contract: JSON.parse(fs.readFileSync(path.join(KIT, 'contract', 'rehearsal-contract.json'), 'utf8')) };
  const lanes = [];
  try {
    const plan = buildPlan(args.lanes);
    checkPlan(plan);
    const planFile = path.join(dir, 'plan.json');
    writeNew(planFile, json(plan));
    report.plan_sha256 = sha256(fs.readFileSync(planFile));
    writeAtomic(reportFile, report);
    await generate(path.join(dir, 'material'));
    runner.material = loadMaterial(path.join(dir, 'material'));
    runner.registry = newRegistry();
    for (const name of args.lanes) {
      const lane = new Lane(runner, name);
      lanes.push(lane);
      try {
        await lane.start();
        let group = null;
        let groupStarted = 0;
        for (const step of plan.steps.filter((s) => s.lane === name)) {
          if (step.group !== group) {
            if (group && Date.now() - groupStarted > GROUP_MS) report.failures.push(`${name}.${group} took over ${GROUP_MS} ms`);
            group = step.group;
            groupStarted = Date.now();
            process.stderr.write(`[rehearsal] ${name} ${group}\n`);
          }
          const result = await lane.step(step);
          report.steps.push(result);
          if (result.result === 'FAIL') process.stderr.write(`[rehearsal] FAIL ${result.id}: ${result.failures.join('; ')}\n`);
        }
        if (group && Date.now() - groupStarted > GROUP_MS) report.failures.push(`${name}.${group} took over ${GROUP_MS} ms`);
      } finally {
        report.cleanup.push(...(await lane.stop()));
        writeAtomic(reportFile, report);
      }
    }
    const missing = plan.steps.filter((s) => !report.steps.some((r) => r.id === s.id)).map((s) => s.id);
    if (missing.length) report.failures.push(`steps not run: ${missing.join(', ')}`);
  } catch (e) {
    report.failures.push(`infrastructure: ${e.message}`);
  } finally {
    for (const lane of lanes) if (lane.servers.length) report.cleanup.push(...(await lane.stop()));
    // The same roots the supervisor uses when the runner dies before reaching this point (node/evidence.mjs).
    const secretRoots = secretDirs(dir);
    try {
      writeAtomic(reportFile, report);
      const scan = scanSecrets(collectSecrets(secretRoots), evidenceRoots(dir));
      report.secret_scan = { pass: scan.pass, files: scan.files, findings: scan.findings, secret_roots: secretRoots.length };
    } catch (e) {
      report.secret_scan = { pass: false, error: e.message };
    }
    if (args.keepSecrets) {
      process.stderr.write('[rehearsal] WARNING: --keep-secrets keeps TEST ONLY private keys and tokens in the run directory\n');
      fs.writeFileSync(path.join(dir, 'SECRETS-KEPT-TEST-ONLY'), 'TEST ONLY secrets were kept on purpose with --keep-secrets\n');
    } else {
      for (const root of secretRoots) fs.rmSync(root, { recursive: true, force: true });
    }
    const failedSteps = report.steps.filter((s) => s.result !== 'PASS').map((s) => s.id);
    const unclean = report.cleanup.filter((c) => !c.clean).map((c) => `${c.lane}.${c.server}`);
    if (failedSteps.length) report.failures.push(`failed steps: ${failedSteps.length}`);
    if (unclean.length) report.failures.push(`unclean stop: ${unclean.join(', ')}`);
    if (!report.secret_scan?.pass) report.failures.push('secret scan did not pass');
    report.status = report.failures.length === 0 && report.steps.length > 0 ? 'PASS' : 'FAIL';
    report.finished_at = iso(Date.now());
    report.summary = {
      steps: report.steps.length,
      passed: report.steps.filter((s) => s.result === 'PASS').length,
      by_lane: Object.fromEntries(args.lanes.map((l) => [l, report.steps.filter((s) => s.lane === l && s.result === 'PASS').length + '/' + report.steps.filter((s) => s.lane === l).length])),
    };
    writeAtomic(reportFile, report);
    process.stderr.write(`[rehearsal] ${report.status} ${report.summary.passed}/${report.summary.steps} steps; report ${reportFile}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
    if (process.connected) process.disconnect(); // the supervisor channel would keep the runner alive
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`[rehearsal] infrastructure failure: ${e.message}\n`);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
