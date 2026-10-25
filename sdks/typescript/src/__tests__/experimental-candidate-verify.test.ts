/**
 * EXPERIMENTAL candidate dcp-jcs-v2, phase 3: the bytes verifier against the public signed vectors
 * (tests/interop/candidate/phase3-signed-vectors.json), with both built-in historical adapters, and
 * the controls of the contract: every signed base's signatures verify, the profile policy is
 * required, a decoder refusal is not delegated while a decoded null is, buffers the caller or the
 * adapter mutates, today's object API still refusing dcp-jcs-v2, and nothing internal in the package
 * entry point. Each case checks the verifiers it entered (one at most) through the probe.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { canonicalizeV2 } from '../core/canonicalize.js';
import { compositeVerify } from '../core/composite-ops.js';
import type { CompositeSignature } from '../core/composite-sig.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import { experimentalCandidateIngress } from '../core/experimental-candidate-ingress.js';
import {
  ExperimentalCandidateAdapterError,
  ExperimentalCandidateConfigError,
  experimentalHistoricalAdapters,
} from '../core/experimental-candidate-router.js';
import type { ExperimentalHistoricalAdapter } from '../core/experimental-candidate-router.js';
import {
  createExperimentalCandidateVerifier,
  createExperimentalCandidateVerifierForTests,
} from '../core/experimental-candidate-verify.js';
import type { ExperimentalCandidateVerifyResult } from '../core/experimental-candidate-verify.js';
import { DEFAULT_VERIFIER_POLICY, verifySignedBundleV2 } from '../core/verify-v2.js';
import * as sdk from '../index.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import type { KeyEntry, SignedBundleV2, VerifierPolicy } from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tests/interop/candidate/phase3-signed-vectors.json'), 'utf8'),
);
const NOW = { now: vectors.now_ms as number };
const TIMEOUT_MS = 30_000;

const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

type Edit = Record<string, string | number>;
type Expected = {
  route: Record<string, unknown>;
  adapter_calls: number;
  entered: string;
  verification: null | { verified: boolean; errors_contain: Record<'ts' | 'py' | 'go' | 'rust' | 'wasm', string[]> };
  manifest_sha256?: string;
  canonical_sha256?: string;
};
type Case = {
  id: string;
  input: { base: string; edits: Edit[] };
  input_sha256: string;
  transport: 'bare' | 'envelope';
  accepted_profiles: string[];
  verifier_policy: string;
  expected: Expected;
  by_adapter?: Record<string, Expected>;
};
const cases = vectors.cases as Case[];
const byId = (id: string) => cases.find((c) => c.id === id)!;

/** The 57 case IDs approved for phase 3, written here: the vectors must carry exactly these, each once. */
const APPROVED_IDS: readonly string[] = [
  'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08',
  'P09', 'P10', 'P11', 'P12', 'P13-800', 'P13-801', 'P13-5000', 'P14',
  'R01', 'R02', 'R03', 'R04', 'R05a', 'R05b-v2', 'R06', 'R07',
  'R08', 'R09', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15',
  'R16', 'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07',
  'F08', 'F09', 'F10', 'F11', 'F12', 'F13', 'F14', 'D01',
  'D02', 'D03', 'D04', 'R05b-both', 'D05', 'D06', 'D07', 'D08',
  'D09',
];

/** Why `ids` is not exactly the approved set, each once (repeated, missing, unknown), or null. */
function idProblem(ids: readonly string[]): string | null {
  const seen = new Set<string>();
  const repeated = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  const missing = APPROVED_IDS.filter((id) => !seen.has(id));
  const unknown = [...seen].filter((id) => !APPROVED_IDS.includes(id));
  return repeated.length + missing.length + unknown.length === 0 ? null : JSON.stringify({ repeated, missing, unknown });
}

