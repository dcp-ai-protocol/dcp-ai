/**
 * DCP-09 §3.5.2 Mandate Chain Time Vector Generator
 *
 * Writes tests/interop/v2/mandate_chain_time_vectors.json: signed chains (a root signed by the human, a sub-mandate
 * signed by the root's agent) that every SDK's chain verifier MUST accept or reject on the time rules alone: validity
 * windows, nesting in the parent's window, the expires_at of the keys of both signature slots, and the verification
 * time. Every time is an RFC 3339 instant of the subset of interop_vectors.json#rfc3339, compared in milliseconds,
 * both limits included; years 0000 and offsets that cross year 0000 or 9999 are instants like any other.
 *
 * The expectations are written by hand. Before writing, the generator checks every signature with compositeVerify
 * (a time vector never rests on a forged or stale signature) and every expectation against a time-only reference
 * evaluator below, written from the contract; it never asks verifyMandateChain what to expect. Keys are fresh and
 * ML-DSA-65 signatures are hedged, so a new run writes other keys and signatures: the committed file is the artifact.
 *
 * Run: cd sdks/typescript && npx --no -- vite-node src/__tests__/generate-mandate-chain-time-vectors.ts
 * (`--no` never installs: it takes a local or an already cached vite-node; this checkout has no local one).
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import type { DcpContext } from '../core/domain-separation.js';
import { compositeSign, compositeVerify } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import type { CompositeSignature } from '../core/composite-sig.js';
import { generateSessionNonce } from '../core/session-nonce.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../../../../tests/interop/v2/mandate_chain_time_vectors.json');

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

const HUMAN = 'human:chain-time-principal';
const ORCHESTRATOR = 'agent:chain-time-orchestrator';
const SUBAGENT = 'agent:chain-time-subagent';
const VERIFICATION_TIME = '2026-10-22T12:00:00.000Z';

type Mandate = Record<string, unknown>;
type KeyEntry = { kid: string; alg: string; public_key_b64: string; created_at: string; expires_at: string | null; status: 'active' };
type Keys = { human_keys: KeyEntry[]; agent_keys: Record<string, KeyEntry[]> };

async function generateKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}

const entries = (k: CompositeKeyPair, classical: string | null = null, pq: string | null = null): KeyEntry[] => [
  { kid: k.classical.kid, alg: k.classical.alg, public_key_b64: k.classical.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: classical, status: 'active' },
  { kid: k.pq.kid, alg: k.pq.alg, public_key_b64: k.pq.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: pq, status: 'active' },
];

const SIG_FIELDS = ['human_composite_sig', 'delegator_composite_sig'];
const unsigned = (m: Mandate): Mandate => Object.fromEntries(Object.entries(m).filter(([k]) => !SIG_FIELDS.includes(k)));
const bytesOf = (m: Mandate) => new TextEncoder().encode(canonicalizeV2(unsigned(m)));

async function signed(payload: Mandate, context: DcpContext, keys: CompositeKeyPair, field: string): Promise<Mandate> {
  return { ...payload, [field]: await compositeSign(registry, context, bytesOf(payload), keys) };
}

// ── Time-only reference evaluator, written from the contract (not from any verifier) ──

const RFC3339 = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(?:Z|([+-])([0-9]{2}):([0-9]{2}))$/;
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
function instant(v: unknown): number | undefined {
  const m = typeof v === 'string' ? RFC3339.exec(v) : null;
  // The whole string, nothing after it (a trailing newline included).
  if (!m || m[0].length !== (v as string).length) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const [oh, om] = [Number(m[9] ?? 0), Number(m[10] ?? 0)];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (mo < 1 || mo > 12 || d < 1 || d > last || h > 23 || mi > 59 || s > 59 || oh > 23 || om > 59) return undefined;
  const ms = Number((m[7] ?? '').slice(0, 3).padEnd(3, '0'));
  const offset = (m[8] === '-' ? -1 : 1) * (oh * 60 + om);
  return ((daysFromCivil(y, mo, d) * 24 + h) * 60 + mi - offset) * 60000 + s * 1000 + ms;
}

/** The time errors of each mandate, as the chain rules name them: window shape, nesting, the window at now, signer keys. */
function timeErrors(chain: Mandate[], keys: Keys, now: number): string[][] {
  return chain.map((m, i) => {
    const errors: string[] = [];
    const from = instant(m.valid_from);
    const until = instant(m.valid_until);
    if (from === undefined) errors.push('missing or invalid valid_from');
    if (until === undefined) errors.push('missing or invalid valid_until');
    if (errors.length > 0) return errors;
    if (i > 0) {
      if (from! < instant(chain[i - 1].valid_from)!) errors.push('valid_from is before the parent valid_from');
      if (until! > instant(chain[i - 1].valid_until)!) errors.push('valid_until is after the parent valid_until');
    }
    if (from! > now) errors.push('not yet valid at the verification time');
    if (until! < now) errors.push('expired at the verification time');
    const field = i === 0 ? 'human_composite_sig' : 'delegator_composite_sig';
    const list = i === 0 ? keys.human_keys : keys.agent_keys[chain[i - 1].agent_id as string];
    const sig = m[field] as CompositeSignature;
    for (const slot of [sig.classical, sig.pq!]) {
      const key = list.find((k) => k.kid === slot.kid)!;
      if (key.expires_at === null) continue;
      const expires = instant(key.expires_at);
      if (expires === undefined || expires < now) {
        errors.push(`${field}: signer key kid=${slot.kid} has expired or has an invalid expires_at`);
        break; // a slot that fails stops the signature check, as the chain rules do
      }
    }
    return errors;
  });
}

