// Differential testing of DCP-09 §3.5.2 mandate chain verification (report and finding format dcp-mandatefuzz/1).
// The same signed chain goes, in finite bounded batches, through the TypeScript, Python, Go and Rust SDKs, by the
// external kit's contract /4 (verify_mandate_chain) and its four wrappers, run by the kit's process runner. WASM
// exports no mandate chain function: that boundary is documented and tested by the kit, not probed here.
//
// Chains are signed here, with no SDK: tweetnacl and @noble/post-quantum over context || 0x00 || dcp-jcs-v1(mandate
// without its signature fields), composite pq_over_classical, ML-DSA-65 with extraEntropy: false. Keys are TEST-ONLY,
// derived from fixed labels. Every semantic mutation is re-signed under the normative signer and context, so a bad
// signature does not mask the rule it exercises; deliberately wrong signers or contexts and stale signatures are
// separate, labelled categories. An expected verdict is written only where DCP-09 §3.5.2 (with its clarification of
// 05/11/2026), the canonicalization profile or RFC 8259 decides it; otherwise the case is an observation. Agreement of
// the SDKs is never the oracle, and an observation or a limited attribution never hides a disagreement or a fault.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { LIMITS as KIT_LIMITS, decodeBase64Strict, exactKeys, isObj, parseResponse, runProcess, sha256 } from '../conformance/external.js';
import { DELEGATION_CONTRACT, OP } from '../conformance/external-delegation.js';
import { bounded, treeDigest } from '../conformance/perf.js';
import { InfraError, UsageError, makeRng } from './fuzz.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const FORMAT = 'dcp-mandatefuzz/1';
export const SDKS = ['ts', 'py', 'go', 'rust'];
export const VERIFICATION_TIME = '2026-10-22T12:00:00Z';
const TIERS = ['routine', 'standard', 'elevated', 'maximum'];
const MiB = 1024 * 1024;
// iterations: random mutants after the coverage sweep (every variant at every depth it applies to, always run).
export const DEFAULTS = {
  iterations: 120, seed: '1', timeoutMs: 120000, buildTimeoutMs: 900000, batchCases: 32, batchBytes: 8 * MiB, caseBytes: MiB,
  stdoutBytes: 4 * MiB, maxFindings: 50, maxRetries: 100, minimizeSteps: 16, minimizeTotal: 64,
  python: process.env.DIFFFUZZ_PYTHON || 'python3', out: path.join(HERE, 'findings', 'mandates'), offline: false,
};
const INT_BOUNDS = {
  iterations: [0, 100000], timeoutMs: [1000, 600000], buildTimeoutMs: [1000, 3600000], batchCases: [8, 256],
  batchBytes: [65536, 64 * MiB], caseBytes: [4096, 16 * MiB], stdoutBytes: [65536, 64 * MiB], maxFindings: [1, 1000],
  maxRetries: [0, 10000], minimizeSteps: [0, 1000], minimizeTotal: [0, 10000],
};
const OPTION = {
  '--iterations': 'iterations', '--seed': 'seed', '--timeout': 'timeoutMs', '--build-timeout-ms': 'buildTimeoutMs',
  '--batch-cases': 'batchCases', '--batch-bytes': 'batchBytes', '--case-bytes': 'caseBytes', '--stdout-bytes': 'stdoutBytes',
  '--max-findings': 'maxFindings', '--max-retries': 'maxRetries', '--minimize-steps': 'minimizeSteps', '--minimize-total': 'minimizeTotal',
  '--python': 'python', '--out': 'out', '--report': 'report', '--replay': 'replay', '--go-wrapper': 'goWrapper', '--rust-wrapper': 'rustWrapper',
};

export function parseArgs(argv) {
  const o = { ...DEFAULTS };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^(--[a-z-]+)(?:=(.*))?$/s);
    if (m && m[1] === '--offline' && m[2] === undefined) {
      if (seen.has('offline')) throw new UsageError('--offline given more than once');
      seen.add('offline');
      o.offline = true;
      continue;
    }
    if (m && m[1] === '--transport-probe' && m[2] === undefined) {
      if (seen.has('transportProbe')) throw new UsageError('--transport-probe given more than once');
      seen.add('transportProbe');
      o.transportProbe = true;
      continue;
    }
    const key = m && OPTION[m[1]];
    if (!key) throw new UsageError(`unknown argument ${argv[i]}`);
    if (seen.has(key)) throw new UsageError(`${m[1]} given more than once`);
    seen.add(key);
    const v = m[2] ?? argv[++i];
    if (v === undefined || v === '' || (m[2] === undefined && v.startsWith('--'))) throw new UsageError(`${m[1]} needs a value`);
    if (key in INT_BOUNDS) {
      const [lo, hi] = INT_BOUNDS[key];
      if (!/^\d+$/.test(v) || Number(v) < lo || Number(v) > hi) throw new UsageError(`${m[1]} must be an integer from ${lo} to ${hi}`);
      o[key] = Number(v);
    } else if (key === 'seed') {
      if (v.length > 256) throw new UsageError('--seed must be 1 to 256 characters');
      o.seed = v;
    } else o[key] = v;
  }
  if (o.caseBytes > o.batchBytes) throw new UsageError('--case-bytes cannot exceed --batch-bytes');
  if (o.transportProbe && o.replay) throw new UsageError('--transport-probe and --replay are separate runs');
  return o;
}

// ── JSON with raw number tokens, and dcp-jcs-v1 over exact integers ──