// Checked when the file loads, before any case runs: a missing, repeated or unknown ID fails it.
const vectorIdProblem = idProblem(cases.map((c) => c.id));
if (vectorIdProblem !== null) throw new Error(`phase 3 vectors: not the approved case IDs: ${vectorIdProblem}`);

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** The input of a case: its base, then each edit in order on the bytes (the format of the file). */
function input(c: Case): Uint8Array {
  let buf = Buffer.from(vectors.bases[c.input.base].input_json as string, 'latin1');
  for (const e of c.input.edits) {
    if ('find' in e) {
      const find = Buffer.from(e.find as string, 'latin1');
      const i = buf.indexOf(find);
      if (i < 0 || buf.indexOf(find, i + 1) >= 0) throw new Error(`${c.id}: find must occur exactly once`);
      const by = 'replace' in e ? Buffer.from(e.replace as string, 'latin1') : Buffer.from(e.replace_hex as string, 'hex');
      buf = Buffer.concat([buf.subarray(0, i), by, buf.subarray(i + find.length)]);
    } else if ('prefix' in e) {
      buf = Buffer.concat([Buffer.from(e.prefix as string, 'latin1'), buf, Buffer.from(e.suffix as string, 'latin1')]);
    } else if ('prefix_hex' in e) {
      buf = Buffer.concat([Buffer.from(e.prefix_hex as string, 'hex'), buf]);
    } else if ('drop_last' in e) {
      buf = buf.subarray(0, buf.length - (e.drop_last as number));
    } else {
      throw new Error(`${c.id}: unknown edit ${JSON.stringify(e)}`);
    }
  }
  return new Uint8Array(buf);
}

const ADAPTERS = ['bufferUtf8JsonParse', 'textDecoderJsonParse'] as const;

/** An adapter that counts its calls and otherwise is the built-in one. */
function counting(adapter: ExperimentalHistoricalAdapter) {
  const counter = { calls: 0 };
  return {
    counter,
    adapter: { name: adapter.name, decode: (u: Uint8Array) => (counter.calls++, adapter.decode(u)) },
  };
}

/** A verifier with a probe that records each verifier it enters. */
function probed(c: Pick<Case, 'transport' | 'accepted_profiles'>, historical: ExperimentalHistoricalAdapter) {
  const entries: string[] = [];
  const verifier = createExperimentalCandidateVerifierForTests(
    { transport: c.transport, acceptedProfiles: c.accepted_profiles, historical },
    { enter: (p) => entries.push(p) },
  );
  return { entries, verifier };
}

