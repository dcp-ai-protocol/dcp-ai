/**
 * Admission from bytes (MP-02 F3): tests/interop/v2/v1_ingress_vectors.json with the two candidate
 * corpora it pins, the signed bundles of delegated_admission_vectors.json, the private copy of the
 * caller's bytes, and a parser fault injected by these tests only.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';
import {
  AlgorithmRegistry,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  admitSignedBundleV2,
  admitSignedBundleV2FromBytes,
  experimentalCandidateIngress,
  type AdmitOptions,
} from '../index.js';
import { admitFromBytesWithParser } from '../core/v1-ingress.js';

const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const I = JSON.parse(read('tests/interop/v2/v1_ingress_vectors.json').toString('utf8'));
const V = JSON.parse(read('tests/interop/v2/delegated_admission_vectors.json').toString('utf8'));
const NOW = Date.parse(V.now);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function newRegistry(ed25519 = new Ed25519Provider()): AlgorithmRegistry {
  const registry = new AlgorithmRegistry();
  registry.registerSigner(ed25519);
  registry.registerSigner(new MlDsa65Provider());
  registry.registerSigner(new SlhDsa192fProvider());
  return registry;
}
const registry = newRegistry();
const strict = (): AdmitOptions => ({
  profile: clone(V.profiles.strict),
  trust: clone(V.trust_sets.base),
  revocation: clone(V.revocations.all_not_revoked),
  now: NOW,
});
const parseJson = (unit: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unit));

type SourceCase = { id: string; input_json?: string; input_hex?: string; input_sha256: string; expected: any; reject_class?: string; canonical_sha256?: string };
const unitOf = (c: SourceCase) => (c.input_hex !== undefined ? Buffer.from(c.input_hex, 'hex') : Buffer.from(c.input_json!, 'utf8'));

describe('the 168 unit cases of the candidate corpora', () => {
  const sources = I.sources.map((s: { path: string; sha256: string; count: number }) => {
    const bytes = read(s.path);
    const all: SourceCase[] = JSON.parse(bytes.toString('utf8')).cases;
    const cases = s.path.endsWith('baseline-corpus.json') ? all : all.filter((c: any) => c.mode === 'document' && c.transport === 'bare');
    return { ...s, bytes, cases };
  });
  const differences = new Map<string, any>(I.domain_differences.map((d: any) => [d.id, d]));

  it('reads the pinned corpora: 87 + 81 cases, 30 domain differences', () => {
    for (const s of sources) {
      expect(sha(s.bytes)).toBe(s.sha256);
      expect(s.cases.length).toBe(s.count);
    }
    expect(sources.map((s: any) => s.cases.length)).toEqual([87, 81]);
    expect(differences.size).toBe(30);
    const ids = new Set(sources.flatMap((s: any) => s.cases.map((c: SourceCase) => c.id)));
    for (const id of differences.keys()) expect(ids.has(id)).toBe(true);
  });

  for (const s of sources) {
    for (const c of s.cases as SourceCase[]) {
      it(`${c.id}`, async () => {
        const unit = unitOf(c);
        expect(sha(unit)).toBe(c.input_sha256);
        const r = await admitSignedBundleV2FromBytes(unit, registry);
        expect(r.ingress.unit_sha256).toBe(c.input_sha256);
        const accepted = typeof c.expected === 'string' ? c.expected === 'accept' : c.expected.result === 'accept';
        const difference = differences.get(c.id);
        if (difference) {
          expect(accepted).toBe(true); // the scanner accepts it; only the domain rejects
          expect(difference.input_sha256).toBe(c.input_sha256);
          expect(r.ingress).toEqual({ accepted: false, ...difference.expected, unit_sha256: c.input_sha256, canonical_sha256: null });
          expect(r.admission).toBeNull();
        } else if (!accepted) {
          const scanned = experimentalCandidateIngress(unit);
          if (scanned.status !== 'reject') throw new Error('the scanner accepts a case its corpus rejects');
          const cls = typeof c.expected === 'string' ? c.reject_class : c.expected.class;
          expect(scanned.class).toBe(cls);
          if (typeof c.expected === 'object') expect(scanned.offset).toBe(c.expected.offset);
          expect(r.ingress).toEqual({ accepted: false, layer: 'scanner', class: cls, offset: scanned.offset, unit_sha256: c.input_sha256, canonical_sha256: null });
          expect(r.admission).toBeNull();
        } else {
          const canonical = typeof c.expected === 'string' ? c.canonical_sha256 : c.expected.canonical_sha256;
          expect(r.ingress).toEqual({ accepted: true, layer: null, class: null, offset: null, unit_sha256: c.input_sha256, canonical_sha256: canonical });
          expect(r.admission?.verified).toBe(false);
          expect(r.admission?.admitted).toBe(false);
        }
      });
    }
  }
});

describe('new cases', () => {
  for (const c of I.cases) {
    it(`${c.group} ${c.id}`, async () => {
      const unit = Buffer.from(c.input_json, 'utf8');
      expect(sha(unit)).toBe(c.input_sha256);
      const r = await admitSignedBundleV2FromBytes(unit, registry);
      if (c.expected.ingress === 'accept') {
        expect(sha(Buffer.from(c.expected.canonical, 'utf8'))).toBe(c.expected.canonical_sha256);
        expect(r.ingress).toEqual({ accepted: true, layer: null, class: null, offset: null, unit_sha256: c.input_sha256, canonical_sha256: c.expected.canonical_sha256 });
        expect(r.value).toEqual(JSON.parse(c.input_json));
        // not a signed bundle: admission runs over the value and rejects it, with no parser fault
        expect(r.admission?.verified).toBe(false);
        expect(r.admission?.admitted).toBe(false);
      } else {
        const { layer, class: cls, offset } = c.expected;
        expect(r.ingress).toEqual({ accepted: false, layer, class: cls, offset, unit_sha256: c.input_sha256, canonical_sha256: null });
        expect(r.admission).toBeNull();
        expect(r.value).toBeNull();
      }
    });
  }
});

describe('signed bundles', () => {
  const names = Object.keys(V.signed_bundles);

  it('the delegated admission vectors carry 16 signed bundles and orch is admitted', async () => {
    expect(names.length).toBe(16);
    expect((await admitSignedBundleV2(clone(V.signed_bundles.orch), registry, strict())).admitted).toBe(true);
  });

  for (const name of names) {
    it(`${name}: the same admission result as the object API, compact or indented`, async () => {
      const expected = await admitSignedBundleV2(clone(V.signed_bundles[name]), registry, strict());
      const compact = await admitSignedBundleV2FromBytes(Buffer.from(JSON.stringify(V.signed_bundles[name]), 'utf8'), registry, strict());
      const indented = await admitSignedBundleV2FromBytes(Buffer.from(JSON.stringify(V.signed_bundles[name], null, 2), 'utf8'), registry, strict());
      for (const r of [compact, indented]) {
        expect(r.ingress.accepted).toBe(true);
        expect(r.admission).toEqual(expected);
        expect(r.value).toEqual(V.signed_bundles[name]);
      }
      expect(indented.ingress.canonical_sha256).toBe(compact.ingress.canonical_sha256);
    });
  }

  it('rejects a transport that rewrites 100 as 100.0, which the object API admits', async () => {
    const text = JSON.stringify(V.signed_bundles.orch);
    expect(text.split('"risk_score":100,').length).toBe(2);
    const rewritten = text.replace('"risk_score":100,', '"risk_score":100.0,');
    const viaObject = await admitSignedBundleV2(JSON.parse(rewritten), registry, strict());
    expect(viaObject.admitted).toBe(true);
    const r = await admitSignedBundleV2FromBytes(Buffer.from(rewritten, 'utf8'), registry, strict());
    expect(r.ingress).toMatchObject({ accepted: false, layer: 'domain', class: 'NUMBER_NOT_PORTABLE', offset: rewritten.indexOf('100.0') });
    expect(r.admission).toBeNull();
  });
});

describe('the private copy', () => {
  const text = JSON.stringify(V.signed_bundles.orch);
  const size = Buffer.byteLength(text);
  // the caller's bytes as a view at byteOffset 8 of a larger buffer, between bytes that are not JSON
  const callerBuffer = () => {
    const backing = Buffer.alloc(size + 16, 0x58);
    backing.write(text, 8, 'utf8');
    return backing.subarray(8, 8 + size);
  };
  const callerUint8Array = () => {
    const backing = new Uint8Array(size + 16).fill(0x58);
    backing.set(Buffer.from(text, 'utf8'), 8);
    return new Uint8Array(backing.buffer, 8, size);
  };
  const views = { 'Buffer#subarray': callerBuffer, 'Uint8Array view': callerUint8Array };
  const original = Buffer.from(text, 'utf8');
  const mutateRiskScore = (view: Uint8Array) => {
    const at = Buffer.from(view).indexOf('"risk_score":100,');
    view.set(Buffer.from('"risk_score":999,'), at);
  };

  for (const [kind, make] of Object.entries(views)) {
    it(`${kind}: hashes the view only`, async () => {
      const view = make();
      expect(view.byteOffset).toBe(8);
      expect(view.buffer.byteLength).toBeGreaterThanOrEqual(size + 16);
      const r = await admitSignedBundleV2FromBytes(view, registry, strict());
      expect(r.ingress.unit_sha256).toBe(sha(original));
      expect(r.admission?.admitted).toBe(true);
    });

    it(`${kind}: the caller's bytes changed just before parsing do not reach the value`, async () => {
      const view = make();
      const expectedAdmission = await admitSignedBundleV2(clone(V.signed_bundles.orch), registry, strict());
      let calls = 0;
      const mutateThenParse = (unit: Uint8Array) => {
        calls++;
        mutateRiskScore(view); // the caller's original buffer, not the argument
        return parseJson(unit);
      };
      const r = await admitFromBytesWithParser(mutateThenParse, view, registry, strict());
      expect(calls).toBe(1);
      expect(Buffer.from(view).toString('utf8')).toContain('"risk_score":999,');
      expect(r.ingress).toEqual({
        accepted: true,
        layer: null,
        class: null,
        offset: null,
        unit_sha256: sha(original),
        canonical_sha256: (await admitSignedBundleV2FromBytes(original, registry, strict())).ingress.canonical_sha256,
      });
      expect(r.value).toEqual(V.signed_bundles.orch);
      expect(r.admission).toEqual(expectedAdmission);
    });
  }

  it('the caller changing its bytes during verification or after the call changes nothing', async () => {
    const view = callerBuffer();
    const real = new Ed25519Provider();
    let calls = 0;
    const tampering = Object.create(real) as Ed25519Provider;
    tampering.verify = async (message, signature, key) => {
      if (calls++ === 0) mutateRiskScore(view);
      return real.verify(message, signature, key);
    };
    const r = await admitSignedBundleV2FromBytes(view, newRegistry(tampering), strict());
    expect(calls).toBeGreaterThan(0);
    expect(Buffer.from(view).toString('utf8')).toContain('"risk_score":999,');
    expect(r.ingress.unit_sha256).toBe(sha(original));
    expect(r.admission?.admitted).toBe(true);
    const before = clone({ ingress: r.ingress, admission: r.admission, value: r.value });
    view.fill(0x20);
    expect({ ingress: r.ingress, admission: r.admission, value: r.value }).toEqual(before);
    expect(r.value).toEqual(V.signed_bundles.orch);
  });
});

describe('a parser fault (injected by these tests only)', () => {
  const unit = Buffer.from(JSON.stringify(V.signed_bundles.orch), 'utf8');
  const fault = { accepted: false, layer: 'parser', class: 'INGRESS_PARSER_MISMATCH', offset: null, unit_sha256: sha(unit), canonical_sha256: null };

  it('the correct parser through the same route admits', async () => {
    const r = await admitFromBytesWithParser(parseJson, unit, registry, strict());
    expect(r.ingress.accepted).toBe(true);
    expect(r.admission?.admitted).toBe(true);
  });

  it('a parser that returns another value is a local fault, before admission', async () => {
    const altered = (u: Uint8Array) => ({ ...parseJson(u), extra: 1 });
    const r = await admitFromBytesWithParser(altered, unit, registry, strict());
    expect(r).toEqual({ ingress: fault, admission: null, value: null });
  });

  it('a parser that changes a number to a non-integer is the same fault', async () => {
    const r = await admitFromBytesWithParser(() => ({ n: 1.5 }), Buffer.from('{"n":1}'), registry);
    expect(r.ingress).toMatchObject({ accepted: false, layer: 'parser', class: 'INGRESS_PARSER_MISMATCH', offset: null });
  });

  it('a parser that throws is the same fault', async () => {
    const throwing = () => {
      throw new SyntaxError('broken parser');
    };
    const r = await admitFromBytesWithParser(throwing, unit, registry, strict());
    expect(r).toEqual({ ingress: fault, admission: null, value: null });
  });

  it('is not part of the package API', () => {
    expect(typeof sdk.admitSignedBundleV2FromBytes).toBe('function');
    expect('admitFromBytesWithParser' in sdk).toBe(false);
  });
});

describe('arguments', () => {
  for (const [kind, arg] of [
    ['a string', '{"n":1}'],
    ['an array of numbers', [123, 125]],
    ['an ArrayBuffer', new ArrayBuffer(2)],
    ['null', null],
  ] as const) {
    it(`${kind} is a TypeError`, async () => {
      await expect(admitSignedBundleV2FromBytes(arg as unknown as Uint8Array, registry)).rejects.toBeInstanceOf(TypeError);
    });
  }
});