/** A JSON number written exactly as `text`. */
export class Raw {
  constructor(text) { this.text = text; }
}
export const clone = (v) => (v instanceof Raw ? v : Array.isArray(v) ? v.map(clone) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
const escapeAll = (s) => `"${s.split('').map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}"`;

/** JSON text: raw tokens verbatim, the strings in `escape` written with \u escapes only, `indent` for insignificant whitespace. */
export function serialize(v, { escape = new Set(), indent = '' } = {}, depth = 0) {
  const nl = indent ? `\n${indent.repeat(depth + 1)}` : '';
  const end = indent ? `\n${indent.repeat(depth)}` : '';
  if (v instanceof Raw) return v.text;
  if (typeof v === 'string') return escape.has(v) ? escapeAll(v) : JSON.stringify(v);
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return JSON.stringify(v);
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => nl + serialize(x, { escape, indent }, depth + 1)).join(',')}${end}]` : '[]';
  const keys = Object.keys(v);
  return keys.length ? `{${keys.map((k) => `${nl}${JSON.stringify(k)}:${indent ? ' ' : ''}${serialize(v[k], { escape, indent }, depth + 1)}`).join(',')}${end}}` : '{}';
}

const NUMBER = /^-?(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
// A limit of this synthetic signer only, not a rule of dcp-jcs-v1 nor a universal overflow bound: it canonicalizes
// integers exactly up to 20 digits (2^53 and 2^53 + 1 included) and refuses exponents beyond +-40, so a literal such as
// 1e400 is unsignable here. A fraction has no dcp-jcs-v1 form. Both throw: the case cannot be signed by this harness.
export function canonicalInteger(text) {
  const m = NUMBER.exec(text);
  if (!m) throw new Error(`not a JSON number: ${text}`);
  const frac = m[2] ?? '';
  const exp = Number(m[3] ?? 0) - frac.length;
  if (Math.abs(exp) > 40) throw new Error(`overflowing or unrepresentable literal: ${text}`);
  let digits = BigInt(m[1] + frac);
  if (exp >= 0) digits *= 10n ** BigInt(exp);
  else {
    const div = 10n ** BigInt(-exp);
    if (digits % div !== 0n) throw new Error(`not an integer: ${text}`);
    digits /= div;
  }
  if (digits.toString().length > 20) throw new Error(`overflowing literal: ${text}`);
  return `${text.startsWith('-') && digits !== 0n ? '-' : ''}${digits}`;
}
const cmpCodePoints = (a, b) => {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
  return x.length - y.length;
};
/** dcp-jcs-v1 (spec/CANONICALIZATION_PROFILE.md) over this module's values: Raw numbers by their exact integer. */
export function canon(v) {
  if (v instanceof Raw) return canonicalInteger(v.text);
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`not a safe integer: ${v}`);
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v).sort(cmpCodePoints).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}

// ── TEST-ONLY parties and their keys, derived from fixed labels ──

const seedOf = (label) => crypto.createHash('sha256').update(`dcp-ai ${FORMAT} TEST-ONLY ${label}`).digest();
const kidOf = (alg, pub) => crypto.createHash('sha256').update(Buffer.concat([Buffer.from(alg), Buffer.from([0]), Buffer.from(pub)])).digest('hex').slice(0, 32);
function party(label) {
  const ed = nacl.sign.keyPair.fromSeed(seedOf(`${label} ed25519`));
  const pq = ml_dsa65.keygen(seedOf(`${label} ml-dsa-65`));
  return {
    label,
    ed: { alg: 'ed25519', kid: kidOf('ed25519', ed.publicKey), pub: Buffer.from(ed.publicKey), sec: ed.secretKey },
    pq: { alg: 'ml-dsa-65', kid: kidOf('ml-dsa-65', pq.publicKey), pub: Buffer.from(pq.publicKey), sec: pq.secretKey },
  };
}
export const HUMAN_ID = 'human:mf-principal';
// One agent per mandate of the deepest chain (depth counts edges: the leaf's delegation_depth, 0 to 2), and an intruder.
export const AGENTS = ['agent:mf-orchestrator', 'agent:mf-subagent', 'agent:mf-tool'];
export const INTRUDER = 'agent:mf-intruder';
export const PARTIES = Object.fromEntries([[HUMAN_ID, party('human')], ...[...AGENTS, INTRUDER].map((a) => [a, party(a)])]);
const keyEntry = (k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.pub.toString('base64'), created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active' });
export const keysDoc = () => ({
  human_keys: [keyEntry(PARTIES[HUMAN_ID].ed), keyEntry(PARTIES[HUMAN_ID].pq)],
  agent_keys: Object.fromEntries([...AGENTS, INTRUDER].map((a) => [a, [keyEntry(PARTIES[a].ed), keyEntry(PARTIES[a].pq)]])),
});

// ── Signatures ──

export const CTX = { root: 'DCP-AI.v2.Delegation', sub: 'DCP-AI.v2.SubMandate' };
export const SLOT = { root: 'human_composite_sig', sub: 'delegator_composite_sig' };
export const bodyOf = (m) => {
  const { human_composite_sig: _h, delegator_composite_sig: _d, ...b } = m;
  return b;
};
const message = (ctx, m) => Buffer.concat([Buffer.from(ctx, 'utf8'), Buffer.from([0]), Buffer.from(canon(bodyOf(m)), 'utf8')]);
export function compositeSig(ctx, m, p) {
  const msg = message(ctx, m);
  const c = Buffer.from(nacl.sign.detached(msg, p.ed.sec));
  const q = Buffer.from(ml_dsa65.sign(Buffer.concat([msg, c]), p.pq.sec, { extraEntropy: false }));
  return { classical: { alg: 'ed25519', kid: p.ed.kid, sig_b64: c.toString('base64') }, pq: { alg: 'ml-dsa-65', kid: p.pq.kid, sig_b64: q.toString('base64') }, binding: 'pq_over_classical' };
}
/** Both components of `sig` checked with primitives under ctx, the keys looked up by kid in `list`. */
export function verifyComposite(ctx, m, sig, list) {
  let msg;
  try { msg = message(ctx, m); } catch { return { canonical: false, classical: false, pq: false }; }
  const key = (kid) => list.find((k) => k.kid === kid);
  const ek = key(sig?.classical?.kid);
  const pk = key(sig?.pq?.kid);
  const c = Buffer.from(sig?.classical?.sig_b64 ?? '', 'base64');
  return {
    canonical: true,
    classical: Boolean(ek) && c.length === 64 && nacl.sign.detached.verify(msg, c, Buffer.from(ek.public_key_b64, 'base64')),
    pq: Boolean(pk) && ml_dsa65.verify(Buffer.from(sig?.pq?.sig_b64 ?? '', 'base64'), Buffer.concat([msg, c]), Buffer.from(pk.public_key_b64, 'base64')),
  };
}
const signerOf = (chain, i) => (i === 0 ? PARTIES[HUMAN_ID] : PARTIES[chain[i - 1].agent_id]);
/** Every mandate signed under its normative role and context: the root by the human, a sub-mandate by its parent's agent. */
export function signChain(chain) {
  return chain.map((m, i) => {
    const b = bodyOf(m);
    return i === 0 ? { ...b, human_composite_sig: compositeSig(CTX.root, b, signerOf(chain, 0)) } : { ...b, delegator_composite_sig: compositeSig(CTX.sub, b, signerOf(chain, i)) };
  });
}
/** Whether every mandate carries exactly its normative slot and that signature verifies under its role and context. */
export function normativeSignatures(chain, keys) {
  return chain.every((m, i) => {
    const role = i === 0 ? 'root' : 'sub';
    const other = i === 0 ? SLOT.sub : SLOT.root;
    const list = i === 0 ? keys.human_keys : keys.agent_keys[chain[i - 1].agent_id] ?? [];
    const v = verifyComposite(CTX[role], m, m[SLOT[role]], list);
    return !(other in m) && v.classical && v.pq;
  });
}

// ── Positive bases (depth counts edges: 0, 1 or 2) ──

const nonce = (id) => crypto.createHash('sha256').update(`${FORMAT} ${id}`).digest('hex');
const TEMPLATE = [
  { mandate_id: 'mandate:mf-root', agent_id: AGENTS[0], valid_from: '2026-01-01T00:00:00Z', valid_until: '2099-01-01T00:00:00Z', tier: 'standard', max_depth: 2,
    scope: [{ domain: 'email', actions_permitted: ['read', 'draft', 'send'], data_classes: ['contact_info', 'company_confidential'], limits: { max_messages_per_day: 100, max_recipients: 5, region: 'EU' } },
      { domain: 'calendar', actions_permitted: ['read', 'create_event'] }] },
  { mandate_id: 'mandate:mf-sub-1', agent_id: AGENTS[1], valid_from: '2026-02-01T00:00:00Z', valid_until: '2098-01-01T00:00:00Z', tier: 'elevated', max_depth: 2,
    scope: [{ domain: 'email', actions_permitted: ['read', 'draft'], data_classes: ['contact_info'], limits: { max_messages_per_day: 50, max_recipients: 5, region: 'EU', require_approval: true } }] },
  { mandate_id: 'mandate:mf-sub-2', agent_id: AGENTS[2], valid_from: '2026-03-01T00:00:00Z', valid_until: '2097-01-01T00:00:00Z', tier: 'maximum', max_depth: 2,
    scope: [{ domain: 'email', actions_permitted: ['read'], data_classes: ['contact_info'], limits: { max_messages_per_day: 10, max_recipients: 1, region: 'EU', require_approval: true } }] },
];
export function baseChain(depth) {
  return TEMPLATE.slice(0, depth + 1).map((t, i) => ({
    dcp_version: '2.0', mandate_id: t.mandate_id, session_nonce: nonce(t.mandate_id), human_id: HUMAN_ID, agent_id: t.agent_id,
    authority_scope: clone(t.scope), valid_from: t.valid_from, valid_until: t.valid_until, revocable: true, timestamp: t.valid_from,
    ...(i ? { parent_mandate_id: TEMPLATE[i - 1].mandate_id, delegation_depth: i } : {}),
    sub_delegation: { permitted: true, max_depth: t.max_depth }, minimum_security_tier: t.tier,
  }));
}
/** Rule 6: the greatest minimum_security_tier along the chain, or null. */
export const effectiveTier = (chain) => chain.map((m) => m.minimum_security_tier).filter((t) => TIERS.includes(t)).sort((a, b) => TIERS.indexOf(b) - TIERS.indexOf(a))[0] ?? null;

// ── Variants: one change each, with its anchor, expectation, signing and attribution ──
//   signing: resigned (normative re-signing after the change), deliberate (a wrong signer or context, checked
//            separately), stale (changed after signing), none (chain untouched: keys, revocation or time change)
//   attribution: isolated, masked_by_signature (the change cannot be signed), representation_dependent (signed exactly,
//            but whether each parser reproduces the signed bytes depends on its number representation)
const ms = (iso) => Date.parse(iso);
const iso = (t) => new Date(t).toISOString();
const leafOf = (c) => c.chain[c.chain.length - 1];
const parentOf = (c) => c.chain[c.chain.length - 2];
const deliberate = (c, i, ctx, signer) => {
  const m = c.chain[i];
  const b = bodyOf(m);
  c.chain[i] = { ...b, [i === 0 ? SLOT.root : SLOT.sub]: compositeSig(ctx, b, signer) };
  c.construction = { mandate: i, context: ctx, signer: signer.label };
};
const at = (list, ...rest) => list.map((v) => Object.assign({ minDepth: 0 }, rest[0], v));
const lower = (t) => TIERS[Math.max(0, TIERS.indexOf(t) - 1)];
export const VARIANTS = [
  ...at([
    { variant: 'root_signed_by_agent', anchor: 'rule1', apply: (c) => deliberate(c, 0, CTX.root, PARTIES[AGENTS[0]]) },
    { variant: 'root_under_sub_context', anchor: 'rule1', apply: (c) => deliberate(c, 0, CTX.sub, PARTIES[HUMAN_ID]) },
    { variant: 'sub_signed_by_human', minDepth: 1, anchor: 'rule2', apply: (c) => deliberate(c, c.sub, CTX.sub, PARTIES[HUMAN_ID]) },
    { variant: 'sub_signed_by_intruder', minDepth: 1, anchor: 'rule2', apply: (c) => deliberate(c, c.sub, CTX.sub, PARTIES[INTRUDER]) },
    { variant: 'sub_signed_by_its_own_agent', minDepth: 1, anchor: 'rule2', apply: (c) => deliberate(c, c.sub, CTX.sub, PARTIES[c.chain[c.sub].agent_id]) },
    { variant: 'sub_under_root_context', minDepth: 1, anchor: 'rule2', apply: (c) => deliberate(c, c.sub, CTX.root, signerOf(c.chain, c.sub)) },
  ], { family: 'roles', signing: 'deliberate', expect: false }),
  ...at([
    { variant: 'wrong_parent_mandate_id', minDepth: 1, anchor: 'rule2', apply: (c) => { c.chain[c.sub].parent_mandate_id = 'mandate:mf-elsewhere'; } },
    { variant: 'delegation_depth_plus_one', minDepth: 1, anchor: 'rule2', apply: (c) => { c.chain[c.sub].delegation_depth += 1; } },
    { variant: 'delegation_depth_missing', minDepth: 1, anchor: 'rule2', apply: (c) => { delete c.chain[c.sub].delegation_depth; } },
    { variant: 'human_id_changed', minDepth: 1, anchor: 'rule2', apply: (c) => { c.chain[c.sub].human_id = 'human:mf-other'; } },
    { variant: 'root_with_parent_mandate_id', anchor: 'rule1', apply: (c) => { c.chain[0].parent_mandate_id = 'mandate:mf-elsewhere'; } },
    { variant: 'root_with_delegation_depth_1', anchor: 'rule1', apply: (c) => { c.chain[0].delegation_depth = 1; } },
  ], { family: 'links', signing: 'resigned', expect: false }),
  ...at([
    { variant: 'sub_delegation_not_permitted', minDepth: 1, anchor: 'rule3', expect: false, apply: (c) => { c.chain[c.sub - 1].sub_delegation.permitted = false; } },
    { variant: 'max_depth_equal_to_leaf_depth', minDepth: 1, anchor: 'rule3', expect: true, apply: (c) => { for (const m of c.chain) m.sub_delegation.max_depth = c.chain.length - 1; } },
    { variant: 'max_depth_below_leaf_depth', minDepth: 1, anchor: 'rule3', expect: false, apply: (c) => { c.chain[c.randInt(c.chain.length - 1)].sub_delegation.max_depth = c.chain.length - 2; } },
    { variant: 'sub_delegation_without_max_depth', minDepth: 1, anchor: 'fail_closed', expect: false, apply: (c) => { delete c.chain[0].sub_delegation.max_depth; } },
  ], { family: 'depth', signing: 'resigned' }),
  ...at([
    { variant: 'actions_proper_subset', expect: true, apply: (c) => { const s = leafOf(c).authority_scope[0]; s.actions_permitted = s.actions_permitted.slice(0, 1); } },
    { variant: 'action_added', expect: false, apply: (c) => { leafOf(c).authority_scope[0].actions_permitted.push('delete'); } },
    { variant: 'data_class_added', expect: false, apply: (c) => { leafOf(c).authority_scope[0].data_classes.push('financial_data'); } },
    { variant: 'data_classes_empty', expect: true, apply: (c) => { leafOf(c).authority_scope[0].data_classes = []; } },
    { variant: 'data_classes_dropped', expect: false, apply: (c) => { delete leafOf(c).authority_scope[0].data_classes; } },
    { variant: 'limit_lower', expect: true, apply: (c) => { const l = leafOf(c).authority_scope[0].limits; l.max_messages_per_day -= 1 + c.randInt(l.max_messages_per_day); } },
    { variant: 'limit_equal_to_parent', expect: true, apply: (c) => { leafOf(c).authority_scope[0].limits.max_messages_per_day = parentOf(c).authority_scope[0].limits.max_messages_per_day; } },
    { variant: 'limit_higher_than_parent', expect: false, apply: (c) => { leafOf(c).authority_scope[0].limits.max_messages_per_day = parentOf(c).authority_scope[0].limits.max_messages_per_day + 1 + c.randInt(1000); } },
    { variant: 'limit_key_dropped', expect: false, apply: (c) => { delete leafOf(c).authority_scope[0].limits.max_recipients; } },
    { variant: 'limit_key_added', expect: true, apply: (c) => { leafOf(c).authority_scope[0].limits.max_attachments = 1 + c.randInt(9); } },
    { variant: 'non_numeric_limit_changed', expect: false, apply: (c) => { leafOf(c).authority_scope[0].limits.region = 'US'; } },
    { variant: 'numeric_limit_as_string', expect: false, apply: (c) => { const l = leafOf(c).authority_scope[0].limits; l.max_recipients = String(l.max_recipients); } },
    { variant: 'domain_not_in_parent', expect: false, apply: (c) => { leafOf(c).authority_scope[0].domain = 'files'; } },
  ], { family: 'attenuation', minDepth: 1, anchor: 'rule5', signing: 'resigned' }),
  ...at([
    { variant: 'integer_in_decimal_form', expect: true, apply: (c) => { const l = leafOf(c).authority_scope[0].limits; l.max_messages_per_day = new Raw(`${l.max_messages_per_day}.0`); } },
    { variant: 'integer_in_exponent_form', expect: true, apply: (c) => { const l = leafOf(c).authority_scope[0].limits; l.max_messages_per_day = new Raw(`${l.max_messages_per_day / 10}e1`); } },
    { variant: 'max_safe_integer_along_the_chain', expect: true, apply: (c) => { for (const m of c.chain) m.authority_scope[0].limits.max_messages_per_day = new Raw('9007199254740991'); } },
    { variant: 'two_pow_53_under_max_safe', expect: false, attribution: 'representation_dependent',
      apply: (c) => { for (const m of c.chain) m.authority_scope[0].limits.max_messages_per_day = new Raw('9007199254740991'); leafOf(c).authority_scope[0].limits.max_messages_per_day = new Raw('9007199254740992'); } },
    { variant: 'two_pow_53_plus_1_under_max_safe', expect: false, attribution: 'representation_dependent',
      apply: (c) => { for (const m of c.chain) m.authority_scope[0].limits.max_messages_per_day = new Raw('9007199254740991'); leafOf(c).authority_scope[0].limits.max_messages_per_day = new Raw('9007199254740993'); } },
    { variant: 'minus_two_pow_53', expect: false, attribution: 'representation_dependent', apply: (c) => { leafOf(c).authority_scope[0].limits.max_messages_per_day = new Raw('-9007199254740992'); } },
    { variant: 'fraction', expect: false, signing: 'stale', attribution: 'masked_by_signature', label: 'fraction_not_in_dcp_jcs_v1', apply: (c) => { leafOf(c).authority_scope[0].limits.max_messages_per_day = new Raw('0.5'); } },
  ], { family: 'numbers', minDepth: 1, anchor: 'rule5', signing: 'resigned', attribution: 'isolated' }),
  ...at([
    { variant: 'duplicate_domain_in_root', minDepth: 0, apply: (c) => { c.chain[0].authority_scope.push(clone(c.chain[0].authority_scope[0])); } },
    { variant: 'duplicate_domain_in_leaf', apply: (c) => { leafOf(c).authority_scope.push(clone(leafOf(c).authority_scope[0])); } },
    { variant: 'case_variant_of_parent_domain', apply: (c) => { leafOf(c).authority_scope[0].domain = 'Email'; } },
    { variant: 'nfd_form_of_parent_nfc_domain', apply: (c) => { for (const m of c.chain) m.authority_scope[0].domain = 'caf\u00e9'; leafOf(c).authority_scope[0].domain = 'cafe\u0301'; } },
    { variant: 'nfc_domain_along_the_chain', expect: true, apply: (c) => { for (const m of c.chain) m.authority_scope[0].domain = 'caf\u00e9'; } },
    { variant: 'trailing_space_in_domain', apply: (c) => { leafOf(c).authority_scope[0].domain = 'email '; } },
  ], { family: 'domains', minDepth: 1, anchor: 'rule5', signing: 'resigned', expect: false }),
  ...at([
    { variant: 'time_at_leaf_valid_from', signing: 'none', expect: true, apply: (c) => { c.time = leafOf(c).valid_from; } },
    { variant: 'time_1ms_before_leaf_valid_from', signing: 'none', expect: false, apply: (c) => { c.time = iso(ms(leafOf(c).valid_from) - 1); } },
    { variant: 'time_at_leaf_valid_until', signing: 'none', expect: true, apply: (c) => { c.time = leafOf(c).valid_until; } },
    { variant: 'time_1ms_after_leaf_valid_until', signing: 'none', expect: false, apply: (c) => { c.time = iso(ms(leafOf(c).valid_until) + 1); } },
    { variant: 'time_below_ms_at_leaf_valid_until', signing: 'none', expect: true, anchor: 'rule4_millisecond', apply: (c) => { c.time = leafOf(c).valid_until.replace('Z', '.0009Z'); } },
    { variant: 'leaf_starts_1ms_before_parent', minDepth: 1, expect: false, apply: (c) => { leafOf(c).valid_from = iso(ms(parentOf(c).valid_from) - 1); } },
    { variant: 'leaf_ends_1ms_after_parent', minDepth: 1, expect: false, apply: (c) => { leafOf(c).valid_until = iso(ms(parentOf(c).valid_until) + 1); } },
    { variant: 'leaf_window_equal_to_parent', minDepth: 1, expect: true, apply: (c) => { leafOf(c).valid_from = parentOf(c).valid_from; leafOf(c).valid_until = parentOf(c).valid_until; } },
    { variant: 'leaf_valid_from_with_offset', expect: true, apply: (c) => { const m = leafOf(c); const t = new Date(ms(m.valid_from) + 2 * 3600000).toISOString().replace('.000Z', '+02:00'); m.valid_from = t; } },
    { variant: 'leaf_ends_below_ms_after_parent', minDepth: 1, expect: true, anchor: 'rule4_millisecond', apply: (c) => { leafOf(c).valid_until = parentOf(c).valid_until.replace('Z', '.0009Z'); } },
  ], { family: 'time', anchor: 'rule4', signing: 'resigned' }),
  ...at([
    { variant: 'human_classical_key_revoked', anchor: 'rule1', expect: false, apply: (c) => { c.keys.human_keys[0].status = 'revoked'; } },
    { variant: 'human_pq_key_status_expired', anchor: 'rule1', expect: false, apply: (c) => { c.keys.human_keys[1].status = 'expired'; } },
    { variant: 'human_classical_key_expires_1ms_before', anchor: 'rule1', expect: false, apply: (c) => { c.keys.human_keys[0].expires_at = iso(ms(c.time) - 1); } },
    { variant: 'human_pq_key_expires_at_time', anchor: 'rule1', expect: true, apply: (c) => { c.keys.human_keys[1].expires_at = c.time; } },
    { variant: 'delegator_classical_key_revoked', minDepth: 1, anchor: 'rule2', expect: false, apply: (c) => { c.keys.agent_keys[c.chain[c.sub - 1].agent_id][0].status = 'revoked'; } },
    { variant: 'delegator_pq_key_status_expired', minDepth: 1, anchor: 'rule2', expect: false, apply: (c) => { c.keys.agent_keys[c.chain[c.sub - 1].agent_id][1].status = 'expired'; } },
    { variant: 'delegator_pq_key_expires_1ms_before', minDepth: 1, anchor: 'rule2', expect: false, apply: (c) => { c.keys.agent_keys[c.chain[c.sub - 1].agent_id][1].expires_at = iso(ms(c.time) - 1); } },
    { variant: 'intruder_key_revoked', anchor: 'all_rules', expect: true, apply: (c) => { c.keys.agent_keys[INTRUDER][0].status = 'revoked'; } },
  ], { family: 'key_validity', signing: 'none' }),
  ...at([
    { variant: 'leaf_tier_below_parent', anchor: 'rule6', expect: false, apply: (c) => { leafOf(c).minimum_security_tier = lower(parentOf(c).minimum_security_tier); } },
    { variant: 'leaf_tier_equal_to_parent', anchor: 'rule6', expect: true, apply: (c) => { leafOf(c).minimum_security_tier = parentOf(c).minimum_security_tier; } },
    { variant: 'leaf_tier_maximum', anchor: 'rule6', expect: true, apply: (c) => { leafOf(c).minimum_security_tier = 'maximum'; } },
    { variant: 'leaf_tier_dropped', anchor: 'rule6', expect: false, apply: (c) => { delete leafOf(c).minimum_security_tier; } },
    { variant: 'leaf_tier_unknown', anchor: 'fail_closed', expect: false, apply: (c) => { leafOf(c).minimum_security_tier = 'critical'; } },
    { variant: 'no_tier_anywhere', minDepth: 0, anchor: 'rule6', expect: true, apply: (c) => { for (const m of c.chain) delete m.minimum_security_tier; } },
  ], { family: 'tier', minDepth: 1, signing: 'resigned' }),
  ...at([
    { variant: 'root_revoked', expect: false, apply: (c) => { c.revoked = [c.chain[0].mandate_id]; } },
    { variant: 'intermediate_revoked', minDepth: 2, expect: false, apply: (c) => { c.revoked = [c.chain[1].mandate_id]; } },
    { variant: 'leaf_revoked', minDepth: 1, expect: false, apply: (c) => { c.revoked = [leafOf(c).mandate_id]; } },
    { variant: 'unrelated_mandate_revoked', anchor: 'all_rules', expect: true, apply: (c) => { c.revoked = ['mandate:mf-unrelated']; } },
  ], { family: 'revocation', anchor: 'rule7', signing: 'none' }),
  ...at([
    { variant: 'domain_written_with_escapes', anchor: 'json_equivalence', expect: true, apply: (c) => { c.text = { escape: new Set(['email']) }; } },
    { variant: 'insignificant_whitespace', anchor: 'json_equivalence', expect: true, apply: (c) => { c.text = { indent: '  ' }; } },
    { variant: 'duplicate_member', anchor: null, expect: null, apply: (c) => { c.text = { duplicate: true }; } },
  ], { family: 'encoding', signing: 'none' }),
].map((v) => ({ attribution: 'isolated', ...v }));

// Inputs a campaign never sends: contract /4 does not carry them to every SDK (1e400 reaches the TypeScript and Python
// SDKs, not Go or Rust), because each wrapper reads the chain as UTF-8 JSON first (as its SDK's own corpus test does)
// and exits 2 on what it cannot read, which is never a verdict.
// `--transport-probe` measures them per component (transportProbe below); `observed` is the measurement of 05/11/2026.
export const OUTSIDE_TRANSPORT = [
  { input: 'a NaN token in a limit', category: 'not_json', observed: 'every wrapper refuses the request (exit 2) before the SDK' },
  { input: 'a leading byte order mark', category: 'not_json', observed: 'every wrapper refuses the request (exit 2) before the SDK' },
  { input: 'the overflowing literal 1e400 in a limit', category: 'overflowing_literal',
    observed: 'the TypeScript and Python wrappers pass it to their SDK, which rejects the chain; the Go (encoding/json into float64) and Rust (serde_json) wrappers refuse the request (exit 2) before the SDK' },
];
const chainText = (chain, t = {}) => {
  let s = serialize(chain, t);
  return t.duplicate ? s.replace('"revocable":true', '"revocable":true,"revocable":true') : s;
};
const bytesOf = (s) => Buffer.from(s, 'utf8');

/**
 * Builds one case of `variant` on the base of `depth`. The returned case holds the exact bytes sent; `check` records the
 * primitive checks of its signatures: normative (every signature valid under its role and context), deliberate (the
 * chosen wrong construction verifies as built) or stale (the changed mandate no longer verifies, or cannot be signed).
 */
const SIGNED = new Map();
/** The signed base of `depth`, signed once: Ed25519 and ML-DSA-65 with extraEntropy: false are deterministic. */
export const signedBase = (depth) => {
  if (!SIGNED.has(depth)) SIGNED.set(depth, signChain(baseChain(depth)));
  return clone(SIGNED.get(depth));
};
export function buildCase(v, depth, rng = makeRng('x')) {
  const signed = signedBase(depth);
  const c = { chain: clone(signed), keys: keysDoc(), revoked: [], time: VERIFICATION_TIME, text: {}, sub: 1 + rng.randInt(Math.max(1, depth)), randInt: rng.randInt };
  if (depth === 0) c.sub = 0;
  if (v.signing === 'resigned') { v.apply(c); c.chain = signChain(c.chain); }
  else v.apply(c);
  const check = { signing: v.signing };
  // Status and expires_at are not part of a signature: a key_validity case still carries normative signatures.
  if (v.signing === 'resigned' || v.signing === 'none') check.normative = normativeSignatures(c.chain, c.keys);
  if (v.signing === 'deliberate') {
    const k = c.construction;
    const list = k.signer === PARTIES[HUMAN_ID].label ? c.keys.human_keys : c.keys.agent_keys[k.signer];
    const slot = k.mandate === 0 ? SLOT.root : SLOT.sub;
    const r = verifyComposite(k.context, c.chain[k.mandate], c.chain[k.mandate][slot], list);
    check.deliberate = { ...k, verifies_as_built: r.classical && r.pq };
  }
  if (v.signing === 'stale') {
    const i = c.chain.length - 1;
    const r = verifyComposite(i ? CTX.sub : CTX.root, c.chain[i], c.chain[i][i ? SLOT.sub : SLOT.root], i ? c.keys.agent_keys[c.chain[i - 1].agent_id] : c.keys.human_keys);
    check.stale = { canonical: r.canonical, still_verifies: r.classical && r.pq };
  }
  const expect = v.expect === null ? null : v.expect ? { valid: true, effective_tier: effectiveTier(c.chain) } : { valid: false };
  const chain = chainText(c.chain, c.text);
  return {
    family: v.family, variant: v.variant, anchor: v.anchor ?? null, signing: v.signing, attribution: v.attribution, ...(v.label ? { label: v.label } : {}),
    depth, expect, check, semantic: c.chain, chain_text: chain, keys_text: JSON.stringify(c.keys), revoked: c.revoked, verification_time: c.time,
  };
}
/** The positive control of a base, and its stale control: the leaf's actions changed after signing. */
export function controlsOf(depth) {
  const signed = signedBase(depth);
  const positive = { family: 'control', variant: `positive_depth_${depth}`, anchor: 'all_rules', signing: 'resigned', attribution: 'isolated', depth,
    expect: { valid: true, effective_tier: effectiveTier(signed) }, check: { signing: 'resigned', normative: normativeSignatures(signed, keysDoc()) },
    semantic: signed, chain_text: serialize(signed), keys_text: JSON.stringify(keysDoc()), revoked: [], verification_time: VERIFICATION_TIME };
  const stale = clone(signed);
  stale.at(-1).authority_scope[0].actions_permitted = ['read', 'delete'];
  const i = stale.length - 1;
  const r = verifyComposite(i ? CTX.sub : CTX.root, stale[i], stale[i][i ? SLOT.sub : SLOT.root], i ? keysDoc().agent_keys[stale[i - 1].agent_id] : keysDoc().human_keys);
  return [positive, { ...positive, variant: `stale_signature_depth_${depth}`, anchor: i ? 'rule2' : 'rule1', signing: 'stale', attribution: 'masked_by_signature',
    expect: { valid: false }, check: { signing: 'stale', stale: { canonical: r.canonical, still_verifies: r.classical && r.pq } }, semantic: stale, chain_text: serialize(stale) }];
}

// ── Self-checks of the signer, before any campaign ──

/** The signer's message construction against the committed corpus (every positive chain verifies with its keys) and the determinism of extraEntropy: false. */
export function signerSelfCheck(root = ROOT) {
  const V = JSON.parse(fs.readFileSync(path.join(root, 'tests/interop/v2/mandate_chain_vectors.json'), 'utf8'));
  let checked = 0;
  for (const c of V.must_accept) {
    const keys = c.keys ?? V.keys;
    c.chain.forEach((m, i) => {
      const r = verifyComposite(i ? CTX.sub : CTX.root, m, m[i ? SLOT.sub : SLOT.root], i ? keys.agent_keys[c.chain[i - 1].agent_id] : keys.human_keys);
      if (!(r.classical && r.pq)) throw new InfraError(`signer self-check: ${c.name} mandate ${i} does not verify with this module's message construction`);
      checked++;
    });
  }
  const p = PARTIES[HUMAN_ID];
  const msg = Buffer.from('dcp-ai mandatefuzz determinism check');
  const a = Buffer.from(ml_dsa65.sign(msg, p.pq.sec, { extraEntropy: false }));
  const b = Buffer.from(ml_dsa65.sign(msg, p.pq.sec, { extraEntropy: false }));
  const h1 = Buffer.from(ml_dsa65.sign(msg, p.pq.sec));
  const h2 = Buffer.from(ml_dsa65.sign(msg, p.pq.sec));
  if (!a.equals(b)) throw new InfraError('signer self-check: ML-DSA-65 with extraEntropy: false is not deterministic with the installed library');
  if (h1.equals(h2)) throw new InfraError('signer self-check: the default ML-DSA-65 signing is not hedged, so extraEntropy: false shows nothing');
  for (const s of [a, h1]) if (!ml_dsa65.verify(s, msg, p.pq.pub)) throw new InfraError('signer self-check: an ML-DSA-65 signature does not verify');
  return { committed_signatures_verified: checked, ml_dsa_deterministic: true, ml_dsa_default_hedged: true };
}

