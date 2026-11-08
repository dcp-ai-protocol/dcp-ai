// Node lane of the MP-05 rehearsal (TEST ONLY).
//
// Direct route: the installed @dcp-ai/express adapter admits the bundle under strict-v1, with the sample configuration
// of docs/OPERATIONAL_LIMITS.md. Delegated route: the application composes and activates the chain with the public SDK
// (evaluateDelegationActivationV2) and its own bounded sources; the adapter has no part in it. On both routes the
// application then authorizes the action (operator policy and, delegated, every mandate) and reserves single-use
// actions in the ledger. action_authorized from DCP is always false; application_authorized is this application's.
//
// Order of a request: X-DCP-Bundle refused (the adapter would prefer that header to the body, so the evidence admitted
// would not be the evidence authorized) -> JSON content type -> bearer token (the only source of the tenant) -> body
// read with the route budget, counted while it arrives -> ingress policy (../ingress-node.mjs) -> envelope ->
// admission -> authorization -> reservation -> effect.
//
//   node node/app-express.mjs CONFIG.json      (spawned by the runner; stdout carries only control events)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createSourceSupervisor, dcpVerify, denyListRevocationSource } from '@dcp-ai/express';
import { createPrincipalTrustStore, evaluateDelegationActivationV2, revocationSnapshotFromDenyList } from '@dcp-ai/sdk';
import { IngressError, parseRequest } from '../ingress-node.mjs';
import { authorize } from './authz.mjs';
import { assertInstalledSdk, assertVerified, checkStaged, isObject, loadContract, readJson } from './common.mjs';
import { newRegistry } from './fixtures.mjs';
import { announce, fetchJsonCapped, isJsonContentType, loopbackUrl, onQuit, readBody, tokenOwner } from './http-common.mjs';
import { actionKey, appendEffect, reserve } from './ledger.mjs';
import { compositionSubjects, mandateSnapshot } from './sources.mjs';

const config = readJson(process.argv[2]);
assertInstalledSdk();
checkStaged();
assertVerified(config.verify_report, config.consumer);
loopbackUrl(config.revocation.deny_list_url);
loopbackUrl(config.revocation.mandates_url);

const contract = loadContract();
const registry = newRegistry();
const tokens = readJson(path.join(config.state, 'operator', 'tokens.json'));
const tenantFile = (tenant, name) => path.join(config.state, 'operator', 'tenants', tenant, name);
const ledgerDir = path.join(config.run, 'ledger');
const effectsFile = path.join(config.run, 'executions.jsonl');
const observationsFile = path.join(config.run, 'observations.jsonl');
const logFile = path.join(config.run, 'app.log');
const profile = { profile: 'strict-v1', verifier_id: contract.verifier_id };
const BUDGET = { direct: contract.routes.direct.max_body_bytes, delegated: contract.routes.delegated.max_body_bytes };
const LIMITS = { mandate_chain: 4, delegator_bundles: 3, acknowledgments: 4, awareness_thresholds: 4 };
const SOURCE = { timeoutMs: 1500, maxBytes: 1024 * 1024 };
const counters = { trust_calls: 0, list_fetches: { deny_list: 0, mandates: 0 }, requests: 0 };
fs.mkdirSync(ledgerDir, { recursive: true, mode: 0o700 });

const log = (message) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
const exact = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const codesOf = (errors) => [...new Set(errors.map((e) => e.code))].sort();

/** The operator's trust set for the tenant, read at every admission: withdrawal and rotation need no restart. */
async function readTrust({ tenant }) {
  counters.trust_calls += 1;
  return JSON.parse(await fs.promises.readFile(tenantFile(tenant, 'trust.json'), 'utf8'));
}

function refuse(req, res, status, code, extra = {}) {
  req.observation.code = code;
  res.status(status).json({ ok: false, code, ...extra });
}

function envelopeIsValid(route, body) {
  if (route === 'direct') return exact(body, ['signed_bundle', 'args']) && isObject(body.signed_bundle);
  if (!exact(body, ['evidence', 'args'])) return false;
  const e = body.evidence;
  return (
    exact(e, ['signed_bundle', ...Object.keys(LIMITS)]) &&
    isObject(e.signed_bundle) &&
    Object.entries(LIMITS).every(([k, max]) => Array.isArray(e[k]) && e[k].length <= max)
  );
}

