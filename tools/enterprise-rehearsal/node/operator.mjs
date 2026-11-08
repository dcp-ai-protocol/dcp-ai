// Operator tool of the MP-05 rehearsal (TEST ONLY).
//
// Tenants, trust sets, the application policy, bearer tokens and revocation lists come only from the operator's own
// files and flags: never from a request, a bundle or an agent. A principal's keys enter a trust set only when their
// key document matches a fingerprint received out of band (no self-trusted keys); every trust set written is
// validated by the SDK (createPrincipalTrustStore) first. Run from a staged kit inside the Node consumer:
//
//   node node/operator.mjs <command> --state DIR [options]       (see USAGE)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrincipalTrustStore, deriveKid } from '@dcp-ai/sdk';
import {
  assertInstalledSdk,
  assertOutsideGit,
  iso,
  isObject,
  loadContract,
  loadScenario,
  readJson,
  sha256Hex,
  sha256Of,
  writeAtomic,
} from './common.mjs';
import { KEY_DOCUMENT_FORMAT } from './fixtures.mjs';

export const POLICY_FORMAT = 'dcp-ai-mp05-operator-policy-v1';
const TENANT = /^[A-Za-z0-9_-]{1,32}$/;
const KEY_ALGS = new Set(['ed25519', 'ml-dsa-65']);
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class OperatorError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const opDir = (state) => path.join(state, 'operator');
function tenantDir(state, tenant) {
  if (typeof tenant !== 'string' || !TENANT.test(tenant)) throw new OperatorError('OP_TENANT_INVALID', String(tenant));
  return path.join(opDir(state), 'tenants', tenant);
}
const trustFile = (state, tenant) => path.join(tenantDir(state, tenant), 'trust.json');
const archiveFile = (state, tenant) => path.join(tenantDir(state, tenant), 'withdrawn.json');
const listFile = (state, name) => path.join(opDir(state), 'revocation', name);

function log(state, entry) {
  fs.appendFileSync(path.join(opDir(state), 'log.jsonl'), `${JSON.stringify({ at: iso(Date.now()), ...entry })}\n`, {
    mode: 0o600,
  });
}