async function main() {
  const human = await generateKeys();
  const orchestrator = await generateKeys();
  const keysWith = (hc: string | null = null, hpq: string | null = null, oc: string | null = null, opq: string | null = null): Keys => ({
    human_keys: entries(human, hc, hpq),
    agent_keys: { [ORCHESTRATOR]: entries(orchestrator, oc, opq) },
  });
  const KEYS = keysWith();

  const root = (window: { from: string; until: string }) =>
    signed(
      {
        dcp_version: '2.0',
        mandate_id: 'mandate:chain-time-root',
        session_nonce: generateSessionNonce(),
        human_id: HUMAN,
        agent_id: ORCHESTRATOR,
        authority_scope: [{ domain: 'email', actions_permitted: ['read', 'send'] }],
        valid_from: window.from,
        valid_until: window.until,
        revocable: true,
        timestamp: '2026-01-01T00:00:00Z',
        sub_delegation: { permitted: true, max_depth: 1 },
      },
      DCP_CONTEXTS.Delegation,
      human,
      'human_composite_sig',
    );
  const sub = (parent: Mandate, window: { from: string; until: string }) =>
    signed(
      {
        dcp_version: '2.0',
        mandate_id: 'mandate:chain-time-sub',
        session_nonce: generateSessionNonce(),
        human_id: HUMAN,
        agent_id: SUBAGENT,
        authority_scope: [{ domain: 'email', actions_permitted: ['read'] }],
        valid_from: window.from,
        valid_until: window.until,
        revocable: true,
        timestamp: '2026-01-01T00:00:00Z',
        parent_mandate_id: parent.mandate_id,
        delegation_depth: 1,
      },
      DCP_CONTEXTS.SubMandate,
      orchestrator,
      'delegator_composite_sig',
    );
  const chain = async (r: { from: string; until: string }, s?: { from: string; until: string }) => {
    const rm = await root(r);
    return s ? [rm, await sub(rm, s)] : [rm];
  };
  const ROOT = { from: '2026-01-01T00:00:00Z', until: '2099-01-01T00:00:00Z' };
  const SUB = { from: '2026-02-01T00:00:00Z', until: '2098-01-01T00:00:00Z' };
  const BEFORE = '2026-10-22T11:59:59.999Z';
  const kid = { hc: human.classical.kid, hpq: human.pq.kid, oc: orchestrator.classical.kid, opq: orchestrator.pq.kid };

  type Case = { name: string; chain: Mandate[]; keys?: Keys; verification_time?: string; expected?: { depth: number; effective_tier: null }; error_contains?: string };
  const accept: Case[] = [
    { name: 'root_only', chain: await chain(ROOT), expected: { depth: 0, effective_tier: null } },
    { name: 'root_and_sub', chain: await chain(ROOT, SUB), expected: { depth: 1, effective_tier: null } },
    {
      name: 'nested_limits_equal_in_milliseconds_written_differently',
      chain: await chain({ from: '2026-02-01T00:00:00Z', until: '2098-01-01T00:00:00Z' }, { from: '2026-02-01T01:00:00.0009+01:00', until: '2097-12-31T23:00:00.0004-01:00' }),
      expected: { depth: 1, effective_tier: null },
    },
    {
      name: 'windows_at_the_verification_time',
      chain: await chain({ from: '2026-10-22T12:00:00Z', until: '2026-10-22T12:00:00.000Z' }, { from: '2026-10-22T14:00:00+02:00', until: '2026-10-22T12:00:00.0009Z' }),
      expected: { depth: 1, effective_tier: null },
    },
    {
      name: 'windows_from_year_0000_to_year_9999_offsets_crossing_both',
      chain: await chain({ from: '0000-01-01T00:00:00+00:01', until: '9999-12-31T23:59:59.999-23:59' }, { from: '0000-01-01T00:00:00Z', until: '9999-12-31T23:59:59.999Z' }),
      expected: { depth: 1, effective_tier: null },
    },
    {
      name: 'every_signer_key_expires_at_the_verification_time',
      chain: await chain(ROOT, SUB),
      keys: keysWith('2026-10-22T12:00:00Z', '2026-10-22T12:00:00.000Z', '2026-10-22T14:00:00+02:00', '2026-10-22T12:00:00.0009Z'),
      expected: { depth: 1, effective_tier: null },
    },
    {
      name: 'every_signer_key_expires_after_year_9999_with_an_offset',
      chain: await chain(ROOT, SUB),
      keys: keysWith(...(Array(4).fill('9999-12-31T23:59:59.999-23:59') as [string, string, string, string])),
      expected: { depth: 1, effective_tier: null },
    },
    { name: 'verification_time_with_an_offset', chain: await chain(ROOT, SUB), verification_time: '2026-10-22T14:00:00+02:00', expected: { depth: 1, effective_tier: null } },
    {
      name: 'verification_time_below_the_millisecond',
      chain: await chain(ROOT, SUB),
      keys: keysWith('2026-10-22T12:00:00Z', '2026-10-22T12:00:00Z', '2026-10-22T12:00:00Z', '2026-10-22T12:00:00Z'),
      verification_time: '2026-10-22T12:00:00.0009Z',
      expected: { depth: 1, effective_tier: null },
    },
  ];
  const reject: Case[] = [
    { name: 'root_expired_by_one_millisecond', chain: await chain({ from: ROOT.from, until: BEFORE }), error_contains: 'mandate[0]: expired at the verification time' },
    { name: 'sub_not_yet_valid_by_one_millisecond', chain: await chain(ROOT, { from: '2026-10-22T12:00:00.001Z', until: SUB.until }), error_contains: 'mandate[1]: not yet valid at the verification time' },
    {
      name: 'sub_starts_one_millisecond_before_the_parent',
      chain: await chain({ from: '2026-02-01T00:00:00Z', until: ROOT.until }, { from: '2026-02-01T00:59:59.999+01:00', until: SUB.until }),
      error_contains: 'mandate[1]: valid_from is before the parent valid_from',
    },
    {
      name: 'sub_ends_one_millisecond_after_the_parent',
      chain: await chain({ from: ROOT.from, until: '2098-01-01T00:00:00Z' }, { from: SUB.from, until: '2098-01-01T00:00:00.001Z' }),
      error_contains: 'mandate[1]: valid_until is after the parent valid_until',
    },
    { name: 'human_classical_key_expired_one_millisecond_before', chain: await chain(ROOT, SUB), keys: keysWith(BEFORE), error_contains: `mandate[0]: human_composite_sig: signer key kid=${kid.hc} has expired` },
    { name: 'human_pq_key_expired_one_millisecond_before', chain: await chain(ROOT, SUB), keys: keysWith(null, BEFORE), error_contains: `mandate[0]: human_composite_sig: signer key kid=${kid.hpq} has expired` },
    { name: 'agent_classical_key_expired_one_millisecond_before', chain: await chain(ROOT, SUB), keys: keysWith(null, null, BEFORE), error_contains: `mandate[1]: delegator_composite_sig: signer key kid=${kid.oc} has expired` },
    { name: 'agent_pq_key_expired_one_millisecond_before', chain: await chain(ROOT, SUB), keys: keysWith(null, null, null, BEFORE), error_contains: `mandate[1]: delegator_composite_sig: signer key kid=${kid.opq} has expired` },
    { name: 'key_expires_at_without_an_offset', chain: await chain(ROOT, SUB), keys: keysWith('2099-01-01T00:00:00'), error_contains: `signer key kid=${kid.hc} has expired or has an invalid expires_at` },
    { name: 'key_expires_at_with_a_trailing_newline', chain: await chain(ROOT, SUB), keys: keysWith('2099-01-01T00:00:00Z\n'), error_contains: `signer key kid=${kid.hc} has expired or has an invalid expires_at` },
    { name: 'key_expires_at_crossing_into_year_minus_1', chain: await chain(ROOT, SUB), keys: keysWith(null, '0000-01-01T00:00:00+00:01'), error_contains: `signer key kid=${kid.hpq} has expired` },
    { name: 'root_window_in_year_minus_1', chain: await chain({ from: '0000-01-01T00:00:00+00:02', until: '0000-01-01T00:00:00+00:01' }), error_contains: 'mandate[0]: expired at the verification time' },
    {
      name: 'sub_window_starting_in_year_10000',
      chain: await chain({ from: ROOT.from, until: '9999-12-31T23:59:59.999-23:59' }, { from: '9999-12-31T23:59:59.999-23:58', until: '9999-12-31T23:59:59.999-23:59' }),
      error_contains: 'mandate[1]: not yet valid at the verification time',
    },
  ];

  const names = [...accept, ...reject].map((c) => c.name);
  if (new Set(names).size !== names.length) throw new Error('duplicate case names');
  // Every signature is real and verifies before any time rule is looked at.
  for (const c of [...accept, ...reject]) {
    for (const [i, m] of c.chain.entries()) {
      const [field, context, signer] = i === 0 ? ['human_composite_sig', DCP_CONTEXTS.Delegation, human] as const : ['delegator_composite_sig', DCP_CONTEXTS.SubMandate, orchestrator] as const;
      const r = await compositeVerify(registry, context, bytesOf(m), m[field] as CompositeSignature, signer.classical.publicKeyB64, signer.pq.publicKeyB64);
      if (!r.valid || !r.classical_valid || r.pq_valid !== true) throw new Error(`${c.name}: mandate[${i}] ${field} does not verify`);
    }
    // The hand-written expectation against the time-only reference.
    const now = instant(c.verification_time ?? VERIFICATION_TIME);
    if (now === undefined) throw new Error(`${c.name}: the verification time is not an instant`);
    const errs = timeErrors(c.chain, c.keys ?? KEYS, now);
    const first = errs.findIndex((e) => e.length > 0);
    if (c.expected) {
      if (first !== -1) throw new Error(`${c.name}: expected to verify, the reference finds ${JSON.stringify(errs)}`);
    } else {
      const text = first === -1 ? '' : errs[first].map((e) => `mandate[${first}]: ${e}`).join('\n').toLowerCase();
      if (!text.includes(c.error_contains!.toLowerCase())) throw new Error(`${c.name}: expected "${c.error_contains}", the reference finds ${JSON.stringify(errs)}`);
    }
  }

  const strip = ({ name, chain: ch, keys, verification_time, expected, error_contains }: Case) => ({
    name,
    chain: ch,
    revoked_mandate_ids: [],
    ...(keys ? { keys } : {}),
    ...(verification_time ? { verification_time } : {}),
    ...(expected ? { expected } : { error_contains: error_contains!.toLowerCase() }),
  });
  const out = {
    _description:
      'Cross-SDK DCP-09 §3.5.2 mandate chain time vectors. Every chain verifier MUST accept each must_accept chain (root first) and report expected.depth and expected.effective_tier, and MUST reject each must_reject chain with an error that contains error_contains (case-insensitive), verified at the case verification_time (else verification_time) against the case keys (else keys) with revoked_mandate_ids revoked. ' +
      'Windows, nesting in the parent window and the expires_at of the signer keys of both slots are RFC 3339 instants of the subset of interop_vectors.json#rfc3339, compared in milliseconds and never as text, both limits included; year 0000 and offsets crossing year 0000 or 9999 are instants like any other. ' +
      'Every signature is real (Ed25519 + ML-DSA-65, pq_over_classical): the root by the human, the sub-mandate by the root agent. Key material is synthetic, generated for these vectors only.',
    _generator: 'sdks/typescript/src/__tests__/generate-mandate-chain-time-vectors.ts',
    verification_time: VERIFICATION_TIME,
    keys: KEYS,
    must_accept: accept.map(strip),
    must_reject: reject.map(strip),
  };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${OUTPUT_PATH}: ${accept.length} must_accept, ${reject.length} must_reject`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