const front = (route) => async (req, res, next) => {
  const id = req.headers['x-request-id'];
  req.observation = { request_id: typeof id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(id) ? id : null, route, tenant: null, code: null };
  res.on('finish', () => appendEffect(observationsFile, { lane: config.lane, ...req.observation, status: res.statusCode }));
  counters.requests += 1;
  if (req.headers['x-dcp-bundle'] !== undefined) return refuse(req, res, 400, 'APP_BUNDLE_HEADER_REJECTED');
  if (!isJsonContentType(req.headers['content-type'])) return refuse(req, res, 415, 'APP_CONTENT_TYPE_REJECTED');
  const tenant = tokenOwner(req.headers.authorization, tokens.tenants);
  if (!tenant) return refuse(req, res, 401, 'APP_UNAUTHENTICATED');
  req.tenant = tenant;
  req.observation.tenant = tenant;
  const body = await readBody(req, BUDGET[route]);
  if (body.tooLarge) {
    res.set('connection', 'close');
    req.resume(); // the rest is discarded, never kept
    return refuse(req, res, 413, 'APP_INGRESS_TOO_LARGE');
  }
  let parsed;
  try {
    parsed = parseRequest(new Uint8Array(body.bytes), BUDGET[route]);
  } catch (e) {
    if (e instanceof IngressError) return refuse(req, res, e.status, e.code, { reason: e.reason });
    throw e; // APP_INGRESS_PARSER_MISMATCH and anything else: an infrastructure fault (500)
  }
  if (!envelopeIsValid(route, parsed)) return refuse(req, res, 400, 'APP_ENVELOPE_INVALID');
  req.body = parsed;
  return next();
};

/** dcp: the real DCP outcome (admitted, delegation_active on the delegated route, action_authorized), never a constant. */
function finish(req, res, decision, payloadHash, route, dcp) {
  if (!decision.ok) return refuse(req, res, 403, decision.code, { detail: decision.detail, dcp });
  let key = null;
  if (decision.single_use) {
    key = actionKey(req.tenant, payloadHash);
    if (!reserve(ledgerDir, req.tenant, key)) return refuse(req, res, 409, 'APP_ALREADY_CONSUMED', { dcp });
  }
  appendEffect(effectsFile, {
    lane: config.lane,
    tenant: req.tenant,
    route,
    action: decision.action,
    amount: decision.amount,
    key,
    request_id: req.observation.request_id,
    at: new Date().toISOString(),
  });
  return res.status(200).json({ ok: true, action: decision.action, single_use: decision.single_use, application_authorized: true, dcp });
}

const supervisor = createSourceSupervisor({ maxInFlight: 32, maxInFlightPerTenant: 8 });
const admitDirect = dcpVerify({
  trustedPrincipals: readTrust,
  profile,
  revocationSource: denyListRevocationSource({ url: config.revocation.deny_list_url, timeoutMs: SOURCE.timeoutMs }),
  revocationTimeoutMs: 2000,
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000, revocation: true },
  cancelOnDisconnect: true,
  tenant: (req) => req.tenant,
});

async function direct(req, res) {
  const bundle = req.body.signed_bundle.bundle;
  // The adapter admitted body.signed_bundle (X-DCP-Bundle was refused before it): the same evidence is authorized.
  if (req.dcpAgent?.agentId !== bundle.agent_passport.payload.agent_id) throw new Error('admitted agent differs from the body');
  // The adapter's real result: admitted, and DCP never authorizes the action. Anything else is an infrastructure
  // fault (500, no effect), never a response that hides the value.
  const admission = req.dcpAgent.admission;
  if (admission?.admitted !== true || admission.actionAuthorized !== false) throw new Error('admission invariant violated');
  const dcp = { admitted: admission.admitted, action_authorized: admission.actionAuthorized };
  const decision = authorize({
    contract,
    policy: readJson(tenantFile(req.tenant, 'policy.json')),
    route: 'direct',
    action: req.params.action,
    args: req.body.args,
    intent: bundle.intent.payload,
    agentId: req.dcpAgent.agentId,
    principalId: bundle.responsible_principal_record.payload.human_id,
  });
  return finish(req, res, decision, bundle.intent.payload_hash, 'direct', dcp);
}