// ── One bounded batch through one wrapper (contract /4), judged strictly ──

const OK_FIELDS = ['id', 'status', 'valid', 'errors', 'effective_tier', 'depth'];
/** One result of the wrapper as an outcome, or null when it is outside the contract (a fault of the whole batch). */
function outcomeOf(r) {
  if (r.status === 'ok') {
    if (!exactKeys(r, OK_FIELDS) || typeof r.valid !== 'boolean' || !Array.isArray(r.errors) || !r.errors.every((e) => typeof e === 'string') ||
      !(r.effective_tier === null || TIERS.includes(r.effective_tier)) || !Number.isSafeInteger(r.depth) || r.depth < 0 || (r.valid && r.errors.length)) return null;
    return { category: 'verdict', valid: r.valid, effective_tier: r.valid ? r.effective_tier : null, errors: r.errors.slice(0, 4).map((e) => e.slice(0, 240)) };
  }
  if (r.status === 'error') return exactKeys(r, ['id', 'status', 'message']) && typeof r.message === 'string' ? { category: 'sdk_error', message: r.message.slice(0, 500) } : null;
  if (r.status === 'unsupported') return exactKeys(r, ['id', 'status']) ? { category: 'unsupported' } : null;
  return null;
}
/** Judges one response: { ok: true, results: Map(id → outcome) } or a batch failure with its category. */
export function judgeResponse(stdout, observed, request) {
  const fail = (category, detail) => ({ ok: false, category, detail, stderr: observed.stderr_excerpt });
  if (observed.spawn_error) return { ...fail('protocol', `cannot start the wrapper: ${observed.spawn_error}`), fatal: true };
  if (observed.output_limit) return fail('output_limit', `stdout exceeded ${observed.stdout_bytes} bytes`);
  if (observed.timed_out || observed.cleanup_incomplete) return fail('timeout', 'no exit with closed pipes before the deadline');
  if (observed.exit_code !== 0 || observed.signal) return fail('crash', `exit code ${observed.exit_code}, signal ${observed.signal}`);
  if (observed.group_alive_after_exit) return fail('protocol', 'a descendant was still running after the wrapper exited');
  const parsed = parseResponse(stdout, request);
  if (parsed.error) return fail('protocol', parsed.error.message);
  const wanted = new Set(request.cases.map((c) => c.id));
  const results = new Map();
  for (const r of parsed.doc.results) {
    if (!isObj(r) || typeof r.id !== 'string' || !wanted.has(r.id)) return fail('protocol', `unknown or missing result id ${JSON.stringify(r?.id).slice(0, 80)}`);
    if (results.has(r.id)) return fail('protocol', `duplicate result id ${r.id}`);
    const o = outcomeOf(r);
    if (!o) return fail('protocol', `result ${r.id} is outside contract /4`);
    results.set(r.id, o);
  }
  if (results.size !== wanted.size) return fail('protocol', `${wanted.size - results.size} result(s) missing`);
  return { ok: true, results, implementation: parsed.doc.implementation };
}
const wireCase = (id, k) => ({ id, op: OP, chain_b64: bytesOf(k.chain_text).toString('base64'), keys_b64: bytesOf(k.keys_text).toString('base64'), revoked_mandate_ids: k.revoked, verification_time: k.verification_time });
export const caseBytes = (k) => bytesOf(k.chain_text).length + bytesOf(k.keys_text).length;
export async function runBatch(argv, cases, o) {
  const request = { contract: DELEGATION_CONTRACT, run_id: crypto.randomUUID(), nonce: crypto.randomBytes(16).toString('hex'), cases: cases.map((k) => wireCase(k.wireId, k)) };
  const input = Buffer.from(JSON.stringify(request));
  if (input.length > o.batchBytes) throw new InfraError(`a request of ${input.length} bytes exceeds --batch-bytes ${o.batchBytes}`);
  const { stdout, observed } = await runProcess(argv, input, { timeoutMs: o.timeoutMs, limits: { ...KIT_LIMITS, stdoutBytes: o.stdoutBytes } });
  return { request, observed, judged: judgeResponse(stdout, observed, request) };
}

