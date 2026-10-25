/**
 * Experimental candidate router (phase 2), by phase: configuration, transport, selection and policy
 * on walkable units, the historical adapter on the units it decides (public fixture of measured
 * decoders), the grammar walker against the phase 1 scanner, v1 parity on really signed bundles,
 * laziness, the adapter contract and byte ownership. Candidate verification is phase 3: corpus
 * expectations accept_v2 and COMMITMENT_MISMATCH are checked only as `candidate`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AlgorithmRegistry,
  createExperimentalCandidateRouter,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  experimentalCandidateExtractUnit,
  experimentalCandidateIngress,
  ExperimentalCandidateAdapterError,
  ExperimentalCandidateConfigError,
  experimentalHistoricalAdapters,
  MlDsa65Provider,
  verifySignedBundleV2,
  type ExperimentalHistoricalAdapter,
} from '../index.js';
import { walkCandidateGrammarForTests } from '../core/experimental-candidate-router.js';

const ROOT = new URL('../../../../', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const BASELINE = read('docs/proposals/canonicalization-candidate/baseline-corpus.json').cases;
const DESIGN = read('docs/proposals/canonicalization-candidate/corpus.json').cases;
const FIXTURE = read('tests/interop/candidate/phase2-adapter-expectations.json');
const VECTORS = read('tests/interop/v2/bundle_vectors.json');
const ADMISSION = read('tests/interop/v2/admission_vectors.json');

type Case = Record<string, any>;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const inputOf = (c: Case) =>
  new Uint8Array(
    c.input_hex !== undefined ? Buffer.from(c.input_hex, 'hex') : Buffer.from(c.input_json, 'utf8'),
  );
const utf8 = (s: string) => new TextEncoder().encode(s);
const join = (...parts: (string | number[] | Uint8Array)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...utf8(p)] : [...p])));
const BOTH = ['dcp-jcs-v1', 'dcp-jcs-v2'];
const TS_ADAPTERS: Record<string, ExperimentalHistoricalAdapter> = {
  'ts.bufferUtf8JsonParse': experimentalHistoricalAdapters.bufferUtf8JsonParse,
  'ts.textDecoderJsonParse': experimentalHistoricalAdapters.textDecoderJsonParse,
};
const counting = (inner: ExperimentalHistoricalAdapter) => {
  const adapter = {
    name: inner.name,
    calls: 0,
    decode: (u: Uint8Array) => (adapter.calls++, inner.decode(u)),
  };
  return adapter;
};
const unitWith = (profile: string, extra = '') =>
  utf8(`{"bundle":{"manifest":{"canonicalization_profile":${profile}}},"signature":{}${extra}}`);

const OBSOLETE = (c: Case) => c.options?.depth_scope === 'transport';
const CONFIGURATION: Case[] = DESIGN.filter((c: Case) => c.group === 'configuration');
const ENVELOPE_DOCUMENTS: Case[] = DESIGN.filter(
  (c: Case) => c.mode === 'document' && c.transport === 'envelope' && !OBSOLETE(c),
);
const ROUTED: Case[] = DESIGN.filter(
  (c: Case) =>
    c.mode === 'bundle' && c.group !== 'configuration' && !('historical' in c) && !OBSOLETE(c),
);

describe('phase 2: configuration, before any input', () => {
  it('counts the corpus cases of each phase', () => {
    expect([CONFIGURATION.length, ENVELOPE_DOCUMENTS.length, ROUTED.length]).toEqual([9, 28, 58]);
    expect(DESIGN.filter((c: Case) => 'historical' in c).length).toBe(9);
    expect(DESIGN.filter(OBSOLETE).length).toBe(2);
    expect(FIXTURE.cases.length).toBe(16);
  });

  it.each(CONFIGURATION.map((c: Case) => [c.id, c] as [string, Case]))(
    '%s is a configuration error',
    (_id, c) => {
      const create = () =>
        createExperimentalCandidateRouter({
          transport: 'bare',
          acceptedProfiles: c.policy,
          historical: experimentalHistoricalAdapters.textDecoderJsonParse,
        });
      expect(create).toThrow(ExperimentalCandidateConfigError);
      try {
        create();
      } catch (e) {
        expect([
          (e as ExperimentalCandidateConfigError).code,
          (e as ExperimentalCandidateConfigError).detail,
        ]).toEqual([c.expected.class, c.expected.detail]);
      }
    },
  );

  it('refuses a transport or an adapter it cannot use', () => {
    const adapter = experimentalHistoricalAdapters.textDecoderJsonParse;
    const detail = (config: unknown) => {
      try {
        createExperimentalCandidateRouter(config as any);
      } catch (e) {
        return (e as ExperimentalCandidateConfigError).detail;
      }
      return 'created';
    };
    expect(detail({ transport: 'header', acceptedProfiles: BOTH, historical: adapter })).toBe(
      'TRANSPORT',
    );
    expect(detail({ transport: 'bare', acceptedProfiles: BOTH })).toBe('HISTORICAL_ADAPTER');
    expect(
      detail({
        transport: 'bare',
        acceptedProfiles: BOTH,
        historical: { name: '', decode: adapter.decode },
      }),
    ).toBe('HISTORICAL_ADAPTER');
    expect(detail({ transport: 'bare', acceptedProfiles: BOTH, historical: { name: 'x' } })).toBe(
      'HISTORICAL_ADAPTER',
    );
    expect(detail(null)).toBe('CONFIG');
  });

  it('reads the configuration strictly: boxed strings, toJSON, bigint and throwing getters are configuration errors', () => {
    const adapter = experimentalHistoricalAdapters.textDecoderJsonParse;
    const detail = (config: unknown) => {
      try {
        createExperimentalCandidateRouter(config as any);
      } catch (e) {
        return e instanceof ExperimentalCandidateConfigError
          ? e.detail
          : `raw ${(e as Error).name}`;
      }
      return 'created';
    };
    const base = { transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: adapter };
    expect(detail({ ...base, acceptedProfiles: [new String('dcp-jcs-v2')] })).toBe('NOT_STRINGS');
    expect(detail({ ...base, acceptedProfiles: [{ toJSON: () => 'dcp-jcs-v2' }] })).toBe(
      'NOT_STRINGS',
    );
    expect(detail({ ...base, acceptedProfiles: [1n] })).toBe('NOT_STRINGS');
    expect(detail({ ...base, transport: new String('bare') })).toBe('TRANSPORT');
    expect(detail({ ...base, historical: { ...adapter, name: new String('x') } })).toBe(
      'HISTORICAL_ADAPTER',
    );
    const getter = (key: string) =>
      Object.defineProperty({ ...base }, key, {
        get: () => {
          throw new Error('synthetic');
        },
      });
    expect(detail(getter('acceptedProfiles'))).toBe('CONFIG');
    expect(
      detail({
        ...base,
        historical: Object.defineProperty({}, 'name', {
          get: () => {
            throw new Error('synthetic');
          },
        }),
      }),
    ).toBe('HISTORICAL_ADAPTER');
    expect(detail(base)).toBe('created');
  });

  it('keeps a private snapshot: later changes to the configuration change nothing', () => {
    const policy = ['dcp-jcs-v1'];
    let replaced = 0;
    const adapter = counting(
      experimentalHistoricalAdapters.textDecoderJsonParse,
    ) as ExperimentalHistoricalAdapter & { calls: number; name: string };
    const config = {
      transport: 'bare' as 'bare' | 'envelope',
      acceptedProfiles: policy,
      historical: adapter as ExperimentalHistoricalAdapter,
    };
    const router = createExperimentalCandidateRouter(config);
    policy.push('dcp-jcs-v2');
    policy.shift();
    config.transport = 'envelope';
    adapter.decode = () => (replaced++, { ok: false, reason: 'replaced' });
    adapter.name = 'replaced';
    config.historical = {
      name: 'other',
      decode: () => (replaced++, { ok: false, reason: 'other' }),
    };
    router.configuration.acceptedProfiles.push('dcp-jcs-v2');
    expect(router.route(unitWith('"dcp-jcs-v2"'))).toMatchObject({
      outcome: 'reject',
      class: 'PROFILE_NOT_ACCEPTED',
      profile: 'dcp-jcs-v2',
    });
    const v1 = router.route(unitWith('"dcp-jcs-v1"'));
    expect(v1).toMatchObject({
      outcome: 'v1_path',
      historical: { adapter: 'textDecoderJsonParse' },
    });
    expect([adapter.calls, replaced]).toEqual([1, 0]);
    expect(router.configuration).toEqual({
      transport: 'bare',
      acceptedProfiles: ['dcp-jcs-v1'],
      historical: 'textDecoderJsonParse',
    });
  });
});

describe('phase 2: transport (document cases in an envelope)', () => {
  it.each(ENVELOPE_DOCUMENTS.map((c: Case) => [c.id, c] as [string, Case]))('%s', (_id, c) => {
    const input = inputOf(c);
    expect(sha(input)).toBe(c.input_sha256);
    const e = c.expected;
    const x = experimentalCandidateExtractUnit(input, 'envelope');
    if (e.class === 'TRANSPORT_INVALID' || e.class === 'TRANSPORT_AMBIGUOUS') {
      expect(x).toEqual({
        status: 'reject',
        class: e.class,
        detail: e.detail,
        transportOffset: e.transport_offset ?? null,
      });
      return;
    }
    expect(x.status).toBe('unit');
    if (x.status !== 'unit') return;
    if (e.unit) expect([x.start, x.end]).toEqual(e.unit);
    const r = experimentalCandidateIngress(input.subarray(x.start, x.end));
    if (e.result === 'accept')
      expect(r.status === 'accept' && r.canonicalSha256).toBe(e.canonical_sha256);
    else expect(r).toEqual({ status: 'reject', class: e.class, offset: e.offset });
  });
});

describe('phase 2: selection and policy on walkable units', () => {
  it.each(ROUTED.map((c: Case) => [c.id, c] as [string, Case]))('%s', (_id, c) => {
    const input = inputOf(c);
    expect(sha(input)).toBe(c.input_sha256);
    const adapter = counting(experimentalHistoricalAdapters.textDecoderJsonParse);
    const r = createExperimentalCandidateRouter({
      transport: c.transport,
      acceptedProfiles: c.policy,
      historical: adapter,
    }).route(input);
    const e = c.expected;
    if (e.unit && r.outcome !== 'reject') expect([r.unit.start, r.unit.end]).toEqual(e.unit);
    if (e.result === 'accept_v2' || e.class === 'COMMITMENT_MISMATCH') {
      // Phase 3 checks the commitments: here the corpus expectation is only that the candidate path is selected.
      expect(r).toMatchObject({
        outcome: 'candidate',
        profile: 'dcp-jcs-v2',
        attempts: ['dcp-jcs-v2'],
        warnings: [],
      });
      expect(adapter.calls).toBe(0);
    } else if (e.result === 'v1_path') {
      expect(r).toMatchObject({ outcome: 'v1_path', profile: 'dcp-jcs-v1', attempts: e.attempts });
      expect(r.warnings.map((w) => ({ class: w.class, offset: w.offset }))).toEqual(e.warnings);
      expect(adapter.calls).toBe(1);
    } else {
      expect(r).toMatchObject({
        outcome: 'reject',
        class: e.class,
        offset: e.offset ?? null,
        profile: e.profile ?? null,
        attempts: [],
      });
      expect(adapter.calls).toBe(0);
    }
  });
});

describe('phase 2: the historical adapter decides (public fixture of measured decoders)', () => {
  const rows: [string, Case, string][] = (FIXTURE.cases as Case[]).flatMap((c: Case) =>
    Object.keys(TS_ADAPTERS).map((a) => [`${c.id} ${a}`, c, a] as [string, Case, string]),
  );
  it.each(rows)('%s', (_label, c, name) => {
    const input = new Uint8Array(Buffer.from(c.input_hex, 'hex'));
    expect(sha(input)).toBe(c.input_sha256);
    const row = c.adapters[name];
    // The fixture reading is the decoder's own, re-measured here.
    const decoded = TS_ADAPTERS[name].decode(input.slice());
    const own = (n: any, k: string) =>
      n && typeof n === 'object' && !Array.isArray(n) && Object.hasOwn(n, k) ? n[k] : undefined;
    const field = decoded.ok
      ? own(own(own(decoded.value, 'bundle'), 'manifest'), 'canonicalization_profile')
      : undefined;
    const reading = !decoded.ok
      ? 'fails'
      : field === undefined
        ? 'absent'
        : field === 'dcp-jcs-v1' || field === 'dcp-jcs-v2'
          ? field
          : 'other';
    expect(reading).toBe(row.decoder_reading);
    const adapter = counting(TS_ADAPTERS[name]);
    const r = createExperimentalCandidateRouter({
      transport: 'bare',
      acceptedProfiles: c.policy,
      historical: adapter,
    }).route(input);
    const e = row.expected;
    expect(adapter.calls).toBe(e.adapter_calls);
    if (e.outcome === 'reject') {
      expect(r).toMatchObject({
        outcome: 'reject',
        class: e.class,
        offset: e.offset,
        profile: e.profile ?? null,
      });
    } else {
      expect(r).toMatchObject({ outcome: 'v1_path', profileSource: e.profile_source });
      if (r.outcome !== 'v1_path') return;
      expect(r.warnings.map((w) => ({ class: w.class, offset: w.offset }))).toEqual(e.warnings);
      expect('decoded' in r.historical ? 'decoded' : 'failed').toBe(e.historical);
    }
  });
});

describe('phase 2: one grammar walker, checked against the phase 1 scanner', () => {
  it('gives the phase 1 grammar verdict on every corpus input that is UTF-8 without a BOM', () => {
    let compared = 0;
    for (const c of [...BASELINE, ...DESIGN]) {
      const input = inputOf(c);
      const p1 = experimentalCandidateIngress(input);
      if (p1.status === 'reject' && (p1.class === 'BOM' || p1.class === 'UTF8_INVALID')) continue; // precedence, below
      const w = walkCandidateGrammarForTests(input);
      if (p1.status === 'reject' && p1.class === 'SYNTAX')
        expect(w, c.id).toEqual({ ok: false, offset: p1.offset });
      else expect(w, c.id).toEqual({ ok: true, offset: null });
      compared++;
    }
    expect(compared).toBe(234); // 274 corpus inputs, 40 of them with a BOM or invalid UTF-8
  });

  it('leaves the encoding layer to its own precedence', () => {
    const ff = join('[,"', [0xff], '"]');
    expect(experimentalCandidateIngress(ff)).toEqual({
      status: 'reject',
      class: 'UTF8_INVALID',
      offset: 3,
    });
    expect(walkCandidateGrammarForTests(ff)).toEqual({ ok: false, offset: 1 });
    const bom = join([0xef, 0xbb, 0xbf], '{}');
    expect(experimentalCandidateIngress(bom)).toEqual({
      status: 'reject',
      class: 'BOM',
      offset: 0,
    });
    expect(walkCandidateGrammarForTests(bom)).toEqual({ ok: false, offset: 0 });
    expect(
      experimentalCandidateExtractUnit(
        join([0xef, 0xbb, 0xbf], '{"signed_bundle":{},}'),
        'envelope',
      ),
    ).toMatchObject({ detail: 'BOM', transportOffset: 0 });
    expect(
      experimentalCandidateExtractUnit(join('{"x":"', [0xff], '","signed_bundle":{}}'), 'envelope'),
    ).toEqual({
      status: 'reject',
      class: 'TRANSPORT_INVALID',
      detail: 'UTF8_INVALID',
      transportOffset: 6,
    });
    expect(
      experimentalCandidateExtractUnit(
        join('{"x":"', [0xff], '","signed_bundle":{},}'),
        'envelope',
      ),
    ).toMatchObject({ detail: 'SYNTAX' });
  });
});

describe('phase 2: v1 parity on really signed bundles, bare, for every built-in adapter', () => {
  const registry = new AlgorithmRegistry();
  registry.registerSigner(new Ed25519Provider());
  registry.registerSigner(new MlDsa65Provider());
  const text = JSON.stringify(VECTORS.signed_bundle);
  const profile = '"canonicalization_profile":"dcp-jcs-v1"';
  expect(text.split(profile).length).toBe(2);
  const action = text.indexOf('"action_type":"') + '"action_type":"'.length;
  const variants: Record<string, Uint8Array> = {
    bom: join([0xef, 0xbb, 0xbf], text),
    'dup-profile-unknown-then-v1': utf8(
      text.replace(profile, '"canonicalization_profile":"dcp-jcs-v9",' + profile),
    ),
    'dup-profile-v2-then-v1': utf8(
      text.replace(profile, '"canonicalization_profile":"dcp-jcs-v2",' + profile),
    ),
    'dup-profile-v1-then-unknown': utf8(
      text.replace(profile, profile + ',"canonicalization_profile":"dcp-jcs-v9"'),
    ),
    'dup-manifest-empty-then-real': utf8(
      text.replace('"manifest":{', '"manifest":{},"manifest":{'),
    ),
    'dup-bundle-empty-then-real': utf8(text.replace('{"bundle":{', '{"bundle":{},"bundle":{')),
    'utf8-ff-in-intent': join(text.slice(0, action), [0xff], text.slice(action + 1)),
    'ufffd-literal-in-intent': join(
      text.slice(0, action),
      [0xef, 0xbf, 0xbd],
      text.slice(action + 1),
    ),
    'trailing-comma': utf8(text.slice(0, -1) + ',}'),
    'inf-unsigned': utf8(text.slice(0, -1) + ',"x":1e999}'),
    'nan-unsigned': utf8(text.slice(0, -1) + ',"x":NaN}'),
    'lone-surrogate-unsigned': utf8(text.slice(0, -1) + ',"x":"\\ud800"}'),
    'inf-profile': utf8(text.replace(profile, '"canonicalization_profile":1e999')),
    'nan-before-v1': utf8(text.replace(profile, '"canonicalization_profile":NaN,' + profile)),
    'inf-before-v1': utf8(text.replace(profile, '"canonicalization_profile":1e999,' + profile)),
  };
  const nowVectors = 1793491200000;
  const nowAdmission = Date.parse(
    ADMISSION.cases.find((c: Case) => c.name === 'A_known_principal_strict').now,
  );
  const inputs: [string, Uint8Array, number][] = [
    ['signed_bundle', utf8(text), nowVectors],
    [
      'classical_only_routine_bundle',
      utf8(JSON.stringify(VECTORS.classical_only_routine_bundle.signed_bundle)),
      nowVectors,
    ],
    ...VECTORS.must_accept_bundles.map((c: Case) => [
      `accept ${c.name}`,
      utf8(JSON.stringify(c.signed_bundle)),
      nowVectors,
    ]),
    ...VECTORS.must_reject_bundles.map((c: Case) => [
      `reject ${c.name}`,
      utf8(JSON.stringify(c.signed_bundle)),
      nowVectors,
    ]),
    ...Object.entries(ADMISSION.signed_bundles).map(([k, v]) => [
      `admission ${k}`,
      utf8(JSON.stringify(v)),
      nowAdmission,
    ]),
    ...Object.entries(variants).map(([k, v]) => [`variant ${k}`, v, nowVectors]),
  ] as [string, Uint8Array, number][];
  const PARITY_TIMEOUT_MS = 30_000; // an explicit budget for these two tests only, not a global one

  it.each(Object.entries(TS_ADAPTERS))(
    "%s: the router never changes today's verdict",
    async (_name, adapter) => {
      const router = createExperimentalCandidateRouter({
        transport: 'bare',
        acceptedProfiles: ['dcp-jcs-v1'],
        historical: adapter,
      });
      const verdict = async (value: unknown, now: number) =>
        (await verifySignedBundleV2(value as any, registry, DEFAULT_VERIFIER_POLICY, { now }))
          .verified;
      const differences: string[] = [];
      let accepted = 0;
      for (const [label, bytes, now] of inputs) {
        const today = adapter.decode(bytes.slice());
        const todayVerdict = today.ok ? await verdict(today.value, now) : false;
        const r = router.route(bytes);
        expect(r.outcome).not.toBe('candidate');
        let routed = false;
        if (r.outcome === 'v1_path' && 'decoded' in r.historical) {
          expect(r.historical.decoded).toEqual(today.ok ? today.value : undefined);
          routed = await verdict(r.historical.decoded, now);
        }
        if (routed !== todayVerdict)
          differences.push(`${label}: today ${todayVerdict}, routed ${routed} (${r.outcome})`);
        if (todayVerdict) accepted++;
      }
      expect(differences).toEqual([]);
      expect(inputs.length).toBe(
        1 + 1 + VECTORS.must_accept_bundles.length + VECTORS.must_reject_bundles.length + 20 + 15,
      );
      expect(accepted).toBeGreaterThan(10);
    },
    // Each test verifies 125 really signed bundles on both sides: up to 250 cryptographic
    // verifications (Ed25519 and ML-DSA-65). They took about 10 s on CI, over the 5 s default.
    PARITY_TIMEOUT_MS,
  );
});

describe('phase 2: laziness and the adapter contract', () => {
  const create = (historical: ExperimentalHistoricalAdapter, acceptedProfiles = BOTH) =>
    createExperimentalCandidateRouter({ transport: 'bare', acceptedProfiles, historical });
  const bomV1 = join([0xef, 0xbb, 0xbf], unitWith('"dcp-jcs-v1"'));

  it('never selects the candidate from a historical reading', () => {
    const v2 = {
      name: 'claims-v2',
      decode: () => ({
        ok: true as const,
        value: { bundle: { manifest: { canonicalization_profile: 'dcp-jcs-v2' } } },
      }),
    };
    expect(create(v2).route(join([0xef, 0xbb, 0xbf], unitWith('"dcp-jcs-v2"')))).toMatchObject({
      outcome: 'reject',
      class: 'BOM',
      offset: 0,
    });
    expect(create(v2).route(bomV1)).toMatchObject({ outcome: 'reject', class: 'BOM' });
  });

  it('consults the adapter only when it is needed', () => {
    const adapter = counting(experimentalHistoricalAdapters.textDecoderJsonParse);
    const router = create(adapter);
    router.route(unitWith('"dcp-jcs-v2"')); // candidate
    router.route(unitWith('"DCP-JCS-V2"')); // PROFILE_UNKNOWN
    router.route(unitWith('"dcp-jcs-v2"', ',"x":1.5')); // v2 with a diagnosis
    expect(adapter.calls).toBe(0);
    router.route(unitWith('"dcp-jcs-v1"'));
    expect(adapter.calls).toBe(1);
    router.route(bomV1);
    expect(adapter.calls).toBe(2);
  });

  it('separates an adapter failure from a refusal of the data', () => {
    const giving = (value: unknown) => ({
      name: 'custom',
      decode: () => ({ ok: true as const, value }),
    });
    const fn = () => 1;
    for (const bad of [undefined, 10n, fn, { a: fn }, [Symbol('s')], new Date(0)]) {
      expect(() => create(giving(bad)).route(bomV1)).toThrow(ExperimentalCandidateAdapterError);
    }
    expect(() =>
      create({
        name: 'throws',
        decode: () => {
          throw new Error('boom');
        },
      }).route(bomV1),
    ).toThrow(ExperimentalCandidateAdapterError);
    expect(() => create({ name: 'shape', decode: () => 'v1' as any }).route(bomV1)).toThrow(
      ExperimentalCandidateAdapterError,
    );
    // Inspecting what the adapter returned never invokes an accessor and never lets an error out raw.
    let invoked = 0;
    const getter = Object.defineProperty({}, 'x', {
      enumerable: true,
      get() {
        invoked++;
        throw new Error('synthetic');
      },
    });
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('synthetic');
        },
      },
    );
    const shared = { a: 1 };
    for (const bad of [getter, { nested: getter }, hostile, { a: shared, b: shared }]) {
      expect(() => create(giving(bad)).route(bomV1)).toThrow(ExperimentalCandidateAdapterError);
    }
    expect(invoked).toBe(0);
    const okGetter = Object.defineProperty({}, 'ok', {
      get: () => {
        throw new Error('synthetic');
      },
    });
    const badReason = {
      ok: false,
      reason: {
        toString: () => {
          throw new Error('synthetic');
        },
      },
    };
    for (const result of [okGetter, badReason, { ok: true }]) {
      expect(() => create({ name: 'result', decode: () => result as any }).route(bomV1)).toThrow(
        ExperimentalCandidateAdapterError,
      );
    }
    // A refusal of the data follows the data path; values a JSON decoder produces are kept as they are.
    expect(
      create({ name: 'refuses', decode: () => ({ ok: false, reason: 'no' }) }).route(bomV1),
    ).toMatchObject({ outcome: 'reject', class: 'BOM' });
    const odd = { bundle: { manifest: {} }, x: [NaN, Infinity, String.fromCharCode(0xd800)] };
    const r = create(giving(odd)).route(bomV1);
    expect(r).toMatchObject({
      outcome: 'v1_path',
      profileSource: 'historical',
      historical: { adapter: 'custom', decoded: odd },
    });
  });
});

describe('phase 2: byte ownership', () => {
  it('routes on private copies: mutations by the adapter or the caller reach neither a decision nor later results', () => {
    const original = join([0xef, 0xbb, 0xbf], unitWith('"dcp-jcs-v1"'));
    const input = original.slice();
    const mutating = {
      name: 'mutating',
      decode(u: Uint8Array) {
        const r = experimentalHistoricalAdapters.textDecoderJsonParse.decode(u);
        u.fill(0);
        input.fill(0x20);
        return r;
      },
    };
    const router = createExperimentalCandidateRouter({
      transport: 'bare',
      acceptedProfiles: BOTH,
      historical: mutating,
    });
    const first = router.route(input);
    expect(first.outcome).toBe('v1_path');
    if (first.outcome !== 'v1_path') return;
    expect([...first.unit.bytes]).toEqual([...original]);
    first.unit.bytes.fill(1); // the returned copy is mutable; nothing else changes
    const second = router.route(original);
    expect(second.outcome === 'v1_path' && [...second.unit.bytes]).toEqual([...original]);
    const kept = original.slice();
    const third = router.route(kept);
    kept.fill(2);
    expect(third.outcome === 'v1_path' && [...third.unit.bytes]).toEqual([...original]);
  });
});

describe('phase 2: boundaries', () => {
  const router = createExperimentalCandidateRouter({
    transport: 'envelope',
    acceptedProfiles: BOTH,
    historical: experimentalHistoricalAdapters.textDecoderJsonParse,
  });

  it('refuses arguments that are not bytes, and a transport it does not know', () => {
    expect(() => router.route('{}' as unknown as Uint8Array)).toThrow(TypeError);
    expect(() => experimentalCandidateExtractUnit(utf8('{}'), 'header' as never)).toThrow(
      TypeError,
    );
  });

  it('keeps offsets in the input and in the unit', () => {
    const r = router.route(join('{"signed_bundle":{"x":"', [0xff], '"}}'));
    expect(r).toMatchObject({
      outcome: 'v1_path',
      unit: { start: 17, end: 26 },
      profileSource: 'historical',
    });
    expect(r.warnings).toEqual([{ class: 'UTF8_INVALID', offset: 6, transportOffset: 23 }]);
    expect(
      router.route(
        utf8('{"a":1,"signed_bundle":{"bundle":{"manifest":{"canonicalization_profile":"x"}}}}'),
      ),
    ).toMatchObject({
      outcome: 'reject',
      class: 'PROFILE_UNKNOWN',
      offset: 50,
      transportOffset: 73,
      unit: { start: 23, end: 79 },
    });
    expect(router.route(utf8('{"signed_bundle":1,"signed_bundle":2}'))).toMatchObject({
      class: 'TRANSPORT_AMBIGUOUS',
      offset: null,
      transportOffset: 19,
      unit: null,
    });
    expect(router.route(utf8('{"other":1}'))).toMatchObject({
      class: 'TRANSPORT_INVALID',
      detail: 'NO_SIGNED_BUNDLE',
      transportOffset: null,
    });
  });

  it('walks a 20 000-level envelope without a depth limit over the envelope', () => {
    const deep = utf8('{"signed_bundle":' + '['.repeat(20000) + ']'.repeat(20000) + '}');
    expect(experimentalCandidateExtractUnit(deep, 'envelope')).toEqual({
      status: 'unit',
      start: 17,
      end: 40017,
    });
    const r = router.route(deep);
    expect(r).toMatchObject({
      outcome: 'v1_path',
      profileSource: 'absent',
      unit: { start: 17, end: 40017 },
    });
    expect(r.warnings).toEqual([{ class: 'DEPTH_EXCEEDED', offset: 64, transportOffset: 81 }]);
  });
});