function bump(version) {
  const m = /^(.*\.)(\d+)$/.exec(version);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${version}.1`;
}

function policyOf(tenant, t, contract) {
  const actions = Object.keys(contract.actions);
  const table = (v, what) => {
    if (!isObject(v)) throw new OperatorError('OP_SCENARIO_INVALID', `${tenant}.${what}`);
    for (const [id, list] of Object.entries(v)) {
      if (!Array.isArray(list) || !list.every((a) => actions.includes(a))) {
        throw new OperatorError('OP_SCENARIO_INVALID', `${tenant}.${what}.${id}`);
      }
    }
    return v;
  };
  if (!isObject(t.max_amount)) throw new OperatorError('OP_SCENARIO_INVALID', `${tenant}.max_amount`);
  for (const [a, cap] of Object.entries(t.max_amount)) {
    if (!actions.includes(a) || !Number.isSafeInteger(cap) || cap < 0) {
      throw new OperatorError('OP_SCENARIO_INVALID', `${tenant}.max_amount.${a}`);
    }
  }
  return {
    policy_format: POLICY_FORMAT,
    tenant,
    policy_version: `${tenant}.1`,
    domain: contract.domain,
    direct_agents: table(t.direct_agents, 'direct_agents'),
    delegated_principals: table(t.delegated_principals, 'delegated_principals'),
    max_amount: t.max_amount,
  };
}

/** Creates the operator state: policies, empty trust sets, TEST ONLY tokens (hashes only outside secrets/), lists. */
export function init(state, { now = Date.now() } = {}) {
  assertOutsideGit(state);
  if (fs.existsSync(opDir(state))) throw new OperatorError('OP_STATE_EXISTS', opDir(state));
  const contract = loadContract();
  const scenario = loadScenario();
  const tokens = { tenants: {}, operator: crypto.randomBytes(32).toString('hex') };
  const hashes = { tenants: {}, operator: sha256Hex(tokens.operator) };
  for (const [tenant, t] of Object.entries(scenario.tenants)) {
    writeAtomic(path.join(tenantDir(state, tenant), 'policy.json'), policyOf(tenant, t, contract));
    if (t.trust_set) {
      writeAtomic(trustFile(state, tenant), { trust_set_version: `${tenant}.1`, principals: [] });
      writeAtomic(archiveFile(state, tenant), { withdrawn: [] });
    }
    tokens.tenants[tenant] = crypto.randomBytes(32).toString('hex');
    hashes.tenants[tenant] = sha256Hex(tokens.tenants[tenant]);
  }
  fs.mkdirSync(path.join(state, 'secrets'), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(state, 'secrets'), 0o700);
  writeAtomic(path.join(state, 'secrets', 'tokens.json'), { test_only: true, ...tokens }, 0o600);
  writeAtomic(path.join(opDir(state), 'tokens.json'), { token_hash: 'sha256 hex of the UTF-8 token', ...hashes }, 0o600);
  const updated_at = iso(now);
  writeAtomic(listFile(state, 'deny-list.json'), { updated_at, revocations: [], kid_revocations: [] });
  writeAtomic(listFile(state, 'mandates.json'), { updated_at, revoked_mandates: [] });
  writeAtomic(path.join(opDir(state), 'scenario.json'), {
    contract_version: contract.contract_version,
    scenario_version: scenario.scenario_version,
    scenario_sha256: sha256Of(scenario),
  });
  log(state, { command: 'init', tenants: Object.keys(scenario.tenants) });
}

function validateKeyDocument(doc) {
  const bad = (m) => {
    throw new OperatorError('OP_KEY_DOCUMENT_INVALID', m);
  };
  if (!isObject(doc) || Object.keys(doc).sort().join() !== 'human_id,key_document_format,keys') bad('members');
  if (doc.key_document_format !== KEY_DOCUMENT_FORMAT) bad('key_document_format');
  if (typeof doc.human_id !== 'string' || doc.human_id === '') bad('human_id');
  if (!Array.isArray(doc.keys) || doc.keys.length === 0) bad('keys');
  const seen = new Set();
  for (const k of doc.keys) {
    if (!isObject(k) || Object.keys(k).sort().join() !== 'alg,kid,public_key_b64') bad('key members');
    if (!KEY_ALGS.has(k.alg)) bad(`alg ${String(k.alg)}`);
    if (typeof k.public_key_b64 !== 'string' || !B64.test(k.public_key_b64)) bad('public_key_b64');
    const bytes = Buffer.from(k.public_key_b64, 'base64');
    if (bytes.toString('base64') !== k.public_key_b64) bad('public_key_b64 is not canonical base64');
    if (deriveKid(k.alg, bytes) !== k.kid) bad(`kid ${String(k.kid)} is not derived from its key`);
    if (seen.has(k.kid)) bad(`kid ${k.kid} twice`);
    seen.add(k.kid);
  }
}

function commitTrust(state, tenant, before, next, entry) {
  next.trust_set_version = bump(before.trust_set_version);
  try {
    createPrincipalTrustStore(next);
  } catch (e) {
    throw new OperatorError('OP_TRUST_SET_INVALID', e.message);
  }
  writeAtomic(trustFile(state, tenant), next);
  log(state, { tenant, trust_set_version: next.trust_set_version, ...entry });
  return next;
}

function readTrust(state, tenant) {
  const file = trustFile(state, tenant);
  if (!fs.existsSync(file)) throw new OperatorError('OP_NO_TRUST_SET', tenant);
  return readJson(file);
}

/**
 * Enrols a principal's keys (or adds keys to an enrolled principal with addKey) after checking the key document
 * against the fingerprint the operator received out of band. Nothing changes when they differ.
 */
export function enroll(state, tenant, documentFile, fingerprint, { addKey = false } = {}) {
  const command = addKey ? 'add-key' : 'enroll';
  const doc = readJson(documentFile);
  validateKeyDocument(doc);
  const computed = sha256Of(doc);
  const presented = String(fingerprint ?? '').trim();
  const same = presented.length === computed.length && crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(computed));
  if (!same) {
    log(state, { command, tenant, human_id: doc.human_id, fingerprint_ok: false });
    throw new OperatorError('OP_FINGERPRINT_MISMATCH', `${doc.human_id}: the key document does not match the out-of-band fingerprint`);
  }
  const trust = readTrust(state, tenant);
  const current = trust.principals.find((p) => p.human_id === doc.human_id);
  const withdrawn = readJson(archiveFile(state, tenant)).withdrawn.some((w) => w.principal.human_id === doc.human_id);
  if (!addKey && (current || withdrawn)) throw new OperatorError('OP_ALREADY_ENROLLED', `${doc.human_id} (use add-key or restore)`);
  if (addKey && !current) throw new OperatorError('OP_NOT_ENROLLED', doc.human_id);
  const keys = doc.keys.map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.public_key_b64, status: 'active' }));
  const next = structuredClone(trust);
  if (addKey) next.principals.find((p) => p.human_id === doc.human_id).keys.push(...keys);
  else next.principals.push({ human_id: doc.human_id, keys });
  return commitTrust(state, tenant, trust, next, { command, human_id: doc.human_id, kids: keys.map((k) => k.kid), fingerprint_ok: true });
}

/** Removes a principal from the tenant's trust set and keeps its entry in the operator's archive. */
export function withdraw(state, tenant, humanId) {
  const trust = readTrust(state, tenant);
  const entry = trust.principals.find((p) => p.human_id === humanId);
  if (!entry) throw new OperatorError('OP_NOT_ENROLLED', String(humanId));
  const archive = readJson(archiveFile(state, tenant));
  writeAtomic(archiveFile(state, tenant), { withdrawn: [...archive.withdrawn, { withdrawn_at: iso(Date.now()), principal: entry }] });
  const next = { ...structuredClone(trust), principals: trust.principals.filter((p) => p.human_id !== humanId) };
  return commitTrust(state, tenant, trust, next, { command: 'withdraw', human_id: humanId });
}

/** Puts a withdrawn principal back, exactly as it was archived. */
export function restore(state, tenant, humanId) {
  const trust = readTrust(state, tenant);
  const archive = readJson(archiveFile(state, tenant));
  const found = archive.withdrawn.find((w) => w.principal.human_id === humanId);
  if (!found) throw new OperatorError('OP_NOT_WITHDRAWN', String(humanId));
  const next = { ...structuredClone(trust), principals: [...trust.principals, found.principal] };
  const result = commitTrust(state, tenant, trust, next, { command: 'restore', human_id: humanId });
  writeAtomic(archiveFile(state, tenant), { withdrawn: archive.withdrawn.filter((w) => w !== found) });
  return result;
}

/** Retires keys: expires_at at `at` (default one second ago), so the SDK reports TRUST_KEY_EXPIRED from then on. */
export function retireKey(state, tenant, humanId, kids, { at = iso(Date.now() - 1_000) } = {}) {
  if (!RFC3339.test(at)) throw new OperatorError('OP_TIME_INVALID', String(at));
  const trust = readTrust(state, tenant);
  const next = structuredClone(trust);
  const entry = next.principals.find((p) => p.human_id === humanId);
  if (!entry) throw new OperatorError('OP_NOT_ENROLLED', String(humanId));
  for (const kid of kids) {
    const key = entry.keys.find((k) => k.kid === kid);
    if (!key) throw new OperatorError('OP_KEY_UNKNOWN', String(kid));
    key.expires_at = at;
  }
  return commitTrust(state, tenant, trust, next, { command: 'retire-key', human_id: humanId, kids, at });
}

/** Edits the deny list (agents and kids) and the list of revoked mandates; each edit stamps updated_at. */
export function editRevocation(state, changes, { now = Date.now() } = {}) {
  const c = { revokeAgents: [], unrevokeAgents: [], revokeKids: [], unrevokeKids: [], revokeMandates: [], unrevokeMandates: [], ...changes };
  const edit = (set, add, remove) => {
    for (const v of add) set.add(String(v));
    for (const v of remove) set.delete(String(v));
    return [...set].sort();
  };
  const updated_at = iso(now);
  if (c.revokeAgents.length + c.unrevokeAgents.length + c.revokeKids.length + c.unrevokeKids.length > 0) {
    const d = readJson(listFile(state, 'deny-list.json'));
    writeAtomic(listFile(state, 'deny-list.json'), {
      updated_at,
      revocations: edit(new Set(d.revocations.map((r) => r.agent_id)), c.revokeAgents, c.unrevokeAgents).map((agent_id) => ({ agent_id })),
      kid_revocations: edit(new Set(d.kid_revocations.map((r) => r.revoked_kid)), c.revokeKids, c.unrevokeKids).map((revoked_kid) => ({
        revoked_kid,
      })),
    });
  }
  if (c.revokeMandates.length + c.unrevokeMandates.length > 0) {
    const m = readJson(listFile(state, 'mandates.json'));
    writeAtomic(listFile(state, 'mandates.json'), {
      updated_at,
      revoked_mandates: edit(new Set(m.revoked_mandates.map((r) => r.mandate_id)), c.revokeMandates, c.unrevokeMandates).map((mandate_id) => ({
        mandate_id,
      })),
    });
  }
  log(state, { command: 'revocation', ...changes });
}

/** Re-stamps both lists as current, without changing their content. */
export function refreshLists(state, { now = Date.now() } = {}) {
  for (const name of ['deny-list.json', 'mandates.json']) {
    writeAtomic(listFile(state, name), { ...readJson(listFile(state, name)), updated_at: iso(now) });
  }
  log(state, { command: 'refresh-lists' });
}

const USAGE = `usage: node node/operator.mjs <command> --state DIR [options]
  init
  enroll   --tenant T --key-document FILE --fingerprint SHA256
  add-key  --tenant T --key-document FILE --fingerprint SHA256
  withdraw --tenant T --principal HUMAN_ID
  restore  --tenant T --principal HUMAN_ID
  retire-key --tenant T --principal HUMAN_ID --kid KID [--kid KID ...] [--at RFC3339]
  revoke-agent | unrevoke-agent --agent AGENT_ID
  revoke-kid | unrevoke-kid --kid KID
  revoke-mandate | unrevoke-mandate --mandate MANDATE_ID
  refresh-lists`;

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) {
      out._.push(argv[i]);
      continue;
    }
    if (argv[i + 1] === undefined) throw new OperatorError('OP_USAGE', USAGE);
    (out[argv[i].slice(2)] ??= []).push(argv[++i]);
  }
  return out;
}

function main(argv) {
  assertInstalledSdk();
  const a = parse(argv);
  const one = (k) => {
    if (!a[k] || a[k].length !== 1) throw new OperatorError('OP_USAGE', `--${k} once\n${USAGE}`);
    return a[k][0];
  };
  const state = path.resolve(one('state'));
  const command = a._[0];
  switch (command) {
    case 'init':
      return init(state);
    case 'enroll':
    case 'add-key':
      return enroll(state, one('tenant'), one('key-document'), one('fingerprint'), { addKey: command === 'add-key' });
    case 'withdraw':
      return withdraw(state, one('tenant'), one('principal'));
    case 'restore':
      return restore(state, one('tenant'), one('principal'));
    case 'retire-key':
      return retireKey(state, one('tenant'), one('principal'), a.kid ?? [], a.at ? { at: one('at') } : {});
    case 'revoke-agent':
    case 'unrevoke-agent':
      return editRevocation(state, { [command === 'revoke-agent' ? 'revokeAgents' : 'unrevokeAgents']: [one('agent')] });
    case 'revoke-kid':
    case 'unrevoke-kid':
      return editRevocation(state, { [command === 'revoke-kid' ? 'revokeKids' : 'unrevokeKids']: [one('kid')] });
    case 'revoke-mandate':
    case 'unrevoke-mandate':
      return editRevocation(state, { [command === 'revoke-mandate' ? 'revokeMandates' : 'unrevokeMandates']: [one('mandate')] });
    case 'refresh-lists':
      return refreshLists(state);
    default:
      throw new OperatorError('OP_USAGE', USAGE);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = main(process.argv.slice(2));
    const summary = result?.trust_set_version ? { trust_set_version: result.trust_set_version } : {};
    console.log(JSON.stringify({ status: 'ok', command: process.argv[2], ...summary }));
  } catch (e) {
    console.error(JSON.stringify({ status: 'refused', code: e.code ?? 'OP_ERROR', message: e.message }));
    process.exit(2);
  }
}