// ── Judgement of one case through the four wrappers ──

export const decision = (x) => (x.category === 'verdict' ? (x.valid ? `accept:${x.effective_tier}` : 'reject') : x.category);
const expected = (k) => (k.expect === null ? null : k.expect.valid ? `accept:${k.expect.effective_tier}` : 'reject');
/** Finding classes of one case (empty when the four agree and match any expectation) and the evidence it gives otherwise. */
export function judgeCase(k, outcomes) {
  const d = SDKS.map((s) => decision(outcomes[s]));
  const classes = [];
  if (SDKS.some((s) => outcomes[s].category !== 'verdict')) classes.push('sdk_fault');
  if (new Set(d).size > 1) classes.push('disagreement');
  const want = expected(k);
  if (want !== null && new Set(d).size === 1 && d[0] !== want && !classes.length) classes.push('expectation');
  if (k.family === 'control' && classes.length) classes.push('control_failed');
  const evidence = classes.length ? null : want === null ? 'agreement_without_expectation' : k.attribution === 'isolated' ? 'rule_evidence' : 'agreement_limited_attribution';
  return { classes, decisions: Object.fromEntries(SDKS.map((s, i) => [s, d[i]])), evidence };
}

// ── Wrappers: TypeScript and Python from source, Go and Rust built in the run's directory or supplied ──