async function list(url, name) {
  counters.list_fetches[name] += 1;
  try {
    return await fetchJsonCapped(url, SOURCE);
  } catch {
    return null; // the source could not answer: no snapshot, never "not revoked"
  }
}

async function delegated(req, res) {
  const e = req.body.evidence;
  let trust;
  try {
    trust = await readTrust({ tenant: req.tenant });
    createPrincipalTrustStore(trust);
  } catch {
    return refuse(req, res, 503, 'APP_TRUST_UNAVAILABLE');
  }
  const [denyList, mandateList] = await Promise.all([
    list(config.revocation.deny_list_url, 'deny_list'),
    list(config.revocation.mandates_url, 'mandates'),
  ]);
  const evidence = {
    signedBundle: e.signed_bundle,
    mandateChain: e.mandate_chain,
    delegatorBundles: e.delegator_bundles,
    acknowledgments: e.acknowledgments,
    awarenessThresholds: e.awareness_thresholds,
  };
  let revocation = null;
  if (denyList !== null) {
    try {
      revocation = revocationSnapshotFromDenyList(denyList, compositionSubjects(evidence));
    } catch {
      revocation = null;
    }
  }
  const r = await evaluateDelegationActivationV2(evidence, registry, {
    trust,
    profile,
    revocation,
    mandateRevocation: mandateSnapshot(mandateList, e.mandate_chain),
    now: Date.now(),
  });
  // The SDK's real result. DCP never authorizes the action, and an active delegation needs an admitted composition;
  // anything else is an infrastructure fault (500, no effect).
  if (r.action_authorized !== false || r.composition.action_authorized !== false) throw new Error('action_authorized invariant violated');
  if (r.delegation_active === true && r.composition.admitted !== true) throw new Error('activation invariant violated');
  const dcp = { admitted: r.composition.admitted, delegation_active: r.delegation_active, action_authorized: r.action_authorized };
  if (!r.composition.admitted) {
    return res.status(403).json({ ok: false, codes: codesOf(r.composition.errors), dcp });
  }
  if (!r.delegation_active) {
    return refuse(req, res, 403, 'APP_DELEGATION_NOT_ACTIVE', { activation_codes: r.errors.map((x) => x.code), dcp });
  }
  const bundle = e.signed_bundle.bundle;
  const decision = authorize({
    contract,
    policy: readJson(tenantFile(req.tenant, 'policy.json')),
    route: 'delegated',
    action: req.params.action,
    args: req.body.args,
    intent: bundle.intent.payload,
    agentId: bundle.agent_passport.payload.agent_id,
    principalId: bundle.responsible_principal_record.payload.human_id,
    chain: e.mandate_chain,
  });
  return finish(req, res, decision, bundle.intent.payload_hash, 'delegated', dcp);
}

const app = express();
app.disable('x-powered-by');
app.disable('etag');
app.get('/v1/operator/state', (req, res) => {
  if (tokenOwner(req.headers.authorization, { operator: tokens.operator }) !== 'operator') {
    return res.status(401).json({ ok: false, code: 'APP_UNAUTHENTICATED' });
  }
  return res.status(200).json({ ok: true, lane: config.lane, ...counters });
});
app.post('/v1/direct/actions/:action', front('direct'), admitDirect, direct);
app.post('/v1/delegated/actions/:action', front('delegated'), delegated);
app.use((req, res) => res.status(404).json({ ok: false, code: 'APP_NOT_FOUND' }));
app.use((err, req, res, _next) => {
  log(`error ${req.method} ${req.path}: ${err?.message}`);
  if (req.observation) req.observation.code = 'APP_INTERNAL_ERROR';
  if (!res.headersSent) res.status(500).json({ ok: false, code: 'APP_INTERNAL_ERROR' });
});

const server = http.createServer(app);
server.listen(0, '127.0.0.1', () => announce({ ev: 'ready', port: server.address().port }));
onQuit(() => {
  server.close(() => {
    announce({ ev: 'stopped' });
    process.exit(0);
  });
  server.closeAllConnections();
});