/** The same exact value: numbers compared by value, objects by their own members, whatever the prototype. */
function sameExact(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return (
    ka.length === kb.length &&
    ka.every((k, i) => k === kb[i] && sameExact((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/**
 * Every value the verifier commits to, and every object or array inside it: the unit, the manifest, the
 * four signed payloads, the audit entries and the PQ checkpoints without their signature.
 */
function committedValues(unit: Record<string, any>): unknown[] {
  const b = unit.bundle;
  const roots: unknown[] = [
    unit,
    b.manifest,
    ...['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'].map((n) => b[n].payload),
    ...b.audit_entries,
  ];
  for (const cp of b.pq_checkpoints ?? []) {
    const { composite_sig: _signature, ...payload } = cp;
    roots.push(payload);
  }
  const all: unknown[] = [];
  const walk = (v: unknown) => {
    if (v === null || typeof v !== 'object') return;
    all.push(v);
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k]);
  };
  roots.forEach(walk);
  return all;
}

function checkRoute(r: ExperimentalCandidateVerifyResult, exp: Expected): void {
  const route = r.route as unknown as Record<string, unknown>;
  expect(route.outcome).toBe(exp.route.outcome);
  for (const key of ['class', 'detail', 'offset', 'profile'] as const) {
    if (key in exp.route) expect(route[key], key).toBe(exp.route[key]);
  }
  if (exp.route.profile_source !== undefined) expect(route.profileSource).toBe(exp.route.profile_source);
  if (exp.route.warning_classes !== undefined) {
    expect((route.warnings as Array<{ class: string }>).map((w) => w.class)).toEqual(exp.route.warning_classes);
  }
  if (exp.route.historical !== undefined) {
    expect('decoded' in (route.historical as object) ? 'decoded' : 'failed', 'historical').toBe(exp.route.historical);
  }
}

describe('phase 3 signed vectors', () => {
  it('the vectors carry exactly the approved case IDs; a missing, repeated or unknown one is refused', () => {
    const ids = cases.map((c) => c.id);
    expect(idProblem(ids)).toBeNull();
    expect(idProblem(APPROVED_IDS)).toBeNull();
    expect(idProblem(ids.filter((id) => id !== 'F07'))).toContain('"missing":["F07"]');
    expect(idProblem([...ids, 'D03'])).toContain('"repeated":["D03"]');
    expect(idProblem(ids.map((id) => (id === 'P05' ? 'P99' : id)))).toBe('{"repeated":[],"missing":["P05"],"unknown":["P99"]}');
  });

  it('the vectors are the committed file the generator checks', () => {
    expect(cases.length).toBe(57);
    for (const c of cases) expect(sha256(input(c)), c.id).toBe(c.input_sha256);
  });

  for (const c of cases) {
    for (const name of ADAPTERS) {
      it(`${c.id} (${name})`, async () => {
        const exp = c.by_adapter?.[`ts:${name}`] ?? c.expected;
        const bytes = input(c);
        const builtIn = experimentalHistoricalAdapters[name];
        const { counter, adapter } = counting(builtIn);
        const { entries, verifier } = probed(c, adapter);
        const policy = vectors.verifier_policies[c.verifier_policy] as VerifierPolicy;
        const r = await verifier.verify(bytes, registry, policy, NOW);

        checkRoute(r, exp);
        expect(counter.calls, 'adapter calls').toBe(exp.adapter_calls);
        expect(r.entered).toBe(exp.entered);
        expect(entries, 'verifiers entered').toEqual(exp.entered === 'none' ? [] : [exp.entered]);
        if (exp.verification === null) {
          expect(r.verification).toBeNull();
        } else {
          expect(r.verification, 'verification').not.toBeNull();
          const v = r.verification!;
          expect(v.verified, JSON.stringify(v.errors)).toBe(exp.verification.verified);
          if (exp.verification.verified) expect(v.errors).toEqual([]);
          for (const s of exp.verification.errors_contain.ts) {
            expect(v.errors.some((e) => e.includes(s)), `${s} in ${JSON.stringify(v.errors)}`).toBe(true);
          }
        }

        if (r.route.outcome === 'candidate' && exp.manifest_sha256 !== undefined) {
          const unit = r.route.value as Record<string, any>;
          expect(r.route.canonicalSha256).toBe(exp.canonical_sha256);
          expect(`sha256:${sha256(canonicalizeV2(unit.bundle.manifest))}`).toBe(exp.manifest_sha256);
          expect(unit.signature.manifest_hash).toBe(exp.manifest_sha256);
        }

        // Delegation: exactly what a current caller gets by decoding the unit with the same decoder.
        if (r.entered === 'dcp-jcs-v1' && r.route.outcome === 'v1_path') {
          const decoded = builtIn.decode(r.route.unit.bytes);
          expect(decoded.ok).toBe(true);
          const direct = await verifySignedBundleV2((decoded as { value: SignedBundleV2 }).value, registry, policy, NOW);
          expect(r.verification).toEqual(direct);
        }

        // The public verifier, without a probe, gives the same result.
        const plain = createExperimentalCandidateVerifier({
          transport: c.transport,
          acceptedProfiles: c.accepted_profiles,
          historical: builtIn,
        });
        expect(await plain.verify(bytes, registry, policy, NOW)).toEqual(r);
      }, TIMEOUT_MS);
    }
  }
});

describe('every signed base carries valid signatures, whatever its semantics', () => {
  const contexts = DCP_CONTEXTS;
  const signedBases = Object.keys(vectors.bases).filter((id) => id !== 'B-v1-legacy' && id !== 'B-null');

  /** The manifest, the four artifacts and each PQ checkpoint: what each signature covers, and its keys. */
  function signatures(text: string): Array<[string, string, unknown, CompositeSignature, KeyEntry[]]> {
    const { bundle: b, signature } = JSON.parse(text);
    const rprKeys = b.responsible_principal_record.payload.binding_keys as KeyEntry[];
    const agentKeys = b.agent_passport.payload.keys as KeyEntry[];
    const out: Array<[string, string, unknown, CompositeSignature, KeyEntry[]]> = [
      ['manifest', contexts.Bundle, b.manifest, signature.composite_sig, rprKeys],
      ['responsible_principal_record', contexts.ResponsiblePrincipal, b.responsible_principal_record.payload, b.responsible_principal_record.composite_sig, rprKeys],
      ['agent_passport', contexts.AgentPassport, b.agent_passport.payload, b.agent_passport.composite_sig, agentKeys],
      ['intent', contexts.Intent, b.intent.payload, b.intent.composite_sig, agentKeys],
      ['policy_decision', contexts.PolicyDecision, b.policy_decision.payload, b.policy_decision.composite_sig, agentKeys],
    ];
    for (const cp of b.pq_checkpoints ?? []) {
      const { composite_sig, ...payload } = cp;
      out.push([`pq_checkpoints[${cp.checkpoint_id}]`, contexts.AuditEvent, payload, composite_sig, agentKeys]);
    }
    return out;
  }

  /** The signature over the canonical payload, with the keys its kids name. */
  async function valid(context: string, payload: unknown, sig: CompositeSignature, keys: KeyEntry[]): Promise<boolean> {
    const classical = keys.find((k) => k.kid === sig.classical.kid);
    const pq = sig.pq ? keys.find((k) => k.kid === sig.pq!.kid) : undefined;
    if (!classical || (sig.pq && !pq)) return false;
    const bytes = new Uint8Array(Buffer.from(canonicalizeV2(payload), 'utf8'));
    return (await compositeVerify(registry, context, bytes, sig, classical.public_key_b64, pq?.public_key_b64)).valid;
  }

  it('covers the 16 signed bases and their 81 signatures', () => {
    expect(signedBases.length).toBe(16);
    expect(signedBases.reduce((n, id) => n + signatures(vectors.bases[id].input_json).length, 0)).toBe(81);
  });

  for (const id of signedBases) {
    it(`${id}: the manifest, artifact and checkpoint signatures verify`, async () => {
      for (const [name, context, payload, sig, keys] of signatures(vectors.bases[id].input_json)) {
        expect(await valid(context, payload, sig, keys), `${id} ${name}`).toBe(true);
      }
    }, TIMEOUT_MS);
  }

  it('a corrupted classical or PQ component does not verify', async () => {
    const [, context, payload, sig, keys] = signatures(vectors.bases['B-v2'].input_json)[0];
    const flip = (b64: string) => {
      const bytes = Buffer.from(b64, 'base64');
      bytes[0] ^= 0xff;
      return bytes.toString('base64');
    };
    expect(await valid(context, payload, sig, keys)).toBe(true);
    expect(await valid(context, payload, { ...sig, classical: { ...sig.classical, sig_b64: flip(sig.classical.sig_b64) } }, keys)).toBe(false);
    expect(await valid(context, payload, { ...sig, pq: { ...sig.pq!, sig_b64: flip(sig.pq!.sig_b64) } }, keys)).toBe(false);
  }, TIMEOUT_MS);
});

describe('equivalence of canonical bytes on every committed value of the positives', () => {
  const positives = cases.filter((c) => c.expected.manifest_sha256 !== undefined);

  it('covers every positive, the checkpoint included', () => {
    expect(positives.map((c) => c.id)).toEqual([
      'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12',
      'P13-800', 'P13-801', 'P13-5000', 'P14',
    ]);
  });

  for (const c of positives) {
    it(`${c.id}: canonicalizeV2 of each committed value is the candidate canonical form of that exact value`, async () => {
      const { verifier } = probed(c, experimentalHistoricalAdapters.bufferUtf8JsonParse);
      const r = await verifier.verify(input(c), registry, undefined, NOW);
      expect(r.route.outcome).toBe('candidate');
      if (r.route.outcome !== 'candidate') return;
      const values = committedValues(r.route.value as Record<string, any>);
      if (c.id === 'P10') expect(values.some((v) => Object.hasOwn(v as object, 'checkpoint_id'))).toBe(true);
      for (const value of values) {
        const canonical = canonicalizeV2(value);
        const again = experimentalCandidateIngress(new Uint8Array(Buffer.from(canonical, 'utf8')));
        expect(again.status).toBe('accept');
        if (again.status !== 'accept') return;
        expect(sameExact(again.value, value), canonical.slice(0, 80)).toBe(true);
        expect(Buffer.from(again.canonical).toString('utf8')).toBe(canonical);
      }
    }, TIMEOUT_MS);
  }

  it('reads the exact integers whatever their form', async () => {
    const limits = { exact_one: 1, ten: 10, hundred: 100, zero: 0, max_safe: 9007199254740991, min_safe: -9007199254740991 };
    for (const id of ['P04', 'P13-800', 'P13-801', 'P13-5000', 'P14']) {
      const { verifier } = probed(byId(id), experimentalHistoricalAdapters.bufferUtf8JsonParse);
      const r = await verifier.verify(input(byId(id)), registry, undefined, NOW);
      if (r.route.outcome !== 'candidate') throw new Error(`${id}: ${r.route.outcome}`);
      const target = (r.route.value as Record<string, any>).bundle.intent.payload.target;
      expect(sameExact(target.limits, limits), id).toBe(true);
    }
  }, TIMEOUT_MS);
});

describe('controls', () => {
  const P01 = byId('P01');
  const D01 = byId('D01');
  const adapter = experimentalHistoricalAdapters.bufferUtf8JsonParse;

  it('the profile policy is required and has no default; the error comes before any input', () => {
    for (const acceptedProfiles of [undefined, null, [], ['dcp-jcs-v3'], ['dcp-jcs-v2', 'dcp-jcs-v2']]) {
      let thrown: unknown;
      try {
        createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles, historical: adapter } as never);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, JSON.stringify(acceptedProfiles)).toBeInstanceOf(ExperimentalCandidateConfigError);
      expect((thrown as ExperimentalCandidateConfigError).code).toBe('POLICY_INVALID');
    }
    expect(() =>
      createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'] } as never),
    ).toThrow(ExperimentalCandidateConfigError);
  });

  it('the cryptographic policy keeps the default of verifySignedBundleV2', async () => {
    const verifier = createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: adapter });
    const implicit = await verifier.verify(input(P01), registry, undefined, NOW);
    const explicit = await verifier.verify(input(P01), registry, DEFAULT_VERIFIER_POLICY, NOW);
    expect(implicit).toEqual(explicit);
    expect(implicit.verification?.verified).toBe(true);
  }, TIMEOUT_MS);

  it('a decoder refusal is not delegated: no value, no verifier', async () => {
    let calls = 0;
    const refuses = { name: 'refuses', decode: () => (calls++, { ok: false as const, reason: 'refused by the test' }) };
    const { entries, verifier } = probed(D01, refuses);
    const r = await verifier.verify(input(D01), registry, undefined, NOW);
    expect(r.route.outcome).toBe('v1_path');
    if (r.route.outcome !== 'v1_path') return;
    expect(r.route.historical).toEqual({ adapter: 'refuses', failed: 'refused by the test' });
    expect(r.entered).toBe('none');
    expect(r.verification).toBeNull();
    expect(entries).toEqual([]);
    expect(calls).toBe(1);
  }, TIMEOUT_MS);

  it('a decoded null is data: it is delegated, and today\'s verifier rejects it', async () => {
    const decodesNull = { name: 'decodes-null', decode: () => ({ ok: true as const, value: null }) };
    const { entries, verifier } = probed(D01, decodesNull);
    const r = await verifier.verify(input(D01), registry, undefined, NOW);
    expect(r.route.outcome).toBe('v1_path');
    expect(r.entered).toBe('dcp-jcs-v1');
    expect(entries).toEqual(['dcp-jcs-v1']);
    expect(r.verification?.verified).toBe(false);
    expect(r.verification?.errors.join()).toContain('Malformed signed bundle');
    expect(r.verification).toEqual(await verifySignedBundleV2(null as never, registry, undefined, NOW));
  }, TIMEOUT_MS);

  it('an adapter that throws is an adapter error, never a rejection, and no verifier runs', async () => {
    const throws = { name: 'throws', decode: () => { throw new Error('boom'); } };
    const { entries, verifier } = probed(D01, throws);
    await expect(verifier.verify(input(D01), registry, undefined, NOW)).rejects.toBeInstanceOf(ExperimentalCandidateAdapterError);
    expect(entries).toEqual([]);
  });

  it('the caller mutating its buffer during or after the call changes nothing', async () => {
    const verifier = createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: adapter });
    const reference = await verifier.verify(input(P01), registry, undefined, NOW);
    const bytes = input(P01);
    const pending = verifier.verify(bytes, registry, undefined, NOW);
    bytes.fill(0x20);
    const r = await pending;
    expect(r).toEqual(reference);
    bytes.fill(0x7b);
    if (r.route.outcome !== 'candidate') throw new Error(r.route.outcome);
    expect(sha256(r.route.unit.bytes)).toBe(P01.input_sha256);
  }, TIMEOUT_MS);

  it('an adapter mutating the unit it receives changes nothing', async () => {
    const mutates = {
      name: adapter.name,
      decode: (u: Uint8Array) => {
        const out = adapter.decode(u);
        u.fill(0x20);
        return out;
      },
    };
    const reference = await createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v1'], historical: adapter })
      .verify(input(D01), registry, undefined, NOW);
    const r = await createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v1'], historical: mutates })
      .verify(input(D01), registry, undefined, NOW);
    expect(r).toEqual(reference);
    expect(r.verification?.verified).toBe(true);
  }, TIMEOUT_MS);

  it('today\'s object API still refuses dcp-jcs-v2, also given the exact value', async () => {
    const parsed = JSON.parse(Buffer.from(input(P01)).toString('utf8')) as SignedBundleV2;
    const r = await verifySignedBundleV2(parsed, registry, undefined, NOW);
    expect(r.verified).toBe(false);
    expect(r.errors).toContain('Unknown canonicalization_profile: dcp-jcs-v2');
    const routed = await createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: adapter })
      .verify(input(P01), registry, undefined, NOW);
    if (routed.route.outcome !== 'candidate') throw new Error(routed.route.outcome);
    const exact = await verifySignedBundleV2(routed.route.value as unknown as SignedBundleV2, registry, undefined, NOW);
    expect(exact.verified).toBe(false);
    expect(exact.errors).toContain('Unknown canonicalization_profile: dcp-jcs-v2');
  }, TIMEOUT_MS);

  it('the package entry point exports the verifier and nothing internal', () => {
    const entry = sdk as Record<string, unknown>;
    expect(typeof entry.createExperimentalCandidateVerifier).toBe('function');
    expect('verifySignedBundleV2WithProfile' in entry).toBe(false);
    expect('createExperimentalCandidateVerifierForTests' in entry).toBe(false);
  });
});