const fileSha = (f) => ({ path: path.relative(ROOT, f).startsWith('..') ? f : path.relative(ROOT, f), sha256: sha256(fs.readFileSync(f)) });
const W = path.join(ROOT, 'tools/conformance/wrappers');
function npmPackage(name) {
  const p = path.join(ROOT, 'node_modules', name);
  return fs.existsSync(path.join(p, 'package.json')) ? { version: JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')).version, tree: treeDigest(p) } : null;
}
const MANIFESTS = [
  'package.json', 'package-lock.json', 'sdks/typescript/package.json', 'sdks/typescript/package-lock.json', 'sdks/python/pyproject.toml',
  'sdks/go/go.mod', 'sdks/go/go.sum', 'sdks/rust/Cargo.toml', 'sdks/rust/Cargo.lock',
  'tools/conformance/wrappers/go/go.mod', 'tools/conformance/wrappers/go/go.sum', 'tools/conformance/wrappers/rust/Cargo.toml', 'tools/conformance/wrappers/rust/Cargo.lock',
];
export const PROVENANCE_LIMITS = [
  'sdks/typescript/dist and src are both hashed; that dist was built from src is not verified.',
  'A supplied Go or Rust wrapper is recorded by its content hash only; that it was built from the hashed sources and manifests is not verified, and no toolchain version is recorded for it.',
  'The Python runtime is the interpreter version it reports; its installed packages are not hashed.',
  'The signing libraries (tweetnacl, @noble/post-quantum) are recorded by version and tree hash; ML-DSA-65 bytes from the same seed are not promised across their versions: replay uses the saved bytes.',
];
const isExecutable = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } };
/** The four wrapper commands, built within one deadline checked before every step, with their provenance. */
export async function buildWrappers(o, tmp) {
  const deadline = performance.now() + o.buildTimeoutMs;
  const steps = [];
  const toolchains = {};
  const step = async (sdk, argv, cwd, env = {}, mode = 'log') => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1000) throw new InfraError(`the build deadline (--build-timeout-ms ${o.buildTimeoutMs}) leaves no time to start the ${sdk} step`);
    const r = await bounded(argv, { cwd, env, timeoutMs: remaining, mode });
    steps.push({ sdk, argv: argv.map((a) => (a.startsWith(tmp) ? `<run dir>${a.slice(tmp.length)}` : a)), cwd: path.relative(ROOT, cwd), duration_ms: r.observed.duration_ms, exit_code: r.observed.exit_code, level: r.level?.kind ?? null });
    if (r.level) throw new InfraError(`${sdk} step failed (${r.level.message}): ${r.observed.stderr_excerpt.slice(-800)}`);
    return r.stdout;
  };
  const tsDist = path.join(ROOT, 'sdks/typescript/dist/index.js');
  if (!fs.existsSync(tsDist)) throw new InfraError(`${tsDist} not found: run "npm install && npm run build" in sdks/typescript`);
  let go = o.goWrapper && path.resolve(o.goWrapper);
  let rust = o.rustWrapper && path.resolve(o.rustWrapper);
  for (const [name, f] of [['--go-wrapper', go], ['--rust-wrapper', rust]]) if (f && !isExecutable(f)) throw new InfraError(`${name} ${f} is not an executable file`);
  if (!go) {
    toolchains.go = (await step('go', ['go', 'version'], ROOT, {}, 'capture')).trim();
    go = path.join(tmp, 'go-wrapper');
    await step('go', ['go', 'build', '-mod=readonly', '-o', go, '.'], path.join(W, 'go'), o.offline ? { GOPROXY: 'off', GOFLAGS: '-mod=readonly' } : { GOFLAGS: '-mod=readonly' });
  }
  if (!rust) {
    toolchains.cargo = (await step('rust', ['cargo', '--version'], ROOT, {}, 'capture')).trim();
    toolchains.rustc = (await step('rust', ['rustc', '--version'], ROOT, {}, 'capture')).trim();
    await step('rust', ['cargo', 'build', '--locked', '--quiet', ...(o.offline ? ['--offline'] : []), '--manifest-path', path.join(W, 'rust', 'Cargo.toml')], ROOT, { CARGO_TARGET_DIR: path.join(tmp, 'rust-target') });
    rust = path.join(tmp, 'rust-target', 'debug', 'dcp-ai-conformance-wrapper');
  }
  const py = await step('py', [o.python, '-I', '-c', 'import sys, json; print(json.dumps({"python": sys.version}))'], ROOT, {}, 'capture');
  let pythonRuntime;
  try { pythonRuntime = JSON.parse(py); } catch { throw new InfraError(`the Python interpreter did not report its runtime: ${py.slice(0, 200)}`); }
  toolchains.node = process.version;
  const commands = { ts: [process.execPath, path.join(W, 'ts-sdk.mjs'), '--sdk', tsDist], py: [o.python, '-I', path.join(W, 'python_sdk.py')], go: [go], rust: [rust] };
  const artifacts = {
    ts_wrapper: fileSha(path.join(W, 'ts-sdk.mjs')), py_wrapper: fileSha(path.join(W, 'python_sdk.py')),
    go_wrapper: { origin: o.goWrapper ? 'supplied' : 'built in the run directory', sha256: sha256(fs.readFileSync(go)), source: treeDigest(path.join(W, 'go')) },
    rust_wrapper: { origin: o.rustWrapper ? 'supplied' : 'built in the run directory', sha256: sha256(fs.readFileSync(rust)), source: treeDigest(path.join(W, 'rust', 'src')) },
    ts_sdk_source: treeDigest(path.join(ROOT, 'sdks/typescript/src')), ts_sdk_dist: treeDigest(path.join(ROOT, 'sdks/typescript/dist')),
    py_sdk_source: treeDigest(path.join(ROOT, 'sdks/python/dcp_ai')), py_runtime: pythonRuntime,
    go_sdk_source: treeDigest(path.join(ROOT, 'sdks/go/dcp')), rust_sdk_source: treeDigest(path.join(ROOT, 'sdks/rust/src')),
    manifests: Object.fromEntries(MANIFESTS.filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => [f, sha256(fs.readFileSync(path.join(ROOT, f)))])),
    signing_libraries: { tweetnacl: npmPackage('tweetnacl'), '@noble/post-quantum': npmPackage('@noble/post-quantum') },
    toolchains,
  };
  return { steps, commands, artifacts };
}
export const runInputs = () => ({
  driver: { module: fileSha(path.join(HERE, 'mandate-fuzz.mjs')), cli: fileSha(path.join(HERE, 'run-mandates.mjs')), runner: fileSha(path.join(ROOT, 'tools/conformance/external.js')) },
  signer_check_fixture: fileSha(path.join(ROOT, 'tests/interop/v2/mandate_chain_vectors.json')),
});

// ── Diff units of a semantic chain, for bounded minimization (Raw tokens compared by text) ──

const same = (a, b) => (a instanceof Raw || b instanceof Raw ? a instanceof Raw && b instanceof Raw && a.text === b.text : a === b);
export function diffUnits(a, b, p = []) {
  if (same(a, b)) return [];
  const plain = (x) => isObj(x) && !(x instanceof Raw);
  if (plain(a) && plain(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !/_composite_sig$/.test(k) || p.length !== 1).flatMap((k) => diffUnits(a[k], b[k], [...p, k]));
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((x, i) => diffUnits(x, b[i], [...p, i]));
  return [{ path: p, value: b === undefined ? { deleted: true } : { set: clone(b) } }];
}
export function applyUnits(base, units) {
  const out = clone(base);
  for (const u of units) {
    let n = out;
    for (const k of u.path.slice(0, -1)) n = n[k];
    if (u.value.deleted) delete n[u.path.at(-1)];
    else n[u.path.at(-1)] = clone(u.value.set);
  }
  return out;
}
const jsonUnits = (units) => units.map((u) => ({ path: u.path, ...(u.value.deleted ? { deleted: true } : { set: u.value.set instanceof Raw ? { raw: u.value.set.text } : u.value.set }) }));

// ── Inputs, outcomes and findings: exact shapes, bound by hashes ──

const INPUT_KEYS = ['chain_b64', 'keys_b64', 'revoked_mandate_ids', 'verification_time'];
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const inputOf = (k) => ({ chain_b64: bytesOf(k.chain_text).toString('base64'), keys_b64: bytesOf(k.keys_text).toString('base64'), revoked_mandate_ids: [...k.revoked], verification_time: k.verification_time });
/** The integrity hash of an input: chain bytes, key bytes, revoked ids and clock, in that order. */
export const inputHash = (inp) => sha256(Buffer.from(JSON.stringify(INPUT_KEYS.map((x) => inp[x])), 'utf8'));
// ignoreBOM: a leading EF BB BF stays U+FEFF, so a recorded input is never repaired into another valid one.
const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/** The exact texts of a recorded input, or why it is not one: canonical base64, fatal UTF-8, JSON, revoked strings, RFC 3339 clock. */
export function decodeInput(inp) {
  if (!exactKeys(inp, INPUT_KEYS)) return { error: `an input has exactly ${INPUT_KEYS.join(', ')}` };
  const texts = {};
  for (const f of ['chain_b64', 'keys_b64']) {
    const buf = decodeBase64Strict(inp[f]);
    if (!buf) return { error: `${f} is not canonical base64` };
    try { texts[f] = FATAL_UTF8.decode(buf); } catch { return { error: `${f} is not UTF-8` }; }
    let doc;
    try { doc = JSON.parse(texts[f]); } catch { return { error: `${f} is not JSON` }; }
    if (f === 'chain_b64' ? !Array.isArray(doc) : !isObj(doc)) return { error: `${f} is not a JSON ${f === 'chain_b64' ? 'array' : 'object'}` };
  }
  if (!Array.isArray(inp.revoked_mandate_ids) || !inp.revoked_mandate_ids.every((x) => typeof x === 'string')) return { error: 'revoked_mandate_ids is not an array of strings' };
  if (typeof inp.verification_time !== 'string' || !RFC3339.test(inp.verification_time)) return { error: 'verification_time is not an RFC 3339 instant with an offset' };
  return { chain_text: texts.chain_b64, keys_text: texts.keys_b64, revoked: inp.revoked_mandate_ids, verification_time: inp.verification_time };
}
const FAULTS = ['crash', 'timeout', 'protocol', 'output_limit'];
/** A recorded outcome of one SDK: a verdict, an SDK error, unsupported, or a fault of its process. */
export function validOutcome(x) {
  if (!isObj(x)) return false;
  if (x.category === 'verdict') return exactKeys(x, ['category', 'valid', 'effective_tier', 'errors']) && typeof x.valid === 'boolean' && (x.effective_tier === null || TIERS.includes(x.effective_tier)) && (x.valid || x.effective_tier === null) && Array.isArray(x.errors) && x.errors.every((e) => typeof e === 'string');
  if (x.category === 'sdk_error') return exactKeys(x, ['category', 'message']) && typeof x.message === 'string';
  if (x.category === 'unsupported') return exactKeys(x, ['category']);
  return FAULTS.includes(x.category) && exactKeys(x, ['category', 'detail']) && typeof x.detail === 'string';
}
const validExpect = (e) => e === null || (exactKeys(e, ['valid']) && e.valid === false) || (exactKeys(e, ['valid', 'effective_tier']) && e.valid === true && (e.effective_tier === null || TIERS.includes(e.effective_tier)));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FINDING_KEYS = ['format', 'kind', 'sdks', 'seed', 'iteration', 'sweep', 'family', 'variant', 'anchor', 'expect', 'signing', 'attribution', 'depth', 'check', 'input', 'input_sha256', 'outcomes', 'decisions', 'classes', 'provenance'];
const FINDING_OPTIONAL = ['label', 'control', 'minimized', 'minimization'];
/**
 * A finding file, fully typed: its input, control and minimized input decoded and bound to their hashes; its four
 * outcomes valid; its decisions and classes derived again from them; its control a recorded pass with its tier. Throws an
 * InfraError otherwise.
 */
export function checkFinding(f) {
  const bad = (why) => { throw new InfraError(`not a replayable finding: ${why}`); };
  if (!exactKeys(f, FINDING_KEYS, FINDING_OPTIONAL) || f.format !== FORMAT) bad(`it needs exactly the ${FORMAT} finding fields`);
  if (!Array.isArray(f.sdks) || f.sdks.join() !== SDKS.join()) bad(`sdks must be exactly ${SDKS.join(', ')}`);
  if (!['mutant', 'control'].includes(f.kind)) bad('kind is neither mutant nor control (a batch failure has no single input)');
  if (!validExpect(f.expect) || typeof f.family !== 'string' || typeof f.attribution !== 'string') bad('expect, family or attribution is malformed');
  const bound = (inp, hash, what) => {
    const d = decodeInput(inp);
    if (d.error) bad(`${what}: ${d.error}`);
    if (hash !== inputHash(inp)) bad(`${what}: input_sha256 does not match its chain, keys, revoked ids and clock`);
    return d;
  };
  const outcomesOk = (o) => exactKeys(o, SDKS) && SDKS.every((s) => validOutcome(o[s]));
  bound(f.input, f.input_sha256, 'input');
  if (!outcomesOk(f.outcomes)) bad(`outcomes must be exactly ${SDKS.join(', ')}, each a valid outcome`);
  const j = judgeCase(f, f.outcomes);
  if (!sameJson(f.decisions, j.decisions)) bad('decisions are not the ones its outcomes give');
  if (!sameJson(f.classes, j.classes) || !f.classes.length) bad('classes are not the ones its outcomes and expectation give');
  if (f.kind === 'mutant') {
    const c = f.control;
    if (!exactKeys(c, ['variant', 'expect', 'input', 'input_sha256', 'outcomes', 'decisions']) || !validExpect(c.expect) || c.expect?.valid !== true) bad('a mutant finding records its positive control with its expected tier');
    bound(c.input, c.input_sha256, 'control');
    if (!outcomesOk(c.outcomes) || !sameJson(c.decisions, judgeCase({ family: 'control', attribution: 'isolated', expect: c.expect }, c.outcomes).decisions)) bad('control outcomes or decisions are malformed');
    if (!SDKS.every((s) => c.decisions[s] === `accept:${c.expect.effective_tier}`)) bad('the recorded control did not pass with its expected tier');
  } else if (f.control !== undefined) bad('a control finding has no separate control');
  if (f.minimized !== undefined) {
    const m = f.minimized;
    if (!exactKeys(m, ['input', 'input_sha256', 'decisions', 'original_units', 'minimized_units', 'units', 'note'])) bad('minimized is malformed');
    bound(m.input, m.input_sha256, 'minimized');
    if (!sameJson(m.decisions, f.decisions) || !(m.minimized_units < m.original_units)) bad('a minimized input keeps the four decisions of the finding with fewer units');
  }
  if (!isObj(f.provenance) || !isObj(f.provenance.inputs)) bad('provenance is missing');
  return f;
}

// ── The campaign ──

/**
 * The cases of a campaign, in order. First the coverage sweep: every variant at every depth it applies to, once, in a
 * fixed order (coverage is guaranteed, not probabilistic). Then `iterations` random mutants. Deterministic for a seed.
 */
export function* planCases(o, variants = VARIANTS) {
  const rng = makeRng(o.seed);
  let it = 0;
  for (const v of variants) for (let d = v.minDepth; d <= 2; d++) yield { ...buildCase(v, d, rng), iteration: it++, sweep: true };
  for (let n = 0; n < o.iterations; n++) {
    const v = rng.pick(variants);
    yield { ...buildCase(v, v.minDepth + rng.randInt(3 - v.minDepth), rng), iteration: it++, sweep: false };
  }
}
export const sweepSize = (variants = VARIANTS) => variants.reduce((n, v) => n + 3 - v.minDepth, 0);
const RETAINED_EVENTS = 100;
const newStats = () => ({
  cases: 0, sweep_executed: 0, random_executed: 0, batches: 0, batch_failures: 0, retries: 0, minimize_steps: 0, skipped_oversize: 0,
  by_family: {}, by_variant: {}, evidence: { rule_evidence: 0, agreement_without_expectation: 0, agreement_limited_attribution: 0 }, rule_evidence_by_anchor: {},
  controls: { runs: 0, failed: 0 }, findings: 0, findings_by_class: {}, findings_written: 0, events_total: 0,
});
const id12 = () => crypto.randomBytes(6).toString('hex');

/**
 * Runs a campaign: signer self-checks, the coverage sweep and `iterations` random mutants in bounded batches, each batch
 * with the positive and stale controls of the three bases. It stops after the batch that gives the first finding, which
 * is preserved for review. `commands` (self-tests only) replaces the four wrappers and skips the build; such a run never
 * credits the SDKs. Exit 0 only with every control passed in every batch, the whole sweep executed, no batch failure
 * and no finding; 1 otherwise; 3 for an infrastructure fault.
 */
export async function runCampaign(o, { commands: injected, variants = VARIANTS, log = console.log } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-mandatefuzz-'));
  const stats = newStats();
  const retained = [];
  const events = [];
  let failed = false;
  const event = (e) => { stats.events_total++; if (events.length < RETAINED_EVENTS) events.push(e); };
  const report = {
    format: FORMAT, sdks: SDKS, sdk_campaign: !injected, options: { ...o, report: undefined }, verification_time: VERIFICATION_TIME, inputs: runInputs(),
    provenance_limits: PROVENANCE_LIMITS, outside_transport: OUTSIDE_TRANSPORT,
    wasm: 'not run: WASM exports no mandate chain function; that boundary is documented and tested by the external kit (contract /4), not probed here',
  };
  let provenance;
  const keep = (f) => {
    stats.findings++;
    for (const c of f.classes ?? [f.variant]) stats.findings_by_class[c] = (stats.findings_by_class[c] ?? 0) + 1;
    if (stats.findings_written >= o.maxFindings) return;
    fs.mkdirSync(o.out, { recursive: true });
    const file = path.join(o.out, `${o.seed.replace(/[^A-Za-z0-9_-]/g, '_')}-${f.iteration}-${f.variant}-${stats.findings}.json`);
    fs.writeFileSync(file, JSON.stringify(f, null, 2));
    stats.findings_written++;
    retained.push({ file: path.relative(ROOT, file).startsWith('..') ? file : path.relative(ROOT, file), kind: f.kind, variant: f.variant, family: f.family, depth: f.depth, classes: f.classes, decisions: f.decisions, expect: f.expect,
      ...(f.minimized ? { original_units: f.minimized.original_units, minimized_units: f.minimized.minimized_units } : {}) });
  };
  try {
    report.signer_check = signerSelfCheck();
    const built = injected ? { steps: [], commands: injected, artifacts: 'injected commands (self-tests): no SDK is credited' } : await buildWrappers(o, tmp);
    if (!exactKeys(built.commands, SDKS) || !SDKS.every((s) => Array.isArray(built.commands[s]) && built.commands[s].length && built.commands[s].every((x) => typeof x === 'string' && x))) {
      throw new InfraError(`commands must be exactly ${SDKS.join(', ')}, each a non-empty argv of strings`);
    }
    report.build = { steps: built.steps, artifacts: built.artifacts };
    provenance = { inputs: report.inputs, artifacts: built.artifacts };
    const controls = [0, 1, 2].flatMap(controlsOf);
    for (const k of controls) if (k.signing === 'resigned' ? !k.check.normative : k.check.stale.still_verifies) throw new InfraError(`control ${k.variant}: its signatures are not as built`);
    const perBatch = o.batchCases - controls.length;
    let minimizeLeft = o.minimizeTotal;
    let retriesLeft = o.maxRetries;

    // Runs `cases` through the four wrappers. Each case keeps its batch id; a failed batch of one SDK is isolated by
    // rerunning a copy of each case alone, under a fresh id, within the retry budget.
    const execute = async (cases) => {
      stats.batches++;
      const ids = cases.map((_k, i) => `c${i}-${id12()}`);
      const settled = await Promise.allSettled(SDKS.map((s) => runBatch(built.commands[s], cases.map((k, i) => ({ ...k, wireId: ids[i] })), o)));
      const rejected = settled.find((r) => r.status === 'rejected');
      if (rejected) throw rejected.reason;
      const out = cases.map(() => ({}));
      for (const [j, s] of SDKS.entries()) {
        const { judged } = settled[j].value;
        if (judged.ok) { ids.forEach((id, i) => { out[i][s] = judged.results.get(id); }); continue; }
        if (judged.fatal) throw new InfraError(`${s}: ${judged.detail}`);
        failed = true;
        stats.batch_failures++;
        event({ kind: 'batch_failure', sdk: s, category: judged.category, detail: judged.detail.slice(0, 300), stderr: (judged.stderr ?? '').slice(-400) });
        let reproduced = false;
        for (const [i, k] of cases.entries()) {
          if (retriesLeft <= 0) throw new InfraError('retry budget exhausted while isolating a failed batch');
          retriesLeft--;
          stats.retries++;
          const id = `r${i}-${id12()}`;
          const one = await runBatch(built.commands[s], [{ ...k, wireId: id }], o);
          if (one.judged.ok) out[i][s] = one.judged.results.get(id);
          else if (one.judged.fatal) throw new InfraError(`${s}: ${one.judged.detail}`);
          else { reproduced = true; out[i][s] = { category: one.judged.category, detail: one.judged.detail.slice(0, 300) }; }
        }
        if (!reproduced) { stats.findings++; stats.findings_by_class.batch_failure_not_reproduced = (stats.findings_by_class.batch_failure_not_reproduced ?? 0) + 1; event({ kind: 'batch_failure_not_reproduced', sdk: s, category: judged.category }); }
      }
      return out;
    };
    const findingOf = (k, j, outcomes, control, controlOutcomes) => ({
      format: FORMAT, kind: k.family === 'control' ? 'control' : 'mutant', sdks: SDKS, seed: o.seed, iteration: k.iteration ?? null, sweep: Boolean(k.sweep),
      family: k.family, variant: k.variant, anchor: k.anchor, expect: k.expect, signing: k.signing, attribution: k.attribution, ...(k.label ? { label: k.label } : {}),
      depth: k.depth, check: k.check, input: inputOf(k), input_sha256: inputHash(inputOf(k)), outcomes, decisions: j.decisions, classes: j.classes,
      ...(control ? { control: { variant: control.variant, expect: control.expect, input: inputOf(control), input_sha256: inputHash(inputOf(control)), outcomes: controlOutcomes, decisions: judgeCase(control, controlOutcomes).decisions } } : {}),
      provenance,
    });
    // Bounded minimization of a re-signed semantic mutant: revert one diff unit at a time, re-sign under the normative
    // signer and context, check every signature with primitives, and keep the reversion only if the four decisions are
    // unchanged and the base's positive control, run in the same batch, still passes. Never for deliberate or stale cases.
    const minimize = async (k, j, positive) => {
      const base = signedBase(k.depth);
      let units = diffUnits(base, k.semantic);
      const original = units.length;
      for (let step = 0, i = 0; i < units.length && step < o.minimizeSteps && minimizeLeft > 0; step++) {
        minimizeLeft--;
        stats.minimize_steps++;
        const trial = units.filter((_u, x) => x !== i);
        const chain = signChain(applyUnits(base, trial));
        if (!normativeSignatures(chain, JSON.parse(k.keys_text))) { i++; continue; }
        const [co, po] = await execute([{ ...k, semantic: chain, chain_text: serialize(chain) }, { ...positive }]);
        if (SDKS.every((s) => decision(co[s]) === j.decisions[s]) && judgeCase(positive, po).classes.length === 0) units = trial; else i++;
      }
      if (units.length === original) return { minimization: `no unit could be reverted within the budget (${original} unit(s))` };
      const chain = signChain(applyUnits(base, units));
      const m = { ...k, chain_text: serialize(chain) };
      return { minimized: { input: inputOf(m), input_sha256: inputHash(inputOf(m)), decisions: j.decisions, original_units: original, minimized_units: units.length, units: jsonUnits(units),
        note: 'Minimal for this search and budget only. Every candidate was re-signed under the normative signer and context, checked with primitives, kept the four decisions and ran with a passing positive control.' } };
    };

    let pending = [];
    let stop = false;
    const flush = async (force = false) => {
      if (!pending.length && !force) return;
      const batch = [...controls.map((c) => ({ ...c })), ...pending];
      pending = [];
      const outs = await execute(batch);
      stats.controls.runs++;
      const controlFailed = new Set();
      for (const [i, k] of batch.entries()) {
        if (k.family !== 'control') continue;
        const j = judgeCase(k, outs[i]);
        if (j.classes.length) { failed = true; stats.controls.failed++; controlFailed.add(k.depth); keep(findingOf(k, j, outs[i])); }
      }
      for (const [i, k] of batch.entries()) {
        if (k.family === 'control') continue;
        if (controlFailed.has(k.depth)) { event({ kind: 'not_judged_control_failed', variant: k.variant, depth: k.depth }); continue; }
        const j = judgeCase(k, outs[i]);
        stats.cases++;
        stats[k.sweep ? 'sweep_executed' : 'random_executed']++;
        stats.by_family[k.family] = (stats.by_family[k.family] ?? 0) + 1;
        stats.by_variant[k.variant] = (stats.by_variant[k.variant] ?? 0) + 1;
        if (!j.classes.length) {
          stats.evidence[j.evidence]++;
          if (j.evidence === 'rule_evidence') stats.rule_evidence_by_anchor[k.anchor] = (stats.rule_evidence_by_anchor[k.anchor] ?? 0) + 1;
          continue;
        }
        failed = true;
        const pi = batch.findIndex((c) => c.variant === `positive_depth_${k.depth}`);
        const f = findingOf(k, j, outs[i], batch[pi], outs[pi]);
        if (k.signing === 'resigned' && !j.classes.includes('sdk_fault') && o.minimizeSteps > 0 && minimizeLeft > 0) Object.assign(f, await minimize(k, j, batch[pi]));
        else f.minimization = k.signing === 'resigned' ? 'not attempted: an SDK fault, or no minimization budget left' : `not applicable: signing ${k.signing} is not a re-signed semantic change`;
        keep(f);
      }
      if (failed) stop = true;
    };
    for (const k of planCases(o, variants)) {
      const bad = (k.check.normative === false) || (k.check.deliberate && !k.check.deliberate.verifies_as_built) || (k.check.stale && k.check.stale.still_verifies);
      if (bad) throw new InfraError(`${k.variant}: the signatures of the case are not as its signing category states (${JSON.stringify(k.check)})`);
      if (caseBytes(k) > o.caseBytes) { stats.skipped_oversize++; event({ kind: 'skipped_oversize', variant: k.variant, depth: k.depth, sweep: k.sweep }); continue; }
      pending.push(k);
      if (pending.length >= perBatch) await flush();
      if (stop) break;
    }
    if (!stop) await flush(stats.batches === 0);
    const required = sweepSize(variants);
    report.coverage = {
      sweep_required: required, sweep_executed: stats.sweep_executed, random_requested: o.iterations, random_executed: stats.random_executed,
      variants_exercised: Object.keys(stats.by_variant).length, variants_defined: variants.length, complete: stats.sweep_executed === required,
    };
    if (stop) report.stopped = 'after the batch that gave the first finding or failure, preserved for review; the remaining cases were not run';
    report.exit = failed || stats.findings || !report.coverage.complete || stats.controls.runs === 0 ? 1 : 0;
  } catch (e) {
    report.error = { kind: e instanceof InfraError ? 'infrastructure' : 'exception', message: e instanceof InfraError ? e.message : (e.stack ?? String(e)) };
    log(`${report.error.kind} error: ${e.message}`);
    report.exit = 3;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  Object.assign(report, { stats, events, findings: retained });
  log(`seed ${o.seed}: ${stats.cases} cases (sweep ${stats.sweep_executed}/${sweepSize(variants)}, random ${stats.random_executed}) in ${stats.batches} batches (${stats.batch_failures} failed), ${stats.evidence.rule_evidence} rule evidence, ${stats.findings} findings; exit ${report.exit}`);
  return report;
}

// ── Replay of a finding: its saved input, control and minimized input, each alone, through the four wrappers ──

/** Every recorded input of a checked finding, each run alone through each wrapper: a failed run is its fault category. */
async function runAlone(commands, cases, o) {
  const out = cases.map(() => ({}));
  for (const s of SDKS) {
    for (const [i, k] of cases.entries()) {
      const id = `p${i}-${id12()}`;
      const r = await runBatch(commands[s], [{ ...k, wireId: id }], o);
      if (r.judged.fatal) throw new InfraError(`${s}: ${r.judged.detail}`);
      out[i][s] = r.judged.ok ? r.judged.results.get(id) : { category: r.judged.category, detail: r.judged.detail.slice(0, 300) };
    }
  }
  return out;
}
const differences = (a, b, p = '') => {
  if (sameJson(a, b)) return [];
  if (isObj(a) && isObj(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => differences(a[k], b[k], p ? `${p}.${k}` : k));
  return [p || '(root)'];
};
/**
 * Replays a finding with its own clock, keys and revoked ids. Exit 0: the finding's four decisions, its control's exact
 * recorded baseline and any minimized input's decisions reproduce; 1: one does not; 3: the finding is malformed, the
 * control does not reproduce its baseline (no judgement), or the infrastructure fails. Provenance differences from the
 * recorded build are reported, never certified away.
 */
export async function replayFinding(o, { commands: injected, log = console.log } = {}) {
  const out = { format: FORMAT, replay: o.replay };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-mandatefuzz-replay-'));
  try {
    let f;
    try { f = JSON.parse(fs.readFileSync(o.replay, 'utf8')); } catch (e) { throw new InfraError(`not a replayable finding: ${e.message}`); }
    checkFinding(f);
    const built = injected ? { commands: injected, artifacts: 'injected commands (self-tests)' } : await buildWrappers(o, tmp);
    out.provenance_differences = differences(f.provenance, { inputs: runInputs(), artifacts: built.artifacts });
    const asCase = (inp) => decodeInput(inp);
    const cases = [asCase(f.input), ...(f.control ? [asCase(f.control.input)] : []), ...(f.minimized ? [asCase(f.minimized.input)] : [])];
    const res = await runAlone(built.commands, cases, o);
    const d = (i) => Object.fromEntries(SDKS.map((s) => [s, decision(res[i][s])]));
    out.now = d(0);
    out.recorded = f.decisions;
    let next = 1;
    if (f.control) {
      out.control = { recorded: f.control.decisions, now: d(next++) };
      if (!sameJson(out.control.now, out.control.recorded)) throw new InfraError(`the control did not reproduce its recorded baseline: ${JSON.stringify(out.control.now)}`);
    }
    out.reproduces = sameJson(out.now, out.recorded);
    if (f.minimized) {
      out.minimized = { recorded: f.minimized.decisions, now: d(next++) };
      out.minimized.reproduces = sameJson(out.minimized.now, out.minimized.recorded);
    }
    out.exit = out.reproduces && (out.minimized?.reproduces ?? true) ? 0 : 1;
  } catch (e) {
    out.error = { kind: e instanceof InfraError ? 'infrastructure' : 'exception', message: e.message };
    out.exit = 3;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  log(JSON.stringify({ reproduces: out.reproduces ?? null, exit: out.exit }));
  return out;
}

// ── Transport probe: inputs contract /4 does not carry to every SDK, measured per component, never a conformance result ──

export const TRANSPORT_LIMITS = [
  'An observation of what contract /4 carries to each SDK, not a conformance requirement: the outcome of each input depends on the JSON reader of each wrapper and may change.',
  'A refusal is the wrapper exiting before calling its SDK (exit 2 for a request it cannot read); it is never an SDK rejection and never counted as one.',
  'The NaN and 1e400 chains carry a stale signature (neither has a dcp-jcs-v1 form): a verdict on them shows only that the SDK was reached and what it answered.',
  'The control is the signed depth-1 positive; the probe is interpretable only when the four wrappers accept it.',
];
/** The control and the three boundary inputs, as exact texts. */
export function transportInputs() {
  const text = serialize(signedBase(1));
  const keys = JSON.stringify(keysDoc());
  const token = (t) => {
    const out = text.replace('"max_messages_per_day":50', `"max_messages_per_day":${t}`);
    if (out === text) throw new InfraError('transport probe: the depth-1 base has no limit 50 to replace');
    return out;
  };
  return [
    ['control', text], ['nan_token', token('NaN')], ['leading_byte_order_mark', String.fromCharCode(0xfeff) + text], ['overflowing_literal_1e400', token('1e400')],
  ].map(([name, chain]) => ({ name, chain_text: chain, keys_text: keys, revoked: [], verification_time: VERIFICATION_TIME }));
}
/** Sends each boundary input alone to each wrapper and records what each component did. Exit 0 when interpretable, 3 otherwise. */
export async function transportProbe(o, { commands: injected, log = console.log } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-mandatefuzz-transport-'));
  const out = { format: FORMAT, probe: 'transport', sdks: SDKS, verification_time: VERIFICATION_TIME, limits: TRANSPORT_LIMITS, inputs: runInputs() };
  try {
    const built = injected ? { commands: injected, artifacts: 'injected commands (self-tests)' } : await buildWrappers(o, tmp);
    out.artifacts = built.artifacts;
    const cases = transportInputs();
    out.cases = cases.map((k) => ({ name: k.name, input_sha256: inputHash(inputOf(k)), chain_sha256: sha256(bytesOf(k.chain_text)) }));
    out.results = {};
    for (const s of SDKS) {
      out.results[s] = {};
      for (const k of cases) {
        const id = `t-${id12()}`;
        const r = await runBatch(built.commands[s], [{ ...k, wireId: id }], o);
        if (r.judged.fatal) throw new InfraError(`${s}: ${r.judged.detail}`);
        out.results[s][k.name] = r.judged.ok ? { reached_sdk: true, decision: decision(r.judged.results.get(id)) }
          : { reached_sdk: false, refused: r.judged.category, exit_code: r.observed.exit_code, signal: r.observed.signal, stderr: (r.judged.stderr ?? '').slice(-300) };
      }
    }
    const control = SDKS.map((s) => out.results[s].control);
    if (!control.every((x) => x.reached_sdk && x.decision === 'accept:elevated')) throw new InfraError(`transport probe: the control was not accepted by the four wrappers (${JSON.stringify(control)})`);
    out.exit = 0;
  } catch (e) {
    out.error = { kind: e instanceof InfraError ? 'infrastructure' : 'exception', message: e.message };
    out.exit = 3;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  log(JSON.stringify(out.results ?? out.error));
  return out;
}
